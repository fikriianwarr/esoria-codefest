import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {db, bucket, account, call, rejected, seedPeriod, seedRegistration, registrationId, periodId, scope, scopeId, webPayload, stamp, sharp} from './helpers.mjs';
import {flagDigest, sha256} from '../../functions/domain.js';
const admin = await account('flow_admin', 'admin');
const payment = await account('flow_payment', 'payment');
const committee = await account('flow_committee', 'committee');
const judge = await account('flow_judge', 'judge');
const user = await account('flow_participant');
const other = await account('flow_other');
const member = await account('flow_member');
const cyber = await account('flow_cyber');
await seedPeriod();
const rid = await seedRegistration(user);
const cyberId = await seedRegistration(cyber, 'cyber');
let workRevision = 0;
let certificateId;
let prepared;
let paymentRegistration;
const requestId = () => crypto.randomUUID();

async function proof(user, registrationId, bytes) {
  const digest = sha256(bytes);
  const intent=await call(user,'createPaymentProofUpload',{registrationId,sizeBytes:bytes.length,sha256:digest});
  const storagePath=intent.storagePath;
  await bucket.file(storagePath).save(bytes,{contentType:'image/jpeg',resumable:false,metadata:{metadata:{ownerUid:user.uid,registrationId,sha256:digest,uploadId:intent.uploadId}}});
  return {storagePath,sha256:digest,sizeBytes:bytes.length,width:800,height:600,fileName:'fixture-transfer.jpg'};
}

test('Emulator: superseded browser binder is rejected before private API access', async () => {
  const actor = await account('flow_revoked_device');
  const record = db.doc(`accountSessions/${actor.uid}`);
  assert.equal((await call(actor, 'resolveSession')).destination, 'dashboard.html');
  const saved = (await record.get()).data();
  try {
    await record.update({sessionHash: '0'.repeat(64)});
    await rejected(call(actor, 'resolveSession'), 'permission-denied');
  } finally {
    await record.update({sessionHash: saved.sessionHash});
  }
  assert.equal((await call(actor, 'resolveSession')).destination, 'dashboard.html');
});

test('callable workflow in isolated Auth/Firestore/Storage/Functions emulators', async (t) => {
  await t.test('authentication and role boundaries reject unauthenticated/participant operations', async () => {
    await rejected(call(null,'saveRegistrationDraft',{draft:{},expectedRevision:0}),'unauthenticated');
    await rejected(call(user,'getOperationsWorkspace',scope()),'permission-denied');
    await rejected(call(payment,'savePeriod',{}),'permission-denied');
    await rejected(call(judge,'getPaymentEvidence',{registrationId:rid}),'permission-denied');
    assert.equal((await call(payment,'resolveSession')).destination,'dashboard.html');
    assert.equal((await call(judge,'resolveSession')).destination,'dashboard.html');
    await rejected(call(committee,'getJuryWorkspace'), 'permission-denied');
  });
  await t.test('new member can check own missing registration securely; admin cannot preflight member flow', async () => {
    // A new registration has no resource.data.userId and is deliberately not
    // readable via client Firestore Rules. The API must resolve ownership itself.
    const absent = await call(other, 'getOwnRegistrationStatus', {periodId, package:'cyber', wave:'wave-02'});
    assert.equal(absent.exists, false);
    const existing = await call(user, 'getOwnRegistrationStatus', {periodId, package:'web', wave:'wave-01'});
    assert.equal(existing.exists, true);
    assert.ok(existing.registrationId.includes(user.uid));
    assert.ok(existing.referenceNumber);
    await rejected(call(admin, 'getOwnRegistrationStatus', {periodId, package:'web', wave:'wave-01'}), 'permission-denied');
    await rejected(call(null, 'getOwnRegistrationStatus', {periodId, package:'web', wave:'wave-01'}), 'unauthenticated');
    await rejected(call(other, 'getOwnRegistrationStatus', {periodId, package:'web', wave:'unknown'}), 'invalid-argument');
  });
  await t.test('archived enrollment cannot be misreported as an active successful registration', async () => {
    const archivedUser = await account('flow_archived_lookup');
    const archivedId = await seedRegistration(archivedUser);
    await db.doc(`registrations/${archivedId}`).update({active:false,submissionId:'historic-entry'});
    const lookup = await call(archivedUser, 'getOwnRegistrationStatus', {periodId,package:'web',wave:'wave-01'});
    assert.equal(lookup.exists,true);
    assert.equal(lookup.active,false);
  });
  await t.test('check-in retry does not duplicate audit, notification or revision', async () => {
    const checkinMember = await account('flow_checkin_retry');
    const checkinId = await seedRegistration(checkinMember);
    const fixture = (await db.doc(`registrations/${checkinId}`).get()).data();
    assert.equal(fixture.ticketNumber, fixture.referenceNumber, 'ACC fixture must use its canonical server reference');
    const payload = {registrationId:checkinId,checkedIn:true};
    assert.deepEqual(await call(admin,'checkInRegistration',payload),{ok:true,checkedIn:true,unchanged:false});
    assert.deepEqual(await call(admin,'checkInRegistration',payload),{ok:true,checkedIn:true,unchanged:true});
    const updated = (await db.doc(`registrations/${checkinId}`).get()).data();
    assert.equal(updated.checkedIn,true);
    assert.equal(updated.checkInRevision,1);
    assert.equal((await db.doc(`auditLogs/registration_checkin_${checkinId}_1`).get()).exists,true);
    assert.equal((await db.doc(`auditLogs/registration_checkin_${checkinId}_2`).get()).exists,false);
    await rejected(call(admin,'checkInRegistration',{registrationId:checkinId,checkedIn:'true'}),'invalid-argument');
  });
  await t.test('drafts remain owner-scoped, validate revision and never allocate quota', async () => {
    const draft = await call(user,'saveRegistrationDraft',{expectedRevision:0,draft:{package:'web',skillStack:'HTML',userId:other.uid,proof:{secret:'never store'}}});
    assert.equal(draft.revision,1);
    assert.equal((await call(other,'getRegistrationDraft')).draft,null);
    const stored=(await db.doc(`registrationDrafts/${user.uid}`).get()).data();
    assert.equal(stored.userId,user.uid);
    assert.equal('proof' in stored.draft,false);
    await rejected(call(user,'saveRegistrationDraft',{expectedRevision:0,draft:{}}),'aborted');
  });
  await t.test('last registration slot is allocated transactionally under concurrent requests', async () => {
    const now=Date.now(), pid='2099-02';
    const packages={web:{enabled:true,waves:{'wave-01':{enabled:true,startsAt:stamp(now+7200000),deadlineAt:stamp(now+10800000),announcementAt:stamp(now+14400000),registrationOpenAt:stamp(now-3600000),registrationCloseAt:stamp(now+3600000)}}}};
    await db.doc(`periods/${pid}`).set({status:'open',label:'REGISTRATION FIXTURE',registrationOpenAt:stamp(now-3600000),registrationCloseAt:stamp(now+3600000),packages,waves:{}});
    await db.doc('system/registration').set({openPeriodId:pid,acceptingRegistrations:true});
    await db.doc(`periodSlots/${pid}__web__wave-01`).set({enabled:true,capacity:1,count:0,sequence:0});
    const bytes=await sharp({create:{width:800,height:600,channels:3,background:'#eae3d0'}}).jpeg().toBuffer();
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const attempts=await Promise.allSettled([user,other].map(async (actor)=>{
      const id=`${pid}__${actor.uid}__web__wave-01`;
      const proofData=await proof(actor,id,bytes);
      return {actor, id, proofData, result:await call(actor,'submitRegistration',{periodId:pid,package:'web',wave:'wave-01',submissionId:requestId(),skillStack:'HTML CSS JS',transferDate:today,senderName:'PENGIRIM UJI',senderInstitution:'BANK FIXTURE',proof:proofData})};
    }));
    assert.equal(attempts.filter((item)=>item.status==='fulfilled').length,1);
    assert.equal(attempts.find((item)=>item.status==='rejected').reason.code,'resource-exhausted');
    assert.equal((await db.doc(`periodSlots/${pid}__web__wave-01`).get()).data().count,1);
    paymentRegistration=attempts.find((item)=>item.status==='fulfilled').value;
  });
  await t.test('manual approval requires confirmed bank statement, ticket, note and current review revision', async () => {
    const payload={registrationId:paymentRegistration.id,status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:'EMULATOR-TICKET-001',adminNotes:'Dana masuk fixture sudah diperiksa terpisah.',expectedReviewRevision:0};
    await rejected(call(admin,'reviewPayment',payload),'failed-precondition');
    const concurrent=await Promise.allSettled([call(admin,'reviewPayment',{...payload,bankTransferConfirmed:true}),call(admin,'reviewPayment',{...payload,bankTransferConfirmed:true})]);
    assert.equal(concurrent.filter((item)=>item.status==='fulfilled').length,1);
    assert.equal(concurrent.find((item)=>item.status==='rejected').reason.code,'aborted');
    const reg=(await db.doc(`registrations/${paymentRegistration.id}`).get()).data();
    assert.equal(reg.bankTransferConfirmed,true);
    assert.equal(reg.status,'terverifikasi');
    await rejected(call(paymentRegistration.actor,'createPaymentProofUpload',{registrationId:paymentRegistration.id,sizeBytes:10,sha256:'a'.repeat(64)}),'failed-precondition');
    const limited=await call(admin,'getOperationsWorkspace',{periodId:'2099-02',package:'web',wave:'wave-01'});
    assert.equal('submission' in limited.items[0],true);
    const image=await call(admin,'getPaymentEvidence',{registrationId:paymentRegistration.id});
    assert.ok(Buffer.from(image.base64,'base64').length>0);
  });
  await t.test('proof replacement rejects fake JPEG bytes and reopens rejected status without deleting a current object on failure', async () => {
    const bytes=Buffer.from([255,216,1,2,3,255,217]);
    await db.doc(`registrations/${rid}`).update({status:'ditolak',paymentStatus:'bermasalah',proofSha256:'f'.repeat(64),rejectionReason:'Bukti fixture tidak terbaca'});
    const fake=await proof(user,rid,bytes);
    await rejected(call(user,'replacePaymentProof',{registrationId:rid,expectedProofSha256:'f'.repeat(64),proof:fake}),'invalid-argument');
    assert.equal((await bucket.file(fake.storagePath).exists())[0],true);
    const valid=await proof(user,rid,await sharp({create:{width:800,height:600,channels:3,background:'#aabbcc'}}).jpeg().toBuffer());
    await call(user,'replacePaymentProof',{registrationId:rid,expectedProofSha256:'f'.repeat(64),proof:valid});
    const reg=(await db.doc(`registrations/${rid}`).get()).data();
    assert.equal(reg.status,'menunggu');assert.equal(reg.paymentProofAttached,true);assert.equal(reg.paymentStatus,'belum_diperiksa');
    await call(admin,'reviewPayment',{registrationId:rid,status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:'FLOW-SUBMISSION-001',adminNotes:'Mutasi fixture diperiksa oleh petugas.',bankTransferConfirmed:true,expectedReviewRevision:reg.reviewRevision||0});
  });
  await t.test('submission enforces ownership, public HTTPS URL, time, revision and idempotent retry', async () => {
    await rejected(call(other,'getCompetitionContext',{registrationId:rid}),'permission-denied');
    await rejected(call(user,'saveSubmission',{registrationId:rid,expectedRevision:0,requestId:requestId(),payload:webPayload({liveUrl:'javascript:alert(1)'})}),'invalid-argument');
    const key=requestId();
    const payload={registrationId:rid,expectedRevision:0,requestId:key,final:true,payload:webPayload()};
    const saved=await call(user,'saveSubmission',payload);workRevision=saved.revision;
    assert.equal(saved.status,'submitted');
    assert.equal((await call(user,'saveSubmission',payload)).duplicate,true);
    await rejected(call(user,'saveSubmission',{...payload,requestId:requestId()}),'aborted');
    const race=await Promise.allSettled([1,2].map((number)=>call(user,'saveSubmission',{...payload,requestId:requestId(),expectedRevision:workRevision,payload:webPayload({title:`Concurrent edit ${number}`})})));
    assert.equal(race.filter((item)=>item.status==='fulfilled').length,1);
    assert.equal(race.find((item)=>item.status==='rejected').reason.code,'aborted');
    workRevision=(await db.doc(`submissions/${rid}`).get()).data().revision;
  });
  await t.test('file intents validate actual PDF bytes before an artifact can be attached', async () => {
    const bytes=Buffer.from('not a pdf at all');
    const hash=sha256(bytes);
    const intent=await call(user,'createSubmissionUpload',{registrationId:rid,fileName:'invalid.pdf',mimeType:'application/pdf',sizeBytes:bytes.length,sha256:hash});
    await bucket.file(intent.storagePath).save(bytes,{contentType:'application/pdf',resumable:false,metadata:{metadata:{ownerUid:user.uid,sha256:hash}}});
    await rejected(call(user,'finalizeSubmissionUpload',{uploadId:intent.uploadId}),'invalid-argument');
    await rejected(call(user,'saveSubmission',{registrationId:rid,expectedRevision:workRevision,requestId:requestId(),payload:webPayload(),artifactIds:[intent.uploadId]}),'invalid-argument');
  });
  await t.test('team membership matches verified email; editor cannot finalize or edit a leader final', async () => {
    const teamId=await seedRegistration(other,'team');
    await db.doc(`registrations/${teamId}`).update({memberCount:2,teamName:'Tim Fixture',teamMembers:[{name:'Ketua',email:other.email,consent:true},{name:'Anggota',email:member.email,consent:true}]});
    await rejected(call(user,'joinTeam',{registrationId:teamId}),'permission-denied');
    await call(member,'joinTeam',{registrationId:teamId});
    const memberContext = await call(member,'getCompetitionContext',{registrationId:teamId});
    assert.deepEqual(memberContext.team.members, [
      {uid:other.uid,name:`Peserta ${other.uid}`,role:'leader'},
      {uid:member.uid,name:`Peserta ${member.uid}`,role:'member'}
    ]);
    assert.equal(memberContext.registration.teamName,'Tim Fixture');
    assert.equal(memberContext.team.members.some((entry)=>'email' in entry || 'phone' in entry),false);
    await call(other,'setTeamEditor',{registrationId:teamId,memberUid:member.uid,enabled:true});
    const payload=webPayload({backendRepositoryUrl:'https://github.com/example/backend',presentationUrl:'https://example.org/pitch',documentationUrl:'https://example.org/architecture'});
    await call(member,'saveSubmission',{registrationId:teamId,expectedRevision:0,requestId:requestId(),payload});
    await rejected(call(member,'saveSubmission',{registrationId:teamId,expectedRevision:1,requestId:requestId(),payload,final:true}),'permission-denied');
    await call(other,'saveSubmission',{registrationId:teamId,expectedRevision:1,requestId:requestId(),payload,final:true});
    await rejected(call(member,'saveSubmission',{registrationId:teamId,expectedRevision:2,requestId:requestId(),payload}),'permission-denied');
    assert.ok((await call(member,'getParticipantWorkspace')).registrations.some((entry)=>entry.registrationId===teamId));
  });
  await t.test('CTF uses secret HMAC and 10-attempt limit; only score receipts are persisted', async () => {
    const ctfScope=scopeId('cyber');
    const pepper='emulator-only-esoria-pepper-00000000000000';
    const flag='ESORIA{emulator_fixture_only}';
    await db.doc(`ctfSecrets/${ctfScope}/challenges/test-flag`).set({title:'Challenge Fixture',active:true,points:100,digest:flagDigest(pepper,ctfScope,'test-flag',flag),revision:1});
    await db.doc(`ctfSecrets/${ctfScope}/challenges/limit-flag`).set({title:'Rate Fixture',active:true,points:100,digest:flagDigest(pepper,ctfScope,'limit-flag','FIXTURE'),revision:1});
    assert.equal((await call(cyber,null,{registrationId:cyberId,challengeId:'test-flag',flag},true)).accepted,true);
    assert.equal((await call(cyber,null,{registrationId:cyberId,challengeId:'test-flag',flag},true)).alreadySolved,true);
    const receipt=(await db.doc(`flagSolves/${cyberId}/challenges/test-flag`).get()).data();
    assert.equal(JSON.stringify(receipt).includes(flag),false);
    for(let n=0;n<9;n++) assert.equal((await call(cyber,null,{registrationId:cyberId,challengeId:'limit-flag',flag:'WRONG'},true)).accepted,false);
    await rejected(call(cyber,null,{registrationId:cyberId,challengeId:'limit-flag',flag:'WRONG'},true),'resource-exhausted');
    const publicContext=await call(cyber,'getCompetitionContext',{registrationId:cyberId});
    assert.equal(JSON.stringify(publicContext).includes('digest'),false);
    assert.equal(JSON.stringify(publicContext).includes(flag),false);
  });
  await t.test('before deadline judging is unavailable and certificates/results remain gated', async () => {
    await rejected(call(admin,'assignJudge',{registrationId:rid,judgeUid:admin.uid}),'failed-precondition');
    await rejected(call(user,'issueCertificate',{registrationId:rid}),'failed-precondition');
    assert.equal((await call(null,'getPublishedResults',scope())).published,false);
    await seedPeriod({deadline:Date.now()-1000,announcement:Date.now()+3600000});
    await rejected(call(user,'saveSubmission',{registrationId:rid,expectedRevision:workRevision,requestId:requestId(),payload:webPayload()}),'failed-precondition');
  });
  await t.test('assigned juror finalization enforces official rubric and cannot be rewritten', async () => {
    await call(admin,'assignJudge',{registrationId:rid,judgeUid:admin.uid});
    const grades={functionality:90,responsive:80,code:70,documentation:100};
    await call(admin,'saveJuryGrade',{registrationId:rid,expectedRevision:0,scores:grades,comment:'Komentar penilaian fixture sesuai rubrik.',finalize:true});
    const workspace=await call(admin,'getJuryWorkspace');
    assert.equal(workspace.assignments[0].grade.total,84.5);
    await rejected(call(admin,'saveJuryGrade',{registrationId:rid,expectedRevision:1,scores:grades,comment:'Komentar perubahan fixture.',finalize:true}),'failed-precondition');
    await rejected(call(payment,'getJuryWorkspace'),'permission-denied');
    await call(admin,'reopenJuryGrade',{registrationId:rid,judgeUid:admin.uid,reason:'Koreksi administratif fixture oleh panitia.'});
    await call(admin,'saveJuryGrade',{registrationId:rid,expectedRevision:2,scores:grades,comment:'Koreksi selesai, nilai sesuai rubrik.',finalize:true});
  });
  await t.test('publication requires approved policy, complete final grades and official announcement time', async () => {
    await rejected(call(admin,'prepareResults',scope()),'failed-precondition');
    await call(admin,'configureCompetition',{...scope(),requiredJudgeCount:1,appealDeadlineAt:new Date(Date.now()+86400000).toISOString(),reason:'Keputusan panitia fixture dalam emulator.',expectedRevision:0});

    // An erroneously early "published" flag must not allow clarification
    // before the exact official announcement time.
    await db.doc(`results/${scopeId()}`).set({published:true,revision:1,announcementAt:stamp(Date.now()+3600000),rows:[{registrationId:rid}]});
    await rejected(call(user,'submitAppeal',{registrationId:rid,message:'Klarifikasi sebelum pengumuman harus ditolak walaupun record bertanda published.'}),'failed-precondition');
    await db.doc(`results/${scopeId()}`).delete();
    prepared=await call(admin,'prepareResults',scope());
    await rejected(call(admin,'publishResults',{...scope(),draftId:prepared.draftId,expectedRevision:prepared.expectedRevision,reason:'Hasil sudah diperiksa oleh panitia fixture.'}),'failed-precondition');
    await seedPeriod({deadline:Date.now()-2000,announcement:Date.now()-1000});
    await rejected(call(admin,'publishResults',{...scope(),draftId:prepared.draftId,expectedRevision:prepared.expectedRevision,reason:'Pratinjau lama harus ditolak oleh fingerprint.'}),'aborted');
    prepared=await call(admin,'prepareResults',scope());
    await call(admin,'publishResults',{...scope(),draftId:prepared.draftId,expectedRevision:prepared.expectedRevision,reason:'Hasil telah diperiksa dan disahkan dalam emulator.'});
    const published=await call(null,'getPublishedResults',scope());
    assert.equal(published.published,true);assert.equal(published.rows[0].total,84.5);
    assert.equal(JSON.stringify(published).includes(user.uid),false);
    assert.equal('registrationId' in published.rows[0],false);
  });
  await t.test('certificate PDF is issued only for eligible owner, verifies publicly and supports revocation', async () => {
    const issued=await call(user,'issueCertificate',{registrationId:rid});certificateId=issued.certificateId;
    assert.match(certificateId,/^[a-f0-9]{32}$/);
    assert.equal((await call(user,'issueCertificate',{registrationId:rid})).certificateId,certificateId);
    assert.equal((await call(admin,'issueCertificate',{registrationId:rid})).certificateId,certificateId);
    const verified=await call(null,'verifyCertificate',{certificateId});
    assert.equal(verified.valid,true);assert.equal(verified.recipient.includes('***'),true);assert.equal('ownerUid' in verified,false);
    const pdf=await call(user,'downloadCertificate',{certificateId});
    assert.equal((await call(admin,'downloadCertificate',{certificateId})).mimeType,'application/pdf');
    assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,5).toString(),'%PDF-');
    assert.equal(pdf.verificationUrl,`https://example.org/verify-certificate.html?id=${certificateId}`);
    await rejected(call(other,'downloadCertificate',{certificateId}),'permission-denied');
    await call(admin,'revokeCertificate',{certificateId,reason:'Sertifikat fixture dicabut untuk menguji verifikasi.'});
    assert.equal((await call(null,'verifyCertificate',{certificateId})).status,'revoked');
    await rejected(call(user,'downloadCertificate',{certificateId}),'failed-precondition');
  });
  await t.test('manual winner prize uses official amount, cannot auto-pay and cannot double-record', async () => {
    const payload={registrationId:rid,reference:'EMULATOR-PRIZE-ONLY',note:'Transfer hadiah fixture diperiksa terpisah.'};
    await rejected(call(admin,'recordPrizePayment',payload),'invalid-argument');
    await rejected(call(payment,'recordPrizePayment',{...payload,bankTransferConfirmed:true}),'permission-denied');
    await call(admin,'recordPrizePayment',{...payload,bankTransferConfirmed:true});
    assert.equal((await db.doc(`prizePayments/${rid}`).get()).data().amountValue,1500000);
    await rejected(call(admin,'recordPrizePayment',{...payload,bankTransferConfirmed:true}),'already-exists');
  });
  await t.test('appeal ownership, audit, withdrawal and access revocation remain effective', async () => {
    await call(user,'submitAppeal',{registrationId:rid,message:'Permintaan klarifikasi administratif fixture untuk memeriksa dokumen.'});
    await call(admin,'resolveAppeal',{registrationId:rid,expectedRevision:1,response:'Panitia sudah memeriksa dokumen fixture dan memberikan jawaban resmi.'});
    await rejected(call(judge,'setStaffRoles',{uid:other.uid,roles:['payment'],active:true,reason:'Role lama telah dipensiunkan.'}),'not-found');
    const published=(await db.doc(`results/${scopeId()}`).get()).data();
    await call(admin,'unpublishResults',{...scope(),expectedRevision:published.revision,reason:'Penarikan hasil fixture untuk menguji rollback publikasi.'});
    assert.equal((await call(null,'getPublishedResults',scope())).published,false);
    await db.doc(`staff/${payment.uid}`).update({active:false});
    await rejected(call(payment,'getOperationsWorkspace',scope()),'permission-denied');
    const audit=await db.collection('auditLogs').where('action','==','results.published').get();assert.ok(audit.size>=1);
  });
  await t.test('Top 3 score ties require an explicit committee decision and withdrawal invalidates issued certificates', async () => {
    const tieUsers = [await account('flow_tie_one'), await account('flow_tie_two')];
    const ids = [rid];
    for (const actor of tieUsers) {
      const id = await seedRegistration(actor); ids.push(id);
      await db.doc(`submissions/${id}`).set({registrationId:id,ownerUid:actor.uid,memberUids:[actor.uid],scope:scopeId(),periodId,package:'web',wave:'wave-01',revision:1,status:'submitted',submittedAt:stamp(Date.now()-10000),payload:webPayload(),artifactIds:[]});
      await call(admin,'assignJudge',{registrationId:id,judgeUid:admin.uid});
      await call(admin,'saveJuryGrade',{registrationId:id,expectedRevision:0,scores:{functionality:90,responsive:80,code:70,documentation:100},comment:'Penilaian fixture seri sesuai bobot resmi.',finalize:true});
    }
    await rejected(call(admin,'prepareResults',scope()),'failed-precondition');
    const preview = await call(admin,'prepareResults',{...scope(),tieOrder:ids,tieReason:'Keputusan panitia fixture setelah klarifikasi seri.'});
    assert.deepEqual(preview.rows.map((entry)=>entry.rank),[1,2,3]);
    await call(admin,'publishResults',{...scope(),draftId:preview.draftId,expectedRevision:preview.expectedRevision,reason:'Hasil seri sudah diperiksa dan disahkan oleh panitia fixture.'});
    const issued = await call(tieUsers[0],'issueCertificate',{registrationId:ids[1]});
    assert.equal((await call(null,'verifyCertificate',{certificateId:issued.certificateId})).valid,true);
    await rejected(call(admin,'setDisqualification',{registrationId:ids[1],expectedRevision:0,disqualified:true,reason:'Hasil terbit harus ditarik terlebih dahulu.'}),'failed-precondition');
    const result=(await db.doc(`results/${scopeId()}`).get()).data();
    await call(admin,'unpublishResults',{...scope(),expectedRevision:result.revision,reason:'Penarikan fixture menguji validitas sertifikat tanpa membocorkan data.'});
    assert.equal((await call(null,'verifyCertificate',{certificateId:issued.certificateId})).status,'withdrawn');
  });

});
