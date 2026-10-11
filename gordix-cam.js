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

    return { profilePaths, pocketPaths, isInsideOther, isPointInPolygon, makeUnit, cuttingOrder, planMoves, toGcode, estimateSeconds };
})();
