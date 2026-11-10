(() => {
  const loader = document.currentScript;
  const modulePath = loader?.dataset.module;

  const showFileProtocolNotice = () => {
    document.body.classList.remove('auth-pending');
    document.documentElement.classList.add('local-file-blocked');

    const notice = document.createElement('section');
    notice.className = 'local-protocol-notice';
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('aria-modal', 'true');
    notice.setAttribute('aria-labelledby', 'local-protocol-title');
    notice.innerHTML = `
      <div class="local-protocol-card">
        <span class="local-protocol-kicker">FIREBASE HOSTING REQUIRED</span>
        <div class="local-protocol-code">FILE → FIREBASE HOSTING</div>
        <h1 id="local-protocol-title">Buka melalui Firebase Hosting.</h1>
        <p>Halaman ini sedang dibuka langsung sebagai <b>file://</b>. Browser tidak dapat menjalankan modul Firebase secara benar pada mode tersebut.</p>
        <ol>
          <li>Tutup tab ini.</li>
          <li>Deploy folder proyek melalui Firebase CLI.</li>
          <li>Setelah deploy berhasil, buka <strong>https://esoria-codefest.web.app</strong>.</li>
        </ol>
        <div class="local-protocol-note"><b>Gunakan alamat Hosting.</b><span>Konfigurasi keamanan, autentikasi, dan database proyek ini dirancang untuk berjalan melalui HTTPS Firebase Hosting.</span></div>
      </div>`;
    document.body.append(notice);
  };

  const showModuleError = (error) => {
    console.error('Esoria application module failed to load:', error);
    const alert = document.createElement('div');
    alert.className = 'local-runtime-alert';
    alert.setAttribute('role', 'alert');
    const details = String(error?.message || error?.code || '');
    const isAppCheck = /app.?check|recaptcha|throttled|403|attestation/i.test(details);
    const message = isAppCheck
      ? 'Validasi keamanan Firebase App Check sedang gagal atau dibatasi. Jangan refresh berulang. Periksa site key reCAPTCHA Enterprise, domain, kuota, dan metrik App Check di Firebase Console.'
      : 'Modul aplikasi belum bisa dijalankan. Periksa koneksi dan buka kembali halaman. Jika berlanjut, lihat pesan Console untuk penyebab yang tepat.';
    const title = document.createElement('b'); title.textContent = 'Aplikasi belum berhasil dimuat.';
    const body = document.createElement('span'); body.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'local-runtime-alert-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Coba muat ulang';
    retry.addEventListener('click', () => window.location.reload());
    const home = document.createElement('a');
    home.href = '/index.html';
    home.textContent = 'Kembali ke beranda';
    actions.append(retry, home);
    alert.append(title, body, actions);
    document.body.append(alert);
  };

  if (!modulePath) {
    showModuleError(new Error('Atribut data-module tidak ditemukan.'));
    return;
  }

  if (window.location.protocol === 'file:') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showFileProtocolNotice, { once: true });
    } else {
      showFileProtocolNotice();
    }
    return;
  }

  import(new URL(modulePath, document.baseURI).href).catch(showModuleError);
})();
