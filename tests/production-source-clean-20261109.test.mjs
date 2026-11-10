import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const read = p => readFileSync(join(root,p),'utf8');
test('production ZIP has no historical participant database or import logic',()=>{
 for(const rel of ['demo','scripts/demo','scripts/live/seed-production.mjs','scripts/live/import-policy.mjs',
    'scripts/live/START_LIVE_WITH_DATASET.ps1','firebase.demo.json'])
  assert.equal(existsSync(join(root,rel)),false,rel);
 assert.deepEqual(readdirSync(root).filter(x=>x.endsWith('.cmd')).sort(),['DEPLOY_SEMUA.cmd','upload.cmd']);
});
test('one-click launcher uses one noninteractive full deploy, not data deletion',()=>{
 const cmd=read('DEPLOY_SEMUA.cmd'), live=read('scripts/live/START_LIVE.ps1'),deploy=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
 assert.match(cmd,/scripts\\live\\START_LIVE\.ps1/);
 assert.match(live,/DEPLOY_FULL_FIREBASE\.ps1/);
 assert.doesNotMatch(live,/Confirm-ESORIAYesNo|Read-Host|seed-production/);
 assert.doesNotMatch(deploy,/Confirm-ESORIAYesNo|Read-Host/);
 assert.match(deploy,/--non-interactive/);
 assert.doesNotMatch(deploy,/(['"])--force\1|firestore:delete|auth:delete/i);
 assert.match(deploy,/Tes emulator keamanan/);
});
test('backend still protects real results, certificates, and private database',()=>{
 assert.match(read('functions/domain.js'),/result\?\.demoFixture !== true/);
 assert.match(read('functions/competition.js'),/officiallyReleased/);
 assert.match(read('firestore.rules'),/allow read, write: if false/);
 assert.match(read('storage.rules'),/allow read, write: if false/);
});
