// 物件轉換測試：使用實際幾何函式驗證旋轉、逆轉換與群組操作。
const assert = require('node:assert/strict');
const G = require('../gordix-objects.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const object = {x: 10, y: 20, angle: 90, width: 100, pixelWidth: 1000,
    box: {minX: 0, minY: 0, maxX: 1000, maxY: 500}};
let p = G.point(object, {x: 1000, y: 250});
near(p.x, 10); near(p.y, 70);
for (const angle of [-450, -90, 0, 37, 90, 360, 720]) {
    const o = {...object, angle};
    const q = {x: 123, y: 456};
    p = G.inverse(o, G.point(o, q));
    near(p.x, q.x); near(p.y, q.y);
}
const bounds = G.bounds([object]);
near(bounds.w, 50); near(bounds.h, 100);
const pair = [{...object, x: -50, y: 0, angle: 0}, {...object, x: 50, y: 0, angle: 0}];
G.rotate(pair, {x: 0, y: 0}, 90);
near(pair[0].x, 0); near(pair[0].y, -50); near(pair[1].y, 50);
near(pair[0].angle, 90);
G.scale(pair, {x: 0, y: 0}, 2);
near(pair[0].y, -100); near(pair[0].width, 200);
console.log('PASS 旋轉、座標往返、外框與群組等比例縮放');
