'use strict';

/*
 * agent-commands.js — Agent 桥的命令层（主进程侧）
 *
 * 业务命令：
 *   ping          健康检查
 *   status        当前图、类别、参数、已生成的贴图尺寸
 *   categories    类别清单（value / 中文标签 / 预设 / 下一个编号）
 *   preview       缩略图（AI 的“眼睛”，PNG base64）
 *   preview_batch 一次看多张（最多 8 张），每张各自的格式与尺寸
 *   open_image    读一张本地图片交给页面（路径 → 字节 → File）
 *   set_category  换类别并重套预设
 *   export        生成并写盘，回传每个文件的路径与像素统计
 *   batch         一批图各自带类别，逐张导入导出，回传逐张结果
 *   progress      批量任务的进度与事件（支持 since 增量）
 *   cancel        请求取消正在跑的批量任务（当前这张写完后停）
 *   batch_state   续跑账本：最近几批的状态、上轮与累计写出量
 *   log           最近命令的审计记录（JSONL，含参数摘要与结果码）
 *   window        显示 / 隐藏窗口（不给参数则只查状态）
 *
 * 只有这里列出来的命令能被执行；页面侧再白名单一层（NMO_Agent）。
 * 没有任何“执行任意 JS / 任意 shell”的入口。
 */

const fs = require('node:fs');
const path = require('node:path');
const { fileStats } = require('./agent-stats');
const { encodeImage, normalizeFormat } = require('./image-encode');
const { createJobStore } = require('./agent-jobs');
const { createAuditLog } = require('./agent-log');
const { createBatchState } = require('./batch-state');

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_ITEMS = 1000;
/* 一次看太多张会把模型上下文和 IPC 一起撑爆，8 张是“够用又不失控”的折中。 */
const MAX_PREVIEW_ITEMS = 8;
const MAX_PREVIEW_PAYLOAD = 20 * 1024 * 1024; // base64 字符数上限
const MAX_BATCH_RETRY = 3;
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tga': 'image/x-targa',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

function fail(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' 超时（' + ms + 'ms）')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function createAgentCommands(options) {
  const getWindow = options.getWindow;
  const startedAt = Date.now();
  const jobs = createJobStore({ eventLimit: 1000 });
  const audit = createAuditLog({ dir: options.logDir });
  const batchState = createBatchState({ dir: options.logDir });
  /* --agent-out 的根目录；为空表示不限制（沿用旧行为）。 */
  const outRoot = options.outDir || [];
  function guardOut(dir) {
    if (typeof dir==='string' && path.isAbsolute(dir)) {
      try {
        const real=fs.realpathSync(dir);
        for (const root of outRoot) {
          const rel=path.relative(fs.realpathSync(root),real);
          if(rel!== '..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel))return null;
        }
      } catch {}
    }
    return fail('out_of_scope','请选择已授权的现有输出目录。');
  }

  async function exec(code, timeoutMs, label) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return fail('no_window', '应用窗口不可用。');
    try {
      const result = await withTimeout(win.webContents.executeJavaScript('(async()=>{await window.NMO_ParametersReady;return '+code+'})()', true), timeoutMs || 30000, label || '页面调用');
      if (result === undefined || result === null) {
        return fail('empty_result', '页面没有返回结果。');
      }
      return result;
    } catch (err) {
      return fail('renderer_error', (err && err.message) || String(err));
    }
  }

  function readImagePayload(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return { error: fail('file_not_found', '找不到文件：' + resolved) };
    }
    if (!stat.isFile()) return { error: fail('not_a_file', '不是文件：' + resolved) };
    if (stat.size > MAX_IMAGE_BYTES) {
      return {
        error: fail(
          'file_too_large',
          '图片超过 ' + Math.round(MAX_IMAGE_BYTES / 1024 / 1024) + ' MB：' + resolved
        )
      };
    }

    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) {
      return {
        error: fail('unsupported', '不支持的扩展名：' + (ext || '（无）') + '。支持：' + Object.keys(MIME_BY_EXT).join(' '))
      };
    }

    return {
      name: path.basename(resolved),
      mime: mime,
      base64: fs.readFileSync(resolved).toString('base64')
    };
  }

  /* 缩略图的像素统计：给看不了图的纯文本模型一点判断依据。 */
  function bitmapStats(image) {
    const size = image.getSize();
    const width = size.width;
    const height = size.height;
    let buf;
    try {
      buf = image.toBitmap();
    } catch {
      return null;
    }
    if (!buf || buf.length < width * height * 4) return null;

    const total = width * height;
    let r = 0;
    let g = 0;
    let b = 0;
    let sat = 0;
    for (let i = 0; i < total; i++) {
      const at = i * 4;
      const bb = buf[at];
      const gg = buf[at + 1];
      const rr = buf[at + 2];
      r += rr;
      g += gg;
      b += bb;
      const mx = Math.max(rr, gg, bb);
      const mn = Math.min(rr, gg, bb);
      sat += mx === 0 ? 0 : (mx - mn) / mx;
    }
    r /= total;
    g /= total;
    b /= total;
    sat /= total;
    return {
      meanRGB: [Math.round(r), Math.round(g), Math.round(b)],
      meanLuma: Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 10) / 10,
      meanSaturation: Math.round(sat * 100) / 100,
      sampledAt: width + '×' + height
    };
  }

  /*
   * 直接读磁盘出缩略图：不碰页面状态，也不会为了看一眼就把图导进程序。
   * 用 nativeImage 解码（png/jpg/bmp/webp…）；tga/tif 这类它读不了的，
   * 提示改成“先 open_image 再 preview”，那时页面里已有解码后的位图。
   */
  function previewFromDisk(filePath, max, format, quality) {
    const resolved = path.resolve(String(filePath || ''));
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return fail('file_not_found', '找不到文件：' + resolved);
    }
    if (!stat.isFile()) return fail('not_a_file', '不是文件：' + resolved);
    if (stat.size > MAX_IMAGE_BYTES) {
      return fail(
        'file_too_large',
        '图片超过 ' + Math.round(MAX_IMAGE_BYTES / 1024 / 1024) + ' MB：' + resolved
      );
    }

    /* 延迟取 electron，避免测试里按普通模块加载时被顶层绑定卡住。 */
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) {
      return fail(
        'preview_unsupported',
        '这个格式没法直接生成缩略图：' +
          (path.extname(resolved) || '（无扩展名）') +
          '。先 open_image 打开它，再调 preview（不带 path）。'
      );
    }

    const size = img.getSize();
    const scale = Math.min(1, max / Math.max(size.width, size.height));
    const thumb =
      scale < 1
        ? img.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good'
          })
        : img;
    const thumbSize = thumb.getSize();
    const encoded = encodeImage(thumb, format, quality);

    return {
      ok: true,
      image: {
        name: path.basename(resolved),
        mime: encoded.mime,
        format: encoded.format,
        which: 'source',
        path: resolved,
        width: size.width,
        height: size.height,
        thumbWidth: thumbSize.width,
        thumbHeight: thumbSize.height,
        scale: Math.round(scale * 1000) / 1000,
        data: encoded.buffer.toString('base64')
      },
      stats: bitmapStats(thumb)
    };
  }

  /*
   * 页面里的缩略图固定是 PNG；要别的格式就在这里再编一次。
   * 只有非 png 才多这一次解码，常态路径没有额外开销。
   */
  function convertPreview(result, format, quality) {
    if (!result || !result.ok || !result.image || !result.image.data) return result;
    if (format === 'png') {
      result.image.format = 'png';
      return result;
    }

    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(Buffer.from(result.image.data, 'base64'));
    if (img.isEmpty()) return fail('encode_failed', '页面缩略图无法转成 ' + format + '。');

    const encoded = encodeImage(img, format, quality);
    result.image.data = encoded.buffer.toString('base64');
    result.image.mime = encoded.mime;
    result.image.format = encoded.format;
    return result;
  }

  async function enrichExport(report) {
    if (!report || !report.ok || !Array.isArray(report.files)) return report;
    const dir = report.dir;
    report.outputs = report.files.map((name) => {
      const full = path.join(dir, name);
      let stats;
      try {
        stats = fileStats(full);
      } catch (err) {
        stats = { bytes: null, sha256: null, error: (err && err.message) || String(err) };
      }
      return Object.assign({ name: name, path: full }, stats);
    });
    return report;
  }


  /* 只有会改变状态/产生文件的命令才值得让用户看见，避免 status 轮询刷屏。 */
  const ACTIVITY_COMMANDS = new Set(['open_image', 'set_category', 'export', 'window', 'quit']);

  /* 这些错误是确定性的，重试只会浪费时间（文件不存在、格式不支持、越界……）。 */
  const NO_RETRY_CODES = new Set([
    'file_not_found',
    'not_a_file',
    'unsupported',
    'file_too_large',
    'bad_args',
    'unknown_command',
    'out_of_scope',
    /* 文件已写出、只是编号库元数据没记上：重试会重写文件，必须人工处理。 */
    'library_metadata_failed',
    /* 回写还没落定：重试会再开一次导出、再占一个号，等它落定再说。 */
    'library_write_pending'
  ]);

  async function attemptBatchItem(item, filePath, label, dir, types) {
    const payload = readImagePayload(filePath);
    if (payload.error) {
      return {
        path: filePath,
        name: label,
        category: item.category || null,
        ok: false,
        stage: 'read',
        error: payload.error.error
      };
    }

    const openRequest = {
      name: payload.name,
      mime: payload.mime,
      base64: payload.base64,
      category: item.category, preset:item.preset, params:item.params
    };
    const opened = await exec(
      'NMO_Agent.openImage(' + JSON.stringify(openRequest) + ')',
      60000,
      'batch open'
    );
    if (!opened || !opened.ok) {
      return {
        path: filePath,
        name: label,
        category: item.category || null,
        ok: false,
        stage: 'open',
        error: (opened && opened.error) || fail('open_failed', '打开失败').error
      };
    }

    const exported = await exec(
      'NMO_Agent.exportTo(' + JSON.stringify({ dir, types, baseName:item.baseName,resumeBase:item.resumeBase }) + ')',
      180000,
      'batch export'
    );
    if (!exported || !exported.ok) {
      const error = (exported && exported.error) || fail('export_failed', '导出失败').error;
      /*
       * 编号库回写失败时文件其实已经落盘：把真实写出量带回去，
       * 不能让账本和用户以为“一个文件都没写”。
       */
      return {
        path: filePath,
        name: label,
        category: opened.category,
        ok: false,
        stage: 'export',
        error: error,
        written: (exported && exported.written) || 0,
        skipped: (exported && exported.skipped) || 0,
        files: (exported && exported.files) || [],
        failures: (exported && exported.failures) || [],
        needsRepair: Boolean(exported && exported.needsRepair)
      };
    }

    const enriched = await enrichExport(exported);
    return {
      path: filePath,
      name: label,
      category: opened.category,
      ok: true,
      written: enriched.written,
      skipped: enriched.skipped,
      failed: enriched.failed,
      files: enriched.outputs || [],
      failures: enriched.failures || []
    };
  }

  /*
   * 单张处理：失败按 retry 次数重试，确定性错误不重试。
   * 重试间隔 300ms、600ms……给“文件正被占用/磁盘暂时忙”一点余地。
   */
  async function processBatchItem(item, index, dir, types, retry) {
    const filePath = item.path ? path.resolve(String(item.path)) : '';
    const label = item.name || (filePath ? path.basename(filePath) : 'item-' + (index + 1));
    let attempts = 0;
    let row = null;
    while (attempts <= retry) {
      attempts += 1;
      row = await attemptBatchItem(item, filePath, label, dir, types);
      row.index = index + 1;
      row.attempts = attempts;
      if (row.ok) return row;
      const code = row.error && row.error.code;
      if (NO_RETRY_CODES.has(code)) return row;
      if (attempts > retry) return row;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempts));
    }
    return row;
  }

  const handlers = {
    async ping() {
      const win = options.guiWindow();
      return {
        ok: true,
        name: 'NormalMap Desktop',
        version: options.version,
        pid: process.pid,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        windowVisible: Boolean(win && !win.isDestroyed() && win.isVisible()),
        outDir: outRoot
      };
    },

    async status() {
      return exec('NMO_Agent.status()', 15000, 'status');
    },

    async categories() {
      return exec('NMO_Agent.categories()', 15000, 'categories');
    },

    /*
     * preview：AI 的“眼睛”。
     *   带 path → 主进程本地解码出缩略图，不改当前打开的图；
     *   不带 path → 页面里已打开的源图 / 已生成的法线图。
     * format：png（默认）/ jpg / tiff / tga。
     */
    async preview(args) {
      args = args || {};
      const format = normalizeFormat(args.format);
      if (!format) {
        return fail(
          'bad_format',
          '不支持的缩略图格式：' +
            (args.format === undefined ? '（空）' : args.format) +
            '。可用：png、jpg、tiff、tga'
        );
      }
      const wanted = Number(args.max);
      const max = Math.max(64, Math.min(1024, Math.round(wanted > 0 ? wanted : 512)));
      if (args.path) return previewFromDisk(args.path, max, format, args.quality);
      const result = await exec(
        'NMO_Agent.preview(' +
          JSON.stringify({ max: max, which: args.which === 'normal' ? 'normal' : 'source' }) +
          ')',
        45000,
        'preview'
      );
      return convertPreview(result, format, args.quality);
    },

    /*
     * preview_batch：一次看多张，AI 给一批图选类别时用。
     *   逐张走 previewFromDisk，只读磁盘、不改当前打开的图；
     *   每张可单独指定 format / max / quality，也可以用顶层默认值。
     * 上限 8 张、base64 合计 20MB：再多请分批，否则一次回到上下文里放不下。
     */
    async preview_batch(args) {
      args = args || {};
      const rawItems = Array.isArray(args.items)
        ? args.items
        : Array.isArray(args.paths)
          ? args.paths.map((entry) => (typeof entry === 'string' ? { path: entry } : entry))
          : [];
      if (!rawItems.length) return fail('bad_args', '缺少 items（[{path, format?, max?}]）。');
      if (rawItems.length > MAX_PREVIEW_ITEMS) {
        return fail(
          'too_many_items',
          '一次最多看 ' + MAX_PREVIEW_ITEMS + ' 张，收到 ' + rawItems.length + ' 张。分几次调用。'
        );
      }

      const defaultFormat = normalizeFormat(args.format || 'png');
      if (!defaultFormat) {
        return fail(
          'bad_format',
          '不支持的缩略图格式：' + args.format + '。可用：png、jpg、tiff、tga'
        );
      }
      const wanted = Number(args.max);
      const defaultMax = Math.max(64, Math.min(1024, Math.round(wanted > 0 ? wanted : 384)));

      const results = [];
      let chars = 0;
      let bytes = 0;

      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i] || {};
        const format = normalizeFormat(item.format || defaultFormat);
        if (!format) {
          results.push({
            index: i,
            path: item.path ? path.resolve(String(item.path)) : null,
            ok: false,
            error: {
              code: 'bad_format',
              message: '第 ' + (i + 1) + ' 张的格式不支持：' + item.format + '。可用：png、jpg、tiff、tga'
            }
          });
          continue;
        }
        const one = Number(item.max);
        const max = Math.max(64, Math.min(1024, Math.round(one > 0 ? one : defaultMax)));
        const quality = item.quality !== undefined ? item.quality : args.quality;
        const shot = previewFromDisk(item.path, max, format, quality);
        if (!shot || !shot.ok) {
          results.push(
            Object.assign({ index: i, path: item.path ? path.resolve(String(item.path)) : null }, shot || fail('preview_failed', '缩略图生成失败'))
          );
          continue;
        }
        const base64 = shot.image.data;
        chars += base64.length;
        bytes += Buffer.byteLength(base64, 'base64');
        results.push({ index: i, ok: true, image: shot.image, stats: shot.stats });
      }

      if (chars > MAX_PREVIEW_PAYLOAD) {
        return fail(
          'payload_too_large',
          '这批缩略图 base64 共 ' +
            Math.round(chars / 1024 / 1024) +
            ' MB，超过 20 MB。把 max 调到 256 左右，或把 format 改成 jpg。'
        );
      }

      const succeeded = results.filter((row) => row.ok).length;
      return {
        ok: succeeded === results.length,
        total: results.length,
        succeeded: succeeded,
        failed: results.length - succeeded,
        max: defaultMax,
        format: defaultFormat,
        totalBytes: bytes,
        items: results
      };
    },

    async open_image(args) {
      args = args || {};
      const payload = readImagePayload(args.path);
      if (payload.error) return payload.error;

      const request = {
        name: payload.name,
        mime: payload.mime,
        base64: payload.base64,
        category: args.category, preset:args.preset, params:args.params
      };
      const result = await exec(
        'NMO_Agent.openImage(' + JSON.stringify(request) + ')',
        60000,
        'open_image'
      );
      return result;
    },

    async set_category(args) {
      args = args || {};
      return exec(
        'NMO_Agent.setCategory(' + JSON.stringify(args.category || '') + ')',
        15000,
        'set_category'
      );
    },

    async export(args) {
      args = args || {};
      const blocked = guardOut(args.dir);
      if (blocked) return blocked;
      const request = { dir: args.dir, types: args.types, baseName: args.baseName };
      const result = await exec('NMO_Agent.exportTo(' + JSON.stringify(request) + ')', 180000, 'export');
      return enrichExport(result);
    },

    /*
     * batch：一批图，每张各自带类别，逐张开图 → 导出。
     * 串行执行：编号预留、源上下文、预设套用全部沿用单张流程；
     * 一张失败只记在那一条，不拖累后面的图。
     *
     * retry: 0–3，单张失败重试次数（确定性错误不重试）；
     * resume: true，按 dir+types+items 的指纹找回上次账本，跳过已成功的图
     *   （items 顺序不影响指纹，换顺序也认得出同一批）；
     * batchId: 显式批次名，同一 dir+types 下跨轮加图/删图仍算同一批。
     * 默认阻塞到全部结束；async:true 立即返回 jobId，
     * 之后用 progress 命令或 GET /events 取增量进度。
     */
    async batch(args) {
      args = args || {};
      const items = Array.isArray(args.items) ? args.items : [];
      if (!items.length) return fail('bad_args', '缺少 items（[{path, category}]）。');
      if (items.length > MAX_BATCH_ITEMS) {
        return fail(
          'too_many_items',
          '一次最多 ' + MAX_BATCH_ITEMS + ' 张，收到 ' + items.length + ' 张。'
        );
      }
      if (!args.dir) return fail('bad_args', '缺少 dir（导出目录）。');
      const blocked = guardOut(args.dir);
      if (blocked) return blocked;

      for(const item of items){const denied=guardOut(item.dir || args.dir); if(denied)return denied;}
      const batchId = args.batchId === undefined || args.batchId === null ? null : String(args.batchId).trim();
      if (batchId !== null && (!batchId || batchId.length > 64)) {
        return fail('bad_args', 'batchId 需为 1–64 个字符的字符串。');
      }

      const dir = path.resolve(String(args.dir));
      const types = Array.isArray(args.types) ? args.types : undefined;
      const retry = Math.max(0, Math.min(MAX_BATCH_RETRY, Math.round(Number(args.retry) || 0)));
      const resume = args.resume === true;
      const fingerprint = batchId
        ? batchState.namedFingerprint(dir, types, batchId)
        : batchState.fingerprint(dir, types, items);
      const baseline=await handlers.get_parameters({});
      if(!baseline.ok)return baseline;
      const available=await handlers.list_presets({});
      if(!available.ok)return available;
      const presetData=new Map(available.presets.map(row=>[row.name,row.data]));
      const keys=batchState.itemKeys(items.map(item=>{
        let revision=null;
        if(item.path){try{const info=fs.statSync(item.path);revision=[info.size,info.mtimeMs];}catch{}}
        return {...item,params:[baseline.data,presetData.get(item.preset || item.category),item.params,revision]};
      }));
      const prior = resume ? batchState.get(fingerprint) : null;
      const priorItems = (prior && prior.items) || {};

      const startedJob = jobs.start('batch', items.length, {
        dir: dir,
        types: types || null,
        retry: retry,
        resume: resume,
        batchId: batchId,
        fingerprint: fingerprint
      });
      if (startedJob.busy) {
        return fail(
          'busy',
          '已有批量任务在跑：' + startedJob.busy.id + '。先查 progress，或等它结束。'
        );
      }
      const job = startedJob.job;
      const batchStartedAt = Date.now();

      const runner = async () => {
        const results = [];
        const ledger = batchState.open(fingerprint, {
          dir: dir,
          types: types || null,
          resume: resume,
          batchId: batchId
        });
        let cancelled = false;
        let skippedDone = 0;

        for (let i = 0; i < items.length; i++) {
          /* 取消只在两张图之间生效：当前这张要么完整写出，要么根本不开始。 */
          if (jobs.isCancelled(job)) {
            cancelled = true;
            break;
          }
          const item = items[i] || {};
          const key = keys[i];
          const filePath = item.path ? path.resolve(String(item.path)) : '';
          const label = item.name || (filePath ? path.basename(filePath) : 'item-' + (i + 1));

          /* 续跑：上次已经成功的图直接记一笔，不再开图、不再占号。 */
          if (resume && priorItems[key] && priorItems[key].status === 'done') {
            skippedDone += 1;
            results.push({
              index: i + 1,
              path: filePath,
              name: label,
              category: item.category || null,
              ok: true,
              skippedDone: true,
              written: 0,
              skipped: 0,
              files: [],
              previousFiles: priorItems[key].files || []
            });
            jobs.itemStart(job, i + 1, {
              name: label,
              path: filePath,
              category: item.category || null,
              skippedDone: true
            });
            jobs.itemDone(job, i + 1, { ok: true, name: label, skippedDone: true });
            continue;
          }

          jobs.itemStart(job, i + 1, {
            name: label,
            path: filePath,sourcePath:filePath,
            category: item.category || null
          });
          const targetDir=item.dir || dir;
          let assigned=priorItems[key]?.baseName;
          let row;
          try{
            if(guardOut(targetDir))throw Error('目录已不在授权范围');
            if(!assigned){
              const next=await options.planner.prepare({preview:true,dir:targetDir,items:[{sourceKey:key,sourceName:path.parse(filePath).name,baseName:item.baseName}]});
              assigned=next.assignments[0].baseName;
            }
            ledger.intent(key,assigned);
            const restored=await handlers.set_parameters({data:baseline.data});
            if(!restored.ok)throw Error(restored.error.message);
            row=await processBatchItem({...item,resumeBase:assigned},i,targetDir,types,retry);
          }catch(err){row={ok:false,index:i+1,path:filePath,name:label,error:{code:'export_failed',message:err.message}};}
          results.push(row);
          ledger.item(key, row);
          jobs.itemDone(job, i + 1, {
            ok: row.ok,
            name: label,
            category: row.category || null,
            stage: row.stage || undefined,
            error: row.error || undefined,
            written: row.written || 0,
            outputs:row.files || [],sourcePath:filePath,attempts: row.attempts || 1
          });
        }

        const succeeded = results.filter((row) => row.ok).length;
        const failed = results.length - succeeded;
        const result = {
          ok: succeeded > 0 && failed === 0,
          cancelled: cancelled,
          notProcessed: items.length - results.length,
          resumed: {
            requested: resume,
            fingerprint: fingerprint,
            batchId: batchId,
            skipped: skippedDone,
            priorStatus: prior ? prior.status : null
          },
          dir: dir,
          total: results.length,
          succeeded: succeeded,
          failed: failed,
          skippedDone: skippedDone,
          written: results.reduce((n, row) => n + (row.written || 0), 0),
          skipped: results.reduce((n, row) => n + (row.skipped || 0), 0),
          ms: Date.now() - batchStartedAt,
          items: results
        };
        await handlers.set_parameters({data:baseline.data});
        ledger.finish(result);
        return result;
      };

      const settle = (result) => {
        jobs.finish(job, result, { cancelled: Boolean(result && result.cancelled) });
        result.jobId = job.id;

        /* 后台批量的“结果”也要落审计：只记了 jobId 等于没记结果。 */
        audit.write(
          'batch_result',
          { jobId: job.id, dir: result.dir, total: result.total, resume: resume },
          result,
          Date.now() - batchStartedAt
        );

        if (typeof options.onActivity === 'function') {
          try {
            options.onActivity({
              cmd: 'batch',
              ok: result.ok !== false,
              done: true,
              written: result.written,
              failed: result.failed,
              cancelled: Boolean(result.cancelled)
            });
          } catch {
            /* 通知失败不影响批量结果 */
          }
        }
        return result;
      };

      if (args.async) {
        setImmediate(() => {
          runner()
            .then(settle)
            .catch((err) =>
              settle({
                ok: false,
                dir: dir,
                total: items.length,
                succeeded: 0,
                failed: items.length,
                written: 0,
                skipped: 0,
                items: [],
                error: { code: 'batch_failed', message: (err && err.message) || String(err) }
              })
            );
        });
        return {
          ok: true,
          jobId: job.id,
          status: 'running',
          total: items.length,
          poll: 'progress 命令（jobId=' + job.id + '）或 GET /events?since=0'
        };
      }

      return settle(await runner());
    },

    /* 批量任务进度：不带 jobId 查最近一个，带 since 只取增量。 */
    async progress(args) {
      args = args || {};
      return jobs.snapshot({ jobId: args.jobId, since: args.since });
    },

    /* 请求取消：当前这张写完后停下，已写出的文件保留。 */
    async cancel(args) {
      args = args || {};
      return jobs.requestCancel(args.jobId);
    },

    /*
     * batch_state：读续跑账本，看最近几批跑到哪、上次写了多少、累计写了多少。
     * 只读，不进命令队列；给“中断后要不要 resume、resume 会跳过几张”提供依据。
     */
    async batch_state(args) {
      args = args || {};
      return batchState.list({ limit: args.limit, dir: args.dir });
    },

    async window(args) {
      args = args || {};
      const win = options.guiWindow();
      if (!win || win.isDestroyed()) return fail('no_window', '应用窗口不可用。');
      if (args.show === true) {
        win.show();
        win.focus();
      } else if (args.show === false) {
        win.hide();
      }
      return { ok: true, visible: win.isVisible() };
    },

    /* 审计日志：给人和 AI 一个“刚才都干了什么”的入口，不记录 ping 与自己。 */
    async log(args) {
      args = args || {};
      return Object.assign({ ok: true, enabled: audit.enabled }, audit.recent(args.lines));
    },

    /* 让 Agent 能体面收尾：先回 HTTP 响应，再退出，不留半截进程。 */
    async quit() {
      if (typeof options.quit !== 'function') {
        return fail('quit_unavailable', '当前实例没有挂接退出回调。');
      }
      setTimeout(() => {
        try {
          options.quit();
        } catch {
          /* 退出失败只能靠进程管理器 */
        }
      }, 150);
      return { ok: true, quitting: true };
    }
  };

  handlers.get_gui_parameters=async ()=>{
    const gui=options.guiWindow();
    if(!gui || gui.isDestroyed())return fail('no_window','前台窗口不可用');
    return gui.webContents.executeJavaScript('(async()=>{await window.NMO_ParametersReady;return NMO_Agent.getParameters()})()');
  };
  handlers.use_gui_parameters=async ()=>{
    const result=await handlers.get_gui_parameters();
    return result.ok?handlers.set_parameters({data:result.data}):result;
  };
  handlers.import_mask=async args=>{
    if(!['metal','rough'].includes(args.kind))return fail('bad_args','kind 需为 rough 或 metal');
    const payload=readImagePayload(args.path);
    if(payload.error)return payload.error;
    return exec('NMO_Agent.importMask('+JSON.stringify({...payload,kind:args.kind,resample:args.resample===true})+')',60000,'import_mask');
  };
  handlers.dry_run=async args=>{
    const groups=new Map(), result=[];
    const current=await handlers.get_parameters({});
    if(!current.ok)return current;
    const presets=await handlers.list_presets({});
    if(!presets.ok)return presets;
    const mapping={normal:['normal_tick','NRM'],displacement:['displacement_tick','DSP'],ao:['ambient_tick','AO'],specular:['specular_tick','SPC'],roughness:['roughness_tick','RGH'],metallic:['metallic_tick','MTL']};
    for(const [i,item] of (args.items || []).entries()){
      const dir=item.dir || args.dir, denied=guardOut(dir);
      if(denied)return denied;
      const real=fs.realpathSync(dir);
      if(!groups.has(real))groups.set(real,[]);
      groups.get(real).push({sourceKey:i,sourceName:path.parse(item.path).name,baseName:item.baseName});
    }
    for(const [dir,items] of groups){
      const plan=await options.planner.prepare({preview:true,dir,items});
      for(const row of plan.assignments){
        const item=args.items[row.sourceKey];
        const presetName=item.preset || item.category;
        const preset=presets.presets.find(p=>p.name===presetName)?.data;
        if(presetName && !preset)return fail('unknown_preset','未知预设：'+presetName);
        const controls={...current.data.controls,...preset?.controls,...item.params?.controls};
        let keys=args.types || Object.keys(mapping).filter(k=>controls[mapping[k][0]]);
        if(keys.includes('all'))keys=Object.keys(mapping);
        keys=[...new Set(keys.map(k=>k==='height'?'displacement':k==='ambient'?'ao':k))];
        if(keys.some(k=>!Object.hasOwn(mapping,k)))return fail('bad_types','未知贴图用途');
        let suffixes=keys.map(k=>mapping[k][1]);
        const pack=item.params?.orm ?? preset?.orm ?? current.data.orm;
        const triple=['AO','RGH','MTL'];
        if(pack && triple.every(k=>suffixes.includes(k) && controls[Object.values(mapping).find(v=>v[1]===k)[0]]))suffixes=[...suffixes.filter(k=>!triple.includes(k)),'ORM'];
        const ext=controls.file_type==='tiff'?'tif':controls.file_type || 'png';
        result[row.sourceKey]={dir,baseName:row.baseName,files:suffixes.map(k=>path.join(dir,row.baseName+'_'+k+'.'+(k==='ORM'?'png':ext)))};
      }
    }
    return {ok:true,items:result};
  };
  const methods={get_parameters:'getParameters',set_parameters:'setParameters',list_presets:'listPresets',apply_preset:'applyPreset',save_preset:'savePreset',rename_preset:'renamePreset',delete_preset:'deletePreset'};
  for(const [command,method] of Object.entries(methods)){
    handlers[command]=args=>exec('NMO_Agent.'+method+'('+JSON.stringify(args)+')',30000,command);
  }
  async function run(cmd, args) {
    const name = String(cmd || '');
    const handler = Object.hasOwn(handlers,name) && handlers[name];
    if(jobs.isBusy() && ['open_image','set_category','export','set_parameters','apply_preset','save_preset','import_mask','use_gui_parameters'].includes(name))return fail('busy','批量任务运行中');
    if (!handler) {
      const unknown = fail('unknown_command', '未知命令：' + cmd + '。可用：' + Object.keys(handlers).join(', '));
      audit.write(name, args, unknown, 0);
      return unknown;
    }
    const started = Date.now();
    let result;
    try {
      result = await handler(args || {});
    } catch (err) {
      result = fail('command_failed', (err && err.message) || String(err));
    }
    /* ping 是健康检查，log 是读日志本身——记它们只会把日志刷满。 */
    if (name !== 'ping' && name !== 'log') {
      audit.write(name, args, result, Date.now() - started);
    }
    /* 批量自己的完成通知在 settle 里发，避免同步批量重复两次。 */
    if (ACTIVITY_COMMANDS.has(name) && typeof options.onActivity === 'function') {
      try {
        options.onActivity({ cmd: name, ok: result.ok !== false, ms: Date.now() - started, finished: true });
      } catch {
        /* 通知失败不影响命令结果 */
      }
    }
    return result;
  }

  return { run: run, list: () => Object.keys(handlers), jobs: jobs, audit: audit };
}

module.exports = { createAgentCommands };
