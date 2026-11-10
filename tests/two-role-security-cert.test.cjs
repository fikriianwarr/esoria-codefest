'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const base=join(__dirname,'..');
const read=f=>readFileSync(join(base,f),'utf8');
test('only admin and member sessions resolve server-side',()=>{
  const source=read('functions/competition.js');
  const region=source.slice(source.indexOf('handlers.resolveSession ='), source.indexOf('handlers.createPaymentProofUpload'));
  assert.match(region,/kind: 'admin'/);
  assert.match(region,/kind: 'participant'/);
  assert.doesNotMatch(region,/staff\/|kind: 'staff'/);
});
test('legacy setStaffRoles action is unregistered and firestore legacy staff inaccessible',()=>{
  const api=read('functions/competition.js');
  assert.doesNotMatch(api,/handlers\.setStaffRoles\s*=/);
  for(const rule of ['firestore.rules','firestore.rules.mfa-enforced']){
    assert.match(read(rule),/match \/staff\/\{uid\} \{ allow read, write: if false; \}/);
  }
  assert.doesNotMatch(read('public/operations.html'),/id="staff-form"/);
});
test('only active admin can receive scoring task, and team conflict remains forbidden',()=>{
  const api=read('functions/competition.js');
  const start=api.indexOf('handlers.assignJudge =');
  const stop=api.indexOf('handlers.deactivateJudgeAssignment',start);
  const assign=api.slice(start,stop);
  assert.match(assign,/admin\.data\(\)\?\.active !== true/);
  assert.match(assign,/reg\.userId === judgeUid/);
  assert.match(assign,/teamDoc\.data\(\)\?\.memberUids\?\.includes\(judgeUid\)/);
  assert.doesNotMatch(assign,/staff\.data/);
});
test('admin may issue certificates only for published eligible winners, private PDF via revocation-aware API',()=>{
  const api=read('functions/competition.js');
  const issue=api.slice(api.indexOf('handlers.issueCertificate ='),api.indexOf('const certificateState ='));
  assert.match(issue,/isAdmin && \(!entry\.rank \|\| entry\.rank > 3\)/);
  assert.match(issue,/officiallyReleased\(result\.data\(\)\)/);
  assert.match(issue,/tx\.create\(db\.doc\(`certificates\/\$\{certificateId\}`\)/);
  assert.match(read('public/competition-operations.js'),/data-operation="certificate"/);
  assert.match(read('storage.rules'),/match \/certificates\/\{all=\*\*\} \{ allow read, write: if false; \}/);
});

test('production release always tests permission and certificate transitions in Firebase Emulator before deploying Rules',()=>{
  const script=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
  assert.match(script,/Tes emulator keamanan dan alur Admin\/Member \(WAJIB\)/);
  assert.ok(script.indexOf("Native 'Tes emulator keamanan")<script.indexOf("Native 'Publish Firestore Rules'"));
});
