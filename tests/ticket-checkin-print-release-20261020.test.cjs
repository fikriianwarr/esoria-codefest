'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const setup = (handler, status = 'terverifikasi', recordPatch = {}) => {
  const code = source('functions/index.js');
  const start = code.indexOf(`const ${handler} = async (request) => {`);
  const end = code.indexOf('\nconst ', start + 10);
  assert.ok(start > 0 && end > start, 'backend handler must exist');
  const writes = [];
  const record = {active: true, status, userId: 'member-12345', ticketNumber: 'ECF-2026-11-WEB-W1-0001',referenceNumber: 'ECF-2026-11-WEB-W1-0001',periodId:'2026-11',package:'web',wave:'wave-01',checkInRevision:0,...recordPatch};
  const doc = (id) => ({id});
  const context = {
    requireAdmin: async () => ({uid:'admin-12345',email:'admin@example.com'}),
    requireString: (v) => String(v),
    HttpsError: class extends Error {constructor(code,message){super(message);this.code=code;}},
    SERVER_TIMESTAMP:{seconds:1700000000},
    db: {doc,runTransaction: async (callback) => callback({
      get: async (ref) => ref.id.startsWith('periodSlots/') ? ({exists:true,data:()=>({count:1,capacity:50})}) : ({exists:true,data:()=>record}),
      update: (ref,data) => writes.push({ref:ref.id,data}),
      set: (ref,data) => writes.push({ref:ref.id,data})
    })},
    slotIdFor: (a,b,c)=>`${a}__${b}__${c}`,
    normalizeTicket: (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '-'),
    notificationRef: (uid,id)=>doc(`notifications/${uid}/${id}`),
    notificationData: (obj)=>obj,
    auditRef: (id)=>doc(`audits/${id}`),
    auditData: ()=>({actor:'admin'})
  };
  const execute = new Function(...Object.keys(context),`${code.slice(start,end)};return ${handler};`)(...Object.values(context));
  return {execute, writes};
};

test('accepted member check-in updates attendance and writes audit without undefined variables', async()=>{
  const {execute,writes}=setup('checkInRegistrationHandler');
  assert.deepEqual(await execute({data:{registrationId:'registration-abcde',checkedIn:true}}),{ok:true,checkedIn:true,unchanged:false});
  const update = writes.find((write)=>write.ref==='registrations/registration-abcde');
  assert.equal(update.data.checkedIn,true);
  assert.equal(update.data.checkInRevision,1);
  assert.ok(writes.some((write)=>write.ref.startsWith('audits/')));
});
test('check-in rejects non-accepted or archived tickets',async()=>{
  const {execute}=setup('checkInRegistrationHandler','menunggu');
  await assert.rejects(execute({data:{registrationId:'registration-abcde',checkedIn:true}}),{code:'failed-precondition'});
});
test('archive and restore handlers do not throw undefined review status variables',async()=>{
  const archived=setup('softDeleteRegistrationHandler', 'menunggu');
  await archived.execute({data:{registrationId:'registration-abcde'}});
  assert.equal(archived.writes.find((write)=>write.ref==='registrations/registration-abcde').data.active,false);
  const restored=setup('restoreRegistrationHandler');
  // This test only ensures those handlers no longer reference payment review fields;
  // restore requires an archived record and is tested separately by Emulator.
  assert.doesNotMatch(restored.execute.toString(),/bankTransferConfirmed|adminNotes/);
});
test('automatic batch tickets use existing ECF prefix only once',()=>{
  const admin=source('public/admin.js');
  assert.match(admin,/normalizeTicket\(item\.referenceNumber \|\| `ECF-\$\{item\.id\.slice\(-12\)\}`\)/);
  assert.doesNotMatch(admin,/normalizeTicket\(`ECF-\$\{item\.referenceNumber/);
  assert.match(admin,/duplicatePrefix = \/\^ECF-ECF-\/i/);
});
test('payment proof is converted into a verified image MIME blob before object URL creation',()=>{
  const sourceText=source('public/spark-data.js');
  assert.match(sourceText,/blob\.slice\(0, 12\)\.arrayBuffer\(\)/);
  assert.match(sourceText,/new Blob\(\[blob\], \{type: jpeg \? 'image\/jpeg' : 'image\/png'\}\)/);
});
test('print actions are real click listeners and no inline handlers are needed',()=>{
  assert.match(source('public/profile.js'),/data-print-ticket/);
  assert.match(source('public/admin.js'),/data-print-proof/);
  assert.match(source('public/profile.js'),/addEventListener\('click', \(\) => popup\.print\(\)\)/);
  assert.match(source('public/admin.js'),/getElementById\('print-proof-now'\)\?\.addEventListener\('click', async \(\) =>/);
  assert.match(source('public/admin.js'),/if \(!previewImage\?\.naturalWidth\)/);
  assert.match(source('public/admin.js'),/windowRef\.print\(\)/);
});
test('responsive modals and batch buttons retain scroll fallback and keyboard checkboxes',()=>{
  const css=source('public/admin.css');
  assert.match(css,/admin-checkbox-option input\[type="checkbox"\]/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/max-height:calc\(100dvh - 20px\)/);
  const profile=source('public/styles.css');
  assert.match(profile,/\.profile-ticket-more/);
  assert.match(profile,/max-height:calc\(100dvh - 20px\)/);
});

test('retrying the same check-in is idempotent; it does not write a second audit or notification', async()=>{
  const {execute,writes}=setup('checkInRegistrationHandler','terverifikasi',{checkedIn:true,checkInRevision:3});
  assert.deepEqual(await execute({data:{registrationId:'registration-abcde',checkedIn:true}}),{ok:true,checkedIn:true,unchanged:true});
  assert.equal(writes.length,0);
});
test('check-in requires an explicit boolean and cannot accept an unnumbered ticket', async()=>{
  const {execute}=setup('checkInRegistrationHandler');
  await assert.rejects(execute({data:{registrationId:'registration-abcde'}}),{code:'invalid-argument'});
  const noTicket=setup('checkInRegistrationHandler','terverifikasi',{ticketNumber:''});
  await assert.rejects(noTicket.execute({data:{registrationId:'registration-abcde',checkedIn:true}}),{code:'failed-precondition'});
});


test('archiving a checked-in member requires explicit check-in reversal and writes nothing',async()=>{
  const {execute,writes}=setup('softDeleteRegistrationHandler','terverifikasi',{checkedIn:true});
  await assert.rejects(execute({data:{registrationId:'registration-abcde'}}),{code:'failed-precondition'});
  assert.equal(writes.length,0);
});

test('ACC without check-in still requires cancellation before archive', async()=>{
  const {execute,writes}=setup('softDeleteRegistrationHandler', 'terverifikasi', {checkedIn:false});
  await assert.rejects(execute({data:{registrationId:'registration-abcde'}}),{code:'failed-precondition'});
  assert.equal(writes.length,0);
});
