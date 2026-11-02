/* 反推專案保留原始輸出；單獨調橋位時只重建原輪廓各刀次的高度。 */
(function (root) {
    'use strict';
    function fingerprint(job,tools) {
        const clean=JSON.parse(JSON.stringify(job));
        delete clean.recovery;delete clean.issues;
        clean.layers.forEach(layer=>{delete layer.tabs;delete layer.tabHeight;delete layer.hidden;delete layer.name;});
        clean.objects.forEach(object=>{delete object.hidden;delete object.name;delete object.groupId;});
        return JSON.stringify({job:clean,tools});
    }
    function updateProfile(lines,profile,layer,thickness) {
        const original=lines.slice(profile.start,profile.end);
        const starts=[];
        original.forEach((line,index)=>{if(/^G1 Z-[\d.]+ F[\d.]+$/.test(line))starts.push(index);});
        if(starts.length<2)throw Error('恢復輪廓缺少分層資料');
        const template=original.slice(starts.at(-1)+1);
        if(template.some(line=>!/^G1 X-?[\d.]+ Y-?[\d.]+(?: Z-?[\d.]+)?(?: F[\d.]+)?$/.test(line)))throw Error('恢復輪廓含未支援指令');
        const top=layer.tabs ? -(thickness-layer.tabHeight) : -Infinity;
        if(layer.tabs && !(layer.tabHeight>0 && layer.tabHeight<=thickness))throw Error('橋位保留厚度無效');
        const result=original.slice(0,starts[0]);
        starts.forEach((start,index)=>{
            const depth=+original[start].match(/ Z(-?[\d.]+)/)[1];
            const end=starts[index+1] ?? original.length;
            result.push(original[start]);
            if(depth>=top && !original.slice(start+1,end).some(line=>/ Z/.test(line))) {
                result.push(...original.slice(start+1,end));return;
            }
            // 沿用末刀的原始 XY 分段與橋位範圍，走速保持原字串。
            result.push(...template.map(line=>line.replace(/ Z(-?[\d.]+)/g,(_,z)=>{
                if(depth>=top)return '';
                return ` Z${(+z===profile.tabTop ? top : depth).toFixed(3)}`;
            })));
        });
        return result;
    }
    function apply(files,job,tools) {
        const recovery=job.recovery;
        if(!recovery)return files;
        if(recovery.version!==1 || !Array.isArray(recovery.files))throw Error('反推專案的原始刀路資料無效');
        if(fingerprint(job,tools)!==recovery.fingerprint) {
            return files.map(file=>({...file,recoveryMode:'rebuilt'}));
        }
        return files.map(file=>{
            const ref=recovery.files.find(item=>item.head===file.head && (item.toolId || null)===(file.tool?.id || null));
            if(!ref)throw Error('反推專案缺少對應刀路');
            const changes=(ref.profiles || []).filter(profile=>{
                const layer=job.layers.find(item=>item.id===profile.layerId);
                if(!layer)throw Error('反推輪廓圖層不存在');
                return layer.tabs!==profile.tabs || layer.tabHeight!==profile.tabHeight;
            });
            if(!changes.length)return decorate({...file,gcode:ref.gcode,recoveryMode:'original'},ref,job);
            const newline=ref.gcode.includes('\r\n') ? '\r\n':'\n';
            const lines=ref.gcode.split(/\r?\n/);
            changes.sort((a,b)=>b.start-a.start).forEach(profile=>{
                const layer=job.layers.find(item=>item.id===profile.layerId);
                lines.splice(profile.start,profile.end-profile.start,...updateProfile(lines,profile,layer,job.thickness));
            });
            return decorate({...file,gcode:lines.join(newline),recoveryMode:'tabs'},ref,job);
        });
    }
    function decorate(file,reference,job) {
        if(typeof GordixPreview==='undefined')return file;
        const parsed=GordixPreview.parse(file.gcode), paths=new Map();
        const profiles=(reference.profiles || []).slice().sort((a,b)=>a.start-b.start);
        // 依輸出中的安全高度抬刀與多刀次輪廓識別圖層，不使用重算的輪廓座標。
        const sections=[];
        parsed.lines.forEach((line,index)=>{if(/^G0 Z/.test(line))sections.push(index);});
        const ranges=[];let profileIndex=0;
        sections.forEach((start,index)=>{
            const end=sections[index+1] ?? parsed.lines.length;
            const cuts=parsed.lines.slice(start,end).filter(line=>/^G1 Z-/.test(line));
            const depth=cuts.reduce((value,line)=>Math.min(value,+line.match(/ Z(-?[\d.]+)/)[1]),0);
            if(cuts.length>1 && depth<=-(job.thickness+job.overcut)+1e-6 && profileIndex<profiles.length) {
                ranges.push({start,end,profile:profiles[profileIndex++]});
            }
        });
        const layerAt=line=>{
            const current=ranges.find(range=>line>=range.start && line<range.end);
            if(current)return current.profile.layerId;
            const next=ranges.find(range=>line<range.start);
            const outer=next && job.layers.find(layer=>layer.id===next.profile.layerId);
            return outer && job.layers.find(layer=>layer.sourceId===outer.sourceId && layer.op==='pocket')?.id;
        };
        let last={x:0,y:0,z:0,down:false},stroke=-1,path=null,unit=null;
        parsed.moves.forEach(move=>{
            if(move.down) {
                if(!last.down) {
                    stroke++;
                    unit=file.head==='laser' ? file.units[stroke] : file.units.find(item=>item.layerId===layerAt(move.line));
                    path=[{x:last.x,y:last.y}];
                    if(unit){if(!paths.has(unit))paths.set(unit,[]);paths.get(unit).push(path);}
                }
                path?.push({x:move.x,y:move.y});
            }
            last=move;
        });
        const markers=[];
        ranges.forEach(({start,end,profile})=>{
            const layer=job.layers.find(item=>item.id===profile.layerId);
            if(!layer.tabs)return;
            const rows=parsed.moves.filter(move=>move.line>=start && move.line<end);
            const bottom=rows.reduce((value,move)=>Math.min(value,move.z),0),top=-(job.thickness-layer.tabHeight);
            // 最深的一圈才是完整橋位，較淺刀次的同一橋位不重複標示。
            let window=null,previous=null;
            rows.forEach(move=>{
                if(move.z===top && previous?.z===bottom)window=[previous,move];
                else if(window) {
                    window.push(move);
                    if(move.z===bottom) {
                        const lengths=window.slice(1).map((p,i)=>Math.hypot(p.x-window[i].x,p.y-window[i].y));
                        let half=lengths.reduce((sum,length)=>sum+length,0)/2;
                        for(let i=0;i<lengths.length;i++) {
                            if(half>lengths[i]){half-=lengths[i];continue;}
                            const a=window[i],b=window[i+1],ratio=lengths[i] ? half/lengths[i]:0;
                            const native=file.units.find(item=>item.layerId===layer.id);
                            markers.push({x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,z:top,height:layer.tabHeight,
                                radius:(6+(file.tool?.d || 0))/2,layerId:layer.id,objectIds:native?.objectIds || []});
                            break;
                        }
                        window=null;
                    }
                }
                previous=move;
            });
        });
        let rapidMm=0;last={x:0,y:0};
        parsed.moves.forEach(move=>{if(move.f===null)rapidMm+=Math.hypot(move.x-last.x,move.y-last.y);last=move;});
        return {...file,moves:parsed.moves,seconds:GordixPreview.Player(parsed).state().total,
            displayUnits:[...paths].map(([base,points])=>({...base,phases:[{paths:points}]})),recoveredMarkers:markers,
            routing:{mode:job.routing,baselineMm:rapidMm,optimizedMm:rapidMm,savedMm:0,savedPct:0}};
    }
    const api={fingerprint,apply};
    if(typeof module!=='undefined' && module.exports)module.exports=api;
    else root.GordixRecovered=api;
})(typeof globalThis!=='undefined' ? globalThis:this);
