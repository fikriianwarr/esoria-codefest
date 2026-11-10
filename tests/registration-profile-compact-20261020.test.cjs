'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');
const read = (name) => readFileSync(join(root, 'public', name), 'utf8');
const authSource = read('auth-core.js').replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\s*$/gm, '')
  .replace(/\bexport (const|function|async function)\b/g, '$1');

function harness({ admin = false, existing = true } = {}) {
  const user = {uid:'uid-123',email:'user@mail.com',emailVerified:true};
  const writes=[]; const reads=[]; const redirects=[];
  const context = {
    auth: {currentUser:user}, db:{}, functions:{}, runtimeConfig: {appCheckSiteKey:''},
    httpsCallable:() => async ({action}) => {writes.push(action); return {data:{profile:{id:user.uid,role:'participant',profileComplete:false}}};},
    doc:(_db,collection,id) => ({collection,id}),
    getDocFromServer: async (ref) => {
      reads.push(ref.collection);
      if (ref.collection === 'admins') return {exists:()=>admin,data:()=>({active:admin})};
      if (ref.collection === 'users') return {exists:()=>existing,data:()=>({role:'participant',profileComplete:true,archived:false})};
      throw Error('Unexpected read');
    },
    onAuthStateChanged:(_auth,callback)=>{queueMicrotask(()=>callback(user));return ()=>{};},
    calculateAgeInWib:()=>null, signOut:async()=>{}, verifyAndWatchDeviceSession: async()=>{}, currentSessionKey:()=>"fixture-key",
    window: { location:{pathname:'/profil.html',search:'',hash:'',replace:(path)=>redirects.push(path)} },
    document: {body:{classList:{remove(){},add(){}}}},
    URLSearchParams, CustomEvent, console, Promise
  };
  context.getDoc = context.getDocFromServer;
  vm.runInNewContext(authSource + '\nthis.requireAuthenticated=requireAuthenticated;',context);
  return {context,reads,writes,redirects};
}

test('profile refresh reads existing document without rewriting it through Cloud Functions',async()=>{
  const h=harness();
  const result=await h.context.requireAuthenticated({verifiedEmailRequired:true,profileReadOptimized:true});
  assert.deepEqual(h.reads.sort(),['admins','users']);
  assert.deepEqual(h.writes,[]);
  assert.equal(result.profile.profileComplete,true);
});

test('profile refresh still initializes missing accounts on the verified backend',async()=>{
  const h=harness({existing:false});
  const result=await h.context.requireAuthenticated({verifiedEmailRequired:true,profileReadOptimized:true});
  assert.deepEqual(h.writes,['ensureUserProfile']);
  assert.equal(result.profile.role,'participant');
});

test('admin redirects before participant profile can become ready',async()=>{
  const h=harness({admin:true});
  void h.context.requireAuthenticated({verifiedEmailRequired:true,profileReadOptimized:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.redirects,['admin.html']);
  assert.deepEqual(h.writes,[]);
});

test('paper upload stays compact and bank blur toggle remains functional',()=>{
  const html=read('form-pendaftaran.html');
  const css=read('payment-institution-paper.css');
  const js=read('registration.js');
  assert.match(html,/data-proof-dropzone/);
  assert.match(html,/data-sensitive-toggle="payment"/);
  assert.match(css,/\.payment-proof-prompt\{min-height:76px!important/);
  assert.match(css,/\.payment-proof-upload\{min-height:0!important/);
  assert.match(js,/syncSensitiveGroup\(group, !isHidden\)/);
});
