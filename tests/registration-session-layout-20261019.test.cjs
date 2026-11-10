const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const read = file => readFileSync(join(__dirname,'..','public',file),'utf8');

test('Auth initialization does not migrate persistence asynchronously on every page',()=>{
 const s=read('firebase-config.js');
 assert.match(s,/export const auth = getAuth\(app\)/);
 assert.doesNotMatch(s,/\bsetPersistence\s*\(/); // No migration on every page. Login configures it once.
});
test('Public results never force logout and expose explicit session recheck',()=>{
 const s=read('results-context.js');
 assert.doesNotMatch(s,/\bsignOut\s*\(/);
 assert.match(s,/Periksa sesi lagi/);
 assert.match(s,/getCurrentAuthUser/);
 assert.match(s,/if \(!permitted\) \{/);
});
test('Registration draft status is adjacent to participant strip, not floating paragraph',()=>{
 const html=read('form-pendaftaran.html');
 assert.match(html,/<div id="registration-draft-status" class="registration-draft-note"/);
 assert.match(html,/registration-account-strip[\s\S]*registration-draft-note[\s\S]*registration-period-banner/);
 assert.match(read('registration-paper-compact.css'),/registration-account-strip[\s\S]*registration-draft-note/);
});
test('Registration notice communicates real save state and never promises a reserved slot',()=>{
 const s=read('registration.js');
 assert.match(s,/Kuota belum dipesan/);
 assert.match(s,/unggah ulang bukti pembayaran/);
 assert.match(s,/updateDraftNotice/);
});
test('Paper process cards are aligned and no longer use rotations',()=>{
 const css=read('registration-paper-compact.css');
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/transform:none!important/);
 assert.match(css,/min-height:94px!important/);
});
test('No registration draft popup depends on database field changes',()=>{
 const s=read('registration.js');
 assert.match(s,/accountApi\('saveRegistrationDraft'/);
 assert.match(s,/expectedRevision: cloudDraftRevision/);
 assert.match(s,/data-state|dataset\.state/);
});
