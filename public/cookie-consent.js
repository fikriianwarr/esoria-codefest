(() => {
  const STORAGE_KEY = 'esoria_cookie_preferences_v2';
  const LEGACY_KEY = 'esoria_cookie_preferences_v1';
  const script = document.querySelector('script[data-esoria-cookie]');
  const rootUrl = new URL('.', script?.src || window.location.href);
  const policyUrl = new URL('legal/cookie-policy.html', rootUrl).href;
  const privacyUrl = new URL('legal/privacy-policy.html', rootUrl).href;
  let preferences = readPreferences();
  let returnFocus = null;
  let toastTimer = 0;
  let panelCloseTimer = 0;

  const DEFAULTS = Object.freeze({
    necessary: true,
    functional: false,
    preferences: false,
    analytics: false,
    marketing: false
  });

  function normalizePreferences(value) {
    if (!value || value.necessary !== true) return null;
    return {
      necessary: true,
      functional: value.functional === true,
      preferences: value.preferences === true,
      analytics: value.analytics === true,
      marketing: value.marketing === true,
      version: 2,
      updatedAt: value.updatedAt || ''
    };
  }

  function readPreferences() {
    try {
      const current = normalizePreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
      if (current) return current;
      const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || 'null');
      if (!legacy?.necessary) return null;
      return {
        ...DEFAULTS,
        preferences: legacy.preferences === true,
        updatedAt: legacy.updatedAt || '',
        version: 2
      };
    } catch {
      return null;
    }
  }

  function applyPreferences(next) {
    Object.entries(next).forEach(([key, enabled]) => {
      if (!['necessary', 'functional', 'preferences', 'analytics', 'marketing'].includes(key)) return;
      document.documentElement.dataset[`cookie${key[0].toUpperCase()}${key.slice(1)}`] = enabled ? 'enabled' : 'disabled';
    });
    document.documentElement.dataset.cookiePreferences = next.preferences ? 'enabled' : 'disabled';
    window.esoriaCookiePreferences = Object.freeze({ ...next });
    window.dispatchEvent(new CustomEvent('esoria:cookie-consent', { detail: { ...next } }));
  }

  if (preferences) applyPreferences(preferences);

  const shell = document.createElement('section');
  shell.className = 'ec-cookie-shell';
  shell.hidden = true;
  shell.setAttribute('aria-labelledby', 'ec-cookie-title');
  shell.setAttribute('aria-describedby', 'ec-cookie-description');
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.innerHTML = `
    <div class="ec-cookie-panel">
      <button aria-label="Tutup pengaturan cookie" class="ec-cookie-close" data-cookie-close type="button">×</button>
      <aside class="ec-cookie-aside" aria-hidden="true">
        <div class="ec-cookie-mark">ECF</div>
        <div class="ec-cookie-aside-copy">
          <small>Preference dossier</small>
          <strong>Kendali tetap di tangan Anda.</strong>
          <span>Lima kategori penyimpanan dijelaskan secara terpisah agar pilihan perangkat lebih transparan.</span>
        </div>
      </aside>
      <div class="ec-cookie-content">
        <div class="ec-cookie-view" data-cookie-view="summary">
          <span class="ec-cookie-kicker">Preferensi perangkat</span>
          <h2 id="ec-cookie-title">Kami menghormati pilihan Anda.</h2>
          <p id="ec-cookie-description">Esoria memakai penyimpanan esensial untuk sesi masuk dan keamanan. Penyimpanan fungsional, preferensi, analitik, dan pemasaran hanya aktif setelah Anda mengizinkannya.</p>
          <div class="ec-cookie-links"><a href="${policyUrl}">Kebijakan Cookie</a><a href="${privacyUrl}">Kebijakan Privasi</a></div>
          <div class="ec-cookie-actions">
            <button class="ec-cookie-button primary" data-cookie-accept-all type="button">Terima Semua</button>
            <button class="ec-cookie-button" data-cookie-essential type="button">Hanya Esensial</button>
            <button class="ec-cookie-button settings" data-cookie-show-settings type="button">Atur Pilihan Lengkap</button>
          </div>
        </div>
        <div class="ec-cookie-view" data-cookie-view="settings" hidden>
          <span class="ec-cookie-kicker">Pengaturan cookie lengkap</span>
          <h2 id="ec-cookie-settings-title" tabindex="-1">Atur preferensi perangkat.</h2>
          <p>Cookie esensial selalu aktif. Empat kategori opsional berikut dapat diubah kapan saja melalui tautan Preferensi Cookie.</p>
          <div class="ec-cookie-choice-list">
            <label class="ec-cookie-choice"><b>01</b><span><strong>Esensial</strong><small>Sesi masuk, keamanan, proteksi akun, dan fungsi inti pendaftaran.</small></span><span class="ec-cookie-toggle"><input checked disabled type="checkbox"><i></i></span></label>
            <label class="ec-cookie-choice"><b>02</b><span><strong>Fungsional</strong><small>Mendukung fitur tambahan seperti draft formulir, status antarmuka, dan pengalaman lintas halaman.</small></span><span class="ec-cookie-toggle"><input data-cookie-category="functional" type="checkbox"><i></i></span></label>
            <label class="ec-cookie-choice"><b>03</b><span><strong>Preferensi</strong><small>Mengingat pilihan tampilan, bahasa, kategori tiket, dan pengaturan perangkat.</small></span><span class="ec-cookie-toggle"><input data-cookie-category="preferences" type="checkbox"><i></i></span></label>
            <label class="ec-cookie-choice"><b>04</b><span><strong>Analitik</strong><small>Membantu memahami penggunaan halaman secara agregat. Tidak aktif sebelum persetujuan.</small></span><span class="ec-cookie-toggle"><input data-cookie-category="analytics" type="checkbox"><i></i></span></label>
            <label class="ec-cookie-choice"><b>05</b><span><strong>Pemasaran</strong><small>Digunakan hanya bila kampanye atau integrasi pemasaran diaktifkan di kemudian hari.</small></span><span class="ec-cookie-toggle"><input data-cookie-category="marketing" type="checkbox"><i></i></span></label>
          </div>
          <div class="ec-cookie-settings-actions">
            <button class="ec-cookie-button primary" data-cookie-save type="button">Simpan Pilihan</button>
            <button class="ec-cookie-button" data-cookie-back type="button">Kembali</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.append(shell);

  const summaryView = shell.querySelector('[data-cookie-view="summary"]');
  const settingsView = shell.querySelector('[data-cookie-view="settings"]');
  const categoryInputs = [...shell.querySelectorAll('[data-cookie-category]')];
  const contentArea = shell.querySelector('.ec-cookie-content');
  const panel = shell.querySelector('.ec-cookie-panel');
  const choiceList = shell.querySelector('.ec-cookie-choice-list');
  const settingsTitle = shell.querySelector('#ec-cookie-settings-title');

  function setView(name) {
    const settingsOpen = name === 'settings';
    shell.classList.toggle('is-settings', settingsOpen);
    shell.setAttribute('aria-labelledby', settingsOpen ? 'ec-cookie-settings-title' : 'ec-cookie-title');
    summaryView.hidden = settingsOpen;
    settingsView.hidden = !settingsOpen;
    if (contentArea) contentArea.scrollTop = 0;
    if (panel) panel.scrollTop = 0;
    if (choiceList) choiceList.scrollTop = 0;
    if (settingsOpen) {
      categoryInputs.forEach((input) => { input.checked = preferences?.[input.dataset.cookieCategory] === true; });
      window.setTimeout(() => settingsTitle?.focus({ preventScroll: true }), 0);
    } else {
      window.setTimeout(() => shell.querySelector('[data-cookie-accept-all]')?.focus({ preventScroll: true }), 0);
    }
  }

  function openPanel(opener = null) {
    window.clearTimeout(panelCloseTimer);
    returnFocus = opener || document.activeElement;
    setView('summary');
    shell.hidden = false;
    shell.classList.remove('is-leaving');
    window.requestAnimationFrame(() => {
      shell.classList.add('is-open');
      shell.querySelector('[data-cookie-accept-all]')?.focus({ preventScroll: true });
    });
  }

  function closePanel() {
    shell.classList.add('is-leaving');
    shell.classList.remove('is-open');
    window.clearTimeout(panelCloseTimer);
    panelCloseTimer = window.setTimeout(() => {
      shell.hidden = true;
      shell.classList.remove('is-leaving');
      if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
    }, 230);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    document.querySelector('.ec-cookie-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'ec-cookie-toast';
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.append(toast);
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 190);
    }, 2800);
  }

  function savePreferences(nextValues, message = 'Pilihan cookie berhasil disimpan.') {
    preferences = {
      ...DEFAULTS,
      ...nextValues,
      necessary: true,
      version: 2,
      updatedAt: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Preferensi tetap berlaku selama halaman aktif jika penyimpanan dibatasi browser.
    }
    applyPreferences(preferences);
    closePanel();
    showToast(message);
  }

  shell.addEventListener('click', (event) => {
    if (event.target.closest('[data-cookie-accept-all]')) {
      savePreferences({ functional: true, preferences: true, analytics: true, marketing: true }, 'Semua kategori cookie diaktifkan.');
    }
    if (event.target.closest('[data-cookie-essential]')) {
      savePreferences({ functional: false, preferences: false, analytics: false, marketing: false }, 'Hanya cookie esensial yang aktif.');
    }
    if (event.target.closest('[data-cookie-show-settings]')) setView('settings');
    if (event.target.closest('[data-cookie-back]')) setView('summary');
    if (event.target.closest('[data-cookie-save]')) {
      const values = Object.fromEntries(categoryInputs.map((input) => [input.dataset.cookieCategory, input.checked]));
      savePreferences(values);
    }
    if (event.target.closest('[data-cookie-close]')) {
      if (preferences) closePanel();
      else savePreferences({ functional: false, preferences: false, analytics: false, marketing: false }, 'Panel ditutup. Hanya cookie esensial yang aktif.');
    }
  });

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-cookie-settings]');
    if (!opener) return;
    event.preventDefault();
    openPanel(opener);
  });

  document.addEventListener('keydown', (event) => {
    if (shell.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (preferences) closePanel();
      else savePreferences({ functional: false, preferences: false, analytics: false, marketing: false }, 'Hanya cookie esensial yang aktif.');
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...shell.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')]
      .filter((element) => !element.closest('[hidden]') && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('storage', (event) => {
    if (![STORAGE_KEY, LEGACY_KEY].includes(event.key)) return;
    preferences = readPreferences();
    if (preferences) applyPreferences(preferences);
  });

  if (!preferences) openPanel();
})();
