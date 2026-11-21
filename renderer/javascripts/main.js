/*
 * Author: Christian Petry
 * Homepage: www.petry-christian.de
 *
 * License: MIT
 * Copyright (c) 2014 Christian Petry
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software 
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute, 
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is 
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or 
 * substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, 
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, 
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, 
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR 
 * OTHER DEALINGS IN THE SOFTWARE.
 */

//console.log("Warnings are disabled!");
//console.warn = function() {};

NMO_FileDrop.initHeightMap();
NMO_RenderView.initRenderer();

var NMO_Main = new function(){
	this.TextureEnum = {
	    NORMAL : 0,
	    DISPLACEMENT : 1,
	    AMBIENT : 2,
	    SPECULAR : 3,
	    ROUGHNESS : 4,
	    METALLIC : 5
	}

	this.auto_update = true;
	this.current_texture = this.TextureEnum.NORMAL;
	this.normal_map_mode = "height";
	this.download_btn = document.getElementById('download');
	this.download_all_btn = document.getElementById('download_all');

	/*
	 * 当前源图的身份与分类。只有通过分类弹窗导入的图才有值：
	 * 有值时导出走“种类_序号_属性”的受控命名，没有值时（例如启动自带的
	 * 示例高度图）保留原来的自定义文件名输入框。
	 */
	this.sourceContext = null;

	this.PROPERTY_BY_TYPE = {
		NormalMap: 'Normal',
		DisplacementMap: 'Height',
		AmbientOcclusionMap: 'AO',
		SpecularMap: 'Specular',
		RoughnessMap: 'Roughness',
		MetallicMap: 'Metallic',
		ORM: 'ORM'
	};

	this.setSourceContext = function(context){
		this.sourceContext = context || null;
		this.updateNamingPreview();
    const input = document.getElementById('file_name');
    if (input && context) input.value = context.sourceName;
  };
  this.updateNamingPreview = function(){};
	this.currentTypeName = function(){
		if (this.current_texture === this.TextureEnum.NORMAL) return 'NormalMap';
		if (this.current_texture === this.TextureEnum.DISPLACEMENT) return 'DisplacementMap';
		if (this.current_texture === this.TextureEnum.AMBIENT) return 'AmbientOcclusionMap';
		if (this.current_texture === this.TextureEnum.SPECULAR) return 'SpecularMap';
		if (this.current_texture === this.TextureEnum.ROUGHNESS) return 'RoughnessMap';
		if (this.current_texture === this.TextureEnum.METALLIC) return 'MetallicMap';
		return 'NormalMap';
	};


	this.activate_height_tab = function(type){
		this.normal_map_mode = type;
		if (type == "height"){
			document.getElementById('tab_btn_heightmap').disabled = true;
			document.getElementById('tab_btn_pictures').disabled = false;
			$('#pictures_map').hide("slide", {direction: "right"}, 400, function() {
				NMO_RenderNormalview.reinitializeShader("height");
				NMO_RenderNormalview.renderNormalview_update("height");
				NMO_NormalMap.createNormalMap();
				NMO_Main.setTexturePreview(NMO_NormalMap.normal_canvas, "normal_img", NMO_NormalMap.normal_canvas.width, NMO_NormalMap.normal_canvas.height);
				NMO_DisplacementMap.createDisplacementMap();
				NMO_AmbientOccMap.createAmbientOcclusionTexture();
				NMO_SpecularMap.createSpecularTexture();
				$('#height_map').show("slide", {direction: "left"}, 400);
			});
		}
		else if (type == "pictures"){
			document.getElementById('tab_btn_pictures').disabled = true;
			document.getElementById('tab_btn_heightmap').disabled = false;
			$('#height_map').hide("slide", {direction: "left"}, 400, function() {
				NMO_RenderNormalview.reinitializeShader("pictures");
				NMO_RenderNormalview.renderNormalview_update("pictures");
				NMO_NormalMap.createNormalMap();
				NMO_Main.setTexturePreview(NMO_NormalMap.normal_canvas, "normal_img", NMO_NormalMap.normal_canvas.width, NMO_NormalMap.normal_canvas.height);
				NMO_RenderNormalview.renderNormalToHeight(); // when the last one was loaded
				NMO_DisplacementMap.createDisplacementMap();
				NMO_AmbientOccMap.createAmbientOcclusionTexture();
				NMO_SpecularMap.createSpecularTexture();
				$('#pictures_map').show("slide", {direction: "right"}, 400);
			});
		}
	}

	/*
	 * 六类贴图共用同一套切换逻辑：显示自己的预览画布与参数表，
	 * 其余隐藏；被选中的选项卡置灰。
	 *
	 * 1.1.1 之前是四段手写 if，加粗糙度/金属度时漏一个 id 就会留下
	 * 上一类的参数表，所以改成表驱动。
	 */
	this.TEXTURE_VIEWS = {
		normal:     { map: 'normal_map',       settings: 'normal_settings',       tab: 'tab_btn_normal',     placeholder: 'NormalMap',            key: 'NORMAL' },
		displace:   { map: 'displacement_map', settings: 'displacement_settings', tab: 'tab_btn_displace',   placeholder: 'DisplacementMap',      key: 'DISPLACEMENT' },
		ao:         { map: 'ao_map',           settings: 'ao_settings',           tab: 'tab_btn_ao',         placeholder: 'AmbientOcclusionMap',  key: 'AMBIENT' },
		specular:   { map: 'specular_map',     settings: 'specular_settings',     tab: 'tab_btn_specular',   placeholder: 'SpecularMap',          key: 'SPECULAR' },
		roughness:  { map: 'roughness_map',    settings: 'roughness_settings',    tab: 'tab_btn_roughness',  placeholder: 'RoughnessMap',         key: 'ROUGHNESS' },
		metallic:   { map: 'metallic_map',     settings: 'metallic_settings',     tab: 'tab_btn_metallic',   placeholder: 'MetallicMap',          key: 'METALLIC' }
	};

	this.activate_texture = function(type){
		if (!this.TEXTURE_VIEWS[type])
			type = 'normal';

		var self = this;
		Object.keys(this.TEXTURE_VIEWS).forEach(function(name){
			var view = self.TEXTURE_VIEWS[name];
			var active = (name === type);
			var map = document.getElementById(view.map);
			var settings = document.getElementById(view.settings);
			var tab = document.getElementById(view.tab);
			// 与旧实现保持一致：显示时把内联样式清空，隐藏时写死 display:none。
			if (map) map.style.cssText = active ? "" : "display: none;";
			if (settings) settings.style.cssText = active ? "" : "display: none;";
			if (tab) tab.disabled = active;
		});

		var view = this.TEXTURE_VIEWS[type];
		document.getElementById('file_name').placeholder = view.placeholder;
		this.current_texture = this.TextureEnum[view.key];
		this.updateNamingPreview();

		/*
		 * 1.1.14：粗糙度/金属度只有在 PBR 这条渲染路径里才影响 3D 预览
		 * （老的 phong 着色器不看这两张图）。所以切到这两栏时自动打开
		 * “PBR 预览”，否则用户会以为改了参数右边却没反应。
		 * 用户自己把它关掉后不再强行打开——只在开关是关的时候补一次。
		 */
		if ((type === 'roughness' || type === 'metallic') &&
			window.NMO_PBRPreview && !NMO_PBRPreview.isEnabled()) {
			NMO_PBRPreview.setEnabled(true);
			NMO_Desktop.status('已自动打开 PBR 预览：粗糙度/金属度只有在 PBR 渲染下才影响 3D 预览。', 'info');
		}
	}

	this.setTexturePreview = function(canvas, img_id, width, height){
		var img = document.getElementById(img_id);

		//canvas.width = width;
		//canvas.height = height;

		//console.log(img_id + ": " + width);		

		img.getContext('2d').clearRect ( 0 , 0 , img.width, img.height );

			
		var ratio = width / height;
		var draw_width = ratio >= 1 ? NMO_FileDrop.container_height : (NMO_FileDrop.container_height * ratio );
		var draw_height = ratio >= 1 ? (NMO_FileDrop.container_height / ratio ) : NMO_FileDrop.container_height;
		
		var reduce_canvas = document.createElement('canvas');
		var helper_canvas = document.createElement('canvas');
		helper_canvas.width = width;
		helper_canvas.height = height;
		reduce_canvas.width = width;
		reduce_canvas.height = height;

		var current_width = width;
		var current_height = height;
		var reduce_context = reduce_canvas.getContext('2d');
		var helper_context = helper_canvas.getContext('2d');
		reduce_context.clearRect(0,0,reduce_context.width, reduce_context.height);
		reduce_context.drawImage(canvas, 0, 0, width, height);
		helper_context.clearRect(0,0,helper_canvas.width, helper_canvas.height);
		helper_context.drawImage(canvas, 0, 0, width, height);
		while(2*draw_width < current_width && 2*draw_height < current_height ){
			//console.log("redraw!");
			helper_context.clearRect(0, 0, helper_canvas.width, helper_canvas.height);
			helper_context.drawImage(reduce_canvas, 0, 0, reduce_canvas.width, reduce_canvas.height);
			reduce_context.clearRect(0, 0, reduce_canvas.width, reduce_canvas.height);
			reduce_context.drawImage(helper_canvas, 0, 0, reduce_canvas.width * 0.5, reduce_canvas.height * 0.5);
			current_width *= 0.5;
			current_height *= 0.5;
		}

		//console.log(draw_width + ", " + draw_height)
		img.height = draw_height;
		img.width = draw_width;
		img.getContext('2d').drawImage(reduce_canvas, 0, 0, current_width, current_height, 0,0, draw_width, draw_height);
		
		if (canvas == NMO_NormalMap.normal_canvas)
			NMO_RenderView.normal_map.needsUpdate = true;
		else if (canvas == NMO_DisplacementMap.displacement_canvas)
			NMO_RenderView.displacement_map.needsUpdate = true;
		else if (canvas == NMO_AmbientOccMap.ao_canvas)
			NMO_RenderView.ao_map.needsUpdate = true;
		else if (canvas == NMO_SpecularMap.specular_canvas)
			NMO_RenderView.specular_map.needsUpdate = true;
		
	}

	this.toggle_height_column = function(){

		if ($("#column_height").is(":visible") == true) {
			$("#column_btn_left_div").html("<<");
			$("#column_height").hide("slide", {direction: "right"}, 400);
				/*$(".column").each(function () {
	    		$(this).css("width", "438px");
				});
				$(".preview_img").each(function () {
		    		$(this).css("max-width", "400px");
		    		$(this).css("max-height", "400px");
				});
				$(".view").each(function () {
		    		$(this).css("max-width", "400px");
		    		$(this).css("max-height", "400px");
				});
				$(".helper").each(function () {
		    		$(this).css("max-width", "400px");
		    		$(this).css("max-height", "400px");
				});
				container_height = 400;
				updateCurrentTexture();
				renderer.setSize( 400, 400 );*/
		}
		else{
			$("#column_btn_left_div").html(">>");			
			$("#column_height").show("slide", {direction: "right"}, 400);
		}
	}

	this.toggle_preview_column = function(){

		if ($("#preview").is(":visible") == true) {
			$("#column_btn_right_div").html(">>");
			$("#preview").hide("slide", {direction: "left"}, 400);				
		}
		else{
			$("#column_btn_right_div").html("<<");
			$("#preview").show("slide", {direction: "left"}, 400);
		}
	}

	this.getImageType = function(){
		var select_file_type = document.getElementById('file_type');
		var file_type = select_file_type.options[select_file_type.selectedIndex].value;
		return file_type;
	};

	this.switchJPGQual = function(){
		if (this.getImageType() != 'jpg'){
			document.getElementById('file_jpg_qual').style.cssText = "display: none;";
			document.getElementById('total_transparency').style.cssText = "font-size:11px;";
		}
		else{
			document.getElementById('total_transparency').style.cssText = "display: none;";	
			document.getElementById('file_jpg_qual').style.cssText = "font-size:11px;";
		}
	};


	this.toggleAutoUpdate = function(){
		this.auto_update = !this.auto_update;
		
		if (this.auto_update)
			NMO_NormalMap.createNormalMap();
			NMO_DisplacementMap.createDisplacementMap();
			NMO_AmbientOccMap.createAmbientOcclusionTexture();
			NMO_SpecularMap.createSpecularTexture();
	};

	this.updateCurrentTexture = function(){
		if (this.current_texture == TextureEnum.NORMAL)
			NMO_NormalMap.createNormalMap();
		else if (this.current_texture == TextureEnum.DISPLACEMENT)
			NMO_DisplacementMap.createDisplacementMap();
		else if (this.current_texture == TextureEnum.AMBIENT)
			NMO_AmbientOccMap.createAmbientOcclusionTexture();
		else if (this.current_texture == TextureEnum.SPECULAR)
			NMO_SpecularMap.createSpecularTexture();
	};

	/* ------------------------------------------------------------------
	 * Desktop export path.
	 *
	 * Upstream behaviour replaced here (reason in docs/MODIFYING.md):
	 *   - "All" called downloadImage() four times with the same #file_name,
	 *     which relied on the browser renaming collisions.
	 *   - every save went through FileSaver's saveAs(), i.e. a browser download
	 *     with no folder choice and no error report.
	 *
	 * The canvas work below (size, alpha for PNG, JPEG quality) is the original
	 * code, unchanged. Only the destination changed: bytes are handed to
	 * NMO_Desktop, which shows the native dialog and writes the file.
	 * ------------------------------------------------------------------ */

	this.getDownloadFileName = function(type){
		var file_name = "download";
		if (type == "NormalMap")
			file_name = "NormalMap";
		else if (type == "DisplacementMap")
			file_name = "DisplacementMap";
		else if (type == "AmbientOcclusionMap")
			file_name = "AmbientOcclusionMap";
		else if (type == "SpecularMap")
			file_name = "SpecularMap";
		else if (type == "RoughnessMap")
			file_name = "RoughnessMap";
		else if (type == "MetallicMap")
			file_name = "MetallicMap";

		var typed = document.getElementById('file_name').value;
		if (typed != "")
			file_name = typed;
		return file_name;
	};

	/* Renders one map canvas into encoded bytes. Returns
	 * {name, type, data:Uint8Array} ready for the desktop bridge. */
	this.buildImageRecord = function(type, file_name){
		return new Promise(function(resolve, reject){
			var canvas = document.createElement("canvas");
			var source = null;

			if (type == "NormalMap")
				source = NMO_NormalMap.normal_canvas;
			else if (type == "DisplacementMap")
				source = NMO_DisplacementMap.displacement_canvas;
			else if (type == "AmbientOcclusionMap")
				source = NMO_AmbientOccMap.ao_canvas;
			else if (type == "SpecularMap")
				source = NMO_SpecularMap.specular_canvas;
			else if (type == "RoughnessMap")
				source = window.NMO_RoughnessMap ? NMO_RoughnessMap.roughness_canvas : null;
			else if (type == "MetallicMap")
				source = window.NMO_MetallicMap ? NMO_MetallicMap.metallic_canvas : null;
			else if (type == "ORM")
				source = window.NMO_ORM ? NMO_ORM.orm_canvas : null;

			// ORM 必须是真正的 RGB PNG（不带 Alpha），用专用编码器，不走 toBlob。
			if (type == "ORM"){
				if (!window.NMO_ORM || !NMO_ORM.isReady()){
					reject(new Error(NMO_ORM ? NMO_ORM.reason() : "ORM 模块不可用。"));
					return;
				}
				NMO_ORM.encodeRgb().then(function(data){
					resolve({ name: file_name, type: "png", data: data });
				}).catch(reject);
				return;
			}

			if (!source || !source.width || !source.height){
				reject(new Error("No " + type + " has been generated yet."));
				return;
			}

			canvas.width = source.width;
			canvas.height = source.height;
			var context = canvas.getContext('2d');
			var file_type = NMO_Main.getImageType();
			if (file_type == "png")
				context.globalAlpha = $('#transparency_nmb').val() / 100;
			context.drawImage(source, 0, 0);

			var qual = $('#file_jpg_qual_nmb').val() / 100;

			if (file_type == "tiff"){
				CanvasToTIFF.toBlob(canvas, function(blob){
					if (!blob){ reject(new Error("TIFF encoding failed.")); return; }
					blob.arrayBuffer().then(function(buf){
						resolve({ name: file_name, type: "tif", data: new Uint8Array(buf) });
					});
				});
				return;
			}

			var image_type = "image/png";
			if (file_type == "jpg")
				image_type = "image/jpeg";

			canvas.toBlob(function(blob){
				if (!blob){ reject(new Error("Image encoding failed.")); return; }
				blob.arrayBuffer().then(function(buf){
					resolve({ name: file_name, type: file_type == "jpg" ? "jpg" : "png", data: new Uint8Array(buf) });
				});
			}, image_type, qual);
		});
	};

	/* Kept for API compatibility: saves the current map through one dialog. */
  this.downloadImage = function(type) {
    return this.openExportPlan([{recordType:type,property:this.PROPERTY_BY_TYPE[type]}]);
  };
	this.exportPlanned = function(options){
		return NMO_Desktop.planExport({
			label: options.label,
			suggestedName: options.suggestedName,
			items: options.items,
			dir: options.dir
		}).then(function(prepared){
			if (!prepared || prepared.canceled) return { ok: false, canceled: true };
			if (prepared.error) return { ok: false, error: prepared.error };

			var failures = [];
			var stopped = false;
			var total = options.tasks.length;

			function step(i){
				if (i >= total) return Promise.resolve();
				if (options.shouldStop && options.shouldStop()) {
					stopped = true;
					return Promise.resolve();
				}
				var task = options.tasks[i];
				NMO_Desktop.status(options.label + ' … ' + (i + 1) + '/' + total, 'info', true);
				return Promise.resolve()
					.then(function(){ return task.produce(); })
					.then(function(record){
						if (!record) throw new Error('页面没有返回图像数据。');
						return NMO_Desktop.writePlanFile(prepared.token, {
							sourceKey: task.sourceKey,
							category: task.category,
							property: task.property,
							type: record.type,
							data: record.data,
							conflict: options.conflict || 'keep'
						});
					})
					.then(function(result){
						if (!result || !result.ok){
							failures.push({ name: task.name, error: (result && result.error) || '写入失败' });
						}
					})
					.catch(function(err){
						failures.push({ name: task.name, error: (err && err.message) || String(err) });
					})
					.then(function(){ return step(i + 1); });
			}

			return step(0).then(function(){
				return NMO_Desktop.finishPlan(prepared.token, 'finish');
			}).then(function(summary){
				var report = NMO_Desktop.reportPlan(summary, options.label, failures);
				report.stopped = stopped;
				if (stopped) report.done = Math.max(0, total - (report.failed || 0));
				return report;
			});
		});
	};

	/*
	 * 导出清单：把源图、类别、编号、属性、文件名、数量先摆出来，
	 * 用户确认目录后才由主进程预留编号并写盘。
	 */
  this.openExportPlan = async function(picked) {
    const ctx = this.sourceContext || {sourceKey:'sample',sourceName:'NormalMap'};
    const types = this.expandOutputs(picked || NMO_FileDrop.getSelectedTypes());
    if (!types.length) return NMO_Desktop.status('请选择贴图用途。','error');
    const plan = await NMO_ExportPlan.open({items:[{...ctx,baseName:document.getElementById('file_name').value || ctx.sourceName}],types});
    if (!plan.confirmed) return {canceled:true};
    return this.exportPlanned({label:'导出',dir:plan.dir,items:plan.items,tasks:types.map(t=>({
      sourceKey:ctx.sourceKey,property:t.property,name:t.property,produce:()=>this.buildImageRecord(t.recordType,'map')
    }))});
  };
  this.downloadAllImages = function(){return this.openExportPlan();};
	/*
	 * 勾选 → 实际输出。ORM 开启时用一张 ORM 替代 AO/Roughness/Metallic 三张，
	 * 其它属性照常独立输出（阶段 D 接入；未启用时原样返回）。
	 */
	this.expandOutputs = function(selection){
		var ormOn = window.NMO_ORM && NMO_ORM.isEnabled && NMO_ORM.isEnabled();
		if (!ormOn) return selection;
		var replaced = ['AO', 'Roughness', 'Metallic'];
		var hasAll = replaced.every(function(p){
			return selection.some(function(s){ return s.property === p; });
		});
		if (!hasAll) return selection;
		var out = selection.filter(function(s){ return replaced.indexOf(s.property) === -1; });
		out.push({ recordType: 'ORM', property: 'ORM' });
		return out;
	};

	this.download_all_btn.addEventListener('click', function (e) {
		e.preventDefault();
		NMO_Main.downloadAllImages();
	});

	var planBtn = document.getElementById('export_plan_btn');
	if (planBtn) {
		planBtn.addEventListener('click', function (e) {
			e.preventDefault();
			NMO_Main.openExportPlan();
		});
	}

	this.download_btn.addEventListener('click', function (e) {
		e.preventDefault();
		// 当前贴图类型由 activate_texture 维护，比逐个数 cssText 稳。
		NMO_Main.downloadImage(NMO_Main.currentTypeName());
	});

	/* 共用的“恢复默认”按钮：按当前选中的贴图类型转给对应的恢复函数。 */
	this.resetCurrentSettings = function(){
		if (this.current_texture === this.TextureEnum.NORMAL) return this.resetNormalMapSettings();
		if (this.current_texture === this.TextureEnum.DISPLACEMENT) return this.resetDisplacementMapSettings();
		if (this.current_texture === this.TextureEnum.AMBIENT) return this.resetAmbientOccMapSettings();
		if (this.current_texture === this.TextureEnum.SPECULAR) return this.resetSpecularMapSettings();
		if (this.current_texture === this.TextureEnum.ROUGHNESS) return this.resetRoughnessSettings();
		if (this.current_texture === this.TextureEnum.METALLIC) {
			NMO_Desktop.status('金属度由“来源”决定（非金属 / 裸金属 / 导入遮罩），没有单独的默认值可恢复。', 'info');
			return;
		}
	};

	/* 粗糙度恢复默认：连内置遮罩预设一起清掉，回到“统一数值 0.50”。 */
	this.resetRoughnessSettings = function(){
		NMO_RoughnessMap.setSettings({
			mode: 'uniform',
			value: 0.5,
			base: 0.5,
			strength: 0,
			detail: 'gray',
			invert: false,
			min: 0,
			max: 1,
			importInvert: false,
			blur: 0,
			contrast: 0
		});
		if (NMO_RoughnessMap.setPreset) NMO_RoughnessMap.setPreset(null);

		var set = function(id, value) {
			var el = document.getElementById(id);
			if (el) el.value = value;
		};
		set('rough_mode', 'uniform');
		set('rough_value', 0.5);
		set('rough_value_nmb', '0.50');
		set('rough_strength', 0);
		set('rough_strength_nmb', '0.00');
		set('rough_detail', 'gray');
		set('rough_min', 0);
		set('rough_min_nmb', '0.00');
		set('rough_max', 1);
		set('rough_max_nmb', '1.00');
		set('rough_preset', '');
		var invert = document.getElementById('rough_invert');
		if (invert) invert.checked = false;

		if (window.NMO_PBRUI && NMO_PBRUI.refreshAll) NMO_PBRUI.refreshAll();
		NMO_Desktop.status('粗糙度已恢复默认：统一数值 0.50，遮罩预设已清除。', 'ok');
	};

	this.resetNormalMapSettings = function() {
		var initialStrength = NMO_NormalMap.getInitialStrength(); 
		var initialLevel = NMO_NormalMap.getInitialLevel();
		var initialSmoothing = NMO_NormalMap.getInitialSmoothing();
		var initialNormalType = NMO_NormalMap.getInitialNormalType();
		var initialInvertRGS = NMO_NormalMap.getInitialInvertRGS();
		var initialHeightOffset = NMO_NormalMap.getInitialHeightOffset();

		document.getElementById('strength_slider').value = initialStrength;
		document.getElementById('strength_nmb').value = initialStrength;
		document.getElementById('level_slider').value = initialLevel;
		document.getElementById('level_nmb').value = initialLevel;
		document.getElementById('blur_sharp_slider').value = initialSmoothing;
		document.getElementById('blur_sharp_nmb').value = initialSmoothing;
		document.getElementById("normal_type").selectedIndex = 0;
		document.getElementById('invert_r').checked = initialInvertRGS;
		document.getElementById('invert_g').checked = initialInvertRGS;
		document.getElementById('invert_height').checked = initialInvertRGS;
		document.getElementById('height_offset').checked = initialHeightOffset;
	
		NMO_NormalMap.setNormalSetting('strength', initialStrength);
		NMO_NormalMap.setNormalSetting('level', initialLevel);
		NMO_NormalMap.setNormalSetting('blur_sharp', initialSmoothing);
		NMO_NormalMap.setNormalSetting('type', initialNormalType);

		if (NMO_NormalMap.invert_red != initialInvertRGS) NMO_NormalMap.invertRed();
		if (NMO_NormalMap.invert_green != initialInvertRGS) NMO_NormalMap.invertGreen();
		if (NMO_NormalMap.invert_source != initialInvertRGS) NMO_NormalMap.invertSource();
		if (NMO_NormalMap.height_offset != initialHeightOffset) NMO_NormalMap.heightOffset();
	};
	
	this.resetDisplacementMapSettings = function() {
		var initialContrast = NMO_DisplacementMap.getInitialContrast();
		var initialSmoothing = NMO_DisplacementMap.getInitialSmoothing();
		var initialInvertDisplacement = NMO_DisplacementMap.getInitialInvertDisplacement();

		document.getElementById('dm_contrast_slider').value = initialContrast;
		document.getElementById('dm_contrast_nmb').value = initialContrast;
		document.getElementById('dm_blur_sharp_slider').value = initialSmoothing;
		document.getElementById('dm_blur_sharp_nmb').value = initialSmoothing;

		NMO_DisplacementMap.setDisplacementSetting('contrast', initialContrast);
		NMO_DisplacementMap.setDisplacementSetting('blur_sharp', initialSmoothing);

		/*
		 * 反相勾选框是置换面板自己的（id=invert_displacement），不能借用
		 * 法线面板的 invert_height —— 那会把法线面板勾选框一起改掉。
		 * 先按实际状态翻转，再把勾选框写成目标值，避免“勾选框和渲染状态不一致”。
		 */
		if (NMO_DisplacementMap.invert_displacement != initialInvertDisplacement){
			NMO_DisplacementMap.invertDisplacement();
		}
		document.getElementById('invert_displacement').checked = initialInvertDisplacement;
	};
	
	this.resetAmbientOccMapSettings = function() {
		var initialStrength = NMO_AmbientOccMap.getInitialStrength();
		var initialMean = NMO_AmbientOccMap.getInitialMean();
		var initialRange = NMO_AmbientOccMap.getInitialRange();
		var initialSmoothing = NMO_AmbientOccMap.getInitialSmoothing();
		var initialInvertAO = NMO_AmbientOccMap.getInitialInvertAO();

		document.getElementById('ao_strength_slider').value = initialStrength;
		document.getElementById('ao_strength_nmb').value = initialStrength;
		document.getElementById('ao_mean_slider').value = initialMean;
		document.getElementById('ao_mean_nmb').value = initialMean;
		document.getElementById('ao_range_slider').value = initialRange;
		document.getElementById('ao_range_nmb').value = initialRange;
		document.getElementById('ao_blur_sharp_slider').value = initialSmoothing;
		document.getElementById('ao_blur_sharp_nmb').value = initialSmoothing;
		document.getElementById('invert_AO').checked = initialInvertAO;
	
		NMO_AmbientOccMap.setAOSetting('strength', initialStrength);
		NMO_AmbientOccMap.setAOSetting('mean', initialMean);
		NMO_AmbientOccMap.setAOSetting('range', initialRange);
		NMO_AmbientOccMap.setAOSetting('blur_sharp', initialSmoothing);

		if (NMO_AmbientOccMap.invert_ao != initialInvertAO){
			NMO_AmbientOccMap.invertAO();
		}
	};
	
	this.resetSpecularMapSettings = function() {
		var initialStrength = NMO_SpecularMap.getInitialStrength();
		var initialMean = NMO_SpecularMap.getInitialMean();
		var initialRange = NMO_SpecularMap.getInitialRange();
		var initialFallOffType = NMO_SpecularMap.getInitialFallOffType();

		document.getElementById('specular_strength_slider').value = initialStrength;
		document.getElementById('specular_strength_nmb').value = initialStrength;
		document.getElementById('specular_mean_slider').value = initialMean;
		document.getElementById('specular_mean_nmb').value = initialMean;
		document.getElementById('specular_range_slider').value = initialRange;
		document.getElementById('specular_range_nmb').value = initialRange;
		document.getElementById("falloff_type").selectedIndex = 1;
	
		NMO_SpecularMap.setSpecularSetting('spec_strength', initialStrength);
		NMO_SpecularMap.setSpecularSetting('spec_mean', initialMean);
		NMO_SpecularMap.setSpecularSetting('spec_range', initialRange);
		NMO_SpecularMap.setSpecularSetting('spec_falloff', initialFallOffType);
	};
}