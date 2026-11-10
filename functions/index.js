import crypto from 'node:crypto';
import sharp from 'sharp';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  getFirestore
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { createCompetitionService } from './competition.js';
import { boundedRetentionDays } from './domain.js';

initializeApp();

const REGION = process.env.FUNCTIONS_REGION || 'asia-southeast2';
// Production cannot disable attestation by changing an environment flag.
const IS_ISOLATED_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true'
  && String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')
  && Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);
const ENFORCE_APP_CHECK = !(IS_ISOLATED_EMULATOR && process.env.ENFORCE_APP_CHECK === 'false');
const NOTIFICATION_RETENTION_DAYS = boundedRetentionDays(process.env.NOTIFICATION_RETENTION_DAYS);
// Staged enforcement: switch on only after every active admin completes MFA and recovery is tested.
const REQUIRE_ADMIN_MFA = process.env.REQUIRE_ADMIN_MFA === 'true';
const REQUIRE_RECENT_ADMIN_AUTH = process.env.REQUIRE_RECENT_ADMIN_AUTH === 'true';

setGlobalOptions({
  region: REGION,
  cpu: 'gcf_gen1',
  maxInstances: 3,
  memory: '512MiB',
  timeoutSeconds: 540
});

const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();
const SERVER_TIMESTAMP = FieldValue.serverTimestamp();
const PACKAGES = {
  web: { label: 'Website Programming', amountLabel: 'Rp100.000', amountValue: 100000 },
  cyber: { label: 'Cybersecurity Mini CTF', amountLabel: 'Rp250.000', amountValue: 250000 },
  team: { label: 'Full Stack Development Team', amountLabel: 'Rp500.000', amountValue: 500000 }
};
const WAVES = {
  'wave-01': { label: 'Wave Awal Bulan — mulai tanggal 1' },
  'wave-02': { label: 'Wave Pertengahan Bulan — mulai tanggal 15' }
};
const STATUS_LABELS = {
  menunggu: 'Sedang diproses',
  terverifikasi: 'Diterima / ACC',
  ditolak: 'Ditolak'
};
const PROFILE_OPTIONS = Object.freeze({
  gender: ['Laki-laki', 'Perempuan', 'Tidak disebutkan'],
  occupation: ['Pelajar', 'Mahasiswa', 'Profesional', 'Komunitas', 'Lainnya'],
  experienceLevel: ['Pemula', 'Menengah', 'Mahir'],
  preferredTrack: ['Website Programming', 'Cybersecurity Mini CTF', 'Full Stack Development Team']
});
const profileChoice = (field, value, label) => {
  const selected = cleanString(value, 100);
  if (!PROFILE_OPTIONS[field]?.includes(selected)) {
    throw new HttpsError('invalid-argument', `${label} tidak tersedia.`);
  }
  return selected;
};
const PAYMENT_LABELS = {
  belum_diperiksa: 'Belum diperiksa',
  sesuai: 'Pembayaran sesuai',
  bermasalah: 'Pembayaran bermasalah'
};

const callableOptions = {
  enforceAppCheck: ENFORCE_APP_CHECK,
  consumeAppCheckToken: ENFORCE_APP_CHECK,
  cpu: 'gcf_gen1',
  maxInstances: 3,
  memory: '512MiB',
  timeoutSeconds: 540
};

const cleanString = (value, maximum = 500) => String(value ?? '').trim().slice(0, maximum);
const requireString = (value, label, minimum = 1, maximum = 500) => {
  const result = cleanString(value, maximum);
  if (result.length < minimum) throw new HttpsError('invalid-argument', `${label} belum valid.`);
  return result;
};
const optionalUrl = (value) => {
  const result = cleanString(value, 500);
  if (!result) return '';
  try {
    const parsed = new URL(result);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw new HttpsError('invalid-argument', 'URL portfolio belum valid.');
  }
};
const safeId = (value, maximum = 180) => cleanString(value, maximum).replace(/[^a-zA-Z0-9_.:-]/g, '_');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
// Per-user transaction-based quotas mitigate repeat API abuse; Firebase Auth itself
// owns SMS code issuance/rate limits (client JavaScript cannot override those).
const ACTION_QUOTAS = Object.freeze({
  submitProfileEditRequest: [5, 3600_000],
  registerPushToken: [24, 3600_000],
  submitRegistration: [24, 3600_000],
  createPaymentProofUpload: [24, 3600_000],
  replacePaymentProof: [12, 3600_000],
  saveParticipantProfile: [20, 3600_000],
  saveProfilePhoto: [20, 3600_000],
  getProfilePhoto: [90, 3600_000],
  getCompetitionMaterials: [12, 3600_000],
  reviewRegistration: [120, 3600_000],
  bulkReviewRegistrations: [40, 3600_000],
  logAdminCsvExport: [16, 3600_000],
  syncAdminMfaStatus: [30, 3600_000]
});
const ADMIN_MUTATIONS = new Set([
  'reviewRegistration', 'bulkReviewRegistrations', 'savePeriod', 'deletePeriod',
  'checkInRegistration', 'softDeleteRegistration', 'restoreRegistration',
  'reviewProfileEditRequest', 'updateParticipantProfile',
  'archiveParticipant', 'restoreParticipant', 'purgePaymentProof',
  'rebuildDashboardMetrics', 'logAdminCsvExport', 'revokeCertificate', 'unpublishResults', 'recordPrizePayment'
]);
const HIGH_IMPACT_ADMIN_ACTIONS = new Set([
  'deletePeriod', 'archiveParticipant', 'purgePaymentProof', 'logAdminCsvExport', 'revokeCertificate', 'unpublishResults', 'recordPrizePayment'
]);
const enforceActionQuota = async (uid, action) => {
  const specification = ACTION_QUOTAS[action] || [60, 60_000];
  const [maxCount, windowMillis] = specification;
  const windowId = Math.floor(Date.now() / windowMillis);
  const docId = hash(`${uid}:${action}:${windowId}`);
  const ref = db.doc(`securityRateLimits/${docId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
    if (count >= maxCount) throw new HttpsError('resource-exhausted', 'Terlalu banyak permintaan. Tunggu sebelum mencoba lagi.');
    transaction.set(ref, {
      count: count + 1,
      action,
      // Do not persist raw UID or IP in a security counter.
      expiresAt: Timestamp.fromMillis((windowId + 2) * windowMillis),
      updatedAt: SERVER_TIMESTAMP
    });
  });
};
const enforceAdminActionPolicy = async (request, action) => {
  if (!ADMIN_MUTATIONS.has(action)) return;
  const user = await requireAdmin(request);
  const token = request.auth?.token || {};
  if (REQUIRE_ADMIN_MFA && (token.admin !== true || !token.firebase?.sign_in_second_factor)) {
    throw new HttpsError('permission-denied', 'Sesi admin memerlukan verifikasi faktor kedua. Masuk ulang dengan MFA.');
  }
  if (REQUIRE_RECENT_ADMIN_AUTH && HIGH_IMPACT_ADMIN_ACTIONS.has(action)
      && (!Number.isFinite(Number(token.auth_time)) || Date.now() / 1000 - Number(token.auth_time) > 900)) {
    throw new HttpsError('failed-precondition', 'Untuk tindakan ini, masuk ulang ke akun admin terlebih dahulu.');
  }
  return user;
};

const slotIdFor = (periodId, packageId, waveId) => `${periodId}__${packageId}__${waveId}`;
const registrationIdFor = (periodId, uid, packageId, waveId) => `${periodId}__${uid}__${packageId}__${waveId}`;
const nowMillis = () => Date.now();
const timestampMillis = (value) => {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const asTimestamp = (value, label) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', `${label} belum valid.`);
  return Timestamp.fromDate(date);
};
const parseDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};
const wibDateValue = (millis = Date.now()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(millis));
const calculateAge = (birthDate, millis = Date.now()) => {
  const birth = parseDateOnly(birthDate);
  if (!birth) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(millis));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  let age = Number(map.year) - birth.getUTCFullYear();
  if (Number(map.month) - 1 < birth.getUTCMonth()
    || (Number(map.month) - 1 === birth.getUTCMonth() && Number(map.day) < birth.getUTCDate())) age -= 1;
  return age;
};
const normalizeTicket = (value) => cleanString(value, 40).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '');
const proofDimensions = (proof = {}) => {
  const width = Number(proof.width);
  const height = Number(proof.height);
  if (![width, height].every((size) => Number.isInteger(size) && size >= 1 && size <= 1800)) {
    throw new HttpsError('invalid-argument', 'Dimensi bukti pembayaran belum valid.');
  }
  return { width, height };
};

// Account session is bound to a fresh Auth sign-in and random browser key.
// auth_time does not change on ID token refresh, so old devices stay rejected.
const sessionKeyPattern = /^[a-f0-9]{64}$/;
const sessionAuthTime = (request) => Number(request.auth?.token?.auth_time || 0);
const requireDeviceSession = async (request) => {
  if (!request.auth?.uid) return; // Public time/status calls remain accessible.
  const key = cleanString(request.data?.payload?.sessionKey, 80);
  if (!sessionKeyPattern.test(key)) throw new HttpsError('failed-precondition', 'Sesi perangkat belum aktif. Masuk ulang.');
  const doc = await db.doc(`accountSessions/${request.auth.uid}`).get();
  if (!doc.exists || doc.data()?.authTime !== sessionAuthTime(request) || doc.data()?.sessionHash !== hash(key)) {
    throw new HttpsError('permission-denied', 'Sesi akun telah digantikan oleh login dari perangkat lain.');
  }
};
const activateDeviceSessionHandler = async (request) => {
  const user = requireAuth(request);
  const key = requireString(request.data?.sessionKey, 'Kunci sesi perangkat', 64, 64);
  if (!sessionKeyPattern.test(key)) throw new HttpsError('invalid-argument', 'Format sesi perangkat tidak valid.');
  const loginTime = sessionAuthTime(request);
  if (!Number.isSafeInteger(loginTime) || loginTime < 1) throw new HttpsError('unauthenticated', 'Masuk ulang dengan kredensial akun.');
  const ref = db.doc(`accountSessions/${user.uid}`);
  await db.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    const record = old.data();
    if (record && (loginTime < record.authTime || (loginTime === record.authTime && record.sessionHash !== hash(key)))) {
      throw new HttpsError('failed-precondition', 'Sesi lain sudah aktif. Masuk lagi setelah beberapa detik untuk menggantikannya.');
    }
    if (record?.authTime === loginTime && record?.sessionHash === hash(key)) return;
    tx.set(ref, {authTime:loginTime, sessionHash:hash(key), activatedAt:SERVER_TIMESTAMP});
  });
  return {active:true};
};
const checkDeviceSessionHandler = async (request) => {
  requireAuth(request);
  await requireDeviceSession({auth:request.auth, data:{payload:request.data}});
  return {active:true};
};

const requireAuth = (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Masuk ke akun terlebih dahulu.');
  return {
    uid: request.auth.uid,
    email: request.auth.token.email || '',
    emailVerified: request.auth.token.email_verified === true,
    claims: request.auth.token
  };
};
const requireVerified = (request) => {
  const user = requireAuth(request);
  if (!user.emailVerified) throw new HttpsError('failed-precondition', 'Verifikasi email sebelum melanjutkan.');
  return user;
};
const getAdminRecord = async (uid) => {
  const snapshot = await db.doc(`admins/${uid}`).get();
  return snapshot.exists ? snapshot.data() : null;
};
const requireAdmin = async (request) => {
  const user = requireVerified(request);
  // The active Firestore document is authoritative. A stale custom claim
  // must never keep an administrator authorized after revocation.
  const record = await getAdminRecord(user.uid);
  if (!record || record.active !== true) {
    throw new HttpsError('permission-denied', 'Anda tidak mempunyai izin untuk melakukan tindakan ini.');
  }
  if (REQUIRE_ADMIN_MFA && (request.auth.token.admin !== true || !request.auth.token.firebase?.sign_in_second_factor)) {
    throw new HttpsError('permission-denied', 'Sesi admin memerlukan MFA. Masuk ulang setelah mengikuti prosedur keamanan.');
  }
  return { ...user, role: 'admin' };
};
const requireActiveProfile = async (uid) => {
  if (await getAdminRecord(uid)) {
    throw new HttpsError('permission-denied', 'Akun admin tidak dapat digunakan sebagai peserta.');
  }
  const snapshot = await db.doc(`users/${uid}`).get();
  if (!snapshot.exists || snapshot.data().archived === true) {
    throw new HttpsError('permission-denied', 'Profil peserta tidak aktif.');
  }
  return snapshot.data();
};
const notificationData = ({
  userId, actor, actorRole = 'system', type = 'system', title, message,
  actionLabel = '', actionUrl = '', sourceType = 'system', sourceId = '', eventKey = ''
}) => ({
  userId,
  actorUid: actor?.uid || '',
  actorEmail: actor?.email || '',
  actorRole,
  type: cleanString(type, 30),
  title: cleanString(title, 120),
  message: cleanString(message, 500),
  actionLabel: cleanString(actionLabel, 60),
  actionUrl: cleanString(actionUrl, 300),
  sourceType: cleanString(sourceType, 40),
  sourceId: cleanString(sourceId, 300),
  eventKey: cleanString(eventKey, 220),
  read: false,
  readAt: null,
  createdAt: SERVER_TIMESTAMP,
  expiresAt: Timestamp.fromMillis(Date.now() + NOTIFICATION_RETENTION_DAYS * 86400000)
});
const notificationRef = (uid, eventKey) => db.doc(`users/${uid}/notifications/${safeId(eventKey || crypto.randomUUID())}`);
const auditRef = (eventKey) => db.doc(`auditLogs/${safeId(eventKey || crypto.randomUUID())}`);
const auditData = (actor, action, targetType, targetId, details = {}) => ({
  action, targetType, targetId,
  actorUid: actor?.uid || 'system',
  actorEmail: actor?.email || '',
  actorRole: actor?.role || 'system',
  details,
  createdAt: SERVER_TIMESTAMP
});
const ensureProofObject = async ({ user, registrationId, storagePath, sizeBytes, sha256 }) => {
  const expectedPrefix = `payment-proofs/${user.uid}/${registrationId}/`;
  if (!storagePath?.startsWith(expectedPrefix) || !storagePath.endsWith('.jpg')) {
    throw new HttpsError('invalid-argument', 'Lokasi bukti pembayaran tidak valid.');
  }
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Bukti pembayaran tidak ditemukan di Storage.');
  const [metadata] = await file.getMetadata();
  const actualSize = Number(metadata.size || 0);
  const custom = metadata.metadata || {};
  if (metadata.contentType !== 'image/jpeg' || actualSize <= 0 || actualSize > 360 * 1024) {
    throw new HttpsError('invalid-argument', 'Bukti pembayaran harus berupa JPEG maksimal 360 KB.');
  }
  if (custom.ownerUid !== user.uid || custom.registrationId !== registrationId) {
    throw new HttpsError('permission-denied', 'Metadata pemilik bukti pembayaran tidak cocok.');
  }
  if (!Number.isInteger(Number(sizeBytes)) || Number(sizeBytes) !== actualSize) {
    throw new HttpsError('invalid-argument', 'Ukuran bukti pembayaran tidak cocok.');
  }
  const declaredHash = cleanString(sha256, 64);
  if (!/^[a-f0-9]{64}$/.test(declaredHash) || declaredHash !== custom.sha256) {
    throw new HttpsError('invalid-argument', 'Metadata hash bukti pembayaran tidak cocok.');
  }
  if (custom.uploadId) {
    if (!/^[a-f0-9-]{36}$/.test(custom.uploadId)) throw new HttpsError('invalid-argument', 'Izin unggah bukti tidak valid.');
    const intent = (await db.doc(`proofUploadIntents/${custom.uploadId}`).get()).data();
    if (!intent || intent.status !== 'pending' || intent.ownerUid !== user.uid || intent.registrationId !== registrationId || intent.storagePath !== storagePath || intent.sha256 !== declaredHash || intent.sizeBytes !== actualSize || timestampMillis(intent.expiresAt) < Date.now()) throw new HttpsError('failed-precondition', 'Izin unggah bukti kedaluwarsa atau tidak sesuai. Unggah ulang bukti.');
  }
  const [bytes] = await file.download();
  // MIME headers alone do not prove that the uploaded bytes are a JPEG.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new HttpsError('invalid-argument', 'Isi bukti pembayaran bukan JPEG yang valid.');
  }
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== declaredHash) throw new HttpsError('invalid-argument', 'Integritas file bukti pembayaran gagal diverifikasi.');
  let decoded;
  try {
    decoded = await sharp(bytes, {failOn: 'warning', limitInputPixels: 1800 * 1800}).raw().toBuffer({resolveWithObject: true});
    if (decoded.info.width > 1800 || decoded.info.height > 1800) throw new Error('dimensions');
  } catch {
    throw new HttpsError('invalid-argument', 'Bukti transfer tidak dapat dibaca sebagai JPEG yang valid.');
  }
  const created = Date.parse(metadata.timeCreated || '');
  if (Number.isFinite(created) && Date.now() - created > 24 * 3600000) {
    throw new HttpsError('failed-precondition', 'Unggahan bukti kedaluwarsa. Pilih dan unggah ulang gambar Anda.');
  }
  if (file.setMetadata) await file.setMetadata({cacheControl: 'private,no-store', metadata: {...custom, firebaseStorageDownloadTokens: null}});
  return { file, metadata, sizeBytes: actualSize, sha256: actualHash, width: decoded.info.width, height: decoded.info.height };
};
const safeDeleteFile = async (path) => {
  if (!path) return;
  try { await bucket.file(path).delete({ ignoreNotFound: true }); } catch { logger.warn('storage_cleanup_failed', {objectHash: hash(path)}); }
};

const PROFILE_PHOTO_MAX_BYTES = 256 * 1024;
const PROFILE_PHOTO_SIDE = 512;
const profilePhotoPathFor = (uid, storagePath) => {
  const prefix = `profile-photos/${uid}/`;
  return typeof storagePath === 'string' && storagePath.startsWith(prefix)
    && /^[A-Za-z0-9-]{20,80}[.]jpg$/.test(storagePath.slice(prefix.length));
};

// Read-only owner-scoped fallback: direct Firebase Storage SDK reads need bucket
// CORS in web browsers, whereas callable traffic does not. Never mint a public
// download token or accept an arbitrary file path supplied by the browser.
const getProfilePhotoHandler = async (request) => {
  const user = requireVerified(request);
  const profile = await requireActiveProfile(user.uid);
  if (profile.role === 'admin') throw new HttpsError('permission-denied', 'Akun Admin tidak memiliki foto profil peserta.');
  const storagePath = profile.photoStoragePath;
  if (!storagePath) return { ok: true, hasPhoto: false };
  if (!profilePhotoPathFor(user.uid, storagePath)) {
    throw new HttpsError('failed-precondition', 'Lokasi foto tersimpan tidak valid. Silakan unggah ulang foto.');
  }
  const requestedVersion = request.data?.photoVersion;
  if (requestedVersion !== undefined && (!Number.isSafeInteger(requestedVersion)
    || requestedVersion !== Number(profile.photoVersion || 0))) {
    throw new HttpsError('failed-precondition', 'Foto profil sudah berubah. Muat ulang profil untuk mendapatkan foto terbaru.');
  }
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Berkas foto tidak tersedia. Pilih foto baru melalui profil.');
  const [metadata] = await file.getMetadata();
  const bytesCount = Number(metadata.size || 0);
  if (metadata.contentType !== 'image/jpeg' || !Number.isInteger(bytesCount)
    || bytesCount < 4 || bytesCount > PROFILE_PHOTO_MAX_BYTES
    || metadata.metadata?.ownerUid !== user.uid
    || !/^[a-f0-9]{64}$/.test(String(profile.photoSha256 || ''))
    || metadata.metadata?.sha256 !== profile.photoSha256) {
    throw new HttpsError('failed-precondition', 'Metadata foto tidak cocok. Hubungi panitia jika masalah berlanjut.');
  }
  const [bytes] = await file.download();
  if (bytes.length !== bytesCount || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
    || crypto.createHash('sha256').update(bytes).digest('hex') !== profile.photoSha256) {
    throw new HttpsError('failed-precondition', 'Berkas foto gagal diverifikasi. Hubungi panitia.');
  }
  return {
    ok: true, hasPhoto: true, photoVersion: Number(profile.photoVersion || 0),
    sizeBytes: bytes.length, sha256: profile.photoSha256,
    mimeType: 'image/jpeg', base64: bytes.toString('base64')
  };
};

const saveProfilePhotoHandler = async (request) => {
  const user = requireVerified(request);
  const input = request.data || {};
  const storagePath = cleanString(input.storagePath, 300);
  const declaredHash = cleanString(input.sha256, 64);
  if (!profilePhotoPathFor(user.uid, storagePath) || !/^[a-f0-9]{64}$/.test(declaredHash)) {
    throw new HttpsError('invalid-argument', 'Lokasi atau hash foto profil belum valid.');
  }
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Foto profil belum selesai diunggah. Coba simpan kembali.');
  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata.size || 0);
  const custom = metadata.metadata || {};
  if (custom.ownerUid !== user.uid) throw new HttpsError('permission-denied', 'Foto profil bukan milik akun ini.');
  if (metadata.contentType !== 'image/jpeg' || !Number.isInteger(sizeBytes)
    || sizeBytes <= 0 || sizeBytes > PROFILE_PHOTO_MAX_BYTES
    || Number(input.sizeBytes) !== sizeBytes || custom.sha256 !== declaredHash) {
    throw new HttpsError('invalid-argument', 'Foto profil harus JPEG maksimal 256 KB dengan metadata yang sesuai.');
  }
  const [bytes] = await file.download();
  if (bytes.length !== sizeBytes || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
    || crypto.createHash('sha256').update(bytes).digest('hex') !== declaredHash) {
    throw new HttpsError('invalid-argument', 'Isi foto profil belum valid. Pilih ulang fotonya.');
  }
  try {
    // Decode the entire image, rather than accepting only a plausible header.
    const { info } = await sharp(bytes, { failOn: 'warning', limitInputPixels: PROFILE_PHOTO_SIDE ** 2 })
      .raw().toBuffer({ resolveWithObject: true });
    if (info.width !== PROFILE_PHOTO_SIDE || info.height !== PROFILE_PHOTO_SIDE) throw new Error('dimensions');
  } catch {
    throw new HttpsError('invalid-argument', 'Foto profil tidak bisa dibaca sebagai JPEG 512 × 512. Pilih ulang fotonya.');
  }
  const reference = db.doc(`users/${user.uid}`);
  const uploadId = storagePath.split('/').at(-1).slice(0, -4);
  const uploadReference = db.doc(`users/${user.uid}/profilePhotoUploads/${uploadId}`);
  const result = await db.runTransaction(async (transaction) => {
    const [profileSnapshot, adminSnapshot, uploadSnapshot] = await Promise.all([
      transaction.get(reference), transaction.get(db.doc(`admins/${user.uid}`)), transaction.get(uploadReference)
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data().archived === true
      || profileSnapshot.data().role === 'admin' || adminSnapshot.exists) {
      throw new HttpsError('permission-denied', 'Foto hanya dapat diubah oleh pemilik profil peserta yang aktif.');
    }
    const current = profileSnapshot.data();
    // A retry after a lost response must not create a second event/version.
    if (current.photoStoragePath === storagePath && current.photoSha256 === declaredHash) {
      return { photoStoragePath: storagePath, photoSha256: declaredHash,
        photoVersion: Number(current.photoVersion || 0), photoSizeBytes: sizeBytes, previousPath: '' };
    }
    if (uploadSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Foto ini sudah pernah diganti. Pilih ulang foto untuk mengunggah salinan baru.');
    }
    const photoVersion = Number(current.photoVersion || 0) + 1;
    const photo = { photoStoragePath: storagePath, photoSha256: declaredHash,
      photoVersion, photoSizeBytes: sizeBytes };
    transaction.update(reference, { ...photo, photoUpdatedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP });
    transaction.set(uploadReference, { storagePath, sha256: declaredHash, photoVersion, linkedAt: SERVER_TIMESTAMP });
    const eventKey = `profile_photo_${user.uid}_${photoVersion}`;
    transaction.set(notificationRef(user.uid, eventKey), notificationData({
      userId: user.uid, actor: user, actorRole: 'user', type: 'profile',
      title: 'Foto profil diperbarui', message: 'Foto profil baru sudah tersimpan. Data identitas utama tetap mengikuti status penguncian profil.',
      actionLabel: 'Buka profil', actionUrl: 'profil.html', sourceType: 'user', sourceId: user.uid, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(user, 'profile.photo_updated', 'user', user.uid, { photoVersion, sizeBytes }));
    return { ...photo, previousPath: current.photoStoragePath || '' };
  });
  if (result.previousPath !== storagePath && profilePhotoPathFor(user.uid, result.previousPath)) {
    await safeDeleteFile(result.previousPath);
  }
  const { previousPath: _previousPath, ...photo } = result;
  return { ok: true, ...photo };
};

const serverClockHandler = async () => ({ serverNow: Date.now(), timeZone: 'Asia/Jakarta' });

const refreshAdminClaimsHandler = async (request) => {
  const user = requireVerified(request);
  const record = await getAdminRecord(user.uid);
  if (!record || record.active !== true) {
    const existing = (await auth.getUser(user.uid)).customClaims || {};
    await auth.setCustomUserClaims(user.uid, { ...existing, admin: false });
    throw new HttpsError('permission-denied', 'Akun ini tidak terdaftar sebagai admin aktif.');
  }
  const existing = (await auth.getUser(user.uid)).customClaims || {};
  await auth.setCustomUserClaims(user.uid, { ...existing, admin: true });
  return { ok: true, admin: true, refreshToken: true };
};

const getSystemHealthHandler = async (request) => {
  await requireAdmin(request);
  const [securitySnapshot, dashboardSnapshot] = await Promise.all([
    db.doc('system/security').get(), db.doc('system/dashboard').get()
  ]);
  return {
    admin: true,
    region: REGION,
    appCheckEnforced: ENFORCE_APP_CHECK,
    adminMfaEnforced: REQUIRE_ADMIN_MFA,
    recentAdminAuthEnforced: REQUIRE_RECENT_ADMIN_AUTH,
    retention: { notificationsDays: NOTIFICATION_RETENTION_DAYS, proofDays: 90 },
    security: securitySnapshot.data() || {},
    dashboard: dashboardSnapshot.data() || {}
  };
};

// Backend-verified MFA inventory; the client never writes an unverified SMS status.
const syncAdminMfaStatusHandler = async (request) => {
  const admin = await requireAdmin(request);
  const record = await auth.getUser(admin.uid);
  const factors = record.multiFactor?.enrolledFactors || [];
  const fingerprint = hash(factors.map((factor) => factor.uid).sort().join('|'));
  const reference = db.doc(`adminSecurityMeta/${admin.uid}`);
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(reference);
    if (previous.exists && previous.data()?.fingerprint === fingerprint) return;
    const eventRef = auditRef(`admin_mfa_${admin.uid}_${crypto.randomUUID()}`);
    transaction.set(reference, { fingerprint, factorCount: factors.length, updatedAt: SERVER_TIMESTAMP }, { merge: true });
    transaction.set(eventRef, auditData(admin, 'admin.mfa.inventory_changed', 'admin', admin.uid, {
      factorCount: factors.length,
      // This inventory is verified by Admin Auth, not a client success message.
      verifiedByAuth: true
    }));
  });
  return { ok: true, factorCount: factors.length };
};

const logAdminCsvExportHandler = async (request) => {
  const admin = await requireAdmin(request);
  const tab = cleanString(request.data?.tab, 20);
  if (!['users', 'registrations', 'editRequests', 'auditLogs'].includes(tab)) {
    throw new HttpsError('invalid-argument', 'Jenis data ekspor tidak didukung.');
  }
  const count = Number(request.data?.count);
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new HttpsError('invalid-argument', 'Jumlah baris tidak valid.');
  }
  const eventKey = `admin_csv_${admin.uid}_${crypto.randomUUID()}`;
  await auditRef(eventKey).set(auditData(admin, 'admin.csv.export_requested', tab, eventKey, {
    count, sensitive: true
  }));
  return { ok: true };
};

const ensureUserProfileHandler = async (request) => {
  const user = requireAuth(request);
  if (await getAdminRecord(user.uid)) {
    throw new HttpsError('permission-denied', 'Administrator tidak memiliki profil peserta. Gunakan Panel Admin.');
  }
  const initial = request.data?.initial && typeof request.data.initial === 'object' ? request.data.initial : {};
  const reference = db.doc(`users/${user.uid}`);
  const now = SERVER_TIMESTAMP;
  const baseName = cleanString(initial.participantName || initial.displayName || user.claims.name || '', 100);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
    transaction.set(reference, {
      uid: user.uid,
      role: 'participant',
      email: user.email,
      emailVerified: user.emailVerified,
      authDisplayName: cleanString(user.claims.name, 100),
      participantName: baseName,
      legalName: baseName,
      displayName: baseName,
      photoURL: cleanString(user.claims.picture, 500),
      authProvider: cleanString(user.claims.firebase?.sign_in_provider, 60),
      birthDate: '', age: null, ageComputedAt: '', gender: '', phone: '+62',
      institution: '', occupation: '', city: '', province: '', address: '',
      primarySkill: '', experienceLevel: '', preferredTrack: '', portfolioUrl: '', bio: '',
      profileComplete: false, profileLocked: false, profileLockedAt: null,
      archived: false, archivedAt: null, archivedByUid: '', profileVersion: 0,
      createdAt: now, updatedAt: now, lastLoginAt: now
    });
  } else {
    const current = snapshot.data();
    transaction.set(reference, {
      uid: user.uid, role: 'participant',
      email: user.email || current.email || '',
      emailVerified: user.emailVerified,
      authDisplayName: cleanString(user.claims.name || current.authDisplayName, 100),
      photoURL: cleanString(user.claims.picture || current.photoURL, 500),
      authProvider: cleanString(user.claims.firebase?.sign_in_provider || current.authProvider, 60),
      profileVersion: Number.isInteger(current.profileVersion) ? current.profileVersion : 0,
      archived: current.archived === true,
      profileComplete: current.profileComplete === true,
      profileLocked: current.profileComplete === true ? true : current.profileLocked === true,
      updatedAt: now,
      lastLoginAt: request.data?.touchLogin === false ? current.lastLoginAt || now : now
    }, { merge: true });
    }
  });
  const result = await reference.get();
  return { profile: { id: result.id, ...result.data() } };
};

const saveParticipantProfileHandler = async (request) => {
  const user = requireVerified(request);
  const payload = request.data?.payload || {};
  const birthDate = requireString(payload.birthDate, 'Tanggal lahir', 10, 10);
  const age = calculateAge(birthDate);
  if (!Number.isInteger(age) || age < 0 || age > 120) throw new HttpsError('invalid-argument', 'Umur peserta belum valid.');
  const participantName = requireString(payload.participantName, 'Nama peserta', 2, 100);
  const phone = requireString(payload.phone, 'Nomor telepon', 9, 20);
  if (!/^\+62[0-9]{8,13}$/.test(phone)) throw new HttpsError('invalid-argument', 'Nomor telepon harus menggunakan format +62.');
  const reference = db.doc(`users/${user.uid}`);
  const requestReference = db.doc(`profileEditRequests/${user.uid}`);
  await db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(reference);
    if (!profileSnapshot.exists) throw new HttpsError('not-found', 'Profil peserta tidak ditemukan.');
    const current = profileSnapshot.data();
    if (current.archived === true) throw new HttpsError('permission-denied', 'Profil sedang diarsipkan.');
    const firstSave = current.profileComplete !== true;
    let editRequest = null;
    if (!firstSave) {
      const requestSnapshot = await transaction.get(requestReference);
      editRequest = requestSnapshot.exists ? requestSnapshot.data() : null;
      if (editRequest?.status !== 'approved') throw new HttpsError('permission-denied', 'Perubahan profil belum disetujui admin.');
    }
    const profileVersion = Number(current.profileVersion || 0) + 1;
    const update = {
      uid: user.uid, email: user.email || current.email || '', emailVerified: true,
      participantName, legalName: requireString(payload.legalName || participantName, 'Nama legal', 2, 100),
      displayName: participantName, birthDate, age, ageComputedAt: wibDateValue(),
      gender: profileChoice('gender', payload.gender, 'Jenis kelamin'), phone,
      institution: cleanString(payload.institution, 150),
      occupation: profileChoice('occupation', payload.occupation, 'Status utama'),
      city: requireString(payload.city, 'Kota', 2, 100),
      province: requireString(payload.province, 'Provinsi', 2, 100),
      address: cleanString(payload.address, 500),
      primarySkill: requireString(payload.primarySkill, 'Keahlian utama', 2, 120),
      experienceLevel: profileChoice('experienceLevel', payload.experienceLevel, 'Tingkat pengalaman'),
      preferredTrack: profileChoice('preferredTrack', payload.preferredTrack, 'Kategori minat'),
      portfolioUrl: optionalUrl(payload.portfolioUrl), bio: cleanString(payload.bio, 300),
      profileComplete: true, profileLocked: true, profileLockedAt: SERVER_TIMESTAMP,
      archived: false, archivedAt: null, archivedByUid: '', profileVersion,
      updatedAt: SERVER_TIMESTAMP, lastLoginAt: SERVER_TIMESTAMP
    };
    transaction.set(reference, update, { merge: true });
    if (!firstSave) transaction.update(requestReference, { status: 'completed', completedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP });
    const eventKey = `profile_saved_${user.uid}_${profileVersion}`;
    transaction.set(notificationRef(user.uid, eventKey), notificationData({
      userId: user.uid, actor: user, actorRole: 'user', type: 'profile',
      title: firstSave ? 'Profil berhasil dikunci' : 'Perubahan profil disimpan',
      message: firstSave ? 'Profil utama sudah lengkap dan siap digunakan untuk pendaftaran.' : 'Perubahan yang disetujui admin berhasil disimpan. Profil kembali dikunci.',
      actionLabel: 'Buka profil', actionUrl: 'profil.html', sourceType: 'user', sourceId: user.uid, eventKey
    }));
  });
  return { ok: true, age };
};

const submitProfileEditRequestHandler = async (request) => {
  const user = requireVerified(request);
  const reason = requireString(request.data?.reason, 'Alasan perubahan', 10, 500);
  const profileReference = db.doc(`users/${user.uid}`);
  const requestReference = db.doc(`profileEditRequests/${user.uid}`);
  await db.runTransaction(async (transaction) => {
    const [profileSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(profileReference), transaction.get(requestReference)
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data().profileComplete !== true || profileSnapshot.data().archived === true) {
      throw new HttpsError('failed-precondition', 'Profil belum lengkap atau tidak aktif.');
    }
    const previous = requestSnapshot.exists ? requestSnapshot.data() : {};
    if (['pending', 'approved'].includes(previous.status)) {
      throw new HttpsError('already-exists', previous.status === 'approved' ? 'Permintaan sudah disetujui.' : 'Permintaan masih menunggu keputusan admin.');
    }
    const attemptCount = Number(previous.attemptCount || 0) + 1;
    transaction.set(requestReference, {
      requestId: user.uid, userId: user.uid, userEmail: user.email,
      userName: profileSnapshot.data().participantName || profileSnapshot.data().legalName || 'Peserta Esoria',
      status: 'pending', reason, attemptCount,
      requestedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
      reviewedAt: null, reviewedByUid: '', reviewedByEmail: '', reviewNote: '', approvedAt: null, completedAt: null
    });
    const eventKey = `profile_edit_requested_${user.uid}_${attemptCount}`;
    transaction.set(notificationRef(user.uid, eventKey), notificationData({
      userId: user.uid, actor: user, actorRole: 'user', type: 'profile',
      title: 'Permintaan edit dikirim', message: 'Permintaan perubahan profil sudah masuk dan menunggu keputusan admin.',
      actionLabel: 'Lihat profil', actionUrl: 'profil.html', sourceType: 'profileEditRequest', sourceId: user.uid, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(user, 'profile_edit.requested', 'profileEditRequest', user.uid, { attemptCount }));
  });
  return { ok: true };
};

const submitRegistrationHandler = async (request) => {
  const user = requireVerified(request);
  const input = request.data || {};
  const periodId = requireString(input.periodId, 'Periode', 4, 50);
  const packageId = requireString(input.package, 'Kategori', 2, 20);
  const waveId = requireString(input.wave, 'Gelombang', 2, 20);
  if (!PACKAGES[packageId] || !WAVES[waveId]) throw new HttpsError('invalid-argument', 'Kategori atau gelombang tidak tersedia.');
  const registrationId = registrationIdFor(periodId, user.uid, packageId, waveId);
  const submissionId = safeId(input.submissionId || registrationId, 180);
  const proof = input.proof || {};
  const dimensions = proofDimensions(proof);
  const proofObject = await ensureProofObject({
    user, registrationId, storagePath: cleanString(proof.storagePath, 500),
    sizeBytes: Number(proof.sizeBytes || 0), sha256: cleanString(proof.sha256, 64)
  });
  const transferDate = requireString(input.transferDate, 'Tanggal transfer', 10, 10);
  if (!parseDateOnly(transferDate) || transferDate > wibDateValue()) throw new HttpsError('invalid-argument', 'Tanggal transfer belum valid atau berada di masa depan.');
  const teamMembers = packageId === 'team' ? input.teamMembers : [];
  if (packageId === 'team') {
    if (!Array.isArray(teamMembers) || teamMembers.length < 2 || teamMembers.length > 4) throw new HttpsError('invalid-argument', 'Tim harus berisi 2–4 anggota.');
    const emails = teamMembers.map((member) => cleanString(member?.email, 160).toLowerCase());
    if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      || emails[0] !== user.email.toLowerCase() || new Set(emails).size !== emails.length) {
      throw new HttpsError('invalid-argument', 'Email anggota tim belum valid atau ganda.');
    }
  }
  const registrationReference = db.doc(`registrations/${registrationId}`);
  const proofReference = db.doc(`paymentProofs/${registrationId}`);
  const slotReference = db.doc(`periodSlots/${slotIdFor(periodId, packageId, waveId)}`);
  const profileReference = db.doc(`users/${user.uid}`);
  const periodReference = db.doc(`periods/${periodId}`);
  const systemReference = db.doc('system/registration');
  const digestRef = db.doc(`proofDigests/${proofObject.sha256}`);
  const result = await db.runTransaction(async (transaction) => {
      const digest = await transaction.get(digestRef);
      const usedBy = Array.isArray(digest.data()?.registrationIds) ? digest.data().registrationIds : [];
      const duplicateSuspected = usedBy.some((entry) => entry !== registrationId);
      const [profileSnapshot, periodSnapshot, systemSnapshot, slotSnapshot, registrationSnapshot, proofSnapshot] = await Promise.all([
        transaction.get(profileReference), transaction.get(periodReference), transaction.get(systemReference),
        transaction.get(slotReference), transaction.get(registrationReference), transaction.get(proofReference)
      ]);
      if (registrationSnapshot.exists) {
        const existing = registrationSnapshot.data();
        if (existing.active === false) throw new HttpsError('failed-precondition', 'Pendaftaran telah diarsipkan. Hubungi Admin ESORIA untuk pemulihan.');
        if (existing.submissionId === submissionId) return { registrationId, referenceNumber: existing.referenceNumber, duplicate: true };
        throw new HttpsError('already-exists', 'Anda sudah mendaftar pada kategori dan gelombang ini.');
      }
      if (proofSnapshot.exists) throw new HttpsError('already-exists', 'Bukti pembayaran untuk pendaftaran ini sudah ada.');
      const profile = profileSnapshot.data();
      if (!profileSnapshot.exists || profile?.profileComplete !== true || profile?.archived === true) throw new HttpsError('failed-precondition', 'Profil tidak aktif atau belum lengkap.');
      if (!periodSnapshot.exists || !slotSnapshot.exists) throw new HttpsError('not-found', 'Periode atau slot kompetisi tidak ditemukan.');
      const period = periodSnapshot.data();
      const system = systemSnapshot.data() || {};
      const slot = slotSnapshot.data();
      const now = nowMillis();
      if (system.openPeriodId !== periodId || system.acceptingRegistrations !== true || period.status !== 'open') throw new HttpsError('failed-precondition', 'Periode pendaftaran tidak sedang dibuka.');
      const openAt = timestampMillis(period.registrationOpenAt);
      const closeAt = timestampMillis(period.registrationCloseAt);
      if (!Number.isFinite(openAt) || !Number.isFinite(closeAt) || now < openAt || now > closeAt) throw new HttpsError('failed-precondition', 'Pendaftaran berada di luar jadwal.');
      const packageSettings = period.packages?.[packageId];
      const globalWave = period.waves?.[waveId];
      const selectedWave = packageSettings?.waves?.[waveId] || globalWave;
      if (!packageSettings || !selectedWave || packageSettings.enabled === false || selectedWave.enabled === false || slot.enabled === false) throw new HttpsError('failed-precondition', 'Kategori atau gelombang sedang dinonaktifkan.');
      const waveOpen = timestampMillis(selectedWave.registrationOpenAt || globalWave?.registrationOpenAt || period.registrationOpenAt);
      const waveClose = timestampMillis(selectedWave.registrationCloseAt || globalWave?.registrationCloseAt || period.registrationCloseAt);
      if (!Number.isFinite(waveOpen) || !Number.isFinite(waveClose) || now < waveOpen || now > waveClose) throw new HttpsError('failed-precondition', 'Jendela pendaftaran gelombang belum dibuka atau sudah ditutup.');
      const capacity = Number(slot.capacity || 0);
      const count = Number(slot.count || 0);
      const nextSequence = Number(slot.sequence || 0) + 1;
      if (capacity <= 0 || count >= capacity) throw new HttpsError('resource-exhausted', 'Slot kategori dan gelombang ini sudah penuh.');
      const referenceNumber = `ECF-${periodId}-${packageId.toUpperCase()}-${waveId === 'wave-01' ? 'W1' : 'W2'}-${String(nextSequence).padStart(4, '0')}`;
      const userName = requireString(profile.participantName || profile.legalName || profile.displayName, 'Nama peserta', 2, 100);
      const safeMembers = packageId === 'team' ? teamMembers.map((member) => ({
        name: requireString(member?.name, 'Nama anggota', 2, 100),
        email: requireString(member?.email, 'Email anggota', 5, 160).toLowerCase(),
        phone: cleanString(member?.phone, 20), institution: cleanString(member?.institution, 120),
        role: requireString(member?.role, 'Peran anggota', 2, 80), consent: member?.consent === true
      })) : [];
      if (safeMembers.some((member) => !member.consent)) throw new HttpsError('invalid-argument', 'Persetujuan seluruh anggota wajib dicentang.');
      const packageConfig = packageSettings;
      const waveConfig = packageSettings?.waves?.[waveId] || globalWave || WAVES[waveId];
      const registration = {
        registrationId, submissionId, referenceNumber, referenceSequence: nextSequence,
        periodId, periodLabel: cleanString(period.label || periodId, 100),
        userId: user.uid, userEmail: user.email, userName,
        package: packageId, packageLabel: cleanString(packageConfig.label || PACKAGES[packageId].label, 100),
        amount: cleanString(packageConfig.amountLabel || PACKAGES[packageId].amountLabel, 30),
        amountValue: Number(packageConfig.amountValue || PACKAGES[packageId].amountValue),
        wave: waveId, waveLabel: cleanString(waveConfig.label || WAVES[waveId].label, 120),
        skillStack: requireString(input.skillStack, 'Stack atau skill', 2, 160),
        portfolioUrl: optionalUrl(input.portfolioUrl),
        teamName: packageId === 'team' ? requireString(input.teamName, 'Nama tim', 2, 100) : '',
        memberCount: safeMembers.length, teamMembers: safeMembers,
        transferDate, transferDateAt: Timestamp.fromDate(new Date(`${transferDate}T00:00:00+07:00`)),
        senderName: requireString(input.senderName, 'Nama pengirim', 2, 120),
        senderInstitution: requireString(input.senderInstitution, 'Bank atau e-wallet', 2, 120),
        notes: cleanString(input.notes, 1000), status: 'menunggu', statusLabel: STATUS_LABELS.menunggu,
        paymentStatus: 'belum_diperiksa', paymentStatusLabel: PAYMENT_LABELS.belum_diperiksa,
        ticketNumber: '', ticketAssignedAt: null, rejectionReason: '', adminNotes: '',
        reviewedAt: null, reviewedByUid: '', reviewedByEmail: '', reviewRevision: 0,
        paymentProofAttached: true, proofStorage: 'firebase-storage', proofDuplicateSuspected: duplicateSuspected,
        proofStoragePath: proof.storagePath, proofSize: proofObject.sizeBytes, proofSha256: proofObject.sha256,
        proofUpdatedAt: SERVER_TIMESTAMP,
        profileSnapshot: {
          email: user.email, participantName: userName, phone: cleanString(profile.phone, 20),
          institution: cleanString(profile.institution, 150), city: cleanString(profile.city, 100),
          province: cleanString(profile.province, 100), primarySkill: cleanString(profile.primarySkill, 120)
        },
        active: true, deletedAt: null, deletedByUid: '', createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP
      };
      transaction.create(registrationReference, registration);
      transaction.create(proofReference, {
        registrationId, periodId, userId: user.uid, userEmail: user.email,
        fileName: cleanString(proof.fileName || 'bukti-transfer.jpg', 120), mimeType: 'image/jpeg',
        sizeBytes: proofObject.sizeBytes, width: proofObject.width || dimensions.width, height: proofObject.height || dimensions.height,
        storagePath: proof.storagePath, sha256: proofObject.sha256, replacementCount: 0,
        createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP
      });
      transaction.set(digestRef, {registrationIds: [...new Set([...usedBy, registrationId])].slice(-100), updatedAt: SERVER_TIMESTAMP}, {merge: true});
      transaction.update(slotReference, { count: count + 1, sequence: nextSequence, updatedAt: SERVER_TIMESTAMP });
      const eventKey = `registration_submitted_${registrationId}`;
      transaction.set(notificationRef(user.uid, eventKey), notificationData({
        userId: user.uid, actor: user, actorRole: 'user', type: 'registration',
        title: 'Pendaftaran berhasil dikirim',
        message: `${registration.packageLabel} · ${registration.waveLabel} sudah masuk antrean verifikasi.`,
        actionLabel: 'Lihat status', actionUrl: 'profil.html#riwayat-pendaftaran',
        sourceType: 'registration', sourceId: registrationId, eventKey
      }));
      transaction.set(auditRef(eventKey), auditData(user, 'registration.submitted', 'registration', registrationId, { periodId, package: packageId, wave: waveId, referenceNumber }));
      return { registrationId, referenceNumber, duplicate: false };
  });
  return result;
};

const replacePaymentProofHandler = async (request) => {
  const user = requireVerified(request);
  const registrationId = requireString(request.data?.registrationId, 'ID pendaftaran', 5, 250);
  const proof = request.data?.proof || {};
  const dimensions = proofDimensions(proof);
  const proofObject = await ensureProofObject({ user, registrationId, storagePath: cleanString(proof.storagePath, 500), sizeBytes: Number(proof.sizeBytes || 0), sha256: cleanString(proof.sha256, 64) });
  const registrationReference = db.doc(`registrations/${registrationId}`);
  const proofReference = db.doc(`paymentProofs/${registrationId}`);
  const digestRef = db.doc(`proofDigests/${proofObject.sha256}`);
  let previousPath = '';
  await db.runTransaction(async (transaction) => {
      const [registrationSnapshot, proofSnapshot, digest] = await Promise.all([transaction.get(registrationReference), transaction.get(proofReference), transaction.get(digestRef)]);
      const usedBy = Array.isArray(digest.data()?.registrationIds) ? digest.data().registrationIds : [];
      if (!registrationSnapshot.exists || registrationSnapshot.data().userId !== user.uid) throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
      const registration = registrationSnapshot.data();
      if (registration.active === false || registration.status === 'terverifikasi' || registration.proofPurgeInProgress === true) {
        throw new HttpsError('failed-precondition', 'Bukti tidak dapat diganti pada status pendaftaran ini.');
      }
      if (request.data.expectedProofSha256 !== registration.proofSha256) throw new HttpsError('aborted', 'Bukti telah berubah. Muat ulang sebelum mengganti.');
      previousPath = proofSnapshot.data()?.storagePath || registration.proofStoragePath || '';
      if (previousPath === proof.storagePath) throw new HttpsError('invalid-argument', 'Unggah file bukti baru untuk penggantian.');
      const replacementCount = Number(proofSnapshot.data()?.replacementCount || 0) + 1;
      transaction.set(proofReference, {
        registrationId, periodId: registration.periodId, userId: user.uid, userEmail: user.email,
        fileName: cleanString(proof.fileName || 'bukti-transfer.jpg', 120), mimeType: 'image/jpeg',
        sizeBytes: proofObject.sizeBytes, width: proofObject.width || dimensions.width, height: proofObject.height || dimensions.height,
        storagePath: proof.storagePath, sha256: proofObject.sha256, replacementCount,
        createdAt: proofSnapshot.data()?.createdAt || SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP
      }, { merge: true });
      transaction.update(registrationReference, {
        proofStoragePath: proof.storagePath, proofSize: proofObject.sizeBytes, proofSha256: proofObject.sha256,
        proofUpdatedAt: SERVER_TIMESTAMP, paymentStatus: 'belum_diperiksa', paymentStatusLabel: PAYMENT_LABELS.belum_diperiksa,
        status: 'menunggu', statusLabel: STATUS_LABELS.menunggu, previousRejectionReason: registration.rejectionReason || '', rejectionReason: '', paymentProofAttached: true, proofRetentionUntil: null, proofDuplicateSuspected: usedBy.some((entry) => entry !== registrationId),
        updatedAt: SERVER_TIMESTAMP
      });
      transaction.set(digestRef, {registrationIds: [...new Set([...usedBy, registrationId])].slice(-100), updatedAt: SERVER_TIMESTAMP}, {merge: true});
      const eventKey = `payment_proof_replaced_${registrationId}_${replacementCount}`;
      transaction.set(notificationRef(user.uid, eventKey), notificationData({
        userId: user.uid, actor: user, actorRole: 'user', type: 'payment',
        title: 'Bukti pembayaran diperbarui', message: 'Bukti baru sudah tersimpan dan kembali menunggu pemeriksaan admin.',
        actionLabel: 'Lihat status', actionUrl: 'profil.html#riwayat-pendaftaran', sourceType: 'registration', sourceId: registrationId, eventKey
      }));
      transaction.set(auditRef(eventKey), auditData(user, 'payment_proof.replaced', 'registration', registrationId, { replacementCount }));
  });
  if (previousPath && previousPath !== proof.storagePath) await safeDeleteFile(previousPath);
  return { ok: true };
};

async function reviewRegistrationCore(admin, input = {}) {
  const registrationId = requireString(input.registrationId, 'ID pendaftaran', 5, 250);
  const status = requireString(input.status, 'Status', 5, 30);
  const paymentStatus = requireString(input.paymentStatus, 'Status pembayaran', 5, 30);
  if (!Object.hasOwn(STATUS_LABELS, status) || !Object.hasOwn(PAYMENT_LABELS, paymentStatus)) throw new HttpsError('invalid-argument', 'Status review tidak valid.');
  const ticketNumber = normalizeTicket(input.ticketNumber);
  if (status === 'terverifikasi' && /^(?:ECF-){2,}/.test(ticketNumber)) throw new HttpsError('invalid-argument', 'Nomor tiket tidak boleh memiliki awalan ECF ganda.');
  const rejectionReason = cleanString(input.rejectionReason, 500);
  const adminNotes = cleanString(input.adminNotes, 1000);
  if (status === 'terverifikasi' && (paymentStatus !== 'sesuai' || ticketNumber.length < 3)) throw new HttpsError('invalid-argument', 'ACC memerlukan pembayaran sesuai dan nomor tiket.');
  if (status !== 'terverifikasi' && ticketNumber) throw new HttpsError('invalid-argument', 'Nomor tiket hanya untuk pendaftaran ACC.');
  if (status === 'ditolak' && rejectionReason.length < 5) throw new HttpsError('invalid-argument', 'Alasan penolakan wajib dijelaskan.');
  if (status === 'terverifikasi' && input.bankTransferConfirmed !== true) throw new HttpsError('failed-precondition', 'Periksa dana masuk pada mutasi rekening resmi dan centang konfirmasi sebelum ACC.');
  if (status === 'terverifikasi' && adminNotes.length < 5) throw new HttpsError('invalid-argument', 'Catatan dasar persetujuan pembayaran wajib diisi.');
  const reference = db.doc(`registrations/${registrationId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
    const current = snapshot.data();
    if (current.active === false || current.proofPurgeInProgress === true) {
      throw new HttpsError('failed-precondition', 'Pendaftaran sedang diarsipkan atau bukti pembayaran diproses.');
    }
    if (status === 'terverifikasi' && current.status !== 'terverifikasi' && current.paymentProofAttached !== true) {
      throw new HttpsError('failed-precondition', 'Bukti pembayaran harus tersedia sebelum pendaftaran diterima.');
    }
    if (!Number.isInteger(input.expectedReviewRevision) || input.expectedReviewRevision !== Number(current.reviewRevision || 0)) throw new HttpsError('aborted', 'Keputusan berubah di sesi lain. Muat ulang data.');
    if (status === 'terverifikasi' && current.proofDuplicateSuspected === true && adminNotes.length < 15) throw new HttpsError('failed-precondition', 'Bukti berpotensi berulang. Jelaskan hasil pemeriksaan terpisah dalam catatan minimal 15 karakter.');
    const oldTicket = cleanString(current.ticketNumber, 40);
    // ACC is a committed state, not an ordinary selection that can be toggled.
    if (current.status === 'terverifikasi' && status !== 'terverifikasi') {
      if (input.reviewAction !== 'cancel_acc' || status !== 'menunggu' || paymentStatus !== 'belum_diperiksa' || adminNotes.length < 10) {
        throw new HttpsError('failed-precondition', 'Gunakan Batalkan ACC dengan alasan minimal 10 karakter. Setelah batal, periksa kembali sebelum ACC ulang.');
      }
    }
    if (current.status === 'terverifikasi' && status === 'terverifikasi') {
      if (oldTicket === ticketNumber || input.reviewAction !== 'repair_ticket') {
        throw new HttpsError('failed-precondition', 'ACC sudah aktif. Hanya perbaikan tiket resmi dengan tindakan eksplisit yang diizinkan.');
      }
      if (normalizeTicket(current.referenceNumber) && ticketNumber !== normalizeTicket(current.referenceNumber)) {
        throw new HttpsError('invalid-argument', 'Nomor tiket perbaikan harus sama dengan referensi resmi yang dibuat server.');
      }
    }

    if (current.checkedIn === true && (status !== 'terverifikasi' || oldTicket !== ticketNumber)) {
      throw new HttpsError('failed-precondition', 'Peserta sudah check-in. Batalkan check-in lebih dulu sebelum mengganti status atau nomor tiket.');
    }
    const newTicketRef = ticketNumber ? db.doc(`ticketNumbers/${ticketNumber}`) : null;
    const oldTicketRef = oldTicket && oldTicket !== ticketNumber ? db.doc(`ticketNumbers/${oldTicket}`) : null;
    if (newTicketRef) {
      const ticketSnapshot = await transaction.get(newTicketRef);
      if (ticketSnapshot.exists && ticketSnapshot.data().registrationId !== registrationId) throw new HttpsError('already-exists', 'Nomor tiket sudah digunakan.');
    }
    const reviewRevision = Number(current.reviewRevision || 0) + 1;
    const proofRetentionUntil = status === 'terverifikasi' && current.paymentProofAttached === true
      ? (current.status === 'terverifikasi' && current.proofRetentionUntil
        ? current.proofRetentionUntil
        : Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000))
      : null;
    const keepCheckIn = status === 'terverifikasi' && current.status === 'terverifikasi' && oldTicket === ticketNumber;
    transaction.update(reference, {
      status, statusLabel: STATUS_LABELS[status], paymentStatus, paymentStatusLabel: PAYMENT_LABELS[paymentStatus],
      ticketNumber, ticketAssignedAt: ticketNumber ? SERVER_TIMESTAMP : null,
      rejectionReason: status === 'ditolak' ? rejectionReason : '', adminNotes,
      reviewedAt: SERVER_TIMESTAMP, reviewedByUid: admin.uid, reviewedByEmail: admin.email,
      reviewRevision, proofRetentionUntil, bankTransferConfirmed: status === 'terverifikasi' && input.bankTransferConfirmed === true,
      checkedIn: keepCheckIn ? current.checkedIn === true : false,
      checkedInAt: keepCheckIn ? current.checkedInAt || null : null,
      checkedInByUid: keepCheckIn ? current.checkedInByUid || '' : '',
      checkedInByEmail: keepCheckIn ? current.checkedInByEmail || '' : '',
      updatedAt: SERVER_TIMESTAMP
    });
    if (newTicketRef) transaction.set(newTicketRef, { ticketNumber, registrationId, userId: current.userId, periodId: current.periodId, assignedAt: SERVER_TIMESTAMP, assignedByUid: admin.uid });
    if (oldTicketRef) transaction.delete(oldTicketRef);
    const eventKey = `registration_review_${registrationId}_${reviewRevision}`;
    const title = status === 'terverifikasi' ? 'Pendaftaran diterima' : status === 'ditolak' ? 'Pendaftaran ditolak' : 'Status pendaftaran diperbarui';
    const message = status === 'terverifikasi'
      ? `Pembayaran terverifikasi. Nomor tiket Anda: ${ticketNumber}.`
      : status === 'ditolak' ? `Pendaftaran belum dapat diterima: ${rejectionReason}` : `Status terbaru: ${STATUS_LABELS[status]} · ${PAYMENT_LABELS[paymentStatus]}.`;
    transaction.set(notificationRef(current.userId, eventKey), notificationData({
      userId: current.userId, actor: admin, actorRole: 'admin', type: status === 'terverifikasi' ? 'ticket' : 'registration',
      title, message, actionLabel: 'Lihat status', actionUrl: 'profil.html#riwayat-pendaftaran',
      sourceType: 'registration', sourceId: registrationId, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(admin, input.reviewAction === 'cancel_acc' ? 'registration.acc_revoked' : input.reviewAction === 'repair_ticket' ? 'registration.ticket_repaired' : 'registration.reviewed', 'registration', registrationId, { status, paymentStatus, ticketNumber, rejectionReason, bankTransferConfirmed: input.bankTransferConfirmed === true, reviewAction: input.reviewAction || 'review', reason: adminNotes }));
  });
  return { ok: true, registrationId };
}

const reviewRegistrationHandler = async (request) => {
  const admin = await requireAdmin(request);
  return reviewRegistrationCore(admin, request.data || {});
};

const bulkReviewRegistrationsHandler = async (request) => {
  const admin = await requireAdmin(request);
  const items = Array.isArray(request.data?.items) ? request.data.items.slice(0, 20) : [];
  if (!items.length) throw new HttpsError('invalid-argument', 'Pilih minimal satu pendaftaran.');
  const results = [];
  for (const item of items) {
    try {
      const result = await reviewRegistrationCore(admin, item || {});
      results.push({ registrationId: result.registrationId, ok: true });
    } catch (error) {
      logger.warn('payment_batch_item_failed', {targetHash: hash(item?.registrationId || ''), code: error?.code || 'internal'});
      results.push({ registrationId: cleanString(item?.registrationId, 250), ok: false, error: error?.message || 'Gagal memproses pendaftaran.' });
    }
  }
  return { results, successCount: results.filter((item) => item.ok).length, failedCount: results.filter((item) => !item.ok).length };
};

const savePeriodHandler = async (request) => {
  const admin = await requireAdmin(request);
  const input = request.data || {};
  const periodId = requireString(input.periodId, 'ID periode', 4, 50);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new HttpsError('invalid-argument', 'ID periode harus berformat YYYY-MM.');
  const mode = cleanString(input.mode, 12);
  if (!['create', 'update'].includes(mode)) throw new HttpsError('invalid-argument', 'Pilih buat periode baru atau mode edit sebelum menyimpan.');
  const expectedRevision = Number(input.expectedRevision);
  if (mode === 'update' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new HttpsError('invalid-argument', 'Versi periode tidak valid. Muat ulang data.');
  const status = requireString(input.status, 'Status periode', 4, 20);
  if (!['draft', 'open', 'full', 'closed', 'completed'].includes(status)) throw new HttpsError('invalid-argument', 'Status periode tidak valid.');
  const registrationOpenAt = asTimestamp(input.registrationOpenAt, 'Pembukaan pendaftaran');
  const registrationCloseAt = asTimestamp(input.registrationCloseAt, 'Penutupan pendaftaran');
  const competitionStartAt = asTimestamp(input.competitionStartAt, 'Awal kompetisi');
  const announcementAt = asTimestamp(input.announcementAt, 'Pengumuman');
  if (!(registrationOpenAt.toMillis() < registrationCloseAt.toMillis() && registrationCloseAt.toMillis() <= announcementAt.toMillis())) {
    throw new HttpsError('invalid-argument', 'Urutan jadwal periode belum valid.');
  }
  const capacities = {};
  const enabledPackages = input.enabledPackages || {};
  const enabledPackageWaves = input.enabledPackageWaves || {};
  for (const packageId of Object.keys(PACKAGES)) {
    for (const waveId of Object.keys(WAVES)) {
      const key = `${packageId}_${waveId}`;
      const supplied = input.capacities?.[key];
      const capacity = supplied == null || supplied === '' ? 50 : Number(supplied);
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000) {
        throw new HttpsError('invalid-argument', `Kuota ${key} harus angka bulat antara 1 dan 10000.`);
      }
      capacities[key] = capacity;
    }
  }
  const periodReference = db.doc(`periods/${periodId}`);
  const systemReference = db.doc('system/registration');
  const slotReferences = Object.keys(PACKAGES).flatMap((packageId) => Object.keys(WAVES).map((waveId) => db.doc(`periodSlots/${slotIdFor(periodId, packageId, waveId)}`)));
  await db.runTransaction(async (transaction) => {
    const published = await transaction.get(db.collection('results').where('periodId', '==', periodId).where('published', '==', true).limit(1));
    if (!published.empty) throw new HttpsError('failed-precondition', 'Tarik pengumuman hasil sebelum mengubah jadwal atau kuota periode ini.');
    const [periodSnapshot, systemSnapshot, ...slotSnapshots] = await Promise.all([
      transaction.get(periodReference), transaction.get(systemReference),
      ...slotReferences.map((reference) => transaction.get(reference))
    ]);
    if (mode === 'create' && periodSnapshot.exists) throw new HttpsError('already-exists', `Periode ${periodId} sudah ada. Pilih Edit Periode untuk mengubahnya.`);
    if (mode === 'update' && !periodSnapshot.exists) throw new HttpsError('not-found', 'Periode tidak ditemukan. Muat ulang daftar periode.');
    const revision = periodSnapshot.exists ? Number(periodSnapshot.data().revision || 0) : 0;
    if (mode === 'update' && expectedRevision !== revision) throw new HttpsError('aborted', 'Periode telah diperbarui dari sesi lain. Muat ulang sebelum menyimpan lagi.');
    const currentOpenId = systemSnapshot.data()?.openPeriodId || '';
    // A previous month whose registration deadline has passed must not block a
    // future period. Active months still require an explicit close operation.
    let expiredPreviousPeriodRef = null;
    if (status === 'open' && currentOpenId && currentOpenId !== periodId) {
      const previousRef = db.doc(`periods/${currentOpenId}`);
      const previousSnapshot = await transaction.get(previousRef);
      const previousClose = previousSnapshot.exists
        ? timestampMillis(previousSnapshot.data().registrationCloseAt) : 0;
      if (!previousSnapshot.exists || !previousClose || previousClose >= Date.now()) {
        throw new HttpsError('failed-precondition',
          `Periode ${currentOpenId} masih terpilih. Tutup periode lama sebelum menggantinya.`);
      }
      expiredPreviousPeriodRef = previousRef;
    }
    const waves = {};
    for (const waveId of Object.keys(WAVES)) {
      const waveInput = input.waves?.[waveId] || {};
      waves[waveId] = {
        id: waveId, label: cleanString(waveInput.label || WAVES[waveId].label, 120),
        enabled: Object.keys(PACKAGES).some((packageId) => enabledPackageWaves?.[packageId]?.[waveId] === true),
        startsAt: asTimestamp(waveInput.startsAt, `${waveId} mulai`),
        closesAt: asTimestamp(waveInput.closesAt, `${waveId} selesai`),
        registrationOpenAt: asTimestamp(waveInput.registrationOpenAt || input.registrationOpenAt, `${waveId} buka`),
        registrationCloseAt: asTimestamp(waveInput.registrationCloseAt || input.registrationCloseAt, `${waveId} tutup`)
      };
    }
    const packages = {};
    for (const packageId of Object.keys(PACKAGES)) {
      const packageInput = input.packages?.[packageId] || {};
      packages[packageId] = {
        id: packageId, label: cleanString(packageInput.label || PACKAGES[packageId].label, 100),
        amountLabel: PACKAGES[packageId].amountLabel,
        amountValue: PACKAGES[packageId].amountValue,
        enabled: enabledPackages?.[packageId] === true,
        waves: {}
      };
      for (const waveId of Object.keys(WAVES)) {
        const schedule = packageInput.waves?.[waveId] || input.categorySchedules?.[packageId]?.[waveId] || {};
        packages[packageId].waves[waveId] = {
          enabled: enabledPackageWaves?.[packageId]?.[waveId] === true,
          label: cleanString(schedule.label || WAVES[waveId].label, 120),
          startsAt: asTimestamp(schedule.startsAt || input.waves?.[waveId]?.startsAt, `${packageId} ${waveId} mulai`),
          deadlineAt: asTimestamp(schedule.deadlineAt || input.waves?.[waveId]?.closesAt, `${packageId} ${waveId} deadline`),
          announcementAt: asTimestamp(schedule.announcementAt || input.announcementAt, `${packageId} ${waveId} pengumuman`),
          registrationOpenAt: asTimestamp(schedule.registrationOpenAt || input.waves?.[waveId]?.registrationOpenAt || input.registrationOpenAt, `${packageId} ${waveId} buka`),
          registrationCloseAt: asTimestamp(schedule.registrationCloseAt || input.waves?.[waveId]?.registrationCloseAt || input.registrationCloseAt, `${packageId} ${waveId} tutup`)
        };
        const configuredWave = packages[packageId].waves[waveId];
        const regStart = configuredWave.registrationOpenAt.toMillis();
        const regEnd = configuredWave.registrationCloseAt.toMillis();
        const competitionStart = configuredWave.startsAt.toMillis();
        if (!(registrationOpenAt.toMillis() <= regStart
          && regStart < regEnd
          && regEnd <= registrationCloseAt.toMillis()
          && regEnd < competitionStart)) {
          throw new HttpsError('invalid-argument', `Pendaftaran ${packageId} ${waveId} harus berada dalam periode dan ditutup sebelum lomba dimulai.`);
        }
        if (!(competitionStart < configuredWave.deadlineAt.toMillis()
          && configuredWave.deadlineAt.toMillis() <= configuredWave.announcementAt.toMillis())) {
          throw new HttpsError('invalid-argument', `Urutan pelaksanaan, deadline, dan pengumuman ${packageId} ${waveId} tidak valid.`);
        }
      }
    }
    const periodPayload = {
      periodId, label: cleanString(input.label || `Esoria CodeFest ${periodId}`, 100), status,
      registrationOpenAt, registrationCloseAt, competitionStartAt, announcementAt,
      waves, packages, capacities, revision: revision + 1, timeZone: 'Asia/Jakarta',
      createdAt: periodSnapshot.exists ? periodSnapshot.data().createdAt || SERVER_TIMESTAMP : SERVER_TIMESTAMP,
      // Period documents are public. Admin details belong exclusively in auditLogs.
      createdByUid: FieldValue.delete(), updatedByUid: FieldValue.delete(),
      updatedByEmail: FieldValue.delete(), updatedAt: SERVER_TIMESTAMP
    };
    transaction.set(periodReference, periodPayload, { merge: true });
    if (expiredPreviousPeriodRef) {
      transaction.update(expiredPreviousPeriodRef, { status: 'closed', updatedAt: SERVER_TIMESTAMP });
    }
    slotReferences.forEach((reference, index) => {
      const [packageId, waveId] = Object.keys(PACKAGES).flatMap((p) => Object.keys(WAVES).map((w) => [p, w]))[index];
      const existing = slotSnapshots[index].exists ? slotSnapshots[index].data() : {};
      const key = `${packageId}_${waveId}`;
      if (capacities[key] < Number(existing.count || 0)) {
        throw new HttpsError('failed-precondition', `Kuota ${key} tidak boleh lebih kecil daripada jumlah pendaftar yang sudah memakai slot.`);
      }
      transaction.set(reference, {
        slotId: reference.id, periodId, package: packageId, wave: waveId,
        enabled: enabledPackageWaves?.[packageId]?.[waveId] === true,
        capacity: capacities[key], count: Math.max(0, Number(existing.count || 0)),
        sequence: Math.max(0, Number(existing.sequence || 0)),
        createdAt: existing.createdAt || SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP
      }, { merge: true });
    });
    if (status === 'open' || currentOpenId === periodId) {
      // true means administratively enabled; request-time checks enforce the
      // opening and closing dates without needing a scheduler to flip the bit.
      transaction.set(systemReference, {
        openPeriodId: status === 'open' ? periodId : '',
        acceptingRegistrations: status === 'open',
        status, registrationOpenAt, registrationCloseAt, updatedAt: SERVER_TIMESTAMP,
        updatedByUid: FieldValue.delete(), updatedByEmail: FieldValue.delete()
      }, { merge: true });
    }
    const eventKey = `period_saved_${periodId}_${Date.now()}`;
    transaction.set(auditRef(eventKey), auditData(admin, periodSnapshot.exists ? 'period.updated' : 'period.created', 'period', periodId, { status, capacities }));
  });
  return { ok: true, periodId };
};

// A draft may be removed only before any registration/slot use. Operational
// and historical periods are closed/completed instead of being deleted.
const deletePeriodHandler = async (request) => {
  const admin = await requireAdmin(request);
  const periodId = requireString(request.data?.periodId, 'ID periode', 7, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new HttpsError('invalid-argument', 'Bulan periode tidak valid.');
  const ref = db.doc(`periods/${periodId}`);
  const systemRef = db.doc('system/registration');
  const slotRefs = Object.keys(PACKAGES).flatMap((category) => Object.keys(WAVES).map((wave) => db.doc(`periodSlots/${slotIdFor(periodId, category, wave)}`)));
  const registrationsRef = db.collection('registrations').where('periodId', '==', periodId).limit(1);
  await db.runTransaction(async (transaction) => {
    const [period, system, registrations, ...slots] = await Promise.all([
      transaction.get(ref), transaction.get(systemRef), transaction.get(registrationsRef),
      ...slotRefs.map((slot) => transaction.get(slot))
    ]);
    if (!period.exists) throw new HttpsError('not-found', 'Periode ini sudah tidak ada.');
    if (period.data().status !== 'draft') throw new HttpsError('failed-precondition', 'Hanya periode Draft yang boleh dihapus. Tutup periode berjalan tanpa menghapus riwayatnya.');
    if (system.data()?.openPeriodId === periodId) throw new HttpsError('failed-precondition', 'Periode aktif tidak boleh dihapus.');
    if (!registrations.empty || slots.some((slot) => slot.exists && (Number(slot.data().count || 0) > 0 || Number(slot.data().sequence || 0) > 0))) {
      throw new HttpsError('failed-precondition', 'Periode memiliki data pendaftaran atau riwayat slot; tidak dapat dihapus.');
    }
    slots.forEach((slot, index) => { if (slot.exists) transaction.delete(slotRefs[index]); });
    transaction.delete(ref);
    transaction.set(auditRef(`period_deleted_${periodId}_${Date.now()}`), auditData(admin, 'period.deleted', 'period', periodId, { priorStatus: 'draft' }));
  });
  return { ok: true, periodId };
};

const checkInRegistrationHandler = async (request) => {
  const admin = await requireAdmin(request);
  const registrationId = requireString(request.data?.registrationId, 'ID pendaftaran', 5, 250);
  if (typeof request.data?.checkedIn !== 'boolean') throw new HttpsError('invalid-argument', 'Status check-in harus berupa pilihan ya/tidak yang valid.');
  const checkedIn = request.data.checkedIn;
  const reference = db.doc(`registrations/${registrationId}`);
  const changed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
    const current = snapshot.data();
    if (current.active === false || current.status !== 'terverifikasi' || !current.ticketNumber) throw new HttpsError('failed-precondition', 'Check-in hanya tersedia untuk tiket aktif yang sudah memiliki nomor tiket ACC.');
    if (checkedIn && normalizeTicket(current.ticketNumber) !== normalizeTicket(current.referenceNumber)) throw new HttpsError('failed-precondition', 'Nomor tiket perlu diperbaiki agar sesuai referensi resmi sebelum check-in.');
    // A retry must not generate another check-in audit or notification.
    if ((current.checkedIn === true) === checkedIn) return false;
    const revision = Number(current.checkInRevision || 0) + 1;
    transaction.update(reference, {
      checkedIn, checkedInAt: checkedIn ? SERVER_TIMESTAMP : null,
      checkedInByUid: checkedIn ? admin.uid : '', checkedInByEmail: checkedIn ? admin.email : '',
      checkInRevision: revision, updatedAt: SERVER_TIMESTAMP
    });
    const eventKey = `registration_checkin_${registrationId}_${revision}`;
    transaction.set(notificationRef(current.userId, eventKey), notificationData({
      userId: current.userId, actor: admin, actorRole: 'admin', type: 'ticket',
      title: checkedIn ? 'Check-in peserta tercatat' : 'Status check-in dibatalkan',
      message: checkedIn ? `Kehadiran untuk tiket ${current.ticketNumber || current.referenceNumber} sudah dicatat panitia.` : 'Status kehadiran dibatalkan oleh panitia.',
      actionLabel: 'Lihat tiket', actionUrl: 'profil.html#riwayat-pendaftaran', sourceType: 'registration', sourceId: registrationId, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(admin, checkedIn ? 'registration.checked_in' : 'registration.checkin_reverted', 'registration', registrationId));
    return true;
  });
  return { ok: true, checkedIn, unchanged: !changed };
};

const softDeleteRegistrationHandler = async (request) => {
  const admin = await requireAdmin(request);
  const registrationId = requireString(request.data?.registrationId, 'ID pendaftaran', 5, 250);
  const reference = db.doc(`registrations/${registrationId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
    const current = snapshot.data();
    if (current.active === false) return;
    // Archiving a checked-in participant must not silently hide attendance or
    // later resurrect it when the record is restored. Revert check-in first.
    if (current.checkedIn === true) throw new HttpsError('failed-precondition', 'Batalkan check-in peserta secara eksplisit sebelum mengarsipkan pendaftaran.');
    if (current.status === 'terverifikasi') throw new HttpsError('failed-precondition', 'Batalkan ACC terlebih dahulu sebelum mengarsipkan pendaftaran agar nomor tiket resmi dinonaktifkan.');
    const slotReference = db.doc(`periodSlots/${slotIdFor(current.periodId, current.package, current.wave)}`);
    const slotSnapshot = await transaction.get(slotReference);
    transaction.update(reference, { active: false, deletedAt: SERVER_TIMESTAMP, deletedByUid: admin.uid, updatedAt: SERVER_TIMESTAMP });
    if (slotSnapshot.exists) transaction.update(slotReference, { count: Math.max(0, Number(slotSnapshot.data().count || 0) - 1), updatedAt: SERVER_TIMESTAMP });
    const eventKey = `registration_archived_${registrationId}`;
    transaction.set(notificationRef(current.userId, eventKey), notificationData({ userId: current.userId, actor: admin, actorRole: 'admin', type: 'registration', title: 'Pendaftaran diarsipkan', message: 'Pendaftaran ini diarsipkan oleh admin. Hubungi panitia bila diperlukan.', sourceType: 'registration', sourceId: registrationId, eventKey }));
    transaction.set(auditRef(eventKey), auditData(admin, 'registration.soft_deleted', 'registration', registrationId));
  });
  return { ok: true };
};

const restoreRegistrationHandler = async (request) => {
  const admin = await requireAdmin(request);
  const registrationId = requireString(request.data?.registrationId, 'ID pendaftaran', 5, 250);
  const reference = db.doc(`registrations/${registrationId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
    const current = snapshot.data();
    if (current.active !== false) return;
    const slotReference = db.doc(`periodSlots/${slotIdFor(current.periodId, current.package, current.wave)}`);
    const slotSnapshot = await transaction.get(slotReference);
    if (!slotSnapshot.exists || Number(slotSnapshot.data().count || 0) >= Number(slotSnapshot.data().capacity || 0)) throw new HttpsError('resource-exhausted', 'Slot sudah penuh atau tidak tersedia.');
    transaction.update(reference, { active: true, deletedAt: null, deletedByUid: '', updatedAt: SERVER_TIMESTAMP });
    transaction.update(slotReference, { count: Number(slotSnapshot.data().count || 0) + 1, updatedAt: SERVER_TIMESTAMP });
    const eventKey = `registration_restored_${registrationId}_${Date.now()}`;
    transaction.set(notificationRef(current.userId, eventKey), notificationData({ userId: current.userId, actor: admin, actorRole: 'admin', type: 'registration', title: 'Pendaftaran dipulihkan', message: 'Pendaftaran kembali aktif dan slot telah dipulihkan.', actionLabel: 'Lihat status', actionUrl: 'profil.html#riwayat-pendaftaran', sourceType: 'registration', sourceId: registrationId, eventKey }));
    transaction.set(auditRef(eventKey), auditData(admin, 'registration.restored', 'registration', registrationId));
  });
  return { ok: true };
};

const reviewProfileEditRequestHandler = async (request) => {
  const admin = await requireAdmin(request);
  const uid = requireString(request.data?.uid, 'UID peserta', 5, 128);
  const status = requireString(request.data?.status, 'Keputusan', 5, 20);
  if (!['approved', 'rejected'].includes(status)) throw new HttpsError('invalid-argument', 'Keputusan tidak valid.');
  const reviewNote = cleanString(request.data?.reviewNote, 500);
  if (status === 'rejected' && reviewNote.length < 5) throw new HttpsError('invalid-argument', 'Alasan penolakan wajib dijelaskan.');
  const reference = db.doc(`profileEditRequests/${uid}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data().status !== 'pending') throw new HttpsError('failed-precondition', 'Permintaan tidak ditemukan atau sudah diproses.');
    transaction.update(reference, { status, reviewNote, reviewedAt: SERVER_TIMESTAMP, reviewedByUid: admin.uid, reviewedByEmail: admin.email, approvedAt: status === 'approved' ? SERVER_TIMESTAMP : null, updatedAt: SERVER_TIMESTAMP });
    const eventKey = `profile_edit_${status}_${uid}_${Number(snapshot.data().attemptCount || 1)}`;
    transaction.set(notificationRef(uid, eventKey), notificationData({
      userId: uid, actor: admin, actorRole: 'admin', type: 'profile',
      title: status === 'approved' ? 'Akses edit profil dibuka' : 'Permintaan edit ditolak',
      message: status === 'approved' ? 'Admin menyetujui permintaan Anda. Profil dapat diubah satu kali.' : `Permintaan perubahan belum disetujui: ${reviewNote}`,
      actionLabel: 'Buka profil', actionUrl: 'profil.html', sourceType: 'profileEditRequest', sourceId: uid, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(admin, status === 'approved' ? 'profile_edit.approved' : 'profile_edit.rejected', 'profileEditRequest', uid, { reviewNote }));
  });
  return { ok: true };
};

const updateParticipantProfileHandler = async (request) => {
  const admin = await requireAdmin(request);
  const input = request.data || {};
  const uid = requireString(input.uid, 'UID peserta', 5, 128);
  if (await getAdminRecord(uid)) throw new HttpsError('failed-precondition', 'Akun administrator tidak dapat diubah melalui data peserta.');
  const birthDate = requireString(input.birthDate, 'Tanggal lahir', 10, 10);
  const age = calculateAge(birthDate);
  if (!Number.isInteger(age) || age < 0 || age > 120) throw new HttpsError('invalid-argument', 'Umur peserta belum valid.');
  const participantName = requireString(input.participantName, 'Nama peserta', 2, 100);
  const phone = requireString(input.phone, 'Nomor telepon', 9, 20);
  if (!/^\+62[0-9]{8,13}$/.test(phone)) throw new HttpsError('invalid-argument', 'Nomor telepon harus format +62.');
  const reference = db.doc(`users/${uid}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Profil peserta tidak ditemukan.');
    const profileVersion = Number(snapshot.data().profileVersion || 0) + 1;
    transaction.set(reference, {
    participantName, legalName: requireString(input.legalName || participantName, 'Nama legal', 2, 100), displayName: participantName,
    birthDate, age, ageComputedAt: wibDateValue(), gender: profileChoice('gender', input.gender, 'Jenis kelamin'), phone,
    occupation: profileChoice('occupation', input.occupation, 'Status utama'), institution: cleanString(input.institution, 150),
    city: requireString(input.city, 'Kota', 2, 100), province: requireString(input.province, 'Provinsi', 2, 100),
    address: cleanString(input.address, 500), primarySkill: requireString(input.primarySkill, 'Keahlian', 2, 120),
    experienceLevel: profileChoice('experienceLevel', input.experienceLevel, 'Tingkat pengalaman'),
    preferredTrack: profileChoice('preferredTrack', input.preferredTrack, 'Kategori minat'),
    portfolioUrl: optionalUrl(input.portfolioUrl), bio: cleanString(input.bio, 300),
    profileComplete: true, profileLocked: true, profileLockedAt: SERVER_TIMESTAMP, profileVersion, updatedAt: SERVER_TIMESTAMP
    }, { merge: true });
    const eventKey = `participant_profile_updated_${uid}_${profileVersion}`;
    transaction.set(notificationRef(uid, eventKey), notificationData({ userId: uid, actor: admin, actorRole: 'admin', type: 'profile', title: 'Profil diperbarui admin', message: 'Data profil utama telah diperbarui oleh admin.', actionLabel: 'Periksa profil', actionUrl: 'profil.html', sourceType: 'user', sourceId: uid, eventKey }));
    transaction.set(auditRef(eventKey), auditData(admin, 'participant.profile_updated', 'user', uid, { participantName, age }));
  });
  return { ok: true, age };
};

const archiveParticipantHandler = async (request) => {
  const admin = await requireAdmin(request);
  const uid = requireString(request.data?.uid, 'UID peserta', 5, 128);
  if (uid === admin.uid || await getAdminRecord(uid)) {
    throw new HttpsError('failed-precondition', 'Akun administrator aktif tidak dapat diarsipkan sebagai peserta.');
  }
  await auth.updateUser(uid, { disabled: true });
  try {
    const eventKey = `participant_archived_${uid}_${Date.now()}`;
    await Promise.all([
      db.doc(`users/${uid}`).set({ archived: true, archivedAt: SERVER_TIMESTAMP, archivedByUid: admin.uid, updatedAt: SERVER_TIMESTAMP }, { merge: true }),
      notificationRef(uid, eventKey).set(notificationData({ userId: uid, actor: admin, actorRole: 'admin', type: 'account', title: 'Akun diarsipkan', message: 'Akses aplikasi dinonaktifkan oleh admin. Hubungi panitia bila diperlukan.', sourceType: 'user', sourceId: uid, eventKey })),
      auditRef(eventKey).set(auditData(admin, 'participant.archived', 'user', uid, { authAccountDisabled: true }))
    ]);
  } catch (error) {
    await auth.updateUser(uid, { disabled: false }).catch(() => {});
    throw error;
  }
  return { ok: true, authAccountDisabled: true };
};

const restoreParticipantHandler = async (request) => {
  const admin = await requireAdmin(request);
  const uid = requireString(request.data?.uid, 'UID peserta', 5, 128);
  if (await getAdminRecord(uid)) {
    throw new HttpsError('failed-precondition', 'Akun administrator bukan peserta dan tidak dapat dipulihkan dari panel peserta.');
  }
  await auth.updateUser(uid, { disabled: false });
  const eventKey = `participant_restored_${uid}_${Date.now()}`;
  await Promise.all([
    db.doc(`users/${uid}`).set({ archived: false, archivedAt: null, archivedByUid: '', updatedAt: SERVER_TIMESTAMP }, { merge: true }),
    notificationRef(uid, eventKey).set(notificationData({ userId: uid, actor: admin, actorRole: 'admin', type: 'account', title: 'Akun dipulihkan', message: 'Profil kembali aktif dan dapat digunakan untuk masuk.', actionLabel: 'Buka profil', actionUrl: 'profil.html', sourceType: 'user', sourceId: uid, eventKey })),
    auditRef(eventKey).set(auditData(admin, 'participant.restored', 'user', uid, { authAccountDisabled: false }))
  ]);
  return { ok: true };
};

// A two-phase purge permits retry after a crash and blocks concurrent review or
// proof replacement while an object is being permanently deleted.
const purgePaymentProofCore = async (registrationId, actor, automated = false) => {
  const registrationReference = db.doc(`registrations/${registrationId}`);
  const proofReference = db.doc(`paymentProofs/${registrationId}`);
  const lock = await db.runTransaction(async (transaction) => {
    const [registrationSnapshot, proofSnapshot] = await Promise.all([
      transaction.get(registrationReference), transaction.get(proofReference)
    ]);
    if (!registrationSnapshot.exists) {
      if (automated) return null;
      throw new HttpsError('not-found', 'Pendaftaran tidak ditemukan.');
    }
    const registration = registrationSnapshot.data();
    if (!proofSnapshot.exists || registration.paymentProofAttached !== true) {
      if (automated) return null;
      throw new HttpsError('failed-precondition', 'Bukti pembayaran sudah tidak tersedia.');
    }
    const until = timestampMillis(registration.proofRetentionUntil);
    if (automated && (registration.status !== 'terverifikasi' || !Number.isFinite(until) || until > Date.now())) return null;
    const startedAt = timestampMillis(registration.proofPurgeStartedAt);
    if (registration.proofPurgeInProgress === true && startedAt && Date.now() - startedAt < 15 * 60 * 1000) {
      if (automated) return null;
      throw new HttpsError('failed-precondition', 'Bukti pembayaran sedang diproses.');
    }
    const storagePath = proofSnapshot.data().storagePath;
    if (storagePath !== registration.proofStoragePath
        || !storagePath?.startsWith(`payment-proofs/${registration.userId}/${registrationId}/`)) {
      throw new HttpsError('failed-precondition', 'Path bukti pembayaran tidak konsisten.');
    }
    transaction.update(registrationReference, {
      proofPurgeInProgress: true, proofPurgeStartedAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP
    });
    return { storagePath, userId: registration.userId };
  });
  if (!lock) return { ok: true, skipped: true };
  try {
    await bucket.file(lock.storagePath).delete({ ignoreNotFound: true });
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(registrationReference);
      if (snapshot.exists && snapshot.data().proofStoragePath === lock.storagePath) {
        transaction.update(registrationReference, { proofPurgeInProgress: false, updatedAt: SERVER_TIMESTAMP });
      }
    }).catch((recoveryError) => logger.error('payment_purge_recovery_failed', {code: recoveryError?.code || 'internal'}));
    throw error;
  }
  await db.runTransaction(async (transaction) => {
    const [registrationSnapshot, proofSnapshot] = await Promise.all([
      transaction.get(registrationReference), transaction.get(proofReference)
    ]);
    if (!registrationSnapshot.exists || registrationSnapshot.data().proofStoragePath !== lock.storagePath) {
      throw new HttpsError('failed-precondition', 'Dokumen bukti berubah selama penghapusan.');
    }
    const current = registrationSnapshot.data();
    if (proofSnapshot.exists && proofSnapshot.data().storagePath !== lock.storagePath) {
      throw new HttpsError('failed-precondition', 'Metadata bukti berubah selama penghapusan.');
    }
    if (proofSnapshot.exists) transaction.delete(proofReference);
    transaction.update(registrationReference, {
      paymentProofAttached: false, proofStoragePath: '', proofSize: 0,
      // Retain the cryptographic digest in the registration for auditing.
      proofPurgedAt: SERVER_TIMESTAMP, proofPurgedByUid: actor?.uid || 'system',
      proofPurgeInProgress: false, proofPurgeStartedAt: null,
      updatedAt: SERVER_TIMESTAMP
    });
    const eventKey = `payment_proof_purged_${registrationId}`;
    transaction.set(notificationRef(lock.userId, eventKey), notificationData({
      userId: lock.userId, actor, actorRole: automated ? 'system' : 'admin', type: 'payment',
      title: 'Bukti pembayaran dihapus',
      message: 'Bukti pembayaran dihapus sesuai kebijakan retensi data; catatan transaksi tetap tersedia.',
      sourceType: 'registration', sourceId: registrationId, eventKey
    }));
    transaction.set(auditRef(eventKey), auditData(actor || { role: 'system' }, 'payment_proof.purged',
      'registration', registrationId, { automated, sha256Retained: Boolean(current.proofSha256) }));
  });
  return { ok: true };
};

const purgePaymentProofHandler = async (request) => {
  const admin = await requireAdmin(request);
  const registrationId = requireString(request.data?.registrationId, 'ID pendaftaran', 5, 250);
  return purgePaymentProofCore(registrationId, admin);
};

// Daily purge, at 03:15 WIB. Firestore composite index declared in
// firestore.indexes.json; deployment creates a Cloud Scheduler job (Blaze).
export const purgeExpiredPaymentProofs = onSchedule({
  schedule: '15 3 * * *', timeZone: 'Asia/Jakarta',
  region: REGION, memory: '512MiB', maxInstances: 1, timeoutSeconds: 540
}, async () => {
  const due = await db.collection('registrations')
    .where('paymentProofAttached', '==', true)
    .where('proofRetentionUntil', '<=', Timestamp.now())
    .limit(100).get();
  let purged = 0;
  let failed = 0;
  for (const item of due.docs) {
    try {
      const result = await purgePaymentProofCore(item.id, { uid: 'system', role: 'system' }, true);
      if (!result.skipped) purged += 1;
    } catch (error) {
      failed += 1;
      logger.error('payment_retention_failed', {targetHash: hash(item.id), code: error?.code || 'internal'});
    }
  }
  logger.info('Pembersihan bukti selesai', { inspected: due.size, purged, failed });
});

const rebuildDashboardMetricsHandler = async (request) => {
  await requireAdmin(request);
  return rebuildMetrics();
};

async function rebuildMetrics() {
  const [users, registrations, pending, verified, editRequests, admins] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('registrations').where('active', '==', true).count().get(),
    db.collection('registrations').where('active', '==', true).where('status', '==', 'menunggu').count().get(),
    db.collection('registrations').where('active', '==', true).where('status', '==', 'terverifikasi').count().get(),
    db.collection('profileEditRequests').where('status', '==', 'pending').count().get(),
    db.collection('admins').get()
  ]);
  // Historical admin accounts may still have users/{uid} from earlier releases.
  const adminUserSnapshots = await Promise.all(admins.docs.map((entry) => db.doc(`users/${entry.id}`).get()));
  const legacyAdminProfiles = adminUserSnapshots.filter((entry) => entry.exists).length;
  const payload = {
    users: Math.max(0, users.data().count - legacyAdminProfiles), registrations: registrations.data().count,
    pending: pending.data().count, verified: verified.data().count,
    editRequests: editRequests.data().count, updatedAt: SERVER_TIMESTAMP
  };
  await db.doc('system/dashboard').set(payload, { merge: true });
  return payload;
}

const pushTokenId = (token) => hash(token);
const validPushToken = (value) => typeof value === 'string'
  && value.length >= 50 && value.length <= 4096 && /^[A-Za-z0-9:._~-]+$/.test(value);

const registerPushTokenHandler = async (request) => {
  const user = requireVerified(request);
  if (await getAdminRecord(user.uid)) {
    throw new HttpsError('permission-denied', 'Notifikasi peserta tidak tersedia untuk administrator.');
  }
  await requireActiveProfile(user.uid);
  const token = request.data?.token;
  if (!validPushToken(token)) throw new HttpsError('invalid-argument', 'Token push tidak valid.');
  const id = pushTokenId(token);
  const ref = db.doc(`users/${user.uid}/pushTokens/${id}`);
  const ownerRef = db.doc(`pushTokenOwners/${id}`);
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(ownerRef);
    const previousUid = previous.exists ? previous.data()?.uid : null;
    if (previousUid && previousUid !== user.uid && /^[A-Za-z0-9_-]{1,128}$/.test(previousUid)) {
      transaction.delete(db.doc(`users/${previousUid}/pushTokens/${id}`));
    }
    transaction.set(ownerRef, { uid: user.uid, updatedAt: SERVER_TIMESTAMP });
    transaction.set(ref, { token, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP });
  });
  return { ok: true };
};

const unregisterPushTokenHandler = async (request) => {
  const user = requireAuth(request);
  const token = request.data?.token;
  if (!validPushToken(token)) throw new HttpsError('invalid-argument', 'Token push tidak valid.');
  const id = pushTokenId(token);
  const ownerRef = db.doc(`pushTokenOwners/${id}`);
  await db.runTransaction(async (transaction) => {
    const owner = await transaction.get(ownerRef);
    transaction.delete(db.doc(`users/${user.uid}/pushTokens/${id}`));
    if (owner.exists && owner.data()?.uid === user.uid) transaction.delete(ownerRef);
  });
  return { ok: true };
};

// New in-app notifications are forwarded to opted-in browsers via FCM.
// The Firestore notification remains the source of truth if push is unavailable.
export const sendParticipantPush = onDocumentCreated({
  document: 'users/{uid}/notifications/{notificationId}',
  region: REGION,
  retry: false,
  memory: '256MiB',
  maxInstances: 3
}, async (event) => {
  const notification = event.data?.data();
  const uid = event.params?.uid;
  if (!notification || !uid || notification.userId !== uid) return;
  if (await getAdminRecord(uid)) return;
  const accountSnapshot = await db.doc(`users/${uid}`).get();
  if (!accountSnapshot.exists || accountSnapshot.data()?.archived === true) return;
  const tokensSnapshot = await db.collection(`users/${uid}/pushTokens`).limit(100).get();
  if (tokensSnapshot.empty) return;
  const entries = tokensSnapshot.docs.filter((entry) => validPushToken(entry.data()?.token));
  if (!entries.length) return;
  const destination = cleanString(notification.actionUrl, 300);
  const path = /^(profil[.]html|index[.]html|dashboard[.]html|submission[.]html|results[.]html)(?:[?#][^\\]*)?$/.test(destination)
    ? `/${destination}` : '/profil.html';
  const payload = {
    tokens: entries.map((entry) => entry.data().token),
    data: {
      // Avoid exposing payment/profile details on a locked or shared device.
      title: 'Pembaruan ESORIA CodeFest',
      body: 'Ada notifikasi baru. Masuk ke akun untuk melihat rinciannya.',
      url: path
    },
    webpush: { headers: { TTL: '86400' } }
  };
  const result = await getMessaging().sendEachForMulticast(payload);
  for (let i = 0; i < result.responses.length; i++) {
    const response = result.responses[i];
    if (response.success) continue;
    const code = response.error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      const id = entries[i].id;
      const ownerRef = db.doc(`pushTokenOwners/${id}`);
      await db.runTransaction(async (transaction) => {
        const owner = await transaction.get(ownerRef);
        if (owner.exists && owner.data()?.uid === uid) {
          transaction.delete(ownerRef);
          transaction.delete(entries[i].ref);
        }
      });
    } else {
      logger.warn('push_delivery_failed', {targetHash: hash(uid), code});
    }
  }
});

const competition = createCompetitionService({db, auth, bucket, Timestamp, FieldValue, HttpsError, requireVerified, requireAdmin, requireActiveProfile, auditData, auditRef, notificationData, notificationRef, reviewRegistrationCore, logger});

export const esoriaCtf = onCall({...callableOptions, timeoutSeconds: 60, secrets: ['CTF_FLAG_PEPPER']}, async (request) => {
  const user = requireVerified(request);
  await requireDeviceSession(request);
  await enforceActionQuota(user.uid, 'submitFlag');
  try { return await competition.submitFlag({...request, data: request.data?.payload || {}}); } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('ctf_request_failed', {code: 'internal'});
    throw new HttpsError('internal', 'Pemeriksaan flag belum tersedia. Hubungi panitia.');
  }
});
export const purgeStaleCompetitionFiles = onSchedule({schedule: 'every 24 hours', timeZone: 'Asia/Jakarta', region: REGION, timeoutSeconds: 300}, async () => {
  try {
    const result = await competition.purgeStaleUploads();
    logger.info('competition_upload_cleanup', result);
  } catch (error) {
    logger.error('competition_cleanup_failed', {code: error?.code || 'internal'});
    throw new Error('Competition cleanup could not complete.');
  }
});

const API_HANDLERS = Object.freeze({
  activateDeviceSession: activateDeviceSessionHandler,
  checkDeviceSession: checkDeviceSessionHandler,
  ...competition.handlers,
  serverClock: serverClockHandler,
  refreshAdminClaims: refreshAdminClaimsHandler,
  syncAdminMfaStatus: syncAdminMfaStatusHandler,
  logAdminCsvExport: logAdminCsvExportHandler,
  getSystemHealth: getSystemHealthHandler,
  ensureUserProfile: ensureUserProfileHandler,
  saveParticipantProfile: saveParticipantProfileHandler,
  saveProfilePhoto: saveProfilePhotoHandler,
  getProfilePhoto: getProfilePhotoHandler,
  submitProfileEditRequest: submitProfileEditRequestHandler,
  submitRegistration: submitRegistrationHandler,
  replacePaymentProof: replacePaymentProofHandler,
  reviewRegistration: reviewRegistrationHandler,
  bulkReviewRegistrations: bulkReviewRegistrationsHandler,
  savePeriod: savePeriodHandler,
  deletePeriod: deletePeriodHandler,
  checkInRegistration: checkInRegistrationHandler,
  softDeleteRegistration: softDeleteRegistrationHandler,
  restoreRegistration: restoreRegistrationHandler,
  reviewProfileEditRequest: reviewProfileEditRequestHandler,
  updateParticipantProfile: updateParticipantProfileHandler,
  archiveParticipant: archiveParticipantHandler,
  restoreParticipant: restoreParticipantHandler,
  purgePaymentProof: purgePaymentProofHandler,
  rebuildDashboardMetrics: rebuildDashboardMetricsHandler,
  registerPushToken: registerPushTokenHandler,
  unregisterPushToken: unregisterPushTokenHandler
});

const PARTICIPANT_ACTIONS = new Set([
  'ensureUserProfile', 'saveParticipantProfile', 'saveProfilePhoto', 'getProfilePhoto', 'submitProfileEditRequest',
  'getOwnRegistrationStatus', 'submitRegistration', 'replacePaymentProof', 'registerPushToken', 'getCompetitionMaterials'
]);

// Two explicitly public READ-ONLY actions, separate from App Check-protected user APIs.
// Do not route additional actions or privileged data through this endpoint.
const PUBLIC_RECORD_ACTIONS = Object.freeze({results: 'getPublishedResults', archive: 'getPublishedArchive', certificate: 'verifyCertificate'});
export const esoriaPublic = onRequest({
  region: REGION, invoker: 'public', cors: false, cpu: 'gcf_gen1',
  maxInstances: 3, memory: '512MiB', timeoutSeconds: 30
}, async (request, response) => {
  response.set('Cache-Control', 'no-store, max-age=0');
  response.set('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.set('Allow', 'GET');
    return response.status(405).json({ok: false, error: 'method-not-allowed'});
  }
  const kind = typeof request.query.kind === 'string' ? request.query.kind : '';
  const action = Object.hasOwn(PUBLIC_RECORD_ACTIONS, kind) ? PUBLIC_RECORD_ACTIONS[kind] : null;
  if (!action) return response.status(404).json({ok: false, error: 'not-found'});
  const payload = kind === 'results'
    ? {periodId: request.query.periodId, package: request.query.package, wave: request.query.wave}
    : kind === 'certificate' ? {certificateId: request.query.certificateId} : {};
  try {
    // Delegates to existing server validation, published status, announcement cutoff,
    // certificate revocation and public-safe field projections.
    const data = await competition.handlers[action]({data: payload});
    return response.status(200).json({ok: true, data});
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'invalid-argument')
      return response.status(400).json({ok: false, error: 'invalid-argument'});
    logger.warn('public_records_error', {kind, code: error instanceof HttpsError ? error.code : 'internal'});
    return response.status(503).json({ok: false, error: 'temporarily-unavailable'});
  }
});

export const esoriaApi = onCall(callableOptions, async (request) => {
  const action = cleanString(request.data?.action, 80);
  const handler = API_HANDLERS[action];
  if (!handler) throw new HttpsError('not-found', 'Aksi API tidak tersedia. Muat ulang aplikasi dan coba lagi.');
  if (request.auth?.uid && !['activateDeviceSession','checkDeviceSession','serverClock'].includes(action)) {
    await requireDeviceSession({auth:request.auth, data:{payload:request.data?.payload || {}}});
  }
  if (PARTICIPANT_ACTIONS.has(action) && request.auth?.uid) {
    const adminRecord = await getAdminRecord(request.auth.uid);
    if (adminRecord) throw new HttpsError('permission-denied', 'Administrator hanya dapat menggunakan panel admin, bukan fitur peserta. Gunakan akun member terpisah.');
  }
  await enforceAdminActionPolicy(request, action);
  const quotaIdentity = request.auth?.uid || hash(`anonymous:${request.rawRequest?.ip || 'unknown'}:${new Date().toISOString().slice(0,10)}`);
  await enforceActionQuota(quotaIdentity, action);
  const routedRequest = {
    auth: request.auth,
    app: request.app,
    rawRequest: request.rawRequest,
    data: request.data?.payload && typeof request.data.payload === 'object' ? request.data.payload : {}
  };
  const started = Date.now();
  try {
    const result = await handler(routedRequest);
    logger.info('api_request', {action, outcome: 'ok', durationMs: Date.now() - started});
    return result;
  } catch (error) {
    logger.warn('api_request', {action, outcome: 'error', code: error instanceof HttpsError ? error.code : 'internal', durationMs: Date.now() - started});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Layanan belum dapat menyelesaikan permintaan. Periksa status sebelum mencoba kembali.');
  }
});
