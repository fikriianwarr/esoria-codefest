// Controller mandiri di semua halaman agar logout tetap bekerja saat modul profil gagal.
import { signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { paperConfirm } from './paper-confirm.js?v=b74586eaa5ef6110';

let inProgress = false;
let confirming = false;
const withTimeout = (promise, ms) => Promise.race([
  promise.catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, ms))
]);

async function logout(button) {
  if (inProgress || confirming) return;
  confirming = true;
  const area = button.closest('header');
  const onRegistration = Boolean(button.closest('.registration-header'));
  const onAdmin = Boolean(button.closest('.admin-header'));
  let approved = false;
  try {
    approved = await paperConfirm({
      title: onAdmin ? 'Keluar dari panel admin?' : onRegistration ? 'Keluar dari pendaftaran?' : 'Keluar dari akun ESORIA?',
      message: onRegistration
        ? 'Yakin ingin keluar? Jika penyimpanan formulir diizinkan, isian yang belum dikirim tetap ada di perangkat ini.'
        : onAdmin
          ? 'Yakin ingin keluar dari panel admin? Masuk lagi untuk mengelola peserta dan pendaftaran.'
          : 'Yakin ingin keluar? Anda bisa masuk lagi kapan saja untuk melihat profil, pendaftaran, dan tiket.',
      confirmText: 'Ya, keluar', danger: true
    });
  } catch (error) {
    console.warn('Dialog konfirmasi keluar belum dapat dibuka:', error);
    // Never log out without confirmation. Keep the button usable for retry.
    const notice = document.createElement('span');
    notice.setAttribute('role', 'alert');
    notice.textContent = 'Konfirmasi belum tersedia. Coba lagi.';
    button.insertAdjacentElement('afterend', notice);
    setTimeout(() => notice.remove(), 6000);
  } finally {
    confirming = false;
  }
  if (!approved) return;
  inProgress = true;
  document.dispatchEvent(new CustomEvent('esoria:logout-approved'));
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = 'Keluar…';
  try {
    // Pembersihan FCM bersifat best-effort; tidak boleh menahan logout karena App Check error.
    if (!onAdmin) {
      const uid = auth.currentUser?.uid;
      // Jangan tunggu unduhan SDK Messaging atau token reCAPTCHA sampai berjam-jam.
      await withTimeout(import('./push-notifications.js?v=b74586eaa5ef6110').then((m) => m.disablePushForCurrentUser()), 1200);
      if (uid) { try { localStorage.removeItem(`esoria:push-opt-in:${uid}`); } catch {} }
    }
    await signOut(auth);
    window.location.replace(onAdmin || onRegistration || area ? 'login.html' : 'index.html');
  } catch (error) {
    inProgress = false;
    button.disabled = false;
    button.textContent = previous;
    const notice = document.createElement('p');
    notice.className = 'esoria-logout-error';
    notice.setAttribute('role', 'alert');
    notice.textContent = 'Gagal mengakhiri sesi. Coba lagi, atau gunakan keluar dari semua perangkat melalui pengaturan akun.';
    button.insertAdjacentElement('afterend', notice);
    setTimeout(() => notice.remove(), 6000);
    console.warn('Logout failed:', error);
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-logout], #registration-logout, #profile-logout, #admin-logout, #verify-logout');
  if (!button) return;
  event.preventDefault();
  void logout(button);
});
