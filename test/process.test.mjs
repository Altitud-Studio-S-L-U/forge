import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess } from '../src/process.mjs';
import { fixture } from './helpers.mjs';

test('real nonzero child exit does not leak its stderr or become successful output', async () => {
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'process.stderr.write("private-provider-token");process.exit(7)'], cwd: process.cwd() }),
    error => error.code === 'PROCESS_FAILED' && !error.message.includes('private-provider-token'));
});
test('real split Unicode survives arbitrary stdout chunk boundaries', async () => {
  const script = 'const bytes=Buffer.from("A😀éZ");process.stdout.write(bytes.subarray(0,3));setTimeout(()=>process.stdout.write(bytes.subarray(3)),80)';
  const result = await runProcess({ executable: process.execPath, args: ['-e', script], cwd: process.cwd() });
  assert.equal(result.stdout, 'A😀éZ');
});
test('stdout and discarded stderr share one bounded output budget', async () => {
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(40));process.stderr.write("y".repeat(40));setInterval(()=>{},1000)'],
    cwd: process.cwd(), maximumOutputBytes: 64 }), { code: 'OUTPUT_LIMIT' });
});
test('deadline terminates an owned parent and its spawned descendant', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t), pidFile = join(directory, 'pid.json');
  const childScript = 'setInterval(()=>{},1000)';
  const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'inherit',windowsHide:true});fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000)`;
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', script], cwd: directory, timeoutMs: 700 }), { code: 'TIMEOUT' });
  const ids = JSON.parse(await readFile(pidFile, 'utf8'));
  await delay(80);
  for (const pid of Object.values(ids)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('cancellation terminates a running child and pre-cancelled calls never start', async () => {
  const controller = new AbortController();
  const running = runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(running, { code: 'CANCELLED' });
  await assert.rejects(runProcess({ executable: 'missing-program', cwd: process.cwd(), signal: controller.signal }), { code: 'CANCELLED' });
});
