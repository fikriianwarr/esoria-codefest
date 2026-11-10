'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const source=readFileSync(join(__dirname,'..','public','public-records.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function makeHarness(){
 const work=[];
 const submit={disabled:false};
 const form={elements:{certificateId:{value:''}},events:{},querySelector(){return submit;},addEventListener(name,cb){this.events[name]=cb;}};
 const panel={innerHTML:'',events:{},addEventListener(name,cb){this.events[name]=cb;}};
 const document={body:{dataset:{workspace:'verify'}},querySelector(selector){return selector==='#verify-certificate-form'?form:selector==='#certificate-verdict'?panel:null;}};
 const fetch=(url)=>{const d=pending();work.push({url:String(url),...d});return d.promise;};
 const code=source;
 vm.runInNewContext(code,{document,fetch,URL,URLSearchParams,AbortController,setTimeout:()=>0,clearTimeout(){},location:{origin:'https://esoria.test',search:''},console:{warn(){}},Date,Intl});
 const check=(id)=>{form.elements.certificateId.value=id;form.events.submit({preventDefault(){}});};
 const respond=(n,result)=>work[n].resolve({ok:true,json:async()=>({ok:true,data:result})});
 return {work,form,panel,submit,check,respond};
}
test('older certificate response cannot replace a newer verification request',async()=>{
 const x=makeHarness();
 x.check('a'.repeat(32));x.check('b'.repeat(32));
 assert.equal(x.work.length,2);
 x.respond(1,{status:'valid',valid:true,recipient:'NEW CERTIFICATE',issuedAt:0});
 await tick();await tick();
 assert.match(x.panel.innerHTML,/NEW CERTIFICATE/);
 assert.equal(x.submit.disabled,false);
 x.respond(0,{status:'revoked',valid:false,recipient:'OLD CERTIFICATE',issuedAt:0});
 await tick();await tick();
 assert.doesNotMatch(x.panel.innerHTML,/OLD CERTIFICATE/);
 assert.match(x.panel.innerHTML,/NEW CERTIFICATE/);
});
test('invalid replacement input invalidates an older pending verification',async()=>{
 const x=makeHarness();x.check('a'.repeat(32));
 x.check('invalid');
 assert.match(x.panel.innerHTML,/ID belum valid/);
 x.respond(0,{status:'valid',valid:true,recipient:'STALE',issuedAt:0});
 await tick();await tick();
 assert.match(x.panel.innerHTML,/ID belum valid/);
 assert.doesNotMatch(x.panel.innerHTML,/STALE/);
});
