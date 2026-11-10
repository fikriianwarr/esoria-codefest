'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const root = join(__dirname,'..','public');
const read = name => readFileSync(join(root,name),'utf8');
test('paper select always rejects disabled native options (including optgroups)',()=>{
 const code=read('paper-dropdown.js');
 assert.match(code,/option\.disabled \|\| option\.parentElement\?\.disabled/);
 assert.match(code,/if \(select\.disabled \|\| isUnavailable\(item\.option\)/);
 assert.match(code,/aria-disabled/);
 assert.match(code,/trigger\.disabled = select\.disabled/);
});
test('paper select reconstructs current choices on every open and watches disabled changes',()=>{
 const code=read('paper-dropdown.js');
 assert.match(code,/\/\/ Native options can change after initialization/);
 assert.match(code,/rebuild\(\);\s*list\.hidden = false/);
 assert.match(code,/new MutationObserver/);
 assert.match(code,/focusAvailable\(/);
});
test('month picker enforces native min and max without breaking YYYY-MM or native input',()=>{
 const code=read('paper-month.js');
 assert.match(code,/validMonth\(input\.min\)/);
 assert.match(code,/validMonth\(input\.max\)/);
 assert.match(code,/if \(input\.disabled \|\| !withinLimits\(value\)\) return/);
 assert.match(code,/input\.dispatchEvent\(new Event\('change'/);
 assert.match(code,/new MutationObserver\(sync\)/);
});
test('month popup stays inside viewport near the right and bottom edges',()=>{
 const code=read('paper-month.js');
 assert.match(code,/wrapper\.getBoundingClientRect\(\)/);
 assert.match(code,/window\.innerWidth - 12/);
 assert.match(code,/flipAbove/);
 assert.match(code,/popup\.style\.maxHeight/);
});
test('login headline uses final audience-neutral copy without altering authorization',()=>{
 const login=read('login.html');
 assert.match(login,/PORTAL AKUN/);
 assert.match(login,/Lanjutkan aktivitasmu, pantau perkembangan kompetisi/);
 assert.doesNotMatch(login,/Member ESORIA dan Administrator|Menu tersedia sesuai hak akses|MEMBER LOGIN|ACCESS FILE|PORTAL ESORIA \/ 01/);
 assert.doesNotMatch(login,/peserta, panitia, dan juri/);
 assert.doesNotMatch(login,/PORTAL PESERTA/);
 const results=read('results.html');
 assert.match(results,/Pratinjau pengelola/);
});
