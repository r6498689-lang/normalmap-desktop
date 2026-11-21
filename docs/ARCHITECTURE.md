# NormalMap Desktop 架构说明

这个仓库是 NormalMap-Online（作者 Christian Petry，MIT）的 Windows x64 离线桌面版。上游站点原样保留在 `renderer/`，另有一份未被修改的副本在 `tests/baseline/site/` 用于像素对比。桌面层只解决三件事：把页面装进窗口、把"浏览器下载"换成原生保存、把网络彻底断掉。法线、AO、位移、Specular 的计算仍然是上游那份代码。

文档描述的是当前代码的实际行为，不是设计意图。凡标注"未验证"的地方，表示只看代码无法确认运行时结果。

> **版本提示（2026-11-19）**：正文主体写于 1.0.0，描述“基础桌面壳”。1.1.x 陆续加入了编号库、导出计划、
> 参数预设、分类弹窗、预览缩放，以及可选的 Agent/MCP 层。**正文与代码冲突时，以代码和 §11 为准**；
> 每个版本的改动细节见 `docs/HANDOFF_*.md`，交付入口见根目录 `DELIVERY.md`。

## 1. 产品定位与硬约束

| 约束 | 具体含义 | 落点 |
| --- | --- | --- |
| 离线 | 运行期不允许任何 http/https/ws 请求成功 | `desktop/main.js` 的 `installNetworkLockdown()` |
| 无服务器 | 默认不起 HTTP 服务、不监听端口；唯一例外是显式 `--agent`，只绑 127.0.0.1 + Bearer 令牌 | `desktop/app-protocol.js`（页面）、`desktop/agent-server.js`（Agent） |
| 无浏览器下载 | 不经过 Chromium 下载管理器，保存必须弹原生对话框 | `session.defaultSession.on('will-download')` + `desktop/save-manager.js` |
| 算法零改动 | 法线/AO/Specular/位移的 GLSL 与数值逻辑保持上游 | `renderer/javascripts/*.js`、`renderer/javascripts/shader/*.js` |
| 单文件交付 | 一个文件夹 + 一个 zip，解压即用，不写注册表 | `build/pack.js` |
| 页面无系统权限 | 页面拿不到 fs、child_process、任意路径 | `desktop/preload.js` 只暴露固定的 IPC 方法表 |

构建标识（来自 `evidence/phase1/smoke-result.json` 的 `build` 字段，由 `getBuildInfo()` 实测输出）：

| 项 | 值 |
| --- | --- |
| 应用版本 | 1.0.0（写此表时；当前以 `package.json` 为准，1.1.34） |
| Electron | 45.3.2 |
| Chromium | 156.0.8078.100 |
| Node（Electron 内置） | 24.22.2 |
| V8 | 15.6.75.57-electron.0 |
| 平台 | win32-x64 |

## 2. 三层结构

```
主进程（Node 环境）
  desktop/main.js          窗口、单实例、IPC、对话框、网络封锁、菜单
  desktop/app-protocol.js  app:// 协议，只读 renderer/（测试时加 baseline）
  desktop/save-manager.js  唯一写盘出口：校验、命名、冲突、错误文案
        │
        │ IPC：7 个 channel，每个 handler 先做来源校验
        │
  desktop/preload.js        contextBridge → window.nmoDesktop（7 个方法，冻结）
        │
渲染进程（Chromium，app://nmo，无 Node）
  上游脚本（three.js r80 / jQuery 2.1.1 / jQuery UI / fancyBox 2 / CanvasToTIFF）
  renderer/desktop/nmo-desktop-bridge.js  页面侧适配：保存、批量、状态、外链
  renderer/desktop/desktop.css            窗口适配样式
```

| 层 | 入口 | 职责 | 明确不做什么 |
| --- | --- | --- | --- |
| 主进程 | `desktop/main.js` | 窗口生命周期、单实例锁、协议注册、IPC、原生对话框、网络封锁、导航拦截、菜单 | 不碰像素，不做图像编码/解码 |
| 预加载 | `desktop/preload.js` | 把 7 个 IPC 调用包装成 `window.nmoDesktop` | 不暴露 `ipcRenderer`、`fs`、`path`、`process` |
| 渲染页面 | `renderer/index.html` | 上游 UI + 桌面桥接，负责生成四张画布并编码成字节 | 不直接写盘、不选路径、不发网络请求 |

边界的关键点：页面只知道"我要保存这段字节，建议叫这个名字"，不知道也不需要知道文件最终落在哪。位置由用户在原生对话框里选，由主进程记住。

## 3. 为什么必须有 app://nmo

### 3.1 file:// 会让整个应用失效

如果用 `file://` 加载 `index.html`，Chromium 把每个本地文件当成不透明源（opaque origin）。后果不是"某些功能降级"，而是核心链路直接断：

1. `images/` 里的贴图被绘制进 canvas 后，canvas 被标记为 tainted。
2. `getImageData()` 抛 `SecurityError`；`toBlob()` / `toDataURL()` 同样失败。
3. 导出依赖 `canvas.toBlob()`（PNG/JPEG）与 CanvasToTIFF 读取画布，全部走不通。
4. WebGL 从被污染的 canvas 取纹理同样会被拒绝。

也就是说，没有真实同源，就没有"把画布变成文件"这一步，应用不可用。自定义标准协议给页面一个真正的源 `app://nmo`，本地图片与页面同源，canvas 保持可读。

### 3.2 协议注册

`desktop/app-protocol.js` 在 `app` ready 之前调用 `protocol.registerSchemesAsPrivileged`：

| 权限 | 值 | 作用 |
| --- | --- | --- |
| `standard` | true | 让 `app://nmo` 成为有源（origin）的标准协议，而不是不透明源 |
| `secure` | true | 视为安全上下文，避免混合内容限制 |
| `supportFetchAPI` | true | 允许页面用 fetch 读取同源资源 |
| `corsEnabled` | true | 走正常同源/CORS 规则，不需要额外放宽 |
| `stream` | true | 支持流式响应 |
| `bypassCSP` | false | 协议本身不绕过页面 CSP |

没有 HTTP 服务器，没有端口，没有 `Access-Control-Allow-Origin: *`。

### 3.3 请求处理与路径穿越

`protocol.handle('app', ...)` 只服务两个 host：

| host | 根目录 | 注册条件 |
| --- | --- | --- |
| `app://nmo` | `renderer/` | 始终 |
| `app://baseline` | `tests/baseline/site/` | 仅测试模式（环境变量 + 打包版需 exe 旁有 `nmo-test.flag`），且目录存在 |

处理顺序：解析 URL → 查 host 对应的根 → 空路径补 `/index.html` → `decodeURIComponent` → `path.posix.normalize` → `path.resolve(root, '.' + normalized)` → 校验结果仍在根目录内（`resolved === root` 或以 `root + path.sep` 开头）→ 对根与目标各做一次 `realpath`，再校验真实路径仍在真实根内。第一道挡 `..` 之类的字符串穿越，第二道挡树内符号链接指向根外。任一不满足返回 403，读不到返回 404，成功返回 200。

响应头固定 `content-type`（按扩展名查表，未知为 `application/octet-stream`）、`cache-control: no-store`、`x-content-type-options: nosniff`。所有请求写入 `requestLog`（上限 20000 条），供 `getNetworkLog()` 取证。

一个边角：`decodeURIComponent` 在 try 之外，畸形的 `%` 转义会让 handler 抛错，结果是该请求失败，而不是绕过目录限制。未验证 Electron 在这种情况下的具体错误页表现。

### 3.4 为什么 baseline 也走协议

基线副本如果直接用 `file://` 打开，它的 canvas 同样会被污染，无法取像素。用 `app://baseline` 在同一次 `protocol.handle` 里再挂一个 host，可以让"桌面版"和"原始上游"运行在同一个 Electron 构建、同一套 GPU 驱动下，排除环境差异。这个 host 只在测试模式注册，打包运行时不会走到这条分支。

### 3.5 和"本地起个 HTTP 服务"的对比

| 方案 | 端口 | canvas 同源 | 主要问题 | 结论 |
| --- | --- | --- | --- | --- |
| `http://127.0.0.1:xxxx` | 需要监听 | 是 | 端口冲突、防火墙提示、本机其他进程可访问、需要处理 CORS | 不用 |
| `file://` | 无 | 否（不透明源） | `getImageData`/`toBlob` 直接失败 | 不可用 |
| `app://nmo` | 无 | 是 | 需要自己写协议 handler 与路径校验 | 采用 |

选 `app://` 的收益不是"更安全"这一个维度，而是同时满足：无端口、无服务进程、同源 canvas、可审计的请求日志。

## 4. 导出数据流

> **2026-11-17（1.1.0）起，默认导出改走“导出计划”。**
> 下面 4.1 / 4.2 的保存对话框流程只保留给**没有分类来源**的场景（例如启动自带的示例图），
> 有来源时文件名由 `类别_编号_属性` 决定，用户只选目录。计划流程见 4.5，命名合同见 4.6。

### 4.0 两条路径的分界

```js
// renderer/javascripts/main.js
if (!this.sourceContext) {
  // 未分类：保留 1.0.0 的单文件另存（4.1）
  return this.buildImageRecord(type, this.getDownloadFileName(type)).then(saveOne);
}
// 已分类：计划导出（4.5），文件名不受用户输入影响
return this.exportPlanned({ items: [...], tasks: [...] });
```

`sourceContext` 由分类弹窗确认后写入，包含 `sourceKey / category / mode / number`。
`sourceKey` 是会话内唯一 ID，不以文件名作键——同名不同内容不会串号。

### 4.1 单文件保存

```
画布（normal_canvas / displacement_canvas / ao_canvas / specular_canvas）
  → buildImageRecord(type, name)        新建 canvas、复制像素、编码
  → { name, type, data: Uint8Array }    纯数据，没有路径
  → NMO_Desktop.saveOne(record)
  → window.nmoDesktop.saveSingle(record)    preload
  → ipcRenderer.invoke('nmo:save-single')   IPC
  → save-manager.validateRecord()           魔数、大小、文件名
  → dialog.showSaveDialog()                 用户选路径
  → fs.writeFileSync(target, bytes, 'w')
```

`buildImageRecord` 保留上游的画布处理：PNG 时按 `#transparency_nmb` 设置 `globalAlpha`，JPEG 时按 `#file_jpg_qual_nmb` 传质量参数，TIFF 走 `CanvasToTIFF.toBlob`。编码完成后只返回字节和类型，不再调用 FileSaver 的 `saveAs()`。

单文件保存允许覆盖：路径由用户在系统对话框确认，对话框带 `showOverwriteConfirmation`。写入用 `flag: 'w'`。

### 4.2 "All" 导出

`downloadAllImages()` 不再连调 4 次 `downloadImage()`，而是走一次文件夹选择：

| 顺序 | 类型 | 文件名后缀 |
| --- | --- | --- |
| 0 | `NormalMap` | `_normal` |
| 1 | `DisplacementMap` | `_displacement` |
| 2 | `AmbientOcclusionMap` | `_ambient` |
| 3 | `SpecularMap` | `_specular` |

基础名取 `#file_name` 的值，空则用 `NormalMap`。`NMO_Desktop.exportMany()` 先 `openFolder()` 拿到 token，再对每个索引调用 `produce(i)`，生成一张、写一张、释放一张。

### 4.3 record 契约

页面能送给主进程的只有这一种结构：

```js
{
  name: "NormalMap_normal",   // 建议文件名，不含扩展名；主进程会清洗
  type: "png",                // png | jpg | tif
  data: Uint8Array            // 已编码的完整文件字节
}
```

`type` 必须在 `save-manager.IMAGE_TYPES` 的键里，`data` 必须是 `Uint8Array` 或 `ArrayBuffer`，字节非空且不超过 512 MB，且开头必须匹配对应格式的魔数。任何一条不满足，写入前就被拒绝。

### 4.4 会话 token 为什么能挡住任意路径

`nmo:begin-batch` 里：

1. 主进程弹 `showOpenDialog({ properties: ['openDirectory'] })`，用户选目录。
2. 主进程对目录做一次写探测（创建 `.nmo-write-probe-<pid>-<time>` 再删除），提前发现只读/无权限。
3. 主进程生成 `crypto.randomUUID()` 作为 token，把 `token → { dir, 计数器, 错误列表 }` 存进 `batchSessions`。
4. 返回给页面的只有 `{ token, dir }`。

之后 `nmo:write-batch-file(token, record)` 只接受 token 和 record，**不接受路径参数**。目录来自主进程内存里的映射，页面无法构造一个指向别处的 token，也无法在 record 里夹带路径：`name` 会经过 `sanitizeBaseName()`（替换 `<>:"/\|?*` 与控制字符、去掉尾部点、去掉用户误输入的图片扩展名、处理 Windows 保留名、截断到 120 字符），类型和字节还要过魔数校验。

token 不是加密凭证，也不需要保密。安全性来自"映射表只在主进程里"这一事实，而不是 token 的不可猜性。

### 4.5 计划导出：先清单，后写盘

```
分类结果（sourceKey/category/mode）
  → NMO_ExportPlan.open()                 导出前清单：源图/类别/编号/属性/目录/文件名/数量
  → ipcMain 'nmo:plan-export'             planner.prepare()
      · 选目录（或复用调用方给的 dir）
      · 写探测 + scanDirectory() 避让已占用编号
      · library.reserve() 一次性预留，返回 token
  → ipcMain 'nmo:write-plan-file'         每个属性一次，文件名由主进程拼
  → ipcMain 'nmo:end-plan'                finish(token, { releaseSourceKeys })
```

三点约束：

1. **页面拿不到路径**。`write-plan-file` 只收 `{ token, sourceKey, category, property, type, data }`，目录来自主进程会话表。
2. **编号先预留**。清单要显示“预计编号”，所以分配发生在开始之前，而不是逐张领号。
3. **停止时退号**。`finish` 接受 `releaseSourceKeys`：只退回“本次新建 + 一个属性都没写出 + 从没开始过”的套组，且只把该类别回落到 `max(剩余套组最大号, 该套组创建前的 baseMax, trustedFloor)`；其他类别不动，备份导入 / 目录里已有的高水位也不会被抹掉。已写出或待重试的号保留，避免重号。
4. **结算要等编号库回写**。`writeOne` 会 `await store.recordProperty()`；`finish` 最多等 5 秒（`finishWaitMs` 可配）。等不到就**不结算为成功**：返回 `ok:false` + `pendingWrites`，保留会话允许再结束一次；页面与 Agent 分别显示/返回待完成状态，不把超时当完成。

### 4.6 命名合同只有一份

`renderer/shared/naming.js` 同时被渲染层与主进程 `require`，是唯一规则来源：

| 导出 | 作用 |
| --- | --- |
| `PROPERTY_LIST` / `PROPERTIES` | 属性枚举（Normal/Height/Displacement/AO/Specular/Roughness/Metallic/ORM） |
| `normalizeCategory()` | 小写、去空白、限长；`Wood` 与 `wood` 归一为同一类 |
| `formatNumber()` | 至少 3 位补零，`999→1000` 自然扩位 |
| `buildFileName()` | `类别_编号_属性 + 扩展名`，非法属性直接抛错 |
| `canonicalExtension()` | 类型 → 规范扩展名（ORM 恒 `.png`） |

主进程与页面共用同一份，避免“界面显示 `wood_001_Normal`、磁盘写成 `Wood_1_normal`”这类两处规则漂移。

### 4.7 编号库

`desktop/library-store.js`，文件在 `<userData>/library/nmo-library.json`：

- `categories`：每个类别的 `maxAssigned` 与 `trustedFloor`（外部可信高水位：备份导入、目录里已存在的文件名，只升不降）；
- `suites`：`类别_编号` 的身份（`sourceKey`、`sourceName`、已写出的 `properties`，以及本次预留前的 `baseMax`）；
- `reservations`：预留记录，用于“预留后崩溃不复用”；
- `retired`：已删除自定义标签的编号水位（`maxAssigned` / `trustedFloor`）。删除标签只删标签，
  同名重建或导入备份时把水位合并回来，所以“删掉一个用过的标签”不会让下一张图从 001 重来；
- `schemaVersion` 不匹配或 JSON 损坏时**拒绝写入并报错**，不静默重置为 001；
- 所有写操作串行化并原子落盘（临时文件 + rename）。

退号（用户停止导出）只回落 `maxAssigned` 到 `max(剩余套组最大号, 被释放套组的 baseMax, trustedFloor)`：
前两项管“本次计划自己的号”，第三项管“预留之后才发生的导入/目录避让”——
只看前两项会在“预留 001 → 导入到 100 → 取消旧计划”时把导入的历史号抹掉。

备份只导出这三类元数据，不含图片；导入先 `previewImport()` 给出差异（新增分类、抬高计数、新套组、身份冲突），只取较大计数，不降号，并把导入的号记进 `trustedFloor`。

## 5. 批量会话为什么逐张写

> 1.1.0 起，批量默认走 4.5 的计划导出（界面流程：选文件 → 逐张分类 → 清单 → 写盘）。
> 下面描述的 `batchSessions` 仍保留，作为 `exportMany()` 的底层实现与旧接口兼容层；
> **重名策略在计划流程里是“保留原文件”，不再自动加 ` (1)`**。

批量模式（`filedrop.js` 的 `processBatchFiles`）处理 N 张源图 × M 种输出。它的循环是：

1. 先过滤出 `isSupportedImage()` 认可的源文件。
2. 选一次目标文件夹，拿 token。
3. 对每张源图：读图 → 等解码真正完成 → 生成该图需要的每种 map → 逐张 `writeRecord` → 下一张。

不把全部结果攒在内存里，原因有三个：

| 原因 | 说明 |
| --- | --- |
| 内存峰值 | 每张源图都会产生多张全尺寸 canvas（加载图、法线、位移、AO、Specular）。2048² 的源图乘上多张 RGBA 画布，攒 50 张就是数 GB；逐张写可以把峰值压到"一张源图的工作集" |
| 首字节时间 | 第一张结果在几秒内落盘，用户能看到进度，而不是等整批算完才出现文件 |
| 失败隔离 | 每张的结果独立计数；第 40 张解码失败不会让前 39 张的结果作废，也不会因为异常退出丢掉已写文件 |

批量写入用 `wx` 标志，绝不覆盖：`uniqueTarget()` 先查 `existsSync`，重名自动加 ` (1)`、` (2)`，上限 9999。单文件保存则是用户在对话框里明确确认覆盖。

`loadHeightmap()` 现在返回 `true/false`。批量循环只在解码成功时生成并写入；失败计入 `ctx.failed`，不会拿上一张图的画布结果冒充这一张。

`batchSessions` 只存在内存里，`end-batch` 删除，`before-quit` 清空。没有超时回收。

## 6. 安全模型

### 6.1 窗口配置

`desktop/main.js` 的 `webPreferences`：

| 选项 | 值 | 原因 |
| --- | --- | --- |
| `contextIsolation` | true | 页面脚本与 preload 的上下文隔离，页面改不到 `window.nmoDesktop` 的实现 |
| `nodeIntegration` | false | 页面拿不到 `require` |
| `nodeIntegrationInWorker` | false | Worker 里同样没有 Node |
| `sandbox` | true | 渲染进程沙箱；preload 只使用 Electron 提供的 `contextBridge` / `ipcRenderer` |
| `webviewTag` | false | 不允许嵌套 webview |
| `webSecurity` | true | 保持同源策略，不关闭安全开关 |
| `allowRunningInsecureContent` | false | 不允许混合内容 |
| `devTools` | `IS_DEV` | 打包版无法打开 DevTools |
| `spellcheck` | false | 无表单输入需求 |

### 6.2 CSP

`renderer/index.html` 的 `<meta http-equiv="Content-Security-Policy">`：

| 指令 | 值 | 作用 |
| --- | --- | --- |
| `default-src` | `'none'` | 默认全禁，逐项放开 |
| `script-src` | `'self' 'unsafe-inline'` | 只允许同源脚本；内联处理器需要 `unsafe-inline` |
| `style-src` | `'self' 'unsafe-inline'` | 同源样式表 + 大量 `style="..."` 属性 |
| `img-src` | `'self' data: blob:` | 本地贴图、TGA 转出的 data URL、画布导出的 blob |
| `font-src` | `'self' data:` | 本地字体 |
| `connect-src` | `'self' data: blob:` | 同源 fetch；不发远程请求 |
| `media-src` | `'self' blob:` | 本地媒体 |
| `worker-src` | `'self' blob:` | 同源 worker |
| `frame-src` | `'none'` | 没有合法 iframe |
| `object-src` | `'none'` | 禁止插件/object |
| `form-action` | `'none'` | 表单不允许把页面导航走 |
| `base-uri` | `'self'` | 防止 `<base>` 劫持相对路径 |

**`script-src` 里 `'unsafe-inline'` 的真实原因**：`index.html` 没有内联 `<script>` 块，但有大量内联事件处理器属性——实测 39 个 `onclick`、29 个 `onchange`、14 个 `oninput`、8 个 `onpropertychange` 等。CSP 的 `script-src` 管这些属性，去掉 `'unsafe-inline'` 会让滑块、标签页、折叠按钮全部失效。改成外部监听器需要重写整个上游 UI，超出"最小改动"的范围，所以保留。

补偿控制（不是"有了 CSP 就安全"，而是这些措施叠起来降低风险）：

- 页面代码全部来自本地 `renderer/`，运行期不能加载任何远程脚本（网络封锁 + `default-src 'none'` + 协议只服务固定目录）。
- 应用自身的 `javascripts/*.js` 与桌面桥接层没有 `eval` / `new Function`（已 grep 确认）。第三方库（jQuery 2.1.1 等）内部的动态执行没有逐一审计，属于未验证范围。
- 桌面桥接层没有 `innerHTML`：状态提示与 build 信息都用 `textContent`。上游代码是否在别处拼接 HTML 未逐一审计。
- `form-action 'none'` 与导航拦截兜底；页面内已无表单（上游的 PayPal 打赏表单已随区块删除），无需再做表单转发。
- 即使页面被注入脚本，在写盘方面它能做的也只有"生成合法的 PNG/JPEG/TIFF 字节并请求写入用户刚选的目录"，拿不到 fs、路径、shell。它还能调用 `openExternal` 让系统浏览器打开一个 http(s) 地址；危害限于多弹一个浏览器窗口。

### 6.3 网络封锁

| 措施 | 位置 | 效果 |
| --- | --- | --- |
| `webRequest.onBeforeRequest({ urls: ['*://*/*'] })` 一律 `cancel: true` | `installNetworkLockdown()` | 所有 http/https/ws 请求被取消并记入 `blockedRequests` |
| 权限请求一律拒绝 | `setPermissionRequestHandler` / `setPermissionCheckHandler` | 摄像头、麦克风、通知、地理位置等都拿不到 |
| 下载一律取消 | `session.defaultSession.on('will-download')` | 即使某处触发浏览器下载，也不会悄悄落盘 |
| 无远程源 | CSP + `app://` 只读本地 | 没有 CDN、统计脚本、字体外链 |

`getNetworkLog()` 返回两部分：被取消的请求（含 URL、资源类型、时间）和 `app://` 的本地请求日志。前者是"离线"的证据，后者是"页面确实从本地加载"的证据。

### 6.4 导航与新窗口

| 事件 | 行为 |
| --- | --- |
| `will-navigate` | URL 不以 `app://nmo/` 开头就 `preventDefault()`，再尝试交给系统浏览器 |
| `setWindowOpenHandler` | 一律 `deny`，把 URL 交给系统浏览器 |
| `will-attach-webview` | 一律 `preventDefault()` |
| 外链点击 | 桥接层捕获 `a[href^=http]`，`preventDefault` 后走 `nmo:open-external` |

`openExternalSafely()` 只放行 `http:` / `https:`，并把 `http:` 升级为 `https:`；其他协议（`file:`、`javascript:`、自定义 scheme）直接返回 false。正常 UI 路径下，外链由用户点击触发。需要说明的边界：`nmo:open-external` 本身不校验"有没有发生点击"，被注入的脚本也能调用它打开一个 http(s) 地址——危害限于弹出系统浏览器，不会让应用页面离开 `app://nmo`。

### 6.5 IPC 来源校验

每个 handler 的第一行都是 `assertTrustedSender(event)`，两个条件同时满足才继续：

1. `event.senderFrame.url` 以 `app://nmo/` 开头（排除被注入的 iframe / 其他 host）。
2. `event.sender === mainWindow.webContents`（排除测试时新开的 baseline 窗口或其他 WebContents）。

任一不满足直接抛错，IPC 调用失败。

### 6.6 写盘校验

`save-manager.js` 是唯一写盘出口，校验顺序：

| 检查 | 失败结果 |
| --- | --- |
| `record` 是对象 | "empty record" |
| `type` 在 `IMAGE_TYPES` 里 | "unsupported image type" |
| `data` 是 `Uint8Array` / `ArrayBuffer` | "payload is not binary data" |
| 长度 > 0 | "generated file is empty" |
| 长度 ≤ 512 MB | "exceeds 512 MB" |
| 前 N 字节匹配魔数（PNG 8 字节、JPEG 3 字节、TIFF 两种字节序） | "not a valid ... image" |
| 文件名清洗后非空 | 回退到 `NormalMap` |
| 目标已存在（批量） | 自动加 ` (n)` |

`describeFsError()` 把 `EACCES/EPERM/ENOSPC/EROFS/ENAMETOOLONG/EEXIST` 翻译成用户能理解的句子，其余回退到原始 message。

### 6.7 不承诺的部分

- 不防"用户自己选了桌面并保存了 100 个文件"。写入位置是用户授权的。
- 不防渲染进程被完全控制后写出**合法格式**的垃圾图片；防的是任意路径、任意字节类型、偷偷联网。
- 可执行文件未签名。从 zip 解压后可能触发 SmartScreen 提示（是否提示取决于文件是否带 Mark-of-the-Web，未验证）。
- `devTools: IS_DEV` 只保证打包版关掉 DevTools，不保证运行中的开发版不可调试。

## 7. 测试架构

### 7.1 启停方式

测试模式要同时满足两个条件：

1. 环境变量 `NMO_TEST_MODE` 为真；
2. 打包版还要求 exe 同目录存在 `nmo-test.flag`（源码树里 `app.isPackaged` 为假，只看第 1 条）。

满足后：

1. `desktop/main.js` 在 `app.whenReady()` 里 `require('./test-hooks').install(mainWindow)`，并把 `{ baseline: true }` 传给 `app-protocol.registerHandler()`。
2. `test-hooks.js` 读取 `NMO_TEST_SPEC`（spec 文件路径）、`NMO_TEST_OUT`（结果 JSON）、`NMO_EVIDENCE_DIR`（截图与附件目录）。
3. 页面 `did-finish-load` 后 `require(spec)` 并 `await spec.run(ctx)`。
4. 结果写 JSON，打印 `NMO_TEST_RESULT=<path>`，`app.exit(result.ok ? 0 : 1)`。

**为什么需要第二道闸**：钩子会在主进程里 `require()` 环境变量指向的任意 JS。只靠环境变量，发布版就是一个"设个变量就能执行任意脚本"的入口——而环境变量可能被启动器、批处理或父进程静默带进来。标记文件放在安装目录里，能往那里写文件的人本来就能替换 exe，威胁模型上没有额外让步。

发布包里没有 `nmo-test.flag`：`npm run test:packaged` 在启动前创建、在 `finally` 里删除；`build/pack.js` 在压缩前删掉任何残留标记，避免崩溃的运行把标记带进 zip。负向证据是 `tests/verify-test-gate.js`：同样设置 `NMO_TEST_MODE` 与 `NMO_TEST_SPEC`，但不放标记文件，启动便携版后确认它不写结果、不自行退出（`evidence/phase3/test-gate.json`）。

`desktop/test-hooks.js` 仍然随 `desktop/` 复制进 `resources/app/`。这是有意保留的：任务书要求对**最终打包程序**跑完整流程，钩子不在包里就无法驱动它；但缺少标记文件时这段代码不会被执行。

### 7.2 驱动 API

`install()` 传给 spec 的 `ctx`：

| 方法 | 用途 |
| --- | --- |
| `js(code)` | `webContents.executeJavaScript(code, true)`，在页面里求值 |
| `wait(ms)` | 定时等待 |
| `waitFor(expr, timeout)` | 轮询直到表达式为真，默认 20s，超时抛错 |
| `screenshot(name)` | `capturePage()` 后写入 evidence 目录 |
| `saveText(name, text)` | 把文本证据写入 evidence 目录 |
| `openBaseline()` | 新开一个窗口加载 `app://baseline/index.html`，不带 preload |
| `compare(b64A, b64B)` | `nativeImage` 解码后逐像素比较 |
| `setFileInput(win, selector, paths)` | 通过 CDP 给 `<input type=file>` 塞文件 |

### 7.3 为什么用 CDP 设置文件

`<input type=file>` 的 `files` 属性是只读的，页面脚本无法伪造；Electron 也没有"设置文件选择结果"的公开 API。测试钩子用 `webContents.debugger.attach('1.3')`，依次发 `DOM.getDocument`、`DOM.querySelector`、`DOM.setFileInputFiles`，把文件塞进真实的 input，让上游的 change 监听器自己处理。这样测的是用户路径，不是绕过 UI 直接调函数。`import`、`batch`、`photos`、`preview`、`paths`、`perf` 都用这条路径喂文件，走的是真实 change 事件，不是直接调函数。

### 7.4 同源基线对比

`app://baseline` 与 `app://nmo` 在同一次 `protocol.handle` 中注册，两个窗口在同一个 Electron 进程、同一块 GPU 上渲染。钩子提供的是两块能力：`openBaseline()` 打开基线页面，`compare()` 比较两张图。`baseline.spec.js` 与 `photos.spec.js` 就是按这个流程跑的：

1. 主窗口加载桌面版，喂同一张 fixture，等四张画布生成。
2. `openBaseline()` 加载 `tests/baseline/site/index.html`，喂同一张图。
3. 两边各自 `canvas.toDataURL('image/png')`，把 base64 交给 `compare()`。

两边的差异面只有 `index.html`（CSP、样式表、标题）、`main.js` 与 `filedrop.js` 的导出/加载路径，没有触及 shader 或 uniform 计算。因此画布像素若不同，只能来自渲染路径或改动本身。

### 7.5 像素比较的判定

`compareImages()` 用 `nativeImage.createFromBuffer()` 解码，取 `getBitmap()`，按 RGBA 四通道逐像素求绝对差：

| 字段 | 含义 |
| --- | --- |
| `sizeEqual` | 宽高是否一致；不一致直接返回，不再比像素 |
| `identical` | 所有像素四通道完全相等 |
| `differingPixels` / `differingRatio` | 有多少像素至少一个通道不同 |
| `maxChannelDelta` | 单通道最大差值（0–255） |
| `meanChannelDelta` | 平均通道差 |

没有容差阈值：`identical` 表示解码后的位图逐像素、逐通道相等。这个定义很严，正好用来回答"算法有没有被改动"。

### 7.6 当前覆盖

`tests/run-all.js` 逐个启动 `tests/specs/*.spec.js`（每个 spec 一个独立的 Electron 进程，避免状态串味）。每次运行生成一个 `runId` 并通过环境变量传进去，结果文件必须回显同一个 `runId`，否则判为过期结果；启动前先删掉旧结果文件。结束后按 exe 全路径查残留进程，查询本身失败时判为“未验证”而不是通过。

| spec | 覆盖 |
| --- | --- |
| `smoke` | 启动、四类贴图生成、3D 预览、无控制台错误、无远程请求 |
| `baseline` | 6 组输入 × 4 类贴图，与 `app://baseline` 的上游页面逐像素比对 |
| `import` | PNG/JPG/BMP/TGA 导入、拖放、取消、无效文件、尺寸标签 |
| `params` | Strength/Level/Blur、反转通道、恢复默认、滤波类型 |
| `export` | 单张 PNG/JPG/TIFF、透明度、JPEG 质量、取消、不可写目录 |
| `export-all` | 一次选目录写 4 张、命名后缀、重名 ` (n)` |
| `batch` | 同名不同内容的源图不串图、逐张写入 |
| `photos` | 四方向实拍照片、与上游两种状态对比 |
| `preview` | 5 个内置模型、自定义 OBJ、Diffuse、六个开关 |
| `paths` | 中文与空格路径的导入、导出、批量 |
| `perf` | 256/512/2048 输入耗时、内存、渲染器信息 |
| `offline` | 冷启动全流程、零远程请求、无监听端口 |
| `save-contract` | 批量失败统计合并、扩展名与编码一致、纠正名称时的覆盖确认 |
| `packaged` | 只对 `dist/` 里的便携版跑：构建身份、无 DevTools、无 `app://baseline`、三种格式、写盘失败、批量失败统计、四方向照片、Diffuse TGA |

`packaged` 需要 `dist/` 里已有产物：`npm run test:packaged` 会自己找 `dist/*-win32-x64/*.exe`，找不到就以退出码 2 结束。普通 `npm test` 会跳过它，不会把"没打包"报成失败。

`tests/lib/raster.js` 是零依赖的 PNG/TGA 编码器，给 `make-fixtures.js` 造 fixture 用；`tests/lib/imageinfo.js` 读 PNG/JPEG/TGA/TIFF 头部尺寸，用来核对导出文件的实际像素尺寸。

## 8. 模块职责表

| 文件 | 职责 | 含算法？ |
| --- | --- | --- |
| `desktop/main.js` | 窗口、单实例、菜单、IPC 注册与来源校验、原生对话框、网络封锁、导航/新窗口拦截、导出目录记忆 | 否 |
| `desktop/app-protocol.js` | `app://nmo`（测试时 `app://baseline`）的注册与请求处理、MIME、路径穿越防护、请求日志 | 否 |
| `desktop/preload.js` | `contextBridge` 暴露 7 个方法：`saveSingle` / `beginBatch` / `writeBatchFile` / `endBatch` / `openExternal` / `getBuildInfo` / `getNetworkLog` | 否 |
| `desktop/save-manager.js` | 唯一的写盘实现：类型/魔数/大小校验、文件名清洗、重名加后缀、errno 文案 | 否 |
| `desktop/test-hooks.js` | 测试驱动：spec 加载、CDP 文件注入、截图、`nativeImage` 像素比较、baseline 窗口 | 否 |
| `renderer/desktop/nmo-desktop-bridge.js` | 页面侧适配：`saveOne`、`openFolder`/`writeRecord`/`finishBatch`、`exportMany`、状态 toast、外链拦截、build info 角标 | 否 |
| `renderer/desktop/desktop.css` | 窗口适配：`body` 最小宽度、状态框、外链角标、footer/texture_link 回到文档流 | 否 |
| `renderer/index.html` | 上游 UI 结构；新增 CSP、`desktop.css`、桥接脚本、标题；全部可见文案改为中文 | 否 |
| `renderer/javascripts/main.js` | 上游 UI 逻辑；只改导出段：`buildImageRecord` / `downloadImage` / `downloadAllImages` / 两个按钮绑定 | 否（编码参数沿用上游） |
| `renderer/javascripts/filedrop.js` | 上游文件加载；批量模式改为一次选目录逐张写、`isSupportedImage`/`isTargaFile`、`loadHeightmap` 解码成功才替换图像、四方向照片改为解码后重算 | 否（改变重算时机，见 §9） |
| `renderer/javascripts/normalMap.js` | 法线参数入口与初始值、`createNormalMap()` 触发 | 是（参数→uniform 的映射） |
| `renderer/javascripts/renderNormalview.js` | 法线渲染管线：两套 shader/uniform、EffectComposer、高斯模糊、画布尺寸 | 是（装配与 uniform 传递） |
| `renderer/javascripts/ambientOccMap.js` | AO 参数、uniform 装配、渲染与灰度合成 | 是（装配） |
| `renderer/javascripts/displaceMap.js` | 位移参数、uniform 装配、渲染；`applyOrDefer` 负责节流调度（唯一改动过计算模块的文件） | 是（装配；调度逻辑修过） |
| `renderer/javascripts/specularMap.js` | Specular 参数、uniform 装配、渲染 | 是（装配） |
| `renderer/javascripts/shader/*.js` | 全部 GLSL：法线（height / 4 图）、AO、位移、Specular、模糊、NormalToHeight | 是（核心） |
| `renderer/javascripts/filters.js` / `renderView.js` / `diffuseMap.js` | 预览滤镜、3D 预览、漫反射贴图 | 是（未改动） |
| `renderer/javascripts/extern/*` | three.js r80、jQuery 2.1.1、jQuery UI、fancyBox、FileSaver、CanvasToTIFF、TGA 解码等第三方库 | 是（第三方，未改动） |
| `build/pack.js` | 复制 Electron runtime + `package.json`/`desktop`/`renderer` 到 `dist/`，改 exe 名，打 zip，写 `BUILD.json` | 否 |
| `tests/*` | fixture 生成、spec、像素工具与基线副本 | 否（但定义"正确"的标准） |

## 9. 与上游的差异面

`tests/baseline/site/` 是 115 个文件的上游副本。`renderer/` 是 117 个文件：多出的两个是 `desktop/desktop.css` 与 `desktop/nmo-desktop-bridge.js`。

`diff -rq renderer tests/baseline/site` 给出五项文件差异，外加一个只存在于 `renderer/` 的 `desktop/` 目录：

| 文件 | 改动内容 | 是否影响计算结果 |
| --- | --- | --- |
| `index.html` | CSP meta、`desktop.css`、桥接脚本、`<title>`、中文文案与一处列宽 | 否 |
| `javascripts/main.js` | 导出段：`buildImageRecord`、`downloadAllImages`、`downloadImage` 走桥接 | 否（画布尺寸、PNG alpha、JPEG 质量参数沿用原代码） |
| `javascripts/filedrop.js` | 批量写盘、TGA 判定、`loadHeightmap` 解码成功才替换、四方向照片改为解码后重算 | 高度图路径否；四方向照片路径**是**（见 9.1） |
| `javascripts/displaceMap.js` | 新增 `applyOrDefer`，节流窗口内的改动不再被丢弃 | 否（只改何时重算） |
| `javascripts/diffuseMap.js` | Diffuse 的 `.tga` 改用与高度图一致的判定（MIME 为空或 `application/octet-stream` 也能解码） | 否（仅贴图载入） |

其余 110 个文件逐字节相同，包括全部 shader、`normalMap.js`、`ambientOccMap.js`、`specularMap.js`、`filters.js`、`renderView.js`、`renderNormalview.js`、`style.css` 与全部图片/字体/贴图。

### 9.1 四方向照片：唯一会改变结果的一处修复

上游 `loadHeightFromPictures()` 在 `img.src = dataURL` 之后**同步**调用重算，此时新赋值的 `Image` 还没有解码，`naturalWidth` 是 0：

- 第一次导入任何一张照片，`renderer.setSize(0, 0)` 把画布缩成 0×0，接着 `drawImage` 抛 `InvalidStateError`，本次重算与 `renderNormalToHeight()` 全部作废。
- 最后一次导入时，新照片仍未被计入，其余三张已就绪，所以照片模式的位移/AO/Specular 来自**上一轮的 height 缓冲**。

现在把重算放进每张图的 `onload`。同样的输入、同样的算法，只是等像素就位再算。可复核的结论在 `tests/specs/photos.spec.js`：

- 法线图：与上游导入后的结果逐像素一致。
- 位移：与“上游导入后强制再算一次”的结果逐像素一致。
- AO / Specular：同上，196608 个像素里偶有 1 个像素差 1 个色阶（照片模式每次新建 WebGL 渲染器做 NormalToHeight 反算带来的浮点噪声），已在证据里如实记录。
- 与“上游导入后不重算”的原始状态相比，位移/AO/Specular 三张图整体不同——这正是被修掉的缺陷本身。

高度图路径不受影响：`baseline.spec.js` 对 6 组输入、4 类贴图的比对是零容差逐像素一致。

## 10. 读代码的顺序

1. `desktop/main.js` — 先看清 7 个 IPC 和网络封锁，后面所有数据流都以它为边界。
2. `desktop/app-protocol.js` — 理解为什么页面不是 `file://`。
3. `desktop/save-manager.js` — 理解页面能写什么、不能写什么。
4. `renderer/desktop/nmo-desktop-bridge.js` — 页面侧的唯一适配层。
5. `renderer/javascripts/main.js` 的导出段 — 画布如何变成 record。
6. `renderer/javascripts/filedrop.js` 的 `processBatchFiles` — 批量为什么逐张。
7. 需要改算法时，再从 `renderNormalview.js` 与 `shader/` 进入。

## 11. Agent / MCP 层（1.1.16 起，可选）

默认完全不存在：只有启动参数带 `--agent` 才会初始化，普通双击打开的行为与 1.0.0 一致。

```
MCP 客户端（Claude / Cursor / WorkBuddy …）
  → mcp/normalmap-mcp.js        零依赖 stdio JSON-RPC，14 个工具，读 agent.json 找端口与令牌
  → POST /command（127.0.0.1）  desktop/agent-server.js：Bearer 校验、1 MB 体限、命令串行、只读旁路
  → desktop/agent-commands.js   命令白名单与参数校验，唯一入口
  → 页面 renderer/desktop/agent-api.js（NMO_Agent）或主进程 nativeImage
  → 现有导出/编号/写盘流程（export-plan.js、library-store.js、save-manager.js）
```

| 文件 | 职责 |
| --- | --- |
| `desktop/agent-server.js` | 回环 HTTP、令牌、命令队列、`/health` `/events` `/cancel` |
| `desktop/agent-commands.js` | 15 个命令：ping/status/categories/preview/preview_batch/open_image/set_category/export/batch/progress/cancel/batch_state/log/window/quit（含 batch 的 retry/resume/batchId） |
| `desktop/agent-jobs.js` | 批量任务账本与增量事件（seq），内存态，上限 1000 事件 / 10 任务 |
| `desktop/agent-log.js` | JSONL 审计，base64 脱敏，5 MB 轮转 |
| `desktop/agent-stats.js` | 缩略图的均值/亮度/饱和度 |
| `desktop/image-encode.js` | 自写 TIFF/TGA 编码（无第三方依赖） |
| `desktop/batch-state.js` | 续跑账本：指纹 v2、`lastRun`/`cumulative`、原子落盘 |
| `mcp/normalmap-mcp.js` | MCP 适配器；带 `progressToken` 时自动改异步并轮询进度 |
| `renderer/desktop/agent-api.js` | 页面侧 `NMO_Agent`：开图、换类别、导出 |
| `renderer/desktop/agent-badge.js` | 左下角 `AI 已连接 / AI · export · 完成` 徽标 |

安全边界（这几条是审查重点）：

1. 只绑 `127.0.0.1`，且校验 `remoteAddress` 是回环；
2. 每个请求必须带 `Authorization: Bearer <token>`，比较用 `timingSafeEqual`；
3. 命令是白名单对象上的方法，没有“执行任意 JS / shell”的入口；
4. 写盘只能走既有导出流程，Agent 不能自起文件名；
5. `--agent-out=<dir>` 时，`export`/`batch` 的目录必须落在该目录内（`path.relative` 判定，防 `out-evil` 前缀绕过）；
6. 令牌文件只写用户目录，权限依赖系统默认 ACL（未做 0600 之类的显式收紧，见 `docs/HANDOFF_AGENT_MODE.md`）。

只读命令（`ping`/`status`/`categories`/`log`/`progress`/`batch_state`，以及带 `path` 的 `preview`、`preview_batch`）
不进命令队列，批量阻塞时也能查状态；会动画布或改状态的命令仍然串行。

续跑与编号：

- `batch { resume: true }` 按账本跳过已成功写出的图；指纹对 items 顺序不敏感；
- `batchId` 让“同一批”跨轮加图/删图仍可续；
- 硬杀后启动，`library/session.lock` 标记会让程序把上次的预留标成 `crashed` 并**保留号**：
  预留过的号永不复用（允许空号），避免把可能已经落盘的文件号再发出去造成覆盖。

读代码顺序（Agent 层）：`agent-server.js` → `agent-commands.js` → `agent-jobs.js` / `batch-state.js` → `agent-api.js` → `normalmap-mcp.js`。
