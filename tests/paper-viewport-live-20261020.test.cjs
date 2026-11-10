'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const ui=read('paper-viewport-refresh-20261020.css');

test('all revised pages load a last, shared paper styling layer',()=>{
 for(const page of ['dashboard','submission','operations','jury','results','profil','admin']){
  const html=read(`${page}.html`);
  assert.match(html,/<link\s+rel="stylesheet" href="paper-viewport-refresh-20261020\.css\?v=[a-f0-9]+"\s*\/?>/i,page);
  assert.ok(html.lastIndexOf('paper-viewport-refresh-20261020.css')>html.lastIndexOf('workspace-paper-polish.css'),page);
 }
});
test('participant landing links and stable five-item staff navbar without arrows',()=>{
 for(const page of ['dashboard','submission']){
  const html=read(`${page}.html`);
  assert.match(html,/<nav\s+class="cf-nav"[^>]*><a href="index\.html" class="cf-landing-link">Beranda<\/a>/);
 }
 for(const page of ['operations','jury']){
  assert.match(read(`${page}.html`), /data-full-admin hidden>Panel Admin<\/a>/);
  assert.match(read(`${page}.html`), /data-logout hidden>Keluar<\/button>/);
  assert.doesNotMatch(read(`${page}.html`), /class="cf-landing-link"/);
 }
 const html=read('results.html');
 assert.match(html, /data-context-nav="staff"[^>]*hidden/);
 assert.match(html, /data-nav-admin>Panel Admin<\/a>/);
 assert.match(html, /data-logout>Keluar<\/button>/);
 assert.doesNotMatch(html.match(/<nav class="cf-nav cf-nav-staff"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '', /Beranda/);
 assert.doesNotMatch(html, /data-nav-back|Kembali ke Operasional/);
 assert.doesNotMatch(read('results-context.js'), /back\.href\s*=/);
});
test('profile has reachable Beranda/Dashboard/Profil/Keluar and paper treatment',()=>{
 const html=read('profil.html');
 assert.match(html,/class="profile-landing-link" href="index.html">Beranda<\/a>/);
 assert.match(html,/class="profile-home-link" href="dashboard.html"><span>Dashboard<\/span><\/a>/);
 assert.match(html,/id="profile-logout"[^>]*><span>Keluar<\/span><\/button>/);
 assert.match(ui,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});
test('dashboard metrics, dossier, activity and single-card layout are responsive and no desktop half-width card',()=>{
 assert.match(ui,/cf-metrics\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(ui,/cf-grid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,460px\),1fr\)\)/);
 assert.match(ui,/cf-grid>\.cf-card:only-child\{display:grid/);
 assert.match(ui,/cf-activity-section \.cf-list\{padding:0 12px;width:100%/);
 assert.match(ui,/@media\(max-width:590px\)/);
});
test('submission retains native file input and accessible checkbox semantics',()=>{
 const html=read('submission.html');
 assert.match(html,/id="artifact-input" type="file"/);
 assert.match(html,/name="originality" type="checkbox"/);
 assert.match(html,/name="publicNameConsent" type="checkbox"/);
 assert.match(ui,/input\[type="checkbox"\]:checked:after/);
 assert.match(ui,/#artifact-input::file-selector-button/);
 assert.doesNotMatch(ui,/#artifact-input\{[^}]*display:none/);
});
test('operations dialog is viewport-bound with a scrollable content fallback to prevent clipping',()=>{
 assert.match(ui,/dialog\.cf-dialog\[open\]\{[^}]*max-height:calc\(100dvh - 20px\)/);
 assert.match(ui,/#workspace-dialog-content\{[^}]*overflow-y:auto/);
 assert.match(ui,/#operation-action-form \[hidden\]\{display:none!important/);
 assert.match(ui,/#operation-action-form>\.cf-button\[type="submit"\]\{[^}]*position:sticky/);
});
test('member status synchronizes from owner-readable Firestore without bypassing callable projection',()=>{
 const js=read('competition-participant.js');
 assert.match(js,/where\('userId', '==', user\.uid\)/);
 assert.match(js,/auth\.currentUser\?\.uid !== user\.uid/);
 assert.match(js,/api\('getParticipantWorkspace'\)/);
 assert.match(js,/onSnapshot\(/);
 assert.match(js,/unsubs\.forEach\(\(stop\) => stop\(\)\)/);
 assert.match(js,/clearInterval\(interval\)/);
});
test('operations live reload only after verified context and preserves modal/preview edits',()=>{
 const js=read('competition-operations.js');
 assert.match(js,/query\(collection\(db, 'registrations'\)/);
 assert.match(js,/where\('periodId', '==', scope\.periodId\)/);
 assert.match(js,/where\('package', '==', scope\.package\)/);
 assert.match(js,/where\('wave', '==', scope\.wave\)/);
 assert.match(js,/\|\| preview \|\| document\.hidden \|\| document\.querySelector\('\.cf-dialog\[open\]'\)/);
 assert.match(js,/unsubscribe\?\.\(\)/);
});
