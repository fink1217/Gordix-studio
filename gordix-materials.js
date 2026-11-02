// 材料加工參數：參數指南（params.html）與各轉檔工具共用的唯一資料來源。
// 材質在「毛胚設定」選一次；刀具或加工頭在各工具的加工面板選，兩者合起來算出建議值。
const GordixMaterials = (() => {
    // CNC 基準值（參數指南「常用材料加工對照表」）：以 stdD 刀徑、stdZ 刃數為準，計算機再依實際刀具換算
    const CNC = {
        softwood:     { baseMinF: 1200, baseMaxF: 1600, baseMinDoc: 3.0, baseMaxDoc: 4.0, rpm: 22000, stdD: 6.35, stdZ: 2 },
        plywood:      { baseMinF: 1000, baseMaxF: 1200, baseMinDoc: 3.0, baseMaxDoc: 3.0, rpm: 20000, stdD: 6.35, stdZ: 2 },
        hardwood:     { baseMinF: 800,  baseMaxF: 1000, baseMinDoc: 1.5, baseMaxDoc: 2.0, rpm: 18000, stdD: 6.35, stdZ: 2 },
        toolingboard: { baseMinF: 1200, baseMaxF: 1500, baseMinDoc: 3.0, baseMaxDoc: 4.0, rpm: 18000, stdD: 6.35, stdZ: 2 },
        acrylic:      { baseMinF: 800,  baseMaxF: 1000, baseMinDoc: 2.0, baseMaxDoc: 3.0, rpm: 16000, stdD: 3.175, stdZ: 1 },
        doublecolor:  { baseMinF: 800,  baseMaxF: 1200, baseMinDoc: 0.5, baseMaxDoc: 1.0, rpm: 15000, stdD: 3.175, stdZ: 1 },
        aluminum:     { baseMinF: 800,  baseMaxF: 1200, baseMinDoc: 0.1, baseMaxDoc: 0.3, rpm: 13500, stdD: 3.175, stdZ: 1 }
    };

    // 雷射對照表（參數指南的雷射分頁照這個順序顯示）；mat = 下面 MATERIALS 的 id，t = 表上實測的厚度（mm）
    const LASER = [
        { mat: 'mdf', t: 3, matZh: '3mm MDF 密集板', matEn: '3mm MDF Board', typeZh: '精準切割', typeEn: 'Cutting', category: 'cut', power: '95%', speed: '200', passes: '3', airZh: '強烈建議開啟', airEn: 'Highly Rec.' },
        { mat: 'mdf', matZh: 'MDF 密集板', matEn: 'MDF Board', typeZh: '表面雕刻', typeEn: 'Engraving', category: 'engrave', power: '30%', speed: '1500', passes: '1', airZh: '建議關閉/低風量', airEn: 'Off/Low' },
        { mat: 'plywood', t: 3, matZh: '3mm 椴木膠合板', matEn: '3mm Basswood Plywood', typeZh: '精準切割', typeEn: 'Cutting', category: 'cut', power: '90%', speed: '350', passes: '2', airZh: '強烈建議開啟', airEn: 'Highly Rec.' },
        { mat: 'plywood', t: 5, matZh: '5mm 椴木膠合板', matEn: '5mm Basswood Plywood', typeZh: '精準切割', typeEn: 'Cutting', category: 'cut', power: '95%', speed: '150', passes: '3', airZh: '強烈建議開啟', airEn: 'Highly Rec.' },
        { mat: 'plywood', matZh: '椴木膠合板', matEn: 'Basswood Plywood', typeZh: '一般雕刻', typeEn: 'Engraving', category: 'engrave', power: '25%', speed: '1500', passes: '1', airZh: '建議關閉/低風量', airEn: 'Off/Low' },
        { mat: 'hardwood', t: 3, matZh: '3mm 櫻桃木實木', matEn: '3mm Cherry Solid Wood', typeZh: '精準切割', typeEn: 'Cutting', category: 'cut', power: '90%', speed: '240', passes: '2', airZh: '強烈建議開啟', airEn: 'Highly Rec.' },
        { mat: 'hardwood', matZh: '櫻桃木/胡桃木實木', matEn: 'Cherry/Walnut Solid Wood', typeZh: '高對比雕刻', typeEn: 'Engraving', category: 'engrave', power: '35%', speed: '1200', passes: '1', airZh: '建議關閉', airEn: 'Off' },
        { mat: 'acrylic', t: 3, matZh: '3mm 壓克力(深色)', matEn: '3mm Dark Acrylic', typeZh: '精準切割', typeEn: 'Cutting', category: 'cut', power: '95%', speed: '250', passes: '2', airZh: '建議開啟', airEn: 'Recommended' },
        { mat: 'acrylic', matZh: '壓克力(深色)', matEn: 'Dark Acrylic', typeZh: '磨砂雕刻', typeEn: 'Engraving', category: 'engrave', power: '20%', speed: '1600', passes: '1', airZh: '建議關閉', airEn: 'Off' },
        { mat: 'cardboard', matZh: '瓦楞紙 / 快遞紙箱', matEn: 'Cardboard Box', typeZh: '輪廓切割', typeEn: 'Cutting', category: 'cut', power: '70%', speed: '800', passes: '1', airZh: '建議開啟', airEn: 'Recommended' },
        { mat: 'cardstock', matZh: '黑卡紙 (250g)', matEn: 'Black Cardstock (250g)', typeZh: '高速切割', typeEn: 'Cutting', category: 'cut', power: '80%', speed: '1200', passes: '1', airZh: '建議開啟', airEn: 'Recommended' },
        { mat: 'leather', matZh: '植鞣皮革', matEn: 'Vegetable Tanned Leather', typeZh: '輪廓切割', typeEn: 'Cutting', category: 'cut', power: '80%', speed: '600', passes: '1', airZh: '強烈建議開啟', airEn: 'Highly Rec.' },
        { mat: 'leather', matZh: '植鞣皮革', matEn: 'Vegetable Tanned Leather', typeZh: '表面雕刻', typeEn: 'Engraving', category: 'engrave', power: '25%', speed: '1500', passes: '1', airZh: '建議關閉/低風量', airEn: 'Off/Low' },
        { mat: 'felt', t: 2, matZh: '不織布 / 毛氈 (2mm)', matEn: 'Felt (2mm)', typeZh: '高速切割', typeEn: 'Cutting', category: 'cut', power: '75%', speed: '700', passes: '1', airZh: '建議開啟', airEn: 'Recommended' },
        { mat: 'softmetal', matZh: '陽極氧化鋁表面', matEn: 'Anodized Aluminum', typeZh: '表面打標', typeEn: 'Marking', category: 'engrave', power: '60%', speed: '1800', passes: '1', airZh: '無影響', airEn: 'N/A' },
        { mat: 'stainless', matZh: '304 不鏽鋼 (無鍍膜/需慢速)', matEn: '304 Stainless Steel (Bare)', typeZh: '高能雕刻/打標', typeEn: 'Marking', category: 'engrave', power: '95%', speed: '600', passes: '1', airZh: '無影響', airEn: 'N/A' },
        { mat: 'slate', matZh: '岩板 / 深色石材', matEn: 'Slate / Dark Stone', typeZh: '高對比雕刻', typeEn: 'Engraving', category: 'engrave', power: '80%', speed: '1400', passes: '1', airZh: '無影響', airEn: 'N/A' },
        { mat: 'glass', matZh: '平板玻璃 (需事先塗黑或貼貼紙)', matEn: 'Glass (Pre-treated Black)', typeZh: '磨砂打標', typeEn: 'Engraving', category: 'engrave', power: '90%', speed: '1000', passes: '1', airZh: '無影響', airEn: 'N/A' }
    ];

    // 毛胚可選的材質：cnc = 上面 CNC 的鍵（沒有 = 不建議 CNC）；雷射資料由 LASER 的 mat 對應。
    // docCap = 實測建議的每刀上限（第三方評測影片：夾板每刀 ≤ 2 mm），優先於指南值。
    const MATERIALS = [
        { id: 'plywood', zh: '合板／膠合板', en: 'Plywood', cnc: 'plywood', docCap: 2.0 },
        { id: 'mdf', zh: '軟木／密集板 MDF', en: 'Softwood / MDF', cnc: 'softwood' },
        { id: 'hardwood', zh: '實木（櫸木、胡桃木、櫻桃木）', en: 'Hardwood (beech, walnut, cherry)', cnc: 'hardwood' },
        { id: 'toolingboard', zh: '代木', en: 'Tooling board', cnc: 'toolingboard' },
        { id: 'acrylic', zh: '壓克力／POM', en: 'Acrylic / POM', cnc: 'acrylic' },
        { id: 'doublecolor', zh: '雙色板／ABS', en: 'Two-color board / ABS', cnc: 'doublecolor' },
        { id: 'softmetal', zh: '軟金屬（鋁、銅）', en: 'Soft metal (aluminum, brass)', cnc: 'aluminum' },
        { id: 'stainless', zh: '不鏽鋼', en: 'Stainless steel' },
        { id: 'cardboard', zh: '瓦楞紙箱', en: 'Cardboard' },
        { id: 'cardstock', zh: '卡紙', en: 'Cardstock' },
        { id: 'leather', zh: '植鞣皮革', en: 'Leather' },
        { id: 'felt', zh: '不織布／毛氈', en: 'Felt' },
        { id: 'slate', zh: '岩板／深色石材', en: 'Slate / dark stone' },
        { id: 'glass', zh: '玻璃（需先塗黑）', en: 'Glass (pre-blackened)' }
    ];
    const DEFAULT_MATERIAL = 'plywood';

    // 加工面板可選的刀具（自訂時由工具自己的刀徑欄位決定 d）
    const CNC_TOOLS = [
        { id: 'd635-2-down', d: 6.35, flutes: 2, type: 'downcut', zh: '1/4" 雙刃下旋 Ø6.35', en: '1/4" 2-flute down-cut Ø6.35' },
        { id: 'd3175-1-up', d: 3.175, flutes: 1, type: 'upcut', zh: '1/8" 單刃上旋 Ø3.175', en: '1/8" 1-flute up-cut Ø3.175' },
        { id: 'd635-2-straight', d: 6.35, flutes: 2, type: 'straight', zh: '1/4" 雙刃直刃 Ø6.35', en: '1/4" 2-flute straight Ø6.35' }
    ];

    const material = id => MATERIALS.find(m => m.id === id) || MATERIALS.find(m => m.id === DEFAULT_MATERIAL);
    const name = (id, lang) => material(id)[lang === 'en' ? 'en' : 'zh'];

    // 智慧速度進位：提供好讀的整數區間（與參數指南相同）
    function roundFeed(val) {
        if (val > 500) return Math.round(val / 100) * 100;
        if (val > 100) return Math.round(val / 50) * 50;
        return Math.round(val / 10) * 10;
    }

    // CNC 計算機（從參數指南搬過來，算法不變）：依材料、刀徑、刃數、刃形算出轉速、刻度、走速與下刀深度範圍
    function cncCalc(cncKey, diameter, flutes, cutterType) {
        const spec = CNC[cncKey] || CNC.softwood;
        const dFactor = diameter / spec.stdD;
        const zFactor = flutes / spec.stdZ;

        // Makita RT0700 防護：最低刻度 3（15,000 RPM），軟金屬放寬到刻度 2
        const minRpm = cncKey === 'aluminum' ? 12000 : 15000;
        const rpm = Math.max(minRpm, Math.min(30000, spec.rpm));
        const dial = rpm < 11000 ? '1' : rpm < 14500 ? '2' : rpm < 19500 ? '3' : rpm < 24500 ? '4' : rpm < 28500 ? '5' : '6';

        let feedMin = spec.baseMinF * Math.pow(dFactor, 0.6) * (0.6 + 0.4 * zFactor);
        let feedMax = spec.baseMaxF * Math.pow(dFactor, 0.6) * (0.6 + 0.4 * zFactor);
        if (cutterType === 'straight') { feedMin *= 0.9; feedMax *= 0.9; }
        else if (cutterType === 'upcut') { feedMin *= 1.05; feedMax *= 1.05; }

        // Gordix 機台走速上限 F2000
        let isLimited = false;
        if (feedMax > 2000) { feedMax = 2000; isLimited = true; }
        if (feedMin > 1900) feedMin = 1800;
        if (feedMin < 100) feedMin = 100;
        if (feedMax < 150) feedMax = 150;

        let docMin = spec.baseMinDoc * dFactor;
        let docMax = spec.baseMaxDoc * dFactor;
        if (cutterType === 'straight') { docMin *= 0.9; docMax *= 0.9; }
        if (cncKey === 'aluminum') {
            docMin = Math.max(0.1, Math.min(docMin, 0.2));
            docMax = Math.max(0.1, Math.min(docMax, 0.3));
        } else {
            if (docMax > 4.0) docMax = 4.0;
            if (docMin < 0.2) docMin = 0.2;
        }
        return { rpm, dial, minF: roundFeed(feedMin), maxF: roundFeed(feedMax), docMin, docMax, isLimited };
    }

    // 工具用的 CNC 建議：材質 + 刀具 { d, flutes, type }。材質不建議 CNC 時回傳 null。
    // 帶入值取保守端：走速取下限、每刀取下限，再套實測上限（例如夾板 ≤ 2 mm）。
    function cncAdvice(matId, tool) {
        const m = material(matId);
        if (!m.cnc) return null;
        const c = cncCalc(m.cnc, tool.d, tool.flutes, tool.type);
        const r1 = v => Math.round(v * 10) / 10;
        const cap = m.docCap || Infinity;
        return Object.assign(c, {
            feed: c.minF,
            doc: r1(Math.min(c.docMin, cap)),
            docMin: r1(c.docMin), docMax: r1(c.docMax),
            docCap: m.docCap || null
        });
    }

    // 雷射建議：category 'cut' | 'engrave'；切割依毛胚厚度挑表上最接近的一筆。
    // 回傳 { row, pct, s, speed, passes, thicknessOff }；thicknessOff = 表上只有別的厚度（差超過 0.5 mm）
    function laserAdvice(matId, category, t) {
        const rows = LASER.filter(r => r.mat === material(matId).id && r.category === category);
        if (!rows.length) return null;
        const row = rows.reduce((a, b) => (b.t != null && t > 0 && Math.abs(b.t - t) < Math.abs((a.t ?? Infinity) - t)) ? b : a);
        const pct = parseFloat(row.power);
        return {
            row, pct, s: Math.round(pct / 100 * 255), speed: parseFloat(row.speed), passes: parseInt(row.passes, 10),
            thicknessOff: row.t != null && t > 0 && Math.abs(row.t - t) > 0.5
        };
    }

    return { CNC, LASER, MATERIALS, DEFAULT_MATERIAL, CNC_TOOLS, material, name, roundFeed, cncCalc, cncAdvice, laserAdvice };
})();
