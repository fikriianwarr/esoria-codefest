'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('MFA: panel paper dan tidak menyisakan ruang reCAPTCHA yang kosong', () => {
  const css = read('public/auth-mfa.css');
  const js = read('public/auth-mfa.js');
  assert.match(css, /#f4ead4/);
  assert.match(css, /auth-mfa-recaptcha:empty\s*\{\s*display:\s*none/);
  assert.match(css, /auth-mfa-panel\[hidden\]/);
  assert.match(js, /captchaContainer\.style\.minHeight\s*=\s*'0px'/);
  assert.match(js, /activeResolver\.resolveSignIn\(assertion\)/);
});

test('Legal: 10 halaman menggunakan CSS terbaru dan menu compact di kanan', () => {
  const dir = path.join(root, 'public/legal');
  const pages = fs.readdirSync(dir).filter(p => p.endsWith('.html'));
  assert.equal(pages.length, 10);
  for (const p of pages) assert.match(fs.readFileSync(path.join(dir,p),'utf8'), /legal-paper\.css\?v=[a-f0-9]{16}/);
  const css = read('public/legal/assets/css/legal-paper.css');
  assert.match(css, /width:\s*min\(252px,\s*calc\(100vw - 43px\)\)/);
  assert.match(css, /right:\s*0;/);
});

test('CSP: kebijakan dasar ketat dan endpoint analitik legal tersedia', () => {
  const config = JSON.parse(read('firebase.json'));
  const hdr = config.hosting.headers[0].headers;
  const policy = hdr.find(h=>h.key==='Content-Security-Policy')?.value;
  assert.ok(policy);
  for(const token of ["script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", 'https://apis.google.com', 'https://www.googletagmanager.com']) assert.ok(policy.includes(token), token);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});

test('Google login: mobile redirect hanya ketika host dan OAuth telah disiapkan', () => {
  const js=read('public/auth-pages.js');
  assert.match(js, /googleRedirectReady\s*===\s*true/);
  assert.match(js, /auth\.app\.options\.authDomain\s*===\s*window\.location\.hostname/);
  assert.match(js, /getRedirectResult\(auth\)/);
  assert.match(js, /signInWithRedirect\(auth, provider\)/);
  assert.match(js, /signInWithPopup\(auth, provider\)/);
  const config=read('public/runtime-config.js');
  assert.match(config, /googleRedirectReady:\s*false/);
});

test('Keamanan: rules tetap terpasang, hardening MFA tidak aktif tanpa migrasi', () => {
  const config = JSON.parse(read('firebase.json'));
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.equal(config.storage.rules, 'storage.rules');
  const env=read('functions/.env.esoria-codefest');
  assert.match(env,/REQUIRE_ADMIN_MFA=false/);
});
