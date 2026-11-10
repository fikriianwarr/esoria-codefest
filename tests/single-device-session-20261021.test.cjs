'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const path = (file) => readFileSync(join(__dirname,'..',file),'utf8');
const backend = path('functions/index.js');
const web = path('public/single-device-session.js');
const auth = path('public/auth-core.js');
const workspace = path('public/workspace.js');
const login = path('public/auth-pages.js');
const firestore = path('firestore.rules');
const storage = path('storage.rules');
const legal = path('public/legal/index.html');

test('new authenticated browser activates a secret-bound session through Cloud Function',()=>{
  assert.match(backend,/const activateDeviceSessionHandler/);
  assert.match(backend,/sessionHash:hash\(key\)/);
  assert.match(backend,/loginTime < record\.authTime/);
  assert.match(backend,/loginTime === record\.authTime && record\.sessionHash !== hash\(key\)/);
  assert.match(backend,/accountSessions\/\$\{user\.uid\}/);
  assert.match(web,/crypto\.getRandomValues\(bytes\)/);
  assert.match(login,/await activateDeviceSession\(user\)/);
});

test('authenticated API and CTF both reject superseded sessions before private actions',()=>{
  assert.match(backend,/await requireDeviceSession\(request\);[\s\S]*enforceActionQuota\(user\.uid, 'submitFlag'\)/);
  assert.match(backend,/await requireDeviceSession\(\{auth:request\.auth, data:\{payload:request\.data\?\.payload \|\| \{\}\}\}\)/);
  assert.match(backend,/doc\.data\(\)\?\.authTime !== sessionAuthTime\(request\)/);
  assert.match(backend,/doc\.data\(\)\?\.sessionHash !== hash\(key\)/);
});

test('rules block reads and writes from old auth_time including Storage while allowing account owner to see replacement',()=>{
  for (const doc of ['firestore.rules','firestore.rules.mfa-enforced']) {
    const rules=path(doc);
    assert.match(rules,/accountSessions\/\$\(request\.auth\.uid\)/);
    assert.match(rules,/\.data\.authTime == request\.auth\.token\.auth_time/);
    assert.match(rules,/match \/accountSessions\/\{uid\}/);
    assert.match(rules,/allow list, write: if false/);
  }
  for (const doc of ['storage.rules','storage.rules.mfa-enforced']) {
    const rules=path(doc);
    assert.match(rules,/accountSessions\/\$\(request\.auth\.uid\)/);
    assert.match(rules,/\.data\.authTime == request\.auth\.token\.auth_time/);
  }
});

test('browser monitors account session document for account takeover and signs out in background',()=>{
  assert.match(web,/onSnapshot\(doc\(db, 'accountSessions', user\.uid\)/);
  assert.match(web,/await signOut\(auth\)/);
  assert.match(web,/\/login\.html\?reason=other-device/);
  assert.match(auth,/await verifyAndWatchDeviceSession\(user\)/);
  assert.match(workspace,/await verifyAndWatchDeviceSession\(user\)/);
});

test('Legal landing page omits redundant guidance panels without removing document index',()=>{
  assert.doesNotMatch(legal,/legal-center-note-grid|legal-resource-band|legal-documents-next/);
  assert.match(legal,/Indeks Dokumen/);
  assert.match(legal,/Sebelum Mendaftar/);
  assert.match(legal,/Kebijakan Privasi/);
});

test('Emulator fixtures activate the real server session before private workflow calls',()=>{
  const helpers=path('tests/emulator/helpers.mjs');
  assert.match(helpers,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(helpers,/await call\(actor, 'activateDeviceSession', \{sessionKey: actor\.sessionKey\}\)/);
  assert.match(helpers,/sessionKey: user\.sessionKey/);
  assert.match(helpers,/ctf \? \{payload: data\} : \{action, payload: data\}/);
  assert.match(helpers,/accountSessions\/\$\{uid\}/);
});

test('Firestore and strict MFA emulator contexts are bound to seeded auth_time',()=>{
  const rules=path('tests/emulator/rules.test.mjs');
  const mfa=path('tests/emulator/strict-mfa.test.mjs');
  assert.match(rules,/auth_time: testAuthTime/);
  assert.match(rules,/accountSessions\/\$\{uid\}/);
  assert.match(rules,/absent and superseded device sessions cannot read Firestore or Storage/);
  assert.match(mfa,/accountSessions\/strict_admin/);
  assert.match(mfa,/auth_time:strictAuthTime/);
  assert.match(mfa,/sign_in_second_factor:'totp'/);
});

test('Emulator explicitly rejects a replaced binder without disabling protected APIs',()=>{
  const workflow=path('tests/emulator/workflow.test.mjs');
  assert.match(workflow,/superseded browser binder is rejected before private API access/);
  assert.match(workflow,/await rejected\(call\(actor, 'resolveSession'\), 'permission-denied'\)/);
  assert.match(backend,/await requireDeviceSession\(\{auth:request\.auth/);
});
