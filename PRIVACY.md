# 隐私说明

SSH Workspace Manager 不包含遥测、广告或分析服务，不向开发者发送服务器列表、路径或使用记录。

- 服务器别名、显示名称、已保存的文件夹路径、收藏、最近打开时间、上次浏览位置及已隐藏服务器列表保存在本机 VS Code 扩展存储中。
- 读取本机 SSH 配置及 known_hosts，用于发现服务器、解析连接参数和校验主机身份。可选私钥只在连接期间读取。
- 密码和私钥口令只用于本次认证，不写入管理记录、日志或 Webview。
- 目录浏览会连接用户选择的 SSH 服务器，发送该连接所需的认证信息，并读取远程目录信息。
- 新建服务器经确认后，向本机 SSH 配置追加连接信息；只保存私钥路径，不保存私钥内容或密码。
- 打开工作区由 Microsoft Remote - SSH 扩展处理，其行为适用该扩展自身的隐私说明。
- 不使用 VS Code Settings Sync 同步目录记录。本机其他用户数据目录或配置档案各自独立。

可以删除单个文件夹记录、隐藏服务器，或关闭自动记录。隐藏服务器保留已有项目记录，便于重新导入后恢复。卸载扩展不会保证 VS Code 删除其扩展存储；如需彻底清理，可在 VS Code 用户数据目录的 `User/globalStorage/katcuu.ssh-workspace-manager` 下删除本扩展的 `catalog.json`。早期测试包使用 `local-dev.ssh-workspace-manager` 目录。

隐私问题请通过 [GitHub Issues](https://github.com/katcuu/vscode_ssh_workspace_manager/issues) 反馈，内容中不要包含凭据或敏感服务器信息。
