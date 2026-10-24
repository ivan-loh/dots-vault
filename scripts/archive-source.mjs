import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Git command failed.');
  return result.stdout.trim();
}

// Only committed files are archived. Git history and local/ignored data stay out.
if (git(['status', '--porcelain', '--untracked-files=no'])) {
  throw new Error('Commit or discard tracked changes before archiving the reviewed source.');
}
const revision = git(['rev-parse', '--short=12', 'HEAD']);
const output = resolve('artifacts', `dots-vault-${revision}.tar.gz`);
mkdirSync(resolve('artifacts'), { recursive: true });
git(['archive', '--format=tar.gz', '--prefix=dots-vault/', `--output=${output}`, 'HEAD']);
console.log(`Created ${output}`);
