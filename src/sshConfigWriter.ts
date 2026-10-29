import { mkdir, open, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import * as lockfile from 'proper-lockfile';
import { validAlias } from './model';
import { readHostAliases } from './sshConfig';

export interface NewSshHost {
  alias: string;
  host: string;
  user: string;
  port: number;
  identityFile?: string;
}

export function hostBlock(host: NewSshHost, newline = '\n'): string {
  if (!validAlias(host.alias) || !/^[A-Za-z0-9._:%-]+$/.test(host.host)
    || !/^[A-Za-z0-9._@\\-]+$/.test(host.user)
    || !Number.isInteger(host.port) || host.port < 1 || host.port > 65535) throw new Error('SSH 连接信息无效。');
  if (host.identityFile && /[\x00-\x1f\x7f"`$]/.test(host.identityFile)) throw new Error('私钥路径包含不支持的字符。');
  const lines = [`Host ${host.alias}`, `  HostName ${host.host}`, `  User ${host.user}`, `  Port ${host.port}`];
  if (host.identityFile) lines.push(`  IdentityFile "${host.identityFile.replaceAll('\\', '/')}"`);
  return lines.join(newline) + newline;
}

/** Append under a fresh Host section; never rewrite the user's existing settings. */
export async function addSshHost(configFile: string, host: NewSshHost): Promise<void> {
  hostBlock(host); // Validate before creating any files.
  await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  const destination = await realpath(configFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return configFile;
    throw error;
  });
  const release = await lockfile.lock(destination, {
    realpath: false, stale: 10000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 300 }
  });
  try {
    if ((await readHostAliases(configFile)).includes(host.alias)) throw new Error('此 SSH 别名已存在，请从配置中导入。');
    const file = await open(destination, 'a+', 0o600);
    try {
      const original = await file.readFile('utf8');
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      const prefix = original && !original.endsWith('\n') ? newline + newline : original ? newline : '';
      await file.appendFile(prefix + hostBlock(host, newline), 'utf8');
      await file.sync();
    } finally { await file.close(); }
  } finally { await release(); }
}
