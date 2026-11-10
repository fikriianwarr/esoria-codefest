import { signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js?v=b74586eaa5ef6110';
// Installs the profile push toggle; no unused function binding is required.
import './push-notifications.js?v=b74586eaa5ef6110';
import { initProfilePhoto } from './profile-photo.js?v=b74586eaa5ef6110';
import { wibDateValue } from './time-utils.js?v=b74586eaa5ef6110';
import {
  replacePaymentProof,
  saveParticipantProfile,
  submitProfileEditRequest
} from './spark-data.js?v=b74586eaa5ef6110';
import {
  calculateAge,
  formatTimestamp,
  friendlyFirebaseError,
  profileName,
  requireAuthenticated,
  safeNextPath
} from './auth-core.js?v=b74586eaa5ef6110';

const { user, profile } = await requireAuthenticated({
  verifiedEmailRequired: true,
  profileReadOptimized: true
});
const form = document.querySelector('#profile-form');
const alertBox = document.querySelector('#profile-alert');
const ageInput = document.querySelector('#profile-age');
const birthInput = document.querySelector('#profile-birth-date');
const phoneInput = form.elements.namedItem('phone');
const saveButton = document.querySelector('#profile-save');
const saveState = document.querySelector('#profile-save-state');
const saveTitle = document.querySelector('#profile-save-title');
const editButton = document.querySelector('#profile-edit');
const lockBanner = document.querySelector('#profile-lock-banner');
const requestDialog = document.querySelector('#profile-request-dialog');
const requestForm = document.querySelector('#profile-request-form');
const requestReason = document.querySelector('#profile-request-reason');
const requestDialogTitle = document.querySelector('#profile-request-title');
const requestDialogText = document.querySelector('#profile-request-text');
const requestStatusPanel = document.querySelector('#profile-request-status');
const requestSubmitButton = document.querySelector('#profile-request-submit');
const saveConfirmDialog = document.querySelector('#profile-save-confirm-dialog');
const saveConfirmTitle = document.querySelector('#profile-save-confirm-title');
const saveConfirmText = document.querySelector('#profile-save-confirm-text');
const saveConfirmAction = document.querySelector('#profile-save-confirm-action');
const customSelects = [...document.querySelectorAll('[data-profile-select]')];
const requiredFields = [...form.querySelectorAll('[required]')];
const nextPath = safeNextPath(new URLSearchParams(window.location.search).get('next'), 'form-pendaftaran.html');
let savingProfile = false;
let requestingEdit = false;
let profileIsComplete = profile?.profileComplete === true;
let profileRequest = null;
let formLocked = profileIsComplete;
let pendingSaveConfirmation = null;
let profileFormTouched = false;
let liveProfile = profile;
const profilePhoto = initProfilePhoto({
  user,
  onSaved(photo) {
    if (Number(photo.photoVersion || 0) >= Number(liveProfile?.photoVersion || 0)) {
      liveProfile = { ...liveProfile, ...photo };
    }
    updateProfileSummary(liveProfile);
    return liveProfile;
  }
});

const localDateValue = wibDateValue;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

const showDialog = (dialog) => {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
};
const closeDialog = (dialog) => {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
};

const setAlert = (message = '', type = 'error') => {
  alertBox.hidden = !message;
  alertBox.textContent = message;
  alertBox.dataset.type = type;
};

const normalizeIndonesianPhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '+62';
  const subscriber = digits.startsWith('62')
    ? digits.slice(2)
    : (digits.startsWith('0') ? digits.slice(1) : digits);
  return `+62${subscriber.slice(0, 13)}`;
};

const requiredIssueCount = () => {
  const nativeIssues = requiredFields.filter((field) => (
    !String(field.value || '').trim() || !field.checkValidity()
  )).length;
  const customIssues = customSelects.filter((component) => (
    !component.querySelector('[data-custom-input]').value
  )).length;
  return nativeIssues + customIssues;
};

const requestStatusLabel = (status) => ({
  pending: 'Menunggu keputusan panitia',
  approved: 'Disetujui — akses edit terbuka',
  rejected: 'Permintaan ditolak',
  completed: 'Perubahan sudah disimpan'
})[status] || 'Belum ada permintaan';

function setFormLocked(locked) {
  formLocked = locked;
  form.classList.toggle('profile-form-locked', locked);
  form.querySelectorAll('input, textarea, button.custom-select-trigger').forEach((field) => {
    if (field === saveButton || field.type === 'hidden' || field.name === 'email' || field.id === 'profile-age') return;
    field.disabled = locked;
  });
  customSelects.forEach((component) => component.classList.toggle('is-disabled', locked));
  updateCityTrigger();
}

function updateProfileAccessState() {
  const status = profileRequest?.status || 'none';
  const approved = profileIsComplete && status === 'approved';
  setFormLocked(profileIsComplete && !approved);

  if (!profileIsComplete) {
    editButton.querySelector('span').textContent = 'Lengkapi Profil';
    editButton.dataset.state = 'initial';
    lockBanner.dataset.state = 'initial';
    lockBanner.innerHTML = '<b>DATA BELUM DIKUNCI</b><span>Lengkapi profil lalu periksa kembali sebelum penyimpanan pertama.</span>';
    saveTitle.textContent = 'Simpan dan kunci profil Anda.';
  } else if (approved) {
    editButton.querySelector('span').textContent = 'Lanjut Edit';
    editButton.dataset.state = 'approved';
    lockBanner.dataset.state = 'approved';
    lockBanner.innerHTML = '<b>AKSES EDIT DISETUJUI</b><span>Perbarui data sekarang. Setelah disimpan, profil otomatis dikunci kembali.</span>';
    saveTitle.textContent = 'Simpan perubahan dan kunci kembali.';
  } else if (status === 'pending') {
    editButton.querySelector('span').textContent = 'Menunggu Panitia';
    editButton.dataset.state = 'pending';
    lockBanner.dataset.state = 'pending';
    lockBanner.innerHTML = '<b>PERMINTAAN SEDANG DIPERIKSA</b><span>Identitasmu tetap tersimpan seperti sebelumnya sampai panitia menyetujui perubahan.</span>';
    saveTitle.textContent = 'Profil utama sedang dikunci.';
  } else if (status === 'rejected') {
    editButton.querySelector('span').textContent = 'Ajukan Ulang';
    editButton.dataset.state = 'rejected';
    lockBanner.dataset.state = 'rejected';
    lockBanner.innerHTML = `<b>PERMINTAAN BELUM DISETUJUI</b><span>${escapeHtml(profileRequest.reviewNote || 'Baca catatan panitia sebelum mengajukan kembali.')}</span>`;
    saveTitle.textContent = 'Profil utama tetap dikunci.';
  } else {
    editButton.querySelector('span').textContent = 'Ajukan Perubahan';
    editButton.dataset.state = 'locked';
    lockBanner.dataset.state = 'locked';
    lockBanner.innerHTML = '<b>PROFIL TERKUNCI</b><span>Ada identitas yang perlu diperbarui? Ajukan perubahan agar panitia bisa memeriksanya.</span>';
    saveTitle.textContent = 'Profil utama telah dikunci.';
  }
  updateSaveAvailability();
}

function updateSaveAvailability() {
  if (formLocked) {
    saveButton.disabled = true;
    saveButton.closest('.profile-save-panel')?.classList.remove('is-ready');
    saveState.textContent = profileRequest?.status === 'pending'
      ? 'Permintaanmu sedang diperiksa panitia.'
      : profileRequest?.status === 'rejected'
        ? 'Ajukan ulang permintaan edit dengan alasan yang lebih jelas.'
        : 'Pilih Ajukan Perubahan untuk meminta izin memperbarui data profil.';
    saveState.dataset.state = 'locked';
    return false;
  }
  const issueCount = requiredIssueCount();
  const ready = issueCount === 0 && form.checkValidity();
  saveButton.disabled = savingProfile || !ready;
  saveButton.closest('.profile-save-panel')?.classList.toggle('is-ready', ready);
  saveState.textContent = ready
    ? (profileIsComplete
      ? 'Semua data valid. Perubahan siap disimpan dan profil akan dikunci kembali.'
      : 'Data wajib sudah lengkap. Periksa sekali lagi sebelum menyimpan identitasmu.')
    : `Lengkapi ${issueCount} data wajib untuk mengaktifkan tombol simpan.`;
  saveState.dataset.state = ready ? 'ready' : 'waiting';
  return ready;
}

const setCustomValue = (component, value) => {
  const input = component.querySelector('[data-custom-input]');
  const label = component.querySelector('[data-selected-label]');
  const trigger = component.querySelector('.custom-select-trigger');
  const options = [...component.querySelectorAll('[role="option"]')];
  const selected = options.find((option) => option.dataset.value === value);
  input.value = selected?.dataset.value || '';
  label.textContent = selected?.dataset.label || label.dataset.placeholder || 'Pilih opsi';
  trigger.classList.toggle('is-placeholder', !selected);
  options.forEach((option) => option.setAttribute('aria-selected', String(option === selected)));
  component.classList.remove('invalid');
  updateSaveAvailability();
};

const closeSelect = (component, focus = false) => {
  const trigger = component.querySelector('.custom-select-trigger');
  const panel = component.querySelector('.custom-options');
  component.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  panel.hidden = true;
  panel.scrollTop = 0;
  if (focus && !trigger.disabled) trigger.focus();
};

// Wilayah Indonesia — nama disimpan sebagai string agar kompatibel dengan profil lama.
// Data kabupaten/kota mengikuti kode provinsi (Kepmendagri 2025, wilayah.id).
const provinceSelector = document.querySelector('[data-profile-select="province"]');
const citySelector = document.querySelector('[data-profile-select="city"]');
const regionHint = document.querySelector('#profile-city-hint');
const provinces = [
  ['11','Aceh'],['12','Sumatera Utara'],['13','Sumatera Barat'],['14','Riau'],
  ['15','Jambi'],['16','Sumatera Selatan'],['17','Bengkulu'],['18','Lampung'],
  ['19','Kepulauan Bangka Belitung'],['21','Kepulauan Riau'],['31','DKI Jakarta'],
  ['32','Jawa Barat'],['33','Jawa Tengah'],['34','Daerah Istimewa Yogyakarta'],
  ['35','Jawa Timur'],['36','Banten'],['51','Bali'],['52','Nusa Tenggara Barat'],
  ['53','Nusa Tenggara Timur'],['61','Kalimantan Barat'],['62','Kalimantan Tengah'],
  ['63','Kalimantan Selatan'],['64','Kalimantan Timur'],['65','Kalimantan Utara'],
  ['71','Sulawesi Utara'],['72','Sulawesi Tengah'],['73','Sulawesi Selatan'],
  ['74','Sulawesi Tenggara'],['75','Gorontalo'],['76','Sulawesi Barat'],
  ['81','Maluku'],['82','Maluku Utara'],['91','Papua'],['92','Papua Barat'],
  ['93','Papua Selatan'],['94','Papua Tengah'],['95','Papua Pegunungan'],
  ['96','Papua Barat Daya']
];
const regionCache = new Map();
let regionEpoch = 0;
let regionLoading = false;
const normalizeRegionName = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID')
  .replace(/^(kota administrasi|kabupaten|kota|kab\.?)\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
const regionOption = (code, name, caption) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  button.dataset.value = name;
  button.dataset.label = name;
  const index = document.createElement('span'); index.textContent = code;
  const label = document.createElement('strong'); label.textContent = name;
  const info = document.createElement('small'); info.textContent = caption;
  button.append(index, label, info);
  return button;
};
const renderRegionOptions = (component, items, caption) => {
  const panel = component.querySelector('.custom-options');
  panel.replaceChildren(...items.map(([code, name]) => regionOption(String(code), name, caption)));
};
const cityTrigger = citySelector.querySelector('.custom-select-trigger');
const citySelected = citySelector.querySelector('[data-selected-label]');
const provinceCode = () => provinces.find(([, name]) => name === provinceSelector.querySelector('[data-custom-input]').value)?.[0];
const updateCityTrigger = () => {
  cityTrigger.disabled = formLocked || regionLoading || !provinceCode() ||
    citySelector.querySelectorAll('[role="option"]').length === 0;
};
const cityMessage = (message, state = '') => {
  regionHint.textContent = message;
  regionHint.dataset.state = state;
};
const cachedRegencies = (code) => {
  if (regionCache.has(code)) return regionCache.get(code);
  try {
    const value = JSON.parse(sessionStorage.getItem(`esoria-regencies-2025-${code}`) || 'null');
    if (Array.isArray(value) && value.length > 0) { regionCache.set(code, value); return value; }
  } catch { /* sessionStorage dapat dimatikan oleh browser. */ }
  return null;
};
const fetchRegencies = async (code) => {
  const cached = cachedRegencies(code);
  if (cached) return cached;
  const urls = [
    `https://wilayah.id/api/regencies/${code}.json`,
    `https://www.emsifa.com/api-wilayah-indonesia/v2/regencies/${code}.json`
  ];
  for (const url of urls) {
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 9000);
    try {
      const response = await fetch(url, { signal: abort.signal, cache: 'force-cache', mode: 'cors' });
      if (!response.ok) throw new Error('Tidak tersedia');
      const json = await response.json();
      const raw = Array.isArray(json) ? json : json.data;
      const cleaned = Array.isArray(raw) ? raw.map((item) => [String(item.code || item.id || ''), String(item.name || '')])
        .filter(([id, name]) => id && name && id.startsWith(code)) : [];
      if (!cleaned.length) throw new Error('Daftar wilayah kosong');
      cleaned.sort((a, b) => a[1].localeCompare(b[1], 'id'));
      regionCache.set(code, cleaned);
      try { sessionStorage.setItem(`esoria-regencies-2025-${code}`, JSON.stringify(cleaned)); } catch { /* cache opsional */ }
      return cleaned;
    } catch { /* Coba penyedia cadangan. */ }
    finally { window.clearTimeout(timeout); }
  }
  throw new Error('Daftar kota/kabupaten belum bisa dimuat. Periksa jaringan lalu pilih ulang provinsi.');
};
const matchingRegion = (component, value) => {
  const options = [...component.querySelectorAll('[role="option"]')];
  const legacyName = component === provinceSelector ? ({
    'diyogyakarta': 'daerahistimewayogyakarta',
    'yogyakarta': 'daerahistimewayogyakarta',
    'dki': 'dkijakarta',
    'jakarta': 'dkijakarta',
    'nanggroeacehdarussalam': 'aceh'
  }[normalizeRegionName(value)] || normalizeRegionName(value)) : normalizeRegionName(value);
  return options.find((option) => option.dataset.value === value) ||
    options.find((option) => normalizeRegionName(option.dataset.value) === legacyName);
};
const chooseProvince = async (name, savedCity = '') => {
  const epoch = ++regionEpoch;
  regionLoading = true;
  const selectedProvince = matchingRegion(provinceSelector, name);
  setCustomValue(provinceSelector, selectedProvince?.dataset.value || '');
  citySelector.querySelector('.custom-options').replaceChildren();
  setCustomValue(citySelector, '');
  if (!provinceCode()) {
    regionLoading = false;
    citySelected.dataset.placeholder = 'Pilih provinsi dahulu';
    citySelected.textContent = 'Pilih provinsi dahulu';
    cityMessage('Pilih provinsi agar daftar kota/kabupaten tersedia.');
    updateCityTrigger();
    return;
  }
  citySelected.dataset.placeholder = 'Memuat wilayah…';
  citySelected.textContent = 'Memuat wilayah…';
  cityMessage('Memuat seluruh kota/kabupaten pada provinsi yang dipilih…');
  updateCityTrigger();
  try {
    const items = await fetchRegencies(provinceCode());
    if (epoch !== regionEpoch) return;
    renderRegionOptions(citySelector, items, 'Wilayah administratif resmi');
    const selectedCity = matchingRegion(citySelector, savedCity);
    setCustomValue(citySelector, selectedCity?.dataset.value || '');
    citySelected.dataset.placeholder = 'Pilih kota/kabupaten';
    if (!selectedCity) citySelected.textContent = 'Pilih kota/kabupaten';
    cityMessage(`${items.length} kota/kabupaten tersedia · pilih domisili kamu.`, 'ready');
  } catch (error) {
    if (epoch !== regionEpoch) return;
    // Data lama boleh tetap terlihat dalam profil yang telah terkunci, tidak membuat opsi palsu.
    if (savedCity) {
      renderRegionOptions(citySelector, [['saved', savedCity]], 'Data profil yang telah tersimpan');
      setCustomValue(citySelector, savedCity);
    }
    citySelected.dataset.placeholder = 'Gagal memuat wilayah';
    if (!savedCity) citySelected.textContent = 'Gagal memuat wilayah';
    cityMessage(error.message, 'error');
  } finally {
    if (epoch === regionEpoch) { regionLoading = false; updateCityTrigger(); updateSaveAvailability(); }
  }
};
renderRegionOptions(provinceSelector, provinces, 'Provinsi Indonesia');
cityMessage('Pilih provinsi agar daftar kota/kabupaten tersedia.');
updateCityTrigger();

customSelects.forEach((component) => {
  const trigger = component.querySelector('.custom-select-trigger');
  const panel = component.querySelector('.custom-options');
  trigger.addEventListener('click', () => {
    if (trigger.disabled) return;
    customSelects.forEach((item) => { if (item !== component) closeSelect(item); });
    const open = component.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (open) {
      panel.scrollTop = 0;
      const options = [...component.querySelectorAll('[role="option"]')];
      const selected = options.find((item) => item.getAttribute('aria-selected') === 'true') || options[0];
      if (selected) window.requestAnimationFrame(() => selected.focus({ preventScroll: true }));
    }
  });
  panel.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option || !panel.contains(option) || option.disabled) return;
    if (component === provinceSelector) {
      void chooseProvince(option.dataset.value);
    } else {
      setCustomValue(component, option.dataset.value);
    }
    profileFormTouched = true;
    closeSelect(component, true);
  });
  panel.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="option"]');
    if (!current) return;
    if (event.key === 'Escape') return closeSelect(component, true);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...panel.querySelectorAll('[role="option"]:not([disabled])')];
    if (!options.length) return;
    const index = options.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  });
});

document.addEventListener('click', (event) => {
  customSelects.forEach((component) => {
    if (!component.contains(event.target)) closeSelect(component);
  });
});

const updateAge = () => {
  const age = calculateAge(birthInput.value);
  ageInput.value = age === null ? '' : `${age} tahun`;
  ageInput.dataset.age = age === null ? '' : String(age);
  birthInput.setCustomValidity(age === null && birthInput.value ? 'Tanggal lahir belum valid.' : '');
  updateSaveAvailability();
};

birthInput.max = localDateValue();
birthInput.addEventListener('input', updateAge);
phoneInput.addEventListener('focus', () => {
  if (!phoneInput.value.trim()) phoneInput.value = '+62';
});
phoneInput.addEventListener('input', () => {
  const normalized = normalizeIndonesianPhone(phoneInput.value);
  if (phoneInput.value !== normalized) phoneInput.value = normalized;
  updateSaveAvailability();
});
phoneInput.addEventListener('blur', () => {
  phoneInput.value = normalizeIndonesianPhone(phoneInput.value);
  updateSaveAvailability();
});

const fillProfile = (data) => {
  const values = {
    display_name: profileName(data, user),
    email: user.email || data?.email || '',
    birth_date: data?.birthDate || '',
    phone: normalizeIndonesianPhone(data?.phone || ''),
    institution: data?.institution || '',
    city: data?.city || '',
    province: data?.province || '',
    address: data?.address || '',
    primary_skill: data?.primarySkill || '',
    portfolio_url: data?.portfolioUrl || '',
    bio: data?.bio || ''
  };
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  });
  birthInput.dispatchEvent(new Event('esoria:paper-date-sync'));
  void chooseProvince(data?.province || '', data?.city || '');
  setCustomValue(document.querySelector('[data-profile-select="gender"]'), data?.gender || '');
  setCustomValue(document.querySelector('[data-profile-select="occupation"]'), data?.occupation || '');
  setCustomValue(document.querySelector('[data-profile-select="experienceLevel"]'), data?.experienceLevel || '');
  setCustomValue(document.querySelector('[data-profile-select="preferredTrack"]'), data?.preferredTrack || '');
  updateAge();
};

const updateProfileSummary = (data) => {
  const name = profileName(data, user);
  profilePhoto.update(data, name);
  document.querySelector('#profile-user-name').textContent = name;
  document.querySelector('#profile-user-email').textContent = user.email || data?.email || '';
  document.querySelector('#profile-user-track').textContent = data?.preferredTrack || 'Belum dipilih';
  document.querySelector('#profile-user-level').textContent = data?.experienceLevel || 'Belum dipilih';
};

// Ignore the first Firestore snapshot's form repaint when it contains the
// same fields as the document already rendered by requireAuthenticated().
const formDataFingerprint = (data = {}) => [
  'participantName', 'legalName', 'displayName', 'birthDate', 'phone',
  'institution', 'city', 'province', 'address', 'primarySkill', 'gender',
  'occupation', 'experienceLevel', 'preferredTrack', 'portfolioUrl', 'bio'
].map((field) => String(data?.[field] ?? '')).join('\u001f');
let lastFormFingerprint = formDataFingerprint(profile);
fillProfile(profile);
updateProfileSummary(profile);
saveButton.querySelector('span').textContent = profileIsComplete ? 'Simpan Perubahan' : 'Simpan & Kunci Profil';
document.querySelector('#profile-continue').href = nextPath;
document.querySelector('#profile-continue-wrap').hidden = !profileIsComplete;

form.addEventListener('input', (event) => {
  profileFormTouched = true;
  event.target.closest('.form-field')?.classList.remove('field-invalid');
  updateSaveAvailability();
});
form.addEventListener('change', updateSaveAvailability);

const scrollToForm = () => {
  form.classList.remove('profile-edit-focus');
  void form.offsetWidth;
  form.classList.add('profile-edit-focus');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => form.elements.namedItem('display_name')?.focus({ preventScroll: true }), 520);
  window.setTimeout(() => form.classList.remove('profile-edit-focus'), 1600);
};

const openRequestDialog = () => {
  const status = profileRequest?.status || 'none';
  requestStatusPanel.dataset.state = status;
  requestStatusPanel.innerHTML = `<b>${escapeHtml(requestStatusLabel(status))}</b><span>${escapeHtml(
    status === 'pending'
      ? `Diajukan ${formatTimestamp(profileRequest.requestedAt)}. Panitia akan memeriksa permintaanmu.`
      : status === 'approved'
        ? 'Akses edit sudah dibuka. Tutup dialog lalu ubah data dan simpan.'
        : status === 'rejected'
          ? (profileRequest.reviewNote || 'Permintaan sebelumnya belum disetujui. Kamu bisa mengajukan kembali.')
          : 'Jelaskan data apa yang perlu diubah dan alasan perubahan secara ringkas.'
  )}</span>`;
  requestDialogTitle.textContent = status === 'pending'
    ? 'Permintaan sedang ditinjau.'
    : status === 'approved'
      ? 'Akses edit sudah dibuka.'
      : status === 'rejected'
        ? 'Ajukan ulang perubahan profil.'
        : 'Ada data yang perlu diubah?';
  requestDialogText.textContent = status === 'pending'
    ? 'Permintaanmu sudah diterima. Tunggu kabar dari panitia di halaman ini.'
    : status === 'approved'
      ? 'Akses hanya berlaku untuk satu kali penyimpanan. Profil akan dikunci kembali setelah perubahan disimpan.'
      : 'Sampaikan data yang ingin diubah beserta alasannya. Panitia akan memeriksa permintaanmu.';
  const canSubmit = !['pending', 'approved'].includes(status);
  requestForm.hidden = !canSubmit;
  requestSubmitButton.disabled = !canSubmit || requestingEdit;
  if (canSubmit) requestReason.value = '';
  showDialog(requestDialog);
};

editButton?.addEventListener('click', () => {
  if (!profileIsComplete || profileRequest?.status === 'approved') {
    scrollToForm();
    return;
  }
  openRequestDialog();
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (requestingEdit) return;
  const reason = requestReason.value.trim();
  if (reason.length < 10) {
    requestReason.setCustomValidity('Jelaskan alasan perubahan minimal 10 karakter.');
    requestReason.reportValidity();
    requestReason.setCustomValidity('');
    return;
  }
  try {
    requestingEdit = true;
    requestSubmitButton.disabled = true;
    requestSubmitButton.textContent = 'Mengirim permintaan…';
    await submitProfileEditRequest({ reason });
    closeDialog(requestDialog);
    setAlert('Permintaanmu sudah dikirim. Panitia akan memeriksanya sebelum identitas bisa diubah.', 'notice');
  } catch (error) {
    setAlert(friendlyFirebaseError(error));
  } finally {
    requestingEdit = false;
    requestSubmitButton.disabled = false;
    requestSubmitButton.textContent = 'Kirim Permintaan →';
  }
});

const askSaveConfirmation = () => new Promise((resolve) => {
  const firstSave = !profileIsComplete;
  saveConfirmTitle.textContent = firstSave ? 'Simpan dan kunci profil?' : 'Simpan perubahan profil?';
  saveConfirmText.textContent = firstSave
    ? 'Periksa data dan kategori minat. Setelah disimpan, perubahan identitas perlu persetujuan panitia.'
    : 'Perubahan yang disetujui akan disimpan, lalu profil otomatis dikunci kembali.';
  saveConfirmAction.textContent = firstSave ? 'Ya, Simpan & Kunci' : 'Ya, Simpan Perubahan';
  pendingSaveConfirmation = resolve;
  showDialog(saveConfirmDialog);
});

saveConfirmAction.addEventListener('click', () => {
  const resolve = pendingSaveConfirmation;
  pendingSaveConfirmation = null;
  closeDialog(saveConfirmDialog);
  resolve?.(true);
});

const cancelPendingSave = () => {
  if (!pendingSaveConfirmation) return;
  const resolve = pendingSaveConfirmation;
  pendingSaveConfirmation = null;
  resolve(false);
};
saveConfirmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelPendingSave();
  closeDialog(saveConfirmDialog);
});
saveConfirmDialog.addEventListener('close', cancelPendingSave);
requestDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDialog(requestDialog);
});

document.querySelectorAll('[data-profile-dialog-close]').forEach((button) => button.addEventListener('click', () => {
  const dialog = button.closest('dialog');
  if (dialog === saveConfirmDialog && pendingSaveConfirmation) {
    const resolve = pendingSaveConfirmation;
    pendingSaveConfirmation = null;
    resolve(false);
  }
  closeDialog(dialog);
}));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (savingProfile || pendingSaveConfirmation) return;
  setAlert('');
  if (formLocked) {
    setAlert('Identitas belum bisa diubah. Ajukan perubahan terlebih dahulu dan tunggu persetujuan panitia.', 'notice');
    return;
  }
  const missingSelect = customSelects.find((component) => !component.querySelector('[data-custom-input]').value);
  if (missingSelect) {
    missingSelect.classList.add('invalid');
    missingSelect.querySelector('.custom-select-trigger').focus();
    setAlert('Lengkapi seluruh pilihan identitas, pengalaman, dan kategori minat.');
    return;
  }
  if (regionLoading || !provinceCode() || !matchingRegion(citySelector, form.elements.namedItem('city').value)) {
    setAlert('Pilih provinsi dan kota/kabupaten dari daftar wilayah yang tersedia.');
    cityTrigger.focus();
    return;
  }
  if (regionHint.dataset.state === 'error' && !formLocked) {
    setAlert('Daftar wilayah belum terverifikasi. Pilih ulang provinsi saat koneksi internet tersedia.');
    return;
  }
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (!await askSaveConfirmation()) return;

  const data = new FormData(form);
  const age = calculateAge(String(data.get('birth_date')));
  const payload = {
    participantName: String(data.get('display_name')).trim(),
    legalName: String(data.get('display_name')).trim(),
    displayName: String(data.get('display_name')).trim(),
    birthDate: String(data.get('birth_date')),
    age,
    ageComputedAt: localDateValue(),
    gender: String(data.get('gender')),
    phone: normalizeIndonesianPhone(data.get('phone')),
    institution: String(data.get('institution')).trim(),
    occupation: String(data.get('occupation')),
    city: String(data.get('city')).trim(),
    province: String(data.get('province')).trim(),
    address: String(data.get('address')).trim(),
    primarySkill: String(data.get('primary_skill')).trim(),
    experienceLevel: String(data.get('experience_level')),
    preferredTrack: String(data.get('preferred_track')),
    portfolioUrl: String(data.get('portfolio_url')).trim(),
    bio: String(data.get('bio')).trim()
  };

  try {
    savingProfile = true;
    updateSaveAvailability();
    saveButton.setAttribute('aria-busy', 'true');
    saveButton.querySelector('span').textContent = 'Menyimpan profil…';
    await saveParticipantProfile({ payload });
    // Firestore menjadi satu-satunya sumber identitas aplikasi. Dengan begitu,
    // penyimpanan profil tidak bergantung pada operasi kedua di Firebase Auth.
    liveProfile = { ...liveProfile, ...payload, profileComplete: true, profileLocked: true };
    updateProfileSummary(liveProfile);
    profileFormTouched = false;
    profileIsComplete = true;
    if (profileRequest?.status === 'approved') profileRequest = { ...profileRequest, status: 'completed' };
    setAlert('Profil berhasil disimpan dan dikunci. Data siap digunakan untuk pendaftaran lomba.', 'success');
    document.querySelector('#profile-continue').href = nextPath;
    document.querySelector('#profile-continue-wrap').hidden = false;
    updateProfileAccessState();
  } catch (error) {
    console.error('Gagal menyimpan profil:', error);
    setAlert(friendlyFirebaseError(error));
  } finally {
    savingProfile = false;
    saveButton.setAttribute('aria-busy', 'false');
    saveButton.querySelector('span').textContent = profileIsComplete ? 'Simpan Perubahan' : 'Simpan & Kunci Profil';
    updateSaveAvailability();
  }
});

onSnapshot(doc(db, 'users', user.uid), async (snapshot) => {
  if (auth.currentUser?.uid !== user.uid || !snapshot.exists()) return;
  const nextProfile = { id: snapshot.id, ...snapshot.data() };
  if (nextProfile.archived === true) {
    setAlert('Akun ini baru saja dinonaktifkan oleh panitia. Kamu akan keluar dari akun.', 'notice');
    window.setTimeout(async () => {
      await signOut(auth).catch(() => {});
      window.location.replace('login.html?reason=archived');
    }, 900);
    return;
  }
  liveProfile = nextProfile;
  profileIsComplete = nextProfile.profileComplete === true;
  updateProfileSummary(nextProfile);
  const nextFingerprint = formDataFingerprint(nextProfile);
  if (!profileFormTouched && !savingProfile && nextFingerprint !== lastFormFingerprint) {
    lastFormFingerprint = nextFingerprint;
    fillProfile(nextProfile);
  }
  document.querySelector('#profile-continue-wrap').hidden = !profileIsComplete;
  saveButton.querySelector('span').textContent = profileIsComplete ? 'Simpan Perubahan' : 'Simpan & Kunci Profil';
  updateProfileAccessState();
}, (error) => console.error('Gagal memantau profil:', error));

onSnapshot(doc(db, 'profileEditRequests', user.uid), (snapshot) => {
  if (auth.currentUser?.uid !== user.uid) return;
  profileRequest = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  updateProfileAccessState();
}, (error) => {
  console.error('Gagal memantau request edit profil:', error);
  updateProfileAccessState();
});

updateProfileAccessState();

const registrationList = document.querySelector('#profile-registrations');
const ticketDialog = document.querySelector('#profile-ticket-dialog');
let registrationItems = [];
let openTicketId = null;

const timestampValue = (value) => value?.seconds
  ? value.seconds * 1000
  : (value ? new Date(value).getTime() : 0);

const ticketStatusLabel = (item) => ({
  menunggu: 'Sedang diproses',
  terverifikasi: 'Diterima / ACC',
  ditolak: 'Ditolak'
})[item?.status] || item?.statusLabel || 'Sedang diproses';

const ticketNumberLabel = (item) => item?.ticketNumber?.trim()
  || (item?.status === 'ditolak' ? 'TIDAK DITERBITKAN' : 'MENUNGGU NOMOR');

const renderRegistrations = () => {
  if (!registrationItems.length) {
    registrationList.innerHTML = '<div class="profile-empty"><b>Belum ada tiket.</b><span>Pilih kategori lomba setelah profil selesai.</span></div>';
    if (ticketDialog?.open) ticketDialog.close();
    return;
  }

  const focusedRecordId = registrationList.contains(document.activeElement)
    ? document.activeElement.closest('[data-ticket-id]')?.dataset.ticketId : null;
  registrationList.innerHTML = registrationItems.map((item, index) => `<button class="profile-ticket-record" data-status="${escapeHtml(item.status || 'menunggu')}" data-ticket-id="${escapeHtml(item.id)}" style="--ticket-delay:${index * 55}ms" type="button">
    <span class="profile-ticket-top"><small>ESORIA / ${escapeHtml(item.wave || 'WAVE')}</small><b>${escapeHtml(item.checkedIn ? 'CHECKED IN' : ticketStatusLabel(item))}</b></span>
    <strong class="profile-ticket-number">${escapeHtml(ticketNumberLabel(item))}</strong>
    <span class="profile-ticket-category">${escapeHtml(item.packageLabel || 'Kategori Lomba')}</span>
    <span class="profile-ticket-facts"><i>${escapeHtml(item.amount || '—')}</i><i>${escapeHtml(item.waveLabel || 'Gelombang')}</i></span>
    <span class="profile-ticket-bottom"><small>${escapeHtml(formatTimestamp(item.createdAt))}</small><b>Lihat detail →</b></span>
  </button>`).join('');
  if (focusedRecordId) {
    [...registrationList.querySelectorAll('[data-ticket-id]')]
      .find((node) => node.dataset.ticketId === focusedRecordId)?.focus({preventScroll:true});
  }
  // The participant may be viewing a ticket when an administrator changes its
  // status. Refresh the open detail without dismissing the modal or losing
  // the expanded history, rather than showing stale ACC/payment information.
  if (openTicketId && ticketDialog?.open) {
    if (registrationItems.some((item) => item.id === openTicketId)) openTicketDetail(openTicketId, true);
    else ticketDialog.close();
  }
};

const loadReplacementImage = (file) => new Promise((resolve, reject) => {
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.addEventListener('load', () => resolve({ image, source }), { once: true });
  image.addEventListener('error', () => {
    URL.revokeObjectURL(source);
    reject(new Error('File yang dipilih bukan gambar yang valid.'));
  }, { once: true });
  image.src = source;
});

const replacementCanvasBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Gambar tidak dapat dikompresi.')), 'image/jpeg', quality);
});

const compressReplacementProof = async (file) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan gambar JPG, PNG, atau WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Ukuran gambar awal maksimal 8 MB.');
  const loaded = await loadReplacementImage(file);
  try {
    const longest = Math.max(loaded.image.naturalWidth, loaded.image.naturalHeight);
    if (!longest) throw new Error('Dimensi gambar tidak dapat dibaca.');
    const scale = Math.min(1, 1800 / longest);
    let width = Math.max(1, Math.round(loaded.image.naturalWidth * scale));
    let height = Math.max(1, Math.round(loaded.image.naturalHeight * scale));
    let quality = 0.86;
    let blob = null;
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded.image, 0, 0, width, height);
      blob = await replacementCanvasBlob(canvas, quality);
      if (blob.size <= 360 * 1024) break;
      if (quality > 0.5) quality -= 0.08;
      else {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
        quality = 0.7;
      }
    }
    if (!blob || blob.size > 360 * 1024) throw new Error('Gambar masih terlalu besar setelah dikompresi. Maksimal 360 KB setelah kompresi.');
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'bukti-transfer';
    return { blob, fileName: `${baseName}.jpg`, mimeType: 'image/jpeg', sizeBytes: blob.size, width, height };
  } finally {
    URL.revokeObjectURL(loaded.source);
  }
};

const uploadReplacementProof = async (item, button) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const original = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Mengompresi…';
      const proof = await compressReplacementProof(file);
      button.textContent = 'Menyimpan…';
      const response = await replacePaymentProof({ registrationId: item.id, proof });
      item.proofSize = response.data.proofSize;
      item.paymentStatus = 'belum_diperiksa';
      item.paymentStatusLabel = 'Belum diperiksa';
      if (typeof ticketDialog.close === 'function') ticketDialog.close();
      else ticketDialog.removeAttribute('open');
      renderRegistrations();
      setAlert('Bukti transfer berhasil diganti dan akan diperiksa ulang.', 'success');
    } catch (error) {
      setAlert(friendlyFirebaseError(error));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }, { once: true });
  input.click();
};

const openTicketDetail = (id, refresh = false) => {
  if (auth.currentUser?.uid !== user.uid) return;
  const item = registrationItems.find((entry) => entry.id === id);
  if (!item) return;
  const content = ticketDialog.querySelector('[data-ticket-dialog-content]');
  const historyExpanded = refresh && content.querySelector('.profile-ticket-more')?.open;
  const focusSelector = refresh && ticketDialog.contains(document.activeElement)
    ? document.activeElement.matches('[data-print-ticket]') ? '[data-print-ticket]'
      : document.activeElement.matches('[data-replace-payment-proof]') ? '[data-replace-payment-proof]' : null
    : null;
  const accepted = item.status === 'terverifikasi';
  const rejected = item.status === 'ditolak';
  const teamDetails = item.package === 'team'
    ? `<span><small>Nama tim</small><b>${escapeHtml(item.teamName || '—')}</b></span><span><small>Jumlah anggota</small><b>${escapeHtml(item.memberCount || '—')}</b></span><span class="wide"><small>Daftar anggota</small><b>${escapeHtml(Array.isArray(item.teamMembers) ? item.teamMembers.map((member) => `${member.name} — ${member.role}`).join(', ') : item.teamMembers || '—')}</b></span>`
    : '';

  content.innerHTML = `<article class="profile-ticket-detail" data-status="${escapeHtml(item.status || 'menunggu')}">
    <header><span>OFFICIAL TICKET ACTIVITY</span><b>${escapeHtml(ticketStatusLabel(item))}</b><h2>${escapeHtml(item.packageLabel || 'Tiket Lomba')}</h2><p>${escapeHtml(item.waveLabel || 'Gelombang')}</p></header>
    <div class="profile-ticket-serial"><small>NOMOR TIKET</small><strong>${escapeHtml(ticketNumberLabel(item))}</strong><span>${accepted ? 'Tiket telah disetujui panitia' : rejected ? 'Pendaftaran tidak diterima' : 'Nomor diberikan setelah pendaftaran disetujui'}</span></div>
    <div class="profile-ticket-detail-grid">
      <span><small>Peserta</small><b>${escapeHtml(item.userName || user.displayName || '—')}</b></span><span><small>Email</small><b>${escapeHtml(item.userEmail || user.email || '—')}</b></span>
      <span><small>Periode</small><b>${escapeHtml(item.periodLabel || item.periodId || '—')}</b></span><span><small>Referensi</small><b>${escapeHtml(item.referenceNumber || '—')}</b></span>
      <span><small>Biaya kategori</small><b>${escapeHtml(item.amount || '—')}</b></span><span><small>Keahlian</small><b>${escapeHtml(item.skillStack || '—')}</b></span>
      <span><small>Pembayaran</small><b>${escapeHtml(item.paymentStatusLabel || 'Belum diperiksa')}</b></span><span><small>Check-in</small><b>${escapeHtml(item.checkedIn ? `Tercatat ${formatTimestamp(item.checkedInAt)}` : 'Belum check-in')}</b></span>
    </div>
    <details class="profile-ticket-more"><summary>Detail pembayaran, anggota &amp; riwayat <span aria-hidden="true">⌄</span></summary><div class="profile-ticket-detail-grid">
      ${teamDetails}<span><small>Tanggal pembayaran</small><b>${escapeHtml(item.transferDate || '—')}</b></span><span><small>Nama pengirim</small><b>${escapeHtml(item.senderName || '—')}</b></span>
      <span><small>Asal pembayaran</small><b>${escapeHtml(item.senderInstitution || '—')}</b></span><span><small>Terakhir diperbarui</small><b>${escapeHtml(formatTimestamp(item.updatedAt || item.createdAt))}</b></span>
      <span><small>Diperiksa oleh</small><b>${escapeHtml(item.reviewedByEmail || 'Belum diperiksa')}</b></span>
      <span class="wide"><small>Alasan penolakan</small><b>${escapeHtml(item.rejectionReason || '—')}</b></span><span class="wide"><small>Catatan peserta</small><b>${escapeHtml(item.notes || 'Tidak ada catatan')}</b></span>
    </div>
    <section class="ticket-activity"><span>ALUR STATUS</span><ol>
      <li class="done"><i>01</i><div><b>Pendaftaran dikirim</b><small>${escapeHtml(formatTimestamp(item.createdAt))}</small></div></li>
      <li class="${item.status === 'menunggu' ? 'current' : 'done'}"><i>02</i><div><b>Diproses panitia</b><small>${item.status === 'menunggu' ? 'Pemeriksaan data sedang berlangsung' : 'Pemeriksaan telah selesai'}</small></div></li>
      <li class="${accepted ? 'accepted' : rejected ? 'rejected' : 'waiting'}"><i>03</i><div><b>${accepted ? 'Pendaftaran diterima' : rejected ? 'Pendaftaran ditolak' : 'Menunggu keputusan'}</b><small>${accepted ? `Nomor tiket ${escapeHtml(ticketNumberLabel(item))}` : rejected ? 'Status akhir telah ditetapkan panitia' : 'Perubahan akan tampil pada halaman ini'}</small></div></li>
    </ol></section></details>
    <div class="profile-ticket-print-actions"><button type="button" class="btn btn-ghost" data-print-ticket="${escapeHtml(item.id)}">Cetak / Simpan PDF</button><small>${accepted ? 'Nomor tiket telah diterbitkan.' : 'Ini bukti pendaftaran, bukan tiket ACC.'}</small></div>
    ${item.status === 'menunggu' && item.active !== false ? `<div class="ticket-detail-actions"><button class="btn btn-ghost" data-replace-payment-proof="${escapeHtml(item.id)}" type="button">Ganti Bukti Transfer</button><small>Bisa diganti sebelum panitia memberi keputusan.</small></div>` : ''}
  </article>`;
  openTicketId = id;
  if (historyExpanded) content.querySelector('.profile-ticket-more').open = true;
  if (!ticketDialog.open) {
    if (typeof ticketDialog.showModal === 'function') ticketDialog.showModal();
    else ticketDialog.setAttribute('open', '');
  } else if (focusSelector) {
    content.querySelector(focusSelector)?.focus({preventScroll:true});
  }
};

ticketDialog?.addEventListener('close', () => { openTicketId = null; });

registrationList.addEventListener('click', (event) => {
  const ticket = event.target.closest('[data-ticket-id]');
  if (ticket) openTicketDetail(ticket.dataset.ticketId);
});

ticketDialog?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-print-ticket]');
  if (!button) return;
  const item = registrationItems.find((entry) => entry.id === button.dataset.printTicket);
  if (!item) return;
  const popup = window.open('', '_blank', 'width=820,height=720');
  if (!popup) return setAlert('Izinkan jendela baru untuk mencetak bukti pendaftaran.');
  const e = escapeHtml;
  const confirmed = item.status === 'terverifikasi';
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${e(confirmed ? 'Tiket Resmi' : 'Bukti Pendaftaran')} ESORIA</title><style>*{box-sizing:border-box}html,body{width:100%;max-width:100%;overflow-x:hidden}body{background:#eae4d6;color:#132a3d;font:14px/1.5 Arial,sans-serif;margin:0;padding:16px}.paper{margin:auto;width:min(100%,760px);background:#fffaf0;border:2px solid #193247;border-top:9px solid #17694d;padding:24px;box-shadow:6px 8px 0 #c2b69f}.eyebrow{color:#aa3030;font:bold 11px monospace;letter-spacing:1.4px}h1{font:700 clamp(28px,7vw,36px)/1.04 Georgia,serif;margin:10px 0 8px}.paper>p{margin:0 0 14px}.number{padding:12px;background:#e9ebdf;border-left:5px solid #167355;font:bold clamp(16px,4.5vw,23px)/1.3 monospace;overflow-wrap:anywhere}.fields{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#cdbfa8;margin-top:15px}.fields div{background:#fffaf0;padding:12px;min-width:0}.fields b{display:block;overflow-wrap:anywhere}.fields small{display:block;color:#6a655d;font-size:10px}.note{padding:12px;background:#f0e6cd;border-left:4px solid #aa3030}.actions{display:flex;justify-content:flex-start}.actions button{margin-top:18px;padding:12px 18px;background:#193247;color:white;border:0;cursor:pointer;min-height:46px}@media(max-width:600px){body{padding:10px}.paper{width:100%;padding:16px;box-shadow:4px 5px 0 #c2b69f}.fields{grid-template-columns:1fr}.actions button{width:100%}}@media print{body{background:white;padding:0}.paper{border:0;box-shadow:none;padding:0;max-width:none;width:auto}.actions{display:none}@page{size:A4;margin:14mm}}</style></head><body><main class="paper"><div class="eyebrow">ESORIA CODEFEST · VERIFIKASI PENDAFTARAN</div><h1>${confirmed ? 'Tiket kompetisi' : 'Bukti pendaftaran'}</h1><p>${e(item.packageLabel || 'Kompetisi')} · ${e(item.periodLabel || item.periodId || '')}</p><div class="number">${e(confirmed ? (item.ticketNumber || item.referenceNumber || '—') : (item.referenceNumber || '—'))}</div><div class="fields"><div><small>PESERTA</small><b>${e(item.userName || user.displayName || '—')}</b></div><div><small>STATUS</small><b>${e(ticketStatusLabel(item))}</b></div><div><small>GELOMBANG</small><b>${e(item.waveLabel || '—')}</b></div><div><small>PEMBAYARAN</small><b>${e(item.paymentStatusLabel || 'Belum diperiksa')}</b></div><div><small>REFERENSI PENDAFTARAN</small><b>${e(item.referenceNumber || '—')}</b></div><div><small>CHECK-IN</small><b>${e(item.checkedIn ? 'Sudah tercatat' : 'Belum check-in')}</b></div></div><p class="note">${confirmed ? 'Tiket ini berlaku sesuai status terbaru pada akun peserta ESORIA.' : 'Bukti ini menunjukkan pendaftaran masuk. Status pembayaran dan tiket tetap dicek lewat akun ESORIA.'}</p><div class="actions"><button type="button" id="print-ticket-now">Cetak / Simpan PDF</button></div></main></body></html>`);
  popup.document.close();
  popup.document.getElementById('print-ticket-now')?.addEventListener('click', () => popup.print());
});

ticketDialog?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-replace-payment-proof]');
  if (!button) return;
  const item = registrationItems.find((entry) => entry.id === button.dataset.replacePaymentProof);
  if (item) void uploadReplacementProof(item, button);
});

document.querySelector('[data-ticket-dialog-close]')?.addEventListener('click', () => {
  if (typeof ticketDialog.close === 'function') ticketDialog.close();
  else ticketDialog.removeAttribute('open');
});

ticketDialog?.addEventListener('click', (event) => {
  if (event.target !== ticketDialog) return;
  if (typeof ticketDialog.close === 'function') ticketDialog.close();
  else ticketDialog.removeAttribute('open');
});

onSnapshot(
  query(collection(db, 'registrations'), where('userId', '==', user.uid), orderBy('createdAt', 'desc')),
  (snapshot) => {
    if (auth.currentUser?.uid !== user.uid) return;
    registrationItems = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.active !== false)
      .sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
    renderRegistrations();
  },
  (error) => {
    registrationList.innerHTML = `<div class="profile-empty"><b>Data belum dapat dimuat.</b><span>${escapeHtml(friendlyFirebaseError(error))}</span></div>`;
  }
);


if (new URLSearchParams(window.location.search).get('complete') === 'required') {
  setAlert('Lengkapi profil terlebih dahulu sebelum membuka form tiket.', 'notice');
}
