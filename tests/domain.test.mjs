import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeHttps,weightedScore,flagDigest,sameDigest,csv,canonical,sha256,maskName,attachmentName,RUBRICS,PRIZES,scheduleFor,officiallyReleased,millis,boundedRetentionDays} from '../functions/domain.js';
import {planRegistration,canRollback} from '../scripts/migration-plan.mjs';

test('submission URL validation refuses scripts, plaintext, private hosts and embedded credentials',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,x','http://example.org','https://user:secret@example.org','https://127.0.0.1','https://2130706433','https://0x7f000001','https://10.0.0.1','https://192.168.0.1','https://[::1]','https://localhost.local'])assert.throws(()=>safeHttps(value,{required:true}),value);
 assert.equal(safeHttps('https://github.com/example/repository'), 'https://github.com/example/repository');
});
test('official rubrics total 100 and prizes preserve the source amounts',()=>{
 for(const rubric of Object.values(RUBRICS))assert.equal(rubric.criteria.reduce((sum,[,,weight])=>sum+weight,0),100);
 assert.deepEqual(PRIZES.web,[1500000,1000000,500000]);assert.deepEqual(PRIZES.cyber,[3000000,2000000,1000000]);assert.deepEqual(PRIZES.team,[6000000,4000000,2000000]);
 assert.equal(weightedScore('web',{functionality:90,responsive:80,code:70,documentation:100}),84.5);
 assert.throws(()=>weightedScore('web',{functionality:101,responsive:0,code:0,documentation:0}));
 assert.throws(()=>weightedScore('web',{functionality:'90',responsive:80,code:70,documentation:100}));
});
test('CTF flag weight comes from a server score and HMAC is scoped to challenge and period',()=>{
 const scores={flags:100,analysis:100,ethics:100,writeup:100};assert.equal(weightedScore('cyber',scores,0),60);
 const pepper='fixture-only-0000000000000000000000000';
 const digest=flagDigest(pepper,'scope-a','challenge-a','ESORIA{fixture}');
 assert.equal(sameDigest(digest,flagDigest(pepper,'scope-b','challenge-a','ESORIA{fixture}')),false);
 assert.equal(sameDigest(digest,flagDigest(pepper,'scope-a','challenge-a','ESORIA{fixture}')),true);
 assert.equal(sameDigest(digest,'bad'),false);assert.throws(()=>flagDigest('', 'scope','id','flag'));
});
test('CSV formulas and attachment filename extensions cannot trigger active content',()=>{
 assert.equal(attachmentName('../payload.html','application/pdf'),'payload.pdf');
 assert.equal(attachmentName('proof.exe','image/jpeg'),'proof.jpg');
 const output=csv([['=HYPERLINK("x")',' +CMD','normal, quoted','two\nlines']]);
 assert.ok(output.startsWith('\ufeff"\'=HYPERLINK(""x"")"'));
 assert.ok(output.includes('"\' +CMD"'));assert.ok(output.includes('"normal, quoted"'));assert.ok(output.includes('two lines'));
});
test('fingerprints are stable across object key ordering and change with field edits',()=>{
 assert.equal(sha256(canonical({b:2,a:1})),sha256(canonical({a:1,b:2})));
 assert.notEqual(sha256(canonical({a:1})),sha256(canonical({a:2})));
 assert.equal(maskName('Fikri Anwar'),'F*** A***');
});
test('category-specific server deadlines override broad wave dates',()=>{
 const period={waves:{'wave-01':{startsAt:100,closesAt:900}},packages:{web:{waves:{'wave-01':{startsAt:100,deadlineAt:300,announcementAt:400}}}}};
 assert.deepEqual(scheduleFor(period,{package:'web',wave:'wave-01'}),{startsAt:100,deadlineAt:300,announcementAt:400});
});
test('migration only adds missing workflow records, preserves fees/status and guards rollback after later edits',()=>{
 const reg={userId:'fixture-owner',periodId:'2099-01',package:'team',wave:'wave-01',amountValue:500000,status:'terverifikasi',proofSha256:'f'.repeat(64)};
 const snapshot=JSON.stringify(reg);const plan=planRegistration('fixture-reg',reg,null,null,1);
 assert.equal(plan.length,2);assert.equal(JSON.stringify(reg),snapshot);
 assert.deepEqual(plan[0].after.memberUids,['fixture-owner']);
 assert.equal(canRollback(plan[0].after,plan[0].afterHash),true);
 assert.equal(canRollback({...plan[0].after,editorUids:['new-editor']},plan[0].afterHash),false);
 assert.equal(planRegistration('fixture-reg',reg,plan[0].after,plan[1].after,2).length,0);
});

test('two-role public result, certificate, and prize release gate honors exact announcement time',()=>{
 const now=Date.parse('2026-10-19T12:00:00.000Z');
 for(const value of [undefined, null, {}, {published:true}, {published:false,announcementAt:now-1}, {published:true,announcementAt:'invalid'}]){
   assert.equal(officiallyReleased(value,now),false);
 }
 assert.equal(officiallyReleased({published:true,announcementAt:now+1},now),false);
 assert.equal(officiallyReleased({published:true,announcementAt:now},now),true);
 assert.equal(officiallyReleased({published:true,announcementAt:{seconds:now/1000}},now),true);
 assert.equal(officiallyReleased({published:true,announcementAt:{toMillis:()=>now-1}},now),true);
});

// Empty Firestore timestamp fields must never serialize to NaN in callable responses.
test('timestamp projection is JSON-safe when check-in or deadline dates are missing',()=>{
  for(const raw of [undefined,null,'','not-a-date',Number.NaN,Infinity]) assert.equal(millis(raw),null);
  assert.equal(millis({seconds:100,nanoseconds:0}),100000);
  assert.equal(millis('2026-10-20T00:00:00.000Z'),Date.UTC(2026,9,20));
  const projection={checkedInAt:millis(),schedule:scheduleFor({}, {wave:'wave-01',package:'web'})};
  assert.doesNotMatch(JSON.stringify(projection),/NaN|Infinity/);
  assert.equal(projection.checkedInAt,null);
});

test('notification retention accepts only finite, bounded day counts', () => {
  for (const value of [undefined, null, '', 'not-a-number', 'Infinity', Number.NaN])
    assert.equal(boundedRetentionDays(value), 365);
  assert.equal(boundedRetentionDays('365'), 365);
  assert.equal(boundedRetentionDays('12'), 30);
  assert.equal(boundedRetentionDays('999999999'), 3650);
  assert.equal(boundedRetentionDays('45.9'), 45);
});
