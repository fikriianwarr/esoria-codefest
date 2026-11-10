import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {certificateAction} from '../public/competition-workflow.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const reg={registrationId:'reg01',status:'terverifikasi',active:true,submission:{submitted:true}};
const current=Date.now();
const result={published:true,announcementAt:current-1000,rows:[{registrationId:'reg01',rank:1,certificateEligible:true,disqualified:false}]};
test('official certificate can be offered only for eligible winner with complete registration',()=>{
 assert.equal(certificateAction(reg,result,{now:current}).enabled,true);
 assert.equal(certificateAction({...reg,submission:{submitted:false}},result,{now:current}).enabled,false);
 assert.equal(certificateAction(reg,{...result,rows:[{registrationId:'reg01',rank:1}]},{now:current}).enabled,false);
 assert.equal(certificateAction(reg,{...result,published:false},{now:current}).enabled,false);
 assert.equal(certificateAction(reg,{...result,announcementAt:current+2000},{now:current}).enabled,false);
});
test('historical fixture never generates a production certificate',()=>{
 assert.equal(certificateAction(reg,{...result,demoFixture:true},{now:current}).enabled,false);
 assert.equal(certificateAction(reg,{...result,demoFixture:true},{now:current,isolated:true}).enabled,true);
});
test('admin certificate button never becomes enabled for synthetic results in production',()=>{
 const ops=readFileSync(join(root,'public/competition-operations.js'),'utf8');
 assert.match(ops,/certificateAction\(reg, data\.result/);
 assert.match(ops,/pdf\.base64\.startsWith\('JVBERi0'\)/);
});

test('isolated emulator PDF has a loopback verification target without weakening production HTTPS',()=>{
 const backend=readFileSync(join(root,'functions/competition.js'),'utf8');
 assert.match(backend,/inLocalEmulator = isolatedDatasetRuntime\(\)/);
 assert.match(backend,/parsed\.origin === 'http:\/\/127\.0\.0\.1:5000'/);
 assert.match(backend,/parsed\.protocol === 'https:'/);
});
