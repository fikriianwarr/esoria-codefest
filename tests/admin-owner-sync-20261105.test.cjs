 'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const read=x=>readFileSync(join(root,x),'utf8');
test('owner admin mapping uses exact email, existing Auth account and verified login',()=>{
 const src=read('scripts/live/sync-admin.mjs');
 for(const snippet of ['fikrianwar2000@gmail.com','auth.getUserByEmail(adminEmail)','user.emailVerified','user.disabled','admins/${user.uid}','ESORIA_ADMIN_SYNC_CONSENT','setCustomUserClaims'])
  assert.ok(src.includes(snippet),snippet);
 assert.doesNotMatch(src,/createUser\(/);
});
test('admin role is still authority from Firestore document and never open security rules',()=>{
 const cloud=read('functions/index.js');
 assert.match(cloud,/record.active !== true/);
 assert.match(read('firestore.rules'),/match \/admins\/\{uid\}/);
 assert.match(read('storage.rules'),/firestore\.get\(\/databases\/\(default\)\/documents\/admins\/\$\(request\.auth\.uid\)\)\.data\.active == true/);
 for(const f of ['firestore.rules','storage.rules'])assert.match(read(f),/allow read, write: if false/);
});
test('no invented credentials or transactions are imported into production',()=>{
 const src=read('scripts/live/START_LIVE.ps1');
 const publicApi=read('functions/competition.js');
 assert.doesNotMatch(src,/seed-production|ESORIA_LIVE_IMPORT_CONSENT|IMPORT DATA LATIHAN/);
 assert.match(publicApi,/data\.demoFixture === true/);
 assert.match(read('functions/domain.js'),/result\?\.demoFixture !== true/);
});
