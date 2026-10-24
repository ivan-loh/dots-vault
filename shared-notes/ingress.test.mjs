import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import('./ingress.mjs').catch(() => ({}));
const origin = 'https://vault.example',
  pins = { VAULT_OWNER_SUBJECT: 'owner', VAULT_CANONICAL_ORIGIN: origin };
const owner = () => ({ userId: 'owner', email: 'owner@example.test' });
function request(
  path = '/shared-notes/api',
  headers = {},
  method = 'POST',
  body = { jsonrpc: '2.0', id: 1, method: 'list', params: {} },
) {
  return new Request(origin + path, {
    method,
    headers: { 'content-type': 'application/json', origin, ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}
const opts = (extra = {}) => ({
  enabled: true,
  pins,
  getIdentity: owner,
  getStore: () => ({ list: async () => [] }),
  ...extra,
});
test('disabled Shared Notes never touches identity body or store', async () => {
  assert.equal(typeof m.handleSharedRequest, 'function');
  const r = await m.handleSharedRequest(request(), {
    enabled: false,
    getIdentity() {
      throw Error('touched');
    },
    getStore() {
      throw Error('touched');
    },
  });
  assert.equal(r.status, 503);
});
test('only canonical owner ingress with exact mutation Origin succeeds', async () => {
  assert.equal(typeof m.handleSharedRequest, 'function');
  assert.equal((await m.handleSharedRequest(request(), opts())).status, 200);
  for (const r of [
    request('/shared-notes/api?x=1'),
    request('/shared-notes/api/'),
    request('/SHARED-NOTES/api'),
    request('/shared-notes/api', { origin: 'null' }),
    request('/shared-notes/api', { origin: 'https://evil.example' }),
    request('/shared-notes/api', { host: 'evil.example' }),
  ])
    assert.notEqual((await m.handleSharedRequest(r, opts())).status, 200);
  const absent = request();
  absent.headers.delete('origin');
  assert.equal((await m.handleSharedRequest(absent, opts())).status, 403);
  for (const who of [null, { userId: 'other', email: 'x' }, { userId: 'owner', email: '' }])
    assert.equal(
      (await m.handleSharedRequest(request(), opts({ getIdentity: () => who }))).status,
      403,
    );
});
test('strict bounded body rejects duplicate keys extra arguments and unknown actions before database', async () => {
  assert.equal(typeof m.handleSharedRequest, 'function');
  let touches = 0;
  const config = opts({
    getStore() {
      touches++;
      throw Error('must not call');
    },
  });
  for (const body of [
    '{"jsonrpc":"2.0","id":1,"method":"list","params":{},"params":{}}',
    { jsonrpc: '2.0', id: 1, method: 'list', params: { owner: 'other' } },
    { jsonrpc: '2.0', id: 1, method: 'decrypt', params: {} },
    { jsonrpc: '2.0', id: 1, method: 'list', params: { _meta: {} } },
    'x'.repeat(65537),
  ])
    assert.notEqual(
      (await m.handleSharedRequest(request('/shared-notes/api', {}, 'POST', body), config)).status,
      200,
    );
  assert.equal(touches, 0);
});
test('safe owner assets have strict no-store external-script-only CSP', async () => {
  assert.equal(typeof m.handleSharedRequest, 'function');
  const r = await m.handleSharedRequest(
    request('/shared-notes', {}, 'GET'),
    opts({ assets: { '/shared-notes': { body: 'safe', type: 'text/html' } } }),
  );
  assert.equal(await r.text(), 'safe');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
});
