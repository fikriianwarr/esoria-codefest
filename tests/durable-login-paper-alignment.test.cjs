const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');

const sessionHarness = (fail=false) => {
  const source=read('public/auth-pages.js');
  const start=source.indexOf('let durablePersistenceReady = false;');
  const end=source.indexOf('const params = new URLSearchParams',start);
  assert.ok(start>0&&end>start);
  let calls=0;
  const sandbox={auth:{},browserLocalPersistence:{kind:'LOCAL'},setPersistence:async (_auth,mode)=>{
    calls++; assert.equal(mode.kind,'LOCAL'); if(fail) throw new Error('blocked');
  },Error};
  vm.runInNewContext(source.slice(start,end)+'\nthis.run = ensureDurableSession;',sandbox);
  return {run:sandbox.run,calls:()=>calls};
};
test('Explicit local Firebase Auth persistence is awaited and initialized once',async()=>{
  const h=sessionHarness();
  await h.run(); await h.run();
  assert.equal(h.calls(),1);
  const login=read('public/auth-pages.js');
  assert.match(login,/await ensureDurableSession\(\);\s*if \(pageMode === 'signup'\)/);
  assert.match(login,/await ensureDurableSession\(\);\s*const provider = new GoogleAuthProvider/);
  assert.doesNotMatch(read('public/firebase-config.js'),/\bsetPersistence\s*\(/);
});
test('Blocked persistence fails explicitly and does not silently sign in memory-only',async()=>{
  const h=sessionHarness(true);
  await assert.rejects(h.run(),/Browser tidak mengizinkan penyimpanan sesi akun/);
});
test('Idle admin guard does not silently sign out an unfocused browser window',()=>{
  const guard=read('public/admin-idle-guard.js');
  assert.match(guard,/document.hidden \|\| \(typeof document.hasFocus/);
  assert.match(guard,/25 \* 60_000/);
  assert.match(guard,/await signOut\(auth\)/);
});
test('Compact admin and scope forms share canonical CSS files, no extra duplicate layer',()=>{
  const admin=read('public/admin-workflow-compact.css');
  const controls=read('public/paper-mobile-controls.css');
  assert.match(admin,/min-height:74px/);
  assert.match(controls,/height:46px;min-height:46px;max-height:46px/);
  for (const page of ['admin.html','operations.html','jury.html','results.html']){
    assert.doesNotMatch(read('public/'+page),/admin-flow-alignment\.css/);
  }
});
