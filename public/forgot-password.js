import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { friendlyFirebaseError } from './auth-core.js?v=b74586eaa5ef6110';

const form = document.querySelector('#reset-request-form');
const alertBox = document.querySelector('#reset-alert');
const button = document.querySelector('#reset-submit');
const setAlert = (message, type = 'error') => {
  alertBox.hidden = !message;
  alertBox.textContent = message;
  alertBox.dataset.type = type;
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) return form.reportValidity();
  const email = new FormData(form).get('email').trim().toLowerCase();
  try {
    button.disabled = true;
    button.querySelector('span').textContent = 'Mengirim…';
    auth.languageCode = 'id';
    await sendPasswordResetEmail(auth, email, {
      url: `${window.location.origin}/login.html`,
      handleCodeInApp: false
    });
    form.reset();
    setAlert('Jika email tersebut terdaftar, instruksi reset akan dikirim. Periksa kotak masuk dan folder spam.', 'success');
  } catch (error) {
    // Hindari mengungkap apakah email terdaftar, kecuali format atau jaringan bermasalah.
    if (error?.code === 'auth/user-not-found') setAlert('Jika email terdaftar, instruksi reset akan segera diterima.', 'success');
    else setAlert(friendlyFirebaseError(error));
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Kirim Tautan Reset';
  }
});
