const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {resolve = res; reject = rej;});
  return {promise, resolve, reject};
};

test('registration draft autosave serializes revisions and queues latest edits', async () => {
  const text = read('public/registration.js');
  const source = text.slice(text.indexOf('const saveAccountDraft = async () => {'), text.indexOf('const queueAccountDraft = () => {'));
  assert.ok(source.startsWith('const saveAccountDraft'));
  const requests = [];
  const notices = [];
  let queues = 0;
  const make = new Function('accountApi','draftPayload','updateDraftNotice','queueAccountDraft', `
    let cloudDraftReady = true, cloudDraftConflict = false, submitting = false;
    let cloudDraftPending = null, cloudDraftQueued = false, cloudDraftRevision = 0;
    ${source}
    return { saveAccountDraft, getRevision:()=> cloudDraftRevision };
  `);
  let draftVersion = 1;
  const state = make((action, payload) => {
    assert.equal(action, 'saveRegistrationDraft');
    const d = deferred();
    requests.push({...d, payload});
    return d.promise;
  }, () => ({draftVersion}), (message, level) => notices.push({message, level}), () => {queues += 1;});
  const first = state.saveAccountDraft();
  draftVersion = 2;
  await state.saveAccountDraft();
  assert.equal(requests.length, 1, 'must not write twice using revision zero');
  requests[0].resolve({revision:1});
  await first;
  assert.equal(queues, 1, 'must schedule a new save for a changed draft');
  const second = state.saveAccountDraft();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].payload.expectedRevision, 1);
  assert.equal(requests[1].payload.draft.draftVersion, 2);
  requests[1].resolve({revision:2});
  await second;
  assert.equal(state.getRevision(), 2);
  assert.equal(notices.at(-1).level, 'saved');
});

test('failed logout confirmation cannot freeze logout or sign out without approval', async () => {
  const source = read('public/logout-controller.js')
    .replace(/^import .*;\n/gm,'')
    + '\nglobalThis.__logout = logout;';
  const messages = [];
  let attempts = 0;
  let signedOut = 0;
  const button = {
    closest: () => null,
    insertAdjacentElement: (_where, node) => messages.push(node.textContent)
  };
  const context = {
    document: {
      addEventListener: ()=>{},
      createElement: ()=>({setAttribute(){},remove(){},textContent:''})
    },
    paperConfirm: async () => {attempts++; throw Error('dialog unavailable');},
    signOut: async () => {signedOut++;},
    auth:{currentUser:{uid:'test'}},
    console: {warn(){}},
    setTimeout:()=>0,
    Promise,
    CustomEvent:class {},
    window:{location:{replace(){}}}
  };
  vm.runInNewContext(source, context, {filename:'logout-controller.js'});
  await context.__logout(button);
  await context.__logout(button);
  assert.equal(attempts, 2);
  assert.equal(signedOut, 0);
  assert.deepEqual(messages, ['Konfirmasi belum tersedia. Coba lagi.', 'Konfirmasi belum tersedia. Coba lagi.']);
});

test('download anchor is attached before clicking and cleaned after click', () => {
  const src=read('public/competition-client.js');
  const section = src.slice(src.indexOf('export const download ='), src.indexOf('export const escapeHtml'))
    .replace('export const download =', 'const download =');
  const calls=[];
  const link = {download:'',href:'',isConnected:false,click(){assert.equal(this.isConnected,true);calls.push('clicked');},remove(){this.isConnected=false; calls.push('removed');}};
  const context={
    atob:(b64)=>Buffer.from(b64,'base64').toString('binary'), Uint8Array, Blob,
    URL:{createObjectURL:()=> 'blob:esoria',revokeObjectURL:()=>calls.push('revoked')},
    document:{body:{append(node){node.isConnected=true;calls.push('appended');}},createElement:()=>link},
    setTimeout:(fn)=>{fn();}
  };
  vm.runInNewContext(`${section}\nglobalThis.__download=download;`,context);
  context.__download({base64:Buffer.from('sample').toString('base64'),mimeType:'application/pdf',fileName:'bukti.pdf'});
  assert.equal(link.download,'bukti.pdf');
  assert.deepEqual(calls,['appended','clicked','removed','revoked']);
});

test('participant registration snapshots refresh open ticket details instead of leaving stale ACC state', () => {
  const src=read('public/profile.js');
  const from=src.indexOf('const renderRegistrations = () => {');
  const to=src.indexOf('const loadReplacementImage =',from);
  assert.ok(from>0 && to>from);
  const fragment=src.slice(from,to);
  const items=[{id:'enroll-1', status:'menunggu', checkedIn:false}];
  const calls=[];
  const ticketDialog={open:true,close(){this.open=false;calls.push('closed');}};
  const registrationList={innerHTML:'',contains:()=>false,querySelectorAll:()=>[]};
  const factory=new Function('registrationItems','registrationList','ticketDialog','document','escapeHtml','ticketStatusLabel','ticketNumberLabel','formatTimestamp','openTicketDetail','openTicketId',`${fragment}\nreturn renderRegistrations;`);
  const render=factory(items,registrationList,ticketDialog,{activeElement:null},(x)=>String(x??''),item=>item.status,item=>item.id,()=> 'now',(id, refresh)=> calls.push(`${id}:${refresh}`),'enroll-1');
  render();
  assert.ok(registrationList.innerHTML.includes('enroll-1'));
  assert.deepEqual(calls,['enroll-1:true']);
  items[0]={...items[0],status:'terverifikasi',checkedIn:true};
  render();
  assert.deepEqual(calls,['enroll-1:true','enroll-1:true']);
  items.length=0;
  render();
  assert.equal(ticketDialog.open,false);
  assert.equal(calls.at(-1),'closed');
});

test('profile owner-scoped snapshot handlers ignore a previous account after session change', () => {
  const source=read('public/profile.js');
  assert.match(source,/onSnapshot\(doc\(db, 'users', user\.uid\), async \(snapshot\) => \{\s*if \(auth\.currentUser\?\.uid !== user\.uid/);
  assert.match(source,/onSnapshot\(doc\(db, 'profileEditRequests', user\.uid\), \(snapshot\) => \{\s*if \(auth\.currentUser\?\.uid !== user\.uid\) return;/);
  assert.match(source,/const openTicketDetail = \(id, refresh = false\) => \{\s*if \(auth\.currentUser\?\.uid !== user\.uid\) return;/);
  assert.match(source,/onSnapshot\(\s*query\(collection\(db, 'registrations'\).*?\(snapshot\) => \{\s*if \(auth\.currentUser\?\.uid !== user\.uid\) return;/s);
});

test('certificate PDF has a font-independent fallback and preserves optional Unicode font support', () => {
  const source = read('functions/competition.js');
  assert.match(source,/if \(error\?\.code !== 'ENOENT'\) throw error;/);
  assert.match(source,/pdf\.embedFont\(StandardFonts\.Helvetica\)/);
  assert.match(source,/font\.encodeText\(character\)/);
  const artwork = read('functions/certificate-artwork.js');
  assert.match(artwork,/const safe = \(value\) => pdfText\(/);
  assert.match(artwork,/const name = fitted\(recipient, 672, 31\.5, 15, font\)/);
  assert.equal(fs.existsSync(path.join(ROOT, 'functions/assets/DejaVuSans.ttf')), false);
});
