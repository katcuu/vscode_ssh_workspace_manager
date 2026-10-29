import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ResolvedSshConfig } from './sshConfig';

export type TrustStatus = 'known' | 'unknown' | 'changed' | 'revoked' | 'certificate';

export function keyAlgorithm(key: Buffer): string {
  if (key.length < 4) throw new Error('服务器主机密钥无效。');
  const length = key.readUInt32BE(0);
  if (length > key.length - 4 || length > 256) throw new Error('服务器主机密钥无效。');
  return key.subarray(4, 4 + length).toString('ascii');
}

export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

function matches(pattern: string, host: string): boolean {
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = createHmac('sha1', Buffer.from(salt, 'base64')).update(host).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  const regex = pattern.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${regex}$`, 'i').test(host);
}

export function checkKnownHosts(content: string, host: string, key: Buffer): TrustStatus {
  const algorithm = keyAlgorithm(key);
  if (algorithm.includes('-cert-')) return 'certificate';
  let known = false, changed = false;
  for (const line of content.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0] || parts[0].startsWith('#')) continue;
    const marker = parts[0].startsWith('@') ? parts.shift() : '';
    const [patterns, type, data] = parts;
    if (!patterns || !type || !data) continue;
    const entries = patterns.split(',');
    if (entries.some(pattern => pattern.startsWith('!') && matches(pattern.slice(1), host))) continue;
    if (!entries.some(pattern => !pattern.startsWith('!') && matches(pattern, host))) continue;
    if (marker === '@cert-authority') continue;
    const stored = Buffer.from(data, 'base64');
    const equal = stored.length === key.length && timingSafeEqual(stored, key);
    if (marker === '@revoked' && equal) return 'revoked';
    if (type === algorithm) { if (equal) known = true; else changed = true; }
  }
  return known ? 'known' : changed ? 'changed' : 'unknown';
}

export async function readHostTrust(config: ResolvedSshConfig, key: Buffer): Promise<TrustStatus> {
  const content = (await Promise.all(config.knownHostsFiles.map(async file => {
    try { return await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new Error('无法读取 known_hosts，已停止后台连接。');
    }
  }))).join('\n');
  const host = config.hostKeyAlias || (config.port === 22 ? config.host : `[${config.host}]:${config.port}`);
  return checkKnownHosts(content, host, key);
}
