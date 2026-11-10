import {test,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {getDoc,doc} from 'firebase/firestore';
import {db,projectId} from './helpers.mjs';
const env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile(new URL('../../firestore.rules.mfa-enforced',import.meta.url),'utf8')},storage:{rules:await readFile(new URL('../../storage.rules.mfa-enforced',import.meta.url),'utf8')}});
after(()=>env.cleanup());
const strictAuthTime = Math.floor(Date.now()/1000);
await db.doc('admins/strict_admin').set({active:true});await db.doc('users/strict_target').set({role:'participant',archived:false});
await db.doc('accountSessions/strict_admin').set({authTime:strictAuthTime,sessionHash:'a'.repeat(64)});
test('strict MFA Rules reject active admin without second factor and reject stale MFA claims after revocation',async()=>{
 const noMfa=env.authenticatedContext('strict_admin',{email_verified:true,admin:true,auth_time:strictAuthTime});
 const mfa=env.authenticatedContext('strict_admin',{email_verified:true,admin:true,auth_time:strictAuthTime,firebase:{sign_in_second_factor:'totp'}});
 await assertFails(getDoc(doc(noMfa.firestore(),'users/strict_target')));
 await assertSucceeds(getDoc(doc(mfa.firestore(),'users/strict_target')));
 await db.doc('admins/strict_admin').update({active:false});
 await assertFails(getDoc(doc(mfa.firestore(),'users/strict_target')));
});
