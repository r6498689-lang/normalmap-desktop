#!/usr/bin/env node
'use strict';

/*
 * normalmap-mcp.js — NormalMap Desktop 的 MCP 适配器（1.1.17）
 *
 * 本身不碰图像，只把 MCP 的 tools/call 翻译成对运行中程序的
 * 本机 HTTP 命令（见 docs/HANDOFF_AGENT_MODE.md）。
 *
 * 零依赖，只用 Node 内置模块；stdio 上跑换行分隔的 JSON-RPC。
 * 程序要先以 --agent 启动，否则每次调用都会返回一条“先启动”的提示。
 *
 * 环境变量：
 *   NMO_AGENT_FILE  发现文件路径，默认 %APPDATA%\NormalMap Desktop\agent.json
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

const SERVER_NAME = 'normalmap-desktop';
const SERVER_VERSION = '1.0.0';
const DEFAULT_FILE = path.join(
  process.env.APPDATA || process.env.HOME || '',
  'NormalMap Desktop',
  'agent.json'
);

function discoveryFile() {
  return process.env.NMO_AGENT_FILE || DEFAULT_FILE;
}

function readAgentInfo() {
  const file = discoveryFile();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      '找不到 Agent 令牌文件：' + file + '。请先启动 "NormalMap Desktop.exe" --agent（托盘出现图标即可）。'
    );
  }
  let info;
  try {
    info = JSON.parse(raw);
  } catch (err) {
    throw new Error('令牌文件不是合法 JSON：' + file + '（' + err.message + '）');
  }
  if (!info.port || !info.token) throw new Error('令牌文件缺少 port/token：' + file);
  return info;
}

function callAgent(cmd, args, timeoutMs) {
  const info = readAgentInfo();
  const body = Buffer.from(JSON.stringify({ cmd: cmd, args: args || {} }), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: '/command',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          Authorization: 'Bearer ' + info.token
        },
        timeout: timeoutMs || 30000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(new Error('程序返回的不是 JSON（HTTP ' + res.statusCode + '）'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时：' + cmd)));
    req.on('error', (err) => reject(err));
    req.end(body);
  });
}

const TYPES = ['normal', 'displacement', 'ao', 'specular', 'roughness', 'metallic', 'all'];

const TOOLS = [
  {
    name: 'normalmap_status',
    description:
      '查看 NormalMap Desktop 当前状态：打开的图片与尺寸、类别、法线/粗糙度/金属度参数、已生成哪些贴图。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'normalmap_open_image',
    description:
      '在本机打开一张高度图并套用类别预设。之后才能导出。推荐流程：先 normalmap_preview 看图，再 normalmap_list_categories 选一个类别，最后带 category 打开。基础名可单独指定。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片绝对路径（png/jpg/bmp/tga/tif 等）' },
        category: {
          type: 'string',
          description: '类别值，例如 wood、concrete、stone、metal；也可以直接使用 preset'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'normalmap_list_categories',
    description:
      '列出可用的材质类别：value、中文标签、粗糙度/金属度预设，以及当前图片已选的类别。给图片选类别前先调它。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'normalmap_preview',
    description:
      '看一眼图片：返回缩略图（MCP image 内容）与尺寸/配色统计。带 path 可预览磁盘上的文件（导入前就能看，不改当前状态）；不带 path 看当前已打开的图。看完再用 normalmap_open_image 或 normalmap_set_category 指定类别。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片绝对路径；省略则看当前已打开的图' },
        max: {
          type: 'integer',
          description: '缩略图最长边像素，默认 512，范围 64–1024。看细节可给 768/1024。'
        },
        which: {
          type: 'string',
          enum: ['source', 'normal'],
          description: 'source=源图/基础颜色（默认），normal=已生成的法线图'
        },
        format: {
          type: 'string',
          enum: ['png', 'jpg', 'tiff', 'tga'],
          description:
            '缩略图格式，默认 png。给模型看建议 png 或 jpg（多数视觉接口不认 tiff/tga）；tiff/tga 主要用于存盘后处理。'
        },
        quality: {
          type: 'integer',
          description: '仅 jpg 有效，1–100，默认 88'
        }
      }
    }
  },
  {
    name: 'normalmap_preview_batch',
    description:
      '一次看多张图（最多 8 张）：每张返回一个 image 内容块与尺寸/配色统计。给一批图选类别时先调这个，比逐张 normalmap_preview 少很多来回。带 path 只读磁盘，不改当前打开的图。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '要看的图，最多 8 张；每张可单独覆盖 max / format / quality',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '图片绝对路径' },
              max: { type: 'integer', description: '这张缩略图的最长边，省略用顶层 max' },
              format: { type: 'string', enum: ['png', 'jpg', 'tiff', 'tga'] },
              quality: { type: 'integer', description: '仅 jpg 有效，1–100' }
            },
            required: ['path']
          }
        },
        max: { type: 'integer', description: '默认最长边，默认 384（批量建议 256–512）' },
        format: {
          type: 'string',
          enum: ['png', 'jpg', 'tiff', 'tga'],
          description: '默认格式，默认 png；照片多时用 jpg 省 token。多数视觉接口只认 png/jpg。'
        },
        quality: { type: 'integer', description: '仅 jpg 有效，1–100，默认 88' }
      },
      required: ['items']
    }
  },
  {
    name: 'normalmap_set_category',
    description: '切换当前图片的类别，并按新类别重新估算粗糙度/金属度基础值。',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: '类别值，例如 wood、stone' } },
      required: ['category']
    }
  },
  {
    name: 'normalmap_export',
    description:
      '把当前图片生成并写入指定目录。编号由程序统一分配，文件名形如 wood_012_Normal.png；返回每个文件的路径、宽高、亮度均值/极值、SHA-256。',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '导出目录的绝对路径（须已存在且获授权）' },
        types: {
          type: 'array',
          items: { type: 'string', enum: TYPES },
          description:
            '要导出的贴图；默认 normal、displacement、ao、specular。传 ["all"] 表示全部六张。'
        }
      },
      required: ['dir']
    }
  },
  {
    name: 'normalmap_batch_export',
    description:
      '批量导出：一次传最多 1000 张图，每张带自己的类别，逐张导入并写入同一目录，返回每张的文件名、宽高、均值、SHA-256 或失败原因。类别不确定时先对每张调 normalmap_preview。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '最多 1000 张；每张 path 必填，省略预设时沿用当前参数',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '图片绝对路径' },
              category: { type: 'string', description: '该图的类别值，例如 wood、carpet' }
            },
            required: ['path']
          }
        },
        dir: { type: 'string', description: '导出目录的绝对路径（须已存在且获授权）' },
        types: {
          type: 'array',
          items: { type: 'string', enum: TYPES },
          description: '要导出的贴图，同 normalmap_export；每张图都按这组类型生成'
        },
        async: {
          type: 'boolean',
          description:
            'true 时立即返回 jobId，不等待完成；之后用 normalmap_batch_progress 查进度。默认 false（等到全部结束再返回）。'
        },
        retry: {
          type: 'integer',
          description: '单张失败重试次数，0–3，默认 0。文件不存在/格式不支持这类确定性错误不重试。'
        },
        resume: {
          type: 'boolean',
          description:
            'true 时按 dir+types+items 找回上次的账本，跳过已经成功写出过的图；用于中断后续跑。items 的顺序不影响匹配。默认 false。'
        },
        batchId: {
          type: 'string',
          description:
            '可选批次名（1–64 字符）。同一 dir+types 下用它标识一批：中途加了图/删了图，续跑仍能认出已完成的。给了 batchId 时 items 不参与匹配。'
        }
      },
      required: ['items', 'dir']
    }
  },
  {
    name: 'normalmap_batch_progress',
    description:
      '查看批量任务的进度：已完成/总数、失败数、状态，以及增量事件（item_start / item_done）。任务结束时会带上完整结果。',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'batch 返回的 jobId；省略则查最近一个任务' },
        since: {
          type: 'integer',
          description: '只返回 seq 大于该值的事件；把上次的 nextSeq 传回来即可增量拉取'
        }
      }
    }
  },
  {
    name: 'normalmap_batch_cancel',
    description:
      '请求取消正在跑的批量任务：当前这张写完后停下，已写出的文件和编号保留，没轮到的图跳过。对 async 批量有效；阻塞中的批量请改用 POST /cancel。',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'batch 返回的 jobId；省略则取消当前正在跑的任务' }
      }
    }
  },
  {
    name: 'normalmap_batch_state',
    description:
      '查批量续跑账本：最近几批的状态、上次这轮写了多少（lastRun）、从第一次到现在累计写了多少（cumulative）、以及每批的 fingerprint / batchId。中断后想 resume 前先看它，确认能跳过几张。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '最多回几批，默认 10，上限 50' },
        dir: { type: 'string', description: '只看某个导出目录的批次；省略则看最近的全部' }
      }
    }
  },
  {
    name: 'normalmap_window',
    description: '显示或隐藏程序窗口。后台运行时可用它让用户看一眼当前效果。',
    inputSchema: {
      type: 'object',
      properties: { show: { type: 'boolean', description: 'true 显示，false 隐藏' } },
      required: ['show']
    }
  },
  {
    name: 'normalmap_log',
    description:
      '最近的命令审计记录（JSONL，含时间、命令、参数摘要、结果码、耗时）。不含图片内容。排查“谁导出了什么/谁改了类别”时用。',
    inputSchema: {
      type: 'object',
      properties: {
        lines: { type: 'integer', description: '回最近多少条，默认 20，最多 200' }
      }
    }
  },
  {
    name: 'normalmap_quit',
    description: '退出 NormalMap Desktop（包括后台托盘进程）。',
    inputSchema: { type: 'object', properties: {} }
  }
];

function toolResult(payload, isError) {
  const image = payload && payload.image;
  /*
   * 预览结果直接按 MCP 的 image 内容回传，客户端（Claude / WorkBuddy 等）
   * 会把它当一张图喂给模型；base64 不再重复塞进文本块。
   */
  if (image && image.data) {
    const meta = Object.assign({}, payload);
    const brief = Object.assign({}, image);
    delete brief.data;
    meta.image = brief;
    return {
      content: [
        { type: 'image', data: image.data, mimeType: image.mime || 'image/png' },
        { type: 'text', text: JSON.stringify(meta, null, 2) }
      ],
      isError: Boolean(isError)
    };
  }
  /*
   * 批量预览：一批图各回一个 image 内容块，文本块只放元数据。
   * imageOrder 记下每个图块对应的 items 下标（失败的项没有图块），
   * 这样模型不会把第 2 张的图当成第 3 张。
   */
  const rows = payload && Array.isArray(payload.items) ? payload.items : null;
  if (rows && rows.some((row) => row && row.image && row.image.data)) {
    const content = [];
    const imageOrder = [];
    const meta = Object.assign({}, payload);
    meta.items = rows.map((row) => {
      if (!row || !row.image || !row.image.data) return row;
      const brief = Object.assign({}, row.image);
      delete brief.data;
      content.push({ type: 'image', data: row.image.data, mimeType: row.image.mime || 'image/png' });
      imageOrder.push(row.index);
      return Object.assign({}, row, { image: brief });
    });
    meta.imageOrder = imageOrder;
    content.push({ type: 'text', text: JSON.stringify(meta, null, 2) });
    return { content: content, isError: Boolean(isError) };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: Boolean(isError)
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * 带进度通知的批量：先起一个异步任务，再每 400ms 拉一次增量事件。
 * 调用方在 tools/call 的 _meta.progressToken 里给了令牌才会走这条路，
 * 没给就还是普通的一次阻塞调用，行为不变。
 */
async function runBatchWithProgress(args, notify) {
  const started = await callAgent(
    'batch',
    { items: args.items, dir: args.dir, types: args.types, async: true, retry: args.retry, resume: args.resume, batchId: args.batchId },
    30000
  );
  if (!started.ok) return started;

  const jobId = started.jobId;
  let since = 0;

  for (let guard = 0; guard < 10800; guard++) {
    await sleep(400);
    const snap = await callAgent('progress', { jobId: jobId, since: since }, 15000);
    if (!snap.ok) return snap;
    since = snap.nextSeq;

    for (const ev of snap.events || []) {
      if (ev.type === 'item_done') {
        notify({
          progress: ev.done,
          total: ev.total,
          message:
            '第 ' + ev.done + '/' + ev.total + ' 张：' + (ev.name || '') + (ev.ok === false ? '（失败）' : '')
        });
      }
    }

    if (snap.job && snap.job.status !== 'running') {
      return (
        snap.job.result || {
          ok: false,
          error: { code: 'job_lost', message: '任务结束但没有结果。' }
        }
      );
    }
  }

  return {
    ok: false,
    error: { code: 'progress_timeout', message: '等待批量任务超时。' }
  };
}

const parameterTools={
  get_gui_parameters:['读取前台当前参数',{}],
  use_gui_parameters:['将前台当前参数应用到后台',{}],
  import_mask:['读取本地粗糙度或金属度遮罩',{path:{type:'string'},kind:{type:'string',enum:['rough','metal']},resample:{type:'boolean'}}],
  get_parameters:['读取全部生成参数',{}],
  set_parameters:['应用用户指定参数',{data:{type:'object',properties:{controls:{type:'object'},orm:{type:'boolean'}},required:['controls']}}],
  list_presets:['列出预设及参数',{}],
  apply_preset:['应用预设',{name:{type:'string'}}],
  save_preset:['保存参数；覆盖已有预设需 confirm=true',{name:{type:'string'},confirm:{type:'boolean'}}],
  rename_preset:['预设改名',{from:{type:'string'},to:{type:'string'}}],
  delete_preset:['删除指定预设',{name:{type:'string'}}],
  dry_run:['预览每个目录内的套组名',{dir:{type:'string'},items:{type:'array',items:{type:'object'}}}]
};
for(const [cmd,[description,properties]] of Object.entries(parameterTools)){
  TOOLS.push({name:'normalmap_'+cmd,description,inputSchema:{type:'object',properties}});
}
for(const tool of TOOLS){
  if(tool.name==='normalmap_open_image')Object.assign(tool.inputSchema.properties,{preset:{type:'string'},params:{type:'object'}});
  if(tool.name==='normalmap_export'){
    tool.description='导出当前贴图，返回实际输出文件与统计。';
    tool.inputSchema.properties.baseName={type:'string'};
  }
  if(tool.name==='normalmap_batch_export'){
    tool.description='最多1000张，可逐图指定输出目录、基础名、预设及参数。';
    Object.assign(tool.inputSchema.properties.items.items.properties,{dir:{type:'string'},baseName:{type:'string'},preset:{type:'string'},params:{type:'object'}});
  }
}
async function callTool(name, args, notify) {
  if(Object.hasOwn(parameterTools,name.slice(10)))return callAgent(name.slice(10),args);
  switch (name) {
    case 'normalmap_status':
      return callAgent('status');
    case 'normalmap_list_categories':
      return callAgent('categories');
    case 'normalmap_preview':
      return callAgent(
        'preview',
        { path: args.path, max: args.max, which: args.which, format: args.format, quality: args.quality },
        60000
      );
    case 'normalmap_preview_batch':
      return callAgent(
        'preview_batch',
        { items: args.items, paths: args.paths, max: args.max, format: args.format, quality: args.quality },
        180000
      );
    case 'normalmap_open_image':
      return callAgent('open_image', args, 60000);
    case 'normalmap_set_category':
      return callAgent('set_category', { category: args.category });
    case 'normalmap_export':
      return callAgent('export', args, 190000);
    case 'normalmap_batch_export':
      if (notify) return runBatchWithProgress(args, notify);
      return callAgent(
        'batch',
        {
          items: args.items,
          dir: args.dir,
          types: args.types,
          async: args.async,
          retry: args.retry,
          resume: args.resume,
          batchId: args.batchId
        },
        600000
      );
    case 'normalmap_batch_progress':
      return callAgent('progress', { jobId: args.jobId, since: args.since }, 15000);
    case 'normalmap_batch_cancel':
      return callAgent('cancel', { jobId: args.jobId }, 15000);
    case 'normalmap_batch_state':
      return callAgent('batch_state', { limit: args.limit, dir: args.dir }, 15000);
    case 'normalmap_window':
      return callAgent('window', { show: args.show });
    case 'normalmap_log':
      return callAgent('log', { lines: args.lines }, 15000);
    case 'normalmap_quit':
      return callAgent('quit');
    default:
      return { ok: false, error: { code: 'unknown_tool', message: '没有这个工具：' + name } };
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } });
}

/* MCP 的进度是服务器发通知，不是响应；客户端不认识就忽略。 */
function sendProgress(progressToken, params) {
  send({
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: Object.assign({ progressToken: progressToken }, params)
  });
}

async function handleRequest(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params || {};

  if (method === 'initialize') {
    let version = SERVER_VERSION;
    try {
      version = readAgentInfo().version || version;
    } catch {
      /* 程序没启动也要能完成握手，调用工具时再提示 */
    }
    send({
      jsonrpc: '2.0',
      id: id,
      result: {
        protocolVersion: params.protocolVersion || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: version },
        instructions:
          'NormalMap Desktop 的本地贴图工具。程序需以 --agent 启动；先用 normalmap_open_image 打开高度图，再用 normalmap_export 导出。' +
          '要替用户判断材质类别时：normalmap_preview（带 path 可先看磁盘上的图）→ normalmap_list_categories → normalmap_open_image/open 时带上 category。' +
          '一批图先看再选：normalmap_preview_batch 一次回最多 8 张缩略图（每张格式/尺寸可单独给），再一次性 normalmap_batch_export。' +
          '一批图可以用 normalmap_batch_export 一次传完（每张各自的 category），逐张返回结果。' +
          '批量支持 async + normalmap_batch_progress 查进度、normalmap_batch_cancel 取消。' +
          '中断后续跑用 batch 的 resume:true；items 顺序无关，跨轮增删图用 batchId 固定批次名，' +
          'resume 前可用 normalmap_batch_state 看上次/累计写了多少。' +
          '看不了图也没关系，preview 的 stats 里有平均色与饱和度可作依据。'
      }
    });
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id: id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id: id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments || {};
    const progressToken = params._meta && params._meta.progressToken;
    const notify = progressToken ? (payload) => sendProgress(progressToken, payload) : null;
    try {
      const result = await callTool(name, args, notify);
      send({
        jsonrpc: '2.0',
        id: id,
        result: toolResult(result, result && result.ok === false)
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id: id,
        result: toolResult(
          { ok: false, error: { code: 'agent_unavailable', message: (err && err.message) || String(err) } },
          true
        )
      });
    }
    return;
  }

  sendError(id, -32601, '不支持的方法：' + method);
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (err) {
      sendError(null, -32700, '无法解析 JSON：' + err.message);
      return;
    }
    /* 通知没有 id，不需要回复（initialized、cancelled 等）。 */
    if (message.id === undefined || message.id === null) return;
    handleRequest(message).catch((err) => {
      sendError(message.id, -32603, (err && err.message) || String(err));
    });
  });
}

main();
