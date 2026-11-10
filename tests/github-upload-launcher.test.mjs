import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read = relative => readFileSync(new URL('../'+relative,import.meta.url),'utf8');

test('GitHub and Firebase launchers remain separate',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.deepEqual(readdirSync(root).filter(f=>f.toLowerCase().endsWith('.cmd')).sort(),['DEPLOY_SEMUA.cmd','upload.cmd']);
  const cmd=read('upload.cmd');
  assert.match(cmd,/scripts\\github-upload\.ps1/);
  assert.match(cmd,/set \/p "ESORIA_UPLOAD_EXIT=Tekan Enter/i);
  assert.match(cmd,/PUBLIC/i);
  assert.doesNotMatch(cmd,/DEPLOY_SEMUA\.cmd|firebase deploy|--force/i);
});

test('fix: check list of remotes before origin get-url',()=>{
  const ps=read('scripts/github-upload.ps1');
  assert.match(ps,/& \$Git remote/);
  assert.match(ps,/\$remoteNames -contains 'origin'/);
  assert.match(ps,/remote','add','origin'/);
  assert.match(ps,/Get-OptionalOutput/);
  assert.ok(ps.indexOf("$remoteNames -contains 'origin'") < ps.indexOf("'remote','get-url','origin'"));
});

test('public repo setup handles history and keeps non-force push',()=>{
  const ps=read('scripts/github-upload.ps1');
  assert.match(ps,/fikriianwarr\/esoria-codefest/);
  assert.match(ps,/repo','create',\$Target,'--public'/);
  assert.match(ps,/repo','edit',\$Target,'--visibility','public','--accept-visibility-change-consequences'/);
  assert.match(ps,/--json','visibility','--jq','\.visibility'/);
  assert.match(ps,/ls-remote','--heads','origin'/);
  assert.match(ps,/reset','--mixed','FETCH_HEAD'/);
  assert.match(ps,/add','--ignore-removal'/);
  assert.match(ps,/restore','--worktree'/);
  assert.match(ps,/push','-u','origin',\$TargetBranch/);
  const executable=ps.replace(/<#[\s\S]*?#>/g,'').replace(/^\s*#.*$/gm,'');
  assert.doesNotMatch(executable,/push[\s\S]{0,30}--force|reset','--hard|repo','delete|firebase deploy/i);
});

test('gitignore protects env settings, example remains available',()=>{
  const ignore=read('.gitignore');
  assert.match(ignore,/\*\*\/\.env\.\*/);
  assert.match(ignore,/!\*\*\/\.env\.example/);
  assert.match(ignore,/\*\*\/\.secret\.\*/);
  assert.match(read('functions/.env.example'),/ENFORCE_APP_CHECK/);
});
