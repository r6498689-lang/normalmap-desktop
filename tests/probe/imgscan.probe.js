'use strict';

/*
 * imgscan.probe.js — 量一张截图里“白色边框”的位置。
 * 用法：把图片路径写进环境变量 NMO_PROBE_IMAGE，再 node tests/probe.js imgscan。
 * 只是为了确认用户截图里两个预览框的真实边界，不参与产品逻辑。
 */

const fs = require('node:fs');

module.exports.run = async function run(ctx) {
  const file = process.env.NMO_PROBE_IMAGE;
  if (!file) return { ok: false, error: 'NMO_PROBE_IMAGE not set' };
  const b64 = fs.readFileSync(file).toString('base64');
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';

  const result = await ctx.js(`(function(){
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = function(){
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        var d = g.getImageData(0, 0, c.width, c.height).data;
        function light(x, y){
          var i = (y * c.width + x) * 4;
          var r = d[i], gg = d[i+1], b = d[i+2];
          return r > 150 && Math.abs(r-gg) < 25 && Math.abs(gg-b) < 25;
        }
        var cols = [], rows = [];
        for (var x = 0; x < c.width; x++) {
          var n = 0, minY = 1e9, maxY = -1;
          for (var y = 30; y < Math.min(490, c.height); y++) if (light(x,y)) { n++; if (y<minY) minY=y; if (y>maxY) maxY=y; }
          if (n > 300) cols.push([x, n, minY, maxY]);
        }
        for (var yy = 0; yy < c.height; yy++) {
          var m = 0, minX = 1e9, maxX = -1;
          for (var xx = 0; xx < c.width; xx++) if (light(xx,yy)) { m++; if (xx<minX) minX=xx; if (xx>maxX) maxX=xx; }
          if (m > 300) rows.push([yy, m, minX, maxX]);
        }
        // 每个外框：左边界列上最长的连续亮段 = 那条竖边框
        var frames = cols.map(function(col){
          var x = col[0], runs = [], start = null, prev = -10;
          for (var y = 0; y < c.height; y++) {
            if (!light(x,y)) continue;
            if (y - prev > 2) { if (start !== null) runs.push([start, prev]); start = y; }
            prev = y;
          }
          if (start !== null) runs.push([start, prev]);
          runs.sort(function(a,b){ return (b[1]-b[0]) - (a[1]-a[0]); });
          var best = runs[0] || [null, null];
          return { x: x, top: best[0], bottom: best[1], len: best[1] !== null ? best[1]-best[0]+1 : 0 };
        });
        // 左右两半里“明显不是背景”的内容 bbox（背景是深蓝照片，内容更亮/更饱和）
        function contentBox(x0, x1) {
          var minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
          for (var y = 0; y < c.height; y++) {
            for (var x = x0; x < x1; x++) {
              var i = (y * c.width + x) * 4;
              var r = d[i], gg = d[i+1], b = d[i+2];
              var lum = 0.2126*r + 0.7152*gg + 0.0722*b;
              var sat = Math.max(r,gg,b) - Math.min(r,gg,b);
              if (lum > 90 || sat > 70) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
        }
        var boxes = { left: contentBox(29, 442), right: contentBox(522, 935) };
        // 紫色法线图像的范围（法线图底色是亮的蓝紫，和背景/边框区分明显）
        var purpleRows = [], purpleCols = [];
        for (var y2 = 0; y2 < c.height; y2++) {
          var n2 = 0;
          for (var x2 = 522; x2 < 936; x2++) {
            var i2 = (y2 * c.width + x2) * 4;
            var r2 = d[i2], g2 = d[i2+1], b2 = d[i2+2];
            if (b2 > 150 && r2 > 90 && b2 - g2 > 30) n2++;
          }
          if (n2 > 100) purpleRows.push(y2);
        }
        for (var x3 = 522; x3 < 936; x3++) {
          var n3 = 0;
          for (var y3 = 0; y3 < c.height; y3++) {
            var i3 = (y3 * c.width + x3) * 4;
            var r3 = d[i3], g3 = d[i3+1], b3 = d[i3+2];
            if (b3 > 150 && r3 > 90 && b3 - g3 > 30) n3++;
          }
          if (n3 > 100) purpleCols.push(x3);
        }
        var purple = {
          top: purpleRows.length ? purpleRows[0] : null,
          bottom: purpleRows.length ? purpleRows[purpleRows.length-1] : null,
          left: purpleCols.length ? purpleCols[0] : null,
          right: purpleCols.length ? purpleCols[purpleCols.length-1] : null
        };
        resolve({ width: c.width, height: c.height, cols: cols, rows: rows, frames: frames, boxes: boxes, purple: purple });
      };
      img.onerror = function(){ resolve({ error: 'image load failed' }); };
      img.src = 'data:${mime};base64,${b64}';
    });
  })()`);

  return { ok: true, spec: 'imgscan', file, result };
};
