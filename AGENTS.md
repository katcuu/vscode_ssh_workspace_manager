# AI 开发入口

这是 VS Code 扩展 **SSH Workspace Manager**，扩展 ID 为 `katcuu.ssh-workspace-manager`。它在本机统一管理本地及 SSH 项目文件夹，正式远程打开交给 Microsoft Remote - SSH。

## 接手顺序

1. 阅读 [开发交接手册](docs/AI-HANDOFF.zh-CN.md)，了解已确认需求、架构、验证与发布状态。
2. 阅读 [README](README.md)、[CONTRIBUTING](CONTRIBUTING.md) 和 [CHANGELOG](CHANGELOG.md)，对照当前 `package.json` 与源码。
3. 检查 `git status` 和相关实现，再针对本次任务修改；保留用户已有改动。

`docs/archive/` 是早期调研及原型记录，部分界面、版本和待办已过时，不能作为当前实现依据。交接手册中的发布和测试状态是带日期的记录，接手时需核对，不能推断新版本已经发布。

## 已确认的产品规则

- 支持 macOS / Windows 本机，远端主要是 Linux。扩展必须运行在本机 UI 扩展宿主：保留 `extensionKind: ["ui"]`。
- 点击活动栏图标直接打开管理页。原生左侧栏有全部服务器、本地文件、历史记录、收藏记录及各服务器；右侧显示项目，具体服务器页还可浏览远程目录。
- 只记录实际打开的工作区根文件夹，不记录源码文件、编辑器标签或安装前的 VS Code 历史。多根工作区按每个根目录记录。
- 同一来源和规范化路径只保留一条记录，重复打开更新时间并保留自定义名称和收藏。点击打开、仅浏览或手动添加，不能被当成打开成功。
- 历史中的删除移除整条记录及收藏；收藏中的移除只取消收藏并保留已有历史。任何记录操作都不删除实际文件。
- 删除服务器表示持久隐藏入口；保留 SSH 配置和项目记录，可重新导入。全局历史、收藏仍包含该服务器的项目。
- 本地和远程使用不同 URI / 路径处理方式。本地从 SSH 窗口打开也应回到本机窗口；远程路径保持 Linux POSIX 语义。
- SFTP 只读浏览优先 agent / 密钥，必要时提示密码。密码与私钥口令不持久化，不发送到 Webview。保留主机密钥校验和连接取消机制。

## 修改位置

| 工作 | 主要入口 |
| --- | --- |
| 生命周期、工作区记录、打开与消息处理 | `src/extension.ts` |
| 原生侧栏和活动栏入口 | `src/serverTree.ts`、`package.json` |
| 去重、迁移、路径、存储并发 | `src/model.ts`、`src/store.ts` |
| SSH 配置、认证、目录及主机信任 | `src/sshConfig.ts`、`src/sshConfigWriter.ts`、`src/sftp.ts`、`src/trust.ts` |
| 管理页与交互 | `media/dashboard.html`、`media/dashboard.js`、`media/dashboard.css` |

所有目录元数据修改通过 `CatalogStore.update()`；不能用 Webview 的旧快照覆盖存储。修改格式必须兼容既有数据，并同步迁移和测试。

正式版本标签、GitHub Release 和 Marketplace OIDC 配置见 [发布指南](docs/RELEASE.zh-CN.md)。

## 验证和交付

使用 Node.js 22，与 CI 保持一致：

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

按变更选择验证范围：逻辑变化跑相关测试及类型检查；界面和 VS Code 集成变化还需真实扩展宿主验收；交付 VSIX 前完成打包检查。纯文档修改核对链接、命令及事实，不必重复全套运行测试。`test/dashboard.test.ts` 的 DOM 替身不能证明真实布局或原生窗口行为。

不要手改 `dist/`，不要提交 `node_modules/`、`artifacts/`、个人目录截图、真实 SSH 配置或凭据。`README.md` 会展示在插件市场，保持面向使用者；AI 和开发说明放在本文件、`CONTRIBUTING.md` 及 `docs/`，这些文件通过 `.vscodeignore` 排除在安装包外。

功能变化同步用户说明和更新记录；架构、数据格式、支持范围、验证或发布流程变化同步交接手册。交付时说明实际修改、跑过的检查、未覆盖范围和发布状态；提交代码、生成 VSIX、本机安装、市场发布是不同步骤。
