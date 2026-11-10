import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { friendlyFirebaseError, safeNextPath } from './auth-core.js?v=b74586eaa5ef6110';

import { verifyAndWatchDeviceSession } from './single-device-session.js?v=b74586eaa5ef6110';
const address = document.querySelector('#verify-email-address');
const alertBox = document.querySelector('#verify-alert');
const checkButton = document.querySelector('#verify-check');
const resendButton = document.querySelector('#verify-resend');
const next = safeNextPath(new URLSearchParams(location.search).get('next'), 'profil.html');
const setAlert = (message, type = 'error') => { alertBox.hidden = !message; alertBox.textContent = message; alertBox.dataset.type = type; };
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) return location.replace(`login.html?next=${encodeURIComponent(next)}`);
  try { await verifyAndWatchDeviceSession(user); } catch (error) { setAlert(friendlyFirebaseError(error)); return; }
  address.textContent = `Email verifikasi dikirim ke ${user.email || 'akun Anda'}.`;
  if (new URLSearchParams(location.search).get('sent') === '1') setAlert('Email verifikasi telah dikirim.', 'success');
  try {
    await user.reload();
    if (auth.currentUser?.uid !== user.uid) return;
    if (user.emailVerified) {
      await user.getIdToken(true);
      location.replace(next);
    }
  } catch (error) { setAlert(friendlyFirebaseError(error)); }
});

checkButton.addEventListener('click', async () => {
  if (!currentUser) return;
  try {
    checkButton.disabled = true;
    checkButton.querySelector('span').textContent = 'Memeriksa…';
    await currentUser.reload();
    if (!currentUser.emailVerified) setAlert('Email belum terverifikasi. Buka tautan pada email lalu coba lagi.', 'notice');
    else {
      await currentUser.getIdToken(true);
      location.replace(next);
    }
  } catch (error) { setAlert(friendlyFirebaseError(error)); }
  finally { checkButton.disabled = false; checkButton.querySelector('span').textContent = 'Saya Sudah Verifikasi'; }
});

resendButton.addEventListener('click', async () => {
  if (!currentUser) return;
  try {
    resendButton.disabled = true;
    await sendEmailVerification(currentUser, { url: `${location.origin}/${next}`, handleCodeInApp: false });
    setAlert('Email verifikasi baru telah dikirim.', 'success');
    setTimeout(() => { resendButton.disabled = false; }, 30000);
  } catch (error) { resendButton.disabled = false; setAlert(friendlyFirebaseError(error)); }
});


