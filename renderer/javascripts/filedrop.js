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

NMO_FileDrop = new function(){
	window.addEventListener("dragover",function(e){
	  e = e || event;
	  e.preventDefault();
	},false);
	window.addEventListener("drop",function(e){
	  e = e || event;
	  e.preventDefault();
	},false);
	
	this.height_canvas = document.getElementById("height_canvas");
	this.height_image;
	this.picture_above, this.picture_left, this.picture_right, this.picture_below;
	this.container_height = 276; // 1.1.15：在 1.1.14 的 273 上再放大 3px
	/* 每次成功载入一张源图就 +1：辅助贴图靠它判断“是不是上一张的数据”。 */
	this.sourceRevision = 0;

	/* 批量的运行时状态：停止标记与可重试的失败项。 */
	this.batchState = {
		running: false,
		stopRequested: false,
		failures: [],
		lastDir: null,
		lastTypes: null
	};


	this.handleDragOver = function(evt) {
		evt.stopPropagation();
		evt.preventDefault();
		evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
	};


	// Setup the dnd listeners.
	this.handleFileSelect = async function(evt) {
		if (typeof evt == 'undefined')
			return;
		
		console.log(evt.target.param);
		if (evt.target.param === 'height')
			await NMO_FileDrop.importSingleHeight(evt.target.files[0]);
		else if (evt.target.param === 'multiple_height')
			await NMO_FileDrop.processBatchFiles(evt.target.files)
	    else
	    	await NMO_FileDrop.readImage(evt.target.files[0], "pictures", evt.target.param); // files is a FileList of File objects. List some properties.
		// Allow selecting the same file again without a page reload.
		evt.target.value = "";
	};

	/*
	 * 分类入口：单图、批量、拖放都走同一个弹窗。
	 * 取消时返回 null，调用方不得生成任何文件。
	 */
	this.classifyFiles = async function(files, initialCategories) {
    const preset = document.getElementById('preset_select').value;
    return {sessionId:crypto.randomUUID(),items:Array.from(files,(file,id)=>({file,id,displayName:file.name.replace(/\.[^.]+$/,''),category:preset}))};
  };

	/** 单图：先分类，再载入主界面，并记住本次会话的源身份。 */
	this.importSingleHeight = async function(file) {
		if (!file) return false;
		if (!NMO_FileDrop.isSupportedImage(file)) {
			NMO_Desktop.status('已跳过“' + file.name + '”：不是受支持的图片。', 'error');
			return false;
		}
		var session = await NMO_FileDrop.classifyFiles([file]);
		if (!session) {
			NMO_Desktop.status('已取消分类，未改变当前图片。', 'info');
			return false;
		}
		var item = session.items[0];
		var loaded = await NMO_FileDrop.readImage(item.file, 'height', '');
		if (loaded !== false) {
			NMO_Main.setSourceContext({
				sourceKey: session.sessionId + ':' + item.id,
				sourceName: item.displayName,
				category: item.category,
				mode: 'new',
				file: item.file
			});
		}
		return loaded;
	};

	/* “返回分类”：用同一批文件重新打开弹窗，并保留已选标签。 */
	this.reclassify = async function(files, categories) {
		var session = await NMO_FileDrop.classifyFiles(files, categories);
		if (!session) return null;
		var item = session.items[0];
		NMO_Main.setSourceContext({
			sourceKey: session.sessionId + ':' + item.id,
			sourceName: item.displayName,
			category: item.category,
			mode: 'new',
			file: item.file
		});
		return session;
	};

	/*
	 * 贴图输出选择区：批量与“全部”共用同一份勾选。
	 * 属性名进文件名（Normal/Height/AO/…），recordType 是画布来源。
	 */
	this.getSelectedTypes = function() {
		var map = [
			['normal_tick', 'NormalMap', 'Normal'],
			['displacement_tick', 'DisplacementMap', 'Height'],
			['ambient_tick', 'AmbientOcclusionMap', 'AO'],
			['specular_tick', 'SpecularMap', 'Specular'],
			['roughness_tick', 'RoughnessMap', 'Roughness'],
			['metallic_tick', 'MetallicMap', 'Metallic']
		];
		var out = [];
		map.forEach(function(row) {
			var input = document.getElementById(row[0]);
			if (input && input.checked) out.push({ recordType: row[1], property: row[2] });
		});
		return out;
	};

	/*
	 * Desktop batch mode.
	 *
	 * 顺序：选择文件 → 逐张分类 → （确定后）选目录 → 主进程序列化预留编号
	 * → 逐张生成并按 种类_序号_属性 写入。
	 * 取消分类不写盘、不占号；解码失败只影响当前这张，成功后继续下一张。
	 */
	this.processBatchFiles = async function(files) {
		var list = Array.prototype.slice.call(files || []);
		if (list.length === 0)
			return;

		var types = this.getSelectedTypes();
		if (types.length === 0) {
			NMO_Desktop.status('批量模式：请先勾选至少一种贴图类型。', 'error');
			return;
		}

		var usable = [];
		var skipped = [];
		for (var i = 0; i < list.length; i++) {
			if (NMO_FileDrop.isSupportedImage(list[i]))
				usable.push(list[i]);
			else
				skipped.push(list[i].name);
		}

		if (usable.length === 0) {
			NMO_Desktop.status('批量模式：所选文件里没有受支持的图片。\n' + skipped.join('、'), 'error');
			return;
		}

		var session = await NMO_FileDrop.classifyFiles(usable);
		if (!session) {
			NMO_Desktop.status('已取消分类，未生成任何文件。', 'info');
			return;
		}

		var items = session.items;
		var plan = null;
		// 分类 → 清单 → （可返回分类）→ 开始导出
		while (!plan) {
			var candidate = await NMO_ExportPlan.open({
				label: '批量导出',
				items: items.map(function(item) {
					return {
						sourceKey: session.sessionId + ':' + item.id,
						sourceName: item.displayName,
						category: item.category,
						mode: 'new'
					};
				}),
				types: NMO_Main.expandOutputs(NMO_FileDrop.getSelectedTypes())
			});
			if (candidate && candidate.confirmed) {
				plan = candidate;
				break;
			}
			if (candidate && candidate.reclassify) {
				var again = await NMO_FileDrop.classifyFiles(
					items.map(function(item) {
						return item.file;
					}),
					items.map(function(item) {
						return item.category;
					})
				);
				if (!again) {
					NMO_Desktop.status('已取消分类，未生成任何文件。', 'info');
					return;
				}
				session = again;
				items = again.items;
				continue;
			}
			return; // 清单里取消：不写盘、不占号
		}

		var prepared = await NMO_Desktop.planExport({
			label: '批量导出',
			suggestedName: 'NormalMap_batch',
			dir: plan.dir,
			items: plan.items
		});
		if (!prepared || prepared.canceled) return;
		if (prepared.error) {
			NMO_Desktop.status('批量导出无法开始：' + prepared.error, 'error');
			return;
		}

		var outputs = plan.types;
		var failures = [];
		var state = NMO_FileDrop.batchState;
		state.running = true;
		state.stopRequested = false;
		state.failures = [];
		state.lastDir = plan.dir;
    state.assigned = new Map(prepared.assignments.map(row=>[row.sourceKey,row.baseName]));
    state.presets=new Map(plan.items.map(row=>[row.sourceKey,row.preset]));
		state.lastTypes = outputs;
		NMO_FileDrop.setBatchButtons(true);

		var stopped = false;
		/* 只有“真的产出过东西”的源图才保留号码：
		   —— 写出至少一个文件，或留下失败记录（重试还要用这个号）；
		   —— 停止时连一次生成都没完成的，号码要退回，否则下一批会跳号。 */
		var usedKeys = {};
		for (var f = 0; f < items.length; f++) {
			if (state.stopRequested) {
				stopped = true;
				break;
			}
			var item = items[f];
			var sourceKey = session.sessionId + ':' + item.id;
			NMO_Desktop.status('批量 第 ' + (f + 1) + '/' + items.length + ' 张源图 · ' + item.displayName, 'info', true);

			var loaded = await NMO_FileDrop.readImage(item.file, 'height', '');
			if (loaded === false) {
				// 解码失败：这张源图的每个属性都算失败，不拿上一张的像素冒充。
				usedKeys[sourceKey] = true;
				for (var t2 = 0; t2 < outputs.length; t2++) {
					failures.push({
						name: item.displayName + '/' + outputs[t2].property,
						error: '文件无法解码',
						sourceKey: sourceKey,
						sourceName: item.displayName,
						category: item.category,
						property: outputs[t2].property,
						recordType: outputs[t2].recordType,
						file: item.file
					});
				}
				continue;
			}

			/* 批量里每张图按自己的类别套预设：同类别、手没改过就按新图重估基础值。 */
			if (plan.items[f].preset) await NMO_Presets.use(plan.items[f].preset);

			for (var t = 0; t < outputs.length; t++) {
				if (state.stopRequested) {
					stopped = true;
					break;
				}
				var record;
				try {
					record = await NMO_Main.buildImageRecord(outputs[t].recordType, 'unused');
				} catch (err) {
					usedKeys[sourceKey] = true;
					failures.push({
						name: item.displayName + '/' + outputs[t].property,
						error: (err && err.message) || '生成失败',
						sourceKey: sourceKey,
						sourceName: item.displayName,
						category: item.category,
						property: outputs[t].property,
						recordType: outputs[t].recordType,
						file: item.file
					});
					continue;
				}
				var written = await NMO_Desktop.writePlanFile(prepared.token, {
					sourceKey: sourceKey,
					category: item.category,
					property: outputs[t].property,
					type: record.type,
					data: record.data,
					conflict: 'keep'
				});
				if (!written || !written.ok) {
					usedKeys[sourceKey] = true;
					failures.push({
						name: item.displayName + '/' + outputs[t].property,
						error: (written && written.error) || '写入失败',
						sourceKey: sourceKey,
						sourceName: item.displayName,
						category: item.category,
						property: outputs[t].property,
						recordType: outputs[t].recordType,
						file: item.file
					});
				} else {
					usedKeys[sourceKey] = true;
				}
			}
			if (stopped) break;
		}

		var unstartedKeys = [];
		if (stopped) {
			items.forEach(function(entry) {
				var key = session.sessionId + ':' + entry.id;
				if (!usedKeys[key]) unstartedKeys.push(key);
			});
		}
		var summary = await NMO_Desktop.finishPlan(prepared.token, 'finish', unstartedKeys);
		state.running = false;
		state.failures = failures;
		NMO_FileDrop.setBatchButtons(false);
		var report = NMO_Desktop.reportPlan(
			summary,
			stopped ? '批量导出（已停止）' : '批量导出',
			failures,
			skipped
		);
		// 只有真的失败项才提示重试；用户主动停止不算。
		var retryBtn = document.getElementById('batch_retry');
		if (retryBtn) {
			retryBtn.style.display = failures.length ? 'inline-block' : 'none';
			retryBtn.disabled = failures.length === 0;
			retryBtn.textContent = '重试失败项（' + failures.length + '）';
		}
		return report;
	};

	this.setBatchButtons = function(running) {
		var stop = document.getElementById('batch_stop');
		var retry = document.getElementById('batch_retry');
		if (stop) {
			stop.style.display = running ? 'inline-block' : 'none';
			stop.disabled = !running;
		}
		if (retry && running) retry.style.display = 'none';
	};

	/* 只补失败项：沿用本批 sourceKey（因此沿用已分配编号），不重复生成成功项。 */
	this.retryFailed = async function() {
		var state = NMO_FileDrop.batchState;
		var failures = state.failures.slice();
		if (!failures.length) return { ok: false };

		var bySource = {};
		failures.forEach(function(failure) {
			var key = failure.sourceKey;
			if (!bySource[key]) {
				bySource[key] = {
					sourceKey: key,
					sourceName: failure.sourceName,
					category: failure.category,
					file: failure.file,
					tasks: []
				};
			}
			bySource[key].tasks.push(failure);
		});

		var prepared = await NMO_Desktop.planExport({
			label: '重试失败项',
			suggestedName: 'NormalMap_retry',
			dir: state.lastDir,
			items: Object.keys(bySource).map(function(key) {
				var entry = bySource[key];
				return {
					sourceKey: key,
					sourceName: entry.sourceName,
          resumeBase:state.assigned.get(key),
					category: entry.category,
					mode: 'new'
				};
			})
		});
		if (!prepared || prepared.canceled || prepared.error) return { ok: false };

		var remaining = [];
		var keys = Object.keys(bySource);
		for (var i = 0; i < keys.length; i++) {
			var entry = bySource[keys[i]];
			var loaded = await NMO_FileDrop.readImage(entry.file, 'height', '');
      if(loaded!==false && state.presets.get(entry.sourceKey)) await NMO_Presets.use(state.presets.get(entry.sourceKey));
			if (loaded === false) {
				remaining = remaining.concat(entry.tasks);
				continue;
			}
			for (var t = 0; t < entry.tasks.length; t++) {
				var task = entry.tasks[t];
				var record;
				try {
					record = await NMO_Main.buildImageRecord(task.recordType, 'unused');
				} catch (err) {
					remaining.push(task);
					continue;
				}
				var written = await NMO_Desktop.writePlanFile(prepared.token, {
					sourceKey: entry.sourceKey,
					category: entry.category,
					property: task.property,
					type: record.type,
					data: record.data,
					conflict: 'keep'
				});
				if (!written || !written.ok) remaining.push(task);
			}
		}

		var summary = await NMO_Desktop.finishPlan(prepared.token, 'finish');
		state.failures = remaining;
		var retryBtn = document.getElementById('batch_retry');
		if (retryBtn) {
			retryBtn.style.display = remaining.length ? 'inline-block' : 'none';
			retryBtn.textContent = '重试失败项（' + remaining.length + '）';
		}
		return NMO_Desktop.reportPlan(summary, '重试失败项', remaining, []);
	};

	/* Kept for API compatibility (not wired to any UI control upstream). */
	this.downloadAll = async function(name){
		var base = (name || 'NormalMap').replace(/\.[^/.]+$/, "");
		var types = [["NormalMap", "_normal"], ["DisplacementMap", "_displacement"], ["AmbientOcclusionMap", "_ambient"], ["SpecularMap", "_specular"]];
		return NMO_Desktop.exportMany({
			label: '导出全部',
			baseName: base,
			total: types.length,
			produce: function(index){
				return NMO_Main.buildImageRecord(types[index][0], base + types[index][1]);
			}
		});
	};
	

	this.handleModelFileSelect = function(evt) {
	    var files = evt.target.files; // FileList object
	    NMO_FileDrop.readModelFile(evt.target.files[0]); // files is a FileList of File objects. List some properties.
	}

	this.readModelFile = function(file){
		console.log(file);
		console.log("trying to load model")

		var onProgress = function ( xhr ) {
			if ( xhr.lengthComputable ) {
				var percentComplete = xhr.loaded / xhr.total * 100;
				console.log( Math.round(percentComplete, 2) + '% downloaded' );
			}
		};
		var onError = function ( xhr ) { };

		var reader = new FileReader();
		reader.onload = function(e){
			// model
			//console.log(e.target.result)
			var data = e.target.result;
			var objLoader = new THREE.OBJLoader();
			var object = objLoader.parse( data );
			object.traverse( function ( child ) {
				if ( child instanceof THREE.Mesh ) {
					child.material = NMO_RenderView.render_model.material;
					NMO_RenderView.customModel = child;
					NMO_RenderView.setModel("Custom");
				}
			} );
		}
		reader.readAsText(file);
		
	};


	this.isPowerOf2 = function(x){
		return ((x != 0) && !(x & (x - 1)))
		/*if((val & -val) == val)
			return true;
		else 
			return false;*/
	};

	/*
	 * Windows does not always hand Chromium a MIME type: .tga files usually
	 * arrive with an empty type, which made the upstream type check reject a
	 * format the file dialog advertises. Accept a known extension only when no
	 * MIME type was supplied, so genuinely wrong files are still rejected.
	 */
	this.isSupportedImage = function(file){
		if (!file) return false;
		if (file.type && /^image\//.test(file.type)) return true;
		// Windows frequently reports no type, or application/octet-stream, for
		// .tga/.tif. The extension decides; the decoder still validates bytes.
		return /\.(png|jpe?g|gif|bmp|webp|tga|tif|tiff)$/i.test(file.name || "");
	};

	this.isTargaFile = function(file){
		return file.type === "image/targa" || file.type === "image/x-targa" || file.type === "image/x-tga" ||
			/\.tga$/i.test(file.name || "");
	};



	this.readImage = async function(imgFile, type, direction, readImageCallback=false, name=""){
		//console.log(imgFile);
		if(!NMO_FileDrop.isSupportedImage(imgFile))
		{
			console.log("The dropped file is not a supported image: ", imgFile && imgFile.type, imgFile && imgFile.name);
			NMO_Desktop.status('已跳过“' + (imgFile && imgFile.name) + '”：不是受支持的图片。', 'error');
			return false;
		}
		console.log("Loading " + imgFile.type + " image");

		let isTarga = NMO_FileDrop.isTargaFile(imgFile);

		const data = await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = e => resolve(e.target.result);
			reader.onerror = reject;
			
			if (isTarga)
				reader.readAsArrayBuffer(imgFile);
			else
				reader.readAsDataURL(imgFile);
		});

		let processedData = data;
		if (isTarga) 
		{
			console.log("Loading targa");
			let tga = new TGA();
			tga.load(new Uint8Array(data))
			processedData = tga.getDataURL('image/png');
		}

		let loaded = true;
		if (type === "height")
			loaded = await NMO_FileDrop.loadHeightmap(processedData);
		else if (type === "pictures")
			await NMO_FileDrop.loadHeightFromPictures(processedData, direction);
		
		// Only hand control back to a batch loop when the pixels really arrived:
		// resolving on error would make it export the previous image again.
		if (!loaded) {
			NMO_Desktop.status('无法解码“' + (imgFile.name || '文件') + '”，仍保留上一张图片。', 'error');
			return false;
		}

		if (readImageCallback)
			await readImageCallback(name);

		return true;
	};


	this.loadHeightmap = function(source){
		return new Promise((resolve) => {
			var previous = this.height_image;
			var img = new Image();
			
			img.onload = async function()
			{
				console.log("loading height image");

				// Only publish the new image once it decoded. Upstream assigned
				// it up front, so a corrupt file left a 0x0 Image in place and
				// the next tab switch sized every canvas to 0x0.
				NMO_FileDrop.height_image = img;
							
				NMO_RenderNormalview.renderNormalview_update("height");
				
				NMO_NormalMap.createNormalMap();
				NMO_RenderNormalview.height_map.needsUpdate = true;
				
				NMO_NormalMap.setNormalSetting('strength', document.getElementById('strength_nmb').value);
				NMO_NormalMap.setNormalSetting('level', document.getElementById('level_nmb').value);
				NMO_NormalMap.setNormalSetting('blur_sharp', document.getElementById('blur_sharp_nmb').value);
				
				NMO_DisplacementMap.createDisplacementMap(document.getElementById('dm_contrast_nmb').value);
				NMO_DisplacementMap.setDisplacementScale(-document.getElementById('dm_strength_nmb').value);
				
				NMO_AmbientOccMap.createAmbientOcclusionTexture();
				NMO_SpecularMap.createSpecularTexture();
				NMO_FileDrop.sourceRevision += 1;
				if (window.NMO_PBR) NMO_PBR.refresh();

				resolve(true);
			};
			
			img.onerror = () => {
				NMO_FileDrop.height_image = previous;
				resolve(false);
			};
			img.src = source;
		});
	};


	this.initHeightMap = function(){

		//height_canvas.height = document.getElementById("height_canvas").height;
		this.height_canvas.height = this.container_height;
		this.height_canvas.width = this.container_height;
		
	    this.height_image = new Image();
		this.height_image.onload = function () {
			//height_canvas.height = height_image.naturalWidth;
			//height_canvas.width = height_image.naturalHeight;
			var context = self.height_canvas.getContext('2d');

			context.drawImage(this, 0, 0, this.width, this.height, 
								0,0, self.height_canvas.width, self.height_canvas.height);
			this.width = this.naturalWidth;
			this.height = this.naturalHeight;
			
			document.getElementById("size").value = "" +(this.naturalWidth) + " x " + (this.naturalHeight);
			

			NMO_FileDrop.initHeightFromPictures();
			NMO_RenderNormalview.renderNormalview_init(); // init only when both types of images are loaded (init)
			NMO_AmbientOccMap.initAOshader();
			NMO_DisplacementMap.initDisplacementshader();
			NMO_SpecularMap.initSpecularshader();
			NMO_RenderNormalview.height_map.needsUpdate = true;
				
			NMO_NormalMap.setNormalSetting('strength', document.getElementById('strength_nmb').value, 'initial');
			NMO_NormalMap.setNormalSetting('level', document.getElementById('level_nmb').value, 'initial');
			NMO_NormalMap.setNormalSetting('blur_sharp', document.getElementById('blur_sharp_nmb').value, 'initial');
			NMO_NormalMap.createNormalMap(); // height map was loaded... so create standard normal map!

			
			NMO_DisplacementMap.createDisplacementMap(document.getElementById('dm_contrast_nmb').value);
			NMO_DisplacementMap.setDisplacementScale(-document.getElementById('dm_strength_nmb').value);
			
			NMO_AmbientOccMap.createAmbientOcclusionTexture();
			NMO_SpecularMap.createSpecularTexture();
			NMO_FileDrop.sourceRevision += 1;
			if (window.NMO_PBR) NMO_PBR.refresh();


	    };
		
	    this.height_image.src = './images/standard_height.png';	
	};




	this.loadHeightFromPictures = function(source, direction){
		var pic_canvas_above = document.getElementById("picture_canvas_above");
		var pic_canvas_left = document.getElementById("picture_canvas_left");
		var pic_canvas_right = document.getElementById("picture_canvas_right");
		var pic_canvas_below = document.getElementById("picture_canvas_below");
		var context_above = pic_canvas_above.getContext('2d');
		var context_left = pic_canvas_left.getContext('2d');
		var context_right = pic_canvas_right.getContext('2d');
		var context_below = pic_canvas_below.getContext('2d');
		//console.log("loading picture image");

		/*
		 * Upstream ran the recompute synchronously after assigning img.src, so
		 * the just-assigned photo still had naturalWidth 0. On the first import
		 * that sized every canvas to 0x0 and threw inside drawImage, and the
		 * last import always computed from the previous photo set.
		 * The recompute now runs once the new pixels exist. Same computation,
		 * same inputs, only after the image is decoded.
		 */
		var recompute = function(){
			NMO_RenderNormalview.renderNormalview_update("pictures");
			NMO_NormalMap.createNormalMap();
			NMO_RenderNormalview.renderNormalToHeight();
		};

		if(direction == "above"){
			this.picture_above = new Image();
			this.picture_above.onload = function () {	
				context_above.drawImage(this, 0, 0, this.width, this.height,
										 0,0, pic_canvas_above.width, pic_canvas_above.height);
				this.width = this.naturalWidth;
				this.height = this.naturalHeight;
				recompute();
			};

			this.picture_above.src = source;
		}
	    else if (direction == "left"){
	    	this.picture_left = new Image();
			this.picture_left.onload = function () {	
				context_left.drawImage(this, 0, 0, this.width, this.height,
										0,0, pic_canvas_left.width, pic_canvas_left.height);
				this.width = this.naturalWidth;
				this.height = this.naturalHeight;
				recompute();
		    };
			
		    this.picture_left.src = source;
		}
	    else if (direction == "right"){
		    this.picture_right = new Image();
			this.picture_right.onload = function () {	
				context_right.drawImage(this, 0, 0, this.width, this.height,
										0,0, pic_canvas_right.width, pic_canvas_right.height);
				this.width = this.naturalWidth;
				this.height = this.naturalHeight;
				recompute();
		    };
			
		    this.picture_right.src = source;	
		}
	    else if (direction == "below"){
		    this.picture_below = new Image();
			this.picture_below.onload = function () {	
				context_below.drawImage(this, 0, 0, this.width, this.height,
										0,0, pic_canvas_below.width, pic_canvas_below.height);
				this.width = this.naturalWidth;
				this.height = this.naturalHeight;
				recompute();
		    };
			
		    this.picture_below.src = source;
		}
	};



	// gets called inside initHeightMap!
	this.initHeightFromPictures = function(){
		
		var pic_canvas_above = document.getElementById("picture_canvas_above");
		var pic_canvas_left = document.getElementById("picture_canvas_left");
		var pic_canvas_right = document.getElementById("picture_canvas_right");
		var pic_canvas_below = document.getElementById("picture_canvas_below");
		var context_above = pic_canvas_above.getContext('2d');
		var context_left = pic_canvas_left.getContext('2d');
		var context_right = pic_canvas_right.getContext('2d');
		var context_below = pic_canvas_below.getContext('2d');
		
	    this.picture_above = new Image();
		this.picture_above.onload = function () {	
			context_above.drawImage(this, 0, 0, this.width, this.height,
									0,0, pic_canvas_above.width, pic_canvas_above.height);
			this.width = this.naturalWidth;
			this.height = this.naturalHeight;

			//NMO_NormalMap.createNormalMap(); // height map was loaded... so create standard normal map!
		
			NMO_RenderNormalview.picture_above_map.needsUpdate = true;
			
	    };
		
	    this.picture_left = new Image();
		this.picture_left.onload = function () {	
			context_left.drawImage(this, 0, 0, this.width, this.height,
									0,0, pic_canvas_left.width, pic_canvas_left.height);
			this.width = this.naturalWidth;
			this.height = this.naturalHeight;

			NMO_RenderNormalview.picture_left_map.needsUpdate = true;
	    };
		

	    this.picture_right = new Image();
		this.picture_right.onload = function () {	
			context_right.drawImage(this, 0, 0, this.width, this.height,
									0,0, pic_canvas_right.width, pic_canvas_right.height);
			this.width = this.naturalWidth;
			this.height = this.naturalHeight;

			NMO_RenderNormalview.picture_right_map.needsUpdate = true;
	    };
		

	    this.picture_below = new Image();
		this.picture_below.onload = function () {	
			context_below.drawImage(this, 0, 0, this.width, this.height,
									0,0, pic_canvas_below.width, pic_canvas_below.height);
			this.width = this.naturalWidth;
			this.height = this.naturalHeight;

			NMO_RenderNormalview.picture_below_map.needsUpdate = true;
			//NMO_RenderNormalview.renderNormalToHeight(); // when the last one was loaded
	    };
		
		this.picture_above.src = './images/default_picture_above.jpg';
	    this.picture_left.src  = './images/default_picture_left.jpg';
	    this.picture_right.src = './images/default_picture_right.jpg';	
	    this.picture_below.src = './images/default_picture_below.jpg';

	};
}

document.getElementById('select_file_height').param = "height";
document.getElementById('select_file_above').param = "above";
document.getElementById('select_file_left').param = "left";
document.getElementById('select_file_right').param = "right";
document.getElementById('select_file_below').param = "below";
document.getElementById('select_multiple_height_files').param = "multiple_height";
document.getElementById('select_file_height').addEventListener('change', NMO_FileDrop.handleFileSelect, false);
document.getElementById('select_file_above').addEventListener('change', NMO_FileDrop.handleFileSelect, false);
document.getElementById('select_file_left').addEventListener('change', NMO_FileDrop.handleFileSelect, false);
document.getElementById('select_file_right').addEventListener('change', NMO_FileDrop.handleFileSelect, false);
document.getElementById('select_file_below').addEventListener('change', NMO_FileDrop.handleFileSelect, false);
document.getElementById('select_multiple_height_files').addEventListener('change', NMO_FileDrop.handleFileSelect, false);

document.getElementById("height_map").addEventListener("dragover", function(e) {e.preventDefault();}, true);
document.getElementById("height_map").addEventListener("drop", function(e){
	//console.log("height");
	e.preventDefault();
	// 拖入也要先分类，不能绕过标签确认。
	if (window.NMO_Classification && NMO_Classification.isOpen()) return;
	NMO_FileDrop.importSingleHeight(e.dataTransfer.files[0]);
}, true);

document.getElementById("picture_above_drop").addEventListener("dragover", function(e) {e.preventDefault();}, true);
document.getElementById("picture_above_drop").addEventListener("drop", function(e){
	//console.log("above");
	e.preventDefault(); 
	NMO_FileDrop.readImage(e.dataTransfer.files[0], "pictures", "above");
}, true);

document.getElementById("picture_left_drop").addEventListener("dragover", function(e) {e.preventDefault();}, true);
document.getElementById("picture_left_drop").addEventListener("drop", function(e){
	e.preventDefault(); 
	NMO_FileDrop.readImage(e.dataTransfer.files[0], "pictures", "left");
}, true);

document.getElementById("picture_right_drop").addEventListener("dragover", function(e) {e.preventDefault();}, true);
document.getElementById("picture_right_drop").addEventListener("drop", function(e){
	e.preventDefault(); 
	NMO_FileDrop.readImage(e.dataTransfer.files[0], "pictures", "right");
}, true);

document.getElementById("picture_below_drop").addEventListener("dragover", function(e) {e.preventDefault();}, true);
document.getElementById("picture_below_drop").addEventListener("drop", function(e){
	e.preventDefault(); 
	NMO_FileDrop.readImage(e.dataTransfer.files[0], "pictures", "below");
}, true);


document.getElementById('select_model_file').addEventListener('change', NMO_FileDrop.handleModelFileSelect, false);
