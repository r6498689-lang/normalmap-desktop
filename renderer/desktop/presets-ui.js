/*
 * presets-ui.js — 参数预设的界面接线
 *
 * 预设只存“生成参数”（粗糙度/金属度/ORM/编码位深等），不存图片、不存路径、
 * 也不存编号——换一批素材套同一个预设时，编号必须继续按编号库往后排。
 *
 * 应用预设走的是和手点控件完全相同的路径：先写控件，再派发 change，
 * 由 pbr-ui.js 现有的绑定去改数据并重算。这样预设永远不会绕开校验。
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  /* 参与预设的控件。顺序即保存顺序，便于人读 JSON。 */
  var FIELDS = [
    ...Array.from(document.querySelectorAll('input[id$="_slider"], input[id^="invert_"], input[id$="_tick"], #height_offset, #normal_type, #falloff_type, #file_type, #transparency_nmb, #file_jpg_qual_nmb'), el=>el.id),
    'rough_mode',
    'rough_value',
    'rough_strength',
    'rough_detail',
    'rough_invert',
    'rough_min',
    'rough_max',
    'metal_mode',
    'metal_invert',
    'metal_min',
    'metal_max',
    'metal_threshold',
    'metal_softness',

    'pbr_preview_toggle'
  ];

  var cache = [];

  function status(text, kind) {
    if (window.NMO_Desktop && NMO_Desktop.status) NMO_Desktop.status(text, kind || 'info');
  }

  /* 预设走 preload 暴露的 IPC 原生对象；桥接层只负责状态提示。 */
  function api() {
    return window.nmoDesktop || null;
  }

  /* 当前控件值。checkbox 存 checked，其余存字符串。 */
  function collect() {
    var data = { controls: {} };
    FIELDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      data.controls[id] = el.type === 'checkbox' ? Boolean(el.checked) : el.value;
    });
    /* 生成参数本体也存一份：即使以后 UI 改了 id，按名字仍能还原大半。 */


    data.maskPreset=NMO_RoughnessMap.getPresetId();
    data.orm = NMO_ORM.isEnabled();
    return data;
  }

  /* 写控件 + 派发事件，让既有绑定负责校验与重算。 */
  async function apply(data) {
    if (!data || !data.controls) {
      status('这个预设里没有可用的参数。', 'error');
      return false;
    }
    if(data.maskPreset!==undefined && data.maskPreset!==NMO_RoughnessMap.getPresetId()){
      $('rough_preset').value=data.maskPreset;
      await NMO_PBRUI.applyRoughPreset(data.maskPreset);
    }
    Object.keys(data.controls).forEach(function (id) {
      var el = $(id);
      if (!el || !FIELDS.includes(id)) return;
      var value = data.controls[id];
      if (el.type === 'checkbox') {
        var next = Boolean(value);
        if (el.checked !== next) {
          el.click();
        }
      } else if (el.value !== String(value)) {
        el.value = String(value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        /*
         * 滑块只监听 input（粗糙度基础值就是这条），程序改 value 不会触发；
         * 补一个 input，保证“套预设”真的改了数据，也顺带把旁边的数字框同步过去。
         */
        if (el.type === 'range') el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    /* 兜底：控件缺失时直接写数据层，避免预设“看起来应用了但没生效”。 */
    if (data.roughness && window.NMO_RoughnessMap) NMO_RoughnessMap.setSettings(data.roughness);
    if (data.metallic && window.NMO_MetallicMap) NMO_MetallicMap.setSettings(data.metallic);

    if (typeof data.orm === 'boolean' && window.NMO_ORM) {
      var btn = $('orm_toggle');
      if (btn && !btn.disabled && NMO_ORM.isEnabled() !== data.orm) {
        NMO_ORM.setEnabled(data.orm);
        btn.setAttribute('aria-pressed', data.orm ? 'true' : 'false');
      }
    }

    if (window.NMO_PBRUI) {
      NMO_PBRUI.refreshAll();
      NMO_PBRUI.updateOrmAvailability();
    }
    return true;
  }

  function fillSelect(selected) {
    var select = $('preset_select');
    if (!select) return;
    var keep = selected || select.value;
    select.textContent = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '（无）';
    select.appendChild(none);
    cache.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      select.appendChild(option);
    });
    if (keep && cache.some(function (item) { return item.name === keep; })) {
      select.value = keep;
    }
  }

  function find(name) {
    return cache.filter(function (item) { return item.name === name; })[0] || null;
  }

  function reload(selected) {
    if (!api()) return Promise.resolve([]);
    return api().getPresets()
      .then(function (result) {
        cache = (result && result.presets) || [];
        fillSelect(selected);
        return cache;
      })
      .catch(function (err) {
        status('读取预设失败：' + err.message, 'error');
        return [];
      });
  }

  function nameFromInput() {
    var input = $('preset_name');
    return input ? input.value.trim() : '';
  }

  function save() {
    var name = nameFromInput() || ($('preset_select') && $('preset_select').value) || '';
    if (!name) {
      status('请先在“预设名”里写一个名字，再保存。', 'error');
      if ($('preset_name')) $('preset_name').focus();
      return Promise.resolve(false);
    }
    if (!api()) return Promise.resolve(false);
    if (find(name) && !window.confirm('是否覆盖原有参数？')) return Promise.resolve(false);
    return api().savePreset({ name: name, data: collect() })
      .then(function (result) {
        if (!result || result.ok === false) {
          status('保存预设失败：' + ((result && result.error) || '未知原因'), 'error');
          return false;
        }
        status('已保存预设“' + (result.name || name) + '”。', 'ok');
        return reload(result.name || name).then(function () { return true; });
      })
      .catch(function (err) {
        status('保存预设失败：' + err.message, 'error');
        return false;
      });
  }

  async function applySelected() {
    var select = $('preset_select');
    var name = select ? select.value : '';
    if (!name) {
      status('先在下拉框里选一个预设，再点“应用”。', 'info');
      return;
    }
    var preset = find(name);
    if (!preset) {
      status('预设“' + name + '”已不存在，列表已刷新。', 'error');
      reload();
      return;
    }
    if (await apply(preset.data)) status('已应用预设“' + name + '”。', 'ok');
  }

  function renameSelected() {
    var select = $('preset_select');
    var from = select ? select.value : '';
    var to = nameFromInput() || (from ? window.prompt('重命名为：', from) : '');
    if (!from) {
      status('先选一个要重命名的预设。', 'info');
      return;
    }
    if (!to || to === from) return;
    if (!api()) return;
    api().renamePreset({ from: from, to: to })
      .then(function (result) {
        if (!result || result.ok === false) {
          status('重命名失败：' + ((result && result.error) || '未知原因'), 'error');
          return;
        }
        status('已重命名为“' + to + '”。', 'ok');
        return reload(to);
      })
      .catch(function (err) {
        status('重命名失败：' + err.message, 'error');
      });
  }

  function deleteSelected() {
    var select = $('preset_select');
    var name = select ? select.value : '';
    if (!name) {
      status('先选一个要删除的预设。', 'info');
      return;
    }
    if (!api()) return;
    api().deletePreset(name)
      .then(function (result) {
        if (!result || result.ok === false) {
          status('删除失败：' + ((result && result.error) || '未知原因'), 'error');
          return;
        }
        status('已删除预设“' + name + '”。', 'info');
        return reload('');
      })
      .catch(function (err) {
        status('删除失败：' + err.message, 'error');
      });
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (!$('preset_save')) return;
    $('preset_save').addEventListener('click', save);
    $('preset_apply').addEventListener('click', applySelected);
    $('preset_rename').addEventListener('click', renameSelected);
    $('preset_delete').addEventListener('click', deleteSelected);
    if ($('preset_select')) {
      $('preset_select').addEventListener('change', function () {
        var preset = find(this.value);
        if (preset) { $('preset_name').value = preset.name; apply(preset.data); }
      });
    }
    reload();
    let ready=false, timer;
    function saveCurrent(){
      if (ready && !location.search.includes('worker=1')) api().saveCurrent(collect());
    }
    window.NMO_ParametersReady=new Promise(resolve=>window.addEventListener('load', async ()=>{
      const last=await api().readCurrent();
      if(last) await apply(last);
      ready=true;resolve();
    }));
    function changed(){ clearTimeout(timer); timer=setTimeout(saveCurrent,180); }
    for(const event of ['input','change','click']) document.addEventListener(event,changed);
    window.addEventListener('beforeunload',saveCurrent);
  });

  window.NMO_Presets = {
    async use(name) {
      const presets=await reload(name);
      const hit=presets.find(p=>p.name===name);
      if(!hit)throw Error('未知预设：'+name);
      await apply(hit.data);
      return collect();
    },
    collect: collect,
    apply: apply,
    reload: reload,
    save: save,
    list: function () { return cache.slice(); }
  };
})();
