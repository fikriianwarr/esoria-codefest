import {httpsCallable} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import {uploadBytes, ref} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import {auth, functions, runtimeConfig, storage} from './firebase-config.js?v=b74586eaa5ef6110';
import {currentSessionKey} from './single-device-session.js?v=b74586eaa5ef6110';

const endpoint = httpsCallable(functions, 'esoriaApi', {timeout: 120000, limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)});
const ctfEndpoint = httpsCallable(functions, 'esoriaCtf', {timeout: 60000, limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)});
const reads = new Set(['getParticipantWorkspace', 'getCompetitionContext', 'getJuryWorkspace', 'getOperationsWorkspace', 'getPublishedResults', 'verifyCertificate', 'getRegistrationDraft']);
const pending = new Map();
export const api = (action, payload = {}) => {
  const key = `${auth.currentUser?.uid || 'anonymous'}:${action}:${JSON.stringify(payload)}`;
  if (reads.has(action) && pending.has(key)) return pending.get(key);
  const uid = auth.currentUser?.uid;
  const request = endpoint({action, payload:{...payload,sessionKey:currentSessionKey()}}).then(({data}) => {
    if (uid !== auth.currentUser?.uid) throw Object.assign(new Error('Sesi berubah. Buka ulang halaman.'), {code: 'auth/session-changed'});
    return data;
  }).finally(() => pending.delete(key));
  if (reads.has(action)) pending.set(key, request);
  return request;
};
export const submitFlag = async (payload) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error('Masuk kembali untuk mengirim jawaban.'), {code:'auth/session-changed'});
  const {data} = await ctfEndpoint({payload:{...payload,sessionKey:currentSessionKey()}});
  if (uid !== auth.currentUser?.uid) {
    throw Object.assign(new Error('Akun berubah saat jawaban diproses. Masuk kembali untuk melihat hasil.'), {code:'auth/session-changed'});
  }
  return data;
};
export const uploadArtifact = async (file, registrationId) => {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('Pilih PDF, PNG, atau JPEG maksimal 5 MB.');
  const ownerUid = auth.currentUser?.uid;
  if (!ownerUid) throw Object.assign(new Error('Sesi telah berakhir. Masuk kembali sebelum mengunggah lampiran.'), {code: 'auth/session-changed'});
  const requireSameUser = () => {
    if (auth.currentUser?.uid !== ownerUid) {
      throw Object.assign(new Error('Akun berubah saat mengunggah. Masuk kembali dan pilih ulang lampiran.'), {code: 'auth/session-changed'});
    }
  };
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  // Pin the owner before the first async operation: Auth can change in another
  // tab while a file is hashed or an upload intent is being requested.
  requireSameUser();
  const intent = await api('createSubmissionUpload', {registrationId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, sha256});
  requireSameUser();
  await uploadBytes(ref(storage, intent.storagePath), file, {contentType: file.type, cacheControl: 'private,no-store', customMetadata: {uploadId: intent.uploadId, ownerUid, registrationId, sha256}});
  requireSameUser();
  return api('finalizeSubmissionUpload', {uploadId: intent.uploadId});
};
export const download = (data) => {
  const bytes = Uint8Array.from(atob(data.base64), (character) => character.charCodeAt(0));
  const objectUrl = URL.createObjectURL(new Blob([bytes], {type: data.mimeType}));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = String(data.fileName || 'ESORIA-unduhan').replace(/[\\/\x00-\x1f]/g, '_');
  // Firefox and Safari require a connected anchor for reliable downloads.
  document.body.append(link);
  try { link.click(); } finally { link.remove(); }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
};
export const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
export const timeValue = (value) => value?.toMillis?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : typeof value?._seconds === 'number' ? value._seconds * 1000 : typeof value === 'number' ? value : Date.parse(value || ''));
export const formatDate = (value) => Number.isFinite(timeValue(value)) ? new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(timeValue(value)) : 'Belum ditetapkan';
