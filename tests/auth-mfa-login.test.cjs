const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'public');
const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
const authPages = fs.readFileSync(path.join(root, 'auth-pages.js'), 'utf8');
const mfaSource = fs.readFileSync(path.join(root, 'auth-mfa.js'), 'utf8');
const mfaCss = fs.readFileSync(path.join(root, 'auth-mfa.css'), 'utf8');

test('login menampilkan formulir faktor kedua dan bukan menonaktifkan MFA', () => {
  assert.match(login, /id="auth-mfa-panel"[^>]*hidden/);
  assert.match(login, /id="auth-mfa-code"[^>]*autocomplete="one-time-code"/);
  assert.match(login, /id="auth-mfa-recaptcha"/);
  assert.match(authPages, /auth\/multi-factor-auth-required/);
  assert.match(authPages, /mfaFlow\.start\(error\)/);
  assert.match(mfaSource, /getMultiFactorResolver\(auth, error\)/);
  assert.match(mfaSource, /activeResolver\.resolveSignIn\(assertion\)/);
  assert.doesNotMatch(authPages, /signInAnonymously|disableMfa|setCustomClaims/);
});

test('panel MFA paper-style tidak melanggar hidden attribute', () => {
  assert.match(mfaCss, /\.auth-mfa-panel\[hidden\]/);
  assert.match(mfaCss, /\.auth-mfa-panel \[hidden\]/);
});

// Small no-network DOM/Firebase simulation for MFA UI event flow.
function buildHarness(kind = 'phone', options = {}) {
  class FakeEl {
    constructor() {
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.textContent = '';
      this.dataset = {};
      this.style = {};
      this.clientWidth = 270;
      this.children = [];
      this.events = {};
    }
    addEventListener(type, fn) { this.events[type] = fn; }
    async trigger(type, event = {}) { return this.events[type]?.({ preventDefault() {}, ...event }); }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    setAttribute(name, value) { this[name] = value; }
    focus() {}
    scrollIntoView() {}
  }
  const ids = [
    'auth-mfa-description','auth-mfa-method-row','auth-mfa-method','auth-mfa-recaptcha',
    'auth-mfa-send','auth-mfa-code-form','auth-mfa-code','auth-mfa-confirm',
    'auth-mfa-cancel','auth-mfa-feedback'
  ];
  const elements = Object.fromEntries(ids.map(id => [`#${id}`, new FakeEl()]));
  const panel = new FakeEl();
  panel.querySelector = selector => elements[selector];
  const providerCalls = [];
  let signedIn = 0;
  let callbackUser = null;
  const fakeResolver = {
    hints: [{factorId: kind === 'phone' ? 'phone' : 'totp', phoneNumber: '+62******1234', uid: 'enrollment-id'}],
    session: {mfa: true},
    async resolveSignIn(assertion) {
      signedIn += 1;
      if (options.resolveSignIn) return options.resolveSignIn(assertion);
      if (assertion.code === '999999') throw Object.assign(new Error('bad'), {code:'auth/invalid-verification-code'});
      return {user: {uid: 'adminuid'}};
    }
  };
  const pageEvents = {};
  const context = {
    document: {
      body: {classList: {add(){}, remove(){}}},
      querySelector: selector => selector === '#auth-mfa-panel' ? panel : null,
      createElement: () => new FakeEl()
    },
    window: {addEventListener(name, callback){ pageEvents[name] = callback; }},
    PhoneMultiFactorGenerator: {FACTOR_ID: 'phone', assertion: cred => ({...cred,kind:'phone'})},
    TotpMultiFactorGenerator: {FACTOR_ID:'totp', assertionForSignIn: (uid, code) => ({uid,code,kind:'totp'})},
    PhoneAuthProvider: class {
      async verifyPhoneNumber(opts, verifier) {
        assert.equal(opts.session, fakeResolver.session);
        assert.ok(verifier);
        providerCalls.push(opts);
        return options.send ? options.send() : 'verification-id';
      }
      static credential(id, code) { return {verificationId: id, code}; }
    },
    RecaptchaVerifier: class { async render() { return 1; } clear(){} },
    getMultiFactorResolver: () => fakeResolver,
    Date, Math, Error, String, Number
  };
  let js = mfaSource.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/m, '').replace('export const createMfaFlow', 'const createMfaFlow');
  js += '\nthis.createMfaFlow = createMfaFlow;';
  vm.runInNewContext(js, context);
  const flow = context.createMfaFlow({
    auth: {id: 1},
    onVerified: async user => {callbackUser = user;},
    onCancel() {}
  });
  return {elements, panel, flow, providerCalls, pageEvents, getSignedIn: () => signedIn, getUser: () => callbackUser};
}

test('SMS MFA wajib meminta kode dan tidak masuk ketika OTP salah', async () => {
  const h = buildHarness();
  h.flow.start({code:'auth/multi-factor-auth-required'});
  assert.equal(h.panel.hidden, false);
  assert.equal(h.elements['#auth-mfa-code-form'].hidden, true);
  await h.elements['#auth-mfa-send'].trigger('click');
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.elements['#auth-mfa-code-form'].hidden, false);
  h.elements['#auth-mfa-code'].value = '999999';
  await h.elements['#auth-mfa-code-form'].trigger('submit');
  assert.equal(h.getUser(), null);
  assert.match(h.elements['#auth-mfa-feedback'].textContent, /salah/);
  h.elements['#auth-mfa-code'].value = '123456';
  await h.elements['#auth-mfa-code-form'].trigger('submit');
  assert.equal(h.getUser().uid, 'adminuid');
  assert.equal(h.panel.hidden, true);
});

test('TOTP MFA dapat dilanjutkan tanpa SMS, dan pembatalan menutup sesi', async () => {
  const h = buildHarness('totp');
  h.flow.start({code:'auth/multi-factor-auth-required'});
  assert.equal(h.elements['#auth-mfa-send'].hidden, true);
  assert.equal(h.elements['#auth-mfa-code-form'].hidden, false);
  h.elements['#auth-mfa-code'].value = '123456';
  await h.elements['#auth-mfa-code-form'].trigger('submit');
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.getUser().uid, 'adminuid');
  h.flow.start({code:'auth/multi-factor-auth-required'});
  await h.elements['#auth-mfa-cancel'].trigger('click');
  assert.equal(h.panel.hidden, true);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('pengiriman SMS hanya menampilkan proses pada tombol kirim, tanpa mengubah label verifikasi', async () => {
  const wait = deferred();
  const h = buildHarness('phone', { send: () => wait.promise });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  const pending = h.elements['#auth-mfa-send'].trigger('click');
  await flush();
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Mengirim kode…');
  assert.equal(h.elements['#auth-mfa-send']['aria-busy'], 'true');
  assert.equal(h.elements['#auth-mfa-confirm'].textContent, 'Verifikasi & Masuk');
  assert.equal(h.elements['#auth-mfa-confirm']['aria-busy'], 'false');
  await h.elements['#auth-mfa-send'].trigger('click');
  assert.equal(h.providerCalls.length, 1);
  wait.resolve('verification-id');
  await pending;
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Kirim ulang kode');
  assert.equal(h.elements['#auth-mfa-code'].disabled, false);
});

test('konfirmasi OTP hanya membuat tombol verifikasi sibuk dan mencegah konfirmasi ganda', async () => {
  const wait = deferred();
  const h = buildHarness('phone', { resolveSignIn: () => wait.promise });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  await h.elements['#auth-mfa-send'].trigger('click');
  h.elements['#auth-mfa-code'].value = '123456';
  const pending = h.elements['#auth-mfa-code-form'].trigger('submit');
  await flush();
  assert.equal(h.elements['#auth-mfa-confirm'].textContent, 'Memverifikasi…');
  assert.equal(h.elements['#auth-mfa-confirm']['aria-busy'], 'true');
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Kirim ulang kode');
  assert.equal(h.elements['#auth-mfa-send']['aria-busy'], 'false');
  assert.equal(h.elements['#auth-mfa-send'].disabled, true);
  await h.elements['#auth-mfa-code-form'].trigger('submit');
  assert.equal(h.getSignedIn(), 1);
  wait.resolve({ user: { uid:'adminuid' } });
  await pending;
  assert.equal(h.getUser().uid, 'adminuid');
});

test('SMS dari percobaan lama tidak menimpa tahap baru setelah pembatalan', async () => {
  const wait = deferred();
  const h = buildHarness('phone', { send: () => wait.promise });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  const pending = h.elements['#auth-mfa-send'].trigger('click');
  await flush();
  assert.equal(h.elements['#auth-mfa-cancel'].disabled, false);
  await h.elements['#auth-mfa-cancel'].trigger('click');
  assert.equal(h.panel.hidden, true);
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  wait.resolve('old-verification-id');
  await pending;
  assert.equal(h.elements['#auth-mfa-code-form'].hidden, true);
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Kirim kode');
  assert.equal(h.elements['#auth-mfa-send'].disabled, false);
  assert.equal(h.getUser(), null);
});

test('hasil OTP yang selesai setelah reset tidak meneruskan callback login dari sesi lama', async () => {
  const wait = deferred();
  const h = buildHarness('totp', { resolveSignIn: () => wait.promise });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  h.elements['#auth-mfa-code'].value = '123456';
  const pending = h.elements['#auth-mfa-code-form'].trigger('submit');
  await flush();
  h.flow.reset();
  wait.resolve({ user: { uid:'old-user' } });
  await pending;
  assert.equal(h.getUser(), null);
  assert.equal(h.panel.hidden, true);
});

test('kegagalan pengiriman mengembalikan label dan membolehkan percobaan berikutnya', async () => {
  const wait = deferred();
  let attempts = 0;
  const h = buildHarness('phone', { send: () => ++attempts === 1 ? wait.promise : Promise.resolve('new-id') });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  const pending = h.elements['#auth-mfa-send'].trigger('click');
  await flush();
  wait.reject(Object.assign(new Error('network'), { code:'auth/network-request-failed' }));
  await pending;
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Kirim kode');
  assert.equal(h.elements['#auth-mfa-send'].disabled, false);
  assert.equal(h.elements['#auth-mfa-confirm']['aria-busy'], 'false');
  await h.elements['#auth-mfa-send'].trigger('click');
  assert.equal(h.elements['#auth-mfa-code-form'].hidden, false);
  assert.equal(h.providerCalls.length, 2);
});

test('meninggalkan halaman mengakhiri tantangan MFA dan mengabaikan respons SMS yang terlambat', async () => {
  const wait = deferred();
  const h = buildHarness('phone', { send: () => wait.promise });
  h.flow.start({ code:'auth/multi-factor-auth-required' });
  const pending = h.elements['#auth-mfa-send'].trigger('click');
  await flush();
  h.pageEvents.pagehide();
  assert.equal(h.panel.hidden, true);
  wait.resolve('late-id');
  await pending;
  assert.equal(h.elements['#auth-mfa-send'].textContent, 'Kirim kode');
  assert.equal(h.getUser(), null);
});
