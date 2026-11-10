import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompetitionService} from '../../functions/competition.js';
import {db,Timestamp,FieldValue,stamp} from './helpers.mjs';
test('cleanup resumes expired leases and preserves a currently attached payment proof',async()=>{
 const old=Date.now()-3*86400000;
 await db.doc('submissionUploads/cleanup-lease').set({status:'purging',purgeLeaseAt:stamp(old),expiresAt:stamp(old),storagePath:'submission-files/fixture/old.pdf'});
 const current='payment-proofs/fixture/cleanup-reg/current.jpg';
 const orphan='payment-proofs/fixture/cleanup-reg/orphan.jpg';
 await db.doc('registrations/cleanup-reg').set({proofStoragePath:current,paymentProofAttached:true});
 const deleted=[];
 const files=[current,orphan].map((name)=>({name,metadata:{timeCreated:new Date(old).toISOString()},delete:async()=>deleted.push(name)}));
 const bucket={file:(name)=>({delete:async()=>deleted.push(name)}),getFiles:async()=>[files,null]};
 const service=createCompetitionService({db,bucket,Timestamp,FieldValue});
 const result=await service.purgeStaleUploads();
 assert.equal(result.purged,1);assert.equal(result.orphanProofs,1);
 assert.equal(deleted.includes(current),false);assert.equal(deleted.includes(orphan),true);
 assert.equal((await db.doc('submissionUploads/cleanup-lease').get()).data().status,'purged');
});
