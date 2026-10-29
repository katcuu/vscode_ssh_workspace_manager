import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { validAlias } from './model';

const execFileAsync = promisify(execFile);

export interface ResolvedSshConfig {
  alias: string;
  host: string;
  port: number;
  username: string;
  identityFiles: string[];
  identityAgent?: string;
  identitiesOnly: boolean;
  publicKeyAuthentication: boolean;
  passwordAuthentication: boolean;
  hostKeyAlias?: string;
  knownHostsFiles: string[];
}

export function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') || value.startsWith('~\\')
    ? path.join(homedir(), value.slice(2)) : value;
}

export function configWords(line: string): string[] {
  const result: string[] = [];
  let word = '', quote = '', active = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (!quote && char === '#') break;
    if (char === '\\' && i + 1 < line.length && /[\s"'\\#]/.test(line[i + 1])) {
      word += line[++i]; active = true; continue;
    }
    if (quote) { if (char === quote) quote = ''; else word += char; active = true; }
    else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char) || (char === '=' && (result.length === 0 || (result.length === 1 && !active)))) {
      if (active) { result.push(word); word = ''; active = false; }
    } else { word += char; active = true; }
  }
  if (active) result.push(word);
  return result;
}

async function expandGlob(pattern: string): Promise<string[]> {
  const absolute = path.resolve(pattern);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep);
  let paths = [parsed.root];
  for (const segment of segments) {
    if (!/[?*]/.test(segment)) { paths = paths.map(base => path.join(base, segment)); continue; }
    const matcher = new RegExp(`^${segment.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
    const next: string[] = [];
    for (const base of paths) {
      const entries = await readdir(base).catch(() => [] as string[]);
      for (const entry of entries.sort()) if (matcher.test(entry)) next.push(path.join(base, entry));
    }
    paths = next;
  }
  return paths;
}

export async function readHostAliases(configFile: string): Promise<string[]> {
  const aliases = new Set<string>();
  const visited = new Set<string>();
  const read = async (file: string, depth: number): Promise<void> => {
    if (depth > 16 || visited.has(file)) return;
    visited.add(file);
    let content: string;
    try { content = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(`无法读取 SSH 配置：${file}`);
    }
    for (const line of content.split(/\r?\n/)) {
      const [keyword, ...values] = configWords(line);
      if (keyword?.toLowerCase() === 'host') for (const alias of values) if (validAlias(alias)) aliases.add(alias);
      if (keyword?.toLowerCase() === 'include') {
        for (const value of values) {
          // OpenSSH treats relative user Include paths as relative to ~/.ssh.
          const expanded = expandHome(value);
          const pattern = path.isAbsolute(expanded) ? expanded : path.join(homedir(), '.ssh', expanded);
          for (const included of await expandGlob(pattern)) await read(included, depth + 1);
        }
      }
    }
  };
  await read(path.resolve(expandHome(configFile)), 0);
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

export function parseResolvedConfig(alias: string, output: string): ResolvedSshConfig {
  const values = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf(' ');
    if (index < 0) continue;
    const key = line.slice(0, index).toLowerCase();
    const value = line.slice(index + 1).trim();
    values.set(key, [...(values.get(key) || []), value]);
  }
  const get = (key: string, fallback = '') => values.get(key)?.[0] || fallback;
  const enabled = (key: string, defaultValue = true) => values.has(key) ? !['no', 'false', '0'].includes(get(key)) : defaultValue;
  for (const key of ['proxyjump', 'proxycommand', 'certificatefile', 'knownhostscommand']) {
    if (values.get(key)?.some(value => value && value !== 'none')) {
      throw new Error(`后台浏览暂不支持 ${key} 后台浏览。可直接打开已保存路径，由 Remote SSH 处理连接。`);
    }
  }
  if (get('preferredauthentications') && get('preferredauthentications') !== 'gssapi-with-mic,hostbased,publickey,keyboard-interactive,password') {
    const supported = get('preferredauthentications').split(',');
    if (supported.some(method => !['publickey', 'password', 'keyboard-interactive', 'gssapi-with-mic', 'hostbased'].includes(method))) {
      throw new Error('此认证策略暂不支持后台浏览，请通过 Remote SSH 打开。');
    }
  }
  if (get('bindaddress') && get('bindaddress') !== '*') throw new Error('后台浏览暂不支持 BindAddress 后台浏览。');
  if (get('bindinterface') && get('bindinterface') !== 'none') throw new Error('后台浏览暂不支持 BindInterface 后台浏览。');
  const host = get('hostname', alias);
  const port = Number(get('port', '22'));
  const username = get('user', userInfo().username);
  if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 连接参数无效。');
  const expandToken = (value: string) => expandHome(value.replace(/%([%dhpru])/g, (_, token: string) => ({
    '%': '%', d: homedir(), h: host, p: String(port), r: username, u: userInfo().username
  })[token] || ''));
  const identityFiles = (values.get('identityfile') || []).filter(value => value !== 'none').map(expandToken);
  const knownHostsFiles = [...(values.get('userknownhostsfile') || []).flatMap(configWords), ...(values.get('globalknownhostsfile') || []).flatMap(configWords)]
    .filter(value => value !== 'none').map(expandToken);
  let agent = get('identityagent');
  if (agent === 'SSH_AUTH_SOCK' || !agent) agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
  else if (agent === 'none') agent = '';
  else if (agent.startsWith('$')) {
    agent = process.env[agent.slice(1)] || '';
  } else agent = expandToken(agent);
  const preferred = get('preferredauthentications').split(',').filter(Boolean);
  return {
    alias, host, port, username, identityFiles, identityAgent: agent || undefined,
    identitiesOnly: enabled('identitiesonly', false),
    publicKeyAuthentication: enabled('pubkeyauthentication') && (!preferred.length || preferred.includes('publickey')),
    passwordAuthentication: enabled('passwordauthentication') && (!preferred.length || preferred.includes('password')),
    hostKeyAlias: get('hostkeyalias') || undefined,
    knownHostsFiles: knownHostsFiles.length ? knownHostsFiles : [path.join(homedir(), '.ssh', 'known_hosts')]
  };
}

export async function resolveSshConfig(sshPath: string, configFile: string, alias: string, signal?: AbortSignal): Promise<ResolvedSshConfig> {
  if (!validAlias(alias)) throw new Error('不支持此 SSH 别名。');
  try {
    // Match exec can execute local commands; refuse it in background browsing before invoking OpenSSH.
    const check = async (file: string, visited = new Set<string>()): Promise<void> => {
      if (visited.has(file)) return;
      if (visited.size > 64) throw new Error('SSH Include 文件过多，请使用 Remote SSH 打开。');
      visited.add(file);
      const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      for (const line of text.split(/\r?\n/)) {
        const [key, ...args] = configWords(line);
        if (key?.toLowerCase() === 'match' && args.some(arg => arg.replace(/^!/, '').split('=')[0].toLowerCase() === 'exec')) {
          throw new Error('后台浏览不执行 Match exec 配置，请使用 Remote SSH 打开。');
        }
        if (key?.toLowerCase() === 'include') for (const value of args) {
          const expanded = expandHome(value);
          for (const included of await expandGlob(path.isAbsolute(expanded) ? expanded : path.join(homedir(), '.ssh', expanded))) {
            await check(included, visited);
          }
        }
      }
    };
    await check(configFile);
    const { stdout } = await execFileAsync(sshPath, ['-G', '-F', configFile, alias], {
      timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, signal
    });
    return parseResolvedConfig(alias, stdout);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('未找到本机 OpenSSH。请安装或设置 sshWorkspaceManager.sshPath。');
    if (typeof code === 'number') throw new Error('OpenSSH 无法解析该配置，请检查 SSH 配置文件和别名。');
    throw error;
  }
}
