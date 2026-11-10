import {
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import {
  getBlob,
  ref as storageRef,
  uploadBytes
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import { auth, db, functions, runtimeConfig, storage } from './firebase-config.js?v=b74586eaa5ef6110';
import { serverNow, syncServerClock } from './server-clock.js?v=b74586eaa5ef6110';
import { sessionStore } from './safe-storage.js?v=b74586eaa5ef6110';
import { currentSessionKey } from './single-device-session.js?v=b74586eaa5ef6110';

export const PACKAGES = {
  web: { label: 'Website Programming', amountLabel: 'Rp100.000', amountValue: 100000 },
  cyber: { label: 'Cybersecurity Mini CTF', amountLabel: 'Rp250.000', amountValue: 250000 },
  team: { label: 'Full Stack Development Team', amountLabel: 'Rp500.000', amountValue: 500000 }
};

export const WAVES = {
  'wave-01': { label: 'Wave Awal Bulan — mulai tanggal 1' },
  'wave-02': { label: 'Wave Pertengahan Bulan — mulai tanggal 15' }
};

const esoriaApi = httpsCallable(functions, 'esoriaApi', {
  timeout: 540000,
  limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)
});
const invoke = async (action, payload = {}) => esoriaApi({ action, payload: {...payload,sessionKey:currentSessionKey()} });
const cleanString = (value, maximum = 500) => String(value ?? '').trim().slice(0, maximum);
const requireCurrentUser = async () => {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Masuk ke akun terlebih dahulu.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  await user.reload();
  if (!user.emailVerified) {
    const error = new Error('Verifikasi email sebelum melanjutkan.');
    error.code = 'functions/failed-precondition';
    throw error;
  }
  await user.getIdToken(true);
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah. Masuk kembali sebelum melanjutkan.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  return user;
};
const slotIdFor = (periodId, packageId, waveId) => `${periodId}__${packageId}__${waveId}`;
const registrationIdFor = (periodId, uid, packageId, waveId) => `${periodId}__${uid}__${packageId}__${waveId}`;
const timestampMillis = (value) => value?.toMillis?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : null);
const serializePeriod = (snapshot, slots = []) => {
  if (!snapshot?.exists()) return null;
  const data = snapshot.data();
  const counts = {};
  const capacities = { ...(data.capacities || {}) };
  slots.forEach((slot) => {
    const key = `${slot.package}_${slot.wave}`;
    counts[key] = Number(slot.count || 0);
    capacities[key] = Number(slot.capacity ?? capacities[key] ?? 0);
  });
  const mapTimestamp = (value) => timestampMillis(value);
  return {
    id: snapshot.id,
    ...data,
    registrationOpenAt: mapTimestamp(data.registrationOpenAt),
    registrationCloseAt: mapTimestamp(data.registrationCloseAt),
    competitionStartAt: mapTimestamp(data.competitionStartAt),
    announcementAt: mapTimestamp(data.announcementAt),
    waves: Object.fromEntries(Object.entries(data.waves || {}).map(([key, wave]) => [key, {
      ...wave,
      startsAt: mapTimestamp(wave.startsAt), closesAt: mapTimestamp(wave.closesAt),
      registrationOpenAt: mapTimestamp(wave.registrationOpenAt), registrationCloseAt: mapTimestamp(wave.registrationCloseAt)
    }])),
    packages: Object.fromEntries(Object.entries(data.packages || {}).map(([packageId, packageData]) => [packageId, {
      ...packageData,
      waves: Object.fromEntries(Object.entries(packageData?.waves || {}).map(([waveId, wave]) => [waveId, {
        ...wave,
        startsAt: mapTimestamp(wave.startsAt), deadlineAt: mapTimestamp(wave.deadlineAt), announcementAt: mapTimestamp(wave.announcementAt),
        registrationOpenAt: mapTimestamp(wave.registrationOpenAt), registrationCloseAt: mapTimestamp(wave.registrationCloseAt)
      }]))
    }])),
    capacities,
    counts
  };
};

const sha256Hex = async (blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const prepareProof = async (proof) => {
  if (!(proof?.blob instanceof Blob) || proof.blob.type !== 'image/jpeg') {
    const error = new Error('Bukti transfer harus diproses menjadi JPEG.');
    error.code = 'functions/invalid-argument';
    throw error;
  }
  if (proof.blob.size <= 0 || proof.blob.size > 360 * 1024) {
    const error = new Error('Bukti transfer maksimal 360 KB setelah kompresi.');
    error.code = 'functions/invalid-argument';
    throw error;
  }
  const width = Number(proof.width || 0);
  const height = Number(proof.height || 0);
  if (!Number.isInteger(width) || width < 1 || width > 1800 || !Number.isInteger(height) || height < 1 || height > 1800) {
    const error = new Error('Dimensi bukti transfer belum valid.');
    error.code = 'functions/invalid-argument';
    throw error;
  }
  return {
    blob: proof.blob,
    fileName: cleanString(proof.fileName || 'bukti-transfer.jpg', 120),
    sizeBytes: proof.blob.size,
    width,
    height,
    sha256: await sha256Hex(proof.blob)
  };
};
const uploadProof = async (user, registrationId, prepared) => {
  const assertSameAccount = () => {
    if (auth.currentUser?.uid !== user.uid) {
      const error = new Error('Akun berubah selama proses unggah. Masuk kembali dan ulangi tindakan dari akun yang benar.');
      error.code = 'functions/unauthenticated';
      throw error;
    }
  };
  assertSameAccount();
  const response = await invoke('createPaymentProofUpload', {registrationId, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256});
  assertSameAccount();
  const {uploadId, storagePath} = response.data;
  await uploadBytes(storageRef(storage, storagePath), prepared.blob, {
    contentType: 'image/jpeg', cacheControl: 'private,max-age=0,no-store',
    customMetadata: {ownerUid: user.uid, registrationId, sha256: prepared.sha256, uploadId}
  });
  assertSameAccount();
  return {...prepared, storagePath};
};

export const getRegistrationContext = async () => {
  await requireCurrentUser();
  const stateSnapshot = await getDoc(doc(db, 'system', 'registration'));
  const periodId = cleanString(stateSnapshot.data()?.openPeriodId, 50);
  await syncServerClock();
  if (!periodId) return { data: { serverNow: serverNow(), period: null, system: stateSnapshot.data() || null, accepting: false } };
  const [periodSnapshot, slotSnapshots] = await Promise.all([
    getDoc(doc(db, 'periods', periodId)),
    Promise.all(Object.keys(PACKAGES).flatMap((packageId) => Object.keys(WAVES).map((waveId) => getDoc(doc(db, 'periodSlots', slotIdFor(periodId, packageId, waveId))))))
  ]);
  if (!periodSnapshot.exists()) return { data: { serverNow: serverNow(), period: null, system: stateSnapshot.data() || null, accepting: false } };
  const period = serializePeriod(periodSnapshot, slotSnapshots.filter((item) => item.exists()).map((item) => item.data()));
  const now = serverNow();
  const state = stateSnapshot.data() || {};
  const accepting = state.acceptingRegistrations === true
    && state.openPeriodId === period.id
    && period.status === 'open'
    && Number.isFinite(period.registrationOpenAt)
    && Number.isFinite(period.registrationCloseAt)
    && period.registrationOpenAt <= now
    && period.registrationCloseAt >= now;
  return { data: { serverNow: now, period, system: state, accepting } };
};

export const submitRegistration = async (input = {}) => {
  const user = await requireCurrentUser();
  const periodId = cleanString(input.periodId, 50);
  const packageId = cleanString(input.package, 20);
  const waveId = cleanString(input.wave, 20);
  const registrationId = registrationIdFor(periodId, user.uid, packageId, waveId);
  // An interrupted submission can only be retried within the same account and slot.
  // The old unscoped session key could leak a retry token into another Member's flow.
  const submissionKey = `esoria-submission-id:${user.uid}:${periodId}:${packageId}:${waveId}`;
  sessionStore.removeItem('esoria-submission-id');
  // A brand-new registration is not readable under owner-only Firestore
  // Rules: it has no resource.data.userId yet. A private callable checks only
  // the signed-in member's own registration, without widening Rules.
  const preflight = await invoke('getOwnRegistrationStatus', {periodId, package: packageId, wave: waveId});
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah. Masuk lagi sebelum mengirim pendaftaran.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  if (preflight.data?.exists) {
    if (preflight.data.active === false) {
      const error = new Error('Pendaftaran sebelumnya telah diarsipkan. Hubungi Admin ESORIA untuk meminta pemulihan, bukan mengirim pembayaran baru.');
      error.code = 'functions/failed-precondition';
      throw error;
    }
    if (preflight.data.status === 'terverifikasi' || preflight.data.status === 'ditolak') {
      const accepted = preflight.data.status === 'terverifikasi';
      const error = new Error(accepted
        ? 'Pendaftaran ini sudah diterima. Nomor tiket dan status dapat dilihat melalui Profil.'
        : 'Pendaftaran sebelumnya telah ditolak. Periksa alasan penolakan di Profil, lalu hubungi Admin bila diperlukan.');
      error.code = 'functions/failed-precondition';
      throw error;
    }
    sessionStore.removeItem(submissionKey);
    return {data: {
      registrationId: preflight.data.registrationId,
      referenceNumber: preflight.data.referenceNumber,
      duplicate: true
    }};
  }
  const prepared = await prepareProof(input.proof);
  const proof = await uploadProof(user, registrationId, prepared);
  const submissionId = cleanString(input.submissionId || sessionStore.getItem(submissionKey) || crypto.randomUUID(), 180);
  sessionStore.setItem(submissionKey, submissionId);
  // Reject account switching between the upload and final API call.
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah selama unggahan. Masuk lagi sebelum mencoba kembali.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  const response = await invoke('submitRegistration', {
    ...input,
    submissionId,
    proof: {
      storagePath: proof.storagePath, fileName: proof.fileName, sizeBytes: proof.sizeBytes,
      width: proof.width, height: proof.height, sha256: proof.sha256
    }
  });
  // The server may have committed successfully while the browser signed into
  // another account. Never surface the old Member's receipt in the new session.
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah saat pendaftaran disimpan. Masuk kembali dan periksa status sebelum mencoba ulang.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  sessionStore.removeItem(submissionKey);
  return response;
};

export const replacePaymentProof = async (input = {}) => {
  const user = await requireCurrentUser();
  const registrationId = cleanString(input.registrationId, 250);
  const expectedProofSha256 = (await getDoc(doc(db, 'registrations', registrationId))).data()?.proofSha256;
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah. Buka lagi pendaftaran sebelum mengganti bukti transfer.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  const prepared = await prepareProof(input.proof);
  const proof = await uploadProof(user, registrationId, prepared);
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Sesi akun berubah. Bukti transfer tidak akan diteruskan dari akun sebelumnya.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  const response = await invoke('replacePaymentProof', {
    registrationId,
    expectedProofSha256,
    proof: {
      storagePath: proof.storagePath, fileName: proof.fileName, sizeBytes: proof.sizeBytes,
      width: proof.width, height: proof.height, sha256: proof.sha256
    }
  });
  if (auth.currentUser?.uid !== user.uid) {
    const error = new Error('Akun berubah sebelum penggantian bukti selesai. Buka lagi detail pada akun yang benar.');
    error.code = 'functions/unauthenticated';
    throw error;
  }
  return { data: { ...response.data, proofSize: proof.sizeBytes } };
};

export const getProofDownloadUrl = async (input = {}) => {
  const user = await requireCurrentUser();
  const registrationId = cleanString(input.registrationId, 250);
  const requireSameAccount = () => {
    if (auth.currentUser?.uid !== user.uid) {
      const error = new Error('Akun berubah saat bukti pembayaran dimuat. Buka kembali detail pada akun yang sedang aktif.');
      error.code = 'functions/unauthenticated';
      throw error;
    }
  };
  const proofSnapshot = await getDoc(doc(db, 'paymentProofs', registrationId));
  if (!proofSnapshot.exists()) {
    const error = new Error('Bukti pembayaran tidak ditemukan.');
    error.code = 'storage/object-not-found';
    throw error;
  }
  const proof = proofSnapshot.data();
  requireSameAccount();
  if (proof.storagePath) {
    const blob = await getBlob(storageRef(storage, proof.storagePath), 400 * 1024);
    requireSameAccount();
    const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const jpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    const png = signature.length >= 8 && [137,80,78,71,13,10,26,10].every((value, i) => signature[i] === value);
    if (!jpeg && !png) throw new Error('Bukti transfer bukan gambar JPEG atau PNG yang valid.');
    const typedBlob = new Blob([blob], {type: jpeg ? 'image/jpeg' : 'image/png'});
    requireSameAccount();
    return { data: { url: URL.createObjectURL(typedBlob), storage: 'firebase-storage', sizeBytes: typedBlob.size } };
  }
  if (typeof proof.dataUrl === 'string' && /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/i.test(proof.dataUrl)) {
    requireSameAccount();
    return { data: { url: proof.dataUrl, storage: 'legacy-firestore', sizeBytes: Number(proof.sizeBytes || 0) } };
  }
  const error = new Error('Bukti pembayaran tidak tersedia.');
  error.code = 'storage/object-not-found';
  throw error;
};

export const purgePaymentProof = (input) => invoke('purgePaymentProof', input);
export const reviewRegistration = (input) => invoke('reviewRegistration', input);
export const bulkReviewRegistrations = (input) => invoke('bulkReviewRegistrations', input);
export const checkInRegistration = (input) => invoke('checkInRegistration', input);
export const softDeleteRegistration = (input) => invoke('softDeleteRegistration', input);
export const restoreRegistration = (input) => invoke('restoreRegistration', input);
export const submitProfileEditRequest = (input) => invoke('submitProfileEditRequest', input);
export const saveParticipantProfile = (input) => invoke('saveParticipantProfile', input);
export const saveProfilePhoto = (input) => invoke('saveProfilePhoto', input);
export const getProfilePhoto = (input = {}) => invoke('getProfilePhoto', input);
export const reviewProfileEditRequest = (input) => invoke('reviewProfileEditRequest', input);
export const archiveParticipant = (input) => invoke('archiveParticipant', input);
export const restoreParticipant = (input) => invoke('restoreParticipant', input);
export const updateParticipantProfile = (input) => invoke('updateParticipantProfile', input);
export const rebuildDashboardMetrics = (input = {}) => invoke('rebuildDashboardMetrics', input);

export const deletePeriod = (periodId) => invoke('deletePeriod', { periodId });

export const savePeriod = async (input = {}) => {
  // The UI calls its unlocked state "edit"; the API contract uses "update".
  const mode = input.mode === 'edit' ? 'update' : input.mode;
  const waves = {
    'wave-01': {
      label: WAVES['wave-01'].label,
      enabled: input.enabledWaves?.['wave-01'] !== false,
      registrationOpenAt: input.wave01RegistrationOpenAt || input.registrationOpenAt,
      registrationCloseAt: input.wave01RegistrationCloseAt || input.registrationCloseAt,
      startsAt: input.wave01StartsAt,
      closesAt: input.wave01ClosesAt
    },
    'wave-02': {
      label: WAVES['wave-02'].label,
      enabled: input.enabledWaves?.['wave-02'] !== false,
      registrationOpenAt: input.wave02RegistrationOpenAt || input.registrationOpenAt,
      registrationCloseAt: input.wave02RegistrationCloseAt || input.registrationCloseAt,
      startsAt: input.wave02StartsAt,
      closesAt: input.wave02ClosesAt
    }
  };
  const packages = Object.fromEntries(Object.entries(PACKAGES).map(([packageId, packageData]) => [packageId, {
    ...packageData,
    enabled: input.enabledPackages?.[packageId] === true,
    waves: Object.fromEntries(Object.keys(WAVES).map((waveId) => {
      const schedule = input.categorySchedules?.[packageId]?.[waveId] || {};
      return [waveId, {
        label: WAVES[waveId].label,
        enabled: input.enabledPackageWaves?.[packageId]?.[waveId] === true,
        registrationOpenAt: waves[waveId].registrationOpenAt,
        registrationCloseAt: waves[waveId].registrationCloseAt,
        startsAt: schedule.startsAt || waves[waveId].startsAt,
        deadlineAt: schedule.deadlineAt || waves[waveId].closesAt,
        announcementAt: schedule.announcementAt || input.announcementAt
      }];
    }))
  }]));
  return invoke('savePeriod', { ...input, mode, waves, packages });
};
