import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
const { SharedStore } = await import('./store.mjs').catch(() => ({}));
const uid = (n) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const draft = (id = 1, op = 2, rev = 0) => ({
  note_id: uid(id),
  operation_id: uid(op),
  expected_revision: rev,
  title: 'Synthetic note',
  body: 'Synthetic body',
});
function setup() {
  assert.equal(typeof SharedStore, 'function');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('drizzle')
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync('drizzle/' + f, 'utf8'));
  }
  let clock = 100000;
  const hooks = {};
  const adapter = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const row = db.prepare(sql).get(...args) ?? null;
              await hooks.first?.(sql, args, row);
              return row;
            },
            async all() {
              return { results: db.prepare(sql).all(...args), success: true };
            },
            async run() {
              return { meta: { changes: db.prepare(sql).run(...args).changes } };
            },
          };
        },
      };
    },
  };
  return { db, store: new SharedStore(adapter, () => clock), hooks, tick: () => (clock += 60000) };
}
test('explicit publish/read/replay/revoke and owner isolation', async () => {
  const { db, store: s } = setup(),
    a = draft();
  assert.deepEqual(await s.list('owner'), []);
  const r = await s.publish('owner', a);
  assert.equal(r.revision, 1);
  assert.deepEqual(await s.publish('owner', a), r);
  assert.deepEqual(await s.list('other'), []);
  await assert.rejects(s.read('other', { note_id: a.note_id, revision: 1 }), /UNAVAILABLE/);
  assert.equal((await s.read('owner', { note_id: a.note_id, revision: 1 })).body, a.body);
  const revoked = await s.revoke('owner', {
    note_id: a.note_id,
    operation_id: uid(3),
    expected_revision: 1,
  });
  assert.equal(revoked.revision, 2);
  assert.deepEqual(await s.list('owner'), []);
  await assert.rejects(s.read('owner', { note_id: a.note_id, revision: 1 }), /UNAVAILABLE/);
  const row = db.prepare('SELECT * FROM shared_notes').get();
  assert.equal(row.body, null);
  assert.equal(row.title, null);
  assert.equal(row.last_operation_kind, 'revoke');
  await assert.rejects(s.publish('owner', { ...a, operation_id: uid(4) }), /CONFLICT/);
});
test('competing revisions cannot overwrite and exact newest replay wins', async () => {
  const { store: s } = setup();
  await s.publish('owner', draft());
  const a = draft(1, 3, 1),
    b = { ...draft(1, 4, 1), body: 'loser' };
  const r = await Promise.allSettled([s.publish('owner', a), s.publish('owner', b)]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await s.list('owner'))[0].revision, 2);
  const winner = r[0].status === 'fulfilled' ? a : b;
  assert.equal((await s.publish('owner', winner)).revision, 2);
  await assert.rejects(s.publish('owner', { ...winner, body: 'different' }), /OPERATION_ID_REUSED/);
});
test('same latest operation ID cannot race through edit or revoke CAS', async () => {
  for (const action of ['publish', 'revoke']) {
    const { store: s, hooks } = setup();
    await s.publish('owner', draft());
    let release, entered;
    const paused = new Promise((r) => (entered = r));
    let wait = true;
    hooks.first = async (sql) => {
      if (wait && sql.startsWith('SELECT') && sql.includes('last_operation_hash')) {
        wait = false;
        entered();
        await new Promise((r) => (release = r));
      }
    };
    const b =
      action === 'publish'
        ? s.publish('owner', draft(1, 9, 2))
        : s.revoke('owner', { note_id: uid(1), operation_id: uid(9), expected_revision: 2 });
    await paused;
    await s.publish('owner', draft(1, 9, 1));
    release();
    await assert.rejects(b, /OPERATION_ID_REUSED|CONFLICT/);
    assert.equal((await s.list('owner'))[0].revision, 2);
  }
});
test('quota saturates and replay/revoke remain available', async () => {
  const { store: s, db, tick } = setup();
  await s.publish('owner', draft());
  for (let i = 0; i < 29; i++)
    await assert.rejects(s.publish('owner', draft(1, 20 + i, 0)), /CONFLICT/);
  await assert.rejects(s.publish('owner', draft(2, 60)), /RATE_LIMIT/);
  assert.equal(db.prepare('SELECT count FROM shared_note_limits').get().count, 31);
  await s.publish('owner', draft());
  await s.revoke('owner', { note_id: uid(1), operation_id: uid(70), expected_revision: 1 });
  tick();
  await s.publish('owner', draft(2, 80));
});
test('active capacity is owner-bound and revoke frees active capacity', async () => {
  const { store: s, tick } = setup();
  for (let i = 1; i <= 50; i++) {
    if (i % 20 === 0) tick();
    await s.publish('owner', draft(i, 100 + i));
  }
  tick();
  await assert.rejects(s.publish('owner', draft(51, 151)), /CAPACITY/);
  await s.publish('other', draft(51, 151));
  await s.revoke('owner', { note_id: uid(1), operation_id: uid(200), expected_revision: 1 });
  await s.publish('owner', draft(51, 201));
  assert.equal((await s.list('owner')).length, 50);
});
test('missing status is explicitly unknown, never definite noncommit', async () => {
  const { store: s } = setup();
  assert.deepEqual(await s.status('owner', { note_id: uid(1), operation_id: uid(2) }), {
    matched: false,
    current_revision: null,
    state: null,
  });
  await s.publish('owner', draft());
  const r = await s.status('owner', { note_id: uid(1), operation_id: uid(2) });
  assert.deepEqual(r, { matched: true, current_revision: 1, state: 'shared', kind: 'publish' });
  assert.deepEqual(await s.status('owner', { note_id: uid(1), operation_id: uid(3) }), {
    matched: false,
    current_revision: 1,
    state: 'shared',
  });
});
test('total tombstone capacity never recycles IDs and is owner-scoped', async () => {
  const { store: s, db } = setup();
  const insert = db.prepare(
    `INSERT INTO shared_notes VALUES(?,?,2,'revoked',NULL,NULL,?,?,'revoke',0,0)`,
  );
  db.exec('BEGIN');
  for (let i = 1; i <= 5000; i++) insert.run('owner', uid(i), uid(i + 6000), '0'.repeat(64));
  db.exec('COMMIT');
  await assert.rejects(s.publish('owner', draft(9000, 9001)), /CAPACITY/);
  assert.equal((await s.publish('other', draft(9000, 9001))).revision, 1);
});
test('clock rollback cannot reset quota or decrease record timestamps', async () => {
  const { store: s, db } = setup();
  await s.publish('owner', draft());
  db.prepare('UPDATE shared_note_limits SET window=999,count=30').run();
  await assert.rejects(s.publish('owner', draft(2, 3)), /RATE_LIMIT/);
  assert.equal(db.prepare('SELECT window FROM shared_note_limits').get().window, 999);
  db.prepare('UPDATE shared_notes SET updated_at=999999').run();
  await s.revoke('owner', { note_id: uid(1), operation_id: uid(4), expected_revision: 1 });
  assert.equal(db.prepare('SELECT updated_at FROM shared_notes').get().updated_at, 999999);
});
test('revision ceiling reserves the final revision for revocation', async () => {
  const { store: s, db } = setup();
  await s.publish('owner', draft());
  db.prepare('UPDATE shared_notes SET revision=2147483646').run();
  await assert.rejects(s.publish('owner', draft(1, 3, 2147483646)), /INVALID_ARGUMENTS/);
  const r = await s.revoke('owner', {
    note_id: uid(1),
    operation_id: uid(4),
    expected_revision: 2147483646,
  });
  assert.equal(r.revision, 2147483647);
  assert.equal(
    (
      await s.revoke('owner', {
        note_id: uid(1),
        operation_id: uid(4),
        expected_revision: 2147483646,
      })
    ).revision,
    2147483647,
  );
});
test('lost post-commit response remains reconcilable and exact retry never duplicates', async () => {
  const { store: s, db, hooks } = setup();
  let lost = true;
  hooks.first = async (sql) => {
    if (lost && sql.startsWith('INSERT INTO shared_notes')) {
      lost = false;
      throw new Error('lost response');
    }
  };
  await assert.rejects(s.publish('owner', draft()), /lost response/);
  assert.equal((await s.status('owner', { note_id: uid(1), operation_id: uid(2) })).matched, true);
  assert.equal((await s.publish('owner', draft())).revision, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shared_notes').get().n, 1);
});
test('schema rejects invalid state/content and existing private tables remain intact', () => {
  const { db } = setup();
  const insert = db.prepare('INSERT INTO shared_notes VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  assert.throws(() =>
    insert.run(
      'owner',
      uid(1),
      1,
      'revoked',
      'not allowed',
      'body',
      uid(2),
      '0'.repeat(64),
      'revoke',
      0,
      0,
    ),
  );
  assert.throws(() =>
    insert.run(
      'owner',
      uid(1),
      1,
      'shared',
      'title',
      'x'.repeat(8193),
      uid(2),
      '0'.repeat(64),
      'publish',
      0,
      0,
    ),
  );
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((x) => x.name);
  assert.deepEqual(tables.sort(), [
    'mutation_limits',
    'shared_note_limits',
    'shared_notes',
    'vaults',
  ]);
});
test('failed or incomplete D1 catalog results never masquerade as an empty catalog', async () => {
  for (const result of [
    { success: false, results: [] },
    { results: [] },
    { success: true, results: null },
  ]) {
    const s = new SharedStore({
      prepare() {
        return {
          bind() {
            return { all: async () => result };
          },
        };
      },
    });
    await assert.rejects(s.list('owner'), /STORAGE_UNAVAILABLE/);
  }
});
