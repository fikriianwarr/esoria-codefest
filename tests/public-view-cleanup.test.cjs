'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const read = file => readFileSync(join(__dirname, '..', 'public', file), 'utf8');
test('public-only pages do not ship permanently hidden workspace buttons and dialogs', () => {
 for (const file of ['results.html','verify-certificate.html']) {
  const html=read(file);
  assert.doesNotMatch(html,/data-logout hidden/);
  assert.doesNotMatch(html,/id=\"workspace-dialog\"/);
  assert.doesNotMatch(html,/id=\"workspace-alert\"/);
 }
});
test('public certificate verification offers public navigation, not participant-only controls', () => {
 const html=read('verify-certificate.html');
 assert.match(html, /href=\"index.html\">Beranda/);
 assert.match(html,/href=\"results.html\">Hasil Publik/);
 assert.doesNotMatch(html,/href=\"dashboard.html\">Dashboard/);
});
