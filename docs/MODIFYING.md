# 修改指南

面向以后要改这个程序的人。当前版本的模块地图与审核入口见根目录 `DELIVERY.md`。先给结论：多数需求只动 `renderer/` 里的上游代码；桌面层（`desktop/`、`renderer/desktop/`）只负责窗口、保存、网络与安全。把这两类改动混在一起，是后面最难维护的情况。

## 1. 先定位：你想改什么，改哪里

| 需求 | 主要文件 | 通常不需要动 |
| --- | --- | --- |
| 加/删一个参数控件 | `renderer/index.html`、参数所属的 `*Map.js`、对应 `shader/*.js` | 桌面层全部 |
| 改算法（法线/AO/位移/Specular） | `renderer/javascripts/shader/*.js`、`renderNormalview.js`、`*Map.js` | 桌面层全部 |
| 改窗口里看起来不对的布局 | `renderer/desktop/desktop.css` | 上游 `style.css` |
| 改上游页面本身的配色、间距、列宽 | `renderer/style.css`、`renderer/index.html` | `desktop/` |
| 改保存流程、文件名、错误提示 | `renderer/javascripts/main.js` 导出段、`desktop/save-manager.js` | 算法文件 |
| 增加一种导出格式 | `main.js` 的 `buildImageRecord`、`save-manager.js`、`index.html` | `build/pack.js` |
| 页面需要新的系统能力 | `desktop/preload.js`、`desktop/main.js` | 上游算法 |
| 改 Agent 命令或 MCP 工具 | `desktop/agent-commands.js`、`mcp/normalmap-mcp.js`、`desktop/agent-server.js` | 上游算法 |
| 改批量续跑 / 编号恢复 | `desktop/batch-state.js`、`desktop/library-store.js`、`desktop/main.js` 的会话标记 | 上游算法 |
| 改测试 | `tests/specs/*`、`tests/lib/*`、`tests/e2e-*.js` | 产品代码 |
| 改打包产物 | `build/pack.js` | `renderer/` |

## 2. 界面布局

### 2.1 index.html 的列结构

页面主体是三个并排的 `.column`（每列 338px），中间夹两个折叠把手：

| 位置 | 元素 | 内容 |
| --- | --- | --- |
| 左把手 | `.column_btn` + `#column_btn_left` | 折叠/展开高度图列，调用 `NMO_Main.toggle_height_column()` |
| 第一列 | `#column_height`（`index.html:120`） | 批量模式、高度图/四向图拖放、尺寸显示 |
| 第二列 | `.column`（`index.html:316`） | 四个 tab（Normal/Displacement/AmbientOcc/Specular）、对应 `*_settings` 参数块、预览画布、文件名/格式/导出按钮 |
| 右把手 | `.column_btn` + `#column_btn_right` | 折叠/展开预览列，调用 `NMO_Main.toggle_preview_column()` |
| 第三列 | `#preview`（`index.html:707`） | three.js 3D 预览、帮助入口 |
| 页脚 | `footer` | 上游版权与素材来源（目前保留） |
| 角标 | `div.texture_link` | “需要贴图？”外链 |

四个参数块 `#normal_settings`、`#displacement_settings`、`#ao_settings`、`#specular_settings` 都在第二列，通过 `display: none` 切换，切换逻辑在 `main.js` 的 `activate_texture()`。加参数就是往对应块里的 `<table class="options_top">` 加一行。

导出区在第二列底部（`<!-- Download Button -->` 之后，约 `index.html:671`）：`#file_name`、`#file_type`（png/jpg/tiff）、`#file_jpg_qual`、`#total_transparency`、`#download`、`#download_all`。

### 2.2 三个样式文件的分工

| 文件 | 管什么 | 典型改动 |
| --- | --- | --- |
| `renderer/style.css` | 上游页面的基础外观：`.column` 宽 338px、`.view` 300×300、`.content` 背景、`footer` 固定定位、`div.texture_link` 绝对定位 | 改列宽、改预览框尺寸、改配色 |
| `renderer/desktop/desktop.css` | 只加"窗口里才需要"的东西：`body { min-width: 1104px }`、横向滚动、`#nmo_status` 提示、`a.nmo_online_link::after` 的 "↗ online"、把 `footer` 和 `.texture_link` 改回文档流 | 窗口太窄、提示被遮挡、外链没有标记 |
| `renderer/index.html` | 结构与内联样式属性（上游有 125 处 `style="..."`） | 增删控件、调某一行的列宽 |

判断规则：

- 现象只在"窗口比浏览器窄"时出现 → `desktop.css`。
- 现象在浏览器里打开上游页面也会出现 → `style.css` 或 `index.html`，属于上游问题。
- 只影响桌面版新增元素（状态框、build 角标、online 标记）→ `desktop.css`。

### 2.3 改列宽的连锁反应

`.column` 宽度在 `style.css:88`（338px），`body` 最小宽度在 `desktop.css:18`（1104px）。两者必须一起改：只改列宽不改 `min-width`，列变宽时页面会溢出并出现多余的横向滚动；列变窄时右侧会留出一块空白。当前 1104px 的取法是三列 + 两个 25px 把手 + 内容区 padding，再加约 20px 余量；改列宽后按同样口径重算。

窗口本身的最小尺寸是 `desktop/main.js` 的 `minWidth: 640 / minHeight: 480`。这个值小于页面最小宽度是故意的：窗口可以缩到 640，页面靠横向滚动保持可用。

### 2.4 页脚与角标

上游 `footer` 是 `position: fixed; bottom: 0`，`div.texture_link` 是 `position: absolute; margin-top: -200px`，都假设视口很宽。`desktop.css` 把两者改成 `position: static`，并给 footer 加底部 padding。桥接层会把 build 信息以 `.nmo_buildinfo` 追加到 `footer` 里。

如果你在 footer 里加内容，注意它现在是文档流的一部分，不再浮在窗口底部。

## 3. 算法改哪里

四张图各有一条"参数 → uniform → GLSL → 重算"的链路。位置如下。

### 3.1 法线

| 环节 | 文件与位置 |
| --- | --- |
| 参数入口 | `normalMap.js:131` `setNormalSetting(element, v, initial)`；初始值在 `getInitialStrength/Level/Smoothing/NormalType/...` |
| uniform 装配 | `renderNormalview.js:65`（height 模式克隆 `NormalMapShader`）、`:83`（pictures 模式克隆 `NormalMapFromPicturesShader`）；赋值在 `:71-73`、`:101-105` |
| GLSL | `shader/NormalMapShader.js`（Sobel/Scharr、`dz`、`invertR/G/H`、`heightOffset`）；`shader/NormalMapFromPicturesShader.js`（四向图求法线） |
| 模糊 | `shader/VerticalBlurShader.js` + `HorizontalBlurShader.js`，在 `renderNormalview.js:133-134` 作为 ShaderPass 加入 composer |
| 重算触发 | `normalMap.js:159-160`：`setNormalSetting` 末尾调 `createNormalMap()`（除非传了 `initial`），后者调 `renderNormalView()` 并刷新预览 |

注意：法线路径**不看** `NMO_Main.auto_update`，每次 set 都会重算。加参数时如果想省性能，需要自己加节流。

### 3.2 环境光遮蔽（AO）

| 环节 | 文件与位置 |
| --- | --- |
| 参数入口 | `ambientOccMap.js:258` `setAOSetting(element, v)`；初始值在同文件的 `getInitialStrength/Mean/Range/Smoothing/InvertAO` |
| uniform 装配 | `ambientOccMap.js:191-212`（`shader = NMO_AmbientOcclusionShader`，克隆 uniforms，逐项赋值 `invert/range/strength/mean/level/tHeight/flipY`） |
| GLSL | `shader/AmbientOcclusionShader.js` |
| 模糊 | `ambientOccMap.js:145-146` 设置 `gaussian_shader_y/x` 的 `v`/`h` |
| 重算触发 | `ambientOccMap.js:274-278`：每次 set 都调 `createAmbientOcclusionTexture()`（`auto_update` 判断被注释掉） |

AO 的输出画布是 `ao_canvas`，先渲染到 `grayscale`，再用 2D context 合成。

### 3.3 位移

| 环节 | 文件与位置 |
| --- | --- |
| 参数入口 | `displaceMap.js:256` `setDisplacementSetting(element, v)` 处理 `contrast` / `blur_sharp`；强度滑块走 `:275` 的 `setDisplaceStrength(v)` |
| uniform 装配 | `displaceMap.js:194-207`（`NMO_DisplacementShader`，`invert/contrast/tHeight/flipY`） |
| GLSL | `shader/DisplacementShader.js` |
| 重算触发 | `displaceMap.js` 的 `applyOrDefer(action)`：50ms 节流内立即重算，否则 60ms 后补一次（见下） |

位移是四条链路里唯一带节流的。加高频参数（比如鼠标拖动实时预览）时，沿用 `applyOrDefer`，别直接每次重算。

**这一处改过上游代码**，是本项目唯一改动计算模块的文件，必须知道原因：上游原本是

```js
if (this.timer == 0) this.timer = Date.now();
if (NMO_Main.auto_update && Date.now() - this.timer > 50) { this.createDisplacementMap(); this.timer = 0; }
```

一连串事件里，第一个事件只把 `timer` 设成当前时间，差值约等于 0，永远进不了重算分支；只有拖动到第 50ms 之后的事件才会真正触发。结果是**单击滑轨、按一次方向键、勾一次 Invert，位移图都不更新**，要等下一次操作才补上。现在改成 `applyOrDefer`：节流窗口内不立刻算，但会挂一个 60ms 的补算，保证最后一个改动一定落地。

它只改变“什么时候算”，不改变“算什么”：`tests/specs/baseline.spec.js` 在修复后依然与上游逐像素一致，可以自己跑一遍确认。

### 3.4 Specular

| 环节 | 文件与位置 |
| --- | --- |
| 参数入口 | `specularMap.js:62` `setSpecularSetting(element, v)`；初始值在同文件的 `getInitial*` |
| uniform 装配 | `specularMap.js:213-235`（`NMO_SpecularShader`，`invert/range/strength/mean/falloff/flipY/tHeight`） |
| GLSL | `shader/SpecularShader.js` |
| 模糊 | `specularMap.js:255-264` |
| 重算触发 | `specularMap.js:81-82`，每次 set 调 `createSpecularTexture()` |

### 3.5 改 GLSL 的现实约束

所有 shader 都是 `THREE.XxxShader = { uniforms: {...}, vertexShader: \`...\`, fragmentShader: \`...\` }` 的形式，GLSL 放在 JS 模板字符串里。没有构建步骤、没有热更新：

- 改完必须重启 `npm start`（或在开发版里 Reload）才生效。
- 模板字符串里的 `${...}` 会被 JS 插值，写 GLSL 时避免误用。
- 语法错误的表现是画布全黑或 WebGL 报错，控制台能看到编译日志。
- 上游是 three.js r80，shader 语法按 r80 的约定写（`varying`、`texture2D`、`gl_FragColor`），不要按现代 three.js 的 `in/out` 改。

## 4. 边界：不要在这些地方改算法

| 文件/区域 | 允许做的事 | 不允许做的事 |
| --- | --- | --- |
| `desktop/main.js` | 窗口、IPC、对话框、网络、菜单 | 任何像素计算、图像缩放、色彩转换 |
| `desktop/app-protocol.js` | 静态文件服务、MIME、路径校验 | 在响应里改写 JS/CSS |
| `desktop/save-manager.js` | 校验字节、命名、写盘 | 转码、压缩、改像素、按尺寸缩放 |
| `desktop/preload.js` | 转发 7 类调用 | 暴露 `fs`/`path`/`shell`/`child_process`/`ipcRenderer` |
| `renderer/desktop/nmo-desktop-bridge.js` | 组织导出流程、toast、外链 | 读画布像素、改编码参数 |
| `renderer/javascripts/main.js` 的 `buildImageRecord` | 选择画布、调用 `toBlob`/CanvasToTIFF | 在这里改 globalAlpha 以外的像素、改尺寸 |
| `tests/baseline/site/` | 只读，作为参考实现 | 任何修改（改了就失去对比意义） |
| `build/pack.js` | 复制、改名、打 zip | 改运行时代码 |

一条实用规则：如果改动会让"同一张输入图、同一组参数"产出的四张画布像素发生变化，那它属于算法改动，应该只出现在 `renderer/javascripts/` 的 shader 或 `*Map.js` 里；如果只是文件字节不同（比如换了 PNG 编码器），那属于导出改动，应该在 `buildImageRecord` 或 `save-manager` 里。

## 5. 新增一个参数：以 Gamma 为例

链路有四段：**HTML 控件 → setXxxSetting → uniform → 触发重算**。下面以法线参数 `Gamma` 为例，假设它的语义是"对高度采样做幂次变换"。

### 第 1 段：控件

在 `#normal_settings` 的表格里，仿照 strength 那一行（`index.html:332` 起）加一行。上游的约定是 slider 与 number 输入互相同步：

```html
<tr>
  <td class="option_text"><span>Gamma</span></td>
  <td class="options">
    <input id="gamma_slider" type="range" min="0.2" max="3" step="0.01" value="1"
           oninput="NMO_NormalMap.setNormalSetting('gamma', this.value);
                    document.getElementById('gamma_nmb').value = this.value;">
    <input id="gamma_nmb" type="number" step="0.01" value="1"
           onchange="NMO_NormalMap.setNormalSetting('gamma', this.value);
                     document.getElementById('gamma_slider').value = this.value;">
  </td>
</tr>
```

### 第 2 段：setNormalSetting

在 `normalMap.js` 里加初始值和分支。注意 height 模式与 pictures 模式是**两套 uniform**，只写一套会导致切换 tab 后参数失效：

```js
this.getInitialGamma = function () { return 1.0; };
this.gamma = this.getInitialGamma();

// setNormalSetting 内部
else if (element == "gamma") {
    this.gamma = parseFloat(v);
    NMO_RenderNormalview.normalmap_uniforms["gamma"].value = this.gamma;
    NMO_RenderNormalview.normalmap_from_pictures_uniforms["gamma"].value = this.gamma;
}
```

### 第 3 段：uniform 与 GLSL

在 `shader/NormalMapShader.js` 的 `uniforms` 里声明，并在 fragment 里使用：

```js
uniforms: {
  "gamma": { type: "1f", value: 1.0 }
}
```

```glsl
uniform float gamma;
float h(vec2 uv) { return pow(abs(texture2D(tHeightMap, uv).r), gamma); }
```

然后把片段里 8 处 `abs(texture2D(tHeightMap, xxx).r)` 换成 `h(xxx)`。如果 pictures 模式也要这个参数，同样的声明要加进 `shader/NormalMapFromPicturesShader.js`，否则第 2 段写 `normalmap_from_pictures_uniforms["gamma"]` 会抛异常（该字段不存在）。

`renderNormalview.js` 不需要为"声明 uniform"而改：`:65` 和 `:83` 的 `THREE.UniformsUtils.clone()` 会把 shader 里新增的字段带进运行期 uniform 对象。但如果这个参数需要在页面初始化时就取 HTML 的当前值（而不是等用户拖动），就要在 `renderNormalview.js:73` 附近补一行初始化，和 `dz` 的做法一致。

### 第 4 段：触发重算

`setNormalSetting` 末尾已经统一调用 `createNormalMap()`（`normalMap.js:159`），只要你的分支不传 `initial`，重算自动发生。不需要在 HTML 的 handler 里再调一次。

### 收尾（可选但建议）

- `main.js:449` 的 `resetNormalMapSettings()` 里把 `gamma_slider`/`gamma_nmb` 恢复到 `getInitialGamma()`，否则"重置"之后界面与实际值不一致。
- 导出不需要改：`buildImageRecord` 读的是最终画布，参数只要影响了画布，单文件、All、批量三种导出都会自动带上。

## 6. 新增一种导出格式：以 WebP 为例

需要动 3 个文件：`index.html`、`javascripts/main.js`、`desktop/save-manager.js`。`build/pack.js` 不需要动（它只复制目录）。

### 6.1 页面：选项与编码分支

1. `index.html:678` 的 `#file_type` 加 `<option value="webp">WEBP</option>`。
2. `main.js` 的 `switchJPGQual()`（`:274`）只对 `jpg` 显示质量输入框；如果 WebP 也要质量，把判断改成 `!= 'jpg' && != 'webp'`。
3. `buildImageRecord`（`main.js:340`）加分支。当前逻辑是：`tiff` 走 CanvasToTIFF，否则 `jpg` 用 `image/jpeg`、其余一律 `image/png`，record 的 `type` 也只在 `jpg` / `png` 之间取。WebP 必须显式处理，否则会静默落进 PNG 分支：用户选了 WebP，实际写出的是 PNG 字节、扩展名 `.png`，不会报错，属于最难发现的一类错误。在通用 `canvas.toBlob(...)` 之前插入：

```js
if (file_type == "webp") {
  canvas.toBlob(function (blob) {
    if (!blob) { reject(new Error("Image encoding failed.")); return; }
    blob.arrayBuffer().then(function (buf) {
      resolve({ name: file_name, type: "webp", data: new Uint8Array(buf) });
    });
  }, "image/webp", qual);
  return;
}
```

注意 record 里的 `type` 必须是 `IMAGE_TYPES` 的键。TIFF 就是这么处理的：页面选 `tiff`，record 里写 `tif`。

### 6.2 主进程：类型表、过滤器、魔数

`save-manager.js`：

1. `IMAGE_TYPES` 加 `webp: { ext: '.webp', mime: 'image/webp', magic: [...] }`。
2. `DIALOG_FILTERS` 加 `webp: [{ name: 'WebP image', extensions: ['webp'] }]`。
3. 魔数校验要特别小心。`matchesMagic()`（`:77`）只从第 0 字节开始比，而 WebP 的结构是 `RIFF`（0–3）+ 长度（4–7）+ `WEBP`（8–11）。如果只写 `[0x52,0x49,0x46,0x46]`，任何 RIFF 容器（WAV、AVI）都会通过。要么扩展 `matchesMagic` 支持 `{offset, bytes}`，要么在 `validateRecord` 里对 webp 额外检查第 8–11 字节。

`normalizeType()` 不用改，它按 `IMAGE_TYPES` 的键查表，加键即可生效。

### 6.3 验证

- 单文件保存：选 WebP，确认对话框过滤器出现、文件能打开。
- All 与批量：确认后缀与扩展名正确。
- 故意把 `type` 写成不存在的值，确认返回 "unsupported image type" 而不是写坏文件。
- 基线像素对比不受影响：换格式只改变编码字节，不改变画布像素；但如果你写 spec 比对文件字节，需要更新预期。

## 7. 什么时候需要改 preload

规则只有一条：**页面需要一项它现在没有的系统能力时，才加接口；接口只传数据，不传路径。**

应该加的情况：

- 要把文件"在资源管理器中显示"（`shell.showItemInFolder`）。
- 要读系统剪贴板里的图片。
- 要调用系统的打印/分享。

不应该加的情况：

- 只是想换个保存位置 → 用户会在现有对话框里选。
- 想直接写某个固定目录 → 不允许，路径必须由主进程的对话框产生。
- 想把算法搬到主进程 → 算法留在页面。

新增一个接口的固定步骤：

1. `preload.js` 的 `api` 对象加一个方法，`ipcRenderer.invoke('nmo:xxx', payload)`。
2. `main.js` 的 `registerIpc()` 加 `ipcMain.handle('nmo:xxx', ...)`，第一行 `assertTrustedSender(event)`。
3. 返回值必须是可结构化克隆的普通对象（不要返回 Buffer、函数、类实例）。
4. 如果涉及写盘，走 `save-manager`，不要自己拼路径。
5. 更新 `docs/ARCHITECTURE.md` 的接口表。

反面例子（不要写）：`writeFile(path, bytes)`、`readFile(path)`、`exec(cmd)`、`openPath(path)`。这些等于把主进程权限直接交给页面，前面所有隔离都白做。

## 8. 改完怎么验证

### 8.1 手工

`npm start` 启动开发版。开发版才有菜单和 DevTools（`devTools: IS_DEV`），打包版两者都没有。

检查项：

- 拖一张 fixture（`tests/fixtures/height-300x200.png`）进去，四张预览都出现。
- 单文件保存：弹原生对话框，取消时不写文件、结果还在。
- All：弹一次文件夹选择，写出 4 个文件，后缀正确。
- 批量：选多张，确认逐张进度、重名自动加 ` (n)`、失败的文件有明确提示。
- 外链：点页脚链接，应该在系统浏览器打开，应用本身不跳走。
- 网络：正常启动后 `getNetworkLog()` 的 `blocked` 应为空（现有 smoke 结果即为空）。出现条目说明有代码尝试联网，虽然已被取消，也要查清调用来源。

### 8.2 自动

```bash
npm test                              # 13 个开发版场景，约 2.5 分钟
node tests/run-all.js --only=baseline # 只跑某个场景，名字见 ARCHITECTURE §7.6
npm run test:gate                     # 验证打包版没有环境变量就能加载测试钩子
```

`tests/run-all.js` 为每个 spec 起一个独立 Electron 进程，把结果写到 `evidence/phase<N>/<name>.json`，最后汇总到 `evidence/test-summary.json`。任一条 `ok` 为假、或进程退出码非 0、或结束后查到残留进程，整轮就算失败。

单独驱动一个 spec 时可以直接用环境变量（`NMO_TEST_MODE`、`NMO_TEST_SPEC`、`NMO_TEST_OUT`、`NMO_EVIDENCE_DIR`），但打包版还要求 exe 同目录有 `nmo-test.flag`，手敲命令时容易漏，建议走 runner。

### 8.3 什么算"计算结果变了"

用同一张输入图、同一组参数，比较四张画布：

| 现象 | 判定 |
| --- | --- |
| `compare()` 返回 `identical: true` | 没变 |
| `differingPixels > 0` 或 `maxChannelDelta > 0` | 变了，哪怕只差 1 个像素的 1 个通道 |
| 宽高不一致（`sizeEqual: false`） | 变了，而且更严重 |
| 只有 PNG/JPEG/TIFF 文件字节不同、像素相同 | 导出编码变了，算法没变 |
| 只有窗口布局、字号、位置变了 | 与算法无关 |

这套判定是零容差的。基线副本的意义是把"换机器/换驱动带来的 1 LSB 差异"排除在比较之外：两个窗口在同一次运行、同一块 GPU 上渲染。跨机器是否真的只差 1 LSB，未验证；基线对比只保证同机同构建下可比。

如果你**有意**改了算法，基线对比必然会失败，这是预期行为。不要为了让测试变绿去改 `tests/baseline/site`；应该新增一份"新的期望输出"并与基线并列记录，同时在提交说明里写清"这是有意的算法变更"。

### 8.4 证据

测试产物默认写到 `evidence/`（`NMO_EVIDENCE_DIR` 可覆盖）。当前已有 `evidence/phase1/smoke-result.json` 与截图。改完保留一份新的结果，方便对比 build 信息和画布尺寸。

## 9. 重新打包

前置条件：

1. 已执行 `npm install`，`node_modules/electron/dist/electron.exe` 存在（`pack.js:48` 会检查，缺了直接退出）。
2. 应用没有在运行。Windows 会锁住 `dist/` 里的 exe 和 dll，运行中打包通常会因文件占用在 `fs.rmSync` 处失败。
3. 在 Windows 上打包会对 zip 调用 `powershell.exe`；非 Windows 走 `zip` 命令（当前交付目标是 Windows x64）。

执行 `npm run pack`。产物：

| 路径 | 内容 |
| --- | --- |
| `dist/NormalMap Desktop-1.0.0-win32-x64/` | 便携文件夹：Electron runtime + `NormalMap Desktop.exe` + `resources/app/{package.json,desktop,renderer}` |
| `dist/NormalMap Desktop-1.0.0-win32-x64.zip` | 上述文件夹的压缩包 |
| `dist/BUILD.json` | 构建时间、版本；`runtime` 是随包运行时的 Electron/Chromium/Node/V8（由打包后的 exe 自报），`buildHost` 是构建机的 Node 与平台；文件夹名、zip 名 |

文件夹名来自 `package.json` 的 `productName` + `version`；改版本号，产物路径随之改变。`pack.js` 会删掉 Electron 自带的 `resources/default_app.asar`，避免默认应用被访问；根目录若存在 `LICENSE`、`LICENSE-THIRD-PARTY.md`、`THIRD_PARTY_NOTICES.md`、`使用说明.md` 会一起复制到 exe 旁边，不存在则跳过。

不会被打进包里的：`docs/`、`tests/`、`build/`、`node_modules/`、`evidence/`。也就是说，最终用户拿到的包里没有 `tests/` 目录和文档；`desktop/test-hooks.js` 会随整个 `desktop/` 被复制进去，但要同时满足 `NMO_TEST_MODE=1` 与 exe 同目录存在 `nmo-test.flag` 才会执行（见 `desktop/main.js` 的 `IS_TEST`）。发布包里没有这个标记文件，`pack.js` 也会在压缩前清掉残留。

exe 未签名。分发时可能需要向用户说明 SmartScreen 提示（未验证具体文案）。

## 10. 源码工程、开发依赖、便携包的区别

| 目录/对象 | 是什么 | 用途 | 能不能改 |
| --- | --- | --- | --- |
| 源码工程（仓库根） | `desktop/`、`renderer/`、`tests/`、`build/`、`package.json` | 开发、调试、跑测试、打包的输入 | 改这里 |
| `node_modules/electron/` | 开发时启动用的 Electron runtime，也是打包时复制的源 | `npm start` 启动；`npm run pack` 从这里复制 runtime | 不改；升级就改 `package.json` 的版本后重新 `npm install` |
| `dist/NormalMap Desktop-1.0.0-win32-x64/` | 生成物，自带 runtime，不依赖 Node/npm | 交付给最终用户，解压双击 exe | 不改；下次 `npm run pack` 会整个删掉重建 |

一句话区分：源码工程是"能改的"，`node_modules/electron` 是"工具"，`dist/` 是"给用户的成品"。调试时改 `dist/` 里的文件不会影响源码，重打包就丢。

## 11. 改之前应该知道的边角

以下都是读代码确认过的事实，不是猜测：

1. **测试入口缺失**：`npm test` 指向的 `tests/run-all.js` 不在当前副本里，现在跑会失败。先补 runner，再谈自动化验证。
2. **批量异常不会收尾**：`nmo-desktop-bridge.js` 的 `exportMany` 里，`try/finally` 的 finally 是空的；如果 `writeBatchFile` 的 IPC 本身 reject（而不是返回 `{ok:false}`），异常会跳过后面的 `finishBatch`，主进程 `batchSessions` 里会留下一个没有关闭的会话。要修就在 finally 里调 `finishBatch` 或把循环包进 catch。
3. **批量结束提示会被覆盖**：`filedrop.js:134` 先显示 `finishBatch` 的汇总，`:136` 又用 "skipped N files" 覆盖同一条 toast，有跳过文件时看不到写入统计。要么合并文案，要么把 skipped 改成追加。
4. **批量会话没有超时**：`batchSessions` 只在 `end-batch` 或退出时清理，页面崩溃不会自动回收。长时间运行且频繁取消的场景需要考虑 TTL。
5. **重算策略不一致**：法线和 AO 每次 set 都重算，位移有 50ms 节流并尊重 `auto_update`，Specular 每次重算。加新参数时按所属模块的现有策略走，别默认"都一样"。
6. **自动更新的 UI 是关的**：`index.html` 里 auto update 区块被注释，`main.js:296-304` 的 `updateCurrentTexture()` 用了未加前缀的 `TextureEnum`，直接调用会抛 `ReferenceError`。如果以后要恢复这个 UI，先修这一行。

## 11.5 改命名规则 / 加一种新属性（1.1.0 起）

命名相关的改动只认一个文件：`renderer/shared/naming.js`。它同时被页面和主进程 `require`，两处规则不会再各写一份。

### 加一种属性

1. `PROPERTIES` 与 `PROPERTY_LIST` 各加一项（值就是文件名里那一段，例如 `Opacity`）。
2. `renderer/javascripts/main.js`：
   - `buildImageRecord()` 里加 `type == "OpacityMap"` 的画布来源；
   - `PROPERTY_BY_TYPE` 里把贴图类型映射到新属性；
   - 如果它要出现在“全部导出”里，加进 `getSelectedTypes()` 对应的勾选集合与 `EXPORT_OUTPUTS`。
3. `renderer/index.html` 贴图选择区加勾选框（id 形如 `opacity_tick`）。
4. 主进程不需要改：`export-plan.writeOne()` 只校验属性白名单，白名单来自 `naming.js`。

### 改文件名格式

只改 `buildFileName()`，并同步改测试：

| 测试 | 断言点 |
| --- | --- |
| `tests/specs/naming.spec.js` | `wood_001`、`999→1000`、补图沿旧号 |
| `tests/specs/export-all.spec.js` | 四个文件的完整名字 |
| `tests/specs/orm.spec.js` | `wood_001_ORM.png` |
| `tests/specs/presets.spec.js` | 停止退号后下一张正好接上 |

### 不要做的事

- 不要在 `desktop/export-plan.js` 里再拼一次文件名；它只调用 `naming.buildFileName()`。
- 不要把类别或编号写进预设文件；预设有意不碰编号（`presets.spec.js` D02 会失败）。
- 不要让页面提交路径或完整文件名；`write-plan-file` 只收 `category/property/type/data`。

## 12. 提交前自检

- [ ] 改的是"该改的那一层"：算法在 `renderer/javascripts/`，窗口在 `desktop/`，样式分工按第 2.2 节。
- [ ] 没有动 `tests/baseline/site/`。
- [ ] 没有在 `desktop/` 里加像素处理，没有在 `buildImageRecord` 里改尺寸。
- [ ] 新参数同时写了两套法线 uniform（如果影响法线）。
- [ ] 新导出格式的 `type` 是 `IMAGE_TYPES` 的键，魔数校验不是只看 4 字节。
- [ ] 新增 IPC 有 `assertTrustedSender`，参数里没有路径。
- [ ] `npm start` 手工走完单文件/All/批量三条导出。
- [ ] 如果改了算法，记录了像素差异；如果没打算改算法，`compare()` 应为 `identical`。
- [ ] `npm run pack` 前关掉了正在运行的旧版本。
- [ ] 动了命名/属性时，`naming.js` 与四个相关 spec 一起改（见 11.5）。
