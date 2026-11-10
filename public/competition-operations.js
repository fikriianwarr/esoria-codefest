import {onSnapshot, collection, query, where, limit} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {db} from './firebase-config.js?v=b74586eaa5ef6110';
import {registrationActions} from './registration-review-policy.js?v=b74586eaa5ef6110';
import {api, esc, formatDate, download, report, busy, modal, closeModal, setClock, empty, statusLabel, monthWib, scopeFromForm} from './competition-ui.js?v=b74586eaa5ef6110';
import {paperConfirm} from './paper-confirm.js?v=b74586eaa5ef6110';
import {timeValue} from './competition-client.js?v=b74586eaa5ef6110';
import {wibDateTimeLocalValue} from './time-utils.js?v=b74586eaa5ef6110';
import {PROCESS_STEPS, assignmentAction, certificateAction, workflowPhase, scoreEstimate, jurySummary, juryFilter, httpsUrl} from './competition-workflow.js?v=b74586eaa5ef6110';

const $ = (selector) => document.querySelector(selector);
const field = (name, label, value = '', type = 'text', required = true) => `<label class="cf-field ${type === 'textarea' ? 'cf-wide' : ''}"><span>${esc(label)}</span>${type === 'textarea' ? `<textarea name="${name}" ${required ? 'required' : ''} rows="4" maxlength="3000">${esc(value)}</textarea>` : `<input type="${type}" name="${name}" value="${esc(value)}" ${required ? 'required' : ''} maxlength="250">`}</label>`;
const select = (name, label, options, value) => `<label class="cf-field"><span>${esc(label)}</span><select name="${name}">${options.map(([key, text]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const check = (name, label, checked = false) => `<label class="cf-check cf-wide"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
const linksFor = (payload) => Object.entries(payload || {}).filter(([key, value]) => key.endsWith('Url') && httpsUrl(value)).map(([key, value]) => `<li><strong>${esc(key.replace('Url', ''))}</strong><a href="${esc(httpsUrl(value))}" target="_blank" rel="noopener noreferrer">Buka tautan karya (tab baru)</a></li>`).join('');
const workHtml = (work) => {
  if (!work) return '<div class="cf-help warning">Karya tidak tersedia. Minta panitia memeriksa status kiriman.</div>';
  const links = linksFor(work.payload);
  const notes = work.payload?.writeup || work.payload?.notes || '';
  return `<div class="cf-work-detail"><h3>${esc(work.payload?.title || 'Karya tanpa judul')}</h3><p class="cf-meta">Periksa isi karya dan lampiran sebelum mengisi rubrik. Buka tautan eksternal hanya jika alamatnya dipercaya.</p>${links ? `<ul class="cf-list">${links}</ul>` : '<p class="cf-meta">Tidak ada tautan eksternal pada karya ini.</p>'}${notes ? `<h4>Catatan peserta</h4><pre>${esc(notes)}</pre>` : ''}<div class="cf-actions">${(work.artifactIds || []).map((uploadId, index) => `<button type="button" class="cf-button secondary" data-download-artifact="${esc(uploadId)}">Unduh lampiran ${index + 1}</button>`).join('')}</div></div>`;
};
const bindDownloads = (content) => {
  const listener = (event) => {
    const target = event.target.closest('[data-download-artifact]');
    if (target) void busy(target, async () => download(await api('getSubmissionFile', {uploadId: target.dataset.downloadArtifact})));
  };
  content.addEventListener('click', listener);
  return () => content.removeEventListener('click', listener);
};
function actionModal(title, html, label, callback, after) {
  modal(title, `<form class="cf-form" id="operation-action-form">${html}<button class="cf-button green cf-wide" type="submit">${esc(label)}</button></form>`, (content) => {
    const form = content.querySelector('form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      form.querySelectorAll('input[type=checkbox]').forEach((input) => {data[input.name] = input.checked;});
      void busy(form, async () => {await callback(data); closeModal(); report('Keputusan tersimpan dan tercatat.', 'success'); await after?.();});
    });
  });
}
// A decision is a single documented transition, not a set of unrelated dropdowns.
function openPaymentDecision(reg, after) {
  const policy = registrationActions(reg);
  if (!policy.mayReview) {report('ACC sudah aktif. Gunakan Batalkan ACC atau Perbaiki Tiket.'); return;}
  const paymentInfo = `<div class="cf-help cf-wide"><strong>${esc(reg.senderName || 'Pengirim belum tercatat')}</strong> · ${esc(reg.senderInstitution || 'Bank tidak tersedia')} · ${esc(reg.transferDate || '—')} · Rp${Number(reg.amountValue || 0).toLocaleString('id-ID')}</div>`;
  const html = paymentInfo + select('decision', 'Keputusan resmi', [['menunggu', 'Tunda / lanjutkan pemeriksaan'], ['terverifikasi', 'Terima / ACC setelah verifikasi bank'], ['ditolak', 'Tolak pendaftaran']], reg.status)
    + `<p class="cf-help cf-wide" id="payment-decision-note" role="status"></p>`
    + `<label class="cf-field cf-wide" id="payment-ticket-preview"><span>Nomor tiket otomatis dari referensi resmi</span><input value="${esc(policy.reference)}" readonly aria-readonly="true"></label>`
    + field('rejectionReason', 'Alasan penolakan (minimal 5 karakter)', reg.rejectionReason || '', 'textarea', false)
    + field('adminNotes', 'Catatan audit / dasar keputusan', '', 'textarea', false)
    + check('bankTransferConfirmed', 'Saya telah memeriksa mutasi rekening resmi dan memastikan dana benar-benar masuk.');
  actionModal('Putuskan pembayaran dan pendaftaran', html, 'Simpan keputusan resmi', async (data) => {
    if (data.decision === 'terverifikasi') {
      if (!policy.reference) throw new Error('Referensi tiket resmi tidak ditemukan; perbaiki data sebelum ACC.');
      if (!data.bankTransferConfirmed) throw new Error('ACC membutuhkan konfirmasi mutasi rekening, bukan hanya screenshot.');
      if ((data.adminNotes || '').trim().length < 5) throw new Error('Jelaskan dasar ACC dalam catatan audit minimal 5 karakter.');
    }
    if (data.decision === 'ditolak' && (data.rejectionReason || '').trim().length < 5) throw new Error('Alasan penolakan minimal 5 karakter.');
    return api('reviewPayment', {registrationId: reg.registrationId, expectedReviewRevision: Number(reg.reviewRevision || 0),
      reviewAction: 'review', status:data.decision,
      paymentStatus: data.decision === 'terverifikasi' ? 'sesuai' : data.decision === 'ditolak' ? 'bermasalah' : 'belum_diperiksa',
      ticketNumber: data.decision === 'terverifikasi' ? policy.reference : '',
      rejectionReason:data.decision === 'ditolak' ? data.rejectionReason : '', adminNotes:data.adminNotes,
      bankTransferConfirmed:data.decision === 'terverifikasi' && data.bankTransferConfirmed});
  }, after);
  const form = $('#operation-action-form');
  const choice = form.elements.decision;
  const reasonField = form.elements.rejectionReason;
  const noteField = form.elements.adminNotes;
  const confirmation = form.elements.bankTransferConfirmed;
  const toggle = () => {
    const approved = choice.value === 'terverifikasi';
    const rejected = choice.value === 'ditolak';
    $('#payment-ticket-preview').hidden = !approved;
    reasonField.closest('label').hidden = !rejected;
    reasonField.disabled = !rejected;
    reasonField.required = rejected;
    reasonField.minLength = rejected ? 5 : 0;
    confirmation.closest('label').hidden = !approved;
    confirmation.disabled = !approved;
    confirmation.required = approved;
    noteField.required = approved;
    noteField.minLength = approved ? 5 : 0;
    $('#payment-decision-note').textContent = approved ? 'Tiket akan diterbitkan sekali setelah dana masuk dikonfirmasi.' : rejected ? 'Penolakan membutuhkan alasan tertulis; tiket tidak diterbitkan.' : 'Data tetap dalam antrean pemeriksaan; tiket belum aktif.';
  };
  choice.addEventListener('change', toggle);toggle();
}
function openCancelAccDecision(reg, after) {
  const policy = registrationActions(reg);
  if (!policy.mayCancelAcc) {report('Peserta masih check-in. Batalkan check-in terlebih dahulu sebelum membatalkan ACC.'); return;}
  actionModal('Batalkan ACC secara resmi', `<div class="cf-help warning cf-wide"><strong>Tiket ${esc(reg.ticketNumber || '—')} akan dinonaktifkan.</strong> Status kembali menunggu, status pembayaran kembali belum diperiksa, dan peserta akan menerima pemberitahuan. ACC ulang hanya tersedia setelah pembatalan berhasil.</div>`
    + field('adminNotes', 'Alasan pembatalan ACC (minimal 10 karakter)', '', 'textarea'), 'Batalkan ACC dan tiket', (data) => {
      if ((data.adminNotes || '').trim().length < 10) throw new Error('Alasan pembatalan minimal 10 karakter.');
      return api('reviewPayment', {registrationId:reg.registrationId,expectedReviewRevision:Number(reg.reviewRevision || 0),reviewAction:'cancel_acc',status:'menunggu',paymentStatus:'belum_diperiksa',ticketNumber:'',bankTransferConfirmed:false,rejectionReason:'',adminNotes:data.adminNotes});
    }, after);
  $('#operation-action-form').elements.adminNotes.minLength = 10;
}
function openRepairTicketDecision(reg, after) {
  const policy = registrationActions(reg);
  if (!policy.mayRepairTicket || !policy.reference) {report('Nomor tiket hanya dapat diperbaiki setelah check-in dibatalkan dan referensi resmi tersedia.');return;}
  actionModal('Perbaiki tiket lama', `<div class="cf-help warning cf-wide">Nomor lama: <strong>${esc(reg.ticketNumber || '—')}</strong>. Nomor pengganti resmi: <strong>${esc(policy.reference)}</strong>. Koreksi ini memperbarui indeks nomor tiket secara atomik dan mencatat audit; tiket lama tidak boleh tetap digunakan.</div>`
    + field('adminNotes','Alasan koreksi nomor (minimal 5 karakter)', 'Koreksi tiket dengan awalan ganda', 'textarea')
    + check('bankTransferConfirmed','Saya memeriksa ulang mutasi rekening dan memastikan ACC ini tetap sah.'), 'Simpan nomor tiket resmi', (data) => {
      if (!data.bankTransferConfirmed) throw new Error('Konfirmasi dana masuk diperlukan untuk koreksi tiket.');
      return api('reviewPayment', {registrationId:reg.registrationId,expectedReviewRevision:Number(reg.reviewRevision || 0), reviewAction:'repair_ticket',status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:policy.reference,rejectionReason:'',adminNotes:data.adminNotes,bankTransferConfirmed:true});
    }, after);
}
async function startJury() {
  let generation = 0;
  let assignments = [];
  let nextCursor = null;
  const search = $('#jury-search');
  const status = $('#jury-status');
  const list = $('#jury-list');
  const overview = $('#jury-metrics');
  const metric = (value, label) => `<article class="cf-metric"><b>${esc(value)}</b><span>${esc(label)}</span></article>`;
  function render() {
    const summary = jurySummary(assignments);
    overview.innerHTML = metric(summary.total, 'PENUGASAN DIMUAT') + metric(summary.pending, 'BELUM DINILAI') + metric(summary.draft, 'DRAFT TERSIMPAN') + metric(summary.final, 'NILAI FINAL');
    const matching = assignments.filter((item) => juryFilter(item, search.value, status.value));
    $('#jury-filter-feedback').textContent = assignments.length ? `${matching.length} dari ${assignments.length} penugasan yang dimuat${nextCursor ? ' · ada halaman berikutnya' : ''}` : 'Belum ada penugasan pada akun administrator yang sedang masuk. Di Operasional, pilih akun penilai yang aktif, lalu perbarui halaman ini.';
    if (!assignments.length) {
      list.innerHTML = `<div class="cf-empty cf-onboarding"><span class="cf-kicker">Menunggu penugasan panitia</span><h3>Belum ada karya yang perlu dinilai.</h3><p>Ini bukan kesalahan akun. Penugasan baru dapat dibuat admin setelah peserta mengirim karya final dan tenggat kategori berakhir.</p><ol class="cf-readiness"><li>Peserta menyelesaikan pendaftaran dan mengirim karya.</li><li>Batas pengumpulan kategori sudah terlewati.</li><li>Admin menugaskan admin penilai untuk karya final.</li><li>Karya muncul di sini secara otomatis setelah menekan Perbarui.</li></ol><p class="cf-meta">Jika kamu panitia, buka halaman Operasional untuk mengecek karya dan penugasan. Penilaian hanya dapat dilakukan melalui akun admin.</p></div>`;
      return;
    }
    if (!matching.length) {
      list.innerHTML = empty('Tidak ada tugas yang cocok.', 'Ubah kata kunci atau filter status. Penugasan yang belum dimuat dapat diakses melalui Muat penugasan berikutnya.');
      return;
    }
    list.innerHTML = matching.map((item) => {
      const locked = Boolean(item.grade?.finalized || item.resultsPublished);
      const criteria = Array.isArray(item.rubric?.criteria) ? item.rubric.criteria : [];
      const tally = item.grade?.scores || {};
      const label = item.resultsPublished ? 'Hasil diumumkan' : item.grade?.finalized ? 'Nilai final' : item.grade ? 'Draft tersimpan' : 'Belum dinilai';
      const style = locked ? 'green' : item.grade ? 'gold' : '';
      return `<article class="cf-card cf-record cf-jury-card" data-jury-card="${esc(item.assignmentId)}"><div class="cf-card-top"><div><span class="cf-kicker">${esc(item.registration?.packageLabel || 'Kategori kompetisi')}</span><h3>${esc(item.submission?.payload?.title || 'Karya peserta')}</h3><p class="cf-meta">${esc(item.registration?.referenceNumber || 'Referensi belum tersedia')} · Revisi karya ${esc(item.submissionRevision || '—')}</p></div><span class="cf-tag ${style}">${esc(label)}</span></div><div class="cf-actions"><button type="button" class="cf-button secondary" data-jury-work="${esc(item.assignmentId)}">Baca karya &amp; lampiran</button></div>${locked ? '<div class="cf-help">Penilaian telah dikunci. Kunjungi panel panitia untuk prosedur koreksi resmi.</div>' : '<div class="cf-help">Isi seluruh kriteria skala 0–100. Simpan draft dahulu apabila penilaian belum selesai.</div>'}<form class="cf-form cf-grade-form" data-grade-form="${esc(item.assignmentId)}" style="margin-top:20px">${criteria.map(([key, rubricLabel, weight]) => {
        const raw = key === 'flags' && item.flagScore !== null ? item.flagScore : tally[key] ?? '';
        const fixed = key === 'flags' && item.flagScore !== null;
        return `<label class="cf-field"><span>${esc(rubricLabel)} · ${esc(weight)}%</span><input type="number" name="${esc(key)}" min="0" max="100" step="0.01" inputmode="decimal" required value="${esc(raw)}" ${locked || fixed ? 'readonly' : ''}><small>${fixed ? 'Dihitung otomatis dari flag CTF yang valid.' : 'Masukkan skor 0–100.'}</small></label>`;
      }).join('')}<label class="cf-field cf-wide"><span>Alasan dan umpan balik penilaian *</span><textarea name="comment" minlength="10" maxlength="3000" required ${locked ? 'readonly' : ''} placeholder="Jelaskan kekuatan, kekurangan, dan dasar pemberian nilai…">${esc(item.grade?.comment || '')}</textarea></label><div class="cf-grade-summary cf-wide"><div><span>Estimasi skor akhir berbobot</span><strong data-score-estimate>—</strong></div><small>Perhitungan sementara di browser. Nilai sah dihitung ulang oleh server.</small></div><div class="cf-form-actions cf-wide"><button class="cf-button secondary" name="save" value="draft" type="submit" ${locked ? 'disabled' : ''}>Simpan draft</button><button class="cf-button green" name="save" value="final" type="submit" ${locked ? 'disabled' : ''}>Finalisasi nilai</button></div>${item.grade ? `<p class="cf-meta cf-wide">Skor server terakhir: ${esc(item.grade.total)} · Revisi nilai ${esc(item.grade.revision)}</p>` : ''}</form></article>`;
    }).join('');
    list.querySelectorAll('[data-grade-form]').forEach((form) => {
      const item = assignments.find((assignment) => assignment.assignmentId === form.dataset.gradeForm);
      const update = () => {
        const values = Object.fromEntries(new FormData(form));
        const sum = scoreEstimate(item.rubric?.criteria, values);
        form.querySelector('[data-score-estimate]').textContent = sum === null ? 'Lengkapi kriteria' : `${sum.toLocaleString('id-ID', {maximumFractionDigits:2})} / 100`;
      };
      form.addEventListener('input', update);
      update();
    });
  }
  async function load(cursor = null) {
    const epoch = ++generation;
    const data = await api('getJuryWorkspace', {cursor});
    if (epoch !== generation) return;
    assignments = cursor ? [...assignments, ...data.assignments] : data.assignments;
    nextCursor = data.nextCursor;
    $('#jury-more').hidden = !nextCursor;
    render();
  }
  search.addEventListener('input', render);
  status.addEventListener('change', render);
  $('#workspace-refresh').addEventListener('click', (event) => void busy(event.currentTarget, () => load()));
  $('#jury-more').addEventListener('click', (event) => {if (nextCursor) void busy(event.currentTarget, () => load(nextCursor));});
  list.addEventListener('click', (event) => {
    const target = event.target.closest('[data-jury-work]');
    if (!target) return;
    const item = assignments.find((assignment) => assignment.assignmentId === target.dataset.juryWork);
    if (item) modal('Lembar karya peserta', workHtml(item.submission), bindDownloads);
  });
  list.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-grade-form]');
    if (!form) return;
    event.preventDefault();
    const item = assignments.find((assignment) => assignment.assignmentId === form.dataset.gradeForm);
    if (!item || item.grade?.finalized || item.resultsPublished) {report('Nilai sudah dikunci. Muat ulang penugasan.'); return;}
    const finalize = event.submitter?.value === 'final';
    const formData = new FormData(form);
    const scores = Object.fromEntries(item.rubric.criteria.map(([key]) => [key, Number(formData.get(key))]));
    const payload = {registrationId: item.registrationId, expectedRevision: item.grade?.revision || 0, scores, comment: String(formData.get('comment') || '').trim(), finalize};
    if (finalize && !await paperConfirm({title: 'Finalisasi nilai karya ini?', message: 'Semua skor dan komentar akan dikunci. Koreksi setelah final hanya dapat dibuka ulang oleh panitia dengan alasan tertulis.', confirmText: 'Kunci dan finalisasi nilai', danger: false})) return;
    await busy(form, async () => {await api('saveJuryGrade', payload); await load(); gradeEdited = false; report(finalize ? 'Nilai berhasil difinalisasi.' : 'Draft penilaian tersimpan.', 'success');});
  });
  await load();
  // Other Admins may finalize or reassign a jury task. Polling uses the
  // authorized server projection, but never overwrites an unsaved score form.
  let gradeEdited = false;
  list.addEventListener('input', (event) => {
    if (event.target.closest('[data-grade-form]')) gradeEdited = true;
  });
  list.addEventListener('submit', (event) => {
    if (event.target.closest('[data-grade-form]')) {
      // The original submit handler updates the server; only successful load
      // should mark the form clean, so a pending edit stays protected.
      gradeEdited = true;
    }
  });
  const juryWatch = setInterval(() => {
    if (document.hidden || gradeEdited || document.querySelector('.cf-dialog[open]')
      || document.activeElement?.closest('[data-grade-form]')) return;
    void load().catch((error) => console.warn('ESORIA: tugas penilaian belum tersinkron', error?.code || 'fetch-failed'));
  }, 30000);
  window.addEventListener('pagehide', () => clearInterval(juryWatch), {once:true});
}

async function startOps({session}) {
  const scopeForm = $('#scope-form');
  scopeForm.elements.periodId.value = monthWib();
  let scope = scopeFromForm(scopeForm);
  let generation = 0;
  let state = null;
  let items = [];
  let preview = null;
  let previewEpoch = 0;
  const sameScope = (left, right) => ['periodId', 'package', 'wave'].every((key) => left?.[key] === right?.[key]);
  const invalidatePreview = () => {
    ++previewEpoch;
    preview = null;
    $('#result-preview').replaceChildren();
  };
  // A scope picker can change while a previous preview request is in flight.
  // Never allow the response for that old scope to create a publish button.
  const onScopeEdited = () => {
    if (!sameScope(scopeFromForm(scopeForm), scope)) invalidatePreview();
  };
  scopeForm.addEventListener('input', onScopeEdited);
  scopeForm.addEventListener('change', onScopeEdited);
  async function load(cursor = null) {
    const epoch = ++generation;
    const data = await api('getOperationsWorkspace', {...scope, cursor});
    if (epoch !== generation) return;
    state = data;
    setClock(data.serverNow);
    items = cursor ? [...items, ...data.items] : data.items;
    if (!cursor) invalidatePreview();
    $('#operations-access').textContent = 'Akses Administrator · Penilaian & pengesahan';
    const metric = (value, label) => `<article class="cf-metric"><b>${esc(value)}</b><span>${esc(label)}</span></article>`;
    $('#workspace-metrics').innerHTML = metric(data.metrics.registrations, `PENDAFTARAN / KUOTA ${data.metrics.capacity}`) + metric(data.metrics.pending, 'ANTREAN PEMERIKSAAN') + metric(data.metrics.verified, 'TIKET DITERIMA') + metric(data.metrics.submissions, 'LEMBAR KARYA');
    const phase = workflowPhase(data);
    $('#operations-process').innerHTML = PROCESS_STEPS.map(([num, title, description], index) => `<li class="${index + 1 === phase ? 'active' : index + 1 < phase ? 'done' : ''}"><b>${num}</b><strong>${esc(title)}</strong><small>${esc(description)}</small></li>`).join('');
    const phaseMessage = data.result?.published ? 'Hasil sudah diumumkan. Koreksi memerlukan prosedur penarikan hasil terlebih dahulu.' :
      !data.schedule ? 'Periode atau jadwal kategori belum ditemukan. Periksa pengaturan periode di Panel Admin.' :
      Number.isFinite(data.schedule.deadlineAt) && Date.now() <= data.schedule.deadlineAt ? 'Pengumpulan karya masih berlangsung. Penilaian admin baru dibuka setelah tenggat kategori.' :
      !data.policy ? 'Tenggat telah lewat. Tetapkan kebijakan jumlah penilai dan batas klarifikasi sebelum menyiapkan hasil.' :
      'Tenggat telah lewat. Pastikan karya ditugaskan, seluruh penilai admin memfinalisasi nilai, dan keputusan kelayakan lengkap.';
    $('#operations-guidance').textContent = `${scope.periodId} · ${scope.package.toUpperCase()} · ${scope.wave}: ${phaseMessage}`;
    const committee = data.admin === true;
    const payment = data.admin === true;
    $('#operations-policy').hidden = !committee;
    $('#export-results').disabled = !data.result?.published;
    $('#export-results').title = data.result?.published ? 'Unduh hasil yang telah diumumkan' : 'CSV hanya dapat diunduh setelah hasil diumumkan.';
    const previewReady = !data.result?.published && Number.isFinite(data.schedule?.deadlineAt) && Date.now() > data.schedule.deadlineAt && Boolean(data.policy?.requiredJudgeCount) && data.metrics.submissions > 0;
    $('#prepare-results-form').querySelector('button[type=submit]').disabled = !previewReady;
    $('#prepare-results-form').querySelector('button[type=submit]').title = previewReady ? 'Susun pratinjau yang belum diumumkan' : 'Memerlukan deadline terlewati, kebijakan juri, dan karya terkirim; hasil juga belum boleh diumumkan.';
    $('#policy-form').querySelector('button[type=submit]').disabled = Boolean(data.result?.published);
    if (committee) {
      const policy = $('#policy-form');
      policy.elements.requiredJudgeCount.value = data.policy?.requiredJudgeCount || '';
      policy.elements.appealDeadlineAt.value = data.policy?.appealDeadlineAt ? wibDateTimeLocalValue(timeValue(data.policy.appealDeadlineAt)) : '';
      $('#withdraw-results').hidden = !data.admin || !data.result?.published;
    }
    $('#operations-more').hidden = !data.nextCursor;
    $('#operations-list').innerHTML = items.length ? items.map((reg) => {const policy = registrationActions(reg); return `<article class="cf-card cf-record"><div class="cf-card-top"><div><span class="cf-kicker">${esc(reg.referenceNumber)}</span><h3>${esc(reg.teamName || reg.userName)}</h3><p class="cf-meta">ID ${esc(reg.registrationId)}${reg.memberCount ? ` · ${reg.memberCount} anggota` : ''}</p></div><span class="cf-tag ${reg.status === 'terverifikasi' ? 'green' : ''}">${esc(statusLabel(reg.status))}</span></div><dl class="cf-facts"><div><dt>Pembayaran</dt><dd>${esc(statusLabel(reg.paymentStatus))}</dd></div><div><dt>Tiket</dt><dd>${esc(reg.ticketNumber || 'Belum diterbitkan')}${policy.needsTicketRepair ? ' · PERLU PERBAIKAN' : ''}</dd></div>${committee ? `<div><dt>Karya</dt><dd>${esc(statusLabel(reg.submission?.status || 'belum_ada'))}</dd></div><div><dt>Penilai aktif</dt><dd>${reg.assignments.filter((assignment) => assignment.active).length}</dd></div>` : ''}</dl>${reg.proofDuplicateSuspected ? '<div class="cf-help warning">Bukti terindikasi identik dengan pendaftaran lain. Periksa dana masuk dan jelaskan temuan sebelum ACC.</div>' : ''}${reg.appeal?.status === 'open' ? '<div class="cf-help warning">Ada permintaan klarifikasi yang perlu ditanggapi.</div>' : ''}<div class="cf-actions">${payment && policy.mayReview ? `<button type="button" class="cf-button" data-operation="payment" data-id="${esc(reg.registrationId)}">${reg.status === 'ditolak' ? 'Tinjau ulang' : 'Periksa & putuskan'}</button>` : ''}${payment && policy.accepted ? `${policy.mayCancelAcc ? `<button type="button" class="cf-button danger" data-operation="cancel-acc" data-id="${esc(reg.registrationId)}">Batalkan ACC</button>` : ''}${policy.needsTicketRepair ? `<button type="button" class="cf-button secondary" data-operation="repair-ticket" data-id="${esc(reg.registrationId)}" ${policy.mayRepairTicket ? '' : 'disabled title="Batalkan check-in dahulu"'}>Perbaiki tiket</button>` : ''}` : ''}${payment && (policy.mayCheckIn || policy.mayCancelCheckIn) ? `<button type="button" class="cf-button secondary" data-operation="check-in" data-id="${esc(reg.registrationId)}">${policy.checkedIn ? 'Batal Check-in' : 'Check-in'}</button>` : ''}${payment ? `<button type="button" class="cf-button secondary" data-operation="proof" data-id="${esc(reg.registrationId)}" ${reg.proofAttached ? '' : 'disabled'}>Lihat bukti privat</button>` : ''}${committee ? `<button class="cf-button secondary" type="button" data-operation="work" data-id="${esc(reg.registrationId)}" ${reg.submission ? '' : 'disabled'}>Lihat karya</button><button class="cf-button secondary" type="button" data-operation="assign" data-id="${esc(reg.registrationId)}" title="${esc(assignmentAction(reg, data.schedule, data.result).reason)}" ${assignmentAction(reg, data.schedule, data.result).enabled ? '' : 'disabled'}>Tugaskan admin penilai</button><button class="cf-button secondary" type="button" data-operation="reopen" data-id="${esc(reg.registrationId)}" ${reg.assignments?.some((entry) => entry.active) && !data.result?.published ? '' : 'disabled'}>Buka ulang nilai</button><button class="cf-button secondary" type="button" data-operation="revoke-assignment" data-id="${esc(reg.registrationId)}" ${reg.assignments?.some((entry) => entry.active) && !data.result?.published ? '' : 'disabled'}>Cabut penugasan</button><button class="cf-button secondary" type="button" data-operation="eligibility" data-id="${esc(reg.registrationId)}">Kelayakan</button>${reg.appeal?.status === 'open' ? `<button class="cf-button secondary" type="button" data-operation="appeal" data-id="${esc(reg.registrationId)}">Tanggapi klarifikasi</button>` : ''}${data.admin && data.result?.published && data.result?.rows?.some((row) => row.registrationId === reg.registrationId && row.rank >= 1 && row.rank <= 3 && !row.disqualified) ? (() => {if (data.result?.demoFixture === true) {
              return `<button class="cf-button green" type="button" data-operation="certificate-preview" data-id="${esc(reg.registrationId)}" title="Buat PDF pratinjau internal yang dapat dicetak">Cetak pratinjau PDF</button><span class="cf-meta">Pratinjau arsip internal; bukan sertifikat resmi.</span>`;
            }
            const availability = certificateAction(reg, data.result, {now:data.serverNow, isolated: location.hostname === "localhost" || location.hostname === "127.0.0.1"}); return `<button class="cf-button green" type="button" data-operation="certificate" data-id="${esc(reg.registrationId)}" ${availability.enabled ? "" : "disabled"} title="${esc(availability.reason)}">${availability.enabled ? "Unduh sertifikat PDF" : "Sertifikat belum tersedia"}</button>${availability.enabled ? "" : `<span class="cf-meta">${esc(availability.reason)}</span>`}`;})() : ''}${data.admin && data.result?.published && data.result?.rows?.some((row) => row.registrationId === reg.registrationId && row.rank >= 1 && row.rank <= 3 && !row.disqualified) ? `<button class="cf-button secondary" type="button" data-operation="prize" data-id="${esc(reg.registrationId)}" ${reg.prize?.paid ? 'disabled' : ''}>${reg.prize?.paid ? 'Hadiah dicatat dibayar' : 'Catat pembayaran hadiah'}</button>` : ''}` : ''}</div>${committee && reg.assignments.length ? `<p class="cf-meta">Penilai aktif: ${reg.assignments.filter((assignment) => assignment.active).map((assignment) => esc(assignment.judgeUid)).join(', ') || 'Belum ada'}</p>` : ''}</article>`;}).join('') : empty('Belum ada pendaftaran.', 'Periksa periode, kategori, dan gelombang yang dipilih.');
  }
  scopeForm.addEventListener('submit', (event) => {event.preventDefault(); scope = scopeFromForm(scopeForm); void busy(scopeForm, () => load());});
  $('#operations-more').addEventListener('click', (event) => void busy(event.currentTarget, () => load(state.nextCursor)));
  $('#operations-list').addEventListener('click', (event) => {
    const target = event.target.closest('[data-operation]');
    if (!target) return;
    const reg = items.find((item) => item.registrationId === target.dataset.id);
    if (!reg) return;
    const registrationId = reg.registrationId;
    const after = () => load();
    switch (target.dataset.operation) {
      case 'certificate-preview':
        void busy(target, async () => {
          const pdf = await api('downloadCertificatePreview', {registrationId});
          if (pdf?.previewOnly !== true || pdf?.mimeType !== 'application/pdf' || typeof pdf?.base64 !== 'string' || !pdf.base64.startsWith('JVBERi0'))
            throw new Error('Server tidak mengembalikan pratinjau PDF yang valid. Periksa log Cloud Functions.');
          download(pdf);
          report('Pratinjau PDF siap diunduh dan dicetak. Dokumen ini bukan sertifikat resmi.', 'success');
        });
        break;
      case 'certificate':
        void busy(target, async () => {
          const availability = certificateAction(reg, state?.result, {now: state?.serverNow || Date.now(), isolated: location.hostname === 'localhost' || location.hostname === '127.0.0.1'});
          if (!availability.enabled) throw new Error(`${availability.reason} Perbarui data dan lakukan pengesahan hasil terlebih dahulu.`);
          const issued = await api('issueCertificate', {registrationId});
          if (!issued?.certificateId) throw new Error('Server belum mengembalikan identitas sertifikat. Periksa status hasil dan ulangi.');
          const pdf = await api('downloadCertificate', {certificateId: issued.certificateId});
          if (pdf?.mimeType !== 'application/pdf' || typeof pdf?.base64 !== 'string' || !pdf.base64.startsWith('JVBERi0'))
            throw new Error('Server tidak mengembalikan dokumen PDF yang valid. Ulangi atau periksa log Cloud Functions.');
          download(pdf);
          report('Sertifikat PDF siap diunduh. Buka berkas untuk mencetak.', 'success');
        });
        break;
      case 'proof':
        void busy(target, async () => {
          const proof = await api('getPaymentEvidence', {registrationId});
          const bytes = Uint8Array.from(atob(proof.base64), (character) => character.charCodeAt(0));
          const src = URL.createObjectURL(new Blob([bytes], {type: 'image/jpeg'}));
          modal('Bukti transfer privat', '<div class="cf-help warning">Cocokkan dana masuk di mutasi rekening resmi secara terpisah. Screenshot bukan konfirmasi penerimaan dana.</div><img class="cf-proof" alt="Screenshot bukti transfer peserta" id="payment-proof-private">', () => {$('#payment-proof-private').src = src; return () => URL.revokeObjectURL(src);});
        }); break;
      case 'payment': openPaymentDecision(reg, after); break;
      case 'cancel-acc': openCancelAccDecision(reg, after); break;
      case 'repair-ticket': openRepairTicketDecision(reg, after); break;
      case 'check-in':
        void busy(target, async () => {
          const accepted = registrationActions(reg);
          if (!accepted.accepted) throw new Error('ACC tidak lagi aktif. Perbarui data terlebih dahulu.');
          const checkedIn = !accepted.checkedIn;
          if (!await paperConfirm({title:checkedIn ? 'Catat check-in?' : 'Batalkan kehadiran?',message:checkedIn ? 'Kehadiran akan dicatat dan terlihat di tiket peserta.' : 'Kehadiran akan dibatalkan dengan audit log dan notifikasi.',confirmText:checkedIn ? 'Ya, Check-in' : 'Batalkan Check-in',danger:!checkedIn})) return;
          await api('checkInRegistration', {registrationId,checkedIn});
          await after();
          report(checkedIn ? 'Check-in tersimpan.' : 'Check-in dibatalkan.', 'success');
        });
        break;
      case 'work': modal('Karya peserta', workHtml(reg.submission), bindDownloads); break;
      case 'assign': actionModal('Tugaskan admin penilai', field('judgeUid', 'UID admin penilai lain (opsional; kosong = akun saya)', '', 'text', false) + '<p class="cf-meta cf-wide">Penilaian dibuka setelah tenggat. UID harus berasal dari akun administrator aktif. Penilai tidak boleh memiliki konflik kepentingan dengan peserta atau tim.</p>', 'Simpan penugasan', (data) => api('assignJudge', {registrationId, ...data}), after); break;
      case 'revoke-assignment': actionModal('Cabut penugasan admin', field('judgeUid', 'UID admin penilai') + field('reason', 'Alasan pencabutan', '', 'textarea'), 'Cabut penugasan', (data) => api('deactivateJudgeAssignment', {registrationId, ...data}), after); break;
      case 'reopen': actionModal('Buka ulang penilaian', field('judgeUid', 'UID admin penilai yang nilainya perlu dikoreksi') + field('reason', 'Alasan koreksi', '', 'textarea'), 'Buka ulang nilai', (data) => api('reopenJuryGrade', {registrationId, ...data}), after); break;
      case 'eligibility': actionModal('Keputusan kelayakan', check('disqualified', 'Diskualifikasi karya ini', reg.decision?.disqualified === true) + field('reason', 'Dasar keputusan dan rujukan aturan', '', 'textarea'), 'Simpan kelayakan', (data) => api('setDisqualification', {registrationId, expectedRevision: reg.decision?.revision || 0, ...data}), after); break;
      case 'appeal': actionModal('Tanggapi klarifikasi', `<div class="cf-help cf-wide">${esc(reg.appeal.message)}</div>` + field('response', 'Tanggapan resmi panitia', '', 'textarea'), 'Kirim tanggapan', (data) => api('resolveAppeal', {registrationId, expectedRevision: reg.appeal.revision, ...data}), after); break;
      case 'prize': actionModal('Catat pembayaran hadiah manual', '<p class="cf-help warning cf-wide">Form ini mencatat hadiah pemenang. Nominal mengikuti hadiah resmi kategori dan peringkat; jangan masukkan nomor rekening atau bukti pribadi.</p>' + field('reference', 'Referensi transaksi manual') + field('note', 'Catatan pembayaran', '', 'textarea') + check('bankTransferConfirmed', 'Saya telah menyelesaikan transfer hadiah secara terpisah dan memeriksa catatan pembayaran resmi.'), 'Catat hadiah dibayar', (data) => api('recordPrizePayment', {registrationId, ...data}), after); break;
    }
  });
  $('#policy-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = scopeFromForm(form);
    const payload = {...scope, requiredJudgeCount: Number(data.requiredJudgeCount), appealDeadlineAt: `${data.appealDeadlineAt}:00+07:00`, reason: data.reason, expectedRevision: state.policy?.revision || 0};
    // Refresh controls only AFTER busy() has restored its snapshot of the
    // disabled flags. Otherwise busy's finally can re-enable a button that
    // the new server state intentionally locked (for example, published results).
    void (async () => {
      let saved = false;
      await busy(form, async () => {await api('configureCompetition', payload); saved = true;});
      if (saved) {
        try {await load(); report('Kebijakan disahkan.', 'success');}
        catch (error) {report(error?.message || 'Kebijakan tersimpan, tetapi tampilan belum berhasil diperbarui.');}
      }
    })();
  });
  $('#prepare-results-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = scopeFromForm(form);
    const preparedScope = {...scope};
    const loadedEpoch = generation;
    const requestedEpoch = ++previewEpoch;
    void busy(form, async () => {
      const result = await api('prepareResults', {...preparedScope, tieOrder: String(data.tieOrder || '').split(',').map((value) => value.trim()).filter(Boolean), tieReason: data.tieReason});
      if (requestedEpoch !== previewEpoch || loadedEpoch !== generation || !sameScope(scopeFromForm(scopeForm), preparedScope)) return;
      preview = {...result, scope: preparedScope};
      $('#result-preview').innerHTML = `<div class="cf-help">Pratinjau belum dipublikasikan. Jadwal pengumuman: ${esc(formatDate(preview.announcementAt))}</div><div class="cf-table-wrap" role="region" aria-label="Pratinjau hasil" tabindex="0"><table><thead><tr><th>Peringkat</th><th>Nama / tiket</th><th>Skor</th></tr></thead><tbody>${preview.rows.map((item) => `<tr><td>${item.rank || '—'}</td><td>${esc(item.displayName)}</td><td>${item.total ?? 'Diskualifikasi'}</td></tr>`).join('')}</tbody></table></div><form class="cf-form" id="publish-results-form" style="margin-top:18px">${field('reason', 'Catatan pengesahan hasil oleh panitia', '', 'textarea')}<button class="cf-button green cf-wide" type="submit">Sahkan &amp; publikasikan hasil</button></form>`;
      $('#publish-results-form').addEventListener('submit', async (publishEvent) => {
        publishEvent.preventDefault();
        const publishForm = publishEvent.currentTarget;
        const reason = publishForm.elements.reason.value;
        const approved = preview;
        if (!approved || !sameScope(scopeFromForm(scopeForm), approved.scope)) {report('Lingkup berubah. Susun kembali pratinjau hasil sebelum publikasi.'); return;}
        const confirmationEpoch = previewEpoch;
        if (!await paperConfirm({title: 'Publikasikan hasil resmi?', message: 'Peserta dan pengunjung dapat melihat hasil ini. Pastikan seluruh penilaian dan keputusan seri sudah diperiksa.', confirmText: 'Publikasikan hasil', danger: false})) return;
        if (confirmationEpoch !== previewEpoch || approved !== preview || !sameScope(scopeFromForm(scopeForm), approved.scope)) {
          report('Pilihan atau pratinjau berubah. Publikasi dibatalkan; susun kembali hasil untuk lingkup yang benar.');
          return;
        }
        await busy(publishForm, async () => {await api('publishResults', {...approved.scope, draftId: approved.draftId, expectedRevision: approved.expectedRevision, reason}); await load(); report('Hasil kompetisi telah dipublikasikan.', 'success');});
      });
    });
  });
  $('#export-results').addEventListener('click', (event) => void busy(event.currentTarget, async () => download(await api('exportCompetitionCsv', scope))));
  $('#withdraw-results').addEventListener('click', () => actionModal('Tarik pengumuman hasil', '<p class="cf-help warning cf-wide">Penarikan menonaktifkan verifikasi sertifikat yang bergantung pada pengumuman ini.</p>' + field('reason', 'Alasan penarikan hasil', '', 'textarea'), 'Tarik pengumuman', (data) => api('unpublishResults', {...scope, ...data, expectedRevision: state.result?.revision || 0}), () => load()));
  $('#revoke-certificate-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = scopeFromForm(form);
    if (!await paperConfirm({title: 'Cabut sertifikat?', message: 'ID sertifikat ini tidak lagi berlaku setelah pencabutan.', confirmText: 'Cabut sertifikat', danger: true})) return;
    await busy(form, async () => {await api('revokeCertificate', payload); report('Sertifikat telah dicabut.', 'success');});
  });
  if (session.kind === 'admin') document.querySelectorAll('[data-full-admin]').forEach((node) => {node.hidden = false;});
  await load();
  // Server remains the source of truth. Avoid replacing active forms/modals or
  // publication previews, as a polling refresh would discard user input.
  let closed = false;
  let syncing = false;
  const backgroundSync = async () => {
    if (closed || syncing || preview || document.hidden || document.querySelector('.cf-dialog[open]')
      || document.activeElement?.closest('#scope-form, #prepare-results-form, #publish-results-form')) return;
    syncing = true;
    try {await load();} catch (error) {
      console.warn('ESORIA: daftar operasional belum tersinkron', error?.code || 'fetch-failed');
    } finally {syncing = false;}
  };
  let unsubscribe = null;
  let queued = null;
  const watchSelectedScope = () => {
    unsubscribe?.(); unsubscribe = null;
    clearTimeout(queued);
    try {
      const rows = query(collection(db, 'registrations'),
        where('periodId', '==', scope.periodId),
        where('package', '==', scope.package),
        where('wave', '==', scope.wave), limit(25));
      let firstSnapshot = true;
      let lastFingerprint = null;
      unsubscribe = onSnapshot(rows, (snapshot) => {
        const fingerprint = snapshot.docs.map((row) => `${row.id}:${row.updateTime?.toMillis?.() || ''}`).join('|');
        if (!firstSnapshot && lastFingerprint !== fingerprint && preview) {
          invalidatePreview();
          report('Data peserta berubah. Susun kembali pratinjau hasil sebelum pengesahan.', 'notice');
        }
        firstSnapshot = false;
        lastFingerprint = fingerprint;
        if (closed || queued) return;
        queued = setTimeout(() => {queued = null; void backgroundSync();}, 600);
      }, (error) => console.warn('ESORIA: listener administrasi tidak tersedia, sinkronisasi berkala tetap aktif', error?.code || 'listen-failed'));
    } catch (error) {
      console.warn('ESORIA: listener administrasi gagal dipasang', error?.code || 'setup-failed');
    }
  };
  watchSelectedScope();
  scopeForm.addEventListener('submit', () => {
    // Scope changes only after form validation and the original handler.
    queueMicrotask(watchSelectedScope);
  });
  const interval = setInterval(() => {void backgroundSync();}, 20000);
  const onVisible = () => {if (document.visibilityState === 'visible') void backgroundSync();};
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', () => {
    closed = true; clearInterval(interval); clearTimeout(queued);
    unsubscribe?.(); document.removeEventListener('visibilitychange', onVisible);
  }, {once:true});
}
export const startOperations = (kind, session) => kind === 'jury' ? startJury() : startOps(session);
