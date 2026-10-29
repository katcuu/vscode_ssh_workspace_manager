import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export interface ServerInfo {
  alias: string;
  label: string;
  configured: boolean;
}

export interface FolderTarget {
  id: string;
  alias: string;
  authority: string;
  path: string;
  name: string;
  favorite: boolean;
  lastOpenedAt: number | null;
}

export interface CatalogData {
  schemaVersion: 1;
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
  schemaVersion: 1, revision: 0, servers: [], folders: [], browsePaths: {}, hiddenServers: []
});

export function validAlias(alias: unknown): alias is string {
  return typeof alias === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(alias);
}

export function normalizeRemotePath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('请输入 Linux 绝对路径，例如 /home/user/projects。');
  }
  if (input.length > 16384) throw new Error('路径过长。');
  const normalized = posix.normalize(input);
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

export function makeFolder(alias: string, path: string, authority = authorityForAlias(alias)): FolderTarget {
  const normalized = normalizeRemotePath(path);
  if (aliasForAuthority(authority) !== alias) throw new Error('服务器别名与 SSH authority 不匹配。');
  return {
    id: folderId(authority, normalized), alias, authority, path: normalized,
    name: posix.basename(normalized) || '/', favorite: false, lastOpenedAt: null
  };
}

export function validateCatalog(value: unknown): CatalogData {
  if (!value || typeof value !== 'object') throw new Error('无效的存储数据。');
  const data = value as CatalogData;
  // Older local builds did not persist exclusions from SSH-config discovery.
  if (data.hiddenServers === undefined) data.hiddenServers = [];
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !Array.isArray(data.servers) || !Array.isArray(data.folders)
    || !data.browsePaths || typeof data.browsePaths !== 'object' || Array.isArray(data.browsePaths)
    || !Array.isArray(data.hiddenServers) || !data.hiddenServers.every(validAlias)) {
    throw new Error('存储格式不兼容。');
  }
  for (const server of data.servers) {
    if (!validAlias(server.alias) || typeof server.label !== 'string') throw new Error('服务器元数据无效。');
  }
  for (const folder of data.folders) {
    if (!validAlias(folder.alias) || aliasForAuthority(folder.authority) !== folder.alias
      || normalizeRemotePath(folder.path) !== folder.path || folder.id !== folderId(folder.authority, folder.path)
      || typeof folder.name !== 'string' || typeof folder.favorite !== 'boolean'
      || (folder.lastOpenedAt !== null && (!Number.isFinite(folder.lastOpenedAt) || folder.lastOpenedAt <= 0))) {
      throw new Error('项目目录元数据无效。');
    }
  }
  for (const [alias, path] of Object.entries(data.browsePaths)) {
    if (!validAlias(alias)) throw new Error('浏览位置元数据无效。');
    normalizeRemotePath(path);
  }
  return data;
}

export function visibleServers(data: CatalogData, aliases: string[]): ServerInfo[] {
  const hidden = new Set(data.hiddenServers);
  const all = new Set([...aliases, ...data.servers.map(server => server.alias), ...data.folders.map(folder => folder.alias)]);
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
