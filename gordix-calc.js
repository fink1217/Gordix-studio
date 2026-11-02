// 數字欄位可以輸入算式：+ - * / 與括號（也接受 × ÷），例如 2440/2、2702-17、(1220-40)*2，按 Enter 或離開欄位時換成結果。
// 載入後把頁面上的 <input type="number"> 換成文字欄位（數字欄位打不進 * 和 /），之後動態產生的也會換，並標上 data-calc。
// 使用者打字時先不把 input 事件交給頁面：按 Enter、離開欄位、或停手 0.6 秒（而且不是算式）才送出。
// 否則頁面會拿打到一半的值去算，例如桌長頁打「2702-17」，打到「2702」就先被上限改成 2600，算式就壞了。
// 程式自己送的事件（isTrusted = false）照常通過。
const GordixCalc = (() => {
    // 是不是算式：有運算子或括號（開頭的負號是負數，不算）
    const isExpr = v => /[+*/×÷()]/.test(v) || /.-/.test(String(v).trim());

    // 只接受數字、小數點、+ - * / 與括號的四則運算（不用 eval）；算不出來回傳 null
    function evaluate(text) {
        const s = String(text).replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
        if (!s || !/^[\d.+\-*/()]+$/.test(s)) return null;
        let i = 0;
        const num = () => {
            const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
            if (!m) throw new Error('number');
            i += m[0].length;
            return parseFloat(m[0]);
        };
        const factor = () => {
            if (s[i] === '-') { i++; return -factor(); }
            if (s[i] === '+') { i++; return factor(); }
            if (s[i] === '(') {
                i++;
                const v = expr();
                if (s[i++] !== ')') throw new Error('paren');
                return v;
            }
            return num();
        };
        const term = () => {
            let v = factor();
            while (s[i] === '*' || s[i] === '/') { const op = s[i++], r = factor(); v = op === '*' ? v * r : v / r; }
            return v;
        };
        const expr = () => {
            let v = term();
            while (s[i] === '+' || s[i] === '-') { const op = s[i++], r = term(); v = op === '+' ? v + r : v - r; }
            return v;
        };
        try {
            const v = expr();
            return i === s.length && isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
        } catch (e) {
            return null;
        }
    }

    function convert(el) {
        if (el.type !== 'number' || el.dataset.calc) return;
        el.dataset.calc = '1';
        el.type = 'text';
        el.autocomplete = 'off';
        el.spellcheck = false;
        if (!el.title) el.title = '可輸入算式，例如 2440/2 / Expressions allowed, e.g. 2440/2';
    }
    const scan = root => { if (root.querySelectorAll) root.querySelectorAll('input[type=number]').forEach(convert); };

    const timers = new WeakMap();
    const send = el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // 算出結果（是算式的話）寫回欄位，再補送 input 與 change，讓頁面照平常的方式接手；算式寫錯就紅框、不送出
    function commit(el) {
        clearTimeout(timers.get(el));
        if (isExpr(el.value)) {
            const v = evaluate(el.value);
            if (v === null) { el.classList.add('calc-bad'); return; }
            el.value = String(v);
        }
        el.classList.remove('calc-bad', 'calc-pending');
        send(el);
    }

    const isCalc = el => el && el.dataset && el.dataset.calc;
    // 捕捉階段先攔下使用者打字的 input 事件
    document.addEventListener('input', e => {
        const el = e.target;
        if (!isCalc(el) || !e.isTrusted) return;
        e.stopImmediatePropagation();
        el.classList.remove('calc-bad');
        el.classList.toggle('calc-pending', isExpr(el.value));
        clearTimeout(timers.get(el));
        if (!isExpr(el.value)) timers.set(el, setTimeout(() => send(el), 600));   // 一般數字：停手一下就更新預覽
    }, true);
    // 離開欄位（瀏覽器的 change）或按 Enter：算出結果送出
    document.addEventListener('change', e => {
        if (isCalc(e.target) && e.isTrusted) { e.stopImmediatePropagation(); commit(e.target); }
    }, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && isCalc(e.target)) { e.preventDefault(); commit(e.target); }
    }, true);

    const style = document.createElement('style');
    style.textContent = 'input.calc-pending{outline:2px dashed #f59e0b !important}input.calc-bad{outline:2px solid #ef4444 !important}';
    document.head.appendChild(style);

    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches('input[type=number]')) convert(n);
        scan(n);
    }))).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document));
    else scan(document);

    return { evaluate, isExpr };
})();
