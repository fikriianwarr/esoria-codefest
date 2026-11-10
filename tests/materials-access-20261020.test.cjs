const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {inflateRawSync} = require('node:zlib');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname,'..');
const source = (p) => fs.readFileSync(path.join(root,p),'utf8');
const access = import(pathToFileURL(path.join(root,'functions/materials-access.js')).href);
// Read the local ZIP entries using only Node built-ins, so this regression
// test also runs on a clean Windows installation without unzip.exe.
function zipEntries(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    assert.equal(flags & 0x08, 0, 'Unexpected ZIP data descriptor');
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const end = start + compressed;
    const data = buffer.subarray(start,end);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset = end;
  }
  return files;
}
const approved = (packageId='team') => ({userId:'leader', package:packageId, active:true, status:'terverifikasi',paymentStatus:'sesuai',ticketNumber:'ECF-2026-11-TEAM-W1-0001'});
const team = {memberUids:['leader','member']};

test('materials: only accepted, paid, officially ticketed registrations are eligible', async () => {
  const {eligibleForMaterials: eligible} = await access;
  assert.equal(eligible(approved('web'), null, 'leader'), true);
  assert.equal(eligible(approved('team'), team, 'leader'), true);
  assert.equal(eligible(approved('team'), team, 'member'), true);
  assert.equal(eligible(approved('team'), team, 'outsider'), false);
  assert.equal(eligible(approved('web'), team, 'member'), false);
  for (const changes of [{status:'menunggu'}, {status:'ditolak'}, {paymentStatus:'belum_diperiksa'}, {active:false}, {ticketNumber:''},{ticketNumber:'ECF-ECF-duplicate'}, {package:'unknown'}]) {
    assert.equal(eligible({...approved(),...changes},team,'leader'),false,JSON.stringify(changes));
  }
});

test('materials: only three allowed bundles; no path traversal and no private data in Hosting', async () => {
  const {readCategoryMaterials} = await access;
  await assert.rejects(() => readCategoryMaterials('../../firestore.rules'),/Invalid materials category/);
  await assert.rejects(() => readCategoryMaterials('web/../team'),/Invalid materials category/);
  assert.equal(fs.existsSync(path.join(root,'public/materials')),false);
  assert.equal(source('firebase.json').includes('/api/materials'),false);
  assert.match(source('functions/competition.js'),/eligibleForMaterials\(registration, team, user.uid\)/);
  assert.match(source('functions/competition.js'),/registrationAccess\(tx, registrationId, user\)/);
  assert.match(source('functions/index.js'),/'getCompetitionMaterials'/);
});

test('materials: downloaded archives are correctly scoped and intact', async () => {
  const {readCategoryMaterials} = await access;
  const manifest = JSON.parse(source('functions/materials/MANIFEST.json'));
  for (const [kind,info] of Object.entries(manifest)) {
    const result = await readCategoryMaterials(kind);
    assert.equal(result.mimeType,'application/zip');
    assert.ok(result.fileName.endsWith('.zip'));
    const bytes = Buffer.from(result.base64,'base64');
    assert.equal(bytes.length,info.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),info.sha256);
    const files = zipEntries(bytes);
    const names = [...files.keys()];
    assert.ok(names.includes('Mulai_di_Sini.html'));
    assert.equal(names.length,info.sourceFileCount+1);
    assert.equal(names.some(n=>n.includes('Panitia') || n.endsWith('.csv')),false);
    const prefix = kind === 'web' ? '01_Website_Programming/' : kind === 'cyber' ? '02_Cybersecurity_Mini_CTF/' : '03_Full_Stack_Team/';
    assert.ok(names.filter(n=>n!=='Mulai_di_Sini.html').every(n=>n.startsWith(prefix)));
    for (const [name,len,checksum] of info.sourceFiles) {
      const original=files.get(name);
      assert.ok(original, `Missing ${name}`);
      assert.equal(original.length,len);
      assert.equal(crypto.createHash('sha256').update(original).digest('hex'),checksum);
    }
  }
});

test('materials: dashboard and submission link authenticated callable downloads only after ACC', () => {
  const js=source('public/competition-participant.js');
  const dashboard=source('public/dashboard.html');
  const submission=source('public/submission.html');
  assert.match(js,/reg\.materialsAvailable/);
  assert.match(js,/data\.materialsAvailable/);
  assert.match(js,/api\('getCompetitionMaterials', \{registrationId\}\)/);
  assert.match(js,/auth\.currentUser\?\.uid !== user\.uid/);
  assert.match(dashboard,/Bahan lomba tersedia setelah ACC/);
  assert.match(submission,/id="materials-download"/);
  assert.match(submission,/id="materials-ready" hidden/);
  assert.match(submission,/id="materials-locked"/);
});
