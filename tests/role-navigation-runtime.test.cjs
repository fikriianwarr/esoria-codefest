'use strict';
// Exercise the actual results-context.js: permission changes must remove stale
// staff navigation, including in-flight Firestore lookups and cross-tab logout.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','public','results-context.js'),'utf8');
const authSource = fs.readFileSync(path.join(__dirname,'..','public','auth-core.js'),'utf8');
const node = () => ({
 hidden:false,children:[],attrs:{},events:{},
 setAttribute(name,value){this.attrs[name]=value;},
 addEventListener(name,cb){this.events[name]=cb;},
 focus(){this.focused=true;},replaceChildren(...items){this.children=items;},
 append(...items){this.children.push(...items);},remove(){this.removed=true;}
});
const flush = () => new Promise(resolve=>setImmediate(resolve));
async function harness({from='jury',user={uid:'judge-1',emailVerified:true},admin=false,roles=['judge'],reject=null,referrer=from,adminLookup=null}={}) {
 const links=Object.fromEntries(['[data-nav-back]','[data-nav-admin]','[data-nav-operations]','[data-nav-jury]','[data-nav-result]'].map(key=>[key,node()]));
 const publicNav=node(),staffNav=node(),memberNav=node(),hero=node(),preview=node();
 staffNav.hidden=true;memberNav.hidden=true;preview.hidden=true;
 staffNav.querySelector=selector=>links[selector]??null;
 let alert=null,authCalls=0,staffCalls=0,observer=null,errorObserver=null;
 hero.insertAdjacentElement=(_,item)=>{alert=item;};
 const nodes={'[data-context-nav="public"]':publicNav,'[data-context-nav="staff"]':staffNav,'[data-context-nav="member"]':memberNav,'.cf-hero':hero,'#results-admin-preview':preview};
 const contextClasses=new Set();
 const document={referrer:`https://esoria.test/${referrer}.html`,hidden:false,documentElement:{classList:{remove:name=>contextClasses.delete(name)}},
  querySelector:selector=>nodes[selector]??null,createElement:()=>node(),events:{},
  addEventListener(name,callback){this.events[name]=callback;}};
 const mocks={
  observeAuthChanges(callback,onError){authCalls++;observer=callback;errorObserver=onError;queueMicrotask(()=>reject==='auth'?onError(new Error('Auth failed')):callback(user));return()=>{};},
  isAdminUser:async u=>{if(adminLookup)return adminLookup(u);if(reject==='admin')throw Error('Firestore unavailable');return admin;},
  getActiveStaffRoles:async current=>{staffCalls++;if(reject==='staff')throw Error('Staff unavailable');return typeof roles === 'function' ? roles(current) : roles;}
 };
 const testSource=source.replace(/await import\('\.\/auth-core\.js\?v=[^']+'\)/,'await Promise.resolve(__mocks)');
 assert.notEqual(testSource,source,'Dynamic import changed; update runtime harness');
 vm.runInNewContext(testSource,{location:{search:`?from=${from}`,origin:'https://esoria.test'},document,URL,URLSearchParams,console:{warn(){}},queueMicrotask,__mocks:mocks});
 await flush();await flush();
 return {publicNav,staffNav,memberNav,links,preview,document,contextClasses,get alert(){return alert;},authCalls,get staffCalls(){return staffCalls;},
  change:async next=>{observer?.(next);await flush();await flush();},
  authError:async()=>{errorObserver?.(new Error('offline'));await flush();},
  revisit:async()=>{document.events.visibilitychange?.();await flush();await flush();}}
}
test('member cannot open admin/judging context even with a legacy staff flag',async()=>{
 const x=await harness();assert.equal(x.staffNav.hidden,true);assert.equal(x.publicNav.hidden,false);
 assert.match(x.alert.children[0].textContent,/membutuhkan akses/);
});
test('member with obsolete payment role cannot use operational console',async()=>{
 const x=await harness({from:'operations',roles:['payment']});assert.equal(x.staffNav.hidden,true);
});
test('admin has access to workflow tabs without acquiring staff role',async()=>{
 const x=await harness({admin:true,roles:[]});assert.equal(x.staffNav.hidden,false);
 assert.equal(x.links['[data-nav-admin]'].hidden,false);assert.equal(x.links['[data-nav-jury]'].hidden,false);
 assert.equal(x.links['[data-nav-operations]'].hidden,false);assert.equal(x.staffCalls,0);
});
test('members and fake URL context cannot obtain administrator nav',async()=>{
 const x=await harness({roles:[]});assert.equal(x.publicNav.hidden,false);assert.equal(x.staffNav.hidden,true);
 assert.match(x.alert.children[0].textContent,/membutuhkan akses/);
 const y=await harness({from:'operations',roles:['judge']});assert.equal(y.staffNav.hidden,true);
 const z=await harness({from:'jury',roles:['payment']});assert.equal(z.staffNav.hidden,true);
});
test('only an active admin is allowed admin context',async()=>{
 const staff=await harness({from:'admin',roles:['committee','judge']});
 const admin=await harness({from:'admin',admin:true,roles:[]});
 assert.equal(staff.staffNav.hidden,true);assert.equal(admin.staffNav.hidden,false);
 assert.equal(admin.links['[data-nav-admin]'].hidden,false);
 assert.equal(admin.links['[data-nav-operations]'].hidden,false);
 assert.equal(admin.links['[data-nav-jury]'].hidden,false);
});
test('no-session, unverified-email, role errors fail closed and do not show fake back links',async()=>{
 for(const options of [{user:null},{user:{uid:'abc',emailVerified:false}},{reject:'staff'},{reject:'auth'}]) {
  const x=await harness(options);assert.equal(x.publicNav.hidden,false);assert.equal(x.staffNav.hidden,true);
  assert.ok(x.alert);assert.equal(x.alert.children.some(child=>/^Kembali ke halaman sebelumnya/.test(child.textContent)),false);
 }
});
test('no user offers explicit login and does not imply signOut',async()=>{
 const x=await harness({user:null});const link=x.alert.children[1];
 assert.equal(link.href,'login.html?next=jury.html');assert.match(link.textContent,/Masuk/);
 assert.doesNotMatch(source,/signOut\(/);
});
test('public result without role context does not bootstrap Firebase Auth',async()=>{
 const x=await harness({from:'nonsense'});assert.equal(x.authCalls,0);assert.equal(x.staffNav.hidden,true);
});
test('cross-tab logout immediately removes previously verified staff navigation',async()=>{
 const x=await harness({admin:true});assert.equal(x.staffNav.hidden,false);
 await x.change(null);assert.equal(x.staffNav.hidden,true);assert.equal(x.publicNav.hidden,false);
 assert.equal(x.preview.hidden,true);assert.match(x.alert.children[0].textContent,/Sesi login belum tersedia/);
});
test('switching from admin to member removes administrator navigation',async()=>{
 const x=await harness({adminLookup:async u=>u.uid==='judge-1'});
 assert.equal(x.staffNav.hidden,false);
 await x.change({uid:'participant',emailVerified:true});
 assert.equal(x.staffNav.hidden,true);assert.equal(x.publicNav.hidden,false);
 assert.equal(x.preview.hidden,true);
 assert.match(x.alert.children[0].textContent,/membutuhkan akses/);
 assert.equal(x.authCalls,1,'observer must only subscribe once');
});
test('previous async admin response cannot restore navigation after logout',async()=>{
 let respond;
 const pending=new Promise(resolve=>{respond=resolve;});
 const x=await harness({adminLookup:()=>pending});
 assert.equal(x.staffNav.hidden,true);
 await x.change(null);respond(true);await flush();await flush();
 assert.equal(x.staffNav.hidden,true);assert.equal(x.publicNav.hidden,false);
 assert.match(x.alert.children[0].textContent,/Sesi login belum tersedia/);
});
test('visibility returns trigger re-verification, and failed lookup hides staff UI',async()=>{
 let enabled=true;
 const x=await harness({adminLookup:async()=>{if(!enabled)throw Error('offline');return true;}});
 assert.equal(x.staffNav.hidden,false);enabled=false;await x.revisit();
 assert.equal(x.staffNav.hidden,true);assert.equal(x.publicNav.hidden,false);
 assert.match(x.alert.children[0].textContent,/Hak akses akun belum/);
});
test('Auth failure invalidates a previously privileged context',async()=>{
 const x=await harness({admin:true});await x.authError();
 assert.equal(x.staffNav.hidden,true);assert.equal(x.preview.hidden,true);
});
test('observer and admin-only permission helpers are imported/exported',()=>{
 assert.match(source,/\{ observeAuthChanges, isAdminUser, getCurrentAuthUser \}/);
 assert.match(authSource,/export const observeAuthChanges\s*=/);
 assert.match(authSource,/export const getCurrentAuthUser\s*=/);
 assert.doesNotMatch(source,/\bgetActiveStaffRoles\b|\bgetStaffDestination\b/);
});

// Rechecking the same Firebase user must not flash the anonymous navbar.
test('admin navbar stays stable during same-UID Firestore refresh and remains admin on success',async()=>{
 let delay=false, resolve;
 const x=await harness({from:'operations',adminLookup:()=>delay ? new Promise(done=>{resolve=done;}) : Promise.resolve(true)});
 assert.equal(x.staffNav.hidden,false);
 assert.equal(x.links['[data-nav-result]'].href,'results.html?from=operations');
 delay=true;
 x.document.events.visibilitychange();
 await flush();
 assert.equal(x.staffNav.hidden,false,'do not hide a previously verified same-UID navbar while pending');
 assert.equal(x.publicNav.hidden,true,'public navbar must not flash while role request is in flight');
 resolve(true);await flush();await flush();
 assert.equal(x.staffNav.hidden,false);
 assert.equal(x.publicNav.hidden,true);
});
test('member from dashboard keeps member nav and never sees admin destinations',async()=>{
 const x=await harness({from:'dashboard',admin:false});
 assert.equal(x.memberNav.hidden,false);
 assert.equal(x.staffNav.hidden,true);
 assert.equal(x.publicNav.hidden,true);
});
