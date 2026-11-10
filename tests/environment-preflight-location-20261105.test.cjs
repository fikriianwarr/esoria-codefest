'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const root=join(__dirname,'..');
test('production runtime config preflight can run in Node without browser location',()=>{
 const p=spawnSync(process.execPath,['scripts/environment-preflight.mjs','--project','esoria-codefest'],{cwd:root,encoding:'utf8'});
 assert.equal(p.status,0,`${p.stdout}\n${p.stderr}`);
 assert.match(p.stdout,/Konfigurasi publik cocok/);
});
test('full deploy source readiness script matches no-backup release path',()=>{
 const p=spawnSync(process.execPath,['scripts/check-release.mjs'],{cwd:root,encoding:'utf8'});
 assert.equal(p.status,0,`${p.stdout}\n${p.stderr}`);
 assert.match(p.stdout,/Rilis bersih: CMD GitHub dan CMD Firebase terpisah/);
});
