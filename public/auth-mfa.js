// Faktor kedua Firebase Authentication: SMS atau authenticator (TOTP).
// Tantangan hanya diberikan jika Firebase mengembalikan auth/multi-factor-auth-required.
// Tidak menyimpan OTP, verificationId, atau resolver di storage browser.
import {
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  TotpMultiFactorGenerator
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

export const createMfaFlow = ({ auth, onVerified, onCancel, onError }) => {
  const panel = document.querySelector('#auth-mfa-panel');
  if (!panel) return null;

  const information = panel.querySelector('#auth-mfa-description');
  const methodRow = panel.querySelector('#auth-mfa-method-row');
  const methodSelect = panel.querySelector('#auth-mfa-method');
  const captchaContainer = panel.querySelector('#auth-mfa-recaptcha');
  const sendButton = panel.querySelector('#auth-mfa-send');
  const codeForm = panel.querySelector('#auth-mfa-code-form');
  const codeInput = panel.querySelector('#auth-mfa-code');
  const confirmButton = panel.querySelector('#auth-mfa-confirm');
  const cancelButton = panel.querySelector('#auth-mfa-cancel');
  const feedback = panel.querySelector('#auth-mfa-feedback');

  let resolver = null;
  let verificationId = '';
  let verifier = null;
  let busy = false;
  let operation = '';
  let lastSmsAt = 0;
  let attemptVersion = 0;

  const selectedHint = () => resolver?.hints?.[Number(methodSelect.value) || 0] || null;
  const isPhone = (hint) => hint?.factorId === PhoneMultiFactorGenerator.FACTOR_ID;
  const isTotp = (hint) => hint?.factorId === TotpMultiFactorGenerator.FACTOR_ID;

  const showFeedback = (text = '', isError = false) => {
    feedback.hidden = !text;
    feedback.textContent = text;
    feedback.dataset.state = isError ? 'error' : 'info';
  };

  const humanError = (error) => {
    const code = String(error?.code || '');
    if (code === 'auth/invalid-verification-code') return 'Kode salah. Cek SMS, lalu coba lagi.';
    if (code === 'auth/code-expired' || code === 'auth/session-expired') return 'Kode kedaluwarsa. Kirim kode baru.';
    if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') return 'Terlalu banyak percobaan. Tunggu sebelum meminta kode baru.';
    if (code === 'auth/captcha-check-failed' || code === 'auth/invalid-app-credential') return 'Pemeriksaan keamanan belum berhasil. Muat ulang halaman lalu coba lagi.';
    if (code === 'auth/invalid-multi-factor-session' || code === 'auth/multi-factor-info-not-found') return 'Sesi verifikasi kedaluwarsa. Batalkan lalu masuk kembali dengan Google.';
    if (code === 'auth/unverified-email') return 'Email akun belum diverifikasi. Selesaikan verifikasi email terlebih dahulu.';
    return 'Verifikasi belum berhasil. Periksa kode dan koneksi lalu coba lagi.';
  };

  const setBusy = (action = '') => {
    operation = action || '';
    busy = Boolean(operation);
    sendButton.disabled = busy;
    confirmButton.disabled = busy;
    methodSelect.disabled = busy;
    cancelButton.disabled = operation === 'confirm';
    codeInput.disabled = busy;
    panel.dataset.operation = operation;
    panel.setAttribute('aria-busy', String(busy));
    sendButton.setAttribute('aria-busy', String(operation === 'send'));
    confirmButton.setAttribute('aria-busy', String(operation === 'confirm'));
    sendButton.textContent = operation === 'send' ? 'Mengirim kode…' : (verificationId ? 'Kirim ulang kode' : 'Kirim kode');
    confirmButton.textContent = operation === 'confirm' ? 'Memverifikasi…' : 'Verifikasi & Masuk';
  };

  const disposeCaptcha = () => {
    try { verifier?.clear(); } catch { /* verifikasi sudah kedaluwarsa */ }
    verifier = null;
    captchaContainer.replaceChildren();
    captchaContainer.style.minHeight = '0px';
    captchaContainer.style.height = '0px';
  };

  const fitCaptcha = () => {
    const widget = captchaContainer.firstElementChild;
    if (!widget || captchaContainer.hidden) return;
    const naturalWidth = 304;
    const naturalHeight = 78;
    const available = Math.max(0, captchaContainer.clientWidth);
    const scale = available && available < naturalWidth ? available / naturalWidth : 1;
    widget.style.width = `${naturalWidth}px`;
    widget.style.position = 'absolute';
    widget.style.left = '50%';
    widget.style.transformOrigin = 'top center';
    widget.style.transform = `translateX(-50%) scale(${scale})`;
    captchaContainer.style.height = `${Math.ceil(naturalHeight * scale)}px`;
    captchaContainer.style.minHeight = captchaContainer.style.height;
  };

  const configureMethod = () => {
    verificationId = '';
    codeInput.value = '';
    codeForm.hidden = true;
    disposeCaptcha();
    const hint = selectedHint();
    if (isPhone(hint)) {
      const end = String(hint.phoneNumber || '').replace(/\D/g, '').slice(-4);
      information.textContent = end
        ? `Nomor tujuan: •••• ${end}.`
        : 'Masukkan kode SMS yang dikirim ke nomor keamanan terdaftar.';
      sendButton.hidden = false;
      captchaContainer.hidden = true;
      showFeedback('Tekan Kirim kode untuk melanjutkan.');
    } else if (isTotp(hint)) {
      information.textContent = 'Kode dari aplikasi autentikatormu.';
      sendButton.hidden = true;
      captchaContainer.hidden = true;
      codeForm.hidden = false;
      showFeedback('Gunakan enam digit kode terbaru dari aplikasi autentikator Anda.');
      codeInput.focus({ preventScroll: true });
    } else {
      information.textContent = 'Metode verifikasi ini belum dapat digunakan di halaman login.';
      sendButton.hidden = true;
      captchaContainer.hidden = true;
      showFeedback('Hubungi pengelola akun untuk bantuan verifikasi.', true);
    }
  };

  const reset = () => {
    attemptVersion += 1;
    resolver = null;
    verificationId = '';
    lastSmsAt = 0;
    codeInput.value = '';
    disposeCaptcha();
    showFeedback('');
    panel.hidden = true;
    document.body.classList.remove('auth-mfa-active');
    setBusy('');
  };

  const start = (error) => {
    reset();
    resolver = getMultiFactorResolver(auth, error);
    if (!resolver?.hints?.length) throw new Error('Metode verifikasi tidak tersedia untuk akun ini.');

    methodSelect.replaceChildren();
    resolver.hints.forEach((hint, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = isPhone(hint)
        ? `SMS ${hint.phoneNumber || 'nomor terdaftar'}`
        : isTotp(hint)
          ? `Aplikasi autentikator ${hint.displayName || ''}`.trim()
          : 'Metode tidak didukung';
      methodSelect.append(option);
    });
    methodSelect.value = '0';
    methodRow.hidden = resolver.hints.length < 2;
    panel.hidden = false;
    document.body.classList.add('auth-mfa-active');
    configureMethod();
    panel.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    return true;
  };

  methodSelect.addEventListener('change', () => {
    if (busy) return;
    lastSmsAt = 0;
    configureMethod();
  });

  sendButton.addEventListener('click', async () => {
    if (busy || !resolver || !isPhone(selectedHint())) return;
    const seconds = Math.ceil((lastSmsAt + 30000 - Date.now()) / 1000);
    if (seconds > 0) {
      showFeedback(`Tunggu sekitar ${seconds} detik sebelum meminta kode baru.`, true);
      return;
    }
    const version = attemptVersion;
    const activeResolver = resolver;
    setBusy('send');
    showFeedback('Centang CAPTCHA untuk menerima kode.');
    try {
      disposeCaptcha();
      captchaContainer.hidden = false;
      // reCAPTCHA Auth berbeda dari App Check dan memang diperlukan untuk pengiriman SMS MFA.
      const activeVerifier = new RecaptchaVerifier(auth, captchaContainer, { size: 'normal' });
      verifier = activeVerifier;
      await activeVerifier.render();
      if (version !== attemptVersion) return;
      fitCaptcha();
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber({
        multiFactorHint: selectedHint(),
        session: activeResolver.session
      }, activeVerifier);
      if (version !== attemptVersion) return;
      verificationId = id;
      lastSmsAt = Date.now();
      codeForm.hidden = false;
      captchaContainer.hidden = true;
      disposeCaptcha();
      showFeedback('Kode terkirim. Masukkan 6 digit dari SMS.');
      codeInput.focus({ preventScroll: true });
    } catch (error) {
      if (version !== attemptVersion) return;
      disposeCaptcha();
      captchaContainer.hidden = true;
      showFeedback(humanError(error), true);
      onError?.(error);
    } finally {
      if (version === attemptVersion) setBusy('');
    }
  });

  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !resolver) return;
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      showFeedback('Masukkan tepat enam digit kode verifikasi.', true);
      codeInput.focus({ preventScroll: true });
      return;
    }
    const hint = selectedHint();
    if (isPhone(hint) && !verificationId) {
      showFeedback('Kirim kode SMS terlebih dahulu.', true);
      return;
    }
    const version = attemptVersion;
    const activeResolver = resolver;
    setBusy('confirm');
    showFeedback('Sedang memeriksa kode…');
    try {
      const assertion = isPhone(hint)
        ? PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code))
        : isTotp(hint)
          ? TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code)
          : null;
      if (!assertion) throw new Error('Metode verifikasi tidak didukung.');
      const credential = await activeResolver.resolveSignIn(assertion);
      if (version !== attemptVersion) return;
      reset();
      try {
        // MFA selesai: kegagalan API/App Check setelah ini bukan kesalahan kode SMS.
        await onVerified(credential.user);
      } catch (postLoginError) {
        onError?.(postLoginError);
      }
    } catch (error) {
      if (version !== attemptVersion) return;
      showFeedback(humanError(error), true);
      onError?.(error);
      setBusy('');
    }
  });

  cancelButton.addEventListener('click', () => {
    if (operation === 'confirm') return;
    reset();
    onCancel?.();
  });

  window.addEventListener('resize', () => {
    if (!panel.hidden && !captchaContainer.hidden) fitCaptcha();
  }, { passive: true });
  window.addEventListener('pagehide', () => {
    if (!panel.hidden) { reset(); onCancel?.(); }
    else disposeCaptcha();
  });
  return { start, reset };
};
