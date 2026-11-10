import test from 'node:test';
import assert from 'node:assert/strict';
import {drawEsoriaCertificate} from '../functions/certificate-artwork.js';

const fixture = (overrides = {}) => ({
  recipientName: 'Putri Cahaya Nusantara',
  packageLabel: 'Full Stack Development Team',
  periodLabel: 'November 2026', waveLabel: 'Wave 01', rank: 1,
  resultRevision: 2, ...overrides
});
async function render(data = fixture()) {
  const events = [];
  const fakeFont = (factor = 0.54) => ({widthOfTextAtSize: (str, size) => [...str].length * factor * size});
  const font = fakeFont();
  const titleFont = fakeFont(0.57);
  const bodyBold = fakeFont(0.61);
  const page = {
    drawText: (content, options) => { assert.ok(Number.isFinite(options.x) && Number.isFinite(options.y)); events.push({kind: 'text', content, ...options}); },
    drawRectangle: (options) => { assert.ok(options.width > 0 && options.height > 0); events.push({kind: 'rect', ...options}); },
    drawLine: (options) => events.push({kind: 'line', ...options}),
    drawImage: (_image, options) => events.push({kind: 'qr', ...options}),
    drawCircle: (options) => { assert.ok(options.size > 0); events.push({kind: 'disc', ...options}); }
  };
  const pdf = {
    addPage: (size) => { assert.deepEqual(size, [842, 595]); return page; },
    embedPng: async (_bytes) => 'embedded-qr'
  };
  const verificationUrl = 'https://esoria-codefest.web.app/verify-certificate.html?id=' + '1'.repeat(32);
  await drawEsoriaCertificate({pdf, rgb: (...v) => ({rgb: v}), QRCode: {
    toBuffer: async (url) => { assert.equal(url, verificationUrl); return Buffer.from('image'); }
  }, font, titleFont, bodyBold, pdfText: (value) => value, data, certificateId: '1'.repeat(32), verificationUrl});
  return events;
}
test('landscape certificate has complete official fields and a scannable verification block', async () => {
  const events = await render();
  const texts = events.filter((e) => e.kind === 'text').map((e) => e.content);
  for (const value of ['ESORIA', 'E-SERTIFIKAT', 'PENGHARGAAN JUARA I', 'Putri Cahaya Nusantara', 'Full Stack Development Team', 'SCAN TO VERIFY']) {
    assert.ok(texts.includes(value), `${value} should be visible`);
  }
  assert.equal(events.filter((e) => e.kind === 'qr').length, 1);
  assert.ok(events.filter((e) => e.kind === 'rect').length >= 9);
  assert.ok(events.filter((e) => e.kind === 'disc').length >= 3); // embossed seal
});
test('non-winning certificate never claims a podium rank', async () => {
  const texts = (await render(fixture({rank: null}))).filter((e) => e.kind === 'text').map((e) => e.content);
  assert.ok(texts.includes('PARTISIPASI TERVALIDASI'));
  assert.ok(!texts.some((v) => v.includes('JUARA')));
});
test('long participant name fits within printable area and does not overwrite award metadata', async () => {
  const name = 'Muhammad Abdurrahman Putra Jayawardhana Nugroho Prasetyo Kartanegara Ramadhan Widodo';
  const texts = (await render(fixture({recipientName: name}))).filter((e) => e.kind === 'text');
  const names = texts.filter((e) => e.content.split(' ').some((token) => token === 'Muhammad' || token === 'Widodo'));
  assert.ok(names.length >= 1 && names.length <= 2);
  for (const entry of names) {
    assert.ok(entry.x >= 70, `name starts too close to edge: ${entry.x}`);
    assert.ok(entry.x + entry.font.widthOfTextAtSize(entry.content, entry.size) <= 772, 'name ends within frame');
    assert.ok(entry.y >= 260, 'name cannot cover award badge');
  }
});
test('certificate normalizes control characters and handles long category without spilling into QR', async () => {
  const texts = (await render(fixture({recipientName: 'Dewi\n Putri', packageLabel: 'Full Stack Development Team '.repeat(8)}))).filter((e) => e.kind === 'text');
  assert.ok(texts.some((e) => e.content === 'Dewi Putri'));
  const category = texts.find((e) => e.y === 140);
  assert.ok(category.x + category.font.widthOfTextAtSize(category.content, category.size) <= 615);
});
