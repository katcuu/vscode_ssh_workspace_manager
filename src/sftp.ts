import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { Client, SFTPWrapper, utils, AuthenticationType } from 'ssh2';
import { normalizeRemotePath, RemoteEntry } from './model';
import { ResolvedSshConfig } from './sshConfig';
import { fingerprint, keyAlgorithm, readHostTrust } from './trust';
import { SshDiagnostics, SshStage } from './sshDiagnostics';

export interface ConnectionPrompts {
  password(alias: string): Promise<string | undefined>;
  passphrase(file: string): Promise<string | undefined>;
  trustHost(alias: string, algorithm: string, fingerprint: string): Promise<boolean>;
}

function aborted(): Error { return new Error('连接已取消。'); }

function sftpError(error: Error & { code?: number }, diagnostics: SshDiagnostics): Error {
  diagnostics.event('directory', 'failed', {}, error);
  if (error.code === 2) return new Error('远程路径不存在。', { cause: error });
  if (error.code === 3) return new Error('没有权限读取此远程目录。', { cause: error });
  return new Error('无法读取远程目录，连接可能已断开或服务器未启用 SFTP。', { cause: error });
}

function timeout<T>(operation: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout(); reject(new Error('远程目录请求超时，请重新连接。')); }, ms);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export class SftpSession {
  private closed = false;
  private idleTimer?: NodeJS.Timeout;

  constructor(private client: Client, private sftp: SFTPWrapper, private diagnostics = new SshDiagnostics()) {
    client.on('close', () => { this.closed = true; clearTimeout(this.idleTimer); });
    this.touch();
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), 5 * 60 * 1000);
    this.idleTimer.unref();
  }

  get available(): boolean { return !this.closed; }

  async homeDirectory(): Promise<string> {
    this.diagnostics.event('directory', 'realpath');
    return timeout(new Promise((resolve, reject) => this.sftp.realpath('.', (error, path) => {
      if (error) reject(sftpError(error, this.diagnostics)); else resolve(normalizeRemotePath(path));
    })), 20000, () => this.close());
  }

  async isDirectory(path: string): Promise<boolean> {
    if (this.closed) throw new Error('后台浏览连接已关闭，请重新连接。');
    return timeout(new Promise((resolve, reject) => this.sftp.stat(normalizeRemotePath(path), (error, stats) => {
      if (error) reject(sftpError(error, this.diagnostics)); else resolve(stats.isDirectory());
    })), 20000, () => this.close());
  }

  async listDirectories(path: string): Promise<RemoteEntry[]> {
    if (this.closed) throw new Error('后台浏览连接已关闭，请重新连接。');
    this.touch();
    this.diagnostics.event('directory', 'readdir');
    const directory = normalizeRemotePath(path);
    if (!await this.isDirectory(directory)) throw new Error('此路径不是文件夹。');
    const entries = await timeout(new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => {
      this.sftp.readdir(directory, (error, list) => error ? reject(sftpError(error, this.diagnostics)) : resolve(list));
    }), 20000, () => this.close());
    const result: RemoteEntry[] = [];
    const symlinks: import('ssh2').FileEntryWithStats[] = [];
    for (const entry of entries) {
      if (!entry.filename || entry.filename === '.' || entry.filename === '..' || /[\x00-\x1f\x7f/]/.test(entry.filename)) continue;
      if (entry.attrs.isDirectory()) result.push({ name: entry.filename, path: posix.join(directory, entry.filename), symlink: false });
      else if (entry.attrs.isSymbolicLink()) symlinks.push(entry);
    }
    // Resolve only link types, with a small concurrency limit; inaccessible links are omitted.
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, symlinks.length) }, async () => {
      while (index < symlinks.length) {
        const entry = symlinks[index++];
        const path = posix.join(directory, entry.filename);
        if (await this.isDirectory(path).catch(() => false)) result.push({ name: entry.filename, path, symlink: true });
      }
    }));
    this.diagnostics.event('directory', 'listed', { directories: result.length });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.client.destroy();
  }
}

export async function connectSftp(config: ResolvedSshConfig, prompts: ConnectionPrompts, signal: AbortSignal, diagnostics = new SshDiagnostics()): Promise<SftpSession> {
  if (signal.aborted) throw aborted();
  const client = new Client();
  const tried = new Set<string>();
  const usedKeys: Buffer[] = [];
  let customError: Error | undefined;
  let authenticationExhausted = false;
  let agentAwaitingFallback = false;
  let password: string | undefined;
  let settled = false;
  let stage: SshStage = 'tcp';

  const nextAuthentication = async (methods: AuthenticationType[] | null): Promise<unknown> => {
    if (signal.aborted || settled) return false;
    if (agentAwaitingFallback) {
      agentAwaitingFallback = false;
      diagnostics.event('agent', 'no-usable-key-continuing-authentication');
    }
    if (!tried.has('none')) { tried.add('none'); return { type: 'none', username: config.username }; }
    const publicKeyAllowed = config.publicKeyAuthentication && (!methods || methods.includes('publickey'));
    if (publicKeyAllowed && config.identityAgent && !config.identitiesOnly && !tried.has('agent')) {
      tried.add('agent');
      stage = 'agent'; diagnostics.event(stage, 'attempt');
      agentAwaitingFallback = true;
      return { type: 'agent', username: config.username, agent: config.identityAgent };
    }
    if (publicKeyAllowed) for (const file of config.identityFiles) {
      if (tried.has(file)) continue;
      tried.add(file);
      let raw: Buffer;
      stage = 'key'; diagnostics.event(stage, 'read', { file });
      try { raw = await readFile(file); }
      catch (error) { diagnostics.event(stage, 'unavailable', { file }, error); continue; }
      if (signal.aborted || settled) { raw.fill(0); return false; }
      usedKeys.push(raw);
      let parsed = utils.parseKey(raw);
      let passphrase: string | undefined;
      if (parsed instanceof Error && /encrypted|passphrase/i.test(parsed.message)) {
        diagnostics.event(stage, 'passphrase-required', { file });
        passphrase = await prompts.passphrase(file);
        if (signal.aborted || settled) return false;
        if (passphrase === undefined) continue;
        diagnostics.secret(passphrase);
        parsed = utils.parseKey(raw, passphrase);
        passphrase = undefined;
      }
      if (parsed instanceof Error) { diagnostics.event(stage, 'invalid', { file }, parsed); continue; }
      diagnostics.event(stage, 'attempt', { file });
      return { type: 'publickey', username: config.username, key: Array.isArray(parsed) ? parsed[0] : parsed };
    }
    if (config.passwordAuthentication && methods?.includes('password') && !tried.has('password')) {
      tried.add('password');
      stage = 'password'; diagnostics.event(stage, 'prompt');
      password = await prompts.password(config.alias);
      if (signal.aborted || settled || password === undefined) { customError = aborted(); return false; }
      diagnostics.secret(password);
      diagnostics.event(stage, 'attempt');
      const auth = { type: 'password', username: config.username, password };
      password = undefined;
      return auth;
    }
    authenticationExhausted = true;
    return false;
  };

  return new Promise<SftpSession>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', cancel);
      password = undefined;
      diagnostics.clearSecrets();
      for (const key of usedKeys) key.fill(0);
      usedKeys.length = 0;
    };
    const fail = (error: Error) => {
      if (settled) return;
      diagnostics.event(stage, 'failed', {}, error);
      settled = true; cleanup(); client.destroy(); reject(error);
    };
    const cancel = () => fail(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    client.on('connect', () => { diagnostics.event('tcp', 'connected'); stage = 'handshake'; diagnostics.event(stage, 'started'); });
    client.on('handshake', () => diagnostics.event('handshake', 'completed'));
    client.on('error', (error: Error & { level?: string; code?: string }) => {
      // ssh2 reports agent transport/signing failures before advancing authHandler itself.
      // They are recoverable on this same SSH connection; destroying it prevents key/password fallback.
      if (error.level === 'agent' && !settled && !signal.aborted) {
        diagnostics.event('agent', 'unavailable-continuing-authentication', {}, error);
        return;
      }
      diagnostics.event(stage, 'client-error', {}, error);
      const message = customError || (authenticationExhausted || error.level === 'client-authentication'
        ? new Error('SSH 认证失败。请确认密钥、agent 或密码；后台浏览暂不支持交互式多因素认证。', { cause: error })
        : new Error(error.level === 'client-dns' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? 'SSH 主机名解析失败，请检查服务器地址。'
          : error.code === 'ECONNREFUSED' ? 'SSH 连接被拒绝，请检查端口和服务器 SSH 服务。'
          : error.code === 'ETIMEDOUT' || error.level === 'client-timeout' ? 'SSH 连接或握手超时，请检查网络，或重试认证。'
          : stage === 'tcp' ? '无法建立 SSH 网络连接，请检查地址、端口和网络；可在“SSH Manager”输出中查看诊断。'
          : 'SSH 握手或连接中断；可在“SSH Manager”输出中查看诊断。', { cause: error }));
      fail(message);
    });
    client.on('close', () => { if (!settled) fail(customError || new Error('SSH 连接已关闭。')); });
    client.on('ready', () => {
      if (settled) return;
      stage = 'sftp'; diagnostics.event(stage, 'initializing');
      client.sftp((error, sftp) => {
        if (settled) return;
        if (error) { fail(new Error('服务器未提供可用的 SFTP 子系统，请使用 Remote SSH 打开。', { cause: error })); return; }
        diagnostics.event(stage, 'ready');
        settled = true; cleanup(); resolve(new SftpSession(client, sftp, diagnostics));
      });
    });
    try {
      diagnostics.event('tcp', 'connecting');
      client.connect({
        host: config.host, port: config.port, username: config.username,
        readyTimeout: 120000, keepaliveInterval: 15000, keepaliveCountMax: 2,
        hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
          void (async () => {
            stage = 'trust'; diagnostics.event(stage, 'checking-known-hosts');
            const trust = await readHostTrust(config, key);
            diagnostics.event(stage, trust);
            if (signal.aborted || settled) { verify(false); return; }
            if (trust === 'known') { stage = 'handshake'; verify(true); return; }
            if (trust === 'changed' || trust === 'revoked' || trust === 'certificate') {
              customError = new Error(trust === 'changed' ? '服务器主机密钥与 known_hosts 不一致，已停止连接。请先通过 Remote SSH 核实。'
                : trust === 'revoked' ? '服务器主机密钥已被撤销，已停止连接。' : '后台浏览暂不支持 SSH 主机证书，请使用 Remote SSH。');
              verify(false); return;
            }
            const accepted = await prompts.trustHost(config.alias, keyAlgorithm(key), fingerprint(key));
            diagnostics.event('trust', accepted ? 'accepted-once' : 'declined');
            if (!accepted || signal.aborted || settled) customError = new Error('未信任此服务器的主机指纹，连接已取消。');
            else stage = 'handshake';
            verify(accepted && !signal.aborted && !settled);
          })().catch(error => { diagnostics.event('trust', 'failed', {}, error); customError = new Error('服务器主机指纹校验失败。', { cause: error }); verify(false); });
        },
        authHandler: (methods, _partial, callback) => {
          void nextAuthentication(methods).then(auth => { if (!settled) callback(auth as Parameters<typeof callback>[0]); })
            .catch(error => { if (settled) return; diagnostics.event(stage, 'credentials-failed', {}, error); customError = new Error('认证已取消或无法读取认证信息。'); callback(false as unknown as Parameters<typeof callback>[0]); });
        }
      });
    } catch (error) { fail(new Error('SSH 连接配置无法用于后台浏览，请使用 Remote SSH 打开。', { cause: error })); }
  });
}
