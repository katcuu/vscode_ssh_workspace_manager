# 当前管理页触发后台连接：可行性核查

日期：2026-10-29。问题：能否留在当前管理页，让官方 Remote SSH 在后台连接服务器，并在本页浏览目录？

## 结论

从管理页发起 Remote SSH 连接可以设计实现。严格的“没有远程窗口、复用官方插件连接、把任意服务器目录返回本页”，本轮没有找到稳定公开接口支持，不能直接列为已确认能力。

用户期望优先保持当前页面；原先“到目标服务器窗口浏览”的方案降为回退。实现上需要在以下路线中选择，尤其要结合认证方式验证。

## 已核查证据

- 官方连接流程完成后进入远程窗口，再打开目录。[Remote SSH 文档](https://code.visualstudio.com/docs/remote/ssh#_connect-to-a-remote-host)
- 本机 Remote SSH 0.128.0 的 `package.json` 声明了 `opensshremotes.openEmptyWindow`、`openEmptyWindowOnCurrentHost`、`openEmptyWindowInCurrentWindow` 等命令，未声明供第三方调用的无窗口连接并列目录命令。这只是清单核查，不能证明所有内部能力均不存在。
- VS Code 的 `vscode.newWindow` 源码支持 remoteAuthority，能作为发起远程窗口的验证入口；没有用于本需求的公开“不建窗口并返回文件系统会话”契约。[官方源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/workspaceCommands.ts)
- 远程文件系统提供方使用本窗口 remote agent connection；不能把修改远程 URI 主机名当成连接另一台服务器的方法。[官方实现](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/remote/common/remoteFileSystemProviderClient.ts)
- Resolvers 接口公开请求仍在 backlog；提案 API 不适合作为普通 Marketplace 扩展的发布基础。[接口请求](https://github.com/microsoft/vscode/issues/148316)、[提案 API 文档](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)

## 三条路线

| 路线 | 原管理页浏览 | 官方 Remote SSH 会话 | 主要限制 |
| --- | --- | --- | --- |
| 官方远程窗口 + 当前窗口读取 | 需要到目标窗口浏览 | 使用 | 最直接，体验需要切换窗口 |
| 官方远程窗口 + 跨窗口转发目录 | 可作为技术原型验证 | 使用 | 仍需要远程窗口；未核实无抢焦点创建/隐藏窗口能力；要做窗口发现、可信主机确认和请求转发 |
| 本机 OpenSSH/SFTP 浏览，选好后 Remote SSH 打开 | 可以按这个目标设计 | 编辑阶段使用；浏览另建连接 | 可共用配置、密钥和 agent，但不能保证共用登录会话；密码/验证码可能再次输入 |

第二条只能称为“把结果汇总到原页”，不能宣称官方提供了无窗口后台连接。不能通过自动隐藏、最小化或抢回焦点来掩盖窗口副作用。

第三条最符合“先在当前页看目录，最后才打开编辑窗口”的体验，是当前建议研究的路线，还没有连接实测。它扩大了浏览层的实现范围，不应冒称仅是调用一个 Remote SSH 命令。

## 建议的浏览路线

1. 页面选择服务器并点击“连接浏览”，展示连接进度；管理页保留在当前窗口。
2. 已经属于当前远程窗口的目标优先用 `workspace.fs`。其他目标由本机 OpenSSH/SFTP 适配器建立轻量连接，通过 SFTP 读取当前层目录。
3. 先尝试 SSH agent、默认密钥及配置中指定的密钥；成功后不显示密码框。密钥/agent 认证失败且服务器支持密码认证时，才在当前页显示密码输入框，再用密码建立本次浏览连接。
4. 使用同一个 SSH 别名、指定配置文件、系统密钥与 ssh-agent；由 OpenSSH 或兼容适配器处理其支持的 Include、ProxyJump 等语义，不用自建解析器重造完整连接配置。[SSH 配置](https://man.openbsd.org/ssh_config)、[SFTP 手册](https://man.openbsd.org/sftp)
5. 单击选中、双击进入，只获取目录元数据。按需连接当前目标，空闲后回收；不预连全部服务器。后台浏览不写工作区历史。
6. 选好文件夹后点击“当前窗口打开/新窗口打开”，交给 VS Code 与官方 Remote SSH 建立编辑环境。目标窗口实际观察到目录后才更新最近记录。

管理数据依旧只在本机保存。远程浏览通道只负责读取，编辑、终端、调试和 VS Code Server 生命周期继续由 Remote SSH 管理。

## 认证和兼容性验证

认证状态明确显示为：`尝试密钥/agent` → `需要密码` → `连接中` → `浏览可用` 或 `连接失败`。密码输入框使用 VS Code 的 password 输入控件；密码只驻留本次 SFTP 会话内存，断开、取消或窗口关闭后清除，不写共享 JSON、不进入日志、不传给 Webview 以外的组件。加密私钥没有可用 agent 时，允许同样方式输入私钥口令，但不保存口令。

密钥已解锁且主机已受信任时有机会无需输入；密码、密钥口令、首次主机确认、验证码仍需相应交互。正式打开时 Remote SSH 是否再次询问，由其自身认证过程决定。

实现前验证 macOS/Windows 的 OpenSSH 路径、SSH 配置与跳板、agent、host-key 确认、密码/口令提示、只读 SFTP 子系统可用性、连接取消/超时/释放。SFTP 被禁用或认证工具不兼容时明确显示原因，回退到官方远程窗口浏览；不自动换成未验证的 shell 列目录命令。

不承诺借助已有 ControlMaster 在两平台通用地复用同一连接；不访问官方插件的私有 socket、令牌或 VS Code Server 协议。所有路线都还需要真实连接原型验证。
