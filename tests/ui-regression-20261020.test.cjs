
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('paper workspace menu keeps a visible fallback nav during pending states', () => {
  const src = read('public/paper-workspace-menu.js');
  assert.match(src, /nav\.dataset\.contextNav === 'public'/);
  assert.match(src, /\|\| navigations\[0\] \|\| null/);
});

test('ticket print popup includes a responsive viewport meta and compact button label', () => {
  const src = read('public/profile.js');
  assert.match(src, /meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"/);
  assert.match(src, /Cetak \/ Simpan PDF/);
});

test('mobile nav overrides lock profile actions to six equal columns and dashboard nav to grid', () => {
  const css = read('public/esoria-paper-final-20261020.css');
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important/);
  assert.match(css, /body\[data-workspace="dashboard"\]\.esoria-dossier-page nav\.cf-nav/);
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('wave labels are shortened consistently for responsive cards and forms', () => {
  assert.match(read('functions/index.js'), /Wave Awal Bulan — mulai tanggal 1/);
  assert.match(read('public/spark-data.js'), /Wave Pertengahan Bulan — mulai tanggal 15/);
  assert.match(read('public/competition-participant.js'), /shortWaveLabel/);
  assert.match(read('public/form-pendaftaran.html'), /<strong>Wave Awal<\/strong><small>Tgl 1<\/small>/);
});
