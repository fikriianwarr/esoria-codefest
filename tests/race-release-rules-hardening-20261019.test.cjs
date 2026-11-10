'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('clarification requires the SAME official publication-time gate as the public archive', async () => {
  const source = read('functions/competition.js');
  const appeal = source.slice(source.indexOf('handlers.submitAppeal ='), source.indexOf('handlers.resolveAppeal ='));
  assert.match(appeal, /officiallyReleased\(result\.data\(\)\)/);
  assert.doesNotMatch(appeal, /result\.data\(\)\?\.published !== true/);
  const {officiallyReleased} = await import(pathToFileURL(path.join(root, 'functions/domain.js')).href);
  const current = 1800000000000;
  assert.equal(officiallyReleased({published:true,announcementAt:current + 60000},current),false);
  assert.equal(officiallyReleased({published:true,announcementAt:current},current),true);
  assert.equal(officiallyReleased({published:false,announcementAt:current - 60000},current),false);
  assert.equal(officiallyReleased({published:true},current),false);
});

test('no rule grants staff a third account role', () => {
  const code = read('functions/competition.js');
  assert.match(code, /kind: 'admin'/);
  assert.match(code, /kind: 'participant'/);
  assert.doesNotMatch(code, /handlers\.setStaffRoles\s*=/);
  for (const file of ['firestore.rules','firestore.rules.mfa-enforced']) {
    assert.match(read(file), /match \/staff\/\{uid\} \{ allow read, write: if false; \}/);
  }
});

for (const file of ['storage.rules','storage.rules.mfa-enforced']) {
  test(`${file} rejects missing metadata with safe map defaults, still uses server-issued upload intents`, () => {
    const rules = read(file);
    for (const key of ['ownerUid','registrationId','sha256','uploadId']) {
      assert.match(rules, new RegExp(`request\\.resource\\.metadata\\.get\\('${key}', ''\\)`));
    }
    assert.match(rules,/firestore\.exists\(\/databases\/\(default\)\/documents\/proofUploadIntents\//);
    assert.match(rules,/firestore\.exists\(\/databases\/\(default\)\/documents\/submissionUploads\//);
    assert.match(rules,/allow get: if resource != null/);
    assert.match(rules,/allow read, write: if false;/);
  });
}

test('member submission locks every input/select/textarea/button when read-only or deadline expires', () => {
  const code = read('public/competition-participant.js');
  assert.equal((code.match(/form\.querySelectorAll\('input,select,textarea,button'\)/g)||[]).length,2);
});

test('admin publication preview cannot be reused after switching scope or during another async load', () => {
  const code = read('public/competition-operations.js');
  assert.match(code,/let previewEpoch = 0/);
  assert.match(code,/scopeForm\.addEventListener\('change'/);
  assert.match(code,/scopeForm\.addEventListener\('input'/);
  assert.match(code,/if \(requestedEpoch !== previewEpoch \|\| loadedEpoch !== generation \|\| !sameScope\(scopeFromForm\(scopeForm\), preparedScope\)\) return;/);
  assert.match(code,/confirmationEpoch !== previewEpoch \|\| approved !== preview/);
  assert.match(code,/if \(!cursor\) invalidatePreview\(\)/);
});

test('one-click full deployment requires emulator checks and refuses destructive operations', () => {
  const script = read('scripts/DEPLOY_FULL_FIREBASE.ps1');
  assert.match(script,/test:emulator/);
  assert.match(script,/--non-interactive/);
  assert.doesNotMatch(script,/predeploy-backup\.ps1/);
  assert.match(read('DEPLOY_SEMUA.cmd'),/START_LIVE\.ps1/);
});
