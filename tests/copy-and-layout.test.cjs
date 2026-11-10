const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('pengingat pembayaran tim melebar sesuai kontainer dan lebih ringkas', () => {
  const ticket = read('tickets/tiket-tim-digital.html');
  const css = read('styles.css');
  assert.match(ticket, /Sebelum mengirim pendaftaran, pastikan nama tim, daftar anggota, nominal, dan tanggal transfer sudah benar\./);
  assert.match(css, /\.ticket-detail-body \.detail-payment-v18 > p\.payment-security-note \{[\s\S]*?width:\s*100%\s*!important;[\s\S]*?max-width:\s*none\s*!important;[\s\S]*?padding:\s*11px 16px\s*!important;/);
  assert.doesNotMatch(ticket, /Ketua tim wajib memastikan nama tim, daftar anggota, nominal, dan tanggal pembayaran sudah benar sebelum form dikirim/);
});

test('konfirmasi keluar menjelaskan konteks tanpa frasa teknis yang tidak perlu', () => {
  const js = read('logout-controller.js');
  assert.match(js, /onRegistration[\s\S]*?isian yang belum dikirim tetap ada di perangkat ini/);
  assert.match(js, /onAdmin[\s\S]*?panel admin/);
  assert.match(js, /melihat profil, pendaftaran, dan tiket/);
  assert.doesNotMatch(js, /data yang dilindungi/);
});

test('label profil dan dashboard admin menggunakan bahasa yang lebih mudah dipahami', () => {
  const profile = read('profil.html') + read('profile.js');
  const admin = read('admin.html');
  assert.match(profile, /Ajukan Perubahan/);
  assert.ok(/id="profile-edit"/.test(profile), 'Tombol permintaan perubahan profil harus tersedia');
  assert.ok(/Ajukan Perubahan/.test(profile), 'Status profil terkunci harus menyediakan aksi permintaan perubahan');
  assert.ok(/persetujuan panitia/.test(profile), 'Penjelasan perubahan harus menyatakan perlunya persetujuan panitia');
  assert.match(admin, /DAFTAR PESERTA/);
  assert.match(admin, /PENINJAUAN BEBERAPA PENDAFTARAN/);
});
