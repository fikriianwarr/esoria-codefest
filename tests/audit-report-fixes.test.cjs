const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Kebijakan pembayaran konsisten dengan Storage dan Firestore metadata', () => {
  const privacy = read('legal/privacy-policy.html');
  const payment = read('legal/payment-policy.html');
  assert.match(privacy, /Firebase Storage/);
  assert.match(payment, /Firebase Storage/);
  assert.match(payment, /Dokumen Firestore hanya menyimpan metadata dan jalur berkas/);
  assert.doesNotMatch(payment, /data terenkripsi dalam\s*dokumen Firestore/);
});

test('Signup menampilkan tautan kebijakan Google dan checkbox email', () => {
  const signup = read('signup.html');
  assert.match(signup, /class="auth-policy-notice"/);
  assert.match(signup, /legal\/privacy-policy\.html/);
  assert.match(signup, /legal\/terms-and-conditions\.html/);
  assert.match(signup, /class="auth-consent"/);
});

test('Status tutup tidak dibayangi tulisan OPEN permanen', () => {
  assert.doesNotMatch(read('styles.css'), /content:\s*"REG \/ OPEN"\s*!important/);
  assert.match(read('live-registration-status.js'), /Lihat jadwal lomba/);
  assert.match(read('live-registration-status.js'), /status\.state === 'open'/);
});

test('Naskah hadiah disunting tanpa frasa terpotong', () => {
  assert.doesNotMatch(read('index.html'), /hadiah sampai buat web/);
  assert.match(read('index.html'), /Hadiah untuk tiga pemenang terbaik/);
  assert.doesNotMatch(read('legal/event-rules.html'), /peserta atau tim peserta/);
});

test('Robot dan sitemap hanya untuk halaman publik yang dapat diindeks', () => {
  const robots = read('robots.txt');
  const site = read('sitemap.xml');
  assert.match(robots, /Sitemap: https:\/\/esoria-codefest\.web\.app\/sitemap\.xml/);
  assert.match(site, /<urlset/);
  assert.match(site, /https:\/\/esoria-codefest\.web\.app\/legal\/privacy-policy\.html/);
  assert.doesNotMatch(site, /\/admin\.html/);
  assert.doesNotMatch(site, /\/form-pendaftaran\.html/);
  assert.match(read('admin.html'), /noindex,nofollow/);
  assert.match(read('index.html'), /rel="canonical"/);
});

test('WebP lokal tersedia dan digunakan logo header; PNG OG tetap ada', () => {
  for (const name of ['assets/logo_esoria.webp', 'legal/assets/img/logo-esoria.webp']) {
    const buffer = fs.readFileSync(path.join(root, name));
    assert.ok(buffer.length > 0);
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  }
  assert.match(read('index.html'), /src="assets\/logo_esoria\.webp"/);
  assert.match(read('legal/index.html'), /src="assets\/img\/logo-esoria\.webp"/);
  assert.ok(fs.existsSync(path.join(root,'assets/logo_esoria.png')));
});

test('kotak alur login yang diminta pengguna sudah dihapus beserta CSS khususnya', () => {
  const login = read('login.html');
  assert.doesNotMatch(login, /auth-story-flow|class="auth-security-note"/);
  assert.doesNotMatch(read('auth-mfa.css'), /auth-story-flow/);
  assert.doesNotMatch(read('styles.css'), /auth-story-flow/);
  assert.match(login, /id="auth-form"/);
  assert.match(login, /id="auth-mfa-panel"/);
});

test('Menu notifikasi memiliki tiga titik rapat di dalam area sentuh', () => {
  const notifications = read('notification-center.js');
  const css = read('notification-center.css');
  assert.match(notifications, /aria-label="Menu notifikasi"/);
  assert.match(notifications, /class="ec-notification-dots"/);
  assert.match(notifications, /class="ec-notification-dots"><span><\/span><span><\/span><span><\/span>/);
  assert.match(css, /\.ec-notification-dots\s*\{[^}]*gap: 6px/s);
  assert.match(css, /\.ec-notification-item-controls > button\s*\{[^}]*width: 40px/s);
});

test('Pesan pembayaran tidak membocorkan nama layanan penyimpanan internal', () => {
  const registration = read('registration.js');
  assert.match(registration, /Screenshot valid dan siap disimpan dengan aman/);
  assert.match(registration, /Mengunggah bukti transfer melalui koneksi aman/);
  assert.doesNotMatch(registration, /Screenshot valid dan siap disimpan pada Firestore/);
});
