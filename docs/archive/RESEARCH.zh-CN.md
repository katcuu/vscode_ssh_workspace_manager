# 开源方案调研

更新日期：2026-10-29。当前需求：服务器与已打开文件夹的统一管理页，以及可逐层进入的远程文件夹浏览区。

“事实”指官方文档或仓库明确描述的能力，不等同于安装实测。“判断”是需求适配分析。“未见说明”表示尚未找到证据，不能断言能力不存在。

## 1. 结论

**判断：Wayfinder 覆盖较多基础管理需求，值得优先试用；尚未找到可确认覆盖内嵌远程目录浏览体验的方案。** 当前需要记录的是 VS Code 打开的文件夹，Wayfinder 的最近工作区目标与这项需求较接近。

用户此前选择独立开发、继续复用官方 Remote - SSH。当前沿用这一路线；自研价值集中在完整长路径、按服务器管理文件夹、自动积累目录，以及在同一页面浏览并选择新目录。现有项目作为交互与技术参考。

## 2. 重点候选

| 候选 | 已核实能力 | 对当前需求的判断 | 许可证证据 |
| --- | --- | --- | --- |
| [Wayfinder](https://github.com/yaver-dev/vscode-wayfinder/blob/main/README.md) | 编辑器管理页、SSH 配置导入、分组、最近目标、当前/新窗口打开 | 基础管理最接近；有 Open Folder 快捷入口，未见内嵌双击逐层浏览远程目录的说明 | README 标明 MIT |
| [Project Manager](https://github.com/alefragnani/vscode-project-manager) | 收藏 SSH 项目，命名、标签、侧栏、快速选择、当前/新窗口打开 | 能缓解常用目录查找；与宽屏管理页及远程浏览区的形态不同 | GPL-3.0 with VS Code Extension Host API Exception |
| [Recent by Remote](https://github.com/kyanet/vscode-recent-by-remote) | 按远程类型、主机组织已有最近记录，支持目录/工作区 | 可参考导入；主要是侧栏树，完整性受 VS Code 数据来源限制 | 仓库标明 MIT |
| [SSH FS](https://github.com/SchoofsKelvin/vscode-sshfs) | SSH 文件系统访问与配置管理 | 浏览有参考价值，但采用另一套文件访问方式，不能当作复用官方 Remote SSH 连接的等价实现 | 仓库标明 GPL-3.0 |

本轮未安装试用上述扩展，也未构建 Wayfinder。不根据未核实的活跃程度、星数或下载数作选型。

## 3. 技术事实与推论

1. **Remote - SSH 本身目前不开源。** 本项目作为协作扩展，不以修改官方插件为前提。[官方 FAQ](https://code.visualstudio.com/docs/remote/faq)
2. **可固定为本机 UI 扩展。** `extensionKind: ["ui"]` 使管理元数据保存在本机；远程资源使用 VS Code API，不能交给本机 Node `fs`。[官方架构](https://github.com/microsoft/vscode-docs/blob/main/api/advanced-topics/remote-extensions.md)
3. **公开 API 可列目录。** `workspace.fs.readDirectory(uri)` 返回名称与类型，`stat` 可核实类型；目录符号链接需要按位判断。[FileSystem](https://code.visualstudio.com/api/references/vscode-api#FileSystem)、[FileType](https://code.visualstudio.com/api/references/vscode-api#FileType)
4. **列目录接口不是任意主机连接管理器。** 当前源码将远程文件系统提供方绑定到本窗口的 remote agent connection。设计推论：仅在确认属于当前连接的 authority 上读取，不能只更改 URI 主机部分就声称读到另一台服务器。[官方实现](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/remote/common/remoteFileSystemProviderClient.ts)
5. **工作区 API 足以记录今后打开的目录。** 启动时读取 `workspace.workspaceFolders`，监听 `onDidChangeWorkspaceFolders`；第一根目录被替换可能重启扩展宿主，因此启动观察也必须保留。[workspace API](https://code.visualstudio.com/api/references/vscode-api#workspace)
6. **旧最近记录仍缺少相应公开读取 API。** `_workbench.getRecentlyOpened` 仅作为可失败的导入适配器，只保留可靠 SSH 文件夹条目。[官方请求](https://github.com/microsoft/vscode/issues/124577)
7. **打开目录可使用 VS Code 命令。** `vscode.openFolder` 支持当前/新窗口；主线 `vscode.newWindow` 有 remoteAuthority 参数，可作空远程窗口验证候选，但需隔离兼容性，不能当作稳定的 Remote SSH 公共 API。[命令文档](https://code.visualstudio.com/api/references/commands)、[源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/workspaceCommands.ts)
8. **本机纯 JavaScript SSH 客户端可以覆盖所需认证形态。** `ssh2` 的连接选项包含 agent、privateKey、passphrase、password 和 SFTP 通道；`ssh2-sftp-client` 在其上提供 Promise API 和 `list()`。这让当前页后台浏览在技术上可行，但仍需验证 SSH config 复杂语义、主机密钥校验、Extension Host Node 版本和 Marketplace 打包。[ssh2](https://github.com/mscdex/ssh2/blob/master/README.md)、[ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)

## 4. 远程浏览路线

体验目标：从当前页触发连接并继续浏览。已在目标服务器窗口时使用 `workspace.fs`；其他服务器优先研究本机 OpenSSH/SFTP 轻量浏览，选定后由官方 Remote SSH 打开编辑窗口。两者可以共用 SSH 配置，但不保证同一登录会话。认证首选 ssh-agent/密钥，失败且允许密码认证时再提示密码；凭据只在内存会话中存在。该路线待真实连接验证。

本轮核查官方文档、VS Code 源码及本机 Remote SSH 0.128.0 的命令清单，未找到供第三方调用的“无窗口连接并返回目录”稳定接口。官方连接窗口可以作为回退；其空窗口上下文与管理页恢复仍需验证。

另一条候选是把请求转发给已连接远程窗口，再将结果汇总到原页；仍需窗口，不能保证静默创建或不抢焦点。[后台连接核查与路线比较](BACKGROUND-CONNECTION.zh-CN.md) 记录了证据和认证差异。没有进行真实 SSH 测试。

## 5. 商店发布与待验证项

稳定后可以准备 Marketplace 上架。官方支持 `@vscode/vsce` 打包 VSIX、注册发布者、发布和预发布通道；实际需要完成实现、测试、资料及平台校验。顺序：本地 VSIX → macOS/Windows 连接 Linux 实测 → 预发布 → 稳定版。[官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

开发前验证：当前 SSH 窗口列出工作区外目录、空窗口起点和恢复管理页、主机切换与认证取消、当前/新窗口打开后实际工作区正确、路径特殊字符/符号链接，以及多窗口共享与旧记录导入范围。

以上为扩展验收项，尚未通过真实 SSH 测试。
