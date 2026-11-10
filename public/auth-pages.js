import {
  browserLocalPersistence,
  setPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getRedirectResult,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { createMfaFlow } from './auth-mfa.js?v=b74586eaa5ef6110';
import { activateDeviceSession, verifyAndWatchDeviceSession } from './single-device-session.js?v=b74586eaa5ef6110';
import {
  ensureUserDocument,
  friendlyFirebaseError,
  getUserProfile,
  isAdminUser,
  safeNextPath
} from './auth-core.js?v=b74586eaa5ef6110';

const pageMode = document.body.dataset.authPage;
const form = document.querySelector('#auth-form');
const alertBox = document.querySelector('#auth-alert');
const submitButton = document.querySelector('#auth-submit');
const googleButton = document.querySelector('#google-auth');
const passwordInput = document.querySelector('#auth-password');
const confirmInput = document.querySelector('#auth-password-confirm');
const passwordMeter = document.querySelector('#password-strength');
let authActionBusy = false;
let lastAppCheckFailureAt = 0;
// Firebase Auth must keep the session across full-page transitions (Admin →
// Hasil Publik → Juri). Await browser persistence before signing in.
// If this browser blocks durable storage, fail clearly instead of silently
// signing in with an in-memory session that disappears at navigation.
let durablePersistenceReady = false;
const ensureDurableSession = async () => {
  if (durablePersistenceReady) return;
  try {
    await setPersistence(auth, browserLocalPersistence);
    durablePersistenceReady = true;
  } catch (error) {
    const problem = new Error('Browser tidak mengizinkan penyimpanan sesi akun. Aktifkan cookie dan penyimpanan situs untuk esoria-codefest.web.app, lalu coba login kembali.');
    problem.code = 'auth/persistence-unavailable';
    problem.cause = error;
    throw problem;
  }
};

const params = new URLSearchParams(window.location.search);
const requestedNext = safeNextPath(params.get('next'), 'profil.html');
if (params.get('session') === 'expired' && pageMode === 'login') {
  queueMicrotask(() => setAlert('Sesi admin sebelumnya berakhir setelah 25 menit tanpa aktivitas. Masuk kembali untuk melanjutkan.', 'notice'));
}
// Redirect tidak aman untuk diaktifkan sampai helper Firebase berada di domain
// yang sama dan redirect URI Google telah diotorisasi di Google Cloud.
const redirectReady = window.ESORIA_RUNTIME_CONFIG?.googleRedirectReady === true
  && auth.app.options.authDomain === window.location.hostname;
const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (matchMedia('(max-width: 760px) and (pointer: coarse)').matches);


const setAlert = (message = '', type = 'error') => {
  if (!alertBox) return;
  alertBox.hidden = !message;
  alertBox.textContent = message;
  alertBox.dataset.type = type;
};



// Backend menggunakan token App Check limited-use untuk fungsi konsumsi token.
// Jangan memanggil getToken() tambahan sebagai preflight: itu tidak menguji
// token limited-use yang nanti dipakai Functions dan hanya menambah attestation.
const stopRapidRetries = () => {
  if (lastAppCheckFailureAt && Date.now() - lastAppCheckFailureAt < 60000) {
    throw new Error('Sistem keamanan baru saja menolak percobaan ini. Tunggu sekitar satu menit sebelum mencoba lagi. Jika muncul waktu tunggu yang lebih lama, ikuti waktu tersebut.');
  }
};
const displayActionError = (error) => {
  if (/app.?check|recaptcha|throttled|403.*forbidden/i.test(String(error?.code || '') + ' ' + String(error?.message || ''))) {
    lastAppCheckFailureAt = Date.now();
  }
  const message = friendlyFirebaseError(error);
  setAlert(message);
};

const setBusy = (busy, message) => {
  authActionBusy = busy;
  [submitButton, googleButton].forEach((button) => {
    if (button) button.disabled = busy;
  });
  if (submitButton) {
    submitButton.setAttribute('aria-busy', String(busy));
    const label = submitButton.querySelector('span');
    if (label) label.textContent = busy ? message : (pageMode === 'signup' ? 'Buat Akun' : 'Masuk');
  }
};

const verificationSettings = () => ({
  url: `${window.location.origin}/profil.html`,
  handleCodeInApp: false
});

const finishAuthentication = async (user, initial = {}) => {
  await activateDeviceSession(user);
  if (await isAdminUser(user)) {
    window.location.replace('admin.html');
    return;
  }

  const profile = await ensureUserDocument(user, initial, true);
  if (!user.emailVerified) {
    const next = encodeURIComponent(profile?.profileComplete ? requestedNext : 'profil.html');
    window.location.replace(`verify-email.html?next=${next}`);
    return;
  }

  if (auth.currentUser?.uid !== user.uid) return;
  const destination = profile?.profileComplete
    ? requestedNext
    : `profil.html?next=${encodeURIComponent(requestedNext)}&complete=required`;
  window.location.replace(destination);
};

const mfaFlow = pageMode === 'login' ? createMfaFlow({
  auth,
  onVerified: finishAuthentication,
  onError: (error) => { displayActionError(error); setBusy(false); },
  onCancel: () => {
    setBusy(false);
    setAlert('Verifikasi dibatalkan. Anda dapat memulai login lagi.', 'notice');
  }
}) : null;

const handleLoginError = (error) => {
  if (error?.code === 'auth/multi-factor-auth-required' && mfaFlow) {
    try {
      mfaFlow.start(error);
      setAlert('Selesaikan faktor kedua di panel verifikasi untuk melanjutkan.', 'notice');
      return;
    } catch (mfaError) {
      displayActionError(mfaError);
    }
  } else {
    displayActionError(error);
  }
  // A credential can succeed while App Check/Firestore rejects the profile
  // lookup. That is not a logged-out state: do not enable a second login.
  if (auth.currentUser) {
    setBusy(true, 'Sesi belum terverifikasi');
    form?.setAttribute('aria-busy', 'false');
  } else {
    setBusy(false);
  }
};

const scorePassword = (password) => {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z\d]/.test(password)) score += 1;
  return score;
};

passwordInput?.addEventListener('input', () => {
  if (!passwordMeter) return;
  const score = scorePassword(passwordInput.value);
  passwordMeter.dataset.score = String(score);
  passwordMeter.querySelector('i').style.width = `${score * 25}%`;
  passwordMeter.querySelector('span').textContent = ['Belum diisi', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][score];
});

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.togglePassword);
    if (!target) return;
    const visible = target.type === 'text';
    target.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Lihat' : 'Sembunyikan';
    button.setAttribute('aria-pressed', String(!visible));
  });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (authActionBusy) return;
  setAlert('');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = new FormData(form);
  const email = String(data.get('identifier') || data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');

  try {
    setBusy(true, pageMode === 'signup' ? 'Membuat akun…' : 'Memeriksa akun…');
    stopRapidRetries();
    await ensureDurableSession();
    if (pageMode === 'signup') {
      const participantName = String(data.get('display_name') || '').trim();
      if (password !== String(data.get('password_confirm') || '')) throw new Error('Konfirmasi kata sandi belum sama.');
      if (scorePassword(password) < 3) throw new Error('Gunakan minimal 10 karakter dengan huruf besar, huruf kecil, angka, dan sebaiknya simbol.');
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await activateDeviceSession(credential.user);
      await updateProfile(credential.user, { displayName: participantName });
      await ensureUserDocument(credential.user, {
        participantName,
        legalName: participantName,
        displayName: participantName
      }, true);
      await sendEmailVerification(credential.user, verificationSettings());
      window.location.replace(`verify-email.html?next=${encodeURIComponent('profil.html')}&sent=1`);
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await finishAuthentication(credential.user);
    }
  } catch (error) {
    if (pageMode === 'login') handleLoginError(error);
    else {
      displayActionError(error);
      if (auth.currentUser) {
        setBusy(true, 'Sesi belum terverifikasi');
        form?.setAttribute('aria-busy', 'false');
      } else setBusy(false);
    }
  }
});


googleButton?.addEventListener('click', async () => {
  if (authActionBusy) return;
  setAlert('');
  try {
    setBusy(true, 'Menghubungkan Google…');
    stopRapidRetries();
    await ensureDurableSession();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    if (redirectReady && mobileDevice) {
      await signInWithRedirect(auth, provider);
      return;
    }
    const credential = await signInWithPopup(auth, provider);
    await finishAuthentication(credential.user);
  } catch (error) {
    handleLoginError(error);
  }
});

if (params.get('reason') === 'admin') setAlert('Akun ini tidak memiliki klaim admin. Gunakan akun admin resmi.', 'notice');
if (params.get('reason') === 'other-device') setAlert('Akun telah digunakan untuk masuk di perangkat lain. Sesi di perangkat ini berakhir.', 'notice');
if (params.get('reason') === 'archived') setAlert('Akun ini telah diarsipkan. Hubungi panitia untuk pemulihan.', 'notice');
if (params.get('reset') === 'success') setAlert('Kata sandi berhasil diperbarui. Silakan masuk.', 'success');
if (params.get('verified') === 'success') setAlert('Email berhasil diverifikasi. Silakan masuk.', 'success');

if (confirmInput) {
  const validateConfirmation = () => {
    confirmInput.setCustomValidity(confirmInput.value && confirmInput.value !== passwordInput.value
      ? 'Konfirmasi kata sandi belum sama.'
      : '');
  };
  confirmInput.addEventListener('input', validateConfirmation);
  passwordInput?.addEventListener('input', validateConfirmation);
}

// Auth guard on the public login/signup pages. A persistent signed-in session
// must continue to its actual destination without asking the user to log in
// again. Wait for Auth initialization BEFORE unlocking input controls.
const originalInputs = [...(form?.querySelectorAll('input') || [])]
  .map((input) => ({ input, disabled: input.disabled }));

const lockAccountForm = () => {
  setBusy(true, 'Memeriksa sesi…');
  originalInputs.forEach(({ input }) => { input.disabled = true; });
  form?.setAttribute('aria-busy', 'true');
};

const unlockAccountForm = () => {
  originalInputs.forEach(({ input, disabled }) => { input.disabled = disabled; });
  form?.removeAttribute('aria-busy');
  setBusy(false);
  googleButton?.removeAttribute?.('aria-label');
};

const continueExistingSession = async (user) => {
  await verifyAndWatchDeviceSession(user);
  // Read server-authoritative admin state. A failed read must never be treated
  // as a non-admin result, or converted into a second sign-in attempt.
  if (await isAdminUser(user)) {
    window.location.replace('admin.html');
    return;
  }
  if (!user.emailVerified) {
    window.location.replace(`verify-email.html?next=${encodeURIComponent(requestedNext)}`);
    return;
  }
  const profile = await getUserProfile(user.uid);
  if (profile?.archived) {
    await signOut(auth);
    window.location.replace('login.html?reason=archived');
    return;
  }
  if (auth.currentUser?.uid !== user.uid) return;
  const destination = profile?.profileComplete
    ? requestedNext
    : `profil.html?next=${encodeURIComponent(requestedNext)}&complete=required`;
  window.location.replace(destination);
};

const guardAccountEntry = async () => {
  if ((pageMode !== 'login' && pageMode !== 'signup') || !form || !submitButton) return;
  lockAccountForm();
  try {
    // getRedirectResult is run only by this guard, never concurrently with
    // an independent redirect callback or a second sign-in handler.
    if (redirectReady) {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        await finishAuthentication(result.user);
        return;
      }
    }
    await auth.authStateReady();
    const existingUser = auth.currentUser;
    if (!existingUser) {
      unlockAccountForm();
      return;
    }
    await continueExistingSession(existingUser);
  } catch (error) {
    // For a verified Firebase session, preserve its identity even if the
    // protected Firestore/App Check lookup fails. Never enable a second login.
    displayActionError(error);
    if (!auth.currentUser) unlockAccountForm();
    else {
      setBusy(true, 'Sesi belum terverifikasi');
      form?.setAttribute('aria-busy', 'false');
    }
  }
};

void guardAccountEntry();
