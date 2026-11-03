import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const { values } = parseArgs({ options: { prepare: { type: 'boolean' }, live: { type: 'boolean' } } });
if (Boolean(values.prepare) === Boolean(values.live)) {
  console.error('Usage: node examples/quickstart/run.mjs --prepare | --live');
  console.error('--prepare checks only the failing fixture. --live also uses your authenticated Codex and Claude Code accounts.');
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'forge-quickstart-'));
  const repo = join(directory, 'repo');
  const evidence = join(directory, 'evidence');
  await mkdir(repo);
  await mkdir(evidence);
  for (const name of ['sum.mjs', 'sum.test.mjs']) {
    await copyFile(new URL(name, import.meta.url), join(repo, name));
  }
  await copyFile(new URL('task.txt', import.meta.url), join(directory, 'task.txt'));
  await writeFile(join(repo, '.gitattributes'), '* text eol=lf\n');
  const git = args => execute('git', ['-c', 'core.hooksPath=', ...args], { cwd: repo, windowsHide: true });
  await git(['init', '-b', 'main']);
  await git(['add', '--all']);
  await git(['-c', 'user.name=Forge Example', '-c', 'user.email=forge@example.test', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Synthetic failing example']);
  await git(['switch', '-c', 'fix/addition']);
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const originalTest = await readFile(join(repo, 'sum.test.mjs'));
  const baseline = await execute(process.execPath, ['--test', 'sum.test.mjs'], { cwd: repo, windowsHide: true })
    .then(() => ({ code: 0 }), error => { if (typeof error.code !== 'number') throw error; return error; });
  assert.equal(baseline.code, 1, 'The synthetic baseline must fail before asking a provider to change it.');
  console.log(`Workspace: ${directory}\nBaseline: failed as expected (2 - 3 is not 5).`);
  if (values.prepare) {
    console.log('Preparation complete; no provider was called. Use --live to run a fresh example with both CLIs.');
    return;
  }

  console.log('Running Codex implementation, Node tests and independent Claude Code review...');
  const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
  const invocation = await execute(process.execPath, [cli, 'implement',
    '--repo', repo, '--task-file', join(directory, 'task.txt'), '--file', 'sum.mjs',
    '--coder', 'codex', '--reviewer', 'claude', '--output', evidence,
    '--verify-json', JSON.stringify([process.execPath, '--test', 'sum.test.mjs']),
    '--timeout-ms', '120000', '--deadline-ms', '300000'],
  { windowsHide: true, timeout: 360000, maxBuffer: 1024 * 1024 })
    .then(result => ({ ...result, code: 0 }), error => { if (typeof error.code !== 'number') throw error; return error; });
  const output = invocation.stdout.trim();
  if (!output) {
    console.error(invocation.stderr.trim() || 'Forge exited without a result.');
    process.exitCode = 2;
    return;
  }
  const result = JSON.parse(output);
  console.log(JSON.stringify(result, null, 2));
  assert.equal((await git(['rev-parse', 'HEAD'])).stdout.trim(), head, 'Forge must not commit.');
  assert.deepEqual(await readFile(join(repo, 'sum.test.mjs')), originalTest, 'The independent test must remain unchanged.');
  assert.equal((await git(['diff', '--cached', '--name-only'])).stdout.trim(), '', 'No change may be staged.');
  console.log((await git(['diff', '--', 'sum.mjs'])).stdout);
  if (invocation.code !== 0 || result.status !== 'ready-for-human-review') {
    console.error('The live run did not pass. Inspect the result above; there is no automatic retry.');
    process.exitCode = 1;
    return;
  }
  assert.equal((await git(['diff', '--name-only'])).stdout.trim(), 'sum.mjs');
  await execute(process.execPath, ['--test', 'sum.test.mjs'], { cwd: repo, windowsHide: true });
  console.log('Verified: tests pass, test file unchanged, only sum.mjs changed, nothing staged or committed.');
}
