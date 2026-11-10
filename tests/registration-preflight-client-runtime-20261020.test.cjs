'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = readFileSync(join(__dirname, '..', 'public', 'spark-data.js'), 'utf8')
  .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s+(?=const\s|function\s)/gm, '');

function harness({existing=false, archived=false, existingStatus="menunggu", changeDuringPreflight=false, changeDuringSubmit=false, rejectSubmit=false}={}) {
  const user={uid:'member-fixture',email:'member@example.invalid',emailVerified:true,reload:async()=>{},getIdToken:async()=>''};
  const auth={currentUser:user};
  const actions=[];
  let uploads=0;
  const store=new Map();
  const sessionStore={getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v),removeItem:key=>store.delete(key)};
  const httpsCallable=()=>async ({action,payload})=>{
    actions.push({action,payload});
    if(action==='getOwnRegistrationStatus') {
      if(changeDuringPreflight) auth.currentUser=null;
      return {data:existing?{exists:true,active:!archived,status:existingStatus,referenceNumber:'ECF-FIXTURE-01',registrationId:'2026-11__member-fixture__web__wave-01'}:{exists:false}};
    }
    if(action==='createPaymentProofUpload') return {data:{uploadId:'test-upload',storagePath:'payment-proofs/member-fixture/2026-11__member-fixture__web__wave-01/test.jpg'}};
    if(action==='submitRegistration') {
      if (changeDuringSubmit) auth.currentUser = null;
      if (rejectSubmit) throw new Error('simulated transport failure');
      return {data:{registrationId:'2026-11__member-fixture__web__wave-01',referenceNumber:'ECF-FIXTURE-01'}};
    }
    throw new Error(`Unexpected action: ${action}`);
  };
  const context={auth,db:{},functions:{},runtimeConfig:{},storage:{},sessionStore,crypto:webcrypto,Blob,URL,
    httpsCallable, currentSessionKey:()=>"test-device-key",
    getDoc:async()=>{throw new Error('Must not read missing registration directly from Firestore.');},
    doc:()=>{throw new Error('Must not construct a direct registration reference.');},
    ref:()=>({}),storageRef:()=>({}),uploadBytes:async()=>{uploads++},getBlob:async()=>{},
    serverNow:()=>Date.now(),syncServerClock:async()=>{},console};
  vm.runInNewContext(source + '\nglobalThis.__testedSubmit = submitRegistration;',context,{timeout:1500});
  return {run:context.__testedSubmit,actions,auth,store,get uploads(){return uploads}};
}
const input=()=>({periodId:'2026-11',package:'web',wave:'wave-01',submissionId:'fixture-id',proof:{blob:new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'}),width:800,height:600,fileName:'transfer.jpg'}});

test('new member registration preflight is callable then upload then server transaction (no direct Firestore document read)',async()=>{
 const h=harness();
 const result=await h.run(input());
 assert.equal(result.data.referenceNumber,'ECF-FIXTURE-01');
 assert.equal(h.uploads,1);
 assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus','createPaymentProofUpload','submitRegistration']);
 assert.equal(h.actions[0].payload.periodId,'2026-11');
});
test('existing member registration returns own receipt without uploading a new proof',async()=>{
 const h=harness({existing:true});
 const result=await h.run(input());
 assert.equal(result.data.duplicate,true);
 assert.equal(result.data.referenceNumber,'ECF-FIXTURE-01');
 assert.equal(h.uploads,0);
 assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus']);
});
test('account switch while private preflight runs stops the upload before data can be sent',async()=>{
 const h=harness({changeDuringPreflight:true});
 await assert.rejects(h.run(input()),e=>e.code==='functions/unauthenticated');
 assert.equal(h.uploads,0);
 assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus']);
});

test('archived member registration cannot be represented as a successful duplicate',async()=>{
 const h=harness({existing:true,archived:true});
 await assert.rejects(h.run(input()),error=>error.code==='functions/failed-precondition'&&/diarsipkan/.test(error.message));
 assert.equal(h.uploads,0);
 assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus']);
});

test('an already approved ticket or rejected registration never masquerades as a new receipt', async()=>{
 for (const existingStatus of ['terverifikasi','ditolak']) {
  const h=harness({existing:true,existingStatus});
  await assert.rejects(h.run(input()),error=>error.code==='functions/failed-precondition');
  assert.equal(h.uploads,0);
  assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus']);
 }
});


test('account switch while server confirms registration does not leak old Member receipt', async()=>{
 const h=harness({changeDuringSubmit:true});
 await assert.rejects(h.run(input()),error=>error.code==='functions/unauthenticated');
 assert.equal(h.uploads,1);
 assert.deepEqual(h.actions.map(x=>x.action),['getOwnRegistrationStatus','createPaymentProofUpload','submitRegistration']);
 const key='esoria-submission-id:member-fixture:2026-11:web:wave-01';
 assert.equal(h.store.get(key),'fixture-id','keep the retry token for the original Member only');
});

test('a failed submission retry token cannot bleed across competition slots', async()=>{
 const h=harness({rejectSubmit:true});
 const first=input(); delete first.submissionId;
 await assert.rejects(h.run(first),/transport failure/);
 const savedFirst=h.store.get('esoria-submission-id:member-fixture:2026-11:web:wave-01');
 assert.match(savedFirst,/^[0-9a-f-]{36}$/i);
 const second=input(); delete second.submissionId; second.wave='wave-02';
 await assert.rejects(h.run(second),/transport failure/);
 const savedSecond=h.store.get('esoria-submission-id:member-fixture:2026-11:web:wave-02');
 assert.notEqual(savedFirst,savedSecond);
 assert.equal(h.store.get('esoria-submission-id'),undefined);
});
