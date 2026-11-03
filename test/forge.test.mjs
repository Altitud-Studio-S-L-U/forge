import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runForge } from '../src/forge.mjs';
import { fileSnapshot, captureFiles, applyChanges, permittedPath } from '../src/files.mjs';
import { ForgeError } from '../src/errors.mjs';
import { runProcess } from '../src/process.mjs';
import { fixture } from './helpers.mjs';

const task = 'Correct sum so it adds two numbers; preserve the existing test.';
const pass = { verdict: 'pass', summary: 'The selected arithmetic change is correct.', findings: [] };
function options(f) { return { mode: 'implement', repo: f.repo, output: f.output, task, files: ['sum.mjs'], verify: [process.execPath, '--test', 'sum.test.mjs'] }; }
async function workingFixture(t) { return fixture(t, { 'sum.mjs': 'export const sum = (a, b) => a - b;\n',
  'sum.test.mjs': 'import {test} from "node:test";import assert from "node:assert/strict";import {sum} from "./sum.mjs";test("sum",()=>assert.equal(sum(2,3),5));\n' }); }
const implement = files => ({ status: 'completed', summary: 'Corrected the arithmetic operation.', changes: [{ path: 'sum.mjs', beforeSha256: files[0].sha256, content: 'export const sum = (a, b) => a + b;\n' }] });

test('real fixture Git and test command gate a staged change without committing', async t => {
  const f = await workingFixture(t), head = (await f.git(['rev-parse', 'HEAD'])).stdout;
  const report = await runForge(options(f), { callProvider: async call => call.kind === 'implement' ? implement(await captureFiles(f.repo, ['sum.mjs'])) : pass });
  assert.equal(report.status, 'ready-for-human-review'); assert.equal(report.checks[0].status, 'passed');
  assert.equal((await f.git(['rev-parse', 'HEAD'])).stdout, head); assert.match((await f.git(['status', '--porcelain'])).stdout, /sum\.mjs/u);
  assert.equal(report.changedFiles.length, 1);
  const persisted = JSON.parse(await readFile(join(report.directory, 'result.json'), 'utf8'));
  assert.equal(persisted.phases[0].result.changes[0].content, undefined);
});
test('review failure cannot become approval and repairs are limited to one', async t => {
  const f = await workingFixture(t); let implementations = 0, reviews = 0;
  const report = await runForge(options(f), { callProvider: async call => {
    if (call.kind === 'implement') { implementations++; return implement(await captureFiles(f.repo, ['sum.mjs'])); }
    reviews++; return { verdict: 'changes-required', summary: 'Missing requested behavior.', findings: [{ severity: 'blocking', file: 'sum.mjs', message: 'A requirement is not addressed.' }] };
  } });
  assert.equal(report.status, 'findings'); assert.equal(implementations, 2); assert.equal(reviews, 2);
});
test('reviewer process failure blocks the result even after real tests pass', async t => {
  const f = await workingFixture(t);
  const report = await runForge(options(f), { callProvider: async call => {
    if (call.kind === 'implement') return implement(await captureFiles(f.repo, ['sum.mjs']));
    throw new ForgeError('PROCESS_FAILED', 'Child process exited without a successful result.');
  } });
  assert.equal(report.status, 'blocked'); assert.equal(report.checks[0].status, 'passed'); assert.equal(report.error.code, 'PROCESS_FAILED');
  assert.equal(report.changedFiles[0].path, 'sum.mjs', 'Applied code stays visible even when its reviewer fails.');
});

test('a blocked review after repair remains blocked rather than ordinary findings', async t => {
  const f = await workingFixture(t); let reviews = 0;
  const report = await runForge(options(f), { callProvider: async call => {
    if (call.kind === 'implement') return implement(await captureFiles(f.repo, ['sum.mjs']));
    reviews++;
    return { verdict: reviews === 1 ? 'changes-required' : 'blocked', summary: 'Review cannot complete.', findings: [] };
  } });
  assert.equal(reviews, 2);
  assert.equal(report.status, 'blocked');
  assert.equal(report.error.code, 'REVIEW_BLOCKED');
});
test('absence of independent verification is explicitly incomplete', async t => {
  const f = await workingFixture(t);
  const report = await runForge({ ...options(f), verify: undefined }, { callProvider: async call => call.kind === 'implement' ? implement(await captureFiles(f.repo, ['sum.mjs'])) : pass });
  assert.equal(report.status, 'needs-verification'); assert.deepEqual(report.checks, []);
});
test('dirty checkout and main branch fail before calling either provider', async t => {
  const f = await workingFixture(t); let calls = 0;
  const deps = { callProvider: async () => { calls++; return pass; } };
  await writeFile(join(f.repo, 'untracked.txt'), 'current work');
  await assert.rejects(runForge(options(f), deps), { code: 'INVALID_INPUT' });
  await f.git(['clean', '-f', '--', 'untracked.txt']); await f.git(['switch', 'main']);
  await assert.rejects(runForge(options(f), deps), { code: 'INVALID_INPUT' }); assert.equal(calls, 0);
});
test('paths, credential-like content, links, byte limits and stale hashes fail before writes', async t => {
  const f = await workingFixture(t);
  for (const name of ['../a', 'a/../b', '/absolute', '.git/config', '.env.local', 'key.pem', 'a\\b', 'con.txt', 'trailing.']) assert.throws(() => permittedPath(name), { code: 'INVALID_INPUT' });
  const files = await captureFiles(f.repo, ['sum.mjs']);
  await writeFile(join(f.repo, 'sum.mjs'), 'changed concurrently');
  await assert.rejects(applyChanges(f.repo, files, implement(files).changes), { code: 'INVALID_INPUT' });
  assert.equal(await readFile(join(f.repo, 'sum.mjs'), 'utf8'), 'changed concurrently');
  await writeFile(join(f.repo, 'large.txt'), 'x'.repeat(65537));
  await assert.rejects(fileSnapshot(f.repo, 'large.txt'), { code: 'INVALID_INPUT' });
  await symlink(f.output, join(f.repo, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(fileSnapshot(f.repo, 'outside/new.txt'), { code: 'INVALID_INPUT' });
  await writeFile(join(f.repo, 'example.txt'), `sk_live_${'x'.repeat(30)}`);
  await assert.rejects(fileSnapshot(f.repo, 'example.txt'), { code: 'CREDENTIAL_CONTENT' });
});
test('replacement retains executable permissions on POSIX', async t => {
  const f = await workingFixture(t);
  await chmod(join(f.repo, 'sum.mjs'), 0o755);
  const files = await captureFiles(f.repo, ['sum.mjs']); await applyChanges(f.repo, files, implement(files).changes);
  if (process.platform !== 'win32') assert.equal((await stat(join(f.repo, 'sum.mjs'))).mode & 0o777, 0o755);
  assert.match(await readFile(join(f.repo, 'sum.mjs'), 'utf8'), /a \+ b/u);
});
test('research uses both providers concurrently and cannot claim success if either fails', async t => {
  const f = await workingFixture(t); let active = 0, peak = 0;
  const report = await runForge({ ...options(f), mode: 'research', verify: undefined }, { callProvider: async call => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 40)); active--;
    if (call.provider === 'claude') throw new ForgeError('PERMISSION_DENIED', 'Denied.');
    return { status: 'completed', summary: 'Inspected arithmetic.', observations: ['Existing tests cover positive addition.'], questions: [] };
  } });
  assert.equal(peak, 2); assert.equal(report.status, 'blocked'); assert.equal(report.error.code, 'PERMISSION_DENIED');
});
test('a model cannot replace a test or another file outside the explicit allowlist', async t => {
  const f = await workingFixture(t), before = await readFile(join(f.repo, 'sum.test.mjs'), 'utf8');
  const report = await runForge(options(f), { callProvider: async () => ({ status: 'completed', summary: 'Attempted test replacement.',
    changes: [{ path: 'sum.test.mjs', beforeSha256: null, content: '' }] }) });
  assert.equal(report.status, 'blocked'); assert.equal(report.error.code, 'INVALID_INPUT');
  assert.equal(await readFile(join(f.repo, 'sum.test.mjs'), 'utf8'), before);
  assert.deepEqual(report.changedFiles, []);
});
test('HEAD changes during verification cannot be approved by a passing reviewer', async t => {
  const f = await workingFixture(t);
  const report = await runForge(options(f), {
    callProvider: async call => call.kind === 'implement' ? implement(await captureFiles(f.repo, ['sum.mjs'])) : pass,
    runProcess: async call => {
      const actual = await runProcess(call);
      await f.git(['add', '--all']); await f.git(['-c', 'user.name=Fixture', '-c', 'user.email=forge@example.test', 'commit', '-m', 'Concurrent fixture commit']);
      return actual;
    },
  });
  assert.equal(report.status, 'blocked'); assert.equal(report.error.code, 'INVALID_INPUT');
});
test('a concurrent edit during the final review fails closed and reports the changed file', async t => {
  const f = await workingFixture(t);
  const report = await runForge(options(f), { callProvider: async call => {
    if (call.kind === 'implement') return implement(await captureFiles(f.repo, ['sum.mjs']));
    await writeFile(join(f.repo, 'sum.mjs'), 'export const sum = () => 100;\n'); return pass;
  } });
  assert.equal(report.status, 'blocked'); assert.equal(report.error.code, 'INVALID_INPUT'); assert.equal(report.changedFiles.length, 1);
});

test('an unselected test changed during implementation blocks replacement', async t => {
  const f = await workingFixture(t), source = await readFile(join(f.repo, 'sum.mjs'), 'utf8');
  const report = await runForge(options(f), { callProvider: async call => {
    if (call.kind === 'implement') {
      await writeFile(join(f.repo, 'sum.test.mjs'), 'import "node:test";\n');
      return implement(await captureFiles(f.repo, ['sum.mjs']));
    }
    return pass;
  } });
  assert.equal(report.status, 'blocked');
  assert.equal(report.error.code, 'CHECKOUT_CHANGED');
  assert.equal(await readFile(join(f.repo, 'sum.mjs'), 'utf8'), source);
  assert.deepEqual(report.checks, []);
});

test('verification cannot change an unselected test and still produce a passing result', async t => {
  const f = await workingFixture(t); let reviews = 0;
  const report = await runForge(options(f), {
    callProvider: async call => {
      if (call.kind === 'implement') return implement(await captureFiles(f.repo, ['sum.mjs']));
      reviews++; return pass;
    },
    runProcess: async call => {
      const actual = await runProcess(call);
      await writeFile(join(f.repo, 'sum.test.mjs'), 'import "node:test";\n');
      return actual;
    },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.error.code, 'CHECKOUT_CHANGED');
  assert.equal(reviews, 0);
});

test('staging selected code or adding an unselected file during review blocks acceptance', async t => {
  for (const change of ['stage', 'new-file']) {
    const f = await workingFixture(t);
    const report = await runForge(options(f), { callProvider: async call => {
      if (call.kind === 'implement') return implement(await captureFiles(f.repo, ['sum.mjs']));
      if (change === 'stage') await f.git(['add', '--', 'sum.mjs']);
      else await writeFile(join(f.repo, 'another file.txt'), 'Concurrent work.\n');
      return pass;
    } });
    assert.equal(report.status, 'blocked');
    assert.equal(report.error.code, 'CHECKOUT_CHANGED');
  }
});
test('evidence cannot be written inside the target or another repository', async t => {
  const f = await workingFixture(t);
  await assert.rejects(runForge({ ...options(f), output: f.repo }), { code: 'INVALID_INPUT' });
  const other = await workingFixture(t);
  await assert.rejects(runForge({ ...options(f), output: other.repo }), { code: 'INVALID_INPUT' });
});
test('captured source preserves a UTF-8 BOM and rejects invalid UTF-8', async t => {
  const f = await workingFixture(t); await writeFile(join(f.repo, 'bom.txt'), '\uFEFFhello');
  assert.equal((await fileSnapshot(f.repo, 'bom.txt')).content, '\uFEFFhello');
  await writeFile(join(f.repo, 'bad.txt'), Buffer.from([0xc3, 0x28]));
  await assert.rejects(fileSnapshot(f.repo, 'bad.txt'), { code: 'INVALID_INPUT' });
});
