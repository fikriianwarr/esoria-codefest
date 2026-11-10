'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../public/workspace.js'), 'utf8');
const protect = source.match(/const protect = async \(\) => \{[\s\S]*?\n\};/);
assert.ok(protect, 'Workspace Auth guard is present');

async function makeHarness({workspace='jury', current={uid:'admin'}, after=undefined, initial={uid:'admin',emailVerified:true}, session={kind:'admin',destination:'admin.html'}}={}) {
  const redirects = [];
  let observers = 0;
  const auth = {currentUser:current};
  const main = {inert:false};
  const elements = [
    {hidden:true,dataset:{roleNav:'operations'}},
    {hidden:true,dataset:{roleNav:'jury'}},
    {hidden:true,dataset:{}},
  ];
  const document={querySelectorAll:()=>elements,querySelector:()=>({hidden:true})};
  const context={
    auth, main, document, kind:workspace,
    window:{location:{replace:x=>redirects.push(x)}},
    location:{pathname:`/${workspace}.html`,search:''},
    waitForAuth:async()=>initial,
    verifyAndWatchDeviceSession:async()=>{},
    api:async()=>{if(after!==undefined)auth.currentUser=after;return session;},
    onAuthStateChanged:()=>{observers+=1;},
  };
  vm.runInNewContext(protect[0] + '\nthis.run=protect;',context);
  const result=await context.run();
  return {result,auth,main,redirects,elements,observers};
}

test('Admin workspace handles account switch while resolveSession is in flight without permanent spinner',async()=>{
  const x=await makeHarness({after:{uid:'member-2'}});
  assert.equal(x.result,null);
  assert.equal(x.main.inert,true);
  assert.deepEqual(x.redirects,['index.html']);
  assert.equal(x.observers,0);
});

test('Admin workspace handles logout while resolveSession is in flight',async()=>{
  const x=await makeHarness({after:null});
  assert.equal(x.result,null);
  assert.equal(x.main.inert,true);
  assert.deepEqual(x.redirects,['login.html?session=changed']);
  assert.equal(x.observers,0);
});

test('An unchanged admin session enters workflow without redirect',async()=>{
  const x=await makeHarness();
  assert.equal(x.result.session.kind,'admin');
  assert.equal(x.redirects.length,0);
  assert.equal(x.observers,1);
});

test('Member cannot use admin judging workflow even with an old staff record',async()=>{
  const x=await makeHarness({initial:{uid:'member',emailVerified:true},current:{uid:'member'},session:{kind:'participant',destination:'dashboard.html'}});
  assert.equal(x.result,null);
  assert.deepEqual(x.redirects,['dashboard.html']);
});
