/* 以固定刀路檢查橋位修改不改 XY、進給或其他加工內容。 */
const assert=require('node:assert/strict');
const R=require('../gordix-recovered.js');
const job={thickness:15,safeZ:2,layers:[{id:'L0',tabs:true,tabHeight:1.8}],objects:[]};
const tools=[{id:'t',f:1000}];
const lines=['G21','G90','G0 Z2.000','G0 X10 Y10','G1 Z-12.000 F300',
 'G1 X10 Y10 F1000','G1 X20 Y10','G1 X30 Y10','G1 Z-14.000 F300',
 'G1 X10 Y10 F1000','G1 X20 Y10 Z-13.200','G1 X30 Y10 Z-14.000',
 'G1 Z-15.200 F300','G1 X10 Y10 F1000','G1 X20 Y10 Z-13.200','G1 X30 Y10 Z-15.200',
 'G0 Z2.000','G0 X0 Y0',''];
job.recovery={version:1,fingerprint:R.fingerprint(job,tools),files:[{head:'router',toolId:'t',gcode:lines.join('\r\n'),profiles:[{start:2,end:16,layerId:'L0',tabs:true,tabHeight:1.8,tabTop:-13.2}]}]};
const generated=[{head:'router',tool:tools[0],gcode:'regenerated'}];
const original=R.apply(generated,job,tools)[0];assert.equal(original.gcode,lines.join('\r\n'));
job.layers[0].hidden=true;job.layers[0].name='重新命名';
assert.equal(R.apply(generated,job,tools)[0].gcode,original.gcode);
job.layers[0].tabHeight=3;
const changed=R.apply(generated,job,tools)[0];
assert.equal(changed.recoveryMode,'tabs');
assert.deepEqual(changed.gcode.match(/X[^\r\nZ F]+ Y[^\r\nZ F]+/g),original.gcode.match(/X[^\r\nZ F]+ Y[^\r\nZ F]+/g));
assert.deepEqual(changed.gcode.match(/ F[\d.]+/g),original.gcode.match(/ F[\d.]+/g));
assert.equal((changed.gcode.match(/X20 Y10 Z-12.000/g)||[]).length,2);
job.layers[0].tabs=false;
assert.ok(!R.apply(generated,job,tools)[0].gcode.includes('Z-13.200'));
job.safeZ=4;
assert.equal(R.apply(generated,job,tools)[0].gcode,'regenerated');
assert.equal(R.apply(generated,job,tools)[0].recoveryMode,'rebuilt');
console.log('PASS 原始輸出、橋位高度、XY 與進給不變、關閉橋位、其他參數改用重算');
