const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const publicRoot = path.resolve(__dirname, '../public');
const read = (p) => fs.readFileSync(path.join(publicRoot, p), 'utf8');

const makeSessionHarness = ({ user = null, admin = false, profile = null, error = null, pageMode = 'login' } = {}) => {
  const input = { disabled: false };
  const state = { busy: [], alerts: [], paths: [], input };
  const form = {
    querySelectorAll: () => [input],
    setAttribute: (name, value) => { state[name] = value; },
    removeAttribute: (name) => { delete state[name]; }
  };
  const auth = { currentUser: user, authStateReady: async () => {} };
  const context = {
    form, auth, pageMode,
    submitButton: { disabled: false }, googleButton: { disabled: false },
    requestedNext: 'form-pendaftaran.html',
    setBusy: (busy, message) => state.busy.push({ busy, message }),
    displayActionError: (e) => state.alerts.push(String(e?.message || e)),
    getRedirectResult: async () => null,
    redirectReady: false,
    isAdminUser: async () => { if (error) throw error; return admin; },
    getUserProfile: async () => profile,
    verifyAndWatchDeviceSession: async () => {},
    finishAuthentication: async () => { throw new Error('Guard should not run login flow'); },
    signOut: async () => { auth.currentUser = null; },
    window: { location: { replace: (p) => state.paths.push(p) } },
    encodeURIComponent
  };
  const code = read('auth-pages.js');
  const marker = '// Auth guard on the public login/signup pages.';
  const snippet = code.slice(code.indexOf(marker)).replace(/void guardAccountEntry\(\);\s*$/, 'this.invokeGuard = guardAccountEntry;');
  vm.runInNewContext(snippet, context);
  return { run: () => context.invokeGuard(), state, form, context };
};

test('sesi sudah login tidak membuka form login kedua dan diarahkan ke profil/pendaftaran', async () => {
  const { run, state } = makeSessionHarness({ user: { uid: 'u1', emailVerified: true }, profile: { profileComplete: true } });
  await run();
  assert.deepEqual(state.paths, ['form-pendaftaran.html']);
  assert.equal(state.input.disabled, true);
  assert.equal(state.busy.at(-1).busy, true);
});

test('sesi admin yang aktif diarahkan ke panel admin tanpa sign-in ulang', async () => {
  const { run, state } = makeSessionHarness({ user: { uid: 'admin', emailVerified: true }, admin: true });
  await run();
  assert.deepEqual(state.paths, ['admin.html']);
  assert.equal(state.input.disabled, true);
});

test('sesi peserta yang belum lengkap diarahkan melengkapi profil', async () => {
  const { run, state } = makeSessionHarness({ user: { uid: 'u2', emailVerified: true }, profile: { profileComplete: false } });
  await run();
  assert.match(state.paths[0], /^profil\.html\?next=form-pendaftaran\.html&complete=required$/);
});

test('akun belum diverifikasi diarahkan ke email verification', async () => {
  const { run, state } = makeSessionHarness({ user: { uid: 'u3', emailVerified: false } });
  await run();
  assert.deepEqual(state.paths, ['verify-email.html?next=form-pendaftaran.html']);
});

test('sesi kosong baru dapat mengaktifkan tombol login setelah resolusi Auth', async () => {
  const { run, state, form } = makeSessionHarness({ user: null });
  await run();
  assert.equal(state.input.disabled, false);
  assert.equal(state.busy.at(-1).busy, false);
  assert.equal(form['aria-busy'], undefined);
  assert.deepEqual(state.paths, []);
});

test('gagal memeriksa admin tidak dianggap sebagai logout atau sesi kosong', async () => {
  const { run, state } = makeSessionHarness({ user: { uid: 'admin', emailVerified: true }, error: new Error('permission-denied') });
  await run();
  assert.deepEqual(state.paths, []);
  assert.equal(state.busy.at(-1).busy, true);
  assert.equal(state.input.disabled, true);
  assert.deepEqual(state.alerts, ['permission-denied']);
});

test('CTA dan catatan peserta mendukung dua kolom serta tiga tombol success satu baris', () => {
  const css = read('cta-session-precision.css');
  const landing = read('index.html');
  const nav = read('site-auth.js');
  const login = read('auth-pages.js');
  assert.match(css, /\.ticket-detail-body \.important-copy \.detail-cta\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.success-dossier \.center-actions\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\[data-auth-link\]\[aria-disabled="true"\]/);
  assert.match(nav, /link\.removeAttribute\('href'\)/);
  assert.match(nav, /link\.removeAttribute\('aria-disabled'\)/);
  assert.match(login, /await auth\.authStateReady\(\)/);
  assert.match(landing, /Status dan tiket ada di profil\./);
});
