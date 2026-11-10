import {
  collection,
  doc,
  onSnapshot,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=b74586eaa5ef6110';
import { getServerClockOffset, serverNow, syncServerClock } from './server-clock.js?v=b74586eaa5ef6110';
import { formatWib } from './time-utils.js?v=b74586eaa5ef6110';

const VALID_PACKAGES = new Set(['web', 'cyber', 'team']);
const requestedPackage = document.body.dataset.ticketPackage
  || new URLSearchParams(location.search).get('paket')
  || '';
const pagePackage = VALID_PACKAGES.has(requestedPackage) ? requestedPackage : '';

let registrationState = null;
let stateReadError = false;
let periodReadError = false;
let slotsReadError = false;
const registrationUnavailable = () => stateReadError || periodReadError || slotsReadError;
let activePeriod = null;
let activeSlots = [];
let unsubscribePeriod = null;
let unsubscribeSlots = null;
let ticker = 0;

const millis = (value) => value?.toMillis?.()
  ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : Number(value || 0));

const serializeWave = (wave = {}) => ({
  ...wave,
  registrationOpenAt: millis(wave.registrationOpenAt),
  registrationCloseAt: millis(wave.registrationCloseAt),
  startsAt: millis(wave.startsAt),
  closesAt: millis(wave.closesAt),
  deadlineAt: millis(wave.deadlineAt),
  announcementAt: millis(wave.announcementAt)
});

const serializePeriod = (period) => period ? ({
  ...period,
  registrationOpenAt: millis(period.registrationOpenAt),
  registrationCloseAt: millis(period.registrationCloseAt),
  competitionStartAt: millis(period.competitionStartAt),
  announcementAt: millis(period.announcementAt),
  waves: Object.fromEntries(Object.entries(period.waves || {}).map(([id, wave]) => [id, serializeWave(wave)])),
  packages: Object.fromEntries(Object.entries(period.packages || {}).map(([id, item]) => [id, {
    ...item,
    waves: Object.fromEntries(Object.entries(item?.waves || {}).map(([waveId, wave]) => [waveId, serializeWave(wave)]))
  }]))
}) : null;

const remainingLabel = (target) => {
  const delta = Number(target || 0) - serverNow();
  if (!Number.isFinite(delta) || delta <= 0) return '';
  const days = Math.floor(delta / 86400000);
  const hours = Math.floor((delta % 86400000) / 3600000);
  const minutes = Math.floor((delta % 3600000) / 60000);
  if (days > 0) return `${days} hari ${hours} jam lagi`;
  if (hours > 0) return `${hours} jam ${minutes} menit lagi`;
  return `${Math.max(1, minutes)} menit lagi`;
};

const slotsFor = (packageId) => activeSlots.filter((slot) => !packageId || slot.package === packageId);

const waveConfig = (packageId, waveId) => (
  activePeriod?.packages?.[packageId]?.waves?.[waveId]
  || activePeriod?.waves?.[waveId]
  || null
);

const evaluateStatus = (packageId = pagePackage) => {
  if (registrationUnavailable()) {
    return { state: 'unavailable', label: 'STATUS BELUM TERVERIFIKASI',
      title: 'Status pendaftaran belum dapat diperiksa',
      detail: 'Koneksi ke Firebase belum tersedia. Muat ulang untuk memeriksa status resmi; jangan berasumsi pendaftaran sudah ditutup.',
      capacity: 0, used: 0, capacityPerWave: 0 };
  }
  if (!registrationState?.openPeriodId || !activePeriod) {
    return {
      state: 'closed',
      label: 'REGISTRATION CLOSED',
      title: 'Pendaftaran ditutup',
      detail: 'Jadwal berikutnya belum diumumkan. Pantau kabar terbarunya di sini.',
      capacity: 0,
      used: 0
    };
  }

  const now = serverNow();
  const periodOpen = Number(activePeriod.registrationOpenAt || millis(registrationState.registrationOpenAt));
  const periodClose = Number(activePeriod.registrationCloseAt || millis(registrationState.registrationCloseAt));
  const selectedPackage = packageId ? activePeriod.packages?.[packageId] : null;
  const relevantSlots = slotsFor(packageId).filter((slot) => slot.enabled !== false
    && activePeriod.packages?.[slot.package]?.enabled !== false
    && waveConfig(slot.package, slot.wave)?.enabled !== false);
  const capacity = relevantSlots.reduce((sum, slot) => sum + Number(slot.capacity || 0), 0);
  const used = relevantSlots.reduce((sum, slot) => sum + Number(slot.count || 0), 0);
  const capacityPerWave = relevantSlots.length
    ? Math.max(...relevantSlots.map((slot) => Number(slot.capacity || 0)))
    : 0;
  const packageEnabled = !packageId || selectedPackage?.enabled !== false;

  if (activePeriod.status === 'full') {
    return {
      state: 'full',
      label: 'REGISTRATION FULL',
      title: 'Kuota pendaftaran penuh',
      detail: capacity > 0
        ? `${used} dari ${capacity} slot pada periode ini telah terisi.`
        : 'Kuota periode ini sudah penuh.',
      capacity,
      used,
      capacityPerWave
    };
  }

  if (activePeriod.status !== 'open'
    || registrationState.acceptingRegistrations !== true
    || !Number.isFinite(periodClose)
    || now > periodClose) {
    return {
      state: 'closed',
      label: 'REGISTRATION CLOSED',
      title: 'Pendaftaran ditutup',
      detail: periodClose
        ? `Periode ditutup ${formatWib(periodClose, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}.`
        : 'Panitia sedang tidak menerima pendaftaran.',
      capacity,
      used,
      capacityPerWave
    };
  }

  if (Number.isFinite(periodOpen) && now < periodOpen) {
    return {
      state: 'upcoming',
      label: 'REGISTRATION UPCOMING',
      title: 'Pendaftaran segera dibuka',
      detail: `${formatWib(periodOpen, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })} · ${remainingLabel(periodOpen)}`,
      capacity,
      used,
      capacityPerWave
    };
  }

  if (!packageEnabled) {
    return {
      state: 'closed',
      label: 'CATEGORY UNAVAILABLE',
      title: 'Kategori belum dibuka',
      detail: 'Belum ada pendaftaran untuk kategori ini.',
      capacity,
      used,
      capacityPerWave
    };
  }

  // Match each slot to its category schedule; global wave times can differ.
  const openSlots = relevantSlots.filter((slot) => {
    const wave = waveConfig(slot.package, slot.wave);
    if (!wave) return false;
    const opensAt = Number(wave.registrationOpenAt || periodOpen);
    const closesAt = Number(wave.registrationCloseAt || periodClose);
    return opensAt <= now && closesAt >= now;
  });
  const hasOpenWave = openSlots.length > 0;
  const allOpenSlotsFull = openSlots.length > 0
    && openSlots.every((slot) => Number(slot.count || 0) >= Number(slot.capacity || 0));

  if (!hasOpenWave) {
    const futureWave = relevantSlots
      .map((slot) => waveConfig(slot.package, slot.wave))
      .filter((wave) => wave && wave.enabled !== false && Number(wave.registrationOpenAt || periodOpen) > now)
      .sort((a, b) => Number(a.registrationOpenAt) - Number(b.registrationOpenAt))[0];
    return futureWave ? {
      state: 'upcoming',
      label: 'REGISTRATION UPCOMING',
      title: 'Gelombang segera dibuka',
      detail: `${formatWib(futureWave.registrationOpenAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })} · ${remainingLabel(futureWave.registrationOpenAt)}`,
      capacity,
      used,
      capacityPerWave
    } : {
      state: 'closed',
      label: 'REGISTRATION CLOSED',
      title: 'Pendaftaran gelombang ditutup',
      detail: 'Belum ada gelombang yang dibuka. Cek jadwal berikutnya.',
      capacity,
      used,
      capacityPerWave
    };
  }

  if (allOpenSlotsFull) {
    return {
      state: 'full',
      label: 'REGISTRATION FULL',
      title: 'Kuota pendaftaran penuh',
      detail: `${used} dari ${capacity} slot telah terisi.`,
      capacity,
      used,
      capacityPerWave
    };
  }

  return {
    state: 'open',
    label: 'REGISTRATION OPEN',
    title: 'Pendaftaran dibuka',
    detail: `${activePeriod.label || registrationState.openPeriodId} · ditutup ${formatWib(periodClose, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })} · ${remainingLabel(periodClose)}`,
    capacity,
    used,
    capacityPerWave
  };
};

const ensureBadge = () => {
  let badge = document.querySelector('[data-live-registration-badge]');
  if (badge) return badge;
  const target = document.querySelector('.detail-main-paper');
  if (!target) return null;
  badge = document.createElement('div');
  badge.className = 'live-registration-badge';
  badge.dataset.liveRegistrationBadge = '';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  badge.innerHTML = '<i aria-hidden="true"></i><span><b>Memeriksa pendaftaran…</b><small>Menunggu kabar terbaru</small></span>';
  target.prepend(badge);
  return badge;
};

const updateRegistrationLinks = (status, scope = document) => {
  scope.querySelectorAll('a.btn-register[href*="form-pendaftaran"], a.btn-register[data-original-href*="form-pendaftaran"], a[data-registration-link]').forEach((link) => {
    if (!link.dataset.originalHref) link.dataset.originalHref = link.getAttribute('href') || '';
    if (!link.dataset.originalHtml) link.dataset.originalHtml = link.innerHTML;
    if (link.dataset.liveState === status.state) return;
    link.dataset.liveState = status.state;
    const open = status.state === 'open';
    link.classList.toggle('registration-link-disabled', !open);
    link.setAttribute('aria-disabled', String(!open));
    if (open) {
      link.setAttribute('href', link.dataset.originalHref);
      link.innerHTML = link.dataset.originalHtml;
      link.removeAttribute('tabindex');
    } else {
      link.removeAttribute('href');
      link.tabIndex = -1;
      link.textContent = status.state === 'upcoming'
        ? 'Belum Dibuka'
        : status.state === 'full'
          ? 'Kuota Penuh'
          : status.state === 'unavailable' ? 'Cek Status Nanti' : 'Pendaftaran Ditutup';
    }
  });
};

const renderWaveDossier = (packageId) => {
  if (!packageId) return;
  document.querySelectorAll('.important-deadline').forEach((node, index) => {
    const waveId = index === 0 ? 'wave-01' : 'wave-02';
    const wave = waveConfig(packageId, waveId);
    if (!wave) return;
    const now = serverNow();
    const opensAt = Number(wave.registrationOpenAt || activePeriod?.registrationOpenAt || 0);
    const closesAt = Number(wave.registrationCloseAt || activePeriod?.registrationCloseAt || 0);
    const isOpen = wave.enabled !== false && opensAt <= now && closesAt >= now;
    const upcoming = wave.enabled !== false && now < opensAt;
    const small = node.querySelector('small');
    const strong = node.querySelector('strong');
    const paragraph = node.querySelector('p');
    if (small) small.textContent = `GELOMBANG ${index + 1} · ${isOpen ? 'DIBUKA' : upcoming ? 'SEGERA DIBUKA' : 'DITUTUP'}`;
    if (strong) strong.textContent = isOpen
      ? `Tutup ${formatWib(closesAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`
      : formatWib(upcoming ? opensAt : closesAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    if (paragraph) paragraph.textContent = isOpen
      ? `${remainingLabel(closesAt)} sebelum gelombang ditutup.`
      : upcoming
        ? `${remainingLabel(opensAt)} sebelum gelombang dibuka.`
        : 'Pendaftaran gelombang ini sudah ditutup.';
    node.dataset.state = isOpen ? 'open' : upcoming ? 'upcoming' : 'closed';
  });
};

const renderTicketPage = () => {
  const status = evaluateStatus(pagePackage);
  document.documentElement.dataset.registrationState = status.state;
  document.body.dataset.registrationState = status.state;

  const badge = ensureBadge();
  if (badge) {
    badge.dataset.state = status.state;
    badge.querySelector('b').textContent = status.label;
    badge.querySelector('small').textContent = status.detail;
  }

  document.querySelectorAll('[data-registration-status-title]').forEach((node) => { node.textContent = status.title; });
  document.querySelectorAll('[data-registration-status-detail]').forEach((node) => { node.textContent = status.detail; });
  document.querySelectorAll('.registration-status-note').forEach((node) => {
    const strong = node.querySelector('strong') || document.createElement('strong');
    strong.textContent = `${status.title}.`;
    const nextAction = document.createElement('a');
    nextAction.href = '../index.html#timeline';
    nextAction.textContent = 'Lihat jadwal lomba →';
    nextAction.className = 'registration-next-action';
    nextAction.hidden = status.state === 'open';
    node.replaceChildren(strong, document.createTextNode(` ${status.detail} `), nextAction);
    node.dataset.state = status.state;
  });
  document.querySelectorAll('.important-dossier').forEach((node) => { node.dataset.state = status.state; });
  const dossierHeader = document.querySelector('.important-dossier-top span');
  if (dossierHeader) dossierHeader.textContent = status.label;

  if (status.capacityPerWave > 0) {
    document.querySelectorAll('[data-live-capacity]').forEach((node) => { node.textContent = String(status.capacityPerWave); });
  }
  document.querySelectorAll('[data-live-slot-summary]').forEach((node) => { node.textContent = `${status.used}/${status.capacity}`; });
  renderWaveDossier(pagePackage);
  updateRegistrationLinks(status);
  return status;
};

const renderIndexCards = () => {
  document.querySelectorAll('[data-ticket-package]').forEach((card) => {
    const packageId = card.dataset.ticketPackage;
    if (!VALID_PACKAGES.has(packageId)) return;
    const status = evaluateStatus(packageId);
    card.dataset.registrationState = status.state;
    const chip = card.querySelector('[data-live-ticket-status]');
    if (chip) {
      chip.querySelector('span').textContent = status.label;
      chip.querySelector('b').textContent = status.title;
    }
    const capacity = status.capacityPerWave || 0;
    card.querySelectorAll('[data-live-capacity]').forEach((node) => {
      if (capacity > 0) node.textContent = String(capacity);
    });
  });
};

const render = () => {
  const status = renderTicketPage();
  renderIndexCards();
  const detail = {
      ...status,
      packageId: pagePackage,
      period: activePeriod,
      slots: activeSlots.map((slot) => ({ ...slot })),
      system: registrationState ? { ...registrationState } : null,
      serverNow: serverNow(),
      serverClockOffset: getServerClockOffset()
  };
  // Consumers initialized after Firebase Auth can reuse the latest live snapshot.
  window.esoriaRegistrationContext = detail;
  window.dispatchEvent(new CustomEvent('esoria:registration-status', { detail }));
};

const watchPeriod = (periodId) => {
  unsubscribePeriod?.();
  unsubscribeSlots?.();
  periodReadError = false;
  slotsReadError = false;
  activePeriod = null;
  activeSlots = [];
  if (!periodId) {
    render();
    return;
  }

  unsubscribePeriod = onSnapshot(doc(db, 'periods', periodId), (snapshot) => {
    periodReadError = false;
    activePeriod = snapshot.exists() ? serializePeriod({ id: snapshot.id, ...snapshot.data() }) : null;
    render();
  }, () => {
    periodReadError = true;
    activePeriod = null;
    render();
  });

  unsubscribeSlots = onSnapshot(
    query(collection(db, 'periodSlots'), where('periodId', '==', periodId)),
    (snapshot) => {
      slotsReadError = false;
    activeSlots = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      render();
    },
    () => {
      slotsReadError = true;
      activeSlots = [];
      render();
    }
  );
};

// Clock synchronization is optional for display and must not block subscriptions.
void syncServerClock().then(render);
const clockTicker = window.setInterval(() => {
  if (!document.hidden) void syncServerClock({ force: true }).then(render);
}, 5 * 60 * 1000);
ticker = window.setInterval(() => { if (!document.hidden) render(); }, 30000);

const unsubscribeState = onSnapshot(doc(db, 'system', 'registration'), (snapshot) => {
  stateReadError = false;
  const next = snapshot.exists() ? snapshot.data() : null;
  const changedPeriod = next?.openPeriodId !== registrationState?.openPeriodId;
  registrationState = next;
  if (changedPeriod) watchPeriod(registrationState?.openPeriodId || '');
  else render();
}, () => {
  stateReadError = true;
  registrationState = null;
  watchPeriod('');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void syncServerClock().then(render);
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void syncServerClock().then(render);
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  window.clearInterval(ticker);
  window.clearInterval(clockTicker);
  unsubscribeState?.();
  unsubscribePeriod?.();
  unsubscribeSlots?.();
});
