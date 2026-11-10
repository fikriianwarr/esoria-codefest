'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {webcrypto, createHash} = require('node:crypto');
const vm = require('node:vm');
const source = readFileSync(join(__dirname,'../public/single-device-session.js'),'utf8')
  .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm,'')
  .replaceAll('export const ','const ');

const hash = (v)=>createHash('sha256').update(v).digest('hex');
function setup(authTime=2000,sessionDoc={}) {
 const calls=[];const storage=new Map();const listeners=[];const redirects=[];
 const user={uid:'participant-fixture',getIdTokenResult:async()=>({claims:{auth_time:authTime}})};
 const auth={currentUser:user};
 const serverRef={data:()=>sessionDoc};
 const endpoint=async ({action,payload})=>{
   calls.push({action,payload});
   if(action==='activateDeviceSession') {
     const digest=hash(payload.sessionKey);
     if(sessionDoc.authTime && (authTime<sessionDoc.authTime || authTime===sessionDoc.authTime && digest!==sessionDoc.sessionHash)) {
       const e=new Error('Sesi perangkat lain aktif');e.code='functions/failed-precondition';throw e;
     }
     Object.assign(sessionDoc,{authTime,sessionHash:digest});return {data:{active:true}};
   }
   if(action==='checkDeviceSession') {
     if(authTime!==sessionDoc.authTime || hash(payload.sessionKey)!==sessionDoc.sessionHash){const e=new Error('replaced');e.code='functions/permission-denied';throw e;}
     return {data:{active:true}};
   }
   throw Error('Unexpected action '+action);
 };
 const context={auth,db:{},functions:{},runtimeConfig:{appCheckSiteKey:''},
   httpsCallable:()=>endpoint,
   localStorage:{getItem:(key)=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
   crypto:webcrypto,Uint8Array,TextEncoder,Number,Promise,Map,String,Array,
   document:{hidden:false,addEventListener:(event,callback)=>listeners.push({event,callback})},
   location:{replace:(path)=>redirects.push(path)},
   getDocFromServer:async()=>({exists:()=>Boolean(sessionDoc.authTime),data:()=>sessionDoc}),
   doc:(_db,...parts)=>parts.join('/'),
   onSnapshot:(_ref,fn)=>{listeners.push({event:'snapshot',callback:fn});return ()=>{};},
   signOut:async()=>{auth.currentUser=null},console:{warn(){}},
 };
 vm.runInNewContext(source+`\nthis.actions={activateDeviceSession,ensureDeviceSession,verifyAndWatchDeviceSession};`,context);
 return {context,user,auth,serverRef,sessionDoc,calls,listeners,redirects};
}

test('Browser creates stable random binder and does not register again on refresh', async()=>{
 const x=setup();
 await x.context.actions.activateDeviceSession(x.user);
 const first=x.calls[0].payload.sessionKey;
 assert.match(first,/^[0-9a-f]{64}$/);
 await x.context.actions.ensureDeviceSession(x.user);
 assert.deepEqual(x.calls.map(c=>c.action),['activateDeviceSession','checkDeviceSession']);
 assert.equal(x.calls[1].payload.sessionKey,first);
});

test('new login from another device replaces old session, prompting old device sign-out',async()=>{
 const shared={};
 const a=setup(1000,shared);await a.context.actions.verifyAndWatchDeviceSession(a.user);
 const b=setup(1001,shared);await b.context.actions.activateDeviceSession(b.user);
 const snapshotListener=a.listeners.find(l=>l.event==='snapshot');
 assert.ok(snapshotListener);
 snapshotListener.callback({exists:()=>true,data:()=>shared,metadata:{fromCache:false}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(a.auth.currentUser,null);
 assert.deepEqual(a.redirects,['/login.html?reason=other-device']);
 assert.equal(b.auth.currentUser,b.user);
});

test('same-second competing sign-in cannot replace old device without matching binder',async()=>{
 const shared={};
 const a=setup(1000,shared);await a.context.actions.activateDeviceSession(a.user);
 const b=setup(1000,shared);
 await assert.rejects(b.context.actions.activateDeviceSession(b.user), /Sesi perangkat lain aktif/);
 assert.equal(shared.sessionHash,hash(a.calls[0].payload.sessionKey));
});

test('initial cached snapshot does not trigger false logout for current device',async()=>{
 const x=setup();await x.context.actions.verifyAndWatchDeviceSession(x.user);
 const snapshotListener=x.listeners.find(l=>l.event==='snapshot');
 snapshotListener.callback({exists:()=>true,data:()=>({sessionHash:'stale',authTime:1}),metadata:{fromCache:true}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.auth.currentUser,x.user);
 assert.equal(x.redirects.length,0);
});
