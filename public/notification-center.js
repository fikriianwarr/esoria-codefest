import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js?v=b74586eaa5ef6110';
import { paperConfirm } from './paper-confirm.js?v=b74586eaa5ef6110';

const toggle = document.querySelector('[data-notification-toggle]');
const badge = toggle?.querySelector('[data-notification-count]');
let panel = null;
let list = null;
let empty = null;
let clearButton = null;
let readButton = null;
let unsubscribe = null;
let currentUser = null;
let items = [];
let initialized = false;
let toastTimer = 0;
let panelCloseTimer = 0;
let panelOpen = false;
let listenerErrorShown = false;
let mutationBusy = false;
let readBusy = false;
let authEpoch = 0;
const NOTIFICATION_CACHE_VERSION = 'v3';
const NOTIFICATION_CACHE_LIMIT = 400;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);

const timestampValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return value?.toMillis?.()
    ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : 0);
};

const cacheKeyFor = (uid) => `esoria-notifications-${NOTIFICATION_CACHE_VERSION}:${uid}`;
const serializeNotification = (item) => ({
  ...item,
  createdAt: timestampValue(item.createdAt),
  readAt: timestampValue(item.readAt) || null
});
const readNotificationCache = (uid) => {
  if (!uid) return [];
  try {
    const value = JSON.parse(localStorage.getItem(cacheKeyFor(uid)) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object'
      && typeof item.id === 'string' && item.id.length > 0 && !item.id.includes('/'))
      .slice(0, NOTIFICATION_CACHE_LIMIT) : [];
  } catch {
    return [];
  }
};
const writeNotificationCache = (uid, values) => {
  if (!uid) return;
  try {
    localStorage.setItem(
      cacheKeyFor(uid),
      JSON.stringify(values.slice(0, NOTIFICATION_CACHE_LIMIT).map(serializeNotification))
    );
  } catch {
    // Cache lokal hanya cadangan. Firestore tetap menjadi sumber permanen.
  }
};

const sameSession = (uid, epoch) => currentUser?.uid === uid && authEpoch === epoch;
const removeAcknowledged = (uid, ids) => {
  const removed = new Set(ids);
  const cached = readNotificationCache(uid).filter((item) => !removed.has(item.id));
  writeNotificationCache(uid, cached);
  if (currentUser?.uid === uid) {
    items = items.filter((item) => !removed.has(item.id));
    writeNotificationCache(uid, items);
    render();
  }
};

const relativeTime = (value) => {
  const time = timestampValue(value);
  if (!time) return 'Baru saja';
  const delta = Math.max(0, Date.now() - time);
  if (delta < 60000) return 'Baru saja';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} menit lalu`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} jam lalu`;
  if (delta < 604800000) return `${Math.floor(delta / 86400000)} hari lalu`;
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(time));
};

const safeActionUrl = (value = '') => {
  const source = String(value || '').trim();
  if (!source || source.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(source)) return '';
  try {
    const url = new URL(source, location.href);
    return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : '';
  } catch {
    return '';
  }
};

const iconFor = (type) => ({
  registration: 'RG',
  payment: 'PY',
  profile: 'ID',
  account: 'AC',
  ticket: 'TK',
  system: 'EC'
})[type] || 'EC';

const ensureToastHost = () => {
  let host = document.querySelector('.ec-notification-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'ec-notification-toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
};

export const showNotificationToast = ({ title = 'Notifikasi', message = '', type = 'system' } = {}) => {
  const host = ensureToastHost();
  host.innerHTML = '';
  const toast = document.createElement('article');
  toast.className = 'ec-notification-toast';
  toast.dataset.type = type;
  toast.innerHTML = `<b>${escapeHtml(iconFor(type))}</b><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small></span><i aria-hidden="true"></i>`;
  host.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 230);
  }, 3000);
};

window.showNotificationToast = showNotificationToast;
window.addEventListener('esoria:notification-toast', (event) => showNotificationToast(event.detail || {}));

const ensurePanel = () => {
  if (panel || !toggle) return panel;
  panel = document.createElement('section');
  panel.className = 'ec-notification-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ec-notification-title');
  panel.innerHTML = `
    <header class="ec-notification-panel-head">
      <div><span>ACTIVITY SIGNAL</span><h2 id="ec-notification-title">Notifikasi</h2><p>Notifikasi yang sudah dibaca tetap tampil dalam riwayat.</p></div>
      <button aria-label="Tutup notifikasi" data-notification-close type="button">×</button>
    </header>
    <div class="ec-notification-toolbar"><span data-notification-summary>Belum ada notifikasi</span><div class="ec-notification-toolbar-actions"><button data-notification-read title="Tandai notifikasi yang ditampilkan sebagai dibaca" type="button">Tandai Dibaca</button><button data-notification-clear type="button">Hapus Semua</button></div></div>
    <div class="ec-notification-list" data-notification-list></div>
    <div class="ec-notification-empty" data-notification-empty><b>00</b><strong>Belum ada aktivitas.</strong><span>Notifikasi baru akan muncul di sini tanpa memuat ulang halaman.</span></div>`;
  document.body.append(panel);
  list = panel.querySelector('[data-notification-list]');
  empty = panel.querySelector('[data-notification-empty]');
  clearButton = panel.querySelector('[data-notification-clear]');
  readButton = panel.querySelector('[data-notification-read]');

  panel.querySelector('[data-notification-close]').addEventListener('click', () => { closePanel(); toggle?.focus(); });
  clearButton.addEventListener('click', clearAll);
  readButton.addEventListener('click', markAllRead);
  list.addEventListener('click', async (event) => {
    const menuButton = event.target.closest('[data-notification-menu]');
    if (menuButton) {
      const card = menuButton.closest('[data-notification-id]');
      const menu = card?.querySelector('.ec-notification-item-menu');
      list.querySelectorAll('.ec-notification-item-menu').forEach((node) => {
        if (node !== menu) { node.hidden = true; node.parentElement?.querySelector('[data-notification-menu]')?.setAttribute('aria-expanded','false'); }
      });
      if (menu) {
        menu.hidden = !menu.hidden;
        if (!menu.hidden) menuButton.setAttribute('aria-expanded', 'true');
        else menuButton.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    const deleteButton = event.target.closest('[data-notification-delete]');
    if (deleteButton && currentUser) {
      if (mutationBusy || readBusy) return;
      const uid = currentUser.uid;
      const epoch = authEpoch;
      const id = deleteButton.dataset.notificationDelete;
      if (!items.some((item) => item.id === id)) return;
      mutationBusy = true;
      deleteButton.disabled = true;
      renderToolbar();
      try {
        await deleteDoc(doc(db, 'users', uid, 'notifications', id));
        removeAcknowledged(uid, [id]);
      } catch {
        deleteButton.disabled = false;
        if (sameSession(uid, epoch)) showNotificationToast({ title: 'Notifikasi belum terhapus', message: 'Periksa koneksi lalu coba kembali.', type: 'system' });
      } finally {
        if (sameSession(uid, epoch)) { mutationBusy = false; renderToolbar(); }
      }
      return;
    }
    const action = event.target.closest('[data-notification-action]');
    if (action) {
      const target = safeActionUrl(action.dataset.notificationAction);
      if (target) location.assign(target);
    }
  });

  document.addEventListener('click', (event) => {
    if (panel.hidden) return;
    if (event.target.closest('.ec-notification-panel') || event.target.closest('[data-notification-toggle]')) return;
    closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { closePanel(); toggle?.focus(); }
  });
  return panel;
};

const renderToolbar = () => {
  const unread = items.filter((item) => item.read !== true).length;
  const summary = panel?.querySelector('[data-notification-summary]');
  if (summary) summary.textContent = `${items.length} aktivitas · ${unread} belum dibaca`;
  if (clearButton) clearButton.disabled = !items.length || mutationBusy || readBusy;
  if (readButton) readButton.disabled = !unread || mutationBusy || readBusy;
};

const render = () => {
  if (!toggle) return;
  const unread = items.filter((item) => item.read !== true).length;
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
  }
  toggle.classList.toggle('has-unread', unread > 0);
  toggle.setAttribute('aria-label', unread ? `Buka notifikasi, ${unread} belum dibaca` : 'Buka notifikasi');
  renderToolbar();
  if (!list || !empty) return;
  empty.hidden = items.length > 0;
  list.hidden = items.length === 0;
  list.innerHTML = items.map((item) => {
    const actionUrl = safeActionUrl(item.actionUrl);
    return `<article class="ec-notification-item" data-notification-id="${escapeHtml(item.id)}" data-read="${item.read === true}">
      <div class="ec-notification-item-icon" data-type="${escapeHtml(item.type || 'system')}">${escapeHtml(iconFor(item.type))}</div>
      <div class="ec-notification-item-copy"><span>${escapeHtml(relativeTime(item.createdAt))}</span><h3>${escapeHtml(item.title || 'Aktivitas akun')}</h3><p>${escapeHtml(item.message || '')}</p>${actionUrl ? `<button data-notification-action="${escapeHtml(actionUrl)}" type="button">${escapeHtml(item.actionLabel || 'Buka detail')} →</button>` : ''}</div>
      <div class="ec-notification-item-controls"><i aria-hidden="true"></i><button aria-label="Menu notifikasi" aria-expanded="false" data-notification-menu type="button"><span aria-hidden="true" class="ec-notification-dots"><span></span><span></span><span></span></span></button><div class="ec-notification-item-menu" hidden><button data-notification-delete="${escapeHtml(item.id)}" type="button">Hapus notifikasi</button></div></div>
    </article>`;
  }).join('');
};

const markAllRead = async () => {
  if (!currentUser || readBusy || mutationBusy) return;
  const uid = currentUser.uid;
  const epoch = authEpoch;
  const unread = items.filter((item) => item.read !== true).slice(0, 450);
  if (!unread.length) return;
  readBusy = true;
  renderToolbar();
  const batch = writeBatch(db);
  unread.forEach((item) => batch.update(doc(db, 'users', uid, 'notifications', item.id), {
    read: true,
    readAt: serverTimestamp()
  }));
  try {
    await batch.commit();
    if (sameSession(uid, epoch)) {
      const ids = new Set(unread.map((item) => item.id));
      items = items.map((item) => ids.has(item.id) ? { ...item, read: true, readAt: Date.now() } : item);
      writeNotificationCache(uid, items);
      render();
    }
  } catch {
    if (sameSession(uid, epoch)) showNotificationToast({ title: 'Status baca belum tersimpan', message: 'Riwayat tetap ada. Periksa koneksi lalu coba kembali.', type: 'system' });
  } finally {
    if (sameSession(uid, epoch)) { readBusy = false; renderToolbar(); }
  }
};

function openPanel() {
  ensurePanel();
  if (!panel || !currentUser) return;
  // The listener often finishes before this lazy panel exists. Always render
  // on open, including a history whose notifications are already all read.
  render();
  window.clearTimeout(panelCloseTimer);
  panelOpen = true;
  panel.hidden = false;
  requestAnimationFrame(() => { if (panelOpen) panel.classList.add('is-open'); });
  toggle?.setAttribute('aria-expanded', 'true');
}

function closePanel() {
  if (!panel || !panelOpen) return;
  panelOpen = false;
  panel.classList.remove('is-open');
  toggle?.setAttribute('aria-expanded', 'false');
  window.clearTimeout(panelCloseTimer);
  panelCloseTimer = window.setTimeout(() => { panel.hidden = true; }, 190);
}

async function clearAll() {
  if (!currentUser || !items.length || mutationBusy || readBusy) return;
  const uid = currentUser.uid;
  const epoch = authEpoch;
  const confirmed = await paperConfirm({ title: 'Hapus semua notifikasi?', message: 'Riwayat notifikasi akun akan dihapus. Pastikan tidak ada informasi yang masih perlu kamu simpan.', confirmText: 'Hapus Semua', danger: true });
  if (!confirmed || !sameSession(uid, epoch) || mutationBusy || readBusy) return;
  mutationBusy = true;
  renderToolbar();
  try {
    const notifications = collection(db, 'users', uid, 'notifications');
    let removed = 0;
    let cursor = null;
    while (true) {
      if (!sameSession(uid, epoch)) return;
      const constraints = [orderBy('createdAt', 'desc'), limit(450)];
      if (cursor) constraints.push(startAfter(cursor));
      const snapshot = await getDocsFromServer(query(notifications, ...constraints));
      if (snapshot.empty) break;
      if (!sameSession(uid, epoch)) return;
      cursor = snapshot.docs[snapshot.docs.length - 1];
      const batch = writeBatch(db);
      snapshot.docs.forEach((item) => batch.delete(item.ref));
      await batch.commit();
      removed += snapshot.size;
      removeAcknowledged(uid, snapshot.docs.map((item) => item.id));
      if (snapshot.size < 450) break;
    }
    if (sameSession(uid, epoch)) showNotificationToast({ title: 'Notifikasi dibersihkan', message: `${removed} aktivitas telah dihapus dari pusat notifikasi.`, type: 'system' });
  } catch {
    if (sameSession(uid, epoch)) showNotificationToast({ title: 'Penghapusan belum selesai', message: 'Riwayat yang belum terhapus tetap tersedia. Periksa koneksi lalu coba kembali.', type: 'system' });
  } finally {
    if (sameSession(uid, epoch)) { mutationBusy = false; render(); }
  }
}

toggle?.addEventListener('click', () => {
  ensurePanel();
  if (panelOpen) closePanel(); else openPanel();
});

const pendingToast = (() => {
  try {
    const value = JSON.parse(sessionStorage.getItem('esoria-pending-notification-toast') || 'null');
    sessionStorage.removeItem('esoria-pending-notification-toast');
    return value;
  } catch {
    return null;
  }
})();
if (pendingToast) window.setTimeout(() => showNotificationToast(pendingToast), 380);

onAuthStateChanged(auth, (user) => {
  unsubscribe?.();
  authEpoch += 1;
  const epoch = authEpoch;
  currentUser = user;
  mutationBusy = false;
  readBusy = false;
  initialized = false;
  listenerErrorShown = false;
  items = user ? readNotificationCache(user.uid) : [];
  render();
  if (!user) { closePanel(); return; }

  const notificationQuery = query(
    collection(db, 'users', user.uid, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(NOTIFICATION_CACHE_LIMIT)
  );

  unsubscribe = onSnapshot(notificationQuery, { includeMetadataChanges: true }, (snapshot) => {
    if (!sameSession(user.uid, epoch)) return;
    const newItems = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));

    // Saat browser belum memperoleh jawaban server, snapshot cache dapat kosong.
    // Jangan mengganti riwayat lokal yang sudah ada dengan snapshot kosong sementara.
    if (snapshot.metadata.fromCache && snapshot.empty && items.length > 0) {
      return;
    }

    if (initialized && !snapshot.metadata.hasPendingWrites) {
      snapshot.docChanges({ includeMetadataChanges: true }).filter((change) => change.type === 'added').forEach((change) => {
        const item = change.doc.data();
        showNotificationToast({ title: item.title, message: item.message, type: item.type });
      });
    }

    initialized = true;
    listenerErrorShown = false;
    items = newItems;
    writeNotificationCache(user.uid, items);
    render();
  }, (error) => {
    if (!sameSession(user.uid, epoch)) return;
    // Riwayat terakhir tidak dibuang ketika koneksi putus atau rules belum
    // tersinkron. Data akan direkonsiliasi kembali saat listener tersambung.
    console.error('Listener notifikasi gagal:', error);
    render();
    if (!listenerErrorShown) {
      listenerErrorShown = true;
      showNotificationToast({
        title: 'Notifikasi tersimpan lokal',
        message: 'Riwayat terakhir tetap ditampilkan. Koneksi akan dicoba kembali saat halaman dibuka lagi.',
        type: 'system'
      });
    }
  });
});
