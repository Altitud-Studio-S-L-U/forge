import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, fixture } from './helpers.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const rejected = { code: 'INVALID_INPUT', message: 'Task must be a bounded regular file.' };

async function cliError(taskFile) {
  const failure = await execute(process.execPath, [cli, 'review', '--task-file', taskFile], { windowsHide: true })
    .then(() => assert.fail('The CLI accepted an incomplete invocation.'), error => error);
  assert.equal(failure.code, 2);
  return JSON.parse(failure.stderr).error;
}

test('the task file must be a regular file of at most 24000 bytes, never a directory or a link', async t => {
  const { directory } = await fixture(t);
  const bounded = join(directory, 'bounded.txt'); await writeFile(bounded, 'x'.repeat(24000));
  const oversized = join(directory, 'oversized.txt'); await writeFile(oversized, 'x'.repeat(24001));
  const folder = join(directory, 'folder'); await mkdir(folder);
  assert.deepEqual(await cliError(oversized), rejected);
  assert.deepEqual(await cliError(folder), rejected);
  // A bounded task passes this check and the run stops later, at the missing repository.
  assert.notDeepEqual(await cliError(bounded), rejected);
  const link = join(directory, 'link.txt');
  try { await symlink(bounded, link, 'file'); } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.diagnostic('This Windows account cannot create file symlinks (EPERM); the link case runs on POSIX and elevated Windows.');
    return;
  }
  assert.deepEqual(await cliError(link), rejected);
});
