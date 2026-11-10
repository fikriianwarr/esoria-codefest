'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const code = (name)=>readFileSync(join(__dirname,'..',name),'utf8');

test('archived registration cannot be replayed as successful duplicate in callable and frontend',()=>{
  const server=code('functions/index.js');
  const client=code('public/spark-data.js');
  const getOwn=code('functions/competition.js');
  assert.match(server,/if \(existing\.active === false\) throw new HttpsError\('failed-precondition'/);
  assert.match(getOwn,/active: record\.active !== false/);
  assert.match(client,/preflight\.data\.active === false/);
  assert.match(client,/preflight\.data\.status === 'terverifikasi'/);
  assert.match(client,/preflight\.data\.status === 'ditolak'/);
});
test('check-in validates Admin/boolean and does not repeat write and notifications',()=>{
  const server=code('functions/index.js');
  const start=server.indexOf('const checkInRegistrationHandler = async (request) => {');
  const body=server.slice(start,server.indexOf('const softDeleteRegistrationHandler',start));
  assert.match(body,/await requireAdmin\(request\)/);
  assert.match(body,/typeof request\.data\?\.checkedIn !== 'boolean'/);
  assert.match(body,/\(current\.checkedIn === true\) === checkedIn\) return false/);
  assert.match(body,/unchanged: !changed/);
});
test('review of a checked-in ticket must first reverse attendance before changing status or ID',()=>{
  const server=code('functions/index.js');
  const start=server.indexOf('async function reviewRegistrationCore');
  const block=server.slice(start,server.indexOf('const reviewRegistrationHandler',start));
  assert.match(block,/current\.checkedIn === true && \(status !== 'terverifikasi' \|\| oldTicket !== ticketNumber\)/);
});
test('private upload and evidence flows reject user changes before returning protected content',()=>{
  const source=code('public/spark-data.js');
  const upload=source.slice(source.indexOf('const uploadProof ='),source.indexOf('export const getRegistrationContext'));
  assert.match(upload,/assertSameAccount\(\)/);
  const proof=source.slice(source.indexOf('export const getProofDownloadUrl ='),source.indexOf('export const purgePaymentProof ='));
  assert.match(proof,/requireSameAccount\(\)/);
  assert.match(proof,/\^data:image\\\/\(\?:jpeg\|png\);base64/);
});


test('successful registration and proof updates do not return stale account data after async call',()=>{
  const client=code('public/spark-data.js');
  const view=code('public/registration.js');
  const submit=client.slice(client.indexOf('export const submitRegistration ='),client.indexOf('export const replacePaymentProof ='));
  assert.match(submit,/const response = await invoke\('submitRegistration'/);
  assert.match(submit,/if \(auth\.currentUser\?\.uid !== user\.uid\) \{[\s\S]*?sessionStore\.removeItem\(submissionKey\);/);
  assert.match(submit,/esoria-submission-id:\$\{user\.uid\}:\$\{periodId\}:\$\{packageId\}:\$\{waveId\}/);
  const replace=client.slice(client.indexOf('export const replacePaymentProof ='),client.indexOf('export const getProofDownloadUrl ='));
  assert.match(replace,/const response = await invoke\('replacePaymentProof',[\s\S]*?if \(auth\.currentUser\?\.uid !== user\.uid\)/);
  assert.match(view,/if \(cloudDraftPending\) await cloudDraftPending\.catch\(\(\) => \{\}\);\s*requireSameMember\(\);/);
  assert.match(view,/await accountApi\('clearRegistrationDraft',[\s\S]*?requireSameMember\(\);/);
});
