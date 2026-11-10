import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const errors=[];
const requireFile=(rel)=>{
  const p=path.join(root,rel);
  if(!existsSync(p))errors.push(`File wajib hilang: ${rel}`);
  return existsSync(p) ? readFileSync(p,'utf8') : '';
};
for (const file of [
  'DEPLOY_SEMUA.cmd','upload.cmd','scripts/github-upload.ps1','scripts/live/START_LIVE.ps1','scripts/live/verify-source.mjs','scripts/DEPLOY_FULL_FIREBASE.ps1',
  '.firebaserc','firebase.json','firestore.rules','storage.rules','firestore.indexes.json',
  'functions/index.js','functions/competition.js','functions/package.json',
  'scripts/live/sync-admin.mjs','scripts/check-admin-security.mjs',
  'public/index.html','public/admin.html',
  'public/dashboard.html','public/operations.html','public/jury.html',
  'public/results.html','public/verify-certificate.html'
]) requireFile(file);
const rc=JSON.parse(requireFile('.firebaserc') || '{}');
const cfg=JSON.parse(requireFile('firebase.json') || '{}');
if (rc.projects?.default!=='esoria-codefest') errors.push('Project Firebase tidak tepat.');
if (cfg.hosting?.public!=='public') errors.push('Root Hosting bukan public/.');
if (cfg.firestore?.rules!=='firestore.rules') errors.push('Firestore rules deployment tidak sesuai.');
if (cfg.storage?.rules!=='storage.rules') errors.push('Storage rules deployment tidak sesuai.');
if (cfg.firestore?.indexes!=='firestore.indexes.json') errors.push('Firestore indeks deployment tidak sesuai.');
const fn=requireFile('functions/index.js');
for(const name of ['esoriaApi','esoriaCtf','esoriaPublic','purgeExpiredPaymentProofs','purgeStaleCompetitionFiles','sendParticipantPush']){
 if(!fn.includes(`export const ${name} =`))errors.push(`Function hilang: ${name}`);
}
const rules=requireFile('firestore.rules');
if(!/match\s+\/staff\/\{uid\}\s*\{\s*allow\s+read\s*,\s*write:\s*if\s+false\s*;\s*\}/.test(rules))errors.push('Dokumen staff lama harus ditutup untuk akses browser.');
if(fn.includes('setStaffRoles =') || fn.includes("case 'setStaffRoles'"))errors.push('Endpoint role staff lama masih aktif.');
const driver=requireFile('scripts/DEPLOY_FULL_FIREBASE.ps1');
if(!driver.includes('test:emulator')) errors.push('Pengujian Emulator wajib sebelum perubahan Firebase.');
if(!driver.includes('--non-interactive')) errors.push('Full deploy harus non-interaktif.');
if(driver.includes('Confirm-ESORIAYesNo') || driver.includes('Read-Host')) errors.push('Konfirmasi manual tertinggal di deploy.');
if(driver.includes('scripts/predeploy-backup.ps1')) errors.push('Backup otomatis lama terhubung.');
const launcher=requireFile('DEPLOY_SEMUA.cmd');
if(!launcher.includes('scripts\\live\\START_LIVE.ps1')) errors.push('CMD bukan single full-deploy launcher.');
if(launcher.includes('START_LIVE_WITH_DATASET'))errors.push('Launcher tidak boleh mengimpor database.');
const githubLauncher=requireFile('upload.cmd');
if(!githubLauncher.includes('scripts\\github-upload.ps1')) errors.push('CMD GitHub harus memanggil orchestrator GitHub terpisah.');
if(githubLauncher.includes('DEPLOY_SEMUA.cmd')) errors.push('CMD GitHub tidak boleh menjalankan deployment Firebase.');
const live=requireFile('scripts/live/START_LIVE.ps1');
if(!live.includes('scripts/DEPLOY_FULL_FIREBASE.ps1') || !live.includes('scripts/live/sync-admin.mjs'))
 errors.push('Orkestrator wajib mencakup deploy dan pemeriksaan admin.');
if(/Confirm-ESORIAYesNo|seed-production|START_LIVE_WITH_DATASET/.test(live))errors.push('Orkestrator live tidak boleh meminta Y/N atau memasukkan data.');
for(const dir of ['demo','scripts/demo','scripts/live/seed-production.mjs'])
 if(existsSync(path.join(root,dir)))errors.push(`Dataset lokal masih dalam ZIP: ${dir}`);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Rilis bersih: CMD GitHub dan CMD Firebase terpisah, enam Cloud Functions, Rules dan tes wajib, tanpa dataset/impor/hapus database.');
