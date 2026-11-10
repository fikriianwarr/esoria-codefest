const test = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:net');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

function occupiedServer() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('occupied Firestore port selects an unused port, without modifying firebase.json', async () => {
  const {chooseEmulatorPorts} = await import('../scripts/emulator-ports.mjs');
  const server = await occupiedServer();
  const original = readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8');
  const port = server.address().port;
  try {
    const defaults = {auth: {host:'127.0.0.1', port:9099}, firestore: {host:'127.0.0.1', port}, storage:{host:'127.0.0.1',port:9199}, functions:{host:'127.0.0.1',port:5001}, ui:{enabled:false}};
    const selected = await chooseEmulatorPorts(defaults);
    assert.notEqual(selected.firestore.port, port);
    assert.equal(selected.firestore.host, '127.0.0.1');
    assert.equal(defaults.firestore.port, port);
    assert.equal(readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8'), original);
    assert.equal(new Set(['auth','firestore','storage','functions','hub','logging'].map(k => selected[k].port)).size,6);
    assert.deepEqual(selected.ui,{enabled:false});
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('runner passes isolated temp config to Firebase CLI and cleans local-only secrets', () => {
  const src = readFileSync(join(__dirname,'..','scripts','run-emulators.mjs'),'utf8');
  assert.match(src, /'emulators:exec', '--config', runtimeConfig, '--project', 'demo-esoria-codefest'/);
  assert.match(src, /ESORIA_TEST_FUNCTIONS_HOST/);
  assert.match(src, /if \(configCreated\) unlinkSync\(runtimeConfig\)/);
  assert.match(src, /if \(secretCreated\) unlinkSync\(secret\)/);
  assert.match(src, /flag: 'wx'/);
  const helper = readFileSync(join(__dirname,'emulator','helpers.mjs'),'utf8');
  assert.match(helper, /Only local Functions Emulator is allowed/);
});


test('runner actually selects alternate port and removes temp config in a stubbed Firebase CLI', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const {spawnSync} = require('node:child_process');
  const temp = fs.mkdtempSync(join(os.tmpdir(),'esoria-port-test-'));
  const server = await occupiedServer();
  try {
    for (const rel of ['scripts','functions','node_modules/firebase-tools/lib/bin']) fs.mkdirSync(join(temp,rel),{recursive:true});
    for (const rel of ['scripts/run-emulators.mjs','scripts/emulator-ports.mjs']) fs.copyFileSync(join(__dirname,'..',rel),join(temp,rel));
    fs.writeFileSync(join(temp,'package.json'),JSON.stringify({type:'module'}));
    const config = {emulators: {auth:{host:'127.0.0.1',port:9099},firestore:{host:'127.0.0.1',port:server.address().port},storage:{host:'127.0.0.1',port:9199},functions:{host:'127.0.0.1',port:5001},ui:{enabled:false}}};
    fs.writeFileSync(join(temp,'firebase.json'), JSON.stringify(config));
    fs.writeFileSync(join(temp,'node_modules/firebase-tools/lib/bin/firebase.js'), `import {readFileSync} from 'node:fs'; const args=process.argv; const c=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8')); if(c.emulators.firestore.port===${server.address().port}) process.exit(51); if(process.env.ESORIA_TEST_FUNCTIONS_HOST!=='127.0.0.1:'+c.emulators.functions.port) process.exit(52); console.log('STUB_EMULATOR_OK');`);
    const result=spawnSync(process.execPath,['scripts/run-emulators.mjs'],{cwd:temp,encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.match(result.stdout,/STUB_EMULATOR_OK/);
    assert.equal(fs.existsSync(join(temp,'functions/.secret.local')),false);
    assert.equal(fs.readdirSync(temp).some(name=>name.startsWith('.esoria-emulator-')),false);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(temp,'firebase.json'),'utf8')),config);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
