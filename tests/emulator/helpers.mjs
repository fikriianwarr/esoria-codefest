import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
export const {initializeApp, getApps} = require('firebase-admin/app');
export const {getFirestore, Timestamp, FieldValue} = require('firebase-admin/firestore');
export const {getAuth} = require('firebase-admin/auth');
export const {getStorage} = require('firebase-admin/storage');
export const sharp = require('sharp');
export const projectId = 'demo-esoria-codefest';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'These tests require the isolated demo project.');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key] || '', /^(127\.0\.0\.1|localhost):\d+$/, `Missing local emulator: ${key}`);
export const adminApp = getApps().find((app) => app.name === 'test-admin') || initializeApp({projectId, storageBucket: `${projectId}.appspot.com`}, 'test-admin');
export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
export const bucket = getStorage(adminApp).bucket();
export async function account(uid, kind = 'participant') {
  const email = `${uid.toLowerCase()}@example.invalid`;
  try {await auth.deleteUser(uid);} catch { /* test identity may not exist */ }
  await auth.createUser({uid, email, password: 'Only-Emulator-12345!', emailVerified: true});
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'Only-Emulator-12345!', returnSecureToken: true})});
  const token = (await response.json()).idToken;
  assert.ok(token, 'Auth emulator issued an ID token');
  if (kind === 'admin') await db.doc(`admins/${uid}`).set({active: true});
  else if (kind !== 'participant') await db.doc(`staff/${uid}`).set({active: true, roles: [kind]});
  else await db.doc(`users/${uid}`).set({uid, email, role: 'participant', participantName: `Peserta ${uid}`, legalName: `Peserta ${uid}`, profileComplete: true, archived: false, phone: '+628123456789', city: 'Kota Uji', province: 'Provinsi Uji'});
  // Exercise the real local session activation endpoint before protected API calls.
  // A user fixture without this activation is correctly denied by production code.
  const actor = {uid, email, token, sessionKey: randomBytes(32).toString('hex')};
  await call(actor, 'activateDeviceSession', {sessionKey: actor.sessionKey});
  const savedSession = await db.doc(`accountSessions/${uid}`).get();
  assert.ok(savedSession.exists, 'Emulator fixture must activate a real account session');
  return actor;
}
export async function call(user, action, payload = {}, ctf = false) {
  // Same random binder that a real browser includes in each authenticated callable.
  const data = user?.sessionKey && action !== 'activateDeviceSession'
    ? {...payload, sessionKey: user.sessionKey} : payload;
  if (process.env.ESORIA_HANDLER_TEST_MODE === 'direct') {
    const module = await import('../../functions/index.js');
    const token = user?.token ? await auth.verifyIdToken(user.token) : null;
    const request = {auth: token ? {uid: token.uid, token} : null, rawRequest: {ip: '127.0.0.1'}, data: ctf ? {payload: data} : {action, payload: data}};
    return (ctf ? module.esoriaCtf : module.esoriaApi).run(request);
  }
  const headers = {'Content-Type': 'application/json'};
  if (user?.token) headers.Authorization = `Bearer ${user.token}`;
  const functionsHost = process.env.ESORIA_TEST_FUNCTIONS_HOST || '127.0.0.1:5001';
  assert.match(functionsHost, /^(127\.0\.0\.1|localhost):\d+$/, 'Only local Functions Emulator is allowed');
  const response = await fetch(`http://${functionsHost}/${projectId}/asia-southeast2/${ctf ? 'esoriaCtf' : 'esoriaApi'}`, {method: 'POST', headers, body: JSON.stringify({data: ctf ? {payload: data} : {action, payload: data}})});
  const result = await response.json();
  if (result.error) throw Object.assign(new Error(result.error.message), {code: result.error.status?.toLowerCase().replaceAll('_', '-'), details: result.error.details});
  return result.result;
}
export const rejected = async (promise, code) => assert.rejects(promise, (error) => {assert.equal(error.code, code, error.message); return true;});
export const stamp = (value) => Timestamp.fromMillis(value);
export const periodId = '2099-01';
export const scope = (track = 'web', wave = 'wave-01') => ({periodId, package: track, wave});
export const scopeId = (track = 'web', wave = 'wave-01') => `${periodId}__${track}__${wave}`;
export const registrationId = (uid, track = 'web', wave = 'wave-01') => `${periodId}__${uid}__${track}__${wave}`;
export async function seedPeriod({deadline = Date.now() + 3600000, announcement = Date.now() + 7200000} = {}) {
  const start = Date.now() - 3600000;
  const wave = {enabled: true, startsAt: stamp(start), deadlineAt: stamp(deadline), announcementAt: stamp(announcement), registrationOpenAt: stamp(start - 3600000), registrationCloseAt: stamp(start - 60000)};
  await db.doc(`periods/${periodId}`).set({periodId, label: 'PERIODE UJI EMULATOR', status: 'open', registrationOpenAt: stamp(start - 7200000), registrationCloseAt: stamp(Date.now() + 3600000), announcementAt: stamp(announcement), waves: {'wave-01': {...wave, closesAt: wave.deadlineAt}}, packages: Object.fromEntries(['web', 'cyber', 'team'].map((track) => [track, {enabled: true, waves: {'wave-01': wave}}]))});
  await db.doc('system/registration').set({openPeriodId: periodId, acceptingRegistrations: true});
}
export async function seedRegistration(user, track = 'web', status = 'terverifikasi') {
  const rid = registrationId(user.uid, track);
  await db.doc(`registrations/${rid}`).set({registrationId: rid, userId: user.uid, userEmail: user.email, userName: `Peserta ${user.uid}`, periodId, periodLabel: 'PERIODE UJI EMULATOR', package: track, packageLabel: {web: 'Website Programming', cyber: 'Cybersecurity Mini CTF', team: 'Full Stack Development Team'}[track], wave: 'wave-01', waveLabel: 'Gelombang Uji', active: true, status, paymentStatus: status === 'terverifikasi' ? 'sesuai' : 'belum_diperiksa', reviewRevision: 0, referenceNumber: `ECF-TEST-${user.uid}`, ticketNumber: status === 'terverifikasi' ? `ECF-TEST-${user.uid}` : '', paymentProofAttached: false, createdAt: Timestamp.now(), amountValue: {web:100000,cyber:250000,team:500000}[track]});
  return rid;
}
export const webPayload = (extra = {}) => ({title: 'Karya pengujian lokal', repositoryUrl: 'https://github.com/example/esoria-test', liveUrl: 'https://example.org/demo', readmeUrl: 'https://example.org/readme', notes: 'Fixture sintetis untuk emulator, bukan data peserta.', originality: true, publicNameConsent: false, ...extra});
