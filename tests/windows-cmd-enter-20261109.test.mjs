import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const cmd=readFileSync(new URL('../DEPLOY_SEMUA.cmd',import.meta.url),'utf8');
const live=readFileSync(new URL('../scripts/live/START_LIVE.ps1',import.meta.url),'utf8');
test('launcher has no legacy database/Y-N banner or menu',()=>{
 assert.doesNotMatch(cmd,/Database live\s*:|Konfirmasi Y\/N\s*:/i);
 assert.doesNotMatch(cmd,/choice\s+\/c|pause\s*>?nul/i);
 assert.match(cmd,/scripts\\live\\START_LIVE\.ps1/);
});
test('every launcher exit (including prerequisites and deployment success) waits for Enter',()=>{
 assert.match(cmd,/if not exist[\s\S]*?goto :finish/i);
 assert.match(cmd,/if errorlevel 1[\s\S]*?goto :finish/i);
 assert.match(cmd,/set "RESULT=%ERRORLEVEL%"/i);
 assert.match(cmd,/:finish\s+echo\.\s+set \/p "ESORIA_CLOSE=Tekan Enter[^\n]+\s+exit \/b %RESULT%/i);
 assert.equal((cmd.match(/exit \/b/gi)||[]).length,1);
});
test('production deploy keeps preflight, private auth, Firestore and Storage boundaries',()=>{
 assert.match(live,/Ensure-CloudCredentials/);
 assert.match(live,/scripts\/live\/sync-admin\.mjs/);
 assert.match(live,/scripts\/DEPLOY_FULL_FIREBASE\.ps1/);
 assert.doesNotMatch(live,/Confirm-ESORIAYesNo|Read-Host/);
});
