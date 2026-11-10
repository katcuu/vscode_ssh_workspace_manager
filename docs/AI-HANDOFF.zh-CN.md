# SSH Workspace Manager 开发交接手册

维护日期：2026-11-10。用户已确认 HTTP 克隆、目录新建 / 删除测试通过并授权正式发布。功能版本 `0.3.0` 已通过市场验证；最终产物核验发现依赖许可证文件名兼容问题，已按新版本规则发布 `0.3.1` 补丁。`0.3.1` 三平台 CI、GitHub Release 与 Marketplace OIDC 发布全部成功，官方查询确认 `validated`；插件运行代码保持用户确认的内容。各版本状态以本轮发布验证记录为准。

本手册用于让后续 AI 或开发者独立接手功能开发、定位问题和验证交付。入口规则见 [AGENTS.md](../AGENTS.md)，使用说明见 [README](../README.md)。具体行为和命令以当前源码、`package.json` 为准；修改实现时同步更新本文。

产品定位、使用场景、语言范围和长期交互约束集中记录在 [PRODUCT.md](../PRODUCT.md)，供后续产品与界面设计读取；技术细节和带日期的验证 / 发布状态继续在本手册维护。

现有视觉系统见 [DESIGN.md](../DESIGN.md)，组件示例和扩展元数据见 [.impeccable/design.json](../.impeccable/design.json)。界面调整以实际源码和宿主主题为依据；设计文档中的扫描规格不能替代真实布局或窗口行为验收。

## 1. 项目目标与交付状态

用户通常管理 10 台以内服务器、每台 10 个以内项目。原生 Remote Explorer 太窄，长路径难辨认，也不便跨服务器找回打开过的项目。本扩展提供原生服务器侧栏和宽幅项目管理页，复用 Remote SSH 打开编辑工作区。

| 项目 | 交接基线 |
| --- | --- |
| 仓库 | [katcuu/vscode_ssh_workspace_manager](https://github.com/katcuu/vscode_ssh_workspace_manager) |
| 扩展 / 发布者 | `katcuu.ssh-workspace-manager` / `katcuu`，MIT |
| 版本与最低 API | 正式版 `0.3.1`；VS Code `^1.99.0` |
| 平台 | macOS / Windows 客户端；Linux SSH 服务器 |
| 本机交付 | `0.3.1` 正式 CI VSIX 已下载并校验九项依赖许可证；bundle 和界面资源与用户确认的测试包一致，`.cmd` 换行按 Git 属性处理；宿主基础 smoke 沿用 `0.3.0` 验证 |
| 市场 | [GitHub Release v0.3.1](https://github.com/katcuu/vscode_ssh_workspace_manager/releases/tag/v0.3.1) 已附正式 VSIX；[标签工作流](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42766283850) 的三平台检查、GitHub Release 和 Marketplace 发布均成功；官方查询确认 `0.3.1` 为 `validated` |
| 自动验证 | `0.3.1` 本机类型检查、构建、打包通过，main / 标签三平台 CI 全通过（含 45 项测试）；隔离 VS Code 1.139.0 基础 smoke 沿用运行逻辑相同的 `0.3.0` 结果 |

市场状态是交接时的记录，不是实时查询结果。继续发布前，核对 [Marketplace](https://marketplace.visualstudio.com/items?itemName=katcuu.ssh-workspace-manager) 与 [发布者管理页](https://marketplace.visualstudio.com/manage/publishers/katcuu)。不要把 GitHub 推送、本机安装或用户看到旧市场版本误认为发布失败。

## 2. 已确认的使用需求

### 入口与列表范围

点击左侧活动栏图标，必须直接打开右侧管理页，重复点击复用同一个管理页标签。左侧使用 VS Code 原生 TreeView，不把服务器列表放回 Webview。服务器显示图标，标题栏支持新增、刷新、编辑 SSH 配置，具体服务器支持删除入口。

| 左侧入口 | 右侧内容 |
| --- | --- |
| 全部服务器 | 所有未隐藏服务器的远程项目，不混入本地项目 |
| 本地文件 | 本机项目，包括自动记录和手动添加的文件夹 |
| 历史记录 | 所有实际打开过的本地及 SSH 项目，包括已隐藏服务器的项目 |
| 收藏记录 | 所有收藏的本地及 SSH 项目，包括尚未打开的目录和已隐藏服务器的项目 |
| 具体服务器 | 该服务器项目，以及远程目录浏览区域 |

项目列表显示名称、完整路径、来源、最近打开时间；支持按名称、路径、服务器别名及显示名搜索。本地来源可用“本地”搜索。历史按最近打开排序，其他视图先收藏、再最近打开、再名称。切换视图清空搜索与收藏筛选，单纯数据刷新保留当前搜索。

具体服务器页和本地文件页在 Webview 宽度至少 1080px、高度至少 680px 时并排显示项目清单与目录浏览 / 本机克隆面板。中间分隔线可拖动，聚焦后支持左右方向键微调及 Home / End 跳转；远程和本机布局分别记忆比例。较窄或较矮的窗口仍用单列布局。项目清单容器至少 700px 时，行内按钮组与完整路径底边对齐；更窄时按钮排到路径下方。

### 记录与操作语义

- 自动记录 VS Code 实际打开的工作区根目录，包含通过其他入口打开的项目。多根工作区逐根记录，不把 `.code-workspace` 文件单独作为项目。
- 用户明确不需要源码文件、编辑器标签页历史，也不要求导入安装前的 VS Code 历史。
- 同一位置重复打开只更新一条记录的时间，保留收藏和自定义显示名称。不同 SSH 别名下的相同路径属于不同位置。
- 只添加、浏览或收藏目录不产生打开历史；取消连接或打开失败也不能提前写入历史。
- 关闭 `sshWorkspaceManager.recordFolders` 后停止自动记录；“记录当前工作区文件夹”命令仍可手动记录。
- 历史或普通列表的“删除记录”先让用户选择“仅删除记录”或“删除文件夹并删除记录”；收藏列表的“取消收藏”只改收藏状态，保留原记录及已有历史。
- 删除实际文件夹须再次确认并在模态框中显示完整路径。文件系统操作成功后才移除记录；路径已不存在时提示后移除旧记录，路径变成普通文件、权限不足或其他删除失败时保留记录。递归删除不跟随远程符号链接，且禁止删除本机盘符根目录和远程 `/`。
- “重命名”只改显示名称；选择“仅删除记录”只改本机元数据。再次实际打开已移除的目录后会重新记录。
- 删除服务器只将别名写入隐藏列表；刷新仍保持隐藏，已有 SSH 配置及项目保留，可从导入入口恢复。全局历史和收藏仍可打开它的项目。
- 每条记录支持当前窗口和新窗口打开。本地项目从远程窗口操作时仍打开本机工作区；远程项目交给 Remote SSH。

### 新目录浏览与认证

具体服务器页面可以“连接并浏览”：单击选中目录、双击进入、返回上级、面包屑跳转、输入绝对路径，支持隐藏目录和指向目录的符号链接。没有选中子目录时，收藏或打开的对象是当前浏览目录。

浏览区新增 `createDirectory` / `deleteDirectory` 消息，扩展校验服务器、当前路径、generation 和操作锁。新建用原生输入框收集单个目录名，拒绝路径分隔符、相对路径、控制字符、首尾空格及超长名称；在当前浏览路径下创建，刷新后通过 `browseResult.selectedPath` 选中新目录（隐藏目录会同时显示）。删除只允许当前列表的直接子目录，连续两个原生模态确认均显示服务器和完整路径；成功后通过 Store 移除同服务器下对应路径及子目录的记录，符号链接只删链接和其本身的记录。缺失路径、取消、权限失败与断开竞争均释放 `directoryOperation` 状态；目录操作和克隆互斥，不预写历史。当前窗口已通过 Remote SSH 连接相同服务器时，创建 / 删除复用 `workspace.fs`；否则复用 SFTP 的 `mkdir` 和不跟随链接的递归删除。

认证优先 agent / 密钥，没有可用凭据时使用 VS Code 原生密码输入。后台 SFTP 与 Remote SSH 是不同连接，正式打开时可能再次认证。当前没有可复用的公开 Remote SSH 接口来保证任意未连接服务器在原页面后台完成目录浏览，因此保留独立 SFTP 路线。

目录浏览区还可把 Git 仓库克隆到所选远程父目录下，以仓库名创建子目录。成功后浏览器刷新并进入克隆目录，可直接打开当前 / 新窗口；页面顶部保留克隆进度或最终结果，切换左侧视图后仍可查看。只有 VS Code 实际打开工作区后才记录历史。Git 必须安装在 Linux 服务器上，且服务器需能访问仓库主机。

克隆在所选服务器的 SSH 命令通道内运行 Git，不依赖 Webview 或 SFTP 写文件。即使当前目录列表通过 Remote SSH 的 `workspace.fs` 读取，克隆仍使用独立 `ssh2` 会话 / exec channel。地址限定 SSH / HTTPS / HTTP，拒绝嵌入式账号、密码、令牌和查询参数；目标名由解码后的仓库路径末段安全派生，命令参数使用 POSIX shell 单引号转义。目标目录已存在时由 Git 报错，不覆盖既有内容。克隆启动后先显示不定进度条和可用的状态文字，Git 输出对象百分比后切换为定量进度。

SSH 仓库优先使用 Linux 服务器的 key / agent；加密 key 的口令或 Git 服务器要求的 SSH 账号密码由 VS Code 原生密码输入框按需收集。HTTP / HTTPS 按需在 VS Code 提示用户名，再提示密码 / 访问令牌；HTTP 凭据输入框说明其到 Git 服务器的连接未加密；禁用 Git credential helper 并设置 `GIT_TERMINAL_PROMPT`，凭据只经 SSH 通道交互提交、不写入命令、Webview、存储或日志。PTY 先执行 `stty -echo`，避免认证输入被终端回显。用户取消、关闭页面或显式断开连接时中断远程命令；单纯切换管理页视图会继续克隆。Git 可提供的阶段与对象百分比显示在管理页顶部和克隆控件旁。

克隆源站的 SSH 主机密钥使用 Linux 服务器的 `known_hosts`。若 Git SSH 提示未知主机，扩展发送拒绝并中止，要求用户在服务器上核对指纹并预先建立信任；不能自动接受未知密钥。HTTPS 凭据输入取消、权限错误、目标已存在、无 Git、SSH 认证或 known_hosts 问题均给出脱敏摘要。

本地文件视图也支持 Git 克隆：先用 VS Code 原生文件夹选择器选择本机父目录，扩展在本机启动 `git clone` 并按仓库名创建子目录；本机需安装 Git 并确保在 PATH 中。Git 进程继承本机 Git / OpenSSH 配置与 agent 环境，因此 SSH key、agent、SSH 配置和 `known_hosts` 都来自运行 VS Code 的电脑；Git 不在 Linux 服务器执行。HTTP / HTTPS 用户名、密码 / 令牌、SSH 账号密码和加密 key 口令由原生输入框收集，通过随机 Unix socket 或 Windows named pipe 的短期 askpass 桥交给本机 Git，凭据不进入 Webview / Store / 命令参数。`GIT_ASKPASS` 和 `SSH_ASKPASS` 均使用打包资源 `media/git-askpass.sh` / `.cmd` 的实际可执行文件路径，凭据桥为同目录 `media/git-askpass.cjs`，通过 `ELECTRON_RUN_AS_NODE` 启动 VS Code 自带的 Node runtime。不能把包含 Node 路径和参数的整段命令用作 `GIT_ASKPASS`；真实 Git 回归已复现其被当作文件名执行。关闭管理页或取消会终止本机 Git 并关闭 IPC endpoint；切换左侧视图不会取消克隆。

本机克隆成功后通过 `CatalogStore.update()` 将目录加入本地列表；`makeLocalFolder()` 的 `lastOpenedAt` 保持 `null`，不能在克隆时写成打开历史。只有工作区事件观察到它实际打开后才由现有记录逻辑更新时间。取消或失败不会写入目录记录。页面顶部保留克隆状态、完整路径，并提供当前 / 新窗口打开；扩展启动后父目录选择默认回到本机 home，同一次扩展运行内通过 snapshot 保留所选路径及克隆结果。远程成功后把 `browsePaths[alias]` 更新到仓库目录；若原页面仍在该服务器视图，立即刷新进入仓库目录；切换出去后返回时，如果 SFTP 会话仍可用，也重新列出克隆目录。

## 3. 代码结构和运行过程

项目使用 TypeScript、VS Code API、原生 HTML/CSS/JavaScript Webview，没有前端框架或独立后端。`extensionKind: ["ui"]` 让管理、配置读取和本地存储运行在本机，而不是远程服务器。

| 文件 | 职责与定位入口 |
| --- | --- |
| `package.json` | 扩展身份、API 下限、激活、命令、视图、设置、Remote SSH 依赖 |
| `src/extension.ts` | `WorkspaceManager`；初始化、工作区观察、单实例管理页、命令、消息、打开目录、连接协调 |
| `src/serverTree.ts` | `SidebarView`、四个顶层入口、服务器图标、选择与删除菜单的上下文 |
| `src/model.ts` | 本地 / 远程记录类型、路径规范化、稳定 ID、schema 校验迁移、隐藏与恢复 |
| `src/store.ts` | `CatalogStore.read/update`；跨窗口文件锁、重新读取、事务写入 |
| `src/sshConfig.ts` | Host / Include 枚举、`ssh -G` 解析、受支持配置映射 |
| `src/sshConfigWriter.ts` | 新服务器参数校验、加锁追加 Host，不重写已有配置 |
| `src/sftp.ts` / `src/trust.ts` | `ssh2` 认证、SFTP 浏览 / 不跟随符号链接的递归删除、Git exec 通道、取消、known_hosts 与指纹 |
| `src/gitClone.ts` | Git URL / 目标名校验、远程命令转义、HTTPS / SSH 提示识别、进度解析 |
| `src/localGitClone.ts` / `media/git-askpass.cjs` | 本机 `git clone`、SSH askpass 凭据桥、Windows named pipe / Unix socket、进度、取消与脱敏错误 |
| `media/dashboard.html/js/css` | 页面结构、列表筛选排序、消息交互、主题和长路径换行 |
| `scripts/build.mjs` / `package.mjs` | esbuild 打包、第三方许可证、VSIX 生成 |
| `test/` / `scripts/vscode-smoke.cjs` | 逻辑及协议测试 / 真实 VS Code 扩展宿主验证 |

初始化过程：创建本机存储目录 → 在适用时迁移 `local-dev` 数据 → 记录当前实际根目录 → 读取 SSH 配置并生成快照 → 监听存储和工作区变化。工作区事件只记录 `event.added`，移除一个根目录不能刷新其他项目的打开时间。窗口获得焦点只刷新快照。

目录元数据变更经 Store 写入后，当前窗口更新快照；其他窗口通过目录级 `fs.watch`、300ms 防抖和重新聚焦刷新看到新数据。快照序号避免较早的异步读取覆盖新状态。原生侧栏仅在服务器列表发生变化时重建，避免频繁刷新导致选择不稳定。

页面 `ready` 请求 `snapshot`。列表打开消息只传记录 ID 与 `mode: "current" | "new"`；扩展从最新 Store 查回合法记录再构造 URI。浏览器中的打开还需校验当前服务器和目录。修改交互时同时检查 `handleMessage()`、前端 `send()` / 消息监听及相应测试，不只改按钮文字。

顶部普通结果 / 错误提示使用 `notice` 容器、独立的 `noticeMessage` 文本及 `dismissNotice` 关闭按钮。消息通过 `textContent` 更新文本节点，不能覆盖容器并移除按钮。关闭只在 Webview 收起当前提示，不发送扩展消息、不修改记录；下一条 `notice` / `error` 仍会显示。克隆结果保留原有独立关闭与消息处理。

打开使用 `vscode.openFolder`：本地通过 `Uri.file()` 和 `forceLocalWindow`，远程通过 `Uri.from({ scheme: "vscode-remote", authority, path })`。不要拼接未转义 URI，否则中文、空格、`#`、`%` 会出问题。新位置由目标窗口实际观察工作区后记历史；若目标已在当前工作区，打开前更新对应根目录，补足宿主未重新激活的情况。

后台浏览使用两种来源：当前窗口已连接同一 SSH 别名时使用 `vscode.workspace.fs`；其他情况使用独立 SFTP。切换服务器 / 视图、取消、关闭管理页、释放扩展都必须中止待连接并释放会话。`generation`、请求序号及服务器检查用于丢弃过期回调，新增异步逻辑时保留这些检查。

## 4. 数据与兼容规则

存储文件为 `context.globalStorageUri.fsPath` 下的 `catalog.json`。同一 VS Code 用户数据目录 / 配置档案内的窗口共享；不同档案和不同电脑不共享，不使用 Settings Sync。

当前格式为 `CatalogData.schemaVersion = 2`：

| 字段 | 语义 |
| --- | --- |
| `revision` | 每次成功事务递增，用于区分初始化等状态 |
| `servers` | 手动保存的 `{ alias, label }`，不是完整 SSH 连接配置 |
| `folders` | 本地和远程的统一记录数组，历史与收藏都从它筛选，不维护第二份列表 |
| `browsePaths` | 每个 SSH 别名上次成功浏览的目录，不代表打开历史 |
| `hiddenServers` | 持久隐藏的服务器别名 |

所有文件夹记录有 `id`、`kind`、`path`、`name`、`favorite`、`lastOpenedAt`。远程记录额外有 `alias` 和 `authority`。`lastOpenedAt: null` 表示保存但尚未实际打开，正数为毫秒时间戳。

- 远程路径按 `path.posix` 规范化，要求 Linux 绝对路径并拒绝控制字符。authority 必须匹配 `ssh-remote+<alias>`。ID 为 SHA-256(`authority + "\0" + path`) 的前 24 位十六进制。
- 本地路径按本机 `node:path` 规范化，保留根目录和合法字符。ID 为 SHA-256(`"file\0" + identity`) 的前 24 位；Windows 对规范化路径转小写，POSIX 保留大小写。
- 不解析符号链接来合并项目，也不按服务器真实 IP 合并不同别名。不要擅自更换 ID 算法，否则收藏、名称和去重都会受影响。
- `recordFolder()` 只更新已存在记录的打开时间，且取新旧时间最大值，防止延迟写入使历史倒退。
- schema 1 的既有远程记录补 `kind: "remote"` 并转为 schema 2，保留原 ID、收藏、名称和时间。早期缺少的 `hiddenServers` 补空数组。
- 从 `local-dev.ssh-workspace-manager` 迁移只在正式扩展存储 `revision === 0` 时进行，不能覆盖已有正式记录。

`CatalogStore.update()` 在锁内重新读取最新文件，再执行修改、递增版本、校验、写入独立临时文件并原子重命名。不要在锁外读出整份数据，再在锁内用旧副本覆盖；也不要绕过 Store 直接写 JSON。文件锁是跨窗口协调的一部分。

文件缺失时才返回空目录；格式不兼容或 JSON 损坏时报告错误、保留原文件，不自动清空。修改 schema 时补迁移、验证、并发和原数据保留测试。定位数据问题先备份并使用脱敏副本，避免在用户日常目录上做试验。

## 5. SSH 支持范围与边界

配置优先 `remote.SSH.configFile`，否则本机 `~/.ssh/config`。Host 枚举只列具体合法别名，支持 Include 与循环保护；连接参数经本机 `ssh -G -F <config> <alias>` 解析。自有 `sshPath` 设置为默认 `ssh` 时兼容 `remote.SSH.path`。

新建服务器校验别名、主机、用户、端口和私钥路径，在用户确认后加锁追加，保留已有字节及换行风格。OpenSSH 既有规则顺序仍生效，例如前面的 `Host *` 可能影响后面新条目；不能通过重排用户配置“修复”。服务器隐藏也不能顺便删除 Host 段落。

独立浏览支持直连、IdentityFile、agent、密码和加密私钥口令；`IdentitiesOnly`、公钥 / 密码认证开关会影响尝试顺序。Windows agent 使用系统 OpenSSH 管道路径，仍需实机验证实际运行环境。

后台浏览当前拒绝 ProxyJump、ProxyCommand、CertificateFile、KnownHostsCommand、特定 BindAddress / BindInterface 配置；调用 `ssh -G` 前还拒绝 `Match exec`，防止浏览阶段执行本机命令。交互式多因素认证和 SSH 主机证书也未支持。这些限制针对独立浏览，保存路径仍可交给 Remote SSH 使用其自身能力打开。

known_hosts 支持明文 / 哈希主机和非默认端口。未知指纹由用户核对后仅信任本次，不改写 known_hosts；已变化、撤销的密钥及不支持的证书拒绝连接。密码 / 口令不落盘、不进入 Webview；不通过记录错误、调试日志或截图泄露凭据。

SFTP 请求超时为 20 秒，连接握手允许 120 秒（包括等待用户输入），会话空闲约 5 分钟关闭。浏览失效后提示重连，不能据此删除已保存项目。目录符号链接需额外 stat，并发上限为 4。

远程浏览恢复规则：Webview 的路径栏在断开或连接失败后仍可编辑；“前往”在未连接时会携带当前路径新建后台连接，连接按钮也传递路径栏值。若恢复默认的 `browsePaths[alias]`，或用户明确提交的路径与已保存路径相同，且该目录因不存在 / 已变成文件而失败，则依次尝试 POSIX 上级目录直到首个可读目录，更新 `browsePaths` 与内存 `lastBrowsePath` 并提示实际落点。只对 missing / not-a-directory 错误回退；权限、网络和 SFTP 错误不改变保存位置，供用户修正后重试。手动输入的不同路径失败时不自动跳到其他目录。新目录读取开始即清空旧列表和目标，失败后禁用打开、收藏和克隆，避免旧目标冒充新目录。连接取消通过 `generation` / `requestSequence` 抛弃延迟结果，不能在取消后写入新的浏览位置。

## 6. 开发、调试和验证

使用 Node.js 22，与三平台 CI 一致；运行时代码由 esbuild 以 Node 20 为目标打包。锁文件纳入版本控制，首次安装用 `npm ci`。

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

`npm run check` 是 `tsc --noEmit`。`npm test` 通过 tsx 执行 Node 测试。`npm run package` 通过 vsce 的 prepublish 流程重新检查和构建，生成 `artifacts/ssh-workspace-manager-<version>.vsix`。`dist/extension.js`、source map 和第三方许可证由构建生成，不直接编辑。增加运行时依赖时同步检查构建脚本里的许可证清单。

默认交付规则（2026-11-09 用户确认）：每轮修改在适用自测通过后，自动打包 VSIX 并检查压缩完整性、版本和包内资源，再提供绝对路径链接供用户测试，无需再次请求打包指令。未要求发布时沿用当前版本号，不自动安装、提交、打标签或上架；安装包保存在被 Git 忽略的 `artifacts/`。

VS Code 打开仓库后按 F5，使用 `.vscode/launch.json` 启动扩展开发宿主；预启动任务会 build，但不是持续监听，改 TypeScript 后需重新构建并重启 / 重新加载宿主。远程打开验收需要在该测试环境安装 Remote - SSH。开发宿主和已安装的正式扩展不是同一个运行实例，核对实际扩展 ID 和版本。

### 自动测试各自证明什么

| 检查 | 覆盖范围 | 未覆盖 |
| --- | --- | --- |
| `test/core.test.ts`，8 个测试 | 本地 / 远程路径与 ID、去重、schema 迁移、Host / Include、known_hosts、并发存储与损坏保护、隐藏恢复、SSH 配置追加 | 原生 UI、真实公网连接 |
| `test/dashboard.test.ts`，7 个测试 | 执行实际 dashboard.js，检查列表、排序、来源搜索、打开 ID 消息、删除 / 取消收藏区别、分栏比例、克隆状态跨视图恢复、路径和当前 / 新窗口打开消息、失效路径后的重连和恢复交互 | DOM 替身不能验证真实排版、点击焦点或 VS Code 窗口 |
| `test/browsing.test.ts`，18 个测试 | 通过 VS Code API double 运行实际扩展 bundle 和 Webview 消息处理，验证目录新建 / 删除、两次确认、跨服务器记录隔离、新建不记历史、失效路径恢复、取消竞争、仅删除记录、本机递归删除、取消二次确认、路径已被外部删除、文件替代目录、删除失败保留记录及根目录保护 | 不启动 VS Code UI，也不执行真实 SFTP；真实 SFTP 错误由协议测试覆盖 |
| `test/gitClone.test.ts`，4 个测试 | SSH / HTTPS / HTTP URL、凭据拒绝、目标名和 shell 转义、认证提示与 Git 进度解析 | 不连接公网 Git 服务 |
| `test/httpClone.test.ts`，1 个测试 | 真实 Git 和本机 HTTP 服务验证匿名克隆、HTTP Basic 用户名 / 令牌认证、取消凭据输入、检出内容、凭据不写入仓库配置，以及带空格的 askpass 启动路径 | 不连接公网仓库或验证用户真实凭据 |
| `test/localGitClone.test.ts`，3 个测试 | 通过本机 IPC endpoint 启动 askpass helper，检查秘密输入传输、取消响应和 Unix socket 清理；真实 OpenSSH 通过带空格的启动脚本 / helper 路径完成本地 SSH fixture 的密码认证 | 不连接公网 Git 服务，也不验证 Windows UI / 用户本机 agent |
| `test/sftp.test.ts`，4 个测试 | 临时密钥和本地 SSH/SFTP 服务，验证公钥优先、密码回退、agent 不可用 / 空身份时继续回退、未知主机信任、变化主机密钥拒绝、加密 / 缺失密钥、目录 / 符号链接、新建 / 重名 / 权限 / 缺失父目录、HTTP 远程克隆认证、错误与取消、诊断脱敏 | 用户实际 agent、跳板机、多因素认证、真实服务器环境 |
| `scripts/vscode-smoke.cjs` | 真实宿主激活、命令、活动栏直接打开、单实例管理页、四种入口、特殊字符 URI | 不进行真实 Remote SSH 连接 |

协议测试使用临时服务和临时密钥，不修改个人 SSH 配置。SFTP 协议测试需要本地监听端口；askpass 桥测试需要建立本机 Unix socket / Windows named pipe。若运行器禁止这些本机 IPC，记录环境限制，不能把协议测试改成跳过后声称全部通过。

真实宿主 smoke 可用 VS Code CLI 配合独立的 `--user-data-dir`、`--extensions-dir`、`--extensionDevelopmentPath <仓库绝对路径>` 和 `--extensionTestsPath <仓库绝对路径>/scripts/vscode-smoke.cjs` 执行。先为隔离扩展目录安装 Remote - SSH，并使用可信的测试工作区。可设置 `SSH_MANAGER_SMOKE_RESULT` 为结果 JSON 的绝对路径；此脚本不是直接用 `node` 运行的测试。

额外设置 `SSH_MANAGER_SMOKE_CATALOG` 才启用多根本地历史分支：它必须指向隔离宿主实际使用的 catalog，启动工作区须至少有两个本地根目录，并预置一条 schema 1 的远程收藏。该分支检查迁移、根目录名称、去重和移除根目录不刷新其他历史；它会移除第二个工作区根目录，因此只能使用临时 fixture，重跑前恢复 fixture。不设该变量时，结果里的 `localHistory` 会是 `not tested`。

### 交接基线的验证证据

0.2.0 的 11 个测试、类型检查、构建及打包已通过。VS Code 1.139.0 的隔离宿主 smoke 包括上述多根历史分支；macOS 中也检查了安装版本的入口、混合历史、搜索和取消收藏保留记录。

### 远程浏览失效路径修复（2026-11-09，开发阶段记录，现随 0.2.3 发布）

- Node.js 22.23.4 下 `npm run check`、`npm test`（30 项）及 `npm run build` 通过。
- 新增的控制层回归通过实际打包扩展 bundle、隔离 catalog、Remote SSH 文件系统 double 和 Webview 消息处理运行；覆盖目录被删除、路径变成普通文件、手动改路径、非法路径、权限错误、根目录不存在和取消竞争。
- Dashboard 测试覆盖断开状态可编辑、从输入路径重新连接、读取失败后仍可修改，以及失败时不显示旧目录为可打开 / 可克隆目标。SFTP 协议测试确认 `NO_SUCH_FILE` 错误码保留供上层恢复，`ENOTDIR` 可识别，并且目录错误后会话仍可用。
- 此开发阶段未生成 VSIX、修改版本号、提交或发布，也未完成真实扩展宿主 UI 验收；后续测试和正式交付见下文。

### 项目文件夹物理删除（2026-11-09，开发阶段记录，现随 0.2.3 发布）

- 删除项目记录时由原生模态框提供“仅删除记录”与“删除文件夹并删除记录”两项；后者需再确认完整路径。递归删除期间显示 VS Code 通知进度。
- 本机通过 `workspace.fs.delete({ recursive: true })` 删除；远程复用可用 SFTP 会话或按 SSH 配置建立后台会话，逐项 `lstat` / `readdir` / `unlink` / `rmdir`，不跟随符号链接。根目录禁止删除；路径缺失按幂等结果处理，文件替代目录及权限错误不会移除记录。
- `npm run check`、`npm test`（37 项）及 `npm run build` 通过。覆盖仅删除记录、取消二次确认、本机递归删除、外部删除路径、普通文件替代目录、删除失败保留记录及远程 SFTP 递归与符号链接边界。
- VS Code 1.139.0 隔离宿主基础 smoke 通过，覆盖激活、活动栏入口、服务器命令和管理页单实例；未触发删除确认，也未连接真实 SSH 服务器执行删除。
- 此开发阶段尚未发布删除功能，未覆盖真实宿主里的两次原生确认及本地 / Remote SSH 实际删除行为；后续用户测试包确认和正式交付见下文，不将其计为自动化覆盖。

### 顶部提示关闭与测试包交付（2026-11-09，开发阶段记录，现随 0.2.3 发布）

- 普通结果与错误提示新增右侧关闭按钮，支持鼠标及键盘激活；关闭仅收起当前提示，后续新消息仍正常展示。长路径换行时按钮保持可见。
- Node.js 22.23.4 下类型检查、37 项测试和构建通过。VS Code 1.139.0 隔离宿主基础 smoke 通过，并在真实 Webview 中检查了宽 / 窄布局、长路径、鼠标关闭、Enter 关闭、新提示重新出现及错误样式重置；未连接真实 SSH 服务器或执行实际文件夹删除。
- 用户要求自测通过后自动生成并提供 VSIX，规则已同步至 `AGENTS.md`、`CONTRIBUTING.md` 及本文。测试包沿用 `0.2.2`；没有提交、打标签或上架。
- 已运行 `npm run package`；测试包 `artifacts/ssh-workspace-manager-0.2.2.vsix` 为 571283 字节，ZIP 完整性、包内版本、UI 宿主声明及 HTML / CSS / JS / bundle 与当前源码一致性检查通过。SHA-256 为 `d2212a2878c804301e6a929b6647ce32c17ec17512598ff6775ccd656cf5f063`。

### HTTP 克隆与浏览区目录操作（2026-11-10，用户测试通过，已随 0.3.0 发布）

- 本机与远程克隆接受 HTTP 地址及端口，仍拒绝 URL 内嵌凭据、查询令牌和非法目录名；原生输入框按需处理 HTTP 账号和密码 / 令牌，提示明文传输。修复本机 `GIT_ASKPASS` 整段命令被当成文件名的问题，改为和 SSH 共用实际启动脚本。
- “新建文件夹”在当前路径下创建并选中；“删除选中文件夹”只允许直接子目录，连续两次确认后删除，刷新并清理对应记录。按钮和克隆任务互斥，取消或失败均恢复可用状态。
- 真实 Git + 隔离 HTTP 服务验证匿名克隆、账号认证、取消凭据、特殊字符 / 带空格的 helper 路径及凭据不持久化；真实 SSH/SFTP 协议夹具验证 mkdir、重名、权限错误、父目录缺失和 HTTP 远程认证提示。控制层测试覆盖新建不记历史、取消、根目录 / 越界目标、子树记录按服务器隔离和删除时路径消失。
- 隔离 VS Code 1.139.0 扩展宿主基础 smoke 通过。复用实际 HTML / CSS / JS 的独立浏览器夹具检查约 1233px / 385px 内容宽度的按钮可用性、选中反馈、新建后选中及无横向溢出；这不是原生确认框或真实 Webview 的完整交互验收。桌面自动化未能选中隔离宿主窗口，未在用户真实服务器执行删除；Windows 实机仍需用户验收。
- Node.js 22.23.4 下类型检查和 45 项自动测试通过。`npm run package` 的类型检查、构建和打包通过；VSIX 共 20 个文件，已核对 ZIP 完整性、版本、UI 宿主声明、包内界面 / bundle / askpass / 用户文档与源码一致及 Unix 启动脚本可执行位。开发阶段交付 `artifacts/ssh-workspace-manager-0.2.3-http-folders-test.vsix`，沿用 `0.2.3` 测试包版本，当时未提交、打标签或上架；用户随后确认 HTTP / 新建 / 删除测试通过，并授权发布 `0.3.0`。用户未说明本轮验收的具体系统，不将其记为 Windows 实机验证。

### 0.3.0 发布验证（2026-11-10，正式发布完成）

- 用户确认采用 `A.B.C`：大功能或较大页面设计变化增加 `A` 并将 `B`、`C` 归零；新增小功能增加 `B` 并将 `C` 归零；Bug 修复增加 `C`。本轮新增 HTTP 克隆和目录操作，版本由 `0.2.3` 升至 `0.3.0`，规则同步至 AGENTS、CONTRIBUTING 与发布指南。
- `package.json`、`package-lock.json` 与 CHANGELOG 已更新为 `0.3.0`。Node.js 22.23.4 下 45 项测试全部通过，`npm run package` 的类型检查、构建和 VSIX 生成通过；隔离 VS Code 1.139.0 宿主通过激活、活动栏直接打开、原生命令、四类侧栏入口及管理页单实例检查。本轮宿主不重复执行真实服务器连接或目录删除；用户已确认上一测试包的 HTTP / 新建 / 删除操作通过。
- 本机正式 VSIX 为 574142 字节、20 个文件，SHA-256 为 `24ea90a2022ea42f19f37467c5b4a1a70f7079d3c27336856bcfe1c13c9bba0b`。ZIP 完整性、版本、UI 宿主声明、运行资源、askpass 可执行位和使用者文档与源码一致性检查通过；运行资源及 bundle 与用户确认的 `0.2.3-http-folders-test` 包逐字节相同。发布说明提取脚本已核对；后续 CI 和市场证据如下。
- 首次 main CI（[42747303568](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42747303568)）中 macOS / Ubuntu 通过；Windows 在 HTTP 匿名克隆后因 `core.autocrlf` 将夹具文本检出为 CRLF，导致固定 LF 字节断言失败。测试仓库新增 `.gitattributes` 固定该文件不做换行转换，保留内容断言，不改产品行为或跳过 Windows 测试。未推送正式标签，修正后重新运行三平台 CI。
- 功能提交 `fd8e421cebca8a4a020ee0f9c093d86c8238f3c6` 和测试夹具修正 `7064a926c38774b19458291c525eda572e8eef1d` 已推送 `main`。修正后 [main CI](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42761716005) 的 macOS / Windows / Ubuntu 检查全部通过；另在本机显式启用 `core.autocrlf=true` 验证 HTTP 夹具通过。
- 附注标签 `v0.3.0` 指向 `7064a926c38774b19458291c525eda572e8eef1d`。[标签工作流](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42762180653) 的三平台检查、GitHub Release 和 Marketplace OIDC 发布均成功；上传日志明确返回 `Published katcuu.ssh-workspace-manager v0.3.0.`，没有跳过版本。[Release](https://github.com/katcuu/vscode_ssh_workspace_manager/releases/tag/v0.3.0) 为正式版本，说明与 CHANGELOG 一致，附 CI 生成的 VSIX。
- Marketplace 官方查询确认版本 `0.3.0`，状态 `validated`，`lastUpdated` 为 `2026-11-10T05:35:36.54Z`。CI 安装包 574025 字节、20 个文件，SHA-256 为 `471f6ecb8504f6c74945e93fa30d9a90780132972da8d8c69d9616ebe673871c`；ZIP 完整性、manifest、bundle、界面和使用者文档核对通过。`.cmd` 的 CRLF 与 `.gitattributes` 一致；第三方许可证比本机少了 `retry` 的正文，已列为下述 `0.3.1` 修复，不能把这份产物记为许可证完整性通过。

### 0.3.1 发布验证（2026-11-10，正式发布完成）

- `retry` 的许可证文件为 `License`，此前构建脚本只尝试 `LICENSE` 等名称；macOS 默认文件系统忽略大小写，Linux 则漏读。新增缺失检查后也发现 `signal-exit` 的 `LICENSE.txt` 未被读取。构建脚本补全这两种实际文件名，并在任何运行时依赖许可证正文为空时立即失败，防止静默生成不完整的 notices。
- `0.3.0` 已经公开发布，因此保留其标签与产物，按用户的补丁规则递增为 `0.3.1`；此次只修复打包，不改插件运行代码或交互。manifest、锁文件及 CHANGELOG 已同步。
- Node.js 22.23.4 下 `npm run package` 的类型检查、构建、打包通过；本机 VSIX 574269 字节、20 个文件，SHA-256 为 `a143e7c6340c893a713c1d7fafaf305cd5b3e84673c8f7051461be89c0d75670`。ZIP、版本、UI 宿主声明、资源与源码一致性及九项依赖的真实许可证正文核对通过，bundle 和界面资源与用户确认测试包相同；本轮不重复完整 UI 操作。
- 补丁提交 `f5b688ed44ce2411ca7c4ce01e95515e91d189d2` 已推送 main；[main CI](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42765941459) 的 macOS / Windows / Ubuntu 全通过。推送标签前下载 Linux CI 包，确认九项许可证完整。附注标签 `v0.3.1` 指向该提交；[标签工作流](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42766283850) 的三平台检查、GitHub Release 和 Marketplace OIDC 上传均成功。
- [GitHub Release v0.3.1](https://github.com/katcuu/vscode_ssh_workspace_manager/releases/tag/v0.3.1) 为正式版本，说明与 CHANGELOG 一致；CI 官方 VSIX 为 574272 字节、20 个文件，SHA-256 为 `8ab9186e41b1eea913a6f16548deafde2c566f56e0ceed55327ed8d9a8839ffa`。下载后 ZIP、版本、UI 宿主声明、bundle、界面、用户文档、九项许可证及脚本权限检查通过；`.cmd` 的 CRLF 按 `.gitattributes` 验证。本机交付采用此正式 CI 安装包。
- Marketplace 上传日志明确返回 `Published katcuu.ssh-workspace-manager v0.3.1.`，没有跳过版本；官方公开查询返回 `0.3.1`、`flags: validated`，`lastUpdated` 为 `2026-11-10T06:12:58.757Z`。最终交付的本地 VSIX 与 GitHub Release / Marketplace 使用同一份 CI 产物。

### 0.2.3 发布验证（2026-11-09，正式发布完成）

- 用户确认上述测试包通过，并授权提交、正式发版及上架 Marketplace；版本已更新为 `0.2.3`，发布说明由 `CHANGELOG.md` 的对应版本提取。
- Node.js 22.23.4 下类型检查、37 项测试、构建与 `npm run package` 通过；发布前本机 VSIX 为 571385 字节、20 个文件，ZIP 完整性、版本、`extensionKind: ["ui"]` 及包内运行资源一致性检查通过。该次本机打包 SHA-256：`c425d1c120d25953702ecfc103f972b4730db1652d4c22fbd2cff0d3f93fef11`。
- VS Code 1.139.0 隔离宿主 `0.2.3` 基础 smoke 通过，管理页实际渲染正常。提示鼠标 / 键盘与窄窗口交互的验证记录见上一小节；本次自动化复验未捕获 Webview 子框架，未把它记为再次通过。此次仅调整版本和文档，运行逻辑及界面资源与用户确认的测试包一致。
- 发布提交 `9573ab95ca48ec997ccf360cb9b5bf7d95ce5204` 已推送至 `main`；[main CI](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42573095220) 的 macOS / Windows / Ubuntu 检查全部成功后，再推送指向该提交的附注标签 `v0.2.3`。
- [v0.2.3 标签工作流](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42574215684) 的三平台检查、GitHub Release 和 Marketplace OIDC 发布任务全部成功。发布日志明确返回 `Published katcuu.ssh-workspace-manager v0.2.3.`，没有跳过已有版本。
- [GitHub Release](https://github.com/katcuu/vscode_ssh_workspace_manager/releases/tag/v0.2.3) 为正式版本（非草稿、非预发布），已附上 CI 生成的 VSIX；发布说明与 `CHANGELOG.md` 对应版本一致。官方安装包为 571268 字节、20 个文件，SHA-256：`1f935567d4acdf78433d1ef2f791afe3e9871be9fd9981305bda6fd670dfefe2`；下载后核对 ZIP 完整性、版本、UI 宿主声明及运行资源 / 用户文档与源码一致。
- Marketplace 官方扩展查询接口返回 `0.2.3`，状态为 `validated`，`lastUpdated` 为 `2026-11-09T06:47:07.787Z`；[商店页面](https://marketplace.visualstudio.com/items?itemName=katcuu.ssh-workspace-manager) 可安装或更新。交付安装包采用上述 GitHub Release 的 CI 产物。

### 最近验证（0.2.2，2026-11-06）

- Node.js 22.23.4 下重新安装依赖，`npm run check`、`npm test`（24 项）、构建及 `npm run package` 均通过。
- 最终 VSIX 包含 17 个文件，压缩包校验通过；版本、`extensionKind: ["ui"]` 和包内 HTML / CSS / JS / askpass 文件与源码一致，Unix askpass 启动脚本保留可执行权限。VS Code CLI 在隔离扩展目录确认安装版本为 `katcuu.ssh-workspace-manager@0.2.2`。
- 隔离 VS Code 1.139.0 宿主通过扩展激活、活动栏直接打开、原生命令、四类侧栏入口和管理页单实例 smoke。另以本机临时 OpenSSH 服务验证 Git 密码 askpass、克隆检出内容及启动前取消；helper 路径含空格也通过。
- 修复了浏览连接中断后克隆进度不结束、非英文 Git 输出解析，以及 OpenSSH 不接受含参数的 askpass 程序路径问题。密码仅经 IPC 传递，不落盘。
- [v0.2.2 标签工作流](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/42194835467) 的 macOS / Windows / Ubuntu 检查、GitHub Release 和 Marketplace OIDC 发布任务全部成功；[GitHub Release](https://github.com/katcuu/vscode_ssh_workspace_manager/releases/tag/v0.2.2) 已附上 VSIX。
- Marketplace 官方扩展查询接口已返回 `0.2.2`，状态为 `validated`。详情页 HTML 暂时仍缓存 `0.2.1`，应以 Marketplace 查询接口的验证状态为准。
- 尚未覆盖 Windows 实机 UI、真实 Linux SSH 服务器的完整认证 → 浏览 → 当前 / 新窗口打开回归，以及最低 VS Code 1.99 的实机体验。CI 不运行真实远程 SSH 或 VS Code UI；后续交付按变更选择检查，不将以前的结果记为本轮新跑过的结果。

### 需要真实宿主的手工回归

1. 点击活动栏直接打开页面；重复点击和切换各入口不产生重复标签。
2. 从插件外打开本地及 SSH 工作区，多根逐根记录；重复打开只更新时间，名称与收藏保留。
3. 手动添加尚未打开目录不进入历史；关闭自动记录后再验证手动记录仍可用。
4. 历史与收藏跨来源搜索；收藏移除保留历史；仅删除记录同时移除收藏但保留文件；物理删除需二次确认完整路径，取消时文件及记录不变，路径已不存在时提示清理记录，删除失败保留记录。
5. 两个窗口同时收藏、重命名、记录、删除，修改及时互相可见且不覆盖其他修改。
6. 从远程窗口打开本地项目仍回到本机；两种窗口模式均传递正确的项目 URI。
7. 隐藏服务器后刷新仍隐藏，全局历史 / 收藏仍可打开，重新导入恢复；新增 Host 不改写旧配置。
8. 浏览中的单击 / 双击、隐藏目录、符号链接、取消、切换服务器、断线与重连保持正确目标。
9. 在 macOS / Windows 本机选择父目录，分别验证本机 SSH key / agent、HTTPS 提示、私钥口令取消、进度、取消和目标目录冲突；成功克隆只加入本地项目列表，打开后才进入历史，确认 Linux 服务器没有收到本机 Git 操作。

## 7. 常见故障定位

| 现象 | 优先检查 |
| --- | --- |
| 找不到入口 / 还是旧界面 | 安装 ID 与版本、是否仍有 local-dev 旧包、活动栏是否隐藏、是否需要 Developer: Reload Window、扩展是否因 Restricted Mode 或依赖未启用而未激活 |
| 图标出现但页面未自动打开 | activationEvents、TreeView ID、onDidChangeVisibility、initialize 的 visible 补偿，以及真实宿主 smoke |
| 历史没有新增 | 实际工作区根 URI 是否为 file 或受支持的 ssh-remote authority、自动记录设置、实际打开是否成功、目标窗口是否加载新版 UI 扩展 |
| 跨窗口不一致 | 是否为同一用户数据目录 / 档案、globalStorageUri、Store 写入异常、目录 watcher 和聚焦 snapshot；不要复制旧快照回写 |
| 提示目录记录无法读取 | 备份 catalog，校验 JSON / schema / 路径 ID；保留原文件，不能自动恢复成空目录 |
| 能 Remote SSH 打开但无法后台浏览 | 用相同 alias/config 检查 ssh -G 输出和本文支持范围、SFTP 子系统、agent 环境、密钥格式、known_hosts；两个连接能力不同 |
| 连接后提示上次目录不存在 | 路径栏会退回最近可访问的上级目录；若仍需其他位置，直接编辑路径并点“前往”。权限错误不会自动跳转，先检查目录权限或改用可访问路径 |
| “新窗口”激活已有窗口 | VS Code 会复用已打开相同文件夹的窗口，即使传了 forceNewWindow；不要靠私有命令强行复制窗口 |
| 目录浏览结果串到另一台服务器 | generation / requestSequence / selectedAlias 的过期回调检查是否被删除或遗漏 |
| 本地项目打开到错误位置或特殊字符截断 | Uri.file、forceLocalWindow；远程是否改成了字符串拼 URI；Windows 是否误用 POSIX 本地路径 |
| 新增 Host 后参数不符合预期 | 现有 Host * / Match / Include 的先匹配规则，用 ssh -G 核对；不能直接改用户配置顺序 |

页面显示面向用户的错误摘要。连接分阶段诊断见命令面板 **SSH Manager: 显示连接诊断** 打开的 **SSH Manager** 输出；扩展宿主日志和 Developer Tools 仅用于进一步排查，并先脱敏服务器、用户目录和凭据。

### Windows 首次 SFTP 连接（2026-11-02）

- 复现环境：Windows 25H2 / build 26200.9711（注册表 ProductName 为 Windows 10 Home China）；VS Code 1.143.1；Remote - SSH 0.128.0；已安装扩展路径 `%USERPROFILE%\.vscode\extensions\katcuu.ssh-workspace-manager-0.2.0`。
- Remote - SSH 与插件 `ssh -G` 默认解析均使用 `%WINDIR%\System32\OpenSSH\ssh.exe`（OpenSSH_for_Windows_9.5p2）；两者默认 `remote.SSH.path`、`remote.SSH.configFile` 均未设置。Remote - SSH 日志确认了该 SSH 路径；本机 `ssh-agent` 服务为 stopped / disabled，用户 SSH 配置及 `known_hosts` 哈希在本轮前后保留。
- 根因：`ssh2` 在连接 Windows named-pipe agent 失败时发出 `error.level === 'agent'`，随后会继续调用认证回调。旧版通用 `error` 监听器却立即销毁 SSH 连接并报告网络超时，因此尚未尝试配置密钥或提示密码。agent 可连但无身份时也需要继续尝试密钥 / 密码。
- 修复：agent 传输 / 签名错误作为可恢复认证事件记录，不结束 SSH 会话；继续依序尝试 IdentityFile 和密码。连接配置、OpenSSH 版本、TCP、握手、known_hosts、agent、密钥、密码、SFTP 初始化及目录操作写入 `SSH Manager` 输出；记录字段保留原始错误 code / level / message，用户名、主机、别名、用户目录和认证口令脱敏，口令缓冲仅保留到认证完成。
- 错误映射现在能区分 DNS 失败、端口拒绝、连接 / 握手超时、认证失败和 SFTP 初始化错误。新增命令 **SSH Manager: 显示连接诊断** 打开输出面板。未知主机仍要求本次确认，known_hosts 中已变化的密钥仍拒绝。
- 本机 Windows 闭环复现使用临时配置、临时密钥、空 / 不可达 agent 和本地 ssh2 SFTP 服务。默认 Windows pipe agent 不可达时，密钥和密码均成功；agent 返回空身份时也回退成功。Windows `ssh -G` 保留含中文和空格的配置 / 私钥路径。known_hosts 在这个隔离 fixture 中关闭以触发未知主机回调；主机变化拒绝、取消密码、缺失密钥、加密密钥、TCP 拒绝及错误诊断另由自动测试覆盖。
- 本机当时已经开着一个 Remote - SSH 窗口；本轮保留该现场，没有先打开新远程连接或更改服务、配置和 known_hosts。故没有把当前真实主机误记为“此前从未 Remote - SSH 连接”。使用独立 Node 进程连接当前真实服务器，known_hosts 命中，agent 报错后私钥认证成功，SFTP 列出 34 个家目录子文件夹，全程未触发密码 / 口令 / 信任回调；此结果不依赖当前窗口的 `vscode.workspace.fs`。

连接错误可从命令面板运行 **SSH Manager: 显示连接诊断** 查看。日志采用结构化阶段事件，不开启 `ssh2` 的协议 debug（其可能包含认证数据）。

## 8. 打包、安装与市场发布

正式版本遵循用户 2026-11-10 确认的 `A.B.C` 规则：大功能变更或较大页面设计变化递增 `A` 并将 `B`、`C` 归零；新增小功能递增 `B` 并将 `C` 归零；Bug 修复递增 `C`。同一发布取最高级别；规则、示例及命令集中见 [发布指南](RELEASE.zh-CN.md#版本号规则)。测试包保留当前版本，正式发布前再统一更新 manifest、锁文件、CHANGELOG 与 tag。

GitHub Release 正文由 `scripts/release-notes.mjs` 从 CHANGELOG 对应版本提取，要求标题已填写发布日期；发布脚本验证 tag 与 manifest 版本一致。正式发布仍沿用 `ci.yml` 的 OIDC 认证，不需要本机保存 Marketplace 令牌。

`README.md`、`CHANGELOG.md`、`PRIVACY.md` 是使用者文档。不要把 AI 接手过程、研究讨论、私人测试路径或内部待办塞进市场详情页。`.vscodeignore` 采用允许列表；AI 手册、AGENTS、测试、源码及开发文档均不打入 VSIX，运行时由 dist 提供。

当前正式版本通过匹配版本号的 Git tag 发布，完整流程和 Trusted Publishing 的一次性配置见 [自动打包与发布](RELEASE.zh-CN.md)。分支 push / PR 只运行三平台检查并生成 30 天有效的 Actions VSIX；推送 vX.Y.Z tag 且检查通过后，CI 会创建附带 VSIX 的 GitHub Release，并使用 OIDC 上传同一 VSIX 到 Marketplace。

Marketplace 自动发布已通过 Trusted Publishing 配置发布者 `katcuu`、仓库 `katcuu/vscode_ssh_workspace_manager` 和 workflow `ci.yml`；CI 使用 OIDC 发布，不需要 PAT 或仓库凭据。上传后 Marketplace 可能先显示 `Verifying`，公开目录版本更新会有延迟。

发布时先更新 package.json、package-lock.json 和 CHANGELOG，推送 main 并确认 CI 成功，再推送匹配的版本 tag。不要只因文档变更就发布新版。VSIX 和私人截图不提交到仓库。`0.2.1` 于 2026-11-02 发布；`0.2.2` 于 2026-11-06 通过 `v0.2.2` 标签发布，GitHub Release 和 Marketplace 均成功，Marketplace 官方查询接口状态为 `validated`。后续版本仍需核对 GitHub Actions 和 Marketplace 当前状态。需要账号登录或协议确认时由用户在浏览器处理。

## 9. 后续任务如何交接

已有需求已完成确认，后续修复不需要重新问一遍历史问题。对新功能先核对是否改变本地 / 远程范围、历史语义或实际文件操作，再就缺少的信息澄清。当前没有授权自动增加云同步、源码历史、任意文件编辑、跳板机实现或其他新范围；已授权的远程写操作限于 Git 克隆、目录新建及用户二次确认的目录删除。

可将以下内容连同仓库交给 AI：

```text
请先阅读根目录 AGENTS.md 和 docs/AI-HANDOFF.zh-CN.md，并核对当前代码与 git 状态。
本次目标：<要增加的能力，或故障现象与预期结果>。
复现信息：<客户端系统、VS Code / 插件版本、入口、步骤、脱敏后的来源与路径>。
请保留既有历史、收藏和 SSH 配置语义，完成修改及与变更相关的验证。
交付时说明改动、实际测试结果、未覆盖范围、提交和发布状态，并更新受影响的说明。
```

完成新任务时，更新本文中被改变的需求、架构、数据、限制或验证状态。仍未完成的工作写明复现和证据；不要让下一位接手者依赖聊天记录或上一台机器的临时文件。
