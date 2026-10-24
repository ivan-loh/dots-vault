import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { handlePocRequest, pocNamespace, rejectPocAlias } from './runtime.mjs';
const origin = 'https://poc.example.test',
  owner = 'fixture-owner';
const pins = { VAULT_OWNER_SUBJECT: owner, VAULT_CANONICAL_ORIGIN: origin };
const rpc = (method = 'tools/list', params = {}) => ({
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
});
const request = (body = rpc(), { path = '/mcp', method = 'POST', headers = {}, url } = {}) => {
  let envelope = body;
  if (typeof body === 'string') {
    try {
      envelope = JSON.parse(body);
    } catch {
      envelope = {};
    }
  }
  const wireMethod =
    typeof envelope?.method === 'string' && /^[\x21-\x7e]+$/.test(envelope.method)
      ? envelope.method
      : 'tools/list';
  return new Request(url ?? origin + path, {
    method,
    headers: {
      host: 'poc.example.test',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': wireMethod,
      ...(envelope?.method === 'tools/call' ? { 'mcp-name': String(envelope.params?.name) } : {}),
      ...headers,
    },
    ...(['GET', 'HEAD'].includes(method)
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
};
const options = (extra = {}) => ({
  enabled: true,
  pins,
  getIdentity: async () => ({ userId: owner, email: 'fixture@example.invalid' }),
  ...extra,
});
const run = (body = rpc(), extra = {}, context = {}) =>
  handlePocRequest(request(body, extra), options(context));
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
const value = async (r) => {
  const body = await r.json();
  return JSON.parse(body.result.content[0].text);
};

test('hard-disabled source gate touches nothing and no network mode can activate', async () => {
  const forbidden = new Proxy(
    {},
    {
      get() {
        assert.fail('disabled request inspected');
      },
    },
  );
  for (const enabled of [undefined, false, 'true', 1, null])
    assert.equal(
      (
        await handlePocRequest(forbidden, {
          enabled,
          getIdentity() {
            assert.fail('identity inspected');
          },
        })
      ).status,
      503,
    );
  assert.match(
    readFileSync(new URL('../lib/connector-poc-activation.mjs', import.meta.url), 'utf8'),
    /CONNECTOR_POC_ENABLED\s*=\s*true/,
  );
});

test('exact owner and nonempty email are mandatory on every RPC method', async () => {
  for (const method of ['server/discover', 'tools/list', 'tools/call'])
    for (const identity of [
      null,
      { userId: 'other', email: 'x@example.invalid' },
      { userId: owner },
      { userId: owner, email: '' },
    ]) {
      const r = await run(
        rpc(method, method === 'tools/call' ? { name: 'list_poc_fixtures', arguments: {} } : {}),
        {},
        { getIdentity: async () => identity },
      );
      assert.equal(r.status, 403);
      assert.doesNotMatch(await r.text(), /DOTS_VAULT_POC|DEMO_ONLY|Synthetic/);
    }
  const r = await run(
    rpc(),
    {
      headers: {
        'oai-authenticated-user-id': owner,
        'oai-authenticated-user-email': 'fixture@example.invalid',
        'OAI-Sites-Authorization': 'Bearer invented-not-a-token',
      },
    },
    { getIdentity: async () => null },
  );
  assert.equal(r.status, 403);
});

test('pins, HTTPS origin, conflicting Host and optional Origin are checked', async () => {
  for (const override of [
    { VAULT_OWNER_SUBJECT: '' },
    { VAULT_OWNER_SUBJECT: ' bad ' },
    { VAULT_CANONICAL_ORIGIN: 'http://poc.example.test' },
    { VAULT_CANONICAL_ORIGIN: origin + '/' },
    { VAULT_CANONICAL_ORIGIN: origin + '/x' },
  ])
    assert.equal((await run(rpc(), {}, { pins: { ...pins, ...override } })).status, 503);
  for (const headers of [
    { host: 'other.invalid' },
    { host: 'other.invalid', 'x-forwarded-host': 'poc.example.test' },
    { origin: 'https://other.invalid' },
    { origin: 'null' },
  ])
    assert.equal((await run(rpc(), { headers })).status, 403);
  assert.equal((await run(rpc(), { url: 'https://other.invalid/mcp' })).status, 403);
  assert.equal((await run(rpc(), { headers: { origin } })).status, 200);
  assert.equal((await run()).status, 200);
});

test('canonical URL and trusted owner remain mandatory when transport omits Host', async () => {
  for (const body of [
    rpc('server/discover'),
    rpc(),
    call('read_poc_fixture', { fixture_id: 'note-demo' }),
  ]) {
    const req = () => {
      const r = request(body);
      r.headers.delete('host');
      return r;
    };
    assert.equal((await handlePocRequest(req(), options())).status, 200);
    for (const identity of [
      null,
      { userId: 'other', email: 'fixture@example.invalid' },
      { userId: owner, email: '' },
    ])
      assert.equal(
        (await handlePocRequest(req(), options({ getIdentity: async () => identity }))).status,
        403,
      );
    const forged = req();
    forged.headers.set('oai-authenticated-user-id', owner);
    forged.headers.set('oai-authenticated-user-email', 'fixture@example.invalid');
    forged.headers.set('OAI-Sites-Authorization', 'Bearer invented-not-a-token');
    assert.equal(
      (await handlePocRequest(forged, options({ getIdentity: async () => null }))).status,
      403,
    );
    for (const value of [
      'null',
      'https://other.invalid',
      'http://poc.example.test',
      origin + ', https://other.invalid',
      '',
    ]) {
      const r = req();
      r.headers.set('origin', value);
      assert.equal((await handlePocRequest(r, options())).status, 403, value);
    }
    for (const url of [
      'https://other.invalid/mcp',
      'http://poc.example.test/mcp',
      'https://poc.example.test:444/mcp',
    ]) {
      const r = request(body, {
        url,
        headers: {
          'x-forwarded-host': 'poc.example.test',
          forwarded: 'host=poc.example.test;proto=https',
        },
      });
      r.headers.delete('host');
      assert.equal((await handlePocRequest(r, options())).status, 403, url);
    }
  }
});

test('supplied Host permits only equivalent canonical authority, never forwarded values', async () => {
  for (const host of [
    'poc.example.test',
    'POC.EXAMPLE.TEST',
    'poc.example.test:443',
    'POC.EXAMPLE.TEST:443',
  ])
    assert.equal((await run(rpc(), { headers: { host } })).status, 200, host);
  for (const host of [
    '',
    'poc.example.test:80',
    'poc.example.test:444',
    'poc.example.test:0443',
    'poc.example.test.',
    'poc.example.test,other.invalid',
    'poc.example.test:443, poc.example.test',
    'poc.example.test/path',
    'poc.example.test?x',
    'poc.example.test#x',
    'poc.example.test@other.invalid',
    'other.invalid@poc.example.test',
    'https://poc.example.test',
    'poc%2eexample.test',
    'poc.example.test\\other.invalid',
  ])
    assert.equal(
      (await run(rpc(), { headers: { host, 'x-forwarded-host': 'poc.example.test' } })).status,
      403,
      host,
    );
  const otherPins = { ...pins, VAULT_CANONICAL_ORIGIN: origin + ':8443' };
  for (const host of ['poc.example.t\u00e9st', 'poc.example. test', 'poc.example.test\t:443'])
    assert.equal((await run(rpc(), { headers: { host } })).status, 403, host);
  assert.equal(
    (
      await run(
        rpc(),
        { url: origin + ':8443/mcp', headers: { host: 'POC.EXAMPLE.TEST:8443' } },
        { pins: otherPins },
      )
    ).status,
    200,
  );
  for (const host of ['poc.example.test', 'poc.example.test:443'])
    assert.equal(
      (await run(rpc(), { url: origin + ':8443/mcp', headers: { host } }, { pins: otherPins }))
        .status,
      403,
    );
});

test('canonical namespace detects aliases before framework routing', async () => {
  for (const path of [
    '/mcp/',
    '/MCP',
    '/m%63p',
    '/%6dcp',
    '//mcp',
    '/mcp//',
    '/mcp%2f',
    '/mcp?x=1',
    '/mcp?',
    '/mcp#x',
  ]) {
    assert.equal(rejectPocAlias(new URL(origin + path)), true, path);
    assert.equal((await run(rpc(), { path })).status, 404, path);
  }
  assert.equal(pocNamespace('/vault'), false);
  assert.equal(pocNamespace('/mcp-other'), false);
  assert.equal(rejectPocAlias(new URL(origin + '/mcp')), false);
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const r = await run(rpc(), { method });
    assert.equal(r.status, 405);
    if (method === 'HEAD') assert.equal(await r.text(), '');
  }
});

test('discovery and the exact read-only tools return safe JSON headers', async () => {
  const discovery = (await (await run(rpc('server/discover'))).json()).result;
  assert.deepEqual(discovery.supportedVersions, ['2026-07-28']);
  assert.deepEqual(discovery.capabilities, { tools: {} });
  assert.equal(discovery.resultType, 'complete');
  assert.equal(discovery.ttlMs, 0);
  assert.equal(discovery.cacheScope, 'private');
  const r = await run(),
    body = await r.json();
  assert.deepEqual(
    body.result.tools.map((t) => t.name),
    ['list_poc_fixtures', 'read_poc_fixture'],
  );
  for (const t of body.result.tools) assert.equal(t.inputSchema.additionalProperties, false);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});

test('all three immutable fictional fixtures are explicit and cannot read arbitrary data', async () => {
  const listed = await value(await run(call('list_poc_fixtures')));
  assert.deepEqual(
    listed.fixtures.map((x) => x.fixture_id),
    ['note-demo', 'contact-demo', 'credential-demo'],
  );
  for (const id of listed.fixtures.map((x) => x.fixture_id)) {
    const record = await value(await run(call('read_poc_fixture', { fixture_id: id })));
    assert.equal(record.synthetic, true);
    assert.match(record.disclosure, /Invented/);
    assert.equal(record.fixture_id, id);
  }
  const credential = await value(
    await run(call('read_poc_fixture', { fixture_id: 'credential-demo' })),
  );
  assert.equal(credential.data.password, 'NONFUNCTIONAL_DEMO_VALUE_DO_NOT_USE');
  assert.equal(credential.data.username, 'DEMO_ONLY_NOT_A_REAL_ACCOUNT');
  assert.equal(
    (await value(await run(call('read_poc_fixture', { fixture_id: 'private-note-id' })))).error,
    'UNAVAILABLE',
  );
  for (const name of [
    'read_shared_note',
    'update_shared_note',
    'read_password',
    'read_private_note',
    'decrypt',
    'fetch',
    'list_vault',
  ])
    assert.equal((await value(await run(call(name, {})))).error, 'UNKNOWN_TOOL');
});

test('strict argument schemas reject forged owner, path, actor and fields', async () => {
  for (const args of [
    { fixture_id: 'note-demo', owner },
    { fixture_id: 'note-demo', actor: 'current dot' },
    { fixture_id: 'note-demo', path: '/api/vault' },
    { fixture_id: 1 },
    null,
    [],
    {},
    { fixture_id: 'x'.repeat(81) },
  ])
    assert.equal(
      (await value(await run(call('read_poc_fixture', args)))).error,
      'INVALID_ARGUMENTS',
    );
  assert.equal(
    (await value(await run(call('list_poc_fixtures', { includeSecrets: true })))).error,
    'INVALID_ARGUMENTS',
  );
});

test('raw RPC rejects duplicates, invalid Unicode, rounded numbers, deep input and extra keys', async () => {
  const invalid = [
    '{',
    '{"jsonrpc":"2.0","id":1,"id":2,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_poc_fixture","arguments":{"fixture_id":"note-demo","fixture_\\u0069d":"credential-demo"}}}',
    '\ud800',
    JSON.stringify(rpc()).replace('tools/list', '\\ud800'),
    '['.repeat(17) + '0' + ']'.repeat(17),
  ];
  for (const text of invalid) assert.equal((await run(text)).status, 400);
  for (const id of ['1.0000000000000001', '9007199254740990.9', '1e0', '-0'])
    assert.equal((await run(JSON.stringify(rpc()).replace('"id":1', '"id":' + id))).status, 400);
  for (const data of [
    [],
    null,
    { ...rpc(), id: null },
    { ...rpc(), id: 'x'.repeat(65) },
    { ...rpc(), params: null },
    { ...rpc(), extra: true },
    { jsonrpc: '2.0', method: 'tools/list' },
  ])
    assert.equal((await run(data)).status, 400);
  assert.equal((await (await run(rpc('initialize'))).json()).error.code, -32601);
});

test('content type, encoded body and streamed byte limits fail closed', async () => {
  for (const type of ['text/plain', 'application/jsonp', 'application/json; charset=latin1'])
    assert.equal((await run(rpc(), { headers: { 'content-type': type } })).status, 415);
  assert.equal((await run(rpc(), { headers: { 'content-encoding': 'gzip' } })).status, 415);
  assert.equal((await run(' '.repeat(65537))).status, 413);
  const exact = JSON.stringify(rpc());
  assert.equal(
    (await run(exact + ' '.repeat(65536 - new TextEncoder().encode(exact).length))).status,
    200,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40000));
      controller.enqueue(new Uint8Array(40000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const r = new Request(origin + '/mcp', {
    method: 'POST',
    headers: { host: 'poc.example.test', 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal((await handlePocRequest(r, options())).status, 413);
  assert.equal(cancelled, true);
  const bad = new Request(origin + '/mcp', {
    method: 'POST',
    headers: { host: 'poc.example.test', 'content-type': 'application/json' },
    body: new Uint8Array([0xc3, 0x28]),
  });
  assert.equal((await handlePocRequest(bad, options())).status, 400);
});

test('fixture and tool result mutation cannot change future calls', async () => {
  const a = await value(await run(call('read_poc_fixture', { fixture_id: 'note-demo' })));
  a.data.body = 'changed';
  assert.notEqual(
    (await value(await run(call('read_poc_fixture', { fixture_id: 'note-demo' })))).data.body,
    'changed',
  );
  const tools = (await (await run()).json()).result.tools;
  tools[0].name = 'get_secrets';
  assert.equal((await (await run()).json()).result.tools[0].name, 'list_poc_fixtures');
});

test('MCP runtime never imports private vault or performs direct network/persistence', () => {
  for (const file of readdirSync(new URL('.', import.meta.url)).filter(
    (n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs'),
  )) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /VaultSession|vault-server|node:fs|localStorage|indexedDB|env\.DB|process\.env|\bfetch\s*\(|\.listen\s*\(/,
      file,
    );
  }
  const manifest = JSON.parse(
    readFileSync(new URL('../.openai/hosting.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(manifest.capabilities, ['mcp']);
});
