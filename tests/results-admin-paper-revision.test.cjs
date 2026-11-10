const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const publicDir = path.resolve(__dirname, '../public');
const read = (file) => readFileSync(path.join(publicDir, file), 'utf8');

test('error helper is imported, not used as an undefined global', () => {
  assert.match(read('competition-ui.js'), /import\s*\{friendlyFirebaseError\}\s*from\s*['"]\.\/auth-core\.js/);
  assert.match(read('competition-ui.js'), /error\?\.code\s*\?\s*friendlyFirebaseError\(error\)/);
});
test('administrative result link preserves the administrative context', () => {
  assert.match(read('admin.html'), /href="results\.html\?from=admin"/);
  assert.match(read('operations.html'), /href="results\.html\?from=operations"/);
  assert.match(read('jury.html'), /href="results\.html\?from=jury"/);
});
test('results publicly accessible without pretending to grant admin permissions', () => {
  const html=read('results.html');
  assert.match(html, /data-context-nav="public"/);
  assert.match(html, /data-context-nav="staff"[^>]*hidden/);
  assert.match(html, /results-context\.js/);
  assert.match(html, /data-nav-operations/);
  assert.match(html, /data-nav-admin/);
  assert.match(html, /data-logout/);
  assert.doesNotMatch(html, /data-nav-back/);
  assert.match(read('results-context.js'), /No private|no permissions|no permissions, mutations/i);
});
test('administrative result preview explains publication does not expose drafts', () => {
  assert.match(read('results.html'), /Hasil draft tetap privat/);
  assert.match(read('results.html'), /get|public-results/);
});
test('category and wave retain the original form values used by Firebase API', () => {
  const html=read('results.html');
  for (const v of ['name="package"','name="wave"','value="web"','value="cyber"','value="team"','value="wave-01"','value="wave-02"']) assert.ok(html.includes(v),v);
  assert.match(read('paper-dropdown.js'), /select\.dispatchEvent\(new Event\('change'/);
});
test('paper dropdown supports keyboard, escape and outside clicks', () => {
  const js=read('paper-dropdown.js');
  for (const key of ['ArrowDown','ArrowUp','Home','End','Escape','Enter','pointerdown']) assert.ok(js.includes(key),key);
  assert.match(js, /aria-selected/);
  assert.match(js, /aria-expanded/);
});
test('admin navigation cards keep three columns on mobile', () => {
  const css=read('admin-workflow-compact.css');
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(read('admin.html'), /admin-workflow-compact\.css/);
});
test('paper results controls and compact empty state remain responsive', () => {
  const css=read('workspace-paper-polish.css');
  assert.match(css, /cf-paper-dropdown-menu\[hidden\]/);
  assert.match(css, /cf-empty\{min-height:112px/);
  assert.match(css, /@media\(max-width:590px\)/);
  assert.match(read('results.html'), /workspace-paper-polish\.css/);
});
