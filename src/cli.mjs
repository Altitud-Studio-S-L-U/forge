#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runForge } from './forge.mjs';
import { readRegularFile } from './files.mjs';
import { ForgeError, requireInput } from './errors.mjs';

export const help = `Forge: bounded Codex + Claude Code cooperation (Node 24, existing CLI authentication).
Usage: forge research|review|implement --repo <absolute checkout> --task-file <file> --file <relative> [--file ...]
  --coder codex|claude       Implementer (default codex).
  --reviewer codex|claude    Independent reviewer (default other provider).
  --codex-model <id>         Optional exact Codex model; otherwise CLI default.
  --claude-model <id>        Optional Claude model; otherwise CLI default.
  --verify-json <argv JSON>  Implementation check, e.g. '["node","--test"]'; no shell.
  --timeout-ms <1000..300000>  Per-process limit (default 120000).
  --deadline-ms <1000..900000> Workflow limit (default 480000).
  --output <external dir>    Existing evidence parent (default OS temporary directory).
Implementation requires a clean feature branch. Only supplied UTF-8 files (12, 64KiB each) can change.
Both agents receive captured context without tools. At most one repair and a final independent review.
No commit, push, merge or deploy. Research is local evidence analysis, not live web research.
Exit: 0 research/review complete or ready for human review; 1 findings/needs verification; 2 blocked/error.
`;

export async function main(args = process.argv.slice(2)) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: true, tokens: true, options: {
      repo: { type: 'string' }, 'task-file': { type: 'string' }, file: { type: 'string', multiple: true },
      coder: { type: 'string' }, reviewer: { type: 'string' }, 'codex-model': { type: 'string' }, 'claude-model': { type: 'string' },
      'verify-json': { type: 'string' }, 'timeout-ms': { type: 'string' }, 'deadline-ms': { type: 'string' },
      output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    if (parsed.values.help) { process.stdout.write(help); return 0; }
    const seen = new Set();
    for (const token of parsed.tokens) if (token.kind === 'option' && token.name !== 'file') {
      requireInput(!seen.has(token.name), 'Repeated scalar options are unsupported.'); seen.add(token.name);
    }
    requireInput(parsed.positionals.length === 1, 'Select exactly one mode.');
    const file = parsed.values['task-file'];
    requireInput(file && isAbsolute(file), 'Task file requires an absolute path.');
    const task = await readRegularFile(file, 24000, () => new ForgeError('INVALID_INPUT', 'Task must be a bounded regular file.'));
    let verify;
    try { verify = parsed.values['verify-json'] === undefined ? undefined : JSON.parse(parsed.values['verify-json']); }
    catch { throw new ForgeError('INVALID_INPUT', 'Verification must be a JSON argv array.'); }
    const integer = key => {
      const value = parsed.values[key];
      if (value === undefined) return undefined;
      requireInput(/^[0-9]{4,6}$/u.test(value), 'Timeout requires whole decimal milliseconds.'); return Number(value);
    };
    const report = await runForge({ mode: parsed.positionals[0], repo: parsed.values.repo, task,
      files: parsed.values.file, coder: parsed.values.coder, reviewer: parsed.values.reviewer,
      codexModel: parsed.values['codex-model'], claudeModel: parsed.values['claude-model'], verify,
      timeoutMs: integer('timeout-ms'), deadlineMs: integer('deadline-ms'),
      ...(parsed.values.output ? { output: resolve(parsed.values.output) } : {}), signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ id: report.id, status: report.status, changedFiles: report.changedFiles,
      checks: report.checks, error: report.error, result: resolve(report.directory, 'result.json') })}\n`);
    return report.status === 'blocked' ? 2 : ['findings', 'needs-verification'].includes(report.status) ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error instanceof ForgeError ? error.code : 'INVALID_INPUT',
      message: error instanceof ForgeError ? error.message : 'Check the supplied paths and CLI arguments.' } })}\n`); return 2;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
