/* 多圖物件的共用幾何：世界座標採機器的 +Y 向上，角度逆時針為正。 */
(function (root) {
    'use strict';
    const radians = angle => angle * Math.PI / 180;
    const normalized = angle => ((angle + 180) % 360 + 360) % 360 - 180;

    /** 將物件畫布座標轉為世界毫米座標。 */
    function point(o, p) {
        const b = o.box, k = o.width / o.pixelWidth, a = radians(o.angle);
        const x = (p.x - (b.minX + b.maxX) / 2) * k;
        const y = ((b.minY + b.maxY) / 2 - p.y) * k;
        return { x: o.x + x * Math.cos(a) - y * Math.sin(a), y: o.y + x * Math.sin(a) + y * Math.cos(a) };
    }

    /** 將世界毫米座標轉回物件畫布座標。 */
    function inverse(o, p) {
        const a = radians(o.angle), k = o.width / o.pixelWidth, x = p.x - o.x, y = p.y - o.y;
        return { x: (o.box.minX + o.box.maxX) / 2 + (x * Math.cos(a) + y * Math.sin(a)) / k,
            y: (o.box.minY + o.box.maxY) / 2 - (-x * Math.sin(a) + y * Math.cos(a)) / k };
    }

    /** 取得旋轉後的四角，供預覽及加工範圍檢查使用。 */
    function corners(o) {
        const b = o.box;
        return [{x: b.minX, y: b.minY}, {x: b.maxX, y: b.minY},
            {x: b.maxX, y: b.maxY}, {x: b.minX, y: b.maxY}].map(p => point(o, p));
    }

    /** 取得多個物件在世界座標的聯集外框。 */
    function bounds(objects) {
        const points = objects.flatMap(corners);
        if (!points.length) return null;
        const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
        const bottom = Math.min(...points.map(p => p.y)), top = Math.max(...points.map(p => p.y));
        return {left, right, bottom, top, w: right - left, h: top - bottom, x: (left + right) / 2, y: (bottom + top) / 2};
    }

    /** 繞共同中心旋轉，成員的中心與角度一起改變。 */
    function rotate(objects, center, degrees) {
        const a = radians(degrees), c = Math.cos(a), s = Math.sin(a);
        objects.forEach(o => {
            const x = o.x - center.x, y = o.y - center.y;
            o.x = center.x + x * c - y * s; o.y = center.y + x * s + y * c;
            o.angle = normalized(o.angle + degrees);
        });
    }

    /** 以共同中心等比例縮放，保留成員之間的相對位置。 */
    function scale(objects, center, ratio) {
        if (!(ratio > 0) || !Number.isFinite(ratio)) return;
        objects.forEach(o => {
            o.x = center.x + (o.x - center.x) * ratio;
            o.y = center.y + (o.y - center.y) * ratio;
            o.width *= ratio;
        });
    }

    /** SVG 使用向下的 Y 軸，故旋轉角度取負號。 */
    function transform(o) {
        const b = o.box;
        return `translate(${o.x} ${-o.y}) rotate(${-o.angle}) scale(${o.width / o.pixelWidth}) translate(${-(b.minX + b.maxX) / 2} ${-(b.minY + b.maxY) / 2})`;
    }
    const api = {point, inverse, corners, bounds, rotate, scale, transform, normalized};
    if (typeof module !== 'undefined') module.exports = api;
    else root.GordixObjects = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
