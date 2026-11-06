import { spawn, ChildProcess } from 'node:child_process';
import { createServer, Server, Socket } from 'node:net';
import { chmod, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { GitClonePrompts, GitCloneProgress, GitPrompt, parseGitProgress, parseGitPrompt, parseGitRepositoryUrl, stripTerminalSequences } from './gitClone';
import { normalizeLocalPath } from './model';

export const ASKPASS_PIPE_ENV = 'SSH_WORKSPACE_MANAGER_ASKPASS_PIPE';

function aborted(): Error { return new Error('克隆已取消。'); }

function quotePosix(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

function quoteWindows(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function askpassCommand(helperPath: string): string {
  const quote = process.platform === 'win32' ? quoteWindows : quotePosix;
  return `${quote(process.execPath)} ${quote(helperPath)}`;
}

function localDestination(parentPath: string, name: string): string {
  if (process.platform === 'win32' && (/[<>:"|?*]/.test(name) || /[ .]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) {
    throw new Error('仓库名不是有效的 Windows 文件夹名称。');
  }
  const parent = normalizeLocalPath(parentPath);
  const destination = path.join(parent, name);
  if (path.dirname(destination) !== parent) throw new Error('仓库名不能作为本地文件夹名称。');
  return destination;
}

export class LocalGitAskPassBridge {
  readonly endpoint: string;
  private readonly clients = new Set<Socket>();
  private readonly server: Server;
  private listening = false;
  private closing?: Promise<void>;

  constructor(private readonly handlePrompt: (prompt: string) => Promise<string | undefined>) {
    this.endpoint = process.platform === 'win32'
      ? `\\\\.\\pipe\\ssh-workspace-manager-${process.pid}-${randomUUID()}`
      : path.join(tmpdir(), `swm-${randomUUID()}.sock`);
    this.server = createServer(socket => this.accept(socket));
  }

  async listen(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.server.once('error', onError);
        this.server.listen(this.endpoint, () => {
          this.server.removeListener('error', onError);
          this.listening = true;
          resolve();
        });
      });
      if (process.platform !== 'win32') await chmod(this.endpoint, 0o600);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private accept(socket: Socket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      buffer += chunk;
      if (buffer.length > 8192) { socket.destroy(); return; }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      try {
        const request = JSON.parse(buffer.slice(0, newline)) as { prompt?: unknown };
        if (typeof request.prompt !== 'string') { socket.end('{"cancel":true}\n'); return; }
        void this.handlePrompt(request.prompt).then(value => {
          if (!socket.destroyed) socket.end(`${JSON.stringify(value === undefined ? { cancel: true } : { value })}\n`);
        }, () => {
          if (!socket.destroyed) socket.end('{"cancel":true}\n');
        });
      } catch {
        socket.end('{"cancel":true}\n');
      }
    });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      for (const client of this.clients) client.destroy();
      if (this.listening) {
        await new Promise<void>(resolve => this.server.close(() => resolve()));
        this.listening = false;
      }
      if (process.platform !== 'win32') await rm(this.endpoint, { force: true }).catch(() => {});
    })();
    return this.closing;
  }
}

function promptError(prompt: GitPrompt, host: string): Error {
  if (prompt.type === 'unknown-host') return new Error(`Git 服务器 ${host} 尚未加入本机 known_hosts。请先核对指纹并建立信任，再重试。`);
  return new Error('Git 请求了暂不支持的认证方式；请检查地址，或使用 SSH key/agent / HTTPS 访问令牌。');
}

function localFailure(output: string, protocol: 'ssh' | 'https', host: string): Error {
  const text = stripTerminalSequences(output).toLowerCase();
  if (/destination path .* already exists|already exists and is not an empty directory/.test(text)) {
    return new Error('目标仓库目录已存在。请选择其他父目录，或先处理已有目录。');
  }
  if (/host key verification failed|authenticity of host/.test(text)) {
    return new Error(`Git 服务器 ${host} 的主机密钥未通过本机 known_hosts 校验。请核对指纹后再连接。`);
  }
  if (/permission denied \((?:publickey|password)(?:,[^)]+)*\)|could not read from remote repository/.test(text)) {
    return new Error(`无法通过 SSH 访问 Git 仓库 ${host}。请检查本机 key/agent 或 SSH 账号密码，也可改用 HTTPS 地址。`);
  }
  if (/authentication failed|invalid username or password|terminal prompts disabled/.test(text)) {
    return new Error(protocol === 'https' ? 'Git HTTPS 认证失败，请检查用户名和访问令牌后重试。' : `Git SSH 认证失败，请检查本机 key/agent（${host}）。`);
  }
  return new Error('Git 克隆失败。请检查仓库地址、访问权限、本机网络和目标目录权限。');
}

export async function cloneLocalRepository(parentPath: string, repositoryUrl: string, helperPath: string,
  prompts: GitClonePrompts, signal: AbortSignal, onProgress: (progress: GitCloneProgress) => void): Promise<string> {
  if (signal.aborted) throw aborted();
  const repository = parseGitRepositoryUrl(repositoryUrl);
  const parent = normalizeLocalPath(parentPath);
  const parentStat = await stat(parent).catch(() => undefined);
  if (!parentStat?.isDirectory()) throw new Error('请选择仍然存在的本机父文件夹。');
  const destination = localDestination(parent, repository.name);
  let child: ChildProcess | undefined;
  let cancelTimer: NodeJS.Timeout | undefined;
  let promptFailure: Error | undefined;
  let promptCancelled = false;
  let username = '';
  let output = '';
  let progressBuffer = '';
  let settled = false;
  const sensitiveValues: string[] = [];
  const emitProgress = (progress: GitCloneProgress) => {
    try { onProgress(progress); } catch { /* Progress rendering must not interrupt the local operation. */ }
  };
  const handlePrompt = async (promptText: string): Promise<string | undefined> => {
    const prompt = parseGitPrompt(promptText, repository.protocol);
    if (!prompt) {
      promptFailure = new Error('Git 请求了暂不支持的认证方式；请检查地址或认证配置。');
      return undefined;
    }
    if (prompt.type === 'unknown-host') {
      promptFailure = promptError(prompt, repository.host);
      return undefined;
    }
    try {
      let value: string | undefined;
      if (prompt.type === 'username') {
        value = await prompts.username(prompt.target);
        if (value !== undefined) username = value;
      } else if (prompt.type === 'password') {
        const targetUser = /https?:\/\/([^@/]+)@/i.exec(prompt.target)?.[1] || username;
        value = await prompts.password(prompt.target, targetUser);
      } else if (prompt.type === 'ssh-password') value = await prompts.sshPassword(prompt.target, prompt.username);
      else value = await prompts.passphrase(prompt.keyPath);
      if (signal.aborted) return undefined;
      if (value === undefined) promptCancelled = true;
      else sensitiveValues.push(value);
      return value;
    } catch {
      promptFailure = new Error('Git 凭据输入失败或已取消。');
      return undefined;
    }
  };
  const interactiveBridge = new LocalGitAskPassBridge(handlePrompt);
  await interactiveBridge.listen();
  if (signal.aborted) { await interactiveBridge.close(); throw aborted(); }

  return new Promise<string>((resolve, reject) => {
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      clearTimeout(cancelTimer);
      const safeOutput = sensitiveValues.filter(Boolean).reduce((text, value) => text.replaceAll(value, '[redacted]'), output);
      sensitiveValues.fill('');
      void interactiveBridge.close().finally(() => {
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(localFailure(safeOutput, repository.protocol, repository.host));
      });
    };
    const terminate = () => {
      if (!child || child.killed || !child.pid) return;
      if (process.platform === 'win32') {
        child.kill();
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => {});
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        cancelTimer = setTimeout(() => { try { process.kill(-child!.pid!, 'SIGKILL'); } catch { child?.kill('SIGKILL'); } }, 1500);
        cancelTimer.unref();
      }
    };
    const abort = () => terminate();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); }
    emitProgress({ phase: 'starting', message: '正在本机启动 Git…' });
    if (signal.aborted) { finish(aborted()); return; }
    try {
      const command = 'git';
      const commandText = askpassCommand(path.resolve(helperPath));
      const sshAskpass = path.join(path.dirname(path.resolve(helperPath)), process.platform === 'win32' ? 'git-askpass.cmd' : 'git-askpass.sh');
      child = spawn(command, ['-c', 'credential.helper=', 'clone', '--progress', '--', repository.url, destination], {
        cwd: parent, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: commandText, SSH_ASKPASS: sshAskpass,
          SSH_WORKSPACE_MANAGER_ASKPASS_NODE: process.execPath, SSH_WORKSPACE_MANAGER_ASKPASS_HELPER: path.resolve(helperPath),
          SSH_ASKPASS_REQUIRE: 'force', ELECTRON_RUN_AS_NODE: '1', [ASKPASS_PIPE_ENV]: interactiveBridge.endpoint }
      });
      const consume = (chunk: Buffer | string) => {
        const text = stripTerminalSequences(chunk.toString()).replace(/\u0000/g, '');
        output = (output + text).slice(-16000);
        progressBuffer += text;
        const lines = progressBuffer.split(/[\r\n]+/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const progress = parseGitProgress(line);
          if (progress) emitProgress(progress);
        }
      };
      child.stdout?.on('data', consume);
      child.stderr?.on('data', consume);
      child.on('error', error => {
        const code = (error as NodeJS.ErrnoException).code;
        finish(new Error(code === 'ENOENT' ? '本机未找到 Git，请先安装 Git 并确保它在 PATH 中。' : '无法启动本机 Git 命令。'));
      });
      child.on('close', code => {
        if (code === 0) {
          emitProgress({ phase: 'complete', message: 'Git 仓库已克隆到本机。', percent: 100 });
          finish(undefined, destination);
        } else if (signal.aborted) finish(aborted());
        else if (promptFailure) finish(promptFailure);
        else if (promptCancelled) finish(new Error('Git 凭据输入已取消。'));
        else finish();
      });
    } catch {
      finish(new Error('无法启动本机 Git 命令。'));
    }
  });
}
