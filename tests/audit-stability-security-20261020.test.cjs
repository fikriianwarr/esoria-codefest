'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function runDashboard({switchAccount=false,legacySchedule=false}={}){
  const js=read('public/competition-participant.js');
  const start=js.indexOf('async function startDashboard({user})');
  const end=js.indexOf('async function startSubmission(',start);
  assert.ok(start>=0 && end>start);
  const calls=[];
  const els=new Map();
  const el=(key)=>{if(!els.has(key))els.set(key,{innerHTML:'',textContent:'',addEventListener(){}});return els.get(key);};
  const initial={uid:'member_a'};
  const auth={currentUser:initial};
  const wait=deferred();
  const ctx={
    auth,db:{},metric:(value,label)=>`<article>${value}:${label}</article>`,api:async()=>wait.promise,esc:(x)=>String(x??''),formatDate:(x)=>x==null?'Belum ditetapkan':String(x),
    statusLabel:(x)=>String(x??''),shortWaveLabel:(x)=>String(x??''),setClock:()=>calls.push('clock'),report:()=>calls.push('report'),
    empty:()=>'<div>kosong</div>',busy:async(_,fn)=>fn(),
    document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    window:{addEventListener(){}},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},console,
    onSnapshot:()=>()=>{},query(){return {};},collection(){return {};},where(){return {};},limit(){return {};},
    $:el,
  };
  vm.runInNewContext(js.slice(start,end)+'\nglobalThis.run=startDashboard;',ctx);
  const promise=ctx.run({user:initial});
  if(switchAccount) auth.currentUser={uid:'member_b'};
  wait.resolve({serverNow:12345,registrations:[{active:true,periodId:'2099-01',periodLabel:'Period',waveLabel:'Wave',packageLabel:'Web',referenceNumber:'ECF-TEST',registrationId:'id',status:'terverifikasi',schedule:legacySchedule?null:{deadlineAt:123}}],notices:[],truncated:false});
  await promise;
  return {calls,els};
}
test('dashboard cannot render a prior Member session after UID change',async()=>{
  const {calls,els}=await runDashboard({switchAccount:true});
  assert.equal(calls.includes('clock'),false);
  assert.equal(els.get('#registration-cards')?.innerHTML||'','');
});
test('legacy missing registration schedule is shown as unknown, not a blank dashboard',async()=>{
  const {els}=await runDashboard({legacySchedule:true});
  assert.match(els.get('#registration-cards').innerHTML,/Belum ditetapkan/);
  assert.match(els.get('#workspace-metrics').innerHTML,/PENDAFTARAN/);
});
test('emulator temporary secret must be exclusive-create and not overwrite existing files',()=>{
  const code=read('scripts/run-emulators.mjs');
  assert.match(code,/flag:\s*'wx'/);
  assert.match(code,/if \(secretCreated\) unlinkSync\(secret\)/);
  // Keep fixture completely outside the source tree to avoid cross-test races.
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'esoria-emulator-secret-'));
  fs.mkdirSync(path.join(tmp,'scripts'));
  fs.mkdirSync(path.join(tmp,'functions'));
  fs.copyFileSync(path.join(root,'scripts/run-emulators.mjs'),path.join(tmp,'scripts/run-emulators.mjs'));
  fs.copyFileSync(path.join(root,'scripts/emulator-ports.mjs'),path.join(tmp,'scripts/emulator-ports.mjs'));
  fs.writeFileSync(path.join(tmp,'package.json'),'{"type":"module"}');
  const filename=path.join(tmp,'functions/.secret.local');
  const contents='PRIVATE_OPERATOR_SENTINEL_NOT_TO_DELETE';
  try {
    fs.writeFileSync(filename,contents);
    const result=spawnSync(process.execPath,['scripts/run-emulators.mjs'],{cwd:tmp,encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0,'emulator must not overwrite a preexisting local secret');
    assert.equal(fs.readFileSync(filename,'utf8'),contents,'existing secret must remain unchanged');
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
test('production deploy refuses unready Firestore indexes before publishing Rules or Functions',()=>{
  const code=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
  assert.match(code,/throw 'Indeks Firestore belum READY/);
  const location=code.indexOf("throw 'Indeks Firestore belum READY");
  assert.ok(location>0 && location<code.indexOf("Publish Firestore Rules"));
});
test('GitHub CI runs emulator permission tests on isolated demo project',()=>{
  const workflow=read('.github/workflows/verify-esoria.yml');
  assert.match(workflow,/actions\/setup-java@v4/);
  assert.match(workflow,/npm run test:emulator/);
  assert.doesNotMatch(workflow,/firebase deploy|gcloud.*deploy/);
});
