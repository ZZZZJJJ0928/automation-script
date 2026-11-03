# 脚本调用与结果通道

此服务端基于上游 `@violentmonkey/mcp` 0.2.0，保留其脚本管理工具和已合并的 `script_handlers`、`script_call`、`script_results`，并增加本分支的 `script_files`、`file_storage`。需要同时使用本分支构建的扩展和此服务端；原版上游服务端会过滤 `script_files` 和 `file_storage`。

## 启动

```sh
npm ci --prefix mcp
node mcp/cli.mjs --port 5678
```

默认使用 stdio，可将 `node` 和本仓库 `mcp/cli.mjs` 的绝对路径配置到 MCP 客户端。终端输出的授权链接含有连接令牌，应只在自己的浏览器中打开。在扩展设置中批准连接、授权目标标签页，再刷新该标签页。安装或修改脚本后也需要重新加载脚本所在页面。

`--http` 改为 HTTP 模式，端点为 `http://127.0.0.1:5678/mcp`，客户端需携带 `Authorization: Bearer <token>`。可以通过 `AUTOMATION_SCRIPT_MCP_TOKEN` 环境变量指定令牌，否则随机生成。`--readonly` 禁止脚本调用，允许读取已上报结果和文件信息。服务只监听本机。

如果已有本地服务使用 `startServer`，将导入改为本仓库 `mcp/server.mjs` 的路径即可，原有 `port`、`token`、`transport`、`readonly`、`callTimeoutMs` 等参数与上游一致。不要同时占用同一端口。

## 注册具名入口

脚本通过 `GM.mcp.register` 注册一个或多个具名入口，MCP 按名称传参调用。普通用户脚本自动注入时，其顶层 `return` 不会自动作为 MCP 结果；应把需要远程调用的逻辑放入入口的 `handle`。

```js
// ==UserScript==
// @name         MCP result example
// @namespace    local.automation-script.examples
// @match        https://example.com/*
// @grant        GM.mcp
// ==/UserScript==

GM.mcp.register({
  readTitle: {
    description: '读取当前页面标题和地址',
    handle: () => ({ title: document.title, url: location.href }),
  },
  sum: {
    description: '计算 a + b',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    handle({ params }) {
      if (typeof params?.a !== 'number' || typeof params?.b !== 'number') throw new Error('需要数字 a 和 b');
      return params.a + params.b;
    },
  },
}).catch(console.error);
```

`@grant GM_mcp` 搭配 `GM_mcp.register(...)` 效果相同。名称为 1–64 个字母、数字、`_`、`.` 或 `-`，每个脚本每个 frame 最多 32 个。重复注册同名入口会替换它，其他入口保留。`register` 返回 Promise，在扩展接受后解析为 `unregister()`，它只移除这次注册且之后未被替换的入口。

`description` 和 `inputSchema` 会出现在 `script_handlers` 中，供 agent 了解入口用途和参数。`inputSchema` 只是提示，扩展不按它校验参数，`handle` 需要自行检查输入。

`handle({ params, report })` 的同步返回值或 Promise 完成值会作为调用结果；抛出异常、Promise 拒绝、循环引用、BigInt 或超过大小限制的结果会使调用 `failed` 并带上 `error`。结果遵循 JSON 序列化规则，顶层 `undefined` 转为 `null`，`false`、`0`、空字符串、数组和对象保留原值。

## MCP 调用

先用现有 `tabs_list` 找到已授权的 `tabId`，然后：

| 工具 | 参数示例 | 返回内容 |
| --- | --- | --- |
| `script_handlers` | `{"tabId":7}` | 按脚本和 frame 列出入口名称、`description`、`inputSchema` |
| `script_call` | `{"tabId":7,"scriptId":1,"handler":"readTitle","callId":"read-001"}` | 等待执行完成，返回 `result` |
| `script_results` | `{"tabId":7,"callId":"read-001"}` | 查询该调用及其上报 |

成功的 `script_call` 示例：

```json
{
  "result": {
    "kind": "call",
    "callId": "read-001",
    "handler": "readTitle",
    "scriptId": 1,
    "frameId": 0,
    "documentId": "document-identifier",
    "seq": 2,
    "status": "completed",
    "startedAt": 1793318400000,
    "finishedAt": 1793318400010,
    "value": { "title": "Example Domain", "url": "https://example.com/" }
  }
}
```

`script_call` 的 `handler` 必填，其他可选参数：

- `params`：默认 `null`，传给 `handle` 的 JSON 参数。
- `frameId`：默认 `0`，对应主文档。
- `callId`：省略时自动生成，指定时为 1–128 字符。在结果仍保留期间，同一标签页中相同 ID、脚本、frame、入口和相同序列化参数的重试复用已有调用，不重复执行；不同参数或入口复用 ID 会报错。
- `timeoutMs`：默认 10000，范围 1–25000 毫秒。
- `wait`：默认 `true`；设为 `false` 立即返回 `pending` 和调用 ID，之后查询 `script_results`。

结果状态为 `pending`、`completed`、`failed`、`timed_out` 或 `cancelled`。**MCP 请求成功不代表脚本成功，调用方应检查 `result.status`。** 业务异常在结果的 `error` 字段中；未授权（403）、参数错误（400）或找不到入口（404）属于 MCP 工具错误。

超时只结束等待，不会停止页面里的代码或撤销其操作。迟到的返回值会把调用更新为 `completed` / `failed`，可继续查询同一 `callId`。长任务建议使用 `wait:false`，完成后查询；不要因为超时就用新的 ID 重复发起有副作用的任务。刷新页面会取消对应文档中的未完成调用，旧文档的回包会被拒绝。

通过浏览器前进或后退从页面缓存恢复时，只要原 MCP 连接和标签页授权仍有效，扩展会自动恢复已注册的入口及其说明、结果和文件通道，无需重新执行脚本。恢复后的通道使用新令牌，离开页面前的调用不会重新执行或接收迟到结果。授权曾被撤销、连接断开或扩展后台重启后，仍需重新授权并刷新页面。

## 上报结果

`handle` 收到的 `report(value, { error }?)` 绑定到本次调用，脚本无需处理调用 ID。它可以多次调用，在调用结束或超时后仍可使用，适合报告进度或后续结果：

```js
GM.mcp.register({
  scan: {
    async handle({ report }) {
      await report({ stage: 'started' });
      setTimeout(() => report({ stage: 'cleanup-done' }).catch(console.error), 1000);
      return { count: 12 };
    },
  },
});
```

与调用无关的页面事件或后台监听结果，用 `GM.mcp.report`：

```js
await GM.mcp.report({ type: 'scan-completed', count: 12 });
// MCP：script_results({ tabId, scriptId }) 读取。
```

两种 `report` 都返回 Promise，成功时解析为 `undefined`；授权失效、文档已离开、调用记录已不在保留期内或序列化失败时拒绝。可传第二个参数 `{ error: 'message' }` 上报失败。

`script_results` 支持 `scriptId`、`callId`、`afterSeq`、`limit`（默认 50，最多 100），返回 `{ entries, nextSeq, dropped }`。条目分两类：`kind: "call"` 是调用记录，`kind: "report"` 是上报，绑定到调用的上报带有该调用的 `callId`。按 `callId` 查询会返回调用和它的上报。读取不消费结果；调用状态变化时其 `seq` 会更新，后续用 `afterSeq: nextSeq` 获取新增或状态更新的条目。

结果仅驻留内存，结束的调用和上报最多保留 5 分钟，上报会延长所属调用的保留时间；每标签页最多 100 条、32 个在途调用，总量约 2 MB。单次参数、返回值或上报的 JSON 字符串最多 256k 字符，错误信息最多 8,192 字符。`dropped` 是被容量或过期清理的累计条数。关闭标签页、撤销授权、断开连接或扩展后台重启会清空状态；保留窗口之外没有幂等保证，需要持久幂等的业务应在脚本或业务服务中自行保存调用 ID。

## 文件保存与传输

首次使用前，在扩展「设置」中勾选「使用浏览器下载 API」，并允许浏览器请求的下载权限。下载权限是可选权限；尚未授权时 `GM.mcp.saveFile` 会明确报错，不会开始保存。

脚本先取得文件内容，交给扩展写入磁盘；扩展确认下载状态为 `complete` 后，才返回文件信息。文件内容通过独立的文件通道传输，不受上面 256k 字符的 JSON 结果限制。MCP 的调用结果只需包含返回的文件信息。

```js
// ==UserScript==
// @name         MCP file export
// @namespace    local.automation-script.examples
// @match        https://example.com/*
// @grant        GM.mcp
// ==/UserScript==

GM.mcp.register({
  exportReport: {
    description: '下载报表并保存到 exports 目录',
    async handle() {
      // 也可以传入 GM_xmlhttpRequest 已取得的 Blob / ArrayBuffer。
      const response = await fetch('/export/report.pdf');
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      return GM.mcp.saveFile({
        name: 'report.pdf',
        directory: 'exports',
        data: await response.blob(),
        mimeType: 'application/pdf',
      });
    },
  },
}).catch(console.error);
```

`@grant GM_mcp` 时使用 `GM_mcp.saveFile(...)`。参数：

| 参数 | 说明 |
| --- | --- |
| `name` | 必填文件名，不含目录；支持中文，拒绝路径分隔符、控制字符、`..` 和非法名称 |
| `data` | 必填内容，支持 Blob / File、ArrayBuffer、TypedArray / DataView、字符串；字符串按 UTF-8 保存，URL 字符串也会当作文本，不会重新发起网络下载 |
| `directory` | 可选子目录，例如 `exports/2026-10`，默认直接保存到设置中的文件保存目录下 |
| `mimeType` | 可选 MIME 类型，默认使用 Blob 类型，否则为 `application/octet-stream` |

在扩展「设置 → MCP → 文件保存目录」中可修改基础目录，默认 `automation-script`；支持 `邮件归档/2026` 等多级相对目录，留空表示浏览器下载目录本身。修改保存后对后续文件立即生效，无需刷新脚本；已开始的保存和已有文件不移动。脚本的 `directory` 会追加到基础目录之后，例如基础目录 `邮件归档` 加上 `directory: "mail"`，保存到 `Downloads/邮件归档/mail/`。邮件采集台通过 `file_storage` 自动跟随该目录，通常 2 秒内更新监听；无需手工配置或重启。

目录位于**浏览器所在机器的默认下载目录**下，例如 `Downloads/automation-script/exports/report.pdf`。浏览器下载 API 的 `filename` 只接受相对下载目录的路径，因此不接受 `/tmp/...`、`C:\\...` 等任意绝对路径；需要更改下载根位置时，点击「更改浏览器下载位置」打开浏览器下载设置（会影响浏览器的下载默认位置）。这是[浏览器下载 API 的限制](https://developer.chrome.com/docs/extensions/reference/api/downloads#property-DownloadOptions-filename)。同名文件自动重命名，绝不覆盖已有文件；返回的 `path` 从完成后的下载记录读取，反映最终实际路径，包括浏览器改名或其他下载设置的影响。

成功返回示例（直接 `return` 时位于 `script_call` 的 `result.value` 中）：

```json
{
  "fileId": "a-unique-file-uuid",
  "downloadId": 42,
  "scriptId": 1,
  "frameId": 0,
  "name": "report (1).pdf",
  "path": "/Users/example/Downloads/automation-script/exports/report (1).pdf",
  "requestedPath": "automation-script/exports/report.pdf",
  "size": 12345,
  "mimeType": "application/pdf",
  "status": "completed",
  "savedAt": 1793318400000
}
```

`fileId` 是本次保存生成的唯一 ID；`downloadId` 是浏览器下载记录 ID；`size` 为文件字节数；`savedAt` 为保存完成时的毫秒时间戳。返回信息中不包含文件内容。

MCP 可以使用 `script_files({ "tabId": 7, "fileId": "a-unique-file-uuid" })` 查询，返回 `{ files: [...] }`。可省略 `fileId`，按 `scriptId` 筛选；`limit` 默认 50、最多 100，返回最近的记录。这里只查询本通道成功保存的文件信息，不读取文件内容或其他浏览器下载记录。

单文件上限 **16 MB**，扩展最多同时保存 **4 个文件**；超限直接报错，批量导出建议逐个 `await`。保存等待最多 120 秒，MV3 下等待期间扩展后台保持运行。下载失败、取消、磁盘错误、授权失效都会使 Promise 拒绝；在 `handle` 中未捕获的错误会自动成为 `failed` 结果。较慢的任务使用 `script_call` 的 `wait:false`，再用 `script_results` 读取最终结果；调用超时不会重复下载或停止脚本。

文件信息在内存中每标签页最多保留 100 条、5 分钟；关闭标签页、撤销授权、断开 MCP 或扩展后台重启会清空信息，**已保存的磁盘文件保留**。撤销授权或断开连接会尽力取消未完成的下载；保存失败不保证磁盘上不存在已完成或部分下载的文件。页面刷新后旧文档不能继续提交文件或收到成功回执。`script_files` 是保存时的信息快照，文件后续被外部移动或删除不会更新该快照。`--readonly` 允许查询文件信息，仍禁止通过 `script_call` 发起导出。

## 检查

```sh
pnpm run ci
pnpm run build
pnpm run build:mv3
npm test --prefix mcp
```

服务端适配固定版本的上游 0.2.0 schema 注册表，只追加 `script_files` 和 `file_storage`。测试通过真实 HTTP / WebSocket 连接验证工具发现、参数转发、结构化结果和只读模式。升级上游依赖时需要同步验证适配层。


### 本地采集台自动跟随目录

`file_storage({})` 是只读工具，返回 `{ directory, downloadDirectory }`，无需标签页授权，不读取网页、文件正文或令牌。`directory` 是扩展中的相对目录；`downloadDirectory` 是从成功保存回执核对并持久保留的浏览器下载根目录，尚未确认时为 `null`。配置读取独立于 5 分钟文件索引，断开连接不删除已确认的根目录。

邮件采集台使用已有的本机 MCP 连接，每 2 秒读取一次配置，监听 `<下载根目录>/<directory>/mail/`。尚未确认根目录时，沿用采集台的 `EML_WATCH_DIR`（默认 `~/Downloads`）；若修改 Chrome 的下载根位置，会在下一次文件保存后根据实际路径校正。MCP 暂时离线或重启时自动重连，保留已有监听并在恢复后补扫描。新旧目录和当前目录持久保存在采集台数据目录的 `watch-directories.json`，切换中的未完成文件仍会入库，重复文件继续按 SHA-256 去重。
