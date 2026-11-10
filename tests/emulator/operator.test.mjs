import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {db,stamp,projectId} from './helpers.mjs';
import {sha256} from '../../functions/domain.js';
const root=new URL('../../',import.meta.url);
const run=(script,args=[],input='')=>spawnSync(process.execPath,[script,'--project',projectId,...args],{cwd:root,env:process.env,input,encoding:'utf8'});
test('operator migration dry-run, idempotent apply and rollback guard preserve later edits',async()=>{
 const rid='operator-team-fixture';
 await db.doc(`registrations/${rid}`).set({userId:'operator-fixture-owner',package:'team',wave:'wave-01',periodId:'2099-12',proofSha256:'d'.repeat(64),amountValue:500000,status:'terverifikasi'});
 const before=(await db.doc(`registrations/${rid}`).get()).data();
 let result=run('scripts/migrate-esoria.mjs');assert.equal(result.status,0,result.stderr);assert.equal((await db.doc(`teams/${rid}`).get()).exists,false);
 result=run('scripts/migrate-esoria.mjs',['--apply','--confirm',projectId]);assert.equal(result.status,0,result.stderr);
 assert.deepEqual((await db.doc(`teams/${rid}`).get()).data().memberUids,['operator-fixture-owner']);
 result=run('scripts/migrate-esoria.mjs',['--apply','--confirm',projectId]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout.trim()).operations,0);
 await db.doc(`teams/${rid}`).update({editorUids:['later-editor']});
 result=run('scripts/migrate-esoria.mjs',['--rollback','--apply','--confirm',projectId]);assert.equal(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout.trim()).blockedByLaterChanges>=1);
 assert.deepEqual((await db.doc(`teams/${rid}`).get()).data().editorUids,['later-editor']);
 assert.deepEqual((await db.doc(`registrations/${rid}`).get()).data(),before);
});
test('CTF provisioning uses stdin, never prints flags, refuses overwrite and refuses changes after start',async()=>{
 const pid='2099-12',scope=`${pid}__cyber__wave-02`;
 await db.doc(`periods/${pid}`).set({packages:{cyber:{waves:{'wave-02':{startsAt:stamp(Date.now()+3600000),deadlineAt:stamp(Date.now()+7200000),announcementAt:stamp(Date.now()+10800000)}}}}});
 const input={periodId:pid,package:'cyber',wave:'wave-02',challenges:[{id:'operator-flag',title:'Fixture challenge',points:100,flag:'FIXTURE_SECRET_FLAG_NOT_REAL'}]};
 let result=run('scripts/provision-ctf.mjs',[],JSON.stringify(input));assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.includes(input.challenges[0].flag),false);
 assert.equal((await db.doc(`ctfSecrets/${scope}/challenges/operator-flag`).get()).exists,false);
 result=run('scripts/provision-ctf.mjs',['--apply','--confirm',projectId],JSON.stringify(input));assert.equal(result.status,0,result.stderr);
 const record=(await db.doc(`ctfSecrets/${scope}/challenges/operator-flag`).get()).data();assert.equal(record.digest.length,64);assert.equal('flag' in record,false);
 result=run('scripts/provision-ctf.mjs',['--apply','--confirm',projectId],JSON.stringify(input));assert.notEqual(result.status,0);
 await db.doc(`periods/${pid}`).update({'packages.cyber.waves.wave-02.startsAt':stamp(Date.now()-1)});
 input.challenges[0].id='late-flag';result=run('scripts/provision-ctf.mjs',['--apply','--confirm',projectId],JSON.stringify(input));assert.notEqual(result.status,0);
});
test('operator tools require an explicit project and explicit mutation confirmation',()=>{
 const result=spawnSync(process.execPath,['scripts/migrate-esoria.mjs','--apply'],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);
 assert.equal(sha256('fixture').length,64);
});
