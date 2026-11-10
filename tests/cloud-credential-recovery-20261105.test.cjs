'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ps=read('scripts/live/START_LIVE.ps1');
test('Launcher validates a real gcloud token instead of relying on active-account listing',()=>{
 assert.match(ps,/function Invoke-GcloudCaptured/);
 assert.match(ps,/auth','print-access-token'/);
 assert.match(ps,/if \(\[string\]::IsNullOrWhiteSpace\(\$account\) -or -not \$token\.Ok/);
 assert.match(ps,/Renew-GcloudLogin -PreviousAccount \$account/);
});
test('Expired CLI credentials reauthenticate in browser and recheck project read-only',()=>{
 assert.match(ps,/auth login \$PreviousAccount '--force'/);
 assert.match(ps,/projects','describe',\$Project/);
 assert.match(ps,/invalid_grant\|expired or revoked/);
 assert.ok(ps.indexOf('Ensure-CloudCredentials\n')<ps.indexOf("'scripts/DEPLOY_FULL_FIREBASE.ps1'"));
});
test('ADC is recovered separately and never prints its access token',()=>{
 assert.match(ps,/auth','application-default','print-access-token'/);
 assert.match(ps,/function Renew-GcloudAdc/);
 assert.match(ps,/gcloud auth application-default login/);
 assert.match(ps,/GOOGLE_APPLICATION_CREDENTIALS/);
 assert.doesNotMatch(ps,/Write-Host.*\$adc\.Output|Write-Host.*\$token\.Output/);
});
test('Recovery never wipes credentials and full deploy has no manual Y/N prompts',()=>{
 assert.doesNotMatch(ps,/auth revoke|application-default revoke|Remove-Item.*gcloud|Remove-Item.*credentials/i);
 assert.doesNotMatch(ps,/Confirm-ESORIAYesNo|Read-Host/);
 assert.doesNotMatch(ps,/IMPORT DATA LATIHAN/);
 assert.match(ps,/AKTIFKAN ADMIN/);
 const cmd=read('DEPLOY_SEMUA.cmd');
 assert.match(cmd,/scripts\\live\\START_LIVE\.ps1/);
 assert.deepEqual(fs.readdirSync(root).filter(x=>x.endsWith('.cmd')).sort(),['DEPLOY_SEMUA.cmd','upload.cmd']);
});
