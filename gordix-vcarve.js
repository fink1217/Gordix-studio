// V 雕刻與沿線雕刻：演算法原樣搬自舊 vc.html（computeNestedVCarve 與它用到的小函式，一行未改），
// 外面包一層「一個圖層的物件 → 刀路」的介面給 gordix-cam.js 用。巢狀關係只看同一圖層。
const GordixVCarve = (() => {
    function getLineIntersection(p1, p2, p3, p4) {
        const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
        if (Math.abs(denom) < 1e-6) return null;
        const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
        const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
            return {
                x: p1.x + ua * (p2.x - p1.x),
                y: p1.y + ua * (p2.y - p1.y)
            };
        }
        return null;
    }

    function isPureStraightLinePath(path, tolerance = 0.05) {
        if (!path || path.length <= 3) return true;
        let clean = [...path];
        if (clean.length > 2 && 
            Math.abs(clean[0].x - clean[clean.length-1].x) < 1e-4 && 
            Math.abs(clean[0].y - clean[clean.length-1].y) < 1e-4) {
            clean.pop();
        }
        if (clean.length <= 2) return true;
        
        const simplified = simplifyPath(clean, tolerance);
        let originalIndices = [];
        let origIdx = 0;
        for (let i = 0; i < simplified.length; i++) {
            const sPt = simplified[i];
            let found = false;
            for (let j = origIdx; j < clean.length; j++) {
                const oPt = clean[j];
                const dist = Math.sqrt((oPt.x - sPt.x)**2 + (oPt.y - sPt.y)**2);
                if (dist < 1e-3) {
                    originalIndices.push(j);
                    origIdx = j;
                    found = true;
                    break;
                }
            }
            if (!found) {
                for (let j = 0; j < clean.length; j++) {
                    const oPt = clean[j];
                    const dist = Math.sqrt((oPt.x - sPt.x)**2 + (oPt.y - sPt.y)**2);
                    if (dist < 1e-3) {
                        originalIndices.push(j);
                        break;
                    }
                }
            }
        }
        
        originalIndices = Array.from(new Set(originalIndices)).sort((a, b) => a - b);
        if (originalIndices.length < 2) return false;
        
        for (let i = 0; i < originalIndices.length; i++) {
            const startIdx = originalIndices[i];
            const endIdx = originalIndices[(i + 1) % originalIndices.length];
            const pStart = clean[startIdx];
            const pEnd = clean[endIdx];
            
            let j = (startIdx + 1) % clean.length;
            while (j !== endIdx) {
                const pMid = clean[j];
                const d = pointToSegmentDistance(pMid, pStart, pEnd);
                if (d > 0.08) { 
                    return false; 
                }
                j = (j + 1) % clean.length;
            }
        }
        return true;
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

    function pointToSegmentDistance(pt, p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const l2 = dx*dx + dy*dy;
        if (l2 === 0) return Math.sqrt((pt.x - p1.x)**2 + (pt.y - p1.y)**2);
        let t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
        return Math.sqrt((pt.x - proj.x)**2 + (pt.y - proj.y)**2);
    }

    function cleanPath(path, resolution) {
        if (path.length < 2) return path;
        let filtered = [path[0]], lastPt = path[0];
        for (let i = 1; i < path.length; i++) {
            const pt = path[i];
            const dx = pt.x - lastPt.x;
            const dy = pt.y - lastPt.y;
            const dz = (pt.z !== undefined && lastPt.z !== undefined) ? (pt.z - lastPt.z) : 0;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist >= resolution || i === path.length - 1) { 
                filtered.push(pt); 
                lastPt = pt; 
            }
        }
        return filtered;
    }

    function resamplePath(path, spacing) {
        if (path.length < 2) return path;
        const resampled = [];
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i+1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            resampled.push(p1);
            if (dist > spacing) {
                const steps = Math.floor(dist / spacing);
                for (let s = 1; s <= steps; s++) {
                    const t = s / (steps + 1);
                    resampled.push({
                        x: p1.x + dx * t,
                        y: p1.y + dy * t
                    });
                }
            }
        }
        resampled.push(path[path.length - 1]);
        return resampled;
    }

    function isPointInPolygon(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > pt.y) !== (yj > pt.y))
                && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function getPolygonArea(poly) {
        let area = 0;
        const N = poly.length;
        if (N < 3) return 0;
        for (let i = 0; i < N; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % N];
            area += (p1.x * p2.y - p2.x * p1.y);
        }
        return area / 2;
    }

    function optimizePathOrder(paths, startX = 0, startY = 0) {
        if (paths.length <= 1) return paths;
        const optimized = [];
        const unvisited = [...paths];
        let curX = startX;
        let curY = startY;

        while (unvisited.length > 0) {
            let bestIdx = -1;
            let bestDistSq = Infinity;
            let reverseBest = false;

            for (let i = 0; i < unvisited.length; i++) {
                const path = unvisited[i];
                if (path.length === 0) continue;

                const startPt = path[0];
                const dStartSq = Math.pow(startPt.x - curX, 2) + Math.pow(startPt.y - curY, 2);
                if (dStartSq < bestDistSq) {
                    bestDistSq = dStartSq;
                    bestIdx = i;
                    reverseBest = false;
                }

                const endPt = path[path.length - 1];
                const dEndSq = Math.pow(endPt.x - curX, 2) + Math.pow(endPt.y - curY, 2);
                if (dEndSq < bestDistSq) {
                    bestDistSq = dEndSq;
                    bestIdx = i;
                    reverseBest = true;
                }
            }

            if (bestIdx === -1) break;

            let nextPath = unvisited.splice(bestIdx, 1)[0];
            if (reverseBest) {
                nextPath = [...nextPath].reverse();
            }
            optimized.push(nextPath);
            
            const lastPt = nextPath[nextPath.length - 1];
            curX = lastPt.x;
            curY = lastPt.y;
        }
        return optimized;
    }

    function computeNestedVCarve(shape, cfg) {
        const outer = [...shape.outer];
        if (outer.length > 2 && outer[0].x === outer[outer.length-1].x && outer[0].y === outer[outer.length-1].y) {
            outer.pop();
        }
        if (getPolygonArea(outer) < 0) outer.reverse();

        const holes = shape.holes.map(h => {
            const temp = [...h];
            if (temp.length > 2 && temp[0].x === temp[temp.length-1].x && temp[0].y === temp[temp.length-1].y) {
                temp.pop();
            }
            if (getPolygonArea(temp) > 0) temp.reverse();
            return temp;
        });

        const isStraight = isPureStraightLinePath(outer, 0.05);

        const tol = Math.max(0.04, cfg.resolution * 0.7);
        const simpOuter = simplifyPath(outer, tol);
        const simpHoles = holes.map(h => simplifyPath(h, tol));

        const sampleSpacing = Math.max(0.5, cfg.resolution * 5);
        const resampledOuter = resamplePath(simpOuter, sampleSpacing);
        const resampledHoles = simpHoles.map(h => resamplePath(h, sampleSpacing));

        const loops = [resampledOuter, ...resampledHoles];

        const isBallNose = (cfg.toolType === 'ballnose');
        const toolRadius = cfg.d / 2.0;
        const vbitAngle = cfg.vbitAngle || 90;
        const halfAngleRad = (vbitAngle / 2) * Math.PI / 180;
        const tanHalf = Math.tan(halfAngleRad);
        const maxDepth = cfg.depth || 3.0;

        const allSegments = [];
        loops.forEach((loop, loopIdx) => {
            const m = loop.length;
            for (let i = 0; i < m; i++) {
                const p1 = loop[i];
                const p2 = loop[(i + 1) % m];
                allSegments.push({
                    p1, p2,
                    loopIdx,
                    segIdx: i,
                    minX: Math.min(p1.x, p2.x),
                    maxX: Math.max(p1.x, p2.x),
                    minY: Math.min(p1.y, p2.y),
                    maxY: Math.max(p1.y, p2.y)
                });
            }
        });

        function getDistanceToRegionBoundary(pt, excludeLoopIdx, excludeSegIndices) {
            let minDist = Infinity;
            for (let i = 0; i < allSegments.length; i++) {
                const s = allSegments[i];
                if (s.loopIdx === excludeLoopIdx && excludeSegIndices.includes(s.segIdx)) continue;
                
                let dx = 0;
                if (pt.x < s.minX) dx = s.minX - pt.x;
                else if (pt.x > s.maxX) dx = pt.x - s.maxX;
                let dy = 0;
                if (pt.y < s.minY) dy = s.minY - pt.y;
                else if (pt.y > s.maxY) dy = pt.y - s.maxY;

                if (dx*dx + dy*dy >= minDist*minDist) continue;

                const d = pointToSegmentDistance(pt, s.p1, s.p2);
                if (d < minDist) minDist = d;
            }
            return minDist;
        }

        const skeletonPoints = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        simpOuter.forEach(pt => {
            if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
        });
        const diag = Math.sqrt((maxX - minX)**2 + (maxY - minY)**2);

        let finishedStrokes = [];
        let bypassedSkeleton = false;

        if (isStraight && holes.length === 0) {
            if (simpOuter.length === 4) {
                const C = getLineIntersection(simpOuter[0], simpOuter[2], simpOuter[1], simpOuter[3]);
                if (C !== null) {
                    let dMin = Infinity;
                    for (let i = 0; i < 4; i++) {
                        const d = pointToSegmentDistance(C, simpOuter[i], simpOuter[(i+1)%4]);
                        if (d < dMin) dMin = d;
                    }
                    const Z_C = isBallNose ? 
                        (dMin >= toolRadius ? -maxDepth : -(toolRadius - Math.sqrt(Math.max(0, toolRadius*toolRadius - dMin*dMin)))) : 
                        -dMin / tanHalf;
                    const targetZC = Math.max(-maxDepth, Z_C);

                    const stroke1 = [
                        { x: simpOuter[0].x, y: simpOuter[0].y, z: 0, r: dMin },
                        { x: C.x, y: C.y, z: targetZC, r: dMin },
                        { x: simpOuter[2].x, y: simpOuter[2].y, z: 0, r: dMin }
                    ];
                    const stroke2 = [
                        { x: simpOuter[1].x, y: simpOuter[1].y, z: 0, r: dMin },
                        { x: C.x, y: C.y, z: targetZC, r: dMin },
                        { x: simpOuter[3].x, y: simpOuter[3].y, z: 0, r: dMin }
                    ];

                    finishedStrokes.push(cleanPath(stroke1, cfg.resolution));
                    finishedStrokes.push(cleanPath(stroke2, cfg.resolution));
                    bypassedSkeleton = true;
                }
            } else if (simpOuter.length === 3) {
                const A = simpOuter[0], B = simpOuter[1], Ct = simpOuter[2];
                const a = Math.sqrt((B.x - Ct.x)**2 + (B.y - Ct.y)**2);
                const b = Math.sqrt((A.x - Ct.x)**2 + (A.y - Ct.y)**2);
                const c = Math.sqrt((A.x - B.x)**2 + (A.y - B.y)**2);
                
                if (a + b + c > 1e-5) {
                    const x_I = (a * A.x + b * B.x + c * Ct.x) / (a + b + c);
                    const y_I = (a * A.y + b * B.y + c * Ct.y) / (a + b + c);
                    const C = { x: x_I, y: y_I };

                    const s = (a + b + c) / 2;
                    const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
                    const r = area / s;

                    const Z_C = isBallNose ? 
                        (r >= toolRadius ? -maxDepth : -(toolRadius - Math.sqrt(Math.max(0, toolRadius*toolRadius - r*r)))) : 
                        -r / tanHalf;
                    const targetZC = Math.max(-maxDepth, Z_C);

                    for (let i = 0; i < 3; i++) {
                        finishedStrokes.push(cleanPath([
                            { x: simpOuter[i].x, y: simpOuter[i].y, z: 0, r },
                            { x: C.x, y: C.y, z: targetZC, r }
                        ], cfg.resolution));
                    }
                    bypassedSkeleton = true;
                }
            }
        }

        if (!bypassedSkeleton) {
            loops.forEach((loop, loopIdx) => {
                const m = loop.length;
                const isHole = (loopIdx > 0);

                for (let i = 0; i < m; i++) {
                    const prev = loop[(i - 1 + m) % m];
                    const curr = loop[i];
                    const next = loop[(i + 1) % m];

                    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
                    const v2 = { x: next.x - curr.x, y: next.y - curr.y };

                    const len1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y);
                    const len2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y);
                    if (len1 < 1e-6 || len2 < 1e-6) continue;

                    const t1 = { x: v1.x / len1, y: v1.y / len1 };
                    const t2 = { x: v2.x / len2, y: v2.y / len2 };

                    const cross = t1.x * t2.y - t1.y * t2.x;
                    const isConcave = isHole ? (cross > 1e-5) : (cross < -1e-5);
                    if (isConcave) continue;

                    const n1 = { x: -t1.y, y: t1.x };
                    const n2 = { x: -t2.y, y: t2.x };

                    let u = { x: n1.x + n2.x, y: n1.y + n2.y };
                    let lenU = Math.sqrt(u.x*u.x + u.y*u.y);
                    if (lenU < 1e-5) {
                        u = { ...n1 };
                    } else {
                        u.x /= lenU; u.y /= lenU;
                    }

                    const startSegs = [(i - 1 + m) % m, i];

                    let low = 0, high = diag;
                    for (let step = 0; step < 16; step++) {
                        const mid = (low + high) / 2;
                        const Pt = { x: curr.x + mid * u.x, y: curr.y + mid * u.y };
                        const dStart = Math.min(pointToSegmentDistance(Pt, prev, curr), pointToSegmentDistance(Pt, curr, next));
                        const dOther = getDistanceToRegionBoundary(Pt, loopIdx, startSegs);

                        if (dStart < dOther) low = mid; else high = mid;
                    }

                    const tStar = (low + high) / 2;
                    const PtStar = { x: curr.x + tStar * u.x, y: curr.y + tStar * u.y };
                    const radius = Math.min(pointToSegmentDistance(PtStar, prev, curr), pointToSegmentDistance(PtStar, curr, next));

                    const isInsideSolid = isPointInPolygon(PtStar, simpOuter) && !simpHoles.some(h => isPointInPolygon(PtStar, h));

                    if (radius > 0.05 && isInsideSolid) {
                        let z = isBallNose ? 
                            (radius >= toolRadius ? -maxDepth : -(toolRadius - Math.sqrt(Math.max(0, toolRadius*toolRadius - radius*radius)))) : 
                            -radius / tanHalf;
                        skeletonPoints.push({
                            x: PtStar.x, y: PtStar.y,
                            z: Math.max(-maxDepth, z),
                            r: radius
                        });
                    }
                }
            });

            const spineStrokes = [];
            if (skeletonPoints.length > 0) {
                const unvisited = [...skeletonPoints];
                const chainThreshold = 1.5; 

                while (unvisited.length > 0) {
                    let stroke = [unvisited.shift()];
                    let growing = true;

                    while (growing) {
                        growing = false;
                        const lastPt = stroke[stroke.length - 1];
                        let bestIdx = -1;
                        let minDist = Infinity;

                        for (let i = 0; i < unvisited.length; i++) {
                            const d = Math.sqrt((unvisited[i].x - lastPt.x)**2 + (unvisited[i].y - lastPt.y)**2);
                            if (d < minDist) {
                                minDist = d;
                                bestIdx = i;
                            }
                        }

                        if (bestIdx !== -1 && minDist < chainThreshold) {
                            stroke.push(unvisited.splice(bestIdx, 1)[0]);
                            growing = true;
                        }
                    }

                    if (stroke.length >= 2) {
                        spineStrokes.push(stroke);
                    }
                }
            }

            finishedStrokes = spineStrokes.map(stroke => {
                let pts = stroke.map(p => ({ x: p.x, y: p.y, z: p.z, r: p.r }));

                const alpha = 0.4;
                for (let iter = 0; iter < 3; iter++) {
                    const temp = JSON.parse(JSON.stringify(pts));
                    for (let j = 1; j < pts.length - 1; j++) {
                        pts[j].x = temp[j].x * (1 - alpha) + (temp[j-1].x + temp[j+1].x) * 0.5 * alpha;
                        pts[j].y = temp[j].y * (1 - alpha) + (temp[j-1].y + temp[j+1].y) * 0.5 * alpha;
                        pts[j].z = temp[j].z * (1 - alpha) + (temp[j-1].z + temp[j+1].z) * 0.5 * alpha;
                    }
                }

                if (pts.length > 4) {
                    const taperLength = Math.min(5, Math.floor(pts.length / 2));
                    for (let k = 0; k < taperLength; k++) {
                        const factor = k / taperLength;
                        pts[k].z = pts[k].z * factor;
                        pts[pts.length - 1 - k].z = pts[pts.length - 1 - k].z * factor;
                    }
                } else {
                    for (let k = 0; k < pts.length; k++) {
                        const distToEnd = Math.min(k, pts.length - 1 - k);
                        const factor = distToEnd / (pts.length / 2);
                        pts[k].z = pts[k].z * factor;
                    }
                }

                return pts;
            }).map(path => cleanPath(path, cfg.resolution)).filter(path => path.length >= 2);

            if (isStraight && simpOuter.length > 4) {
                const N_verts = simpOuter.length;
                for (let i = 0; i < N_verts; i++) {
                    const prev = simpOuter[(i - 1 + N_verts) % N_verts];
                    const curr = simpOuter[i];
                    const next = simpOuter[(i + 1) % N_verts];

                    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
                    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                    const len1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y);
                    const len2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y);
                    if (len1 < 1e-6 || len2 < 1e-6) continue;

                    const cross = (v1.x / len1) * (v2.y / len2) - (v1.y / len1) * (v2.x / len2);
                    if (cross < -1e-5) { 
                        let nearestPtOnSpine = null;
                        let minDistSq = Infinity;
                        finishedStrokes.forEach(stroke => {
                            stroke.forEach(pt => {
                                const dSq = (pt.x - curr.x)**2 + (pt.y - curr.y)**2;
                                if (dSq < minDistSq) {
                                    minDistSq = dSq;
                                    nearestPtOnSpine = pt;
                                }
                            });
                        });

                        if (nearestPtOnSpine && minDistSq > 0.25) {
                            const miterLine = [
                                { x: curr.x, y: curr.y, z: 0, r: nearestPtOnSpine.r || toolRadius },
                                { x: nearestPtOnSpine.x, y: nearestPtOnSpine.y, z: nearestPtOnSpine.z, r: nearestPtOnSpine.r || toolRadius }
                            ];
                            finishedStrokes.push(cleanPath(miterLine, cfg.resolution));
                        }
                    }
                }
            }
        }

        return optimizePathOrder(finishedStrokes, 0, 0);
    }

    // 巢狀層數（從 1 起算）與父物件：和舊 vc.html 的 computePartNestingTopology 相同，只是輸入改成點陣列
    function topology(shapes) {
        const polys = shapes.map((path, idx) => ({ idx, path, area: Math.abs(getPolygonArea(path)), pt: path.length > 0 ? path[0] : { x: 0, y: 0 } }));
        const parents = polys.map(pA => {
            let best = null, minArea = Infinity;
            polys.forEach(pB => {
                if (pA.idx !== pB.idx && pB.area > pA.area && isPointInPolygon(pA.pt, pB.path) && pB.area < minArea) { minArea = pB.area; best = pB.idx; }
            });
            return best;
        });
        const depth = i => parents[i] === null ? 1 : depth(parents[i]) + 1;
        return { depths: shapes.map((_, i) => depth(i)), parents };
    }

    // V 雕刻：shapes = 一個圖層的物件（點陣列）；side 'odd' 雕第 1、3… 層（單獨的字本體），'even' 雕第 2、4… 層（外框裡的字）。
    // cfg = { d, depth, vbitAngle, toolType: 'vbit' | 'ballnose', resolution }
    // 回傳 { groups: [{ index, paths }], tooWide }：每個要雕的區域一組（排序用），tooWide = 刀具角度 / 直徑 / 深度不夠雕滿
    function vcarve(shapes, cfg, side) {
        const { depths, parents } = topology(shapes);
        const carve = i => side === 'even' ? depths[i] % 2 === 0 : depths[i] % 2 !== 0;
        const D_max = cfg.depth, theta = cfg.vbitAngle || 90, tanHalf = Math.tan((theta / 2) * Math.PI / 180);
        const toolRadius = cfg.d / 2.0;
        const r_max = cfg.toolType === 'ballnose'
            ? (D_max >= toolRadius ? toolRadius : Math.sqrt(Math.max(0, 2 * toolRadius * D_max - D_max * D_max)))
            : Math.min(toolRadius, D_max * tanHalf);
        const groups = [];
        for (let i = 0; i < shapes.length; i++) {
            if (!carve(i)) continue;
            const holes = shapes.filter((_, c) => parents[c] === i && !carve(c));
            const strokes = computeNestedVCarve({ outer: shapes[i], holes }, cfg);
            if (strokes.some(s => s.some(pt => pt.r > r_max + 1e-3))) return { groups: [], tooWide: true };
            // 同一區域內：淺的先雕（和舊版相同）
            strokes.sort((a, b) => Math.max(...b.map(pt => pt.z !== undefined ? pt.z : 0)) - Math.max(...a.map(pt => pt.z !== undefined ? pt.z : 0)));
            groups.push({ index: i, paths: strokes });
        }
        return { groups, tooWide: false };
    }

    // 沿線雕刻：沿著每個物件的線，深度 depth；每層下刀 step 小於深度時分層（V 刀預設一次到深）
    // open[i] 為 true 的是開放的線（例如定位線），照原樣雕、不接回起點
    function engrave(shapes, depth, step, resolution, open) {
        const passes = Math.max(1, Math.ceil(depth / (step || depth)));
        return shapes.map((path, i) => {
            const closed = !(open && open[i]) && path.length > 2 && (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y) ? [...path, path[0]] : path;
            const out = [];
            for (let k = 1; k <= passes; k++) {
                const z = -Math.min(depth, k * step || depth);
                out.push(cleanPath(closed.map(pt => ({ x: pt.x, y: pt.y, z })), resolution));
            }
            return out;
        });
    }

    return { vcarve, engrave, topology, computeNestedVCarve };
})();
