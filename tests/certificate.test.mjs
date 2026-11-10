import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createCompetitionService} from '../functions/competition.js';
import {PDFDocument} from '../functions/node_modules/pdf-lib/cjs/index.js';
const certificateId=crypto.randomBytes(16).toString('hex');
const certificate={certificateId,registrationId:'fixture-reg',scope:'fixture-scope',ownerUid:'fixture-owner',recipientName:'Peserta Uji Éléonore',publicName:'P*** U*** É***',packageLabel:'Website Programming',periodLabel:'PERIODE UJI',waveLabel:'Gelombang Uji',rank:1,resultRevision:1,revoked:false};
const records={['certificates/'+certificateId]:certificate,'results/fixture-scope':{published:true,revision:1,announcementAt:Date.now()-1000,rows:[{registrationId:'fixture-reg',certificateEligible:true,disqualified:false}]}};
const db={doc:(path)=>({get:async()=>({exists:Boolean(records[path]),data:()=>records[path]})})};
const factory=(archive)=>createCompetitionService({db,requireVerified:()=>({uid:'fixture-owner'}),bucket:{file:()=>({save:archive})}});
test('certificate renderer produces a one-page PDF with the exact public verification target',async()=>{
 process.env.SITE_ORIGIN='https://example.org';
 const result=await factory(async()=>{}).handlers.downloadCertificate({data:{certificateId}});
 const pdf=await PDFDocument.load(Buffer.from(result.base64,'base64'));
 assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getPage(0).getWidth(),842);
 assert.equal(result.verificationUrl,`https://example.org/verify-certificate.html?id=${certificateId}`);
});
test('certificate download remains available after an optional archive failure',async()=>{
 process.env.SITE_ORIGIN='https://example.org';
 const result=await factory(async()=>{throw Object.assign(new Error('synthetic Storage outage'),{code:503});}).handlers.downloadCertificate({data:{certificateId}});
 assert.equal(Buffer.from(result.base64,'base64').subarray(0,5).toString(),'%PDF-');
});
