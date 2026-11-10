import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {registrationActions, normalizeOfficialTicket} from '../public/registration-review-policy.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const base = {active:true,referenceNumber:'ECF-2026-11-WEB-W1-0001',ticketNumber:'',status:'menunggu',checkedIn:false};

test('nomor tiket menghapus pengulangan ECF secara deterministik untuk saran revisi', () => {
  assert.equal(normalizeOfficialTicket('ECF-ECF-2026-11-WEB-W1-0001'),'ECF-2026-11-WEB-W1-0001');
  assert.equal(normalizeOfficialTicket('ecf-ecf-ecf-2026-11-web-w1-0001'),'ECF-2026-11-WEB-W1-0001');
});
test('pendaftaran menunggu bisa diperiksa, tetapi belum bisa check-in', () => {
  const p = registrationActions(base);
  assert.equal(p.mayReview,true);
  assert.equal(p.mayCheckIn,false);
  assert.equal(p.mayCancelAcc,false);
});
test('ACC dengan tiket valid hanya menampilkan aksi yang relevan', () => {
  const p = registrationActions({...base,status:'terverifikasi',ticketNumber:base.referenceNumber});
  assert.equal(p.mayReview,false);
  assert.equal(p.mayCancelAcc,true);
  assert.equal(p.mayCheckIn,true);
  assert.equal(p.needsTicketRepair,false);
  assert.equal(p.mayArchive,false);
});
test('ACC dengan prefiks ganda mengharuskan perbaikan resmi sebelum check-in', () => {
  const p = registrationActions({...base,status:'terverifikasi',ticketNumber:`ECF-${base.referenceNumber}`});
  assert.equal(p.needsTicketRepair,true);
  assert.equal(p.mayRepairTicket,true);
  assert.equal(p.mayCheckIn,false);
});
test('check-in aktif mengunci perubahan ACC, tiket, arsip tetapi boleh dibatalkan', () => {
  const p = registrationActions({...base,status:'terverifikasi',ticketNumber:`ECF-${base.referenceNumber}`,checkedIn:true});
  assert.equal(p.mayCancelAcc,false);
  assert.equal(p.mayRepairTicket,false);
  assert.equal(p.mayCancelCheckIn,true);
  assert.equal(p.mayArchive,false);
});
test('pengarsipan mengunci review dan pembatalan check-in', () => {
  const p = registrationActions({...base,active:false,status:'ditolak'});
  assert.equal(p.mayReview,false);
  assert.equal(p.mayArchive,false);
  assert.equal(p.mayCancelCheckIn,false);
});
test('ditolak dapat ditinjau ulang tanpa tiket aktif', () => {
  const p = registrationActions({...base,status:'ditolak'});
  assert.equal(p.mayReview,true);
  assert.equal(p.mayCancelAcc,false);
});
test('server mewajibkan alasan dan aksi eksplisit untuk pencabutan ACC', () => {
  const s=read('functions/index.js');
  assert.match(s,/input\.reviewAction !== 'cancel_acc'/);
  assert.match(s,/adminNotes\.length < 10/);
  assert.match(s,/paymentStatus !== 'belum_diperiksa'/);
  assert.match(s,/registration\.acc_revoked/);
});
test('server melindungi tiket kanonis dan indeks nomor yang sudah diberikan', () => {
  const s=read('functions/index.js');
  assert.match(s,/Nomor tiket tidak boleh memiliki awalan ECF ganda/);
  assert.match(s,/input\.reviewAction !== 'repair_ticket'/);
  assert.match(s,/transaction\.delete\(oldTicketRef\)/);
  assert.match(s,/Nomor tiket perbaikan harus sama dengan referensi resmi/);
});
test('server menolak check-in tiket bermasalah dan arsip ACC', () => {
  const s=read('functions/index.js');
  assert.match(s,/checkedIn && normalizeTicket\(current.ticketNumber\) !== normalizeTicket\(current.referenceNumber\)/);
  assert.match(s,/Batalkan ACC terlebih dahulu sebelum mengarsipkan/);
});
test('semua panel menerapkan aturan yang sama dan tidak menawarkan ACC ulang', () => {
  const admin=read('public/admin.js');
  const ops=read('public/competition-operations.js');
  assert.match(admin,/policy\.accepted \? .*data-cancel-acc/);
  assert.match(ops,/policy\.mayReview/);
  assert.match(ops,/openCancelAccDecision/);
  assert.match(ops,/openRepairTicketDecision/);
  assert.match(ops,/data-operation="check-in"/);
});
test('aturan CSS breakpoint berlaku setelah style lama tanpa menyembunyikan teks tiket', () => {
  const admin=read('public/admin-registration-alignment-20261020.css');
  assert.match(admin,/@media\(max-width:530px\)/);
  assert.match(admin,/\.admin-registration-person/);
  assert.match(admin,/overflow-wrap:anywhere/);
  const ops=read('public/operations-decision-compact-20261020.css');
  assert.match(ops, /max-height:min\(86dvh,840px\)/);
  assert.match(ops, /\[hidden\]\{display:none!important/);
  assert.match(read('public/admin.html'),/admin-registration-alignment-20261020.css/);
  assert.match(read('public/operations.html'),/operations-decision-compact-20261020.css/);
});
