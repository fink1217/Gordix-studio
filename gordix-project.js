/* CNC 專案包含原始來源與加工狀態；自動備份使用 IndexedDB，避免圖片塞滿 localStorage。 */
(() => {
    'use strict';
    const panel = document.createElement('section');
    panel.className = 'studio-panel card space-y-2';
    panel.innerHTML = `<div class="label">專案存檔</div><div class="flex gap-2">
        <button id="project-save" class="btn btn-sub">儲存專案</button>
        <button id="project-open" class="btn btn-sub">開啟專案</button></div>
        <button id="gcode-import" class="btn btn-sub w-full">匯入 G-code 預覽</button>
        <input id="gcode-input" type="file" accept=".gcode,.nc,.tap,.txt" multiple hidden>
        <input id="project-input" type="file" accept=".json,.gordix" hidden>
        <button id="project-recover" class="btn btn-sub w-full" hidden>恢復上次工作</button>
        <div id="project-status" class="text-xs" role="status">專案包含原圖、物件位置、群組、圖層、刀具與加工設定。</div>`;
    document.querySelector('.studio-sidebar').prepend(panel);
    const status = message => { $('project-status').textContent = message; };
    const clone = value => JSON.parse(JSON.stringify(value));
    let timer, applying = false, previous = null, queue = Promise.resolve();

    function capture() {
        return clone({format:'gordix-cnc-project',version:1,savedAt:new Date().toISOString(),
            job, tools, sources:[...sources.values()], sourceId:source?.id,
            workspace:{stock,tableId,table,tableConfigured},layout:layoutOpts,
            counters:{layerSeq,groupSeq,sourceSeq,objectSeq}, selectionRotation});
    }

    function validate(data) {
        if (data?.format !== 'gordix-cnc-project' || data.version !== 1) throw Error('不支援的專案格式或版本');
        function finite(value) {
            if (typeof value === 'number' && !Number.isFinite(value)) throw Error('專案含無效數值');
            if (value && typeof value === 'object') Object.entries(value).forEach(([key,item]) => {
                if (['__proto__','constructor','prototype'].includes(key)) throw Error('專案含無效欄位');
                finite(item);
            });
        }
        finite(data);
        const j=data.job, w=data.workspace;
        if (!j || !Array.isArray(j.objects) || !Array.isArray(j.layers) || !Array.isArray(data.tools) || !Array.isArray(data.sources)
            || !w?.table || !w.stock || !(w.stock.t>0) || !(j.safeZ>=0.5) || !(j.resolution>=0.05) || !(j.overcut>=0)) throw Error('專案資料不完整');
        const ids = rows => {
            const set=new Set(rows.map(row=>row.id));
            if (set.size!==rows.length || rows.some(row=>row.id==null)) throw Error('專案識別碼重複或缺漏');
            return set;
        };
        const layers=ids(j.layers), toolIds=ids(data.tools), sourceIds=ids(data.sources);ids(j.objects);
        data.sources.forEach(src=>{if(typeof src.data!=='string' || !['svg','dxf','png','jpg','jpeg','bmp','webp'].includes(src.ext)) throw Error('原始圖檔資料不完整');});
        data.tools.forEach(t=>{if(!['flat','vbit','ball'].includes(t.type) || !(t.d>0) || !(t.f>0) || !(t.step>0)) throw Error('刀具參數無效');});
        j.layers.forEach(layer=>{if(!OPS.includes(layer.op) || (!isLaserOp(layer.op) && !toolIds.has(layer.toolId))) throw Error('圖層加工設定無效');});
        j.objects.forEach(obj=>{
            if (!layers.has(obj.layerId) || !sourceIds.has(obj.sourceId) || !Array.isArray(obj.points) || obj.points.length<2
                || obj.points.some(p=>typeof p.x!=='number' || typeof p.y!=='number')) throw Error('物件座標或圖層關係無效');
        });
        if (!data.counters || !data.layout) throw Error('專案缺少群組與放樣設定');
        ['layerSeq','groupSeq','sourceSeq','objectSeq'].forEach(key=>{
            if (!Number.isSafeInteger(data.counters[key]) || data.counters[key]<0) throw Error('專案計數器無效');
        });
        // 預先建立刀路，失敗時尚未變更目前工作。
        GordixCam.buildFiles(clone(j),clone(data.tools));
        return data;
    }

    function install(data) {
        clearTimeout(importTimer); importVersion++;
        Object.keys(job).forEach(key=>delete job[key]);Object.assign(job,clone(data.job));
        tools=clone(data.tools);
        ({stock,tableId,table,tableConfigured}=clone(data.workspace));
        range=GordixTable.workRange(table);boardPoly=stock.on ? GordixTable.boardShape(table,stock):null;
        boardCenter=GordixTable.boardMid(table,stock);
        sources.clear();sourceData.clear();
        data.sources.forEach(src=>{sources.set(src.id,clone(src));sourceData.set(src.id,src.data);});
        source=sources.get(data.sourceId) || [...sources.values()].at(-1) || null;
        ({layerSeq,groupSeq,sourceSeq,objectSeq}=data.counters);
        selectionRotation=clone(data.selectionRotation || {key:'',angle:0});
        Object.assign(layoutOpts,data.layout);
        selObjs.clear();expanded.clear();selLayerId=job.layers[0]?.id || null;
        $('overcut').value=job.overcut;$('safe-z').value=job.safeZ;$('resolution').value=job.resolution;
        $('route-mode').value=job.routing;
        syncSource();rebuild(false);fitView();
    }

    async function open(data) {
        if (importBusy || sourcePending) throw Error('請等候圖片匯入或重新解析完成');
        validate(data);
        const before=capture();applying=true;
        try {install(data);} catch(error) {install(before);throw error;} finally {applying=false;}
        history.stack=[];history.index=-1;commit();
        await backup();
        status('已恢復完整專案；毛胚與工作台使用存檔內設定。');
    }

    const database = new Promise((resolve,reject) => {
        const request=indexedDB.open('gordix-projects',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('projects');
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
    });
    async function store(mode, value) {
        const db=await database;
        return new Promise((resolve,reject)=>{
            const transaction=db.transaction('projects',mode), table=transaction.objectStore('projects');
            const request=mode==='readonly' ? table.get('cnc-latest') : table.put(value,'cnc-latest');
            transaction.oncomplete=()=>resolve(request.result);
            transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
        });
    }
    function backup() {
        const data=capture();
        queue=queue.catch(()=>{}).then(()=>store('readwrite',data));
        return queue.then(()=>status(`已自動備份 ${new Date(data.savedAt).toLocaleTimeString()}`));
    }
    window.addEventListener('gordix:change',()=>{
        if(applying) return;
        clearTimeout(timer);timer=setTimeout(()=>{
            if(importBusy || sourcePending) return;
            backup().catch(()=>status('自動備份失敗，請使用「儲存專案」下載檔案。'));
        },700);
    });
    store('readonly').then(data=>{
        if(!data) return;
        previous=data;$('project-recover').hidden=false;
        status(`找到上次備份：${new Date(data.savedAt).toLocaleString()}`);
    }).catch(()=>status('瀏覽器無法備份，請使用「儲存專案」下載檔案。'));
    $('project-recover').onclick=async()=>{
        try{await open(previous);$('project-recover').hidden=true;}catch(error){status(error.message);}
    };
    $('project-open').onclick=()=>$('project-input').click();
    $('project-input').onchange=async event=>{
        const file=event.target.files[0];if(!file)return;
        try {
            if(file.size>100*1024*1024)throw Error('專案超過 100 MB');
            const data=JSON.parse(await file.text());
            if(data.format==='gordix-gcode-recovery')GordixGcodePreview.open(data);
            else await open(data);
        }catch(error){status(`開啟失敗：${error.message}`);}finally{event.target.value='';}
    };
    $('gcode-import').onclick=()=>$('gcode-input').click();
    $('gcode-input').onchange=async event=>{
        try {
            const inputs=[...event.target.files];
            if(!inputs.length)return;
            if(inputs.reduce((sum,file)=>sum+file.size,0)>100*1024*1024)throw Error('檔案合計超過 100 MB');
            const imported=await Promise.all(inputs.map(async file=>({name:file.name,gcode:await file.text()})));
            GordixGcodePreview.open({format:'gordix-gcode-recovery',version:1,files:imported});
        }catch(error){status(`預覽失敗：${error.message}`);}finally{event.target.value='';}
    };
    $('project-save').onclick=async()=>{
        document.activeElement?.blur();
        // 等待數字欄位提交與圖片重新取樣，避免儲存到一半的輸入。
        await new Promise(resolve=>setTimeout(resolve,700));
        if(importBusy || sourcePending){status('圖片仍在匯入或重新解析，完成後請再儲存。');return;}
        try {
            const data=capture();validate(data);
            const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
            const link=document.createElement('a');link.href=url;
            link.download=`${job.name.replace(/[\\/:*?"<>|]/g,'_') || 'job'}.gordix.json`;link.click();
            setTimeout(()=>URL.revokeObjectURL(url),30000);status('已下載完整專案；請保留此檔以便下次開啟。');
        }catch(error){status(`儲存失敗：${error.message}`);}
    };
})();
