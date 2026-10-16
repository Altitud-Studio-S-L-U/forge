export class ForgeError extends Error {
  constructor(code, message) { super(message); this.name = 'ForgeError'; this.code = code; }
}
export function requireInput(condition, message) {
  if (!condition) throw new ForgeError('INVALID_INPUT', message);
}
export const digest = async bytes => (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
