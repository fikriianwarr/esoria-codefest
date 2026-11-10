'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..','public');
const read = f => fs.readFileSync(path.join(root,f),'utf8');

test('pending navbar gate runs before stylesheet and deferred Firebase role lookup',()=>{
 const html = read('results.html');
 assert.ok(html.indexOf('src="results-context-boot.js') < html.indexOf('rel="stylesheet" href="competition-paper.css'));
 assert.ok(html.indexOf('results-context-boot.js') < html.indexOf('results-context.js'));
 assert.match(html,/data-context-nav="pending"/);
 const css = read('session-continuity.css');
 assert.match(css,/html\.esoria-context-pending body\.esoria-dossier-page \.cf-nav\[data-context-nav="public"\]/);
 assert.match(css,/nav\.cf-nav\.cf-nav-pending\{display:none!important/);
 assert.match(css,/html\.esoria-context-pending body\.esoria-dossier-page nav\.cf-nav\.cf-nav-pending\{display:flex!important/);
});
test('URL context only activates a neutral pending placeholder, never a privileged link',()=>{
 const source = read('results-context-boot.js');
 for(const from of ['admin','operations','jury','dashboard','unknown','']){
  const values = new Set();
  const context = {URLSearchParams,location:{search:`?from=${from}`},document:{documentElement:{classList:{add:x=>values.add(x)}}}};
  vm.runInNewContext(source,context);
  assert.equal(values.has('esoria-context-pending'),['admin','operations','jury','dashboard'].includes(from));
  assert.doesNotMatch(source,/admin\.html|jury\.html|operations\.html/);
 }
});
test('final odd operations step fills two mobile columns but does not expand desktop',()=>{
 const css=read('competition-paper.css');
 assert.match(css,/@media\s*\(min-width:361px\) and \(max-width:600px\)/);
 assert.match(css,/#operations-process>li:last-child:nth-child\(odd\)\{grid-column:1\/-1/);
});
