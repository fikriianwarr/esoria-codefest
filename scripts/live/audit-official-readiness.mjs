#!/usr/bin/env node
/** Read-only official results & certificate readiness audit for the owned project. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {aggregateReadiness, classifyCertificateCandidate, classifyPublicResult, validPublicScope} from './official-readiness-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projectId = 'esoria-codefest';
const config = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
if (config.projects?.default !== projectId) throw Error('Proyek Firebase tidak cocok.');
if (process.argv.length !== 2) throw Error('Audit ini hanya-baca; tidak menerima parameter mutasi.');
if (['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'].some(k => process.env[k]))
  throw Error('Audit produksi tidak boleh dialihkan ke Emulator.');
for (const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','FIREBASE_PROJECT_ID']) {
  if (process.env[key] && process.env[key] !== projectId) throw Error(`${key} tidak cocok dengan ${projectId}.`);
}
const require = createRequire(join(root,'functions/package.json'));
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');
const app = initializeApp({credential:applicationDefault(), projectId},'esoria-official-readonly-audit');
const db = getFirestore(app);
const auth = getAuth(app);
const authCounts = {active: 0, disabled: 0, activeVerified: 0, truncated: false};
let token;
for (let page = 0; page < 20; page++) {
  const response = await auth.listUsers(1000, token);
  for (const user of response.users) {
    if (user.disabled) authCounts.disabled++;
    else {authCounts.active++; if (user.emailVerified) authCounts.activeVerified++;}
  }
  token = response.pageToken;
  if (!token) break;
  if (page === 19) authCounts.truncated = true;
}
const snap = await db.collection('results').get();
const rows = snap.docs.map(doc => ({id: doc.id, data: doc.data()}));
const overview = aggregateReadiness(rows);
const candidates = {ready:0, notEligible:0, registrationNotVerified:0, submissionNotFinished:0, identityNotComplete:0};
const eligible = [];
for (const item of rows) {
  if (classifyPublicResult(item.data) !== 'public' || !validPublicScope(item)) continue;
  for (const row of item.data.rows || []) {
    if (!row?.registrationId || !/^[a-zA-Z0-9_-]{1,180}$/.test(row.registrationId)) continue;
    eligible.push({result:item.data,row});
  }
}
// Small bounded parallel groups avoid unbounded reads; this is an advisory audit,
// not certificate issuance. Actual Cloud Functions recheck eligibility.
for (let i=0;i<eligible.length;i+=40) {
  const entries=eligible.slice(i,i+40);
  const registrations=await db.getAll(...entries.map(({row})=>db.doc(`registrations/${row.registrationId}`)));
  const submissions=await db.getAll(...entries.map(({row})=>db.doc(`submissions/${row.registrationId}`)));
  const profiles=await db.getAll(...registrations.map(reg => {
    const uid=reg.data()?.userId;
    return db.doc(`users/${typeof uid === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(uid)?uid:'missing-user-profile'}`);
  }));
  entries.forEach((item,index)=>{
    const status=classifyCertificateCandidate({
      result:item.result,row:item.row,registration:registrations[index].data(),
      submission:submissions[index].data(),profile:profiles[index].data()
    });
    const key={'ready':'ready','not-eligible':'notEligible','registration-not-verified':'registrationNotVerified',
      'submission-not-finished':'submissionNotFinished','identity-not-complete':'identityNotComplete',
      'result-not-public':'notEligible'}[status];
    candidates[key]++;
  });
}
console.log('\n=== AUDIT HASIL PUBLIK & SERTIFIKAT ESORIA (HANYA BACA) ===');
console.log(`Proyek Firebase: ${projectId}`);
console.log(`Firebase Auth aktif: ${authCounts.active}; nonaktif: ${authCounts.disabled}; aktif dan email terverifikasi: ${authCounts.activeVerified}${authCounts.truncated ? ' (hitung parsial)' : ''}`);
console.log(`Lingkup hasil: ${overview.total}`);
console.log(`Hasil sah yang sudah dapat dibaca publik: ${overview.public}`);
console.log(`Menunggu jadwal pengumuman: ${overview.scheduled}`);
console.log(`Belum disahkan: ${overview.unpublished}`);
console.log(`Tanggal pengumuman belum valid: ${overview.missingAnnouncement}`);
console.log(`Identitas lingkup hasil tidak sesuai skema: ${overview.invalidScope}`);
console.log(`Catatan internal (tidak terbit sebagai prestasi resmi): ${overview.internal}`);
console.log(`Calon sertifikat pemenang dengan data lengkap: ${candidates.ready}`);
console.log(`Belum layak menerima sertifikat pemenang: ${candidates.notEligible}`);
console.log(`Pendaftaran belum diverifikasi: ${candidates.registrationNotVerified}`);
console.log(`Karya belum lengkap: ${candidates.submissionNotFinished}`);
console.log(`Identitas penerima belum lengkap: ${candidates.identityNotComplete}`);
if (!overview.public) console.log('TINDAK LANJUT: Sahkan penilaian dan hasil kompetisi yang benar-benar terverifikasi melalui Operasional, sesudah jadwal pengumuman.');
console.log('Audit tidak mengubah akun, pembayaran, hasil, sertifikat, atau Firebase Rules.');
