const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=(file)=>fs.readFileSync(path.join(root,file),'utf8');
test('six member profile actions remain in a single mobile row without hiding labels',()=>{
 const html=source('public/profil.html'),css=source('public/esoria-paper-final-20261020.css');
 for(const item of ['profile-push-button','profile-notification-button','profile-landing-link','profile-home-link','profile-current-tab','profile-logout'])assert.ok(html.includes(item),item);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important/);
 assert.match(css,/profile-landing-link:focus-visible/);
});
test('staff menu is never activated before backend role validation',()=>{
 const js=source('public/workspace.js'),css=source('public/esoria-paper-final-20261020.css');
 assert.ok(js.indexOf("const session = await api('resolveSession')")<js.indexOf("document.querySelectorAll('[data-role-nav]')"));
 assert.match(css,/auth-pending \.cf-header>\.cf-nav:not\(\.cf-nav-verifying\)/);
 for(const page of ['jury.html','operations.html']){
  const html=source('public/'+page);
  assert.match(html,/class="cf-nav cf-nav-verifying" data-context-nav="pending"/);
  assert.match(html,/<a href="admin.html" data-full-admin hidden>/);
  assert.match(html,/data-role-nav="jury" hidden/);
 }
 assert.equal((js.match(/document\.querySelectorAll\('\[data-logout\]'\)\.forEach/g)||[]).length,2);
});
test('bank and wallet selector persists the human-readable value, keeping legacy payload unchanged',()=>{
 const html=source('public/form-pendaftaran.html');
 const reg=source('public/registration.js');
 assert.match(html,/<select name="bank_pengirim" required/);
 for(const name of ['BCA','BRI','BSI','Bank Jago','DANA','GoPay','OVO','ShopeePay','Bank lainnya','E-wallet lainnya'])assert.ok(html.includes('value="'+name+'"'),name);
 assert.match(reg,/data\.get\('bank_pengirim'\)/);
 assert.match(source('functions/index.js'),/requireString\(input\.senderInstitution/);
});
test('the private payment evidence print is page-bounded and waits for image readiness',()=>{
 const admin=source('public/admin.js'),css=source('public/esoria-paper-final-20261020.css');
 assert.match(admin,/@page\{size:A4 portrait;margin:12mm\}/);
 assert.match(admin,/height:258mm;max-height:258mm/);
 assert.match(admin,/if \(previewImage && !previewImage\.complete\)/);
 assert.match(admin,/if \(!previewImage\?\.naturalWidth\)/);
 assert.match(css,/admin-payment-proof-actions/);
 assert.match(admin,/Lihat gambar penuh ↗<\/a>/);
});
test('official check-in semantics remain unchanged despite shorter label',()=>{
 const admin=source('public/admin.js'),op=source('public/competition-operations.js');
 assert.match(admin,/>Batal Check-in<\/button>/);
 assert.match(op,/checkedIn \? 'Batal Check-in' : 'Check-in'/);
 assert.match(op,/checkedIn:!reg\.checkedIn|checkedIn/);
});
test('rules preserve server-only business writes and private storage intents',()=>{
 const firestore=source('firestore.rules'),storage=source('storage.rules');
 assert.match(firestore,/match \/registrations\/\{registrationId\}/);
 assert.match(firestore,/allow write: if false/);
 assert.match(storage,/proofUploadIntents/);
 assert.match(storage,/allow list: if false/);
});
