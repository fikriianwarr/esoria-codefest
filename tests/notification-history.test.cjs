const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/notification-center.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function history(records, options = {}) {
  const nodes = {};
  const cache = new Map();
  const server = new Map(records.map((item) => [item.id, { ...item }]));
  const timers = new Map();
  const calls = { reads: 0, updates: [], deletes: [], toasts: [], confirms: 0, batches: 0 };
  const element = () => ({ hidden: false, disabled: false, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {},
    querySelector: (selector) => nodes[selector] });
  const context = {
    URL, console, location: { href: 'https://example.test/profil.html', origin: 'https://example.test' },
    toggle: element(), badge: element(), panel: null, list: null, empty: null,
    clearButton: null, readButton: null, currentUser: { uid: 'part_a' }, authEpoch: 1,
    mutationBusy: false, readBusy: false, panelOpen: false, panelCloseTimer: 0,
    items: records.slice(0, 400).map((item) => ({ ...item })), db: {},
    NOTIFICATION_CACHE_VERSION: 'v3', NOTIFICATION_CACHE_LIMIT: 400,
    localStorage: { getItem: (key) => options.blockStorage ? (() => { throw Error('blocked'); })() : cache.get(key),
      setItem: (key, value) => { if (options.blockStorage) throw Error('blocked'); cache.set(key, value); } },
    requestAnimationFrame: (callback) => callback(),
    window: { clearTimeout: (id) => timers.delete(id), setTimeout: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; } },
    showNotificationToast: (message) => calls.toasts.push(message),
    paperConfirm: async () => { calls.confirms += 1; return options.confirm !== false; },
    doc: (_, ...parts) => ({ path: parts.join('/') }), collection: (_, ...parts) => ({ path: parts.join('/') }),
    orderBy: () => ({ kind: 'order' }), limit: (value) => ({ kind: 'limit', value }),
    startAfter: (value) => ({ kind: 'cursor', value }), query: (ref, ...constraints) => ({ ...ref, constraints }),
    serverTimestamp: () => ({ server: true }),
    getDocsFromServer: async (query) => {
      calls.reads += 1;
      if (options.offline) throw Error('offline');
      if (options.switchAccount) { context.currentUser = { uid: 'part_b' }; context.authEpoch += 1; }
      const cursor = query.constraints.find((item) => item.kind === 'cursor')?.value;
      const max = query.constraints.find((item) => item.kind === 'limit').value;
      const values = [...server.values()].sort((a, b) => b.createdAt - a.createdAt)
        .filter((item) => !cursor || item.createdAt < cursor.createdAt).slice(0, max);
      const docs = values.map((item) => ({ id: item.id, createdAt: item.createdAt, ref: { path: `users/part_a/notifications/${item.id}` } }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    writeBatch: () => {
      const writes = [];
      return { update: (ref, data) => writes.push({ type: 'update', ref, data }),
        delete: (ref) => writes.push({ type: 'delete', ref }),
        commit: async () => {
          if (options.rejectCommit) throw Error('write rejected');
          calls.batches += 1;
          for (const item of writes) {
            const id = item.ref.path.split('/').at(-1);
            if (item.type === 'delete') { server.delete(id); calls.deletes.push(id); }
            else { server.set(id, { ...server.get(id), ...item.data }); calls.updates.push(id); }
          }
          if (options.arrivalDuringClear && calls.batches === 1 && writes[0]?.type === 'delete') {
            const arrival = { id: 'new-arrival', createdAt: 1000000, title: 'Baru masuk', read: false };
            server.set(arrival.id, arrival); context.items.unshift(arrival);
          }
        }
      };
    },
    ensurePanel: () => {
      if (context.panel) return context.panel;
      nodes['[data-notification-summary]'] = element();
      context.panel = element(); context.panel.hidden = true;
      context.list = element(); context.empty = element(); context.clearButton = element(); context.readButton = element();
      return context.panel;
    }
  };
  vm.runInNewContext([
    between('const escapeHtml', 'const ensureToastHost'),
    between('const renderToolbar', 'const markAllRead'),
    between('const markAllRead', "toggle?.addEventListener('click'"),
    'this.api = { openPanel, closePanel, markAllRead, clearAll, render, readNotificationCache, writeNotificationCache };'
  ].join('\n'), context);
  context.api.writeNotificationCache('part_a', context.items);
  return { context, server, calls, nodes, cache, ...context.api };
}
const entries = (read = false, count = 2) => Array.from({ length: count }, (_, index) => ({
  id: `activity-${index}`, title: `Aktivitas ${index}`, message: 'Hasil tersimpan', read, createdAt: count - index
}));

test('riwayat yang semuanya sudah dibaca tetap tampil saat panel baru pertama dibuka', () => {
  const h = history(entries(true));
  h.render(); assert.equal(h.context.panel, null);
  h.openPanel();
  assert.match(h.context.list.innerHTML, /Aktivitas 0/);
  assert.match(h.context.list.innerHTML, /Aktivitas 1/);
  assert.equal(h.context.empty.hidden, true);
  assert.equal(h.context.panel.hidden, false);
  assert.equal(h.calls.batches, 0);
});

test('buka tutup panel tidak menandai dibaca, menghapus dokumen, atau mengosongkan cache', () => {
  const h = history(entries());
  h.openPanel(); h.closePanel(); h.openPanel();
  assert.equal(h.context.badge.textContent, '2');
  assert.equal(h.server.size, 2);
  assert.equal(h.readNotificationCache('part_a').length, 2);
  assert.equal(h.calls.batches, 0);
});

test('Tandai Dibaca mengubah status tetapi semua kartu dan dokumen tetap tersedia', async () => {
  const h = history(entries()); h.openPanel();
  await h.markAllRead();
  assert.equal(h.calls.updates.length, 2);
  assert.equal(h.calls.deletes.length, 0);
  assert.equal(h.server.size, 2);
  assert.equal(h.context.badge.hidden, true);
  assert.match(h.context.list.innerHTML, /Aktivitas 0/);
  h.closePanel(); h.openPanel();
  assert.match(h.context.list.innerHTML, /Aktivitas 1/);
  assert.equal(h.readNotificationCache('part_a').length, 2);
});

test('menolak status baca tidak menghilangkan riwayat atau menyisakan tombol terkunci', async () => {
  const h = history(entries(), { rejectCommit: true }); h.openPanel();
  await h.markAllRead();
  assert.equal(h.context.items.length, 2);
  assert.equal(h.context.readButton.disabled, false);
  assert.equal(h.calls.toasts[0].title, 'Status baca belum tersimpan');
});

test('membatalkan konfirmasi Hapus Semua tidak membaca atau menghapus koleksi', async () => {
  const h = history(entries(), { confirm: false }); h.openPanel(); await h.clearAll();
  assert.equal(h.server.size, 2); assert.equal(h.calls.reads, 0); assert.equal(h.calls.deletes.length, 0);
});

test('Hapus Semua membersihkan dokumen dan cache setelah server mengonfirmasi', async () => {
  const h = history(entries()); h.openPanel(); await h.clearAll();
  assert.equal(h.server.size, 0); assert.equal(h.context.items.length, 0);
  assert.equal(h.readNotificationCache('part_a').length, 0);
  assert.equal(h.context.empty.hidden, false); assert.equal(h.context.clearButton.disabled, true);
});

test('penghapusan lebih dari satu batch memakai cursor dan mempertahankan notifikasi yang baru datang', async () => {
  const h = history(entries(false, 600), { arrivalDuringClear: true }); h.openPanel(); await h.clearAll();
  assert.equal(h.calls.deletes.length, 600); assert.equal(h.calls.reads, 2);
  assert.equal(h.server.size, 1); assert.equal(h.server.has('new-arrival'), true);
  assert.equal(h.context.items.length, 1); assert.equal(h.context.items[0].id, 'new-arrival');
});

test('koneksi terputus saat Hapus Semua mempertahankan notifikasi yang belum dihapus', async () => {
  const h = history(entries(), { offline: true }); h.openPanel(); await h.clearAll();
  assert.equal(h.server.size, 2); assert.equal(h.context.items.length, 2);
  assert.equal(h.context.clearButton.disabled, false);
  assert.equal(h.calls.toasts[0].title, 'Penghapusan belum selesai');
});

test('pergantian akun saat query berjalan membatalkan batch akun lama', async () => {
  const h = history(entries(), { switchAccount: true }); h.openPanel(); await h.clearAll();
  assert.equal(h.calls.deletes.length, 0); assert.equal(h.server.size, 2);
});

test('storage diblokir atau cache rusak tidak menggagalkan render riwayat', () => {
  const h = history(entries(), { blockStorage: true }); h.openPanel();
  assert.match(h.context.list.innerHTML, /Aktivitas 0/);
  assert.equal(h.readNotificationCache('part_a').length, 0);
  const normal = history(entries());
  normal.cache.set('esoria-notifications-v3:part_a', '[null,{},false,{"id":"valid","read":true}]');
  assert.equal(normal.readNotificationCache('part_a').length, 1);
});
