'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..','public',f),'utf8');

test('open paper menu header has a real positive stacking level above the positioned hero',()=>{
  const css=read('paper-mobile-controls.css');
  assert.match(css,/\.cf-header\{position:relative;z-index:90;/);
  assert.match(css,/nav\.cf-nav\[data-paper-menu-enhanced\]\.is-paper-menu-open:not\(\[hidden\]\)\{display:grid!important\}/);
  assert.match(css,/nav\.cf-nav\[hidden\]/);
});
test('mobile pending identity indicator is a compact header sibling, not 100%-wide overlay',()=>{
  const css=read('session-continuity.css');
  assert.match(css,/html\.esoria-context-pending body\.esoria-dossier-page \.cf-header>nav\.cf-nav-pending\{/);
  assert.match(css,/flex:0 0 132px!important/);
  assert.match(css,/max-width:132px/);
  assert.match(css,/\.cf-header>\.cf-brand\{/);
  assert.match(read('results.html'),/Memeriksa akses…/);
});
test('archive mobile submit occupies the cell beside wave, not a full third row',()=>{
  const css=read('paper-mobile-controls.css');
  assert.match(css,/@media \(min-width:361px\) and \(max-width:590px\)/);
  assert.match(css,/#scope-form\.cf-toolbar>\.cf-button\{\s*grid-column:auto!important/);
  assert.match(css,/@media \(max-width:360px\)/);
});
test('mobile menu remains a visual enhancement and cannot grant access',()=>{
  const menu=read('paper-workspace-menu.js');
  assert.match(menu,/navigations\.find\(\(nav\) => !nav\.hidden\)/);
  assert.doesNotMatch(menu,/signIn|isAdminUser|setStaffRoles|localStorage/);
  assert.match(read('results-context.js'),/const permitted = admin;/);
});
