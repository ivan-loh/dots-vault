// Actual built Worker, isolated local D1 and synthetic records only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { encode, b64 } from '../vault-server/src/codec.mjs';
const root = resolve(process.argv[2] ?? '.'),
  shared = process.argv[3] === 'enabled';
const origin = 'https://vault.example',
  owner = 'compiled-synthetic-owner';
const configuration = JSON.parse(readFileSync(root + '/dist/server/wrangler.json', 'utf8'));
const moduleFiles = readdirSync(root + '/dist/server', { recursive: true }).filter((f) =>
  /\.m?js$/.test(f),
);
// Miniflare's Node transport rewrites raw Host. This in-memory test ingress
// restores ONLY the explicit synthetic Host case; the actual built Worker and
// every authorization predicate remain byte-unmodified. Never packaged/deployed.
const entry = {
  type: 'ESModule',
  path: root + '/dist/server/synthetic-test-entry.mjs',
  contents: `import worker from './index.js'; export default {fetch(request,env,ctx){const headers=new Headers(request.headers);const host=headers.get('x-local-synthetic-host');headers.delete('x-local-synthetic-host');const origin=headers.get('x-local-synthetic-origin');headers.delete('x-local-synthetic-origin');if(origin===null)headers.delete('origin');else headers.set('origin',origin);if(host===null||host==='__absent__')headers.delete('host');else headers.set('host',host);return worker.fetch(new Request(request,{headers}),env,ctx)}}`,
};
const mf = new Miniflare({
  modules: [
    entry,
    ...[configuration.main, ...moduleFiles.filter((f) => f !== configuration.main)].map((path) => ({
      type: 'ESModule',
      path: root + '/dist/server/' + path,
    })),
  ],
  modulesRoot: root + '/dist/server',
  compatibilityDate: configuration.compatibility_date,
  compatibilityFlags: configuration.compatibility_flags,
  bindings: { VAULT_OWNER_SUBJECT: owner, VAULT_CANONICAL_ORIGIN: origin },
  d1Databases: ['DB'],
  cf: false,
  port: 0,
  inspectorPort: 0,
  assets: {
    directory: root + '/dist/client',
    binding: 'ASSETS',
    routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
  },
  outboundService: () => new Response('Synthetic test: outbound blocked', { status: 403 }),
});
let checks = 0;
const equal = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  },
  ok = (value) => {
    assert.ok(value);
    checks++;
  };
const headers = {
  host: 'vault.example',
  'oai-authenticated-user-id': owner,
  'oai-authenticated-user-email': 'synthetic@example.invalid',
};
const request = async (
  path,
  { method = 'GET', extra = {}, body, anonymous = false, urlOrigin = origin } = {},
) => {
  const h = { ...(anonymous ? { host: 'vault.example' } : headers), ...extra };
  h['x-local-synthetic-host'] = h.host ?? '__absent__';
  delete h.host;
  if (Object.hasOwn(h, 'origin') && h.origin !== undefined)
    h['x-local-synthetic-origin'] = h.origin;
  delete h.origin;
  return (await mf.getWorker()).fetch(urlOrigin + path, {
    method,
    redirect: 'manual',
    headers: h,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
};
const rpc = (method, params = {}, extra = {}) =>
  request('/mcp', {
    method: 'POST',
    extra: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}),
      ...extra,
    },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        ...params,
      },
    },
  });
const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).json();
const sharedRequest = (method, params = {}, extra = {}) =>
  request('/shared-notes/api', {
    method: 'POST',
    extra: { origin, 'content-type': 'application/json', ...extra },
    body: { jsonrpc: '2.0', id: 1, method, params },
  });
const uuid = (n) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
try {
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync(root + '/drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync(root + '/drizzle/' + file, 'utf8')
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  for (const path of ['/vault', '/vault/assets/app.js', '/api/status', '/api/vault', '/mcp'])
    equal((await request(path, { anonymous: true })).status, 403);
  const landing = await request('/');
  equal(landing.status, 307);
  equal(landing.headers.get('location'), '/vault');
  const wrongLanding = await request('/', { extra: { 'oai-authenticated-user-id': 'wrong' } });
  ok(wrongLanding.status !== 307);
  ok(!(await wrongLanding.text()).includes('type=\"password\"'));
  equal((await request('/api/status')).status, 200);
  equal((await request('/api/vault')).status, 404);
  for (const path of [
    '/vault/',
    '/VAULT',
    '/api/status/',
    '/api/%73tatus',
    '/mcp/',
    '/MCP',
    '/mcp?x=1',
  ])
    ok((await request(path)).status !== 200);
  for (const [path, source, type] of [
    ['/vault', 'vault-assets/index.html.txt', 'text/html'],
    ['/vault/assets/app.js', 'vault-assets/app.js.txt', 'text/javascript'],
    ['/vault/assets/styles.css', 'vault-assets/styles.css.txt', 'text/css'],
  ]) {
    const r = await request(path);
    equal(r.status, 200);
    equal(await r.text(), readFileSync(root + '/' + source, 'utf8'));
    ok(r.headers.get('content-type').startsWith(type));
    ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    ok(r.headers.get('cache-control').includes('no-store'));
  }
  const zero = (n) => b64(new Uint8Array(n));
  const envelope = {
    format: 'dots-vault',
    version: 1,
    suite: 'argon2id13-xchacha20poly1305-v1',
    vaultId: '1'.repeat(32),
    revision: 1,
    master: { id: '2'.repeat(32), generation: 1 },
    passwordWrap: {
      id: '3'.repeat(32),
      kind: 'password',
      createdRevision: 1,
      kdf: { algorithm: 'argon2id13', salt: zero(16), ops: 3, memory: 67108864 },
      nonce: zero(24),
      ciphertext: zero(48),
    },
    recoveryWrap: null,
    manifest: { nonce: zero(24), ciphertext: zero(16) },
    records: [],
  };
  const mutation = (path, payload, extra = {}) =>
    request(path, {
      method: 'POST',
      extra: { origin, 'content-type': 'application/json', ...extra },
      body: encode(payload),
    });
  const create = {
    expectedRevision: 0,
    operationId: envelope.vaultId + ':0:' + '4'.repeat(32),
    envelope,
  };
  equal(
    (await mutation('/api/vault/create', create, { origin: 'https://foreign.example' })).status,
    403,
  );
  equal((await request('/api/vault')).status, 404);
  equal((await mutation('/api/vault/create', create)).status, 201);
  equal((await mutation('/api/vault/create', create)).status, 201);
  const changed = { ...envelope, revision: 2 };
  const replace = {
    expectedRevision: 1,
    operationId: envelope.vaultId + ':1:' + '5'.repeat(32),
    envelope: changed,
  };
  equal((await mutation('/api/vault/replace', replace)).status, 200);
  equal(
    (
      await mutation('/api/vault/replace', {
        ...replace,
        operationId: envelope.vaultId + ':1:' + '6'.repeat(32),
      })
    ).status,
    409,
  );
  equal((await (await request('/api/vault')).json()).envelope.revision, 2);
  const privateBefore = (await db.prepare('SELECT * FROM vaults').all()).results;
  equal((await rpc('server/discover')).status, 200);
  equal((await rpc('tools/list', {}, { host: null })).status, 200);
  equal(
    (await rpc('tools/list', {}, { host: null, 'oai-authenticated-user-id': 'wrong' })).status,
    403,
  );
  equal(
    (
      await request('/mcp', {
        method: 'POST',
        urlOrigin: 'https://foreign.example',
        extra: { host: null, 'content-type': 'application/json' },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      })
    ).status,
    403,
  );
  const catalog = await (await rpc('tools/list')).json();
  equal(
    catalog.result.tools.map((x) => x.name),
    [
      'list_poc_fixtures',
      'read_poc_fixture',
      ...(shared ? ['list_shared_notes', 'read_shared_note'] : []),
    ],
  );
  for (const fixture_id of ['note-demo', 'contact-demo', 'credential-demo']) {
    const result = await call('read_poc_fixture', { fixture_id });
    equal(result.result.isError, false);
    equal(JSON.parse(result.result.content[0].text).synthetic, true);
  }
  for (const name of ['decrypt_vault', 'write_shared_note', 'revoke_shared_note'])
    equal((await call(name)).result.isError, true);
  for (const extra of [
    { origin: 'null' },
    { origin: 'https://foreign.example' },
    { host: 'foreign.example' },
    { 'oai-authenticated-user-id': 'not-owner' },
    { 'oai-authenticated-user-email': '' },
  ])
    equal((await rpc('tools/list', {}, extra)).status, 403);
  if (!shared) {
    for (const path of [
      '/shared-notes',
      '/shared-notes/api',
      '/SHARED-NOTES/api',
      '/shared-notes/app.mjs',
    ])
      equal((await request(path)).status, 503);
    equal((await call('list_shared_notes')).result.isError, true);
  } else {
    for (const [path, source] of [
      ['/shared-notes', 'index.html.txt'],
      ['/shared-notes/app.mjs', 'app.mjs'],
      ['/shared-notes/session.mjs', 'session.mjs'],
      ['/shared-notes/transport.mjs', 'transport.mjs'],
      ['/shared-notes/model.mjs', 'model.mjs'],
      ['/shared-notes/styles.css', 'styles.css.txt'],
    ]) {
      const r = await request(path);
      equal(r.status, 200);
      equal(await r.text(), readFileSync(root + '/shared-notes/' + source, 'utf8'));
      ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
      ok(!r.headers.get('content-security-policy').includes('unsafe-inline'));
      equal((await request(path, { anonymous: true })).status, 403);
    }
    for (const path of [
      '/shared-notes/',
      '/SHARED-NOTES',
      '/shared-notes/api/',
      '/shared-notes/api?x=1',
      '/shared-notes/%61pi',
      '/shared-notes/store.mjs',
    ])
      ok((await request(path)).status !== 200);
    equal((await (await sharedRequest('list')).json()).result, { notes: [] });
    equal((await sharedRequest('list', {}, { origin: undefined })).status, 403);
    equal((await sharedRequest('list', {}, { host: null })).status, 200);
    equal(
      (await sharedRequest('list', {}, { host: null, 'oai-authenticated-user-id': 'wrong' }))
        .status,
      403,
    );
    equal(
      (
        await request('/shared-notes/api', {
          method: 'POST',
          urlOrigin: 'https://foreign.example',
          extra: { host: null, origin, 'content-type': 'application/json' },
          body: { jsonrpc: '2.0', id: 1, method: 'list', params: {} },
        })
      ).status,
      403,
    );
    const note = {
      note_id: uuid(1),
      operation_id: uuid(2),
      expected_revision: 0,
      title: 'Synthetic <script> & \u202e',
      body: 'Non-sensitive compiled proof 😀\n<script>inert</script>',
    };
    for (const extra of [
      { origin: 'null' },
      { origin: 'https://foreign.example' },
      { host: 'foreign.example' },
      { 'oai-authenticated-user-id': 'other' },
    ])
      equal((await sharedRequest('publish', note, extra)).status, 403);
    equal((await (await sharedRequest('list')).json()).result.notes.length, 0);
    equal((await sharedRequest('publish', note)).status, 200);
    equal((await sharedRequest('publish', note)).status, 200);
    equal((await (await sharedRequest('list')).json()).result.notes[0], {
      note_id: note.note_id,
      revision: 1,
      title: note.title,
    });
    const read = await call('read_shared_note', { note_id: note.note_id, revision: 1 });
    equal(read.result.isError, false);
    equal(JSON.parse(read.result.content[0].text).body, note.body);
    equal((await call('list_shared_notes', { owner: 'other' })).result.isError, true);
    const edit = {
      ...note,
      operation_id: uuid(3),
      expected_revision: 1,
      body: 'Changed synthetic copy',
    };
    equal((await sharedRequest('publish', edit)).status, 200);
    equal(
      (await call('read_shared_note', { note_id: note.note_id, revision: 1 })).result.isError,
      true,
    );
    const revoke = { note_id: note.note_id, operation_id: uuid(4), expected_revision: 2 };
    equal((await sharedRequest('revoke', revoke)).status, 200);
    equal((await sharedRequest('revoke', revoke)).status, 200);
    equal(
      (await call('read_shared_note', { note_id: note.note_id, revision: 2 })).result.isError,
      true,
    );
    equal(JSON.parse((await call('list_shared_notes')).result.content[0].text), { notes: [] });
    equal(await db.prepare('SELECT title,body,state,revision FROM shared_notes').first(), {
      title: null,
      body: null,
      state: 'revoked',
      revision: 3,
    });
    equal((await sharedRequest('publish', { ...note, operation_id: uuid(5) })).status, 409);
  }
  equal((await db.prepare('SELECT * FROM vaults').all()).results, privateBefore);
  console.log(
    JSON.stringify({ checks, shared, worker: root + '/dist/server/index.js', result: 'PASS' }),
  );
} finally {
  await mf.dispose();
}
