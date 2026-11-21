'use strict';
const assert=require('node:assert/strict'), path=require('node:path'), fs=require('node:fs');
module.exports.run=async function(ctx){
  const out=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nmo-gui-'));
  ctx.dialogs.folderIs(out);
  await ctx.js('window.NMO_ParametersReady');
  await ctx.js(`document.getElementById('file_name').value='试用材质'; document.getElementById('download').click();true`);
  await ctx.waitFor('document.querySelector("dialog input")');
  await ctx.js(`const input=document.querySelector('dialog input');input.value='GUI_107';input.dispatchEvent(new Event('input',{bubbles:true}));true`);
  await ctx.waitFor('document.querySelector("dialog button:last-child:not(:disabled)")');
  await ctx.js(`document.querySelector('dialog button:last-child').click();true`);
  for(let i=0;i<100 && !fs.existsSync(path.join(out,'GUI_107_NRM.png'));i++)await ctx.wait(100);
  assert(fs.existsSync(path.join(out,'GUI_107_NRM.png')));
  await ctx.js("NMO_Agent.setParameters({data:{controls:{rough_value:0.83}}})");
  await ctx.wait(500);
  const last=await ctx.js("window.nmoDesktop.readCurrent()");
  assert.equal(Number(last.controls.rough_value),0.83);
  return {ok:true,out,parameterSaved:0.83};
};
