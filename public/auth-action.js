import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { friendlyFirebaseError, safeNextPath } from './auth-core.js?v=b74586eaa5ef6110';

const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const code = params.get('oobCode');
const continueUrl = params.get('continueUrl');
const title = document.querySelector('#action-title');
const eyebrow = document.querySelector('#action-eyebrow');
const description = document.querySelector('#action-description');
const alertBox = document.querySelector('#action-alert');
const form = document.querySelector('#action-password-form');
const finish = document.querySelector('#action-finish');
const setAlert = (message, type = 'error') => { alertBox.hidden = !message; alertBox.textContent = message; alertBox.dataset.type = type; };
const showFinish = (href = 'login.html') => { finish.href = href; finish.hidden = false; };
const safeContinueDestination = () => {
  if (!continueUrl) return 'profil.html';
  try {
    const parsed = new URL(continueUrl, location.origin);
    if (parsed.origin !== location.origin) return 'profil.html';
    return safeNextPath(`${parsed.pathname}${parsed.search}${parsed.hash}`, 'profil.html');
  } catch {
    return 'profil.html';
  }
};

const scorePassword = (password) => password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);

document.querySelector('[data-toggle-action-password]').addEventListener('click', (event) => {
  const input = document.querySelector('#action-password');
  const visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; event.currentTarget.textContent = visible ? 'Lihat' : 'Sembunyikan';
});

const initialize = async () => {
  if (!code) throw new Error('Kode tindakan tidak ditemukan pada tautan.');
  auth.languageCode = 'id';
  if (mode === 'resetPassword') {
    const email = await verifyPasswordResetCode(auth, code);
    eyebrow.textContent = 'PASSWORD RESET'; title.textContent = 'Buat kata sandi baru.'; description.textContent = `Akun: ${email}`; form.hidden = false; return;
  }
  if (mode === 'verifyEmail') {
    await checkActionCode(auth, code); await applyActionCode(auth, code);
    eyebrow.textContent = 'EMAIL VERIFIED'; title.textContent = 'Email berhasil dikonfirmasi.'; description.textContent = 'Identitas akun sudah aktif dan dapat digunakan untuk pendaftaran.'; setAlert('Verifikasi selesai. Silakan masuk atau kembali ke akun Anda.', 'success'); showFinish(safeContinueDestination()); return;
  }
  if (mode === 'recoverEmail') {
    await checkActionCode(auth, code); await applyActionCode(auth, code);
    eyebrow.textContent = 'EMAIL RECOVERED'; title.textContent = 'Alamat email berhasil dipulihkan.'; description.textContent = 'Masuk kembali dan segera perbarui kata sandi akun.'; showFinish('forgot-password.html'); return;
  }
  throw new Error('Jenis tindakan akun tidak didukung.');
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#action-password').value;
  const confirmation = document.querySelector('#action-password-confirm').value;
  if (password !== confirmation) return setAlert('Konfirmasi kata sandi belum sama.');
  if (!scorePassword(password)) return setAlert('Gunakan minimal 10 karakter dengan huruf besar, huruf kecil, dan angka.');
  const button = document.querySelector('#action-submit');
  try {
    button.disabled = true; button.querySelector('span').textContent = 'Menyimpan…';
    await confirmPasswordReset(auth, code, password);
    form.hidden = true; eyebrow.textContent = 'PASSWORD UPDATED'; title.textContent = 'Kata sandi berhasil diperbarui.'; description.textContent = 'Gunakan kata sandi baru untuk masuk.'; setAlert('Perubahan berhasil disimpan.', 'success'); showFinish('login.html?reset=success');
  } catch (error) { setAlert(friendlyFirebaseError(error)); button.disabled = false; button.querySelector('span').textContent = 'Simpan Kata Sandi Baru'; }
});

initialize().catch((error) => { eyebrow.textContent = 'INVALID OR EXPIRED'; title.textContent = 'Tautan tidak dapat digunakan.'; description.textContent = 'Tautan mungkin sudah dipakai atau melewati masa berlaku.'; setAlert(friendlyFirebaseError(error)); showFinish(mode === 'resetPassword' ? 'forgot-password.html' : 'login.html'); });
