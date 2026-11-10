import {readFileSync} from 'node:fs';
const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];
if(!args.includes('--project')||!project)throw new Error('Project wajib eksplisit.');
const cors=JSON.parse(readFileSync(new URL('../storage.cors.json',import.meta.url),'utf8'));
const expected=[`https://${project}.web.app`,`https://${project}.firebaseapp.com`];
if(!Array.isArray(cors)||!cors.length)throw new Error('CORS belum lengkap.');
for(const rule of cors){
 if(!Array.isArray(rule.origin)||!rule.origin.length||rule.origin.some((origin)=>!expected.includes(origin)))throw new Error('Origin CORS berbeda dari dua domain Firebase resmi project target. Tinjau konfigurasi sebelum perubahan CORS.');
 if(rule.method.some((method)=>!['GET','HEAD'].includes(method)))throw new Error('CORS upload tidak diperlukan; batasi GET dan HEAD sesuai alur privat source.');
}
console.log(`CORS lokal cocok dengan ${project}; belum diterapkan.`);
