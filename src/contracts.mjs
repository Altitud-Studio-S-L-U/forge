import { ForgeError } from './errors.mjs';

const text = { type: 'string', minLength: 1, maxLength: 4000 };
const finding = { type: 'object', additionalProperties: false, required: ['severity', 'file', 'message'], properties: {
  severity: { type: 'string', enum: ['blocking', 'warning'] }, file: { type: ['string', 'null'], maxLength: 240 }, message: text,
} };
export const schemas = Object.freeze({
  implement: { type: 'object', additionalProperties: false, required: ['status', 'summary', 'changes'], properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] }, summary: text,
    changes: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
      required: ['path', 'beforeSha256', 'content'], properties: { path: { type: 'string', minLength: 1, maxLength: 240 },
        beforeSha256: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }, content: { type: 'string', maxLength: 65536 } } } },
  } },
  review: { type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'findings'], properties: {
    verdict: { type: 'string', enum: ['pass', 'changes-required', 'blocked'] }, summary: text,
    findings: { type: 'array', maxItems: 30, items: finding },
  } },
  research: { type: 'object', additionalProperties: false, required: ['status', 'summary', 'observations', 'questions'], properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] }, summary: text,
    observations: { type: 'array', maxItems: 30, items: text }, questions: { type: 'array', maxItems: 20, items: text },
  } },
});

// A closed validator for this small fixed schema vocabulary, not a general JSON Schema implementation.
function matches(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(kind)) return false;
  if (value === null) return true;
  if (kind === 'string') return (!schema.minLength || value.length >= schema.minLength)
    && (!schema.maxLength || value.length <= schema.maxLength) && (!schema.enum || schema.enum.includes(value))
    && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value)) && !value.includes('\u0000');
  if (kind === 'array') return value.length <= schema.maxItems && value.every(item => matches(item, schema.items));
  if (kind === 'object') return Object.keys(value).every(key => Object.hasOwn(schema.properties, key))
    && schema.required.every(key => Object.hasOwn(value, key)) && Object.entries(value).every(([key, item]) => matches(item, schema.properties[key]));
  return false;
}
export function rejectCredentials(text) {
  if (/(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk_live_|sk_test_|sk-proj-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~-]{24,})/u.test(text)) {
    throw new ForgeError('CREDENTIAL_CONTENT', 'Credential-like content is outside the permitted context and output.');
  }
}
export function parseResponse(kind, raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 512 * 1024) throw new ForgeError('INVALID_RESPONSE', 'Agent response exceeds its contract.');
  rejectCredentials(raw);
  let value;
  try { value = JSON.parse(raw); } catch { throw new ForgeError('INVALID_RESPONSE', 'Agent did not return complete JSON.'); }
  if (!schemas[kind] || !matches(value, schemas[kind])) throw new ForgeError('INVALID_RESPONSE', 'Agent returned an incompatible response.');
  if (kind === 'implement' && (new Set(value.changes.map(item => item.path)).size !== value.changes.length
    || value.status === 'blocked' && value.changes.length > 0)) throw new ForgeError('INVALID_RESPONSE', 'Agent returned conflicting implementation state.');
  if (kind === 'review' && value.verdict === 'pass' && value.findings.some(item => item.severity === 'blocking')) {
    throw new ForgeError('INVALID_RESPONSE', 'A passing review cannot include a blocking finding.');
  }
  return value;
}
