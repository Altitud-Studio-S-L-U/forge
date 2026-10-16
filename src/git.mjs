import { runProcess } from './process.mjs';
import { requireInput } from './errors.mjs';

async function git(repo, args) { return (await runProcess({ executable: 'git', args: ['--no-pager', '-c', 'core.fsmonitor=false', ...args], cwd: repo, timeoutMs: 15_000, maximumOutputBytes: 256 * 1024 })).stdout.trimEnd(); }
export async function repositoryState(repo, { clean = false, feature = false } = {}) {
  const top = await git(repo, ['rev-parse', '--show-toplevel']);
  const normalize = value => {
    const normalized = value.replaceAll('\\', '/').replace(/\/$/u, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  requireInput(normalize(top) === normalize(repo), 'Repository must be its top-level checkout.');
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const branch = await git(repo, ['symbolic-ref', '--short', 'HEAD']);
  const status = await git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
  requireInput(!clean || status === '', 'Implementation requires a clean checkout, including untracked files.');
  requireInput(!feature || /^(?:feat|fix|hotfix)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(branch), 'Implementation requires a feat/, fix/ or hotfix/ branch.');
  return { head, branch, status };
}
export async function assertHead(repo, previous) {
  const current = await repositoryState(repo);
  requireInput(current.head === previous.head && current.branch === previous.branch, 'Repository head or branch changed during the run.');
  return current;
}
