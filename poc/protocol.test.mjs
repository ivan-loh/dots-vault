import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePocRequest } from './runtime.mjs';
import { parseRequest } from './rpc.mjs';

// Wire shape from the official 2026-07-28 discovery and HTTP transport specs.
// Local invented identity only; this is not a hosted authentication test.
const origin = 'https://protocol.example.test';
const owner = 'invented-owner';
const metadata = () => ({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'ExampleClient', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
});
const rpc = (method = 'server/discover', params = {}) => ({
  jsonrpc: '2.0',
  id: 'discover-1',
  method,
  params: { _meta: metadata(), ...params },
});
const context = (extra) => ({
  enabled: true,
  pins: { VAULT_OWNER_SUBJECT: owner, VAULT_CANONICAL_ORIGIN: origin },
  getIdentity: async () => ({ userId: owner, email: 'owner@example.invalid' }),
  ...extra,
});
async function run(body = rpc(), { headers = {}, ...extra } = {}, options = {}) {
  const h = new Headers({
    host: 'protocol.example.test',
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version':
      body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? '2026-07-28',
    'mcp-method': body.method,
    ...(body.method === 'tools/call' ? { 'mcp-name': body.params.name } : {}),
  });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) h.delete(key);
    else h.set(key, value);
  }
  return handlePocRequest(
    new Request(origin + '/mcp', {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
      ...extra,
    }),
    context(options),
  );
}

test('official modern discovery request succeeds with complete private caching response', async () => {
  const response = await run();
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.equal(result.resultType, 'complete');
  assert.deepEqual(result.supportedVersions, ['2026-07-28']);
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.equal(result.ttlMs, 0);
  assert.equal(result.cacheScope, 'private');
});

test('standard metadata works on catalog and all three fixed reads, never authorizes', async () => {
  const list = await run(rpc('tools/list'));
  assert.equal(list.status, 200);
  const catalog = (await list.json()).result;
  assert.equal(catalog.resultType, 'complete');
  assert.equal(catalog.ttlMs, 0);
  assert.equal(catalog.cacheScope, 'private');
  assert.deepEqual(
    catalog.tools.map((t) => t.name),
    ['list_poc_fixtures', 'read_poc_fixture'],
  );
  for (const fixture_id of ['note-demo', 'contact-demo', 'credential-demo']) {
    const request = rpc('tools/call', { name: 'read_poc_fixture', arguments: { fixture_id } });
    request.params._meta['com.example/owner'] = owner;
    request.params._meta['com.example/dot'] = 'claimed-dot';
    const response = await run(request);
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.resultType, 'complete');
    assert.equal(JSON.parse(result.content[0].text).fixture_id, fixture_id);
    const denied = await run(request, {}, { getIdentity: async () => null });
    assert.equal(denied.status, 403);
  }
});

test('metadata requirements are validated and unsupported versions are recognized modern errors', async () => {
  for (const meta of [
    undefined,
    null,
    [],
    {},
    { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': [],
    },
  ]) {
    const response = await run(rpc('server/discover', { _meta: meta }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32602);
  }
  const request = rpc();
  request.params._meta['io.modelcontextprotocol/protocolVersion'] = '2025-11-25';
  const response = await run(request);
  assert.equal(response.status, 400);
  const error = (await response.json()).error;
  assert.equal(error.code, -32022);
  assert.deepEqual(error.data.supported, ['2026-07-28']);
  assert.equal(error.data.requested, '2025-11-25');
});

test('required mirrored headers reject absence or mismatch without reflecting input', async () => {
  const request = rpc('tools/call', {
    name: 'read_poc_fixture',
    arguments: { fixture_id: 'note-demo' },
  });
  for (const headers of [
    { 'mcp-protocol-version': null },
    { 'mcp-protocol-version': '2025-11-25' },
    { 'mcp-method': null },
    { 'mcp-method': 'tools/list' },
    { 'mcp-name': null },
    { 'mcp-name': 'DO_NOT_REFLECT' },
    { 'mcp-name': '=?base64?!!!?=' },
  ]) {
    const response = await run(request, { headers });
    assert.equal(response.status, 400);
    const error = (await response.json()).error;
    assert.equal(error.code, -32020);
    assert.doesNotMatch(JSON.stringify(error), /DO_NOT_REFLECT|!!!/);
  }
  const encoded = '=?base64?' + Buffer.from('read_poc_fixture').toString('base64') + '?=';
  assert.equal((await run(request, { headers: { 'mcp-name': encoded } })).status, 200);
  const bom = '=?base64?' + Buffer.from('\uFEFFread_poc_fixture').toString('base64') + '?=';
  const mismatch = await run(request, { headers: { 'mcp-name': bom } });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, -32020);
});

test('transport metadata is outside exact tool arguments and cannot expand the catalog', async () => {
  assert.equal((await run(rpc('tools/call', { name: 'list_poc_fixtures' }))).status, 200);
  for (const arguments_ of [
    { fixture_id: 'note-demo', _meta: metadata() },
    { fixture_id: 'note-demo', owner },
  ]) {
    const response = await run(
      rpc('tools/call', { name: 'read_poc_fixture', arguments: arguments_ }),
    );
    assert.equal(
      JSON.parse((await response.json()).result.content[0].text).error,
      'INVALID_ARGUMENTS',
    );
  }
  const response = await run(rpc('unimplemented/method'));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, -32601);
  assert.equal((await run(rpc('tools/list', { cursor: 'unissued-cursor' }))).status, 400);
});

test('auth diagnostics are fixed enums, preserve denial and never include input values', async () => {
  const observed = [];
  const diagnostic = (value) => observed.push(value);
  for (const [headers, identity, expected] of [
    [{ host: '' }, { userId: owner, email: 'owner@example.invalid' }, 'host'],
    [{ host: 'private-value.invalid' }, { userId: owner, email: 'owner@example.invalid' }, 'host'],
    [
      { origin: 'https://private-value.invalid' },
      { userId: owner, email: 'owner@example.invalid' },
      'origin',
    ],
    [{}, null, 'identity_missing'],
    [{}, { userId: 'private-value', email: 'owner@example.invalid' }, 'owner_mismatch'],
    [{}, { userId: owner, email: '' }, 'email_missing'],
  ]) {
    const response = await run(
      rpc(),
      { headers },
      { diagnostic, getIdentity: async () => identity },
    );
    assert.equal(response.status, 403);
    assert.equal(observed.at(-1), expected);
    assert.deepEqual(await response.json(), { code: 'NOT_AUTHORIZED' });
  }
  assert.doesNotMatch(JSON.stringify(observed), /private-value|example\.invalid|invented-owner/);
  assert.equal(
    (
      await run(
        rpc(),
        {},
        {
          diagnostic() {
            throw Error('ignored');
          },
          getIdentity: async () => null,
        },
      )
    ).status,
    403,
  );
});

test('signed safe IDs and bounded opaque metadata numbers follow the modern JSON envelope', async () => {
  const request = rpc();
  request.id = -1;
  request.params._meta['com.example/numbers'] = {
    negative: -1,
    fraction: 0.5,
    nested: [0.25, -2.75, 1e-5],
  };
  const response = await run(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, -1);
  for (const id of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    const value = rpc();
    value.id = id;
    assert.equal((await run(value)).status, 200);
  }
  for (const id of [-Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1, 0.5]) {
    const value = rpc();
    value.id = id;
    assert.equal((await run(value)).status, 400);
  }
  const tooLarge = rpc();
  tooLarge.params._meta['com.example/numbers'] = { value: Number.MAX_SAFE_INTEGER + 1 };
  assert.equal((await run(tooLarge)).status, 400);
  const scalar = rpc();
  scalar.params._meta = -0.5;
  assert.equal((await run(scalar)).status, 400);
  const argument = rpc('tools/call', {
    name: 'read_poc_fixture',
    arguments: { fixture_id: 'note-demo', _meta: { number: 0.5 } },
  });
  assert.equal((await run(argument)).status, 400);
  const raw = JSON.stringify(
    rpc('server/discover', { _meta: { ...metadata(), 'com.example/value': 0 } }),
  );
  for (const number of ['1e309', '-1e309', '9007199254740992']) {
    assert.throws(() =>
      parseRequest(raw.replace('"com.example/value":0', '"com.example/value":' + number)),
    );
  }
  for (const number of ['1.0000000000000001', '9007199254740990.9', '1e0', '-0']) {
    assert.throws(() => parseRequest(raw.replace('"id":"discover-1"', '"id":' + number)));
  }
  const escaped = raw
    .replace('"params"', '"pa\\u0072ams"')
    .replace('"_meta"', '"_me\\u0074a"')
    .replace('"com.example/value":0', '"com.example/value":-0.5');
  assert.equal(parseRequest(escaped).params._meta['com.example/value'], -0.5);
  assert.throws(() =>
    parseRequest(
      raw.replace('"com.example/value":0', '"com.example/value":0,"com.example/val\\u0075e":1'),
    ),
  );
  assert.throws(() =>
    parseRequest(
      JSON.stringify(argument).replace('"_meta":{"number":0.5}', '"_me\\u0074a":{"number":0.5}'),
    ),
  );
});
