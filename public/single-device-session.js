/* ESORIA single active browser session. The server owns authorization.
 * A device key is a random session binder, NOT a Firebase Auth token.
 * Tabs sharing the same origin share the device key; another browser does not.
 */
import { onSnapshot, doc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth, db, functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';

const KEY_PREFIX = 'esoria:session-device:v1:';
const readStorage = (uid) => { try { return localStorage.getItem(`${KEY_PREFIX}${uid}`) || ''; } catch { return ''; } };
const saveStorage = (uid, key) => { localStorage.setItem(`${KEY_PREFIX}${uid}`, key); };
export const currentSessionKey = () => auth.currentUser ? readStorage(auth.currentUser.uid) : '';
const endpoint = httpsCallable(functions, 'esoriaApi', { timeout: 30000, limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey) });
const authTime = async (user) => {
  const result = await user.getIdTokenResult();
  const value = Number(result.claims.auth_time);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Waktu autentikasi belum valid. Masuk ulang.');
  return value;
};
const replacedError = () => Object.assign(new Error('Akun ini telah digunakan untuk masuk pada perangkat lain. Silakan login kembali.'), {code:'auth/session-replaced'});
let unsubscribe = null;
let watchedUid = '';
let ending = false;
export const endReplacedSession = async () => {
  if (ending) return;
  ending = true;
  unsubscribe?.(); unsubscribe = null;
  try { await signOut(auth); } finally {
    location.replace('/login.html?reason=other-device');
  }
};
export const activateDeviceSession = async (user) => {
  if (!user || auth.currentUser?.uid !== user.uid) throw replacedError();
  // Keep one key across tabs, but only a fresh credential may replace an old device.
  let key = readStorage(user.uid);
  if (!key) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    try { saveStorage(user.uid, key); } catch { throw new Error('Penyimpanan browser diperlukan untuk sesi satu perangkat. Aktifkan penyimpanan situs.'); }
  }
  const {data} = await endpoint({action:'activateDeviceSession',payload:{sessionKey:key}});
  if (!data?.active || auth.currentUser?.uid !== user.uid) throw replacedError();
  return {authTime:await authTime(user), key};
};
export const ensureDeviceSession = async (user) => {
  if (!user) throw replacedError();
  const expectedTime = await authTime(user);
  const snap = await getDocFromServer(doc(db,'accountSessions',user.uid));
  if (!snap.exists()) return activateDeviceSession(user); // Migration for previously logged-in users.
  if (Number(snap.data()?.authTime) !== expectedTime || !readStorage(user.uid)) throw replacedError();
  // Backend validates the binder on every authenticated callable, not just auth_time.
  await endpoint({action:'checkDeviceSession',payload:{sessionKey:readStorage(user.uid)}});
  return {authTime:expectedTime,key:readStorage(user.uid)};
};
export const watchDeviceSession = (user, expected) => {
  if (!user || !expected || watchedUid === user.uid) return;
  unsubscribe?.();
  watchedUid = user.uid;
  unsubscribe = onSnapshot(doc(db, 'accountSessions', user.uid), (snap) => {
    // A cached pre-login snapshot must never sign out a newly authenticated device.
    if (snap.metadata?.fromCache) return;
    if (!snap.exists() || Number(snap.data().authTime) !== expected.authTime || snap.data().sessionHash !== expected.sessionHash) {
      void endReplacedSession();
    }
  }, (error) => {
    // Connectivity errors must not be mistaken for a revoked session.
    console.warn('Pemantauan sesi terputus:', error.code || 'unavailable');
  });
};
export const verifyAndWatchDeviceSession = async (user) => {
  try {
    const session = await ensureDeviceSession(user);
    // SHA-256 is computed locally only to compare the session binder from server.
    const bytes = new TextEncoder().encode(session.key);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sessionHash = [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
    watchDeviceSession(user, {...session,sessionHash});
  } catch (error) {
    if (error?.code === 'auth/session-replaced' || error?.code === 'functions/permission-denied' || error?.code === 'functions/failed-precondition') {
      await endReplacedSession();
      throw replacedError();
    }
    throw error;
  }
};

// Recheck after returning from a background tab; listeners may be throttled on mobile.
let recheckBusy = false;
document.addEventListener('visibilitychange', () => {
  const user = auth.currentUser;
  if (document.hidden || !user || user.uid !== watchedUid || recheckBusy || ending) return;
  recheckBusy = true;
  void ensureDeviceSession(user).catch((error) => {
    if (error?.code === 'auth/session-replaced' || error?.code === 'functions/permission-denied' || error?.code === 'functions/failed-precondition') {
      void endReplacedSession();
    }
  }).finally(() => { recheckBusy = false; });
});
