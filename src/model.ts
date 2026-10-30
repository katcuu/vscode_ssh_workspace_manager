import { createHash } from 'node:crypto';
import * as path from 'node:path';

export interface ServerInfo {
  alias: string;
  label: string;
  configured: boolean;
}

interface FolderMetadata {
  id: string;
  name: string;
  favorite: boolean;
  lastOpenedAt: number | null;
}

export interface RemoteFolderTarget extends FolderMetadata {
  kind: 'remote';
  alias: string;
  authority: string;
  path: string;
}

export interface LocalFolderTarget extends FolderMetadata {
  kind: 'local';
  path: string;
}

export type FolderTarget = RemoteFolderTarget | LocalFolderTarget;

export interface CatalogData {
  schemaVersion: 2;
  revision: number;
  servers: { alias: string; label: string }[];
  folders: FolderTarget[];
  browsePaths: Record<string, string>;
  hiddenServers: string[];
}

export interface RemoteEntry {
  name: string;
  path: string;
  symlink: boolean;
}

export const emptyCatalog = (): CatalogData => ({
  schemaVersion: 2, revision: 0, servers: [], folders: [], browsePaths: {}, hiddenServers: []
});

export function validAlias(alias: unknown): alias is string {
  return typeof alias === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(alias);
}

export function normalizeRemotePath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('请输入 Linux 绝对路径，例如 /home/user/projects。');
  }
  if (input.length > 16384) throw new Error('路径过长。');
  const normalized = path.posix.normalize(input);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

export function authorityForAlias(alias: string): string {
  if (!validAlias(alias)) throw new Error('SSH 别名仅支持英文字母、数字、点、下划线和连字符。');
  return `ssh-remote+${alias}`;
}

export function aliasForAuthority(authority: string): string | undefined {
  if (!authority.startsWith('ssh-remote+')) return undefined;
  const alias = authority.slice('ssh-remote+'.length);
  return validAlias(alias) ? alias : undefined;
}

export function folderId(authority: string, path: string): string {
  return createHash('sha256').update(authority).update('\0').update(normalizeRemotePath(path)).digest('hex').slice(0, 24);
}

export function normalizeLocalPath(input: unknown): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('请输入本机文件夹的绝对路径。');
  }
  if (input.length > 16384) throw new Error('路径过长。');
  const normalized = path.normalize(input);
  const root = path.parse(normalized).root;
  return normalized === root ? normalized : normalized.replace(process.platform === 'win32' ? /[\\/]+$/ : /\/+$/, '');
}

export function localFolderId(input: string): string {
  const normalized = normalizeLocalPath(input);
  const identity = process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  return createHash('sha256').update('file\0').update(identity).digest('hex').slice(0, 24);
}

export function makeFolder(alias: string, remotePath: string, authority = authorityForAlias(alias)): RemoteFolderTarget {
  const normalized = normalizeRemotePath(remotePath);
  if (aliasForAuthority(authority) !== alias) throw new Error('服务器别名与 SSH authority 不匹配。');
  return {
    id: folderId(authority, normalized), kind: 'remote', alias, authority, path: normalized,
    name: path.posix.basename(normalized) || '/', favorite: false, lastOpenedAt: null
  };
}

export function makeLocalFolder(input: string): LocalFolderTarget {
  const normalized = normalizeLocalPath(input);
  return {
    id: localFolderId(normalized), kind: 'local', path: normalized,
    name: path.basename(normalized) || normalized, favorite: false, lastOpenedAt: null
  };
}

export function recordFolder(data: CatalogData, folder: FolderTarget, openedAt = Date.now()): void {
  const existing = data.folders.find(value => value.id === folder.id);
  if (existing) existing.lastOpenedAt = Math.max(existing.lastOpenedAt || 0, openedAt);
  else data.folders.push({ ...folder, lastOpenedAt: openedAt });
}

export function validateCatalog(value: unknown): CatalogData {
  if (!value || typeof value !== 'object') throw new Error('无效的存储数据。');
  const data = value as Omit<CatalogData, 'schemaVersion'> & { schemaVersion: number };
  // Older local builds did not persist exclusions from SSH-config discovery.
  if (data.hiddenServers === undefined) data.hiddenServers = [];
  if (data.schemaVersion === 1 && Array.isArray(data.folders)) {
    for (const folder of data.folders) (folder as FolderTarget & { kind?: string }).kind ??= 'remote';
    data.schemaVersion = 2;
  }
  if (data.schemaVersion !== 2 || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !Array.isArray(data.servers) || !Array.isArray(data.folders)
    || !data.browsePaths || typeof data.browsePaths !== 'object' || Array.isArray(data.browsePaths)
    || !Array.isArray(data.hiddenServers) || !data.hiddenServers.every(validAlias)) {
    throw new Error('存储格式不兼容。');
  }
  for (const server of data.servers) {
    if (!validAlias(server.alias) || typeof server.label !== 'string') throw new Error('服务器元数据无效。');
  }
  for (const folder of data.folders) {
    const commonInvalid = typeof folder.name !== 'string' || typeof folder.favorite !== 'boolean'
      || (folder.lastOpenedAt !== null && (!Number.isFinite(folder.lastOpenedAt) || folder.lastOpenedAt <= 0));
    if (commonInvalid) throw new Error('项目目录元数据无效。');
    if (folder.kind === 'remote' && (!validAlias(folder.alias) || aliasForAuthority(folder.authority) !== folder.alias
      || normalizeRemotePath(folder.path) !== folder.path || folder.id !== folderId(folder.authority, folder.path))) {
      throw new Error('项目目录元数据无效。');
    }
    if (folder.kind === 'local' && (normalizeLocalPath(folder.path) !== folder.path || folder.id !== localFolderId(folder.path))) {
      throw new Error('项目目录元数据无效。');
    }
    if (folder.kind !== 'remote' && folder.kind !== 'local') {
      throw new Error('项目目录元数据无效。');
    }
  }
  for (const [alias, path] of Object.entries(data.browsePaths)) {
    if (!validAlias(alias)) throw new Error('浏览位置元数据无效。');
    normalizeRemotePath(path);
  }
  return data as CatalogData;
}

export function visibleServers(data: CatalogData, aliases: string[]): ServerInfo[] {
  const hidden = new Set(data.hiddenServers);
  const all = new Set([...aliases, ...data.servers.map(server => server.alias), ...data.folders.flatMap(folder => folder.kind === 'remote' ? [folder.alias] : [])]);
  return [...all].filter(alias => !hidden.has(alias)).map(alias => ({
    alias, label: data.servers.find(server => server.alias === alias)?.label || alias,
    configured: aliases.includes(alias)
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function restoreServer(data: CatalogData, alias: string): void {
  if (!validAlias(alias)) throw new Error('SSH 别名无效。');
  data.hiddenServers = data.hiddenServers.filter(value => value !== alias);
  if (!data.servers.some(server => server.alias === alias)) data.servers.push({ alias, label: alias });
}

export function hideServer(data: CatalogData, alias: string): void {
  if (!validAlias(alias)) throw new Error('SSH 别名无效。');
  if (!data.hiddenServers.includes(alias)) data.hiddenServers.push(alias);
}
