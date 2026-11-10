import {
  getBlob,
  ref as storageRef,
  uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import { auth, storage } from './firebase-config.js?v=b74586eaa5ef6110';
import { getProfilePhoto, saveProfilePhoto } from './spark-data.js?v=b74586eaa5ef6110';
import { friendlyFirebaseError } from './auth-core.js?v=b74586eaa5ef6110';

// Private fallback photo is returned only by an authenticated, owner-scoped
// callable. Decode only bounded JPEG bytes, never a public bearer-token URL.
export const decodePrivateProfilePhoto = (data, expected = {}) => {
  if (data?.ok !== true || data.hasPhoto !== true || data.mimeType !== 'image/jpeg'
    || !Number.isSafeInteger(data.sizeBytes) || data.sizeBytes < 4 || data.sizeBytes > 256 * 1024
    || !/^[a-f0-9]{64}$/.test(String(data.sha256 || ''))
    || String(data.sha256) !== String(expected.photoSha256 || '')
    || Number(data.photoVersion) !== Number(expected.photoVersion || 0)
    || typeof data.base64 !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) {
    throw errorWith('Foto profil tersimpan belum dapat diverifikasi.');
  }
  const binary = atob(data.base64);
  if (binary.length !== data.sizeBytes || binary.charCodeAt(0) !== 0xff
    || binary.charCodeAt(1) !== 0xd8
    || binary.charCodeAt(binary.length - 2) !== 0xff
    || binary.charCodeAt(binary.length - 1) !== 0xd9) {
    throw errorWith('Isi foto profil tidak sesuai.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
};

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BYTES = 256 * 1024;
const PHOTO_SIDE = 512;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const errorWith = (message, code = 'functions/invalid-argument') => Object.assign(new Error(message), { code });

export const validatePhotoFile = (file) => {
  if (!file || !IMAGE_TYPES.has(file.type)) throw errorWith('Pilih foto JPG, PNG, atau WebP.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_SOURCE_BYTES) {
    throw errorWith('Ukuran foto awal maksimal 8 MB. Pilih foto yang lebih kecil.');
  }
};

export const isOwnPhotoPath = (uid, path = '') => {
  const prefix = `profile-photos/${uid}/`;
  return typeof path === 'string' && path.startsWith(prefix)
    && /^[A-Za-z0-9-]{20,80}[.]jpg$/.test(path.slice(prefix.length));
};

const providerPhotoUrl = (value = '') => {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return '';
    return url.href;
  } catch { return ''; }
};

export const prepareProfilePhoto = async (file) => {
  validatePhotoFile(file);
  let source = null;
  let sourceUrl = '';
  try {
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } else {
      sourceUrl = URL.createObjectURL(file);
      source = new Image();
      const loaded = new Promise((resolve, reject) => {
        source.onload = resolve;
        source.onerror = () => reject(errorWith('Foto tidak bisa dibaca. Coba simpan ulang sebagai JPG atau PNG.'));
      });
      source.src = sourceUrl;
      await loaded;
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height || width * height > 40_000_000) {
      throw errorWith('Dimensi foto terlalu besar atau belum valid. Pilih foto maksimal 40 megapiksel.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIDE;
    canvas.height = PHOTO_SIDE;
    const context = canvas.getContext('2d');
    if (!context) throw errorWith('Browser belum bisa menyiapkan foto. Coba browser lain.');
    const edge = Math.min(width, height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE);
    context.drawImage(source, (width - edge) / 2, (height - edge) / 2, edge, edge, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
    let blob = null;
    for (const quality of [0.88, 0.76, 0.64, 0.5]) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob?.size > 0 && blob.size <= MAX_PHOTO_BYTES) break;
    }
    if (!blob || blob.type !== 'image/jpeg' || blob.size <= 0 || blob.size > MAX_PHOTO_BYTES) {
      throw errorWith('Foto belum bisa dikompres. Coba foto lain yang lebih sederhana.');
    }
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { blob, sha256, sizeBytes: blob.size };
  } catch (error) {
    if (error?.code) throw error;
    throw errorWith('Foto tidak bisa diproses. Pilih file JPG, PNG, atau WebP yang masih bisa dibuka.');
  } finally {
    source?.close?.();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
};

export const initProfilePhoto = ({ user, onSaved } = {}) => {
  const avatar = document.querySelector('#profile-avatar');
  const initials = document.querySelector('#profile-avatar-initials');
  const image = document.querySelector('#profile-avatar-image');
  const input = document.querySelector('#profile-photo-input');
  const pick = document.querySelector('#profile-photo-pick');
  const save = document.querySelector('#profile-photo-save');
  const cancel = document.querySelector('#profile-photo-cancel');
  const pendingActions = document.querySelector('#profile-photo-pending-actions');
  const status = document.querySelector('#profile-photo-status');
  if (!avatar || !initials || !image || !input || !pick || !save || !cancel || !pendingActions || !status || !user) {
    return { update() {} };
  }
  let currentProfile = {};
  let currentName = 'Peserta';
  let pending = null;
  let busy = false;
  let disposed = false;
  let imageRequest = 0;
  let savedKey = '';
  let savedObjectUrl = '';
  let activeImageError = '';
  const keyFor = (data) => data.photoStoragePath
    ? `${data.photoStoragePath}:${data.photoSha256 || ''}:${Number(data.photoVersion || 0)}`
    : providerPhotoUrl(data.photoURL || user.photoURL);
  const message = (text, state = 'notice') => { status.textContent = text; status.dataset.state = state; };
  const controls = () => {
    pick.disabled = busy;
    input.disabled = busy;
    save.disabled = busy;
    cancel.disabled = busy;
    save.hidden = !pending;
    cancel.hidden = !pending;
    pendingActions.hidden = !pending;
    pick.textContent = pending || currentProfile.photoStoragePath || savedKey ? 'Ganti Foto' : 'Pilih Foto';
    avatar.setAttribute('aria-busy', String(busy));
  };
  const display = (url = '') => {
    image.hidden = !url;
    initials.hidden = Boolean(url);
    image.alt = `Foto profil ${currentName}`;
    if (url) image.src = url;
    else image.removeAttribute('src');
  };
  const discardPending = () => {
    if (pending?.url) URL.revokeObjectURL(pending.url);
    pending = null;
  };
  const loadSaved = async () => {
    if (disposed || busy || pending) return;
    const key = keyFor(currentProfile);
    if (key === savedKey) return;
    const run = ++imageRequest;
    if (!key) {
      savedKey = '';
      if (savedObjectUrl) URL.revokeObjectURL(savedObjectUrl);
      savedObjectUrl = '';
      display();
      return;
    }
    try {
      let url;
      let ownsUrl = false;
      if (currentProfile.photoStoragePath) {
        if (!isOwnPhotoPath(user.uid, currentProfile.photoStoragePath)) throw errorWith('Lokasi foto belum valid.');
        let blob;
        try {
          blob = await getBlob(storageRef(storage, currentProfile.photoStoragePath), MAX_PHOTO_BYTES);
        } catch (directError) {
          // Storage getBlob can fail if production bucket CORS was never applied.
          // Use a verified server read, without exposing a public download token.
          if (auth.currentUser?.uid !== user.uid) throw errorWith('Sesi akun berubah.', 'functions/unauthenticated');
          const response = await getProfilePhoto({ photoVersion: Number(currentProfile.photoVersion || 0) });
          if (auth.currentUser?.uid !== user.uid) throw errorWith('Sesi akun berubah.', 'functions/unauthenticated');
          blob = decodePrivateProfilePhoto(response.data, currentProfile);
        }
        if (blob.size <= 0 || blob.size > MAX_PHOTO_BYTES || blob.type !== 'image/jpeg') {
          throw errorWith('Ukuran atau format foto belum valid.');
        }
        url = URL.createObjectURL(blob);
        ownsUrl = true;
      } else url = providerPhotoUrl(currentProfile.photoURL || user.photoURL);
      if (disposed || auth.currentUser?.uid !== user.uid
        || run !== imageRequest || pending || busy || key !== keyFor(currentProfile)) {
        if (ownsUrl) URL.revokeObjectURL(url);
        if (!disposed && auth.currentUser?.uid !== user.uid) display();
        return;
      }
      if (savedObjectUrl) URL.revokeObjectURL(savedObjectUrl);
      savedObjectUrl = ownsUrl ? url : '';
      savedKey = key;
      display(url);
      if (activeImageError) message('', 'notice');
      activeImageError = '';
      controls();
    } catch (error) {
      if (!disposed && auth.currentUser?.uid !== user.uid) {
        if (savedObjectUrl) URL.revokeObjectURL(savedObjectUrl);
        savedObjectUrl = '';
        savedKey = '';
        display();
        return;
      }
      if (!disposed && run === imageRequest && !pending && !busy) {
        display();
        activeImageError = error?.code || 'unavailable';
        message(error?.code === 'functions/not-found'
          ? 'Berkas foto sudah tidak tersedia. Gunakan Ganti Foto untuk memasang ulang.'
          : 'Foto belum bisa dimuat. Coba buka tab ini lagi atau pilih Ganti Foto.', 'error');
      }
    }
  };
  image.addEventListener('error', () => {
    if (disposed || pending || busy) return;
    display();
    savedKey = '';
    message('Foto belum bisa ditampilkan. Kamu tetap bisa memilih foto baru.', 'error');
  });
  pick.addEventListener('click', () => { if (!busy) input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy || disposed) return;
    busy = true;
    controls();
    message('Menyiapkan foto…');
    try {
      const prepared = await prepareProfilePhoto(file);
      if (disposed) return;
      imageRequest += 1;
      discardPending();
      pending = { ...prepared, url: URL.createObjectURL(prepared.blob), storagePath: '' };
      display(pending.url);
      message('Pratinjau siap. Pilih Simpan Foto untuk menerapkannya.');
    } catch (error) { message(error.message || 'Foto belum bisa disiapkan.', 'error'); }
    finally { busy = false; controls(); }
  });
  cancel.addEventListener('click', () => {
    if (busy) return;
    discardPending();
    display(savedObjectUrl || providerPhotoUrl(currentProfile.photoURL || user.photoURL));
    savedKey = '';
    message('Pilihan foto dibatalkan.');
    controls();
    void loadSaved();
  });
  save.addEventListener('click', async () => {
    if (!pending || busy || disposed) return;
    const prepared = pending;
    busy = true;
    controls();
    message('Mengunggah foto…');
    try {
      if (auth.currentUser?.uid !== user.uid) throw errorWith('Sesi akun berubah. Masuk ulang sebelum menyimpan.', 'functions/unauthenticated');
      await user.getIdToken();
      if (!prepared.storagePath) {
        const token = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(20))].map((n) => n.toString(16).padStart(2, '0')).join('');
        const path = `profile-photos/${user.uid}/${token}.jpg`;
        const task = uploadBytesResumable(storageRef(storage, path), prepared.blob, {
          contentType: 'image/jpeg', cacheControl: 'private,max-age=3600',
          customMetadata: { ownerUid: user.uid, sha256: prepared.sha256 }
        });
        await new Promise((resolve, reject) => task.on('state_changed', (snapshot) => {
          const percent = snapshot.totalBytes ? Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100) : 0;
          message(`Mengunggah foto… ${percent}%`);
        }, reject, resolve));
        prepared.storagePath = path;
      }
      if (auth.currentUser?.uid !== user.uid) throw errorWith('Sesi akun berubah. Masuk ulang sebelum menyimpan.', 'functions/unauthenticated');
      message('Menyimpan foto profil…');
      const response = await saveProfilePhoto({ storagePath: prepared.storagePath, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256 });
      if (response.data?.ok !== true) throw errorWith('Penyimpanan belum dikonfirmasi. Coba Simpan Foto lagi.', 'functions/unavailable');
      if (auth.currentUser?.uid !== user.uid) throw errorWith('Sesi akun berubah. Foto akun lama tidak akan ditampilkan.', 'functions/unauthenticated');
      const updated = onSaved?.(response.data) || { ...currentProfile, ...response.data };
      currentProfile = updated;
      pending = null;
      if (savedObjectUrl) URL.revokeObjectURL(savedObjectUrl);
      savedObjectUrl = prepared.url;
      prepared.url = '';
      savedKey = keyFor(response.data);
      display(savedObjectUrl);
      message('Foto profil sudah tersimpan. Foto bisa diganti tanpa membuka kunci data identitas.', 'success');
    } catch (error) {
      const detail = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/not-found'].includes(error?.code)
        ? error.message : friendlyFirebaseError(error);
      message(detail || 'Foto belum tersimpan. Coba lagi saat koneksi sudah siap.', 'error');
    } finally {
      busy = false;
      controls();
      if (!pending) void loadSaved();
    }
  });
  // Refresh failed reads when the tab is active again. Do not retry on a
  // background page, during uploads, or when a newer avatar is already shown.
  const retryUnavailable = () => {
    if (!disposed && !pending && !busy && !savedKey && currentProfile.photoStoragePath
      && auth.currentUser?.uid === user.uid) void loadSaved();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryUnavailable();
  });
  window.addEventListener('pageshow', retryUnavailable);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    disposed = true;
    imageRequest += 1;
    discardPending();
    if (savedObjectUrl) URL.revokeObjectURL(savedObjectUrl);
  });
  controls();
  return {
    update(data = {}, name = 'Peserta') {
      if (disposed || Number(data.photoVersion || 0) < Number(currentProfile.photoVersion || 0)) return;
      currentProfile = data;
      currentName = name;
      initials.textContent = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'E';
      image.alt = `Foto profil ${name}`;
      controls();
      if (!pending && !busy) void loadSaved();
    }
  };
};
