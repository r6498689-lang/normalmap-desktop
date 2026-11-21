var diffuse_canvas = document.createElement("canvas");

function handleDiffuseFileSelect(evt) {
    var files = evt.target.files; // FileList object
    readDiffuseImage(evt.target.files[0]); // files is a FileList of File objects. List some properties.
}

document.getElementById('select_diffuse_file').addEventListener('change', handleDiffuseFileSelect, false);

/*
 * Upstream decided "is this a TGA?" from File.type === "image/targa" and
 * rejected anything whose type did not match /image.*\./ . On Windows a .tga
 * often arrives with an empty type, "image/x-tga" or "application/octet-stream",
 * so the file was either rejected outright or sent to the browser's image
 * decoder, which cannot read TGA. The height-map path already solved this with
 * NMO_FileDrop.isTargaFile / isSupportedImage; reuse it here instead of keeping
 * a second, stricter rule.
 */
var readDiffuseImage = function(imgFile){
	if (!imgFile) return;
	if (!NMO_FileDrop.isSupportedImage(imgFile)) {
		console.log("The dropped file is not a supported image: ", imgFile && imgFile.type);
		NMO_Desktop.status('已跳过“' + (imgFile.name || '文件') + '”：不是受支持的图片。', 'error');
		return;
	}

	var isTarga = NMO_FileDrop.isTargaFile(imgFile);
	var reader = new FileReader();
	reader.onload = function(e){
		var data = e.target.result;
		if (isTarga){
			try {
				var tga = new TGA();
				tga.load(new Uint8Array(data));
				data = tga.getDataURL('image/png');
			} catch (err) {
				NMO_Desktop.status('无法按 TGA 解码“' + imgFile.name + '”：' + (err && err.message ? err.message : err), 'error');
				return;
			}
		}
		loadDiffuseMap(data);
		document.getElementById('input_diffuse').disabled = false;
	};
	reader.onerror = function(){
		NMO_Desktop.status('无法读取“' + imgFile.name + '”。', 'error');
	};
	if (isTarga)
		reader.readAsArrayBuffer(imgFile);
	else
		reader.readAsDataURL(imgFile);
};

var loadDiffuseMap = function(source){
	diffuse_image = new Image();
	//console.log(source);
			
	diffuse_image.onload = function(){
		var ctx_diffuse = diffuse_canvas.getContext("2d");
		diffuse_canvas.width = diffuse_image.width;
		diffuse_canvas.height = diffuse_image.height;
		ctx_diffuse.clearRect(0, 0, diffuse_image.width, diffuse_image.height);
		ctx_diffuse.drawImage(diffuse_image,0,0, diffuse_image.width, diffuse_image.height);
		NMO_RenderView.diffuse_map.needsUpdate = true;
		diffuse_canvas.dataset.sourceWidth = String(diffuse_image.width);
		diffuse_canvas.dataset.sourceHeight = String(diffuse_image.height);

		NMO_RenderView.enableDiffuse();
	};

	diffuse_image.src = source;
};