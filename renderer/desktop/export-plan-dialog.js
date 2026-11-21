window.NMO_ExportPlan = {
  async open({items, types}) {
    const chosen = await window.nmoDesktop.chooseExportDir();
    if (!chosen || !chosen.ok) return {confirmed:false};
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'background:#27282b;color:white;max-height:80vh;overflow:auto;border:1px solid #666;padding:20px';
    function element(tag,text,parent=dialog) {
      const el=document.createElement(tag);
      if(text) el.textContent=text;
      parent.appendChild(el);
      return el;
    }
    element('h3','导出清单');
    element('p',chosen.dir);
    const presets = await NMO_Presets.reload();
    const rows = items.map(item=>{
      const row=element('p');
      element('label',item.sourceName+' → ',row);
      const input=element('input',null,row);
      input.value=item.baseName || item.sourceName;
      input.maxLength=180;
      const select=element('select',null,row);
      element('option','当前参数',select).value='';
      if(items.length>1) for(const p of presets) element('option',p.name,select).value=p.name;
      select.hidden=items.length===1;
      return {item,input,select,preview:element('small','',row)};
    });
    const cancel=element('button','取消'), start=element('button','开始导出');
    const entries=()=>rows.map(({item,input,select})=>({sourceKey:item.sourceKey,sourceName:item.sourceName,baseName:input.value,preset:select.value}));
    let version=0;
    async function refresh(){
      const generation=++version;
      start.disabled=true;
      const p=await window.nmoDesktop.planExport({dir:chosen.dir,items:entries(),preview:true});
      if(generation!==version)return;
      rows.forEach((r,i)=>{r.preview.textContent=p.error || types.map(t=>p.assignments[i].baseName+'_'+NMO_OutputSuffix[t.property]+'.'+(t.property==='ORM'?'png':NMO_Main.getImageType())).join('、');});
      start.disabled=!!p.error;
    }
    dialog.addEventListener('input',refresh);
    document.body.appendChild(dialog);
    dialog.showModal();
    refresh();
    return new Promise(resolve=>{
      function finish(confirmed){dialog.close();dialog.remove();resolve({confirmed,dir:chosen.dir,items:entries(),types});}
      cancel.onclick=()=>finish(false);
      dialog.oncancel=e=>{e.preventDefault();finish(false);};
      start.onclick=()=>finish(true);
    });
  }
};