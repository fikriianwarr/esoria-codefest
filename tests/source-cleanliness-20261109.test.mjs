import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(join(root,path),'utf8');

test('production archive source contains no persistent logs or editor temp files',()=>{
  const files=[];
  function collect(dir){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(['node_modules','.git','.firebase'].includes(entry.name))continue;
      const f=join(dir,entry.name);
      if(entry.isDirectory())collect(f);
      else files.push(f);
    }
  }
  collect(root);
  assert.equal(files.filter(f=>/\.(?:log|tmp|bak|orig|swp|swo)(?:\..*)?$/i.test(f)).length,0);
});

test('deployment does not write a transcript unless explicitly opted in',()=>{
  const source=read('scripts/live/START_LIVE.ps1');
  assert.match(source,/GetEnvironmentVariable\('ESORIA_SAVE_DEPLOY_LOG','Process'\) -eq '1'\) \{[\s\S]*?Start-Transcript/);
  assert.match(source,/if \(\$locationPushed\) \{ Pop-Location \}/);
  assert.match(source,/firebase\|firestore\|database\|pubsub\|ui/);
  const cmd=read('DEPLOY_SEMUA.cmd');
  assert.doesNotMatch(cmd,/Lihat deploy-last\.log|Cek situs dan deploy-last\.log/);
  assert.match(cmd,/set \/p "ESORIA_CLOSE=/i);
  assert.match(cmd,/exit \/b %RESULT%/i);
});

test('project checker validates CSS @import as well as url() assets',()=>{
  const checker=read('scripts/check-project.mjs');
  assert.match(checker,/@import/);
  assert.match(checker,/checkReference\(file, match\[2\]\.trim\(\)\)/);
});

test('unused animation definitions have been removed without replacing shared styles',()=>{
  assert.doesNotMatch(read('public/styles.css'),/@keyframes stampBreathe/);
  assert.doesNotMatch(read('public/legal/assets/css/legal-paper.css'),/@keyframes menuIn/);
  assert.match(read('public/styles.css'),/\.form-field/);
});

test('npm lockfile matches manifest and avoids duplicate Node.js runtime downloads',()=>{
  const manifest=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.deepEqual(lock.packages[''].devDependencies,manifest.devDependencies);
  assert.deepEqual(lock.packages[''].dependencies ?? {},manifest.dependencies ?? {});
  assert.equal(manifest.engines.node,'22.x');
  assert.ok(!('node' in manifest.devDependencies));
  assert.ok(!('node_modules/node' in lock.packages));
  assert.ok(!('node_modules/node-bin-setup' in lock.packages));
});
