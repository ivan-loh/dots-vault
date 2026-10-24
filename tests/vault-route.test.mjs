import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { disabledVaultRoute } from '../lib/vault-route.mjs';
import { applyReadinessHeaders } from '../lib/vault-readiness.mjs';
test('isolated vault response profile remains disabled for all methods and asset paths', async () => {
  for (const path of ['/vault', '/vault/', '/vault/app.js', '/vault/styles.css', '/vault/unknown'])
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await disabledVaultRoute(new Request('https://fixture.example' + path, { method }));
      assert.equal(r.status, 503);
      assert.match(
        r.headers.get('content-security-policy'),
        /script-src 'self' 'wasm-unsafe-eval'/,
      );
      assert.doesNotMatch(r.headers.get('content-security-policy'), /'unsafe-inline'/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      if (method === 'HEAD') assert.equal(await r.text(), '');
      else assert.equal((await r.json()).code, 'DEPLOYMENT_DISABLED');
    }
  assert.match(
    applyReadinessHeaders(new Response('ready')).headers.get('content-security-policy'),
    /script-src 'none'/,
  );
});
test('production human source gate is enabled and owner identity is only obtained in actual route context', async () => {
  const worker = await readFile('worker/index.ts', 'utf8');
  assert.doesNotMatch(worker, /getChatGPTUser|env\.DB/);
  const activation = await readFile('lib/human-activation.mjs', 'utf8');
  assert.match(activation, /HUMAN_VAULT_ENABLED = true/);
  const route = await readFile('lib/human-route.ts', 'utf8');
  assert.match(route, /getIdentity: getChatGPTUser/);
  assert.match(route, /getDatabase: \(\) => env\.DB/);
  assert.doesNotMatch(route, /getDb\(/);
});
