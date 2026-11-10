'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('first registration must never read a nonexisting owner-protected Firestore document directly', () => {
  const client = read('public/spark-data.js');
  const block = client.slice(client.indexOf('export const submitRegistration ='),client.indexOf('export const replacePaymentProof ='));
  assert.doesNotMatch(block,/getDoc\s*\(\s*doc\s*\(\s*db\s*,\s*[\x27\x22]registrations[\x27\x22]/);
  assert.match(block,/invoke\(\s*[\x27\x22]getOwnRegistrationStatus[\x27\x22]/);
  assert.match(block,/preflight\.data\?\.exists/);
  assert.match(block,/auth\.currentUser\?\.uid !== user\.uid/);
});
test('authenticated member owns lookup ID and legacy admin cannot gain third-role access', () => {
  const backend=read('functions/competition.js');
  const block=backend.slice(backend.indexOf('handlers.getOwnRegistrationStatus ='),backend.indexOf('handlers.createPaymentProofUpload ='));
  assert.match(block,/await participant\(request\)/);
  assert.match(block,/scopeInput\(request\.data/);
  assert.match(block,/user\.uid/);
  assert.match(block,/record\.userId !== user\.uid/);
  const router=read('functions/index.js');
  assert.match(router,/\.\.\.competition\.handlers/);
  assert.match(router,/[\x27\x22]getOwnRegistrationStatus[\x27\x22],\s*[\x27\x22]submitRegistration/);
  assert.match(read('firestore.rules'),/match \/registrations\/\{registrationId\}/);
  assert.doesNotMatch(read('firestore.rules'),/match \/registrations\/\{registrationId\}[^}]*allow read:\s*if true/);
});
test('registration period heading describes actual status rather than always predicting closure',()=>{
  assert.match(read('public/form-pendaftaran.html'),/id="registration-countdown-heading"/);
  const code=read('public/registration.js');
  assert.match(code,/countdownHeading\.textContent = 'BATAS PENDAFTARAN'/);
  assert.match(code,/countdownHeading\.textContent = 'PENDAFTARAN DIBUKA DALAM'/);
});
test('mobile review uses compact two-column paper layout, responsive dialogs and real focusable controls',()=>{
  const css=read('public/registration-paper-compact.css');
  const html=read('public/form-pendaftaran.html');
  assert.match(css,/registration-review-grid\s*\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/registration-review-dialog\s*\{padding:15px 13px 13px!important;max-height/);
  assert.match(html,/<dialog[^>]+registration-review-dialog/);
  assert.match(html,/id="registration-confirm-submit"/);
  assert.match(read('public/registration.js'),/review-wide-mobile/);
});
test('team member headers remain fieldset/legend, and no absolute rotated title is required',()=>{
  const code=read('public/registration.js');
  const css=read('public/registration-paper-compact.css');
  assert.match(code,/<fieldset class="team-member-card"/);
  assert.match(code,/<legend><b>/);
  assert.match(css,/\.registration-body \.team-member-card legend/);
  assert.match(css,/transform:none!important/);
});
