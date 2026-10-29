# Phase A：后台 SFTP 浏览原型

目标：先验证“管理页不离开当前窗口，使用 SSH 密钥/agent 或密码读取远程目录；选定后再交给官方 Remote SSH 打开”的最小闭环。

2026-10-29：已实现 0.0.1 原型，当前选用 `ssh2` 直接调用。已完成本机临时 SSH/SFTP 服务器的协议测试和 VS Code 开发宿主激活检查；真实 Linux 服务器、Remote SSH 正式打开和 Windows 实机验收待用户试用。密码输入目前使用 VS Code 原生密码框，未知主机仅本次信任，变化 / 撤销密钥拒绝连接。ProxyJump / ProxyCommand 等复杂配置先拒绝后台浏览。

## 认证状态机

```text
idle
  └─ 点击「后台连接并浏览」
       └─ trying-key-or-agent
            ├─ 成功 → browsing
            ├─ 认证失败且允许 password → password-required
            │    ├─ 输入密码 → connecting → browsing
            │    └─ 取消/失败 → idle 或 auth-error
            └─ 不支持/超时/网络错误 → fallback-remote-window
```

原型必须把“后台浏览连接”和“Remote SSH 编辑连接”分开显示。后台浏览成功不代表 VS Code 已经建立远程窗口；打开文件夹时仍由 Remote SSH 再次完成自己的连接与认证。

## 认证顺序

1. 从 SSH config 得到 alias、HostName、User、Port、IdentityFile 等连接参数。
2. 如果存在 `SSH_AUTH_SOCK` 或 Windows 可用的 agent，优先尝试 agent。
3. 读取配置中指定的私钥和默认密钥路径；加密私钥需要私钥口令时提示输入。
4. 只有上述方式失败，并且服务端公布 password 方法时，才显示服务器密码输入框。
5. 密码/口令只存在扩展宿主的本次连接对象中。清除输入控件、断开连接、取消连接、窗口关闭时立即释放；不写 `globalStorageUri`、SSH config、日志、遥测或 Webview 状态。
6. 认证失败最多允许用户主动重试；不能自动循环尝试密码，也不能把密码写进命令行参数或临时文件。

## 适配器候选

Phase A 同时做一个最小对比：

| 候选 | 价值 | 需要验证 |
| --- | --- | --- |
| `ssh2` | 纯 JavaScript SSH 客户端，公开支持 `agent`、`privateKey`、`passphrase`、`password` 和 SFTP 通道 | SSH config 的 ProxyJump/ProxyCommand、known_hosts 校验、VS Code Extension Host 的 Node 版本 |
| `ssh2-sftp-client` | 在 `ssh2` 之上提供 Promise API 和 `list()`，减少目录读取样板代码 | 当前版本的 Node 要求、依赖体积、错误分类和发布包兼容性 |
| 系统 `sftp` | 直接复用 OpenSSH 对 config、ProxyJump、agent 和主机密钥的处理 | 密码交互不能安全地通过标准输入传递；跨平台 askpass、取消和进程回收复杂，不作为首选密码方案 |

`ssh2` 文档明确列出 agent、私钥、口令、密码和 SFTP 能力；`ssh2-sftp-client` 文档展示了 `list()`、agent、私钥与密码连接。最终依赖以 Phase A 在 macOS 和 Windows 的 Extension Host 实测为准：[ssh2](https://github.com/mscdex/ssh2/blob/master/README.md)、[ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)。

首版只读目录。若复杂 SSH 配置无法被 Node 适配器安全复现，显示“不支持后台浏览此配置”，回退到官方 Remote SSH 窗口，不悄悄删掉 ProxyJump 或认证参数。

## 目录协议

```ts
type BrowseRequest = {
  requestId: string;
  serverId: string;
  path: string;       // Linux/POSIX absolute path
  signal?: AbortSignal;
};

type RemoteEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'directory-symlink';
};

interface BrowseAdapter {
  connect(server: Server, credentials?: EphemeralCredentials): Promise<BrowseSession>;
}

interface BrowseSession {
  listDirectories(path: string): Promise<RemoteEntry[]>;
  close(): Promise<void>;
}
```

目录列表只返回当前层的目录，不读文件内容，不递归。每个请求绑定 serverId、SSH alias 和会话 ID；切换服务器或关闭页面后，旧请求结果丢弃。连接空闲一段时间后关闭，下一次浏览重新走认证检查。

## 主机密钥与错误

原型必须验证 known_hosts。已知主机指纹继续使用本机 SSH 信任数据；未知或变化的指纹显示主机、算法和指纹，让用户明确接受或取消，不能默认接受。错误至少分为：密码错误、密钥/agent 不可用、主机指纹变化、权限不足、SFTP 子系统不可用、路径不存在、网络超时、配置不支持。

## Phase A 验收

- macOS：密钥、ssh-agent、密码、错误密码、取消密码、known_hosts、断线。
- Windows：同一组认证场景；验证 OpenSSH 路径、agent 环境变量和临时连接回收。
- 服务器配置：HostName、User、Port、IdentityFile、ProxyJump、Include、别名含空格/特殊字符的边界。
- 目录：根目录、中文、空格、`#`、`%`、符号链接、权限目录、空目录、路径不存在。
- 并发：快速切换两台服务器，旧列表不能覆盖新服务器；连接取消后不能残留密码或 SSH 进程。
- 打开：从后台浏览选中目录，调用 `vscode.openFolder`/Remote SSH；只有目标窗口实际观察到工作区根目录才写最近记录。

通过标准是：密钥或 agent 成功时无密码提示；失败后只显示一次明确密码入口；密码不落盘、不进日志；无法支持的配置有可理解回退；整个浏览过程管理页保持可用。
