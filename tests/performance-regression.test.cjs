const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const withoutImports = (source) => source.replace(/^import[\s\S]*?;\s*$/gm, '').replaceAll('export const ', 'const ');

test('storage yang diblokir atau penuh tidak melempar error dan tetap menjaga id percobaan', () => {
  const denied = () => { throw new Error('SecurityError'); };
  const browser = {};
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(browser, name, { get: denied });
  const context = { window: browser };
  vm.runInNewContext(`${withoutImports(read('safe-storage.js'))}\nthis.local = localStore; this.session = sessionStore;`, context);
  assert.equal(context.session.setItem('attempt', 'stable-id'), false);
  assert.equal(context.session.getItem('attempt'), 'stable-id');
  assert.equal(context.local.getItem('attempt'), null);
  context.session.removeItem('attempt');
  assert.equal(context.session.getItem('attempt'), null);
});

test('storage normal menyimpan dan menghapus nilai pada browser', () => {
  const values = new Map();
  const store = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const context = { window: { localStorage: store, sessionStorage: store } };
  vm.runInNewContext(`${withoutImports(read('safe-storage.js'))}\nthis.store = localStore;`, context);
  assert.equal(context.store.setItem('draft', 123), true);
  assert.equal(values.get('draft'), '123');
  context.store.removeItem('draft');
  assert.equal(values.has('draft'), false);
});

test('edit periode diterjemahkan menjadi update pada payload API dan mempertahankan revisi', async () => {
  const calls = [];
  const context = { functions: {}, runtimeConfig: {}, currentSessionKey:()=>"test-device-key", httpsCallable: () => async (input) => { calls.push(input); return { data: { ok: true } }; } };
  vm.runInNewContext(`${withoutImports(read('spark-data.js'))}\nthis.save = savePeriod;`, context);
  const common = { periodId: '2026-11', status: 'draft', expectedRevision: 4, enabledPackages: { web: true }, enabledPackageWaves: { web: { 'wave-01': true } } };
  await context.save({ ...common, mode: 'edit' });
  assert.equal(calls[0].action, 'savePeriod');
  assert.equal(calls[0].payload.mode, 'update');
  assert.equal(calls[0].payload.expectedRevision, 4);
  assert.equal(calls[0].payload.packages.web.waves['wave-01'].enabled, true);
  await context.save({ ...common, mode: 'create' });
  assert.equal(calls[1].payload.mode, 'create');
});

test('ubah kata sandi asli memperbarui validitas konfirmasi tanpa mengetik ulang konfirmasi', () => {
  const listeners = {};
  const input = (name) => ({ value: '', addEventListener: (event, callback) => { listeners[`${name}:${event}`] = callback; }, setCustomValidity(value) { this.issue = value; } });
  const password = input('password');
  const confirmation = input('confirmation');
  const nodes = { '#auth-password': password, '#auth-password-confirm': confirmation };
  const context = {
    document: { body: { dataset: { authPage: 'signup' } }, querySelector: (selector) => nodes[selector] || null, querySelectorAll: () => [] },
    window: { location: { search: '', hostname: 'local.test' }, ESORIA_RUNTIME_CONFIG: {} },
    navigator: { userAgent: '' }, matchMedia: () => ({ matches: false }),
    URLSearchParams, safeNextPath: () => 'profil.html'
  };
  vm.runInNewContext(withoutImports(read('auth-pages.js')), context);
  password.value = 'Original123!'; confirmation.value = 'Original123!';
  listeners['confirmation:input']();
  assert.equal(confirmation.issue, '');
  password.value = 'Different123!'; listeners['password:input']();
  assert.match(confirmation.issue, /belum sama/);
  password.value = 'Original123!'; listeners['password:input']();
  assert.equal(confirmation.issue, '');
});

test('umur menolak tanggal yang tidak ada dan menerima tanggal kabisat yang sah', () => {
  const context = {};
  vm.runInNewContext(`${withoutImports(read('time-utils.js'))}\nthis.age = calculateAgeInWib;`, context);
  assert.equal(context.age('2025-02-29', new Date('2026-10-16')), null);
  assert.equal(context.age('2024-02-31', new Date('2026-10-16')), null);
  assert.equal(context.age('2000-02-29', new Date('2026-10-16')), 26);
});

test('sesi yang baru selesai verifikasi email dapat melewati gate tanpa spinner permanen', async () => {
  const user = { uid: 'verified-after-reload', emailVerified: false, async reload() { this.emailVerified = true; }, async getIdToken() {} };
  const classes = new Set(['auth-pending']);
  const context = {
    auth: { currentUser: user }, db: {}, functions: {}, runtimeConfig: {}, verifyAndWatchDeviceSession: async()=>{}, currentSessionKey:()=>"fixture-key",
    onAuthStateChanged: (_, callback) => { queueMicrotask(() => callback(user)); return () => {}; },
    doc: (_, ...parts) => parts.join('/'),
    getDoc: async () => ({ exists: () => false }),
    httpsCallable: () => async () => ({ data: { profile: { profileComplete: true } } }),
    document: { body: { classList: { remove: (name) => classes.delete(name), add: (name) => classes.add(name) } } },
    window: { location: { pathname: '/profil.html', search: '', hash: '', replace() { throw new Error('Tidak semestinya redirect'); } } }
  };
  vm.runInNewContext(`${withoutImports(read('auth-core.js'))}\nthis.require = requireAuthenticated;`, context);
  const result = await context.require({ verifiedEmailRequired: true });
  assert.equal(result.user.uid, user.uid);
  assert.equal(classes.has('auth-pending'), false);
  assert.equal(classes.has('auth-ready'), true);
});

function liveHarness() {
  const subscriptions = [];
  const events = {};
  const intervals = new Map();
  let clears = 0;
  const window = {
    addEventListener: (name, callback) => { events[name] = callback; },
    dispatchEvent() {},
    setInterval: (callback) => { const id = intervals.size + 1; intervals.set(id, callback); return id; },
    clearInterval: (id) => intervals.delete(id)
  };
  const context = {
    window, document: { body: { dataset: {} }, documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, hidden: false },
    location: { search: '' }, URLSearchParams, CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } },
    db: {}, doc: (_, ...parts) => parts.join('/'), collection: (_, name) => name,
    where: (...parts) => parts, query: (...parts) => parts,
    onSnapshot: (target, callback) => { subscriptions.push({ target, callback }); return () => { clears += 1; }; },
    serverNow: () => 1000000, getServerClockOffset: () => 0, syncServerClock: () => new Promise(() => {}), formatWib: () => 'tanggal WIB'
  };
  vm.runInNewContext(`${withoutImports(read('live-registration-status.js'))}\nthis.status = evaluateStatus;`, context);
  const push = (index, data, id = '') => subscriptions[index].callback({ exists: () => true, data: () => data, id });
  const slots = (rows) => subscriptions[2].callback({ docs: rows.map((data, index) => ({ id: String(index), data: () => data })) });
  return { context, subscriptions, events, intervals, push, slots, clears: () => clears };
}

test('status mulai berlangganan saat clock lambat dan tetap hidup setelah halaman dipulihkan', () => {
  const h = liveHarness();
  assert.equal(h.subscriptions.length, 1);
  h.push(0, { openPeriodId: '2026-11', acceptingRegistrations: true });
  assert.equal(h.subscriptions.length, 3);
  h.events.pagehide({ persisted: true });
  assert.equal(h.clears(), 0);
  assert.equal(h.intervals.size, 2);
  h.events.pagehide({ persisted: false });
  assert.equal(h.clears(), 3);
  assert.equal(h.intervals.size, 0);
});

test('status beranda mengikuti jadwal kategori, termasuk gelombang berikutnya dan kuota', () => {
  const h = liveHarness();
  const globalWave = { enabled: true, registrationOpenAt: 900000, registrationCloseAt: 1100000 };
  const period = { status: 'open', registrationOpenAt: 800000, registrationCloseAt: 1200000, waves: { 'wave-01': globalWave }, packages: { web: { enabled: true, waves: { 'wave-01': { ...globalWave, registrationOpenAt: 1050000 } } }, cyber: { enabled: false } } };
  h.push(0, { openPeriodId: '2026-11', acceptingRegistrations: true });
  h.push(1, period, '2026-11');
  h.slots([{ package: 'web', wave: 'wave-01', capacity: 10, count: 2, enabled: true }, { package: 'cyber', wave: 'wave-01', capacity: 10, count: 0, enabled: true }]);
  assert.equal(h.context.status().state, 'upcoming');
  period.packages.web.waves['wave-01'] = globalWave;
  h.push(1, period, '2026-11');
  assert.equal(h.context.status().state, 'open');
  h.slots([{ package: 'web', wave: 'wave-01', capacity: 10, count: 10, enabled: true }]);
  assert.equal(h.context.status().state, 'full');
  h.slots([]);
  assert.equal(h.context.status().state, 'closed');
});

test('permintaan clock paralel dideduplikasi dan timeout tampilan dibatasi 10 detik', async () => {
  let calls = 0, resolve;
  const deferred = new Promise((done) => { resolve = done; });
  const context = { functions: {}, runtimeConfig: {}, currentSessionKey:()=>"test-device-key", httpsCallable: (_, name, options) => {
    assert.equal(options.timeout, 10000);
    return () => { calls += 1; return deferred; };
  } };
  vm.runInNewContext(`${withoutImports(read('server-clock.js'))}\nthis.sync = syncServerClock;`, context);
  const first = context.sync(), second = context.sync();
  assert.equal(calls, 1);
  resolve({ data: { serverNow: Date.now() } });
  await Promise.all([first, second]);
  await context.sync();
  assert.equal(calls, 1);
});

test('analitik tanpa persetujuan tidak mengimpor atau menginisialisasi Firebase', () => {
  const events = {};
  const context = { window: { addEventListener: (name, callback) => { events[name] = callback; }, esoriaCookiePreferences: { analytics: false } } };
  // Static imports would fail here; dynamic imports must remain untouched until opt-in.
  vm.runInNewContext(read('analytics-consent.js'), context);
  assert.doesNotThrow(() => events['esoria:cookie-consent']({ detail: { analytics: false } }));
});

test('gagal mengunduh analitik opsional ditangani tanpa promise rejection yang tidak tertangkap', async () => {
  const events = {}, warnings = [];
  const context = {
    window: { addEventListener: (name, callback) => { events[name] = callback; }, esoriaCookiePreferences: { analytics: false } },
    console: { warn: (...args) => warnings.push(args) }
  };
  vm.runInNewContext(read('analytics-consent.js'), context);
  events['esoria:cookie-consent']({ detail: { analytics: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warnings.length, 1);
});

test('buka ulang panel notifikasi membatalkan timer tutup sebelumnya', () => {
  const timers = new Map();
  const panel = { hidden: true, classList: { add() {}, remove() {} } };
  let click;
  const context = {
    panel, panelOpen: false, panelCloseTimer: 0, currentUser: { uid: 'participant' },
    toggle: { setAttribute() {}, addEventListener: (_, callback) => { click = callback; } },
    ensurePanel() {}, render() {}, requestAnimationFrame: (callback) => callback(),
    window: { clearTimeout: (id) => timers.delete(id), setTimeout: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; } }
  };
  const source = read('notification-center.js');
  vm.runInNewContext(source.slice(source.indexOf('function openPanel()'), source.indexOf('async function clearAll()')), context);
  vm.runInNewContext(source.slice(source.indexOf("toggle?.addEventListener('click'"), source.indexOf('const pendingToast')), context);
  click();
  click();
  assert.equal(timers.size, 1);
  click();
  assert.equal(timers.size, 0);
  assert.equal(panel.hidden, false);
});
