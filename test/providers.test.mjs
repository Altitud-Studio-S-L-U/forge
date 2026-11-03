import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { callProvider, providerExecutable } from '../src/providers.mjs';

const review = { verdict: 'pass', summary: 'Inspected the supplied source.', findings: [] };
async function providerFixture(t, name, source) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'forge-provider-test-'));
  const previous = process.env[`FORGE_${name.toUpperCase()}_EXECUTABLE`];
  t.after(async () => {
    const key = `FORGE_${name.toUpperCase()}_EXECUTABLE`;
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    const current = await realpath(directory);
    assert.equal(dirname(current), parent);
    assert.ok(basename(current).startsWith('forge-provider-test-'));
    await rm(current, { recursive: true, force: false });
  });
  const executable = join(directory, 'fake provider.mjs');
  await writeFile(executable, source);
  process.env[`FORGE_${name.toUpperCase()}_EXECUTABLE`] = executable;
  return { directory, executable };
}
function codexSource(events) {
  return `import {writeFile} from 'node:fs/promises';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
if(Buffer.concat(chunks).toString()!=='Explicit fixture context')process.exit(7);
const args=process.argv.slice(2);
await writeFile(args[args.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify(review))});
process.stdout.write(${JSON.stringify(events.map(event => JSON.stringify(event)).join('\n') + '\n')});`;
}
async function call(f, suffix = 'call') {
  return callProvider({ provider: 'codex', kind: 'review', prompt: 'Explicit fixture context',
    directory: join(f.directory, suffix), timeoutMs: 5000 });
}

test('Codex adapter consumes stdin, accepts a completed data-only stream and removes the raw answer', async t => {
  const f = await providerFixture(t, 'codex', codexSource([
    { type: 'thread.started', thread_id: 'fixture' }, { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'message', type: 'agent_message', text: JSON.stringify(review) } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ]));
  assert.deepEqual(await call(f), review);
  await assert.rejects(readFile(join(f.directory, 'call', 'answer.json')), { code: 'ENOENT' });
});

test('Codex adapter rejects incomplete streams even when a valid answer file and exit zero exist', async t => {
  const f = await providerFixture(t, 'codex', codexSource([]));
  await assert.rejects(call(f, 'empty'), { code: 'INVALID_RESPONSE' });
  await writeFile(f.executable, codexSource([{ type: 'turn.started' }]));
  await assert.rejects(call(f, 'started'), { code: 'INVALID_RESPONSE' });
});

test('Codex adapter rejects known and unfamiliar tool items before trusting a completed answer', async t => {
  const f = await providerFixture(t, 'codex', '');
  for (const type of ['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'collab_tool_call', 'future_tool']) {
    await writeFile(f.executable, codexSource([{ type: 'turn.started' },
      { type: 'item.completed', item: { id: 'operation', type } }, { type: 'turn.completed' }]));
    await assert.rejects(call(f, type), { code: 'UNEXPECTED_TOOL_USE' });
  }
});

test('Claude adapter uses explicit stdin and disables tools, MCP configuration and hooks', async t => {
  const source = `const args=process.argv.slice(2);const values=flag=>args[args.indexOf(flag)+1];
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
if(Buffer.concat(chunks).toString()!=='Explicit fixture context'||values('--tools')!==''
  ||values('--setting-sources')!==''||values('--permission-mode')!=='plan'
  ||!args.includes('--strict-mcp-config')||values('--mcp-config')!==JSON.stringify({mcpServers:{}})
  ||JSON.parse(values('--settings')).disableAllHooks!==true)process.exit(7);
process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: review }))});`;
  const f = await providerFixture(t, 'claude', source);
  assert.deepEqual(await callProvider({ provider: 'claude', kind: 'review', prompt: 'Explicit fixture context',
    directory: join(f.directory, 'call'), timeoutMs: 5000 }), review);
});

test('POSIX npm-style executable links resolve to their JavaScript entrypoint', { skip: process.platform === 'win32' }, async t => {
  const f = await providerFixture(t, 'codex', '');
  const bin = join(f.directory, 'bin'); await mkdir(bin);
  const link = join(bin, 'codex'); await symlink(f.executable, link);
  assert.deepEqual(await providerExecutable('codex', link), { executable: process.execPath, prefix: [f.executable] });
  const previousPath = process.env.PATH;
  const previousOverride = process.env.FORGE_CODEX_EXECUTABLE;
  process.env.PATH = bin;
  delete process.env.FORGE_CODEX_EXECUTABLE;
  try {
    assert.deepEqual(await providerExecutable('codex'), { executable: process.execPath, prefix: [f.executable] });
  } finally {
    process.env.PATH = previousPath;
    process.env.FORGE_CODEX_EXECUTABLE = previousOverride;
  }
});
