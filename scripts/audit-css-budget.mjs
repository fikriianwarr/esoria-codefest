#!/usr/bin/env node
/* Read-only style budget; protects against accidental duplicate CSS and asset growth. */
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const pages=['index.html','admin.html','profil.html','dashboard.html','operations.html','jury.html','results.html','forgot-password.html'];
let failed=false;
for(const page of pages){
  const html=await readFile(path.join(root,page),'utf8');
  const links=[...html.matchAll(/<link\b[^>]*?href=["']([^"']+\.css)(?:\?[^"']*)?["'][^>]*>/gi)]
    .map(i=>i[1]);
  const distinct=new Set(links);
  if(links.length!==distinct.size){console.error(`GAGAL ${page}: stylesheet duplikat.`);failed=true;}
  let bytes=0;
  for(const href of distinct){
    const normalized=href.replace(/^\.\//,'').replace(/^\//,'');
    const resolved=path.resolve(root,normalized);
    if(!resolved.startsWith(root+path.sep)) throw Error('Aset di luar public/');
    const file=await stat(resolved).catch(()=>null);
    if(!file?.isFile()){console.error(`GAGAL ${page}: CSS hilang: ${href}`);failed=true;continue;}
    bytes+=file.size;
  }
  console.log(`${page.padEnd(23)} ${String(links.length).padStart(2)} CSS / ${(bytes/1024).toFixed(1)} KiB sebelum kompresi`);
  // Absolute guardrail, NOT a claim of real Lighthouse speed.
  if(bytes > 500*1024){console.error(`GAGAL ${page}: budget 500 KiB terlampaui.`);failed=true;}
}
if(failed)process.exitCode=1;
