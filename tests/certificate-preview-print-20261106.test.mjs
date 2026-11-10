import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=(name)=>readFileSync(new URL(name,root),'utf8');

test('internal preview PDF is admin-gated, read-only and never creates an official entitlement',()=>{
 const backend=read('functions/competition.js');
 const section=backend.split('handlers.downloadCertificatePreview = async (request) => {')[1]?.split('  handlers.issueCertificate = async (request) => {')[0];
 assert.ok(section,'preview API present');
 assert.match(section,/await authorize\(request\)/);
 assert.match(section,/demoFixture !== true/);
 assert.match(section,/drawEsoriaCertificatePreview\(pdf,/);
 assert.match(section,/previewOnly: true/);
 assert.doesNotMatch(section, /tx\.create|tx\.set|tx\.update|\.file\(|certificateEntitlements|certificate\.issued/);
});

test('preview file contains clear non-official notice, no public QR and has a landscape page',()=>{
 const body=read('functions/certificate-preview.js');
 assert.match(body,/842, 595/);
 assert.match(body,/PRATINJAU SERTIFIKAT/);
 assert.match(body,/BUKAN BUKTI PENGHARGAAN RESMI/);
 assert.match(body,/Tidak menyatakan kemenangan, pembayaran/);
 assert.doesNotMatch(body,/QRCode|verify-certificate\.html|certificateId|OFFICIAL DIGITAL CERTIFICATE/);
});

test('operations panel offers printable preview for internal records and retains real issuance for legitimate winners',()=>{
 const ui=read('public/competition-operations.js');
 assert.match(ui,/data\.result\?\.demoFixture === true/);
 assert.match(ui,/data-operation="certificate-preview"/);
 assert.match(ui,/api\('downloadCertificatePreview', \{registrationId\}\)/);
 assert.match(ui,/data-operation="certificate"/);
 assert.match(ui,/api\('issueCertificate', \{registrationId\}\)/);
 assert.match(ui,/pdf\.base64\.startsWith\('JVBERi0'\)/);
});

test('published results and certificates remain subject to official server release gate',()=>{
 const domain=read('functions/domain.js');
 const backend=read('functions/competition.js');
 assert.match(domain,/demoFixture !== true \|\| isolatedDatasetRuntime\(\)/);
 assert.match(backend,/!officiallyReleased\(result\.data\(\)\)/);
 assert.match(backend,/if \(!state\.valid\) fail\('failed-precondition'/);
});
