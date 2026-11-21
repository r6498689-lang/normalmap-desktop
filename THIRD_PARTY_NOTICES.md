# 第三方组件与许可声明

本文件适用于 **NormalMap Desktop 1.0.0**（Windows x64 便携版，下文简称“本程序”）。

本程序是把开源网站 [NormalMap-Online](https://github.com/cpetry/NormalMap-Online) 的 `gh-pages` 分支打包成的离线桌面程序。除本地编写的桌面封装代码外，界面、着色器与美术资源均来自原项目及其第三方依赖。

阅读约定：

- 表格中“随包分发”指该文件实际出现在发布文件夹里，而不是只被引用。
- 各组件下方的许可以及版权文字均为**英文原文照抄**，未作翻译或改写；中文只用于说明。
- 若某个组件的许可全文没有随包附带，会明确写“未随包提供”并给出出处 URL，不在此处补写全文。
- 本文件只描述许可与署名，不构成法律意见。

## 一、组件清单

| 名称 | 版本 | 作者 / 版权持有者 | 许可 | 包内位置 | 随包分发 |
| --- | --- | --- | --- | --- | --- |
| NormalMap-Online（原始程序） | `gh-pages` 树 `b806a793581cd42e31c857a28eeea8079ee583f8` | Christian Petry | MIT | `renderer/`（`LICENSE`、`index.html`、`javascripts/`、`shader/`、`stylesheets/` 等） | 是 |
| three.js | r80（`three.min.js` 内 `REVISION="80"`） | three.js authors（Mr.doob 等） | MIT | `renderer/javascripts/extern/three.min.js` | 是 |
| three.js（未压缩副本，未加载） | 文件内 `REVISION = '81dev'` | 同上 | MIT | `renderer/javascripts/extern/three.js` | 是（`index.html` 未引用，运行时不加载） |
| three.js 示例扩展（OrbitControls / OBJLoader / EffectComposer / RenderPass / ShaderPass / MaskPass / CopyShader / TeapotBufferGeometry） | 文件内未标注版本（随原仓库引入） | 各文件 `@author` 行标注的示例作者 | MIT（文件内仅有 `@author` 行，无许可正文） | `renderer/javascripts/extern/` | 是 |
| jQuery | 2.1.1 | jQuery Foundation, Inc. | MIT | `renderer/javascripts/extern/jquery-2.1.1.min.js` | 是 |
| jQuery UI | 1.11.4（仅 `effect.js`、`effect-drop.js`、`effect-slide.js`） | jQuery Foundation and other contributors | MIT | `renderer/javascripts/extern/jquery-ui.min.js` | 是 |
| fancyBox | 2.1.5 | Janis Skarnelis | GPLv3 与商业授权双许可（GPLv3 全文未随包提供） | `renderer/javascripts/fancybox/source/` | 是 |
| CanvasToTIFF（canvas-to-tiff） | 1.6.1 | epistemex.com | MIT | `renderer/javascripts/extern/canvastotiff.min.js` | 是 |
| FileSaver.js | 文件内未标注版本 | Eli Grey | MIT（文件头无许可正文，全文未随包提供） | `renderer/javascripts/extern/filesaver.min.js` | 是 |
| Blob.js | 2014-07-24 | Eli Grey、Devin Samarin | X11/MIT（全文未随包提供） | `renderer/javascripts/extern/blob.js` | 是 |
| canvas-toBlob.js | 2013-12-27 | Eli Grey、Devin Samarin | X11/MIT（全文未随包提供） | `renderer/javascripts/extern/canvas-toBlob.js` | 是 |
| jsTGALoader | 1.2.0 | Vincent Thibault | BSD 二条款（全文在文件头） | `renderer/javascripts/extern/readTGA.js` | 是 |
| ganalytics.js | 未标注 | Google Analytics 通用嵌入片段（站点 ID `UA-52374438-1`） | 文件内无版权与许可声明 | `renderer/javascripts/extern/ganalytics.js` | 文件在包内，但 `index.html` 未引用，运行时不加载、不执行 |
| Open Sans 字体（latin 400 / 700） | v29 | The Open Sans Project Authors | SIL Open Font License 1.1（全文未随包提供） | `renderer/fonts/` | 是 |
| 环境贴图 `cubemaps/park` | 未标注 | Emil Persson（Humus） | Creative Commons Attribution 3.0 Unported（CC BY 3.0） | `renderer/cubemaps/park/` | 是（`readme.txt` 内含署名与许可） |
| 示例照片 `default_picture_*.jpg` | 未标注 | Christian Petry | 未单独附许可文件（随原仓库分发，仓库 `LICENSE` 为 MIT） | `renderer/images/` | 是 |
| Electron | 45.3.2 | Electron contributors；2013-2020 GitHub Inc. | MIT | 发布文件夹根目录 `LICENSE` | 是 |
| Chromium | 随 Electron 45.3.2 捆绑 | Chromium 项目及其贡献者 | BSD 类等多种许可（汇总文件） | 发布文件夹根目录 `LICENSES.chromium.html` | 是 |
| Node.js | 随 Electron 45.3.2 捆绑 | Node.js contributors | MIT 及第三方许可（汇总在同一文件内） | 发布文件夹根目录 `LICENSES.chromium.html` | 是 |

说明：

- 运行时的许可文件由 Electron 官方发行包原样附带，打包脚本只做复制，没有删改。
- `renderer/javascripts/extern/three.js` 存在但未被 `index.html` 引用；页面实际加载的是 `three.min.js`（r80）。两者都保留了上游文件，因此都列入本表。
- `ganalytics.js` 是原站用于 Google Analytics 的旧封装。本程序不加载它，也不发送任何统计数据；文件仅为与原仓库保持一致的完整拷贝。经检查，`renderer/index.html` 与 `renderer/javascripts/*.js` 中没有任何对它的引用。
- fancyBox 只在 `renderer/javascripts/renderView.js` 中被调用（图片放大预览），作为独立文件从本地加载。

## 二、各组件的原始声明原文

以下文字从随包文件头部直接复制，保留英文原样。没有版权行的文件会注明“文件内无版权行”。

### 1. NormalMap-Online — `renderer/LICENSE`

```text
MIT License

Copyright (c) 2019 Christian Petry
```

原始代码文件头部另有一处较早的版权年份，例如 `renderer/javascripts/filedrop.js`：

```text
/*
 * Author: Christian Petry
 * Homepage: www.petry-christian.de
 *
 * License: MIT
 * Copyright (c) 2014 Christian Petry
 */
```

原仓库 `renderer/README.md` 中关于产出物归属的说明：

```text
You may use all normal maps you create here as you see fit. They are yours and will not be saved anywhere. The scripts are running on your machine only.
```

### 2. three.js — `renderer/javascripts/extern/three.min.js`

文件内无版权行，仅第一行为：

```text
// threejs.org/license
```

上游 MIT 许可全文未随包提供，见 <https://github.com/mrdoob/three.js/blob/r80/LICENSE>。

同一目录下的示例文件保留了各自作者行，例如 `OrbitControls.js`：

```text
/**
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 */
```

### 3. jQuery — `renderer/javascripts/extern/jquery-2.1.1.min.js`

```text
/*! jQuery v2.1.1 | (c) 2005, 2014 jQuery Foundation, Inc. | jquery.org/license */
```

### 4. jQuery UI — `renderer/javascripts/extern/jquery-ui.min.js`

```text
/*! jQuery UI - v1.11.4 - 2015-10-14
* http://jqueryui.com
* Includes: effect.js, effect-drop.js, effect-slide.js
* Copyright 2015 jQuery Foundation and other contributors; Licensed MIT */
```

### 5. fancyBox — `renderer/javascripts/fancybox/source/jquery.fancybox.js`

```text
/*!
 * fancyBox - jQuery Plugin
 * version: 2.1.5 (Fri, 14 Jun 2013)
 * @requires jQuery v1.6 or later
 *
 * Examples at http://fancyapps.com/fancybox/
 * License: www.fancyapps.com/fancybox/#license
 *
 * Copyright 2012 Janis Skarnelis - janis@fancyapps.com
 *
 */
```

文件头只给出许可页地址，没有写明具体许可类型，也未附带任何许可全文。上游对该版本的公开说明是：GPLv3 与商业授权双许可。GPLv3 全文未随包提供，见 <https://www.gnu.org/licenses/gpl-3.0.html>；商业授权见 <https://fancyapps.com/fancybox/>。

**这一项的许可条件比 MIT 严格**，是本程序所带组件中限制最多的一项。分发时不能把它当成 MIT 处理。

### 6. CanvasToTIFF — `renderer/javascripts/extern/canvastotiff.min.js`

```text
/*
	canvas-to-tiff 1.6.1
	(c) epistemex.com 2015-2016
	MIT License
*/
```

### 7. FileSaver.js — `renderer/javascripts/extern/filesaver.min.js`

```text
/*! @source http://purl.eligrey.com/github/FileSaver.js/blob/master/FileSaver.js */
```

文件内没有版权行，也没有许可正文。上游为 MIT，全文未随包提供，见 <https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md>。

### 8. Blob.js — `renderer/javascripts/extern/blob.js`

```text
/* Blob.js
 * A Blob implementation.
 * 2014-07-24
 *
 * By Eli Grey, http://eligrey.com
 * By Devin Samarin, https://github.com/dsamarin
 * License: X11/MIT
 *   See https://github.com/eligrey/Blob.js/blob/master/LICENSE.md
 */
```

许可全文未随包提供，见上述 URL。

### 9. canvas-toBlob.js — `renderer/javascripts/extern/canvas-toBlob.js`

```text
/* canvas-toBlob.js
 * A canvas.toBlob() implementation.
 * 2013-12-27
 * 
 * By Eli Grey, http://eligrey.com and Devin Samarin, https://github.com/eboyjr
 * License: X11/MIT
 *   See https://github.com/eligrey/canvas-toBlob.js/blob/master/LICENSE.md
 */
```

许可全文未随包提供，见上述 URL。

### 10. jsTGALoader — `renderer/javascripts/extern/readTGA.js`

```text
 /**
 * @fileoverview jsTGALoader - Javascript loader for TGA file
 * @author Vincent Thibault
 * @version 1.2.0
 * @blog http://blog.robrowser.com/javascript-tga-loader.html
 */

/* Copyright (c) 2013, Vincent Thibault. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */
```

这是 BSD 二条款形式（两条 Redistribution 条件），不是三条款，文件里也没有“不得使用作者名义背书”的第三条。

### 11. ganalytics.js — `renderer/javascripts/extern/ganalytics.js`

文件内无版权行、无许可声明，内容为 Google Analytics 的标准异步嵌入代码：

```text
(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
})(window,document,'script','//www.google-analytics.com/analytics.js','ga');

ga('create', 'UA-52374438-1', 'auto');
ga('send', 'pageview');
```

**本程序不加载、不执行该文件**，也不会连接 `www.google-analytics.com`（运行时网络请求全部被拦截）。保留该文件只是为了让 `renderer/` 与原仓库保持一致。

### 12. Open Sans — `renderer/fonts/open-sans-v29-latin-*.woff2|woff|ttf|eot|svg`

字体文件中没有可读的版权字符串。`renderer/opensans700.css` 只有 `/* open-sans-regular - latin */` 这类分组注释：

```text
/* open-sans-regular - latin */
```

上游采用 SIL Open Font License 1.1。OFL 全文未随包提供，见 <https://github.com/googlefonts/opensans/blob/main/OFL.txt> 或 <https://openfontlicense.org/open-font-license-official-text/>。

### 13. 环境贴图 park — `renderer/cubemaps/park/readme.txt`

```text
Author
======

This is the work of Emil Persson, aka Humus.
http://www.humus.name



License
=======

This work is licensed under a Creative Commons Attribution 3.0 Unported License.
http://creativecommons.org/licenses/by/3.0/
```

CC BY 3.0 要求在使用时保留作者署名与许可标识；本项目保留 `readme.txt` 原文件，并在本表与《使用说明》中署名 Emil Persson。

### 14. 示例照片 — `renderer/images/default_picture_above.jpg` 等 4 个文件

JPEG 文件内没有版权或作者元数据。这四张照片来自原仓库，由 Christian Petry 拍摄，用于“四方向照片”演示。仓库 `LICENSE` 为 MIT，但照片本身没有单独附许可文件；本程序按原样随包分发，不改动、不另行授权。

### 15. Electron — 发布文件夹根目录 `LICENSE`

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.
```

### 16. Chromium / Node.js — 发布文件夹根目录 `LICENSES.chromium.html`

该文件由 Chromium 的 `licenses.py` 生成，开头为：

```text
<!-- Generated by licenses.py; do not edit. -->
```

其中 Node.js 段落开头为：

```text
Node.js
Node.js is licensed for use as follows:
```

Chromium、Node.js 及其捆绑库的许可全文都在这份 HTML 里，随包原样保留，不在本文件中重复。文件大小约 5.7 MB，属正常。

## 三、关于本项目自身

- **桌面封装部分是本地构建的。** `desktop/`（Electron 主进程、保存管理、`app://` 协议）、`renderer/desktop/`（状态栏与链接拦截）、`build/`、`tests/` 为本地新增代码，`package.json` 中标注为 MIT。
- **原始程序与美术资源版权归原作者。** 界面、着色器（`renderer/javascripts/shader/`）、图标、示例照片、`renderer/LICENSE` 均来自 Christian Petry 的 NormalMap-Online，版权与署名归 Christian Petry，不因本地封装而转移。本程序不是原作者发布的版本，也不代表原作者的认可或背书。
- **不要把原作者的法律信息改成本地维护者的。** 分发或再修改时，`renderer/LICENSE`、`renderer/cubemaps/park/readme.txt`、各第三方文件头必须保留原样。
- **用户产出的贴图归用户。** 依原项目说明，生成的法线/位移/AO/高光贴图由使用者自由处置；本程序不上传、不保存这些图片。
- **本程序不提供任何担保。** 各组件的许可均为“按现状提供”，详见各许可全文。
