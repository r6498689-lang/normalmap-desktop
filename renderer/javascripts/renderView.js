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


var NMO_RenderView = new function(){
	this.scene = new THREE.Scene();
	this.camera = new THREE.PerspectiveCamera( 30, 1, 0.1, 100000 );
	this.renderer = new THREE.WebGLRenderer({ alpha: false,  antialias: true });
	this.displacement_map, this.diffuse_map, this.normal_map, this.specular_map, this.ao_map;
	this.material;
	// 1.1.9 起默认不自动旋转：模型静止，用户用鼠标拖动查看；开关打开才转
	this.rotation_enabled = false;
	this.render_model;
	this.customModel;
	this.textureCube;
	
	this.renderView = function(){
		// request new frame
        requestAnimationFrame(function(){
            NMO_RenderView.renderView();
        });
		this.renderer.render(this.scene, this.camera);
		
		if(this.rotation_enabled && this.render_model){
			this.render_model.rotation.x += 0.0015;
			this.render_model.rotation.y += 0.0015;
		}
		//console.log("rendering");
	};


	this.initRenderer = function(){

		this.renderer.setSize( NMO_FileDrop.container_height, NMO_FileDrop.container_height );
		//renderer.physicallyBasedShading = true;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		document.getElementById('render_view').appendChild( this.renderer.domElement );
		
		//camera.position.x = 2000;
	    this.camera.position.z = 29;
		this.camera.lookAt({
	        x: 0,
	        y: 0,
	        z: 0
	    });
		
		var controls = new THREE.OrbitControls( this.camera, this.renderer.domElement );
		
		
		var hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.6 );
		hemiLight.color.setHSL( 0.6, 1, 0.6 );
		hemiLight.groundColor.setHSL( 0.095, 1, 0.75 );
		hemiLight.position.set( 0, 500, 0 );
		this.scene.add( hemiLight );

		
		var dirLight = new THREE.DirectionalLight( 0xffffff, 1 );
		dirLight.color.setHSL( 0.1, 1, 0.95 );
		dirLight.position.set( -1, 1.75, 1 );
		dirLight.position.multiplyScalar( 50 );
		this.scene.add( dirLight );

		dirLight.castShadow = true;

		dirLight.shadow.mapSize.width = 2048;
		dirLight.shadow.mapSize.height = 2048;

		var d = 50;

		dirLight.shadow.camera.left = -d;
		dirLight.shadow.camera.right = d;
		dirLight.shadow.camera.top = d;
		dirLight.shadow.camera.bottom = -d;

		dirLight.shadow.camera.far = 3500;
		dirLight.shadow.bias = -0.0001;
		
		
		
		//var height_canvas   = document.getElementById('height_canvas');
		
		this.diffuse_map			= new THREE.Texture( diffuse_canvas );
		this.specular_map  			= new THREE.Texture( NMO_SpecularMap.specular_canvas );
		this.normal_map  			= new THREE.Texture( NMO_NormalMap.normal_canvas );
		this.displacement_map		= new THREE.Texture( NMO_DisplacementMap.displacement_canvas );
		this.ao_map  				= new THREE.Texture( NMO_AmbientOccMap.ao_canvas );
		this.diffuse_map.wrapS 		= this.diffuse_map.wrapT = THREE.RepeatWrapping;
		this.specular_map.wrapS 	= this.specular_map.wrapT = THREE.RepeatWrapping;
		this.normal_map.wrapS 		= this.normal_map.wrapT = THREE.RepeatWrapping;
		this.displacement_map.wrapS = this.displacement_map.wrapT = THREE.RepeatWrapping;
		this.ao_map.wrapS 			= this.ao_map.wrapT = THREE.RepeatWrapping;
		
		var loader = new THREE.CubeTextureLoader();
		loader.setPath( 'cubemaps/park/' );

		this.textureCube = loader.load( [
			'posx.jpg', 'negx.jpg',
			'posy.jpg', 'negy.jpg',
			'posz.jpg', 'negz.jpg'
		] );
		
		
		//var shader = THREE.NormalDisplacementShader;
		var shader = THREE.ShaderLib.phong
		
		// see ShaderLib (https://github.com/mrdoob/three.js/blob/master/src/renderers/shaders/ShaderLib.js)
		var uniforms = THREE.UniformsUtils.clone( shader.uniforms );
		
		//uniforms[ "diffuse" ].value = new THREE.Color(0xbbbbbb);
		//uniforms[ "specular" ].value = new THREE.Color(0x777777);
		//uniforms[ "ambientLightColor" ].value = new THREE.Color(0x000000);

		//console.log(this.diffuse_map);
		//uniforms["color"].value 	           = new THREE.Color("rgb(255, 0, 0)");
		var textureLoader = new THREE.TextureLoader();

		shaderUniforms = uniforms;
		//shaderUniforms.aoMap = this.ao_map;
		//console.log(shaderUniforms);

		var defines = {};

		//defines[ "USE_MAP" ] = "";
		defines[ "USE_SPECULARMAP" ] = "";
		if (document.getElementById('input_displacement').checked)
			defines[ "USE_DISPLACEMENTMAP" ] = "";
		defines[ "USE_AOMAP" ] = "";
		
		
		//defines[ "USE_LIGHTMAP" ] = "";
		defines[ "USE_NORMALMAP" ] = "";

		this.material = new THREE.ShaderMaterial( { 
			name: "renderViewShader",
			defines: defines,
			uniforms: shaderUniforms,
			vertexShader: shader.vertexShader, 
			fragmentShader: shader.fragmentShader,
			//transparent: true,
			lights: true
		} );
		//console.log(shaderUniforms)

		this.material.extensions.derivatives = true;  // needed for normalmap
		this.material.uniforms.map.value = this.diffuse_map;
		this.material.uniforms.normalMap.value = this.normal_map;
		this.material.uniforms.specularMap.value = this.specular_map;
		this.material.uniforms.displacementMap.value = this.displacement_map;
		//this.material.uniforms.lightMap.value = textureCube;
		this.material.uniforms.envMap.value = this.textureCube;
		this.material.uniforms.aoMap.value = this.ao_map;
		this.material.uniforms.aoMapIntensity.value = 1;
		this.material.uniforms.displacementScale.value = -0.3
		this.material.uniforms.displacementBias.value = 0;
		this.material.uniforms.diffuse.value = new THREE.Color(0xaaaaaa);
		this.material.uniforms.specular.value = new THREE.Color(0x444444);
		//this.material.unshininess.value = 40;
		//this.material.uniforms.ambientLightColor.value = new THREE.Color(0x777777);


		this.setModel("Cube");

		//this.scene.background = textureCube;
		
		//console.log("init done");
		this.renderView();
	};


	this.setRepeat = function(v_x, v_y){
		/*
		 * 1.1.14：开了 PBR 预览时 render_model.material 是 MeshStandardMaterial，
		 * 没有 uniforms。贴图重复参数只属于老的着色器，写到 this.material 上即可，
		 * 否则换源图时会抛 TypeError 并中断后面的重采样。
		 */
		var target = this.material;
		if (!target || !target.uniforms) return;
		target.uniforms.offsetRepeat.value = new THREE.Vector4(0,0,v_x, v_y);
		target.needsUpdate = true;
	};


	this.setModel = function(type){
		this.scene.remove( this.render_model );

		if (type == "Cube"){
			var geometry = new THREE.BoxGeometry(10, 10, 10, 128, 128, 128);
			geometry.faceVertexUvs[ 1 ] = geometry.faceVertexUvs[ 0 ];
			//geometry.computeTangents();
			this.render_model = new THREE.Mesh( new THREE.BufferGeometry().fromGeometry( geometry), this.material);
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.scene.add( this.render_model );
		}
		else if (type == "Sphere"){
			var geometry = new THREE.SphereGeometry( 7, 128, 128);
			geometry.faceVertexUvs[ 1 ] = geometry.faceVertexUvs[ 0 ];
			//geometry.computeTangents();
			this.render_model = new THREE.Mesh( new THREE.BufferGeometry().fromGeometry( geometry), this.material);
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.scene.add( this.render_model );
		}
		else if (type == "Cylinder"){
			var geometry = new THREE.CylinderGeometry( 7, 7, 10, 128 );
			geometry.faceVertexUvs[ 1 ] = geometry.faceVertexUvs[ 0 ];
			//geometry.computeTangents();
			this.render_model = new THREE.Mesh( new THREE.BufferGeometry().fromGeometry( geometry), this.material);
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.scene.add( this.render_model );
		}
		else if (type == "Plane"){
			var geometry = new THREE.PlaneGeometry(12, 12, 128, 128);
			geometry.faceVertexUvs[ 1 ] = geometry.faceVertexUvs[ 0 ];
			//geometry.computeTangents();
			this.setRotationEnabled(false);
			this.render_model.rotation.x = 0;
			this.render_model.rotation.y = 0;
			this.camera.position.x = 0;
			this.camera.position.y = 0;
			this.camera.position.z = 29;
			this.camera.lookAt({
	        	x: 0,
	        	y: 0,
		        z: 0
	    	});
			this.render_model = new THREE.Mesh( new THREE.BufferGeometry().fromGeometry( geometry), this.material);
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.render_model.material.side = THREE.DoubleSide;
			this.scene.add( this.render_model );
		}
		else if (type == "Teapot"){
			var geometry = new THREE.TeapotBufferGeometry( 3, //teapotSize,
				15, // tesselation?!
				true, // bottom
				true, // lid
				true, // body
				true, // fitLid,
				true // nonblinn
				);

			this.render_model = new THREE.Mesh(	geometry, this.material );	// if no match, pick Phong
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.scene.add( this.render_model );
			this.setDisplacement(false);
		}		
		else if (type == "Custom" && this.customModel){
			this.render_model = this.customModel;
			this.render_model.castShadow = true;
			this.render_model.receiveShadow = true;
			this.scene.add( this.render_model );
		}

		/*
		 * 1.1.14：立着正对镜头的立方体/圆柱看起来就是一块方形，粗糙度只能表现为
		 * 整体“糊一点”，金属度只剩亮度差，几乎分不出来。给一个 3/4 视角后能同时
		 * 看到三个面、每条边的反射各不相同，粗糙度/金属度的差别才看得出来。
		 * 只对这两个“棱角模型”做，平面保持正对（要贴图对齐），茶壶/自定义不动。
		 */
		if (this.render_model && (type === 'Cube' || type === 'Cylinder')) {
			this.render_model.rotation.set(0.22, 0.62, 0);
		}
		//this.render_model.geometry.faceVertexUvs[ 1 ] = this.render_model.geometry.faceVertexUvs[ 0 ];
	};

				

	this.setDisplacementOptions = function(scale, bias){
		// 同上：位移只作用于老着色器，PBR 材质没有 uniforms。
		var target = this.material;
		if (!target || !target.uniforms) return;
		target.uniforms[ "displacementScale" ].value = scale * 5;
		target.uniforms[ "displacementBias" ].value = scale * 5 * - bias;
	}

	/**
	 * 自动旋转开关（1.1.9）
	 * 唯一的真相来源：任何入口（设置里点开关、切到“平面”模型）都走这里，
	 * 保证 状态 / checkbox / 开关文案 三者不会打架。
	 * 关掉之后渲染循环照常跑，只是不再改 rotation —— 鼠标拖动（OrbitControls 转的是相机）
	 * 仍然有效，下一帧就能看到新角度。
	 */
	this.setRotationEnabled = function(enabled){
		this.rotation_enabled = !!enabled;
		var box = document.getElementById('input_rot');
		if (box && box.checked !== this.rotation_enabled) box.checked = this.rotation_enabled;
		var label = document.getElementById('rot_switch');
		if (label) label.classList.toggle('is-on', this.rotation_enabled);
		var text = document.getElementById('rot_switch_text');
		if (text) text.textContent = this.rotation_enabled ? '自动旋转 · 开' : '自动旋转 · 关';
		return this.rotation_enabled;
	};

	/** 兼容旧接口：onclick 时代留下的调用，翻一下就同步 UI */
	this.toggleRotation = function(){
		return this.setRotationEnabled(!this.rotation_enabled);
	};

	/*
	 * 1.1.31：把“显示”开关统一成 set 版本，并让它们在 PBR 预览下同样生效。
	 * phong 预览改 ShaderMaterial 的 defines；PBR 预览（MeshStandardMaterial）
	 * 直接换绑 normalMap / aoMap。toggleXxx 是 onclick 时代的旧入口，改成
	 * “读复选框的当前值再设置”，避免复选框和材质 define 各说各话。
	 */
	this._pbrMaterial = function(){
		return (window.NMO_PBRPreview && window.NMO_PBRPreview.material) || null;
	};

	this._applyDefine = function(defName, on){
		var phong = this.material;
		if (!phong || !phong.defines) return;
		if (on) phong.defines[defName] = '';
		else delete phong.defines[defName];
		phong.needsUpdate = true;
	};

	this._syncShowCheckbox = function(boxId, on){
		var box = document.getElementById(boxId);
		if (box && box.checked !== on) box.checked = on;
	};

	this.setNormal = function(on){
		on = !!on;
		this._applyDefine('USE_NORMALMAP', on);
		var pbr = this._pbrMaterial();
		if (pbr) { pbr.normalMap = on ? this.normal_map : null; pbr.needsUpdate = true; }
		this._syncShowCheckbox('input_normal', on);
	};

	this.setAO = function(on){
		on = !!on;
		this._applyDefine('USE_AOMAP', on);
		var pbr = this._pbrMaterial();
		if (pbr) { pbr.aoMap = on ? this.ao_map : null; pbr.needsUpdate = true; }
		this._syncShowCheckbox('input_ao', on);
	};

	/* PBR 的 MeshStandardMaterial 没有独立高光贴图，高光只在 phong 预览里有效。 */
	this.setSpecular = function(on){
		this._applyDefine('USE_SPECULARMAP', !!on);
		this._syncShowCheckbox('input_specular', !!on);
	};

	this.setDisplacement = function(displacement){
		this._applyDefine('USE_DISPLACEMENTMAP', !!displacement);
	};

	this.toggleNormal = function(){
		var box = document.getElementById('input_normal');
		this.setNormal(box ? box.checked : true);
	};

	this.toggleAO = function(){
		var box = document.getElementById('input_ao');
		this.setAO(box ? box.checked : true);
	};

	this.toggleSpecular = function(){
		var box = document.getElementById('input_specular');
		this.setSpecular(box ? box.checked : true);
	};


	this.toggleDiffuse = function(){
		if (this.render_model.material.defines["USE_MAP"] == "")
			delete this.render_model.material.defines["USE_MAP"];
		else
			this.render_model.material.defines["USE_MAP"] = "";
		this.render_model.material.needsUpdate = true;
	};

	this.enableDiffuse = function(){
		this.render_model.material.defines["USE_MAP"] = "";
		document.getElementById('input_diffuse').disabled = false;
		document.getElementById('input_diffuse').checked = true;

		this.render_model.material.needsUpdate = true;
	};

	this.setEnvironment = function(environment){
		if (!environment){
			delete this.render_model.material.defines["USE_ENVMAP"];
			delete this.render_model.material.defines["ENVMAP_MODE_REFLECTION"];
			delete this.render_model.material.defines["ENVMAP_TYPE_CUBE"];
			delete this.render_model.material.defines["ENVMAP_BLENDING_MIX"];
			this.scene.background = "";
		}
		else{
			this.render_model.material.defines["USE_ENVMAP"] = "";
			this.render_model.material.defines["ENVMAP_MODE_REFLECTION"] = "";
			this.render_model.material.defines["ENVMAP_TYPE_CUBE"] = "";
			this.render_model.material.defines["ENVMAP_BLENDING_MIX"] = "";
			//this.scene.background = this.textureCube;
		}
		this.render_model.material.needsUpdate = true;
	};

}

$(document).ready(function() {
	$(".various").fancybox({
		maxWidth	: 600,
		maxHeight	: 600,
		fitToView	: false,
		width		: 600,
		height		: 600,
		autoSize	: false,
		closeClick	: false,
		openEffect	: 'none',
		closeEffect	: 'none',
	});

	$(".big_preview").fancybox({
		maxWidth	: 800,
		maxHeight	: 800,
		fitToView	: false,
		width		: 800,
		height		: 800,
		autoSize	: false,
		closeClick	: false,
		openEffect	: 'none',
		closeEffect	: 'none',
		
		afterShow: function(){
			document.getElementById('renderBig').appendChild(NMO_RenderView.renderer.domElement);
			NMO_RenderView.renderer.setSize( 800, 800 );

		},
		afterClose: function(){
			document.getElementById('render_view').appendChild(NMO_RenderView.renderer.domElement);
			NMO_RenderView.renderer.setSize(NMO_FileDrop.container_height, NMO_FileDrop.container_height );
		}
	});
});