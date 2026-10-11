// Gordix Studio 共用區域分析：把黑白遮罩分成「細線」與「色塊」，
// 細線沿中線畫一次，色塊往內縮半個筆寬畫外框再填滿。
// 遮罩格式 { w, h, data: Uint8Array }，1 = 要畫。座標以像素中心為整數，像素 i 佔 [i-0.5, i+0.5]。
const GordixRegions = (() => {
    const INF = 1e20;
    const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

    const blank = (w, h) => ({ w, h, data: new Uint8Array(w * h) });

    // 一維平方距離轉換（Felzenszwalb & Huttenlocher）
    function edt1d(f, n, d, v, z) {
        let k = 0;
        v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < n; q++) {
            let s;
            while ((s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    // 每格到最近「值 = target」格子的平方距離
    function edt(mask, target) {
        const { w, h, data } = mask;
        const out = new Float64Array(w * h);
        for (let i = 0; i < w * h; i++) out[i] = data[i] === target ? 0 : INF;
        const n = Math.max(w, h);
        const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) f[y] = out[y * w + x];
            edt1d(f, h, d, v, z);
            for (let y = 0; y < h; y++) out[y * w + x] = d[y];
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) f[x] = out[y * w + x];
            edt1d(f, w, d, v, z);
            for (let x = 0; x < w; x++) out[y * w + x] = d[x];
        }
        return out;
    }

    // 以半徑 r 的圓做開運算：圓放得進去的地方是色塊，其餘是細線
    function splitThickThin(mask, r) {
        const dIn = edt(mask, 0);
        const eroded = blank(mask.w, mask.h);
        for (let i = 0; i < dIn.length; i++) eroded.data[i] = mask.data[i] && dIn[i] > r * r ? 1 : 0;
        const dE = edt(eroded, 1);
        const thick = blank(mask.w, mask.h), thin = blank(mask.w, mask.h);
        for (let i = 0; i < dE.length; i++) {
            if (!mask.data[i]) continue;
            if (dE[i] <= r * r) thick.data[i] = 1; else thin.data[i] = 1;
        }
        return { thick, thin, dIn };
    }

    // 以半徑 r 的圓做閉運算：補掉比筆寬窄的破洞與縫（筆畫不出來，留著只會讓骨架繞圈）
    function close(mask, r) {
        const dOut = edt(mask, 1);
        const grown = blank(mask.w, mask.h);
        for (let i = 0; i < dOut.length; i++) grown.data[i] = dOut[i] <= r * r ? 1 : 0;
        const dBack = edt(grown, 0);
        const out = blank(mask.w, mask.h);
        for (let i = 0; i < dBack.length; i++) out.data[i] = mask.data[i] || dBack[i] > r * r ? 1 : 0;
        return out;
    }

    // 8 連通標記，回傳 { labels, comps: [{ pixels, x0, y0, x1, y1 }] }
    function components(mask) {
        const { w, h, data } = mask;
        const labels = new Int32Array(w * h).fill(-1);
        const comps = [];
        const stack = [];
        for (let i = 0; i < w * h; i++) {
            if (!data[i] || labels[i] >= 0) continue;
            const c = { pixels: [], x0: w, y0: h, x1: 0, y1: 0 };
            labels[i] = comps.length; stack.push(i);
            while (stack.length) {
                const p = stack.pop(), x = p % w, y = (p - x) / w;
                c.pixels.push(p);
                if (x < c.x0) c.x0 = x;
                if (x > c.x1) c.x1 = x;
                if (y < c.y0) c.y0 = y;
                if (y > c.y1) c.y1 = y;
                for (const [dx, dy] of N8) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const q = ny * w + nx;
                    if (data[q] && labels[q] < 0) { labels[q] = comps.length; stack.push(q); }
                }
            }
            comps.push(c);
        }
        return { labels, comps };
    }

    // 把一個連通塊裁成獨立的小遮罩（四周留 1 格空白）
    function crop(w, comp) {
        const ox = comp.x0 - 1, oy = comp.y0 - 1;
        const m = blank(comp.x1 - comp.x0 + 3, comp.y1 - comp.y0 + 3);
        comp.pixels.forEach(p => { const x = p % w, y = (p - x) / w; m.data[(y - oy) * m.w + (x - ox)] = 1; });
        return { m, ox, oy };
    }

    const shift = (paths, ox, oy) => paths.map(p => p.map(q => ({ x: q.x + ox, y: q.y + oy })));

    // Zhang-Suen 細化成一像素寬骨架
    function skeleton(mask) {
        const { w, h } = mask;
        const d = Uint8Array.from(mask.data);
        const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[y * w + x];
        let changed = true;
        while (changed) {
            changed = false;
            for (let pass = 0; pass < 2; pass++) {
                const del = [];
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    if (!d[y * w + x]) continue;
                    const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
                               at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
                    const b = p.reduce((s, v) => s + v, 0);
                    if (b < 2 || b > 6) continue;
                    let a = 0;
                    for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
                    if (a !== 1) continue;
                    if (pass === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
                    del.push(y * w + x);
                }
                del.forEach(i => { d[i] = 0; });
                if (del.length) changed = true;
            }
        }
        // 去掉樓梯狀的多餘角點：拿掉後鄰居仍彼此相連，就不影響連通，避免走線時誤判成交叉點
        const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (!d[y * w + x]) continue;
            const on = ring.map(([dx, dy]) => at(x + dx, y + dy));
            if (on.reduce((s, v) => s + v, 0) < 2) continue;
            const group = on.map((v, i) => v ? i : -1);
            const find = i => group[i] === i ? i : (group[i] = find(group[i]));
            const join = (a, b) => { if (on[a] && on[b]) group[find(a)] = find(b); };
            for (let i = 0; i < 8; i++) join(i, (i + 1) % 8);
            for (let i = 0; i < 8; i += 2) join(i, (i + 2) % 8);
            const roots = new Set(on.map((v, i) => v ? find(i) : -1).filter(r => r >= 0));
            if (roots.size === 1) d[y * w + x] = 0;
        }
        return { w, h, data: d };
    }

    // 骨架 → 折線：從端點 / 交叉點沿線走到下一個節點；沒有節點的閉環另外走
    function traceSkeleton(skel) {
        const { w, h, data } = skel;
        const nb = i => {
            const x = i % w, y = (i - x) / w, out = [];
            for (const [dx, dy] of N8) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx]) out.push(ny * w + nx);
            }
            return out;
        };
        const deg = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) if (data[i]) deg[i] = nb(i).length;
        const isNode = i => deg[i] !== 2;
        const used = new Set();
        const key = (a, b) => a < b ? a + ',' + b : b + ',' + a;
        const paths = [];
        const walk = (start, next) => {
            const path = [start];
            let prev = start, cur = next;
            used.add(key(prev, cur));
            while (true) {
                path.push(cur);
                if (isNode(cur) || cur === start) break;
                const cand = nb(cur).filter(q => q !== prev && !used.has(key(cur, q)));
                if (!cand.length) break;
                prev = cur; cur = cand[0];
                used.add(key(prev, cur));
            }
            return path;
        };
        for (let i = 0; i < w * h; i++) {
            if (!data[i] || !isNode(i)) continue;
            if (deg[i] === 0) { paths.push([i]); continue; }
            for (const q of nb(i)) if (!used.has(key(i, q))) paths.push(walk(i, q));
        }
        for (let i = 0; i < w * h; i++) {
            if (!data[i] || isNode(i)) continue;
            const free = nb(i).filter(q => !used.has(key(i, q)));
            if (free.length === 2) paths.push(walk(i, free[0]));
        }
        return paths.map(p => p.map(i => ({ x: i % w, y: (i - i % w) / w })));
    }

    const plen = p => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);
    const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 1.5;
    const closed = p => p.length > 2 && same(p[0], p[p.length - 1]);

    // 剪掉一端懸空、另一端接在交叉點、又短於 minLen 的毛刺；兩端都懸空的短線（點、短劃）保留
    function pruneSpurs(paths, minLen) {
        let cur = paths;
        for (let iter = 0; iter < 5; iter++) {
            const ends = cur.flatMap(p => [p[0], p[p.length - 1]]);
            const touches = pt => ends.filter(e => same(e, pt)).length > 1;
            const next = cur.filter(p => {
                if (plen(p) >= minLen || closed(p)) return true;
                return touches(p[0]) === touches(p[p.length - 1]);
            });
            if (next.length === cur.length) break;
            cur = next;
        }
        return cur;
    }

    // 端點相接的折線串起來，減少抬筆
    function mergePaths(paths) {
        const list = paths.map(p => p.slice());
        let merged = true;
        while (merged) {
            merged = false;
            for (let i = 0; i < list.length && !merged; i++) {
                const a = list[i];
                if (closed(a)) continue;
                for (let j = i + 1; j < list.length; j++) {
                    const b = list[j];
                    if (closed(b)) continue;
                    let joined = null;
                    if (same(a[a.length - 1], b[0])) joined = a.concat(b.slice(1));
                    else if (same(a[a.length - 1], b[b.length - 1])) joined = a.concat(b.slice(0, -1).reverse());
                    else if (same(a[0], b[b.length - 1])) joined = b.concat(a.slice(1));
                    else if (same(a[0], b[0])) joined = b.slice().reverse().concat(a.slice(1));
                    if (joined) { list[i] = joined; list.splice(j, 1); merged = true; break; }
                }
            }
        }
        return list;
    }

    function segDist(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
        let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }

    // Ramer-Douglas-Peucker 簡化
    function simplify(pts, eps) {
        if (pts.length <= 2) return pts;
        const a = pts[0], b = pts[pts.length - 1];
        let dmax = 0, idx = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const d = segDist(pts[i], a, b);
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax <= eps) return [a, b];
        return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
    }

    // 遮罩 → 中線折線（每條線只走一次）
    function centerlines(mask, minLen) {
        const paths = mergePaths(pruneSpurs(traceSkeleton(skeleton(mask)), minLen));
        return paths.map(p => p.length > 2 ? simplify(p, 0.75) : p);
    }

    // marching squares（0.5 等值）→ 閉合輪廓；黑色在行進方向右側（y 向下的畫面座標）
    function contours(mask) {
        const { w, h, data } = mask;
        const v = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : data[y * w + x];
        const next = new Map();
        const P = (x2, y2) => x2 + ',' + y2;   // 以 2 倍座標當 key，中點都是整數
        const seg = (a, b) => next.set(P(a[0], a[1]), b);
        for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
            const c = v(x, y) * 8 + v(x + 1, y) * 4 + v(x + 1, y + 1) * 2 + v(x, y + 1);
            if (c === 0 || c === 15) continue;
            const T = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1], B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
            switch (c) {
                case 1: seg(L, B); break;
                case 2: seg(B, R); break;
                case 3: seg(L, R); break;
                case 4: seg(R, T); break;
                case 5: seg(L, T); seg(R, B); break;
                case 6: seg(B, T); break;
                case 7: seg(L, T); break;
                case 8: seg(T, L); break;
                case 9: seg(T, B); break;
                case 10: seg(T, R); seg(B, L); break;
                case 11: seg(T, R); break;
                case 12: seg(R, L); break;
                case 13: seg(R, B); break;
                case 14: seg(B, L); break;
            }
        }
        const loops = [];
        for (const startKey of Array.from(next.keys())) {
            if (!next.has(startKey)) continue;
            const loop = [];
            let k = startKey;
            while (next.has(k)) {
                const [x2, y2] = k.split(',').map(Number);
                loop.push({ x: x2 / 2, y: y2 / 2 });
                const nxt = next.get(k);
                next.delete(k);
                k = P(nxt[0], nxt[1]);
            }
            if (loop.length >= 3) loops.push(simplify(loop.concat([loop[0]]), 0.3).slice(0, -1));
        }
        return loops;
    }

    // 往內縮 r 像素後的輪廓（筆的中心要走的路線）
    function inset(mask, r, dIn) {
        const d = dIn || edt(mask, 0);
        const m = blank(mask.w, mask.h);
        for (let i = 0; i < d.length; i++) m.data[i] = mask.data[i] && d[i] > r * r ? 1 : 0;
        return contours(m);
    }

    // 掃描線填滿（奇偶規則），與繪圖工具原本的 generateFillLines 相同
    function hatch(paths, deg, spacing) {
        const lines = [];
        if (!paths.length || isNaN(spacing) || spacing <= 1.0) return lines;
        const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const rot = paths.map(p => p.map(pt => ({ x: pt.x * cos + pt.y * sin, y: -pt.x * sin + pt.y * cos })));
        let minY = Infinity, maxY = -Infinity;
        rot.forEach(rp => rp.forEach(pt => { minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }));
        if ((maxY - minY) / spacing > 3000) return lines;
        for (let y = minY + spacing; y < maxY; y += spacing) {
            const xs = [];
            rot.forEach(rp => {
                for (let i = 0; i < rp.length; i++) {
                    const p1 = rp[i], p2 = rp[(i + 1) % rp.length];
                    if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) xs.push(p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y));
                }
            });
            xs.sort((a, b) => a - b);
            for (let i = 0; i + 1 < xs.length; i += 2) {
                lines.push([{ x: xs[i] * cos - y * sin, y: xs[i] * sin + y * cos },
                            { x: xs[i + 1] * cos - y * sin, y: xs[i + 1] * sin + y * cos }]);
            }
        }
        return lines;
    }

    // 細線端點若靠近色塊，沿線的方向延伸進色塊再多半個筆寬，避免接縫留白
    function extendInto(path, thick, maxLen, extra) {
        const tryEnd = (a, b) => {
            const L = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const ux = (a.x - b.x) / L, uy = (a.y - b.y) / L;
            for (let t = 0.5; t <= maxLen; t += 0.5) {
                const x = Math.round(a.x + ux * t), y = Math.round(a.y + uy * t);
                if (x < 0 || y < 0 || x >= thick.w || y >= thick.h) return null;
                if (thick.data[y * thick.w + x]) return { x: a.x + ux * (t + extra), y: a.y + uy * (t + extra) };
            }
            return null;
        };
        if (path.length < 2 || closed(path)) return path;
        const head = tryEnd(path[0], path[1]), tail = tryEnd(path[path.length - 1], path[path.length - 2]);
        return (head ? [head] : []).concat(path, tail ? [tail] : []);
    }

    // 遮罩 → 區域。每個區域同時算好中線與外框，圖層換畫法時不用重算。
    function analyze(input, opts) {
        const pen = opts.penPx, penR = pen / 2, openR = 0.75 * pen;
        const mask = close(input, penR);
        const { thick, thin, dIn } = splitThickThin(mask, openR);
        const dT = edt(thick, 1);
        const regions = [];
        // core：外框那一圈（筆中心在半筆寬深處）蓋不到、要靠填滿補的內部（深度 > 一個筆寬）
        const add = (kind, comp, center, outline, core) => regions.push({
            id: regions.length, kind, center, outline, core, area: comp.pixels.length,
            bbox: [comp.x0, comp.y0, comp.x1, comp.y1], layerId: null });

        for (const comp of components(thin).comps) {
            // 只是色塊邊緣被開運算削掉的碎邊 → 色塊外框已涵蓋，不另外畫
            const far = comp.pixels.reduce((s, p) => Math.max(s, dT[p]), 0);
            if (far <= (openR + 1) * (openR + 1)) continue;
            const { m, ox, oy } = crop(mask.w, comp);
            const center = shift(centerlines(m, pen), ox, oy).map(p => extendInto(p, thick, pen * 1.5, penR));
            const raw = shift(contours(m), ox, oy);
            add('line', comp, center, raw, raw);
        }
        for (const comp of components(thick).comps) {
            const { m, ox, oy } = crop(mask.w, comp);
            const deeper = r => {
                const k = blank(m.w, m.h);
                comp.pixels.forEach(p => {
                    if (dIn[p] <= r * r) return;
                    const x = p % mask.w, y = (p - x) / mask.w;
                    k.data[(y - oy) * m.w + (x - ox)] = 1;
                });
                return shift(contours(k), ox, oy);
            };
            let outline = deeper(penR);
            if (!outline.length) outline = shift(contours(m), ox, oy);
            add('blob', comp, shift(centerlines(m, pen), ox, oy), outline, deeper(pen));
        }
        return regions;
    }

    // 依圖層（順序 = 畫的順序）輸出：open = 中線、closed = 外框、hatch = 填滿線
    function emit(regions, layers, opts) {
        const out = { open: [], closed: [], hatch: [] };
        for (const layer of layers) {
            if (!layer.visible) continue;
            for (const g of regions) {
                if (g.layerId !== layer.id) continue;
                if (layer.mode === 'center') out.open.push(...g.center);
                if (layer.mode === 'outline' || layer.mode === 'outline_fill') out.closed.push(...g.outline);
                if (layer.mode === 'fill') out.hatch.push(...hatch(g.outline, opts.fillDeg, opts.fillSpacingPx));
                if (layer.mode === 'outline_fill') out.hatch.push(...hatch(g.core, opts.fillDeg, opts.fillSpacingPx));
            }
        }
        return out;
    }

    return { edt, close, splitThickThin, components, skeleton, traceSkeleton, pruneSpurs, mergePaths, simplify,
             centerlines, contours, inset, hatch, analyze, emit };
})();
