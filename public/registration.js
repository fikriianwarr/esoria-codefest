import {api as accountApi} from './competition-client.js?v=b74586eaa5ef6110';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { localStore, sessionStore } from './safe-storage.js?v=b74586eaa5ef6110';
import { paperConfirm } from './paper-confirm.js?v=b74586eaa5ef6110';
import {
  getRegistrationContext,
  submitRegistration
} from './spark-data.js?v=b74586eaa5ef6110';
import {
  calculateAge,
  friendlyFirebaseError,
  profileName,
  requireAuthenticated
} from './auth-core.js?v=b74586eaa5ef6110';
import { formatWib, wibDateValue } from './time-utils.js?v=b74586eaa5ef6110';

const { user, profile } = await requireAuthenticated({ profileRequired: true, verifiedEmailRequired: true });
const registrationForm = document.querySelector('#registration-form');
const packageSelect = document.querySelector('#package-select');
const waveSelect = document.querySelector('#wave-select');
const memberCountInput = document.querySelector('#member-count');
const teamFields = document.querySelector('#team-fields');
const teamRequiredFields = [...document.querySelectorAll('[data-team-required]')];
const teamMemberEditor = document.querySelector('#team-member-editor');
const nominalDisplay = document.querySelector('#nominal-display');
const nominalTicket = document.querySelector('#nominal-ticket');
const selectedPackageCard = document.querySelector('#selected-package-card');
const formAlert = document.querySelector('#form-alert');
const progressBar = document.querySelector('#form-progress-bar');
const progressText = document.querySelector('#form-progress-text');
const formSteps = [...document.querySelectorAll('[data-form-step]')];
const customSelects = [...document.querySelectorAll('[data-custom-select]')];
const transferDateInput = document.querySelector('[name="tanggal_transfer"]');
const paymentProofInput = document.querySelector('#payment-proof-input');
const paymentProofDropzone = document.querySelector('[data-proof-dropzone]');
const paymentProofPreview = document.querySelector('#payment-proof-preview');
const paymentProofImage = document.querySelector('#payment-proof-image');
const paymentProofName = document.querySelector('#payment-proof-name');
const paymentProofMeta = document.querySelector('#payment-proof-meta');
const paymentProofStatus = document.querySelector('#payment-proof-status');
const paymentProofRemove = document.querySelector('#payment-proof-remove');
const uploadProgress = document.querySelector('#proof-upload-progress');
const uploadProgressBar = uploadProgress?.querySelector('i');
const periodBanner = document.querySelector('#registration-period-banner');
const periodLabel = document.querySelector('#registration-period-label');
const countdown = document.querySelector('#registration-countdown');
const countdownHeading = document.querySelector('#registration-countdown-heading');
const periodInput = document.querySelector('#registration-period-id');
const reviewDialog = document.querySelector('#registration-review-dialog');
const reviewContent = document.querySelector('#registration-review-content');
const confirmSubmit = document.querySelector('#registration-confirm-submit');
const submitButton = registrationForm.querySelector('.form-submit');
const DRAFT_KEY = `esoria-registration-draft:${user.uid}`;

let activePeriod = null;
let acceptingRegistrations = false;
let registrationSystem = null;
let serverClockOffset = 0;
let paymentProofData = null;
let paymentProofBusy = false;
let paymentProofProcessId = 0;
let submitting = false;
let formDirty = false;
let countdownTimer = 0;
let periodContextVersion = 0;

const packageData = {
  web: { label: 'Website Programming', amount: 'Rp100.000', meta: 'Individu · 3 hari', theme: 'web' },
  cyber: { label: 'Cybersecurity Mini CTF', amount: 'Rp250.000', meta: 'Individu · 3 hari', theme: 'cyber' },
  team: { label: 'Full Stack Development Team', amount: 'Rp500.000', meta: 'Tim 2–4 orang · 7 hari', theme: 'team' }
};

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

const localToday = () => wibDateValue(Date.now() + serverClockOffset);
if (transferDateInput) transferDateInput.max = localToday();

const setFormAlert = (message = '', type = 'error') => {
  delete formAlert.dataset.source;
  formAlert.hidden = !message;
  formAlert.textContent = message;
  formAlert.dataset.type = type;
};

const setProfileField = (name, value = '') => {
  const field = registrationForm.elements.namedItem(name);
  if (field) field.value = value;
};

const accountName = profileName(profile, user);
setProfileField('user_id', user.uid);
setProfileField('nama_lengkap', accountName);
setProfileField('email', user.email || profile.email || '');
setProfileField('nomor_telepon', profile.phone || '');
setProfileField('instansi', profile.institution || '');
setProfileField('kota', profile.city || '');
setProfileField('provinsi', profile.province || '');

document.querySelector('#registration-account-name').textContent = accountName;
const accountAge = calculateAge(profile.birthDate);
document.querySelector('#registration-account-meta').textContent = `${user.email || ''}${accountAge === null ? '' : ` · ${accountAge} tahun`} · ${profile.city || profile.province || 'Profil aktif'}`;
document.querySelector('#registration-account-avatar').textContent = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

document.addEventListener('esoria:logout-approved', () => { formDirty = false; });

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const loadImageFile = (file) => new Promise((resolve, reject) => {
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.addEventListener('load', () => resolve({ image, source }), { once: true });
  image.addEventListener('error', () => { URL.revokeObjectURL(source); reject(new Error('File yang dipilih bukan gambar yang valid.')); }, { once: true });
  image.src = source;
});

const canvasBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Screenshot tidak dapat dikompresi.')), 'image/jpeg', quality);
});

const compressPaymentProof = async (file) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan screenshot berformat JPG, PNG, atau WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Ukuran screenshot maksimal 8 MB.');
  const loaded = await loadImageFile(file);
  try {
    const longestSide = Math.max(loaded.image.naturalWidth, loaded.image.naturalHeight);
    if (!longestSide) throw new Error('Dimensi screenshot tidak dapat dibaca.');
    const initialScale = Math.min(1, 1800 / longestSide);
    let width = Math.max(1, Math.round(loaded.image.naturalWidth * initialScale));
    let height = Math.max(1, Math.round(loaded.image.naturalHeight * initialScale));
    let quality = 0.86;
    let blob = null;
    const maximumBytes = 360 * 1024;
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded.image, 0, 0, width, height);
      blob = await canvasBlob(canvas, quality);
      if (blob.size <= maximumBytes) break;
      if (quality > 0.5) quality -= 0.08;
      else {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(width * (loaded.image.naturalHeight / loaded.image.naturalWidth)));
        quality = 0.7;
      }
    }
    if (!blob || blob.size > maximumBytes) throw new Error('Screenshot masih terlalu besar setelah dikompresi. Pilih gambar lain.');
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'bukti-transfer';
    return {
      blob,
      fileName: `${baseName}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: blob.size,
      width,
      height,
      previewUrl: URL.createObjectURL(blob)
    };
  } finally {
    URL.revokeObjectURL(loaded.source);
  }
};

const setPaymentProofStatus = (message, state = '') => {
  paymentProofStatus.textContent = message;
  paymentProofStatus.dataset.state = state;
};

const resetPaymentProof = () => {
  paymentProofProcessId += 1;
  if (paymentProofData?.previewUrl) URL.revokeObjectURL(paymentProofData.previewUrl);
  paymentProofData = null;
  paymentProofBusy = false;
  paymentProofInput.value = '';
  paymentProofInput.setCustomValidity('Pilih screenshot bukti transfer.');
  paymentProofDropzone.classList.remove('is-processing', 'is-invalid');
  paymentProofDropzone.hidden = false;
  paymentProofPreview.hidden = true;
  paymentProofImage.removeAttribute('src');
  uploadProgress.hidden = true;
  if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  setPaymentProofStatus('Belum ada screenshot yang dipilih.');
  updateProgress();
};

const processPaymentProof = async (file) => {
  const processId = ++paymentProofProcessId;
  if (paymentProofData?.previewUrl) URL.revokeObjectURL(paymentProofData.previewUrl);
  paymentProofData = null;
  paymentProofBusy = true;
  paymentProofInput.setCustomValidity('Screenshot sedang diproses.');
  paymentProofDropzone.classList.remove('is-invalid');
  paymentProofDropzone.classList.add('is-processing');
  setPaymentProofStatus('Menyiapkan dan mengompresi screenshot…');
  updateProgress();
  try {
    const result = await compressPaymentProof(file);
    if (processId !== paymentProofProcessId) return URL.revokeObjectURL(result.previewUrl);
    paymentProofData = result;
    paymentProofInput.setCustomValidity('');
    paymentProofImage.src = result.previewUrl;
    paymentProofName.textContent = result.fileName;
    paymentProofMeta.textContent = `${formatFileSize(result.sizeBytes)} · ${result.width} × ${result.height} px`;
    paymentProofDropzone.hidden = true;
    paymentProofPreview.hidden = false;
    setPaymentProofStatus('Screenshot valid dan siap disimpan dengan aman.', 'ready');
    setFormAlert('');
  } catch (error) {
    if (processId !== paymentProofProcessId) return;
    paymentProofInput.value = '';
    paymentProofInput.setCustomValidity(error.message);
    paymentProofDropzone.classList.add('is-invalid');
    setPaymentProofStatus(error.message, 'error');
    setFormAlert(error.message);
  } finally {
    if (processId === paymentProofProcessId) {
      paymentProofBusy = false;
      paymentProofDropzone.classList.remove('is-processing');
      updateProgress();
    }
  }
};

paymentProofInput.addEventListener('change', () => {
  const file = paymentProofInput.files?.[0];
  if (file) void processPaymentProof(file);
  else resetPaymentProof();
});
paymentProofRemove.addEventListener('click', () => { resetPaymentProof(); paymentProofInput.focus(); });
['dragenter', 'dragover'].forEach((eventName) => paymentProofDropzone.addEventListener(eventName, (event) => { event.preventDefault(); if (!paymentProofBusy) paymentProofDropzone.classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach((eventName) => paymentProofDropzone.addEventListener(eventName, (event) => { event.preventDefault(); paymentProofDropzone.classList.remove('is-dragging'); }));
paymentProofDropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file || paymentProofBusy) return;
  const transfer = new DataTransfer(); transfer.items.add(file); paymentProofInput.files = transfer.files; void processPaymentProof(file);
});

const closeCustomSelect = (component, restoreFocus = false) => {
  const trigger = component?.querySelector('.custom-select-trigger');
  const panel = component?.querySelector('.custom-options');
  if (!trigger || !panel) return;
  component.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true;
  if (restoreFocus) trigger.focus();
};
const closeOtherSelects = (current) => customSelects.forEach((component) => { if (component !== current) closeCustomSelect(component); });
const openCustomSelect = (component, focusTarget = 'selected') => {
  const trigger = component.querySelector('.custom-select-trigger');
  const panel = component.querySelector('.custom-options');
  const options = [...component.querySelectorAll('[role="option"]')];
  if (!trigger || !panel || !options.length) return;
  const available = options.filter((option) => !option.disabled);
  closeOtherSelects(component); panel.hidden = false; component.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
  if (focusTarget && available.length) {
    const selected = available.find((option) => option.getAttribute('aria-selected') === 'true');
    (focusTarget === 'last' ? available[available.length - 1] : (selected || available[0])).focus();
  }
};
const selectCustomOption = (component, option, emit = true) => {
  const input = component.querySelector('[data-custom-input]');
  const trigger = component.querySelector('.custom-select-trigger');
  const label = component.querySelector('[data-selected-label]');
  const options = [...component.querySelectorAll('[role="option"]')];
  if (!input || !trigger || !label || !option || option.disabled) return;
  input.value = option.dataset.value || '';
  // Keep the official full label as a tooltip while presenting compact text
  // inside the selected wave trigger. The hidden input's wave id is untouched.
  const fullLabel = option.dataset.label || option.querySelector('strong')?.textContent || '';
  label.textContent = option.dataset.compactLabel || fullLabel;
  if (option.dataset.compactLabel) label.title = fullLabel;
  else label.removeAttribute('title');
  options.forEach((item) => item.setAttribute('aria-selected', String(item === option)));
  trigger.classList.toggle('is-placeholder', !input.value);
  component.classList.remove('invalid');
  if (emit) input.dispatchEvent(new Event('change', { bubbles: true }));
};
const setCustomValue = (input, value, emit = false) => {
  const component = input?.closest('[data-custom-select]');
  const option = [...(component?.querySelectorAll('[role="option"]') || [])].find((item) => item.dataset.value === value);
  if (component && option) selectCustomOption(component, option, emit);
};

customSelects.forEach((component) => {
  const input = component.querySelector('[data-custom-input]');
  const trigger = component.querySelector('.custom-select-trigger');
  const panel = component.querySelector('.custom-options');
  const options = [...component.querySelectorAll('[role="option"]')];
  if (!input || !trigger || !panel || !options.length) return;
  if (input.value) setCustomValue(input, input.value);
  trigger.addEventListener('click', () => component.classList.contains('open') ? closeCustomSelect(component) : openCustomSelect(component, false));
  trigger.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); openCustomSelect(component, ['ArrowUp', 'End'].includes(event.key) ? 'last' : 'selected');
  });
  options.forEach((option, index) => {
    option.addEventListener('click', () => { if (option.disabled) return; selectCustomOption(component, option); closeCustomSelect(component, true); });
    option.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeCustomSelect(component, true); return; }
      if (event.key === 'Tab') { closeCustomSelect(component); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
      if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = options.length - 1;
      const candidates = options.filter((item) => !item.disabled);
      const next = options[nextIndex];
      (next.disabled ? (candidates.find((item) => options.indexOf(item) >= nextIndex) || candidates[0]) : next)?.focus();
    });
  });
});
document.addEventListener('click', (event) => customSelects.forEach((component) => { if (!component.contains(event.target)) closeCustomSelect(component); }));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') customSelects.forEach((component) => closeCustomSelect(component)); });

const renderTeamMembers = (count, restored = []) => {
  if (!count) {
    teamMemberEditor.innerHTML = '<p>Pilih jumlah anggota untuk menampilkan kolom anggota.</p>';
    updateProgress();
    return;
  }
  teamMemberEditor.innerHTML = Array.from({ length: count }, (_, index) => {
    const member = restored[index] || {};
    return `<fieldset class="team-member-card" data-member-index="${index}"><legend><b>${String(index + 1).padStart(2, '0')}</b> Anggota ${index + 1}${index === 0 ? ' / Ketua' : ''}</legend><div class="team-member-grid"><label><span>Nama lengkap *</span><input data-team-member="name" maxlength="100" minlength="2" required type="text" value="${escapeHtml(member.name || (index === 0 ? accountName : ''))}"></label><label><span>Email *</span><input data-team-member="email" maxlength="160" required type="email" value="${escapeHtml(member.email || (index === 0 ? user.email || '' : ''))}" ${index === 0 ? 'readonly aria-readonly="true"' : ''}></label><label><span>Nomor telepon</span><input data-team-member="phone" maxlength="20" type="tel" value="${escapeHtml(member.phone || (index === 0 ? profile.phone || '' : ''))}"></label><label><span>Instansi</span><input data-team-member="institution" maxlength="120" type="text" value="${escapeHtml(member.institution || (index === 0 ? profile.institution || '' : ''))}"></label><label class="wide"><span>Peran *</span><input data-team-member="role" maxlength="80" minlength="2" placeholder="Frontend, Backend, Security, UI/UX" required type="text" value="${escapeHtml(member.role || (index === 0 ? 'Ketua Tim' : ''))}"></label><label class="wide team-member-consent"><input data-team-member-consent required type="checkbox" ${member.consent ? 'checked' : ''}><span>Saya memastikan anggota ini mengetahui dan menyetujui pendaftaran serta penggunaan datanya untuk operasional kompetisi.</span></label></div></fieldset>`;
  }).join('');
  teamMemberEditor.querySelectorAll('input').forEach((input) => input.addEventListener('input', updateProgress));
  updateProgress();
};

const collectTeamMembers = () => [...teamMemberEditor.querySelectorAll('[data-member-index]')].map((card) => ({
  ...Object.fromEntries([...card.querySelectorAll('[data-team-member]')].map((input) => [input.dataset.teamMember, input.value.trim()])),
  consent: card.querySelector('[data-team-member-consent]')?.checked === true
}));

const getProgressFields = (scope) => {
  if (!scope) return [];
  return [...new Set([...scope.querySelectorAll('[required]:not(:disabled)'), ...scope.querySelectorAll('[data-progress-required]:not(:disabled)')])];
};
const hasValue = (field) => {
  if (field === paymentProofInput) return Boolean(paymentProofData) && !paymentProofBusy;
  if (field.type === 'checkbox') return field.checked;
  return Boolean(String(field.value || '').trim());
};
const updateProgress = () => {
  const requiredFields = getProgressFields(registrationForm);
  const completeFields = requiredFields.filter(hasValue).length;
  const progress = requiredFields.length ? Math.round((completeFields / requiredFields.length) * 100) : 0;
  progressBar.style.width = `${progress}%`;
  progressText.textContent = progress === 100 ? 'Semua data wajib sudah lengkap. Periksa kembali sebelum dikirim.' : `${progress}% data wajib telah dilengkapi.`;
  const sectionState = {
    identity: getProgressFields(registrationForm.querySelector('[data-section="identity"]')),
    package: getProgressFields(registrationForm.querySelector('[data-section="package"]')),
    payment: getProgressFields(registrationForm.querySelector('[data-section="payment"]'))
  };
  const firstIncomplete = Object.entries(sectionState).find(([, fields]) => fields.some((field) => !hasValue(field)))?.[0];
  formSteps.forEach((step) => {
    const fields = sectionState[step.dataset.formStep] || [];
    const section = registrationForm.querySelector(`[data-section="${step.dataset.formStep}"]`);
    const complete = fields.length && fields.every(hasValue);
    step.classList.toggle('complete', complete);
    step.classList.toggle('active', !complete && (section?.contains(document.activeElement) || step.dataset.formStep === firstIncomplete));
  });
};

const updatePackage = () => {
  const selected = packageData[packageSelect.value] || packageData.web;
  const isTeam = packageSelect.value === 'team';
  document.body.dataset.packageTheme = selected.theme;
  nominalDisplay.value = selected.amount;
  nominalTicket.value = selected.amount;
  teamFields.hidden = !isTeam;
  teamRequiredFields.forEach((field) => { field.disabled = !isTeam; if (!isTeam) field.closest('[data-custom-select]')?.classList.remove('invalid'); });
  teamMemberEditor.querySelectorAll('input').forEach((field) => { field.disabled = !isTeam; });
  selectedPackageCard.querySelector('strong').textContent = selected.label;
  selectedPackageCard.querySelector('span').textContent = `${selected.amount} · ${selected.meta}`;
  if (activePeriod) {
    const packageConfig = activePeriod.packages?.[packageSelect.value] || {};
    const currentWaveConfig = packageConfig.waves?.[waveSelect.value] || activePeriod.waves?.[waveSelect.value];
    if (!currentWaveConfig || currentWaveConfig.enabled === false) {
      const now = Date.now() + serverClockOffset;
      const fallbackWave = ['wave-01', 'wave-02'].find((waveId) => {
        const wave = packageConfig.waves?.[waveId] || activePeriod.waves?.[waveId];
        return wave?.enabled !== false
          && Number(wave.registrationOpenAt || activePeriod.registrationOpenAt || 0) <= now
          && Number(wave.registrationCloseAt || activePeriod.registrationCloseAt || 0) >= now;
      });
      if (fallbackWave) setCustomValue(waveSelect, fallbackWave, true);
    }
  }
  updateAvailabilityForPeriod();
  updateProgress();
};

const updateAvailabilityForPeriod = () => {
  const now = Date.now() + serverClockOffset;
  const periodOpenAt = Number(activePeriod?.registrationOpenAt || 0);
  const periodCloseAt = Number(activePeriod?.registrationCloseAt || 0);
  const submitAllowed = Boolean(activePeriod)
    && acceptingRegistrations
    && activePeriod.status === 'open'
    && periodOpenAt <= now
    && periodCloseAt >= now;
  const selectedPackage = activePeriod?.packages?.[packageSelect.value] || null;
  const packageOpen = Boolean(selectedPackage) && selectedPackage.enabled !== false;
  const waveConfigFor = (waveId) => selectedPackage?.waves?.[waveId] || activePeriod?.waves?.[waveId] || null;
  const selectedWave = waveConfigFor(waveSelect.value);
  const waveIsOpen = (wave) => Boolean(wave)
    && wave.enabled !== false
    && Number(wave.registrationOpenAt || activePeriod?.registrationOpenAt || 0) <= now
    && Number(wave.registrationCloseAt || activePeriod?.registrationCloseAt || 0) >= now;
  const waveOpen = waveIsOpen(selectedWave);

  document.querySelectorAll('#wave-options [data-value]').forEach((option) => {
    const config = waveConfigFor(option.dataset.value);
    const available = submitAllowed && packageOpen && waveIsOpen(config);
    option.disabled = !available;
    option.setAttribute('aria-disabled', String(!available));
    option.dataset.windowState = !config || config.enabled === false ? 'disabled' : (available ? 'open' : 'closed');
    const note = option.querySelector('small');
    if (note && config) {
      const opensAt = Number(config.registrationOpenAt || activePeriod?.registrationOpenAt || 0);
      const closesAt = Number(config.registrationCloseAt || activePeriod?.registrationCloseAt || 0);
      note.textContent = available
        ? `Daftar s.d. ${formatWib(closesAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`
        : (!submitAllowed ? 'Pendaftaran periode ditutup' : now < opensAt ? `Dibuka ${formatWib(opensAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}` : 'Masa pendaftaran berakhir');
    }
  });

  // Jika periode berubah menjadi tertutup, jangan biarkan gelombang lama terlihat terpilih.
  const selectedOption = [...document.querySelectorAll('#wave-options [data-value]')]
    .find((option) => option.dataset.value === waveSelect.value);
  if (waveSelect.value && (!selectedOption || selectedOption.disabled)) {
    waveSelect.value = '';
    const component = waveSelect.closest('[data-custom-select]');
    const selectedLabel = component?.querySelector('[data-selected-label]');
    if (selectedLabel) {
      selectedLabel.textContent = 'Pilih gelombang saat dibuka';
      selectedLabel.removeAttribute('title');
    }
    component?.querySelector('.custom-select-trigger')?.classList.add('is-placeholder');
    component?.querySelectorAll('[role="option"]').forEach((option) => option.setAttribute('aria-selected', 'false'));
  }
  const key = `${packageSelect.value}_${waveSelect.value}`;
  const capacity = Number(activePeriod?.capacities?.[key] ?? 0);
  const used = Number(activePeriod?.counts?.[key] ?? 0);
  const full = Boolean(waveSelect.value) && capacity > 0 && used >= capacity;
  submitButton.disabled = !submitAllowed || !packageOpen || !waveOpen || full || submitting;

  if (!submitAllowed) {
    setFormAlert('Pendaftaran sedang ditutup. Pantau jadwal pembukaan gelombang berikutnya di halaman utama.', 'notice');
    formAlert.dataset.source = 'availability';
  } else if (!packageOpen && packageSelect.value) {
    setFormAlert('Kategori ini belum tersedia pada periode yang dipilih. Coba kategori lain.', 'notice');
    formAlert.dataset.source = 'availability';
  } else if (full) {
    setFormAlert(`Slot ${packageData[packageSelect.value]?.label || 'kategori'} pada gelombang ini sudah penuh.`, 'notice');
    formAlert.dataset.source = 'availability';
  } else if (waveSelect.value && selectedWave && !waveOpen) {
    setFormAlert('Pendaftaran untuk gelombang ini belum dibuka atau sudah ditutup. Pilih gelombang yang masih tersedia.', 'notice');
    formAlert.dataset.source = 'availability';
  } else if (formAlert.dataset.source === 'availability') {
    setFormAlert('');
    delete formAlert.dataset.source;
  }
};

const updateCountdown = () => {
  window.clearInterval(countdownTimer);
  const formatDuration = (milliseconds) => {
    const days = Math.floor(milliseconds / 86400000);
    const hours = Math.floor((milliseconds % 86400000) / 3600000);
    const minutes = Math.max(0, Math.floor((milliseconds % 3600000) / 60000));
    return days ? `${days} hari ${hours} jam` : `${hours} jam ${minutes} menit`;
  };
  const render = () => {
    const now = Date.now() + serverClockOffset;
    if (!activePeriod || !acceptingRegistrations || activePeriod.status !== 'open') {
      countdownHeading.textContent = 'STATUS PENDAFTARAN';
      countdown.textContent = 'Pendaftaran ditutup';
      periodBanner.dataset.state = 'closed';
      updateAvailabilityForPeriod();
      return;
    }
    const windows = Object.values(activePeriod.packages || {}).flatMap((category) => {
      if (category.enabled === false) return [];
      return Object.values(category.waves || {}).filter((wave) => wave.enabled !== false)
        .map((wave) => ({
          starts: Number(wave.registrationOpenAt || 0),
          ends: Number(wave.registrationCloseAt || 0)
        })).filter((window) => window.starts > 0 && window.ends > window.starts);
    });
    const open = windows.filter((window) => window.starts <= now && now <= window.ends);
    if (open.length) {
      const closestDeadline = Math.min(...open.map((window) => window.ends));
      countdownHeading.textContent = 'BATAS PENDAFTARAN';
      countdown.textContent = `${formatDuration(closestDeadline - now)} tersisa`;
      periodBanner.dataset.state = 'open';
    } else {
      const future = windows.filter((window) => window.starts > now).sort((x, y) => x.starts - y.starts)[0];
      if (future) {
        countdownHeading.textContent = 'PENDAFTARAN DIBUKA DALAM';
        countdown.textContent = formatDuration(future.starts - now);
        periodBanner.dataset.state = 'upcoming';
      } else {
        countdownHeading.textContent = 'STATUS PENDAFTARAN';
        countdown.textContent = 'Pendaftaran ditutup';
        periodBanner.dataset.state = 'closed';
      }
    }
    updateAvailabilityForPeriod();
  };
  render();
  countdownTimer = window.setInterval(render, 30000);
};

const hydratePeriodSlots = (period, slots = []) => {
  if (!period) return null;
  const counts = { ...(period.counts || {}) };
  const capacities = { ...(period.capacities || {}) };
  slots.forEach((slot) => {
    const key = `${slot.package}_${slot.wave}`;
    counts[key] = Number(slot.count || 0);
    capacities[key] = Number(slot.capacity ?? capacities[key] ?? 0);
  });
  return { ...period, counts, capacities };
};

const renderPeriodContext = () => {
  if (!activePeriod) {
    periodInput.value = '';
    periodLabel.textContent = 'Belum ada periode pendaftaran aktif';
    countdownHeading.textContent = 'STATUS PENDAFTARAN';
    countdown.textContent = 'Belum dibuka';
    periodBanner.dataset.state = 'closed';
    setFormAlert('Panitia belum membuka periode pendaftaran. Form tetap dapat dilihat, tetapi belum dapat dikirim.', 'notice');
    updateAvailabilityForPeriod();
    return;
  }

  periodInput.value = activePeriod.id;
  periodLabel.textContent = activePeriod.label || activePeriod.id;
  Object.entries(packageData).forEach(([key, item]) => {
    const config = activePeriod.packages?.[key];
    if (config) {
      item.label = config.label || item.label;
      item.amount = config.amountLabel || item.amount;
    }
    const option = document.querySelector(`#package-options [data-value="${key}"]`);
    if (option) {
      option.disabled = config?.enabled === false;
      option.setAttribute('aria-disabled', String(config?.enabled === false));
    }
  });

  const firstEnabledPackage = Object.keys(packageData).find((key) => activePeriod.packages?.[key]?.enabled !== false);
  if (firstEnabledPackage && activePeriod.packages?.[packageSelect.value]?.enabled === false) {
    setCustomValue(packageSelect, firstEnabledPackage, true);
  }
  const nowWithOffset = Date.now() + serverClockOffset;
  const selectedPackageConfig = activePeriod.packages?.[packageSelect.value] || {};
  const firstOpenWave = ['wave-01', 'wave-02'].find((key) => {
    const wave = selectedPackageConfig.waves?.[key] || activePeriod.waves?.[key];
    return wave?.enabled !== false
      && Number(wave.registrationOpenAt || activePeriod.registrationOpenAt || 0) <= nowWithOffset
      && Number(wave.registrationCloseAt || activePeriod.registrationCloseAt || 0) >= nowWithOffset;
  });
  if (firstOpenWave && !waveSelect.value) setCustomValue(waveSelect, firstOpenWave, true);
  if (!acceptingRegistrations && formAlert.dataset.source !== 'availability') {
    const opensAt = Number(activePeriod.registrationOpenAt || 0);
    const message = nowWithOffset < opensAt
      ? `Pendaftaran belum dibuka. Jadwal pembukaan: ${formatWib(opensAt, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}.`
      : 'Periode pendaftaran sedang ditutup oleh panitia.';
    setFormAlert(message, 'notice');
  }
  updateCountdown();
  updatePackage();
};

const loadPeriod = async () => {
  const version = periodContextVersion;
  try {
    periodBanner.dataset.state = 'loading';
    const response = await getRegistrationContext();
    if (version !== periodContextVersion) return;
    serverClockOffset = Number(response.data.serverNow || Date.now()) - Date.now();
    registrationSystem = response.data.system || null;
    acceptingRegistrations = response.data.accepting === true;
    activePeriod = hydratePeriodSlots(response.data.period || null, []);
    if (transferDateInput) transferDateInput.max = localToday();
    renderPeriodContext();
  } catch (error) {
    if (version !== periodContextVersion) return;
    periodLabel.textContent = 'Periode gagal dimuat';
    periodBanner.dataset.state = 'closed';
    setFormAlert(friendlyFirebaseError(error));
  }
};

const applyLivePeriod = (detail = {}) => {
  periodContextVersion += 1;
  const offset = Number(detail.serverClockOffset);
  if (Number.isFinite(offset)) serverClockOffset = offset;
  registrationSystem = detail.system || null;
  activePeriod = hydratePeriodSlots(detail.period || null, detail.slots || []);
  const now = Date.now() + serverClockOffset;
  acceptingRegistrations = registrationSystem?.acceptingRegistrations === true
    && Boolean(activePeriod)
    && activePeriod.status === 'open'
    && Number(activePeriod.registrationOpenAt || 0) <= now
    && Number(activePeriod.registrationCloseAt || 0) >= now;
  if (transferDateInput) transferDateInput.max = localToday();
  renderPeriodContext();
};
window.addEventListener('esoria:registration-status', (event) => applyLivePeriod(event.detail));

const draftPayload = () => {
  const data = new FormData(registrationForm);
  return {
    package: packageSelect.value,
    wave: waveSelect.value,
    skillStack: String(data.get('skill_stack') || ''),
    portfolioUrl: String(data.get('portfolio_url') || ''),
    teamName: String(data.get('nama_tim') || ''),
    memberCount: String(data.get('jumlah_anggota') || ''),
    teamMembers: collectTeamMembers(),
    transferDate: String(data.get('tanggal_transfer') || ''),
    senderName: String(data.get('nama_pengirim') || ''),
    senderInstitution: String(data.get('bank_pengirim') || ''),
    notes: String(data.get('catatan') || ''),
    savedAt: Date.now()
  };
};
let cloudDraftRevision = 0;
let cloudDraftReady = false;
let cloudDraftPending = null;
let cloudDraftQueued = false;
let cloudDraftTimer = 0;
let cloudDraftConflict = false;
let cloudRestoring = false;
const cloudDraftStatus = document.querySelector('#registration-draft-status');
const updateDraftNotice = (message, state = 'ready') => {
  if (!cloudDraftStatus) return;
  cloudDraftStatus.dataset.state = state;
  const symbol = cloudDraftStatus.querySelector('.registration-draft-icon');
  if (symbol) symbol.textContent = ({saving:'…',warning:'!',saved:'✓',ready:'i',loading:'…'})[state] || 'i';
  const copy = cloudDraftStatus.querySelector('.registration-draft-copy');
  if (copy) copy.textContent = message;
};
const saveAccountDraft = async () => {
  if (!cloudDraftReady || cloudDraftConflict || submitting) return;
  // Do not start parallel writes with the same expectedRevision. A new edit
  // while a save is in flight is queued and saved after its revision arrives.
  if (cloudDraftPending) { cloudDraftQueued = true; return; }
  const snapshot = draftPayload();
  updateDraftNotice('Menyimpan isian pendaftaran…', 'saving');
  const request = accountApi('saveRegistrationDraft', {draft: snapshot, expectedRevision: cloudDraftRevision});
  cloudDraftPending = request;
  try {
    const data = await request;
    cloudDraftRevision = data.revision;
    updateDraftNotice('Isian tersimpan hingga 14 hari. Kuota belum dipesan; unggah ulang bukti pembayaran saat mengirim.', 'saved');
  } catch (error) {
    cloudDraftConflict = String(error.code || '').endsWith('aborted');
    updateDraftNotice(cloudDraftConflict ? 'Draft berubah di perangkat lain. Muat ulang untuk sinkronisasi.' : 'Isian belum tersimpan. Periksa koneksi sebelum meninggalkan halaman.', 'warning');
  } finally {
    if (cloudDraftPending === request) cloudDraftPending = null;
    if (cloudDraftQueued) {
      cloudDraftQueued = false;
      if (!cloudDraftConflict && !submitting) queueAccountDraft();
    }
  }
};
const queueAccountDraft = () => {
  if (cloudRestoring) return;
  window.clearTimeout(cloudDraftTimer);
  cloudDraftTimer = window.setTimeout(() => void saveAccountDraft(), 1200);
};
let draftTimer = 0;
let draftRestored = false;
const functionalStorageAllowed = () => window.esoriaCookiePreferences?.functional === true;
const saveDraft = () => {
  if (cloudRestoring) return;
  formDirty = true;
  queueAccountDraft();
  window.clearTimeout(draftTimer);
  if (!functionalStorageAllowed()) {
    localStore.removeItem(DRAFT_KEY);
    return;
  }
  draftTimer = window.setTimeout(() => {
    if (functionalStorageAllowed()) localStore.setItem(DRAFT_KEY, JSON.stringify(draftPayload()));
  }, 350);
};
const restoreDraft = () => {
  if (draftRestored || !functionalStorageAllowed()) return;
  try {
    const draft = JSON.parse(localStore.getItem(DRAFT_KEY) || 'null');
    if (!draft || Date.now() - draft.savedAt > 14 * 86400000) return;
    if (draft.package && packageData[draft.package]) setCustomValue(packageSelect, draft.package, true);
    if (draft.wave && !document.querySelector(`#wave-options [data-value="${draft.wave}"]`)?.disabled) setCustomValue(waveSelect, draft.wave, true);
    const fields = { skill_stack: draft.skillStack, portfolio_url: draft.portfolioUrl, nama_tim: draft.teamName, tanggal_transfer: draft.transferDate, nama_pengirim: draft.senderName, bank_pengirim: draft.senderInstitution, catatan: draft.notes };
    Object.entries(fields).forEach(([name, value]) => { const field = registrationForm.elements.namedItem(name); if (field && value) { field.value = value; if (name === 'bank_pengirim') field.dispatchEvent(new Event('esoria:paper-select-sync')); if (name === 'tanggal_transfer') field.dispatchEvent(new Event('esoria:paper-date-sync')); } });
    if (draft.memberCount) { setCustomValue(memberCountInput, draft.memberCount, true); renderTeamMembers(Number(draft.memberCount), draft.teamMembers || []); }
    setFormAlert('Draft form dari perangkat ini berhasil dipulihkan. Bukti transfer perlu dipilih kembali.', 'notice');
    formDirty = false;
    draftRestored = true;
  } catch { localStore.removeItem(DRAFT_KEY); }
};

window.addEventListener('esoria:cookie-consent', (event) => {
  if (event.detail?.functional === true) restoreDraft();
  else {
    window.clearTimeout(draftTimer);
    localStore.removeItem(DRAFT_KEY);
  }
});

const validateTeam = () => {
  if (packageSelect.value !== 'team') return true;
  const members = collectTeamMembers();
  const expected = Number(memberCountInput.value);
  if (members.length !== expected || expected < 2 || expected > 4) { setFormAlert('Lengkapi data 2–4 anggota tim.'); return false; }
  const emails = members.map((member) => member.email.toLowerCase());
  if (emails[0] !== String(user.email || '').toLowerCase()) { setFormAlert('Email ketua tim harus sama dengan email akun yang sedang masuk.'); return false; }
  if (new Set(emails).size !== emails.length) { setFormAlert('Email anggota tim tidak boleh ganda.'); return false; }
  return true;
};

const validateForm = () => {
  const missingCustom = [...registrationForm.querySelectorAll('[data-custom-required]:not(:disabled)')].find((field) => !field.value);
  if (missingCustom) {
    const component = missingCustom.closest('[data-custom-select]'); component?.classList.add('invalid'); component?.querySelector('.custom-select-trigger')?.focus();
    setFormAlert('Pilih gelombang dan lengkapi pilihan tim sebelum mengirim pendaftaran.'); return false;
  }
  if (!activePeriod || activePeriod.status !== 'open' || !acceptingRegistrations) {
    setFormAlert('Periode pendaftaran belum tersedia, belum dibuka, atau sudah ditutup.');
    return false;
  }
  updateAvailabilityForPeriod();
  if (submitButton.disabled && !submitting) {
    setFormAlert('Kategori atau gelombang yang dipilih sedang tidak tersedia atau kuotanya sudah penuh.');
    return false;
  }
  if (paymentProofBusy) { setFormAlert('Tunggu hingga screenshot selesai diproses.'); return false; }
  if (!paymentProofData) { paymentProofInput.setCustomValidity('Pilih screenshot bukti transfer terlebih dahulu.'); paymentProofDropzone.classList.add('is-invalid'); paymentProofInput.reportValidity(); setFormAlert('Lampirkan screenshot bukti transfer.'); return false; }
  if (!validateTeam()) return false;
  if (!registrationForm.checkValidity()) { registrationForm.reportValidity(); setFormAlert('Lengkapi seluruh data wajib dengan format yang benar.'); return false; }
  return true;
};

const openReview = () => {
  const data = new FormData(registrationForm);
  const selectedPackage = packageData[packageSelect.value];
  const waveLabel = document.querySelector('#wave-options [aria-selected="true"]')?.dataset.label || '';
  const members = collectTeamMembers();
  reviewContent.innerHTML = [
    ['Periode', activePeriod.label], ['Peserta', accountName], ['Kategori', selectedPackage.label], ['Biaya', selectedPackage.amount], ['Gelombang', waveLabel],
    ['Skill utama', data.get('skill_stack')], ['Transfer', `${data.get('tanggal_transfer')} · ${data.get('nama_pengirim')} · ${data.get('bank_pengirim')}`],
    ...(packageSelect.value === 'team' ? [['Tim', `${data.get('nama_tim')} · ${members.length} anggota`], ['Anggota', members.map((member) => `${member.name} (${member.role})`).join(', ')]] : [])
  ].map(([label, value]) => `<span class="${['Periode', 'Skill utama', 'Transfer', 'Tim', 'Anggota'].includes(label) ? 'review-wide-mobile' : ''}"><small>${escapeHtml(label)}</small><b>${escapeHtml(value || '—')}</b></span>`).join('');
  if (typeof reviewDialog.showModal === 'function') reviewDialog.showModal(); else reviewDialog.setAttribute('open', '');
};
const closeReview = () => { if (typeof reviewDialog.close === 'function') reviewDialog.close(); else reviewDialog.removeAttribute('open'); };
document.querySelectorAll('[data-registration-review-close]').forEach((button) => button.addEventListener('click', closeReview));

const performSubmit = async () => {
  if (submitting || !validateForm()) return;
  closeReview();
  submitting = true;
  setFormAlert('');
  submitButton.disabled = true;
  confirmSubmit.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  submitButton.querySelector('span').textContent = 'Mengamankan slot…';
  uploadProgress.hidden = false;
  uploadProgressBar.style.width = '35%';
  setPaymentProofStatus('Mengunggah bukti transfer melalui koneksi aman…', 'uploading');

  const data = new FormData(registrationForm);
  const periodId = activePeriod.id;
  const packageId = packageSelect.value;
  const waveId = waveSelect.value;
  const requireSameMember = () => {
    if (auth.currentUser?.uid !== user.uid) {
      const error = new Error('Sesi akun berubah selama pendaftaran. Masuk kembali dan periksa status sebelum mencoba ulang.');
      error.code = 'functions/unauthenticated';
      throw error;
    }
  };
  try {
    const response = await submitRegistration({
      periodId,
      package: packageId,
      wave: waveId,
      skillStack: String(data.get('skill_stack') || '').trim(),
      portfolioUrl: String(data.get('portfolio_url') || '').trim(),
      teamName: packageId === 'team' ? String(data.get('nama_tim') || '').trim() : '',
      teamMembers: packageId === 'team' ? collectTeamMembers() : [],
      transferDate: String(data.get('tanggal_transfer') || ''),
      senderName: String(data.get('nama_pengirim') || '').trim(),
      senderInstitution: String(data.get('bank_pengirim') || '').trim(),
      notes: String(data.get('catatan') || '').trim(),
      proof: paymentProofData
    });
    requireSameMember();
    uploadProgressBar.style.width = '100%';
    setPaymentProofStatus('Bukti transfer dan pendaftaran berhasil disimpan.', 'ready');
    window.clearTimeout(cloudDraftTimer);
    if (cloudDraftPending) await cloudDraftPending.catch(() => {});
    requireSameMember();
    await accountApi('clearRegistrationDraft', {expectedRevision: cloudDraftRevision}).catch(() => {});
    requireSameMember();
    localStore.removeItem(DRAFT_KEY);
    sessionStore.setItem('esoria-last-registration', JSON.stringify(response.data));
    sessionStore.setItem('esoria-pending-notification-toast', JSON.stringify({
      title: 'Pendaftaran berhasil dikirim',
      message: 'Data dan bukti pembayaran sudah masuk ke panel panitia.',
      type: 'registration'
    }));
    formDirty = false;
    location.assign(`pendaftaran-berhasil.html?id=${encodeURIComponent(response.data.registrationId)}`);
  } catch (error) {
    const code = String(error?.code || '').replace(/^functions\//, '');
    const message = code === 'permission-denied'
      ? 'Pendaftaran ditolak karena izin akun. Pastikan kamu masuk sebagai Member ESORIA yang aktif, bukan Administrator. Jika akun sudah benar, masuk ulang lalu coba lagi; hubungi pengelola jika tetap gagal.'
      : friendlyFirebaseError(error);
    setFormAlert(message);
    setPaymentProofStatus('Pendaftaran belum berhasil. Periksa pesan kesalahan sebelum mencoba kembali.', 'error');
    submitting = false;
    submitButton.disabled = false;
    confirmSubmit.disabled = false;
    submitButton.setAttribute('aria-busy', 'false');
    submitButton.querySelector('span').textContent = 'Kirim Pendaftaran';
    uploadProgress.hidden = true;
    uploadProgressBar.style.width = '0%';
    updateAvailabilityForPeriod();
  }
};

registrationForm.addEventListener('input', () => { updateProgress(); saveDraft(); });
registrationForm.addEventListener('change', () => { updateProgress(); saveDraft(); });
registrationForm.addEventListener('focusin', updateProgress);
registrationForm.addEventListener('submit', (event) => { event.preventDefault(); if (validateForm()) openReview(); });
confirmSubmit.addEventListener('click', performSubmit);

packageSelect.addEventListener('change', updatePackage);
waveSelect.addEventListener('change', updateAvailabilityForPeriod);
memberCountInput.addEventListener('change', () => renderTeamMembers(Number(memberCountInput.value)));

const requestedPackage = new URLSearchParams(location.search).get('paket');
if (requestedPackage && packageData[requestedPackage]) setCustomValue(packageSelect, requestedPackage);

document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(button.dataset.copy); const original = button.textContent; button.textContent = 'Tersalin ✓'; setTimeout(() => { button.textContent = original; }, 1600); }
  catch { button.textContent = button.dataset.copy; }
}));

const sensitiveGroups = new Map();
document.querySelectorAll('[data-sensitive-cluster]').forEach((element) => {
  const group = element.dataset.sensitiveCluster;
  if (!sensitiveGroups.has(group)) sensitiveGroups.set(group, []);
  sensitiveGroups.get(group).push(element);
});

const sensitiveToggles = [...document.querySelectorAll('[data-sensitive-toggle]')];
const syncSensitiveGroup = (group, hidden) => {
  sensitiveGroups.get(group)?.forEach((element) => element.classList.toggle('is-hidden', hidden));
  sensitiveToggles.filter((button) => button.dataset.sensitiveToggle === group).forEach((button) => {
    button.setAttribute('aria-pressed', String(!hidden));
    button.textContent = hidden ? 'Tampilkan detail' : 'Sembunyikan detail';
  });
};

sensitiveToggles.forEach((button) => button.addEventListener('click', () => {
  const group = button.dataset.sensitiveToggle;
  const isHidden = sensitiveGroups.get(group)?.[0]?.classList.contains('is-hidden');
  syncSensitiveGroup(group, !isHidden);
}));

for (const group of sensitiveGroups.keys()) syncSensitiveGroup(group, true);

document.addEventListener('click', async (event) => {
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || url.pathname === location.pathname || !formDirty || submitting) return;
  event.preventDefault();
  if (await paperConfirm({ title: 'Tinggalkan formulir?', message: functionalStorageAllowed()
    ? 'Isian yang belum dikirim dicadangkan jika penyimpanan perangkat tersedia. Bukti transfer perlu dipilih kembali saat melanjutkan.'
    : 'Isian yang belum dikirim akan hilang karena penyimpanan draft belum diizinkan. Tetap tinggalkan formulir?', confirmText: 'Tinggalkan formulir', danger: false })) {
    formDirty = false;
    location.assign(url.href);
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!formDirty || submitting) return;
  event.preventDefault();
  event.returnValue = '';
});

restoreDraft();
updatePackage();
updateProgress();
if (window.esoriaRegistrationContext) applyLivePeriod(window.esoriaRegistrationContext);
else await loadPeriod();

// Account-scoped drafts complement the consent-based local backup. No proof is persisted in a draft.
try {
  const saved = await accountApi('getRegistrationDraft');
  cloudDraftRevision = saved.revision || 0;
  cloudDraftReady = true;
  let localSavedAt = 0;
  if (functionalStorageAllowed()) {
    try {localSavedAt = JSON.parse(localStore.getItem(DRAFT_KEY) || 'null')?.savedAt || 0;} catch { /* ignored */ }
  }
  if (saved.draft && !formDirty && saved.savedAt > localSavedAt) {
    cloudRestoring = true;
    const draft = saved.draft;
    if (draft.package && packageData[draft.package]) setCustomValue(packageSelect, draft.package, true);
    if (draft.wave && !document.querySelector(`#wave-options [data-value="${draft.wave}"]`)?.disabled) setCustomValue(waveSelect, draft.wave, true);
    const fields = {skill_stack: draft.skillStack, portfolio_url: draft.portfolioUrl, nama_tim: draft.teamName, tanggal_transfer: draft.transferDate, nama_pengirim: draft.senderName, bank_pengirim: draft.senderInstitution, catatan: draft.notes};
    Object.entries(fields).forEach(([name, value]) => {const field = registrationForm.elements.namedItem(name); if (field && value) {field.value = value; if (name === 'bank_pengirim') field.dispatchEvent(new Event('esoria:paper-select-sync')); if (name === 'tanggal_transfer') field.dispatchEvent(new Event('esoria:paper-date-sync'));}});
    if (draft.memberCount) {setCustomValue(memberCountInput, draft.memberCount, true); renderTeamMembers(Number(draft.memberCount), draft.teamMembers || []);}
    cloudRestoring = false;
    formDirty = false;
    updateProgress();
    updateDraftNotice('Isian sebelumnya dipulihkan. Periksa periode dan pilih kembali bukti pembayaran.', 'saved');
  } else if (formDirty) queueAccountDraft();
  else updateDraftNotice('Isian disimpan otomatis hingga 14 hari. Kuota baru dipesan setelah pendaftaran dikirim.', 'ready');
} catch {
  updateDraftNotice('Draft belum dapat dimuat. Isi formulir lalu pastikan tersimpan sebelum keluar.', 'warning');
}
