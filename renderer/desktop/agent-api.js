'use strict';

/*
 * agent-api.js — 给 Agent 桥用的页面侧命令（1.1.16）
 *
 * 主进程通过 executeJavaScript 调这里的函数，参数都是普通 JSON。
 * 这里只做三件事：把字节变成 File 走原有导入路径、按类别套预设、按计划导出。
 * 图像计算、命名规则、编号预留全部沿用现有实现，不另起一套。
 *
 * 所有函数都返回 {ok:true, ...} / {ok:false, error:{code, message}}，
 * 不抛异常 —— 异常穿过 executeJavaScript 只剩一句 message，错误码会丢。
 */

(function () {
	'use strict';

	var TYPE_MAP = {
		normal: { recordType: 'NormalMap', property: 'Normal' },
		displacement: { recordType: 'DisplacementMap', property: 'Height' },
		height: { recordType: 'DisplacementMap', property: 'Height' },
		ao: { recordType: 'AmbientOcclusionMap', property: 'AO' },
		ambient: { recordType: 'AmbientOcclusionMap', property: 'AO' },
		specular: { recordType: 'SpecularMap', property: 'Specular' },
		roughness: { recordType: 'RoughnessMap', property: 'Roughness' },
		metallic: { recordType: 'MetallicMap', property: 'Metallic' }
	};
	var DEFAULT_TYPES = ['normal', 'displacement', 'ao', 'specular'];

	function ok(data) {
		return Object.assign({ ok: true }, data || {});
	}

	function fail(code, message) {
		return { ok: false, error: { code: code, message: message } };
	}

	function base64ToBytes(b64) {
		var binary = atob(b64);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	function imageSize() {
		var img = NMO_FileDrop.height_image;
		if (!img || !img.naturalWidth) return null;
		return { width: img.naturalWidth, height: img.naturalHeight };
	}

	function categoryList() {
    return NMO_Presets.reload().then(rows=>rows.map(p=>({value:p.name,label:p.name})));
  }

	function findCategory(list, value) {
		for (var i = 0; i < list.length; i++) {
			if (list[i].value === value) return list[i];
		}
		return null;
	}

	function canvasSizes() {
		var out = {};
		function put(name, canvas) {
			if (canvas && canvas.width > 1 && canvas.height > 1) {
				out[name] = [canvas.width, canvas.height];
			}
		}
		put('normal', window.NMO_NormalMap && NMO_NormalMap.normal_canvas);
		put('displacement', window.NMO_DisplacementMap && NMO_DisplacementMap.displacement_canvas);
		put('ao', window.NMO_AmbientOccMap && NMO_AmbientOccMap.ao_canvas);
		put('specular', window.NMO_SpecularMap && NMO_SpecularMap.specular_canvas);
		put('roughness', window.NMO_RoughnessMap && NMO_RoughnessMap.roughness_canvas);
		put('metallic', window.NMO_MetallicMap && NMO_MetallicMap.metallic_canvas);
		return out;
	}

	function selectedTypes() {
		var list = NMO_FileDrop.getSelectedTypes ? NMO_FileDrop.getSelectedTypes() : [];
		return list.map(function (row) {
			return row.property;
		});
	}

	async function status() {
		try {
			var ctx = NMO_Main.sourceContext || null;
			var list = await categoryList();
			var entry = ctx ? findCategory(list, ctx.category) : null;
			var strength = document.getElementById('strength_nmb');
			var level = document.getElementById('level_nmb');
			var blur = document.getElementById('blur_sharp_nmb');
			return ok({
				image: ctx
					? { name: ctx.sourceName, file: ctx.file ? ctx.file.name : null, size: imageSize() }
					: null,
				category: ctx ? ctx.category : null,
				categoryLabel: entry ? entry.label : null,
				params: {
					normal: {
						strength: strength ? Number(strength.value) : null,
						level: level ? Number(level.value) : null,
						blur_sharp: blur ? Number(blur.value) : null
					},
					roughness: window.NMO_RoughnessMap ? NMO_RoughnessMap.getSettings() : null,
					metallic: window.NMO_MetallicMap ? NMO_MetallicMap.getSettings() : null
				},
				types: selectedTypes(),
				pbrPreview: window.NMO_PBRPreview ? NMO_PBRPreview.isEnabled() : false,
				generated: canvasSizes()
			});
		} catch (err) {
			return fail('status_failed', (err && err.message) || String(err));
		}
	}

	/*
	 * 打开一张图：字节 → File → 原有 readImage 路径。
	 * 分类不走弹窗：类别由调用方给定，直接写进 sourceContext。
	 */
	async function openImage(payload) {
		try {
			if (!payload || !payload.base64) return fail('bad_args', '缺少图片字节。');
			var bytes = base64ToBytes(payload.base64);
			var name = payload.name || 'image.png';
			var file = new File([bytes], name, { type: payload.mime || '' });

			if (!NMO_FileDrop.isSupportedImage(file)) {
				return fail('unsupported', '不是受支持的图片：' + name);
			}

			var loaded = await NMO_FileDrop.readImage(file, 'height', '');
			if (loaded === false) {
				return fail('decode_failed', '图片无法解码：' + name);
			}

      const preset=payload.preset || payload.category || '';
      if(preset)await NMO_Presets.use(preset);
      if(payload.params) await parameters({data:payload.params},true);
			var sourceKey =
				'agent:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
			NMO_Main.setSourceContext({
				sourceKey: sourceKey,
				sourceName: name.replace(/\.[^.]+$/, ''),
				category: preset,
				mode: 'new',
				file: file
			});

			var out = await status();
			return out;
		} catch (err) {
			return fail('open_failed', (err && err.message) || String(err));
		}
	}

	async function setCategory(category) {
		try {
			if (!category) return fail('bad_args', '缺少 category。');
			var ctx = NMO_Main.sourceContext;
			if (!ctx) return fail('no_image', '还没有打开图片，先调 open_image。');

			var list = await categoryList();
			var entry = findCategory(list, category);
			if (!entry) {
				return fail(
					'unknown_category',
					'没有这个类别：' + category + '。可用：' + list.map(function (c) { return c.value; }).join(', ')
				);
			}

			ctx.category = entry.value;
			/* 重新走一遍 setSourceContext：类别一变就重套该类别的粗糙度/金属度预设。 */
			await NMO_Presets.use(category);
      NMO_Main.setSourceContext(ctx);
			return status();
		} catch (err) {
			return fail('set_category_failed', (err && err.message) || String(err));
		}
	}

	function normalizeTypes(types) {
		var keys = Array.isArray(types) && types.length ? types.slice() : DEFAULT_TYPES.slice();
		if (keys.indexOf('all') !== -1) keys = Object.keys(TYPE_MAP);
		var seen = {};
		var out = [];
		for (var i = 0; i < keys.length; i++) {
			var key = String(keys[i] || '').toLowerCase();
			var hit = TYPE_MAP[key];
			if (!hit) return { error: '未知的贴图类型：' + keys[i] };
			if (seen[hit.property]) continue;
			seen[hit.property] = true;
			out.push(hit);
		}
		return { types: out };
	}

	/*
	 * 导出到指定目录：跳过目录选择框，编号仍由主进程序列化预留。
	 * 生成失败只记在该项，不拖累其它项 —— 与界面的“全部导出”同一套。
	 */
	async function exportTo(args) {
		try {
			args = args || {};
			var ctx = NMO_Main.sourceContext;
			if (!ctx) return fail('no_image', '还没有打开图片，先调 open_image。');
			if (!args.dir) return fail('bad_args', '缺少 dir（导出目录）。');

			const selected=args.types || selectedTypes();
      if(!selected.length)return fail('bad_types','请选择贴图用途');
      var picked = normalizeTypes(selected);
			if (picked.error) return fail('bad_types', picked.error);

			var outputs = NMO_Main.expandOutputs(picked.types);
			var tasks = outputs.map(function (output) {
				return {
					sourceKey: ctx.sourceKey,
					category: ctx.category,
					property: output.property,
					name: output.property,
					produce: function () {
						return NMO_Main.buildImageRecord(output.recordType, 'unused');
					}
				};
			});

			var report = await NMO_Main.exportPlanned({
				label: 'Agent 导出',
				suggestedName: 'NormalMap',
				dir: args.dir,
				items: [
					{
						sourceKey: ctx.sourceKey,
						sourceName: ctx.sourceName,
            baseName: args.baseName ?? ctx.sourceName,
            resumeBase:args.resumeBase,
						category: ctx.category,
						mode: 'new'
					}
				],
				tasks: tasks
			});

			var settled = (report && (report.written || 0) + (report.skipped || 0) > 0 && !report.failed);
			if (!report || !(report.ok || settled)) {
				return fail(
					'export_failed',
					(report && (report.error || (report.failures && report.failures[0] && report.failures[0].error))) ||
						'导出没有写出任何文件。'
				);
			}
			return ok({
				dir: report.dir,
				written: report.written,
				skipped: report.skipped,
				failed: report.failed,
				libraryFailed: report.libraryFailed || 0,
				needsRepair: false,
				files: report.files || [],
				failures: report.failures || []
			});
		} catch (err) {
			return fail('export_failed', (err && err.message) || String(err));
		}
	}

	/* ------------------------------------------------------------------
	 * 类别清单：给 AI 一份“可选项”，含中文标签、预设与下一个编号。
	 * AI 看完图之后只能从这张表里选，选错会被 set_category 挡回来。
	 * ------------------------------------------------------------------ */

	async function categories() {
		try {
			var ctx = NMO_Main.sourceContext || null;
			var list = await categoryList();
			var table = (window.NMO_CategoryPresets && NMO_CategoryPresets.table) || {};
			return ok({
				current: ctx ? ctx.category : null,
				count: list.length,
				categories: list.map(function (row) {
					var preset = table[row.value] || null;
					return {
						value: row.value,
						label: row.label,
						preset: preset
							? { base: preset.base, strength: preset.strength, metal: preset.metal }
							: null
					};
				})
			});
		} catch (err) {
			return fail('categories_failed', (err && err.message) || String(err));
		}
	}

	/* ------------------------------------------------------------------
	 * 缩略图：给 AI“眼睛”。
	 * 源图取已解码的 height_image；法线图取 normal_canvas。
	 * 按最长边缩到 max（默认 512），转成 PNG base64 —— 只回传缩略图，
	 * 不回传原图，避免几十兆的字符串穿过 IPC。
	 * ------------------------------------------------------------------ */

	function scaledCanvas(source, w, h, max) {
		var scale = Math.min(1, max / Math.max(w || 1, h || 1));
		var cw = Math.max(1, Math.round(w * scale));
		var ch = Math.max(1, Math.round(h * scale));
		var canvas = document.createElement('canvas');
		canvas.width = cw;
		canvas.height = ch;
		var g = canvas.getContext('2d');
		g.imageSmoothingEnabled = true;
		g.imageSmoothingQuality = 'high';
		g.drawImage(source, 0, 0, cw, ch);
		return { canvas: canvas, width: cw, height: ch, scale: scale };
	}

	function canvasStats(canvas) {
		try {
			var g = canvas.getContext('2d');
			var px = g.getImageData(0, 0, canvas.width, canvas.height).data;
			var n = canvas.width * canvas.height;
			var r = 0;
			var gg = 0;
			var b = 0;
			var sat = 0;
			for (var i = 0; i < n; i++) {
				var at = i * 4;
				var rr = px[at];
				var gv = px[at + 1];
				var bb = px[at + 2];
				r += rr;
				gg += gv;
				b += bb;
				var mx = Math.max(rr, gv, bb);
				var mn = Math.min(rr, gv, bb);
				sat += mx === 0 ? 0 : (mx - mn) / mx;
			}
			r /= n;
			gg /= n;
			b /= n;
			sat /= n;
			return {
				meanRGB: [Math.round(r), Math.round(gg), Math.round(b)],
				meanLuma: Math.round((0.2126 * r + 0.7152 * gg + 0.0722 * b) * 10) / 10,
				meanSaturation: Math.round(sat * 100) / 100,
				sampledAt: canvas.width + '×' + canvas.height
			};
		} catch (err) {
			return null;
		}
	}

	async function preview(payload) {
		try {
			payload = payload || {};
			var max = Math.max(64, Math.min(1024, Math.round(Number(payload.max) || 512)));
			var which = payload.which === 'normal' ? 'normal' : 'source';
			var source;
			var name;
			var width;
			var height;

			if (which === 'normal') {
				var nc = window.NMO_NormalMap && NMO_NormalMap.normal_canvas;
				if (!nc || !nc.width || nc.width < 2) {
					return fail('no_normal', '还没有生成法线图，先 open_image 打开一张图。');
				}
				source = nc;
				width = nc.width;
				height = nc.height;
				name = 'normal';
			} else {
				var img = NMO_FileDrop.height_image;
				if (!img || !img.naturalWidth) {
					return fail('no_image', '还没有打开图片。可以带 path 直接预览磁盘上的文件，或先调 open_image。');
				}
				source = img;
				width = img.naturalWidth;
				height = img.naturalHeight;
				name = (NMO_Main.sourceContext && NMO_Main.sourceContext.sourceName) || 'source';
			}

			var fixed = scaledCanvas(source, width, height, max);
			var dataUrl = fixed.canvas.toDataURL('image/png');
			return ok({
				image: {
					name: name,
					mime: 'image/png',
					which: which,
					width: width,
					height: height,
					thumbWidth: fixed.width,
					thumbHeight: fixed.height,
					scale: Math.round(fixed.scale * 1000) / 1000,
					data: dataUrl.slice(dataUrl.indexOf(',') + 1)
				},
				stats: canvasStats(fixed.canvas)
			});
		} catch (err) {
			return fail('preview_failed', (err && err.message) || String(err));
		}
	}

	async function parameters(args, modifying){
    if(modifying){
      const data=args.data;
      const before=NMO_Presets.collect();
      if(!data || !data.controls || typeof data.controls!=='object') throw Error('需要 data.controls');
      for(const [id,value] of Object.entries(data.controls)){
        const el=document.getElementById(id);
        if(!Object.hasOwn(before.controls,id) || !el)throw Error('未知参数 '+id);
        if(el.type==='checkbox' && typeof value!=='boolean')throw Error(id+' 需要布尔值');
        if(el.options && !Array.from(el.options).some(o=>o.value===value))throw Error(id+' 无效选项');
        if(['range','number'].includes(el.type) && (value==='' || !Number.isFinite(Number(value)) || (el.min && Number(value)<Number(el.min)) || (el.max && Number(value)>Number(el.max))))throw Error(id+' 超出范围');
      }
      if(data.orm!==undefined && typeof data.orm!=='boolean')throw Error('orm 需要布尔值');
      if(data.maskPreset && !NMO_MaskPresets.find(data.maskPreset))throw Error("未知遮罩预设");
      await NMO_Presets.apply({controls:data.controls,orm:data.orm,maskPreset:data.maskPreset});
    }
    return ok({data:NMO_Presets.collect()});
  }
  window.NMO_Agent = {
    async importMask(payload){
      const file=new File([base64ToBytes(payload.base64)],payload.name,{type:payload.mime || ''});
      await NMO_PBRUI.importMask(payload.kind,file,payload.resample);
      return ok({data:NMO_Presets.collect()});
    },
    getParameters:()=>parameters({},false),
    setParameters:args=>parameters(args,true),
    listPresets:async()=>ok({presets:await NMO_Presets.reload()}),
    applyPreset:async args=>ok({data:await NMO_Presets.use(args.name)}),
    savePreset:async args=>{
      const rows=await NMO_Presets.reload();
      if(rows.some(p=>p.name===args.name) && args.confirm!==true)return fail('confirmation_required','覆盖预设需要确认');
      return window.nmoDesktop.savePreset({name:args.name,data:NMO_Presets.collect()});
    },
    renamePreset:args=>window.nmoDesktop.renamePreset(args),
    deletePreset:args=>window.nmoDesktop.deletePreset(args.name),
		version: '1.1',
		status: status,
		categories: categories,
		preview: preview,
		openImage: openImage,
		setCategory: setCategory,
		exportTo: exportTo
	};
})();
