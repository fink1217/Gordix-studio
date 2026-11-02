// Gordix Studio 共用 G-code 預覽：解析成動作清單，畫 2D（SVG 路徑字串）與 3D（Three.js），產生續畫檔。
// 機器面板的進度是「行數百分比」（實測：50% 的續畫點在第 38,840 / 77,796 行），所以進度與續畫都以行數為準。
const GordixPreview = (() => {
    // 一個動作 = 從上一點直線走到 {x, y, z}；down = 這一段有在畫 / 切；line = 原檔行號（0 起）。
    // 有 M03 的檔（雷射、筆身模式）以 M03~M05 之間的 G1 為下筆；沒有 M03 的檔（Z 軸筆觸、CNC）以 Z ≤ 0 的 G1 為下筆。
    // 圓弧 G2/G3 依 I/J（或 R）切成每段約 1 mm、最多 5° 的小直線，全部記同一行號。
    // f = 這一段的進給（mm/min）；G0 為 null（空跑速度由播放器假設）。
    function parse(text) {
        const lines = text.split('\n');
        const spindle = /^\s*M0?3\b/im.test(text);
        const moves = [];
        let x = 0, y = 0, z = 0, g = 0, f = 1000, on = false;
        lines.forEach((raw, line) => {
            const words = raw.replace(/\(.*?\)|;.*/g, '').toUpperCase().match(/[A-Z]\s*-?[\d.]+/g) || [];
            const to = { x, y, z };
            let moved = false, I = null, J = null, R = null;
            for (const w of words) {
                const c = w[0], v = parseFloat(w.slice(1));
                if (c === 'G' && v <= 3) g = v;
                else if (c === 'M' && (v === 3 || v === 4)) on = true;
                else if (c === 'M' && v === 5) on = false;
                else if (c === 'F') f = v;
                else if (c === 'I') I = v;
                else if (c === 'J') J = v;
                else if (c === 'R') R = v;
                else if (c === 'X' || c === 'Y' || c === 'Z') { to[c.toLowerCase()] = v; moved = true; }
            }
            if (!moved) return;
            const down = g > 0 && (!spindle || on) && to.z <= 0;
            const feed = g > 0 ? f : null;
            const pts = (g === 2 || g === 3) ? arcPoints({ x, y, z }, to, I, J, R, g === 2) : [to];
            pts.forEach(q => moves.push({ x: q.x, y: q.y, z: q.z, down, line, f: feed }));
            ({ x, y, z } = to);
        });
        return { lines, moves, starts: strokeStarts(moves), hasZ: moves.some(m => m.z !== 0) };
    }

    // 圓弧中間點（含終點）。I/J 為圓心相對起點；只有 R 時取短弧（R < 0 取長弧）；起終點相同 = 整圈。
    function arcPoints(a, b, I, J, R, cw) {
        let cx, cy;
        if (I !== null || J !== null) {
            cx = a.x + (I || 0); cy = a.y + (J || 0);
        } else if (R) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
            if (!d || Math.abs(R) < d / 2) return [b];
            const h = Math.sqrt(R * R - d * d / 4) * ((cw ? 1 : -1) * (R > 0 ? 1 : -1));
            cx = mx - h * dy / d; cy = my + h * dx / d;
        } else return [b];
        const r = Math.hypot(a.x - cx, a.y - cy);
        const a0 = Math.atan2(a.y - cy, a.x - cx);
        let sweep = Math.atan2(b.y - cy, b.x - cx) - a0;
        if (cw && sweep >= -1e-9) sweep -= 2 * Math.PI;
        if (!cw && sweep <= 1e-9) sweep += 2 * Math.PI;
        const n = Math.min(720, Math.max(1, Math.ceil(Math.abs(sweep) * r / 1), Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
        const out = [];
        for (let i = 1; i < n; i++) {
            const t = i / n, ang = a0 + sweep * t;
            out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), z: a.z + (b.z - a.z) * t });
        }
        out.push(b);
        return out;
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

        // frac：第 upto 個動作做到幾成（播放動畫時刀頭在兩點之間）
        function setProgress(n, frac) {
            upto = Math.max(0, Math.min(n, moves.length));
            doneDown.setDrawRange(0, cumDown[upto] * 2);
            doneTravel.setDrawRange(0, cumTravel[upto] * 2);
            const a = moves[upto - 1] || { x: 0, y: 0, z: 0 }, b = moves[upto], f = b ? (frac || 0) : 0;
            const m = b ? { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f } : a;
            head.position.set(m.x, m.y, simObj ? m.z : Math.max(m.z, 0));
            if (simObj) simObj.update();
            render();
        }

        // 切削模擬的實體（GordixSim.Mesh 的回傳值）；第一次放進來時加燈光
        let simObj = null, lit = false;
        function setSim(obj) {
            if (simObj) scene.remove(simObj.group);
            simObj = obj;
            if (obj) {
                if (!lit) {
                    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
                    sun.position.set(0.4, -0.6, 1);
                    scene.add(new THREE.AmbientLight(0xffffff, 0.55), sun);
                    lit = true;
                }
                scene.add(obj.group);
            }
            render();
        }

        // 2D：正上方俯視、鎖住旋轉；3D：斜上方、可旋轉
        function setTop(on) {
            controls.enableRotate = !on;
            const c = controls.target, dist = camera.position.distanceTo(c);
            camera.position.set(c.x, c.y - (on ? 0.0001 : dist * 0.6), c.z + (on ? dist : dist * 0.8));
            controls.update();
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

        return { setMoves, setProgress, setSim, setTop, resize, counts, render };
    }

    // 播放器：依每段進給換算時間（G0 空跑假設 F3000），播放時用 requestAnimationFrame 往前走。
    // 監聽者收到 (n, frac)：已做完 n 個動作、第 n 個做到 frac（0~1）。顯示的百分比以行數為準（同機器面板）。
    const RAPID = 3000;
    function Player(p) {
        const t = [0];
        let px = 0, py = 0, pz = 0;
        p.moves.forEach(m => {
            t.push(t[t.length - 1] + Math.hypot(m.x - px, m.y - py, m.z - pz) / ((m.f || RAPID) / 60));
            px = m.x; py = m.y; pz = m.z;
        });
        const total = t[t.length - 1], len = p.moves.length;
        const listeners = [];
        let cur = total, speed = 1, playing = false, last = 0;

        // 最後一個 t[n] ≤ s 的 n（二分搜尋）
        function indexAt(s) {
            let lo = 0, hi = len;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= s) lo = mid; else hi = mid - 1; }
            return lo;
        }
        function state() {
            const n = indexAt(cur);
            const frac = n < len ? Math.min(1, (cur - t[n]) / ((t[n + 1] - t[n]) || 1)) : 0;
            return { n, frac, playing, speed, total, remaining: total - cur, lineFrac: n >= len ? 1 : p.moves[n].line / p.lines.length };
        }
        const emit = () => { const s = state(); listeners.forEach(fn => fn(s)); };
        function step(now) {
            if (!playing) return;
            cur = Math.min(total, cur + (now - last) / 1000 * speed);
            last = now;
            if (cur >= total) playing = false;
            emit();
            if (playing) requestAnimationFrame(step);
        }
        const api = {
            on(fn) { listeners.push(fn); return api; },
            state,
            play() {
                if (playing) return;
                if (cur >= total) cur = 0;
                playing = true; last = performance.now();
                emit();
                requestAnimationFrame(step);
            },
            pause() { playing = false; emit(); },
            toggle() { playing ? api.pause() : api.play(); },
            setSpeed(k) { speed = k; emit(); },
            seekMove(n) { cur = t[Math.max(0, Math.min(n, len))]; emit(); },
            // frac = 行數百分比（0~1），和進度滑桿、機器面板相同
            seekFrac(frac) { api.seekMove(at(p, frac).upto); },
            end() { playing = false; cur = total; emit(); }
        };
        return api;
    }

    const fmtTime = s => {
        s = Math.max(0, Math.round(s));
        const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
        return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(ss).padStart(2, '0')}`;
    };

    // 播放控制列（放進 el）：播放 / 暫停、速度、進度滑桿（行數百分比）、剩餘時間。
    // 速度：1×、10×、100×，「跳到最後」直接看完成的樣子。
    const BAR_TEXT = {
        zh: { play: '▶ 播放', pause: '❚❚ 暫停', end: '跳到最後', remain: '剩約 {t}', progress: '進度 {p}%' },
        en: { play: '▶ Play', pause: '❚❚ Pause', end: 'Jump to end', remain: '~{t} left', progress: '{p}%' }
    };
    function PlayerBar(el, player, lang) {
        el.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                <button data-pb="play" class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white min-w-[72px]"></button>
                <select data-pb="speed" class="px-1 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                    <option value="1">1×</option><option value="10">10×</option><option value="100" selected>100×</option><option value="1000">1000×</option>
                </select>
                <button data-pb="end" class="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200"></button>
                <input data-pb="slider" type="range" min="0" max="1000" value="1000" class="flex-1 min-w-[120px] accent-emerald-500">
                <span data-pb="text" class="font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap"></span>
            </div>`;
        const q = k => el.querySelector(`[data-pb="${k}"]`);
        let L = BAR_TEXT[lang] || BAR_TEXT.zh;
        player.setSpeed(100);
        q('play').onclick = () => player.toggle();
        q('end').onclick = () => player.end();
        q('speed').onchange = e => player.setSpeed(parseFloat(e.target.value));
        q('slider').oninput = e => { player.pause(); player.seekFrac(e.target.value / 1000); };
        function update(s) {
            q('play').innerText = s.playing ? L.pause : L.play;
            q('end').innerText = L.end;
            if (document.activeElement !== q('slider')) q('slider').value = Math.round(s.lineFrac * 1000);
            q('text').innerText = L.progress.replace('{p}', Math.round(s.lineFrac * 100)) + ' · ' + L.remain.replace('{t}', fmtTime(s.remaining));
        }
        player.on(update);
        update(player.state());
        return { setLang(l) { L = BAR_TEXT[l] || BAR_TEXT.zh; update(player.state()); } };
    }

    return { parse, strokeStarts, at, resume, svg2d, View3D, Player, PlayerBar, fmtTime };
})();
