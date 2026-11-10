const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const project = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(project, file), 'utf8');
const profile = read('public/profile.js');
const form = read('public/profil.html');
const style = read('public/esoria-workspace-dossier.css');
test('pilihan provinsi mencakup 38 provinsi tanpa duplikasi kode', () => {
  const data = profile.match(/const provinces = \[([\s\S]+?)\n\];/);
  assert.ok(data, 'tabel provinsi tersedia');
  const provinces = [...data[1].matchAll(/\['(\d{2})','([^']+)'\]/g)];
  assert.equal(provinces.length, 38);
  assert.equal(new Set(provinces.map(([, id]) => id)).size, 38);
  assert.ok(provinces.some(([, , name]) => name === 'Papua Pegunungan'));
  assert.ok(provinces.some(([, , name]) => name === 'Papua Barat Daya'));
});
test('kota dan provinsi memakai dropdown dinamis, bukan teks bebas', () => {
  assert.match(form, /data-profile-select="province"/);
  assert.match(form, /data-profile-select="city"/);
  assert.match(form, /data-custom-input name="province" type="hidden"/);
  assert.match(form, /data-custom-input name="city" type="hidden"/);
  assert.doesNotMatch(form, /<input[^>]*name="city"[^>]*type="text"/);
  assert.match(form, /aria-controls="profile-city-options"/);
  assert.match(form, /aria-live="polite"/);
});
test('pilihan kota bergantung pada provinsi dan penanganan balapan permintaan aktif', () => {
  assert.match(profile, /const epoch = \+\+regionEpoch;/);
  assert.match(profile, /if \(epoch !== regionEpoch\) return;/);
  assert.match(profile, /setCustomValue\(citySelector, ''\)/);
  assert.match(profile, /renderRegionOptions\(citySelector, items/);
  assert.match(profile, /updateCityTrigger\(\)/);
});
test('data wilayah diambil dari dua penyedia dengan cache opsional dan kegagalan jelas', () => {
  assert.match(profile, /wilayah\.id\/api\/regencies/);
  assert.match(profile, /emsifa\.com\/api-wilayah-indonesia\/v2\/regencies/);
  assert.match(profile, /sessionStorage\.setItem/);
  assert.match(profile, /Periksa jaringan lalu pilih ulang provinsi/);
});
test('profil lama tetap kompatibel dengan nama wilayah sebagai string', () => {
  assert.match(profile, /city: String\(data\.get\('city'\)\)\.trim\(\)/);
  assert.match(profile, /province: String\(data\.get\('province'\)\)\.trim\(\)/);
  assert.match(profile, /chooseProvince\(data\?\.province \|\| '', data\?\.city \|\| ''\)/);
  assert.match(profile, /const legacyName/);
});
test('CSP tetap membatasi script dan memberi akses hanya dua domain data wilayah', () => {
  const firebase = JSON.parse(read('firebase.json'));
  const csp = firebase.hosting.headers[0].headers.find((item) => item.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src [^;]+https:\/\/wilayah\.id/);
  assert.match(csp, /connect-src [^;]+https:\/\/www\.emsifa\.com/);
  assert.match(csp, /object-src 'none'/);
});
test('Dashboard dan Results memakai lembar paper, navbar tab, dan filter responsif', () => {
  for (const page of ['dashboard.html','results.html']) {
    const html = read(`public/${page}`);
    assert.match(html, /esoria-workspace-dossier\.css/);
    assert.match(html, /esoria-dossier-page/);
  }
  assert.match(style, /\.cf-nav a\[aria-current=page\]/);
  assert.match(style, /\.cf-team-dossier/);
  assert.match(style, /\.cf-result-dossier/);
  assert.match(style, /@media\(max-width:500px\)/);
  assert.match(read('public/competition-participant.js'), /cf-activity-empty/);
});
