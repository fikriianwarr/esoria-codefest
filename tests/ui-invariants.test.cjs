const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../public');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('logout tersedia mandiri di semua halaman dengan tombol keluar', () => {
  for (const page of ['index.html','admin.html','profil.html','form-pendaftaran.html','verify-email.html']) {
    assert.match(read(page), /logout-controller\.js\?v=/, `${page} missing logout controller`);
    assert.match(read(page), /paper-confirm\.css\?v=/, `${page} missing confirmation styles`);
  }
  const controller = read('logout-controller.js');
  assert.match(controller, /await signOut\(auth\)/);
  assert.match(controller, /esoria:logout-approved/);
  assert.match(controller, /paperConfirm/);
  assert.doesNotMatch(read('profile.js'), /#profile-logout'\)\?\.addEventListener/);
  assert.doesNotMatch(read('admin.js'), /#admin-logout'\)\.addEventListener/);
});

test('gelombang dinonaktifkan sejak awal sebelum jadwal Firebase selesai diambil', () => {
  const html = read('form-pendaftaran.html');
  assert.match(html, /aria-disabled="true" disabled data-label="Wave Awal Bulan/);
  assert.match(html, /aria-disabled="true" disabled data-label="Wave Pertengahan Bulan/);
  const js = read('registration.js');
  assert.match(js, /option\.disabled = !available/);
  assert.match(js, /if \(waveSelect\.value && \(!selectedOption \|\| selectedOption\.disabled\)\)/);
  assert.match(js, /if \(!input \|\| !trigger \|\| !label \|\| !option \|\| option\.disabled\) return/);
});

test('navigasi awal tidak mengklaim peserta sudah logout dan tidak menyembunyikan kegagalan App Check', () => {
  const landing = read('index.html');
  assert.match(landing, /data-auth-state="checking"/);
  assert.match(read('site-auth.js'), /SESI BELUM TERVERIFIKASI/);
  assert.match(read('auth-core.js'), /appCheck\/throttled/);
  assert.match(read('app-loader.js'), /Firebase App Check sedang gagal/);
});

test('cookie dialog langsung muncul pada kunjungan tanpa preferensi', () => {
  const cookie = read('cookie-consent.js');
  assert.match(cookie, /if \(!preferences\) openPanel\(\);/);
  assert.doesNotMatch(cookie, /setTimeout\(\(\) => openPanel\(\), 520\)/);
});

test('navbar keamanan berada di header dan kartu status redundan dihapus', () => {
  const admin = read('admin.html');
  assert.match(admin, /id="admin-security-open"/);
  assert.doesNotMatch(admin, /class="admin-system-ribbon"/);
  assert.match(admin, /refinement\.css/);
});


test('judul legal refund tidak memotong kata di tengah dan mengikuti ukuran layar', () => {
  const page = read('legal/refund-policy.html');
  const css = read('legal/assets/css/legal-paper.css');
  assert.match(page, /class="article paper-shell refund-policy-article"/);
  assert.match(css, /\.article\.refund-policy-article > h1[\s\S]*?overflow-wrap:\s*normal/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.article\.refund-policy-article > h1/);
});

test('badge permintaan admin berada dalam tab dan hilang ketika jumlah nol', () => {
  const admin = read('admin.html');
  const css = read('refinement.css');
  const js = read('admin.js');
  assert.match(admin, /title="Permintaan Edit Profil"/);
  assert.match(css, /#admin-request-tab-count\s*\{[\s\S]*?top:\s*5px/);
  assert.match(js, /requestBadge\.hidden = state\.metrics\.editRequests <= 0/);
});

test('placeholder nomor telepon terbaca dan kotak catatan login sudah dihapus', () => {
  const css = read('refinement.css');
  const admin = read('admin.html');
  const login = read('login.html');
  assert.match(admin, /placeholder="\+628123456789"/);
  assert.doesNotMatch(admin, /placeholder="Contoh: \+628123456789"/);
  assert.match(css, /\.admin-body \.admin-mfa-fields input:disabled::placeholder/);
  assert.match(css, /\.auth-body \.auth-security-note/);
  assert.match(read('esoria-ui-final.css'), /\.auth-body \.auth-security-note strong/);
  assert.doesNotMatch(login, /<span>AKSES AKUN<\/span>|Gunakan satu akun peserta resmi\./);
});

test('panel sesi aktif lama tidak tampil, login tetap menampilkan status dan menangani error', () => {
  const login = read('login.html');
  const signup = read('signup.html');
  const code = read('auth-pages.js');
  for (const page of [login, signup]) {
    assert.doesNotMatch(page, /id="auth-session"|id="session-continue"|id="session-switch"|id="session-feedback"/);
    assert.match(page, /id="auth-alert"/);
  }
  assert.match(login, /id="google-auth"/);
  assert.match(login, /id="auth-form"/);
  assert.ok(/data-module="\.\/auth-pages\.js\?v=[^"]+"/.test(login), "Halaman login wajib memuat modul autentikasi versi aktif");
  assert.match(code, /if \(authActionBusy\) return;/);
  assert.match(code, /stopRapidRetries\(\);/);
  assert.match(code, /const displayActionError = \(error\) =>/);
  assert.match(code, /setAlert\(message\);/);
  assert.match(code, /const setBusy = \(busy, message\) =>/);
  assert.match(code, /googleButton\?\.addEventListener\('click'/);
  assert.match(code, /form\?\.addEventListener\('submit'/);
  assert.doesNotMatch(code, /getToken as getAppCheckToken/);
  assert.doesNotMatch(code, /setSessionBusy|setSessionFeedback|sessionContinue|sessionSwitch/);
});

test('favicon identik di semua halaman, dan file verifikasi tetap tidak berubah', () => {
  const names=[];
  const root=path.resolve(__dirname,'../public');
  const visit=(folder) => {
    for (const file of fs.readdirSync(folder,{withFileTypes:true})) {
      const full=path.join(folder,file.name);
      if(file.isDirectory()) visit(full);
      else if(file.name.endsWith('.html') && !file.name.startsWith('google810f4dbeac957730')) names.push(full);
    }
  };
  visit(root);
  for (const full of names) assert.match(fs.readFileSync(full,'utf8'), /href="\/assets\/favicon.svg\?v=20261015-r7"/, `${full} favicon tidak sama`);
  assert.match(read('google810f4dbeac957730.html'), /google-site-verification/);
});
