'use strict';
// An earlier Firebase role lookup must not downgrade a newer verified session.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../public/site-auth.js'),'utf8')
  .replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\s*$/gm,'');
test('stale denied role read cannot change the navbar after a newer admin session is verified', async()=>{
  let authObserver;
  let rejectOld, resolveNew;
  const oldLookup=new Promise((_,reject)=>{rejectOld=reject;});
  const newLookup=new Promise(resolve=>{resolveNew=resolve;});
  const state={dataset:{registrationState:'closed'}};
  const auth={currentUser:{uid:'older',emailVerified:true}};
  const mocks={
    document:{body:{dataset:{root:'.'}},documentElement:state,querySelectorAll:()=>[],querySelector:()=>null},
    window:{addEventListener(){}},
    auth,
    onAuthStateChanged:(_,fn)=>{authObserver=fn;},
    verifyAndWatchDeviceSession:async()=>{},
    isAdminUser:u=>u.uid==='older'?oldLookup:newLookup,
    getStaffDestination:async()=>null,
    console:{warn(){}},
  };
  vm.runInNewContext(source,mocks);
  assert.equal(typeof authObserver,'function');
  authObserver({uid:'older',emailVerified:true});
  auth.currentUser={uid:'new-admin',emailVerified:true};
  authObserver(auth.currentUser);
  resolveNew(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.dataset.authState,'signed-in');
  rejectOld(new Error('stale permission denied'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.dataset.authState,'signed-in');
});
