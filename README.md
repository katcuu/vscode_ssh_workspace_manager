# SSH Workspace Manager

在 VS Code 中集中管理 SSH 服务器和项目文件夹。左侧选择服务器，右侧查看完整路径、收藏与最近打开的文件夹，也可以直接浏览服务器目录。

适用于 **macOS / Windows 本机连接 Linux 服务器**。需要 Microsoft **Remote - SSH** 和本机 OpenSSH。

## 开始使用

1. 安装本扩展，按提示安装 Microsoft **Remote - SSH**。
2. 点击左侧活动栏的 **SSH Manager** 图标，管理页会直接打开。
3. 在左侧选择服务器。已有 SSH 配置会自动导入，也可以点击服务器栏右上角 **+** 新增。
4. 点击项目的 **当前窗口** 或 **新窗口**，由 Remote SSH 打开文件夹。

也可以从命令面板执行 **SSH Manager: 打开管理页 / Open Dashboard**，或点击底部状态栏 **SSH Manager**。图标被隐藏时，右击活动栏并勾选 **SSH Manager**。

## 管理服务器

服务器列表位于 VS Code 侧边栏，每台服务器带有服务器图标。选择 **全部服务器** 可以跨服务器搜索项目。

- **新增服务器**：输入 SSH 别名、地址、用户、端口和可选私钥路径，确认后追加到本机 SSH 配置。
- **从 SSH 配置导入**：选择已有 Host 别名，或恢复之前删除的服务器。
- **添加已知 SSH 别名**：只添加管理记录，适用于已有可连接的别名。
- **删除服务器**：悬停服务器后点击垃圾桶。从管理器隐藏，刷新后也不会重新出现；SSH 配置、已保存的项目记录和远程文件保留，重新导入即可恢复。
- **刷新 / SSH 配置**：使用服务器栏标题处的按钮刷新列表或编辑配置。

优先读取 `remote.SSH.configFile`，未设置时读取本机 `~/.ssh/config`（Windows 为用户目录下的 `.ssh/config`）。支持具体 Host 和 Include；通配 Host 不单独列出。新建条目追加在配置末尾，现有 OpenSSH 的规则顺序仍然生效。

## 管理项目文件夹

完整路径会自动换行显示，可按名称、路径或服务器搜索。支持收藏、重命名、手动添加绝对路径和删除记录。

**取消收藏**保留文件夹记录；**删除记录**移除此文件夹的收藏及历史记录，保留远程文件。再次实际打开该目录后，可以重新记录。

自动记录的是 VS Code **实际打开的 SSH 工作区文件夹**，包括多根工作区的每个根目录。不会记录源码文件或编辑器标签页，也不会导入安装前的 VS Code 历史。可在设置中关闭自动记录，或用 **记录当前文件夹** 手动保存。

## 浏览并打开新文件夹

1. 在左侧选择一台服务器，点击右侧 **连接并浏览**。
2. 单击选中文件夹，双击进入；也可以使用上级按钮、面包屑或绝对路径前往目录。
3. 点击 **收藏**、**当前窗口打开** 或 **新窗口打开**。未选中子目录时，操作对象为当前浏览目录。

支持隐藏目录和指向目录的符号链接。目录浏览只读取文件夹信息，不修改远程文件。

连接时优先使用 SSH agent / 密钥，必要时弹出 VS Code 原生密码框。已知主机使用本机 `known_hosts` 校验；未知指纹需要核对并仅本次信任，已变化或撤销的密钥会拒绝连接。

后台浏览使用独立 SFTP 连接；打开编辑窗口时 Remote SSH 可能再次要求认证。后台浏览支持直连的 HostName、User、Port、IdentityFile 和 agent；ProxyJump、ProxyCommand、SSH 证书和交互式多因素认证暂不支持浏览，这些连接仍可通过已保存路径交给 Remote SSH 打开。

## 设置与数据

| 设置 | 作用 |
| --- | --- |
| `sshWorkspaceManager.recordFolders` | 自动记录实际打开的 SSH 工作区文件夹，默认开启 |
| `sshWorkspaceManager.sshPath` | 本机 OpenSSH 路径，默认使用 PATH 中的 `ssh`；同时兼容 Remote SSH 的路径设置 |

记录保存在本机 VS Code 扩展存储中，同一用户数据目录 / 配置档案内的窗口共享。没有云同步或遥测；不保存密码或私钥口令。详见[隐私说明](https://github.com/katcuu/vscode_ssh_workspace_manager/blob/main/PRIVACY.md)。

从早期 `local-dev` 测试包升级时，会在新的存储为空时迁移已有记录。请卸载旧的 `local-dev` 版本，保留 `katcuu` 版本，避免入口重复。

## 问题反馈

通过 [GitHub Issues](https://github.com/katcuu/vscode_ssh_workspace_manager/issues) 反馈问题，请注明系统、VS Code 版本和失败步骤，服务器地址与目录可匿名化。不要提交密码、私钥或敏感配置。

最低 VS Code 版本为 1.99。Windows 已提供兼容实现和 CI 检查，真实 Windows 远程连接体验仍需进一步验证。

[源代码](https://github.com/katcuu/vscode_ssh_workspace_manager) · [MIT 许可证](https://github.com/katcuu/vscode_ssh_workspace_manager/blob/main/LICENSE)
