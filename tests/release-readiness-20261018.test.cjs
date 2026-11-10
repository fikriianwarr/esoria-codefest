const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const read = (name) => fs.readFileSync(path.join(root,name),'utf8');

test('public results staff context requires a verified role, not query param alone', () => {
  const js=read('public/results-context.js');
  assert.match(js,/observeAuthChanges\(/);
  assert.match(js,/await isAdminUser\(user\)/);
  assert.doesNotMatch(js,/getActiveStaffRoles\(user\)/);
  assert.match(js,/if \(!permitted\) \{/);
  assert.match(js,/const permitted = admin/);
  assert.ok(js.indexOf('if (!permitted) {')<js.indexOf('staffNav.hidden = false'));
  assert.match(js,/if \(!user.emailVerified\) \{/);
});
test('public results visitors do not load Firebase unless staff context requested', () => {
  const js=read('public/results-context.js');
  assert.ok(js.indexOf("if (!Object.prototype.hasOwnProperty.call(destinations, from)) return") < js.indexOf("import('./auth-core.js"));
});
test('registration Firebase failures are labeled unavailable, not closed', () => {
  const js=read('public/live-registration-status.js');
  const start=js.indexOf('const evaluateStatus ='),end=js.indexOf('const ensureBadge =',start);
  const ctx={registrationUnavailable:()=>true,pagePackage:''};
  vm.runInNewContext(js.slice(start,end)+'\nthis.evaluateStatus=evaluateStatus;',ctx);
  const result=ctx.evaluateStatus('web');
  assert.equal(result.state,'unavailable');
  assert.match(result.title,/belum dapat diperiksa/);
  assert.match(js,/stateReadError = true;/);
  assert.match(js,/periodReadError = true;/);
  assert.match(js,/slotsReadError = true;/);
  assert.match(js,/Cek Status Nanti/);
});
test('responsive navigation has readable text and 44px touch sizes', () => {
  const css=read('public/navigation-accessibility.css');
  assert.match(css,/min-height:44px/);
  assert.match(css,/font-size:12px/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/prefers-reduced-motion/);
  for(const page of ['results','dashboard','jury','operations'])assert.match(read(`public/${page}.html`),/navigation-accessibility\.css/);
});
test('admin omits the pre-release checklist without removing the security entry point', () => {
  const html=read('public/admin.html');
  assert.doesNotMatch(html,/operator-release-checklist|CHECKLIST PRA-RILIS|readiness-shortcuts/);
  assert.match(html,/id="admin-security-open"/);
  assert.match(html,/id="admin-security-dialog"/);
});
test('smoke verifier checks live public API shape read-only', () => {
  const code=read('scripts/verify-public-release.mjs');
  assert.match(code,/\/api\/public\?kind=results/);
  assert.match(code,/kind=certificate/);
  assert.match(code,/data\?\.ok===true/);
  assert.match(code,/published==='boolean'/);
  assert.doesNotMatch(code,/\bfirebase deploy\b|\bdeleteDocument\b|\bsetDoc\b/);
  assert.match(read('scripts/DEPLOY_FULL_FIREBASE.ps1'),/\/api\/public/);
  assert.match(read('scripts/live/START_LIVE.ps1'),/DEPLOY_FULL_FIREBASE\.ps1/);
});
