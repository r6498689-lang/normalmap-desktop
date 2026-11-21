'use strict';

/*
 * classification.spec.js — 阶段 A 交互验收（C01–C04）
 *
 * 全部通过真实 UI 事件驱动：CDP 设置 <input type=file> → 弹窗 → 点分类按钮
 * → 点确定/取消。不给图片预填标签，不调用内部函数跳过交互。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const driver = require('../lib/driver');

module.exports.run = async function run(ctx) {
  const failures = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) failures.push(label + (detail ? ' — ' + detail : ''));
  };

  const fx = (...p) => driver.fixture(...p);
  const counter = () => ctx.js("document.getElementById('classify_counter').textContent");
  const okDisabled = () => ctx.js("Boolean(document.getElementById('classify_ok').disabled)");
  const clickCat = (value) => ctx.js(`document.getElementById('classify_cat_${value}').click()`);

  async function waitDialog() {
    await ctx.waitFor("document.getElementById('classify_dialog') !== null", 15000);
  }
  async function waitPreviewReady() {
    await ctx.waitFor("!document.getElementById('classify_cat_wood').disabled", 20000);
  }
  async function setFiles(selector, files) {
    await ctx.setFileInput(ctx.win, selector, files);
  }

  await driver.waitForBoot(ctx);

  /* ---------------- C01 单图：选择即停留，确定后才提交 ---------------- */
  await setFiles('#select_file_height', [fx('height-bumps-256.png')]);
  await waitDialog();
  await waitPreviewReady();

  check('C01 单图打开分类框', true);
  check('C01 计数显示 当前 1 / 1', /当前 1 \/ 1/.test(await counter()), await counter());
  check('C01 未分类时确定不可用', (await okDisabled()) === true);
  check(
    'C01 分类按钮来自内置表',
    (await ctx.js("document.querySelectorAll('#classify_categories .nmo-cat').length")) >= 20
  );
  await ctx.screenshot('phase-a-single-dialog.png');

  await clickCat('wood');
  await ctx.wait(250);
  check('C01 最后一张分类后仍停留', /当前 1 \/ 1/.test(await counter()), await counter());
  check('C01 分类后确定可用', (await okDisabled()) === false);
  check(
    'C01 当前分类显示带命名值',
    /wood/.test(await ctx.js("document.getElementById('classify_current').textContent"))
  );

  await ctx.js("document.getElementById('classify_ok').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  await ctx.waitFor('NMO_FileDrop.height_image.naturalWidth === 256', 20000);
  const singleContext = await ctx.js('JSON.stringify(NMO_Main.sourceContext)');
  check('C01 确定后才载入图片', /"category":"wood"/.test(singleContext), singleContext);
  check('C01 源身份是会话唯一 ID', /sess-/.test(singleContext), singleContext);

  /* ---------------- C04 取消：不改主界面、不占号 ---------------- */
  const beforeCancelSize = await ctx.js('NMO_NormalMap.normal_canvas.width');
  await setFiles('#select_file_height', [fx('height-300x200.png')]);
  await waitDialog();
  await waitPreviewReady();
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  await ctx.wait(400);
  check(
    'C04 取消后主界面仍是上一张',
    (await ctx.js('NMO_NormalMap.normal_canvas.width')) === beforeCancelSize,
    String(beforeCancelSize)
  );
  check(
    'C04 取消不改变源身份',
    (await ctx.js('JSON.stringify(NMO_Main.sourceContext)')) === singleContext
  );

  /* ---------------- C01 三张：逐张前进、最后停留 ---------------- */
  await setFiles('#select_multiple_height_files', [
    fx('height-bumps-256.png'),
    fx('height-300x200.png'),
    fx('height-255x257.png')
  ]);
  await waitDialog();
  await waitPreviewReady();
  check('C01 三图初始 当前 1 / 3', /当前 1 \/ 3/.test(await counter()), await counter());

  await clickCat('concrete');
  await ctx.waitFor("document.getElementById('classify_counter').textContent.indexOf('当前 2 / 3') >= 0", 15000);
  check('C01 选完自动前进到第二张', true);
  check('C01 已分类计数 1 / 3', /已分类 1 \/ 3/.test(await counter()), await counter());

  await waitPreviewReady();
  await clickCat('stone');
  await ctx.waitFor("document.getElementById('classify_counter').textContent.indexOf('当前 3 / 3') >= 0", 15000);
  await waitPreviewReady();
  await clickCat('brick');
  await ctx.wait(250);
  check('C01 最后一张选择后停留', /当前 3 \/ 3/.test(await counter()), await counter());
  check('C01 全部完成后确定可用', (await okDisabled()) === false);

  /* ---------------- C02 上一张、改标签、回看保留 ---------------- */
  await ctx.js("document.getElementById('classify_prev').click()");
  await ctx.waitFor("document.getElementById('classify_counter').textContent.indexOf('当前 2 / 3') >= 0", 15000);
  await waitPreviewReady();
  const secondSelected = await ctx.js(
    "document.getElementById('classify_cat_stone').classList.contains('is-selected')"
  );
  check('C02 返回上一张时原标签保留', secondSelected === true);
  await clickCat('wood');
  await ctx.waitFor("document.getElementById('classify_counter').textContent.indexOf('当前 3 / 3') >= 0", 15000);
  check('C02 改标签后按顺序回到第三张', true);
  await ctx.js("document.getElementById('classify_prev').click()");
  await ctx.waitFor("document.getElementById('classify_counter').textContent.indexOf('当前 2 / 3') >= 0", 15000);
  await waitPreviewReady();
  check(
    'C02 只改目标项',
    (await ctx.js("document.getElementById('classify_cat_wood').classList.contains('is-selected')")) === true
  );
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);

  /* ---------------- C04 快速连点：不能把下一张也打上同一标签 ---------------- */
  await setFiles('#select_multiple_height_files', [
    fx('height-bumps-256.png'),
    fx('height-alpha-192.png')
  ]);
  await waitDialog();
  await waitPreviewReady();
  await ctx.js(
    "(function(){document.getElementById('classify_cat_wood').click();document.getElementById('classify_cat_stone').click();})()"
  );
  await ctx.wait(150);
  const rapid = JSON.parse(await ctx.js('JSON.stringify(NMO_Classification.snapshot())'));
  check(
    'C04 连点只作用于当前图',
    rapid.categories[0].category === 'wood' && rapid.categories[1].category === null,
    JSON.stringify(rapid.categories)
  );

  /* ---------------- C04 坏图：给文件名、可移除、不能确定 ---------------- */
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);

  await setFiles('#select_file_height', [fx('not-an-image.png')]);
  await waitDialog();
  await ctx.waitFor("document.getElementById('classify_error').hidden === false", 20000);
  const errorText = await ctx.js("document.getElementById('classify_error').textContent");
  check('C04 坏图显示具体文件名', /not-an-image\.png/.test(errorText), errorText);
  check(
    'C04 坏图时分类按钮不可点',
    (await ctx.js("document.getElementById('classify_cat_wood').disabled")) === true
  );
  check('C04 坏图时确定不可用', (await okDisabled()) === true);
  await ctx.screenshot('phase-a-bad-image.png');

  await ctx.js("document.getElementById('classify_remove').click()");
  await ctx.wait(250);
  check('C04 移除后队列为空只能取消', (await okDisabled()) === true);
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  check(
    'C04 移除坏图不删除源文件',
    fs.existsSync(fx('not-an-image.png')) === true
  );

  /* -------- 1.1.34 解码失败要说清原因（空文件 / 截断 PNG / 伪装扩展名） -------- */
  const decodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmo-decode-'));
  const decodeCases = [
    { name: 'empty-texture.png', bytes: Buffer.alloc(0), expect: /0 字节/ },
    {
      name: 'truncated-texture.png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]),
      expect: /不完整/
    },
    {
      name: 'actually-tiff.png',
      bytes: Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(32)]),
      expect: /TIFF/
    }
  ];
  for (const c of decodeCases) {
    const p = path.join(decodeDir, c.name);
    fs.writeFileSync(p, c.bytes);
    await setFiles('#select_file_height', [p]);
    await waitDialog();
    await ctx.waitFor("document.getElementById('classify_error').hidden === false", 25000);
    const text = await ctx.js("document.getElementById('classify_error').textContent");
    check('1.1.34 解码失败说明原因：' + c.name, c.expect.test(text), text);
    await ctx.js("document.getElementById('classify_cancel').click()");
    await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);
  }

  /* ---------------- C03 自定义标签与规范化去重 ---------------- */
  const beforeLib = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library.categories.length)})')
  );

  await setFiles('#select_file_height', [fx('height-bumps-256.png')]);
  await waitDialog();
  await waitPreviewReady();
  await ctx.js("document.getElementById('classify_custom_toggle').click()");
  await ctx.js(`(function(){
    var input = document.getElementById('classify_custom_input');
    input.value = '  Old  Oak  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const customPreview = await ctx.js("document.getElementById('classify_custom_preview').textContent");
  check('C03 自定义标签预览规范化结果', /old_oak/.test(customPreview), customPreview);
  await ctx.screenshot('phase-a-custom-tag.png');

  await ctx.js("document.getElementById('classify_custom_save').click()");
  await ctx.waitFor("document.getElementById('classify_cat_old_oak') !== null", 15000);
  await ctx.wait(400);
  check(
    'C03 保存后立即用于当前图',
    (await ctx.js("document.getElementById('classify_cat_old_oak').classList.contains('is-selected')")) === true
  );
  const afterLib = await ctx.js(
    'window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})'
  );
  const lib = JSON.parse(afterLib);
  check('C03 自定义标签写入编号库', lib.categories.some((c) => c.value === 'old_oak'));
  check('C03 库里只多了一个分类', lib.categories.length === beforeLib + 1, beforeLib + ' -> ' + lib.categories.length);

  /* -------- 1.1.33 删除自定义标签：× → 确认 → 从列表与库里消失 -------- */
  check(
    'C03 内置标签没有删除按钮',
    (await ctx.js("document.getElementById('classify_cat_del_wood') === null")) === true
  );
  check(
    'C03 自定义标签有删除按钮',
    (await ctx.js("document.getElementById('classify_cat_del_old_oak') !== null")) === true
  );
  await ctx.js("document.getElementById('classify_cat_del_old_oak').click()");
  await ctx.wait(200);
  check(
    'C03 点删除先出确认条',
    (await ctx.js("document.getElementById('classify_remove_box').hidden")) === false
  );
  check(
    'C03 确认条写明要删的标签',
    /old_oak/.test(await ctx.js("document.getElementById('classify_remove_text').textContent"))
  );
  await ctx.screenshot('phase-a-remove-tag-confirm.png');
  await ctx.js("document.getElementById('classify_remove_confirm').click()");
  await ctx.waitFor("document.getElementById('classify_cat_old_oak') === null", 15000);
  await ctx.wait(400);
  check(
    'C03 删除后标签从列表消失',
    (await ctx.js("document.getElementById('classify_cat_old_oak') === null")) === true
  );
  const libAfterRemove = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
  );
  check('C03 删除后编号库不再列出该标签', !libAfterRemove.categories.some((c) => c.value === 'old_oak'));
  check(
    'C03 删除后分类数量回到原值',
    libAfterRemove.categories.length === beforeLib,
    beforeLib + ' -> ' + libAfterRemove.categories.length
  );
  check(
    'C03 删除已选标签后当前图退回未选择',
    (await okDisabled()) === true,
    await okDisabled()
  );
  const afterRemoveSnap = JSON.parse(await ctx.js('JSON.stringify(NMO_Classification.snapshot())'));
  check(
    'C03 删除标签不影响预览解码',
    afterRemoveSnap.categories[0] && afterRemoveSnap.categories[0].preview === 'ready',
    JSON.stringify(afterRemoveSnap.categories)
  );

  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);

  // 再开一次，输入大写 WOOD：应复用已有 wood，不新建第二个计数。
  const woodCountBefore = lib.categories.filter((c) => c.value.toLowerCase() === 'wood').length;
  await setFiles('#select_file_height', [fx('height-300x200.png')]);
  await waitDialog();
  await waitPreviewReady();
  await ctx.js("document.getElementById('classify_custom_toggle').click()");
  await ctx.js(`(function(){
    var input = document.getElementById('classify_custom_input');
    input.value = 'WOOD';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await ctx.js("document.getElementById('classify_custom_save').click()");
  await ctx.wait(500);
  const lib2 = JSON.parse(
    await ctx.js('window.nmoDesktop.getLibrary().then(function(r){return JSON.stringify(r.library)})')
  );
  const woodCountAfter = lib2.categories.filter((c) => c.value.toLowerCase() === 'wood').length;
  check('C03 Wood/wood 不建两个计数', woodCountBefore === woodCountAfter, woodCountBefore + ' -> ' + woodCountAfter);
  check(
    'C03 复用已有分类后当前图被标记',
    (await ctx.js("document.getElementById('classify_cat_wood').classList.contains('is-selected')")) === true
  );
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);

  /* ---------------- C04 弹窗打开时另一批导入被拒绝 ---------------- */
  await setFiles('#select_file_height', [fx('height-bumps-256.png')]);
  await waitDialog();
  await waitPreviewReady();
  const rejected = await ctx.js(
    "NMO_Classification.open([new File(['x'],'other.png',{type:'image/png'})]).then(function(r){return JSON.stringify(r)})"
  );
  check('C04 已有会话时拒绝新一批', /"cancelled":true/.test(rejected), rejected);
  check(
    'C04 仍只有一个弹窗',
    (await ctx.js("document.querySelectorAll('#classify_dialog').length")) === 1
  );
  await ctx.js("document.getElementById('classify_cancel').click()");
  await ctx.waitFor("document.getElementById('classify_dialog') === null", 10000);

  const consoleErrors = ctx.consoleLog.filter((e) => e.level === 'error' || e.level === 3);
  check('无渲染进程报错', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  return {
    ok: failures.length === 0,
    spec: 'classification',
    method: 'CDP 设置真实 <input type=file>，随后用按钮 click 驱动弹窗',
    steps,
    failures,
    checkedAt: new Date().toISOString()
  };
};
