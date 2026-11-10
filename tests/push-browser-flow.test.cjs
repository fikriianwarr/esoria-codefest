'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/push-notifications.js'),'utf8')
  .replace(/^import[\s\S]*?from '\S+';\s*/gm, '')
  .replace('export async function disablePushForCurrentUser', 'async function disablePushForCurrentUser');
function setup({ permission='default', blockedStorage=false }={}) {
  const events=[];
  const flags=new Map();
  const attrs=new Map();
  let click;
  const label={textContent:''};
  const button={
    disabled:false, title:'',
    querySelector:()=>label,
    setAttribute:(k,v)=>attrs.set(k,String(v)),
    classList:{toggle:()=>{}},
    addEventListener:(name,handler)=>{if(name==='click')click=handler}
  };
  const auth={currentUser:{uid:'participant-1'}};
  const notification={
    permission,
    requestPermission:()=>{events.push('permission-requested'); notification.permission='granted'; return Promise.resolve('granted')}
  };
  const context={
    console, currentSessionKey:()=>"test-device-key",
    Date,
    setTimeout, clearTimeout, Promise, Map, Boolean, String, Number,
    Notification:notification,
    CustomEvent:class {constructor(name,opts){this.name=name;this.detail=opts.detail}},
    window:{Notification:notification,isSecureContext:true,dispatchEvent:(evt)=>{events.push(['toast',evt.detail.message])}},
    navigator:{serviceWorker:{register:async()=>({active:true}),ready:Promise.resolve({active:true})}},
    localStorage:{
      getItem:(k)=>{if(blockedStorage)throw Error('storage disabled');return flags.get(k)??null},
      setItem:(k,v)=>{if(blockedStorage)throw Error('storage disabled');flags.set(k,v)},
      removeItem:(k)=>{if(blockedStorage)throw Error('storage disabled');flags.delete(k)}
    },
    document:{querySelector:(q)=>q==='[data-push-toggle]'?button:null},
    app:{}, auth, functions:{}, runtimeConfig:{appCheckSiteKey:'public-key',messagingVapidKey:'public-vapid-key'},
    httpsCallable:()=>async({action})=>{events.push(action);return {data:{ok:true}}},
    deleteToken:async()=>true, getMessaging:()=>({}), getToken:async()=>{events.push('get-token');return 'FCM_TOKEN'},
    isSupported:async()=>true, onMessage:()=>{},
    onAuthStateChanged:(a,callback)=>{callback(a.currentUser)}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{timeout:3000});
  return {events,click:()=>click(),label,attrs,notification,flags};
}

test('push Android: izin didahulukan sebelum token dan registrasi API', async()=>{
  const h=setup();
  await h.click();
  assert.deepEqual(h.events.filter(x=>typeof x==='string'),['permission-requested','get-token','registerPushToken']);
  assert.equal(h.label.textContent,'Nonaktifkan Push');
  assert.equal(h.attrs.get('aria-pressed'),'true');
});

test('push ketika izin ditolak tidak mencoba token atau registrasi dan memberi pesan', async()=>{
  const h=setup({permission:'denied'});
  await h.click();
  assert.equal(h.events.some(x=>x==='get-token'||x==='registerPushToken'),false);
  assert.equal(h.events.some(x=>Array.isArray(x)&&/Izin situs ESORIA diblokir/.test(x[1])),true);
  assert.equal(h.label.textContent,'Aktifkan Push');
});

test('push tidak gagal total jika localStorage diblokir browser', async()=>{
  const h=setup({blockedStorage:true});
  await h.click();
  assert.equal(h.events.includes('registerPushToken'),true);
  assert.equal(h.label.textContent,'Nonaktifkan Push');
});
