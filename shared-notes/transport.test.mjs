import test from 'node:test';
import assert from 'node:assert/strict';
const { createApi } = await import('./transport.mjs').catch(() => ({}));
test('timeout aborts a hung fetch without claiming noncommit', async () => {
  assert.equal(typeof createApi, 'function');
  let signal;
  const api = createApi(async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }, 15);
  await assert.rejects(api.publish({}), /REQUEST_TIMEOUT/);
  assert.equal(signal.aborted, true);
});
test('deadline covers hung response body and cancels its reader', async () => {
  assert.equal(typeof createApi, 'function');
  let cancelled = false;
  const body = new ReadableStream({
    pull() {},
    cancel() {
      cancelled = true;
    },
  });
  const api = createApi(async () => new Response(body), 15);
  await assert.rejects(api.list({}), /REQUEST_TIMEOUT/);
  assert.equal(cancelled, true);
});
test('same-origin no-store nonredirecting requests preserve exact payload and bound responses', async () => {
  assert.equal(typeof createApi, 'function');
  let seen;
  const api = createApi(async (url, options) => {
    seen = { url, options };
    return Response.json({ result: { notes: [] } });
  });
  assert.deepEqual(await api.list({}), { notes: [] });
  assert.equal(seen.url, '/shared-notes/api');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.credentials, 'same-origin');
  assert.equal(seen.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(seen.options.body), {
    jsonrpc: '2.0',
    id: 1,
    method: 'list',
    params: {},
  });
  await assert.rejects(
    createApi(async () => new Response('x'.repeat(65537))).read({}),
    /INVALID_RESPONSE/,
  );
});
