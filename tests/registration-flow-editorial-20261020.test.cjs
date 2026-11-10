'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const html = readFileSync(path.join(root, 'form-pendaftaran.html'), 'utf8');
const css = readFileSync(path.join(root, 'esoria-paper-final-20261020.css'), 'utf8');

test('registration still has exactly three semantic stage labels in original order', () => {
  const match = html.match(/<div aria-label="Tahap pendaftaran" class="registration-flow-mini">([\s\S]*?)<\/div>/);
  assert.ok(match, 'stage group must remain accessible');
  const stages = [...match[1].matchAll(/<strong>(.*?)<\/strong>/g)].map((x) => x[1]);
  assert.deepEqual(stages, ['Pilih lomba', 'Cek data', 'Periksa &amp; kirim']);
  assert.equal((match[1].match(/<svg /g)||[]).length, 3);
});

test('the editorials use blue, red, green and yellow accents and consistent equal-height cards', () => {
  assert.match(css, /REGISTRATION EDITORIAL TICKETS/);
  assert.match(css, /--ticket-accent:#14658a/);
  assert.match(css, /--ticket-accent:#b33432/);
  assert.match(css, /--ticket-accent:#19714f/);
  assert.match(css, /#e9b72e/);
  assert.match(css, /align-items:stretch!important/);
  assert.match(css, /min-height:157px!important/);
});

test('the mobile variant prioritizes readable stacked cards over horizontal overflow', () => {
  assert.match(css, /@media\(max-width:530px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(css, /min-height:76px!important/);
  assert.match(css, /overflow:hidden!important/);
});

test('decorative animation respects user motion preferences', () => {
  assert.match(css, /@media\(prefers-reduced-motion:no-preference\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation:none!important;transition:none!important/);
});
