'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../functions/index.js'),'utf8');
const first = source.indexOf('async function reviewRegistrationCore(admin, input = {}) {');
const last = source.indexOf('\nconst reviewRegistrationHandler',first);
assert.ok(first > 0 && last > first);
const code = source.slice(first,last);
const canonical = 'ECF-2026-11-WEB-W1-0001';
const regId = 'registration-123456';
const pending = {active:true, status:'menunggu', paymentStatus:'belum_diperiksa',paymentProofAttached:true, checkedIn:false, ticketNumber:'', referenceNumber:canonical, reviewRevision:0,userId:'member-abc',periodId:'2026-11'};
const accepted = {...pending,status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:canonical,bankTransferConfirmed:true,reviewRevision:1};
const admin = {uid:'admin-abc',email:'admin@example.com'};
const notes = 'Mutasi rekening resmi diperiksa dan cocok.';
const approve = {registrationId:regId,expectedReviewRevision:0,status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:canonical, bankTransferConfirmed:true,adminNotes:notes};
function harness(record) {
  const writes=[];
  const docs = new Map([[`registrations/${regId}`,record]]);
  const db={
    doc:(path)=>({path}),
    runTransaction: async (cb)=>cb({
      get: async ({path})=>({exists:docs.has(path),data:()=>docs.get(path)}),
      update:({path},data)=>{writes.push({op:'update',path,data});docs.set(path,{...(docs.get(path)||{}),...data});},
      set:({path},data)=>{writes.push({op:'set',path,data});docs.set(path,data);},
      delete:({path})=>{writes.push({op:'delete',path});docs.delete(path);}
    })
  };
  const context = {
    requireString:(value,label,min,max)=> {const s=String(value||'').trim();if(s.length<min||s.length>max)throw Error(label);return s;},
    STATUS_LABELS:{menunggu:'Menunggu',terverifikasi:'ACC',ditolak:'Ditolak'},
    PAYMENT_LABELS:{belum_diperiksa:'Belum diperiksa',sesuai:'Sesuai',bermasalah:'Bermasalah'},
    normalizeTicket:(value)=>String(value||'').trim().toUpperCase().replace(/\s+/g,'-'),
    cleanString:(value,max)=>String(value||'').trim().slice(0,max),
    HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}},
    SERVER_TIMESTAMP:{mock:'timestamp'},Timestamp:{fromMillis:(ms)=>({ms})},
    db,notificationRef:(uid,k)=>({path:`notifications/${uid}/${k}`}),
    auditRef:(k)=>({path:`audits/${k}`}),
    notificationData:(v)=>v,
    auditData:(_admin,event,_type,_id,details)=>({event,details})
  };
  const run = new Function(...Object.keys(context),`${code};return reviewRegistrationCore;`)(...Object.values(context));
  return {run:(input)=>run(admin,input),writes,docs};
}
test('ACC mempublikasikan satu tiket kanonis serta audit',async()=>{
  const h=harness(pending);
  await h.run(approve);
  assert.ok(h.docs.has(`ticketNumbers/${canonical}`));
  assert.equal(h.docs.get(`registrations/${regId}`).status,'terverifikasi');
  assert.ok(h.writes.some(w=>w.path.startsWith('audits/')));
});
test('ACC nomor ganda ECF-ECF ditolak sebelum menulis Firestore',async()=>{
  const h=harness(pending);
  await assert.rejects(h.run({...approve,ticketNumber:`ECF-${canonical}`}),{code:'invalid-argument'});
  assert.equal(h.writes.length,0);
});
test('ACC sudah aktif tidak boleh dibalik via pilihan status biasa',async()=>{
  const h=harness(accepted);
  await assert.rejects(h.run({registrationId:regId,expectedReviewRevision:1,status:'menunggu',paymentStatus:'belum_diperiksa',ticketNumber:'',adminNotes:notes}),{code:'failed-precondition'});
  assert.equal(h.writes.length,0);
});
test('ACC hanya boleh dicabut dengan alasan dan aksi eksplisit',async()=>{
  const h=harness(accepted);
  await h.run({registrationId:regId,expectedReviewRevision:1,reviewAction:'cancel_acc',status:'menunggu',paymentStatus:'belum_diperiksa',ticketNumber:'',adminNotes:'Koreksi administratif membutuhkan pemeriksaan ulang.'});
  assert.equal(h.docs.get(`registrations/${regId}`).status,'menunggu');
  assert.equal(h.docs.get(`registrations/${regId}`).ticketNumber,'');
  assert.ok(h.writes.some(w=>w.op==='delete'&&w.path===`ticketNumbers/${canonical}`));
  assert.ok(h.writes.some(w=>w.data?.event==='registration.acc_revoked'));
});
test('ACC check-in aktif tidak boleh dicabut secara diam-diam',async()=>{
  const h=harness({...accepted,checkedIn:true});
  await assert.rejects(h.run({registrationId:regId,expectedReviewRevision:1,reviewAction:'cancel_acc',status:'menunggu',paymentStatus:'belum_diperiksa',ticketNumber:'',adminNotes:'Batalkan check-in dulu sebagai catatan audit.'}),{code:'failed-precondition'});
  assert.equal(h.writes.length,0);
});
test('tiket bermasalah dapat diperbaiki dengan memindahkan indeks secara atomik',async()=>{
  const old=`ECF-${canonical}`;
  const h=harness({...accepted,ticketNumber:old});
  h.docs.set(`ticketNumbers/${old}`,{registrationId:regId});
  await h.run({registrationId:regId,expectedReviewRevision:1,reviewAction:'repair_ticket',status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:canonical,bankTransferConfirmed:true,adminNotes:notes});
  assert.equal(h.docs.get(`registrations/${regId}`).ticketNumber,canonical);
  assert.equal(h.docs.has(`ticketNumbers/${old}`),false);
  assert.equal(h.docs.get(`ticketNumbers/${canonical}`).registrationId,regId);
  assert.ok(h.writes.some(w=>w.data?.event==='registration.ticket_repaired'));
});
test('revisi lama tidak bisa menimpa keputusan sesi admin lain',async()=>{
  const h=harness({...pending,reviewRevision:2});
  await assert.rejects(h.run(approve),{code:'aborted'});
  assert.equal(h.writes.length,0);
});
test('nomor tiket peserta lain tidak dapat direbut',async()=>{
  const h=harness(pending);
  h.docs.set(`ticketNumbers/${canonical}`,{registrationId:'other-reg'});
  await assert.rejects(h.run(approve),{code:'already-exists'});
  assert.equal(h.writes.length,0);
});
