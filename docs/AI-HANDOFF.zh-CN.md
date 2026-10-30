# SSH Workspace Manager 开发交接手册

维护日期：2026-10-30。实现基线：`0.2.0`，功能提交 `8e404a41f4afbcebe65492d3701b22fec8194196`。

本手册用于让后续 AI 或开发者独立接手功能开发、定位问题和验证交付。入口规则见 [AGENTS.md](../AGENTS.md)，使用说明见 [README](../README.md)。具体行为和命令以当前源码、`package.json` 为准；修改实现时同步更新本文。

## 1. 项目目标与交付状态

用户通常管理 10 台以内服务器、每台 10 个以内项目。原生 Remote Explorer 太窄，长路径难辨认，也不便跨服务器找回打开过的项目。本扩展提供原生服务器侧栏和宽幅项目管理页，复用 Remote SSH 打开编辑工作区。

| 项目 | 交接基线 |
| --- | --- |
| 仓库 | [katcuu/vscode_ssh_workspace_manager](https://github.com/katcuu/vscode_ssh_workspace_manager) |
| 扩展 / 发布者 | `katcuu.ssh-workspace-manager` / `katcuu`，MIT |
| 版本与最低 API | `package.json` 为 `0.2.0`；VS Code `^1.99.0` |
| 平台 | macOS / Windows 客户端；Linux SSH 服务器 |
| 本机交付 | 0.2.0 已打包、安装并在 macOS VS Code 1.139.0 验收主要界面 |
| 市场 | 0.1.0 此前已发布；本次 0.2.0 功能交付尚未发布到市场 |
| 自动验证 | 11 个测试通过；Ubuntu、macOS、Windows 的 CI 检查通过 |

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

### 记录与操作语义

- 自动记录 VS Code 实际打开的工作区根目录，包含通过其他入口打开的项目。多根工作区逐根记录，不把 `.code-workspace` 文件单独作为项目。
- 用户明确不需要源码文件、编辑器标签页历史，也不要求导入安装前的 VS Code 历史。
- 同一位置重复打开只更新一条记录的时间，保留收藏和自定义显示名称。不同 SSH 别名下的相同路径属于不同位置。
- 只添加、浏览或收藏目录不产生打开历史；取消连接或打开失败也不能提前写入历史。
- 关闭 `sshWorkspaceManager.recordFolders` 后停止自动记录；“记录当前工作区文件夹”命令仍可手动记录。
- 历史或普通列表的“删除记录”删除整个项目元数据，收藏一起移除。收藏列表的“取消收藏”只改收藏状态，保留原记录及已有历史。
- “重命名”只改显示名称；“删除记录”只改本机元数据，均不操作实际文件。删除后再次实际打开会重新记录。
- 删除服务器只将别名写入隐藏列表；刷新仍保持隐藏，已有 SSH 配置及项目保留，可从导入入口恢复。全局历史和收藏仍可打开它的项目。
- 每条记录支持当前窗口和新窗口打开。本地项目从远程窗口操作时仍打开本机工作区；远程项目交给 Remote SSH。

### 新目录浏览与认证

具体服务器页面可以“连接并浏览”：单击选中目录、双击进入、返回上级、面包屑跳转、输入绝对路径，支持隐藏目录和指向目录的符号链接。没有选中子目录时，收藏或打开的对象是当前浏览目录。

认证优先 agent / 密钥，没有可用凭据时使用 VS Code 原生密码输入。后台 SFTP 与 Remote SSH 是不同连接，正式打开时可能再次认证。当前没有可复用的公开 Remote SSH 接口来保证任意未连接服务器在原页面后台完成目录浏览，因此保留独立 SFTP 路线。

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
| `src/sftp.ts` / `src/trust.ts` | `ssh2` 认证、SFTP 只读浏览、超时取消、known_hosts 与指纹 |
| `media/dashboard.html/js/css` | 页面结构、列表筛选排序、消息交互、主题和长路径换行 |
| `scripts/build.mjs` / `package.mjs` | esbuild 打包、第三方许可证、VSIX 生成 |
| `test/` / `scripts/vscode-smoke.cjs` | 逻辑及协议测试 / 真实 VS Code 扩展宿主验证 |

初始化过程：创建本机存储目录 → 在适用时迁移 `local-dev` 数据 → 记录当前实际根目录 → 读取 SSH 配置并生成快照 → 监听存储和工作区变化。工作区事件只记录 `event.added`，移除一个根目录不能刷新其他项目的打开时间。窗口获得焦点只刷新快照。

目录元数据变更经 Store 写入后，当前窗口更新快照；其他窗口通过目录级 `fs.watch`、300ms 防抖和重新聚焦刷新看到新数据。快照序号避免较早的异步读取覆盖新状态。原生侧栏仅在服务器列表发生变化时重建，避免频繁刷新导致选择不稳定。

页面 `ready` 请求 `snapshot`。列表打开消息只传记录 ID 与 `mode: "current" | "new"`；扩展从最新 Store 查回合法记录再构造 URI。浏览器中的打开还需校验当前服务器和目录。修改交互时同时检查 `handleMessage()`、前端 `send()` / 消息监听及相应测试，不只改按钮文字。

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

VS Code 打开仓库后按 F5，使用 `.vscode/launch.json` 启动扩展开发宿主；预启动任务会 build，但不是持续监听，改 TypeScript 后需重新构建并重启 / 重新加载宿主。远程打开验收需要在该测试环境安装 Remote - SSH。开发宿主和已安装的正式扩展不是同一个运行实例，核对实际扩展 ID 和版本。

### 自动测试各自证明什么

| 检查 | 覆盖范围 | 未覆盖 |
| --- | --- | --- |
| `test/core.test.ts`，8 个测试 | 本地 / 远程路径与 ID、去重、schema 迁移、Host / Include、known_hosts、并发存储与损坏保护、隐藏恢复、SSH 配置追加 | 原生 UI、真实公网连接 |
| `test/dashboard.test.ts`，2 个测试 | 执行实际 dashboard.js，检查列表、排序、来源搜索、打开 ID 消息、删除 / 取消收藏区别 | DOM 替身不能验证真实排版、点击焦点或 VS Code 窗口 |
| `test/sftp.test.ts`，1 个测试 | 临时密钥和本地 SSH/SFTP 服务，验证公钥优先、密码回退、拒绝信任、目录 / 符号链接、错误与取消 | 用户实际 agent、跳板机、多因素认证、真实服务器环境 |
| `scripts/vscode-smoke.cjs` | 真实宿主激活、命令、活动栏直接打开、单实例管理页、四种入口、特殊字符 URI | 不进行真实 Remote SSH 连接 |

协议测试使用临时服务和临时密钥，不修改个人 SSH 配置。测试环境必须允许监听回环端口；若运行器禁止监听，记录环境限制，不能把协议测试改成跳过后声称全部通过。

真实宿主 smoke 可用 VS Code CLI 配合独立的 `--user-data-dir`、`--extensions-dir`、`--extensionDevelopmentPath <仓库绝对路径>` 和 `--extensionTestsPath <仓库绝对路径>/scripts/vscode-smoke.cjs` 执行。先为隔离扩展目录安装 Remote - SSH，并使用可信的测试工作区。可设置 `SSH_MANAGER_SMOKE_RESULT` 为结果 JSON 的绝对路径；此脚本不是直接用 `node` 运行的测试。

额外设置 `SSH_MANAGER_SMOKE_CATALOG` 才启用多根本地历史分支：它必须指向隔离宿主实际使用的 catalog，启动工作区须至少有两个本地根目录，并预置一条 schema 1 的远程收藏。该分支检查迁移、根目录名称、去重和移除根目录不刷新其他历史；它会移除第二个工作区根目录，因此只能使用临时 fixture，重跑前恢复 fixture。不设该变量时，结果里的 `localHistory` 会是 `not tested`。

### 交接基线的验证证据

0.2.0 的 11 个测试、类型检查、构建及打包已通过。VS Code 1.139.0 的隔离宿主 smoke 包括上述多根历史分支；macOS 中也检查了安装版本的入口、混合历史、搜索和取消收藏保留记录。

功能提交的 [CI run 41029849954](https://github.com/katcuu/vscode_ssh_workspace_manager/actions/runs/41029849954) 已成功，矩阵为 Ubuntu / macOS / Windows，Linux 额外生成 VSIX。CI 不运行真实 VS Code UI 或公网 Remote SSH。

这不是对后续提交的保证。尚未覆盖 Windows 实机 UI、真实 Linux 服务器完整的认证 → 浏览 → 当前 / 新窗口打开回归，以及最低 VS Code 1.99 的实机体验。后续交付按变更选择检查，不将以前的结果记为本轮新跑过的结果。

### 需要真实宿主的手工回归

1. 点击活动栏直接打开页面；重复点击和切换各入口不产生重复标签。
2. 从插件外打开本地及 SSH 工作区，多根逐根记录；重复打开只更新时间，名称与收藏保留。
3. 手动添加尚未打开目录不进入历史；关闭自动记录后再验证手动记录仍可用。
4. 历史与收藏跨来源搜索；收藏移除保留历史，历史删除同时移除收藏，实际文件保持完整。
5. 两个窗口同时收藏、重命名、记录、删除，修改及时互相可见且不覆盖其他修改。
6. 从远程窗口打开本地项目仍回到本机；两种窗口模式均传递正确的项目 URI。
7. 隐藏服务器后刷新仍隐藏，全局历史 / 收藏仍可打开，重新导入恢复；新增 Host 不改写旧配置。
8. 浏览中的单击 / 双击、隐藏目录、符号链接、取消、切换服务器、断线与重连保持正确目标。

## 7. 常见故障定位

| 现象 | 优先检查 |
| --- | --- |
| 找不到入口 / 还是旧界面 | 安装 ID 与版本、是否仍有 local-dev 旧包、活动栏是否隐藏、是否需要 Developer: Reload Window、扩展是否因 Restricted Mode 或依赖未启用而未激活 |
| 图标出现但页面未自动打开 | activationEvents、TreeView ID、onDidChangeVisibility、initialize 的 visible 补偿，以及真实宿主 smoke |
| 历史没有新增 | 实际工作区根 URI 是否为 file 或受支持的 ssh-remote authority、自动记录设置、实际打开是否成功、目标窗口是否加载新版 UI 扩展 |
| 跨窗口不一致 | 是否为同一用户数据目录 / 档案、globalStorageUri、Store 写入异常、目录 watcher 和聚焦 snapshot；不要复制旧快照回写 |
| 提示目录记录无法读取 | 备份 catalog，校验 JSON / schema / 路径 ID；保留原文件，不能自动恢复成空目录 |
| 能 Remote SSH 打开但无法后台浏览 | 用相同 alias/config 检查 ssh -G 输出和本文支持范围、SFTP 子系统、agent 环境、密钥格式、known_hosts；两个连接能力不同 |
| “新窗口”激活已有窗口 | VS Code 会复用已打开相同文件夹的窗口，即使传了 forceNewWindow；不要靠私有命令强行复制窗口 |
| 目录浏览结果串到另一台服务器 | generation / requestSequence / selectedAlias 的过期回调检查是否被删除或遗漏 |
| 本地项目打开到错误位置或特殊字符截断 | Uri.file、forceLocalWindow；远程是否改成了字符串拼 URI；Windows 是否误用 POSIX 本地路径 |
| 新增 Host 后参数不符合预期 | 现有 Host * / Match / Include 的先匹配规则，用 ssh -G 核对；不能直接改用户配置顺序 |

错误当前通过管理页提示或 VS Code 消息显示，没有专用日志服务。需要宿主日志时查看 VS Code 的扩展宿主日志和 Developer Tools，并先脱敏服务器、用户目录和凭据。

## 8. 打包、安装与市场发布

`README.md`、`CHANGELOG.md`、`PRIVACY.md` 是使用者文档。不要把 AI 接手过程、研究讨论、私人测试路径或内部待办塞进市场详情页。`.vscodeignore` 采用允许列表；AI 手册、AGENTS、测试、源码及开发文档均不打入 VSIX，运行时由 dist 提供。

需要发布新版本时，按本次授权范围完成以下步骤：

1. 同步 `package.json`、`package-lock.json` 的版本及 CHANGELOG，检查用户说明、隐私说明和扩展身份未遗漏。
2. 完成相关测试、类型检查、真实宿主验收和 `npm run package`。检查 VSIX 的 manifest、运行时、页面资源、图标、用户文档和第三方许可证；新增资源需同步允许列表。
3. 使用 `code --install-extension <VSIX绝对路径> --force` 在测试环境安装并重新加载窗口，核对运行的是新版本。不要为测试关闭用户其他 SSH 窗口。
4. 将本次代码提交并推送到既有 GitHub 仓库，核对 CI。`artifacts/` 是本地交付目录，不提交安装包和私人截图。
5. 使用发布者 `katcuu` 在官方管理页上传新版本 VSIX，或在已有合法发布凭据的环境使用官方 vsce 发布。无需为了文档修改自动发新版。
6. 上传后等待验证，检查管理页状态及公开详情页实际版本。只有确认上线后才更新“已发布”记录。

用户已创建发布者并完成过 0.1.0 上传。需要账号登录、协议确认或 CAPTCHA 时由用户在浏览器处理；不要索取、记录或提交密码 / PAT。0.2.0 是否后续已发布，接手时重新核对。

## 9. 后续任务如何交接

已有需求已完成确认，后续修复不需要重新问一遍历史问题。对新功能先核对是否改变本地 / 远程范围、历史语义或实际文件操作，再就缺少的信息澄清。当前没有授权自动增加云同步、源码历史、远程写文件、跳板机实现或其他新范围。

可将以下内容连同仓库交给 AI：

```text
请先阅读根目录 AGENTS.md 和 docs/AI-HANDOFF.zh-CN.md，并核对当前代码与 git 状态。
本次目标：<要增加的能力，或故障现象与预期结果>。
复现信息：<客户端系统、VS Code / 插件版本、入口、步骤、脱敏后的来源与路径>。
请保留既有历史、收藏和 SSH 配置语义，完成修改及与变更相关的验证。
交付时说明改动、实际测试结果、未覆盖范围、提交和发布状态，并更新受影响的说明。
```

完成新任务时，更新本文中被改变的需求、架构、数据、限制或验证状态。仍未完成的工作写明复现和证据；不要让下一位接手者依赖聊天记录或上一台机器的临时文件。
