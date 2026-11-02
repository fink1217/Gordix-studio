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

    // 鬆緊修正：機器放出的皮帶比實際需要長 C mm（樣機實測約 17 mm），所以 table.cfg 的四邊要各扣 C。
    // 對角線 D 依 SW 角（S 邊與 W 邊的夾角）不變重算，否則換算出的工作台會歪 1~2.5°。
    // 網頁裡存的是捲尺實際量到的值（C 另外存）；c 為負數 = 反過來由 table.cfg 的值還原量測值。
    const SLACK_MEASURED = 17;
    function shrinkTable(d, c) {
        if (!c) return Object.assign({}, d);
        const r1 = v => Math.round(v * 10) / 10;
        const cosT = Math.max(-1, Math.min(1, (d.W * d.W + d.S * d.S - d.D * d.D) / (2 * d.W * d.S || 1)));
        const S = d.S - c, W = d.W - c;
        return Object.assign({}, d, {
            E: r1(d.E - c), S: r1(S), W: r1(W), N: r1(d.N - c),
            D: r1(Math.sqrt(S * S + W * W - 2 * S * W * cosT))
        });
    }
    // 寫進 table.cfg 的值（已扣鬆緊修正）
    const cfgValues = d => shrinkTable(d, d.C || 0);

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

    // 常用板材尺寸（w 沿 X / S 邊，h 沿 Y / E 邊）；選單由 w、h 比對推出，不另外存
    const BOARD_SIZES = [
        { id: '4x8', w: 2440, h: 1220 },
        { id: '3x6', w: 1820, h: 910 },
        { id: '2x4', w: 1220, h: 610 }
    ];

    // 讀取毛胚設定 { on, mode, w, h, t, material, m, table }：
    //   material 是 GordixMaterials 的材質 id，各工具據此帶入建議的加工參數。
    //   mode 'size' = 選尺寸、放在工作台正中央；'measure' = 用量測值三角定位。
    //   舊資料只有量測值、沒有 mode，視為 'measure'，量過的值不會遺失；沒存過時為 4×8、厚 18 mm 置中。
    //   table 是毛胚放在哪個工作台表格（不動 table.cfg 的 currentId，首頁才不會誤判成「未下載」）。
    function loadBoard(table) {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(BOARD_KEY)); } catch (e) { }
        const board = Object.assign(
            { on: true, mode: saved && saved.m ? 'measure' : 'size', w: 2440, h: 1220, t: 18, material: 'plywood', m: null, table: null },
            saved || {});
        if (!board.m) board.m = defaultBoardMeasure(table || boardTable(board).table);
        return board;
    }

    // 毛胚是否存過（首頁用來判斷步驟 2 是否完成）
    function hasBoard() {
        try { return !!localStorage.getItem(BOARD_KEY); } catch (e) { return false; }
    }

    // 毛胚所在的工作台：{ id, table, tables, configured }。
    // 優先用毛胚記下的表格，沒有就用桌長配置目前的表格，再沒有就用表格 1。
    function boardTable(board) {
        const saved = load();
        const tables = saved ? saved.tables : DEFAULTS;
        const pick = [board && board.table, saved && saved.currentId, 1].find(id => id != null && tables[id]);
        return { id: String(pick), table: tables[pick], tables, configured: !!saved };
    }

    // 毛胚四角（NW → NE → SE → SW，機器座標）；量測定位失敗或尺寸無效時回傳 null
    function boardShape(table, board) {
        if (board.mode === 'measure') return boardPolygon(table, board.m);
        if (!(board.w > 0 && board.h > 0)) return null;
        const x = board.w / 2, y = board.h / 2;
        return [{ x: -x, y }, { x, y }, { x, y: -y }, { x: -x, y: -y }];
    }

    // 毛胚中心；無法定位時為機器中心
    function boardMid(table, board) {
        const poly = boardShape(table, board);
        if (!poly) return { x: 0, y: 0 };
        return { x: poly.reduce((s, p) => s + p.x, 0) / 4, y: poly.reduce((s, p) => s + p.y, 0) / 4 };
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


    function insidePolygon(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    return {
        DEFAULTS, load, save, markConfigured, workRange, corners, locate, SLACK_MEASURED, shrinkTable, cfgValues,
        BOARD_CORNERS, BOARD_SIZES, defaultBoardMeasure, loadBoard, saveBoard, hasBoard, boardTable,
        boardCorners, boardPolygon, boardShape, boardMid, insidePolygon
    };
})();
