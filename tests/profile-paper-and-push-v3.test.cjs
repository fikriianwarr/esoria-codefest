'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(base,p),'utf8');

test('kartu alur, lembar persiapan, dan catatan identitas yang dihapus tidak muncul di HTML', () => {
  const html = read('public/profil.html');
  assert.doesNotMatch(html, /class="profile-intro-flow"/);
  assert.doesNotMatch(html, /class="profile-flow-meta"/);
  assert.doesNotMatch(html, /profile-identity-note|CATATAN IDENTITAS|DATA TERLINDUNGI/);
  assert.doesNotMatch(html, /profile-intro-sheet|LEMBAR PERSIAPAN/);
  assert.match(html, /id="profile-user-name"/);
});

test('kontrol profil tetap stabil dan selector kartu yang dihapus tidak tersisa', () => {
  const ui = read('public/esoria-ui-final.css');
  const res = read('public/responsive-stability.css');
  assert.doesNotMatch(ui, /esoriaPaperFloat|esoriaPaperLift|profile-intro-flow|profile-flow-meta|profile-intro-sheet/);
  assert.doesNotMatch(res, /esoriaMobilePaperSettle|profile-intro-flow|profile-intro-sheet/);
  assert.match(ui, /\.profile-body \.profile-main \*,/);
  assert.match(ui, /animation:none!important/);
});

test('beranda menggunakan ilustrasi responsif dan tanpa perforasi setengah terpotong', () => {
  const home = read('public/index.html');
  const css = read('public/responsive-home-paper.css');
  assert.match(home, /responsive-home-paper\.css\?v=[a-f0-9]{16}/);
  assert.match(css, /\.hero-board \{width:100%; aspect-ratio:\.96\/1;/);
  assert.match(css, /\.quick-grid::before,\.landing-body \.quick-grid::after \{display:none!important/);
});

test('push menggunakan izin klik, penyimpanan tahan error, SW timeout, dan status bukan klaim palsu', () => {
  const src = read('public/push-notifications.js');
  assert.match(src, /Notification\.requestPermission\(\)/);
  assert.match(src, /await Promise\.race\(/);
  assert.match(src, /const readFlag = \(key\)/);
  assert.match(src, /clearFlag\(enableFlag\(user\.uid\)\)/);
  assert.match(src, /registerPushToken/);
  assert.match(src, /unregisterPushToken/);
  assert.match(src, /Pengaturan Android/);
});

test('Firebase rules tetap melindungi penulisan bisnis dan admin aktif', () => {
  const firestore = read('firestore.rules');
  const storage = read('storage.rules');
  assert.match(firestore, /request\.auth\.uid/);
  assert.match(firestore, /allow create, update, delete: if false/);
  assert.match(storage, /activeParticipant\(uid\)/);
  assert.match(storage, /request\.resource\.size <= 368640/);
});
