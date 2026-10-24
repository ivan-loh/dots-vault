import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  readinessResponse,
  disabledDataResponse,
  applyReadinessHeaders,
} from '../lib/vault-readiness.mjs';
test('anonymous and service-only diagnostics do not assert identity', async () => {
  for (const user of [null, {}, { userId: 'synthetic-subject' }])
    assert.equal(readinessResponse('GET', user).status, 401);
});
test('authenticated diagnostics are read-only and never owner proof', async () => {
  const r = readinessResponse('GET', {
    userId: 'synthetic-subject',
    email: 'synthetic@example.invalid',
  });
  const data = await r.json();
  assert.equal(data.dataEnabled, false);
  assert.equal(data.ownerPinned, false);
  assert.equal(data.dotAccessEnabled, false);
  assert.equal(data.identity.subject, 'synthetic-subject');
  assert.equal('email' in data.identity, false);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(readinessResponse(method, { userId: 'x', email: 'y' }).status, 405);
});
test('disabledDataResponse stays disabled regardless of an environment toggle', async () => {
  process.env.VAULT_ENABLED = 'true';
  const response = disabledDataResponse();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).dataEnabled, false);
  delete process.env.VAULT_ENABLED;
});
test('HTML and identity responses disallow scripts, framing, network and caching', () => {
  const r = applyReadinessHeaders(new Response('ok'));
  assert.match(r.headers.get('Content-Security-Policy'), /script-src 'none'/);
  assert.match(r.headers.get('Content-Security-Policy'), /connect-src 'none'/);
  assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(r.headers.get('Cache-Control'), /no-store/);
  assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer');
});
test('readiness UI contains no secret fields and manifest requests existing DB and canonical MCP only', async () => {
  for (const file of ['app/page.tsx', 'app/identity/page.tsx']) {
    const s = await readFile(file, 'utf8');
    assert.doesNotMatch(
      s,
      /<input|<form|localStorage|sessionStorage|dangerouslySetInnerHTML|VaultSession|from.*crypto/,
    );
  }
  const m = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
  assert.equal(m.d1, 'DB');
  assert.equal(m.r2, null);
  assert.deepEqual(m.capabilities, ['mcp']);
  assert.equal(m.plugins, undefined);
  assert.equal(m.connectors, undefined);
});

test('identity and metadata distinguish private-vault access from Shared Notes tools', async () => {
  const identity = await readFile('app/identity/page.tsx', 'utf8');
  const layout = await readFile('app/layout.tsx', 'utf8');
  assert.doesNotMatch(identity, /Dot access:/);
  assert.match(identity, /Private vault agent access:/);
  assert.match(identity, /Shared Notes/);
  assert.doesNotMatch(layout, /No delegated dot access/);
  assert.match(layout, /Shared Notes/);
});
