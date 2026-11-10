import {
  EmailAuthProvider,
  GoogleAuthProvider,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  multiFactor,
  reauthenticateWithCredential,
  reauthenticateWithPopup
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { auth, functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';
import {currentSessionKey} from './single-device-session.js?v=b74586eaa5ef6110';

const callApi = (action, payload = {}) => httpsCallable(functions, 'esoriaApi', {
  timeout: 540000,
  limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)
})({ action, payload:{...payload,sessionKey:currentSessionKey()} });

const dialog = document.querySelector('#admin-security-dialog');
const openButton = document.querySelector('#admin-security-open');
const closeButtons = dialog?.querySelectorAll('[data-admin-security-close]') || [];
const claimRole = dialog?.querySelector('[data-security-role]');
const claimState = dialog?.querySelector('[data-security-claim]');
const mfaState = dialog?.querySelector('[data-security-mfa]');
const appCheckState = dialog?.querySelector('[data-security-app-check]');
const refreshButton = dialog?.querySelector('#admin-security-refresh-claim');
const sendButton = dialog?.querySelector('#admin-mfa-send');
const enrollButton = dialog?.querySelector('#admin-mfa-enroll');
const removeButton = dialog?.querySelector('#admin-mfa-remove-old');
const oldPhonePanel = dialog?.querySelector('#admin-mfa-old-panel');
const oldPhoneSelect = dialog?.querySelector('#admin-mfa-old-factor');
const passwordInput = dialog?.querySelector('#admin-mfa-password');
const passwordLabel = passwordInput?.closest('label');
const mfaInstruction = dialog?.querySelector('[data-mfa-instruction]');
const phoneInput = dialog?.querySelector('#admin-mfa-phone');
const codeInput = dialog?.querySelector('#admin-mfa-code');
const feedback = dialog?.querySelector('#admin-security-feedback');
const isGoogleOnly = (user) => user?.providerData?.some((provider) => provider.providerId === 'google.com')
  && !user?.providerData?.some((provider) => provider.providerId === 'password');
let verificationId = '';
let verifier = null;
let busy = false;
let lastSmsRequestAt = 0;

const show = (message, type = 'success') => {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.type = type;
  feedback.hidden = false;
};
const setState = (node, label, state) => {
  if (!node) return;
  node.textContent = label;
  node.dataset.state = state;
};
const setBusy = (value) => {
  busy = value;
  [sendButton, enrollButton, removeButton].forEach((button) => {
    if (button) button.disabled = value || (button === enrollButton && !verificationId);
  });
  if (!value && removeButton && oldPhonePanel) removeButton.disabled = oldPhonePanel.hidden;
};
const disposeVerifier = () => {
  try { verifier?.clear(); } catch { /* expired recaptcha already disposed */ }
  verifier = null;
};
const safeSecurityError = (error) => {
  const code = String(error?.code || '');
  if (code.includes('requires-recent-login') || code.includes('multi-factor-auth-required')) {
    return 'Sesi verifikasi perlu diperbarui. Keluar lalu masuk kembali dengan faktor kedua, kemudian ulangi perubahan nomor.';
  }
  if (code.includes('invalid-verification-code') || code.includes('code-expired')) return 'Kode SMS salah atau kedaluwarsa. Periksa kode dan coba lagi.';
  if (code.includes('too-many-requests') || code.includes('quota-exceeded')) return 'Batas permintaan SMS tercapai. Tunggu sebelum mencoba lagi.';
  if (code.includes('captcha')) return 'Pemeriksaan keamanan SMS belum berhasil. Muat ulang halaman dan coba lagi.';
  if (code.includes('credential-already-in-use')) return 'Nomor tersebut sudah digunakan oleh akun lain.';
  return 'Proses keamanan belum selesai. Periksa koneksi dan coba lagi.';
};

const reauthenticate = async (user) => {
  // A recent sign-in already proves both factors; reauthenticate when the session ages.
  const result = await user.getIdTokenResult();
  const age = Date.now() - Date.parse(result.authTime);
  if (Number.isFinite(age) && age >= 0 && age < 3 * 60_000) return;
  if (isGoogleOnly(user)) {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
  } else {
    const password = passwordInput?.value || '';
    if (!user.email || password.length < 6) throw Object.assign(new Error('Password belum diisi'), { code: 'auth/requires-recent-login' });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  }
};
const refreshSecurityView = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const needsPassword = !isGoogleOnly(user);
  if (passwordLabel) passwordLabel.hidden = !needsPassword;
  if (dialog) dialog.dataset.passwordRequired = String(needsPassword);
  if (mfaInstruction) mfaInstruction.textContent = 'Verifikasi nomor baru terlebih dahulu. Setelah berhasil, Anda dapat menonaktifkan nomor lama agar akun tetap memakai nomor yang paling terbaru.';
  const token = await user.getIdTokenResult();
  if (claimRole) claimRole.textContent = 'Administrator aktif';
  setState(claimState, token.claims.admin === true ? 'AKSES AKTIF' : 'PERLU PEMERIKSAAN', token.claims.admin === true ? 'good' : 'warn');
  const factors = multiFactor(user).enrolledFactors;
  const phoneFactors = factors.filter((factor) => factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID);
  setState(mfaState, factors.length ? `${factors.length} METODE AKTIF` : 'BELUM DIAKTIFKAN', factors.length ? 'good' : 'warn');
  if (oldPhonePanel && oldPhoneSelect) {
    oldPhoneSelect.replaceChildren();
    for (const factor of phoneFactors) {
      const option = document.createElement('option');
      option.value = factor.uid;
      option.textContent = `SMS ${factor.phoneNumber || 'nomor tersimpan'}`;
      oldPhoneSelect.append(option);
    }
    oldPhonePanel.hidden = factors.length < 2 || phoneFactors.length < 1;
  }
  try {
    const response = await callApi('getSystemHealth');
    const health = response.data || {};
    const enforced = Boolean(runtimeConfig.appCheckSiteKey && health.appCheckEnforced);
    setState(appCheckState, enforced ? 'AKTIF' : runtimeConfig.appCheckSiteKey ? 'PERLU DIVERIFIKASI' : 'BELUM DIKONFIGURASI', enforced ? 'good' : 'warn');
  } catch {
    setState(appCheckState, runtimeConfig.appCheckSiteKey ? 'KEY TERSEDIA' : 'BELUM DIKONFIGURASI', runtimeConfig.appCheckSiteKey ? 'neutral' : 'warn');
  }
  // Verify factor inventory from Firebase Auth on the server and record its changes.
  try { await callApi('syncAdminMfaStatus'); } catch { /* preserve MFA usability if audit endpoint is offline */ }
};
const openDialog = () => {
  if (!dialog) return;
  if (!dialog.open) (typeof dialog.showModal === 'function' ? dialog.showModal() : dialog.setAttribute('open', ''));
  dialog.scrollTop = 0;
  // The modal is a scrollable sheet on phones; restore its title on every open.
  void refreshSecurityView().catch(() => show('Status keamanan belum dapat dimuat. Periksa jaringan dan coba lagi.', 'error'));
};
const closeDialog = () => {
  if (!dialog) return;
  typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open');
};
openButton?.addEventListener('click', openDialog);
closeButtons.forEach((button) => button.addEventListener('click', closeDialog));
dialog?.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });

refreshButton?.addEventListener('click', async () => {
  refreshButton.disabled = true;
  try {
    await callApi('refreshAdminClaims');
    await auth.currentUser?.getIdToken(true);
    await refreshSecurityView();
    show('Status akses administrator sudah diperiksa dan disinkronkan.');
  } catch (error) {
    show(safeSecurityError(error), 'error');
  } finally { refreshButton.disabled = false; }
});

sendButton?.addEventListener('click', async () => {
  if (busy) return;
  const user = auth.currentUser;
  const phone = String(phoneInput?.value || '').replace(/[\s()-]/g, '');
  if (!user || !/^\+62\d{8,13}$/.test(phone)) { show('Gunakan nomor Indonesia aktif dengan format +62.', 'error'); return; }
  const waitSeconds = Math.ceil((lastSmsRequestAt + 60000 - Date.now()) / 1000);
  if (waitSeconds > 0) { show(`Tunggu ${waitSeconds} detik untuk mengirim kode berikutnya.`, 'error'); return; }
  setBusy(true);
  try {
    await reauthenticate(user);
    disposeVerifier();
    verifier = new RecaptchaVerifier(auth, 'admin-mfa-recaptcha', { size: 'invisible' });
    const session = await multiFactor(user).getSession();
    verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ phoneNumber: phone, session }, verifier);
    lastSmsRequestAt = Date.now();
    if (codeInput) codeInput.disabled = false;
    show('Kode SMS telah dikirim. Masukkan enam digit untuk memverifikasi nomor baru.');
  } catch (error) {
    verificationId = '';
    disposeVerifier();
    show(safeSecurityError(error), 'error');
  } finally { setBusy(false); }
});

enrollButton?.addEventListener('click', async () => {
  if (busy) return;
  const user = auth.currentUser;
  const code = String(codeInput?.value || '').trim();
  if (!user || !verificationId || !/^\d{6}$/.test(code)) { show('Masukkan enam digit kode SMS.', 'error'); return; }
  setBusy(true);
  try {
    await multiFactor(user).enroll(
      PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code)),
      'Nomor keamanan ESORIA'
    );
    verificationId = '';
    if (passwordInput) passwordInput.value = '';
    if (codeInput) { codeInput.value = ''; codeInput.disabled = true; }
    if (phoneInput) phoneInput.value = '';
    disposeVerifier();
    await refreshSecurityView().catch(() => {});
    show('Nomor baru sudah terverifikasi. Jika mengganti nomor, pilih nomor lama di bawah untuk menonaktifkannya setelah masuk ulang jika diperlukan.');
  } catch (error) { show(safeSecurityError(error), 'error'); }
  finally { setBusy(false); }
});

removeButton?.addEventListener('click', async () => {
  if (busy) return;
  const user = auth.currentUser;
  const oldUid = oldPhoneSelect?.value;
  const factors = user ? multiFactor(user).enrolledFactors : [];
  if (!oldUid || factors.length < 2 || !factors.some((factor) => factor.uid === oldUid)) {
    show('Verifikasi nomor baru terlebih dahulu. Faktor terakhir tidak dapat dihapus dari panel ini.', 'error');
    return;
  }
  if (!window.confirm('Nonaktifkan nomor lama yang dipilih? Nomor lain harus tetap tersedia untuk login.')) return;
  setBusy(true);
  try {
    await reauthenticate(user);
    await multiFactor(user).unenroll(oldUid);
    await refreshSecurityView().catch(() => {});
    show('Nomor lama sudah dinonaktifkan. Jika diminta, masuk ulang untuk memperbarui sesi keamanan.');
  } catch (error) { show(safeSecurityError(error), 'error'); }
  finally { setBusy(false); }
});

window.addEventListener('esoria:admin-security-open', openDialog);
window.addEventListener('pagehide', disposeVerifier);
