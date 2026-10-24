import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { SharedStore } from './store.mjs';
const uuid = () => crypto.randomUUID();
const input = (note_id = uuid(), expected_revision = 0, operation_id = uuid()) => ({
  note_id,
  expected_revision,
  operation_id,
  title: 'Synthetic shared note',
  body: 'Untrusted synthetic body <script>inert</script>',
});
const status = (a) => ({ note_id: a.note_id, operation_id: a.operation_id });
const wins = (r) => r.filter((x) => x.status === 'fulfilled');
const wrap = (db, intercept) => ({
  prepare(sql) {
    const p = db.prepare(sql);
    return {
      bind(...args) {
        const bound = p.bind(...args);
        return intercept(sql, args, bound) ?? bound;
      },
    };
  },
});

test('fresh rebuilt backend against isolated real D1', async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("Disabled local test route")}}',
    compatibilityDate: '2026-01-01',
    cf: false,
    port: 0,
    inspectorPort: 0,
    d1Databases: ['DB'],
    outboundService: () => new Response('No outbound networking', { status: 403 }),
  });
  try {
    const db = await mf.getD1Database('DB');
    const migrations = readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((x) => x.endsWith('.sql'))
      .sort();
    const migrate = async (file) => {
      for (const sql of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8')
        .split('--> statement-breakpoint')
        .map((x) => x.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    };
    await migrate(migrations[0]);
    await db
      .prepare('INSERT INTO vaults VALUES(?,?,?,?,?,?)')
      .bind(
        'synthetic-private-owner',
        'synthetic-vault',
        1,
        'SYNTHETIC_OPAQUE_ENVELOPE',
        'synthetic-op',
        'synthetic-digest',
      )
      .run();
    await db
      .prepare('INSERT INTO mutation_limits VALUES(?,?,?)')
      .bind('synthetic-private-owner', 1, 4)
      .run();
    const privateBefore = (await db.prepare('SELECT * FROM vaults').all()).results,
      limitBefore = (await db.prepare('SELECT * FROM mutation_limits').all()).results;
    const schemasBefore = (
      await db
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE name IN ('vaults','mutation_limits','vaults_vault_id_unique') ORDER BY name",
        )
        .all()
    ).results;
    for (const m of migrations.slice(1)) await migrate(m);
    const store = new SharedStore(db, () => 120000);

    await t.test(
      'parallel identical creates apply exactly once and changed payload never replays',
      async () => {
        const a = input(),
          r = await Promise.all(Array.from({ length: 10 }, () => store.publish('create', a)));
        assert.ok(r.every((x) => x.revision === 1));
        const b = input(a.note_id, 1),
          edits = await Promise.allSettled([
            store.publish('create', b),
            store.publish('create', { ...b, body: 'Changed body' }),
          ]);
        assert.equal(wins(edits).length, 1);
        assert.match(
          edits.find((x) => x.status === 'rejected').reason.message,
          /OPERATION_ID_REUSED|CONFLICT/,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM shared_notes WHERE owner_id=?')
              .bind('create')
              .first()
          ).n,
          1,
        );
      },
    );
    await t.test('edit/edit/revoke CAS has exactly one winner', async () => {
      const a = input();
      await store.publish('cas', a);
      const attempts = await Promise.allSettled([
        store.publish('cas', input(a.note_id, 1)),
        store.publish('cas', input(a.note_id, 1)),
        store.revoke('cas', { note_id: a.note_id, operation_id: uuid(), expected_revision: 1 }),
      ]);
      assert.equal(wins(attempts).length, 1);
      assert.equal((await store.status('cas', status(a))).current_revision, 2);
    });
    await t.test(
      'both latest-operation ID predicates survive a deliberately stale pre-read',
      async () => {
        for (const action of ['publish', 'revoke']) {
          const owner = 'reuse-' + action,
            a = input();
          await store.publish(owner, a);
          let enter,
            release,
            held = false;
          const entered = new Promise((r) => (enter = r)),
            gate = new Promise((r) => (release = r));
          const delayed = wrap(db, (sql, args, b) => {
            if (sql.startsWith('SELECT revision,state,last_operation_id') && !held) {
              held = true;
              return {
                first: async () => {
                  const snapshot = await b.first();
                  enter();
                  await gate;
                  return snapshot;
                },
              };
            }
          });
          const op = uuid(),
            late = new SharedStore(delayed, () => 120000),
            b =
              action === 'publish'
                ? input(a.note_id, 2, op)
                : { note_id: a.note_id, operation_id: op, expected_revision: 2 };
          const outcome = late[action](owner, b).then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
          await entered;
          const winning = { ...input(a.note_id, 1, op), body: 'Winning revision 2' };
          await store.publish(owner, winning);
          release();
          assert.match((await outcome).error?.message ?? '', /OPERATION_ID_REUSED|CONFLICT/);
          assert.equal(
            (await store.read(owner, { note_id: a.note_id, revision: 2 })).body,
            winning.body,
          );
        }
      },
    );
    await t.test(
      'last quota slot is atomic; exact replay and revoke bypass exhaustion',
      async () => {
        await db.prepare('INSERT INTO shared_note_limits VALUES(?,?,?)').bind('quota', 2, 29).run();
        const attempts = Array.from({ length: 8 }, () => input()),
          r = await Promise.allSettled(attempts.map((a) => store.publish('quota', a)));
        assert.equal(wins(r).length, 1);
        assert.equal(
          (
            await db
              .prepare('SELECT count FROM shared_note_limits WHERE owner_id=?')
              .bind('quota')
              .first()
          ).count,
          31,
        );
        const a = attempts[r.findIndex((x) => x.status === 'fulfilled')];
        await store.publish('quota', a);
        await store.revoke('quota', {
          note_id: a.note_id,
          operation_id: uuid(),
          expected_revision: 1,
        });
        await assert.rejects(
          new SharedStore(db, () => 60000).publish('quota', input()),
          /RATE_LIMIT/,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT window FROM shared_note_limits WHERE owner_id=?')
              .bind('quota')
              .first()
          ).window,
          2,
        );
        await new SharedStore(db, () => 180000).publish('quota', input());
      },
    );
    const seed = async (owner, n, state) =>
      db
        .prepare(
          `WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<?) INSERT INTO shared_notes(owner_id,note_id,revision,state,title,body,last_operation_id,last_operation_hash,last_operation_kind,created_at,updated_at) SELECT ?,printf('%08x-0000-4000-8000-%012x',x,x),1,?,CASE WHEN ?='shared' THEN 'Synthetic seed' ELSE NULL END,CASE WHEN ?='shared' THEN '' ELSE NULL END,?,?,CASE WHEN ?='shared' THEN 'publish' ELSE 'revoke' END,0,0 FROM seq`,
        )
        .bind(n, owner, state, state, state, uuid(), '0'.repeat(64), state)
        .run();
    await t.test('active and lifetime capacities atomically admit only one last slot', async () => {
      for (const [owner, n, state] of [
        ['active', 49, 'shared'],
        ['lifetime', 4999, 'revoked'],
      ]) {
        await seed(owner, n, state);
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => store.publish(owner, input())),
        );
        assert.equal(wins(results).length, 1);
        assert.ok(
          results
            .filter((x) => x.status === 'rejected')
            .every((x) => x.reason.message === 'CAPACITY'),
        );
        assert.equal(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM shared_notes WHERE owner_id=?')
              .bind(owner)
              .first()
          ).n,
          n + 1,
        );
      }
    });
    await t.test(
      'absent status does not preclude delayed commit; exact retry never duplicates',
      async () => {
        const a = input();
        let enter,
          release,
          held = false;
        const entered = new Promise((r) => (enter = r)),
          gate = new Promise((r) => (release = r));
        const delayed = wrap(db, (sql, args, b) => {
          if (sql.startsWith('INSERT INTO shared_notes') && !held) {
            held = true;
            return {
              first: async () => {
                enter();
                await gate;
                return b.first();
              },
            };
          }
        });
        const late = new SharedStore(delayed, () => 120000),
          pending = late.publish('delayed-create', a);
        await entered;
        assert.deepEqual(await store.status('delayed-create', status(a)), {
          matched: false,
          current_revision: null,
          state: null,
        });
        const retry = await store.publish('delayed-create', a);
        release();
        assert.deepEqual(await pending, retry);
        assert.equal(
          (
            await db
              .prepare('SELECT COUNT(*) AS n FROM shared_notes WHERE owner_id=?')
              .bind('delayed-create')
              .first()
          ).n,
          1,
        );
      },
    );
    await t.test(
      'pre/post commit storage failures consume quota correctly and remain recoverable',
      async () => {
        for (const phase of ['before', 'after']) {
          const owner = 'fault-' + phase,
            a = input();
          let once = true;
          const fault = wrap(db, (sql, args, b) => {
            if (sql.startsWith('INSERT INTO shared_notes'))
              return {
                first: async () => {
                  if (!once) return b.first();
                  once = false;
                  if (phase === 'before') throw Error('injected');
                  await b.first();
                  throw Error('injected');
                },
              };
          });
          const s = new SharedStore(fault, () => 120000);
          await assert.rejects(s.publish(owner, a), /injected/);
          assert.equal((await store.status(owner, status(a))).matched, phase === 'after');
          assert.equal((await s.publish(owner, a)).revision, 1);
          assert.equal(
            (
              await db
                .prepare('SELECT count FROM shared_note_limits WHERE owner_id=?')
                .bind(owner)
                .first()
            ).count,
            phase === 'after' ? 1 : 2,
          );
        }
      },
    );
    await t.test(
      'delayed edit cannot resurrect revoked plaintext; revocation replaces content hash',
      async () => {
        const owner = 'revocation',
          a = input();
        await store.publish(owner, a);
        const before = await db
          .prepare('SELECT last_operation_hash FROM shared_notes WHERE owner_id=?')
          .bind(owner)
          .first();
        let enter,
          release,
          held = false;
        const entered = new Promise((r) => (enter = r)),
          gate = new Promise((r) => (release = r));
        const delayed = wrap(db, (sql, args, b) => {
          if (
            sql.startsWith('UPDATE shared_notes') &&
            sql.includes("last_operation_kind='publish'") &&
            !held
          ) {
            held = true;
            return {
              first: async () => {
                enter();
                await gate;
                return b.first();
              },
            };
          }
        });
        const late = new SharedStore(delayed, () => 120000),
          pending = late.publish(owner, input(a.note_id, 1)).then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
        await entered;
        const rev = { note_id: a.note_id, operation_id: uuid(), expected_revision: 1 };
        await store.revoke(owner, rev);
        release();
        assert.match((await pending).error?.message ?? '', /CONFLICT/);
        const after = await db
          .prepare('SELECT title,body,last_operation_hash FROM shared_notes WHERE owner_id=?')
          .bind(owner)
          .first();
        assert.equal(after.title, null);
        assert.equal(after.body, null);
        assert.notEqual(after.last_operation_hash, before.last_operation_hash);
        await assert.rejects(store.publish(owner, input(a.note_id)), /CONFLICT/);
      },
    );
    await t.test(
      'terminal revision can always revoke and maximum Unicode/byte payload round-trips',
      async () => {
        const a = { ...input(), title: '😀'.repeat(120), body: '\0'.repeat(8192) };
        await store.publish('terminal', a);
        assert.equal(
          (await store.read('terminal', { note_id: a.note_id, revision: 1 })).body,
          a.body,
        );
        await db
          .prepare('UPDATE shared_notes SET revision=2147483646 WHERE owner_id=?')
          .bind('terminal')
          .run();
        await assert.rejects(
          store.publish('terminal', input(a.note_id, 2147483646)),
          /INVALID_ARGUMENTS/,
        );
        const rev = { note_id: a.note_id, expected_revision: 2147483646, operation_id: uuid() };
        assert.equal((await store.revoke('terminal', rev)).revision, 2147483647);
        assert.equal((await store.revoke('terminal', rev)).revision, 2147483647);
        await assert.rejects(
          store.read('terminal', { note_id: a.note_id, revision: 2147483646 }),
          /UNAVAILABLE/,
        );
      },
    );
    await t.test(
      'owner isolation and unchanged private schema/data after additive migration and mutations',
      async () => {
        const a = input();
        await store.publish('isolation', a);
        await assert.rejects(
          store.read('other', { note_id: a.note_id, revision: 1 }),
          /UNAVAILABLE/,
        );
        assert.deepEqual(await store.list('other'), []);
        assert.deepEqual((await db.prepare('SELECT * FROM vaults').all()).results, privateBefore);
        assert.deepEqual(
          (await db.prepare('SELECT * FROM mutation_limits').all()).results,
          limitBefore,
        );
        assert.deepEqual(
          (
            await db
              .prepare(
                "SELECT name,sql FROM sqlite_master WHERE name IN ('vaults','mutation_limits','vaults_vault_id_unique') ORDER BY name",
              )
              .all()
          ).results,
          schemasBefore,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});
