import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const execute = promisify(execFile);
export async function fixture(t, files = { 'sum.mjs': 'export const sum = (a, b) => a - b;\n' }) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'forge-test-'));
  t.after(async () => {
    const current = await realpath(directory);
    if (dirname(current) !== parent || !basename(current).startsWith('forge-test-')) throw new Error('Refuse foreign fixture cleanup.');
    await rm(current, { recursive: true, force: false });
  });
  const repo = join(directory, 'repo'), output = join(directory, 'evidence'); await mkdir(repo); await mkdir(output);
  for (const [name, content] of Object.entries(files)) { await mkdir(dirname(join(repo, name)), { recursive: true }); await writeFile(join(repo, name), content); }
  const git = args => execute('git', args, { cwd: repo, windowsHide: true });
  await git(['init', '-b', 'main']); await git(['add', '--all']);
  await git(['-c', 'user.name=Forge Fixture', '-c', 'user.email=forge@example.test', 'commit', '-m', 'Fixture baseline']);
  await git(['switch', '-c', 'feat/fixture']);
  return { directory, repo, output, git };
}
