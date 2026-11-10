import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];
if(!args.includes('--project')||!project)throw new Error('Project wajib eksplisit.');
const context={globalThis:{}};
vm.runInNewContext(readFileSync(new URL('../public/runtime-config.js',import.meta.url),'utf8'),context,{timeout:1000});
const runtime=context.globalThis.ESORIA_RUNTIME_CONFIG;
if(runtime.firebase) {
  if(runtime.firebase.projectId!==project)throw new Error('Bucket berbeda dari project target.');
  if(![`${project}.firebasestorage.app`,`${project}.appspot.com`].includes(runtime.firebase.storageBucket))throw new Error('Bucket berbeda dari default project target.');
  console.log(runtime.firebase.storageBucket);
} else {
  if(project!=='esoria-codefest')throw new Error('Konfigurasi staging belum dibuat.');
  console.log('esoria-codefest.firebasestorage.app');
}
