'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve;const promise = new Promise(r => {resolve=r;});return {promise, resolve};};

function publicHarness(kind) {
  const work = [];
  const submit = {disabled: false};
  const fields = kind === 'results'
    ? {periodId: {value:'', dispatchEvent(){}}, package: {value:'web', selectedOptions:[{textContent:'Website Programming'}]}, wave:{value:'wave-01', selectedOptions:[{textContent:'Awal bulan'}]}}
    : {certificateId:{value:''}};
  const form = {
    elements:fields, events:{}, querySelector(){return submit;},
    addEventListener(name, cb){this.events[name]=cb;}
  };
  const panel = {innerHTML:'', events:{}, addEventListener(name, cb){this.events[name]=cb;}};
  const document = {body:{dataset:{workspace:kind}},querySelector(s) {
    return s === (kind === 'results' ? '#scope-form' : '#verify-certificate-form') ? form
      : s === (kind === 'results' ? '#public-results' : '#certificate-verdict') ? panel : null;
  }};
  const FormData = class {constructor(f){this.entries=Object.entries(f.elements).map(([key,field])=>[key,field.value]);} [Symbol.iterator](){return this.entries[Symbol.iterator]();}};
  const fetch = url => {const d=deferred();work.push({url:String(url), ...d});return d.promise;};
  vm.runInNewContext(read('public/public-records.js'), {
    document,FormData,fetch,URL,URLSearchParams,AbortController,
    setTimeout:()=>0,clearTimeout(){},Event:class{constructor(type){this.type=type;}},
    location:{origin:'https://esoria.test',search:''},console:{warn(){}},Date,Intl
  });
  const submitForm = () => form.events.submit({preventDefault(){}});
  const resolve = (idx,data) => work[idx].resolve({ok:true,json:async()=>({ok:true,data})});
  return {form,fields,panel,submit,work,submitForm,resolve};
}

test('public results changing filter cancels a pending response and unlocks Tampilkan',async()=>{
  const x=publicHarness('results');
  assert.equal(x.work.length,1,'first public archive request starts automatically');
  assert.equal(x.submit.disabled,true);
  x.fields.package.value='cyber';
  x.form.events.change();
  assert.equal(x.submit.disabled,false);
  assert.match(x.panel.innerHTML,/Filter telah berubah/);
  x.resolve(0,{published:true,rows:[{displayName:'OLD RESULTS',rank:1}]});
  await tick();await tick();
  assert.doesNotMatch(x.panel.innerHTML,/OLD RESULTS/);
  x.submitForm();
  assert.equal(x.work.length,2);
  x.resolve(1,{published:false});
  await tick();await tick();
  assert.equal(x.submit.disabled,false);
});

test('invalid scope after a request does not leave Tampilkan disabled',async()=>{
  const x=publicHarness('results');
  x.fields.periodId.value='not-a-month';
  x.submitForm();
  assert.match(x.panel.innerHTML,/Pilihan belum lengkap/);
  assert.equal(x.submit.disabled,false);
  x.resolve(0,{published:true,rows:[{displayName:'STALE',rank:1}]});
  await tick();await tick();
  assert.doesNotMatch(x.panel.innerHTML,/STALE/);
});

test('editing certificate ID invalidates a pending result before another submit',async()=>{
  const x=publicHarness('verify');
  x.fields.certificateId.value='a'.repeat(32);x.submitForm();
  assert.equal(x.submit.disabled,true);
  x.fields.certificateId.value='b'.repeat(32);x.form.events.input();
  assert.equal(x.submit.disabled,false);
  assert.match(x.panel.innerHTML,/ID sertifikat berubah/);
  x.resolve(0,{valid:true,status:'valid',recipient:'WRONG CERTIFICATE',issuedAt:1});
  await tick();await tick();
  assert.doesNotMatch(x.panel.innerHTML,/WRONG CERTIFICATE/);
});

test('invalid certificate replacement unlocks submit and blocks stale verification',async()=>{
  const x=publicHarness('verify');
  x.fields.certificateId.value='a'.repeat(32);x.submitForm();
  x.fields.certificateId.value='invalid';x.submitForm();
  assert.equal(x.submit.disabled,false);
  assert.match(x.panel.innerHTML,/ID belum valid/);
  x.resolve(0,{valid:true,status:'valid',recipient:'STALE'});
  await tick();await tick();
  assert.doesNotMatch(x.panel.innerHTML,/STALE/);
});

test('CTF answers are not returned to a different account after an asynchronous call',async()=>{
  const src=read('public/competition-client.js');
  const match=src.match(/export const submitFlag = async \(payload\) => \{[\s\S]*?\n\};/);
  assert.ok(match);
  const auth={currentUser:{uid:'member-a'}};
  const d=deferred();
  const sandbox={auth,ctfEndpoint:()=>d.promise,currentSessionKey:()=>"test-device-key"};
  vm.runInNewContext(match[0].replace('export const','const')+'\nthis.submitFlag=submitFlag;',sandbox);
  const result=sandbox.submitFlag({challengeId:'challenge'});
  auth.currentUser={uid:'member-b'};
  d.resolve({data:{accepted:true}});
  await assert.rejects(result,/Akun berubah/);
  auth.currentUser=null;
  await assert.rejects(sandbox.submitFlag({challengeId:'challenge'}),/Masuk kembali/);
});

test('post-save competition refresh runs after busy cleanup to preserve server disabled states',()=>{
  const src=read('public/competition-operations.js');
  assert.match(src,/await busy\(form, async \(\) => \{await api\('configureCompetition', payload\); saved = true;\}\);\s*if \(saved\) \{\s*try \{await load\(\);/);
  assert.doesNotMatch(src,/await api\('configureCompetition', payload\); await load\(\)/);
});

test('member draft refresh never overwrites a form changed while request was pending',async()=>{
  const src=read('public/competition-participant.js');
  const match=src.match(/document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(match);
  let listener, updated=0;
  let dirty=false;
  let saving=null;
  let conflict=false;
  const work=[];
  const sandbox={
    document:{visibilityState:'visible',addEventListener(name,cb){listener=cb;}},
    api:()=>{const d=deferred();work.push(d);return d.promise;},
    render:()=>{updated++;},reportError(error){throw error;},registrationId:'r1',dirty,saving,conflict
  };
  vm.runInNewContext(match[0], sandbox);
  listener();
  assert.equal(work.length,1);
  sandbox.dirty=true; // user began typing after request started
  work[0].resolve({submission:{revision:9}});
  await tick();await tick();
  assert.equal(updated,0,'unsaved edits must not be overwritten by the old server response');
  sandbox.dirty=false;
  listener();
  work[1].resolve({submission:{revision:10}});
  await tick();await tick();
  assert.equal(updated,1,'an unchanged form can update from the server');
});
