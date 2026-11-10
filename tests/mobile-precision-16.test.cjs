const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'public');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('layout precision loaded on four core pages after legacy responsive styles', () => {
  for (const page of ['index.html','profil.html','admin.html','form-pendaftaran.html']) {
    const html=read(page);
    assert.match(html, /responsive-precision-20261016\.css/);
    assert.ok(html.indexOf('responsive-precision-20261016.css') > html.indexOf('responsive-stability.css'));
  }
});
test('hero CTA, paired admin controls, and profile actions have mobile grid invariants', () => {
  const css=read('responsive-precision-20261016.css');
  for (const fragment of ['.landing-body .hero-copy .hero-actions', '.profile-body .profile-primary-actions', '.admin-body .admin-user-card > .admin-user-meta', '.admin-body .admin-user-card > .admin-card-actions', '.admin-body .admin-toolbar-actions']) {
    assert.ok(css.includes(fragment), `CSS missing ${fragment}`);
  }
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});
test('native touchscreen carousel scrolling is never captured by custom mouse handler', () => {
  const js=read('script.js');
  assert.match(js, /event\.pointerType !== 'mouse'/);
});
test('touch scroll + compact carousel controls set in mobile stylesheet', () => {
  const css=read('responsive-precision-20261016.css');
  assert.match(css, /touch-action:pan-x pan-y/);
  assert.match(css, /\.ticket-toolbar\.is-visible/);
  assert.match(css, /\.ticket-toolbar \.slide-btn/);
});
test('CSV export requires admin confirmation before creating a download', () => {
  const js=read('admin.js');
  assert.match(js, /askConfirmation\('Ekspor data ke CSV\?'/);
  assert.match(js, /'Ya, Ekspor CSV'/);
});
test('audit labels are readable, with backend audit identifiers preserved', () => {
  const js=read('admin.js');
  assert.match(js, /'profile_edit\.requested': 'Permintaan edit profil dikirim'/);
  assert.match(js, /friendlyTarget/);
  assert.match(js, /\['ID Log', 'Tindakan'/);
});
test('registration wave options remain visible even when legitimately disabled', () => {
  const css=read('responsive-precision-20261016.css');
  assert.match(css, /#wave-options \[role="option"\]:disabled/);
  assert.match(css, /opacity:1!important;visibility:visible!important/);
  assert.match(css, /#wave-options\[hidden\] \{display:none!important/);
});
test('legal CSS cache version updated across the legal pages', () => {
  const legal=path.join(root,'legal');
  for (const file of fs.readdirSync(legal).filter((file) => file.endsWith('.html'))) {
    assert.match(fs.readFileSync(path.join(legal,file),'utf8'), /legal-paper\.css\?v=[a-f0-9]{16}/);
  }
});
