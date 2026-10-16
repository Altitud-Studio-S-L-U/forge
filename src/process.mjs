import { spawn } from 'node:child_process';
import { ForgeError } from './errors.mjs';

export function childEnvironment(environment = process.env) {
  const names = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE',
    'HOME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'LANG', 'LC_ALL', 'SHELL', 'CODEX_HOME',
    'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH']);
  return Object.fromEntries(Object.entries(environment).filter(([key]) => names.has(key.toUpperCase())));
}

async function terminateTree(child) {
  if (!Number.isInteger(child.pid) || child.pid < 1) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn(`${process.env.SystemRoot || 'C:\\Windows'}/System32/taskkill.exe`, ['/PID', String(child.pid), '/T', '/F'],
        { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve); killer.once('close', resolve);
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export function runProcess({ executable, args = [], cwd, input = '', signal, timeoutMs = 120_000, maximumOutputBytes = 1024 * 1024, env }) {
  if (signal?.aborted) return Promise.reject(new ForgeError('CANCELLED', 'Operation was cancelled.'));
  return new Promise((resolve, reject) => {
    let child, failure, timer, closed = false, bytes = 0, killing;
    const output = [];
    const fail = code => {
      failure ??= new ForgeError(code, { TIMEOUT: 'Child process exceeded its deadline.', CANCELLED: 'Operation was cancelled.',
        OUTPUT_LIMIT: 'Child process exceeded its output budget.' }[code] ?? 'Child process could not complete.');
      if (child && !killing) killing = terminateTree(child).catch(() => {
        failure = new ForgeError('TERMINATION_FAILED', 'Could not confirm termination of the owned process tree.');
        child.kill();
      });
    };
    const abort = () => fail('CANCELLED');
    try { child = spawn(executable, args, { cwd, env: env ?? childEnvironment(), shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new ForgeError('PROCESS_START_FAILED', 'The configured executable could not start.')); return; }
    timer = setTimeout(() => fail('TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (chunk, retain) => {
      bytes += chunk.length;
      if (bytes > maximumOutputBytes) { fail('OUTPUT_LIMIT'); return; }
      if (retain) output.push(chunk);
    };
    // Raw stderr may contain provider responses or credentials; count it but never retain or print it.
    child.stdout.on('data', chunk => capture(chunk, true));
    child.stderr.on('data', chunk => capture(chunk, false));
    child.stdin.on('error', () => {});
    child.once('error', () => { failure ??= new ForgeError('PROCESS_START_FAILED', 'The configured executable could not start.'); });
    child.once('close', async (code, exitSignal) => {
      if (closed) return; closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (killing) await killing;
      if (failure) { reject(failure); return; }
      if (code !== 0 || exitSignal) { reject(new ForgeError('PROCESS_FAILED', 'Child process exited without a successful result.')); return; }
      resolve({ stdout: Buffer.concat(output).toString('utf8'), exitCode: code, outputBytes: bytes });
    });
    child.stdin.end(input);
  });
}
