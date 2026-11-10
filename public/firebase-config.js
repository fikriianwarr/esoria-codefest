import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js';

const originalFirebaseConfig = {
  apiKey: 'AIzaSyBVdDOxokBR67-QGiS5KYONLDlqUkASq-U',
  authDomain: 'esoria-codefest.firebaseapp.com',
  projectId: 'esoria-codefest',
  storageBucket: 'esoria-codefest.firebasestorage.app',
  messagingSenderId: '56329075998',
  appId: '1:56329075998:web:85268753c681f782da1d0f',
  measurementId: 'G-DD0611TXRL'
};

const runtime = window.ESORIA_RUNTIME_CONFIG || {};
// This opt-in is only true on a fixed local hosting port. Never enable on a
// real Hosting origin, and never route demo traffic to live ESORIA services.
const isDemoHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname) && window.location.port === '5000';
const useDemoEmulator = isDemoHost && runtime.demoEmulator === true;
const demoFirebaseConfig = Object.freeze({
  apiKey: 'demo-key-not-for-production', authDomain: 'demo-esoria-codefest.firebaseapp.com',
  projectId: 'demo-esoria-codefest', storageBucket: 'demo-esoria-codefest.appspot.com',
  messagingSenderId: '123456789', appId: '1:123456789:web:0000000000000000000000'
});
// A staging configuration must be complete: never mix its services with production.
if (runtime.firebase && ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].some((key) => !String(runtime.firebase[key] || '').trim())) throw new Error('Konfigurasi Firebase lingkungan belum lengkap.');
export const firebaseConfig = Object.freeze(useDemoEmulator ? demoFirebaseConfig : (runtime.firebase || originalFirebaseConfig));
if (!useDemoEmulator && runtime.firebase && firebaseConfig.projectId !== 'esoria-codefest' && !runtime.appCheckSiteKey) throw new Error('Site key App Check staging belum diisi.');
export const runtimeConfig = Object.freeze({
  appCheckSiteKey: String(runtime.appCheckSiteKey || '').trim(),
  analyticsEnabled: runtime.analyticsEnabled !== false,
  performanceEnabled: runtime.performanceEnabled !== false,
  functionsRegion: String(runtime.functionsRegion || 'asia-southeast2').trim(),
  messagingVapidKey: String(runtime.messagingVapidKey || '').trim()
});

export const app = getApps()[0] || initializeApp(firebaseConfig);

// App Check harus diinisialisasi SEBELUM Auth/Firestore/Functions/Storage
// supaya permintaan Firebase pertama tidak berlomba dengan pemasangan provider.
// Jika attestation ditolak (HTTP 403), SDK akan tetap menolak akses: jangan
// menggunakan bypass atau token debug pada build produksi.
const appCheckEnabled = !useDemoEmulator && Boolean(runtimeConfig.appCheckSiteKey);
if (appCheckEnabled) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(runtimeConfig.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.error('Inisialisasi Firebase App Check gagal:', error?.code || 'app-check/init-failed');
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, runtimeConfig.functionsRegion);

// getAuth uses Firebase's browser persistence hierarchy (IndexedDB/localStorage)
// by default. Do not start an unawaited setPersistence migration on every page:
// a concurrent auth-state initialization or redirect can otherwise race the
// migration and make the same session appear different across page loads.
// Real sign-out remains explicit or subject to the admin idle-security policy.

// The connectors are configured ONLY for http://localhost:5000 demo sessions.
// They must run before any feature module issues an SDK request.
if (useDemoEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  document.documentElement.dataset.esoriaDemo = 'true';
}
