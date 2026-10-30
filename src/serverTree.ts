import * as vscode from 'vscode';
import { ServerInfo } from './model';

export type SidebarView = 'all' | 'local' | 'history' | 'favorites' | 'server';

export class ServerItem extends vscode.TreeItem {
  constructor(readonly view: SidebarView, readonly alias?: string, server?: ServerInfo) {
    const title = view === 'all' ? '全部服务器'
      : view === 'local' ? '本地文件'
        : view === 'history' ? '历史记录'
          : view === 'favorites' ? '收藏记录' : server?.label || alias || '服务器';
    super(title, vscode.TreeItemCollapsibleState.None);
    this.id = view === 'server' ? `server:${alias}` : view;
    this.iconPath = new vscode.ThemeIcon(view === 'server' ? 'server'
      : view === 'all' ? 'layers' : view === 'local' ? 'folder'
        : view === 'history' ? 'history' : 'star-full');
    this.contextValue = view === 'server' ? 'sshServer' : `ssh${view[0].toUpperCase()}${view.slice(1)}`;
    this.description = view === 'server' && server && server.label !== alias ? alias : undefined;
    this.tooltip = view === 'server'
      ? `${server?.label || alias}\n${server?.configured ? '来自本机 SSH 配置' : '已保存的 SSH 别名'}`
      : `查看${title}`;
    this.command = { command: 'sshWorkspaceManager.selectServer', title: '查看项目文件夹', arguments: [this] };
  }
}

export class ServerTree implements vscode.TreeDataProvider<ServerItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: ServerItem[] = [new ServerItem('all')];
  private signature = '';

  update(servers: ServerInfo[]): void {
    const signature = JSON.stringify(servers);
    if (signature === this.signature) return;
    this.signature = signature;
    this.items = [
      new ServerItem('all'),
      new ServerItem('local'),
      new ServerItem('history'),
      new ServerItem('favorites'),
      ...servers.map(server => new ServerItem('server', server.alias, server))
    ];
    this.changed.fire();
  }

  getTreeItem(item: ServerItem): vscode.TreeItem { return item; }
  getChildren(): ServerItem[] { return this.items; }
  getParent(): undefined { return undefined; }
  find(view: SidebarView, alias?: string): ServerItem | undefined {
    return this.items.find(item => item.view === view && item.alias === alias);
  }
  dispose(): void { this.changed.dispose(); }
}
