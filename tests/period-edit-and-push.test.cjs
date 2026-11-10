const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('period controls start locked and require explicit create or edit', () => {
  const html = read('public/admin.html'), js = read('public/admin.js');
  assert.match(html, /id="period-edit-current"/);
  assert.match(html, /id="period-cancel-edit"/);
  assert.match(html, /id="period-delete-current"/);
  assert.match(js, /applyPeriodMode\('view'\)/);
  assert.match(js, /mode: periodEditMode, expectedRevision:/);
  assert.match(js, /askConfirmation\('Buka pengaturan periode\?/);
});
test('push toggling has busy feedback and at-most-twice-daily refresh', () => {
  const js=read('public/push-notifications.js');
  assert.match(js,/pendingAction === 'disable'/);
  assert.match(js,/aria-busy/);
  assert.match(js,/12 \* 60 \* 60 \* 1000/);
});
test('admin firestore and storage stay server-authoritative', () => {
  const rules=read('firestore.rules'), storage=read('storage.rules');
  assert.match(rules,/match \/periods\/\{periodId\} \{\s*allow read: if true;\s*allow write: if false;/);
  assert.match(storage,/data\.role != 'admin'/);
  assert.match(storage,/allow update, delete: if false;/);
});
