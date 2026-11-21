# 与上游的差异清单

基线：`tests/baseline/site/`（上游 gh-pages 分支 tree `b806a793581cd42e31c857a28eeea8079ee583f8` 的完整副本，115 个文件，只读）。
对照：`renderer/`（117 个文件）。

复核命令：

```bash
diff -rq renderer tests/baseline/site
```

输出（2026-11-14 实测）：

```text
Only in renderer: desktop
Files renderer/index.html and tests/baseline/site/index.html differ
Files renderer/javascripts/diffuseMap.js and tests/baseline/site/javascripts/diffuseMap.js differ
Files renderer/javascripts/displaceMap.js and tests/baseline/site/javascripts/displaceMap.js differ
Files renderer/javascripts/filedrop.js and tests/baseline/site/javascripts/filedrop.js differ
Files renderer/javascripts/main.js and tests/baseline/site/javascripts/main.js differ
```

**110 个文件逐字节相同**，包含全部 GLSL（`javascripts/shader/*.js`）、`normalMap.js`、`ambientOccMap.js`、`specularMap.js`、`filters.js`、`renderView.js`、`renderNormalview.js`、`style.css`、`extern/*`、全部图片/字体/环境贴图。

第五个改动文件 `diffuseMap.js` 只影响 Diffuse 贴图的载入判定（Windows 下 `.tga` 的 MIME 常为空或 `image/x-tga`，上游只认 `image/targa`），不参与法线/位移/AO/Specular 的生成。

## 一、新增文件（原项目没有）

| 路径 | 作用 |
| --- | --- |
| `desktop/main.js` | 窗口生命周期、单实例、IPC、原生对话框、网络封锁、导航拦截、菜单 |
| `desktop/preload.js` | `contextBridge` 暴露 7 个方法，无 fs / 无 shell / 无任意路径 |
| `desktop/app-protocol.js` | `app://nmo` 协议（测试时另有 `app://baseline`）、MIME、路径穿越防护、请求日志 |
| `desktop/save-manager.js` | 唯一写盘出口：魔数校验、文件名清洗、重名加后缀、errno 文案 |
| `desktop/test-hooks.js` | 仅测试模式加载（环境变量 + exe 旁 `nmo-test.flag` 双闸）：spec 驱动、CDP 注入文件、截图、像素比较 |
| `renderer/desktop/nmo-desktop-bridge.js` | 页面侧适配层 `NMO_Desktop`：保存、批量会话、状态提示、外链拦截 |
| `renderer/desktop/desktop.css` | 窗口适配：最小宽度与滚动、状态框、外链角标、footer 回文档流 |
| `tests/**`、`build/**`、`docs/**`、`README.md`、`THIRD_PARTY_NOTICES.md`、`LICENSE-THIRD-PARTY.md`、`使用说明.md` | 测试、打包、文档 |

## 二、修改文件（5 个）

### 1. `renderer/index.html`

桌面封装带来的改动：

- 新增 CSP `<meta>`（`default-src 'none'` 起步，见 `docs/ARCHITECTURE.md` §6.2）
- 新增 `<link>` 引入 `desktop/desktop.css`
- 末尾新增 `<script>` 引入 `desktop/nmo-desktop-bridge.js`
- `<title>` 改为 `NormalMap-Online — 桌面版`

界面中文化带来的改动（2026-11-15，详见第五节）：

- 全部可见文案改为中文（标签、按钮、下拉项、提示、帮助面板、页脚）
- `<html lang="en">` → `lang="zh-CN"`；`<meta name="language">` → `chinese`
- 模式下拉的 `<option>` 补上显式 `value="Cube"` 等英文值——文字可以翻，**取值不能翻**，`renderView.setModel()` 按值分支
- 批量区的标签列宽 120px → 100px，让四个中文勾选项回到一行
- `images/drag_drop.png`（英文被画进图里）换成 `.drop_hint` 文本块
- 上游的打赏区块（PayPal 表单 + `donate.gif` + `pixel.gif` 追踪像素）与“反馈”区块（邮箱图片）整段删除，连带移除页面上唯一的 `<form>` 和桥接层里对应的表单拦截分支

**不影响计算。** 控件 id、内联事件、DOM 层级未动；改动只涉及文本、一个列宽，以及三处展示元素（拖放提示、打赏区块、反馈区块）。

### 2. `renderer/javascripts/main.js`（导出段，替换约 88 行、新增约 123 行）

上游问题：`download_all_btn` 连调 4 次 `downloadImage()`，四次都用同一个 `#file_name`，靠浏览器自动改名；每次都走 FileSaver 的 `saveAs()`，没有目录选择、没有错误反馈。

改动：

| 函数 | 变化 |
| --- | --- |
| `buildImageRecord(type, name)` | 新增。把某类贴图画布编码成 `{name, type, data:Uint8Array}`；PNG 仍按 `#transparency_nmb` 设 `globalAlpha`，JPEG 仍取 `#file_jpg_qual_nmb`，TIFF 仍走 `CanvasToTIFF.toBlob` |
| `downloadImage(type)` | 改为 `buildImageRecord` + `NMO_Desktop.saveOne`，即一次原生"另存为" |
| `downloadAllImages()` | 新增。一次选目录，四个文件名加 `_normal/_displacement/_ambient/_specular` 后缀 |
| 两个按钮绑定 | `preventDefault()` 后走上面两条路径 |

**编码参数与画布内容不变**（尺寸、alpha、质量都是原来的表达式），只改落盘方式与"All"的命名。

### 3. `renderer/javascripts/filedrop.js`（+212 行）

| 变化 | 原因 | 是否改结果 |
| --- | --- | --- |
| `processBatchFiles` 重写：先选一次目录，再逐张"载入 → 计算 → 写入" | 上游每张图弹一个浏览器下载，无法选目录、无法报错、大图会同时驻留内存 | 否 |
| 新增 `isSupportedImage` / `isTargaFile` | Windows 下 `.tga` 常常没有 MIME，上游 `file.type.match(/image.*/)` 直接拒收，与界面 `accept` 不符 | 否 |
| `loadHeightmap` 改为解码成功后才替换 `height_image`，并返回布尔 | 上游先赋值再设 `src`，损坏文件会留下 0×0 的 `Image`，之后切标签页会把画布缩成 0×0 并抛异常 | 否（失败路径才有区别） |
| `loadHeightFromPictures`：重算移入每张图的 `onload` | 上游在 `img.src=` 之后同步重算，此时 `naturalWidth` 还是 0 | **是**，见第三节 |
| `handleFileSelect` 末尾清空 `input.value` | 否则重复选择同一个文件不触发 `change` | 否 |

### 4. `renderer/javascripts/displaceMap.js`（+31 行）

新增 `applyOrDefer(action)`，`invertDisplacement` / `setDisplacementSetting` / `setDisplaceStrength` / `setDisplacementContrast` 改用它。

上游逻辑：`if (timer==0) timer=now; if (now - timer > 50) 重算`。同一串事件里第一个只设时间戳，差值≈0，于是**单击滑轨、按一次方向键、勾一次 Invert 都不触发重算**，要等下一次操作补上。

现在节流窗口内改挂 60ms 补算，保证最后一次改动一定落地。**只改"何时算"，不改"算什么"**：`baseline.spec.js` 修复后仍与上游逐像素一致。

## 三、算法 / 结果层面的变化（单独列出）

只有一处：**四方向照片模式**。

上游 `loadHeightFromPictures()` 末尾同步调用：

```js
NMO_RenderNormalview.renderNormalview_update("pictures");
NMO_NormalMap.createNormalMap();
NMO_RenderNormalview.renderNormalToHeight();
```

此时刚 `new Image()` 的那张照片还没解码 → `naturalWidth === 0`。后果：

1. 第一次导入任意一张照片时，`renderer.setSize(0,0)` 把画布缩成 0×0，随即 `drawImage` 抛 `InvalidStateError`，本次重算与 `renderNormalToHeight()` 作废。
2. 导入最后一张时新照片尚未计入，因此照片模式下的 Displacement / AmbientOcc / Specular 来自**上一轮的 height 缓冲**（页面加载时的高度图或上一组照片）。

本项目把重算放进每张照片的 `onload`：同样的输入、同样的着色器，只是等像素就位再算。

复核方式与结论（`tests/specs/photos.spec.js`，`evidence/phase2/photos.json`）：

| 比对对象 | 结论 |
| --- | --- |
| 法线图 vs 上游导入后 | 逐像素一致 |
| Displacement vs 上游导入后强制重算一次 | 逐像素一致 |
| AmbientOcc / Specular vs 同上 | 196608 像素中偶有 1 像素差 1 个色阶（照片模式每次都新建 WebGL 渲染器做 NormalToHeight 反算，浮点噪声），已记录 |
| Displacement/AO/Specular vs 上游导入后**不重算**的原始状态 | 整体不同——这就是被修掉的缺陷本身 |

**高度图路径不受影响**：`baseline.spec.js` 用 6 组输入（默认 512、彩色、带 alpha、非正方形、非 2 次幂）× 4 类贴图，零容差逐像素一致，见 `evidence/phase2/baseline.json`。

## 四、行为差异（不涉及像素）

| 项 | 上游 | 现在 |
| --- | --- | --- |
| 保存 | 浏览器下载，无目录选择 | 原生"另存为" / 一次选目录 |
| 重名 | 由浏览器自动改名，可能静默覆盖 | 统一加 ` (1)` 后缀，绝不覆盖，结果里提示重命名数量 |
| 取消 | — | 视为正常操作，不写文件、不清空结果、不报错 |

## 五、界面中文化（2026-11-15）

目标：界面上不留英文单词。范围与处理方式如下。

| 位置 | 处理 |
| --- | --- |
| `index.html` 的标签、按钮、下拉项、表头 | 直接替换为中文 |
| 四个帮助面板（说明、批量、高度图、照片） | 整段重写为中文，图片与结构保留 |
| 模式下拉（Cube/Sphere/…） | 显示中文，`value` 保持英文 |
| `drag_drop.png` | 图片里的英文无法替换，改为等尺寸的 HTML 文本块 |
| `donate.gif`、`email_adresse.png`、`pixel.gif` | 随打赏/反馈区块一起删除，文件已从 `renderer/images/` 移除 |
| 状态栏、保存对话框、错误文案 | 在 `desktop/*.js` 与桥接层里逐条替换 |

保留英文的部分是有意的：`NormalMap-Online` 品牌、`PNG/JPG/TIFF` 格式名、`Sobel/Scharr` 滤波算法名、`AO` 缩写、文件默认名 `NormalMap`、以及下拉框的 `value`。

字体：`Open Sans` 没有中文字形，`desktop.css` 里把 CJK 交给系统字体（`Microsoft YaHei` 优先），西文仍是 `Open Sans`；四个帮助面板的内联 `Georgia` 被 `!important` 覆盖，否则中文会落到衬线回退字体。

回归：`npm test` 13/13 通过，`baseline.spec.js` 仍是零容差逐像素一致——中文化没有碰计算路径。测试里断言英文文案的 12 处已同步改为中文（`batch`、`export-all`、`export`、`import`、`packaged`、`save-contract`）。
| 写盘失败 | 无反馈 | 提示具体原因（权限、磁盘满、目录不存在…） |
| 外链 | 在页面内跳转 | 标 `↗ online`，点击才用系统浏览器打开 |
| 页面内的 `<form>` | 一处 PayPal 打赏表单 POST 到 paypal.com | 表单已删除，页面不再有 `<form>`；`form-action 'none'` 与导航拦截仅作兜底 |
| 窗口 | 浏览器标签页 | 独立窗口，最小 640×480，窄于 1104px 时横向滚动 |
| footer / "Need a Texture?" | 固定在视口底部、绝对定位 `-200px` | 回到文档流，避免压住预览列内容 |
| 刷新 | F5 | 打包版无开发者工具、无刷新入口 |

## 五之二、命名/编号/PBR（2026-11-17，1.1.0）

这一轮不是改算法，而是把“另存为”换成了有编号的导出流程：

| 项目 | 上游 / 1.0.0 | 1.1.0 |
| --- | --- | --- |
| 文件名 | 用户输入，自由命名 | `类别_编号_属性.扩展名`，输入框变只读预览 |
| 编号 | 无 | 每类别独立计数，至少 3 位，`999→1000` |
| 同源多属性 | 各自命名，可能对不上 | 共用一个编号（`wood_001_Normal/Height/AO/Specular`） |
| 重名 | 浏览器下载自动加 `(1)` | 保留原文件，汇总里说明“N 个同名文件已存在” |
| 批量流程 | 选文件即逐张导出 | 选文件 → 逐张分类 → 导出清单 → 写盘 |
| 贴图类型 | 法线/置换/环境光/高光 | 增加粗糙度/金属度，可打包为 ORM |
| 预览材质 | `MeshPhongMaterial` | 可选 `MeshStandardMaterial`（PBR，挂 envMap） |

**对像素的影响：**

- 法线/置换/环境光/高光四类的计算未改，`baseline` 仍逐像素一致；
- 新增的粗糙度/金属度是独立贴图，不参与旧四类的计算；
- ORM 只是把已有标量按 R/G/B 装进一张图，不做 gamma 变换、不颠倒通道。

新增 12 个文件与详细职责见 `docs/HANDOFF_NMO_NAMING_PBR.md` §2。

## 六、未修改但值得知道的上游缺陷

| 现象 | 位置 | 处理 |
| --- | --- | --- |
| 载入自定义 OBJ 后，下拉框仍显示原模型（场景已换成 OBJ） | `filedrop.readModelFile` → `setModel("Custom")` 不回写 `<select>` | 未改。测试按实际行为断言，见 `preview.spec.js` |
| Diffuse 的 `.tga` 与高度图同样受 MIME 缺失影响 | `diffuseMap.readDiffuseImage` 仍用 `imgFile.type.match(/image.*/)` | 未改。PNG/JPEG 正常；TGA 拖入会提示不支持 |
| `updateCurrentTexture()` 用了未加前缀的 `TextureEnum` | `main.js` | 未改。该路径绑在已被注释掉的 UI 上，属死代码 |
| 非 2 次幂尺寸只提示不改图 | `renderNormalview.renderNormalview_update` | 保留原行为（`Size` 后加 `NOT POWER OF 2 !`） |
