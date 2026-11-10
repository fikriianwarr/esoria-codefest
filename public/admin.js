import { serverNow, syncServerClock } from './server-clock.js?v=b74586eaa5ef6110';
import { registrationActions, normalizeOfficialTicket } from './registration-review-policy.js?v=b74586eaa5ef6110';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db, functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import {currentSessionKey} from './single-device-session.js?v=b74586eaa5ef6110';
import {
  formatWib,
  wibDateTimeLocalValue,
  wibDateValue,
  wibIsoFromParts,
  wibMonthValue
} from './time-utils.js?v=b74586eaa5ef6110';
import {
  archiveParticipant,
  getProofDownloadUrl,
  purgePaymentProof,
  restoreParticipant,
  restoreRegistration,
  reviewProfileEditRequest,
  reviewRegistration,
  savePeriod,
  deletePeriod,
  softDeleteRegistration,
  updateParticipantProfile,
  bulkReviewRegistrations,
  checkInRegistration,
  rebuildDashboardMetrics
} from './spark-data.js?v=b74586eaa5ef6110';
import {
  calculateAge,
  formatTimestamp,
  friendlyFirebaseError,
  requireAuthenticated
} from './auth-core.js?v=b74586eaa5ef6110';

const { user } = await requireAuthenticated({ adminRequired: true });
await user.getIdTokenResult();
document.body.dataset.adminAccess = 'full';
const PAGE_SIZE = 50;
const state = {
  users: [],
  adminUids: new Set([user.uid]),
  registrations: [],
  periods: [],
  periodSlots: [],
  auditLogs: [],
  editRequests: [],
  activeTab: 'users',
  search: '',
  filter: 'all',
  sort: 'newest',
  cursors: { users: null, registrations: null, auditLogs: null, editRequests: null },
  hasMore: { users: true, registrations: true, auditLogs: true, editRequests: true },
  loading: { users: false, registrations: false, periods: false, auditLogs: false, editRequests: false },
  metrics: { users: 0, registrations: 0, pending: 0, verified: 0, editRequests: 0 },
  selectedRegistrations: new Set()
};


const userList = document.querySelector('#admin-user-list');
const registrationList = document.querySelector('#admin-registration-list');
const periodList = document.querySelector('#admin-period-list');
const auditList = document.querySelector('#admin-audit-list');
const profileRequestList = document.querySelector('#admin-profile-request-list');
const detailDialog = document.querySelector('#admin-detail-dialog');
const editDialog = document.querySelector('#admin-edit-dialog');
const editForm = document.querySelector('#admin-edit-form');
const profileRequestDialog = document.querySelector('#admin-profile-request-dialog');
const reviewDialog = document.querySelector('#admin-review-dialog');
const reviewForm = document.querySelector('#admin-review-form');
const confirmDialog = document.querySelector('#admin-confirm-dialog');
const bulkDialog = document.querySelector('#admin-bulk-dialog');
const bulkForm = document.querySelector('#admin-bulk-form');
const bulkBar = document.querySelector('#admin-bulk-review-bar');
const periodForm = document.querySelector('#admin-period-form');
let periodEditMode = 'view';
let periodEditingId = '';
let periodExpectedRevision = 0;
const getStoredPeriod = (id) => state.periods.find((item) => item.id === id);
const periodStateNotice = document.querySelector('#period-edit-state');
const applyPeriodMode = (mode, item = null) => {
  periodEditMode = mode;
  periodEditingId = mode === 'edit' ? String(item?.id || '') : '';
  periodExpectedRevision = mode === 'edit' ? Number(item?.revision || 0) : 0;
  const editing = mode !== 'view';
  periodForm.dataset.editMode = mode;
  periodForm.classList.toggle('is-editable', editing);
  for (const field of periodForm.querySelectorAll('#period-status, [data-capacity], [data-enabled-package-wave]')) {
    field.disabled = !editing || (field.matches('[data-capacity]') && !periodForm.querySelector(`[data-enabled-package-wave="${field.dataset.capacity}"]`)?.checked);
  }
  const month = periodForm.querySelector('#period-month');
  month.disabled = mode === 'edit';
  const save = periodForm.querySelector('.admin-save-button');
  save.disabled = !editing;
  save.textContent = mode === 'create' ? 'Tinjau Periode Baru →' : mode === 'edit' ? 'Tinjau Perubahan →' : 'Pilih Edit Periode';
  document.querySelector('#period-cancel-edit').hidden = !editing;
  document.querySelector('#period-new').hidden = editing;
  document.querySelector('#period-edit-current').hidden = editing;
  const canDelete = mode === 'edit' && item?.status === 'draft';
  document.querySelector('#period-delete-current').hidden = !canDelete;
  periodStateNotice.textContent = mode === 'create'
    ? 'Membuat periode baru. Bulan yang sudah ada tidak dapat dibuat ulang.'
    : mode === 'edit' ? `Mengedit ${periodEditingId}. Simpan perubahan setelah pemeriksaan dan konfirmasi.`
    : 'Mode lihat. Pilih Edit Periode untuk membuka perubahan atau Buat Periode Baru.';
  if (editing) syncAllPeriodControls();
};

const toolbar = document.querySelector('.admin-toolbar');
const filterControl = document.querySelector('#admin-filter');
const sortControl = document.querySelector('#admin-sort');
const searchControl = document.querySelector('#admin-search');
const toast = document.querySelector('#admin-toast');
let pendingConfirmation = null;
toolbar.dataset.mode = state.activeTab;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);
const timestampValue = (value) => value?.seconds ? value.seconds * 1000 : (value?.toMillis?.() || (value ? new Date(value).getTime() : 0));
const localDateValue = wibDateValue;
const dateTimeLocalValue = wibDateTimeLocalValue;
const normalizeIndonesianPhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '+62';
  const subscriber = digits.startsWith('62') ? digits.slice(2) : (digits.startsWith('0') ? digits.slice(1) : digits);
  return `+62${subscriber.slice(0, 13)}`;
};
const statusLabel = (status) => ({ menunggu: 'Sedang diproses', terverifikasi: 'Diterima / ACC', ditolak: 'Ditolak' })[status] || 'Sedang diproses';
const paymentLabel = (status) => ({ belum_diperiksa: 'Belum diperiksa', sesuai: 'Pembayaran sesuai', bermasalah: 'Pembayaran bermasalah' })[status] || 'Belum diperiksa';
const normalizeTicket = normalizeOfficialTicket;


const PERIOD_MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const localIso = wibIsoFromParts;
const formatTemplateDate = (iso) => formatWib(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const buildMonthlyPeriodTemplate = (monthValue) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue || '')) return null;
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const previousMonthLastDay = new Date(year, monthIndex, 0).getDate();
  const registrationOpenAt = localIso(year, monthIndex - 1, 20, 0, 1);
  const wave01RegistrationCloseAt = localIso(year, monthIndex - 1, previousMonthLastDay, 23, 59);
  const wave02RegistrationOpenAt = localIso(year, monthIndex, 5, 0, 1);
  const registrationCloseAt = localIso(year, monthIndex, 14, 23, 59);
  const wave01StartsAt = localIso(year, monthIndex, 1, 0, 1);
  const wave01ClosesAt = localIso(year, monthIndex, 8, 18, 0);
  const wave02StartsAt = localIso(year, monthIndex, 15, 0, 1);
  const wave02ClosesAt = localIso(year, monthIndex, 22, 18, 0);
  const categorySchedules = {
    web: {
      'wave-01': { startsAt: wave01StartsAt, deadlineAt: localIso(year, monthIndex, 3, 23, 59), announcementAt: localIso(year, monthIndex, 4, 20, 0) },
      'wave-02': { startsAt: wave02StartsAt, deadlineAt: localIso(year, monthIndex, 17, 23, 59), announcementAt: localIso(year, monthIndex, 18, 20, 0) }
    },
    cyber: {
      'wave-01': { startsAt: wave01StartsAt, deadlineAt: localIso(year, monthIndex, 3, 23, 59), announcementAt: localIso(year, monthIndex, 4, 20, 0) },
      'wave-02': { startsAt: wave02StartsAt, deadlineAt: localIso(year, monthIndex, 17, 23, 59), announcementAt: localIso(year, monthIndex, 18, 20, 0) }
    },
    team: {
      'wave-01': { startsAt: wave01StartsAt, deadlineAt: localIso(year, monthIndex, 7, 23, 59), announcementAt: localIso(year, monthIndex, 8, 20, 0) },
      'wave-02': { startsAt: wave02StartsAt, deadlineAt: localIso(year, monthIndex, 21, 23, 59), announcementAt: localIso(year, monthIndex, 22, 20, 0) }
    }
  };
  return {
    periodId: monthValue,
    label: `Esoria CodeFest ${PERIOD_MONTH_NAMES[monthIndex]} ${year}`,
    registrationOpenAt,
    registrationCloseAt,
    competitionStartAt: wave01StartsAt,
    announcementAt: categorySchedules.team['wave-02'].announcementAt,
    wave01RegistrationOpenAt: registrationOpenAt,
    wave01RegistrationCloseAt,
    wave02RegistrationOpenAt,
    wave02RegistrationCloseAt: registrationCloseAt,
    wave01StartsAt,
    wave01ClosesAt,
    wave02StartsAt,
    wave02ClosesAt,
    waves: {
      'wave-01': { label: 'Gelombang Awal', enabled: true, startsAt: wave01StartsAt, closesAt: wave01ClosesAt, registrationOpenAt, registrationCloseAt: wave01RegistrationCloseAt },
      'wave-02': { label: 'Gelombang Pertengahan', enabled: true, startsAt: wave02StartsAt, closesAt: wave02ClosesAt, registrationOpenAt: wave02RegistrationOpenAt, registrationCloseAt }
    },
    categorySchedules,
    templateId: 'monthly-3-arena-v1'
  };
};
const updatePeriodTemplatePreview = () => {
  const monthInput = document.querySelector('#period-month');
  const template = buildMonthlyPeriodTemplate(monthInput?.value || '');
  if (!template) return;
  document.querySelector('#period-id').value = template.periodId;
  document.querySelector('#period-label').value = template.label;
  document.querySelector('#period-preview-registration').textContent = `${formatTemplateDate(template.wave01RegistrationOpenAt)} — ${formatTemplateDate(template.wave02RegistrationCloseAt)}`;
  document.querySelector('#period-preview-wave1').textContent = `DAFTAR ${formatTemplateDate(template.wave01RegistrationOpenAt)} – ${formatTemplateDate(template.wave01RegistrationCloseAt)} · LOMBA 01–08`;
  document.querySelector('#period-preview-wave2').textContent = `DAFTAR ${formatTemplateDate(template.wave02RegistrationOpenAt)} – ${formatTemplateDate(template.wave02RegistrationCloseAt)} · LOMBA 15–22`;
  const shortDate = (iso) => formatWib(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  document.querySelectorAll('[data-wave-schedule]').forEach((label) => {
    const [category, wave] = label.dataset.waveSchedule.split('_');
    const start = template.categorySchedules[category]?.[wave]?.startsAt;
    const end = template.categorySchedules[category]?.[wave]?.announcementAt;
    label.textContent = `${shortDate(start)} – ${shortDate(end)} WIB`;
  });
};

const showToast = (message, type = 'success') => {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
};
const showDialog = (dialog) => typeof dialog.showModal === 'function' ? dialog.showModal() : dialog.setAttribute('open', '');
const closeDialog = (dialog) => typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open');
const sortItems = (items, type) => [...items].sort((a, b) => {
  if (type === 'name') return (a.participantName || a.displayName || a.userName || a.email || '').localeCompare(b.participantName || b.displayName || b.userName || b.email || '', 'id', { sensitivity: 'base' });
  const difference = timestampValue(a.createdAt || a.requestedAt || a.updatedAt) - timestampValue(b.createdAt || b.requestedAt || b.updatedAt);
  return type === 'oldest' ? difference : -difference;
});

const filteredUsers = () => sortItems(state.users.filter((item) => {
  if (state.adminUids.has(item.uid || item.id) || item.role === 'admin') return false;
  const haystack = [item.participantName, item.legalName, item.displayName, item.email, item.phone, item.city, item.province, item.institution, item.primarySkill, item.preferredTrack].join(' ').toLowerCase();
  const matchesFilter = state.filter === 'all'
    || (state.filter === 'complete' && item.profileComplete === true)
    || (state.filter === 'incomplete' && item.profileComplete !== true)
    || (state.filter === 'archived' && item.archived === true);
  return haystack.includes(state.search) && matchesFilter;
}), state.sort);

const filteredRegistrations = () => sortItems(state.registrations.filter((item) => {
  const haystack = [item.referenceNumber, item.userName, item.userEmail, item.packageLabel, item.periodLabel, item.waveLabel, item.statusLabel, item.ticketNumber, item.senderName, item.teamName].join(' ').toLowerCase();
  const matchesFilter = state.filter === 'all'
    || item.status === state.filter
    || (state.filter === 'deleted' && item.active === false)
    || item.periodId === state.filter;
  return haystack.includes(state.search) && matchesFilter;
}), state.sort);

const filteredAuditLogs = () => sortItems(state.auditLogs.filter((item) => {
  const details = item.details && typeof item.details === 'object' ? JSON.stringify(item.details) : String(item.details || '');
  const haystack = [item.action, item.targetType, item.targetId, item.actorEmail, item.actorUid, details].join(' ').toLowerCase();
  const matchesFilter = state.filter === 'all' || item.targetType === state.filter;
  return haystack.includes(state.search) && matchesFilter;
}), state.sort);

const readableReviewNote = (value) => ({'Menunggu peninjauan admin demo.':'Menunggu pemeriksaan panitia.','Perubahan contoh ditolak untuk menguji alur penolakan.':'Alasan penolakan lama memerlukan pemeriksaan ulang.'})[value] || value;
const filteredEditRequests = () => sortItems(state.editRequests.filter((item) => {
  const haystack = [item.userName, item.userEmail, item.reason, item.reviewNote, item.status].join(' ').toLowerCase();
  const matchesFilter = state.filter === 'all' || item.status === state.filter;
  return haystack.includes(state.search) && matchesFilter;
}), state.sort);

const updateMetrics = () => {
  document.querySelector('#metric-users').textContent = String(state.metrics.users);
  document.querySelector('#metric-registrations').textContent = String(state.metrics.registrations);
  document.querySelector('#metric-pending').textContent = String(state.metrics.pending);
  document.querySelector('#metric-verified').textContent = String(state.metrics.verified);
  document.querySelector('#metric-edit-requests').textContent = String(state.metrics.editRequests);
  const requestBadge = document.querySelector('#admin-request-tab-count');
  requestBadge.textContent = String(state.metrics.editRequests);
  requestBadge.hidden = state.metrics.editRequests <= 0;
};

const loadMetrics = async () => {
  updateMetrics();
};

const loadMoreButton = (type) => {
  const hasMore = Boolean(type && state.hasMore[type]);
  return `<div class="admin-live-note"><span>Data pada daftar ini menampilkan pembaruan terbaru selama sesi admin aktif.</span>${hasMore ? `<button data-load-more="${escapeHtml(type)}" type="button">Muat 50 data berikutnya →</button>` : '<b>Seluruh data yang tersedia sudah ditampilkan.</b>'}</div>`;
};

const renderUsers = () => {
  const items = filteredUsers();
  if (!items.length) {
    userList.innerHTML = '<div class="admin-empty"><b>Data peserta tidak ditemukan.</b><span>Ubah pencarian atau filter untuk menampilkan data lainnya.</span></div>' + loadMoreButton('users');
    return;
  }

  const registrationCountByUser = new Map();
  state.registrations.forEach((entry) => {
    if (!entry?.userId || entry.active === false) return;
    registrationCountByUser.set(entry.userId, (registrationCountByUser.get(entry.userId) || 0) + 1);
  });

  const latestEditRequestByUser = new Map();
  state.editRequests.forEach((entry) => {
    const key = entry?.userId || entry?.id;
    if (!key || latestEditRequestByUser.has(key)) return;
    latestEditRequestByUser.set(key, entry);
  });

  userList.innerHTML = items.map((item) => {
    const uid = item.uid || item.id;
    const name = item.participantName || item.legalName || item.displayName || 'Nama belum dilengkapi';
    const age = calculateAge(item.birthDate);
    const registrations = registrationCountByUser.get(uid) || 0;
    const editRequest = latestEditRequestByUser.get(uid);
    const profileState = item.archived
      ? 'Akun diarsipkan'
      : editRequest?.status === 'pending'
        ? 'Permintaan perubahan menunggu'
        : editRequest?.status === 'approved'
          ? 'Akses edit dibuka'
          : item.profileComplete ? 'Profil lengkap & terkunci' : 'Profil belum lengkap';
    const accountAction = item.archived
      ? `<button class="restore" data-restore-user="${escapeHtml(uid)}" type="button">Pulihkan</button>`
      : `<button class="danger" data-archive-user="${escapeHtml(uid)}" type="button">Arsipkan</button>`;
    return `<article class="admin-user-card" data-archived="${Boolean(item.archived)}"><div class="admin-user-avatar">${escapeHtml(name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'E')}</div><div class="admin-user-main"><span>${escapeHtml(profileState)}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(item.email || 'Email tidak tersedia')}</p></div><div class="admin-user-meta"><span><small>DOMISILI</small><b>${escapeHtml(item.city || item.province || '—')}</b></span><span><small>UMUR</small><b>${age ?? '—'}</b></span><span><small>TIKET AKTIF</small><b>${registrations}</b></span></div><div class="admin-card-actions"><button data-view-user="${escapeHtml(uid)}" type="button">Detail</button><button class="edit" data-edit-user="${escapeHtml(uid)}" type="button">Edit</button>${accountAction}</div></article>`;
  }).join('') + loadMoreButton('users');
};

const updateBulkBar = () => {
  const count = state.selectedRegistrations.size;
  if (!bulkBar) return;
  bulkBar.hidden = count === 0;
  const countNode = document.querySelector('#admin-bulk-count');
  if (countNode) countNode.textContent = String(count);
};

const renderRegistrations = () => {
  const items = filteredRegistrations();
  if (!items.length) {
    registrationList.innerHTML = '<div class="admin-empty"><b>Pendaftaran tidak ditemukan.</b><span>Ubah pencarian atau filter untuk menampilkan data lainnya.</span></div>' + loadMoreButton('registrations');
    return;
  }
  registrationList.innerHTML = items.map((item) => {
    const policy = registrationActions(item);
    if (policy.accepted || !policy.active) state.selectedRegistrations.delete(item.id);
    const selected = !policy.accepted && state.selectedRegistrations.has(item.id);
    const reference = item.referenceNumber || 'Referensi belum tersedia';
    const checkedInNote = item.checkedIn === true ? `Check-in ${formatTimestamp(item.checkedInAt)}` : '';
    const statusNote = checkedInNote || item.rejectionReason || (policy.accepted ? 'Pembayaran disetujui dan tiket aktif.' : readableReviewNote(item.adminNotes) || 'Belum ada catatan pemeriksaan.');
    const officialTicket = item.ticketNumber || 'Belum diterbitkan';
    const checkInAction = policy.mayCheckIn
      ? `<button class="checkin" data-checkin-registration="${escapeHtml(item.id)}" data-checkin-state="false" type="button">Check-in</button>`
      : policy.mayCancelCheckIn
        ? `<button class="checkin" data-checkin-registration="${escapeHtml(item.id)}" data-checkin-state="true" type="button">Batal Check-in</button>` : '';
    const statusAction = !policy.active ? `<button class="edit" data-restore-registration="${escapeHtml(item.id)}" type="button">Pulihkan</button>`
      : policy.accepted ? `${policy.checkedIn ? '' : `<button class="edit" data-cancel-acc="${escapeHtml(item.id)}" type="button">Batalkan ACC</button>`}${policy.needsTicketRepair ? `<button class="edit" data-repair-ticket="${escapeHtml(item.id)}" ${policy.checkedIn ? 'disabled title="Batalkan check-in terlebih dahulu"' : ''} type="button">Perbaiki Tiket</button>` : ''}`
      : `<button class="edit" data-review-registration="${escapeHtml(item.id)}" type="button">${item.status === 'ditolak' ? 'Tinjau Ulang' : 'Review / ACC'}</button>`;
    const archiveAction = policy.active ? `<button class="danger" data-delete-registration="${escapeHtml(item.id)}" type="button" ${policy.mayArchive ? '' : 'disabled title="Batalkan check-in, lalu batalkan ACC sebelum mengarsipkan"'}>Arsipkan</button>` : '';
    return `<article class="admin-registration-card" data-active="${policy.active}" data-checked-in="${policy.checkedIn}" data-selected="${selected}" data-status="${escapeHtml(item.status || 'menunggu')}"><label class="admin-registration-select" title="${policy.accepted ? 'ACC aktif: batalkan ACC sebelum review kembali' : 'Pilih untuk pemeriksaan massal'}"><input ${selected ? 'checked' : ''} data-select-registration="${escapeHtml(item.id)}" ${!policy.active || policy.accepted ? 'disabled' : ''} type="checkbox"><span class="sr-only">Pilih pendaftaran ${escapeHtml(reference)}</span></label><div class="admin-registration-code"><small>REFERENSI</small><span>${escapeHtml(reference)}</span><small>TIKET RESMI</small><b>${escapeHtml(officialTicket)}</b>${policy.needsTicketRepair ? '<em class="admin-ticket-warning">Perlu perbaikan nomor</em>' : ''}${item.checkedIn === true ? '<i>CHECKED IN</i>' : ''}</div><div class="admin-registration-person"><span class="admin-category-tag">${escapeHtml(item.periodLabel || item.periodId || 'Periode')} / ${escapeHtml(item.packageLabel || 'Kategori')}</span><h3>${escapeHtml(item.userName || 'Peserta')}</h3><p>${escapeHtml(item.userEmail || '')} · ${escapeHtml(item.waveLabel || '')}</p></div><div class="admin-payment-facts"><span><small>NOMINAL</small><b>${escapeHtml(item.amount || '—')}</b></span><span><small>PEMBAYARAN</small><b>${escapeHtml(paymentLabel(item.paymentStatus))}</b></span><span><small>DIKIRIM</small><b>${escapeHtml(formatTimestamp(item.createdAt))}</b></span></div><div class="admin-registration-review-summary"><span>${escapeHtml(statusLabel(item.status))}</span><small>${escapeHtml(statusNote)}</small></div><div class="admin-card-actions"><button data-view-registration="${escapeHtml(item.id)}" type="button">Detail</button>${checkInAction}${statusAction}${archiveAction}</div></article>`;
  }).join('') + loadMoreButton('registrations');
  updateBulkBar();
};

const periodStatusText = (status) => ({ draft: 'Draft', open: 'Open', full: 'Full', closed: 'Closed', completed: 'Completed' })[status] || status;
const PERIOD_PACKAGE_META = {
  web: { code: 'WEB', label: 'Website Programming', accent: 'blue' },
  cyber: { code: 'CYBER', label: 'Cybersecurity Mini CTF', accent: 'red' },
  team: { code: 'TEAM', label: 'Full Stack Development Team', accent: 'green' }
};
const liveWaveLabel = (period, packageId, waveId, enabled, count, capacity) => {
  if (!enabled) return 'DINONAKTIFKAN';
  if (period.status !== 'open') return 'BELUM DIBUKA';
  const wave = period.packages?.[packageId]?.waves?.[waveId] || period.waves?.[waveId] || {};
  const now = serverNow();
  const start = timestampValue(wave.registrationOpenAt || period.registrationOpenAt);
  const end = timestampValue(wave.registrationCloseAt || period.registrationCloseAt);
  if (now < start) return 'TERJADWAL';
  if (now > end) return 'DITUTUP';
  if (capacity > 0 && count >= capacity) return 'KUOTA PENUH';
  return 'PENDAFTARAN DIBUKA';
};
const periodWaveEnabled = (period, packageId, waveId) => {
  const packageData = period.packages?.[packageId] || {};
  const packageWave = packageData.waves?.[waveId];
  const slot = period.slots?.[`${packageId}_${waveId}`];
  if (typeof packageWave?.enabled === 'boolean') return packageWave.enabled;
  if (typeof slot?.enabled === 'boolean') return slot.enabled;
  return packageData.enabled !== false && period.waves?.[waveId]?.enabled !== false;
};
const renderPeriods = () => {
  if (!state.periods.length) {
    periodList.innerHTML = '<div class="admin-empty"><b>Belum ada periode.</b><span>Pilih bulan, aktifkan gelombang, lalu simpan pengaturan pertama.</span></div>';
    return;
  }
  periodList.innerHTML = state.periods.map((item) => {
    const categoryCards = Object.entries(PERIOD_PACKAGE_META).map(([packageId, meta]) => {
      const packageData = item.packages?.[packageId] || {};
      const waves = ['wave-01', 'wave-02'].map((waveId) => {
        const key = `${packageId}_${waveId}`;
        const enabled = periodWaveEnabled(item, packageId, waveId);
        const count = Number(item.counts?.[key] ?? item.slots?.[key]?.count ?? 0);
        const capacity = Number(item.capacities?.[key] ?? item.slots?.[key]?.capacity ?? packageData.waves?.[waveId]?.capacity ?? 0);
        const schedule = item.categorySchedules?.[packageId]?.[waveId] || packageData.waves?.[waveId] || {};
        const start = schedule.startsAt || item.waves?.[waveId]?.startsAt;
        const finish = schedule.announcementAt || schedule.deadlineAt || item.waves?.[waveId]?.closesAt;
        const regStart = schedule.registrationOpenAt || item.waves?.[waveId]?.registrationOpenAt || item.registrationOpenAt;
        const regEnd = schedule.registrationCloseAt || item.waves?.[waveId]?.registrationCloseAt || item.registrationCloseAt;
        const stateLabel = liveWaveLabel(item, packageId, waveId, enabled, count, capacity);
        return `<article class="period-record-wave" data-enabled="${enabled}"><header><div><b>${waveId === 'wave-01' ? 'W01' : 'W02'}</b><span>${waveId === 'wave-01' ? 'Gelombang Awal' : 'Gelombang Tengah'}</span></div><i>${escapeHtml(stateLabel)}</i></header><div class="period-record-wave-meter"><strong>${count}</strong><span>dari ${capacity} slot</span></div><small><b>Daftar:</b> ${escapeHtml(formatTimestamp(regStart))} – ${escapeHtml(formatTimestamp(regEnd))}<br><b>Lomba:</b> ${escapeHtml(formatTimestamp(start))} – ${escapeHtml(formatTimestamp(finish))}</small></article>`;
      }).join('');
      const enabledCount = ['wave-01', 'wave-02'].filter((waveId) => periodWaveEnabled(item, packageId, waveId)).length;
      return `<article class="period-record-category" data-accent="${meta.accent}" data-enabled="${enabledCount > 0}"><header><div><span>${meta.code}</span><b>${enabledCount}/2 WAVE DIIZINKAN</b></div></header><h4>${escapeHtml(packageData.label || meta.label)}</h4><div class="period-record-waves">${waves}</div></article>`;
    }).join('');
    const activeRegistrations = Object.values(item.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    return `<section class="admin-period-record" data-status="${escapeHtml(item.status)}"><header class="period-record-head"><div><span>${escapeHtml(periodStatusText(item.status).toUpperCase())}</span><h3>${escapeHtml(item.label || item.id)}</h3><p>${escapeHtml(item.id)} · ${escapeHtml(formatTimestamp(item.registrationOpenAt))} — ${escapeHtml(formatTimestamp(item.registrationCloseAt))}</p></div><button class="period-open-editor" data-edit-period="${escapeHtml(item.id)}" type="button">Edit Seluruh Periode →</button></header><div class="period-record-summary"><span><b>3</b>Kategori</span><span><b>6</b>Slot gelombang</span><span><b>${activeRegistrations}</b>Pendaftar aktif</span></div><div class="period-record-category-grid">${categoryCards}</div></section>`;
  }).join('');
};

const AUDIT_ACTION_LABELS = {
  'period.deleted': 'Draft periode dihapus',
  'period.created': 'Periode dibuat',
  'period.updated': 'Periode diperbarui',
  'registration.reviewed': 'Pendaftaran ditinjau',
  'registration.soft_deleted': 'Pendaftaran diarsipkan',
  'registration.restored': 'Pendaftaran dipulihkan',
  'payment_proof.purged': 'Bukti pembayaran dihapus',
  'profile_edit.requested': 'Permintaan edit profil dikirim',
  'profile_edit.approved': 'Perubahan profil disetujui',
  'profile_edit.rejected': 'Perubahan profil ditolak',
  'participant.archived': 'Peserta diarsipkan',
  'participant.restored': 'Peserta dipulihkan'
};
const AUDIT_TARGET_LABELS = {
  period: 'Periode kompetisi',
  registration: 'Pendaftaran',
  profileEditRequest: 'Permintaan edit profil',
  user: 'Akun peserta'
};
const AUDIT_STATUS_LABELS = {
  draft: 'Draft', open: 'Dibuka', full: 'Penuh', closed: 'Ditutup', completed: 'Selesai',
  menunggu: 'Sedang diproses', terverifikasi: 'Diterima / ACC', ditolak: 'Ditolak',
  belum_diperiksa: 'Belum diperiksa', sesuai: 'Pembayaran sesuai', bermasalah: 'Pembayaran bermasalah'
};
const AUDIT_CAPACITY_LABELS = {
  'web_wave-01': 'Website · Wave 01', 'web_wave-02': 'Website · Wave 02',
  'cyber_wave-01': 'Cybersecurity · Wave 01', 'cyber_wave-02': 'Cybersecurity · Wave 02',
  'team_wave-01': 'Full Stack Team · Wave 01', 'team_wave-02': 'Full Stack Team · Wave 02'
};
const humanizeAuditKey = (key = '') => ({
  status: 'Status', paymentStatus: 'Pembayaran', ticketNumber: 'Nomor tiket',
  participantUid: 'UID peserta', attemptCount: 'Pengajuan ke-', reason: 'Alasan peserta', reviewNote: 'Catatan admin',
  retainedSha256: 'Hash bukti', authAccountDisabled: 'Akun Auth dinonaktifkan'
})[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());
const formatAuditValue = (key, value) => {
  if (value === true) return 'Ya';
  if (value === false) return 'Tidak';
  if (value == null || value === '') return '—';
  if (key === 'status' || key === 'paymentStatus') return AUDIT_STATUS_LABELS[value] || String(value);
  return String(value);
};
const auditFacts = (item) => {
  const details = item.details && typeof item.details === 'object' ? item.details : {};
  const facts = [];
  if (details.capacities && typeof details.capacities === 'object') {
    Object.entries(details.capacities).forEach(([key, value]) => {
      facts.push([AUDIT_CAPACITY_LABELS[key] || humanizeAuditKey(key), `${value} slot`]);
    });
  }
  Object.entries(details).forEach(([key, value]) => {
    if (key === 'capacities' || typeof value === 'object') return;
    facts.push([humanizeAuditKey(key), formatAuditValue(key, value)]);
  });
  return facts.slice(0, 8);
};

const renderAuditLogs = () => {
  const items = filteredAuditLogs();
  if (!items.length) {
    auditList.innerHTML = '<div class="admin-empty"><b>Audit log tidak ditemukan.</b><span>Ubah pencarian atau muat data berikutnya.</span></div>' + loadMoreButton('auditLogs');
    return;
  }
  auditList.innerHTML = items.map((item) => {
    const facts = auditFacts(item);
    const details = facts.length
      ? `<div class="admin-audit-facts">${facts.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join('')}</div>`
      : '<p class="admin-audit-note">Tidak ada rincian tambahan.</p>';
    const action = AUDIT_ACTION_LABELS[item.action] || humanizeAuditKey(item.action || 'Aktivitas sistem');
    const target = AUDIT_TARGET_LABELS[item.targetType] || humanizeAuditKey(item.targetType || 'Data');
    const userTarget = item.targetType === 'profileEditRequest' || item.targetType === 'user'
      ? state.users.find((userRow) => (userRow.uid || userRow.id) === item.targetId)
      : null;
    const friendlyTarget = userTarget?.participantName || userTarget?.displayName || userTarget?.email || (item.targetType === 'profileEditRequest' ? 'Permintaan perubahan profil peserta' : item.targetId || '—');
    return `<article class="admin-audit-card"><div class="admin-audit-main"><span>${escapeHtml(action)}</span><h3>${escapeHtml(target)}</h3><p class="admin-audit-target">${escapeHtml(friendlyTarget)}</p>${details}</div><aside><b>${escapeHtml(item.actorEmail || item.actorUid || 'Sistem')}</b><small>${escapeHtml(formatTimestamp(item.createdAt))}</small></aside></article>`;
  }).join('') + loadMoreButton('auditLogs');
};

const editRequestStatusLabel = (status) => ({ pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', completed: 'Selesai' })[status] || status;
const renderEditRequests = () => {
  const items = filteredEditRequests();
  if (!items.length) {
    profileRequestList.innerHTML = '<div class="admin-empty"><b>Tidak ada permintaan edit.</b><span>Permintaan peserta akan tampil pada antrean ini.</span></div>' + loadMoreButton('editRequests');
    return;
  }
  profileRequestList.innerHTML = items.map((item) => {
    const userData = state.users.find((entry) => (entry.uid || entry.id) === item.userId);
    const name = userData?.participantName || item.userName || 'Peserta Esoria';
    const status = item.status || 'pending';
    const actions = status === 'pending'
      ? `<button class="edit" data-review-profile-request="${escapeHtml(item.userId)}" type="button">Tinjau Request</button>`
      : `<button data-view-profile-request="${escapeHtml(item.userId)}" type="button">Lihat Keputusan</button>`;
    return `<article class="admin-profile-request-card" data-status="${escapeHtml(status)}"><div class="admin-request-index"><span>${escapeHtml(String(item.attemptCount || 1).padStart(2, '0'))}</span><b>REQ</b></div><div class="admin-request-identity"><span>PROFILE CHANGE / ${escapeHtml(editRequestStatusLabel(status).toUpperCase())}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(item.userEmail || userData?.email || '')}</p></div><div class="admin-request-message"><small>ALASAN PESERTA</small><p>${escapeHtml(item.reason || 'Tidak ada alasan')}</p>${item.reviewNote ? `<em>Catatan admin: ${escapeHtml(readableReviewNote(item.reviewNote))}</em>` : ''}</div><div class="admin-request-time"><b>${escapeHtml(editRequestStatusLabel(status))}</b><small>${escapeHtml(formatTimestamp(item.updatedAt || item.requestedAt))}</small></div><div class="admin-card-actions">${actions}</div></article>`;
  }).join('') + loadMoreButton('editRequests');
};

const renderAll = () => {
  updateMetrics();
  // Hidden tabs render when opened, rather than rebuilding five lists per event.
  const renderers = { users: renderUsers, editRequests: renderEditRequests, registrations: renderRegistrations, periods: renderPeriods, auditLogs: renderAuditLogs };
  renderers[state.activeTab]?.();
};

const updateFilterOptions = () => {
  let options;
  if (state.activeTab === 'users') options = [['all', 'Semua peserta'], ['complete', 'Profil lengkap'], ['incomplete', 'Profil belum lengkap'], ['archived', 'Diarsipkan']];
  else if (state.activeTab === 'editRequests') options = [['all', 'Semua request'], ['pending', 'Menunggu'], ['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['completed', 'Selesai']];
  else if (state.activeTab === 'registrations') options = [['all', 'Semua pendaftaran'], ['menunggu', 'Sedang diproses'], ['terverifikasi', 'Diterima / ACC'], ['ditolak', 'Ditolak'], ['deleted', 'Diarsipkan'], ...state.periods.map((period) => [period.id, period.label])];
  else if (state.activeTab === 'auditLogs') options = [['all', 'Semua log'], ['registration', 'Pendaftaran'], ['user', 'Peserta'], ['period', 'Periode']];
  else options = [['all', 'Semua periode']];
  filterControl.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
  filterControl.value = options.some(([value]) => value === state.filter) ? state.filter : 'all';
};

const realtimeUnsubscribers = [];
const realtimeInitialized = new Set();
const paginatedTypes = new Set();
const rowOrderField = { users: 'createdAt', registrations: 'createdAt', editRequests: 'updatedAt', auditLogs: 'createdAt' };

const rebuildPeriods = () => {
  state.periods = state.periods.map((period) => {
    const counts = {};
    const capacities = { ...(period.capacities || {}) };
    const slots = {};
    state.periodSlots.filter((slot) => slot.periodId === period.id).forEach((slot) => {
      const key = `${slot.package}_${slot.wave}`;
      counts[key] = Number(slot.count || 0);
      capacities[key] = Number(slot.capacity ?? capacities[key] ?? 0);
      slots[key] = slot;
    });
    return { ...period, counts, capacities, slots };
  });
};

let adminRenderFrame = 0;
const afterRealtimeUpdate = () => {
  if (adminRenderFrame) return;
  adminRenderFrame = requestAnimationFrame(() => {
    adminRenderFrame = 0;
    updateFilterOptions();
    renderAll();
  });
};

const mergeRows = (type, rows) => {
  const map = new Map(state[type].map((item) => [item.id, item]));
  rows.forEach((item) => map.set(item.id, item));
  state[type] = [...map.values()];
};

const subscribeRows = (type, collectionName) => {
  const field = rowOrderField[type];
  const firstPage = query(collection(db, collectionName), orderBy(field, 'desc'), limit(PAGE_SIZE));
  realtimeUnsubscribers.push(onSnapshot(firstPage, (snapshot) => {
    if (realtimeInitialized.has(type)) {
      const additions = snapshot.docChanges().filter((change) => change.type === 'added');
      if (additions.length && type === 'registrations') {
        const latest = additions[0].doc.data();
        showToast(`Pendaftaran baru masuk: ${latest.userName || latest.userEmail || 'peserta'} · ${latest.packageLabel || 'kategori'}.`);
      }
      if (additions.length && type === 'editRequests') {
        const latest = additions[0].doc.data();
        showToast(`Permintaan perubahan profil dari ${latest.userName || latest.userEmail || 'peserta'}.`);
      }
    }
    realtimeInitialized.add(type);
    const headRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    const headIds = new Set(headRows.map((item) => item.id));
    const tailRows = state[type].filter((item) => !headIds.has(item.id));
    state[type] = [...headRows, ...tailRows];
    // A live first page must not move the pagination cursor back over loaded pages.
    if (!paginatedTypes.has(type)) {
      state.cursors[type] = snapshot.docs.at(-1) || null;
      state.hasMore[type] = snapshot.size === PAGE_SIZE;
    }
    afterRealtimeUpdate();
    if (type !== 'auditLogs') queueMetricsRefresh();
  }, (error) => showToast(friendlyFirebaseError(error), 'error')));
};

let metricsRefreshTimer = null;
const queueMetricsRefresh = () => {
  if (metricsRefreshTimer) return;
  metricsRefreshTimer = setTimeout(() => {
    metricsRefreshTimer = null;
    void rebuildDashboardMetrics().catch((error) => {
      console.warn('Pembaruan ringkasan dashboard belum berhasil:', error);
    });
  }, 1500);
};

const startRealtimeAdmin = () => {
  // Separate admin identities from the participant directory. Old user docs
  // are retained for audit but must not be shown or exported as participants.
  realtimeUnsubscribers.push(onSnapshot(collection(db, 'admins'), (snapshot) => {
    state.adminUids = new Set([user.uid, ...snapshot.docs.map((entry) => entry.id)]);
    if (state.activeTab === 'users') renderUsers();
  }, (error) => showToast(friendlyFirebaseError(error), 'error')));
  subscribeRows('users', 'users');
  subscribeRows('editRequests', 'profileEditRequests');
  subscribeRows('registrations', 'registrations');
  subscribeRows('auditLogs', 'auditLogs');
  realtimeUnsubscribers.push(onSnapshot(doc(db, 'system', 'dashboard'), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      state.metrics = {
        users: Number(data.users || 0), registrations: Number(data.registrations || 0),
        pending: Number(data.pending || 0), verified: Number(data.verified || 0),
        editRequests: Number(data.editRequests || 0)
      };
      updateMetrics();
    } else {
      void rebuildDashboardMetrics().catch(() => {});
    }
  }, () => {}));
  realtimeUnsubscribers.push(onSnapshot(collection(db, 'periods'), (snapshot) => {
    state.periods = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (periodEditMode === 'view') {
      const month = document.querySelector('#period-month').value;
      const selected = getStoredPeriod(month);
      if (selected) fillPeriodForm(selected, '', '', false);
    }
    rebuildPeriods();
    afterRealtimeUpdate();
  }, (error) => showToast(friendlyFirebaseError(error), 'error')));
  realtimeUnsubscribers.push(onSnapshot(collection(db, 'periodSlots'), (snapshot) => {
    state.periodSlots = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    rebuildPeriods();
    afterRealtimeUpdate();
  }, (error) => showToast(friendlyFirebaseError(error), 'error')));
};

const loadPage = async (type, append = false) => {
  if (!append || !rowOrderField[type] || !state.hasMore[type] || state.loading[type]) return;
  const cursor = state.cursors[type];
  if (!cursor) return;
  state.loading[type] = true;
  try {
    const collectionName = type === 'editRequests' ? 'profileEditRequests' : type;
    const page = await getDocs(query(collection(db, collectionName), orderBy(rowOrderField[type], 'desc'), startAfter(cursor), limit(PAGE_SIZE)));
    mergeRows(type, page.docs.map((item) => ({ id: item.id, ...item.data() })));
    paginatedTypes.add(type);
    state.cursors[type] = page.docs.at(-1) || cursor;
    state.hasMore[type] = page.size === PAGE_SIZE;
    afterRealtimeUpdate();
  } catch (error) {
    showToast(friendlyFirebaseError(error), 'error');
  } finally {
    state.loading[type] = false;
  }
};

const refreshRegistrations = async () => {
  afterRealtimeUpdate();
};

const openUserDetail = (uid) => {
  const item = state.users.find((entry) => (entry.uid || entry.id) === uid);
  if (!item) return;
  const related = state.registrations.filter((entry) => entry.userId === uid);
  const name = item.participantName || item.legalName || item.displayName || 'Profil Peserta';
  detailDialog.querySelector('[data-dialog-content]').innerHTML = `<div class="admin-detail-head"><span>PARTICIPANT DOSSIER</span><h2>${escapeHtml(name)}</h2><p>${escapeHtml(item.email || '')}</p></div><div class="admin-detail-grid"><span><small>UID</small><b>${escapeHtml(uid)}</b></span><span><small>Email terverifikasi</small><b>${item.emailVerified ? 'Ya' : 'Belum'}</b></span><span><small>Nama legal</small><b>${escapeHtml(item.legalName || name)}</b></span><span><small>Umur</small><b>${calculateAge(item.birthDate) ?? '—'}</b></span><span><small>Telepon</small><b>${escapeHtml(item.phone || '—')}</b></span><span><small>Status utama</small><b>${escapeHtml(item.occupation || '—')}</b></span><span><small>Instansi</small><b>${escapeHtml(item.institution || '—')}</b></span><span><small>Domisili</small><b>${escapeHtml(`${item.city || '—'}, ${item.province || '—'}`)}</b></span><span><small>Keahlian</small><b>${escapeHtml(item.primarySkill || '—')}</b></span><span><small>Tingkat</small><b>${escapeHtml(item.experienceLevel || '—')}</b></span><span class="wide"><small>Alamat</small><b>${escapeHtml(item.address || '—')}</b></span><span class="wide"><small>Portfolio</small><b>${escapeHtml(item.portfolioUrl || '—')}</b></span><span class="wide"><small>Bio</small><b>${escapeHtml(item.bio || '—')}</b></span></div><div class="admin-related-forms"><h3>Riwayat Pendaftaran (${related.length})</h3>${related.length ? related.map((entry) => `<article><b>${escapeHtml(entry.periodLabel || entry.periodId)} / ${escapeHtml(entry.packageLabel)}</b><span>${escapeHtml(entry.ticketNumber || entry.referenceNumber || 'Belum ada nomor')} · ${escapeHtml(statusLabel(entry.status))}</span></article>`).join('') : '<p>Belum ada pendaftaran pada data yang dimuat.</p>'}</div>`;
  showDialog(detailDialog);
};

let activeProofUrl = '';
let proofRequestEpoch = 0;
const openRegistrationDetail = async (id) => {
  const epoch = ++proofRequestEpoch;
  if (activeProofUrl) { URL.revokeObjectURL(activeProofUrl); activeProofUrl = ''; }
  const item = state.registrations.find((entry) => entry.id === id);
  if (!item) return;
  const members = Array.isArray(item.teamMembers) ? item.teamMembers.map((member) => `${member.name} — ${member.role} — ${member.email}`).join('\n') : item.teamMembers || '';
  detailDialog.querySelector('[data-dialog-content]').innerHTML = `<div class="admin-detail-head"><span>TICKET DECISION FILE</span><h2>${escapeHtml(item.packageLabel || 'Pendaftaran Lomba')}</h2><p>${escapeHtml(item.referenceNumber || item.id)}</p></div><div class="admin-detail-grid"><span><small>Periode</small><b>${escapeHtml(item.periodLabel || item.periodId || '—')}</b></span><span><small>Status</small><b>${escapeHtml(statusLabel(item.status))}</b></span><span><small>Nomor tiket</small><b>${escapeHtml(item.ticketNumber || 'Belum ditetapkan')}</b></span><span><small>Pembayaran</small><b>${escapeHtml(paymentLabel(item.paymentStatus))}</b></span><span><small>Peserta</small><b>${escapeHtml(item.userName || '—')}</b></span><span><small>Email</small><b>${escapeHtml(item.userEmail || '—')}</b></span><span><small>Gelombang</small><b>${escapeHtml(item.waveLabel || '—')}</b></span><span><small>Nominal</small><b>${escapeHtml(item.amount || '—')}</b></span><span><small>Keahlian</small><b>${escapeHtml(item.skillStack || '—')}</b></span><span><small>Nama tim</small><b>${escapeHtml(item.teamName || '—')}</b></span>${members ? `<span class="wide"><small>Anggota tim</small><b class="preserve-lines">${escapeHtml(members)}</b></span>` : ''}<span><small>Tanggal transfer</small><b>${escapeHtml(item.transferDate || '—')}</b></span><span><small>Nama pengirim</small><b>${escapeHtml(item.senderName || '—')}</b></span><span><small>Asal transfer</small><b>${escapeHtml(item.senderInstitution || '—')}</b></span><span><small>Diperiksa oleh</small><b>${escapeHtml(item.reviewedByEmail || 'Belum diperiksa')}</b></span><span class="wide"><small>Alasan penolakan</small><b>${escapeHtml(item.rejectionReason || '—')}</b></span><span class="wide"><small>Catatan internal</small><b>${escapeHtml(readableReviewNote(item.adminNotes) || '—')}</b></span><span class="wide"><small>Catatan peserta</small><b>${escapeHtml(item.notes || 'Tidak ada catatan')}</b></span></div><section aria-live="polite" class="admin-payment-proof" data-payment-proof-panel><div class="admin-payment-proof-loading"><i aria-hidden="true"></i><span>Menyiapkan akses bukti transfer…</span></div></section>`;
  showDialog(detailDialog);
  const panel = detailDialog.querySelector('[data-payment-proof-panel]');
  if (item.paymentProofAttached === false || item.proofStorage === 'purged') {
    panel.innerHTML = '<div class="admin-payment-proof-empty"><b>Bukti transfer sudah dihapus dari penyimpanan.</b><span>Hash bukti tetap disimpan untuk audit dan pencegahan penggunaan ulang.</span></div>';
    return;
  }
  try {
    const response = await getProofDownloadUrl({ registrationId: id });
    if (!panel?.isConnected || epoch !== proofRequestEpoch || !detailDialog.open) {
      if (response.data.url?.startsWith('blob:')) URL.revokeObjectURL(response.data.url);
      return;
    }
    activeProofUrl = response.data.url?.startsWith('blob:') ? response.data.url : '';
    const purgeButton = item.status !== 'menunggu' || item.active === false
      ? `<button class="admin-proof-purge" data-purge-payment-proof="${escapeHtml(id)}" type="button">Hapus bukti dari penyimpanan</button>`
      : '';
    const storageLabel = response.data.storage === 'legacy-firestore' ? 'Arsip lama' : 'Berkas privat peserta';
    panel.innerHTML = `<div class="admin-payment-proof-head"><span>BUKTI TRANSFER</span><h3>Screenshot pembayaran peserta</h3></div><figure class="admin-payment-proof-figure"><img alt="Screenshot bukti transfer peserta" decoding="async" src="${escapeHtml(response.data.url)}"><figcaption><div><small>BUKTI PEMBAYARAN</small><b>${escapeHtml(storageLabel)}</b></div><div class="admin-payment-proof-actions"><a href="${escapeHtml(response.data.url)}" rel="noopener noreferrer" target="_blank">Lihat gambar penuh ↗</a><button type="button" data-print-proof="${escapeHtml(id)}">Cetak PDF</button></div></figcaption></figure>${purgeButton}`;
    const preview = panel.querySelector('.admin-payment-proof-figure img');
    preview?.addEventListener('error', () => {
      if (epoch !== proofRequestEpoch) return;
      preview.hidden = true;
      const message = document.createElement('p');
      message.className = 'admin-payment-proof-empty';
      message.textContent = 'Gambar bukti belum dapat ditampilkan. Coba muat ulang detail atau periksa berkas asli.';
      preview.parentElement?.prepend(message);
    }, {once: true});
  } catch (error) {
    if (panel?.isConnected && epoch === proofRequestEpoch) panel.innerHTML = `<div class="admin-payment-proof-empty"><b>Bukti transfer gagal dimuat.</b><span>${escapeHtml(friendlyFirebaseError(error))}</span></div>`;
  }
};

detailDialog?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-print-proof]');
  if (!button) return;
  const item = state.registrations.find((entry) => entry.id === button.dataset.printProof);
  const image = detailDialog.querySelector('.admin-payment-proof-figure img');
  if (!item || !image?.complete || !image.naturalWidth) return showToast('Gambar belum siap. Tunggu hingga bukti pembayaran tampil.', 'error');
  const windowRef = window.open('', '_blank', 'width=920,height=760');
  if (!windowRef) return showToast('Izinkan popup untuk mencetak bukti pembayaran.', 'error');
  const safe = escapeHtml;
  windowRef.document.open();
  windowRef.document.write(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bukti pembayaran ${safe(item.referenceNumber || '')}</title><style>
*{box-sizing:border-box}html,body{margin:0;color:#142d40;background:#e6decd;font:13px/1.4 Arial,sans-serif}
body{padding:15px}.sheet{width:min(100%,740px);margin:auto;padding:16px 20px;background:#fffdf6;border:1px solid #1b3a4b;box-shadow:5px 6px 0 #c3b49b;display:flex;flex-direction:column;gap:9px}
.kicker{font-size:10px;font-weight:800;letter-spacing:.11em;color:#a33439}h1{margin:0;font:700 clamp(20px,3vw,26px)/1.1 Georgia,serif}.meta{padding:9px 0;border-block:1px solid #c9bba4;overflow-wrap:anywhere}.proof-wrap{min-height:0;display:grid;place-items:center;border:1px solid #d4c6b0;background:#f9f3e8;padding:8px}
.proof-wrap img{display:block;max-width:100%;max-height:min(49dvh,165mm);width:auto;height:auto;object-fit:contain}.warning{padding:9px 11px;margin:0;border-left:4px solid #ac3438;background:#f2e9d9;font-size:11px;line-height:1.4}.print-actions{margin:3px 0 0}.print-actions button{padding:10px 16px;border:1px solid #15374b;background:#15374b;color:white;font-weight:750;cursor:pointer}
@page{size:A4 portrait;margin:12mm}
@media print{html,body{width:100%;height:auto!important;margin:0;padding:0;background:#fff!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{width:100%;height:258mm;max-height:258mm;margin:0;padding:2mm 0;box-shadow:none;border:0;gap:3mm;break-inside:avoid;page-break-inside:avoid;overflow:hidden}.kicker{font-size:9pt}h1{font-size:21pt}.meta{font-size:10pt;padding:2mm 0}.proof-wrap{flex:1;max-height:155mm;min-height:0;padding:2mm;overflow:hidden;break-inside:avoid}.proof-wrap img{max-width:100%;max-height:145mm;object-fit:contain}.warning{font-size:9pt;padding:2mm 3mm;break-inside:avoid}.print-actions{display:none!important}}
@media(max-width:560px){body{padding:8px}.sheet{padding:12px;gap:7px}.proof-wrap img{max-height:43dvh}.warning{font-size:10px}}
</style></head><body><article class="sheet"><span class="kicker">ESORIA CODEFEST / DOKUMEN VERIFIKASI</span><h1>Bukti pembayaran peserta</h1><div class="meta"><b>${safe(item.userName || 'Peserta')}</b> · ${safe(item.periodLabel || item.periodId || '')}<div>Referensi: ${safe(item.referenceNumber || item.id)}</div><div>Nominal: ${safe(item.amount || '—')} · Status: ${safe(paymentLabel(item.paymentStatus))}</div></div><div class="proof-wrap"><img alt="Bukti transfer" id="payment-print-image" src="${safe(image.src)}"></div><p class="warning"><b>Dokumen pendukung, bukan bukti dana masuk.</b> Admin wajib memeriksa mutasi rekening resmi sebelum ACC.</p><div class="print-actions"><button type="button" id="print-proof-now">Cetak / Simpan PDF</button></div></article></body></html>`);
  windowRef.document.close();
  windowRef.document.getElementById('print-proof-now')?.addEventListener('click', async () => {
    const previewImage = windowRef.document.getElementById('payment-print-image');
    if (previewImage && !previewImage.complete) await new Promise((resolve) => {
      previewImage.addEventListener('load', resolve, {once:true});
      previewImage.addEventListener('error', resolve, {once:true});
      setTimeout(resolve, 5000);
    });
    if (!previewImage?.naturalWidth) return windowRef.alert('Bukti pembayaran belum berhasil dimuat. Coba buka kembali dokumen.');
    windowRef.print();
  });
});

const setEditValue = (selector, value = '') => { const field = editForm.querySelector(selector); if (field) field.value = value ?? ''; };
const openUserEditor = (uid) => {
  const item = state.users.find((entry) => (entry.uid || entry.id) === uid);
  if (!item) return;
  setEditValue('#admin-edit-uid', uid);
  setEditValue('#admin-edit-name', item.participantName || item.legalName || item.displayName);
  setEditValue('#admin-edit-email', item.email);
  setEditValue('#admin-edit-birth', item.birthDate);
  document.querySelector('#admin-edit-birth')?.dispatchEvent(new Event('esoria:paper-date-sync'));
  setEditValue('#admin-edit-gender', item.gender);
  setEditValue('#admin-edit-phone', normalizeIndonesianPhone(item.phone));
  setEditValue('#admin-edit-occupation', item.occupation);
  setEditValue('#admin-edit-institution', item.institution);
  setEditValue('#admin-edit-city', item.city);
  setEditValue('#admin-edit-province', item.province);
  setEditValue('#admin-edit-skill', item.primarySkill);
  setEditValue('#admin-edit-level', item.experienceLevel);
  setEditValue('#admin-edit-track', item.preferredTrack);
  setEditValue('#admin-edit-address', item.address);
  setEditValue('#admin-edit-portfolio', item.portfolioUrl);
  setEditValue('#admin-edit-bio', item.bio);
  showDialog(editDialog);
};

const openReview = (id, repair = false) => {
  const item = state.registrations.find((entry) => entry.id === id);
  if (!item) return;
  const policy = registrationActions(item);
  if (policy.accepted && (!repair || !policy.mayRepairTicket)) return showToast('ACC sudah aktif. Gunakan Batalkan ACC, atau Perbaiki Tiket jika nomornya keliru.', 'error');
  if (repair && !policy.mayRepairTicket) return showToast('Perbaikan tiket tidak tersedia untuk status ini.', 'error');
  reviewForm.dataset.reviewAction = repair ? 'repair_ticket' : 'review';
  document.querySelector('#admin-review-title').textContent = repair ? 'Perbaiki nomor tiket resmi' : 'Putuskan pendaftaran';
  document.querySelector('#admin-review-id').value = id;
  document.querySelector('#admin-review-revision').value = String(item.reviewRevision || 0);
  document.querySelector('#admin-bank-confirm').checked = false;
  document.querySelector('#admin-review-participant').textContent = `${item.userName || 'Peserta'} · ${item.packageLabel || ''} · ${item.periodLabel || item.periodId || ''}`;
  document.querySelector('#admin-review-status').value = item.status || 'menunggu';
  document.querySelector('#admin-review-payment').value = item.paymentStatus || 'belum_diperiksa';
  const duplicatePrefix = /^ECF-ECF-/i.test(item.ticketNumber || '');
  const suggestedTicket = normalizeTicket(item.referenceNumber || '');
  document.querySelector('#admin-review-ticket').value = repair ? suggestedTicket : '';
  document.querySelector('#admin-review-status').disabled = repair;
  document.querySelector('#admin-review-payment').disabled = repair;
  document.querySelector('#admin-review-ticket').dataset.suggested = suggestedTicket;
  document.querySelector('#admin-review-status').value = repair ? 'terverifikasi' : item.status || 'menunggu';
  document.querySelector('#admin-review-payment').value = repair ? 'sesuai' : item.paymentStatus || 'belum_diperiksa';
  if (duplicatePrefix && repair) showToast('Nomor tiket lama memiliki ECF ganda. Simpan koreksi resmi setelah memeriksa ulang transaksi.', 'error');
  document.querySelector('#admin-review-reason').value = item.rejectionReason || '';
  document.querySelector('#admin-review-notes').value = item.adminNotes || '';
  showDialog(reviewDialog);
  updateAdminReviewFields();
};

const updateAdminReviewFields = () => {
  const status = document.querySelector('#admin-review-status').value;
  const repair = reviewForm.dataset.reviewAction === 'repair_ticket';
  const ticket = document.querySelector('#admin-review-ticket');
  const reason = document.querySelector('#admin-review-reason');
  const bank = document.querySelector('#admin-bank-confirm');
  const payment = document.querySelector('#admin-review-payment');
  const notes = document.querySelector('#admin-review-notes');
  const isAcc = status === 'terverifikasi';
  ticket.closest('label').hidden = !isAcc;
  ticket.disabled = !isAcc;
  reason.closest('label').hidden = status !== 'ditolak';
  reason.disabled = status !== 'ditolak';
  reason.required = status === 'ditolak';
  reason.minLength = status === 'ditolak' ? 5 : 0;
  bank.closest('label').hidden = !isAcc;
  bank.disabled = !isAcc;
  bank.required = isAcc;
  notes.required = isAcc;
  notes.minLength = isAcc ? 5 : 0;
  if (isAcc && !repair) payment.value = 'sesuai';
  if (repair) notes.placeholder = 'Jelaskan alasan koreksi nomor tiket resmi';
  else notes.placeholder = 'Dasar keputusan dan hasil pemeriksaan mutasi';
};

document.querySelector('#admin-review-status')?.addEventListener('change', (event) => {
  const ticketField = document.querySelector('#admin-review-ticket');
  if (!ticketField) return;
  if (event.target.value !== 'terverifikasi') ticketField.value = '';
  else if (!ticketField.value) ticketField.value = ticketField.dataset.suggested || '';
  updateAdminReviewFields();
});

// Cancellation requires an explicit user gesture, with a reason and a fresh revision.
const openCancelAcc = (id) => {
  const item = state.registrations.find((entry) => entry.id === id);
  if (!item || !registrationActions(item).mayCancelAcc) return showToast('Batalkan check-in terlebih dahulu, kemudian muat ulang data.', 'error');
  askConfirmation('Batalkan ACC dan nonaktifkan tiket?', 'Pendaftaran kembali menunggu pemeriksaan. Status pembayaran dikembalikan ke belum diperiksa, nomor tiket dilepas, dan peserta diberi notifikasi. Setelah itu baru dapat di-ACC ulang.', async () => {
    const reason = document.querySelector('#admin-cancel-acc-reason').value.trim();
    if (reason.length < 10) throw new Error('Alasan pembatalan ACC minimal 10 karakter.');
    await reviewRegistration({registrationId: id, expectedReviewRevision: Number(item.reviewRevision || 0), reviewAction:'cancel_acc', status:'menunggu', paymentStatus:'belum_diperiksa', ticketNumber:'', rejectionReason:'', bankTransferConfirmed:false, adminNotes:reason.trim()});
    await refreshRegistrations();
    showToast('ACC dibatalkan dan tiket lama dinonaktifkan.');
  }, 'Ya, Batalkan ACC');
  document.querySelector('#admin-cancel-acc-reason-wrap').hidden = false;
  document.querySelector('#admin-cancel-acc-reason').value = '';
};

const openProfileRequestReview = (uid) => {
  const item = state.editRequests.find((entry) => entry.userId === uid || entry.id === uid);
  if (!item) return;
  const userData = state.users.find((entry) => (entry.uid || entry.id) === uid);
  document.querySelector('#admin-profile-request-uid').value = uid;
  document.querySelector('#admin-profile-request-participant').textContent = `${userData?.participantName || item.userName || 'Peserta'} · ${item.userEmail || userData?.email || ''}`;
  document.querySelector('#admin-profile-request-reason').textContent = item.reason || 'Tidak ada alasan.';
  document.querySelector('#admin-profile-request-note').value = item.reviewNote || '';
  const pending = item.status === 'pending';
  document.querySelector('#admin-profile-request-approve').hidden = !pending;
  document.querySelector('#admin-profile-request-reject').hidden = !pending;
  showDialog(profileRequestDialog);
};

const askConfirmation = (title, message, action, buttonLabel = 'Ya, Lanjutkan') => {
  const reasonField = document.querySelector('#admin-cancel-acc-reason-wrap');
  if (reasonField) reasonField.hidden = true;
  confirmDialog.querySelector('h2').textContent = title;
  confirmDialog.querySelector('p').textContent = message;
  confirmDialog.querySelector('#admin-confirm-action').textContent = buttonLabel;
  pendingConfirmation = action;
  showDialog(confirmDialog);
};

const sanitizeCsvValue = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
const csvCell = (value) => `"${sanitizeCsvValue(value).replace(/"/g, '""')}"`;
const exportActiveData = async () => {
  const userRows = filteredUsers().map((item) => [item.uid || item.id, item.participantName || item.displayName, item.legalName, item.email, item.emailVerified ? 'Ya' : 'Belum', item.profileComplete ? 'Lengkap' : 'Belum lengkap', item.birthDate, calculateAge(item.birthDate) ?? '', item.gender, item.phone, item.occupation, item.institution, item.city, item.province, item.primarySkill, item.experienceLevel, item.preferredTrack, item.address, item.portfolioUrl, item.bio, item.archived ? 'Diarsipkan' : 'Aktif', formatTimestamp(item.createdAt)]);
  const registrationRows = filteredRegistrations().map((item) => [item.id, item.referenceNumber, item.periodId, item.ticketNumber, item.userName, item.userEmail, item.packageLabel, item.amount, item.waveLabel, statusLabel(item.status), paymentLabel(item.paymentStatus), item.skillStack, item.teamName, item.memberCount, Array.isArray(item.teamMembers) ? item.teamMembers.map((member) => `${member.name} (${member.role})`).join('; ') : item.teamMembers, item.transferDate, item.senderName, item.senderInstitution, item.rejectionReason, item.adminNotes, item.notes, item.active === false ? 'Diarsipkan' : 'Aktif', formatTimestamp(item.createdAt), formatTimestamp(item.updatedAt)]);
  const requestRows = filteredEditRequests().map((item) => [item.userId, item.userName, item.userEmail, editRequestStatusLabel(item.status), item.reason, item.reviewNote, item.reviewedByEmail, formatTimestamp(item.requestedAt), formatTimestamp(item.reviewedAt), formatTimestamp(item.completedAt)]);
  const auditRows = filteredAuditLogs().map((item) => [item.id, item.action, item.targetType, item.targetId, item.actorUid, item.actorEmail, JSON.stringify(item.details || {}), formatTimestamp(item.createdAt)]);
  const headers = {
    users: ['UID', 'Nama Peserta', 'Nama Legal', 'Email', 'Email Terverifikasi', 'Profil', 'Tanggal Lahir', 'Umur', 'Gender', 'Telepon', 'Status Utama', 'Instansi', 'Kota', 'Provinsi', 'Keahlian', 'Tingkat', 'Kategori Minat', 'Alamat', 'Portfolio', 'Bio', 'Status Data', 'Dibuat'],
    editRequests: ['UID Peserta', 'Nama', 'Email', 'Status', 'Alasan Peserta', 'Catatan Admin', 'Diproses Oleh', 'Diajukan', 'Diputuskan', 'Selesai'],
    registrations: ['ID', 'Referensi', 'Periode', 'Nomor Tiket', 'Peserta', 'Email', 'Kategori', 'Nominal', 'Gelombang', 'Status', 'Status Pembayaran', 'Keahlian', 'Nama Tim', 'Jumlah Anggota', 'Anggota', 'Tanggal Transfer', 'Nama Pengirim', 'Asal Transfer', 'Alasan Penolakan', 'Catatan Admin', 'Catatan Peserta', 'Status Data', 'Dibuat', 'Diperbarui'],
    auditLogs: ['ID Log', 'Tindakan', 'Jenis Target', 'ID Target', 'UID Aktor', 'Email Aktor', 'Detail', 'Waktu']
  };
  const rowSets = { users: userRows, editRequests: requestRows, registrations: registrationRows, auditLogs: auditRows };
  const header = headers[state.activeTab];
  const rows = rowSets[state.activeTab] || [];
  if (!rows.length) return showToast('Tidak ada data pada tampilan aktif untuk diekspor.', 'error');
  // Audit the export request on the server BEFORE creating a sensitive local file.
  // A failed audit request prevents export rather than silently bypassing accountability.
  const auditExport = httpsCallable(functions, 'esoriaApi', {
    timeout: 30000, limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey)
  });
  await auditExport({ action: 'logAdminCsvExport', payload: { tab: state.activeTab, count: rows.length,sessionKey:currentSessionKey() } });
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `esoria-${state.activeTab}-${localDateValue()}.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  showToast('Arsip CSV aman berhasil disiapkan.');
};

const fillPeriodForm = (period, focusPackage = '', focusWave = '', scroll = true) => {
  const monthValue = /^\d{4}-(0[1-9]|1[0-2])/.test(period.id || '')
    ? String(period.id).slice(0, 7)
    : dateTimeLocalValue(period.competitionStartAt).slice(0, 7);
  document.querySelector('#period-month').value = monthValue;
  document.querySelector('#period-status').value = period.status || 'draft';
  document.querySelectorAll('[data-capacity]').forEach((input) => {
    input.value = period.capacities?.[input.dataset.capacity]
      ?? period.slots?.[input.dataset.capacity]?.capacity
      ?? 50;
  });
  document.querySelectorAll('[data-enabled-package-wave]').forEach((input) => {
    const [packageId, waveId] = input.dataset.enabledPackageWave.split('_');
    input.checked = periodWaveEnabled(period, packageId, waveId);
  });
  syncAllPeriodControls();
  updatePeriodTemplatePreview();
  const target = focusWave
    ? periodForm.querySelector(`[data-wave-control="${focusPackage}_${focusWave}"]`)
    : focusPackage
      ? periodForm.querySelector(`[data-period-category="${focusPackage}"]`)
      : periodForm;
  if (scroll) target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (focusWave) target?.classList.add('period-focus-pulse');
  window.setTimeout(() => target?.classList.remove('period-focus-pulse'), 1000);
};

detailDialog.addEventListener('click', (event) => {
  const purge = event.target.closest('[data-purge-payment-proof]');
  if (!purge) return;
  const registrationId = purge.dataset.purgePaymentProof;
  askConfirmation(
    'Hapus bukti transfer?',
    'Simpan salinan bukti di arsip panitia terlebih dahulu. Screenshot akan dihapus permanen dari Firebase Storage, tetapi hash audit tetap disimpan.',
    async () => {
      await purgePaymentProof({ registrationId });
      const item = state.registrations.find((entry) => entry.id === registrationId);
      if (item) Object.assign(item, { paymentProofAttached: false, proofStorage: 'purged', proofSize: 0 });
      closeDialog(detailDialog);
      renderAll();
      showToast('Bukti transfer berhasil dihapus dari Firebase Storage.');
    },
    'Ya, Hapus Bukti'
  );
});

userList.addEventListener('click', (event) => {
  const load = event.target.closest('[data-load-more]');
  if (load) return void loadPage(load.dataset.loadMore, true);
  const view = event.target.closest('[data-view-user]');
  const edit = event.target.closest('[data-edit-user]');
  const archive = event.target.closest('[data-archive-user]');
  const restore = event.target.closest('[data-restore-user]');
  if (view) openUserDetail(view.dataset.viewUser);
  if (edit) openUserEditor(edit.dataset.editUser);
  if (restore) {
    const uid = restore.dataset.restoreUser;
    askConfirmation('Pulihkan peserta?', 'Peserta akan dipulihkan di Firestore dan Firebase Authentication oleh backend.', async () => {
      await restoreParticipant({ uid });
      const item = state.users.find((entry) => (entry.uid || entry.id) === uid);
      if (item) item.archived = false;
      renderAll();
      await loadMetrics();
      showToast('Peserta berhasil dipulihkan.');
    }, 'Ya, Pulihkan');
  }
  if (archive) {
    const uid = archive.dataset.archiveUser;
    const item = state.users.find((entry) => (entry.uid || entry.id) === uid);
    askConfirmation('Arsipkan peserta?', `Akun ${item?.participantName || item?.email || 'peserta'} akan diarsipkan dan dinonaktifkan pada Firebase Authentication sampai dipulihkan.`, async () => {
      await archiveParticipant({ uid });
      item.archived = true;
      renderAll();
      await loadMetrics();
      showToast('Peserta berhasil diarsipkan.');
    }, 'Ya, Arsipkan');
  }
});

profileRequestList.addEventListener('click', (event) => {
  const load = event.target.closest('[data-load-more]');
  if (load) return void loadPage(load.dataset.loadMore, true);
  const review = event.target.closest('[data-review-profile-request]');
  const view = event.target.closest('[data-view-profile-request]');
  if (review) openProfileRequestReview(review.dataset.reviewProfileRequest);
  if (view) openProfileRequestReview(view.dataset.viewProfileRequest);
});

registrationList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select-registration]');
  if (!checkbox) return;
  if (checkbox.checked) {
    const candidate = state.registrations.find((item) => item.id === checkbox.dataset.selectRegistration);
    if (!candidate || !registrationActions(candidate).mayReview) {checkbox.checked = false; return showToast('Pendaftaran sudah ACC atau tidak aktif; jangan proses secara massal.', 'error');}
    if (state.selectedRegistrations.size >= 20) {
      checkbox.checked = false;
      showToast('Anda dapat memproses maksimal 20 pendaftaran sekaligus.', 'error');
      return;
    }
    state.selectedRegistrations.add(checkbox.dataset.selectRegistration);
  } else {
    state.selectedRegistrations.delete(checkbox.dataset.selectRegistration);
  }
  checkbox.closest('.admin-registration-card')?.setAttribute('data-selected', String(checkbox.checked));
  updateBulkBar();
});

const openBulkDialog = (action) => {
  const selected = [...state.selectedRegistrations].map((id) => state.registrations.find((item) => item.id === id)).filter(Boolean);
  if (!selected.length) return showToast('Pilih pendaftaran terlebih dahulu.', 'error');
  document.querySelector('#admin-bulk-action').value = action;
  document.querySelector('#admin-bulk-summary').textContent = `${selected.length} pendaftaran akan diproses`;
  document.querySelector('#admin-bulk-title').textContent = action === 'approve' ? 'ACC pendaftaran terpilih' : action === 'reject' ? 'Tolak pendaftaran terpilih' : 'Tandai sebagai sedang diproses';
  document.querySelector('#admin-bulk-payment').value = action === 'approve' ? 'sesuai' : action === 'reject' ? 'bermasalah' : 'belum_diperiksa';
  document.querySelector('#admin-bulk-reason').value = '';
  document.querySelector('#admin-bulk-bank-confirm').checked = false;
  showDialog(bulkDialog);
};

bulkBar?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-bulk-action]');
  if (!button) return;
  const action = button.dataset.bulkAction;
  if (action === 'clear') {
    state.selectedRegistrations.clear();
    renderRegistrations();
    return;
  }
  openBulkDialog(action);
});

bulkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const action = document.querySelector('#admin-bulk-action').value;
  const paymentStatus = document.querySelector('#admin-bulk-payment').value;
  const reason = document.querySelector('#admin-bulk-reason').value.trim();
  if (action === 'reject' && reason.length < 5) return showToast('Alasan penolakan bulk minimal 5 karakter.', 'error');
  const selected = [...state.selectedRegistrations].map((id) => state.registrations.find((item) => item.id === id)).filter((item) => item && registrationActions(item).mayReview).slice(0, 20);
  if (action === 'approve' && !document.querySelector('#admin-bulk-bank-confirm').checked) return showToast('Periksa mutasi rekening resmi untuk seluruh item dan centang konfirmasi dana masuk.', 'error');
  const items = selected.map((item) => ({
    expectedReviewRevision: Number(item.reviewRevision || 0), bankTransferConfirmed: document.querySelector('#admin-bulk-bank-confirm').checked,
    registrationId: item.id,
    status: action === 'approve' ? 'terverifikasi' : action === 'reject' ? 'ditolak' : 'menunggu',
    paymentStatus: action === 'approve' ? 'sesuai' : paymentStatus,
    ticketNumber: action === 'approve' ? normalizeTicket(item.referenceNumber || `ECF-${item.id.slice(-12)}`) : '',
    reviewAction: 'bulk_review',
    rejectionReason: action === 'reject' ? reason : '',
    adminNotes: reason || (action === 'approve' ? 'Mutasi rekening resmi diperiksa satu per satu oleh admin.' : `Bulk review ${action}`)
  }));
  const button = bulkForm.querySelector('.admin-save-button');
  try {
    button.disabled = true;
    button.textContent = 'Memproses batch…';
    const response = await bulkReviewRegistrations({ items });
    const result = response.data || response;
    (result.results || []).filter((item) => item.ok).forEach((item) => state.selectedRegistrations.delete(item.registrationId));
    closeDialog(bulkDialog);
    renderRegistrations();
    if (result.failedCount) showToast(`${result.successCount} berhasil, ${result.failedCount} gagal. Buka detail item yang gagal.`, 'error');
    else showToast(`${result.successCount} pendaftaran berhasil diproses.`);
  } catch (error) {
    showToast(friendlyFirebaseError(error), 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Proses Pendaftaran Terpilih →';
  }
});

registrationList.addEventListener('click', (event) => {
  const load = event.target.closest('[data-load-more]');
  if (load) return void loadPage(load.dataset.loadMore, true);
  const view = event.target.closest('[data-view-registration]');
  const review = event.target.closest('[data-review-registration]');
  const remove = event.target.closest('[data-delete-registration]');
  const restore = event.target.closest('[data-restore-registration]');
  const checkIn = event.target.closest('[data-checkin-registration]');
  if (view) void openRegistrationDetail(view.dataset.viewRegistration);
  if (checkIn) {
    const registrationId = checkIn.dataset.checkinRegistration;
    const checkedIn = checkIn.dataset.checkinState !== 'true';
    askConfirmation(checkedIn ? 'Catat check-in peserta?' : 'Batalkan check-in?', checkedIn ? 'Kehadiran peserta akan dicatat dan langsung muncul pada tiket serta audit log.' : 'Status kehadiran akan dikembalikan menjadi belum check-in.', async () => {
      await checkInRegistration({ registrationId, checkedIn });
      showToast(checkedIn ? 'Check-in peserta berhasil dicatat.' : 'Check-in peserta berhasil dibatalkan.');
    }, checkedIn ? 'Ya, Check-in' : 'Batalkan Check-in');
  }
  if (review) openReview(review.dataset.reviewRegistration);
  const cancelAcc = event.target.closest('[data-cancel-acc]');
  if (cancelAcc) openCancelAcc(cancelAcc.dataset.cancelAcc);
  const repairTicket = event.target.closest('[data-repair-ticket]');
  if (repairTicket) openReview(repairTicket.dataset.repairTicket, true);
  if (remove) askConfirmation('Arsipkan pendaftaran?', 'Data tidak dihapus permanen. Slot akan dilepas dan pendaftaran dapat dipulihkan jika kapasitas masih tersedia.', async () => { await softDeleteRegistration({ registrationId: remove.dataset.deleteRegistration }); await refreshRegistrations(); showToast('Pendaftaran berhasil diarsipkan.'); }, 'Ya, Arsipkan');
  if (restore) askConfirmation('Pulihkan pendaftaran?', 'Slot periode akan dipakai kembali. Pemulihan gagal apabila kapasitas sudah penuh.', async () => { await restoreRegistration({ registrationId: restore.dataset.restoreRegistration }); await refreshRegistrations(); showToast('Pendaftaran berhasil dipulihkan.'); }, 'Ya, Pulihkan');
});

auditList.addEventListener('click', (event) => {
  const load = event.target.closest('[data-load-more]');
  if (load) void loadPage(load.dataset.loadMore, true);
});

periodList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-period]');
  if (!button) return;
  if (periodEditMode !== 'view') return showToast('Selesaikan atau batalkan perubahan periode yang sedang dibuka sebelum memilih periode lain.', 'error');
  const item = state.periods.find((period) => period.id === button.dataset.editPeriod);
  if (item) {
    // Pilih satu periode utuh; tidak ada mode edit parsial per kategori/gelombang.
    askConfirmation('Buka pengaturan periode?', `Anda akan mengedit seluruh periode ${item.id}, termasuk status, enam gelombang, dan kapasitasnya. Perubahan belum diterapkan sampai Anda menyimpan.`, () => {
      fillPeriodForm(item, '', '', false);
      applyPeriodMode('edit', item);
      periodForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 'Ya, Mulai Edit');
  }
});

const decideProfileRequest = async (status) => {
  const uid = document.querySelector('#admin-profile-request-uid').value;
  const reviewNote = document.querySelector('#admin-profile-request-note').value.trim();
  if (status === 'rejected' && reviewNote.length < 5) {
    return showToast('Jelaskan alasan penolakan minimal 5 karakter.', 'error');
  }
  const approveButton = document.querySelector('#admin-profile-request-approve');
  const rejectButton = document.querySelector('#admin-profile-request-reject');
  try {
    approveButton.disabled = true;
    rejectButton.disabled = true;
    await reviewProfileEditRequest({ uid, status, reviewNote });
    closeDialog(profileRequestDialog);
    await loadMetrics();
    showToast(status === 'approved' ? 'Permintaan disetujui. Peserta dapat mengubah profil satu kali.' : 'Permintaan perubahan profil ditolak.');
  } catch (error) {
    showToast(friendlyFirebaseError(error), 'error');
  } finally {
    approveButton.disabled = false;
    rejectButton.disabled = false;
  }
};
document.querySelector('#admin-profile-request-approve').addEventListener('click', () => decideProfileRequest('approved'));
document.querySelector('#admin-profile-request-reject').addEventListener('click', () => decideProfileRequest('rejected'));

reviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!reviewForm.checkValidity()) return reviewForm.reportValidity();
  const status = document.querySelector('#admin-review-status').value;
  const ticketNumber = normalizeTicket(document.querySelector('#admin-review-ticket').value);
  const rejectionReason = document.querySelector('#admin-review-reason').value.trim();
  const paymentStatus = document.querySelector('#admin-review-payment').value;
  if (status === 'terverifikasi' && ticketNumber.length < 3) return showToast('Nomor tiket wajib diisi untuk ACC.', 'error');
  if (status === 'terverifikasi' && paymentStatus !== 'sesuai') return showToast('Tandai pembayaran sebagai sesuai sebelum ACC.', 'error');
  if (status !== 'terverifikasi' && ticketNumber) return showToast('Kosongkan nomor tiket untuk status selain ACC.', 'error');
  if (status === 'ditolak' && rejectionReason.length < 5) return showToast('Alasan penolakan wajib dijelaskan.', 'error');
  const button = reviewForm.querySelector('.admin-save-button');
  try {
    button.disabled = true; button.textContent = 'Menyimpan…';
    await reviewRegistration({ reviewAction:reviewForm.dataset.reviewAction || 'review', expectedReviewRevision: Number(document.querySelector('#admin-review-revision').value), bankTransferConfirmed: document.querySelector('#admin-bank-confirm').checked, registrationId: document.querySelector('#admin-review-id').value, status, paymentStatus, ticketNumber, rejectionReason, adminNotes: document.querySelector('#admin-review-notes').value.trim() });
    closeDialog(reviewDialog); await refreshRegistrations(); showToast('Keputusan pendaftaran berhasil disimpan.');
  } catch (error) { showToast(friendlyFirebaseError(error), 'error'); }
  finally { button.disabled = false; button.textContent = 'Simpan Keputusan →'; }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const phoneField = editForm.querySelector('#admin-edit-phone');
  phoneField.value = normalizeIndonesianPhone(phoneField.value);
  if (!editForm.checkValidity()) return editForm.reportValidity();
  const uid = editForm.querySelector('#admin-edit-uid').value;
  const birthDate = editForm.querySelector('#admin-edit-birth').value;
  const age = calculateAge(birthDate);
  if (age === null) return showToast('Tanggal lahir peserta belum valid.', 'error');
  const name = editForm.querySelector('#admin-edit-name').value.trim();
  const button = editForm.querySelector('.admin-save-button');
  try {
    button.disabled = true; button.textContent = 'Menyimpan…';
    await updateParticipantProfile({ uid, participantName: name, legalName: name, birthDate, gender: editForm.querySelector('#admin-edit-gender').value, phone: phoneField.value, occupation: editForm.querySelector('#admin-edit-occupation').value, institution: editForm.querySelector('#admin-edit-institution').value.trim(), city: editForm.querySelector('#admin-edit-city').value.trim(), province: editForm.querySelector('#admin-edit-province').value.trim(), address: editForm.querySelector('#admin-edit-address').value.trim(), primarySkill: editForm.querySelector('#admin-edit-skill').value.trim(), experienceLevel: editForm.querySelector('#admin-edit-level').value, preferredTrack: editForm.querySelector('#admin-edit-track').value, portfolioUrl: editForm.querySelector('#admin-edit-portfolio').value.trim(), bio: editForm.querySelector('#admin-edit-bio').value.trim() });
    const item = state.users.find((entry) => (entry.uid || entry.id) === uid);
    Object.assign(item, { participantName: name, legalName: name, displayName: name, birthDate, age, phone: phoneField.value, gender: editForm.querySelector('#admin-edit-gender').value, occupation: editForm.querySelector('#admin-edit-occupation').value, institution: editForm.querySelector('#admin-edit-institution').value.trim(), city: editForm.querySelector('#admin-edit-city').value.trim(), province: editForm.querySelector('#admin-edit-province').value.trim(), primarySkill: editForm.querySelector('#admin-edit-skill').value.trim(), experienceLevel: editForm.querySelector('#admin-edit-level').value, preferredTrack: editForm.querySelector('#admin-edit-track').value, address: editForm.querySelector('#admin-edit-address').value.trim(), portfolioUrl: editForm.querySelector('#admin-edit-portfolio').value.trim(), bio: editForm.querySelector('#admin-edit-bio').value.trim(), profileComplete: true });
    closeDialog(editDialog); renderAll(); showToast('Profil peserta berhasil diperbarui.');
  } catch (error) { showToast(friendlyFirebaseError(error), 'error'); }
  finally { button.disabled = false; button.textContent = 'Simpan Perubahan →'; }
});

document.querySelector('#period-new').addEventListener('click', () => {
  const month = document.querySelector('#period-month');
  for (let attempt = 0; attempt < 24 && getStoredPeriod(month.value); attempt += 1) {
    const [year, m] = month.value.split('-').map(Number);
    const next = new Date(Date.UTC(year, m, 1));
    month.value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  updatePeriodTemplatePreview();
  document.querySelector('#period-status').value = 'draft';
  periodForm.querySelectorAll('[data-enabled-package-wave]').forEach((control) => { control.checked = true; });
  periodForm.querySelectorAll('[data-capacity]').forEach((control) => { control.value = '50'; });
  applyPeriodMode('create');
  periodForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('#period-edit-current').addEventListener('click', () => {
  const id = document.querySelector('#period-month').value;
  const found = getStoredPeriod(id);
  if (!found) return showToast('Periode bulan ini belum ada. Pilih Buat Periode Baru.', 'error');
  askConfirmation('Edit periode kompetisi?', `Perubahan pada periode ${id} memengaruhi pembukaan pendaftaran dan kapasitas slot.`, () => {
    fillPeriodForm(found); applyPeriodMode('edit', found);
  }, 'Mulai Edit');
});
document.querySelector('#period-cancel-edit').addEventListener('click', () => {
  const selected = getStoredPeriod(document.querySelector('#period-month').value);
  if (selected) fillPeriodForm(selected);
  applyPeriodMode('view');
});
document.querySelector('#period-delete-current').addEventListener('click', () => {
  const item = getStoredPeriod(periodEditingId);
  if (!item || item.status !== 'draft') return showToast('Hanya periode Draft yang boleh dihapus.', 'error');
  askConfirmation('Hapus periode Draft?', `Periode ${item.id} akan dihapus jika belum mempunyai pendaftaran dan belum pernah memakai slot. Catatan audit tetap disimpan.`, async () => {
    await deletePeriod(item.id);
    applyPeriodMode('view');
    showToast(`Periode Draft ${item.id} berhasil dihapus.`);
  }, 'Hapus Draft');
});

periodForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (periodEditMode === 'view') return showToast('Aktifkan mode edit sebelum menyimpan.', 'error');
  if (!periodForm.checkValidity()) return periodForm.reportValidity();
  const monthValue = document.querySelector('#period-month').value;
  const schedule = buildMonthlyPeriodTemplate(monthValue);
  if (!schedule) return showToast('Pilih bulan kompetisi yang valid.', 'error');
  if (periodEditMode === 'create' && getStoredPeriod(monthValue)) return showToast(`Periode ${monthValue} sudah ada. Tidak boleh membuat periode duplikat.`, 'error');
  if (periodEditMode === 'edit' && (monthValue !== periodEditingId || !getStoredPeriod(periodEditingId))) return showToast('Periode berubah atau tidak ditemukan. Pilih ulang mode edit.', 'error');
  const enabledPackages = {};
  const enabledPackageWaves = {};
  const capacities = {};
  for (const packageId of Object.keys(PERIOD_PACKAGE_META)) {
    enabledPackageWaves[packageId] = {};
    for (const waveId of ['wave-01', 'wave-02']) {
      const key = `${packageId}_${waveId}`;
      const waveToggle = periodForm.querySelector(`[data-enabled-package-wave="${key}"]`);
      enabledPackageWaves[packageId][waveId] = Boolean(waveToggle?.checked);
      capacities[key] = Math.max(1, Number(periodForm.querySelector(`[data-capacity="${key}"]`)?.value || 50));
    }
    enabledPackages[packageId] = Object.values(enabledPackageWaves[packageId]).some(Boolean);
  }
  if (!Object.values(enabledPackages).some(Boolean)) return showToast('Aktifkan minimal satu kategori dan satu wave.', 'error');
  const payload = {
    ...schedule,
    mode: periodEditMode, expectedRevision: periodExpectedRevision,
    status: document.querySelector('#period-status').value,
    capacities,
    enabledPackages,
    enabledPackageWaves,
    enabledWaves: {
      'wave-01': Object.values(enabledPackageWaves).some((waves) => waves['wave-01']),
      'wave-02': Object.values(enabledPackageWaves).some((waves) => waves['wave-02'])
    }
  };
  // Form tidak melakukan penulisan sebelum admin menyetujui dialog. Jangan tampilkan
  // indikator "Menyimpan" saat masih menunggu keputusan pengguna.
  askConfirmation(periodEditMode === 'create' ? 'Buat periode baru?' : 'Simpan perubahan periode?',
    `${schedule.periodId} — status ${payload.status}. Periksa jadwal pendaftaran, kapasitas, dan kategori sebelum menerapkan.`,
    async () => {
      await savePeriod(payload);
      applyPeriodMode('view');
      showToast('Periode berhasil disimpan. Perubahan akan diperbarui dari server.');
    }, 'Ya, Simpan Periode');
});

document.querySelector('#admin-confirm-action').addEventListener('click', async () => {
  const button = document.querySelector('#admin-confirm-action');
  const originalLabel = button.textContent;
  try {
    if (!pendingConfirmation || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Memproses…';
    await pendingConfirmation();
    pendingConfirmation = null;
    closeDialog(confirmDialog);
  } catch (error) {
    const detail = friendlyFirebaseError(error);
    showToast(detail, 'error');
    // Jangan hilangkan konfirmasi bila server menolak atau koneksi gagal.
    const message = confirmDialog.querySelector('p');
    message.textContent = `Belum berhasil: ${detail}. Periksa kembali sebelum mencoba lagi.`;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = originalLabel;
  }
});
confirmDialog.addEventListener('close', () => { pendingConfirmation = null; });
document.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
const adminTabs = [...document.querySelectorAll('[data-admin-tab]')];
const activateAdminTab = (button, focus = false) => {
  state.activeTab = button.dataset.adminTab;
  state.filter = 'all';
  adminTabs.forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== state.activeTab; });
  const periodMode = state.activeTab === 'periods';
  toolbar.dataset.mode = state.activeTab;
  searchControl.disabled = periodMode;
  sortControl.disabled = periodMode;
  filterControl.disabled = periodMode;
  document.querySelector('#admin-export').disabled = periodMode;
  if (periodMode) {
    state.search = '';
    searchControl.value = '';
  }
  updateFilterOptions();
  renderAll();
  if (focus) button.focus();
};
adminTabs.forEach((button) => {
  button.addEventListener('click', () => activateAdminTab(button));
  button.addEventListener('keydown', (event) => {
    const index = adminTabs.indexOf(button);
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % adminTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + adminTabs.length) % adminTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = adminTabs.length - 1;
    else return;
    event.preventDefault();
    activateAdminTab(adminTabs[nextIndex], true);
  });
});
let searchTimer = 0;
searchControl.addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderAll, 120);
});
filterControl.addEventListener('change', (event) => { state.filter = event.target.value; renderAll(); });
sortControl.addEventListener('change', (event) => { state.sort = event.target.value; renderAll(); });
document.querySelector('#admin-clear').addEventListener('click', () => { state.search = ''; state.filter = 'all'; state.sort = 'newest'; searchControl.value = ''; sortControl.value = 'newest'; updateFilterOptions(); renderAll(); });
document.querySelector('#admin-export').addEventListener('click', () => {
  const selectedTab = state.activeTab === 'users' ? 'peserta' : state.activeTab === 'editRequests' ? 'permintaan edit' : state.activeTab === 'registrations' ? 'pendaftaran' : state.activeTab === 'auditLogs' ? 'audit log' : 'periode';
  askConfirmation('Ekspor data ke CSV?', `Unduh data ${selectedTab} sesuai filter yang sedang diterapkan? Pastikan berkas CSV berisi informasi peserta dan disimpan hanya di perangkat yang aman.`, () => { void exportActiveData().catch((error) => showToast(friendlyFirebaseError(error), 'error')); }, 'Ya, Ekspor CSV');
});
document.querySelector('#admin-edit-birth').max = localDateValue();
document.querySelector('#admin-account').textContent = user.email || 'Admin Esoria';
const roleLabel = document.querySelector('#admin-account-role');
if (roleLabel) roleLabel.textContent = 'ADMIN';
const initialTab = adminTabs.find((button) => !button.hidden);
if (initialTab && initialTab.dataset.adminTab !== state.activeTab) activateAdminTab(initialTab);
const defaultPeriodMonth = wibMonthValue();
document.querySelector('#period-month').value = defaultPeriodMonth;
const syncPeriodCategoryControl = (packageId) => {
  const category = periodForm.querySelector(`[data-period-category="${packageId}"]`);
  const waveToggles = [...periodForm.querySelectorAll(`[data-enabled-package-wave^="${packageId}_"]`)];
  let enabledCount = 0;
  waveToggles.forEach((toggle) => {
    const control = toggle.closest('[data-wave-control]');
    const enabled = toggle.checked;
    if (enabled) enabledCount += 1;
    control?.toggleAttribute('data-disabled', !enabled);
    const capacity = control?.querySelector('[data-capacity]');
    if (capacity) capacity.disabled = !enabled || periodEditMode === 'view';
    const stateLabel = control?.querySelector('header label span');
    if (stateLabel) stateLabel.textContent = enabled ? 'Diizinkan' : 'Nonaktif';
  });
  category?.toggleAttribute('data-disabled', enabledCount === 0);
  const badge = periodForm.querySelector(`[data-category-state="${packageId}"]`);
  if (badge) {
    badge.textContent = `${enabledCount} / 2 diizinkan`;
    badge.dataset.enabledCount = String(enabledCount);
  }
};
const syncAllPeriodControls = () => Object.keys(PERIOD_PACKAGE_META).forEach(syncPeriodCategoryControl);
document.querySelector('#period-month').addEventListener('change', () => {
  updatePeriodTemplatePreview();
  if (periodEditMode === 'view') {
    const stored = getStoredPeriod(document.querySelector('#period-month').value);
    if (stored) fillPeriodForm(stored, '', '', false);
  }
  if (periodEditMode === 'create' && getStoredPeriod(document.querySelector('#period-month').value)) {
    showToast('Periode bulan ini sudah ada. Pilih bulan lain atau gunakan Edit Periode.', 'error');
  }
});
periodForm.querySelectorAll('[data-enabled-package-wave]').forEach((input) => input.addEventListener('change', () => {
  syncPeriodCategoryControl(input.dataset.enabledPackageWave.split('_')[0]);
}));
syncAllPeriodControls();
updatePeriodTemplatePreview();
applyPeriodMode('view');

startRealtimeAdmin();
// Server-synchronised labels: no dependence on an inaccurate local device clock.
void syncServerClock().then(() => { if (state.activeTab === 'periods') renderPeriods(); });
const periodStatusTicker = window.setInterval(() => {
  if (document.visibilityState === 'visible' && state.activeTab === 'periods') renderPeriods();
}, 60000);
window.addEventListener('pagehide', (event) => {
  clearTimeout(searchTimer);
  clearTimeout(metricsRefreshTimer);
  metricsRefreshTimer = null;
  cancelAnimationFrame(adminRenderFrame);
  adminRenderFrame = 0;
  // A persisted document resumes its existing listeners and timers on Back.
  if (event.persisted) return;
  clearInterval(periodStatusTicker);
  realtimeUnsubscribers.forEach((unsubscribe) => unsubscribe());
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) afterRealtimeUpdate();
});
