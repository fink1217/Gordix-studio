/* 同檔刀路排序：只調整空跑路線，不反轉銑削方向或拆開加工單元。 */
(function (root) {
    'use strict';
    const origin = {x: 0, y: 0};
    const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    /** 取單元第一個起點與最後一個終點，保持單元內部加工不變。 */
    function ends(unit) {
        const paths = unit.phases.flatMap(phase => phase.paths).filter(path => path.length > 1);
        return paths.length ? {start: paths[0][0], end: paths.at(-1).at(-1)} : {start: origin, end: origin};
    }

    /** 估計跨單元移動距離，包含由機器中心出發及最後回中心。 */
    function distance(units, destination = origin) {
        let position = origin, length = 0;
        units.forEach(unit => {
            const edge = ends(unit);
            length += gap(position, edge.start);
            position = edge.end;
        });
        return length + gap(position, destination);
    }

    /** 替換單一路徑的陣列，原始單元與來源幾何不會被修改。 */
    function withPath(unit, path) {
        return {...unit, phases: [{...unit.phases[0], paths: [path]}]};
    }

    /** 封閉輪廓只移起點；開放雷射線可反向；其他加工維持方向。 */
    function enter(unit, position) {
        if (unit.phases.length !== 1 || unit.phases[0].paths.length !== 1) return unit;
        const path = unit.phases[0].paths[0];
        if (path.length < 2) return unit;
        const closed = gap(path[0], path.at(-1)) < 1e-8;
        if (!closed) {
            const reverse = unit.operation === 'laserLine' && gap(position, path.at(-1)) < gap(position, path[0]);
            return reverse ? withPath(unit, [...path].reverse()) : unit;
        }
        if (!['outer', 'inner', 'laser'].includes(unit.type)) return unit;
        const count = path.length - 1, step = Math.max(1, Math.ceil(count / 64));
        let best = 0, length = gap(position, path[0]);
        for (let i = step; i < count; i += step) {
            const next = gap(position, path[i]);
            if (next < length) {best = i; length = next;}
        }
        if (!best) return unit;
        const loop = path.slice(0, -1);
        return withPath(unit, [...loop.slice(best), ...loop.slice(0, best), loop[best]]);
    }

    /** 檢查排序是否保留所有加工先後限制。 */
    function valid(order, dependencies) {
        const position = new Map(order.map((index, rank) => [index, rank]));
        return order.every(index => (dependencies[index] || []).every(before => position.get(before) < position.get(index)));
    }

    /** 依路線順序，從上一刀終點選擇下一個單元的入口。 */
    function orient(order, units) {
        let position = origin;
        return order.map(index => {
            const unit = enter(units[index], position);
            position = ends(unit).end;
            return unit;
        });
    }

    /** 從目前可加工的單元中就近選擇，不越過尚未完成的依賴。 */
    function nearest(units, dependencies, seed) {
        const used = new Set(), order = [];
        let position = origin;
        while (order.length < units.length) {
            let best = -1, length = Infinity, chosen = null;
            units.forEach((unit, index) => {
                if (used.has(index) || !(dependencies[index] || []).every(id => used.has(id))) return;
                const candidate = enter(unit, position), value = gap(position, ends(candidate).start);
                if (!order.length && seed !== undefined && seed !== index) return;
                if (value < length) {best = index; length = value; chosen = candidate;}
            });
            if (best < 0) throw new Error('加工先後限制互相衝突');
            used.add(best); order.push(best); position = ends(chosen).end;
        }
        return order;
    }

    /** 小批物件進行有限次區段交換，始終檢查加工先後限制。 */
    function improve(order, units, dependencies, destination) {
        if (order.length > 60) return order;
        let best = [...order], score = distance(best.map(index => units[index]), destination);
        for (let pass = 0; pass < 2; pass++) {
            let changed = false;
            for (let i = 0; i < best.length - 1; i++) {
                for (let j = i + 1; j < best.length; j++) {
                    const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
                    if (!valid(candidate, dependencies)) continue;
                    const next = distance(candidate.map(index => units[index]), destination);
                    if (next + 1e-7 >= score) continue;
                    best = candidate; score = next; changed = true;
                }
            }
            if (!changed) break;
        }
        return best;
    }

    /** 以原可行序列及少量就近序列比較，回傳較短的可行路線。 */
    function optimize(units, dependencies = [], destination = origin) {
        if (!units.length) return {units: [], order: []};
        const input = units.map((_, index) => index);
        const seeds = input.filter(index => !(dependencies[index] || []).length)
            .sort((a, b) => gap(origin, ends(enter(units[a], origin)).start) - gap(origin, ends(enter(units[b], origin)).start))
            .slice(0, units.length <= 100 ? 3 : 1);
        const orders = seeds.map(seed => nearest(units, dependencies, seed));
        if (valid(input, dependencies)) orders.push(input);
        let result = null, score = Infinity;
        orders.forEach(order => {
            const choices = [order, improve(order, units, dependencies, destination)];
            choices.forEach(candidate => {
                const route = orient(candidate, units), next = distance(route, destination);
                if (next < score) {result = {units: route, order: candidate}; score = next;}
            });
        });
        return result;
    }

    const api = {optimize, distance, valid};
    if (typeof module !== 'undefined') module.exports = api;
    else root.GordixRoute = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
