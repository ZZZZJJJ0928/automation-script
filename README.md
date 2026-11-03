# Automation Script

基于 [Violentmonkey（暴力猴）](https://github.com/violentmonkey/violentmonkey) 的 fork，为浏览器提供用户脚本安装、编辑、执行和管理功能。

本仓库仅维护 Automation Script 扩展及其通用 MCP 脚本管理、调用与结果通道。

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

加载后请保留此目录。重新构建后，在扩展管理页点击 Automation Script 的“重新加载”，再刷新需要运行脚本的网页。

### 从暴力猴迁移

1. 在原暴力猴的“设置 | 备份”中勾选“导出脚本数据”，导出 ZIP 备份。
2. 在 Automation Script 的“设置 | 备份”中勾选“导入脚本数据”和“导入设置”，导入该 ZIP，核对脚本数量。
3. 停用原暴力猴扩展，保留原扩展及备份，以便需要时恢复。刷新目标网页，避免两个管理器同时执行同一脚本。

Firefox 可在 `about:debugging` →“此 Firefox”→“临时载入附加组件”选择 `dist/manifest.json`。本地分支使用独立的 Firefox 扩展 ID `automation-script@local`。

## 检查

```sh
pnpm run ci
```

## MCP 脚本调用与返回结果

扩展提供上游已合并的 `GM.mcp`（`@grant GM.mcp` 或 `GM_mcp`）：脚本用 `GM.mcp.register({ 名称: { description, inputSchema, handle } })` 注册具名入口，MCP 通过 `script_handlers` 发现入口及其说明，用 `script_call` 按名称传参调用，取得同步或异步结果。入口收到的 `report` 绑定到本次调用，可在调用结束前后追加上报；`GM.mcp.report` 可主动上报与调用无关的结果。`script_results` 可按调用 ID 查询调用及其上报，支持并发关联、异常、超时和迟到结果。

本分支额外提供 `GM.mcp.saveFile({ name, data, directory })`：脚本取得下载内容后，可让扩展保存到浏览器下载目录下的可配置目录（默认 `automation-script/`，在「设置 → MCP → 文件保存目录」修改；`directory` 为追加的脚本子目录）。保存完成后返回 `fileId`、实际绝对路径 `path`、字节数 `size`、MIME 类型等信息；MCP 可通过 `script_files` 查询。支持 Blob、ArrayBuffer、TypedArray 和文本，单文件最多 16 MB。

需要同时使用本仓库的 [MCP 服务端与接入说明](./mcp/README.md)，并在扩展设置中授权目标标签页后刷新页面。上游 `@violentmonkey/mcp` 0.2.0 起已包含 `script_*` 调用工具，但不包含本分支的 `script_files` 和 `file_storage`。

## 上游兼容性

界面名称、页面标题、导出文件名前缀和新建脚本的命名空间已调整。内部 `Violentmonkey` 协议标识、`GM_info.scriptHandler`、备份数据格式及同步目录保留上游行为，以维持用户脚本和数据兼容性。

上游文档链接、图标、商店发布脚本及自托管更新地址仍保留；这些发布配置尚未适配本地分支。

邮件采集台现通过只读 MCP 工具 `file_storage` 自动同步文件保存目录，约 2 秒生效；支持离线恢复、重启后补扫描，以及新旧目录的内容去重。
