'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('two-account authorization is server enforced, not based on a staff record', () => {
  const server = read('functions/competition.js');
  const session = server.slice(server.indexOf('handlers.resolveSession ='), server.indexOf('handlers.createPaymentProofUpload ='));
  assert.match(session, /kind: 'admin'/);
  assert.match(session, /kind: 'participant'/);
  assert.doesNotMatch(session, /kind: 'staff'/);
  assert.match(session, /admin\.exists && admin\.data\(\)\?\.active !== true/);
  assert.doesNotMatch(server, /handlers\.setStaffRoles\s*=/);
  const source = server.slice(server.indexOf('const authorize ='), server.indexOf('const participant ='));
  assert.match(source, /requireAdmin\(request\)/);
  assert.doesNotMatch(source, /staff\//);
  const fileAccess = server.slice(server.indexOf('handlers.getSubmissionFile ='), server.indexOf('handlers.configureCompetition ='));
  assert.match(fileAccess, /await authorize\(request\)/);
  assert.doesNotMatch(fileAccess, /roles\.includes|staff\//);
});

test('winner certificates and prize acknowledgements use the same official release condition', () => {
  const server = read('functions/competition.js');
  for (const [start, end] of [
    ['handlers.issueCertificate =', 'const certificateState ='],
    ['handlers.recordPrizePayment =', 'handlers.getOperationsWorkspace =']
  ]) {
    const block = server.slice(server.indexOf(start), server.indexOf(end));
    assert.match(block, /officiallyReleased\(/);
  }
  assert.match(server, /const activeResults = async \(scope\) => \{/);
  assert.match(read('functions/domain.js'), /export const officiallyReleased/);
});

test('public navigation and historical API names are distinct from login roles', () => {
  for (const file of ['public/admin.html', 'public/jury.html', 'public/operations.html', 'public/results.html']) {
    assert.doesNotMatch(read(file), />Meja Juri<\/a>/);
  }
  const html = read('public/results.html');
  assert.ok(html.indexOf('src="runtime-config.js"') < html.indexOf('src="results-context.js'));
  assert.match(html, /data-context-nav="public"/);
  assert.match(html, /data-context-nav="member"/);
  assert.match(html, /data-context-nav="staff"/); // legacy CSS identifier only, not a role
});

test('legacy Firestore staff records cannot grant browser access', () => {
  for (const name of ['firestore.rules', 'firestore.rules.mfa-enforced']) {
    assert.match(read(name), /match \/staff\/\{uid\} \{ allow read, write: if false; \}/);
    assert.match(read(name), /match \/juryGrades\/\{id\} \{ allow read, write: if false; \}/);
  }
  const launcher = read('scripts/live/START_LIVE.ps1');
  const full = read('scripts/DEPLOY_FULL_FIREBASE.ps1');
  assert.match(launcher, /scripts\/DEPLOY_FULL_FIREBASE\.ps1/);
  assert.doesNotMatch(launcher, /seed-production\.mjs/);
  assert.ok(full.indexOf("Native 'Tes emulator keamanan") < full.indexOf("Native 'Publish Firestore Rules'"));
});
