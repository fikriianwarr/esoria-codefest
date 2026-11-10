const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(rel)=>fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
test('hidden logout never forced visible during role lookup',()=>{
 const css=read('public/esoria-paper-final-20261020.css');
 assert.match(css,/\.cf-nav \[hidden\]/);
 assert.match(css,/\[data-notification-count\]\[hidden\]/);
 assert.match(css,/:has\(>button\[data-logout\]:not\(\[hidden\]\)\)/);
 assert.doesNotMatch(css,/\.cf-nav button\[data-logout\]\{display:flex!important\}/);
});
test('canonical backend wave labels unchanged despite shortened mobile card text',()=>{
 assert.match(read('functions/index.js'),/Wave Awal Bulan — mulai tanggal 1/);
 assert.match(read('public/spark-data.js'),/Wave Pertengahan Bulan — mulai tanggal 15/);
 assert.match(read('public/competition-participant.js'),/esc\(shortWaveLabel\(reg\.waveLabel\)\)/);
});
