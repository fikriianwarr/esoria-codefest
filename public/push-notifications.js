import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js';
import { app, auth, functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';
import {currentSessionKey} from './single-device-session.js?v=b74586eaa5ef6110';

const button = document.querySelector('[data-push-toggle]');
const label = button?.querySelector('[data-push-label]');
const enableFlag = (uid) => `esoria:push-opt-in:${uid}`;
const syncFlag = (uid) => `esoria:push-last-sync:${uid}`;
// Browsers can block localStorage in restrictive privacy modes. A storage
// error should never break the whole profile or prevent a supported retry.
const memoryFlags = new Map();
const readFlag = (key) => {
  try { return localStorage.getItem(key) ?? memoryFlags.get(key) ?? null; }
  catch { return memoryFlags.get(key) ?? null; }
};
const writeFlag = (key, value) => {
  memoryFlags.set(key, String(value));
  try { localStorage.setItem(key, String(value)); } catch { /* best effort */ }
};
const clearFlag = (key) => {
  memoryFlags.delete(key);
  try { localStorage.removeItem(key); } catch { /* best effort */ }
};

const api = httpsCallable(functions, 'esoriaApi', {
  timeout: 30000,
  limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)
});
let busy = false;
let pendingAction = '';
let messaging = null;
let backgroundRegistration = null;
let listening = false;
const inform = (message, title = 'Notifikasi Push') => {
  window.dispatchEvent(new CustomEvent('esoria:notification-toast', { detail: { title, message, type: 'system' } }));
};
const updateButton = (enabled) => {
  if (!button) return;
  button.setAttribute('aria-pressed', String(enabled));
  if (label) label.textContent = busy
    ? pendingAction === 'disable' ? 'Menonaktifkan…' : 'Mengaktifkan…'
    : enabled ? 'Nonaktifkan Push' : 'Aktifkan Push';
  button.classList.toggle('is-processing', busy);
  button.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  button.title = enabled ? 'Hentikan notifikasi push di perangkat ini' : 'Terima notifikasi saat tab ditutup';
};
const checkSupport = async () => {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) {
    throw new Error('Push memerlukan browser dengan izin notifikasi dan koneksi HTTPS.');
  }
  if (!(await isSupported())) throw new Error('Browser ini tidak mendukung Firebase Cloud Messaging.');
  if (!runtimeConfig.messagingVapidKey) {
    throw new Error('Web Push belum dikonfigurasi. Admin perlu mengisi messagingVapidKey dari Firebase Console > Cloud Messaging pada runtime-config.js, kemudian deploy Hosting.');
  }
};
const loadMessaging = async () => {
  await checkSupport();
  backgroundRegistration ||= await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/', updateViaCache: 'none' });
  if (!backgroundRegistration.active) {
    // Avoid an infinite spinner if a broken/blocked SW never becomes active.
    let pendingTimer;
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          pendingTimer = setTimeout(() => reject(new Error('Service worker belum siap. Muat ulang halaman lalu coba lagi.')), 15000);
        })
      ]);
    } finally {
      clearTimeout(pendingTimer);
    }
  }
  messaging ||= getMessaging(app);
  if (!listening) {
    onMessage(messaging, (payload) => {
      const data = payload.data || {};
      inform(data.body || 'Ada pembaruan aktivitas.', data.title || 'ESORIA CodeFest');
    });
    listening = true;
  }
  return messaging;
};
const getBrowserToken = async () => {
  const instance = await loadMessaging();
  return getToken(instance, {
    vapidKey: runtimeConfig.messagingVapidKey,
    serviceWorkerRegistration: backgroundRegistration
  });
};

// Called by the profile logout flow; server removes ownership, and FCM invalidates
// the device token to avoid delivering the old account's messages after logout.
export async function disablePushForCurrentUser() {
  const uid = auth.currentUser?.uid;
  if (!uid || readFlag(enableFlag(uid)) !== '1') return true;
  let remoteRemoved = false;
  try {
    if (Notification.permission === 'granted') {
      const token = await getBrowserToken();
      if (token) { await api({ action: 'unregisterPushToken', payload: { token,sessionKey:currentSessionKey() } }); remoteRemoved = true; }
    }
  } catch (error) {
    console.warn('Sinkronisasi penghentian push gagal:', error);
  } finally {
    let removedLocally = false;
    try {
      if (messaging) removedLocally = await deleteToken(messaging);
      else if (Notification.permission !== 'granted') removedLocally = true;
    } catch (error) { console.warn('FCM token lokal belum terhapus:', error); }
    if (remoteRemoved || removedLocally) {
      clearFlag(enableFlag(uid));
      clearFlag(syncFlag(uid));
    }
    updateButton(readFlag(enableFlag(uid)) === '1');
  }
  return readFlag(enableFlag(uid)) !== '1';
}

button?.addEventListener('click', async () => {
  if (busy) return;
  if (!auth.currentUser) {
    inform('Sesi peserta belum siap. Tunggu sampai profil selesai dimuat lalu coba lagi.', 'Push belum aktif');
    return;
  }
  const uid = auth.currentUser.uid;
  busy = true;
  const activeBefore = typeof Notification !== 'undefined' && Notification.permission === 'granted' && readFlag(enableFlag(uid)) === '1';
  pendingAction = activeBefore ? 'disable' : 'enable';
  updateButton(activeBefore);
  try {
    const active = activeBefore;
    if (active) {
      const removed = await disablePushForCurrentUser();
      if (!removed) throw new Error('Push belum berhasil dihentikan. Periksa koneksi lalu coba lagi.');
      inform('Push di perangkat ini telah dinonaktifkan.');
    } else {
      // Browser permission MUST be requested in the immediate click gesture:
      // awaiting Firebase support checks first can lose user activation on mobile.
      if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('Push tidak tersedia di browser ini. Gunakan Chrome terbaru dengan HTTPS dan izin notifikasi perangkat aktif.');
      }
      if (!runtimeConfig.messagingVapidKey) {
        throw new Error('Konfigurasi Web Push belum tersedia. Hubungi admin untuk memeriksa VAPID key.');
      }
      if (Notification.permission === 'denied') {
        throw new Error('Izin situs ESORIA diblokir. Buka ikon pengaturan di samping alamat situs → Izin situs → Notifikasi → Izinkan. Pastikan notifikasi Chrome juga aktif di Pengaturan Android.');
      }
      // Execute before the first await: this preserves transient user activation.
      const permissionPromise = Notification.permission === 'granted'
        ? Promise.resolve('granted') : Notification.requestPermission();
      const permission = await permissionPromise;
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Izin notifikasi ditolak. Ubah izin ESORIA menjadi Izinkan pada pengaturan situs Chrome serta periksa notifikasi Chrome di Pengaturan Android.'
          : 'Izin notifikasi belum diberikan. Ketuk Aktifkan Push lagi lalu pilih Izinkan pada dialog browser.');
      }
      const token = await getBrowserToken();
      if (!token) throw new Error('Perangkat belum memperoleh token Firebase Messaging. Periksa konfigurasi VAPID dan koneksi.');
      await api({ action: 'registerPushToken', payload: { token,sessionKey:currentSessionKey() } });
      writeFlag(enableFlag(uid), '1');
      writeFlag(syncFlag(uid), String(Date.now()));
      inform('Push aktif untuk browser ini. Pembaruan akan diterima jika izin perangkat dan layanan pesan tetap tersedia.');
    }
  } catch (error) {
    inform(error?.message || 'Tidak bisa mengaktifkan Push. Periksa pengaturan browser.', 'Push belum aktif');
  } finally {
    busy = false;
    pendingAction = '';
    updateButton(typeof Notification !== 'undefined' && Notification.permission === 'granted' && readFlag(enableFlag(uid)) === '1');
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!button) return;
  // Stale opt-in must not claim that push is active after the browser blocks it.
  if (user && typeof Notification !== 'undefined' && Notification.permission !== 'granted' && readFlag(enableFlag(user.uid)) === '1') {
    clearFlag(enableFlag(user.uid));
    clearFlag(syncFlag(user.uid));
  }
  const enabled = Boolean(user && typeof Notification !== 'undefined' && Notification.permission === 'granted' && readFlag(enableFlag(user.uid)) === '1');
  updateButton(enabled);
  // Keep an explicitly opted-in device token in sync after browser reload.
  if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (Date.now() - Number(readFlag(syncFlag(user.uid)) || 0) < 12 * 60 * 60 * 1000) return;
  try {
    const token = await getBrowserToken();
    if (token && auth.currentUser?.uid === user.uid) {
      await api({ action: 'registerPushToken', payload: { token,sessionKey:currentSessionKey() } });
      writeFlag(syncFlag(user.uid), String(Date.now()));
    }
  } catch (error) {
    console.warn('Sinkronisasi Push ditunda:', error);
  }
});
