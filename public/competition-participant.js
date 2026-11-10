import {onSnapshot, collection, query, where, limit} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {db, auth} from './firebase-config.js?v=b74586eaa5ef6110';
import {api, esc, formatDate, download, report, reportError, busy, setClock, now, countdown, empty, statusLabel} from './competition-ui.js?v=b74586eaa5ef6110';
import {submitFlag, uploadArtifact} from './competition-client.js?v=b74586eaa5ef6110';
import {paperConfirm} from './paper-confirm.js?v=b74586eaa5ef6110';

const $ = (selector) => document.querySelector(selector);
const shortWaveLabel = (value) => String(value || '—')
  .replace(/^Wave Awal Bulan\s*[—-]\s*mulai tanggal 1$/i, 'Wave Awal · tgl 1')
  .replace(/^Wave Pertengahan Bulan\s*[—-]\s*mulai tanggal 15$/i, 'Wave Tengah · tgl 15');
const metric = (value, label) => `<article class="cf-metric"><b>${esc(value)}</b><span>${esc(label)}</span></article>`;
async function startDashboard({user}) {
  let generation = 0;
  let lastSignature = null;
  let closed = false;
  let debounce = null;
  const unsubs = [];
  const safeLoad = () => {
    if (closed || document.visibilityState === 'hidden' || auth.currentUser?.uid !== user.uid) return;
    void load().catch((error) => console.warn('ESORIA: pembaruan dashboard ditunda', error?.code || 'fetch-failed'));
  };
  const queueSync = () => {
    if (closed || debounce) return;
    debounce = setTimeout(() => {debounce = null; safeLoad();}, 500);
  };
  async function load() {
    const epoch = ++generation;
    const data = await api('getParticipantWorkspace');
    // A response may arrive after sign-out/account replacement. Never paint
    // another account's registration or notification data into this dashboard.
    if (epoch !== generation || closed || auth.currentUser?.uid !== user.uid) return;
    const registrations = Array.isArray(data?.registrations) ? data.registrations : [];
    const notices = Array.isArray(data?.notices) ? data.notices : [];
    setClock(data.serverNow);
    const signature = JSON.stringify([registrations, notices, data.truncated]);
    if (lastSignature === signature) return;
    const active = registrations.filter((reg) => reg.active);
    $('#workspace-metrics').innerHTML = metric(active.length, 'PENDAFTARAN') + metric(active.filter((reg) => reg.status === 'terverifikasi').length, 'TIKET DITERIMA') + metric(active.filter((reg) => ['submitted', 'updated', 'locked', 'reviewed'].includes(reg.submissionStatus)).length, 'KARYA TERKIRIM') + metric(active.filter((reg) => reg.result).length, 'HASIL DIUMUMKAN');
    $('#registration-cards').innerHTML = registrations.length ? registrations.map((reg) => `<article class="cf-card"><div class="cf-card-top"><div><span class="cf-kicker">${esc(reg.periodLabel || reg.periodId)} / ${esc(shortWaveLabel(reg.waveLabel))}</span><h3>${esc(reg.packageLabel)}</h3><p class="cf-meta">${esc(reg.referenceNumber)}</p></div><span class="cf-tag ${reg.status === 'terverifikasi' ? 'green' : reg.status === 'ditolak' ? 'red' : ''}">${esc(statusLabel(reg.status))}</span></div><dl class="cf-facts"><div><dt>Pembayaran manual</dt><dd>${esc(statusLabel(reg.paymentStatus))}</dd></div><div><dt>Tiket</dt><dd>${esc(reg.ticketNumber || 'Belum diterbitkan')}</dd></div><div><dt>Karya</dt><dd>${esc(statusLabel(reg.submissionStatus))}</dd></div><div><dt>Batas pengumpulan</dt><dd>${esc(formatDate(reg.schedule?.deadlineAt))}</dd></div></dl><div class="cf-materials-inline ${reg.materialsAvailable ? 'is-ready' : 'is-locked'}"><span class="cf-materials-inline-label">BAHAN LOMBA · ${esc(reg.packageLabel)}</span>${reg.materialsAvailable ? `<div class="cf-materials-inline-row"><p>Pendaftaran ACC. Panduan dan bahan kategori sudah dapat diunduh.</p><button type="button" class="cf-button green" data-material-registration="${esc(reg.registrationId)}">Unduh bahan lomba</button></div>` : '<p>Tersedia setelah tiket dan pembayaran diterima panitia (ACC).</p>'}</div>${reg.rejectionReason ? `<div class="cf-help warning">${esc(reg.rejectionReason)}</div>` : ''}${reg.result ? `<div class="cf-help">${reg.result.disqualified ? 'Panitia mencatat diskualifikasi.' : `Skor final ${esc(reg.result.total)} · ${reg.result.rank <= 3 ? `Juara ${esc(reg.result.rank)}` : 'Submission valid'}`}</div>` : '<p class="cf-meta">Hasil penilaian tampil setelah disahkan dan diumumkan.</p>'}<footer><div class="cf-actions"><a class="cf-button" href="submission.html?id=${encodeURIComponent(reg.registrationId)}">${reg.result ? 'Hasil & sertifikat' : 'Buka ruang karya'} ↗</a><a class="cf-button secondary" href="profil.html#riwayat-pendaftaran">Tiket &amp; bukti transfer</a></div></footer></article>`).join('') : empty('Lembar pertamamu masih kosong.', 'Lengkapi profil dan pilih kompetisi untuk memulai.', '<a class="cf-button" href="form-pendaftaran.html">Pilih kompetisi ↗</a>');
    $('#activity-list').innerHTML = notices.length ? notices.map((notice) => `<li><strong>${esc(notice.title)}</strong><p>${esc(notice.message)}</p><small class="cf-meta">${esc(formatDate(notice.createdAt))}</small></li>`).join('') : '<li class="cf-activity-empty"><span class="cf-activity-seal" aria-hidden="true">00</span><div><strong>Belum ada aktivitas yang tercatat.</strong><p>Informasi kompetisi dan notifikasi penting akan muncul setelah kamu mulai berpartisipasi.</p></div></li>';
    // Keep the previous signature if an unexpected legacy record made render fail.
    // That way a later refresh still retries rather than showing stale cards.
    lastSignature = signature;
    if (data.truncated) report('Ringkasan menampilkan maksimal 50 pendaftaran terbaru. Riwayat lama tetap tersedia di profil.', 'notice');
  }
  $('#registration-cards').addEventListener('click', (event) => {
    const button = event.target.closest('[data-material-registration]');
    if (!button || !event.currentTarget.contains(button)) return;
    const registrationId = button.dataset.materialRegistration;
    if (!registrationId || auth.currentUser?.uid !== user.uid) return;
    void busy(button, async () => {
      const result = await api('getCompetitionMaterials', {registrationId});
      if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi berubah. Masuk kembali sebelum mengunduh.');
      download(result);
      report('Bahan lomba telah disiapkan sesuai kategori pendaftaran Anda.', 'success');
    });
  });
  $('#workspace-refresh').addEventListener('click', (event) => void busy(event.currentTarget, load));
  $('#join-team-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    void busy(form, async () => {await api('joinTeam', payload); await load(); report('Akun Anda sudah terhubung dengan tim.', 'success');});
  });
  await load();
  // Listening to private owner-readable documents does not bypass Functions
  // authorization; a matching change only invalidates the server projection.
  const subscribe = (ref) => {
    try {unsubs.push(onSnapshot(ref, () => queueSync(), (error) => {
      console.warn('ESORIA: listener status tidak aktif, fallback otomatis tetap berjalan', error?.code || 'listen-failed');
    }));} catch (error) {console.warn('ESORIA: listener tidak tersedia', error?.code || 'setup-failed');}
  };
  subscribe(query(collection(db, 'registrations'), where('userId', '==', user.uid), limit(50)));
  subscribe(query(collection(db, 'users', user.uid, 'notifications'), limit(50)));
  // Team-member status and results may be projected via Functions only; refresh
  // periodically as a fallback, including when returning to this browser tab.
  const interval = setInterval(safeLoad, 30000);
  const onDashboardVisible = () => {if (document.visibilityState === 'visible') queueSync();};
  document.addEventListener('visibilitychange', onDashboardVisible);
  window.addEventListener('pagehide', () => {
    closed = true; clearInterval(interval); clearTimeout(debounce);
    unsubs.forEach((stop) => stop());
    document.removeEventListener('visibilitychange', onDashboardVisible);
  }, {once:true});
}
async function startSubmission({user}) {
  const registrationId = new URLSearchParams(location.search).get('id');
  if (!registrationId) {$('#submission-context').innerHTML = 'Pilih kompetisi dari <a href="dashboard.html">dashboard peserta</a> terlebih dahulu.'; $('#submission-form').inert = true; return;}
  const form = $('#submission-form');
  let context;
  let artifactIds = [];
  let artifacts = [];
  let dirty = false;
  let timer;
  let saving = null;
  let conflict = false;
  let frozen = true;
  let revision = 0;
  let lastAttempt = null;
  let clockTimer;
  const currentPayload = () => {
    const data = Object.fromEntries(new FormData(form));
    for (const name of ['originality', 'safeTesting', 'publicNameConsent']) data[name] = form.elements[name].checked;
    return data;
  };
  const refreshFileList = () => {
    $('#artifact-list').innerHTML = artifacts.map((file) => `<li><strong>${esc(file.fileName)}</strong><span class="cf-meta">${Math.ceil(file.sizeBytes / 1024)} KB</span><div class="cf-actions"><button class="cf-button secondary" type="button" data-file-download="${esc(file.uploadId)}">Unduh</button>${!frozen ? `<button class="cf-button secondary" type="button" data-file-remove="${esc(file.uploadId)}">Lepas dari karya</button>` : ''}</div></li>`).join('');
  };
  const queueSave = () => {
    dirty = true;
    clearTimeout(timer);
    if (!frozen && !context.submission?.submittedAt) timer = setTimeout(() => void save(false, true).catch(reportError), 1200);
    $('#submission-save-state').textContent = 'Ada perubahan yang belum tersimpan.';
  };
  async function save(final, automatic = false) {
    if (frozen || conflict) return;
    if (saving) {await saving; if (!dirty && !final) return;}
    clearTimeout(timer);
    if (automatic && [...form.querySelectorAll('input[type=url]')].some((input) => input.value && !input.checkValidity())) {$('#submission-save-state').textContent = 'Lengkapi URL untuk menyimpan draft.'; return;}
    const payload = currentPayload();
    const snapshot = JSON.stringify({payload, artifactIds, final});
    const requestId = lastAttempt?.snapshot === snapshot ? lastAttempt.requestId : crypto.randomUUID();
    lastAttempt = {snapshot, requestId};
    dirty = false;
    $('#submission-save-state').textContent = 'Menyimpan karya…';
    let succeeded = false;
    saving = api('saveSubmission', {registrationId, expectedRevision: revision, requestId, final, payload, artifactIds: [...artifactIds]});
    try {
      const data = await saving;
      succeeded = true;
      revision = data.revision;
      context.submission = {...context.submission, revision, status: data.status, submittedAt: final || context.submission?.submittedAt ? true : null};
      $('#submission-status').textContent = statusLabel(data.status);
      $('#submission-save-state').textContent = dirty ? 'Revisi tersimpan. Masih ada perubahan baru.' : `Revisi ${revision} tersimpan · ${formatDate(now())}`;
      lastAttempt = null;
      if (final) report('Karya sudah diterima. Anda dapat memperbaruinya sebelum tenggat sesuai izin ketua.', 'success');
    } catch (error) {
      dirty = true;
      if (String(error.code).endsWith('aborted')) {conflict = true; report('Karya berubah dari sesi lain. Salin perubahan Anda lalu muat ulang; penyimpanan otomatis dihentikan untuk melindungi revisi.', 'error');}
      $('#submission-save-state').textContent = 'Perubahan belum terkonfirmasi tersimpan. Periksa koneksi dan status sebelum mengirim ulang.';
      throw error;
    } finally {
      saving = null;
      if (succeeded && dirty && !conflict && !context.submission?.submittedAt) timer = setTimeout(() => void save(false, true).catch(reportError), 1200);
    }
  }
  function render(data, populate = true) {
    context = data;
    setClock(data.serverNow);
    revision = data.submission?.revision || 0;
    frozen = ![data.schedule.startsAt, data.schedule.deadlineAt].every(Number.isFinite) || data.registration.status !== 'terverifikasi' || !data.canEdit || now() < data.schedule.startsAt || now() > data.schedule.deadlineAt || ['locked', 'reviewed'].includes(data.submission?.effectiveStatus) || data.submission?.submittedAt && !data.leader;
    $('#submission-title').textContent = data.registration.packageLabel;
    $('#submission-status').textContent = statusLabel(data.submission?.effectiveStatus || 'draft');
    $('#submission-context').textContent = `${data.registration.referenceNumber} · ${data.registration.waveLabel} · ${data.registration.teamName || data.registration.userName}`;
    $('#materials-track-name').textContent = data.registration.packageLabel || 'Kategori lomba';
    $('#materials-locked').hidden = Boolean(data.materialsAvailable);
    $('#materials-ready').hidden = !data.materialsAvailable;
    $('#materials-download').disabled = !data.materialsAvailable;
    $('#submission-schedule').innerHTML = [['Mulai', data.schedule.startsAt], ['Deadline', data.schedule.deadlineAt], ['Pengumuman', data.schedule.announcementAt]].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(formatDate(value))}</dd></div>`).join('');
    $('#submission-rubric').innerHTML = data.rubric.criteria.map(([, label, weight]) => `<li><span>${esc(label)}</span><b>${weight}%</b></li>`).join('');
    $('#rubric-source').href = data.rubric.source;
    const visible = {web: ['repositoryUrl', 'liveUrl', 'readmeUrl'], cyber: ['evidenceUrl', 'writeup', 'tools', 'safeTesting'], team: ['repositoryUrl', 'backendRepositoryUrl', 'liveUrl', 'readmeUrl', 'presentationUrl', 'documentationUrl']}[data.registration.package];
    form.querySelectorAll('[data-submission-field]').forEach((field) => {field.hidden = !visible.includes(field.dataset.submissionField);});
    if (populate) {
      for (const [name, value] of Object.entries(data.submission?.payload || {})) {
        if (!form.elements[name]) continue;
        if (form.elements[name].type === 'checkbox') form.elements[name].checked = value === true; else form.elements[name].value = value || '';
      }
      artifactIds = data.files.map((file) => file.uploadId);
      artifacts = data.files;
      dirty = false;
    }
    form.querySelectorAll('input,select,textarea,button').forEach((control) => {control.disabled = Boolean(frozen);});
    $('#submit-submission').hidden = !data.leader;
    $('#submission-save-state').textContent = frozen ? 'Lembar ini hanya dapat dibaca. Periksa jadwal, status tiket, dan izin editor tim.' : revision ? `Revisi ${revision} dimuat. Draft awal disimpan otomatis.` : 'Draft awal tersimpan otomatis setelah Anda mulai mengisi.';
    refreshFileList();
    $('#ctf-section').hidden = data.registration.package !== 'cyber';
    if (data.registration.package === 'cyber') {
      const select = $('#flag-form').elements.challengeId;
      select.innerHTML = data.challenges.length ? data.challenges.map((challenge) => `<option value="${esc(challenge.id)}" ${challenge.solved ? 'disabled' : ''}>${esc(challenge.title)} · ${esc(challenge.points)} poin ${challenge.solved ? '· selesai' : ''}</option>`).join('') : '<option value="">Challenge belum dibuka panitia</option>';
      $('#flag-form').querySelectorAll('button,input,select').forEach((control) => {control.disabled = frozen || !data.challenges.some((challenge) => !challenge.solved);});
    }
    $('#team-section').hidden = !data.team;
    if (data.team) {
      $('#team-display-name').textContent = data.registration.teamName || 'Tim ESORIA';
      $('#team-reference').textContent = data.registration.referenceNumber || 'Belum diterbitkan';
      const memberUids = Array.isArray(data.team.memberUids) ? data.team.memberUids : [];
      $('#team-member-count').textContent = `${memberUids.length} dari ${Math.max(memberUids.length, Number(data.registration.memberCount) || memberUids.length)} terhubung`;
      const membersByUid = new Map((data.team.members || []).map((member) => [member.uid, member]));
      const connectedCards = memberUids.map((uid, index) => {
        const leaderMember = uid === data.team.leaderUid;
        const selfMember = uid === user.uid;
        const displayName = membersByUid.get(uid)?.name || (leaderMember ? data.registration.userName : `Anggota tim ${index + 1}`);
        const label = leaderMember ? 'Ketua tim' : 'Anggota tim';
        const editAllowed = Array.isArray(data.team.editorUids) && data.team.editorUids.includes(uid);
        return `<li class="team-paper-member"><div class="team-paper-member-person"><span class="team-paper-avatar" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="team-paper-member-copy"><small>${label}</small><strong>${esc(displayName)}</strong><span class="team-paper-member-note">${selfMember ? 'Akun Anda' : editAllowed ? 'Izin editor aktif' : leaderMember ? 'Pengelola pengiriman final' : 'Anggota terhubung'}</span></div></div>${selfMember ? '<span class="team-paper-tag">ANDA</span>' : ''}${data.leader && !leaderMember && !frozen ? `<label class="cf-check team-paper-editor"><input type="checkbox" data-editor="${esc(uid)}" ${editAllowed ? 'checked' : ''}><span>Izinkan menyimpan draft</span></label>` : ''}</li>`;
      });
      const missingCount = Math.max(0, (Number(data.registration.memberCount) || memberUids.length) - memberUids.length);
      const pendingCards = Array.from({length: Math.min(missingCount, 4)}, (_, index) => `<li class="team-paper-member team-paper-pending"><div class="team-paper-member-person"><span class="team-paper-avatar" aria-hidden="true">${String(memberUids.length + index + 1).padStart(2, '0')}</span><div class="team-paper-member-copy"><small>Undangan tim</small><strong>Belum terhubung</strong><span class="team-paper-member-note">Anggota perlu login memakai email yang didaftarkan ketua.</span></div></div></li>`);
      $('#team-members').innerHTML = [...connectedCards, ...pendingCards].join('');
      $('#team-invitation').hidden = !data.leader;
      $('#team-registration-id').textContent = 'ID penghubung berbeda dari nomor referensi tiket.';
      $('#team-code-manual').hidden = true;
      $('#team-code-manual').value = '';
      $('#team-copy-feedback').textContent = '';
    }
    $('#result-section').hidden = !data.result;
    if (data.result) {
      $('#participant-result').innerHTML = data.result.disqualified ? '<p>Panitia mencatat diskualifikasi. Hubungi kanal resmi untuk klarifikasi.</p>' : `<p><b>Skor final ${esc(data.result.total)}</b> · ${data.result.rank <= 3 ? `Juara ${esc(data.result.rank)}` : 'Submission valid'}</p>`;
      $('#certificate-actions').innerHTML = data.result.certificateEligible ? '<button type="button" class="cf-button green" id="issue-certificate">Terbitkan &amp; unduh sertifikat</button>' + data.certificates.filter((cert) => cert.resultRevision === data.resultsRevision).map((cert) => `<a href="verify-certificate.html?id=${esc(cert.id)}" class="cf-button secondary">Periksa sertifikat ${cert.revoked ? '(dicabut)' : ''}</a>`).join('') : '';
      $('#issue-certificate')?.addEventListener('click', (event) => void busy(event.currentTarget, async () => {const certificate = await api('issueCertificate', {registrationId}); download(await api('downloadCertificate', {certificateId: certificate.certificateId}));}));
      $('#appeal-window').textContent = `Batas klarifikasi: ${formatDate(data.appealDeadlineAt)}`;
    }
  }
  $('#materials-download').addEventListener('click', (event) => void busy(event.currentTarget, async () => {
    if (!context?.materialsAvailable || auth.currentUser?.uid !== user.uid) throw new Error('Tiket belum ACC atau sesi telah berubah.');
    const materials = await api('getCompetitionMaterials', {registrationId});
    if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi berubah. Masuk kembali sebelum mengunduh.');
    download(materials);
    report('Bahan lomba kategori Anda berhasil disiapkan.', 'success');
  }));
  $('#team-copy-id').addEventListener('click', async (event) => {
    if (!context?.leader || auth.currentUser?.uid !== user.uid) return;
    const button = event.currentTarget;
    const feedback = $('#team-copy-feedback');
    const manual = $('#team-code-manual');
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(registrationId);
      feedback.textContent = 'ID tim berhasil disalin. Kirim secara pribadi ke anggota terdaftar.';
      manual.hidden = true;
      manual.value = '';
    } catch {
      manual.value = registrationId;
      manual.hidden = false;
      manual.focus();
      manual.select();
      feedback.textContent = 'Salin ID dari kolom yang muncul. Jangan bagikan ke publik.';
    } finally {
      button.disabled = false;
    }
  });
  form.addEventListener('input', queueSave);
  $('#save-submission').addEventListener('click', () => void save(false).catch(reportError));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {form.reportValidity(); return;}
    if (!await paperConfirm({title: 'Kirim karya untuk dinilai?', message: 'Periksa seluruh tautan, lampiran, dan pernyataan keaslian. Karya harus dapat diperiksa oleh administrator penilai.', confirmText: 'Kirim karya', danger: false})) return;
    // Snapshot values must be read before controls are disabled by busy().
    if (saving) await saving.catch(() => {});
    const button = $('#submit-submission');
    await busy(button, () => save(true));
  });
  $('#artifact-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (artifactIds.length >= 8) {report('Maksimal delapan lampiran dalam satu revisi.'); return;}
    await busy(event.target.parentElement, async () => {
      const item = await uploadArtifact(file, registrationId);
      artifacts.push(item); artifactIds.push(item.uploadId); refreshFileList(); queueSave();
      report('Lampiran sudah diperiksa. Simpan atau kirim revisi untuk menyertakannya dalam karya.', 'success');
    });
    event.target.value = '';
  });
  $('#artifact-list').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-file-remove]');
    const target = event.target.closest('[data-file-download]');
    if (remove && !frozen) {artifactIds = artifactIds.filter((key) => key !== remove.dataset.fileRemove); artifacts = artifacts.filter((item) => item.uploadId !== remove.dataset.fileRemove); refreshFileList(); queueSave();}
    if (target) void busy(target, async () => download(await api('getSubmissionFile', {uploadId: target.dataset.fileDownload})));
  });
  $('#flag-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const flagForm = event.currentTarget;
    const payload = {registrationId, ...Object.fromEntries(new FormData(flagForm))};
    void busy(flagForm, async () => {
      const result = await submitFlag(payload);
      flagForm.elements.flag.value = '';
      report(result.accepted ? `Flag diterima · ${result.points} poin.` : 'Flag belum cocok. Periksa kembali analisis Anda.', result.accepted ? 'success' : 'notice');
      const data = await api('getCompetitionContext', {registrationId});
      // Apply the fresh disabled states after busy() has restored its captured controls.
      setTimeout(() => render(data, false), 0);
    });
  });
  $('#team-members').addEventListener('change', (event) => {
    const input = event.target.closest('[data-editor]');
    if (input) void busy(input.parentElement, async () => {await api('setTeamEditor', {registrationId, memberUid: input.dataset.editor, enabled: input.checked}); report('Izin editor tim diperbarui.', 'success');});
  });
  $('#appeal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const appealForm = event.currentTarget;
    const message = appealForm.elements.message.value;
    void busy(appealForm, async () => {await api('submitAppeal', {registrationId, message}); appealForm.reset(); report('Permintaan klarifikasi masuk ke panitia.', 'success');});
  });
  const initial = await api('getCompetitionContext', {registrationId});
  render(initial);
  clockTimer = setInterval(() => {$('#submission-countdown').textContent = countdown(context.schedule.deadlineAt); if (now() > context.schedule.deadlineAt && !frozen) {frozen = true; form.querySelectorAll('input,select,textarea,button').forEach((control) => {control.disabled = true;}); $('#submission-save-state').textContent = 'Tenggat telah berakhir. Lembar karya dikunci.';}}, 1000);
  window.addEventListener('beforeunload', (event) => {if (dirty || saving) {event.preventDefault(); event.returnValue = '';}});
  window.addEventListener('pagehide', () => {clearTimeout(timer); clearInterval(clockTimer);});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || dirty || saving || conflict) return;
    // Editing can begin while the server refresh is in flight. Never replace
    // revision/status with an older response once local edits have started.
    void api('getCompetitionContext', {registrationId})
      .then((data) => {if (!dirty && !saving && !conflict) render(data, false);})
      .catch(reportError);
  });
}
export const startParticipant = (kind, session) => kind === 'dashboard' ? startDashboard(session) : startSubmission(session);
