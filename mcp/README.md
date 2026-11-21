# NormalMap 本地 MCP 和 HTTP

在便携目录启动 NormalMap Desktop.exe --agent --agent-out="授权的素材根目录"。需要多个根可重复提供参数。默认输出目录须已存在。Agent 使用本机 127.0.0.1 和随机 Bearer 令牌；发现文件在 %APPDATA%\NormalMap Desktop\agent.json；自定义 --profile 时可通过 NMO_AGENT_FILE 指定发现文件。

MCP 客户端通过 stdio 运行 node normalmap-mcp.js。没有 Node 时，也可以用同目录上一级的 NormalMap Desktop.exe 运行这个 JS，并仅为此客户端进程设置 ELECTRON_RUN_AS_NODE=1。用 tools/list 取得参数描述。

HTTP 使用 POST /command，JSON 格式 {"cmd":"命令","args":{}}。先用 get_parameters 读取控件名及当前值，再用 set_parameters 传 {"data":{"controls":{"rough_value":0.65},"orm":false}}。后台参数与前台隔离。list_presets 返回名称和内容；apply_preset、save_preset、rename_preset、delete_preset 管理预设。覆盖需要 confirm=true。

open_image 接受 path、可选 preset 和 params。export 接受 dir、可选 baseName 和 types。batch 接受公共 dir、types 和 items，每项可指定 path、dir、baseName、preset、params。最多 1000 项。dry_run 接受同样的导出清单并返回每项的目录、基础名、完整计划文件名。async=true 返回 jobId，progress 返回 events 和最终 job.result，cancel 请求在下一张开始前停止，batch_state 查历史。item_done 事件含 index、total、name 和本项写出的文件。输出的 stddev 是亮度标准差，和 mean 同用 0–255 量纲。JSON 请求上限 1 MiB。

get_gui_parameters 可读前台参数。use_gui_parameters 将此刻的前台参数复制给后台。import_mask 接受 kind（rough 或 metal）、path 和可选 resample。
