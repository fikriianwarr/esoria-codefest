const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = relative => fs.readFileSync(path.resolve(__dirname,'..',relative),'utf8');

test('profile, registration and admin include one progressive paper calendar layer', () => {
  for (const file of ['form-pendaftaran.html','profil.html','admin.html']) {
    const html=read(`public/${file}`);
    assert.match(html,/paper-date\.css\?v=/);
    assert.match(html,/paper-date-init\.js\?v=/);
    assert.equal((html.match(/paper-date-init\.js\?v=/g)||[]).length,1);
    assert.match(html,/type="date"/);
  }
});

test('paper date picker preserves original date input for Firebase forms and fires native input/change', () => {
  const source=read('public/paper-date.js');
  assert.match(source,/input\.value=value/);
  assert.match(source,/new Event\('input',\{bubbles:true\}\)/);
  assert.match(source,/new Event\('change',\{bubbles:true\}\)/);
  assert.match(source,/limits\(input\)/);
  assert.match(source,/input\.disabled \|\| input\.readOnly/);
  assert.match(source,/ec-date-native/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/popupParent\.append\(pop\)/);
});

test('restoring draft, loading profile, and admin edit keep paper calendar label in sync', () => {
  assert.match(read('public/registration.js'),/name === 'tanggal_transfer'\) field\.dispatchEvent\(new Event\('esoria:paper-date-sync'\)\)/);
  assert.match(read('public/profile.js'),/birthInput\.dispatchEvent\(new Event\('esoria:paper-date-sync'\)\)/);
  assert.match(read('public/admin.js'),/querySelector\('#admin-edit-birth'\)\?\.dispatchEvent\(new Event\('esoria:paper-date-sync'\)\)/);
});

test('calendar style stays in viewport and native input is not display:none', () => {
  const css=read('public/paper-date.css');
  assert.match(css,/\.ec-date-popover\{[^}]*position:fixed/);
  assert.match(css,/\.ec-date-popover\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.ec-date-days\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css,/\.ec-date-native\s*\{[^}]*display:none/);
});

test('bank dropdown and registration dropdown use deterministic paper chevrons', () => {
  const js=read('public/paper-dropdown.js');
  assert.match(js,/Draw a consistent chevron/);
  assert.match(js,/stroke-width="2"/);
  assert.match(read('public/registration-paper-compact.css'),/Registration select arrows/);
});
