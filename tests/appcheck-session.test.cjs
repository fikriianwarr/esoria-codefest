const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');

test('App Check dipasang sebelum layanan Firebase mulai dibuat', () => {
  const code = source('firebase-config.js');
  const init = code.indexOf('initializeAppCheck(app,');
  assert.ok(init > 0, 'App Check initialization missing');
  for (const service of ['getAuth(app)', 'getFirestore(app)', 'getStorage(app)', 'getFunctions(app,']) {
    const at = code.indexOf(service);
    assert.ok(at > init, `${service} initialized before App Check`);
  }
  assert.match(code, /ReCaptchaEnterpriseProvider/);
  assert.doesNotMatch(code, /FIREBASE_APPCHECK_DEBUG_TOKEN|ReCaptchaV3Provider/);
});

test('gagal membaca dokumen admin akibat App Check tidak dianggap logout atau akses ditolak', () => {
  const code = source('auth-core.js');
  assert.match(code, /if \(adminRequired\) \{\s*let allowed;\s*try \{\s*allowed = await isAdminUser\(user\);\s*\} catch \(error\) \{[\s\S]*?displayAuthFailure\(error\)/);
});

test('error autentikasi tidak menyembunyikan logout atau mengizinkan akses data pribadi', () => {
  const code = source('auth-core.js');
  assert.match(code, /gate\.setAttribute\('role', 'alertdialog'\)/);
  assert.match(code, /await signOut\(auth\)/);
  assert.match(code, /Kembali ke Beranda/);
  assert.match(code, /Keluar dari Akun/);
  assert.match(code, /return new Promise\(\(\) => \{\}\);/);
  const css = source('refinement.css');
  assert.match(css, /\.auth-error \.auth-gate\.auth-gate-failed/);
  assert.match(css, /z-index:9999/);
});
