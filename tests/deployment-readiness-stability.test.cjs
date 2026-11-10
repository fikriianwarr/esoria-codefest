'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
test('full deployment cannot bypass tests or Firebase Emulator and has no Y/N prompts',()=>{
 const launcher=read('scripts/live/START_LIVE.ps1');
 const deploy=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
 assert.match(launcher,/DEPLOY_FULL_FIREBASE\.ps1/);
 assert.doesNotMatch(launcher,/seed-production\.mjs/);
 assert.match(deploy,/Tes regresi, unit dan alur penilaian admin/);
 assert.match(deploy,/Tes emulator keamanan dan alur Admin\/Member/);
 assert.doesNotMatch(deploy,/hosting:clone/);
 assert.match(deploy,/--non-interactive/);
 assert.doesNotMatch(deploy,/scripts\/predeploy-backup\.ps1/);
 assert.ok(deploy.indexOf('Tes emulator keamanan')<deploy.indexOf('Publish Firestore Rules'));
 assert.doesNotMatch(launcher,/Confirm-ESORIAYesNo|Read-Host/);
});
test('new public function deployed and checked before Hosting, without forced data deletion',()=>{
 const deploy=read('scripts/DEPLOY_FULL_FIREBASE.ps1');
 assert.match(deploy,/functions:esoriaPublic/);
 assert.match(deploy,/esoriaPublic belum ACTIVE/);
 assert.doesNotMatch(deploy,/['"]--force['"]|['"]firestore['"],\s*['"]delete|database:remove/i);
});
