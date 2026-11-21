'use strict';

/*
 * presets-store.js — 参数预设（只保存生成设置，不保存图片/路径/编号）
 *
 * 文件：<userData>/library/nmo-presets.json
 * 结构：{ schemaVersion: 1, presets: { [name]: { createdAt, data } } }
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const FILE_NAME = 'nmo-presets.json';
const MAX_PRESETS = 100;
const MAX_NAME = 40;

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, presets: {} };
}

class PresetStore {
  constructor(options) {
    this.dir = (options || {}).dir;
    this.file = path.join(this.dir, FILE_NAME);
    this.state = null;
  }

  load() {
    if (this.state) return this.state;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || typeof parsed.presets !== 'object') {
        throw new Error('预设文件格式不正确。');
      }
      this.state = parsed;
    } catch (err) {
      if (err.code === 'ENOENT') this.state = emptyState();
      else throw new Error('预设读取失败：' + err.message);
    }
    if (!this.state.factoryInitialized) {
      this._persist({...this.state,factoryInitialized:true,presets:{...require("./factory-presets.json"),...this.state.presets}});
    }
    return this.state;
  }

  _persist(next) {
    fs.mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify(next, null, 2) + '\n';
    const tmp = this.file + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, this.file);
    this.state = next;
  }

  list() {
    const state = this.load();
    return Object.keys(state.presets)
      .sort()
      .map((name) => ({ name, createdAt: state.presets[name].createdAt, data: state.presets[name].data }));
  }

  save(name, data) {
    const clean = String(name || '').trim().slice(0, MAX_NAME);
    if (!clean || Object.hasOwn(Object.prototype,clean)) throw new Error('预设名不能为空。');
    const state = JSON.parse(JSON.stringify(this.load()));
    if (!state.presets[clean] && Object.keys(state.presets).length >= MAX_PRESETS) {
      throw new Error('预设数量已达到上限 ' + MAX_PRESETS + '。');
    }
    state.presets[clean] = { createdAt: new Date().toISOString(), data: data || {} };
    this._persist(state);
    return { ok: true, name: clean };
  }

  rename(from, to) {
    const source = String(from || '').trim();
    const target = String(to || '').trim().slice(0, MAX_NAME);
    const state = JSON.parse(JSON.stringify(this.load()));
    if (!state.presets[source]) throw new Error('预设不存在：' + source);
    if (!target || Object.hasOwn(Object.prototype,target)) throw new Error('新预设名不能为空。');
    if (state.presets[target]) throw new Error('已存在同名预设：' + target);
    state.presets[target] = state.presets[source];
    delete state.presets[source];
    this._persist(state);
    return { ok: true, name: target };
  }

  remove(name) {
    const state = JSON.parse(JSON.stringify(this.load()));
    if (!state.presets[name]) throw new Error('预设不存在：' + name);
    delete state.presets[name];
    this._persist(state);
    return { ok: true };
  }
}

module.exports = { PresetStore, SCHEMA_VERSION, FILE_NAME };
