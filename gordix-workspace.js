// 工作台視圖的共用繪製：桌面、格線、方位、治具、加工範圍與板材。
// 輸出 SVG 字串，單位 mm，原點為機器中心；機器 +Y 朝 N 邊，所以 SVG 的 y = -Y。
// 繪圖工具與 CNC 工具共用；需要先載入 gordix-table.js。
const GordixWorkspace = (() => {
    function svgText(x, y, str, size, fill, anchor = 'middle', weight = 'bold') {
        return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" pointer-events="none">${str}</text>`;
    }

    // opts：{ table, board: GordixTable.loadBoard() 的毛胚設定, u: 1 個螢幕像素等於幾 mm, isDark,
    //         labels: { tableName, front, legendRange, legendBoard } }
    function staticSvg({ table: t, board, u, isDark, labels: d }) {
        const range = GordixTable.workRange(t);
        const c = isDark
            ? { table: '#1e293b', edge: '#64748b', grid: 'rgba(255,255,255,0.07)', text: 'rgba(255,255,255,0.6)' }
            : { table: '#f1f5f9', edge: '#94a3b8', grid: 'rgba(15,23,42,0.08)', text: 'rgba(15,23,42,0.65)' };
        const fs = 11 * u;
        const nss = 'vector-effect="non-scaling-stroke"';
        const s = [];
        const jig = GordixTable.corners(t);
        const sv = p => `${p.x},${-p.y}`; // 機器座標 → SVG 座標
        const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

        // 工作台（桌長配置的實際四邊形）與 5cm 格線，格線裁切在桌面內
        const tablePts = [jig.NW, jig.NE, jig.SE, jig.SW].map(sv).join(' ');
        const xs = Object.values(jig).map(p => p.x), ys = Object.values(jig).map(p => -p.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        s.push(`<clipPath id="table-clip"><polygon points="${tablePts}"/></clipPath>`);
        s.push(`<polygon points="${tablePts}" fill="${c.table}" stroke="${c.edge}" stroke-width="2" ${nss}/>`);
        s.push(`<g clip-path="url(#table-clip)">`);
        for (let x = Math.ceil(x0 / 50) * 50; x <= x1; x += 50) {
            s.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${c.grid}" stroke-width="1" ${nss}/>`);
        }
        for (let y = Math.ceil(y0 / 50) * 50; y <= y1; y += 50) {
            s.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${c.grid}" stroke-width="1" ${nss}/>`);
        }
        s.push(`</g>`);
        const nMid = mid(jig.NW, jig.NE), sMid = mid(jig.SW, jig.SE), wMid = mid(jig.NW, jig.SW), eMid = mid(jig.NE, jig.SE);
        s.push(svgText(nMid.x, -Math.max(jig.NW.y, jig.NE.y) - 8 * u, `${d.tableName} ${t.S} × ${t.W} mm`, fs, c.text));
        s.push(svgText(nMid.x, -nMid.y + fs + 4 * u, 'N', fs, c.text));
        s.push(svgText(sMid.x, -sMid.y - 6 * u, `S · ${d.front}`, fs, '#ea580c'));
        s.push(svgText(wMid.x + 6 * u, -wMid.y + fs * 0.35, 'W', fs, c.text, 'start'));
        s.push(svgText(eMid.x - 6 * u, -eMid.y + fs * 0.35, 'E', fs, c.text, 'end'));

        // 角落治具（板材量測的基準點）
        Object.entries(jig).forEach(([k, p]) => {
            s.push(`<circle cx="${p.x}" cy="${-p.y}" r="${5 * u}" fill="${c.edge}" stroke="#ffffff" stroke-width="1" ${nss}/>`);
            s.push(svgText(p.x + (p.x < 0 ? 8 : -8) * u, -p.y + (p.y > 0 ? -7 : 15) * u, k, fs * 0.9, c.text, p.x < 0 ? 'start' : 'end'));
        });

        // 加工範圍
        s.push(`<rect x="${-range.x}" y="${-range.y}" width="${range.x * 2}" height="${range.y * 2}" fill="rgba(14,165,233,0.05)" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="6 4" ${nss}/>`);
        s.push(svgText(-range.x + 5 * u, -range.y + fs + 4 * u, `${d.legendRange} ${range.x * 2} × ${range.y * 2} mm`, fs, '#0ea5e9', 'start'));

        // 板材：選尺寸時置中；量測時由量測值三角定位出四角，並畫出量測線方便對照實際拉捲尺的位置
        const poly = board.on ? GordixTable.boardShape(t, board) : null;
        if (board.on && board.mode === 'measure') {
            const pts = GordixTable.boardCorners(t, board.m);
            GordixTable.BOARD_CORNERS.forEach(bc => {
                if (!pts[bc.id]) return;
                bc.jigs.forEach(j => s.push(`<line x1="${jig[j].x}" y1="${-jig[j].y}" x2="${pts[bc.id].x}" y2="${-pts[bc.id].y}" stroke="#f59e0b" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 4" ${nss}/>`));
            });
        }
        if (poly) {
            s.push(`<polygon points="${poly.map(sv).join(' ')}" fill="rgba(180,83,9,0.35)" stroke="#f59e0b" stroke-width="1.5" ${nss}/>`);
            s.push(svgText(poly[0].x + 4 * u, -Math.max(poly[0].y, poly[1].y) + fs + 3 * u, d.legendBoard, fs, '#f59e0b', 'start'));
            // 板材超出加工範圍的部分畫斜線：機器碰不到
            if (poly.some(p => Math.abs(p.x) > range.x || Math.abs(p.y) > range.y)) {
                const g = 8 * u;
                s.push(`<pattern id="ws-out-hatch" width="${g}" height="${g}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
                    `<line x1="0" y1="0" x2="0" y2="${g}" stroke="#f59e0b" stroke-opacity="0.7" stroke-width="${1.2 * u}"/></pattern>`);
                s.push(`<mask id="ws-out-mask"><polygon points="${poly.map(sv).join(' ')}" fill="#fff"/>` +
                    `<rect x="${-range.x}" y="${-range.y}" width="${range.x * 2}" height="${range.y * 2}" fill="#000"/></mask>`);
                s.push(`<polygon points="${poly.map(sv).join(' ')}" fill="url(#ws-out-hatch)" mask="url(#ws-out-mask)" pointer-events="none"/>`);
            }
        }
        return s.join('');
    }

    return { svgText, staticSvg };
})();
