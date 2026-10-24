import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('route wires only the static gate, existing pins and supported identity helper and lazy Shared Notes store', () => {
  const source = read('lib/connector-poc-route.ts');
  assert.match(source, /getChatGPTUser/);
  assert.match(source, /CONNECTOR_POC_ENABLED/);
  assert.match(source, /VAULT_OWNER_SUBJECT/);
  assert.match(source, /VAULT_CANONICAL_ORIGIN/);
  assert.match(source, /sharedEnabled:\s*SHARED_NOTES_ENABLED/);
  assert.match(source, /getSharedStore:\s*\(\)\s*=>\s*new SharedStore\(env\.DB\)/);
  assert.doesNotMatch(
    source,
    /human-route|human-runtime|vault-server|VaultSession|bearer|authorization/i,
  );
  const route = read('app/mcp/route.ts');
  assert.match(route, /force-dynamic/);
  for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
    assert.match(route, new RegExp('\\b' + method + '\\b'));
});
test('worker handles POC namespace before Vinext and rejects aliases before routing', () => {
  const source = read('worker/index.ts');
  assert.ok(source.indexOf('if (pocNamespace') < source.indexOf('handler.fetch'));
  assert.match(source, /rejectPocAlias/);
  assert.match(source, /!CONNECTOR_POC_ENABLED/);
});
test('private crypto core and approved manifest/human gate remain unchanged', () => {
  const bundle = read('vault-assets/app.js.txt');
  assert.equal(
    createHash('sha256')
      .update(bundle.slice(0, bundle.lastIndexOf('// web/app.mjs')))
      .digest('hex'),
    'f1cee24bd61d87a25bdee35d6134885ae34265e4a56565cb45f5a621529195dd',
  );
  assert.deepEqual(JSON.parse(read('.openai/hosting.json')), {
    d1: 'DB',
    r2: null,
    capabilities: ['mcp'],
  });
  assert.match(read('lib/human-activation.mjs'), /HUMAN_VAULT_ENABLED\s*=\s*true/);
});
test('owner landing no longer promotes fictional fixtures as vault content', () => {
  const source = read('app/page.tsx');
  assert.match(source, /redirect\('\/vault'\)/);
  assert.doesNotMatch(source, /Fictional fixture reads verified|Connection proof|POC published/);
});
