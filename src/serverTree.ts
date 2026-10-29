import * as vscode from 'vscode';
import { ServerInfo } from './model';

export class ServerItem extends vscode.TreeItem {
  constructor(readonly alias?: string, server?: ServerInfo) {
    super(server?.label || '全部服务器', vscode.TreeItemCollapsibleState.None);
    this.id = alias || '__all__';
    this.iconPath = new vscode.ThemeIcon(alias ? 'server' : 'layers');
    this.contextValue = alias ? 'sshServer' : 'sshAllServers';
    this.description = server && server.label !== alias ? alias : undefined;
    this.tooltip = alias ? `${server?.label || alias}\n${server?.configured ? '来自本机 SSH 配置' : '已保存的 SSH 别名'}` : '查看所有服务器的项目文件夹';
    this.command = { command: 'sshWorkspaceManager.selectServer', title: '查看项目文件夹', arguments: [this] };
  }
}

export class ServerTree implements vscode.TreeDataProvider<ServerItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: ServerItem[] = [new ServerItem()];
  private signature = '';

  update(servers: ServerInfo[]): void {
    const signature = JSON.stringify(servers);
    if (signature === this.signature) return;
    this.signature = signature;
    this.items = [new ServerItem(), ...servers.map(server => new ServerItem(server.alias, server))];
    this.changed.fire();
  }

  getTreeItem(item: ServerItem): vscode.TreeItem { return item; }
  getChildren(): ServerItem[] { return this.items; }
  getParent(): undefined { return undefined; }
  find(alias?: string): ServerItem | undefined { return this.items.find(item => item.alias === alias); }
  dispose(): void { this.changed.dispose(); }
}
