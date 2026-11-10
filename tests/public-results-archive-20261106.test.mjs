import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {officiallyReleased} from '../functions/domain.js';
const base=resolve(import.meta.dirname,'..');
const read=(path)=>readFileSync(resolve(base,path),'utf8');
const tick=()=>new Promise((r)=>setImmediate(r));

test('production launcher is non-interactive and excludes dataset import',()=>{
 const deploy=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
 const launcher=read('DEPLOY_SEMUA.cmd');
 assert.match(deploy,/--non-interactive/);
 assert.doesNotMatch(deploy,/Confirm-ESORIAYesNo|Read-Host/);
 assert.match(launcher,/scripts\\live\\START_LIVE\.ps1/);
 assert.doesNotMatch(launcher,/START_LIVE_WITH_DATASET/);
});

test('public scope archive excludes unreleased, future and synthetic production records',()=>{
 const now=Date.parse('2026-11-06T10:00:00Z');
 assert.equal(officiallyReleased({published:true,announcementAt:new Date('2026-10-10T10:00:00Z').toISOString()},now),true);
 assert.equal(officiallyReleased({published:true,demoFixture:true,announcementAt:'2026-10-10T10:00:00Z'},now),false);
 assert.equal(officiallyReleased({published:true,announcementAt:'2026-12-10T10:00:00Z'},now),false);
 assert.equal(officiallyReleased({published:false,announcementAt:'2026-10-10T10:00:00Z'},now),false);
 const backend=read('functions/competition.js');
 assert.match(backend,/handlers\.getPublishedArchive/);
 assert.match(backend,/\.where\('published', '==', true\)\.limit\(100\)/);
 assert.match(backend,/if \(!officiallyReleased\(result\)\) return null/);
 assert.match(read('functions/index.js'),/archive: 'getPublishedArchive'/);
});

test('results page selects existing October archive rather than empty November by default',async()=>{
 const calls=[];
 const el={periodId:{value:'',dispatchEvent(){}}, package:{value:'web',selectedOptions:[{textContent:'Website Programming'}]},wave:{value:'wave-01',selectedOptions:[{textContent:'Awal bulan'}]}};
 const form={elements:el,listeners:{},querySelector(){return {disabled:false};},addEventListener(type,fn){this.listeners[type]=fn;}};
 const panel={innerHTML:'',addEventListener(){}};
 const archive={innerHTML:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(){return [];}};
 const document={body:{dataset:{workspace:'results'}},querySelector(s){return {'#scope-form':form,'#public-results':panel,'#results-archive':archive}[s]||null;}};
 const FormData=class {constructor(f){this.elements=Object.entries(f.elements).map(([k,v])=>[k,v.value]);} [Symbol.iterator](){return this.elements[Symbol.iterator]();}};
 const fetch=async url=>{
  calls.push(String(url));
  const u=new URL(String(url));
  if(u.searchParams.get('kind')==='archive')return {ok:true,json:async()=>({ok:true,data:{items:[{periodId:'2026-10',package:'web',wave:'wave-01'},{periodId:'2026-09',package:'cyber',wave:'wave-02'}]}})};
  return {ok:true,json:async()=>({ok:true,data:{published:true,rows:[{displayName:'Peserta Terpilih',rank:1,total:97}]}})};
 };
 vm.runInNewContext(read('public/public-records.js'),{document,FormData,URL,URLSearchParams,fetch,AbortController,console:{warn(){}},setTimeout:()=>0,clearTimeout(){},location:{origin:'http://127.0.0.1:5000',hostname:'127.0.0.1',port:'5000',search:''},window:{ESORIA_RUNTIME_CONFIG:{demoEmulator:true}},Event:class{constructor(type){this.type=type;}},Date,Intl});
 for(let i=0;i<5;i++)await tick();
 assert.equal(el.periodId.value,'2026-10');
 assert.match(archive.innerHTML,/2026-10/);
 assert.match(panel.innerHTML,/Peserta Terpilih/);
 assert.equal(calls.filter(x=>x.includes('kind=archive')).length,1);
 assert.equal(calls.filter(x=>x.includes('kind=results')).length,1);
 assert.match(panel.innerHTML,/peninjauan internal/);
});

test('no live fixture import is shipped with production source',()=>{
 assert.doesNotMatch(read('scripts/live/START_LIVE.ps1'),/seed-production/);
 assert.doesNotMatch(read('DEPLOY_SEMUA.cmd'),/START_LIVE_WITH_DATASET/);
});
