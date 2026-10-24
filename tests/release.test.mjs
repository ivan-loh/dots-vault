import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('release hosting metadata is project-neutral and requests only DB and MCP', () => {
  assert.deepEqual(JSON.parse(read('.openai/hosting.json')), {
    d1: 'DB',
    r2: null,
    capabilities: ['mcp'],
  });
  assert.equal(existsSync(new URL('../.openai/source-provenance.json', import.meta.url)), false);
});

test('release names the package and exposes repeatable verification and packaging commands', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'dots-vault');
  for (const command of [
    'test',
    'test:compiled',
    'typecheck',
    'check',
    'archive',
    'preview:synthetic',
  ]) {
    assert.equal(typeof pkg.scripts[command], 'string', command);
  }
});

test('the retained browser cryptography prefix stays byte-identical', () => {
  const bundle = read('vault-assets/app.js.txt');
  const boundary = bundle.lastIndexOf('// web/app.mjs');
  assert.ok(boundary > 0);
  assert.equal(
    createHash('sha256').update(bundle.slice(0, boundary)).digest('hex'),
    'f1cee24bd61d87a25bdee35d6134885ae34265e4a56565cb45f5a621529195dd',
  );
});
