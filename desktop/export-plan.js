'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const save = require('./save-manager');
const suffix = require('../renderer/shared/output-names');
function validBase(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
    throw Error('请输入合法的基础文件名。');
  return value;
}
function createPlanner({dialogs}) {
  const sessions = new Map(), held = new Set();
  function occupied(dir, base, names) {
    const prefix = base.toLowerCase() + '_';
    return held.has(path.join(dir,base).toLowerCase()) || names.some(name => {
      const parsed = path.parse(name.toLowerCase());
      return parsed.name.startsWith(prefix) && Object.values(suffix).includes(parsed.name.slice(prefix.length).toUpperCase());
    });
  }
  async function prepare(request) {
    let dir = request.dir;
    if (!dir) {
      const chosen = await dialogs.chooseFolder();
      if (!chosen.ok) return {canceled:true};
      dir = chosen.dir;
    }
    dir = fs.realpathSync(dir);
    const names = fs.readdirSync(dir), slots = new Map(), files = [], errors = [];
    try {
      for (const item of request.items) {
        if (slots.has(item.sourceKey)) throw Error('源图标识重复。');
        const stem = validBase(item.baseName ?? item.sourceName);
        let base = stem, n = 0;
        if(item.resumeBase){base=validBase(item.resumeBase);if(held.has(path.join(dir,base).toLowerCase()))throw Error('套组正在导出。');}
        else while (occupied(dir,base,names)) base = stem + ' (' + (++n) + ')';
        held.add(path.join(dir,base).toLowerCase());
        slots.set(item.sourceKey,{resume:!!item.resumeBase,baseName:base,sourceKey:item.sourceKey});
      }
      const assignments = [...slots.values()];
      if (request.preview) return {dir,assignments};
      const token = crypto.randomUUID();
      sessions.set(token,{dir,slots,files,errors});
      return {dir,assignments,token};
    } finally {
      if (request.preview || slots.size !== request.items.length)
        for (const slot of slots.values()) held.delete(path.join(dir,slot.baseName).toLowerCase());
    }
  }
  function writeOne(token, record) {
    const plan = sessions.get(token);
    if (!plan) return {ok:false,error:'导出已结束。'};
    try {
      const slot = plan.slots.get(record.sourceKey);
      if (!slot || !Object.hasOwn(suffix,record.property)) throw Error('源图或用途不在计划内。');
      const image = save.validateRecord(record,0);
      if (!image.ok) throw Error(image.error);
      if(fs.realpathSync(plan.dir)!==plan.dir)throw Error('导出目录已改变。');
      const fileName = slot.baseName + '_' + suffix[record.property] + save.IMAGE_TYPES[image.type].ext;
      const target = path.join(plan.dir,fileName);
      if(slot.resume && fs.existsSync(target)){
        if(!fs.readFileSync(target).equals(image.bytes))throw Error('续跑发现同名文件内容不同：'+fileName);
      } else {
        const temp=path.join(plan.dir,'.nmo-'+crypto.randomUUID()+'.tmp');
        try {
          fs.writeFileSync(temp,image.bytes,{flag:'wx'});
          try {fs.linkSync(temp,target);}
          catch(err){
            if(!['ENOTSUP','EPERM','ENOSYS'].includes(err.code))throw err;
            fs.copyFileSync(temp,target,fs.constants.COPYFILE_EXCL);
          }
        } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
      }
      plan.files.push(fileName);
      return {ok:true,fileName,path:target,bytes:image.bytes.length};
    } catch(err) {
      plan.errors.push(err.message);
      return {ok:false,error:err.message};
    }
  }
  function finish(token) {
    const p = sessions.get(token);
    if (!p) return {ok:false,error:'导出已结束。'};
    sessions.delete(token);
    for (const slot of p.slots.values()) held.delete(path.join(p.dir,slot.baseName).toLowerCase());
    return {ok:p.files.length>0 && !p.errors.length,dir:p.dir,written:p.files.length,skipped:0,failed:p.errors.length,files:p.files,errors:p.errors};
  }
  return {prepare,writeOne,finish,abort:finish};
}
module.exports = {createPlanner,validBase};
