# 第三方许可全文汇编（LICENSE-THIRD-PARTY）

本文件汇集 **NormalMap Desktop 1.0.0** 随包分发的第三方组件的许可全文，与 `THIRD_PARTY_NOTICES.md` 中的组件清单一一对应。组件名称、版本、包内位置的完整列表见该文件。

阅读约定：

- 许可正文保留英文原样。中文只用于说明适用对象。
- “标准 MIT 全文”在原文中只有版权行不同，因此每个组件各自成节，并在节首注明版权持有者。
- 如果许可全文没有随包附带，本节只写“未随包提供”、出处 URL 与要点摘要，不补写全文。
- 运行时的 `LICENSE` 与 `LICENSES.chromium.html` 由 Electron 官方发行包原样附带，位于发布文件夹根目录。

---

## 1. NormalMap-Online（原始程序）

版权持有者：Christian Petry（`renderer/LICENSE`：`Copyright (c) 2019 Christian Petry`）
包内位置：`renderer/`
许可：MIT

```text
MIT License

Copyright (c) 2019 Christian Petry

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. three.js（含示例扩展）

版权持有者：three.js authors（Mr.doob 及贡献者）。上游 LICENSE 的版权行未随包提供，包内 `three.min.js` 仅有一行 `// threejs.org/license`。
包内位置：`renderer/javascripts/extern/three.min.js`、`three.js`、`OrbitControls.js`、`OBJLoader.js`、`EffectComposer.js`、`RenderPass.js`、`ShaderPass.js`、`MaskPass.js`、`CopyShader.js`、`TeapotBufferGeometry.js`
许可：MIT

```text
The MIT License

Copyright (c) three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

上游许可原文：<https://github.com/mrdoob/three.js/blob/r80/LICENSE>

---

## 3. jQuery

版权持有者：jQuery Foundation, Inc.（`(c) 2005, 2014 jQuery Foundation, Inc.`）
包内位置：`renderer/javascripts/extern/jquery-2.1.1.min.js`
许可：MIT

```text
The MIT License

Copyright (c) 2005, 2014 jQuery Foundation, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 4. jQuery UI（1.11.4，仅 effects 部分）

版权持有者：jQuery Foundation and other contributors（`Copyright 2015 jQuery Foundation and other contributors`）
包内位置：`renderer/javascripts/extern/jquery-ui.min.js`
许可：MIT

```text
The MIT License

Copyright 2015 jQuery Foundation and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 5. fancyBox 2.1.5

版权持有者：Janis Skarnelis（`Copyright 2012 Janis Skarnelis - janis@fancyapps.com`）
包内位置：`renderer/javascripts/fancybox/source/`（`jquery.fancybox.js`、`jquery.fancybox.pack.js`、CSS、图片、`helpers/`）
许可：GPLv3 与商业授权双许可

本项目按 **GPLv3** 分发该组件：它作为独立文件随包分发，由 `index.html` 以 `<script>` 从本地路径加载，只在本地创建图片放大预览；它没有与主程序的其他代码静态链接、合并打包或编译进同一个二进制。GPLv3 完整文本见 <https://www.gnu.org/licenses/gpl-3.0.html>（本包未附带该文本）。如需在闭源条件下分发，可向 fancyapps 获取商业授权：<https://fancyapps.com/fancybox/>。

GPLv3 完整文本未随包提供，见 <https://www.gnu.org/licenses/gpl-3.0.html>。

该组件是本包中许可条件最严格的一项，**不得按 MIT 处理**。

---

## 6. CanvasToTIFF（canvas-to-tiff 1.6.1）

版权持有者：epistemex.com（`(c) epistemex.com 2015-2016`）
包内位置：`renderer/javascripts/extern/canvastotiff.min.js`
许可：MIT

```text
The MIT License

Copyright (c) 2015-2016 epistemex.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 7. FileSaver.js

版权持有者：Eli Grey（文件内只有 `@source` 行，版权行与许可正文未随包提供）
包内位置：`renderer/javascripts/extern/filesaver.min.js`
许可：MIT

```text
The MIT License

Copyright (c) Eli Grey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

上游许可原文：<https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md>

---

## 8. Blob.js

版权持有者：Eli Grey、Devin Samarin
包内位置：`renderer/javascripts/extern/blob.js`
许可：X11/MIT（文件头标注 `License: X11/MIT`）

X11/MIT 与上面的 MIT 文本条款一致，只是标题行写法不同。许可全文未随包提供，见 <https://github.com/eligrey/Blob.js/blob/master/LICENSE.md>。

```text
The MIT License (X11)

Copyright (c) Eli Grey, Devin Samarin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 9. canvas-toBlob.js

版权持有者：Eli Grey、Devin Samarin
包内位置：`renderer/javascripts/extern/canvas-toBlob.js`
许可：X11/MIT（文件头标注 `License: X11/MIT`）

许可全文未随包提供，见 <https://github.com/eligrey/canvas-toBlob.js/blob/master/LICENSE.md>。条款与上一节相同，此处不重复。

---

## 10. jsTGALoader 1.2.0

版权持有者：Vincent Thibault（`Copyright (c) 2013, Vincent Thibault. All rights reserved.`）
包内位置：`renderer/javascripts/extern/readTGA.js`
许可：BSD 二条款（原文随文件头附送，以下为照抄）

```text
Copyright (c) 2013, Vincent Thibault. All rights reserved.

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
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 11. ganalytics.js

版权持有者：未标注（Google Analytics 通用嵌入片段）
包内位置：`renderer/javascripts/extern/ganalytics.js`
许可：文件内无版权与许可声明

该文件不被 `index.html` 引用，运行时不加载、不执行，也不会产生任何网络请求。因文件内没有许可声明，无法在此列出许可全文；如需了解 Google Analytics 脚本的使用条款，见 <https://policies.google.com/technologies/partner-sites>。

---

## 12. Open Sans 字体

版权持有者：The Open Sans Project Authors
包内位置：`renderer/fonts/open-sans-v29-latin-regular.*`、`renderer/fonts/open-sans-v29-latin-700.*`
许可：SIL Open Font License 1.1

**OFL 1.1 全文未随包提供**，见 <https://github.com/googlefonts/opensans/blob/main/OFL.txt> 与官方文本 <https://openfontlicense.org/open-font-license-official-text/>。

OFL 1.1 的主要义务（摘要，不替代原文）：

- 允许自由使用、复制、合并、修改、分发字体，包括随商业软件一起分发。
- 字体文件本身不得单独销售。
- 修改后的字体不得继续使用保留字体名（Reserved Font Name），本包未修改字体文件，保留原名。
- 随字体分发的文档中需保留版权声明与本许可文本。

---

## 13. 环境贴图 park（cubemaps）

版权持有者：Emil Persson（Humus），<http://www.humus.name>
包内位置：`renderer/cubemaps/park/`（`posx/negx/posy/negy/posz/negz.jpg`、`readme.txt`）
许可：Creative Commons Attribution 3.0 Unported（CC BY 3.0）

**CC BY 3.0 全文未随包提供**，见 <https://creativecommons.org/licenses/by/3.0/>。包内 `readme.txt` 保留了作者与许可标识。

CC BY 3.0 的主要义务（摘要，不替代原文）：

- 使用（含复制、分发、公开演示、修改）时必须保留作者署名（Emil Persson / Humus）、作品来源与许可标识。
- 必须标明是否作过修改。本包未修改贴图文件。
- 不得暗示作者为本程序背书。

---

## 14. 示例照片 default_picture_*.jpg

版权持有者：Christian Petry（原仓库示例照片，文件内无版权元数据）
包内位置：`renderer/images/default_picture_above.jpg`、`default_picture_below.jpg`、`default_picture_left.jpg`、`default_picture_right.jpg`
许可：未单独附许可文件

这四张照片随原仓库分发，仓库根 `renderer/LICENSE` 为 MIT，但照片本身没有随包附带独立的许可声明，因此本文件不为其编造全文。若需在其它项目中使用这些照片，请先向原作者取得许可。

---

## 15. Electron 45.3.2

版权持有者：Electron contributors、GitHub Inc.
包内位置：发布文件夹根目录 `LICENSE`（打包时原样复制自 Electron 官方发行包）
许可：MIT

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 16. Chromium

版权持有者：Chromium 项目及其贡献者
包内位置：发布文件夹根目录 `LICENSES.chromium.html`
许可：BSD 三条款为主的多种开源许可

**许可全文未单独提供**，全部汇总在随包的 `LICENSES.chromium.html`（约 5.7 MB，由 Chromium 的 `licenses.py` 生成，逐条列出 Chromium 及其捆绑库的许可与版权）。上游说明见 <https://www.chromium.org/Home/>。

---

## 17. Node.js

版权持有者：Node.js contributors
包内位置：发布文件夹根目录 `LICENSES.chromium.html`（内含 `Node.js is licensed for use as follows:` 段落）
许可：MIT 及捆绑库的第三方许可

**许可全文未单独提供**，见随包的 `LICENSES.chromium.html`，或上游 <https://github.com/nodejs/node/blob/main/LICENSE>。

---

## 18. 本程序自身（本地封装部分）

版权持有者：本程序的本地构建者
包内位置：`desktop/`、`renderer/desktop/`、`build/`、`tests/`、`package.json`
许可：MIT（`package.json` 中 `"license": "MIT"`）

这一部分只覆盖本地新增的桌面封装代码，**不覆盖** `renderer/` 中的原始程序与美术资源；后者的版权归 Christian Petry，见第 1 节。
