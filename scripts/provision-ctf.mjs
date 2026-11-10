import {argumentsFor,operatorGuard,operatorDatabase} from './operator-runtime.mjs';
import {flagDigest,millis,scopeFor,scheduleFor} from '../functions/domain.js';
const args=argumentsFor(),projectId=operatorGuard(args);
const {db,Timestamp}=operatorDatabase(projectId);
let stdin='';for await(const chunk of process.stdin){stdin+=chunk;if(stdin.length>1000000)throw new Error('Input terlalu besar.');}
let input;try{input=JSON.parse(stdin.replace(/^\uFEFF/,''));}catch{throw new Error('Input JSON CTF tidak valid. Isi rahasia tidak dicetak.');}
if(input.package!=='cyber'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodId||'')||!['wave-01','wave-02'].includes(input.wave))throw new Error('Lingkup CTF tidak valid.');
if(!Array.isArray(input.challenges)||!input.challenges.length||input.challenges.length>100)throw new Error('Isi 1–100 challenge resmi.');
const ids=input.challenges.map((item)=>item.id);
if(new Set(ids).size!==ids.length)throw new Error('ID challenge ganda.');
const scope=scopeFor(input),pepper=process.env.CTF_FLAG_PEPPER;
const records=input.challenges.map((item)=>{
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id||'')||typeof item.title!=='string'||!item.title.trim()||!Number.isInteger(item.points)||item.points<1||item.points>10000||typeof item.flag!=='string'||!item.flag.trim()||item.flag.length>500)throw new Error('Identitas, poin, atau flag challenge tidak valid.');
 return {id:item.id,title:item.title.trim().slice(0,150),points:item.points,digest:flagDigest(pepper,scope,item.id,item.flag),active:true,revision:1};
});
await db.runTransaction(async(tx)=>{
 const period=await tx.get(db.doc(`periods/${input.periodId}`));
 if(!period.exists)throw new Error('Periode harus ada sebelum konfigurasi CTF.');
 const startsAt=scheduleFor(period.data(),input).startsAt;
 if(!Number.isFinite(millis(startsAt))||Date.now()>=startsAt)throw new Error('Challenge hanya boleh dibuat sebelum kategori dimulai. Tidak mengubah flag saat lomba berjalan.');
 const refs=records.map((record)=>db.doc(`ctfSecrets/${scope}/challenges/${record.id}`));
 const existing=await Promise.all(refs.map((ref)=>tx.get(ref)));
 if(existing.some((doc)=>doc.exists))throw new Error('Challenge sudah ada. Skrip tidak menimpa jawaban atau data lama.');
 if(args.apply){records.forEach((record,index)=>tx.create(refs[index],{...record,createdAt:Timestamp.now()}));tx.set(db.collection('auditLogs').doc(),{action:'ctf.configuration_created',actorUid:'operator-tool',actorRole:'operator',targetType:'competition',targetId:scope,details:{challenges:records.length},createdAt:Timestamp.now()});}
});
console.log(JSON.stringify({projectId,mode:args.apply?'apply':'dry-run',scope,challenges:records.length,message:'Flag dan pepper tidak dicetak atau ditulis ke file.'}));
