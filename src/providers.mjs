import { access, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { schemas, parseResponse } from './contracts.mjs';
import { ForgeError, requireInput } from './errors.mjs';
import { childEnvironment, runProcess } from './process.mjs';

async function onPath(name) {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    for (const candidate of names) {
      const file = resolve(directory.replace(/^"|"$/gu, ''), candidate);
      try { await access(file); if ((await lstat(file)).isFile()) return file; } catch {}
    }
  }
  throw new ForgeError('PROVIDER_UNAVAILABLE', `The ${name} CLI is not available on PATH.`);
}
export async function providerExecutable(name, configured = process.env[`FORGE_${name.toUpperCase()}_EXECUTABLE`]) {
  requireInput(name === 'codex' || name === 'claude', 'Provider must be codex or claude.');
  const path = configured ? resolve(configured) : await onPath(name);
  requireInput(!configured || isAbsolute(configured), 'Configured provider executable must be an absolute path.');
  try { requireInput((await lstat(path)).isFile(), 'Provider executable must be a file.'); }
  catch (error) { if (error instanceof ForgeError) throw error; throw new ForgeError('PROVIDER_UNAVAILABLE', 'Provider executable is unavailable.'); }
  if (extname(path).toLowerCase() === '.js' || extname(path).toLowerCase() === '.mjs') return { executable: process.execPath, prefix: [path] };
  if (process.platform === 'win32' && extname(path).toLowerCase() === '.cmd') {
    // npm command wrappers require cmd.exe. Resolve the installed official entrypoint instead of shell-quoting model or operator data.
    const entry = join(dirname(path), 'node_modules', name === 'claude' ? '@anthropic-ai/claude-code/cli.js' : '@openai/codex/bin/codex.js');
    try { await access(entry); } catch { throw new ForgeError('PROVIDER_UNAVAILABLE', 'The npm CLI entrypoint is unavailable; configure its absolute .js or .exe path.'); }
    return { executable: process.execPath, prefix: [entry] };
  }
  requireInput(process.platform !== 'win32' || extname(path).toLowerCase() === '.exe', 'Windows providers require an executable or JavaScript entrypoint.');
  return { executable: path, prefix: [] };
}

export function decodeClaude(stdout, kind) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { throw new ForgeError('INVALID_RESPONSE', 'Claude did not return a complete result envelope.'); }
  if (!envelope || envelope.type !== 'result' || envelope.is_error !== false || envelope.subtype !== 'success') {
    throw new ForgeError('PROVIDER_FAILED', 'Claude did not complete the requested operation.');
  }
  if (Array.isArray(envelope.permission_denials) && envelope.permission_denials.length > 0) {
    throw new ForgeError('PERMISSION_DENIED', 'Claude reported a denied operation; no approval is inferred.');
  }
  if (!envelope.structured_output || typeof envelope.structured_output !== 'object') throw new ForgeError('INVALID_RESPONSE', 'Claude did not return structured output.');
  return parseResponse(kind, JSON.stringify(envelope.structured_output));
}
function validateCodexEvents(stdout) {
  for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { throw new ForgeError('INVALID_RESPONSE', 'Codex emitted an incomplete event stream.'); }
    if (['error', 'turn.failed'].includes(item.type)) throw new ForgeError('PROVIDER_FAILED', 'Codex reported a failed turn.');
    if (item.item && ['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(item.item.type)) {
      throw new ForgeError('UNEXPECTED_TOOL_USE', 'The bounded agent attempted a tool operation.');
    }
  }
}
export async function callProvider({ provider, kind, prompt, directory, signal, timeoutMs, model }) {
  requireInput(model === undefined || typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(model), 'Model must be an explicit bounded identifier.');
  const command = await providerExecutable(provider);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const schema = schemas[kind];
  if (provider === 'claude') {
    const args = [...command.prefix, '--print', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
      '--tools', '', '--permission-mode', 'plan', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '', '--settings', '{"disableAllHooks":true}', ...(model ? ['--model', model] : [])];
    const result = await runProcess({ ...command, args, cwd: directory, input: prompt, signal, timeoutMs, env: childEnvironment() });
    return decodeClaude(result.stdout, kind);
  }
  const schemaFile = join(directory, 'schema.json'), outputFile = join(directory, 'answer.json');
  await writeFile(schemaFile, JSON.stringify(schema), { flag: 'wx', mode: 0o600 });
  const args = [...command.prefix, '--no-daemon', '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-c', 'features.shell_tool=false', '--json', '--color', 'never',
    '--output-schema', schemaFile, '--output-last-message', outputFile, ...(model ? ['--model', model] : []), '-'];
  try {
    const result = await runProcess({ ...command, args, cwd: directory, input: prompt, signal, timeoutMs, env: childEnvironment() });
    validateCodexEvents(result.stdout);
    const info = await lstat(outputFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) throw new ForgeError('INVALID_RESPONSE', 'Codex result file exceeds its contract.');
    return parseResponse(kind, await readFile(outputFile, 'utf8'));
  } catch (error) {
    if (error instanceof ForgeError) throw error;
    throw new ForgeError('INVALID_RESPONSE', 'Codex did not supply a readable final result.');
  } finally { await unlink(outputFile).catch(() => {}); }
}
