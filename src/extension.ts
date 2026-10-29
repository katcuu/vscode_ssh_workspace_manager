import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { watch, FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { aliasForAuthority, authorityForAlias, hideServer, makeFolder, normalizeRemotePath, RemoteEntry, restoreServer, ServerInfo, validAlias, validateCatalog, visibleServers } from './model';
import { expandHome, readHostAliases, resolveSshConfig } from './sshConfig';
import { addSshHost } from './sshConfigWriter';
import { ServerItem, ServerTree } from './serverTree';
import { CatalogStore } from './store';
import { connectSftp, SftpSession } from './sftp';

let manager: WorkspaceManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  manager = new WorkspaceManager(context);
  context.subscriptions.push(manager,
    vscode.commands.registerCommand('sshWorkspaceManager.openDashboard', () => manager?.show()),
    vscode.commands.registerCommand('sshWorkspaceManager.saveCurrentFolders', () => manager?.recordCurrentFolders(true)),
    ...(['addServer', 'removeServer', 'refreshServers', 'editConfig', 'selectServer'] as const).map(command =>
      vscode.commands.registerCommand(`sshWorkspaceManager.${command}`, (item?: ServerItem) => manager?.runCommand(command, item))));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = '$(remote) SSH Manager';
  status.tooltip = '打开 SSH 文件夹管理页';
  status.command = 'sshWorkspaceManager.openDashboard';
  status.show();
  context.subscriptions.push(status);
  await manager.initialize();
}

export function deactivate(): void { manager?.dispose(); manager = undefined; }

class WorkspaceManager implements vscode.Disposable {
  private readonly store: CatalogStore;
  private panel?: vscode.WebviewPanel;
  private watcher?: FSWatcher;
  private debounce?: NodeJS.Timeout;
  private servers: ServerInfo[] = [];
  private configFile = '';
  private selectedAlias?: string;
  private selectionInitialized = false;
  private snapshotSequence = 0;
  private readonly tree = new ServerTree();
  private readonly view: vscode.TreeView<ServerItem>;
  private initialized = false;
  private session?: SftpSession;
  private connection?: AbortController;
  private generation = 0;
  private requestSequence = 0;
  private lastBrowsePath?: string;
  private subscriptions: vscode.Disposable[] = [];
  private disposed = false;

  constructor(private context: vscode.ExtensionContext) {
    this.store = new CatalogStore(context.globalStorageUri.fsPath);
    this.view = vscode.window.createTreeView('sshWorkspaceManager.launcher', { treeDataProvider: this.tree, showCollapseAll: false });
    this.subscriptions.push(this.view, this.tree, this.view.onDidChangeVisibility(event => {
      if (event.visible && this.initialized) void this.show(true).catch(error => this.report(error));
    }));
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(path.dirname(this.store.file), { recursive: true });
      await this.migrateLocalBuild();
      await this.recordCurrentFolders(false);
      await this.snapshot();
      this.watchStore();
    } catch (error) { this.report(error); }
    this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void this.recordCurrentFolders(false).catch(error => this.report(error));
    }), vscode.window.onDidChangeWindowState(state => {
      if (state.focused) void this.snapshot().catch(error => this.report(error));
    }), vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('remote.SSH.configFile')) void this.snapshot().catch(error => this.report(error));
    }));
    this.initialized = true;
    if (this.view.visible) await this.show(true);
  }

  private async migrateLocalBuild(): Promise<void> {
    if (this.context.extension.id === 'local-dev.ssh-workspace-manager') return;
    const legacyFile = path.join(path.dirname(this.context.globalStorageUri.fsPath), 'local-dev.ssh-workspace-manager', 'catalog.json');
    let legacy;
    try { legacy = validateCatalog(JSON.parse(await readFile(legacyFile, 'utf8'))); }
    catch { return; }
    if ((await this.store.read()).revision !== 0) return;
    await this.store.update(data => {
      if (data.revision === 0) Object.assign(data, legacy);
    });
  }

  private watchStore(): void {
    if (this.watcher || this.disposed) return;
    try {
      this.watcher = watch(path.dirname(this.store.file), () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { void this.snapshot().catch(error => this.report(error)); }, 300);
      });
    } catch { /* The directory is created on the first persisted operation. */ }
  }

  private configPath(): string {
    const remote = vscode.workspace.getConfiguration('remote.SSH').get<string>('configFile', '').trim();
    return expandHome(remote || path.join(homedir(), '.ssh', 'config'));
  }

  private async snapshot(): Promise<void> {
    const sequence = ++this.snapshotSequence;
    const data = await this.store.read();
    this.configFile = this.configPath();
    const aliases = await readHostAliases(this.configFile);
    if (sequence !== this.snapshotSequence || this.disposed) return;
    this.servers = visibleServers(data, aliases);
    this.tree.update(this.servers);
    this.view.message = this.servers.length ? undefined : '点击 + 添加服务器，或导入 SSH 配置。';
    const current = this.currentRemote();
    if (!this.selectionInitialized) {
      this.selectedAlias = this.servers.some(server => server.alias === current?.alias) ? current?.alias : this.servers[0]?.alias;
      this.selectionInitialized = true;
      this.lastBrowsePath = this.selectedAlias ? (Object.hasOwn(data.browsePaths, this.selectedAlias) ? data.browsePaths[this.selectedAlias] : undefined)
        || (current?.alias === this.selectedAlias ? current.path : undefined) : undefined;
    } else if (this.selectedAlias && !this.servers.some(server => server.alias === this.selectedAlias)) {
      this.disconnect(); this.selectedAlias = undefined; this.lastBrowsePath = undefined;
    }
    this.post({ type: 'snapshot', servers: this.servers,
      folders: data.folders.filter(folder => !data.hiddenServers.includes(folder.alias)),
      browsePaths: data.browsePaths, selectedAlias: this.selectedAlias, initialPath: this.lastBrowsePath || '',
      recording: vscode.workspace.getConfiguration('sshWorkspaceManager').get('recordFolders', true) });
    const item = this.tree.find(this.selectedAlias);
    if (this.view.visible && item) await this.view.reveal(item, { select: true, focus: false });
  }

  async show(preserveFocus = false): Promise<void> {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Active, preserveFocus); return; }
    const panel = this.panel = vscode.window.createWebviewPanel('sshWorkspaceManager', 'SSH Workspace Manager', { viewColumn: vscode.ViewColumn.Active, preserveFocus }, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    });
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'activity-bar.svg');
    const webview = panel.webview;
    panel.onDidDispose(() => { this.panel = undefined; this.disconnect(); });
    webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message).catch(error => this.report(error));
    });
    const nonce = randomBytes(18).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.css'));
    const template = await readFile(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.html').fsPath, 'utf8');
    if (this.panel !== panel) return;
    webview.html = template.replaceAll('{{cspSource}}', webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replace('{{script}}', script.toString()).replace('{{style}}', style.toString());
  }

  private post(message: unknown): void { void this.panel?.webview.postMessage(message); }

  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : '操作失败，请重试。';
    if (this.panel) this.post({ type: 'error', message });
    else void vscode.window.showErrorMessage(`SSH Manager: ${message}`);
  }

  private currentRemote(): { alias: string; authority: string; path: string } | undefined {
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const alias = folder.uri.scheme === 'vscode-remote' && aliasForAuthority(folder.uri.authority);
      if (alias) return { alias, authority: folder.uri.authority, path: folder.uri.path };
    }
    return undefined;
  }

  async recordCurrentFolders(manual: boolean): Promise<void> {
    if (!manual && !vscode.workspace.getConfiguration('sshWorkspaceManager').get('recordFolders', true)) return;
    const folders = (vscode.workspace.workspaceFolders || []).flatMap(folder => {
      const alias = folder.uri.scheme === 'vscode-remote' && aliasForAuthority(folder.uri.authority);
      return alias ? [makeFolder(alias, folder.uri.path, folder.uri.authority)] : [];
    });
    if (!folders.length) {
      if (manual) void vscode.window.showInformationMessage('当前窗口没有可记录的 SSH 工作区文件夹。');
      return;
    }
    let recorded = 0;
    await this.store.update(data => {
      for (const folder of folders) {
        if (data.hiddenServers.includes(folder.alias)) continue;
        recorded += 1;
        const existing = data.folders.find(value => value.id === folder.id);
        if (existing) existing.lastOpenedAt = Date.now();
        else data.folders.push({ ...folder, lastOpenedAt: Date.now() });
      }
    });
    this.watchStore();
    await this.snapshot();
    if (manual) void vscode.window.showInformationMessage(recorded ? `已记录 ${recorded} 个 SSH 文件夹。` : '当前服务器已从管理器删除，请先重新导入。');
  }

  private requireAlias(alias: unknown): string {
    if (!validAlias(alias) || !this.servers.some(server => server.alias === alias)) throw new Error('请先选择有效的 SSH 服务器。');
    return alias;
  }

  async runCommand(command: 'addServer' | 'removeServer' | 'refreshServers' | 'editConfig' | 'selectServer', item?: ServerItem): Promise<void> {
    try {
      switch (command) {
        case 'refreshServers': await this.snapshot(); return;
        case 'editConfig': {
          const uri = vscode.Uri.file(this.configPath());
          const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
          const document = exists ? await vscode.workspace.openTextDocument(uri)
            : await vscode.workspace.openTextDocument(uri.with({ scheme: 'untitled' }));
          await vscode.window.showTextDocument(document); return;
        }
        case 'selectServer': await this.selectServer(item?.alias); return;
        case 'addServer': await this.addServer(); return;
        case 'removeServer': {
          const alias = item?.alias || (await vscode.window.showQuickPick(this.servers.map(server => ({ label: server.label, alias: server.alias })), { title: '删除服务器' }))?.alias;
          if (!alias) return;
          this.requireAlias(alias);
          const answer = await vscode.window.showWarningMessage(`从管理器删除 ${alias}？`, { modal: true,
            detail: '该服务器将从列表隐藏，刷新后也不会重新出现。SSH 配置、已存的项目记录和远程文件均保留。可通过「新增服务器 → 从 SSH 配置导入」恢复。'
          }, '删除服务器');
          if (answer !== '删除服务器') return;
          await this.store.update(data => hideServer(data, alias));
          await this.snapshot(); return;
        }
      }
    } catch (error) { this.report(error); }
  }

  private async selectServer(value?: string): Promise<void> {
    const alias = value === undefined ? undefined : this.requireAlias(value);
    if (alias !== this.selectedAlias) {
      this.disconnect(); this.selectedAlias = alias; this.selectionInitialized = true;
      const generation = this.generation;
      const data = await this.store.read();
      if (generation !== this.generation) return;
      const current = this.currentRemote();
      this.lastBrowsePath = alias ? (Object.hasOwn(data.browsePaths, alias) ? data.browsePaths[alias] : undefined)
        || (current?.alias === alias ? current.path : undefined) : undefined;
    }
    await this.show(true);
    await this.snapshot();
  }

  private async addServer(): Promise<void> {
    const action = await vscode.window.showQuickPick([
      { label: '$(add) 新建 SSH 服务器', detail: '填写地址、用户和端口，保存到本机 SSH 配置。', action: 'create' },
      { label: '$(repo-clone) 从 SSH 配置导入', detail: '选择已有 Host 别名，也可恢复已删除的服务器。', action: 'import' },
      { label: '$(server) 添加已知 SSH 别名', detail: '只添加管理记录，适用于已有可连接的别名。', action: 'alias' }
    ], { title: '新增服务器', ignoreFocusOut: true });
    if (!action) return;
    const configFile = this.configPath();
    let alias: string | undefined;
    if (action.action === 'import') {
      const aliases = await readHostAliases(configFile);
      if (!aliases.length) { void vscode.window.showInformationMessage('SSH 配置中没有具体的 Host 别名，请选择「新建 SSH 服务器」。'); return; }
      const data = await this.store.read();
      alias = (await vscode.window.showQuickPick(aliases.map(value => ({ label: value,
        description: data.hiddenServers.includes(value) ? '已删除 · 可恢复' : this.servers.some(server => server.alias === value) ? '已在列表中' : '', alias: value
      })), { title: '导入 SSH 服务器', ignoreFocusOut: true }))?.alias;
    } else {
      alias = await vscode.window.showInputBox({ title: 'SSH 服务器别名', prompt: '在 Remote SSH 和管理器中使用的名称，例如 dev-server。', ignoreFocusOut: true,
        validateInput: value => validAlias(value) ? undefined : '仅支持英文字母、数字、点、下划线和连字符。' });
      if (!alias) return;
      if (action.action === 'create') {
        if ((await readHostAliases(configFile)).includes(alias)) throw new Error('此别名已存在，请使用「从 SSH 配置导入」。');
        const host = await vscode.window.showInputBox({ title: `${alias} · 服务器地址`, placeHolder: '192.168.1.10 或 dev.example.com', ignoreFocusOut: true,
          validateInput: value => /^[A-Za-z0-9._:%-]+$/.test(value) ? undefined : '请输入 IP 或主机名，不要包含用户、端口或 ssh 命令。' });
        if (!host) return;
        const user = await vscode.window.showInputBox({ title: `${alias} · 登录用户`, value: process.env.USER || process.env.USERNAME || '', ignoreFocusOut: true,
          validateInput: value => /^[A-Za-z0-9._@\\-]+$/.test(value) ? undefined : '请输入有效的用户名。' });
        if (!user) return;
        const port = await vscode.window.showInputBox({ title: `${alias} · SSH 端口`, value: '22', ignoreFocusOut: true,
          validateInput: value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536 ? undefined : '端口范围为 1–65535。' });
        if (!port) return;
        const identityFile = await vscode.window.showInputBox({ title: `${alias} · 私钥文件（可选）`, prompt: '留空时使用默认密钥、SSH agent 或密码。这里只填写本机文件路径。', ignoreFocusOut: true,
          placeHolder: '~/.ssh/id_ed25519', validateInput: value => /[\x00-\x1f\x7f"`$]/.test(value) ? '路径包含不支持的字符。' : undefined });
        if (identityFile === undefined) return;
        const confirm = await vscode.window.showInformationMessage(`保存 SSH 服务器 ${alias}？`, { modal: true,
          detail: `${user}@${host}:${port}\n\n将追加到 ${configFile}，保留现有配置。密码和私钥内容不会保存。`
        }, '保存服务器');
        if (confirm !== '保存服务器') return;
        await addSshHost(configFile, { alias, host, user, port: Number(port), identityFile: identityFile.trim() || undefined });
      }
    }
    if (!alias) return;
    await this.store.update(data => restoreServer(data, alias!));
    this.watchStore(); await this.snapshot(); await this.selectServer(alias);
    const item = this.tree.find(alias);
    if (item) await this.view.reveal(item, { select: true, focus: false });
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (typeof message.type !== 'string') return;
    switch (message.type) {
      case 'ready': case 'refreshServers': await this.snapshot(); return;
      case 'connect': {
        const alias = this.requireAlias(message.alias);
        if (alias !== this.selectedAlias) throw new Error('服务器已切换，请重新连接。');
        await this.connectAndBrowse(alias); return;
      }
      case 'cancel': this.disconnect(); this.post({ type: 'status', message: '后台浏览连接已断开。', busy: false, connected: false }); return;
      case 'browse': {
        const alias = this.requireAlias(message.alias);
        if (alias !== this.selectedAlias) return;
        await this.list(alias, normalizeRemotePath(message.path)); return;
      }
      case 'saveFolder': {
        const alias = this.requireAlias(message.alias);
        const folder = makeFolder(alias, normalizeRemotePath(message.path));
        await this.store.update(data => {
          const existing = data.folders.find(value => value.id === folder.id);
          if (existing) existing.favorite = true;
          else data.folders.push({ ...folder, favorite: true });
        });
        this.watchStore(); await this.snapshot(); this.post({ type: 'notice', message: '文件夹已收藏。' }); return;
      }
      case 'remove': {
        if (typeof message.id !== 'string') return;
        await this.store.update(data => {
          data.folders = data.folders.filter(folder => folder.id !== message.id);
        });
        await this.snapshot();
        this.post({ type: 'notice', message: '已删除此文件夹的收藏和历史记录，服务器上的文件夹保留。再次打开后会重新记录。' });
        return;
      }
      case 'favorite': case 'rename': {
        if (typeof message.id !== 'string') return;
        const data = await this.store.read();
        const folder = data.folders.find(value => value.id === message.id);
        if (!folder) throw new Error('记录已被其他窗口移除。');
        let name: string | undefined;
        if (message.type === 'rename') {
          name = await vscode.window.showInputBox({ title: '项目显示名称', value: folder.name, validateInput: value => value.trim() ? undefined : '请输入名称。' });
          if (name === undefined) return;
        }
        await this.store.update(latest => {
          const target = latest.folders.find(value => value.id === message.id);
          if (!target) return;
          if (message.type === 'favorite') target.favorite = !target.favorite;
          else if (name) target.name = name.trim();
        });
        await this.snapshot(); return;
      }
      case 'open': {
        const alias = this.requireAlias(message.alias);
        const remotePath = normalizeRemotePath(message.path);
        if (message.mode !== 'current' && message.mode !== 'new') throw new Error('打开方式无效。');
        if (message.fromBrowser === true) {
          if (alias !== this.selectedAlias || !this.lastBrowsePath) throw new Error('请先连接并浏览目标目录。');
          await this.verifyDirectory(alias, remotePath);
        }
        if (!vscode.extensions.getExtension('ms-vscode-remote.remote-ssh')) {
          throw new Error('请先安装 Microsoft Remote - SSH 扩展，再打开远程文件夹。');
        }
        // Opening itself never records success; the destination extension host observes the workspace.
        const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: authorityForAlias(alias), path: remotePath });
        await vscode.commands.executeCommand('vscode.openFolder', uri, message.mode === 'new' ? { forceNewWindow: true } : { forceReuseWindow: true });
        return;
      }
      case 'addFolder': {
        const alias = this.requireAlias(message.alias);
        const value = await vscode.window.showInputBox({ title: `${alias}：添加项目文件夹`, prompt: 'Linux 绝对路径；无需先连接服务器',
          placeHolder: '/home/user/projects/example', validateInput: value => { try { normalizeRemotePath(value); return undefined; } catch { return '请输入 Linux 绝对路径。'; } } });
        if (value === undefined) return;
        const folder = makeFolder(alias, value);
        await this.store.update(data => { if (!data.folders.some(item => item.id === folder.id)) data.folders.push(folder); });
        this.watchStore(); await this.snapshot(); return;
      }
      case 'recordCurrent': await this.recordCurrentFolders(true); return;
      default: return;
    }
  }

  private async inputSecret(title: string, prompt: string, signal: AbortSignal): Promise<string | undefined> {
    const token = new vscode.CancellationTokenSource();
    const cancel = () => token.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) token.cancel();
    try { return await vscode.window.showInputBox({ title, prompt, password: true, ignoreFocusOut: true }, token.token); }
    finally { signal.removeEventListener('abort', cancel); token.dispose(); }
  }

  private async connectAndBrowse(alias: string): Promise<void> {
    this.disconnect(); this.selectedAlias = alias;
    const generation = this.generation;
    const controller = this.connection = new AbortController();
    this.post({ type: 'status', message: '正在尝试密钥 / SSH agent…', busy: true, connected: false });
    try {
      const current = this.currentRemote();
      if (current?.alias !== alias) {
        const configuredPath = vscode.workspace.getConfiguration('sshWorkspaceManager').get('sshPath', 'ssh');
        const sshPath = configuredPath === 'ssh' ? vscode.workspace.getConfiguration('remote.SSH').get('path', '') || 'ssh' : configuredPath;
        const config = await resolveSshConfig(sshPath, this.configPath(), alias, controller.signal);
        if (generation !== this.generation) return;
        const session = await connectSftp(config, {
          password: async () => {
            if (generation !== this.generation) return undefined;
            this.post({ type: 'status', message: '密钥 / agent 未通过，等待输入服务器密码…', busy: true, connected: false });
            return this.inputSecret(`${alias}：SSH 密码`, '仅用于本次后台浏览；不会保存。正式打开时 Remote SSH 可能再次认证。', controller.signal);
          },
          passphrase: file => this.inputSecret(`${alias}：私钥口令`, `解锁 ${file}；口令不会保存。`, controller.signal),
          trustHost: async (_host, algorithm, fingerprint) => {
            const choice = await vscode.window.showWarningMessage(`首次后台连接 ${alias}`, {
              modal: true, detail: `本机 known_hosts 中没有该主机密钥。请核对服务器指纹：\n${algorithm}\n${fingerprint}\n\n仅信任本次连接，不改写 known_hosts。`
            }, '核对后仅本次信任');
            return choice === '核对后仅本次信任' && !controller.signal.aborted;
          }
        }, controller.signal);
        if (generation !== this.generation) { session.close(); return; }
        this.session = session;
      }
      let initialPath = this.lastBrowsePath;
      if (!initialPath) initialPath = current?.alias === alias ? current.path : await this.session!.homeDirectory();
      if (generation !== this.generation) return;
      await this.list(alias, initialPath);
    } catch (error) {
      if (generation !== this.generation) return;
      this.disconnect(); this.report(error);
      this.post({ type: 'status', message: '后台连接未就绪，可重试或直接打开已保存的文件夹。', busy: false, connected: false });
    }
  }

  private async verifyDirectory(alias: string, remotePath: string): Promise<void> {
    const current = this.currentRemote();
    if (current?.alias === alias) {
      const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: current.authority, path: remotePath });
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.Directory)) throw new Error('该路径不是文件夹。');
    } else if (!this.session?.available || !await this.session.isDirectory(remotePath)) throw new Error('目录已失效或后台浏览已断开，请刷新或重新连接。');
  }

  private async list(alias: string, remotePath: string): Promise<void> {
    const generation = this.generation, sequence = ++this.requestSequence;
    const normalized = normalizeRemotePath(remotePath);
    this.post({ type: 'status', message: '正在读取目录…', busy: true, connected: true });
    try {
      const current = this.currentRemote();
      let entries: RemoteEntry[], backend: string;
      if (current?.alias === alias) {
        await this.verifyDirectory(alias, normalized);
        const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: current.authority, path: normalized });
        entries = (await vscode.workspace.fs.readDirectory(uri)).filter(([name, type]) => (type & vscode.FileType.Directory) !== 0 && !/[\x00-\x1f\x7f/]/.test(name))
          .map(([name, type]) => ({ name, path: path.posix.join(normalized, name), symlink: !!(type & vscode.FileType.SymbolicLink) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        backend = '当前 Remote SSH 连接';
      } else {
        if (!this.session?.available) throw new Error('请先连接此服务器。');
        entries = await this.session.listDirectories(normalized);
        backend = 'SFTP 后台浏览';
      }
      if (generation !== this.generation || sequence !== this.requestSequence || alias !== this.selectedAlias) return;
      this.lastBrowsePath = normalized;
      await this.store.update(data => { data.browsePaths[alias] = normalized; });
      this.watchStore();
      if (generation !== this.generation || sequence !== this.requestSequence) return;
      this.post({ type: 'browseResult', alias, path: normalized, entries, backend });
    } catch (error) {
      if (generation !== this.generation || sequence !== this.requestSequence) return;
      this.report(error);
      this.post({ type: 'status', message: '目录读取失败；保留上次浏览位置。', busy: false,
        connected: this.currentRemote()?.alias === alias || !!this.session?.available });
    }
  }

  private disconnect(): void {
    this.generation += 1; this.requestSequence += 1;
    this.connection?.abort(); this.connection = undefined;
    this.session?.close(); this.session = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect(); clearTimeout(this.debounce); this.watcher?.close();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions = [];
    this.panel?.dispose(); this.panel = undefined;
  }
}
