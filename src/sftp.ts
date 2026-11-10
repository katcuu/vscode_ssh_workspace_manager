import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { Client, SFTPWrapper, utils, AuthenticationType } from 'ssh2';
import { normalizeRemotePath, RemoteEntry } from './model';
import { ResolvedSshConfig } from './sshConfig';
import { fingerprint, keyAlgorithm, readHostTrust } from './trust';
import { SshDiagnostics, SshStage } from './sshDiagnostics';
import { GitClonePrompts, GitCloneProgress, GitRepository, gitCloneCommand, gitCloneDestination, parseGitProgress, parseGitPrompt, parseGitRepositoryUrl, stripTerminalSequences } from './gitClone';

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

function sftpDeleteError(error: Error & { code?: number }, diagnostics: SshDiagnostics): Error {
  diagnostics.event('directory', 'delete-failed', {}, error);
  if (error.code === 2) return new Error('远程路径不存在或已被移除。', { cause: error });
  if (error.code === 3) return new Error('没有权限删除此远程文件夹。', { cause: error });
  return new Error('无法删除远程文件夹，请检查服务器连接和目录权限。', { cause: error });
}

function isMissingPath(error: unknown): boolean {
  for (let depth = 0; depth < 5 && error && typeof error === 'object'; depth++) {
    const detail = error as { code?: unknown; cause?: unknown };
    if (detail.code === 2 || detail.code === 'ENOENT') return true;
    error = detail.cause;
  }
  return false;
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
  private activeCommands = 0;

  constructor(private client: Client, private sftp: SFTPWrapper, private diagnostics = new SshDiagnostics()) {
    client.on('close', () => { this.closed = true; clearTimeout(this.idleTimer); });
    this.touch();
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    if (this.activeCommands) return;
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
    if (!await this.isDirectory(directory)) throw Object.assign(new Error('此路径不是文件夹。'), { code: 'ENOTDIR' });
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

  async createDirectory(path: string): Promise<void> {
    if (this.closed) throw new Error('后台浏览连接已关闭，请重新连接。');
    const directory = normalizeRemotePath(path);
    if (directory === '/') throw new Error('根目录已存在，请输入子文件夹名称。');
    this.touch();
    this.diagnostics.event('directory', 'mkdir');
    await timeout(new Promise<void>((resolve, reject) => {
      this.sftp.mkdir(directory, error => {
        if (!error) { resolve(); return; }
        this.diagnostics.event('directory', 'mkdir-failed', {}, error);
        const code = (error as Error & { code?: number }).code;
        reject(new Error(code === 3 ? '没有权限在此路径下新建文件夹。'
          : code === 2 ? '父文件夹已不存在，请刷新目录后重试。'
            : '无法新建文件夹，名称可能已存在；请刷新并检查连接和目录权限。', { cause: error }));
      });
    }), 20000, () => this.close());
  }

  async deleteDirectory(path: string, onProgress: (deleted: number, currentPath: string) => void = () => {}): Promise<number> {
    if (this.closed) throw new Error('后台浏览连接已关闭，请重新连接。');
    const directory = normalizeRemotePath(path);
    if (directory === '/') throw new Error('为保护服务器，不能删除根目录。');
    let deleted = 0;

    const request = <T>(operation: (callback: (error: (Error & { code?: number }) | null | undefined, value?: T) => void) => void) =>
      timeout(new Promise<T>((resolve, reject) => operation((error, value) => {
        if (error) reject(sftpDeleteError(error, this.diagnostics)); else resolve(value as T);
      })), 20000, () => this.close());

    const remove = async (currentPath: string, target = false): Promise<void> => {
      this.touch();
      let stats: import('ssh2').Stats;
      try { stats = await request<import('ssh2').Stats>(callback => this.sftp.lstat(currentPath, callback)); }
      catch (error) { if (isMissingPath(error)) return; throw error; }

      if (target && !stats.isDirectory() && !stats.isSymbolicLink()) {
        throw new Error('此路径已不是文件夹，未删除实际文件。请仅删除项目记录，或先检查服务器上的路径。');
      }
      if (stats.isDirectory()) {
        let entries: import('ssh2').FileEntryWithStats[];
        try { entries = await request<import('ssh2').FileEntryWithStats[]>(callback => this.sftp.readdir(currentPath, callback)); }
        catch (error) { if (isMissingPath(error)) return; throw error; }
        for (const entry of entries) {
          if (!entry.filename || entry.filename === '.' || entry.filename === '..' || /[\x00-\x1f\x7f/]/.test(entry.filename)) {
            throw new Error('服务器返回了无效的目录项，已停止删除以保护其他路径。');
          }
          await remove(posix.join(currentPath, entry.filename));
        }
        try { await request<void>(callback => this.sftp.rmdir(currentPath, callback)); }
        catch (error) { if (!isMissingPath(error)) throw error; }
      } else {
        try { await request<void>(callback => this.sftp.unlink(currentPath, callback)); }
        catch (error) { if (!isMissingPath(error)) throw error; }
      }
      deleted += 1;
      onProgress(deleted, currentPath);
      this.touch();
    };

    this.diagnostics.event('directory', 'delete-started');
    await remove(directory, true);
    this.diagnostics.event('directory', 'delete-completed', { entries: deleted });
    return deleted;
  }

  async cloneRepository(parentPath: string, repositoryUrl: string, prompts: GitClonePrompts, signal: AbortSignal,
    onProgress: (progress: GitCloneProgress) => void): Promise<string> {
    if (this.closed) throw new Error('后台 SSH 连接已关闭，请重新连接后再克隆。');
    if (signal.aborted) throw aborted();
    const repository = parseGitRepositoryUrl(repositoryUrl);
    const destination = gitCloneDestination(parentPath, repository);
    const releaseCommand = () => {
      this.activeCommands = Math.max(0, this.activeCommands - 1);
      this.touch();
    };
    this.activeCommands += 1;
    clearTimeout(this.idleTimer);

    return new Promise<string>((resolve, reject) => {
      let channel: import('ssh2').ClientChannel | undefined;
      let settled = false;
      let cancelTimer: NodeJS.Timeout | undefined;
      let cancelError: Error | undefined;
      let promptActive = false;
      let username = '';
      let exitCode: number | undefined;
      let promptBuffer = '';
      let progressBuffer = '';
      let output = '';

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        clearTimeout(cancelTimer);
        releaseCommand();
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve(destination);
      };
      const emitProgress = (progress: GitCloneProgress) => {
        try { onProgress(progress); } catch { /* Progress rendering must not interrupt the remote operation. */ }
      };
      const interrupt = (error: Error) => {
        if (settled || cancelError) return;
        cancelError = error;
        if (!channel) { finish(error); return; }
        try { channel.write('\x03'); channel.signal('INT'); } catch { /* The channel may already be closing. */ }
        cancelTimer = setTimeout(() => { channel?.destroy(); finish(error); }, 1500);
        cancelTimer.unref();
      };
      const onAbort = () => interrupt(aborted());
      signal.addEventListener('abort', onAbort, { once: true });

      const handlePrompt = async (prompt: NonNullable<ReturnType<typeof parseGitPrompt>>) => {
        if (prompt.type === 'unknown-host') {
          try { channel?.write('no\n'); } catch { /* The remote prompt may already be closed. */ }
          interrupt(new Error(`Git 服务器 ${repository.host} 的主机密钥尚未被服务器信任。请先在 Linux 服务器上核对指纹并建立信任后重试。`));
          return;
        }
        promptActive = true;
        try {
          let value: string | undefined;
          if (prompt.type === 'username') {
            value = await prompts.username(prompt.target);
            if (value !== undefined) username = value;
          } else if (prompt.type === 'password') {
            const targetUser = /https?:\/\/([^@/]+)@/i.exec(prompt.target)?.[1] || username;
            value = await prompts.password(prompt.target, targetUser);
          } else if (prompt.type === 'ssh-password') {
            value = await prompts.sshPassword(prompt.target, prompt.username);
          } else value = await prompts.passphrase(prompt.keyPath);
          if (signal.aborted || cancelError) return;
          if (value === undefined) { interrupt(new Error('Git 凭据输入已取消。')); return; }
          channel?.write(`${value}\n`);
          value = undefined;
          promptBuffer = '';
        } catch {
          interrupt(new Error('Git 凭据输入失败或已取消。'));
        } finally { promptActive = false; }
      };

      const consume = (chunk: Buffer | string) => {
        const text = stripTerminalSequences(chunk.toString()).replace(/\u0000/g, '');
        output = (output + text).slice(-12000);
        progressBuffer += text;
        const lines = progressBuffer.split(/[\r\n]+/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const progress = parseGitProgress(line);
          if (progress) emitProgress(progress);
        }
        if (!promptActive && !cancelError) {
          promptBuffer = (promptBuffer + text).slice(-8192);
          const prompt = parseGitPrompt(promptBuffer, repository.protocol);
          if (prompt) {
            promptBuffer = '';
            void handlePrompt(prompt);
          }
        }
      };

      emitProgress({ phase: 'starting', message: '正在服务器上启动 Git…' });
      try {
        this.client.exec(gitCloneCommand(repository.url, destination), {
          pty: { term: 'xterm', cols: 120, rows: 40, modes: { ECHO: 0 } }
        }, (error, stream) => {
          if (error || !stream) {
            if (!settled) finish(new Error('无法在服务器上启动 Git 命令；请确认服务器允许 SSH 命令执行。'));
            return;
          }
          channel = stream;
          if (settled || signal.aborted || cancelError) {
            try { stream.write('\x03'); stream.signal('INT'); stream.destroy(); } catch { /* The channel may already be closing. */ }
            if (!settled) onAbort();
            return;
          }
          emitProgress({ phase: 'starting', message: '正在连接 Git 仓库；可输入凭据或取消。' });
          stream.on('data', consume);
          stream.stderr.on('data', consume);
          stream.on('exit', (code) => { exitCode = typeof code === 'number' ? code : undefined; });
          stream.on('error', () => finish(cancelError || new Error('Git 命令通道中断。')));
          stream.on('close', () => {
            if (cancelError) { finish(cancelError); return; }
            if (exitCode === 0) {
              emitProgress({ phase: 'complete', message: 'Git 仓库已拉取完成。', percent: 100 });
              finish();
            } else finish(this.cloneFailure(output, repository.protocol, repository.host));
          });
        });
      } catch {
        finish(new Error('无法在服务器上启动 Git 命令；请确认服务器允许 SSH 命令执行。'));
      }
    });
  }

  private cloneFailure(output: string, protocol: GitRepository['protocol'], host: string): Error {
    const text = stripTerminalSequences(output).toLowerCase();
    if (/command not found|git: not found|git: command not found/.test(text)) return new Error('Linux 服务器未安装 Git。');
    if (/destination path .* already exists|already exists and is not an empty directory/.test(text)) {
      return new Error('目标仓库目录已存在。请选择其他父目录，或先在服务器上处理已有目录。');
    }
    if (/permission denied \((?:publickey|password)(?:,[^)]+)*\)|could not read from remote repository/.test(text)) {
      return new Error(`无法通过 SSH 访问 Git 仓库 ${host}。请检查 Linux 服务器上的 key/agent 或 SSH 账号密码；也可改用 HTTPS 地址并输入令牌。`);
    }
    if (/authentication failed|invalid username or password|terminal prompts disabled/.test(text)) {
      return new Error(protocol !== 'ssh' ? `Git ${protocol.toUpperCase()} 认证失败，请检查用户名和密码 / 访问令牌后重试。` : 'Git SSH 认证失败，请检查 Linux 服务器上的 key/agent。');
    }
    if (/host key verification failed|authenticity of host/.test(text)) {
      return new Error(`Git 服务器 ${host} 的主机密钥校验失败。请在 Linux 服务器上核验并配置 known_hosts 后重试。`);
    }
    return new Error('Git 克隆失败。请检查仓库地址、访问权限、服务器网络和目标目录权限。');
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
