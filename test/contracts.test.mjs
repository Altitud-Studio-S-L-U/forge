import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, rejectCredentials } from '../src/contracts.mjs';
import { decodeClaude } from '../src/providers.mjs';
import { verificationCommand } from '../src/forge.mjs';
import { childEnvironment } from '../src/process.mjs';

test('incomplete, unexpected and contradictory agent output never becomes a passing review', () => {
  const valid = { verdict: 'pass', summary: 'Reviewed selected code.', findings: [] };
  assert.deepEqual(parseResponse('review', JSON.stringify(valid)), valid);
  for (const raw of ['{"verdict":', JSON.stringify({ ...valid, approved: true }), JSON.stringify({ ...valid, findings: [{ severity: 'blocking', file: 'a.mjs', message: 'Broken.' }] }),
    JSON.stringify({ verdict: 'pass', summary: '', findings: [] }), '[]', 'null']) assert.throws(() => parseResponse('review', raw), { code: 'INVALID_RESPONSE' });
  assert.throws(() => parseResponse('implement', JSON.stringify({ status: 'blocked', summary: 'Cannot implement.', changes: [{ path: 'a', beforeSha256: null, content: 'x' }] })), { code: 'INVALID_RESPONSE' });
});
test('Claude error, denial and missing structured output override success-looking text', () => {
  const success = { type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'pass', summary: 'Review complete.', findings: [] } };
  assert.equal(decodeClaude(JSON.stringify(success), 'review').verdict, 'pass');
  assert.throws(() => decodeClaude(JSON.stringify({ ...success, permission_denials: [{ tool_name: 'Read' }] }), 'review'), { code: 'PERMISSION_DENIED' });
  assert.throws(() => decodeClaude(JSON.stringify({ ...success, is_error: true }), 'review'), { code: 'PROVIDER_FAILED' });
  assert.throws(() => decodeClaude(JSON.stringify({ ...success, structured_output: undefined, result: 'Approved!' }), 'review'), { code: 'INVALID_RESPONSE' });
});
test('verification is explicit argv and child environments do not inherit API credentials', () => {
  assert.deepEqual(verificationCommand(['node', '--test']), ['node', '--test']);
  for (const value of ['node --test', [], ['cmd.exe', '/c', 'echo ok'], ['C:/Windows/powershell.exe', '-Command', 'x'], ['node', '\0']]) assert.throws(() => verificationCommand(value), { code: 'INVALID_INPUT' });
  assert.deepEqual(childEnvironment({ PATH: 'tools', HOME: '/user', OPENAI_API_KEY: 'private', ANTHROPIC_API_KEY: 'private', GH_TOKEN: 'private', DATABASE_URL: 'private' }), { PATH: 'tools', HOME: '/user' });
  assert.throws(() => rejectCredentials(`Bearer ${'x'.repeat(30)}`), { code: 'CREDENTIAL_CONTENT' });
});
