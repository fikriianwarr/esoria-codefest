'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(base,name),'utf8');

test('Hasil Publik memakai navigasi netral, bukan navigasi peserta ketika akun belum dipastikan', () => {
  const html = read('results.html');
  const publicNav = html.match(/<nav[^>]*data-context-nav="public"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(publicNav);
  assert.match(publicNav, /href="index.html">Beranda/);
  assert.match(publicNav, /href="results.html" aria-current="page" class="cf-nav-selected">Hasil Publik/);
  assert.doesNotMatch(publicNav, /Dashboard|href="profil\.html"|href="form-pendaftaran\.html"/);
  assert.match(html, /data-context-nav="staff"[^>]*hidden/);
});

test('Query from=jury tidak otomatis memberi akses role dan tidak menyebabkan signOut', () => {
  const code = read('results-context.js');
  assert.match(code, /observeAuthChanges\(/);
  assert.match(code, /await isAdminUser\(user\)/);
  assert.match(code, /const permitted = admin/);
  assert.doesNotMatch(code, /roles.includes\('judge'\)/);
  assert.doesNotMatch(code, /roles.includes\('committee'\)/);
  assert.ok(code.indexOf('if (!permitted) {') < code.indexOf('staffNav.hidden = false'));
  assert.ok(code.indexOf('if (!Object.prototype.hasOwnProperty.call(destinations, from)) return') < code.indexOf("import('./auth-core.js"));
  assert.doesNotMatch(code, /\bsignOut\s*\(/);
  assert.match(code, /Sesi belum tentu berakhir/);
  // Referrer is not trustworthy authorization evidence; permissions always use Firebase Auth.
  assert.doesNotMatch(code, /\bgenuineReferrer\b/);
});

test('Status bukan anggota tidak menyamar sebagai logout', () => {
  const code = read('site-auth.js');
  assert.match(code, /lockAuthLinks\('SESI BELUM TERVERIFIKASI'/);
  assert.match(code, /dataset\.authState = 'verification-error'/);
  assert.doesNotMatch(code, /signOut\s*\(/);
});

test('Aktivitas lintas tab hanya berlaku untuk UID yang sama, bukan nilai simpanan yang basi', () => {
  const code = read('session-activity.js').replace(/^import[^\n]+\n/m,'').replace(/export const/g,'const');
  const map = new Map();
  const events = [];
  let currentTime = 1000000;
  const storage = {
    getItem: key => map.get(key) || null,
    setItem: (key,val) => map.set(key,val)
  };
  const context = {
    auth: { currentUser: { uid:'admin-1' } },
    localStorage: storage,
    document: { addEventListener:(name,fn)=>events.push({name,fn}) },
    Date: { now:()=>currentTime },
    Number, JSON
  };
  vm.runInNewContext(code+'\nthis.logic = {markSessionActivity, lastAuthenticatedActivity};', context);
  context.logic.markSessionActivity();
  assert.equal(context.logic.lastAuthenticatedActivity('admin-1'),currentTime);
  const stored=JSON.parse([...map.values()][0]);
  assert.equal(stored.uid,'admin-1');
  currentTime+=10000;
  context.logic.markSessionActivity();
  assert.equal(JSON.parse([...map.values()][0]).at,currentTime);
  const other = {auth:{currentUser:{uid:'admin-1'}},localStorage:storage,document:{addEventListener:()=>{}},Date:{now:()=>currentTime+1000},Number,JSON};
  vm.runInNewContext(code+'\nthis.logic = {lastAuthenticatedActivity};',other);
  assert.equal(other.logic.lastAuthenticatedActivity('admin-1'),currentTime+1000);
  assert.equal(other.logic.lastAuthenticatedActivity('admin-2'),currentTime+1000);
  assert.ok(events.some(x=>x.name==='pointerdown'));
});

test('Penjaga admin tidak logout ketika tab tersembunyi dan tetap punya batas 25 menit', () => {
  const code=read('admin-idle-guard.js');
  assert.match(code,/25 \* 60_000/);
  assert.match(code,/WARN_BEFORE_MS = 2 \* 60_000/);
  assert.match(code,/document.hidden \|\| \(typeof document.hasFocus/);
  assert.match(code,/lastAuthenticatedActivity\(uid\)/);
  assert.match(code,/await signOut\(auth\)/);
  assert.doesNotMatch(code,/finally\s*\{\s*location\.replace/);
  assert.match(code,/login\.html\?session=expired/);
  assert.match(read('auth-pages.js'), /params\.get\('session'\) === 'expired'/);
});

test('CSS warning tetap dapat dibaca dan ditutup melalui tindakan lanjut', () => {
  const css=read('session-continuity.css');
  assert.match(css,/min-height:44px/);
  assert.match(css,/\.esoria-idle-warning\[hidden\]/);
  assert.match(css,/\.cf-context-state/);
  assert.match(read('admin.html'),/session-continuity\.css/);
  assert.match(read('results.html'),/session-continuity\.css/);
});
