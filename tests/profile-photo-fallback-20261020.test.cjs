// Exercises the actual isolated owner-scoped Cloud Function logic without
// requiring the optional local native sharp binary.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = join(__dirname, '..');
const functionsSource = readFileSync(join(root, 'functions/index.js'), 'utf8');
const photoSource = readFileSync(join(root, 'public/profile-photo.js'), 'utf8');
const apiSource = readFileSync(join(root, 'public/spark-data.js'), 'utf8');

function mockServer({ active = true, archived = false, owner = 'owner_1', role = 'participant' } = {}) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x30, 0x50, 0xff, 0xd9]);
  const sha256 = crypto.createHash('sha256').update(jpeg).digest('hex');
  const storagePath = `profile-photos/${owner}/${'a'.repeat(24)}.jpg`;
  const profile = active ? { photoStoragePath: storagePath, photoSha256: sha256,
    photoVersion: 2, role, archived } : null;
  const state = { profile, storageOwner: owner, blob: jpeg, mimeType: 'image/jpeg' };
  const selected = functionsSource.slice(functionsSource.indexOf('const getProfilePhotoHandler = async (request) => {'),
    functionsSource.indexOf('const saveProfilePhotoHandler = async (request) => {'));
  assert.ok(selected.startsWith('const getProfilePhotoHandler'));
  class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = {
    requireVerified: (req) => {
      if (!req.auth?.uid) throw new FakeHttpsError('unauthenticated', 'Login required');
      if (!req.auth.token?.email_verified) throw new FakeHttpsError('failed-precondition', 'Verify email');
      return { uid: req.auth.uid };
    },
    requireActiveProfile: async (uid) => {
      if (uid !== owner || !state.profile || state.profile.archived) throw new FakeHttpsError('permission-denied', 'No access');
      return state.profile;
    },
    profilePhotoPathFor: (uid, value) => typeof value === 'string' && new RegExp(`^profile-photos/${uid}/[A-Za-z0-9-]{20,80}\\.jpg$`).test(value),
    bucket: { file: (filePath) => ({
      exists: async () => [filePath === state.profile.photoStoragePath && !!state.blob],
      getMetadata: async () => [{ size: String(state.blob?.length ?? 0), contentType: state.mimeType,
        metadata: { ownerUid: state.storageOwner, sha256: sha256 } }],
      download: async () => [state.blob]
    }) },
    crypto, HttpsError: FakeHttpsError, PROFILE_PHOTO_MAX_BYTES: 256 * 1024,
    Number, String, Object
  };
  vm.runInNewContext(`${selected}\nthis.handler = getProfilePhotoHandler`, context);
  const request = (uid = owner, version = 2) => ({ auth: uid ? { uid, token: { email_verified: true }} : null,
    data: { photoVersion: version } });
  return { ...state, handler: context.handler, request, state, jpeg, sha256 };
}

test('owner may reload private photo after tab refresh with the saved hash and version', async () => {
  const h = mockServer();
  const result = await h.handler(h.request());
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.sha256, h.sha256);
  assert.equal(Buffer.from(result.base64, 'base64').equals(h.jpeg), true);
  assert.equal(Object.hasOwn(result, 'downloadUrl'), false);
});

test('photo fallback denies anonymous, unverified, and other user accounts', async () => {
  const h = mockServer();
  await assert.rejects(h.handler(h.request(null)), { code: 'unauthenticated' });
  const unverified = h.request(); unverified.auth.token.email_verified = false;
  await assert.rejects(h.handler(unverified), { code: 'failed-precondition' });
  await assert.rejects(h.handler(h.request('outsider')), { code: 'permission-denied' });
});

test('photo fallback denies archived profiles, administrator role and stale version', async () => {
  const a = mockServer({archived:true});
  await assert.rejects(a.handler(a.request()), {code:'permission-denied'});
  const b = mockServer({role:'admin'});
  await assert.rejects(b.handler(b.request()), {code:'permission-denied'});
  const c = mockServer();
  await assert.rejects(c.handler(c.request('owner_1',1)), {code:'failed-precondition'});
});

test('photo fallback rejects changed owner metadata, invalid image and missing photo', async () => {
  const h = mockServer();
  h.state.storageOwner = 'outsider';
  await assert.rejects(h.handler(h.request()), {code:'failed-precondition'});
  h.state.storageOwner = 'owner_1';
  h.state.blob = Buffer.from([1,2,3,4]);
  await assert.rejects(h.handler(h.request()), {code:'failed-precondition'});
  h.state.blob = null;
  await assert.rejects(h.handler(h.request()), {code:'not-found'});
});

test('backend and client register private read through protected callable, not public URL', () => {
  assert.match(functionsSource, /getProfilePhoto:\s*getProfilePhotoHandler/);
  assert.match(functionsSource, /'saveProfilePhoto', 'getProfilePhoto'/);
  assert.match(apiSource, /getProfilePhoto\s*=\s*\(input = \{\}\) => invoke\('getProfilePhoto', input\)/);
  assert.match(photoSource, /getProfilePhoto\(\{ photoVersion: Number\(currentProfile\.photoVersion \|\| 0\) \}\)/);
  assert.doesNotMatch(photoSource, /getDownloadURL/);
  assert.match(photoSource, /visibilitychange/);
  assert.match(photoSource, /auth\.currentUser\?\.uid !== user\.uid/);
});

function frontendHarness({ fallbackReject = null, defer = false } = {}) {
  const imageEvents = {};
  const pageEvents = {};
  const tabEvents = {};
  const elements = new Map();
  for (const name of ['#profile-avatar', '#profile-avatar-initials', '#profile-avatar-image',
    '#profile-photo-input', '#profile-photo-pick', '#profile-photo-save',
    '#profile-photo-cancel', '#profile-photo-pending-actions', '#profile-photo-status']) {
    elements.set(name, {
      hidden: false, disabled: false, dataset: {}, style: {}, value: '', textContent: '',
      setAttribute() {}, removeAttribute() {},
      addEventListener(event, handler) { this.listeners ||= {}; this.listeners[event] = handler; }
    });
  }
  let fetchCount = 0;
  let serverCount = 0;
  let resolveServer;
  const pendingServer = defer ? new Promise((resolve) => { resolveServer = resolve; }) : null;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xd9]);
  const sha256 = crypto.createHash('sha256').update(jpeg).digest('hex');
  const auth = { currentUser: { uid: 'owner_1' } };
  const source = photoSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*$/gm, '')
    .replaceAll('export const ', 'const ') + '\nthis.init = initProfilePhoto';
  const context = {
    auth, storage: {}, Blob, atob, crypto: crypto.webcrypto,
    URL: { createObjectURL: () => `blob:photo-${Math.random()}`, revokeObjectURL: () => {} },
    document: { querySelector: (name) => elements.get(name),
      addEventListener: (event, handler) => { tabEvents[event] = handler; }, visibilityState: 'visible' },
    window: { addEventListener: (event, handler) => { pageEvents[event] = handler; } },
    getBlob: async () => { fetchCount++; throw new Error('Storage direct fetch blocked by CORS'); },
    storageRef: (_service, path) => path,
    getProfilePhoto: async () => {
      serverCount++;
      if (fallbackReject) throw fallbackReject;
      if (pendingServer) return pendingServer;
      return { data: {ok:true, hasPhoto:true, mimeType:'image/jpeg', sizeBytes:jpeg.length,
        sha256, photoVersion:2, base64:jpeg.toString('base64')} };
    },
    friendlyFirebaseError: (e) => e.message,
    uploadBytesResumable: () => { throw new Error('unexpected upload'); },
    Image: class {}, console
  };
  vm.runInNewContext(source, context);
  const initialized = context.init({ user: { uid:'owner_1', photoURL: '' } });
  const profile = { photoStoragePath:`profile-photos/owner_1/${'a'.repeat(24)}.jpg`,
    photoSha256:sha256, photoVersion:2 };
  return { elements, auth, pageEvents, tabEvents, initialized, profile,
    get fetchCount() { return fetchCount; },
    get serverCount() { return serverCount; },
    resolveServer, jpeg };
}

const flushAsync = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

test('client reloads photo via callable after Storage CORS failure, then retains it', async () => {
  const h = frontendHarness();
  h.initialized.update(h.profile, 'Contoh Pengguna');
  await flushAsync();
  assert.equal(h.fetchCount, 1);
  assert.equal(h.serverCount, 1);
  assert.equal(h.elements.get('#profile-avatar-image').hidden, false);
  assert.equal(h.elements.get('#profile-avatar-initials').hidden, true);
  h.initialized.update(h.profile, 'Contoh Pengguna');
  await flushAsync();
  assert.equal(h.serverCount, 1, 'already loaded photo not fetched again');
});

test('client prevents a previous owner photo from returning after account switch', async () => {
  const h = frontendHarness({defer:true});
  h.initialized.update(h.profile, 'Contoh Pengguna');
  await flushAsync();
  assert.equal(h.serverCount, 1);
  h.auth.currentUser.uid = 'other_user';
  const bytes = h.jpeg;
  h.resolveServer({ data: { ok:true, hasPhoto:true, mimeType:'image/jpeg',
    sizeBytes:bytes.length, sha256:h.profile.photoSha256, photoVersion:2,
    base64:bytes.toString('base64') } });
  await flushAsync();
  assert.equal(h.elements.get('#profile-avatar-image').hidden, true);
  assert.equal(h.elements.get('#profile-avatar-initials').hidden, false);
});

test('client retries a failed image on returning to tab, not on a background tab', async () => {
  const h = frontendHarness({fallbackReject: Object.assign(new Error('unavailable'), {code:'functions/unavailable'})});
  h.initialized.update(h.profile, 'Contoh Pengguna');
  await flushAsync();
  assert.equal(h.serverCount, 1);
  assert.match(h.elements.get('#profile-photo-status').textContent, /Foto belum bisa dimuat/);
  h.tabEvents.visibilitychange?.();
  await flushAsync();
  assert.equal(h.serverCount, 2);
});
