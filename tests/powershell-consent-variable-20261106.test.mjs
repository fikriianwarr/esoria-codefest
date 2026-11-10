import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

function listPowerShell(folder) {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? listPowerShell(relative) : entry.name.endsWith('.ps1') ? [relative] : [];
  });
}

test('one-click production release has no deployment prompts', () => {
  const launcher = read('scripts/live/START_LIVE.ps1');
  const deploy = read('scripts/DEPLOY_FULL_FIREBASE.ps1');
  for (const code of [launcher, deploy]) {
    assert.doesNotMatch(code,/Confirm-ESORIAYesNo|Read-Host/);
  }
  assert.match(deploy,/--non-interactive/);
});

test('no PowerShell script interpolates an unbraced variable immediately before a question mark', () => {
  for (const path of listPowerShell('scripts')) {
    const source = read(path);
    assert.doesNotMatch(source, /\$[A-Za-z_][A-Za-z0-9_]*\?/, `Unsafe PowerShell interpolation in ${path}`);
  }
});
