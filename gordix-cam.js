// CAM：刀路、加工單元排序、動作序列、G-code 與時間估算。
// 刀路演算法原樣搬自 CNC.html；G-code 與時間估算改為共用同一份動作序列（舊版是兩份重複的走訪程式）。
// 座標單位 mm，原點為機器中心。
const GordixCam = (() => {
    // --- 以下刀路演算法原樣搬自 CNC.html ---

    function cleanPath(path, resolution) {
        if (path.length < 2) return path;
        let filtered = [path[0]], lastPt = path[0];
        for (let i = 1; i < path.length; i++) {
            const pt = path[i], dist = Math.sqrt(Math.pow(pt.x - lastPt.x, 2) + Math.pow(pt.y - lastPt.y, 2));
            if (dist >= resolution || i === path.length - 1) { filtered.push(pt); lastPt = pt; }
        }
        return filtered;
    }

    // --- 判端一個點是否在多邊形內部 (PIP Algorithm - Ray Casting) ---
    function isPointInPolygon(point, vs) {
        let x = point.x, y = point.y;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            let xi = vs[i].x, yi = vs[i].y;
            let xj = vs[j].x, yj = vs[j].y;
            let intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // --- 判斷零件 A 的範圍是否在零件 B 的範圍內部 (改以中心點計算) ---
    function isInsideOther(partA, partB) {
        if (!partA.bounds || !partB.bounds) return false;
        // A 的 bounding box 必須完全置於 B 的 bounding box 內部 (允許貼邊 0.01 容差)
        if (partA.bounds.minX < partB.bounds.minX - 0.01 ||
            partA.bounds.maxX > partB.bounds.maxX + 0.01 ||
            partA.bounds.minY < partB.bounds.minY - 0.01 ||
            partA.bounds.maxY > partB.bounds.maxY + 0.01) {
            return false;
        }
        if (partA.points.length === 0) return false;
        // 使用 Bounding Box 中心點（幾何中心）進行點在多邊形判定，避免檢查到剛好重疊的邊界點而誤判
        const centerPt = {
            x: (partA.bounds.minX + partA.bounds.maxX) / 2,
            y: (partA.bounds.minY + partA.bounds.maxY) / 2
        };
        return isPointInPolygon(centerPt, partB.points);
    }

    // --- 橋位 (TAB) 計算與智慧段切分演算法 ---
    function subdividePath(path, maxLen = 0.5) {
        if (path.length < 2) return path;
        const result = [path[0]];
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > maxLen) {
                const divisions = Math.ceil(len / maxLen);
                for (let j = 1; j < divisions; j++) {
                    const t = j / divisions;
                    result.push({
                        x: p1.x + dx * t,
                        y: p1.y + dy * t
                    });
                }
            }
            result.push(p2);
        }
        return result;
    }

    // 計算點到線段的最短距離，供 insertTabsIntoPath 判斷相交
    function distToSegment(p, p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((p.x - p1.x) ** 2 + (p.y - p1.y) ** 2);
        let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
    }

    // 智慧型橋位線段插入演算法：只有臨近 TAB 的線段才細分，其他線段保持完整，避免生成微小碎線
    function insertTabsIntoPath(path, tabCenters, tabLength = 6) {
        if (!tabCenters || tabCenters.length === 0) return path;
        const R = tabLength / 2;
        const result = [path[0]];
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) {
                result.push(p2);
                continue;
            }

            // 判斷此線段是否與任何橋位圓形區域相交或足夠接近
            let intersects = false;
            for (let j = 0; j < tabCenters.length; j++) {
                const tc = tabCenters[j];
                const dist = distToSegment(tc, p1, p2);
                if (dist < R + 0.1) { // 加上極小安全容差
                    intersects = true;
                    break;
                }
            }

            if (intersects) {
                // 僅針對與橋位接觸的線段進行高精細細分 (0.5mm 步長)
                const step = 0.5;
                const divisions = Math.ceil(len / step);
                for (let d = 1; d < divisions; d++) {
                    const t = d / divisions;
                    result.push({
                        x: p1.x + dx * t,
                        y: p1.y + dy * t
                    });
                }
            }
            result.push(p2);
        }
        return result;
    }

    function getTabPointsForPath(path) {
        if (!path || path.length < 3) return [];
        
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        path.forEach(pt => {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
        });
        
        const A = { x: minX, y: minY };
        const B = { x: maxX, y: maxY };
        const C = { x: minX, y: maxY };
        const D = { x: maxX, y: minY };
        
        let ptA = path[0], ptB = path[0];
        let minDistA = Infinity, minDistB = Infinity;
        
        path.forEach(pt => {
            const distA = Math.pow(pt.x - A.x, 2) + Math.pow(pt.y - A.y, 2);
            if (distA < minDistA) { minDistA = distA; ptA = pt; }
            
            const distB = Math.pow(pt.x - B.x, 2) + Math.pow(pt.y - B.y, 2);
            if (distB < minDistB) { minDistB = distB; ptB = pt; }
        });
        
        const centers = [ptA, ptB];
        
        let area = 0;
        for (let i = 0; i < path.length; i++) {
            let j = (i + 1) % path.length;
            area += path[i].x * path[j].y;
            area -= path[j].x * path[i].y;
        }
        area = Math.abs(area / 2);
        
        if (area > 1600) {
            let ptC = path[0], ptD = path[0];
            let minDistC = Infinity, minDistD = Infinity;
            
            path.forEach(pt => {
                const distC = Math.pow(pt.x - C.x, 2) + Math.pow(pt.y - C.y, 2);
                if (distC < minDistC) { minDistC = distC; ptC = pt; }
                
                const distD = Math.pow(pt.x - D.x, 2) + Math.pow(pt.y - D.y, 2);
                if (distD < minDistD) { minDistD = distD; ptD = pt; }
            });
            
            const distToExisting = (p) => centers.some(c => Math.pow(p.x - c.x, 2) + Math.pow(p.y - c.y, 2) < 1.0);
            if (!distToExisting(ptC)) centers.push(ptC);
            if (!distToExisting(ptD)) centers.push(ptD);
        }
        
        return centers;
    }

    function isPointInTab(pt, tabCenters, tabLength = 6) {
        const halfLenSq = Math.pow(tabLength / 2, 2);
        for (let i = 0; i < tabCenters.length; i++) {
            const tc = tabCenters[i];
            const distSq = Math.pow(pt.x - tc.x, 2) + Math.pow(pt.y - tc.y, 2);
            if (distSq < halfLenSq) return true;
        }
        return false;
    }

    function profilePaths(rawPath, cfg, groupScale) {
        const scale = 10000;
        const scaledPath = rawPath.map(pt => ({ x: pt.x * groupScale, y: pt.y * groupScale }));
        const pX = scaledPath.map(pt => ({ X: Math.round(pt.x * scale), Y: Math.round(pt.y * scale) }));
        let intermediatePaths = [];
        if (cfg.type === 'laser') {
            intermediatePaths.push([...scaledPath, scaledPath[0]]);
        } else {
            const co = new ClipperLib.ClipperOffset();
            co.AddPath(pX, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            let delta = cfg.type === 'outer' ? (cfg.d/2)*scale : -(cfg.d/2)*scale;
            let offsetResult = new ClipperLib.Paths();
            co.Execute(offsetResult, delta);
            offsetResult.forEach(pts => {
                let loop = pts.map(pt => ({ x: pt.X/scale, y: pt.Y/scale })); 
                if(loop.length > 0) loop.push(loop[0]);
                intermediatePaths.push(loop);
            });
        }
        return intermediatePaths.map(path => cleanPath(path, cfg.resolution));
    }

    function pocketPaths(rawPaths, cfg, groupScale) {
        const scale = 10000;
        const allClipperPaths = rawPaths.map(rawPath => {
            return rawPath.map(pt => ({ X: Math.round(pt.x * groupScale * scale), Y: Math.round(pt.y * groupScale * scale) }));
        });
        const cl = new ClipperLib.Clipper();
        cl.AddPaths(allClipperPaths, ClipperLib.PolyType.ptSubject, true);
        const polyTree = new ClipperLib.PolyTree();
        cl.Execute(ClipperLib.ClipType.ctUnion, polyTree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd); // 奇偶規則：內層圖形是島，不會被挖掉
        
        const pocketContourPaths = [];
        const pocketScanPaths = [];

        function traverseTree(node) {
            const children = node.Childs();
            for (let i = 0; i < children.length; i++) {
                const outerNode = children[i];
                if (!outerNode.IsHole()) {
                    const subjectPath = outerNode.Contour();
                    const islands = outerNode.Childs().map(n => n.Contour());
                    if (islands.length > 0) {
                        const islandOffsetter = new ClipperLib.ClipperOffset();
                        islands.forEach(isl => islandOffsetter.AddPath(isl, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon));
                        let islandOuters = new ClipperLib.Paths();
                        islandOffsetter.Execute(islandOuters, (cfg.d/2)*scale);
                        islandOuters.forEach(l => {
                            let p = l.map(pt => ({ x: pt.X/scale, y: pt.Y/scale })); 
                            if(p.length > 0) p.push(p[0]);
                            pocketContourPaths.push(cleanPath(p, cfg.resolution));
                        });
                    }
                    const subjectOffsetter = new ClipperLib.ClipperOffset();
                    subjectOffsetter.AddPath(subjectPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                    let subjectInners = new ClipperLib.Paths();
                    subjectOffsetter.Execute(subjectInners, -(cfg.d/2)*scale);
                    subjectInners.forEach(l => {
                        let p = l.map(pt => ({ x: pt.X/scale, y: pt.Y/scale })); 
                        if(p.length > 0) p.push(p[0]);
                        pocketContourPaths.push(cleanPath(p, cfg.resolution));
                    });
                    const scanPaths = computeScanlinePocket(subjectPath, islands, cfg, scale);
                    pocketScanPaths.push(...scanPaths);
                    outerNode.Childs().forEach(holeNode => traverseTree(holeNode));
                }
            }
        }
        traverseTree(polyTree);
        return { contour: pocketContourPaths, scan: pocketScanPaths };
    }

    function computeScanlinePocket(subject, islands, cfg, scale) {
        const toolRadius = (cfg.d / 2) * scale;
        const shrinkAmount = (cfg.d * 0.5) * scale;
        const co = new ClipperLib.ClipperOffset();
        co.AddPath(subject, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        let outerBound = new ClipperLib.Paths();
        co.Execute(outerBound, -toolRadius);
        let workingArea = outerBound;
        if (islands.length > 0 && outerBound.length > 0) {
            let islandNoGo = new ClipperLib.Paths();
            const coIsl = new ClipperLib.ClipperOffset();
            islands.forEach(isl => coIsl.AddPath(isl, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon));
            coIsl.Execute(islandNoGo, toolRadius);
            const cl = new ClipperLib.Clipper();
            cl.AddPaths(outerBound, ClipperLib.PolyType.ptSubject, true);
            cl.AddPaths(islandNoGo, ClipperLib.PolyType.ptClip, true);
            let finalArea = new ClipperLib.Paths();
            cl.Execute(ClipperLib.ClipType.ctDifference, finalArea, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
            workingArea = finalArea;
        }
        if (workingArea.length === 0) return [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        workingArea.forEach(p => p.forEach(pt => { 
            minX = Math.min(minX, pt.X); maxX = Math.max(maxX, pt.X); 
            minY = Math.min(minY, pt.Y); maxY = Math.max(maxY, pt.Y); 
        }));
        const scanStep = Math.max(1, (cfg.d * (1 - cfg.overlap)) * scale);
        let segmentGroups = [];
        for (let y = minY + scanStep/2; y <= maxY; y += scanStep) {
            const scanLine = [{X: minX - 100, Y: Math.round(y)}, {X: maxX + 100, Y: Math.round(y)}];
            const cl = new ClipperLib.Clipper();
            cl.AddPath(scanLine, ClipperLib.PolyType.ptSubject, false);
            cl.AddPaths(workingArea, ClipperLib.PolyType.ptClip, true);
            const segmentsTree = new ClipperLib.PolyTree();
            cl.Execute(ClipperLib.ClipType.ctIntersection, segmentsTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
            const openPaths = ClipperLib.Clipper.PolyTreeToPaths(segmentsTree);
            if (openPaths.length > 0) {
                openPaths.sort((a,b) => a[0].X - b[0].X);
                openPaths.forEach((path, groupIdx) => {
                    if (!segmentGroups[groupIdx]) segmentGroups[groupIdx] = [];
                    segmentGroups[groupIdx].push(path);
                });
            }
        }
        const optimizedPaths = [];
        segmentGroups.forEach((group, idx) => {
            let reverse = false;
            group.forEach(path => {
                if (path.length >= 2) {
                    const p1 = path[0], p2 = path[path.length - 1];
                    const dx = p2.X - p1.X, dy = p2.Y - p1.Y;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    if (len > shrinkAmount * 2.5) { 
                        const unitX = dx / len, unitY = dy / len;
                        p1.X = Math.round(p1.X + unitX * shrinkAmount);
                        p1.Y = Math.round(p1.Y + unitY * shrinkAmount);
                        p2.X = Math.round(p2.X - unitX * shrinkAmount);
                        p2.Y = Math.round(p2.Y - unitY * shrinkAmount);
                    }
                }
                let p = path.map(pt => ({ x: pt.X / scale, y: pt.Y / scale }));
                if (reverse) p.reverse();
                optimizedPaths.push(p);
                reverse = !reverse;
            });
        });
        return optimizedPaths;
    }

    // --- 加工單元、排序、動作序列 ---
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // 加工單元：排序與輸出的最小單位（一個輪廓物件、一個挖槽區域……）。
    // u：{ type, cfg: { d, depth, step, f, useTab }, phases: [{ paths, isContour, linkDist }], nestingDepth }
    // farRadius = 所有路徑離機器中心最遠的距離，用來排「由中心往外」
    function makeUnit(u) {
        let r = 0;
        u.phases.forEach(ph => ph.paths.forEach(path => path.forEach(pt => { r = Math.max(r, Math.hypot(pt.x, pt.y)); })));
        return { ...u, farRadius: r };
    }

    // 加工順序：雷射先做（不破壞板面）；銑削由機器中心往外。
    // 機器靠 8 條皮帶拉在四角治具之間、騎在板材上移動，在中央最穩；先銑中間再往外，
    // 機器前緣面對的才是完整板面，不會一頭撞進剛銑好的槽。
    // 被包住的圖形離中心的最遠距離不會超過外框，所以孔仍然會在外輪廓之前切。
    function cuttingOrder(units) {
        const stage = { pocket: 0, inner: 1, outer: 2 };
        return units
            .map(u => ({ u, laser: u.type === 'laser', r: u.farRadius }))
            .sort((a, b) => (b.laser - a.laser) || (a.r - b.r)
                || ((b.u.nestingDepth || 0) - (a.u.nestingDepth || 0))
                || ((stage[a.u.type] ?? 9) - (stage[b.u.type] ?? 9)))
            .map(k => k.u);
    }

    // 已排序的加工單元 → 動作序列。規則逐條沿用舊 CNC.html 的輸出程式。
    // 動作：{ g: 0|1, x?, y?, z?, f? } 或 { m: 'M03 S255' | 'M05' }
    function planMoves(units, safeZ) {
        const mv = [];
        units.forEach(u => {
            const cfg = u.cfg, isLaser = u.type === 'laser';
            const passes = (isLaser || u.type === 'path3d') ? 1 : Math.ceil(cfg.depth / cfg.step);
            let lastPointOfPart = null;
            u.phases.forEach(phase => {
                if (!phase.paths.length) return;
                for (let i = 1; i <= passes; i++) {
                    const targetZ = isLaser ? 0 : -(Math.min(cfg.depth, i * cfg.step)).toFixed(3);
                    let lastPtInLayer = null;
                    phase.paths.forEach((path, pathIdx) => {
                        if (path.length < 2) return;
                        const useTab = !isLaser && cfg.useTab && i === passes && phase.isContour;
                        const tabLength = 6 + (cfg.d || 0); // TAB 移動長度 = 6mm + 刀具直徑
                        const tabCenters = useTab ? getTabPointsForPath(path) : [];
                        const finalPath = useTab ? insertTabsIntoPath(path, tabCenters, tabLength) : path;
                        const tabZ = useTab ? Math.min(0, targetZ + cfg.step) : targetZ;
                        // 立體路徑（V 雕刻、浮雕）每點自帶 z
                        const zAt = pt => pt.z !== undefined ? pt.z : (useTab && isPointInTab(pt, tabCenters, tabLength) ? tabZ : targetZ);
                        const start = finalPath[0], startZ = zAt(start);

                        // 同一單元的下一層從同一點開始時不抬刀；挖槽掃描線、雕刻筆劃在 linkDist 內直接連過去
                        let needRetract = true;
                        if (i > 1 && pathIdx === 0 && lastPointOfPart) needRetract = dist(start, lastPointOfPart) >= 0.5;
                        else if (lastPtInLayer && dist(start, lastPtInLayer) <= phase.linkDist) needRetract = false;

                        const down = isLaser ? { m: 'M03 S255' } : { g: 1, z: startZ, f: 300 };
                        if (needRetract) {
                            if (!isLaser) mv.push({ g: 0, z: safeZ });
                            mv.push({ g: 0, x: start.x, y: start.y }, down);
                        } else {
                            mv.push(down, { g: 1, x: start.x, y: start.y, f: cfg.f });
                        }
                        for (let j = 1; j < finalPath.length; j++) {
                            const p = finalPath[j];
                            mv.push({ g: 1, x: p.x, y: p.y, z: zAt(p), f: cfg.f });
                        }
                        if (isLaser) mv.push({ m: 'M05' });
                        lastPtInLayer = lastPointOfPart = finalPath[finalPath.length - 1];
                    });
                }
            });
            if (!isLaser) mv.push({ g: 0, z: safeZ });
        });
        mv.push({ g: 0, x: 0, y: 0, home: true }); // 回機器中心
        return mv;
    }

    // 動作序列 → G-code 文字。Z 與 F 只在數值改變時輸出，與舊版相同。
    function toGcode(moves, safeZ, comments) {
        const fx = v => v.toFixed(3);
        const out = [...comments.map(c => '; ' + c), 'G21', 'G90', `G0 Z${fx(safeZ)}`, 'G0 X0 Y0'];
        let z = safeZ, f = null;
        moves.forEach(m => {
            if (m.m) { out.push(m.m); return; }
            if (m.home) { out.push('G0 X0 Y0'); return; } // 與檔頭相同的寫法
            const hasXY = m.x !== undefined;
            const zChanged = m.z !== undefined && Math.abs(m.z - z) > 0.001;
            if (!hasXY && !zChanged) return;
            if (zChanged) z = m.z;
            if (m.g === 0) { out.push(hasXY ? `G0 X${fx(m.x)} Y${fx(m.y)}` : `G0 Z${fx(m.z)}`); return; }
            let line = 'G1' + (hasXY ? ` X${fx(m.x)} Y${fx(m.y)}` : '') + (zChanged ? ` Z${fx(m.z)}` : '');
            if (m.f !== f) { line += ` F${m.f}`; f = m.f; }
            out.push(line);
        });
        return out.join('\n');
    }

    // 預估秒數：G0 以 2000 mm/min 計，G1 以動作的 F 計（下刀 F300）
    function estimateSeconds(moves, safeZ) {
        let p = { x: 0, y: 0, z: safeZ }, sec = 0;
        moves.forEach(m => {
            if (m.m) return;
            const q = { x: m.x ?? p.x, y: m.y ?? p.y, z: m.z ?? p.z };
            sec += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / (m.g === 0 ? 2000 : m.f) * 60;
            p = q;
        });
        return sec;
    }

    // --- 圖層 → 加工單元 → 依刀具分檔 ---

    // 預設刀具庫（數值沿用舊工具，輸出才會與舊版相同）
    const TOOLS = [
        { id: 'flat635', type: 'flat', d: 6.35, step: 1.0, f: 1000, overlap: 0.5 },
        { id: 'flat3175', type: 'flat', d: 3.175, step: 0.5, f: 800, overlap: 0.5 },
        { id: 'vbit90', type: 'vbit', d: 6.0, angle: 90, step: 99, f: 1000 },
        { id: 'ball6', type: 'ball', d: 6.0, step: 99, f: 1000, stepover: 1.8 }
    ];

    // 加工方式 → 加工頭；cut = 會切出材料邊界（判斷孔的依據）
    const OPS = {
        profile: { head: 'router', cut: true },   // 輪廓（自動判斷內外）
        outer: { head: 'router', cut: true },
        inner: { head: 'router', cut: true },
        pocket: { head: 'router' },
        engrave: { head: 'router' },              // 沿線雕刻
        vcarve: { head: 'router' },
        relief: { head: 'router' },               // 灰階浮雕
        laser: { head: 'laser', cut: true },      // 雷射切割
        drillMark: { head: 'mark' }               // 只標孔位（放樣檔）
    };

    // 檔與檔的先後：放樣 → 雷射 → 銑削（依檔內最後的階段：挖槽 → 內輪廓 → 外輪廓，切穿再往後）
    const STAGE = { pocket: 0, inner: 1, outer: 2 };
    const HEAD_RANK = { mark: -1, laser: 0 };

    function boundsOf(points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(pt => {
            minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
        });
        return { minX, maxX, minY, maxY };
    }

    // 自動內外：只看「切割類」圖層的外框，被奇數層包住的是孔。
    // 挖槽、雕刻的框不是材料邊界，不算進去（舊版全部都算，挖槽裡的孔會被誤判成外輪廓）。
    function cutNesting(job) {
        const isCut = o => !!(OPS[job.layers.find(l => l.id === o.layerId).op] || {}).cut;
        const shapes = job.objects.map(o => ({ id: o.id, points: o.points, bounds: boundsOf(o.points), cut: isCut(o) }));
        const cutters = shapes.filter(s => s.cut);
        return new Map(shapes.map(s => [s.id, cutters.filter(c => c !== s && isInsideOther(s, c)).length]));
    }

    const layerDepth = (job, layer) => layer.through ? job.thickness + job.overcut : layer.depth;
    const fileKey = layer => OPS[layer.op].head === 'router' ? 'router:' + layer.toolId : OPS[layer.op].head;

    // 一個圖層的物件 → 加工單元
    function layerUnits(job, layer, tool, objs, nest) {
        const base = {
            d: tool ? tool.d : 0, depth: layerDepth(job, layer), step: tool ? tool.step : 1,
            f: tool ? tool.f : (layer.feed || 1000), useTab: !!(layer.through && layer.tabs),
            resolution: job.resolution, overlap: (tool && tool.overlap) || 0.5
        };
        const unit = (type, objectIds, nestingDepth, phases) =>
            makeUnit({ type, cfg: { ...base, type }, layerId: layer.id, objectIds, nestingDepth, through: !!layer.through, phases });

        if (layer.op === 'profile' || layer.op === 'outer' || layer.op === 'inner' || layer.op === 'laser') {
            return objs.map(o => {
                const type = layer.op === 'profile' ? (nest.get(o.id) % 2 === 1 ? 'inner' : 'outer') : layer.op;
                // 雷射的路徑之間一律關雷射再移動（舊版距離近時會開著雷射直接連過去，燒出一條多餘的線）
                return unit(type, [o.id], nest.get(o.id),
                    [{ paths: profilePaths(o.points, { ...base, type }, 1), isContour: type !== 'laser', linkDist: -1 }]);
            });
        }
        if (layer.op === 'pocket') {
            // 每個最外層的物件連同包在它裡面的物件（島）是一個挖槽區域，各自排序
            const shapes = objs.map(o => ({ o, points: o.points, bounds: boundsOf(o.points) }));
            const tops = shapes.filter(s => !shapes.some(t => t !== s && isInsideOther(s, t)));
            return tops.map(top => {
                const group = [top, ...shapes.filter(s => s !== top && isInsideOther(s, top))];
                const r = pocketPaths(group.map(s => s.points), { ...base, type: 'pocket' }, 1);
                return unit('pocket', group.map(s => s.o.id), nest.get(top.o.id), [
                    { paths: r.scan, isContour: false, linkDist: base.d },
                    { paths: r.contour, isContour: true, linkDist: -1 }
                ]);
            });
        }
        if ((layer.op === 'vcarve' || layer.op === 'engrave') && typeof GordixVCarve === 'object') {
            // 演算法在 gordix-vcarve.js（原樣搬自舊 vc.html）；每個要雕的區域 / 每個物件是一個單元，才能由中心往外排序
            const shapes = objs.map(o => o.points);
            if (layer.op === 'engrave') {
                return GordixVCarve.engrave(shapes, layerDepth(job, layer), tool.step, job.resolution).map((paths, i) =>
                    unit('path3d', [objs[i].id], nest.get(objs[i].id), [{ paths, isContour: false, linkDist: 0.1 }]));
            }
            const r = GordixVCarve.vcarve(shapes, {
                d: tool.d, depth: layer.depth, vbitAngle: tool.angle || 90,
                toolType: tool.type === 'ball' ? 'ballnose' : 'vbit', resolution: job.resolution
            }, layer.carveSide || 'odd');
            if (r.tooWide) (job.issues = job.issues || {})[layer.id] = 'tooWide';
            return r.groups.map(g => unit('path3d', [objs[g.index].id], nest.get(objs[g.index].id), [{ paths: g.paths, isContour: false, linkDist: 0.1 }]));
        }
        return []; // 灰階浮雕、標孔位：後續步驟加入
    }

    // 所有顯示中的圖層 → 加工單元（沒有刀具的銑削圖層略過，由畫面提示）
    // job.issues：{ 圖層 id: 'tooWide' }（V 刀雕不滿時不產生刀路，由畫面提示）
    function buildUnits(job, tools) {
        job.issues = {};
        const nest = cutNesting(job);
        return job.layers.filter(l => l.visible).flatMap(layer => {
            const tool = tools.find(t => t.id === layer.toolId);
            if (OPS[layer.op].head === 'router' && !tool) return [];
            const objs = job.objects.filter(o => o.layerId === layer.id);
            return layerUnits(job, layer, tool, objs, nest).map(u => ({ ...u, fileKey: fileKey(layer) }));
        }).filter(u => u.phases.some(ph => ph.paths.length));
    }

    function toolLabel(t) {
        if (t.type === 'vbit') return `V-bit ${t.angle}deg D${t.d}`;
        if (t.type === 'ball') return `ball nose D${t.d}`;
        return `flat end mill D${t.d}`;
    }

    // 檔名用英文：機器螢幕與 SD 卡不一定支援中文檔名
    function fileSlug(f) {
        if (f.head === 'laser') return 'laser';
        if (f.head === 'mark') return 'layout';
        return (f.tool.type === 'vbit' ? 'vbit' + f.tool.angle : f.tool.type + f.tool.d);
    }

    // 檔頭註解（ASCII）：第幾個檔、刀具、開始前要做的事
    function fileComments(f, i, files) {
        const c = [`Gordix Studio CNC - file ${i + 1} of ${files.length}`];
        if (f.head === 'router') {
            const prevRouter = i > 0 && files[i - 1].head === 'router';
            c.push(`Tool: ${toolLabel(f.tool)}`,
                (prevRouter ? 'Before start: stop spindle, change tool' : 'Before start: install tool')
                + ', set Z0 on material surface, router dial 3, start spindle',
                'Spindle is manual: turn it on before starting',
                'Order: center outward');
        } else if (f.head === 'laser') {
            c.push('Tool: laser module', 'Before start: mount laser module, set Z0, wear laser safety glasses');
        } else {
            c.push('Tool: laser or pen (layout marks)');
        }
        return c;
    }

    // 依加工頭與刀具分檔：同一把刀同一檔；檔內由機器中心往外
    function buildFiles(job, tools) {
        const groups = new Map();
        buildUnits(job, tools).forEach(u => {
            if (!groups.has(u.fileKey)) groups.set(u.fileKey, []);
            groups.get(u.fileKey).push(u);
        });
        const files = [...groups].map(([key, units]) => {
            const head = key.startsWith('router:') ? 'router' : key;
            const stages = units.map(u => (STAGE[u.type] ?? 0) + (u.through ? 0.5 : 0));
            return {
                key, head, tool: head === 'router' ? tools.find(t => 'router:' + t.id === key) : null,
                units: cuttingOrder(units),
                rank: head === 'router' ? 1 + Math.max(...stages) : HEAD_RANK[head], minStage: Math.min(...stages)
            };
        });
        files.sort((a, b) => (a.rank - b.rank) || (a.minStage - b.minStage));
        return files.map((f, i) => {
            const comments = fileComments(f, i, files);
            const moves = planMoves(f.units, job.safeZ);
            return {
                ...f, comments, moves,
                name: `${job.name}_${String(i + 1).padStart(2, '0')}_${fileSlug(f)}.gcode`,
                gcode: toGcode(moves, job.safeZ, comments),
                seconds: estimateSeconds(moves, job.safeZ)
            };
        });
    }

    // --- 放樣檔：加工前用畫筆或雷射在板材上標出零件外框、孔位十字與零件編號（實測影片的用法：先確認位置、手鑽孔、標名稱） ---

    // 七段顯示器樣式的單筆畫數字（與繪圖工具校準檔相同）
    const SEG = {
        a: [[0, 1], [1, 1]], b: [[1, 1], [1, 0.5]], c: [[1, 0.5], [1, 0]], d: [[0, 0], [1, 0]],
        e: [[0, 0.5], [0, 0]], f: [[0, 1], [0, 0.5]], g: [[0, 0.5], [1, 0.5]]
    };
    const DIGIT_SEGS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

    // 數字 n 置中在 (cx, cy)，字高 h：回傳筆劃（每筆兩點）
    function digitStrokes(n, cx, cy, h) {
        const w = h / 2, gap = w * 0.6, s = String(n), x0 = cx - (s.length * w + (s.length - 1) * gap) / 2, y0 = cy - h / 2;
        const out = [];
        [...s].forEach((ch, i) => DIGIT_SEGS[+ch].split('').forEach(k => {
            const [[ax, ay], [bx, by]] = SEG[k], ox = x0 + i * (w + gap);
            out.push([{ x: ox + ax * w, y: y0 + ay * h }, { x: ox + bx * w, y: y0 + by * h }]);
        }));
        return out;
    }

    // opts = { outlines, crosses, numbers, s（M03 的功率；畫筆 255）, f }
    // 外框：切割類圖層的物件原始輪廓（不做刀具補償）。十字：被包住的孔（自動內外判斷為孔、內輪廓）與「只標孔位」圖層的物件中心，
    // 臂長 = min(10, 孔徑)。編號：最外層的零件依由上到下、由左到右編號，寫在零件左上角內側。
    // 回傳 { name, gcode, seconds, strokes, numbers: [{ id, n }] }；沒有東西可畫時回傳 null。
    function layoutFile(job, opts) {
        const nest = cutNesting(job);
        const layerOf = o => job.layers.find(l => l.id === o.layerId);
        const objs = job.objects.filter(o => { const l = layerOf(o); return l && l.visible; });
        const strokes = [], numbers = [];
        objs.forEach(o => {
            const l = layerOf(o), op = OPS[l.op] || {}, b = boundsOf(o.points);
            const hole = l.op === 'inner' || (l.op === 'profile' && nest.get(o.id) % 2 === 1);
            if (opts.outlines && op.cut && !hole) strokes.push(o.points);
            if (opts.crosses && (hole || l.op === 'drillMark')) {
                const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, arm = Math.min(10, Math.max(b.maxX - b.minX, b.maxY - b.minY)) / 2;
                strokes.push([{ x: cx - arm, y: cy }, { x: cx + arm, y: cy }], [{ x: cx, y: cy - arm }, { x: cx, y: cy + arm }]);
            }
        });
        if (opts.numbers) {
            const parts = objs.filter(o => (OPS[layerOf(o).op] || {}).cut && nest.get(o.id) === 0)
                .map(o => ({ o, b: boundsOf(o.points) }))
                .sort((p, q) => (q.b.maxY - p.b.maxY) || (p.b.minX - q.b.minX));
            parts.forEach((p, i) => {
                // 寫在零件左上角內側（中間常有孔或挖槽）；零件太小就寫在中心
                const w = p.b.maxX - p.b.minX, ht = p.b.maxY - p.b.minY, h = Math.max(3, Math.min(10, ht / 5));
                const big = w > 6 * h && ht > 4 * h;
                const cx = big ? p.b.minX + 2 * h : (p.b.minX + p.b.maxX) / 2, cy = big ? p.b.maxY - 1.5 * h : (p.b.minY + p.b.maxY) / 2;
                strokes.push(...digitStrokes(i + 1, cx, cy, h));
                numbers.push({ id: p.o.id, n: i + 1 });
            });
        }
        if (!strokes.length) return null;
        // 依最近點連起來，減少空跑；每一筆：G0 到起點 → M03 → G1 … → M05（和繪圖工具相同的格式）
        const order = [], left = strokes.slice();
        let cur = { x: 0, y: 0 };
        while (left.length) {
            let best = 0, rev = false, bd = Infinity;
            left.forEach((s, i) => {
                const d0 = dist(cur, s[0]), d1 = dist(cur, s[s.length - 1]);
                if (d0 < bd) { bd = d0; best = i; rev = false; }
                if (d1 < bd) { bd = d1; best = i; rev = true; }
            });
            const s = left.splice(best, 1)[0], path = rev ? s.slice().reverse() : s;
            order.push(path);
            cur = path[path.length - 1];
        }
        const fx = v => v.toFixed(3), f = opts.f || 1500;
        const g = ['; Gordix Studio CNC - layout marks (outlines / hole crosses / part numbers)', '; Tool: laser or pen (layout marks)', 'G21', 'G90', 'G0 X0 Y0'];
        let sec = 0, p = { x: 0, y: 0 };
        order.forEach(path => {
            g.push(`G0 X${fx(path[0].x)} Y${fx(path[0].y)}`, `M03 S${opts.s}`);
            sec += dist(p, path[0]) / 2000 * 60;
            path.slice(1).forEach((q, i) => { g.push(`G1 X${fx(q.x)} Y${fx(q.y)}${i === 0 ? ` F${f}` : ''}`); sec += dist(path[i], q) / f * 60; });
            g.push('M05');
            p = path[path.length - 1];
        });
        g.push('G0 X0 Y0');
        return { name: `${job.name}_00_layout.gcode`, head: 'mark', gcode: g.join('\n'), seconds: sec, strokes: order, numbers };
    }

    return {
        layoutFile, digitStrokes,
        TOOLS, OPS, profilePaths, pocketPaths, isInsideOther, isPointInPolygon, boundsOf,
        makeUnit, cuttingOrder, planMoves, toGcode, estimateSeconds,
        cutNesting, layerDepth, buildUnits, buildFiles, toolLabel
    };
})();
