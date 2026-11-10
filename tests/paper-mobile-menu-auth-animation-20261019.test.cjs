'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const publicRoot=path.join(__dirname,'..','public');
const read=name=>readFileSync(path.join(publicRoot,name),'utf8');
const script=read('paper-workspace-menu.js');
const css=read('paper-mobile-controls.css');

test('shared paper hamburger loads on operations, evaluation and public-results pages',()=>{
 for(const page of ['jury.html','operations.html','results.html']){
  const html=read(page);
  assert.match(html, /<script defer src="paper-workspace-menu\.js\?v=[a-f0-9]+"><\/script>/);
  assert.match(html,/paper-mobile-controls\.css\?v=[a-f0-9]+/);
 }
});
test('paper hamburger never performs or grants authentication',()=>{
 assert.doesNotMatch(script,/\bsignOut\s*\(|\bsetPersistence\s*\(|\bisAdminUser\s*\(|\blocalStorage\b|\bgetAuth\s*\(/);
 assert.match(script,/nav\.hidden/);
 assert.match(script,/document\.documentElement\.classList\.contains\('esoria-context-pending'\)/);
 assert.match(script,/!document\.body\.classList\.contains\('auth-ready'\)/);
 assert.match(script,/aria-expanded/);
 assert.match(script,/Escape/);
 assert.match(script,/pointerdown/);
 assert.match(script,/nav\.addEventListener\('click'/);
 assert.match(script,/\[data-logout\]/);
});
test('compact menu is aligned to right, has independent signout treatment and honors hidden',()=>{
 assert.match(css,/\.cf-paper-menu-toggle/);
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/right|inset:auto 0 auto auto/);
 assert.match(css,/nav\.cf-nav\[data-paper-menu-enhanced\]\.is-paper-menu-open:not\(\[hidden\]\)/);
 assert.match(css,/nav\.cf-nav :is\(a,button\)\[hidden\]/);
 assert.match(css,/button\[data-logout\]/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('login and recovery receive one short CSS animation rather than script overlay',()=>{
 const account=read('account-paper.css');
 assert.match(account, /@keyframes esoria-account-sheet-enter/);
 assert.match(account,/data-auth-page="login"/);
 assert.match(account,/auth-recovery-body/);
 assert.match(account,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(read('forgot-password.html'),/DOKUMEN 01 \/ AKSES AKUN/);
 assert.match(read('forgot-password.html'),/PEMULIHAN AKUN/);
 const login = read('login.html');
 assert.match(login,/Lanjutkan aktivitasmu, pantau perkembangan kompetisi/);
 assert.doesNotMatch(login,/Member ESORIA dan Administrator|Menu tersedia sesuai hak akses|MEMBER LOGIN|ACCESS FILE|PORTAL ESORIA \/ 01/);
});
