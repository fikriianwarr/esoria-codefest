import {test, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, collection, getDocs} from 'firebase/firestore';
import {ref, uploadBytes, getBytes, deleteObject} from 'firebase/storage';
import {db, bucket, Timestamp, projectId} from './helpers.mjs';

const env = await initializeTestEnvironment({projectId, firestore: {rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8')}, storage: {rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8')}});
after(() => env.cleanup());
const testAuthTime = Math.floor(Date.now() / 1000);
const claims = {email_verified: true, auth_time: testAuthTime};
const owner = env.authenticatedContext('rules_owner', claims);
const other = env.authenticatedContext('rules_other', {...claims, admin: true});
const admin = env.authenticatedContext('rules_admin', {...claims, admin: true});
const anonymous = env.unauthenticatedContext();
const payment = env.authenticatedContext('rules_payment', claims);
await Promise.all([
  db.doc('users/rules_owner').set({role: 'participant', archived: false}),
  ...['rules_owner','rules_other','rules_admin','rules_payment'].map((uid) => db.doc(`accountSessions/${uid}`).set({authTime: testAuthTime, sessionHash: 'f'.repeat(64)})), db.doc('users/rules_other').set({role: 'participant', archived: false}), db.doc('admins/rules_admin').set({active:true}), db.doc('staff/rules_payment').set({active:true,roles:['payment']}), db.doc('periods/rules_public').set({label: 'Public fixture'})
]);

test('Rules: public periods readable, anonymous personal information denied', async () => {
  await assertSucceeds(getDoc(doc(anonymous.firestore(), 'periods/rules_public')));
  await assertFails(getDoc(doc(anonymous.firestore(), 'users/rules_owner')));
  await assertFails(getDocs(collection(anonymous.firestore(), 'registrations')));
});
test('Rules: owners can read their profile but cannot write business state or grant admin', async () => {
  await assertSucceeds(getDoc(doc(owner.firestore(), 'users/rules_owner')));
  await assertFails(getDoc(doc(other.firestore(), 'users/rules_owner')));
  for (const path of ['users/rules_owner', 'admins/rules_owner', 'staff/rules_owner', 'registrations/new', 'paymentProofs/new', 'periodSlots/new']) await assertFails(setDoc(doc(owner.firestore(), path), {active:true,status:'terverifikasi'}));
});
test('Rules: claims alone do not grant admin; payment staff cannot read all profiles', async () => {
  await assertFails(getDoc(doc(other.firestore(), 'users/rules_owner')));
  await assertFails(getDoc(doc(payment.firestore(), 'users/rules_owner')));
  await assertSucceeds(getDoc(doc(admin.firestore(), 'users/rules_owner')));
});
test('Rules: secrets, grades, certificates and unpublished results are server-only even for a browser admin', async () => {
  for (const path of ['ctfSecrets/private/challenges/answer', 'juryGrades/private', 'results/private', 'certificates/private', 'proofDigests/private', 'submissionUploads/private', 'prizePayments/private', 'resultDrafts/private']) {
    await db.doc(path).set({digest:'not-a-real-secret',published:false});
    await assertFails(getDoc(doc(owner.firestore(), path)));
    await assertFails(getDoc(doc(admin.firestore(), path)));
    await assertFails(setDoc(doc(admin.firestore(), path), {published:true}));
  }
});
test('Rules: submission read requires server-defined ownership; clients cannot change member UIDs', async () => {
  await db.doc('submissions/rules_work').set({ownerUid:'rules_owner',memberUids:['rules_owner']});
  await assertSucceeds(getDoc(doc(owner.firestore(),'submissions/rules_work')));
  await assertFails(getDoc(doc(other.firestore(),'submissions/rules_work')));
  await assertFails(setDoc(doc(owner.firestore(),'submissions/rules_work'),{ownerUid:'rules_other',memberUids:['rules_other']}));
});
test('Storage Rules: proof create validates metadata, size, MIME and immutability', async () => {
  const storage = owner.storage();
  const path = 'payment-proofs/rules_owner/rules_registration/immutable.jpg';
  const uploadId='ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
  const metadata = {contentType:'image/jpeg',customMetadata:{ownerUid:'rules_owner',registrationId:'rules_registration',sha256:'a'.repeat(64),uploadId}};
  await assertFails(uploadBytes(ref(storage,path),new Uint8Array(4),metadata));
  // A missing upload ID must be rejected without an unsafe metadata dereference.
  await assertFails(uploadBytes(ref(storage,'payment-proofs/rules_owner/rules_registration/missing-id.jpg'),new Uint8Array(4),{contentType:'image/jpeg',customMetadata:{ownerUid:'rules_owner',registrationId:'rules_registration',sha256:'a'.repeat(64)}}));
  await db.doc(`proofUploadIntents/${uploadId}`).set({ownerUid:'rules_owner',registrationId:'rules_registration',storagePath:path,sizeBytes:4,sha256:'a'.repeat(64),status:'pending',expiresAt:Timestamp.fromMillis(Date.now()+1800000)});
  await assertFails(uploadBytes(ref(storage,path),new Uint8Array([1]),{...metadata,contentType:'text/html'}));
  await assertFails(uploadBytes(ref(storage,path),new Uint8Array([1]),{...metadata,customMetadata:{...metadata.customMetadata,ownerUid:'rules_other'}}));
  await assertFails(uploadBytes(ref(storage,path),new Uint8Array(368641),metadata));
  await assertSucceeds(uploadBytes(ref(storage,path),new Uint8Array([255,216,255,217]),metadata));
  await assertFails(uploadBytes(ref(storage,path),new Uint8Array([1,2]),metadata));
  await assertFails(deleteObject(ref(storage,path)));
});
test('Storage Rules: only attached unexpired proof can be fetched by its owner or active admin', async () => {
  const path = 'payment-proofs/rules_owner/rules_registration/immutable.jpg';
  await assertFails(getBytes(ref(owner.storage(),path)));
  await db.doc('registrations/rules_registration').set({userId:'rules_owner',paymentProofAttached:true,proofStoragePath:path,proofRetentionUntil:Timestamp.fromMillis(Date.now()+3600000)});
  await assertSucceeds(getBytes(ref(owner.storage(),path)));
  await assertSucceeds(getBytes(ref(admin.storage(),path)));
  await assertFails(getBytes(ref(other.storage(),path)));
  await assertFails(getBytes(ref(payment.storage(),path)));
  await db.doc('registrations/rules_registration').update({proofRetentionUntil:Timestamp.fromMillis(Date.now()-1000)});
  await assertFails(getBytes(ref(owner.storage(),path)));
});
test('Storage Rules: signed intent requires exact owner, path, type, size, hash and lifetime; no direct read', async () => {
  const uploadId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const path = `submission-files/rules_owner/rules_work/${uploadId}.pdf`;
  await db.doc(`submissionUploads/${uploadId}`).set({ownerUid:'rules_owner',registrationId:'rules_work',status:'pending',expiresAt:Timestamp.fromMillis(Date.now()+3600000),storagePath:path,sizeBytes:5,mimeType:'application/pdf',sha256:'b'.repeat(64)});
  const meta={contentType:'application/pdf',customMetadata:{uploadId,ownerUid:'rules_owner',registrationId:'rules_work',sha256:'b'.repeat(64)}};
  await assertFails(uploadBytes(ref(other.storage(),path),new Uint8Array(5),meta));
  await assertFails(uploadBytes(ref(owner.storage(),`submission-files/rules_owner/rules_work/unsigned.pdf`),new Uint8Array(5),{contentType:'application/pdf',customMetadata:{ownerUid:'rules_owner',registrationId:'rules_work',sha256:'b'.repeat(64)}}));
  await assertFails(uploadBytes(ref(owner.storage(),path),new Uint8Array(6),meta));
  await assertFails(uploadBytes(ref(owner.storage(),path),new Uint8Array(5),{...meta,contentType:'image/png'}));
  await assertSucceeds(uploadBytes(ref(owner.storage(),path),new Uint8Array(5),meta));
  await assertFails(getBytes(ref(owner.storage(),path)));
  await db.doc(`submissionUploads/${uploadId}`).update({expiresAt:Timestamp.fromMillis(Date.now()-1)});
  await bucket.file(path).delete({ignoreNotFound:true});
  await assertFails(uploadBytes(ref(owner.storage(),path),new Uint8Array(5),meta));
});
test('Rules: absent and superseded device sessions cannot read Firestore or Storage', async () => {
  const uid = 'rules_revoked_device';
  await db.doc(`users/${uid}`).set({role:'participant', archived:false});
  const actor = env.authenticatedContext(uid, claims);
  await assertFails(getDoc(doc(actor.firestore(), `users/${uid}`)));
  await db.doc(`accountSessions/${uid}`).set({authTime:testAuthTime,sessionHash:'a'.repeat(64)});
  await assertSucceeds(getDoc(doc(actor.firestore(), `users/${uid}`)));
  await db.doc(`accountSessions/${uid}`).update({authTime:testAuthTime+1,sessionHash:'b'.repeat(64)});
  await assertFails(getDoc(doc(actor.firestore(), `users/${uid}`)));
  await assertFails(getBytes(ref(actor.storage(), `payment-proofs/${uid}/any/proof.jpg`)));
});
test('Rules: disabled admin loses document and evidence access immediately', async () => {
  await db.doc('admins/rules_admin').update({active:false});
  await assertFails(getDoc(doc(admin.firestore(),'users/rules_owner')));
});
