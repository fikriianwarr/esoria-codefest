'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = path.join(__dirname,'..');
const read = (name) => readFileSync(path.join(root,name),'utf8');

for (const name of ['storage.rules','storage.rules.mfa-enforced']) {
  test(`${name}: missing upload and registration documents are checked before reading fields`, () => {
    const rules = read(name);
    for (const [document,field] of [
      ['proofUploadIntents','proofIntent().ownerUid'],
      ['submissionUploads','submissionIntent().ownerUid'],
      ['registrations','paymentProofAttached == true']
    ]) {
      const check = `firestore.exists(/databases/(default)/documents/${document}/`;
      const use = rules.indexOf(field);
      assert.ok(use > 0,`Missing field ${field}`);
      assert.ok(rules.lastIndexOf(check,use) > 0,`Missing document guard before ${field}`);
    }
    assert.match(rules,/allow read, write: if false;/);
  });
}

const source = read('public/competition-client.js');
const match = source.match(/export const uploadArtifact = async \(file, registrationId\) => \{[\s\S]*?\n\};/);
assert.ok(match,'uploadArtifact must remain exported');
const makeUpload = (setMocks) => {
  const auth = {currentUser:{uid:'member-1'}};
  let writes = 0;
  let finals = 0;
  const context = {
    auth,
    storage:{},
    crypto:webcrypto,
    ref:(_storage,storagePath)=>storagePath,
    uploadBytes:async()=>{writes++;},
    api:async(action)=>{
      if (action==='createSubmissionUpload') return {storagePath:'submission-files/member-1/fixture/file.pdf',uploadId:'upload-1'};
      if (action==='finalizeSubmissionUpload') {finals++;return {ok:true};}
      throw Error(`Unexpected ${action}`);
    }
  };
  setMocks?.(context);
  vm.runInNewContext(match[0].replace(/^export const /,'const ')+'\nthis.execute=uploadArtifact;',context);
  return {execute:context.execute,auth,counts:()=>({writes,finals})};
};
const file = {type:'application/pdf',size:8,arrayBuffer:async()=>new Uint8Array([37,80,68,70,45]).buffer,name:'fixture.pdf'};

test('attachment upload completes under an unchanged member session',async()=>{
  const x=makeUpload();
  await x.execute(file,'registration-1');
  assert.equal(x.counts().writes,1);
  assert.equal(x.counts().finals,1);
});
test('attachment upload rejects a missing session before requesting an intent',async()=>{
  const x=makeUpload(); x.auth.currentUser=null;
  await assert.rejects(x.execute(file,'registration-1'),/Sesi telah berakhir/);
  assert.equal(x.counts().writes,0);
});
test('attachment upload aborts before Storage if the account changes during intent',async()=>{
  const x=makeUpload(ctx=>{
    ctx.api=async(action)=>{
      if(action==='createSubmissionUpload') {
        ctx.auth.currentUser={uid:'member-2'};
        return {storagePath:'submission-files/member-1/fixture/file.pdf',uploadId:'upload-1'};
      }
      throw Error('Unexpected finalize');
    };
  });
  await assert.rejects(x.execute(file,'registration-1'),/Akun berubah/);
  assert.equal(x.counts().writes,0);
});
test('attachment upload does not finalize if account changes while uploading',async()=>{
  const x=makeUpload(ctx=>{
    ctx.uploadBytes=async()=>{ctx.auth.currentUser={uid:'member-2'};};
  });
  await assert.rejects(x.execute(file,'registration-1'),/Akun berubah/);
  assert.equal(x.counts().finals,0);
});
test('module-loader failure shows recovery actions without bypassing protected Auth',()=>{
  const code=read('public/app-loader.js');
  assert.match(code,/Coba muat ulang/);
  assert.match(code,/Kembali ke beranda/);
  assert.match(code,/window\.location\.reload\(\)/);
  const errorHandler = code.split('const showModuleError = (error) => {')[1].split('\n  };')[0];
  assert.doesNotMatch(errorHandler,/classList\.remove\('auth-pending'\)/);
});
