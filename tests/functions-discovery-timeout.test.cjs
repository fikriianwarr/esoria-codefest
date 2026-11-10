'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const release = readFileSync(join(__dirname,'..','scripts/DEPLOY_FULL_FIREBASE.ps1'),'utf8');

test('functions discovery timeout is increased before the six-function publish step', () => {
  const setup = release.indexOf("$env:FUNCTIONS_DISCOVERY_TIMEOUT = '120'");
  const deploy = release.indexOf("Native 'Redeploy 6 Cloud Functions (termasuk esoriaPublic)'");
  const restore = release.indexOf('previousDiscoveryTimeout', deploy);
  assert.ok(setup >= 0 && deploy > setup, 'discovery timeout must be set in same PowerShell process before Firebase CLI');
  assert.ok(restore > deploy, 'previous discovery environment value must be restored afterward');
  assert.match(release,/Remove-Item Env:\\FUNCTIONS_DISCOVERY_TIMEOUT -ErrorAction SilentlyContinue/);
  assert.match(release,/functions:esoriaApi,functions:esoriaCtf,functions:esoriaPublic,functions:purgeExpiredPaymentProofs,functions:purgeStaleCompetitionFiles,functions:sendParticipantPush/);
});

test('increasing discovery timeout does not bypass full release safeguards', () => {
  const noninteractive = release.indexOf('Memulai full deploy non-interaktif');
  const emulator = release.indexOf('Tes emulator keamanan dan alur Admin/Member (WAJIB)');
  const deployment = release.indexOf("Native 'Redeploy 6 Cloud Functions (termasuk esoriaPublic)'");
  assert.ok(emulator > -1 && noninteractive > emulator && deployment > noninteractive);
  assert.match(release,/Native 'Publish Hosting ke website live'/);
  assert.doesNotMatch(release,/(['\"])--force\1|hosting:clone/);
  assert.doesNotMatch(release,/predeploy-backup\.ps1/);
});
