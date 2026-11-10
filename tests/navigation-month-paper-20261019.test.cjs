'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const root = join(__dirname,'..','public');
const read = file => readFileSync(join(root,file),'utf8');
test('only verified admin context exposes stable staff navigation',()=>{
 const script=read('results-context.js');
 const failure=script.slice(script.indexOf('const setStatus ='),script.indexOf('// Subscribe once.'));
 assert.doesNotMatch(failure,/back\.href\s*=\s*destinations\[from\]/);
 assert.match(failure,/login\.html\?next=/);
 assert.match(script,/if \(!permitted\) \{/);
 assert.match(script,/if \(!permitted\) \{/);
 assert.match(script,/staffNav\.hidden = false/);
 assert.match(read('results.html'),/data-context-nav="staff"[^>]*hidden/);
 assert.doesNotMatch(script,/signOut\(/);
});
test('paper month picker maintains required native YYYY-MM form value',()=>{
 const js=read('paper-month.js');
 assert.match(js,/input\.value = value/);
 assert.match(js,/input\.dispatchEvent\(new Event\('change'/);
 assert.match(js,/Asia\/Jakarta/);
 assert.match(js,/aria-pressed/);
 assert.match(js,/Escape/);
 assert.match(js,/Tab/);
});
test('paper dropdown is enabled for jury status and operations/results choices',()=>{
 assert.match(read('paper-dropdown.js'),/select#jury-status/);
 assert.match(read('paper-select-init.js'),/enhancePaperMonthInputs\(document\)/);
 for(const page of ['results.html','jury.html','operations.html']) {
  assert.match(read(page),/paper-mobile-controls\.css/);
  assert.match(read(page),/paper-select-init\.js/);
 }
});
test('mobile navbar never requires five unreadable tiny tabs',()=>{
 const css=read('paper-mobile-controls.css');
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/min-height:44px!important/);
 assert.match(css,/cf-paper-month-panel/);
});
