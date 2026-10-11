// 讀檔：SVG / DXF / 點陣圖 → 路徑清單 { points, layer, color }。
// 座標單位 mm、Y 朝上、以整體外框中心為原點（與舊 CNC.html 相同）。
// 解析演算法原樣搬自 CNC.html，輸出必須與舊版逐點相同；新增的只有線條顏色與分組。
const GordixImport = (() => {
    // --- 以下原樣搬自 CNC.html ---

    function tracePath(sx, sy, w, h, isBlack, visited){
        const path = []; let cx = sx, cy = sy;
        const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
        let d = 7;
        for(let i=0; i<30000; i++){
            visited[cy*w+cx] = 1; path.push({x:cx, y:cy});
            let found = false;
            for(let j=0; j<8; j++){
                let nd = (d+j)%8, nx = cx+dirs[nd][0], ny = cy+dirs[nd][1];
                if(isBlack(nx, ny)){ cx = nx; cy = ny; d = (nd+5)%8; found = true; break; }
            }
            if(!found || (cx === sx && cy === sy && path.length > 5)) break;
        }
        return path;
    }

    function laplacianSmooth(points, iterations = 3) {
        if (points.length < 3) return points;
        let current = JSON.parse(JSON.stringify(points));
        for (let iter = 0; iter < iterations; iter++) {
            let next = JSON.parse(JSON.stringify(current));
            for (let i = 1; i < current.length - 1; i++) {
                next[i].x = 0.5 * current[i].x + 0.25 * (current[i - 1].x + current[i + 1].x);
                next[i].y = 0.5 * current[i].y + 0.25 * (current[i - 1].y + current[i + 1].y);
            }
            current = next;
        }
        return current;
    }

    // DP 折線簡化演算法
    function simplifyPath(points, tolerance) {
        if (points.length <= 2) return points;
        let maxSqDist = 0, index = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const sqDist = getSqSegDist(points[i], points[0], points[points.length - 1]);
            if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
        }
        if (maxSqDist > tolerance * tolerance) {
            const res1 = simplifyPath(points.slice(0, index + 1), tolerance);
            const res2 = simplifyPath(points.slice(index), tolerance);
            return res1.slice(0, res1.length - 1).concat(res2);
        }
        return [points[0], points[points.length - 1]];
    }

    function getSqSegDist(p, p1, p2) {
        let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) { x = p2.x; y = p2.y; }
            else if (t > 0) { x += dx * t; y += dy * t; }
        }
        dx = p.x - x; dy = p.y - y;
        return dx * dx + dy * dy;
    }

    function parseBitmap(dataUrl, targetW, smoothTol, threshold) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width; canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const w = canvas.width, h = canvas.height;
                const visited = new Uint8Array(w * h);
                const mmScale = targetW / w;

                const isBlack = (x, y) => {
                    if(x < 1 || y < 1 || x >= w-1 || y >= h-1) return false;
                    const i = (y * w + x) * 4;
                    const gray = imgData.data[i] * 0.299 + imgData.data[i+1] * 0.587 + imgData.data[i+2] * 0.114;
                    return gray < threshold;
                };

                let paths = [];
                for(let y=1; y<h-1; y++){
                    for(let x=1; x<w-1; x++){
                        if(isBlack(x,y) && !visited[y*w+x]){
                            let edge = false;
                            for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++) if(!isBlack(x+dx, y+dy)) edge = true;
                            if(edge){
                                const path = tracePath(x, y, w, h, isBlack, visited);
                                if(path.length > 10){
                                    const mmPoints = path.map(p => ({ x: p.x * mmScale, y: (h - p.y) * mmScale }));
                                    const smoothed = laplacianSmooth(mmPoints, 3);
                                    paths.push(simplifyPath(smoothed, smoothTol));
                                }
                            } else visited[y*w+x] = 1;
                        }
                    }
                }
                resolve({ paths, canvas });
            };
            img.src = dataUrl;
        });
    }

    function splitSVGPathToSubpaths(dAttr) {
        if (!dAttr) return [];
        
        const cmdRegex = /([a-zA-Z])([^a-zA-Z]*)/g;
        let match;
        const commands = [];
        
        function parseNumbers(str) {
            if (!str) return [];
            const matches = str.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
            return matches ? matches.map(Number) : [];
        }

        while ((match = cmdRegex.exec(dAttr)) !== null) {
            commands.push({
                cmd: match[1],
                args: parseNumbers(match[2]),
                rawArgs: match[2]
            });
        }

        if (commands.length === 0) return [];

        let currentX = 0, currentY = 0;
        let startX = 0, startY = 0;
        const subpathStrings = [];
        let currentSubpathTokens = [];

        commands.forEach(item => {
            let { cmd, args, rawArgs } = item;
            const upper = cmd.toUpperCase();
            const isRel = (cmd === cmd.toLowerCase());

            if (upper === 'M') {
                if (currentSubpathTokens.length > 0) {
                    subpathStrings.push(currentSubpathTokens.join(' '));
                    currentSubpathTokens = [];
                }

                if (args.length >= 2) {
                    let firstX = isRel ? currentX + args[0] : args[0];
                    let firstY = isRel ? currentY + args[1] : args[1];

                    currentX = firstX;
                    currentY = firstY;
                    startX = firstX;
                    startY = firstY;

                    let tokenStr = `M ${firstX} ${firstY}`;

                    if (args.length > 2) {
                        const extraArgs = args.slice(2);
                        if (isRel) {
                            tokenStr += ` l ${extraArgs.join(' ')}`;
                            for (let i = 0; i < extraArgs.length; i += 2) {
                                if (i + 1 < extraArgs.length) {
                                    currentX += extraArgs[i];
                                    currentY += extraArgs[i + 1];
                                }
                            }
                        } else {
                            tokenStr += ` L ${extraArgs.join(' ')}`;
                            if (extraArgs.length >= 2) {
                                currentX = extraArgs[extraArgs.length - 2];
                                currentY = extraArgs[extraArgs.length - 1];
                            }
                        }
                    }
                    currentSubpathTokens.push(tokenStr);
                }
            } else {
                currentSubpathTokens.push(`${cmd}${rawArgs}`);

                if (upper === 'Z') {
                    currentX = startX;
                    currentY = startY;
                } else if (upper === 'L') {
                    if (args.length >= 2) {
                        if (isRel) {
                            for (let i = 0; i < args.length; i += 2) {
                                if (i + 1 < args.length) {
                                    currentX += args[i];
                                    currentY += args[i + 1];
                                }
                            }
                        } else {
                            currentX = args[args.length - 2];
                            currentY = args[args.length - 1];
                        }
                    }
                } else if (upper === 'H') {
                    if (args.length >= 1) {
                        if (isRel) args.forEach(val => currentX += val);
                        else currentX = args[args.length - 1];
                    }
                } else if (upper === 'V') {
                    if (args.length >= 1) {
                        if (isRel) args.forEach(val => currentY += val);
                        else currentY = args[args.length - 1];
                    }
                } else if (upper === 'C') {
                    if (args.length >= 6) {
                        if (isRel) {
                            for (let i = 0; i < args.length; i += 6) {
                                if (i + 5 < args.length) {
                                    currentX += args[i + 4];
                                    currentY += args[i + 5];
                                }
                            }
                        } else {
                            currentX = args[args.length - 2];
                            currentY = args[args.length - 1];
                        }
                    }
                } else if (upper === 'S' || upper === 'Q') {
                    if (args.length >= 4) {
                        if (isRel) {
                            for (let i = 0; i < args.length; i += 4) {
                                if (i + 3 < args.length) {
                                    currentX += args[i + 2];
                                    currentY += args[i + 3];
                                }
                            }
                        } else {
                            currentX = args[args.length - 2];
                            currentY = args[args.length - 1];
                        }
                    }
                } else if (upper === 'T') {
                    if (args.length >= 2) {
                        if (isRel) {
                            for (let i = 0; i < args.length; i += 2) {
                                if (i + 1 < args.length) {
                                    currentX += args[i];
                                    currentY += args[i + 1];
                                }
                            }
                        } else {
                            currentX = args[args.length - 2];
                            currentY = args[args.length - 1];
                        }
                    }
                } else if (upper === 'A') {
                    if (args.length >= 7) {
                        if (isRel) {
                            for (let i = 0; i < args.length; i += 7) {
                                if (i + 6 < args.length) {
                                    currentX += args[i + 5];
                                    currentY += args[i + 6];
                                }
                            }
                        } else {
                            currentX = args[args.length - 2];
                            currentY = args[args.length - 1];
                        }
                    }
                }
            }
        });

        if (currentSubpathTokens.length > 0) {
            subpathStrings.push(currentSubpathTokens.join(' '));
        }

        return subpathStrings;
    }

    function parseSVG(svgString, targetW, smoothTol) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) return [];

        // 建立隱藏 DOM 容器以讓瀏覽器 SVG 引擎計算 transform/CTM 與 getPointAtLength
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.visibility = 'hidden';
        document.body.appendChild(tempContainer);
        tempContainer.appendChild(svgEl);

        const paths = [];
        const elements = svgEl.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon');
        
        function getSVGLayer(el) {
            let parent = el.parentElement;
            while (parent && parent.tagName.toLowerCase() !== 'svg') {
                if (parent.tagName.toLowerCase() === 'g') {
                    let label = parent.getAttribute('inkscape:label') || parent.getAttribute('id') || parent.getAttribute('class');
                    if (label) return label;
                }
                parent = parent.parentElement;
            }
            return "Default";
        }

        elements.forEach(el => {
            const type = el.tagName.toLowerCase();
            let ctm = null;
            try {
                ctm = el.getCTM();
            } catch(e) {
                ctm = null;
            }

            function transformPoint(px, py) {
                if (ctm) {
                    const wx = ctm.a * px + ctm.c * py + ctm.e;
                    const wy = ctm.b * px + ctm.d * py + ctm.f;
                    return { x: wx, y: -wy };
                }
                return { x: px, y: -py };
            }

            const layerName = getSVGLayer(el);
            const color = svgColor(el);

            if (type === 'path') {
                const dAttr = el.getAttribute('d');
                if (dAttr) {
                    // 精確解析並將相對子路徑 (m) 轉為絕對座標 (M)，防範座標扭曲拉線
                    const subpaths = splitSVGPathToSubpaths(dAttr);
                    subpaths.forEach(subD => {
                        const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                        tempPath.setAttribute("d", subD);
                        svgEl.appendChild(tempPath);
                        let len = 0;
                        try { len = tempPath.getTotalLength(); } catch(e) { len = 0; }
                        
                        if (len > 0) {
                            const segments = Math.max(10, Math.ceil(len / (smoothTol * 5)));
                            const pts = [];
                            for (let i = 0; i <= segments; i++) {
                                const p = tempPath.getPointAtLength(i * len / segments);
                                pts.push(transformPoint(p.x, p.y));
                            }
                            if (pts.length > 1) {
                                paths.push({
                                    points: simplifyPath(pts, smoothTol),
                                    layer: layerName, color
                                });
                            }
                        }
                        svgEl.removeChild(tempPath);
                    });
                }
            } else {
                let pts = [];
                if (type === 'rect') {
                    const x = parseFloat(el.getAttribute('x')||0), y = parseFloat(el.getAttribute('y')||0);
                    const w = parseFloat(el.getAttribute('width')||0), h = parseFloat(el.getAttribute('height')||0);
                    const rawPts = [{x, y}, {x: x+w, y}, {x: x+w, y: y+h}, {x, y: y+h}, {x, y}];
                    pts = rawPts.map(pt => transformPoint(pt.x, pt.y));
                } else if (type === 'circle' || type === 'ellipse') {
                    const cx = parseFloat(el.getAttribute('cx')||0), cy = parseFloat(el.getAttribute('cy')||0);
                    const rx = type === 'circle' ? parseFloat(el.getAttribute('r')||0) : parseFloat(el.getAttribute('rx')||0);
                    const ry = type === 'circle' ? rx : parseFloat(el.getAttribute('ry')||0);
                    for (let i = 0; i <= 64; i++) {
                        const a = (i / 64) * Math.PI * 2;
                        pts.push(transformPoint(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
                    }
                } else if (type === 'line') {
                    const x1 = parseFloat(el.getAttribute('x1')||0), y1 = parseFloat(el.getAttribute('y1')||0);
                    const x2 = parseFloat(el.getAttribute('x2')||0), y2 = parseFloat(el.getAttribute('y2')||0);
                    pts = [transformPoint(x1, y1), transformPoint(x2, y2)];
                } else if (type === 'polyline' || type === 'polygon') {
                    const pstr = (el.getAttribute('points') || '').trim().split(/[\s,]+/);
                    for (let i = 0; i < pstr.length - 1; i += 2) {
                        const px = parseFloat(pstr[i]), py = parseFloat(pstr[i+1]);
                        if (!isNaN(px) && !isNaN(py)) {
                            pts.push(transformPoint(px, py));
                        }
                    }
                    if (type === 'polygon' && pts.length > 0) pts.push(pts[0]);
                }

                if (pts.length > 1) {
                    paths.push({
                        points: simplifyPath(pts, smoothTol),
                        layer: layerName, color
                    });
                }
            }
        });

        // 移除臨時 DOM 容器
        document.body.removeChild(tempContainer);

        return scaleVectorPaths(paths, targetW);
    }

    function parseDXFRaw(dxfString, smoothTol) {
        const parser = new DxfParser();
        try {
            const dxf = parser.parseSync(dxfString);
            const paths = [];

            dxf.entities.forEach(ent => {
                let pts = [];
                if (ent.type === 'LINE') {
                    pts = [{x: ent.vertices[0].x, y: ent.vertices[0].y}, {x: ent.vertices[1].x, y: ent.vertices[1].y}];
                } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                    ent.vertices.forEach(v => pts.push({x: v.x, y: v.y}));
                    if (ent.shape) pts.push(pts[0]);
                } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
                    const start = ent.startAngle || 0, end = ent.endAngle !== undefined ? ent.endAngle : Math.PI*2;
                    const r = ent.radius, steps = 64;
                    for(let i=0; i<=steps; i++) {
                        const a = start + (end-start)*(i/steps);
                        pts.push({ x: ent.center.x + Math.cos(a)*r, y: ent.center.y + Math.sin(a)*r });
                    }
                }
                if (pts.length > 1) {
                    paths.push({
                        points: simplifyPath(pts, smoothTol),
                        layer: ent.layer || "Default",
                        color: dxfColor(dxf, ent)
                    });
                }
            });
            return paths;
        } catch(e) {
            console.error("DXF Parse Error", e);
            return [];
        }
    }

    function scaleVectorPaths(paths, targetW) {
        if (paths.length === 0) return [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        paths.forEach(p => p.points.forEach(pt => {
            minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        }));

        const curW = maxX - minX;
        const scale = targetW / curW;
        const offsetX = -minX * scale;
        const offsetY = -minY * scale;

        return paths.map(p => ({
            points: p.points.map(pt => ({
                x: pt.x * scale + offsetX,
                y: pt.y * scale + offsetY
            })),
            layer: p.layer,
            color: p.color
        }));
    }

    // 把瀏覽器算出的顏色（rgb(...) 或 none）轉成 #rrggbb；沒有顏色時回傳 null
    function toHex(css) {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(css || '');
        if (!m || m[4] === '0') return null;
        return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
    }

    // 線條顏色：優先用 stroke，沒有再用 fill。SVG 已放進隱藏容器，CSS class 給的顏色也讀得到
    function svgColor(el) {
        const st = getComputedStyle(el);
        return toHex(st.stroke) || toHex(st.fill);
    }

    // DXF 顏色：圖元自己有顏色就用，ByLayer（色號 256）或沒設定時用圖層的顏色
    function dxfColor(dxf, ent) {
        const layer = dxf.tables && dxf.tables.layer && dxf.tables.layer.layers[ent.layer];
        const own = typeof ent.color === 'number' && ent.colorIndex !== 256;
        const c = own ? ent.color : (layer ? layer.color : null);
        return typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : null;
    }

    function parseDXF(dxfString, targetW, smoothTol) {
        return scaleVectorPaths(parseDXFRaw(dxfString, smoothTol), targetW);
    }

    function extentWidth(paths) {
        let minX = Infinity, maxX = -Infinity;
        paths.forEach(p => p.points.forEach(pt => { minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x); }));
        return maxX > minX ? maxX - minX : null;
    }

    // 檔案宣告的實際寬度（mm）；SVG 規則原樣沿用舊 CNC.html，DXF 用圖形外框寬度
    function realWidth(text, ext) {
        if (ext === 'dxf') return extentWidth(parseDXFRaw(text, 0.01));
        if (ext !== 'svg') return null;
        const svgEl = new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('svg');
        if (!svgEl) return null;
        let mm = null;
        const widthAttr = svgEl.getAttribute('width');
        const viewBoxAttr = svgEl.getAttribute('viewBox');
        if (widthAttr && !widthAttr.includes('%')) {
            const val = parseFloat(widthAttr);
            const unit = widthAttr.replace(/[\d\s\.\-]/g, '').toLowerCase();
            if (unit === 'mm') mm = val;
            else if (unit === 'cm') mm = val * 10;
            else if (unit === 'in') mm = val * 25.4;
            else mm = val * (25.4 / 96);
        }
        if (!mm && viewBoxAttr) {
            const parts = viewBoxAttr.trim().split(/[\s,]+/);
            if (parts.length === 4) mm = parseFloat(parts[2]) * (25.4 / 96);
        }
        return mm && mm > 0 ? mm : null;
    }

    // 以整體外框中心為原點，並把路徑封閉（與舊 processVectorIntoParts 相同）
    function centerAndClose(vectorPaths) {
        let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
        vectorPaths.forEach(p => p.points.forEach(pt => {
            gMinX = Math.min(gMinX, pt.x); gMaxX = Math.max(gMaxX, pt.x);
            gMinY = Math.min(gMinY, pt.y); gMaxY = Math.max(gMaxY, pt.y);
        }));
        const gCx = (gMinX + gMaxX) / 2;
        const gCy = (gMinY + gMaxY) / 2;
        return vectorPaths.map(p => {
            const points = p.points.map(pt => ({ x: pt.x - gCx, y: pt.y - gCy }));
            const first = points[0], last = points[points.length - 1];
            if (points.length > 2 && (first.x !== last.x || first.y !== last.y)) points.push({ ...first });
            return { points, layer: p.layer || 'Default', color: p.color || null };
        });
    }

    // 讀向量檔（svg / dxf）。opts：{ targetW, smooth }
    function load(text, ext, opts) {
        const paths = ext === 'svg' ? parseSVG(text, opts.targetW, opts.smooth)
            : ext === 'dxf' ? parseDXF(text, opts.targetW, opts.smooth) : [];
        return centerAndClose(paths);
    }

    // 讀點陣圖。opts：{ targetW, smooth, threshold }；回傳 Promise<{ paths, canvas }>
    async function loadBitmap(dataUrl, opts) {
        const r = await parseBitmap(dataUrl, opts.targetW, opts.smooth, opts.threshold);
        return { paths: centerAndClose(r.paths.map(points => ({ points, layer: 'Bitmap' }))), canvas: r.canvas };
    }

    // 分組依據：有兩個以上具名圖層時用圖層名；否則有兩種以上顏色時用顏色；都沒有就全部一組
    function autoGroupMode(paths) {
        const names = new Set(paths.map(p => p.layer).filter(n => n && n !== 'Default'));
        if (names.size >= 2) return 'layer';
        return new Set(paths.map(p => p.color).filter(Boolean)).size >= 2 ? 'color' : 'layer';
    }

    // 依圖層名或顏色分組，保持第一次出現的順序
    function groupPaths(paths, mode) {
        const groups = new Map();
        paths.forEach(p => {
            const key = (mode === 'color' ? p.color : p.layer) || (mode === 'color' ? '#000000' : 'Default');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        });
        return [...groups].map(([key, list]) => ({ key, paths: list }));
    }

    return { load, loadBitmap, realWidth, autoGroupMode, groupPaths, simplifyPath };
})();
