import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/archive-source.mjs', import.meta.url));
const run = (cwd, command, args) => spawnSync(command, args, { cwd, encoding: 'utf8' });

test('source archives include committed files only and are repeatable', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vault-archive-test-'));
  try {
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.name', 'Synthetic Test'],
      ['config', 'user.email', 'test@example.invalid'],
    ]) {
      assert.equal(run(cwd, 'git', args).status, 0);
    }
    writeFileSync(join(cwd, 'README.md'), 'Synthetic source only.\n');
    writeFileSync(join(cwd, '.gitignore'), 'ignored.txt\nartifacts/\n');
    assert.equal(run(cwd, 'git', ['add', '.']).status, 0);
    assert.equal(run(cwd, 'git', ['commit', '-m', 'Synthetic source']).status, 0);
    writeFileSync(join(cwd, 'ignored.txt'), 'Not source.');
    writeFileSync(join(cwd, 'untracked.txt'), 'Not source.');
    const first = run(cwd, process.execPath, [script]);
    assert.equal(first.status, 0, first.stderr);
    const path = first.stdout.trim().replace(/^Created /, '');
    const bytes = readFileSync(path);
    assert.equal(run(cwd, process.execPath, [script]).status, 0);
    assert.deepEqual(readFileSync(path), bytes);
    const tar = gunzipSync(bytes);
    const paths = [];
    for (let offset = 0; offset + 512 <= tar.length; ) {
      const header = tar.subarray(offset, offset + 512);
      const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
      if (!name) break;
      const size =
        Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim(), 8) ||
        0;
      paths.push(name);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.ok(paths.includes('dots-vault/README.md'));
    assert.ok(paths.every((name) => !/ignored.txt|untracked.txt|\.git\//.test(name)));
    writeFileSync(join(cwd, 'README.md'), 'Uncommitted edit.\n');
    const dirty = run(cwd, process.execPath, [script]);
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /Commit or discard tracked changes/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
