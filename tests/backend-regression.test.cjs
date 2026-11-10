// Offline regression checks. In-memory Firestore/Storage stubs; no production access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sharp = require('../functions/node_modules/sharp');
// The VM harness removes ESM imports from functions/index.js, so supply the
// actual imported domain helper to its sandbox rather than duplicating logic.
const { boundedRetentionDays } = require('../functions/domain.js');

const mainSource = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
const source = mainSource
  .replace(/^import[\s\S]*?from ['"][^'\"]+['"];\s*$/gm, '')
  .replaceAll('export const ', 'const ')
  + '\nthis.__handlers = { API_HANDLERS, purgePaymentProofCore, purgeExpiredPaymentProofs, sendParticipantPush, esoriaApi };';

function buildHarness(environment = {}) {
  const records = new Map();
  const blobs = new Map();
  const deletedFiles = [];
  const sentPushes = [];
  const events = [];
  class FakeTimestamp {
    constructor(ms) { this.ms = ms; }
    toMillis() { return this.ms; }
    static fromMillis(ms) { return new FakeTimestamp(ms); }
    static fromDate(date) { return new FakeTimestamp(date.getTime()); }
    static now() { return new FakeTimestamp(Date.now()); }
  }
  class FakeError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const REMOVE = Symbol('remove');
  const stamp = () => new FakeTimestamp(Date.now());
  const convert = (value, prior) => {
    if (value === REMOVE) return REMOVE;
    if (Array.isArray(value)) return value.map((item) => convert(item));
    if (value && typeof value === 'object' && !(value instanceof FakeTimestamp)) {
      const out = prior && typeof prior === 'object' && !Array.isArray(prior) ? {...prior} : {};
      for (const [key, child] of Object.entries(value)) {
        if (child === REMOVE) delete out[key]; else out[key] = convert(child, out[key]);
      }
      return out;
    }
    return value;
  };
  const snapshot = (key) => ({
    exists: records.has(key),
    id: key.split('/').at(-1),
    data: () => records.get(key)
  });
  const makeRef = (key) => ({
    id: key.split('/').at(-1),
    path: key,
    async get() { return snapshot(key); },
    async set(value, options = {}) {
      records.set(key, convert(value, options.merge ? records.get(key) : undefined));
    },
    async update(value) { records.set(key, convert(value, records.get(key))); },
    async delete() { records.delete(key); }
  });
  const store = {
    doc: makeRef,
    async runTransaction(callback) {
      const mutations = [];
      const txn = {
        get: async (ref) => ref.path ? snapshot(ref.path) : ref.get(),
        set: (ref, value, options = {}) => mutations.push(() => { records.set(ref.path, convert(value, options.merge ? records.get(ref.path) : undefined)); }),
        create: (ref, value) => mutations.push(() => { if (records.has(ref.path)) throw Error('already exists'); records.set(ref.path, convert(value)); }),
        update: (ref, value) => mutations.push(() => { records.set(ref.path, convert(value, records.get(ref.path))); }),
        delete: (ref) => mutations.push(() => records.delete(ref.path))
      };
      const result = await callback(txn);
      mutations.forEach((mutation) => mutation());
      return result;
    },
    batch() {
      const writes = [];
      return {
        delete: (ref) => writes.push(() => records.delete(ref.path)),
        update: (ref, data) => writes.push(() => records.set(ref.path, convert(data, records.get(ref.path)))),
        set: (ref, data) => writes.push(() => records.set(ref.path, convert(data))),
        commit: async () => { writes.forEach((write) => write()); }
      };
    },
    collection: (name) => {
      const conditions = [];
      let max = Infinity;
      const query = {
        where(field, op, value) { conditions.push([field, op, value]); return this; },
        limit(count) { max = count; return this; },
        async get() {
          const prefix = `${name}/`;
          const rows = [...records.entries()].filter(([key, data]) =>
            key.startsWith(prefix) && !key.slice(prefix.length).includes('/') &&
            conditions.every(([field, op, value]) => op !== '==' || data[field] === value))
            .slice(0, max).map(([key]) => ({ ...snapshot(key), ref: makeRef(key) }));
          return { size: rows.length, docs: rows, empty: rows.length === 0 };
        },
        count() { return { get: async () => ({ data: () => ({count: [...records.entries()].filter(([key, data]) => key.startsWith(`${name}/`) && !key.slice(name.length+1).includes('/') && conditions.every(([f,op,val]) => op !== '==' || data[f] === val)).length}) }) }; }
      };
      return query;
    }
  };
  const bucket = {file: (key) => ({
    exists: async () => [blobs.has(key)],
    getMetadata: async () => [{
      size: String(blobs.get(key)?.bytes?.length || 0),
      contentType: 'image/jpeg',
      metadata: blobs.get(key)?.meta || {}
    }],
    download: async () => [blobs.get(key).bytes],
    delete: async () => { deletedFiles.push(key); blobs.delete(key); }
  })};
  const authorization = (uid = 'uid_a') => ({auth: {uid, token: {email: 'admin@example.org', email_verified: true, admin: true}} , data:{}});
  const context = {
    createCompetitionService: () => ({handlers: {}, submitFlag: async () => ({}), purgeStaleUploads: async () => ({})}),
    crypto, sharp, boundedRetentionDays, URL, process: { env: environment }, console,
    initializeApp: () => {}, getFirestore: () => store,
    getStorage: () => ({bucket: () => bucket}),
    getMessaging: () => ({ sendEachForMulticast: async (payload) => { sentPushes.push(payload); return { responses: payload.tokens.map(() => ({ success: true })) }; } }),
    getAuth: () => ({getUser: async () => ({customClaims: {}}), setCustomUserClaims: async () => {}}),
    FieldValue: {serverTimestamp: stamp, delete: () => REMOVE},
    Timestamp: FakeTimestamp, logger: {warn: () => {}, error: () => {}, info: () => {}},
    setGlobalOptions: () => {}, HttpsError: FakeError,
    onCall: (options, handler) => ({options, handler}),
    onRequest: (options, handler) => ({options, handler}),
    onSchedule: (options, handler) => {events.push({options,handler});return {options,handler};},
    onDocumentCreated: (options, handler) => ({options,handler})
  };
  vm.runInNewContext(source, context, {filename: 'functions/index.js'});
  return {...context.__handlers, records, blobs, deletedFiles, sentPushes, events, authorization, Timestamp: FakeTimestamp};
}
// Build the same authenticated envelope sent by the live client after
// activateDeviceSession. Regression tests must not bypass session enforcement.
const authorizedApiRequest = (h, action, payload = {}, uid = 'uid_a') => {
  const authTime = 1770000000;
  const existingKey = h.testSessionKeys?.get(uid);
  const sessionKey = existingKey || crypto.randomBytes(32).toString('hex');
  if (!h.testSessionKeys) h.testSessionKeys = new Map();
  h.testSessionKeys.set(uid, sessionKey);
  if (!existingKey) h.records.set(`accountSessions/${uid}`, {
    authTime,
    sessionHash: crypto.createHash('sha256').update(sessionKey).digest('hex')
  });
  const request = h.authorization(uid);
  request.auth.token.auth_time = authTime;
  return { ...request, data: {action, payload: {...payload, sessionKey}} };
};

const date = (day) => new Date(`2026-11-${String(day).padStart(2, '0')}T10:00:00+07:00`).toISOString();
const goodPeriod = (id, status = 'open') => ({
  periodId: id, status, mode: 'create', registrationOpenAt: date(1), registrationCloseAt: date(15),
  competitionStartAt: date(3), announcementAt: date(25),
  enabledPackages: {web:true,cyber:true,team:true},
  enabledPackageWaves: Object.fromEntries(['web','cyber','team'].map(id=>[id, {'wave-01':true,'wave-02':true}])),
  waves: {
    'wave-01': { startsAt: date(3), closesAt: date(10), registrationOpenAt: date(1), registrationCloseAt: date(2) },
    'wave-02': { startsAt: date(17), closesAt: date(20), registrationOpenAt: date(4), registrationCloseAt: date(15) }
  }
});

test('backend VM harness uses the real retention helper when loading Cloud Functions', async () => {
  for (const [envValue, expected] of [
    ['not-a-number', 365],
    ['12', 30],
    ['90', 90],
    ['999999', 3650]
  ]) {
    const h = buildHarness({ NOTIFICATION_RETENTION_DAYS: envValue });
    h.records.set('admins/uid_a', { active: true });
    const health = await h.API_HANDLERS.getSystemHealth(h.authorization());
    assert.equal(health.retention.notificationsDays, expected);
  }
});

test('stale admin claim cannot bypass a deactivated document', async () => {
  const h = buildHarness();
  h.records.set('admins/uid_a', {active:false});
  await assert.rejects(h.API_HANDLERS.getSystemHealth(h.authorization()), {code:'permission-denied'});
  h.records.set('admins/uid_a', {active:true});
  const result = await h.API_HANDLERS.getSystemHealth(h.authorization());
  assert.equal(result.admin, true);
});

test('future open period stays enabled and drafts cannot overwrite the active period', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  await h.API_HANDLERS.savePeriod({...h.authorization(), data:goodPeriod('2026-11')});
  assert.equal(h.records.get('system/registration').openPeriodId, '2026-11');
  assert.equal(h.records.get('system/registration').acceptingRegistrations, true);
  assert.equal(h.records.get('periods/2026-11').createdByUid, undefined);
  await h.API_HANDLERS.savePeriod({...h.authorization(), data:goodPeriod('2026-12','draft')});
  assert.equal(h.records.get('system/registration').openPeriodId,'2026-11');
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(), data:{...goodPeriod('2026-12'),mode:'update',expectedRevision:1}}), {code:'failed-precondition'});
  await h.API_HANDLERS.savePeriod({...h.authorization(), data:{...goodPeriod('2026-11','closed'),mode:'update',expectedRevision:1}});
  assert.equal(h.records.get('system/registration').openPeriodId,'');
  await h.API_HANDLERS.savePeriod({...h.authorization(), data:{...goodPeriod('2026-12'),mode:'update',expectedRevision:1}});
  assert.equal(h.records.get('system/registration').openPeriodId,'2026-12');
});

test('an expired period rolls over while a running period stays protected', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-11')});
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-12')}), {code:'failed-precondition'});
  h.records.get('periods/2026-11').registrationCloseAt=h.Timestamp.fromMillis(Date.now()-60_000);
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-12')});
  assert.equal(h.records.get('system/registration').openPeriodId,'2026-12');
  assert.equal(h.records.get('periods/2026-11').status,'closed');
});

test('wave registration must close before competition begins', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  const data=goodPeriod('2026-11');
  data.waves['wave-01'].registrationCloseAt=date(6);
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(),data}), {code:'invalid-argument'});
  assert.equal(h.records.has('system/registration'),false);
  const fixed=goodPeriod('2026-11');
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:fixed});
  const period=h.records.get('periods/2026-11');
  assert.equal(period.packages.web.waves['wave-01'].registrationCloseAt.toMillis(),new Date(date(2)).getTime());
  assert.equal(period.packages.web.waves['wave-02'].registrationOpenAt.toMillis(),new Date(date(4)).getTime());
});

test('reviewed proof can be purged and digest is retained', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  const id='registration-001', key=`payment-proofs/u123/${id}/proof.jpg`;
  h.records.set(`registrations/${id}`, {registrationId:id, userId:'u123',status:'terverifikasi', paymentProofAttached:true,proofStoragePath:key,proofSha256:'a'.repeat(64)});
  h.records.set(`paymentProofs/${id}`,{storagePath:key});
  h.blobs.set(key,{bytes:Buffer.from('sample')});
  const result=await h.API_HANDLERS.purgePaymentProof({...h.authorization(), data:{registrationId:id}});
  assert.equal(result.ok,true);
  assert.equal(h.records.get(`registrations/${id}`).proofSha256,'a'.repeat(64));
  assert.equal(h.records.get(`registrations/${id}`).paymentProofAttached,false);
  assert.equal(h.records.has(`paymentProofs/${id}`),false);
  assert.deepEqual(h.deletedFiles,[key]);
});

test('rejected proof replacement never deletes a pre-existing Storage object', async () => {
  const h=buildHarness();const id='registration-002', uid='uid_a';
  const key=`payment-proofs/${uid}/${id}/already-used.jpg`;
  const bytes=await sharp({create: {width:800,height:600,channels:3,background:'#fafafa'}}).jpeg().toBuffer(), sha=crypto.createHash('sha256').update(bytes).digest('hex');
  h.blobs.set(key,{bytes,meta:{ownerUid:uid,registrationId:id,sha256:sha}});
  h.records.set(`registrations/${id}`,{userId:uid,active:true,status:'terverifikasi',proofStoragePath:key});
  await assert.rejects(h.API_HANDLERS.replacePaymentProof({ ...h.authorization(), data:{registrationId:id,proof:{storagePath:key,sizeBytes:bytes.length,sha256:sha,width:800,height:600}} }), {code:'failed-precondition'});
  assert.equal(h.blobs.has(key),true);
  assert.equal(h.deletedFiles.length,0);
});

test('invalid profile option is rejected by the backend API', async () => {
  const h=buildHarness();
  await assert.rejects(h.API_HANDLERS.saveParticipantProfile({...h.authorization(),data:{
    birthDate:'2003-01-01',participantName:'Akun Peserta',phone:'+6281234567890',gender:'hacked'
  }}), {code:'invalid-argument'});
});

test('security rules require active administrator doc (not a stale claim)', () => {
  const fire=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
  const storage=fs.readFileSync(path.join(__dirname,'../storage.rules'),'utf8');
  assert.match(fire, /return verified\(\) && adminDocument\(\);/);
  assert.match(storage, /return verified\(\) && adminDocument\(\);/);
  assert.doesNotMatch(fire, /adminClaim\(\)\s*\|\|\s*adminDocument\(\)/);
});

test('invalid capacity or wave schedule is rejected before writing a period', async () => {
  const h = buildHarness(); h.records.set('admins/uid_a', {active:true});
  const badCapacity = goodPeriod('2026-11');
  badCapacity.capacities = { 'web_wave-01': 0 };
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(), data: badCapacity}), {code:'invalid-argument'});
  assert.equal(h.records.has('periods/2026-11'), false);
  const badSchedule = goodPeriod('2026-11');
  badSchedule.waves['wave-01'].registrationOpenAt = date(18);
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(), data:badSchedule}), {code:'invalid-argument'});
});

test('a forged JPEG content type is not sufficient to pass evidence verification', async () => {
  const h=buildHarness(), id='registration-003', uid='uid_a';
  const key=`payment-proofs/${uid}/${id}/fake.jpg`;
  const bytes=Buffer.from('This is not a JPEG image');
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  h.blobs.set(key,{bytes,meta:{ownerUid:uid,registrationId:id,sha256:sha}});
  h.records.set(`registrations/${id}`,{userId:uid,active:true,status:'menunggu',proofStoragePath:key});
  await assert.rejects(h.API_HANDLERS.replacePaymentProof({...h.authorization(),data:{
    registrationId:id,proof:{storagePath:key,sizeBytes:bytes.length,sha256:sha,width:600,height:600}
  }}),{code:'invalid-argument'});
  assert.equal(h.blobs.has(key),true);
});


test('Admin API refuses requests with missing or superseded device session before privileged actions', async () => {
  const h = buildHarness();
  h.records.set('admins/uid_a', {active:true});
  const unsigned = { ...h.authorization(), data:{action:'logAdminCsvExport', payload:{tab:'users',count:1}} };
  await assert.rejects(h.esoriaApi.handler(unsigned), {code:'failed-precondition'});
  const signed = authorizedApiRequest(h, 'logAdminCsvExport', {tab:'users',count:1});
  h.records.set('accountSessions/uid_a', {authTime: 1770000000, sessionHash:'0'.repeat(64)});
  await assert.rejects(h.esoriaApi.handler(signed), {code:'permission-denied'});
  assert.equal([...h.records.keys()].filter((key) => key.startsWith('auditLogs/')).length, 0);
});

test('active admin cannot create a participant account', async () => {
  const h = buildHarness();
  h.records.set('admins/uid_a', {active:true});
  await assert.rejects(h.API_HANDLERS.ensureUserProfile(h.authorization()), {code:'permission-denied'});
  assert.equal(h.records.has('users/uid_a'), false);
  await assert.rejects(h.esoriaApi.handler(authorizedApiRequest(h, 'ensureUserProfile')), {code:'permission-denied'});
  assert.equal(h.records.has('users/uid_a'), false);
});

test('participant creates only participant role and legacy admin data is excluded from counts', async () => {
  const h = buildHarness();
  await h.API_HANDLERS.ensureUserProfile(h.authorization('part_a'));
  assert.equal(h.records.get('users/part_a').role, 'participant');
  h.records.set('admins/uid_a', {active:true});
  h.records.set('users/uid_a', {uid:'uid_a', profileComplete:false});
  const result = await h.API_HANDLERS.rebuildDashboardMetrics(h.authorization());
  assert.equal(result.users, 1);
});

test('FCM device token can be registered only for active participants and transferred across accounts', async () => {
  const h = buildHarness();
  const token = 'long-fcm-token:' + 'a'.repeat(80);
  h.records.set('admins/uid_a', {active:true});
  h.records.set('users/uid_a', {archived:false});
  await assert.rejects(h.API_HANDLERS.registerPushToken({...h.authorization(),data:{token}}), {code:'permission-denied'});
  h.records.set('users/part_a',{archived:false});
  await h.API_HANDLERS.registerPushToken({...h.authorization('part_a'),data:{token}});
  const id = crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(h.records.get(`pushTokenOwners/${id}`).uid,'part_a');
  h.records.set('users/part_b',{archived:false});
  await h.API_HANDLERS.registerPushToken({...h.authorization('part_b'),data:{token}});
  assert.equal(h.records.has(`users/part_a/pushTokens/${id}`),false);
  assert.equal(h.records.get(`pushTokenOwners/${id}`).uid,'part_b');
  await h.API_HANDLERS.unregisterPushToken({...h.authorization('part_b'), data:{token}});
  assert.equal(h.records.has(`users/part_b/pushTokens/${id}`),false);
  assert.equal(h.records.has(`pushTokenOwners/${id}`),false);
});

test('new participant notification sends to an opted-in browser; admin notifications are never forwarded', async () => {
  const h = buildHarness();
  const token = 'long-fcm-token:' + 'b'.repeat(80);
  h.records.set('users/part_a',{archived:false});
  await h.API_HANDLERS.registerPushToken({...h.authorization('part_a'),data:{token}});
  await h.sendParticipantPush.handler({params:{uid:'part_a'},data:{data:()=>({userId:'part_a',title:'Sukses',message:'Pembayaran diterima',actionUrl:'profil.html#riwayat-pendaftaran'})}});
  assert.equal(h.sentPushes.length,1);
  assert.equal(h.sentPushes[0].tokens[0],token);
  assert.equal(h.sentPushes[0].data.url,'/profil.html#riwayat-pendaftaran');
  h.records.set('admins/part_a', {active:true});
  await h.sendParticipantPush.handler({params:{uid:'part_a'},data:{data:()=>({userId:'part_a',title:'No',message:'No'})}});
  assert.equal(h.sentPushes.length,1);
});

test('storage rules block admin accounts from uploading as participants', () => {
  const text = fs.readFileSync(path.join(__dirname,'../storage.rules'),'utf8');
  assert.match(text, /function activeParticipant[\s\S]*?!firestore[.]exists\(\/databases\/\(default\)\/documents\/admins/);
  const html = fs.readFileSync(path.join(__dirname,'../public/profil.html'),'utf8');
  assert.match(html, /data-push-toggle/);
  const profileJs = fs.readFileSync(path.join(__dirname,'../public/profile.js'),'utf8');
  assert.match(profileJs, /push-notifications[.]js/);
});


test('period creation is idempotency protected and edits require a fresh revision', async () => {
  const h = buildHarness();h.records.set('admins/uid_a', {active:true});
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-11','draft')});
  assert.equal(h.records.get('periods/2026-11').revision, 1);
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-11','draft')}), {code:'already-exists'});
  await assert.rejects(h.API_HANDLERS.savePeriod({...h.authorization(),data:{...goodPeriod('2026-11','draft'),mode:'update',expectedRevision:0}}), {code:'aborted'});
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:{...goodPeriod('2026-11','draft'),mode:'update',expectedRevision:1}});
  assert.equal(h.records.get('periods/2026-11').revision, 2);
});

test('only an unused draft period is deletable and deletion is audited', async () => {
  const h = buildHarness();h.records.set('admins/uid_a', {active:true});
  await h.API_HANDLERS.savePeriod({...h.authorization(),data:goodPeriod('2026-11','draft')});
  h.records.set('registrations/test-registration',{periodId:'2026-11'});
  await assert.rejects(h.API_HANDLERS.deletePeriod({...h.authorization(),data:{periodId:'2026-11'}}), {code:'failed-precondition'});
  h.records.delete('registrations/test-registration');
  await h.API_HANDLERS.deletePeriod({...h.authorization(),data:{periodId:'2026-11'}});
  assert.equal(h.records.has('periods/2026-11'), false);
  assert.equal(h.records.has('periodSlots/2026-11__web__wave-01'), false);
  assert.ok([...h.records.values()].some(x=>x && x.action==='period.deleted'));
});

test('CSV export requires a verified active administrator and creates a server-side audit record', async () => {
  const h = buildHarness();
  const request = authorizedApiRequest(h, 'logAdminCsvExport', {tab:'users',count:2});
  await assert.rejects(h.esoriaApi.handler(request), {code:'permission-denied'});
  h.records.set('admins/uid_a', {active:true});
  const output = await h.esoriaApi.handler(request);
  assert.equal(output.ok,true);
  const logs=[...h.records.entries()].filter(([key])=>key.startsWith('auditLogs/'));
  assert.equal(logs.length,1);
  assert.equal(logs[0][1].action,'admin.csv.export_requested');
  assert.equal(logs[0][1].details.count,2);
});

test('CSV requests have an atomic hourly limit and reject malformed tab', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  const request=(tab='users')=>authorizedApiRequest(h, 'logAdminCsvExport', {tab,count:1});
  await assert.rejects(h.esoriaApi.handler(request('unauthorized')), {code:'invalid-argument'});
  for(let n=0;n<15;n++) await h.esoriaApi.handler(request());
  await assert.rejects(h.esoriaApi.handler(request()), {code:'resource-exhausted'});
  const quotas=[...h.records.entries()].filter(([key])=>key.startsWith('securityRateLimits/'));
  assert.equal(quotas.length,1);
  assert.equal(quotas[0][1].count,16);
  assert.equal(Object.hasOwn(quotas[0][1],'uid'),false);
});

test('MFA inventory never trusts SMS number from a client; audit only server-verified factor count', async () => {
  const h=buildHarness();h.records.set('admins/uid_a',{active:true});
  const response=await h.esoriaApi.handler(authorizedApiRequest(h, 'syncAdminMfaStatus', {phone:'+621111111111'}));
  assert.deepEqual(JSON.parse(JSON.stringify(response)),{ok:true,factorCount:0});
  const security=h.records.get('adminSecurityMeta/uid_a');
  assert.equal(security.factorCount,0);
  assert.equal(JSON.stringify(security).includes('+621111111111'),false);
});

test('strict rules exist separately and are not deployed before admin MFA rollout', () => {
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase.json'),'utf8'));
  const fire=fs.readFileSync(path.join(__dirname,'../firestore.rules.mfa-enforced'),'utf8');
  const storage=fs.readFileSync(path.join(__dirname,'../storage.rules.mfa-enforced'),'utf8');
  assert.match(fire,/sign_in_second_factor/);
  assert.match(storage,/sign_in_second_factor/);
  assert.equal(config.firestore.rules,'firestore.rules');
  assert.equal(config.storage.rules,'storage.rules');
  assert.match(fs.readFileSync(path.join(__dirname,'../public/admin-security.js'),'utf8'),/multiFactor\(user\)\.unenroll\(oldUid\)/);
});

async function stagedPhoto(h, uid = 'part_a', suffix = 'a', options = {}) {
  const bytes = options.bytes || await sharp({ create: {
    width: options.width || 512, height: options.height || 512, channels: 3, background: '#244a70'
  } }).jpeg().toBuffer();
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const storagePath = `profile-photos/${uid}/${suffix.repeat(24)}.jpg`;
  h.blobs.set(storagePath, { bytes, meta: { ownerUid: uid, sha256 } });
  return { storagePath, sha256, sizeBytes: bytes.length };
}

test('foto profil tersimpan ketika identitas terkunci tanpa mengubah status atau data identitas', async () => {
  const h = buildHarness();
  const before = { uid: 'part_a', role: 'participant', participantName: 'Peserta Asli',
    profileComplete: true, profileLocked: true, archived: false, profileVersion: 7 };
  h.records.set('users/part_a', { ...before });
  const photo = await stagedPhoto(h);
  const result = await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo });
  const profile = h.records.get('users/part_a');
  assert.equal(result.ok, true);
  assert.equal(profile.photoStoragePath, photo.storagePath);
  assert.equal(profile.photoVersion, 1);
  for (const [key, value] of Object.entries(before)) assert.equal(profile[key], value);
  assert.equal(h.records.has('users/part_a/notifications/profile_photo_part_a_1'), true);
});

test('ulang simpan foto setelah respons hilang tidak menggandakan foto, audit, atau notifikasi', async () => {
  const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
  const photo = await stagedPhoto(h);
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo });
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo });
  assert.equal(h.records.get('users/part_a').photoVersion, 1);
  assert.equal([...h.records.keys()].filter((key) => key.startsWith('auditLogs/profile_photo_')).length, 1);
  assert.equal([...h.records.keys()].filter((key) => key.startsWith('users/part_a/notifications/profile_photo_')).length, 1);
});

test('penggantian foto menghapus berkas lama sesudah metadata baru tersimpan', async () => {
  const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
  const first = await stagedPhoto(h, 'part_a', 'a');
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: first });
  const second = await stagedPhoto(h, 'part_a', 'b');
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: second });
  assert.equal(h.records.get('users/part_a').photoVersion, 2);
  assert.equal(h.records.get('users/part_a').photoStoragePath, second.storagePath);
  assert.deepEqual(h.deletedFiles, [first.storagePath]);
  assert.equal(h.blobs.has(second.storagePath), true);
});

test('path foto peserta lain dan path traversal ditolak sebelum penyimpanan', async () => {
  for (const path of ['profile-photos/part_b/abcdefghijklmnopqrstuvwx.jpg', 'profile-photos/part_a/../part_b/photo.jpg']) {
    const h = buildHarness();
    await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'),
      data: { storagePath: path, sha256: 'a'.repeat(64), sizeBytes: 100 } }), { code: 'invalid-argument' });
    assert.equal(h.records.has('users/part_a'), false);
  }
});

test('admin, peserta diarsipkan, dan profil yang belum ada tidak bisa mengubah foto', async () => {
  for (const mode of ['admin', 'archived', 'missing']) {
    const h = buildHarness();
    if (mode !== 'missing') h.records.set('users/part_a', { role: 'participant', archived: mode === 'archived' });
    if (mode === 'admin') h.records.set('admins/part_a', { active: true });
    const photo = await stagedPhoto(h);
    await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo }), { code: 'permission-denied' });
    assert.equal(h.records.get('users/part_a')?.photoStoragePath, undefined);
  }
});

test('metadata pemilik, ukuran, serta hash foto harus cocok dengan berkas sebenarnya', async () => {
  for (const mode of ['owner', 'size', 'hash', 'bytes']) {
    const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
    const photo = await stagedPhoto(h);
    if (mode === 'owner') h.blobs.get(photo.storagePath).meta.ownerUid = 'part_b';
    if (mode === 'size') photo.sizeBytes += 1;
    if (mode === 'hash') photo.sha256 = 'f'.repeat(64);
    if (mode === 'bytes') h.blobs.get(photo.storagePath).bytes[30] ^= 1;
    await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo }),
      { code: mode === 'owner' ? 'permission-denied' : 'invalid-argument' });
    assert.equal(h.records.get('users/part_a').photoStoragePath, undefined);
  }
});

test('JPEG rusak yang memiliki header dan penutup palsu tetap ditolak oleh decoder', async () => {
  const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
  const photo = await stagedPhoto(h, 'part_a', 'a', { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 2, 0, 2, 0, 3, 0xff, 0xd9]) });
  await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo }), { code: 'invalid-argument' });
});

test('foto harus tepat 512 persegi dan tidak lebih dari 256 KB', async () => {
  for (const options of [{ width: 256, height: 256 }, { width: 1024, height: 1024 }, { bytes: Buffer.alloc(262145, 1) }]) {
    const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
    const photo = await stagedPhoto(h, 'part_a', 'a', options);
    await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: photo }), { code: 'invalid-argument' });
  }
});

test('foto yang pernah diganti tidak dapat diaktifkan lagi melalui request lama', async () => {
  const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
  const first = await stagedPhoto(h, 'part_a', 'a');
  const oldBlob = h.blobs.get(first.storagePath);
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: first });
  const second = await stagedPhoto(h, 'part_a', 'b');
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: second });
  h.blobs.set(first.storagePath, oldBlob);
  await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: first }), { code: 'failed-precondition' });
  assert.equal(h.records.get('users/part_a').photoStoragePath, second.storagePath);
});

test('foto baru tidak menghapus foto aktif ketika backend menolak penyimpanan', async () => {
  const h = buildHarness(); h.records.set('users/part_a', { role: 'participant', archived: false });
  const first = await stagedPhoto(h, 'part_a', 'a');
  await h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: first });
  h.records.get('users/part_a').archived = true;
  const second = await stagedPhoto(h, 'part_a', 'b');
  await assert.rejects(h.API_HANDLERS.saveProfilePhoto({ ...h.authorization('part_a'), data: second }), { code: 'permission-denied' });
  assert.equal(h.records.get('users/part_a').photoStoragePath, first.storagePath);
  assert.equal(h.blobs.has(first.storagePath), true);
  assert.equal(h.deletedFiles.length, 0);
});

test('production project cannot disable App Check through an accidental emulator flag', () => {
 const h=buildHarness({FUNCTIONS_EMULATOR:'true',ENFORCE_APP_CHECK:'false',GCLOUD_PROJECT:'esoria-codefest',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'});
 assert.equal(h.esoriaApi.options.enforceAppCheck,true);
 const demo=buildHarness({FUNCTIONS_EMULATOR:'true',ENFORCE_APP_CHECK:'false',GCLOUD_PROJECT:'demo-esoria-codefest',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'});
 assert.equal(demo.esoriaApi.options.enforceAppCheck,false);
});
