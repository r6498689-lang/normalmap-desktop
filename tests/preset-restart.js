'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nmo-restart-')), env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const exe=process.argv[2] || require('electron');
const args=process.argv[2]?[]:['.'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child;
function launch(extra){return spawn(exe,[...args,'--profile='+root,...extra],{env,windowsHide:true,stdio:'ignore'});}
async function until(fn){let last;for(let i=0;i<100;i++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(150);}throw last || Error('等待超时');}
async function gui(){
  child=launch(['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']);
  const target=await until(async()=>{
    const port=fs.readFileSync(path.join(root,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
    return (await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.url.startsWith('app://'));
  });
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0;
  async function evaluate(expression){
    const id=++seq;
    return new Promise((resolve,reject)=>{
      ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id!==id)return;
        if(msg.result?.exceptionDetails)return reject(Error(msg.result.exceptionDetails.exception?.description));
        resolve(msg.result?.result?.value);
      };
      ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
  }
  await until(()=>evaluate("typeof NMO_Agent!=='undefined' && document.readyState==='complete'"));
  await evaluate('window.NMO_ParametersReady');
  return {ws,evaluate};
}
(async()=>{
  let page=await gui();
  await page.evaluate("NMO_Agent.setParameters({data:{controls:{rough_value:0.83}}})");
  await until(()=>Number(JSON.parse(fs.readFileSync(path.join(root,'current-parameters.json'))).controls.rough_value)===0.83);
  page.ws.close();const killed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await killed;
  page=await gui();
  assert.equal(await page.evaluate("Number(NMO_Presets.collect().controls.rough_value)"),0.83);
  const attach=launch(['--agent','--agent-out='+root]);
  const info=await until(()=>JSON.parse(fs.readFileSync(path.join(root,'agent.json'))));
  assert.equal(info.pid,child.pid);
  async function call(cmd,args){return (await fetch('http://127.0.0.1:'+info.port+'/command',{method:'POST',headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json'},body:JSON.stringify({cmd,args})})).json();}
  const set=await until(async()=>{const r=await call('set_parameters',{data:{controls:{rough_value:0.32}}});return r.ok && r;});
  assert.equal(Number(set.data.controls.rough_value),0.32);
  assert.equal(await page.evaluate("Number(NMO_Presets.collect().controls.rough_value)"),0.83);
  page.ws.close();await call('quit',{});
  console.log(JSON.stringify({ok:true,recovered:0.83,agent:0.32,gui:0.83,existingProcess:true}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{setTimeout(()=>{if(child?.exitCode===null)child.kill();},1000).unref();});
