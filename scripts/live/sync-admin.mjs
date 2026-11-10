/**
 * Synchronize an EXISTING, email-verified Firebase Authentication account with
 * the ESORIA admin document. No password creation, no anonymous admin promotion.
 * The operator must authenticate in gcloud as this exact Google account and
 * explicitly approve the change from the local release launcher.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const projectId = 'esoria-codefest';
const adminEmail = 'fikrianwar2000@gmail.com';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2];
if (!['--plan','--apply','--verify'].includes(mode) || process.argv.length !== 3)
  throw Error('Gunakan --plan, --apply atau --verify saja.');
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])
  if(process.env[name]) throw Error(`Tidak boleh mengarahkan sinkronisasi admin live ke emulator: ${name}`);
for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT','GCP_PROJECT','FIREBASE_PROJECT_ID'])
  if(process.env[name] && process.env[name] !== projectId) throw Error(`Project ${name} tidak sesuai.`);
if(JSON.parse(readFileSync(join(root,'.firebaserc'),'utf8')).projects?.default !== projectId)
  throw Error('Project .firebaserc tidak sesuai.');
const require = createRequire(join(root,'functions/package.json'));
const {initializeApp,applicationDefault} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const app=initializeApp({credential:applicationDefault(),projectId}, 'esoria-owner-admin-sync');
try {
  const auth=getAuth(app), db=getFirestore(app);
  let user;
  try { user=await auth.getUserByEmail(adminEmail); }
  catch(error) {
    if(error.code!=='auth/user-not-found') throw error;
    // Safe read-only fallback: an existing admins/{uid} might refer to a
    // verified Auth user even if the email index is temporarily inconsistent.
    // Never promote a different email or infer identity from Firestore alone.
    const matches=await db.collection('admins').where('email','==',adminEmail).limit(5).get();
    for(const doc of matches.docs){
      try {
        const candidate=await auth.getUser(doc.id);
        if(candidate.email?.toLowerCase()===adminEmail){ user=candidate; break; }
      } catch(e) { if(e.code!=='auth/user-not-found') throw e; }
    }
    if(!user && mode==='--plan') {
      console.warn(`ADMIN_ACCOUNT_MISSING: ${adminEmail} tidak ditemukan di Firebase Auth project ${projectId}.`);
      console.warn('Deployment dan pemeriksaan dataset dapat diteruskan secara terpisah; sinkronisasi role admin akan DILEWATI sampai akun yang cocok dibuat dan email diverifikasi.');
      console.warn('Login menggunakan Google pada website proyek, kemudian jalankan ulang CMD untuk menyinkronkan hak admin. Tidak membuat user atau claim admin otomatis.');
      process.exitCode=12;
    }
    if(!user && mode!=='--plan') throw Error(`Akun ${adminEmail} tidak ada di Auth project ${projectId}. Login/daftar dengan Google di website dan verifikasi email; tidak akan membuat admin dengan kredensial otomatis.`);
  }
  if(user){
  if(user.disabled || !user.emailVerified || user.email?.toLowerCase()!==adminEmail)
    throw Error('Akun target harus aktif, email cocok, dan sudah terverifikasi sebelum mendapat akses admin.');
  const ref=db.doc(`admins/${user.uid}`);
  const [adminSnap, profileSnap] = await Promise.all([ref.get(),db.doc(`users/${user.uid}`).get()]);
  if(!adminSnap.exists || adminSnap.data()?.active!==true){
    const reg=await db.collection('registrations').where('userId','==',user.uid).limit(1).get();
    if(!reg.empty) throw Error('Akun yang akan diangkat menjadi admin memiliki pendaftaran kompetisi. Tinjau konflik peran ini secara manual; jangan mengubah kepemilikan peserta.');
  }
  if(adminSnap.exists && adminSnap.data()?.email && adminSnap.data().email.toLowerCase()!==adminEmail)
    throw Error('Dokumen admin UID sudah dimiliki email lain. Tidak ada data ditimpa.');
  if(profileSnap.exists && profileSnap.data()?.email && profileSnap.data().email.toLowerCase()!==adminEmail)
    throw Error('Profil UID memiliki email berbeda. Perlu peninjauan manual.');
  const claims=user.customClaims||{};
  const active=adminSnap.exists && adminSnap.data()?.active===true;
  console.log(`ADMIN ${mode}: email=${adminEmail}, uid=${user.uid}, verified=${user.emailVerified}, Auth disabled=${user.disabled}, doc aktif=${active}, claim admin=${claims.admin===true}`);
  if(mode==='--verify') {
    if(!active || claims.admin!==true || profileSnap.data()?.role!=='admin') throw Error('Sinkronisasi admin belum lengkap; cek Auth, admins/{uid}, dan users/{uid}.');
    console.log('VERIFIKASI ADMIN LULUS.');
  } else if(mode==='--apply') {
    if(process.env.ESORIA_ADMIN_SYNC_CONSENT!==`AKTIFKAN ADMIN ${projectId} ${adminEmail}`)
      throw Error('Persetujuan sinkronisasi admin belum diberikan.');
    // Keep existing admin metadata; never turn on unverified/disabled accounts.
    await ref.set({email:adminEmail, displayName:user.displayName||profileSnap.data()?.displayName||'Administrator ESORIA',
      role:'admin',active:true,updatedAt:FieldValue.serverTimestamp(),
      ...(adminSnap.exists?{}:{createdAt:FieldValue.serverTimestamp()})}, {merge:true});
    // Mirror identity into users/{uid} for consistent admin UI and metrics.
    // An existing member record is only converted after the no-registration guard.
    const profile={uid:user.uid,email:adminEmail,emailVerified:true,role:'admin',
      displayName:user.displayName||profileSnap.data()?.displayName||'Administrator ESORIA',
      archived:false,updatedAt:FieldValue.serverTimestamp(),
      ...(profileSnap.exists?{}:{createdAt:FieldValue.serverTimestamp()})};
    await db.doc(`users/${user.uid}`).set(profile,{merge:true});
    // Claims are a cache of the authoritative Firestore admin document.
    if(claims.admin!==true)await auth.setCustomUserClaims(user.uid,{...claims,admin:true});
    console.log('Admin disinkronkan. Keluar dan masuk kembali ke website agar ID token memuat claim baru.');
  } else console.log('PREVIEW ADMIN SELESAI. Tidak ada perubahan data.');
  }
} finally {await app.delete();}
