# 自动打包与发布

## 触发规则

- 推送到 main 或创建 Pull Request：运行 Ubuntu、macOS、Windows 三平台检查；Ubuntu 生成 VSIX，作为 Actions 构建产物保留 30 天。
- 推送形如 vX.Y.Z 的 Git tag：运行相同的三平台检查，并验证 tag 与 package.json 的版本完全一致。检查通过后，GitHub Release 附上 VSIX，同时把同一个 VSIX 发布到 Visual Studio Marketplace。
- 普通分支提交不会创建 GitHub Release，也不会上传 Marketplace。

自动发布不会替开发者递增版本号。新版本需要先在 main 更新扩展版本和 CHANGELOG，再通过一个匹配的 tag 发布。

## 发布新版本

先选定一个尚未发布的版本号，例如 0.2.1。在仓库根目录运行以下命令；把示例版本换成实际版本：

```sh
npm version 0.2.1 --no-git-tag-version
```

检查 package.json 和 package-lock.json 的版本已更新，补充 CHANGELOG，完成相关验证，然后提交并推送 main。确认 GitHub Actions 的三平台检查通过后，创建并推送版本 tag：

```sh
git tag v0.2.1
git push origin v0.2.1
```

打开该 tag 对应的 Actions run。所有检查通过后：

- GitHub Release 会附上 ssh-workspace-manager-0.2.1.vsix，可长期下载。
- Marketplace job 会用 OIDC 上传该 VSIX。Marketplace 仍需完成平台扫描和验证后才会显示新版本。
- Actions 页面也会提供同一 VSIX 构建产物，保留 30 天。

tag 与 package.json 版本不一致时，检查会失败，两个发布 job 都不会运行。重复执行已有版本时，Marketplace 会跳过已存在的版本；新内容必须先递增版本再发布。

## 一次性启用 Marketplace 自动发布

Microsoft Marketplace 支持 GitHub Actions Trusted Publishing。它使用 GitHub 的短期 OIDC 身份凭据，不需要创建或保存 PAT / VSCE_PAT。官方说明见 [Trusted publishing 文档](https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview?view=azure-devops) 与 [vsce Trusted Publishing 文档](https://github.com/microsoft/vscode-vsce#trusted-publishing)。

使用发布者 katcuu 的 Microsoft 账号打开 [Publisher 管理页面](https://marketplace.visualstudio.com/manage/publishers/katcuu)，在 Trusted Publishing 中为 GitHub Actions 添加一次策略：

| 策略字段 | 值 |
| --- | --- |
| Repository owner | katcuu |
| Repository | vscode_ssh_workspace_manager |
| Workflow file | ci.yml |
| Environment | 留空；当前 workflow 没有使用 GitHub Environment |

保存策略后，下一次推送匹配版本的 tag 就会自动发布。若策略尚未配置或字段不匹配，Marketplace job 会失败，但 GitHub Release job 仍会独立上传 VSIX。修正策略后，可在 Actions 中重新运行失败的 workflow。

Workflow 字段填写 .github/workflows 下的文件名 ci.yml。文件改名时，也要同步更新 Trusted Publishing 策略。发布 job 的 id-token: write 权限只授予 Marketplace job；不要将该权限提升到整个 workflow。

## 手动发布与本地打包

若暂时不启用 Trusted Publishing，可从成功的 Actions run 下载 VSIX，或从 GitHub Release 下载对应版本，再登录 Publisher 管理页面手动上传。上传后等待 Marketplace 验证完成。

本地打包仍可使用：

```sh
npm ci
npm run package
```

VSIX 会写入 artifacts/ssh-workspace-manager-<version>.vsix。CI 与 OIDC 使用仓库锁定的 @vscode/vsce 4.x 和 Node.js 22。Microsoft 的 [扩展发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) 介绍了 VSIX 与 Marketplace 发布方式。
