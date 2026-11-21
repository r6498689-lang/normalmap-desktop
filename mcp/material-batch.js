'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const [folder,...flags]=process.argv.slice(2);
  if(!folder || flags.some(v=>v!=='--preview' && !v.startsWith('--preset=')))throw Error('用法：材质批量.cmd "素材根目录" [--preview] [--preset=预设名]');
  const root=fs.realpathSync(folder);
  const items=[];
  const preset=flags.find(s=>s.startsWith('--preset='))?.slice(9);
  function scan(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())scan(full);
      else if(entry.isFile() && /^BaseColor_.*\.png$/i.test(entry.name) && !/_(NRM|RGH|MTL|AO|DSP|SPC|ORM)\.png$/i.test(entry.name)){
        const parts=/^(\d+)_(.+)$/.exec(path.basename(dir));
        if(!parts)throw Error('材质文件夹需要“编号_类目”：'+dir);
        items.push({path:full,dir,baseName:parts[2]+'_'+parts[1],preset});
      }
    }
  }
  scan(root);
  if(!items.length)throw Error('没有找到 BaseColor_ 开头的 PNG。');
  const file=process.env.NMO_AGENT_FILE || path.join(process.env.APPDATA,'NormalMap Desktop','agent.json');
  if(!process.env.NMO_AGENT_FILE){
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(path.join(__dirname,'..','NormalMap Desktop.exe'),['--agent','--agent-out='+root],{detached:true,stdio:'ignore',env,windowsHide:true});
    child.unref();
  }
  let info;
  async function call(cmd,args={}){
    const res=await fetch('http://127.0.0.1:'+info.port+'/command',{method:'POST',headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json'},body:JSON.stringify({cmd,args})});
    const data=await res.json();
    if(!data.ok)throw Error(data.error?.message || JSON.stringify(data));
    return data;
  }
  for(let i=0;i<80;i++){
    try{info=JSON.parse(fs.readFileSync(file));await call('ping');break;}catch(err){if(i===79)throw err;await sleep(250);}
  }
  if(!info.commands?.includes('use_gui_parameters'))throw Error('请退出旧版 NormalMap，再用 1.2.0 或更高版本运行。');
  await call('use_gui_parameters');
  if(flags.includes('--preview')){
    console.log(JSON.stringify((await call('dry_run',{dir:root,items})).items,null,2));return;
  }
  const job=await call('batch',{dir:root,items,async:true,resume:true,retry:1});
  let cursor=0;
  for(;;){
    await sleep(750);
    const status=await call('progress',{jobId:job.jobId,since:cursor});cursor=status.nextSeq;
    for(const e of status.events)if(e.type==='item_done')console.log(e.index+'/'+items.length,e.name,e.ok?'完成':'失败');
    if(status.job.status!=='running'){
      const result=status.job.result;
      for(const row of result?.items || [])if(!row.ok)console.error(row.path,row.error);
      if(status.job.status!=='done')throw Error('批量结束：'+status.job.status);
      return;
    }
  }
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
