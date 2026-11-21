# NormalMap Desktop

基于 [NormalMap-Online](https://github.com/cpetry/NormalMap-Online)（作者 Christian Petry，MIT）改造的 **Windows 桌面版贴图工具**。全部计算在本机完成，可离线使用，并对外提供本地自动化接口。

![version](https://img.shields.io/badge/version-1.2.0-blue)

## 功能

- **离线生成**：法线、置换、AO、高光、粗糙度、金属度，源图与输出均为本地文件，不联网
- **ORM 打包**：勾选 AO、粗糙度、金属度后开启 ORM，仅输出 `_ORM` 一张替代这三张，通道顺序 R=AO、G=粗糙度、B=金属度
- **参数预设**：内置 20 个出厂材质预设；可保存、覆盖、改名、删除自己的预设，保存同名会先确认
- **参数记忆**：停止操作后自动写入本机配置，重开程序恢复上次状态
- **批量导出**：支持每张单独改名、单独选预设，带预览、进度、断点续跑与失败重试，自动处理重名
- **本地 Agent 接口**：`--agent` 启动后仅监听 `127.0.0.1`，用 Bearer 令牌鉴权，供脚本或 AI 调用

## 运行

需要 Node.js 18+。

```bash
npm install
npm start
```

## 打包

```bash
npm run pack
```

生成 `dist/` 下的便携版文件夹和 ZIP，`resources/app` 由 `desktop/`、`renderer/`、`mcp/` 等目录复制产生。

## 测试

```bash
npm test              # 全部用例
npm run test:packaged # 针对打包后的便携版
```

部分历史用例针对 1.1.x 的旧行为（分类、编号等），运行前请按当前功能判断。

## 目录结构

| 目录 | 内容 |
|---|---|
| `desktop/` | Electron 主进程、导出逻辑、Agent 服务 |
| `renderer/` | 界面、贴图算法、预设与编号 |
| `mcp/` | 本地自动化接口与批量命令行封装 |
| `build/` | 打包与资源导入脚本 |
| `tests/` | 单元、端到端与验收用例 |
| `docs/` | 架构说明、改造指引、与上游的差异 |

## 本地 Agent 接口

```bash
NormalMap Desktop.exe --agent
```

启动后会在用户配置目录生成 `agent.json`，内含端口与令牌。所有请求走 `POST http://127.0.0.1:<port>/command`，头部带 `Authorization: Bearer <token>`。

批量导出示例：

```bat
mcp\material-batch.cmd "D:\Assets\Textures" --preview
```

详见 [`mcp/README.md`](mcp/README.md) 与 [`使用说明.md`](使用说明.md)。

## 许可

MIT。原始程序版权归 Christian Petry（2019），本仓库的修改部分版权归 NormalMap Desktop contributors。

第三方组件的完整许可全文见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与 [`LICENSE-THIRD-PARTY.md`](LICENSE-THIRD-PARTY.md)。

## 致谢

- [NormalMap-Online](https://github.com/cpetry/NormalMap-Online) — Christian Petry，MIT
- [Electron](https://www.electronjs.org/) — MIT
- [three.js](https://threejs.org/) — MIT

## English

A Windows desktop fork of NormalMap-Online: fully offline texture-map generation (normal, displacement, AO, specular, roughness, metallic) with ORM packing, material presets, batch export with resume, and a local agent API bound to `127.0.0.1` with bearer-token auth.

```bash
npm install && npm start
npm run pack    # build portable folder + zip into dist/
```

Licensed under MIT. Original work © 2019 Christian Petry; modifications © 2026 NormalMap Desktop contributors.
