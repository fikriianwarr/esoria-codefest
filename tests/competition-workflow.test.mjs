import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentAction, workflowPhase, scoreEstimate, juryFilter, jurySummary, httpsUrl, PROCESS_STEPS} from '../public/competition-workflow.js';
import fs from 'node:fs';

const future = Date.now() + 3600000;
const past = Date.now() - 3600000;
const work = {status: 'terverifikasi', active: true, submission: {submitted: true}};

test('alur panitia selalu memiliki lima tahap yang jelas', () => assert.equal(PROCESS_STEPS.length, 5));
test('tidak bisa menugaskan juri sebelum tenggat', () => assert.equal(assignmentAction(work, {deadlineAt:future}, null).enabled, false));
test('tidak bisa menugaskan jika karya belum final', () => assert.equal(assignmentAction({...work,submission:{submitted:false}}, {deadlineAt:past}, null).enabled, false));
test('tidak bisa menugaskan jika pendaftaran belum diterima', () => assert.equal(assignmentAction({...work,status:'menunggu'}, {deadlineAt:past}, null).enabled, false));
test('tidak bisa menugaskan jika hasil sudah diumumkan', () => assert.equal(assignmentAction(work, {deadlineAt:past}, {published:true}).enabled, false));
test('panitia dapat menugaskan karya final setelah deadline', () => assert.equal(assignmentAction(work, {deadlineAt:past}, null).enabled, true));
test('status tahap berganti setelah hasil diumumkan', () => assert.equal(workflowPhase({result:{published:true}}),5));
test('tahap pengumpulan selama tenggat berjalan', () => assert.equal(workflowPhase({schedule:{deadlineAt:future}}),2));
test('tahap penyusunan kebijakan ketika deadline lewat', () => assert.equal(workflowPhase({schedule:{deadlineAt:past}}),3));
test('tahap penilaian ketika kebijakan siap', () => assert.equal(workflowPhase({schedule:{deadlineAt:past},policy:{requiredJudgeCount:2}}),4));
test('kalkulasi rubrik berbobot menerima nol', () => assert.equal(scoreEstimate([['a','A',40],['b','B',60]], {a:0,b:100}),60));
test('kalkulasi tidak mengklaim skor ketika ada kriteria kosong', () => assert.equal(scoreEstimate([['a','A',40],['b','B',60]], {a:100,b:''}),null));
test('kalkulasi tidak menerima input di luar rentang', () => assert.equal(scoreEstimate([['a','A',100]], {a:101}),null));
test('filter tugas memperhatikan status draft dan judul', () => {
  const item = {registration:{referenceNumber:'ES-10',packageLabel:'Website Programming'},submission:{payload:{title:'Galeri Karya'}},grade:{finalized:false}};
  assert.equal(juryFilter(item,'galeri','draft'),true);
  assert.equal(juryFilter(item,'tidak ada','all'),false);
  assert.equal(juryFilter(item,'es-10','final'),false);
});
test('ringkasan penugasan juri konsisten', () => assert.deepEqual(jurySummary([{grade:null},{grade:{finalized:false}},{grade:{finalized:true}}]),{total:3,final:1,draft:1,pending:1}));
test('tautan karya harus https dan tidak mengandung credentials', () => {
 assert.equal(httpsUrl('javascript:alert(1)'),null);
 assert.equal(httpsUrl('http://example.com'),null);
 assert.equal(httpsUrl('https://u:p@example.com'),null);
 assert.equal(httpsUrl('https://example.com/portfolio'),'https://example.com/portfolio');
});
test('hanya akses admin yang boleh mengelola penilaian', () => {
 const server=fs.readFileSync(new URL('../functions/competition.js', import.meta.url),'utf8');
 assert.match(server,/const user = await requireAdmin\(request\)/);
 assert.doesNotMatch(server,/staffDoc/);
});
test('setiap halaman alur mempunyai elemen yang diharapkan', () => {
 const operations=fs.readFileSync(new URL('../public/operations.html',import.meta.url),'utf8');
 const jury=fs.readFileSync(new URL('../public/jury.html',import.meta.url),'utf8');
 const results=fs.readFileSync(new URL('../public/results.html',import.meta.url),'utf8');
 assert.match(operations,/id="operations-process"/);
 assert.match(operations,/id="operations-guidance"/);
 assert.match(jury,/id="jury-search"/);
 assert.match(jury,/id="jury-metrics"/);
 assert.match(results,/id="public-results"/);
});
