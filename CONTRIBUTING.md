# 开发与验证

使用 Node.js 22 或更新版本：

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

VS Code 打开仓库后按 F5，启动独立扩展开发宿主。`npm run package` 自动检查、构建，并生成 `artifacts/ssh-workspace-manager-<version>.vsix`。发布包只包含运行时、界面资源、用户文档及许可证。

## 结构

- `src/extension.ts`：VS Code 生命周期、命令、工作区观察和管理页控制。
- `src/serverTree.ts`：原生工作区侧边栏，提供服务器、本地、历史和收藏入口。
- `src/model.ts` / `store.ts`：数据校验、删除恢复和跨窗口持久化。
- `src/sshConfig.ts` / `sshConfigWriter.ts`：OpenSSH 配置读取及确认后的追加写入。
- `src/sftp.ts` / `trust.ts`：目录浏览、认证和主机密钥校验。
- `media/`：Webview、活动栏矢量图标及 Marketplace PNG 图标。
- `test/`：数据、配置与本地 SSH/SFTP 协议测试。
- `scripts/vscode-smoke.cjs`：在真实 VS Code 扩展宿主检查激活、活动栏直接打开和单实例页面。
- `docs/archive/`：早期调研与设计，不作为当前功能承诺，也不打入 VSIX。

协议测试使用临时生成的密钥和本地临时 SSH 服务器，不依赖个人 SSH 配置。不要将真实配置、地址、私钥或凭据提交到仓库。

手工验收：点击活动栏图标应同时打开项目栏和右侧页面；本地 / 远程工作区自动记录并按来源去重；历史删除整条记录、收藏移除保留历史；四种列表均可搜索和打开；创建服务器后检查已有配置未被改写；验证密钥 / agent / 密码的远程浏览及 Remote SSH 两种窗口打开。
