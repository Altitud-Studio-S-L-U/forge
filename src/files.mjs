import { constants } from 'node:fs';
import { lstat, open, realpath, mkdir, rename, unlink, chmod } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { ForgeError, requireInput, digest } from './errors.mjs';
import { rejectCredentials } from './contracts.mjs';

export function permittedPath(path) {
  requireInput(typeof path === 'string' && path.length <= 240 && /^[a-zA-Z0-9._/-]+$/u.test(path), 'Use portable relative file paths.');
  const parts = path.split('/');
  requireInput(parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/u.test(part)
    && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part)), 'File paths contain an unsupported segment.');
  requireInput(!parts.some(part => /^(?:\.git|\.claude|\.codex|node_modules|\.aws|\.ssh|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$/iu.test(part))
    && !/\.(?:pem|key|p12|pfx|keystore)$/iu.test(path), 'Secrets and tool configuration are outside the permitted scope.');
  return path;
}
export async function canonicalRoot(path) {
  requireInput(typeof path === 'string' && isAbsolute(path), 'Repository requires an absolute path.');
  const root = await realpath(path);
  requireInput((await lstat(root)).isDirectory(), 'Repository must be a directory.');
  return root;
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export async function fileSnapshot(root, name) {
  permittedPath(name);
  const target = resolve(root, ...name.split('/'));
  requireInput(inside(root, target), 'File scope escapes the repository.');
  const parts = name.split('/'); let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    let info;
    try { info = await lstat(current, { bigint: true }); } catch (error) {
      if (error.code === 'ENOENT') return { path: name, sha256: null, content: null };
      throw error;
    }
    requireInput(!info.isSymbolicLink() && (!info.isFile() || info.nlink === 1n), 'Linked files and ancestors are outside the permitted scope.');
    if (index < parts.length - 1) requireInput(info.isDirectory(), 'A file ancestor is not a directory.');
    else {
      requireInput(info.isFile() && info.size <= 65536n, 'Each context file must be a regular file of at most 64 KiB.');
      const handle = await open(target, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
      try {
        const before = await handle.stat({ bigint: true });
        requireInput(before.isFile() && before.nlink === 1n && before.size <= 65536n && before.ino === info.ino, 'File changed before capture.');
        const bytes = Buffer.alloc(Number(before.size) + 1); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat({ bigint: true });
        requireInput(bytesRead === Number(before.size) && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'File changed during capture.');
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, bytesRead)); }
        catch { throw new ForgeError('INVALID_INPUT', 'Context files must contain valid UTF-8.'); }
        requireInput(!content.includes('\0'), 'Binary context files are unsupported.'); rejectCredentials(content);
        return { path: name, sha256: await digest(bytes.subarray(0, bytesRead)), content, mode: Number(before.mode & 0o777n) };
      } finally { await handle.close(); }
    }
  }
}
export async function captureFiles(root, names) {
  requireInput(Array.isArray(names) && names.length >= 1 && names.length <= 12 && new Set(names.map(name => name.toLowerCase())).size === names.length,
    'Select one to twelve distinct files explicitly.');
  const files = [];
  for (const name of names) files.push(await fileSnapshot(root, name));
  requireInput(Buffer.byteLength(JSON.stringify(files)) <= 256 * 1024, 'Selected context exceeds 256 KiB.');
  return files;
}
export async function applyChanges(root, captured, changes) {
  const allowed = new Map(captured.map(file => [file.path, file]));
  requireInput(Array.isArray(changes) && changes.length > 0 && changes.length <= captured.length, 'An implementation must supply at least one in-scope change.');
  for (const change of changes) {
    permittedPath(change.path);
    const previous = allowed.get(change.path);
    requireInput(previous && previous.sha256 === change.beforeSha256 && Buffer.byteLength(change.content) <= 65536, 'Implementation escaped scope or used a stale source hash.');
    requireInput((await fileSnapshot(root, change.path)).sha256 === previous.sha256, 'The checkout changed after context capture.');
    rejectCredentials(change.content);
  }
  // All preconditions are checked before the first write. Files are replaced atomically; model output never becomes a shell command.
  for (const change of changes) {
    requireInput((await fileSnapshot(root, change.path)).sha256 === allowed.get(change.path).sha256, 'The file changed before replacement.');
    const target = resolve(root, ...change.path.split('/')); await mkdir(dirname(target), { recursive: true });
    const temporary = resolve(dirname(target), `.forge-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(change.content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await chmod(temporary, allowed.get(change.path).mode ?? 0o644); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}
