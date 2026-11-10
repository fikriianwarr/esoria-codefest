import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {auth} from './firebase-config.js?v=b74586eaa5ef6110';
import {waitForAuth} from './auth-core.js?v=b74586eaa5ef6110';
import {verifyAndWatchDeviceSession} from './single-device-session.js?v=b74586eaa5ef6110';
import {api, esc, formatDate, busy, report, reportError, empty, scopeFromForm, monthWib} from './competition-ui.js?v=b74586eaa5ef6110';
import './logout-controller.js?v=b74586eaa5ef6110';
const kind = document.body.dataset.workspace;
const main = document.querySelector('main');
const protect = async () => {
  const user = await waitForAuth();
  if (!user) {window.location.replace(`login.html?next=${encodeURIComponent(location.pathname.slice(1) + location.search)}`); return null;}
  if (!user.emailVerified) {window.location.replace(`verify-email.html?next=${encodeURIComponent(location.pathname.slice(1) + location.search)}`); return null;}
  // Validate the active browser session BEFORE requesting any participant/admin state.
  await verifyAndWatchDeviceSession(user);
  // Signing out is safe during verification. Privileged navigation remains hidden
  // until resolveSession has confirmed the active server-side role.
  document.querySelectorAll('[data-logout]').forEach((logout) => {logout.hidden = false;});
  const session = await api('resolveSession');
  if ((['operations', 'jury'].includes(kind) && session.kind !== 'admin')
    || (['dashboard', 'submission'].includes(kind) && session.kind !== 'participant')) {
    window.location.replace(session.destination);
    return null;
  }
  if (auth.currentUser?.uid !== user.uid) {
    // Session changed while the server was resolving access. Do not leave a
    // protected workspace stuck forever on the "Memeriksa sesi" gate.
    main.inert = true;
    window.location.replace(auth.currentUser ? 'index.html' : 'login.html?session=changed');
    return null;
  }
  document.querySelectorAll('[data-full-admin]').forEach((item) => {item.hidden = session.kind !== 'admin';});
  document.querySelectorAll('[data-role-nav]').forEach((item) => {item.hidden = false;});
  document.querySelectorAll('[data-logout]').forEach((logout) => {logout.hidden = false;});
  onAuthStateChanged(auth, (current) => {
    if (current?.uid !== user.uid) {
      // Auth changes are distinct from authorization errors. Reload for a new
      // signed-in user; redirect to sign-in only after Auth confirms no user.
      main.inert = true;
      window.location.replace(current ? 'index.html' : 'login.html?session=changed');
    }
  });
  return {user, session};
};

async function publicResults() {
  const form = document.querySelector('#scope-form');
  const panel = document.querySelector('#public-results');
  form.elements.periodId.value = monthWib(); form.elements.periodId.dispatchEvent(new Event('input', {bubbles:true}));
  let generation = 0;
  const render = (scope, data) => {
    if (!data?.published) {
      panel.innerHTML = empty('Belum ada hasil resmi untuk pilihan ini.', 'Hasil belum disahkan, belum mencapai jadwal pengumuman, atau memang belum tersedia. Pilih periode, kategori, atau gelombang lainnya.');
      return;
    }
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
      panel.innerHTML = empty('Belum ada peserta dalam hasil resmi.', 'Hasil telah diumumkan tetapi daftar peringkat masih kosong. Hubungi panitia jika diperlukan.');
      return;
    }
    const category = form.elements.package.selectedOptions[0]?.textContent || 'Kompetisi';
    const wave = form.elements.wave.selectedOptions[0]?.textContent || scope.wave;
    panel.innerHTML = `<div class="cf-section-head cf-results-heading"><div><span class="cf-kicker">Arsip hasil resmi</span><h2>Hasil kompetisi yang diumumkan.</h2><p class="cf-meta">${esc(scope.periodId)} · ${esc(category)} · ${esc(wave)}</p></div><span class="cf-tag green">TELAH DIUMUMKAN</span></div><div class="cf-table-wrap" role="region" aria-label="Hasil kompetisi resmi" tabindex="0"><table><thead><tr><th scope="col">Peringkat</th><th scope="col">Peserta / tim / tiket</th><th scope="col">Skor</th><th scope="col">Keterangan</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${esc(item.disqualified ? '—' : item.rank || '—')}</strong></td><td>${esc(item.displayName || 'Tidak ditampilkan')}</td><td>${esc(item.disqualified ? '—' : item.total ?? '—')}</td><td><span class="cf-tag ${item.disqualified ? 'red' : item.rank && item.rank <= 3 ? 'green' : ''}">${item.disqualified ? 'Diskualifikasi' : item.rank && item.rank <= 3 ? 'Pemenang' : 'Peserta tervalidasi'}</span></td></tr>`).join('')}</tbody></table></div><p class="cf-meta cf-results-disclaimer">Hanya hasil yang telah disahkan panitia yang muncul di sini. Skor dan peringkat mengikuti keputusan resmi pada saat publikasi.</p>`;
  };
  async function load() {
    const current = ++generation;
    const scope = scopeFromForm(form);
    panel.innerHTML = '<div class="cf-empty" role="status"><h3>Memeriksa hasil resmi…</h3><p>Memeriksa arsip untuk periode, kategori, dan gelombang terpilih.</p></div>';
    await busy(form, async () => {
      try {
        const data = await api('getPublishedResults', scope);
        if (current !== generation) return;
        render(scope, data);
        report('');
      } catch (error) {
        if (current !== generation) return;
        panel.innerHTML = empty('Hasil belum dapat dimuat.', 'Layanan arsip belum merespons. Periksa koneksi dan keamanan browser, kemudian tekan Tampilkan untuk mencoba lagi.');
        reportError(error);
      }
    });
  }
  form.addEventListener('submit', (event) => {event.preventDefault(); void load();});
  // The current WIB month is a useful default. Do not require an extra click to see a result or empty state.
  await load();
}

async function verifyCertificate() {
  const form = document.querySelector('#verify-certificate-form');
  const verdict = document.querySelector('#certificate-verdict');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const certificateId = form.elements.certificateId.value.trim().toLowerCase();
    void busy(form, async () => {
      const data = await api('verifyCertificate', {certificateId});
      const label = {valid: 'Sertifikat berlaku.', revoked: 'Sertifikat telah dicabut.', withdrawn: 'Hasil sedang ditarik.', not_found: 'ID tidak ditemukan.'}[data.status];
      verdict.innerHTML = `<div class="cf-verdict" data-valid="${data.valid}">${esc(label)}</div>${data.recipient ? `<dl class="cf-facts"><div><dt>Penerima</dt><dd>${esc(data.recipient)}</dd></div><div><dt>Kategori</dt><dd>${esc(data.category)}</dd></div><div><dt>Periode</dt><dd>${esc(data.period)} · ${esc(data.wave)}</dd></div><div><dt>Terbit</dt><dd>${esc(formatDate(data.issuedAt))}</dd></div></dl>` : '<p>Periksa kembali ID pada dokumen asli.</p>'}`;
    });
  });
  const id = new URLSearchParams(location.search).get('id');
  if (/^[a-f0-9]{32}$/.test(id || '')) {form.elements.certificateId.value = id; form.requestSubmit();}
}
try {
  let session = null;
  if (!['results', 'verify'].includes(kind)) session = await protect();
  if (['results', 'verify'].includes(kind) || session) {
    if (kind === 'results') await publicResults();
    else if (kind === 'verify') await verifyCertificate();
    else if (['dashboard', 'submission'].includes(kind)) await (await import('./competition-participant.js?v=b74586eaa5ef6110')).startParticipant(kind, session);
    else await (await import('./competition-operations.js?v=b74586eaa5ef6110')).startOperations(kind, session);
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-ready');
    main.inert = false;
    document.querySelector('#workspace-auth')?.remove();
  }
} catch (error) {
  reportError(error);
  const state = document.querySelector('#workspace-auth');
  if (state) state.innerHTML = 'Pemeriksaan belum selesai. <a href="">Coba muat ulang satu kali</a> atau kembali ke <a href="index.html">beranda</a>.';
}

