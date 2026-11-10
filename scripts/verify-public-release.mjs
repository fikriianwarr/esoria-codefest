#!/usr/bin/env node
/** Read-only smoke checks against Hosting and public records. Never publishes or writes data. */
import {readFile} from 'node:fs/promises';
import {sameHtmlRelease} from './release-html-integrity.mjs';
const origin = process.env.ESORIA_SMOKE_ORIGIN || 'https://esoria-codefest.web.app';
const base = new URL(origin);
const strictHtml = process.env.ESORIA_SMOKE_VERIFY_FILES === '1' ||
  (process.env.ESORIA_SMOKE_VERIFY_FILES !== '0' && base.origin === 'https://esoria-codefest.web.app');
if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
  throw new Error('Smoke origin harus HTTPS, atau localhost untuk emulator.');
}
const currentWib = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Jakarta',year:'numeric',month:'2-digit'}).formatToParts(new Date());
const periodId = `${currentWib.find(i => i.type==='year').value}-${currentWib.find(i => i.type==='month').value}`;
const paths = [
  {url:'/',kind:'html',file:'index.html'},
  {url:'/login.html',kind:'html',file:'login.html'},
  {url:'/admin.html',kind:'html',file:'admin.html'},
  {url:'/dashboard.html',kind:'html',file:'dashboard.html'},
  {url:'/operations.html',kind:'html',file:'operations.html'},
  {url:'/jury.html',kind:'html',file:'jury.html'},
  {url:'/results.html',kind:'html',file:'results.html'},
  {url:'/legal/',kind:'html',file:'legal/index.html'},
  {url:`/api/public?kind=results&periodId=${periodId}&package=web&wave=wave-01`,kind:'results'},
  {url:'/api/public?kind=certificate&certificateId=00000000000000000000000000000000',kind:'certificate'}
];
const problems = [];
for (const item of paths) {
  const address = new URL(item.url,base);
  try {
    const response = await fetch(address,{signal:AbortSignal.timeout(16000),cache:'no-store',redirect:'follow'});
    const content = await response.text();
    const type=response.headers.get('content-type') || '';
    let valid = response.status===200;
    if(item.kind==='html') {
      valid &&= type.includes('text/html') && /<html[\s>]/i.test(content);
      if (valid && strictHtml) {
        const source = await readFile(new URL(`../public/${item.file}`, import.meta.url), 'utf8');
        if (!sameHtmlRelease(content, source)) {
          valid = false;
          problems.push(`${item.url}: HTML yang terbit tidak sama dengan file paket. Periksa versi Hosting, cache, dan folder yang dideploy.`);
        }
      }
    }
    if(item.kind==='results'||item.kind==='certificate'){
      let data=null;try{data=JSON.parse(content)}catch{}
      valid &&= type.includes('application/json') && data?.ok===true && typeof data.data==='object';
      if(item.kind==='results') valid &&= typeof data?.data?.published==='boolean';
    }
    console.log(`${valid?'OK':'GAGAL'} HTTP ${response.status}: ${item.url}`);
    if(!valid) problems.push(`${item.url}: respons tidak valid (${response.status}, ${type})`);
  } catch(error){problems.push(`${item.url}: ${error.message}`);console.error(`GAGAL: ${item.url}: ${error.message}`)}
}
if(problems.length){ console.error('Smoke produksi belum berhasil:\n'+problems.join('\n'));process.exitCode=1; }
else console.log(`Smoke read-only selesai: ${paths.length}/${paths.length} endpoint terverifikasi${strictHtml ? ', termasuk kecocokan source HTML Hosting' : ''}. Auth/MFA/pembayaran tetap memerlukan uji manual.`);
