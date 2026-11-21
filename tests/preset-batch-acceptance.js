'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {spawn}=require('node:child_process'), assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nmo-preset-test-')), profile=path.join(root,'profile'), out=path.join(root,'out');
fs.mkdirSync(out);
const exe=process.argv[2] || require('electron');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const args=[...(process.argv[2]?[]:['.']),'--agent','--agent-out='+out,'--profile='+profile];
const cp=spawn(exe,args,{env,windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let discovery;
 for(let i=0;i<240 && !discovery;i++){try{discovery=JSON.parse(fs.readFileSync(path.join(profile,'agent.json')));}catch{await sleep(250);}}
 assert(discovery,'agent discovery missing');
 async function call(cmd,args={}){
   const response=await fetch('http://127.0.0.1:'+discovery.port+'/command',{method:'POST',headers:{Authorization:'Bearer '+discovery.token,'Content-Type':'application/json'},body:JSON.stringify({cmd,args})});
   return response.json();
 }
 try {
   let presets;
   for(let i=0;i<60;i++){presets=await call('list_presets');if(presets.ok)break;await sleep(250);}
   assert.equal(presets.presets?.length,20,JSON.stringify(presets));
   const applied=await call('apply_preset',{name:'asphalt'});assert.equal(applied.ok,true,JSON.stringify(applied));
   assert.equal((await call('save_preset',{name:'asphalt'})).error.code,'confirmation_required');
   const params={controls:{roughness_tick:true,metallic_tick:true,ambient_tick:true,rough_value:0.71},orm:true};
   const changed=await call('set_parameters',{data:params});assert.equal(changed.data?.orm,true,JSON.stringify(changed));
   const file=path.resolve('tests/fixtures/height-bumps-256.png');
   const items=Array.from({length:Number(process.env.NMO_ACCEPT_COUNT || 50)},(_,i)=>{
     const dir=path.join(out,String(i));fs.mkdirSync(dir);return {path:file,dir,baseName:'Asphalt_107'};
   });
   const preview=await call('dry_run',{dir:out,items:[items[0],items[0]]});
   assert.equal(preview.items[1].baseName,'Asphalt_107 (1)');
   assert.equal((await call('dry_run',{dir:out,items:[{...items[0],dir:root}]})).ok,false);
   const bulk=Array.from({length:781},(_,i)=>({...items[i%items.length],baseName:'bulk_'+i}));
   const bulkPreview=await call('dry_run',{dir:out,items:bulk});
   assert.equal(bulkPreview.items.length,781);
   const bulkJob=await call('batch',{items:bulk,dir:out,async:true});
   assert.equal(bulkJob.total,781);
   await call('cancel',{jobId:bulkJob.jobId});
   while((await call('progress',{jobId:bulkJob.jobId})).job.status==='running')await sleep(150);
   const batch={dir:out,items,types:['normal','ao','roughness','metallic'],batchId:'acceptance'};
   const start=await call('batch',{...batch,async:true});
   assert(start.jobId,JSON.stringify(start));
   let report;
   while(!report){
     await sleep(300);
     const progress=await call('progress',{jobId:start.jobId,since:999999});
     if(progress.job.status!=='running')report=progress.job.result;
   }
   if(!fs.existsSync(path.join(items[0].dir,'Asphalt_107_NRM.png')))throw Error(JSON.stringify(report).slice(0,1800));
   for(const item of items)assert.deepEqual(fs.readdirSync(item.dir).filter(n=>n.startsWith('Asphalt')).sort(),['Asphalt_107_NRM.png','Asphalt_107_ORM.png']);
   const second=await call('batch',{...batch,items:[items[0]],resume:true});assert.equal(second.resumed.skipped,1);
   const dup=await call('batch',{...batch,items:[items[0]]});assert(fs.existsSync(path.join(items[0].dir,'Asphalt_107 (1)_ORM.png')),JSON.stringify(dup));
   const bundle=process.argv[2]?path.join(path.dirname(path.resolve(process.argv[2])),'mcp'):path.resolve('mcp');
   const clientEnv={...env,NMO_AGENT_FILE:path.join(profile,'agent.json')};
   const {execFileSync,spawnSync}=require('node:child_process');
   const mcp=spawnSync(process.execPath,[path.join(bundle,'normalmap-mcp.js')],{env:clientEnv,encoding:'utf8',input:[
     {jsonrpc:'2.0',id:1,method:'tools/list'},
     {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'normalmap_get_parameters',arguments:{}}}
   ].map(v=>JSON.stringify(v)).join('\n')+'\n'});
   const replies=mcp.stdout.trim().split(/\r?\n/).map(r=>JSON.parse(r));
   assert(replies.find(r=>r.id===1).result.tools.some(t=>t.name==='normalmap_dry_run'));
   assert(!replies.find(r=>r.id===2).result.isError);
   const mat=path.join(out,'107_Asphalt');fs.mkdirSync(mat);fs.copyFileSync(file,path.join(mat,'BaseColor_107_sample.png'));
   const previewText=execFileSync(process.execPath,[path.join(bundle,'material-batch.js'),out,'--preview'],{env:clientEnv,encoding:'utf8'});
   assert.equal(JSON.parse(previewText)[0].baseName,'Asphalt_107');
   execFileSync(process.execPath,[path.join(bundle,'material-batch.js'),out],{env:clientEnv});
   assert(fs.existsSync(path.join(mat,'Asphalt_107_NRM.png')));
   assert(!fs.existsSync(path.join(profile,'library','nmo-library.json')));
   console.log(JSON.stringify({passed:true,version:discovery.version,materials:items.length,images:items.length*2,profile:root}));
 } finally {await call('quit').catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{setTimeout(()=>{if(cp.exitCode===null)cp.kill();},1500).unref();});
