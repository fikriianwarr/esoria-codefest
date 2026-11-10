import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, unlinkSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, delimiter} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chooseEmulatorPorts} from './emulator-ports.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const secret = fileURLToPath(new URL('../functions/.secret.local', import.meta.url));
// Keep a copy of firebase.json beside the original so relative Rules/Functions
// paths resolve as usual. Only emulators in this temporary demo config change.
const runtimeConfig = fileURLToPath(new URL(`../.esoria-emulator-${process.pid}-${randomUUID()}.json`, import.meta.url));
let secretCreated = false;
let configCreated = false;
try {
  // Never overwrite a real operator secret. Reuse our own emulator-only fixture if a
  // previous interrupted run left it behind; clean up only a file we created here.
  const emulatorSecret = 'CTF_FLAG_PEPPER=emulator-only-esoria-pepper-00000000000000\n';
  if (existsSync(secret)) {
    if (readFileSync(secret, 'utf8') !== emulatorSecret) {
      throw new Error('functions/.secret.local sudah berisi secret lain. Jalankan pengujian pada folder terpisah; tidak ada secret yang ditimpa.');
    }
  } else {
    writeFileSync(secret, emulatorSecret, {mode: 0o600, flag: 'wx'});
    secretCreated = true;
  }
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  config.emulators = await chooseEmulatorPorts(config.emulators);
  writeFileSync(runtimeConfig, JSON.stringify(config, null, 2), {mode: 0o600, flag: 'wx'});
  configCreated = true;
  const cli = fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));
  const direct = process.argv.includes('--direct-handlers');
  const services = direct ? 'auth,firestore,storage' : 'auth,firestore,storage,functions';
  const emulatorEnv = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
    ENFORCE_APP_CHECK: 'false',
    GCLOUD_PROJECT: 'demo-esoria-codefest',
    SITE_ORIGIN: 'https://example.org',
    FIREBASE_CONFIG: JSON.stringify({projectId: 'demo-esoria-codefest', storageBucket: 'demo-esoria-codefest.appspot.com'}),
    ESORIA_HANDLER_TEST_MODE: direct ? 'direct' : 'http',
    ESORIA_TEST_FUNCTIONS_HOST: `127.0.0.1:${config.emulators.functions.port}`,
    CTF_FLAG_PEPPER: 'emulator-only-esoria-pepper-00000000000000',
    ...(direct ? {FUNCTIONS_EMULATOR: 'true'} : {}),
  };
  // Local transport opt-in affects the demo subprocess only.
  if (process.argv.includes('--local-transport')) {
    for (const key of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy']) delete emulatorEnv[key];
  }
  const command = 'node --test --test-concurrency=1 tests/emulator/*.test.mjs';
  const result = spawnSync(process.execPath, [cli, 'emulators:exec', '--config', runtimeConfig, '--project', 'demo-esoria-codefest', '--only', services, command], {cwd: root, stdio: 'inherit', env: emulatorEnv});
  process.exitCode = result.status ?? 1;
} finally {
  if (configCreated) unlinkSync(runtimeConfig);
  if (secretCreated) unlinkSync(secret);
}
