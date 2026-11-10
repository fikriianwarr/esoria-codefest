import {
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getDocFromServer
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { auth, db, functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';
import './session-activity.js?v=b74586eaa5ef6110';
import { currentSessionKey, verifyAndWatchDeviceSession } from './single-device-session.js?v=b74586eaa5ef6110';
import { calculateAgeInWib } from './time-utils.js?v=b74586eaa5ef6110';

const callApi = (action, payload = {}) => httpsCallable(functions, 'esoriaApi', {
  timeout: 540000,
  limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)
})({ action, payload: {...payload,sessionKey:currentSessionKey()} });

const ALLOWED_TOP_LEVEL = new Set([
  'index.html',
  'profil.html',
  'dashboard.html',
  'submission.html',
  'results.html',
  'verify-certificate.html',
  'form-pendaftaran.html',
  'pendaftaran-berhasil.html',
  'verify-email.html',
  'forgot-password.html'
]);
const ALLOWED_PREFIXES = ['tickets/', 'legal/'];

export const calculateAge = (birthDate, today = new Date()) => calculateAgeInWib(birthDate, today);

export const safeNextPath = (value, fallback = 'profil.html') => {
  if (!value) return fallback;
  let decoded = String(value);
  try { decoded = decodeURIComponent(decoded); } catch { /* gunakan nilai asli */ }
  const normalized = decoded.trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('\\') || normalized.includes('\0')) return fallback;
  if (normalized.includes('..') || normalized.includes('://') || normalized.startsWith('//')) return fallback;

  const [path] = normalized.split(/[?#]/, 1);
  if (ALLOWED_TOP_LEVEL.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return normalized;
  }
  return fallback;
};

export const currentRelativePath = () => {
  const pathname = window.location.pathname.replace(/^\/+/, '') || 'index.html';
  return `${pathname}${window.location.search}${window.location.hash}`;
};

// Observe Auth changes without treating a failed role lookup as sign-out.
export const observeAuthChanges = (callback, onError) => onAuthStateChanged(auth, callback, onError);
export const getCurrentAuthUser = () => auth.currentUser;

export const waitForAuth = () => new Promise((resolve, reject) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    resolve(user);
  }, (error) => {
    unsubscribe();
    reject(error);
  });
});

const profileRequests = new Map();
const adminRequests = new Map();
const userEnsures = new Map();
const inFlight = (map, key, callback) => {
  if (map.has(key)) return map.get(key);
  const pending = callback().finally(() => map.delete(key));
  map.set(key, pending);
  return pending;
};
export const getUserProfile = async (uid, { serverOnly = false } = {}) => inFlight(profileRequests, `${uid}:${serverOnly}`, async () => {
  const snapshot = await (serverOnly ? getDocFromServer : getDoc)(doc(db, 'users', uid));
  return snapshot.exists() ? {id: snapshot.id, ...snapshot.data()} : null;
});
export const ensureUserDocument = async (user, initial = {}, touchLogin = false) => {
  if (!user) return null;
  return inFlight(userEnsures, `${user.uid}:${touchLogin}:${JSON.stringify(initial)}`, async () => {
    const response = await callApi('ensureUserProfile', {initial, touchLogin});
    return response.data?.profile || getUserProfile(user.uid);
  });
};
export const isAdminUser = async (user = auth.currentUser) => {
  if (!user?.emailVerified) return false;
  return inFlight(adminRequests, user.uid, async () => {
    const snapshot = await getDoc(doc(db, 'admins', user.uid));
    return snapshot.exists() && snapshot.data().active === true;
  });
};

export const requireVerifiedEmail = async (user, next = 'profil.html') => {
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) {
    await user.getIdToken(true);
    return true;
  }
  const destination = encodeURIComponent(safeNextPath(next, 'profil.html'));
  window.location.replace(`verify-email.html?next=${destination}`);
  return false;
};

const displayAuthFailure = (error) => {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-error');
  const gate = document.querySelector('.auth-gate');
  if (!gate) return;

  gate.classList.add('auth-gate-failed');
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'auth-failure-title');
  gate.replaceChildren();
  const card = document.createElement('section');
  card.className = 'auth-error-card';
  const kicker = document.createElement('span');
  kicker.className = 'auth-error-kicker';
  kicker.textContent = 'ESORIA / KEAMANAN SESI';
  const heading = document.createElement('h1');
  heading.id = 'auth-failure-title';
  heading.textContent = 'Pemeriksaan keamanan belum berhasil';
  const message = document.createElement('p');
  message.textContent = friendlyFirebaseError(error);
  const advisory = document.createElement('p');
  advisory.className = 'auth-error-advisory';
  advisory.textContent = 'Akun Anda tidak perlu dibuat ulang. Status login dapat tetap aktif, tetapi informasi pribadi tidak akan dimuat sampai verifikasi keamanan berhasil.';
  const actions = document.createElement('div');
  actions.className = 'auth-error-actions';
  const home = document.createElement('a');
  home.href = '/index.html';
  home.textContent = 'Kembali ke Beranda';
  home.className = 'auth-error-home';
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.textContent = 'Keluar dari Akun';
  logout.className = 'auth-error-logout';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Mengakhiri sesi…';
    try {
      await signOut(auth);
      window.location.replace('/login.html');
    } catch (signOutError) {
      logout.disabled = false;
      logout.textContent = 'Coba keluar lagi';
      advisory.textContent = 'Gagal mengakhiri sesi. Periksa koneksi lalu coba lagi.';
      console.error('Tidak dapat mengakhiri sesi Firebase:', signOutError?.code || signOutError?.message);
    }
  });
  actions.append(home, logout);
  card.append(kicker, heading, message, advisory, actions);
  gate.append(card);
  logout.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('esoria:auth-error', {
    detail: { message: friendlyFirebaseError(error) }
  }));
};

export const requireAuthenticated = async ({
  profileRequired = false,
  adminRequired = false,
  verifiedEmailRequired = false,
  profileReadOptimized = false
} = {}) => {
  let user;
  try {
    user = await waitForAuth();
  } catch (error) {
    displayAuthFailure(error);
    return new Promise(() => {});
  }
  if (!user) {
    const next = encodeURIComponent(currentRelativePath());
    window.location.replace(`login.html?next=${next}`);
    return new Promise(() => {});
  }

  try { await verifyAndWatchDeviceSession(user); } catch (error) {
    displayAuthFailure(error);
    return new Promise(() => {});
  }

  if (adminRequired) {
    let allowed;
    try {
      allowed = await isAdminUser(user);
    } catch (error) {
      // Gagal membaca dokumen admin (mis. App Check 403) BUKAN bukti
      // bahwa user tidak berhak, dan tidak boleh memicu logout otomatis.
      displayAuthFailure(error);
      return new Promise(() => {});
    }
    if (!allowed) {
      window.location.replace('dashboard.html');
      return new Promise(() => {});
    }
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-ready');
    return { user, profile: null };
  }

  if (verifiedEmailRequired && !user.emailVerified) {
    try {
      const verified = await requireVerifiedEmail(user, currentRelativePath());
      if (!verified) return new Promise(() => {});
    } catch (error) {
      displayAuthFailure(error);
      return new Promise(() => {});
    }
  }

  let profile;
  try {
    // The Profile page only needs to read an existing participant document.
    // Run the two server-authorized reads concurrently rather than waiting for
    // an admin read before a profile-writing Cloud Function call on each reload.
    // A missing document still goes through the verified server initializer.
    if (profileReadOptimized) {
      const [isAdmin, existing] = await Promise.all([isAdminUser(user), getUserProfile(user.uid, { serverOnly: true })]);
      if (isAdmin) {
        window.location.replace('admin.html');
        return new Promise(() => {});
      }
      profile = existing && existing.role === 'participant'
        ? existing : await ensureUserDocument(user);
    } else {
      if (await isAdminUser(user)) {
        window.location.replace('admin.html');
        return new Promise(() => {});
      }
      profile = await ensureUserDocument(user);
    }
  } catch (error) {
    displayAuthFailure(error);
    return new Promise(() => {});
  }
  if (profile?.archived) {
    await signOut(auth);
    window.location.replace('login.html?reason=archived');
    return new Promise(() => {});
  }

  if (profileRequired && !profile?.profileComplete) {
    const next = encodeURIComponent(currentRelativePath());
    window.location.replace(`profil.html?next=${next}&complete=required`);
    return new Promise(() => {});
  }

  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-ready');
  return { user, profile };
};

export const profileName = (profile, user) => (
  profile?.participantName || profile?.legalName || profile?.displayName || user?.displayName || user?.email || 'Peserta Esoria'
);

export const formatTimestamp = (timestamp) => {
  const date = timestamp?.toDate?.() || (timestamp ? new Date(timestamp) : null);
  if (!date || Number.isNaN(date.getTime())) return 'Belum tercatat';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta'
  }).format(date);
};

export const friendlyFirebaseError = (error) => {
  const code = String(error?.code || '').replace(/^functions\//, '');
  const messages = {
    'auth/invalid-credential': 'Email/username atau kata sandi tidak cocok.',
    'auth/invalid-email': 'Format email belum benar.',
    'auth/email-already-in-use': 'Email tersebut sudah terdaftar. Silakan masuk.',
    'auth/weak-password': 'Kata sandi belum memenuhi ketentuan keamanan.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
    'auth/multi-factor-auth-required': 'Akun memerlukan verifikasi faktor kedua. Masukkan kode pada panel keamanan untuk melanjutkan.',
    'auth/popup-closed-by-user': 'Jendela Google ditutup sebelum proses selesai.',
    'auth/popup-blocked': 'Jendela Google diblokir. Izinkan pop-up untuk situs ini atau buka ESORIA langsung di Chrome/Safari, lalu coba lagi.',
    'auth/operation-not-supported-in-this-environment': 'Login Google tidak didukung pada browser dalam aplikasi ini. Buka ESORIA langsung di Chrome, Safari, atau browser utama.',
    'auth/unauthorized-domain': 'Domain login belum diizinkan Firebase Authentication. Hubungi pengelola ESORIA; jangan memasukkan kredensial di situs lain.',
    'auth/network-request-failed': 'Koneksi ke layanan akun gagal. Periksa internet Anda.',
    'auth/persistence-unavailable': 'Browser memblokir penyimpanan sesi akun. Izinkan data situs esoria-codefest.web.app atau gunakan jendela browser yang mengizinkannya sebelum masuk lagi.',
    'appCheck/throttled': 'Pemeriksaan keamanan sedang membatasi percobaan sementara. Tunggu beberapa saat sebelum mencoba lagi.',
    'appCheck/recaptcha-error': 'Pemeriksaan keamanan browser belum berhasil. Muat ulang halaman lalu coba kembali.',
    'auth/user-disabled': 'Akun ini telah dinonaktifkan oleh pengelola.',
    'auth/expired-action-code': 'Tautan sudah kedaluwarsa. Minta tautan baru lalu coba kembali.',
    'auth/invalid-action-code': 'Tautan tidak valid atau sudah pernah digunakan.',
    'auth/user-not-found': 'Jika email terdaftar, instruksi akan dikirim ke alamat tersebut.',
    'auth/requires-recent-login': 'Masuk kembali untuk melanjutkan tindakan sensitif ini.',
    'storage/unauthenticated': 'Masuk lagi sebelum mengunggah atau membuka berkas.',
    'storage/unauthorized': 'Akses penyimpanan belum diizinkan. Muat ulang halaman atau hubungi panitia jika tetap gagal.',
    'storage/canceled': 'Unggahan dibatalkan. Kamu bisa memilih dan mengunggah berkas lagi.',
    'storage/retry-limit-exceeded': 'Unggahan belum selesai karena koneksi. Periksa internet lalu coba lagi.',
    'storage/quota-exceeded': 'Penyimpanan sedang tidak tersedia. Hubungi panitia sebelum mencoba kembali.',
    'storage/unknown': 'Penyimpanan belum merespons. Periksa koneksi lalu coba kembali.',
    'unavailable': 'Layanan belum bisa dihubungi. Periksa koneksi lalu coba kembali.',
    'deadline-exceeded': 'Konfirmasi penyimpanan belum diterima. Periksa hasilnya atau coba lagi saat koneksi siap.',
    'permission-denied': 'Anda tidak mempunyai izin untuk melakukan tindakan ini.',
    'unauthenticated': 'Silakan masuk lagi untuk melanjutkan.',
    'failed-precondition': error?.message || 'Persyaratan tindakan belum terpenuhi.',
    'already-exists': error?.message || 'Data tersebut sudah tersedia.',
    'resource-exhausted': error?.message || 'Slot yang tersedia sudah habis.',
    'invalid-argument': error?.message || 'Data yang dikirim belum valid.',
    'not-found': error?.message || 'Data yang diminta tidak ditemukan.'
  };
  const raw = String(error?.message || '');
  if (/appcheck|app.check|recaptcha|attestation|throttled|403.*forbidden/i.test(`${code} ${raw}`)) {
    return /throttled|attempts allowed|24h/i.test(raw) ? messages['appCheck/throttled'] : messages['appCheck/recaptcha-error'];
  }
  return messages[error?.code] || messages[code] || 'Masuk belum berhasil. Periksa data akun Anda lalu coba kembali.';
};
