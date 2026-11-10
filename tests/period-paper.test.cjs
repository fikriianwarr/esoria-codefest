const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('satu pintu edit seluruh periode, tanpa tombol edit masing-masing kategori/wave', () => {
  const js = read('public/admin.js');
  assert.match(js, /Edit Seluruh Periode →/);
  assert.doesNotMatch(js, /Atur kategori →/);
  assert.doesNotMatch(js, /Atur \$\{waveId/);
  assert.match(js, /if \(periodEditMode !== 'view'\) return showToast\('Selesaikan atau batalkan perubahan/);
  assert.match(js, /fillPeriodForm\(item, '', '', false\)/);
});

test('simpan menunggu konfirmasi, tidak mengaku menyimpan sebelum disetujui', () => {
  const js = read('public/admin.js');
  const section = js.split("periodForm.addEventListener('submit'")[1].split("document.querySelector('#admin-confirm-action')")[0];
  assert.match(section, /askConfirmation\(/);
  assert.doesNotMatch(section, /button\.textContent = 'Menyimpan periode…'/);
  assert.match(js, /await pendingConfirmation\(\)/);
  assert.match(js, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /button\.removeAttribute\('aria-busy'\)/);
  assert.match(js, /confirmDialog\.addEventListener\('close'/);
  assert.match(js, /mode: periodEditMode, expectedRevision: periodExpectedRevision/);
});

test('paper checkbox dan dialog dimuat terakhir dengan warna dan ukuran terbaca', () => {
  const html = read('public/admin.html');
  const css = read('public/admin-period-paper.css');
  assert.match(html, /admin-period-paper\.css\?v=[a-f0-9]{16}/);
  assert.match(html, /data-module="\.\/admin\.js\?v=[a-f0-9]{16}"/);
  assert.match(css, /\.period-wave-control header label input\[type="checkbox"\]:checked \+ i::after/);
  assert.match(css, /content: '✓'/);
  assert.match(css, /dialog\.admin-confirm-dialog h2[\s\S]*color: #10243a !important/);
  assert.match(css, /grid-template-areas: 'wave-top wave-top' 'timeline quota'/);
});

test('firestore dan storage tetap membatasi penulisan bisnis di sisi server', () => {
  const rules = read('firestore.rules');
  const storage = read('storage.rules');
  assert.match(rules, /match \/periods\/\{periodId\} \{\s*allow read: if true;\s*allow write: if false/);
  assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/admins\/\$\(request\.auth\.uid\)\)\.data\.active == true/);
  assert.match(storage, /allow create: if activeParticipant\(uid\)/);
  assert.match(storage, /allow update, delete: if false/);
});
