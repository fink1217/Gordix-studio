// Gordix Studio 共用 G-code 預覽：解析成動作清單，畫 2D（SVG 路徑字串）與 3D（Three.js），產生續畫檔。
// 機器面板的進度是「行數百分比」（實測：50% 的續畫點在第 38,840 / 77,796 行），所以進度與續畫都以行數為準。
const GordixPreview = (() => {
    // 一個動作 = 從上一點直線走到 {x, y, z}；down = 這一段有在畫 / 切；line = 原檔行號（0 起）。
    // 有 M03 的檔（雷射、筆身模式）以 M03~M05 之間的 G1 為下筆；沒有 M03 的檔（Z 軸筆觸、CNC）以 Z ≤ 0 的 G1 為下筆。
    // 圓弧 G2/G3 以直線近似到終點（繪圖工具不輸出圓弧）。
    function parse(text) {
        const lines = text.split('\n');
        const spindle = /^\s*M0?3\b/im.test(text);
        const moves = [];
        let x = 0, y = 0, z = 0, g = 0, on = false;
        lines.forEach((raw, line) => {
            const words = raw.replace(/\(.*?\)|;.*/g, '').toUpperCase().match(/[A-Z]\s*-?[\d.]+/g) || [];
            let moved = false;
            for (const w of words) {
                const c = w[0], v = parseFloat(w.slice(1));
                if (c === 'G' && v <= 3) g = v;
                else if (c === 'M' && (v === 3 || v === 4)) on = true;
                else if (c === 'M' && v === 5) on = false;
                else if (c === 'X') { x = v; moved = true; }
                else if (c === 'Y') { y = v; moved = true; }
                else if (c === 'Z') { z = v; moved = true; }
            }
            if (moved) moves.push({ x, y, z, down: g > 0 && (!spindle || on) && z <= 0, line });
        });
        return { lines, moves, starts: strokeStarts(moves), hasZ: moves.some(m => m.z !== 0) };
    }

    // 筆劃起點（動作索引）：沒在畫的移動，下一個動作開始畫 → 這個移動就是一筆的開頭（結尾回原點的 G0 不算）
    function strokeStarts(moves) {
        const out = [];
        for (let i = 0; i + 1 < moves.length; i++) if (!moves[i].down && moves[i + 1].down) out.push(i);
        return out;
    }

    // 面板顯示 frac 時：已做完的動作數（upto），以及續畫要從第幾筆開始（k，0 起 = 該行所在的那一筆，整筆重畫）
    function at(p, frac) {
        const L = Math.floor(frac * p.lines.length);
        let upto = 0, k = 0;
        while (upto < p.moves.length && p.moves[upto].line < L) upto++;
        while (k + 1 < p.starts.length && p.moves[p.starts[k + 1]].line <= L) k++;
        return { line: L, upto, k };
    }

    // 續畫檔 = 原檔第一筆之前的表頭（單位、速度、抬筆）原封不動 + 從第 k 筆的起點移動開始的原內容，不加任何東西
    function resume(p, frac) {
        if (!p.starts.length) return { text: p.lines.join('\n'), stroke: 0, of: 0, line: 0 };
        const { k } = at(p, frac);
        const head = p.moves[p.starts[0]].line, from = p.moves[p.starts[k]].line;
        return { text: p.lines.slice(0, head).concat(p.lines.slice(from)).join('\n'), stroke: k + 1, of: p.starts.length, line: from };
    }

    // 2D 路徑字串（機器座標，SVG 的 y = -Y）：done = 已畫、todo = 還沒畫、travel = 空跑（只到 upto 為止）
    function svg2d(p, upto) {
        const out = { done: '', todo: '', travel: '' };
        let px = 0, py = 0, last = null;
        p.moves.forEach((m, i) => {
            const key = !m.down ? 'travel' : i < upto ? 'done' : 'todo';
            if (key === 'travel' && i >= upto) last = null;
            else {
                out[key] += (last === key ? '' : `M${px} ${-py}`) + `L${m.x} ${-m.y}`;
                last = key;
            }
            px = m.x; py = m.y;
        });
        return out;
    }

    // 3D：Three.js r128 + OrbitControls（由頁面載入），Z 朝上。下筆段：已畫實線、未畫淡色；空跑段抬高顯示到目前進度。
    // 進度只改 drawRange，不重建幾何。outlines = 板材、加工範圍等參考框（[{x, y}]，畫在 Z = 0）。
    function View3D(el) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e6);
        camera.up.set(0, 0, 1);
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        const render = () => renderer.render(scene, camera);
        controls.addEventListener('change', render);
        let group = null, doneDown = null, doneTravel = null, head = null, moves = [], cumDown = [0], cumTravel = [0], upto = 0;

        const geometry = list => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
            return g;
        };
        // 同一份頂點資料再包一個幾何，才能各自設定 drawRange
        const sharing = g => {
            const s = new THREE.BufferGeometry();
            s.setAttribute('position', g.getAttribute('position'));
            return s;
        };
        const lines = (geo, color, opacity) =>
            new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));

        function setMoves(p, outlines) {
            if (group) {
                scene.remove(group);
                group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            }
            moves = p.moves;
            // 鏡頭對準路徑本身（參考框通常大很多），沒有路徑才看參考框
            const box = new THREE.Box3();
            moves.forEach(m => box.expandByPoint(new THREE.Vector3(m.x, m.y, m.z)));
            if (box.isEmpty()) (outlines || []).forEach(o => o.forEach(q => box.expandByPoint(new THREE.Vector3(q.x, q.y, 0))));
            if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 0));
            const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 10);
            const lift = p.hasZ ? 0 : size * 0.01;   // 沒有 Z 的檔，空跑抬高一點才分得出來

            const down = [], travel = [];
            cumDown = [0]; cumTravel = [0];
            let px = 0, py = 0, pz = 0;
            moves.forEach(m => {
                if (m.down) down.push(px, py, pz, m.x, m.y, m.z);
                else travel.push(px, py, Math.max(pz, 0) + lift, m.x, m.y, Math.max(m.z, 0) + lift);
                cumDown.push(down.length / 6); cumTravel.push(travel.length / 6);
                px = m.x; py = m.y; pz = m.z;
            });
            const downAll = geometry(down), travelAll = geometry(travel);
            doneDown = sharing(downAll);
            doneTravel = sharing(travelAll);
            group = new THREE.Group();
            group.add(lines(downAll, 0x94a3b8, 0.35), lines(doneDown, 0x2563eb, 1), lines(doneTravel, 0xf97316, 0.5));
            (outlines || []).forEach(o => {
                const ring = [];
                o.forEach((q, i) => { const r = o[(i + 1) % o.length]; ring.push(q.x, q.y, 0, r.x, r.y, 0); });
                group.add(lines(geometry(ring), 0x64748b, 0.8));
            });
            head = new THREE.Mesh(new THREE.SphereGeometry(size * 0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
            group.add(head);
            scene.add(group);

            const c = box.getCenter(new THREE.Vector3());
            controls.target.copy(c);
            // 斜上方往下看；距離依視角與畫面寬高比，讓整個路徑剛好放得下
            const dist = size / 2 / Math.tan(camera.fov * Math.PI / 360) / Math.min(1, camera.aspect) * 1.1;
            camera.position.set(c.x, c.y - dist * 0.6, c.z + dist * 0.8);
            controls.update();
            setProgress(moves.length);
        }

        function setProgress(n) {
            upto = Math.max(0, Math.min(n, moves.length));
            doneDown.setDrawRange(0, cumDown[upto] * 2);
            doneTravel.setDrawRange(0, cumTravel[upto] * 2);
            const m = moves[upto - 1] || { x: 0, y: 0, z: 0 };
            head.position.set(m.x, m.y, Math.max(m.z, 0));
            render();
        }

        function resize() {
            const w = el.clientWidth || 1, h = el.clientHeight || 1;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
        }

        const counts = () => ({ down: cumDown[cumDown.length - 1], travel: cumTravel[cumTravel.length - 1], doneDown: cumDown[upto] });

        return { setMoves, setProgress, resize, counts };
    }

    return { parse, strokeStarts, at, resume, svg2d, View3D };
})();
