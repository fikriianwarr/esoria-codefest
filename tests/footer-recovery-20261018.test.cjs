const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const src = (name) => fs.readFileSync(path.join(root, 'public', name), 'utf8');

function makeLink() {
  const attrs = {};
  return {
    textContent: '', href:'', dataset:{},
    setAttribute(k,v){attrs[k]=v}, removeAttribute(k){delete attrs[k]},
    getAttribute(k){return attrs[k]},
    querySelector(){return null}
  };
}
async function checkFooter(user, admin = false, staff = null) {
  const header = makeLink(), short = makeLink();
  let listener;
  const auth = {currentUser:user};
  const code = src('site-auth.js').replace(/^import\s*(?:\{[\s\S]*?\}|[^;]*?)\s*from\s*[^;]+;\s*/gm,'');
  const document = {
    body:{dataset:{}}, documentElement:{dataset:{}},
    querySelectorAll(){return []},
    querySelector(sel){return sel === '[data-footer-portal-link]'? header : sel === '[data-footer-dashboard-link]'?short:null}
  };
  vm.runInNewContext(code, {
    document,window:{addEventListener(){}},
    auth,onAuthStateChanged(_auth, cb){listener=cb},
    async isAdminUser(){return admin},
    async verifyAndWatchDeviceSession(){},
    async getStaffDestination(){return staff}
  }, {timeout:2000});
  listener(user);
  await new Promise(resolve=>setImmediate(resolve));
  return {header,short,document};
}
test('footer retains anonymous login destination',async()=>{
  const {header,short,document}=await checkFooter(null);
  assert.match(header.href,/\/login\.html$/);
  assert.equal(header.textContent,'Masuk ke Portal ↗');
  assert.equal(short.textContent,'Portal Akun');
  assert.equal(document.documentElement.dataset.authState,'signed-out');
});
test('signed-in participant sees dashboard instead of login',async()=>{
  const {header,short}=await checkFooter({uid:'participant',emailVerified:true});
  assert.match(header.href,/\/dashboard\.html$/);
  assert.equal(header.textContent,'Buka Dashboard ↗');
  assert.equal(short.textContent,'Dashboard Saya');
});
test('active admin sees admin dashboard',async()=>{
  const {header,short}=await checkFooter({uid:'admin',emailVerified:true},true);
  assert.match(header.href,/\/admin\.html$/);
  assert.equal(short.textContent,'Panel Admin');
});
test('retired staff flag does not grant a third role; member goes to dashboard',async()=>{
  const {header}=await checkFooter({uid:'previous-staff',emailVerified:true},false,'jury.html');
  assert.match(header.href,/\/dashboard\.html$/);
  assert.equal(header.textContent,'Buka Dashboard ↗');
});
test('unverified account receives email verification destination',async()=>{
  const {header}=await checkFooter({uid:'unverified',emailVerified:false});
  assert.match(header.href,/\/verify-email\.html$/);
  assert.equal(header.textContent,'Verifikasi Email ↗');
});
test('reset form preserves authentication handlers and presents privacy-safe status',()=>{
  const html=src('forgot-password.html'), code=src('forgot-password.js');
  assert.match(html,/id="reset-request-form"/);
  assert.match(html,/id="reset-email"/);
  assert.match(html,/id="reset-submit"/);
  assert.match(html,/recovery-paper\.css/);
  assert.match(html,/CATATAN KEAMANAN/);
  assert.match(code,/sendPasswordResetEmail/);
  assert.match(code,/Jika email tersebut terdaftar/);
  assert.doesNotMatch(html,/auth-paper-kit/);
  assert.doesNotMatch(html,/account-layout\.js/); // signup-only script
});
test('paper recovery CSS removes fixed-height cards only on recovery screen',()=>{
  const css=src('recovery-paper.css');
  assert.match(css,/\.auth-recovery-body \.auth-layout\.auth-action-layout/);
  assert.match(css,/min-height:0/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/prefers-reduced-motion/);
});

test('launcher forbids hosting-only and requires full deploy',()=>{
  const ps1=fs.readFileSync(path.join(root,'scripts/live/START_LIVE.ps1'),'utf8');
  assert.match(ps1,/scripts\/DEPLOY_FULL_FIREBASE\.ps1/);
  assert.doesNotMatch(ps1,/seed-production\.mjs/);
  assert.doesNotMatch(ps1,/Confirm-ESORIAYesNo|Read-Host/);
  assert.match(ps1,/DEPLOY_FULL_FIREBASE\.ps1/);
});
