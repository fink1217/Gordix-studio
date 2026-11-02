/* 直接讀取既有刀路；預覽不套用 CAM、不平移、不覆寫編輯中的專案。 */
window.GordixGcodePreview = (() => {
    const dialog=document.createElement('dialog');
    dialog.id='gcode-preview-dialog';
    dialog.style.cssText='width:94vw;max-width:1500px;height:90vh;padding:16px;background:#0f172a;color:#e2e8f0;border:1px solid #64748b;border-radius:12px;';
    dialog.innerHTML=`<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <strong>既有 G-code 預覽</strong><button id="gcode-close" class="btn btn-sub">關閉</button>
        <button id="gcode-top" class="btn btn-sub">俯視／立體</button>
        <button id="gcode-archive-save" class="btn btn-sub">儲存刀路恢復檔</button>
        <button id="gcode-restore-edit" class="btn btn-main">恢復到主編輯區</button>
        <button id="gcode-open-project" class="btn btn-sub">開啟專案恢復編輯</button>
        <input id="gcode-recovery-input" type="file" accept=".json,.gordix,.svg,.gcode,.nc,.tap,.txt" multiple hidden>
        <select id="gcode-file-select" aria-label="預覽的 G-code" class="num-in" style="max-width:480px"></select></div>
        <p id="gcode-preview-note" style="font-size:13px;margin:8px 0"></p>
        <div style="padding:8px;border:1px solid #64748b;border-radius:6px;font-size:13px">
        <div>恢復編輯：先選原始 SVG，再確認雷射與銑刀兩份 G-code，最後按上方「恢復到主編輯區」。</div>
        <label style="display:block;margin-top:6px">① 原始 SVG（可多選，不是 PNG／JPG）
        <input id="gcode-source-input" type="file" accept=".svg" multiple></label>
        <label style="display:block;margin-top:6px">② 補充 G-code（已有的檔案不用重選）
        <input id="gcode-extra-input" type="file" accept=".gcode,.nc,.tap,.txt" multiple></label>
        <div id="gcode-recovery-files" role="status" style="margin-top:6px;overflow-wrap:anywhere"></div></div>
        <div id="gcode-preview-canvas" style="height:calc(100% - 290px);min-height:180px;position:relative"></div>
        <div id="gcode-preview-player"></div><div id="gcode-preview-info" style="font-size:12px"></div>`;
    document.body.append(dialog);
    const el=id=>document.getElementById(id);
    let view=null,player=null,archive=null,top=true;
    function validate(text) {
        if(typeof text!=='string' || !text.trim())throw Error('G-code 是空的');
        const code=text.replace(/\([^)]*\)|;[^\r\n]*/g,'');
        if(!/\bG0?21\b/i.test(code) || !/\bG0?90\b/i.test(code))throw Error('目前預覽需明確指定 G21 毫米與 G90 絕對座標');
        const supported=new Set([0,1,2,3,17,21,90,94]);
        for(const match of code.matchAll(/G\s*(\d+(?:\.\d+)?)/gi)) {
            if(!supported.has(+match[1]))throw Error(`尚未支援 G${match[1]}，避免顯示錯誤座標`);
        }
        const parsed=GordixPreview.parse(text);
        if(!parsed.moves.length || parsed.moves.some(m=>![m.x,m.y,m.z].every(Number.isFinite)))throw Error('找不到有效刀路');
        return parsed;
    }
    function show(index) {
        player?.pause();
        const file=archive.files[index], parsed=validate(file.gcode);
        if(!view)view=GordixPreview.View3D(el('gcode-preview-canvas'));
        view.resize();view.setMoves(parsed,[]);view.setTop(top);
        player=GordixPreview.Player(parsed).on(state=>view.setProgress(state.n,state.frac));
        GordixPreview.PlayerBar(el('gcode-preview-player'),player,'zh');
        const bounds=parsed.moves.reduce((b,m)=>({minX:Math.min(b.minX,m.x),maxX:Math.max(b.maxX,m.x),minY:Math.min(b.minY,m.y),maxY:Math.max(b.maxY,m.y),minZ:Math.min(b.minZ,m.z),maxZ:Math.max(b.maxZ,m.z)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity});
        el('gcode-preview-info').textContent=`${parsed.moves.length} 段 · X ${bounds.minX.toFixed(3)}～${bounds.maxX.toFixed(3)} · Y ${bounds.minY.toFixed(3)}～${bounds.maxY.toFixed(3)} · Z ${bounds.minZ.toFixed(3)}～${bounds.maxZ.toFixed(3)} mm`;
        el('gcode-preview-canvas').dataset.moves=parsed.moves.length;
    }
    function open(data) {
        if(data?.format!=='gordix-gcode-recovery' || data.version!==1 || !Array.isArray(data.files) || !data.files.length)throw Error('刀路恢復檔格式無效');
        data.files.forEach(file=>{if(typeof file.name!=='string')throw Error('刀路缺少名稱');validate(file.gcode);});
        archive=JSON.parse(JSON.stringify(data));
        renderRecoveryFiles();
        el('gcode-restore-edit').disabled=false;
        el('gcode-restore-edit').title='恢復物件、圖層與可輸出的刀路；缺少原圖時可補選檔案';
        el('gcode-file-select').replaceChildren(...archive.files.map((file,index)=>{const option=document.createElement('option');option.value=index;option.textContent=file.name;return option;}));
        el('gcode-preview-note').textContent=data.note || '原始座標直接預覽；不重新產生刀路。此檔不包含可確認的原始圖層、群組與加工設定。';
        if(!dialog.open)dialog.showModal();show(0);
    }
    el('gcode-file-select').onchange=event=>show(+event.target.value);
    el('gcode-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>player?.pause());
    el('gcode-top').onclick=()=>{top=!top;view?.setTop(top);};
    function renderRecoveryFiles() {
        el('gcode-recovery-files').textContent=`已載入原圖：${(archive.sources || []).map(file=>file.name).join('、') || '尚未選擇'}；刀路：${archive.files.map(file=>file.name).join('、')}`;
    }
    async function addFiles(event,isSource) {
        try {
            const inputs=[...event.target.files];if(!inputs.length)return;
            if(inputs.reduce((sum,file)=>sum+file.size,0)>100*1024*1024)throw Error('檔案合計超過 100 MB');
            const additions=await Promise.all(inputs.map(async file=>isSource ? {name:file.name,data:await file.text()}:{name:file.name,gcode:await file.text()}));
            if(!isSource)additions.forEach(file=>validate(file.gcode));
            archive.sources=archive.sources || [];
            const list=isSource ? archive.sources:archive.files;
            additions.forEach(file=>{const index=list.findIndex(old=>old.name===file.name);if(index>=0)list[index]=file;else list.push(file);});
            renderRecoveryFiles();el('gcode-preview-note').textContent='檔案已加入。確認原圖與兩份刀路後，按「恢復到主編輯區」。';
        }catch(error){el('gcode-preview-note').textContent=`加入失敗：${error.message}`;}
        finally{event.target.value='';}
    }
    el('gcode-source-input').onchange=event=>addFiles(event,true);
    el('gcode-extra-input').onchange=event=>addFiles(event,false);
    function chooseFiles() {
        el('gcode-preview-note').textContent='請選擇可編輯專案 JSON；或同時選取原始 SVG 與雷射、銑刀 G-code。';
        el('gcode-recovery-input').click();
    }
    el('gcode-open-project').onclick=chooseFiles;
    el('gcode-restore-edit').onclick=()=>{
        if(!archive.editableProject && !archive.sources?.length){chooseFiles();return;}
        el('gcode-preview-note').textContent='正在恢復到主編輯區…';
        window.dispatchEvent(new CustomEvent('gordix:recover-toolpaths',{detail:archive}));
    };
    el('gcode-recovery-input').onchange=async event=>{
        try {
            const inputs=[...event.target.files];if(!inputs.length)return;
            if(inputs.reduce((sum,file)=>sum+file.size,0)>100*1024*1024)throw Error('檔案合計超過 100 MB');
            const project=inputs.find(file=>/\.(json|gordix)$/i.test(file.name));
            if(project) {
                const data=JSON.parse(await project.text());
                window.dispatchEvent(new CustomEvent('gordix:recover-toolpaths',{detail:data}));return;
            }
            const data=JSON.parse(JSON.stringify(archive));data.sources=data.sources || [];
            if(inputs.filter(file=>/\.(gcode|nc|tap|txt)$/i.test(file.name)).length>=2)data.files=[];
            for(const file of inputs) {
                const text=await file.text();
                const list=/\.svg$/i.test(file.name) ? data.sources : data.files;
                const item=/\.svg$/i.test(file.name) ? {name:file.name,data:text}:{name:file.name,gcode:text};
                const index=list.findIndex(old=>old.name===file.name);
                if(index>=0)list[index]=item;else list.push(item);
            }
            el('gcode-preview-note').textContent='已讀取檔案，正在核對原圖與刀路…';
            window.dispatchEvent(new CustomEvent('gordix:recover-toolpaths',{detail:data}));
        }catch(error){el('gcode-preview-note').textContent=`恢復失敗：${error.message}`;}
        finally{event.target.value='';}
    };
    el('gcode-archive-save').onclick=()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download='toolpaths.recovery.gordix.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    };
    window.addEventListener('resize',()=>{if(dialog.open)view?.resize();});
    return {open,validate,setMessage(message){el('gcode-preview-note').textContent=message;}};
})();
