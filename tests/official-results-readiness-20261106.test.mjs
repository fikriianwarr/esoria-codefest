import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aggregateReadiness,classifyPublicResult,classifyCertificateCandidate,validPublicScope} from '../scripts/live/official-readiness-core.mjs';

const now=Date.parse('2026-11-06T00:00:00Z');
const base={published:true,announcementAt:'2026-10-25T00:00:00Z',rows:[]};
test('real released results are public after announcement',()=>assert.equal(classifyPublicResult(base,now),'public'));
test('fixture results never become official even when published',()=>assert.equal(classifyPublicResult({...base,demoFixture:true},now),'internal'));
test('results require explicit publication and a valid announcement date',()=>{
  assert.equal(classifyPublicResult({...base,published:false},now),'unpublished');
  assert.equal(classifyPublicResult({...base,announcementAt:null},now),'missing-announcement');
  assert.equal(classifyPublicResult({...base,announcementAt:'2026-11-20T00:00:00Z'},now),'scheduled');
});
test('readiness count separates official from internal, scheduled and unpublished',()=>{
  const report=aggregateReadiness([{id:'2026-10__web__wave-01',data:{...base,periodId:'2026-10',package:'web',wave:'wave-01'}},{id:'b',data:{...base,demoFixture:true}},
    {id:'c',data:{...base,published:false}},{id:'d',data:{...base,announcementAt:'2026-12-01'}}],{now});
  assert.deepEqual({public:report.public,internal:report.internal,scheduled:report.scheduled,unpublished:report.unpublished},
    {public:1,internal:1,scheduled:1,unpublished:1});
  assert.deepEqual(report.publicScopes,['2026-10__web__wave-01']);
});
test('official archive excludes inconsistent result scope IDs',()=>{
  const data={...base,periodId:'2026-10',package:'web',wave:'wave-01'};
  assert.equal(validPublicScope({id:'2026-10__web__wave-01',data}),true);
  assert.equal(validPublicScope({id:'2026-10__cyber__wave-01',data}),false);
  const report=aggregateReadiness([{id:'not-a-real-scope',data}],{now});
  assert.equal(report.invalidScope,1);
  assert.equal(report.public,0);
});
test('certificate candidate requires verified enrollment, submission and real profile',()=>{
  const valid={result:base,row:{rank:1,certificateEligible:true,disqualified:false},
    registration:{active:true,status:'terverifikasi'},submission:{submittedAt:'2026-10-20'},profile:{legalName:'Peserta Nyata'},now};
  assert.equal(classifyCertificateCandidate(valid),'ready');
  assert.equal(classifyCertificateCandidate({...valid,result:{...base,demoFixture:true}}),'result-not-public');
  assert.equal(classifyCertificateCandidate({...valid,registration:{...valid.registration,demoFixture:true}}),'registration-not-verified');
  assert.equal(classifyCertificateCandidate({...valid,submission:{...valid.submission,demoFixture:true}}),'submission-not-finished');
  assert.equal(classifyCertificateCandidate({...valid,profile:{...valid.profile,demoFixture:true}}),'identity-not-complete');
  assert.equal(classifyCertificateCandidate({...valid,row:{rank:4,certificateEligible:true}}),'not-eligible');
});
test('audit script is read-only and never calls admin writes or enables accounts',()=>{
  const src=readFileSync(new URL('../scripts/live/audit-official-readiness.mjs',import.meta.url),'utf8');
  assert.match(src,/getFirestore/);
  assert.doesNotMatch(src,/createUser\s*\(|updateUser\s*\(|setCustomUserClaims\s*\(|\.set\s*\(|\.update\s*\(|\.delete\s*\(|\.save\s*\(/);
});
