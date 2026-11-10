import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {sameHtmlRelease} from '../scripts/release-html-integrity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = rel => readFileSync(new URL(rel, `file://${root}`), 'utf8');

test('hosting smoke compares exact deployed HTML, not only HTTP 200', () => {
  const code = read('scripts/verify-public-release.mjs');
  assert.match(code, /sameHtmlRelease\(content, source\)/);
  assert.match(code, /base\.origin === 'https:\/\/esoria-codefest\.web\.app'/);
  assert.match(code, /Periksa versi Hosting, cache, dan folder yang dideploy/);
  assert.match(code, /file:'admin\.html'|file:'dashboard\.html'/);
});

test('clean production release excludes historical import scripts and checks published HTML', () => {
  const code = read('scripts/verify-public-release.mjs');
  assert.match(code, /sameHtmlRelease\(content, source\)/);
  const launcher = read('DEPLOY_SEMUA.cmd');
  assert.match(launcher, /scripts\\live\\START_LIVE\.ps1/);
  assert.doesNotMatch(launcher, /START_LIVE_WITH_DATASET|seed-production/);
});

test('published HTML comparison detects a stale release but tolerates CRLF and BOM', () => {
  assert.ok(sameHtmlRelease('<html>new</html>', '<html>new</html>'));
  assert.ok(sameHtmlRelease('\uFEFF<html>one\r\ntwo</html>', '<html>one\ntwo</html>'));
  assert.equal(sameHtmlRelease('<html>OLD</html>', '<html>NEW</html>'), false);
  assert.equal(sameHtmlRelease('<html>homepage</html>', '<html>admin panel</html>'), false);
});

// End-to-end smoke verification against a local HTTP stand-in: it must reject
// stale but otherwise valid HTTP 200 HTML, not just broken status codes.
test('smoke verifier succeeds on matching HTML and rejects a stale HTTP 200 page', async () => {
  const {createServer} = await import('node:http');
  const {spawn} = await import('node:child_process');
  const {once} = await import('node:events');
  let stale = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/public') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ok:true,data:{published:false,issued:false}}));
      return;
    }
    const fileName = url.pathname === '/' ? 'index.html' :
      url.pathname === '/legal/' ? 'legal/index.html' : url.pathname.slice(1);
    const file = new URL(`../public/${fileName}`, import.meta.url);
    try {
      let html = readFileSync(file, 'utf8');
      if (stale && fileName === 'admin.html') html = html.replace('<html', '<html data-stale="true"');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    } catch {
      response.writeHead(404).end('Missing');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-public-release.mjs'], {
      cwd: root,
      env: {...process.env, ESORIA_SMOKE_ORIGIN: `http://127.0.0.1:${port}`, ESORIA_SMOKE_VERIFY_FILES:'1'},
      stdio: ['ignore','pipe','pipe'],
    });
    let output = '';
    for (const channel of [child.stdout, child.stderr]) channel.on('data', c => { output += c.toString(); });
    child.once('error', reject);
    child.once('close', code => resolve({code, output}));
  });
  try {
    const good = await run();
    assert.equal(good.code, 0, good.output);
    assert.match(good.output, /termasuk kecocokan source HTML Hosting/);
    stale = true;
    const bad = await run();
    assert.notEqual(bad.code, 0, bad.output);
    assert.match(bad.output, /HTML yang terbit tidak sama/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
