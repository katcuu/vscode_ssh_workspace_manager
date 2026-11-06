import { posix } from 'node:path';
import { normalizeRemotePath } from './model';

export interface GitRepository {
  url: string;
  host: string;
  name: string;
  protocol: 'ssh' | 'https';
}

export interface GitCloneProgress {
  phase: 'starting' | 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checkout' | 'complete';
  message: string;
  percent?: number;
  current?: number;
  total?: number;
}

export interface GitClonePrompts {
  username(target: string): Promise<string | undefined>;
  password(target: string, username: string): Promise<string | undefined>;
  sshPassword(target: string, username: string): Promise<string | undefined>;
  passphrase(keyPath: string): Promise<string | undefined>;
}

export type GitPrompt =
  | { type: 'username'; target: string }
  | { type: 'password'; target: string }
  | { type: 'ssh-password'; target: string; username: string }
  | { type: 'passphrase'; keyPath: string }
  | { type: 'unknown-host' };

function repositoryName(repositoryPath: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(repositoryPath); }
  catch { throw new Error('Git 仓库地址中的路径编码无效。'); }
  if (decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('Git 仓库路径不能包含相对目录。');
  const lastSegment = posix.basename(decoded.replace(/\/+$/, ''));
  if (!lastSegment || /^\.git$/i.test(lastSegment)) throw new Error('无法从 Git 地址中确定安全的仓库目录名。');
  const name = lastSegment.replace(/\.git$/i, '');
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/.test(name)) {
    throw new Error('无法从 Git 地址中确定安全的仓库目录名。');
  }
  return name;
}

export function parseGitRepositoryUrl(value: string): GitRepository {
  const url = value.trim();
  if (!url || url.length > 4096 || /[\x00-\x1f\x7f]/.test(url)) throw new Error('请输入有效的 Git 仓库地址。');

  if (/^https:\/\//i.test(url)) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('HTTPS 仓库地址无效。'); }
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('HTTPS 地址不要包含账号、令牌、查询参数或片段；需要认证时会安全提示输入。');
    }
    return { url, host: parsed.hostname, name: repositoryName(parsed.pathname), protocol: 'https' };
  }

  if (/^ssh:\/\//i.test(url)) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('SSH 仓库地址无效。'); }
    if (!parsed.hostname || parsed.password || parsed.search || parsed.hash) throw new Error('SSH 仓库地址无效，请勿在地址中嵌入凭据。');
    return { url, host: parsed.hostname, name: repositoryName(parsed.pathname), protocol: 'ssh' };
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    throw new Error('仅支持 SSH 和 HTTPS 仓库地址。');
  }

  const scp = /^(?:([^@/:\s]+)@)?(\[[^\]]+\]|[A-Za-z0-9.-]+):(.+)$/.exec(url);
  if (!scp || /[\x00-\x1f\x7f]/.test(scp[3])) {
    throw new Error('仅支持 SSH 地址（git@host:group/repo.git 或 ssh://...）和 HTTPS 地址。');
  }
  return { url, host: scp[2].replace(/^\[|\]$/g, ''), name: repositoryName(scp[3]), protocol: 'ssh' };
}

export function gitCloneDestination(parent: string, repository: GitRepository): string {
  return posix.join(normalizeRemotePath(parent), repository.name);
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function gitCloneCommand(repositoryUrl: string, destination: string): string {
  return `stty -echo 2>/dev/null || :; LC_ALL=C GIT_TERMINAL_PROMPT=1 GIT_ASKPASS= git -c credential.helper= clone --progress -- ${quoteShell(repositoryUrl)} ${quoteShell(destination)}`;
}

export function stripTerminalSequences(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
}

export function parseGitPrompt(value: string, protocol: GitRepository['protocol']): GitPrompt | undefined {
  const text = stripTerminalSequences(value).replace(/\r/g, '\n');
  const username = /(?:^|\n)Username for '([^']+)':\s*$/i.exec(text);
  if (protocol === 'https' && username) return { type: 'username', target: username[1] };
  const password = /(?:^|\n)Password for '([^']+)':\s*$/i.exec(text);
  if (protocol === 'https' && password) return { type: 'password', target: password[1] };
  const sshPassword = /(?:^|\n)([^@\s]+)@([^'\r\n]+)'s password:\s*$/i.exec(text);
  if (protocol === 'ssh' && sshPassword) return { type: 'ssh-password', username: sshPassword[1], target: sshPassword[2] };
  const passphrase = /(?:^|\n)Enter passphrase for key '([^']*)':\s*$/i.exec(text);
  if (passphrase) return { type: 'passphrase', keyPath: passphrase[1] };
  if (/Are you sure you want to continue connecting\s*\([^)]*\)\?\s*$/i.test(text)) return { type: 'unknown-host' };
  return undefined;
}

export function parseGitProgress(line: string): GitCloneProgress | undefined {
  const text = stripTerminalSequences(line).trim();
  const match = /(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s*(\d+)%\s*(?:\((\d+)\/(\d+)\))?/i.exec(text);
  if (!match) return undefined;
  const phase = match[1].toLowerCase().startsWith('counting') ? 'counting'
    : match[1].toLowerCase().startsWith('compressing') ? 'compressing'
      : match[1].toLowerCase().startsWith('receiving') ? 'receiving'
        : match[1].toLowerCase().startsWith('resolving') ? 'resolving' : 'checkout';
  const labels = { counting: '统计对象', compressing: '压缩对象', receiving: '接收对象', resolving: '解析差异', checkout: '检出文件' };
  const current = match[3] ? Number(match[3]) : undefined;
  const total = match[4] ? Number(match[4]) : undefined;
  const percent = Number(match[2]);
  return { phase, message: `${labels[phase]} ${percent}%${current !== undefined && total !== undefined ? `（${current}/${total}）` : ''}`,
    percent, current, total };
}
