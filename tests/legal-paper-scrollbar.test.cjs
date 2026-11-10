'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../public/legal');
const css = fs.readFileSync(path.join(root, 'assets/css/legal-paper.css'), 'utf8');
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith('.html'));

test('semua halaman Legal memakai versi stylesheet paper-scroll terbaru', () => {
  assert.equal(htmlFiles.length, 10);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /assets\/css\/legal-paper\.css\?v=[a-f0-9]{16}/, file);
  }
});

test('scrollbar halaman utama dan menu, daftar isi, tabel memakai paper style', () => {
  assert.match(css, /ESORIA LEGAL PAPER SCROLLBAR/);
  for (const selector of ['html', 'body', '.nav-links', '.document-index', '.table-wrap', 'textarea', 'pre']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.') + '::-webkit-scrollbar-thumb'), selector);
  }
  assert.match(css, /scrollbar-color:\s*var\(--legal-scroll-ink\)\s+var\(--legal-scroll-track\)/);
  assert.match(css, /\.document-index\s*\{\s*scrollbar-color:\s*var\(--legal-scroll-gold\)/);
  assert.match(css, /scrollbar-thumb:hover/);
  assert.match(css, /scrollbar-button/);
});

test('scrollbar native tetap ada; tidak ada mekanisme memblokir scroll', () => {
  const part = css.split('/* ESORIA LEGAL PAPER SCROLLBAR — 20261016')[1]?.split('/* Mobile navigation — compact paper menu anchored at right. */')[0];
  assert.ok(part);
  assert.doesNotMatch(part, /overflow:\s*hidden|touch-action:\s*none|pointer-events:\s*none|scrollbar-width:\s*none/);
});
