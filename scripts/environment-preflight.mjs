import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
if (!project || !args.includes('--project') || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('Project ID eksplisit diperlukan.');
// This script runs outside a browser: provide the location object used by runtime-config.js.
// Simulate the production origin, never the isolated emulator origin.
const runtime = {globalThis: {},location:{hostname:`${project}.web.app`,port:''}};
vm.runInNewContext(readFileSync(new URL('../public/runtime-config.js',import.meta.url),'utf8'),runtime,{timeout:1000});
const config = runtime.globalThis.ESORIA_RUNTIME_CONFIG;
if (!config?.appCheckSiteKey) throw new Error('Site key App Check belum diisi.');
const source=readFileSync(new URL('../public/firebase-config.js',import.meta.url),'utf8');
const match=source.match(/const originalFirebaseConfig = (\{[\s\S]*?\n\});/);
if (!match) throw new Error('Konfigurasi asli tidak ditemukan.');
const original = vm.runInNewContext(`(${match[1]})`, {}, {timeout:1000});
const firebase = config.firebase || original;
if (![`${project}.firebasestorage.app`, `${project}.appspot.com`].includes(firebase.storageBucket)) throw new Error('Bucket harus default Firebase milik project target; konfigurasi lintas proyek ditolak.');
if (firebase.projectId !== project) throw new Error(`Client Firebase berbeda dari target ${project}. Gunakan generator runtime staging terlebih dahulu.`);
for (const key of ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId']) if (!String(firebase[key]||'').trim()) throw new Error(`Konfigurasi publik ${key} belum lengkap.`);
if (!config.messagingVapidKey || config.messagingVapidKey.length < 60) throw new Error('Public VAPID key belum lengkap.');
const engines=JSON.parse(readFileSync(new URL('../functions/package.json',import.meta.url),'utf8')).engines;
if(engines?.node!=='22') throw new Error('Functions harus memakai Node 22.');
if (project !== 'esoria-codefest' && !config.firebase) throw new Error('Staging wajib mempunyai seluruh Firebase client config sendiri.');
console.log(`Konfigurasi publik cocok dengan ${project}; Node Functions 22; App Check dan Web Push telah diisi. Kepemilikan key/domain tetap perlu dibuktikan di Console.`);

if (project !== 'esoria-codefest') {
  const envFile=new URL(`../functions/.env.${project}`,import.meta.url);
  if(!existsSync(envFile))throw new Error('Berkas .env project staging belum dibuat.');
  const env=readFileSync(envFile,'utf8');
  const origin=env.match(/^SITE_ORIGIN=(.+)$/m)?.[1]?.trim();
  if(!origin||!origin.startsWith('https://')||origin.includes('esoria-codefest.web.app'))throw new Error('SITE_ORIGIN staging wajib diisi dan terpisah dari produksi.');
}
