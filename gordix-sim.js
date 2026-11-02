// Gordix Studio 共用切削模擬：把板材切成細格子記錄高度（高度圖），刀具每走一段就把經過的格子削成刀尖形狀。
// 只模擬「刀尖形狀掃過的體積」，不模擬皮帶、機身晃動、木材撕裂與刀把碰撞。
// 座標：機器 mm，Z0 = 材料表面，往下為負；板材底面 = -厚度，削到底面的格子就是切穿（洞）。
const GordixSim = (() => {
    const MAX_CELLS = 600000;   // 手機也跑得動的格數上限；範圍大時自動放大格子

    // 刀尖輪廓：距刀具中心 r 的位置，削出的面比刀尖高多少；超出刀半徑回傳 Infinity（不削）
    // tool = { type: 'flat' | 'ball' | 'vbit', d, angle }（angle 為 V 刀夾角，度）
    function profile(tool) {
        const R = tool.d / 2;
        if (tool.type === 'ball') return r => r <= R ? R - Math.sqrt(R * R - r * r) : Infinity;
        if (tool.type === 'vbit') {
            const k = 1 / Math.tan((tool.angle || 90) * Math.PI / 360);
            return r => r <= R ? r * k : Infinity;
        }
        return r => r <= R ? 0 : Infinity;
    }

    // 建立模擬：範圍 = 會切到材料（Z < 0）的動作外框，外擴刀半徑 + 2 mm
    function create(moves, tool, thickness) {
        const R = tool.d / 2 + 2;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, px = 0, py = 0, pz = 0;
        moves.forEach(m => {
            if (Math.min(m.z, pz) < 0) {
                minX = Math.min(minX, px, m.x); maxX = Math.max(maxX, px, m.x);
                minY = Math.min(minY, py, m.y); maxY = Math.max(maxY, py, m.y);
            }
            px = m.x; py = m.y; pz = m.z;
        });
        if (!isFinite(minX)) { minX = minY = -10; maxX = maxY = 10; }
        minX -= R; minY -= R; maxX += R; maxY += R;
        const res = Math.max(0.1, Math.sqrt((maxX - minX) * (maxY - minY) / MAX_CELLS));
        const nx = Math.ceil((maxX - minX) / res) + 1, ny = Math.ceil((maxY - minY) / res) + 1;
        const sim = { x0: minX, y0: minY, res, nx, ny, h: new Float32Array(nx * ny), bottom: -Math.abs(thickness), tool, prof: profile(tool), moves, done: 0, dirty: true };
        return sim;
    }

    function reset(sim) {
        sim.h.fill(0);
        sim.done = 0;
        sim.partial = null;
        sim.dirty = true;
    }

    // 刀尖從 a 直線走到 b（{x, y, z}）：經過範圍內每一格取最低的刀尖面
    function carve(sim, a, b) {
        if (Math.min(a.z, b.z) >= 0) return;   // 都在材料表面以上，沒切到
        const R = sim.tool.d / 2, res = sim.res, h = sim.h, nx = sim.nx, bottom = sim.bottom, prof = sim.prof;
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - sim.x0) / res));
        const i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + R - sim.x0) / res));
        const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - sim.y0) / res));
        const j1 = Math.min(sim.ny - 1, Math.ceil((Math.max(a.y, b.y) + R - sim.y0) / res));
        const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
        for (let j = j0; j <= j1; j++) {
            const y = sim.y0 + j * res;
            for (let i = i0; i <= i1; i++) {
                const x = sim.x0 + i * res;
                const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
                const r = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
                const v = a.z + t * (b.z - a.z) + prof(r);
                const k = j * nx + i;
                if (v < h[k]) h[k] = Math.max(v, bottom);
            }
        }
        sim.dirty = true;
    }

    // 模擬到「做完 n 個動作，第 n 個做到 frac」。往回拖時從頭重算。
    // deadline（performance.now() 的時間）到了就先停，回傳 false，下一個畫面再繼續，避免大檔卡住頁面。
    function advance(sim, n, frac, deadline) {
        const moves = sim.moves;
        n = Math.max(0, Math.min(n, moves.length));
        frac = frac || 0;
        // 削過的格子回不去：比上次（含做到一半的那段）還早，就從頭重算
        const p = sim.partial;
        if (n < sim.done || (p && (n < p.n || (n === p.n && frac < p.frac)))) reset(sim);
        sim.partial = null;
        const prev = i => i > 0 ? moves[i - 1] : { x: 0, y: 0, z: 5 };
        while (sim.done < n) {
            carve(sim, prev(sim.done), moves[sim.done]);
            sim.done++;
            if (deadline && (sim.done & 63) === 0 && performance.now() > deadline) return false;
        }
        if (frac > 0 && n < moves.length) {
            const a = prev(n), b = moves[n];
            carve(sim, a, { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, z: a.z + (b.z - a.z) * frac });
            sim.partial = { n, frac };
        }
        return true;
    }

    // 統計：切到的格數、切穿的格數、最深處
    function stats(sim) {
        let cut = 0, through = 0, min = 0;
        for (let k = 0; k < sim.h.length; k++) {
            const v = sim.h[k];
            if (v < -1e-6) cut++;
            if (v <= sim.bottom + 1e-6) through++;
            if (v < min) min = v;
        }
        return { cut, through, min, res: sim.res, cells: sim.h.length };
    }

    // Three.js 實體：有光影的板材上表面（依深度上色、切穿處挖空）＋ 板材外框 ＋ 下面的底板
    function Mesh(sim, THREE) {
        const { nx, ny, res, x0, y0 } = sim;
        const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 4);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            pos[k * 3] = x0 + i * res; pos[k * 3 + 1] = y0 + j * res;
        }
        const idx = [];
        for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
            const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
        geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
        const surface = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }));

        const group = new THREE.Group();
        group.add(surface);
        // 板材四周的外框（表面到底面）
        const x1 = x0 + (nx - 1) * res, y1 = y0 + (ny - 1) * res, zb = sim.bottom;
        const box = [];
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach((p, i, arr) => {
            const q = arr[(i + 1) % 4];
            box.push(p[0], p[1], 0, q[0], q[1], 0, p[0], p[1], zb, q[0], q[1], zb, p[0], p[1], 0, p[0], p[1], zb);
        });
        const boxGeo = new THREE.BufferGeometry();
        boxGeo.setAttribute('position', new THREE.Float32BufferAttribute(box, 3));
        group.add(new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0x92400e })));
        // 底板（切穿處看得到）
        const base = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 20, y1 - y0 + 20),
            new THREE.MeshLambertMaterial({ color: 0x475569, side: THREE.DoubleSide }));
        base.position.set((x0 + x1) / 2, (y0 + y1) / 2, zb - 0.5);
        group.add(base);

        // 依高度圖更新表面：表面淺木色，越深越暗；切穿 alpha = 0（alphaTest 會挖掉）
        function update() {
            if (!sim.dirty) return;
            const h = sim.h, depth = -sim.bottom || 1;
            for (let k = 0; k < h.length; k++) {
                const v = h[k];
                pos[k * 3 + 2] = v;
                const t = Math.min(1, -v / depth);
                col[k * 4] = 0.86 - 0.42 * t; col[k * 4 + 1] = 0.72 - 0.42 * t; col[k * 4 + 2] = 0.52 - 0.34 * t;
                col[k * 4 + 3] = v <= sim.bottom + 1e-6 ? 0 : 1;
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            geo.computeVertexNormals();
            sim.dirty = false;
        }
        function dispose() {
            group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        }
        update();
        return { group, update, dispose, base };   // base：2D 俯視壓平時要藏起來，否則會蓋住表面
    }

    return { MAX_CELLS, profile, create, reset, carve, advance, stats, Mesh };
})();
