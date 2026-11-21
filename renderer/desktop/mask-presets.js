/*
 * mask-presets.js — 十张内置黑白遮罩（粗糙度“预设”下拉的数据源）
 *
 * 这十张图来自用户提供的素材，由 build/import-masks.js 统一转成
 * 1024×1024、8 位灰度 PNG 放在 images/masks/ 下。
 * 这里只负责“id → 中文名 → 文件路径”和按需解码，具体怎么用（是否重采样、
 * 什么时候生效）由 pbrMaps.js 决定。
 */
(function () {
  'use strict';

  var PRESETS = [
    { id: 'peeling-wood', label: '剥落木纹', file: 'images/masks/peeling-wood.png' },
    { id: 'mottled-wall', label: '斑驳墙面', file: 'images/masks/mottled-wall.png' },
    { id: 'soft-cloud', label: '云雾柔斑', file: 'images/masks/soft-cloud.png' },
    { id: 'edge-fade', label: '上下渐隐', file: 'images/masks/edge-fade.png' },
    { id: 'heavy-stain', label: '重污渍', file: 'images/masks/heavy-stain.png' },
    { id: 'crumpled-cloth', label: '揉皱布料', file: 'images/masks/crumpled-cloth.png' },
    { id: 'coarse-grain', label: '粗颗粒', file: 'images/masks/coarse-grain.png' },
    { id: 'fine-grain', label: '细颗粒', file: 'images/masks/fine-grain.png' },
    { id: 'brushed-plaster', label: '涂抹灰泥', file: 'images/masks/brushed-plaster.png' },
    { id: 'vertical-streak', label: '竖向条纹', file: 'images/masks/vertical-streak.png' }
  ];

  var cache = {}; // id -> canvas
  var pending = {}; // id -> Promise<canvas>

  function find(id) {
    for (var i = 0; i < PRESETS.length; i += 1) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return null;
  }

  function list() {
    return PRESETS.map(function (item) {
      return { id: item.id, label: item.label };
    });
  }

  function labelOf(id) {
    var item = find(id);
    return item ? item.label : '';
  }

  function load(id) {
    var item = find(id);
    if (!item) return Promise.reject(new Error('没有这个遮罩预设：' + id));
    if (cache[id]) return Promise.resolve(cache[id]);
    if (pending[id]) return pending[id];

    pending[id] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        cache[id] = canvas;
        delete pending[id];
        resolve(canvas);
      };
      img.onerror = function () {
        delete pending[id];
        reject(new Error('遮罩预设读取失败：' + item.label));
      };
      img.src = item.file;
    });
    return pending[id];
  }

  window.NMO_MaskPresets = {
    list: list,
    find: find,
    labelOf: labelOf,
    load: load,
    /** 已经解码过的画布；没加载过返回 null（渲染路径用，避免同步等待）。 */
    peek: function (id) {
      return cache[id] || null;
    }
  };
})();
