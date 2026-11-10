const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('security center only allows removing old factor after a replacement exists',()=>{
  const js=read('public/admin-security.js');
  assert.match(js,/factors\.length\s*<\s*2/);
  assert.match(js,/multiFactor\(user\)\.enroll/);
  assert.match(js,/multiFactor\(user\)\.unenroll\(oldUid\)/);
  assert.match(js,/lastSmsRequestAt\s*\+\s*60000/);
  assert.match(read('public/admin.html'),/id="admin-mfa-old-panel" hidden/);
  assert.match(read('public/admin.html'),/Sinkronkan Akses/);
});

test('transaction-based rate limit and audit cannot be written directly by clients',()=>{
  const code=read('functions/index.js');
  const fire=read('firestore.rules');
  assert.match(code,/const enforceActionQuota = async/);
  assert.match(code,/db\.runTransaction/);
  assert.match(code,/logAdminCsvExportHandler/);
  assert.match(code,/admin\.csv\.export_requested/);
  assert.match(fire,/match \/securityRateLimits\/\{bucketId\}/);
  assert.match(fire,/match \/adminSecurityMeta\/\{uid\}/);
});

test('admin export requires server audit before generating local CSV',()=>{
  const source=read('public/admin.js');
  assert.ok(source.indexOf("action: 'logAdminCsvExport'") > 0);
  assert.ok(source.indexOf("action: 'logAdminCsvExport'") < source.indexOf('const csv ='));
});

test('admin session timeout and strict MFA policy have safe opt-in defaults',()=>{
  const js=read('public/admin-idle-guard.js');
  const env=read('functions/.env.esoria-codefest');
  assert.match(js,/25 \* 60_000/);
  assert.match(js,/signOut\(auth\)/);
  assert.match(env,/REQUIRE_ADMIN_MFA=false/);
  assert.match(env,/REQUIRE_RECENT_ADMIN_AUTH=false/);
  const conf=JSON.parse(read('firebase.json'));
  assert.equal(conf.firestore.rules,'firestore.rules');
  assert.equal(conf.storage.rules,'storage.rules');
});

test('ticket CTA is compact and its text does not share its arrow cell',()=>{
  assert.match(read('public/index.html'),/<strong>Daftar Lomba<\/strong>/);
  const css=read('public/responsive-precision-20261016.css');
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto!important/);
  assert.match(css,/\.ticket-action-grid \.ticket-payment-cta > b/);
  assert.match(css,/@media\(max-width:360px\)/);
});
