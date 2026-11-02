/* 將含原圖的舊刀路封存檔升級為可編輯專案；只接受能核對的三種加工圖層。 */
window.GordixRecoverImport=(()=>{
    const point=(p,m)=>({x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f});
    function register(paths,segments) {
        const grid=new Map(),cell=.01;
        const key=(x,y)=>`${x},${y}`;
        segments.flat().forEach(p=>{
            const k=key(Math.floor(p.x/cell),Math.floor(p.y/cell));
            if(!grid.has(k))grid.set(k,[]);grid.get(k).push(p);
        });
        function nearest(p) {
            let best=null,distance=Infinity;
            const x=Math.floor(p.x/cell),y=Math.floor(p.y/cell);
            for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of grid.get(key(x+i,y+j)) || []) {
                const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<distance){best=q;distance=d;}
            }
            return {p:best,d:distance};
        }
        const length=pair=>Math.hypot(pair[1].x-pair[0].x,pair[1].y-pair[0].y);
        const base=paths.reduce((a,b)=>length(a)>length(b)?a:b),size=length(base);
        let best=null;
        for(const target of segments.filter(pair=>Math.abs(length(pair)-size)<.01))for(const pair of [target,[target[1],target[0]]]) {
            const angle=Math.atan2(pair[1].y-pair[0].y,pair[1].x-pair[0].x)-Math.atan2(base[1].y-base[0].y,base[1].x-base[0].x);
            let m={a:Math.cos(angle),b:Math.sin(angle),c:-Math.sin(angle),d:Math.cos(angle),e:0,f:0};
            const origin=point(base[0],m);m.e=pair[0].x-origin.x;m.f=pair[0].y-origin.y;
            const input=paths.flat();let matches=input.map(p=>nearest(point(p,m)));
            if(matches.some(match=>match.d>.005))continue;
            const center=list=>list.reduce((a,p)=>({x:a.x+p.x/list.length,y:a.y+p.y/list.length}),{x:0,y:0});
            const a=center(input),b=center(matches.map(match=>match.p));let dot=0,cross=0;
            input.forEach((p,index)=>{const q=matches[index].p;dot+=(p.x-a.x)*(q.x-b.x)+(p.y-a.y)*(q.y-b.y);cross+=(p.x-a.x)*(q.y-b.y)-(p.y-a.y)*(q.x-b.x);});
            const theta=Math.atan2(cross,dot);m={a:Math.cos(theta),b:Math.sin(theta),c:-Math.sin(theta),d:Math.cos(theta),e:0,f:0};
            const c=point(a,m);m.e=b.x-c.x;m.f=b.y-c.y;
            const error=Math.max(...input.map(p=>nearest(point(p,m)).d));
            if(error<.002 && (!best || error<best.error))best={matrix:m,error};
        }
        return best;
    }
    function segmentDistance(p,a,b) {
        const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y;
        const t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;
        return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);
    }
    function verifyGeometry(project,referenceFiles) {
        const rebuilt=GordixCam.buildFiles(project.job,project.tools),cell=4,tolerance=.02;
        function strokes(text) {
            const result=[];let path=null,last={x:0,y:0};
            GordixPreview.parse(text).moves.forEach(move=>{
                if(move.down) {
                    if(!path){path={points:[last],z:new Set(),f:new Set()};result.push(path);}
                    path.points.push(move);path.z.add(move.z.toFixed(3));path.f.add(move.f);
                }else path=null;
                last=move;
            });
            return result;
        }
        function index(points) {
            const grid=new Map(),seen=new Set();
            for(let i=1;i<points.length;i++) {
                const a=points[i-1],b=points[i],id=`${a.x},${a.y},${b.x},${b.y}`;
                if(seen.has(id))continue;seen.add(id);
                const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/cell));
                const keys=new Set();
                for(let n=0;n<=count;n++)keys.add(`${Math.floor((a.x+(b.x-a.x)*n/count)/cell)},${Math.floor((a.y+(b.y-a.y)*n/count)/cell)}`);
                for(const key of keys){if(!grid.has(key))grid.set(key,[]);grid.get(key).push([a,b]);}
            }
            return grid;
        }
        function check(a,b) {
            const grid=index(b),seen=new Set();
            for(let i=1;i<a.length;i++) {
                const start=a[i-1],end=a[i],count=Math.max(2,Math.ceil(Math.hypot(end.x-start.x,end.y-start.y)/2));
                for(let n=0;n<=count;n++) {
                    const p={x:start.x+(end.x-start.x)*n/count,y:start.y+(end.y-start.y)*n/count},id=`${p.x},${p.y}`;
                    if(seen.has(id))continue;seen.add(id);
                    const x=Math.floor(p.x/cell),y=Math.floor(p.y/cell);let found=false;
                    for(let dx=-1;dx<=1 && !found;dx++)for(let dy=-1;dy<=1 && !found;dy++) {
                        found=(grid.get(`${x+dx},${y+dy}`) || []).some(([u,v])=>segmentDistance(p,u,v)<=tolerance);
                    }
                    if(!found)throw Error('原圖重算的挖槽或外輪廓與既有刀路不符，已保留目前專案。');
                }
            }
        }
        if(rebuilt.length!==referenceFiles.length)throw Error('加工檔數量不符，無法恢復');
        rebuilt.forEach((file,index)=>{
            const a=strokes(file.gcode),b=strokes(referenceFiles[index].gcode);
            if(a.length!==b.length)throw Error('加工階段或順序無法核對，未套用恢復。');
            a.forEach((stroke,i)=>{
                const signature=set=>JSON.stringify([...set].sort());
                if(signature(stroke.z)!==signature(b[i].z) || signature(stroke.f)!==signature(b[i].f))throw Error('切深或走速無法核對，未套用恢復。');
                check(stroke.points,b[i].points);check(b[i].points,stroke.points);
            });
        });
    }
    async function convert(data,workspace) {
        if(data.editableProject?.format==='gordix-cnc-project')return data.editableProject;
        if(!Array.isArray(data.sources) || !data.sources.length)throw Error('這份封存檔沒有原圖，不能還原可編輯物件；請開啟完整專案檔。');
        const laser=data.files.find(file=>/Tool: laser/i.test(file.gcode));
        const router=data.files.find(file=>/Tool: flat end mill D[\d.]+/i.test(file.gcode));
        if(!laser || !router || data.files.length!==2)throw Error('目前舊檔升級需要雷射與平刀兩份刀路。');
        data.files.forEach(file=>GordixGcodePreview.validate(file.gcode));
        const segments=[];let previous={x:0,y:0};
        GordixPreview.parse(laser.gcode).moves.forEach(move=>{if(move.down)segments.push([previous,{x:move.x,y:move.y}]);previous={x:move.x,y:move.y};});
        const candidates=[];
        for(const source of data.sources) {
            if(!/\.svg$/i.test(source.name))continue;
            const targetW=GordixImport.realWidth(source.data,'svg');
            const paths=GordixImport.load(source.data,'svg',{targetW,smooth:.1});
            const closed=paths.filter(path=>path.closed),lines=paths.filter(path=>!path.closed && path.points.length===2);
            if(closed.length!==2 || !lines.length)continue;
            const fit=register(lines.map(path=>path.points),segments);
            if(fit)candidates.push({...source,targetW,paths,fit});
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!candidates.length || candidates.reduce((n,src)=>n+src.paths.filter(path=>!path.closed).length,0)!==segments.length)throw Error('原圖無法完整對上雷射刀路，已保留目前專案。');
        const code=router.gcode.split(/\r?\n/),boundaries=[];
        code.forEach((line,index)=>{if(/^G0 Z/.test(line))boundaries.push(index);});
        const sections=boundaries.slice(0,-1).map((start,index)=>{
            const end=boundaries[index+1],rows=code.slice(start,end);
            const plunges=rows.filter(line=>/^G1 Z-/.test(line)).map(line=>+line.match(/ Z(-?[\d.]+)/)[1]);
            return {start,end,rows,plunges,depth:Math.max(0,...plunges.map(z=>-z))};
        });
        const maxDepth=Math.max(...sections.map(section=>section.depth)),thickness=Math.floor(maxDepth+.000001);
        const contours=sections.filter(section=>section.plunges.length>1 && section.depth===maxDepth);
        const pocketDepth=Math.max(...sections.filter(section=>section.depth<maxDepth).map(section=>section.depth));
        if(contours.length!==candidates.length || !(pocketDepth>0) || !(thickness>0))throw Error('無法確認各物件加工階段，未變更目前專案。');
        const diameter=+router.gcode.match(/Tool: flat end mill D([\d.]+)/i)[1];
        const feed=+code.find(line=>/^G1 X.* F/.test(line)).match(/ F([\d.]+)/)[1];
        const step=Math.min(...sections.flatMap(section=>section.plunges).map(z=>-z));
        const safeZ=+code.find(line=>/^G0 Z[\d.]+/.test(line)).match(/ Z([\d.]+)/)[1];
        const laserFeed=+laser.gcode.match(/G1[^\r\n]* F([\d.]+)/)[1];
        const power=+laser.gcode.match(/M0?3 S([\d.]+)/)[1];
        const project={format:'gordix-cnc-project',version:1,savedAt:new Date().toISOString(),
            job:{name:'composition_restored',thickness,overcut:+(maxDepth-thickness).toFixed(6),safeZ,resolution:.1,rapidFeed:null,routing:'center',layers:[],objects:[]},
            tools:[{id:'recovered-flat',type:'flat',d:diameter,f:feed,step,flutes:2,cut:'downcut',overlap:.5}],
            sources:[],workspace:JSON.parse(JSON.stringify(workspace)),layout:{on:false,outlines:true,crosses:true,numbers:true,head:'pen'},
            counters:{layerSeq:0,groupSeq:0,sourceSeq:0,objectSeq:0},selectionRotation:{key:'',angle:0}};
        project.workspace.stock.t=thickness;project.workspace.stock.on=false;
        const job=project.job,c=project.counters;
        candidates.forEach(src=>{
            const id=++c.sourceSeq,matrix=src.fit.matrix,groupId='G'+ ++c.groupSeq;
            project.sources.push({id,name:src.name,data:src.data,ext:'svg',isBitmap:false,targetW:src.targetW,smooth:.1,threshold:128,groupMode:'color'});
            const closed=src.paths.filter(path=>path.closed);
            const area=path=>{const b=GordixCam.boundsOf(path.points);return(b.maxX-b.minX)*(b.maxY-b.minY);};
            const outer=area(closed[0])>area(closed[1])?closed[0]:closed[1];
            const layers=new Map();
            [['outer','外輪廓','profile',maxDepth],['pocket','挖槽','pocket',pocketDepth],['laser','雷射畫線','laserLine',0]].forEach(([key,name,op,depth])=>{
                const layer={id:'L'+c.layerSeq++,sourceId:id,key: key==='outer'?outer.color:key==='pocket'?closed.find(path=>path!==outer).color:src.paths.find(path=>!path.closed).color,
                    name:src.name+' · '+name,color:key==='outer'?'#ff0000':key==='pocket'?'#00a000':'#0000ff',visible:true,op,depth,through:key==='outer',tabs:key==='outer',tabHeight:1.8,toolId:'recovered-flat',laserPct:power/255*100,feed:laserFeed,laserPasses:1};
                job.layers.push(layer);layers.set(key,layer);
            });
            src.paths.forEach((path,pathIndex)=>job.objects.push({id:++c.objectSeq,sourceId:id,pathIndex,closed:path.closed,layerId:layers.get(path===outer?'outer':path.closed?'pocket':'laser').id,
                groupId,matrix:{...matrix},points:path.points.map(p=>point(p,matrix))}));
        });
        const profiles=contours.map(section=>{
            const xy=section.rows.find(line=>/^G0 X/.test(line)).match(/X(-?[\d.]+) Y(-?[\d.]+)/),start={x:+xy[1],y:+xy[2]};
            const shapes=job.objects.filter(object=>job.layers.find(layer=>layer.id===object.layerId).op==='profile');
            const best=shapes.map(shape=>({shape,d:Math.min(...shape.points.slice(1).map((p,index)=>segmentDistance(start,shape.points[index],p)))})).sort((a,b)=>a.d-b.d)[0];
            if(Math.abs(best.d-diameter/2)>.02)throw Error('銑刀輪廓與原圖位置不符，未套用恢復。');
            const finalStart=section.rows.findLastIndex(line=>/^G1 Z-/.test(line));
            const levels=section.rows.slice(finalStart+1).flatMap(line=>/ X.* Z(-?[\d.]+)/.test(line)?[+line.match(/ Z(-?[\d.]+)/)[1]]:[]);
            if(!levels.length)throw Error('無法確認原刀路橋位高度');
            const tabTop=Math.max(...levels),layer=job.layers.find(layer=>layer.id===best.shape.layerId);layer.tabHeight=+(thickness+tabTop).toFixed(6);
            return {layerId:layer.id,start:section.start,end:section.end,tabTop,tabs:true,tabHeight:layer.tabHeight};
        });
        if(new Set(profiles.map(profile=>profile.layerId)).size!==contours.length)throw Error('輪廓對位重複，未套用恢復。');
        verifyGeometry(project,[laser,router]);
        job.recovery={version:1,fingerprint:GordixRecovered.fingerprint(job,project.tools),files:[
            {head:'laser',toolId:null,gcode:laser.gcode,profiles:[]},
            {head:'router',toolId:'recovered-flat',gcode:router.gcode,profiles}]};
        project.sourceId=project.sources[0].id;
        return project;
    }
    return {convert};
})();
