import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(join(root,path),'utf8');
const required=['DEPLOY_SEMUA.cmd','scripts/live/START_LIVE.ps1','scripts/live/sync-admin.mjs',
 'scripts/DEPLOY_FULL_FIREBASE.ps1','firebase.json','firestore.rules','storage.rules',
 'firestore.indexes.json','public/index.html','functions/index.js','functions/competition.js',
 'scripts/run-emulators.mjs','scripts/live/audit-official-readiness.mjs'];
for(const path of required)assert.ok(existsSync(join(root,path)),`File wajib hilang: ${path}`);
assert.deepEqual(readdirSync(root).filter(n=>n.toLowerCase().endsWith('.cmd')).sort(),['DEPLOY_SEMUA.cmd','upload.cmd']);
for(const path of ['demo','scripts/demo','scripts/local/START_DATASET.ps1','scripts/live/seed-production.mjs',
 'scripts/live/import-policy.mjs','scripts/live/START_LIVE_WITH_DATASET.ps1'])
 assert.ok(!existsSync(join(root,path)),`Data historis tidak boleh ada di paket produksi: ${path}`);
const launcher=read('DEPLOY_SEMUA.cmd');
assert.match(launcher,/scripts\\live\\START_LIVE\.ps1/);
assert.doesNotMatch(launcher,/START_LIVE_WITH_DATASET|choice \/c 123/i);
assert.match(launcher,/set \/p \"ESORIA_CLOSE=/i);
for (const file of ['scripts/live/START_LIVE.ps1','scripts/DEPLOY_FULL_FIREBASE.ps1']) {
 const source=read(file);
 assert.doesNotMatch(source,/Confirm-ESORIAYesNo|Read-Host|PUBLIKASIKAN TANPA BACKUP|seed-production/);
}
const deploy=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
assert.match(deploy,/test:emulator/);
assert.match(deploy,/--non-interactive/);
assert.doesNotMatch(deploy,/["']--force["']|firestore:delete|database:delete/);
const rules=read('firestore.rules'),storage=read('storage.rules');
assert.match(rules,/allow read, write: if false/);
assert.match(storage,/allow read, write: if false/);
assert.match(read('functions/domain.js'),/result\?\.demoFixture !== true/);

const generatedFilePatterns = [/\.log(?:\..+)?$/i,/\.(?:tmp|bak|orig|swp|swo)$/i,/^Thumbs\.db$/i,/^Desktop\.ini$/i];
function inspectGeneratedFiles(directory) {
  for (const item of readdirSync(directory,{withFileTypes:true})) {
    if (['node_modules','.firebase','.git'].includes(item.name)) continue;
    const target=join(directory,item.name);
    if (item.isDirectory()) inspectGeneratedFiles(target);
    else assert.ok(!generatedFilePatterns.some(pattern=>pattern.test(item.name)),`Berkas hasil proses tidak boleh disertakan: ${target}`);
  }
}
inspectGeneratedFiles(root);

console.log('LULUS: source produksi bersih, dua launcher CMD terpisah (GitHub/Firebase), pengujian keamanan dan Rules tetap aktif.');
