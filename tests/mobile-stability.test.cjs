const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const css = read('public/responsive-stability.css');

test('profil dan form mendaftarkan stylesheet responsif setelah CSS lama', () => {
  for (const name of ['profil.html', 'form-pendaftaran.html']) {
    const html = read(`public/${name}`);
    assert.match(html, /responsive-stability\.css\?v=[a-f0-9]{16}/);
    assert.ok(html.indexOf('responsive-stability.css') > html.indexOf('refinement.css'));
  }
});

test('empat kontrol profil memiliki baris grid responsif tanpa menyembunyikan aksi', () => {
  const html = read('public/profil.html');
  for (const label of ['data-push-toggle', 'data-notification-toggle', 'profile-home-link', 'profile-logout']) {
    assert.ok(html.includes(label), `kontrol ${label} hilang`);
  }
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)\s*and\s*\(min-width:\s*761px\)/);
});

test('loading autentikasi menahan scroll tetapi dialog error tetap dapat digulir', () => {
  assert.match(css, /body\.auth-pending, body\.auth-error \{position:fixed!important/);
  assert.match(css, /body\.auth-pending \.auth-gate \{touch-action:none/);
  assert.match(css, /body\.auth-error \.auth-gate\.auth-gate-failed \{touch-action:auto;overflow-y:auto!important/);
});

test('halaman pendaftaran memakai judul ringkas serta meniadakan elemen pelebar viewport', () => {
  assert.match(css, /\.registration-body \.registration-intro \{display:flex;flex-direction:column/);
  assert.match(css, /\.registration-body \.registration-flow-mini \{position:static!important/);
  assert.match(css, /\.registration-body \.form-progress-panel::after \{display:none;\}/);
});

test('izin Web Push diminta langsung dalam event klik dan status denied dijelaskan', () => {
  const src = read('public/push-notifications.js');
  assert.match(src, /Notification\.permission === 'denied'/);
  const requestAt = src.indexOf('Notification.requestPermission()');
  const getTokenAt = src.indexOf('const token = await getBrowserToken();', src.indexOf("button?.addEventListener('click'"));
  assert.ok(requestAt > 0 && getTokenAt > requestAt, 'izin harus diminta sebelum pekerjaan asinkron untuk token');
  assert.match(src, /Pengaturan Android/);
});
