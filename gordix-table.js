// 工作台資料：桌長配置產生器與各轉檔工具共用。
// 尺寸單位一律為 mm；座標原點為機器中心（工作台中心）。
const GordixTable = (() => {
    const KEY = 'gordix-tables';

    const DEFAULTS = {
        1: { E: 1460, S: 2560, W: 1460, N: 2560, D: 2947, X: 1.000, Y: 1.000 },
        2: { E: 1460, S: 1340, W: 1460, N: 1340, D: 1982, X: 1.000, Y: 1.000 },
        3: { E: 1440, S: 1320, W: 1440, N: 1320, D: 1953, X: 1.000, Y: 1.000 },
        4: { E: 840, S: 1320, W: 840, N: 1320, D: 1565, X: 1.000, Y: 1.000 },
        5: { E: 840, S: 720, W: 840, N: 720, D: 1106, X: 1.000, Y: 1.000 }
    };

    // 讀取使用者存過的設定；沒有存過或資料損毀時回傳 null
    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(KEY));
            return saved && saved.tables ? saved : null;
        } catch (e) {
            return null;
        }
    }

    // 儲存目前編輯中的值；保留上次下載 table.cfg 時的快照（configured）
    function save(tables, currentId) {
        const prev = load();
        write({ tables, currentId, savedAt: Date.now(), configured: prev ? prev.configured : undefined });
    }

    // 使用者下載 table.cfg 時呼叫：記下實際交給機器的設定，首頁據此判斷「工作台已設定」
    function markConfigured(tables, currentId) {
        const snapshot = JSON.parse(JSON.stringify(tables));
        write({ tables, currentId, savedAt: Date.now(), configured: { tables: snapshot, currentId, at: Date.now() } });
    }

    function write(data) {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
        } catch (e) { /* 無痕模式等無法儲存的情況，下次開啟會回到預設值 */ }
    }

    // 機器可到達的加工座標範圍 (±x, ±y)，X 沿 S/N 邊，Y 沿 W/E 邊
    function workRange(d) {
        const tan15 = Math.tan(15 * Math.PI / 180);
        const x = 100 + d.S / 2 - (d.W - 240) / 2 * tan15;
        const y = 100 + d.W / 2 - (d.S - 240) / 2 * tan15;
        return {
            x: Math.round(Math.min(x, d.S / 2 - 140)),
            y: Math.round(Math.min(y, d.W / 2 - 140))
        };
    }

    // 四個角落治具的位置（機器座標 mm：原點為 NW–SE 對角線中點，+X 沿 S 邊朝 E，+Y 朝 N）。
    // 計算方式與桌長配置產生器的畫圖相同：由四邊長與對角線 D 推出四邊形。
    function corners(d) {
        const cosT = Math.max(-1, Math.min(1, (d.W * d.W + d.S * d.S - d.D * d.D) / (2 * d.W * d.S || 1)));
        const theta = Math.acos(cosT);
        // 先在「S 邊為底、y 朝下」的座標算，最後再換成機器座標
        const BL = { x: 0, y: 0 };
        const BR = { x: d.S, y: 0 };
        const TL = { x: d.W * Math.cos(theta), y: -d.W * Math.sin(theta) };
        const angleD = Math.atan2(BR.y - TL.y, BR.x - TL.x);
        const cosP = Math.max(-1, Math.min(1, (d.N * d.N + d.D * d.D - d.E * d.E) / (2 * d.N * d.D || 1)));
        const phi = Math.acos(cosP);
        const TR = { x: TL.x + d.N * Math.cos(angleD - phi), y: TL.y + d.N * Math.sin(angleD - phi) };
        const cx = (TL.x + BR.x) / 2, cy = (TL.y + BR.y) / 2;
        const m = p => ({ x: p.x - cx, y: -(p.y - cy) });
        return { NW: m(TL), NE: m(TR), SE: m(BR), SW: m(BL) };
    }

    // 三角定位：已知兩個治具位置與到某點的直線距離 r1、r2，求該點。
    // 兩圓有兩個交點，取比較靠近工作台中心（原點）的那個；量不出交點時回傳 null。
    function locate(p1, p2, r1, r2) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const d = Math.hypot(dx, dy);
        if (!(r1 > 0 && r2 > 0 && d > 0) || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        const mx = p1.x + a * dx / d, my = p1.y + a * dy / d;
        const s1 = { x: mx - h * dy / d, y: my + h * dx / d };
        const s2 = { x: mx + h * dy / d, y: my - h * dx / d };
        return Math.hypot(s1.x, s1.y) <= Math.hypot(s2.x, s2.y) ? s1 : s2;
    }

    // --- 板材：以「每個角到兩個相鄰治具的直線距離」三角定位；量測值存在瀏覽器，繪圖與 CNC 工具共用 ---
    const BOARD_KEY = 'gordix-board';
    const BOARD_CORNERS = [
        { id: 'NW', jigs: ['NW', 'NE'] },
        { id: 'NE', jigs: ['NW', 'NE'] },
        { id: 'SE', jigs: ['SW', 'SE'] },
        { id: 'SW', jigs: ['SW', 'SE'] }
    ];

    // 預設：一塊 300 × 200 mm 的板材放在工作台正中央，反推它的量測值
    function defaultBoardMeasure(table) {
        const jig = corners(table);
        const at = { NW: { x: -150, y: 100 }, NE: { x: 150, y: 100 }, SE: { x: 150, y: -100 }, SW: { x: -150, y: -100 } };
        const m = {};
        BOARD_CORNERS.forEach(c => {
            m[c.id] = c.jigs.map(j => Math.round(Math.hypot(at[c.id].x - jig[j].x, at[c.id].y - jig[j].y) * 10) / 10);
        });
        return m;
    }

    // 讀取板材設定 { on, m }；沒有存過時用預設值
    function loadBoard(table) {
        const board = { on: true, m: null };
        try { Object.assign(board, JSON.parse(localStorage.getItem(BOARD_KEY)) || {}); } catch (e) { }
        if (!board.m) board.m = defaultBoardMeasure(table);
        return board;
    }

    function saveBoard(board) {
        try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch (e) { }
    }

    // 由量測值算出板材四角（機器座標）；量不出交點的角為 null
    function boardCorners(table, m) {
        const jig = corners(table);
        const pts = {};
        BOARD_CORNERS.forEach(c => {
            const [a, b] = m[c.id] || [];
            pts[c.id] = locate(jig[c.jigs[0]], jig[c.jigs[1]], a, b);
        });
        return pts;
    }

    // 依 NW → NE → SE → SW 順序的板材多邊形；有任何角定位失敗時回傳 null
    function boardPolygon(table, m) {
        const p = boardCorners(table, m);
        const order = ['NW', 'NE', 'SE', 'SW'];
        return order.every(k => p[k]) ? order.map(k => p[k]) : null;
    }

    function boardCenter(table, m) {
        const poly = boardPolygon(table, m);
        if (!poly) return { x: 0, y: 0 };
        return { x: poly.reduce((s, p) => s + p.x, 0) / 4, y: poly.reduce((s, p) => s + p.y, 0) / 4 };
    }

    function insidePolygon(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    return {
        DEFAULTS, load, save, markConfigured, workRange, corners, locate,
        BOARD_CORNERS, defaultBoardMeasure, loadBoard, saveBoard, boardCorners, boardPolygon, boardCenter, insidePolygon
    };
})();
