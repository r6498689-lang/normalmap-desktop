'use strict';

/*
 * batch-state.js — 批量任务的落盘账本（1.1.26，1.1.28 改指纹与统计）
 *
 * 解决的问题：一批图跑到第 30 张时程序被关掉/崩溃，重跑要从头再来。
 * 这里把“哪些图已经成功写出”记到 userData 的 batch-state.json，
 * 下次用同样的 dir + types + items 再跑，带 resume:true 就跳过已完成的。
 *
 * 设计取舍：
 *   - 按“整批指纹”分组：换了目录或类型就是另一批，不会串；
 *     items 按“路径|类别”排序后再算指纹，所以单纯换顺序仍然认得同一批；
 *   - 想跨轮改 items（加图/删图）时给 batchId：同一目录同一类型下，
 *     batchId 相同就是同一批，已完成的照旧跳过，新图照常处理；
 *   - 每处理完一张就原子写盘（tmp + rename），崩溃最多丢最后一张；
 *   - 只记文件名与状态，不记图片内容；最多保留 10 批、14 天；
 *   - 写盘失败静默：账本坏了顶多不能续跑，不能让批量本身失败。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAME = 'batch-state.json';
const MAX_BATCHES = 10;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

/* 指纹格式变了就升这里，旧账本自然不再匹配，等 TTL 清掉。 */
const FINGERPRINT_VERSION = 2;

function itemSignature(item) {
  return (item && item.path ? path.resolve(String(item.path)) : '') + '|' + JSON.stringify([item?.category,item?.preset,item?.params,item?.dir,item?.baseName]);
}

function itemKeys(items) {
  const seen = {};
  return items.map((item) => {
    const base = itemSignature(item);
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : base + '#' + seen[base];
  });
}

function normalizeTypes(types) {
  /* 类型的书写顺序不影响写出哪些贴图，排序后同一组类型指纹一致。 */
  return Array.isArray(types) ? types.map(String).sort() : null;
}

function hash(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function fingerprint(dir, types, items) {
  return hash({
    v: FINGERPRINT_VERSION,
    dir: path.resolve(String(dir || '')),
    types: normalizeTypes(types),
    /* 排序：items 换个顺序还是同一批。重复项由 itemKeys 的 #n 兜底。 */
    items: items.map(itemSignature).sort()
  });
}

/*
 * 显式批次名：目录与类型仍然参与指纹（防止把 A 目录的账本套到 B 目录），
 * items 不参与 —— 这样中途补几张图，续跑仍然认得前面已完成的。
 */
function namedFingerprint(dir, types, batchId) {
  return hash({
    v: FINGERPRINT_VERSION,
    dir: path.resolve(String(dir || '')),
    types: normalizeTypes(types),
    batchId: String(batchId || '')
  });
}

function createBatchState(options) {
  const root = options && options.dir;
  const file = root ? path.join(root, FILE_NAME) : null;

  function empty() {
    return { version: 1, batches: {} };
  }

  function load() {
    if (!file) return empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.batches && typeof parsed.batches === 'object') {
        return parsed;
      }
    } catch {
      /* 损坏就当没有 */
    }
    return empty();
  }

  function prune(state) {
    const now = Date.now();
    for (const key of Object.keys(state.batches)) {
      const entry = state.batches[key];
      const at = Date.parse((entry && entry.updatedAt) || '');
      if (!Number.isFinite(at) || now - at > TTL_MS) delete state.batches[key];
    }
    const keys = Object.keys(state.batches);
    if (keys.length > MAX_BATCHES) {
      keys
        .sort((a, b) => String(state.batches[a].updatedAt).localeCompare(String(state.batches[b].updatedAt)))
        .slice(0, keys.length - MAX_BATCHES)
        .forEach((key) => delete state.batches[key]);
    }
  }

  function save(state) {
    if (!file) return;
    try {
      prune(state);
      fs.mkdirSync(root, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
      fs.renameSync(tmp, file);
    } catch(err){throw Error("续跑记录保存失败："+err.message);}
  }

  function get(fp) {
    if (!file) return null;
    const entry = load().batches[fp];
    return entry || null;
  }

  function tally(entry) {
    const items = (entry && entry.items) || {};
    const keys = Object.keys(items);
    let done = 0;
    let failed = 0;
    let written = 0;
    let attempts = 0;
    for (const key of keys) {
      const row = items[key] || {};
      if (row.status === 'done') done += 1;
      else if (row.status === 'failed') failed += 1;
      written += row.written || 0;
      attempts += row.attempts || 0;
    }
    return { items: keys.length, done: done, failed: failed, written: written, attempts: attempts };
  }

  /*
   * list()：给人和 AI 一个“这批之前跑到哪了”的入口。
   * 只回统计与路径，不回图片内容；按更新时间倒序。
   */
  function list(optionsArg) {
    const opts = optionsArg || {};
    const limit = Math.max(1, Math.min(50, Math.round(Number(opts.limit) || 10)));
    if (!file) return { ok: true, file: null, total: 0, batches: [] };
    const state = load();
    const dirFilter = opts.dir ? path.resolve(String(opts.dir)) : null;
    const rows = Object.keys(state.batches)
      .map((key) => {
        const entry = state.batches[key] || {};
        const cumulative = entry.cumulative || tally(entry);
        return {
          fingerprint: key,
          batchId: entry.batchId || null,
          status: entry.status || null,
          dir: entry.dir || null,
          types: entry.types || null,
          createdAt: entry.createdAt || null,
          updatedAt: entry.updatedAt || null,
          lastRun: entry.lastRun || null,
          cumulative: cumulative
        };
      })
      .filter((row) => !dirFilter || (row.dir && path.resolve(row.dir) === dirFilter))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
    return { ok: true, file: file, total: Object.keys(state.batches).length, batches: rows };
  }

  /*
   * open() 返回一个“记账器”：
   *   item(key, row)  每张处理完调用，立刻落盘；
   *   finish(result)  整批结束时写状态。
   * resume 为假时覆盖旧账，等价于“这一批重新开始”。
   */
  function open(fp, meta) {
    const state = load();
    if (!meta.resume || !state.batches[fp]) {
      state.batches[fp] = {
        fingerprint: fp,
        batchId: meta.batchId || null,
        dir: meta.dir,
        types: meta.types || null,
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: {}
      };
      save(state);
    } else {
      state.batches[fp].batchId = meta.batchId || state.batches[fp].batchId || null;
      state.batches[fp].status = 'running';
      state.batches[fp].updatedAt = new Date().toISOString();
      save(state);
    }

    return {
      intent(key,baseName){
        const next=load();
        const entry=next.batches[fp];
        entry.items[key]={...entry.items[key],baseName,status:'running'};
        save(next);
      },
      item: function (key, row) {
        const now = new Date().toISOString();
        const next = load();
        const entry = next.batches[fp] || { items: {} };
        entry.items = entry.items || {};
        entry.items[key] = {
          baseName:entry.items[key]?.baseName,
          path: row.path,
          name: row.name,
          category: row.category || null,
          status: row.ok ? 'done' : 'failed',
          written: row.written || 0,
          skipped: row.skipped || 0,
          files: (row.files || []).map((f) => f.name),
          error: row.error || null,
          attempts: row.attempts || 1,
          at: now
        };
        entry.updatedAt = now;
        next.batches[fp] = entry;
        save(next);
      },
      finish: function (result) {
        const now = new Date().toISOString();
        const next = load();
        const entry = next.batches[fp];
        if (!entry) return;
        entry.status = result.cancelled ? 'cancelled' : result.failed === 0 ? 'done' : 'partial';
        entry.updatedAt = now;
        /*
         * lastRun 只看这一轮：续跑那轮 written 是 0，别让人以为文件丢了；
         * cumulative 是这批从第一次开始累计写出多少。两个数分开记。
         */
        entry.lastRun = {
          at: now,
          total: result.total,
          succeeded: result.succeeded,
          failed: result.failed,
          skippedDone: result.skippedDone || 0,
          written: result.written || 0,
          skipped: result.skipped || 0,
          cancelled: Boolean(result.cancelled),
          ms: result.ms || 0
        };
        entry.cumulative = tally(entry);
        delete entry.summary;
        save(next);
      }
    };
  }

  return {
    get: get,
    list: list,
    open: open,
    file: file,
    fingerprint: fingerprint,
    namedFingerprint: namedFingerprint,
    itemKeys: itemKeys
  };
}

module.exports = { createBatchState, fingerprint, namedFingerprint, itemKeys };
