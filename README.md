# Automation Script

基于 [Violentmonkey（暴力猴）](https://github.com/violentmonkey/violentmonkey) 的 fork，为浏览器提供用户脚本安装、编辑、执行和管理功能。

- 项目包名：`automation-script`
- 扩展显示名称：`Automation Script`
- 项目仓库：[ZZZZJJJ0928/automation-script](https://github.com/ZZZZJJJ0928/automation-script)，Git remote 名为 `origin`
- 上游：`violentmonkey/violentmonkey`，Git remote 名为 `upstream`
- 默认分支：`automation-script`
- 初始基线：`97eb799d`（上游 `master`，2026-10-28 拉取）

保留上游 Git 历史、MIT 许可证和作者署名。上游说明见 [README.upstream.md](./README.upstream.md)。

## 本地开发

需要 Node.js 24 或更新版本，以及 `package.json` 指定的 pnpm 12.13.0。

```sh
pnpm install --frozen-lockfile

# Chrome / Chromium：Manifest V3
pnpm dev:mv3

# Firefox / 支持 Manifest V2 的浏览器
pnpm dev
```

没有全局 pnpm 时，可用 `npx --yes pnpm@12.13.0` 替代上述命令中的 `pnpm`。

## 构建和加载

```sh
# Chrome / Chromium，输出到 dist-mv3/
pnpm build:mv3

# Manifest V2，输出到 dist/
pnpm build
```

在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载本项目的 `dist-mv3/`。然后在 Automation Script 的详情页开启“允许运行用户脚本”。

Firefox 可在 `about:debugging` →“此 Firefox”→“临时载入附加组件”选择 `dist/manifest.json`。本地分支使用独立的 Firefox 扩展 ID `automation-script@local`。

## 检查

```sh
pnpm run ci
```

## 原有 QQ 邮箱脚本

此前目录中的脚本、说明、测试及 npm 配置保存在 [userscripts/qqmail-inbox-eml/](./userscripts/qqmail-inbox-eml/README.md)。原有截图保留在同一本地目录，已通过 `.gitignore` 排除上传。它是独立用户脚本，不会自动安装到扩展中。

```sh
cd userscripts/qqmail-inbox-eml
npm ci
npm test
```

## 上游兼容性

界面名称、页面标题、导出文件名前缀和新建脚本的命名空间已调整。内部 `Violentmonkey` 协议标识、`GM_info.scriptHandler`、备份数据格式及同步目录保留上游行为，以维持用户脚本和数据兼容性。

上游文档链接、图标、商店发布脚本及自托管更新地址仍保留；这些发布配置尚未适配本地分支。
