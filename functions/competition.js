import crypto from 'node:crypto';
import sharp from 'sharp';
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';
import QRCode from 'qrcode';
import {drawEsoriaCertificate} from './certificate-artwork.js';
import {drawEsoriaCertificatePreview} from './certificate-preview.js';
import {eligibleForMaterials, readCategoryMaterials} from './materials-access.js';
import {RUBRICS, PRIZES, canonical, sha256, millis, scopeFor, scheduleFor, weightedScore, safeHttps, flagDigest, sameDigest, maskName, csv, attachmentName, officiallyReleased, isolatedDatasetRuntime} from './domain.js';

// All business writes use Admin SDK transactions. Browser Rules deny direct writes.
export function createCompetitionService({db, auth, bucket, Timestamp, FieldValue, HttpsError, requireVerified, requireAdmin, requireActiveProfile, auditData, auditRef, notificationData, notificationRef, reviewRegistrationCore, logger}) {
  const stamp = () => FieldValue.serverTimestamp();
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const required = (value, label, min = 1, max = 500) => {
    const out = text(value, max);
    if (out.length < min) fail('invalid-argument', `${label} belum lengkap.`);
    return out;
  };
  const id = (value) => {
    const out = required(value, 'ID', 1, 250);
    if (!/^[A-Za-z0-9_.:-]+$/.test(out)) fail('invalid-argument', 'ID tidak valid.');
    return out;
  };
  const revision = (value, actual) => {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid-argument', 'Versi data wajib diisi.');
    if (value !== Number(actual || 0)) fail('aborted', 'Data berubah di sesi lain. Muat ulang sebelum menyimpan.');
  };
  const scopeInput = (input) => {
    const periodId = id(input.periodId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) || !RUBRICS[input.package] || !['wave-01', 'wave-02'].includes(input.wave)) fail('invalid-argument', 'Periode, kategori, atau gelombang tidak valid.');
    return {periodId, package: input.package, wave: input.wave, scope: scopeFor(input)};
  };
  const queryScope = (collection, scope) => db.collection(collection).where('scope', '==', scope);
  const event = (transaction, actor, action, targetType, targetId, details = {}) => {
    transaction.set(auditRef(crypto.randomUUID()), auditData(actor, action, targetType, targetId, details));
  };
  const notify = (transaction, uid, title, message, sourceId, eventKey = crypto.randomUUID()) => {
    transaction.set(notificationRef(uid, eventKey), notificationData({userId: uid, type: 'competition', title, message, actionLabel: 'Buka dashboard', actionUrl: 'dashboard.html', sourceType: 'competition', sourceId, eventKey}));
  };
  // Two account types only: active administrators and ESORIA members.
  // A scoring assignment is a task, not a third account role.
  const authorize = async (request) => {
    const user = await requireAdmin(request);
    if (process.env.REQUIRE_ADMIN_MFA === 'true' && !request.auth.token.firebase?.sign_in_second_factor) fail('permission-denied', 'Masuk ulang dengan MFA.');
    return {...user, role: 'admin'};
  };
  const participant = async (request) => {
    const user = requireVerified(request);
    await requireActiveProfile(user.uid);
    return user;
  };
  const registrationAccess = async (transaction, registrationId, user) => {
    const [registrationDoc, teamDoc] = await Promise.all([transaction.get(db.doc(`registrations/${registrationId}`)), transaction.get(db.doc(`teams/${registrationId}`))]);
    if (!registrationDoc.exists || registrationDoc.data().active === false) fail('not-found', 'Pendaftaran aktif tidak ditemukan.');
    const registration = registrationDoc.data();
    const team = teamDoc.data() || {memberUids: [registration.userId], editorUids: []};
    const leader = registration.userId === user.uid;
    if (!leader && !(registration.package === 'team' && team.memberUids.includes(user.uid))) fail('permission-denied', 'Karya bukan milik akun atau tim Anda.');
    return {registration, team, leader, canEdit: leader || team.editorUids?.includes(user.uid) === true};
  };
  const assertWindow = (registration, period, now = Date.now()) => {
    if (registration.status !== 'terverifikasi' || registration.active === false) fail('failed-precondition', 'Pendaftaran dan pembayaran harus diterima sebelum mengirim karya.');
    const schedule = scheduleFor(period, registration);
    if (![schedule.startsAt, schedule.deadlineAt, schedule.announcementAt].every(Number.isFinite)) fail('failed-precondition', 'Jadwal kategori belum lengkap. Hubungi panitia.');
    if (!['open', 'closed', 'completed'].includes(period.status)) fail('failed-precondition', 'Periode belum diaktifkan.');
    if (now < schedule.startsAt || now > schedule.deadlineAt) fail('failed-precondition', 'Pengumpulan berada di luar jadwal lomba.');
    return schedule;
  };
  const url = (value, requiredValue = false) => {
    try { return safeHttps(value, {required: requiredValue}); } catch { fail('invalid-argument', 'Tautan harus URL HTTPS publik yang valid, tanpa kredensial.'); }
  };
  const submissionPayload = (input, track, final) => {
    const fields = ['repositoryUrl', 'backendRepositoryUrl', 'liveUrl', 'readmeUrl', 'presentationUrl', 'documentationUrl', 'evidenceUrl'];
    const out = Object.fromEntries(fields.map((key) => [key, url(input[key], final && (track === 'web' ? ['repositoryUrl', 'liveUrl', 'readmeUrl'].includes(key) : track === 'team' ? ['repositoryUrl', 'backendRepositoryUrl', 'liveUrl', 'presentationUrl', 'documentationUrl', 'readmeUrl'].includes(key) : false))]));
    out.title = text(input.title, 150);
    out.notes = text(input.notes, 10000);
    out.writeup = text(input.writeup, 30000);
    out.tools = text(input.tools, 2000);
    out.originality = input.originality === true;
    out.safeTesting = input.safeTesting === true;
    out.publicNameConsent = input.publicNameConsent === true;
    if (final && (!out.originality || out.title.length < 3)) fail('invalid-argument', 'Judul dan pernyataan keaslian wajib diisi.');
    if (final && track === 'cyber' && (!out.safeTesting || out.writeup.length < 50 || !out.tools)) fail('invalid-argument', 'Write-up, alat/metode, dan persetujuan safe-testing wajib diisi.');
    return out;
  };
  const gradeId = (registrationId, judgeUid) => sha256(`${registrationId}:${judgeUid}`);
  const activeResults = async (scope) => {
    const doc = await db.doc(`results/${scope}`).get();
    const data = doc.data();
    return officiallyReleased(data) ? {id: doc.id, ...data} : null;
  };

  const handlers = {};
  handlers.resolveSession = async (request) => {
    const user = requireVerified(request);
    const admin = await db.doc(`admins/${user.uid}`).get();
    // A retired Admin document must not silently transform into a Member.
    // Member profile creation/storage access is intentionally denied while the
    // historical admins/{uid} document exists. Return a consistent policy error.
    if (admin.exists && admin.data()?.active !== true) {
      fail('permission-denied', 'Akses administrator dinonaktifkan. Hubungi pengelola untuk peninjauan akun.');
    }
    return admin.data()?.active === true
      ? {kind: 'admin', destination: 'admin.html'}
      : {kind: 'participant', destination: 'dashboard.html'};
  };
  // New registrations do not have an owner field yet, so a browser Firestore
  // get() is intentionally denied by Rules. Check the current member's own ID
  // through the authenticated API instead; do not weaken Firestore Rules.
  handlers.getOwnRegistrationStatus = async (request) => {
    const user = await participant(request);
    const scope = scopeInput(request.data || {});
    const registrationId = `${scope.periodId}__${user.uid}__${scope.package}__${scope.wave}`;
    const existing = await db.doc(`registrations/${registrationId}`).get();
    if (!existing.exists) return {exists: false};
    const record = existing.data();
    if (record.userId !== user.uid) fail('permission-denied', 'Pendaftaran bukan milik akun ini.');
    // Archived records keep their historical ID; a member must not be sent
    // to a successful-registration receipt for a registration that is inactive.
    return {
      exists: true,
      active: record.active !== false,
      registrationId,
      referenceNumber: text(record.referenceNumber, 80),
      status: text(record.status, 40)
    };
  };
  handlers.createPaymentProofUpload = async (request) => {
    const user = await participant(request);
    const input = request.data;
    const registrationId = id(input.registrationId);
    const parsed = registrationId.match(/^(\d{4}-(?:0[1-9]|1[0-2]))__(.+)__(web|cyber|team)__(wave-01|wave-02)$/);
    const sizeBytes = Number(input.sizeBytes);
    if (!parsed || parsed[2] !== user.uid || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 360 * 1024 || !/^[a-f0-9]{64}$/.test(input.sha256 || '')) fail('invalid-argument', 'Metadata dan tujuan unggah bukti belum valid.');
    const uploadId = crypto.randomUUID();
    const storagePath = `payment-proofs/${user.uid}/${registrationId}/${uploadId}.jpg`;
    await db.runTransaction(async (tx) => {
      const [regDoc, profile, periodDoc, system] = await Promise.all([tx.get(db.doc(`registrations/${registrationId}`)), tx.get(db.doc(`users/${user.uid}`)), tx.get(db.doc(`periods/${parsed[1]}`)), tx.get(db.doc('system/registration'))]);
      if (profile.data()?.profileComplete !== true || profile.data()?.archived === true) fail('failed-precondition', 'Profil lengkap dan aktif diperlukan.');
      if (regDoc.exists) {
        if (regDoc.data().userId !== user.uid || regDoc.data().active === false || regDoc.data().status === 'terverifikasi' || regDoc.data().proofPurgeInProgress === true) fail('failed-precondition', 'Bukti tidak dapat diganti pada status ini.');
      } else {
        const period = periodDoc.data();
        const wave = period?.packages?.[parsed[3]]?.waves?.[parsed[4]] || period?.waves?.[parsed[4]];
        const openAt = millis(wave?.registrationOpenAt || period?.registrationOpenAt);
        const closeAt = millis(wave?.registrationCloseAt || period?.registrationCloseAt);
        if (system.data()?.openPeriodId !== parsed[1] || system.data()?.acceptingRegistrations !== true || period?.status !== 'open' || !wave || wave.enabled === false || period?.packages?.[parsed[3]]?.enabled === false || !Number.isFinite(openAt) || !Number.isFinite(closeAt) || Date.now() < openAt || Date.now() > closeAt) fail('failed-precondition', 'Pendaftaran kategori dan gelombang belum dibuka atau sudah ditutup.');
      }
      tx.create(db.doc(`proofUploadIntents/${uploadId}`), {uploadId, ownerUid: user.uid, registrationId, storagePath, sha256: input.sha256, sizeBytes, status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60000), createdAt: stamp()});
    });
    return {uploadId, storagePath};
  };
  handlers.saveRegistrationDraft = async (request) => {
    const user = await participant(request);
    const input = request.data || {};
    const draft = input.draft || {};
    const allowed = ['package', 'wave', 'skillStack', 'portfolioUrl', 'teamName', 'memberCount', 'transferDate', 'senderName', 'senderInstitution', 'notes'];
    const safe = Object.fromEntries(allowed.map((key) => [key, text(draft[key], key === 'notes' ? 1000 : 500)]));
    safe.teamMembers = Array.isArray(draft.teamMembers) ? draft.teamMembers.slice(0, 4).map((member) => ({name: text(member.name, 100), email: text(member.email, 160), phone: text(member.phone, 20), institution: text(member.institution, 120), role: text(member.role, 80), consent: member.consent === true})) : [];
    const ref = db.doc(`registrationDrafts/${user.uid}`);
    return db.runTransaction(async (tx) => {
      const prior = await tx.get(ref);
      revision(input.expectedRevision, prior.data()?.revision);
      const next = Number(prior.data()?.revision || 0) + 1;
      tx.set(ref, {userId: user.uid, draft: safe, revision: next, updatedAt: stamp(), expiresAt: Timestamp.fromMillis(Date.now() + 14 * 86400000)});
      return {revision: next, savedAt: Date.now()};
    });
  };
  handlers.getRegistrationDraft = async (request) => {
    const user = await participant(request);
    const data = (await db.doc(`registrationDrafts/${user.uid}`).get()).data();
    return data && millis(data.expiresAt) > Date.now() ? {draft: data.draft, revision: data.revision, savedAt: millis(data.updatedAt)} : {draft: null, revision: data?.revision || 0};
  };
  handlers.clearRegistrationDraft = async (request) => {
    const user = await participant(request);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`registrationDrafts/${user.uid}`);
      const prior = await tx.get(ref);
      if (!prior.exists) return;
      revision(request.data.expectedRevision, prior.data()?.revision);
      tx.delete(ref);
    });
    return {ok: true};
  };
  handlers.joinTeam = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data.registrationId);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`teams/${registrationId}`);
      const [registrationDoc, teamDoc, profileDoc] = await Promise.all([tx.get(db.doc(`registrations/${registrationId}`)), tx.get(ref), tx.get(db.doc(`users/${user.uid}`))]);
      const reg = registrationDoc.data();
      if (!reg || reg.package !== 'team' || reg.active === false) fail('not-found', 'Pendaftaran tim tidak ditemukan.');
      if (profileDoc.data()?.profileComplete !== true) fail('failed-precondition', 'Lengkapi profil sebelum bergabung ke tim.');
      if (reg.userId !== user.uid && !reg.teamMembers?.some((member) => member.email?.toLowerCase() === user.email.toLowerCase() && member.consent === true)) fail('permission-denied', 'Email terverifikasi Anda tidak ada dalam daftar anggota tim.');
      const current = teamDoc.data() || {leaderUid: reg.userId, memberUids: [reg.userId], editorUids: []};
      if (current.memberUids.includes(user.uid)) return;
      if (current.memberUids.length >= Number(reg.memberCount || 4)) fail('failed-precondition', 'Seluruh keanggotaan tim sudah terhubung.');
      tx.set(ref, {...current, registrationId, scope: scopeFor(reg), memberUids: [...current.memberUids, user.uid], updatedAt: stamp()});
      event(tx, {...user, role: 'participant'}, 'team.member_linked', 'registration', registrationId);
    });
    return {ok: true};
  };
  handlers.setTeamEditor = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data.registrationId);
    const memberUid = id(request.data.memberUid);
    await db.runTransaction(async (tx) => {
      const {registration, team, leader} = await registrationAccess(tx, registrationId, user);
      const period = await tx.get(db.doc(`periods/${registration.periodId}`));
      assertWindow(registration, period.data());
      if (!leader || registration.package !== 'team' || !team.memberUids.includes(memberUid) || memberUid === user.uid) fail('permission-denied', 'Hanya ketua dapat memberi izin editor kepada anggota terhubung.');
      const editors = new Set(team.editorUids || []);
      if (request.data.enabled === true) editors.add(memberUid); else editors.delete(memberUid);
      tx.set(db.doc(`teams/${registrationId}`), {...team, registrationId, leaderUid: user.uid, scope: scopeFor(registration), editorUids: [...editors], updatedAt: stamp()});
      event(tx, {...user, role: 'participant'}, 'team.editor_changed', 'registration', registrationId, {enabled: request.data.enabled === true, memberUid});
    });
    return {ok: true};
  };

  handlers.saveSubmission = async (request) => {
    const user = await participant(request);
    const input = request.data;
    const registrationId = id(input.registrationId);
    const requestId = id(input.requestId);
    const final = input.final === true;
    const artifactIds = Array.isArray(input.artifactIds) ? [...new Set(input.artifactIds.map(id))].slice(0, 8) : [];
    return db.runTransaction(async (tx) => {
      const access = await registrationAccess(tx, registrationId, user);
      const {registration, team, leader, canEdit} = access;
      const scope = scopeFor(registration);
      const ref = db.doc(`submissions/${registrationId}`);
      const [periodDoc, priorDoc, resultDoc, ...uploads] = await Promise.all([tx.get(db.doc(`periods/${registration.periodId}`)), tx.get(ref), tx.get(db.doc(`results/${scope}`)), ...artifactIds.map((key) => tx.get(db.doc(`submissionUploads/${key}`)))]);
      const prior = priorDoc.data() || {};
      const payload = submissionPayload(input.payload || {}, registration.package, final || ['submitted', 'updated'].includes(prior.status));
      const mutationHash = sha256(canonical({payload, artifactIds, final}));
      if (prior.lastMutationId === requestId) {
        if (prior.lastMutationHash !== mutationHash) fail('invalid-argument', 'ID permintaan telah digunakan untuk data berbeda.');
        return {revision: prior.revision, status: prior.status, duplicate: true};
      }
      assertWindow(registration, periodDoc.data());
      if (!canEdit || ((final || prior.submittedAt) && !leader)) fail('permission-denied', 'Hanya editor boleh menyimpan draft dan ketua yang boleh mengirim final.');
      if (resultDoc.data()?.published === true || ['locked', 'reviewed'].includes(prior.status)) fail('failed-precondition', 'Karya sudah dikunci.');
      revision(input.expectedRevision, prior.revision);
      for (const upload of uploads) {
        const item = upload.data();
        if (!item || item.registrationId !== registrationId || !['uploaded', 'attached'].includes(item.status) || item.ownerUid !== user.uid && !team.memberUids.includes(item.ownerUid)) fail('invalid-argument', 'Lampiran belum diverifikasi atau bukan milik tim.');
      }
      if ((final || ['submitted', 'updated'].includes(prior.status)) && registration.package === 'cyber' && !artifactIds.length && !payload.evidenceUrl) fail('invalid-argument', 'Evidence berupa lampiran atau tautan HTTPS wajib disertakan.');
      const nextRevision = Number(prior.revision || 0) + 1;
      const status = final ? (prior.submittedAt ? 'updated' : 'submitted') : prior.submittedAt ? 'updated' : 'draft';
      // Updating a previously submitted work is another valid final revision; retain all required fields.
      const data = {registrationId, ownerUid: registration.userId, memberUids: team.memberUids, scope, periodId: registration.periodId, package: registration.package, wave: registration.wave, payload, artifactIds,
        revision: nextRevision, status, createdAt: prior.createdAt || stamp(), updatedAt: stamp(), submittedAt: final || prior.submittedAt ? stamp() : null,
        lastMutationId: requestId, lastMutationHash: mutationHash};
      tx.set(ref, data);
      tx.create(db.doc(`submissionRevisions/${registrationId}/items/${String(nextRevision).padStart(6, '0')}`), {...data, actorUid: user.uid});
      uploads.forEach((upload) => tx.update(upload.ref, {status: 'attached', attachedAt: stamp()}));
      event(tx, {...user, role: 'participant'}, `submission.${status}`, 'submission', registrationId, {revision: nextRevision});
      if (status !== 'draft') notify(tx, registration.userId, 'Karya tersimpan', `Kiriman revisi ${nextRevision} sudah diterima.`, registrationId, `submission_${registrationId}_${nextRevision}`);
      return {revision: nextRevision, status};
    });
  };

  handlers.createSubmissionUpload = async (request) => {
    const user = await participant(request);
    const input = request.data;
    const registrationId = id(input.registrationId);
    const uploadId = crypto.randomUUID();
    const sizeBytes = Number(input.sizeBytes);
    const mime = text(input.mimeType, 80);
    const ext = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg'}[mime];
    if (!ext || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(input.sha256 || '')) fail('invalid-argument', 'Lampiran harus PDF/PNG/JPEG maksimal 5 MB dengan hash SHA-256.');
    const path = `submission-files/${user.uid}/${registrationId}/${uploadId}.${ext}`;
    await db.runTransaction(async (tx) => {
      const {registration, canEdit} = await registrationAccess(tx, registrationId, user);
      const [period, pending] = await Promise.all([tx.get(db.doc(`periods/${registration.periodId}`)), tx.get(db.collection('submissionUploads').where('ownerUid', '==', user.uid).where('status', '==', 'pending').limit(12))]);
      assertWindow(registration, period.data());
      if (!canEdit) fail('permission-denied', 'Izin editor diperlukan.');
      if (pending.size >= 12) fail('resource-exhausted', 'Selesaikan unggahan sebelumnya atau tunggu pembersihan otomatis.');
      tx.create(db.doc(`submissionUploads/${uploadId}`), {uploadId, registrationId, scope: scopeFor(registration), ownerUid: user.uid, storagePath: path, sha256: input.sha256, sizeBytes, mimeType: mime, fileName: attachmentName(input.fileName, mime), status: 'pending', createdAt: stamp(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60000)});
    });
    return {uploadId, storagePath: path};
  };
  handlers.finalizeSubmissionUpload = async (request) => {
    const user = await participant(request);
    const uploadId = id(request.data.uploadId);
    const ref = db.doc(`submissionUploads/${uploadId}`);
    const uploadDoc = await ref.get();
    const upload = uploadDoc.data();
    if (!upload || upload.ownerUid !== user.uid) fail('not-found', 'Unggahan tidak ditemukan.');
    if (['uploaded', 'attached'].includes(upload.status)) return {uploadId, fileName: upload.fileName, sizeBytes: upload.sizeBytes};
    if (upload.status !== 'pending' || millis(upload.expiresAt) < Date.now()) fail('failed-precondition', 'Izin unggah kedaluwarsa. Buat ulang unggahan.');
    const file = bucket.file(upload.storagePath);
    const [meta] = await file.getMetadata();
    if (Number(meta.size) !== upload.sizeBytes || meta.contentType !== upload.mimeType || meta.metadata?.ownerUid !== user.uid || meta.metadata?.sha256 !== upload.sha256) fail('invalid-argument', 'Metadata lampiran tidak cocok.');
    const [bytes] = await file.download();
    if (sha256(bytes) !== upload.sha256) fail('invalid-argument', 'Hash isi lampiran tidak cocok.');
    try {
      if (upload.mimeType === 'application/pdf') {
        if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || /\/(JavaScript|JS|EmbeddedFile|Launch|RichMedia|OpenAction|AA)\b/.test(bytes.toString('latin1'))) throw new Error('active');
        const pdf = await PDFDocument.load(bytes, {ignoreEncryption: false});
        // Inspect parsed dictionaries too, including object streams hidden from a byte scan.
        for (const [, object] of pdf.context.enumerateIndirectObjects()) {
          if (/\/(JavaScript|JS|EmbeddedFile|Launch|RichMedia|OpenAction|AA)\b/.test(String(object))) throw new Error('active');
        }
        if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error('pages');
      } else {
        const {info} = await sharp(bytes, {failOn: 'warning', limitInputPixels: 36000000}).raw().toBuffer({resolveWithObject: true});
        if (info.width > 6000 || info.height > 6000) throw new Error('dimensions');
      }
    } catch { fail('invalid-argument', 'Isi file rusak, terenkripsi, aktif, atau melewati batas. Unggah PDF biasa atau gambar.'); }
    await file.setMetadata({cacheControl: 'private,no-store', contentDisposition: 'attachment', metadata: {...meta.metadata, firebaseStorageDownloadTokens: null}});
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const {registration, canEdit} = await registrationAccess(tx, upload.registrationId, user);
      const period = await tx.get(db.doc(`periods/${registration.periodId}`));
      assertWindow(registration, period.data());
      if (!canEdit || current.data()?.status !== 'pending') fail('failed-precondition', 'Status unggahan berubah. Muat ulang.');
      tx.update(ref, {status: 'uploaded', verifiedAt: stamp()});
    });
    return {uploadId, fileName: upload.fileName, sizeBytes: upload.sizeBytes};
  };

  // Private, category-scoped download. Every request is authorized again on
  // the server, so guessed registration IDs and direct URLs cannot read files.
  handlers.getCompetitionMaterials = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data?.registrationId);
    const {registration, team} = await db.runTransaction((tx) => registrationAccess(tx, registrationId, user));
    if (!eligibleForMaterials(registration, team, user.uid)) {
      fail('failed-precondition', 'Bahan lomba tersedia setelah pembayaran dan tiket diterima (ACC).');
    }
    try {
      return await readCategoryMaterials(registration.package);
    } catch (error) {
      logger.error('materials_bundle_unavailable', {package: registration.package, code: error?.code || 'missing-bundle'});
      fail('unavailable', 'Bahan lomba belum dapat diunduh. Coba kembali atau hubungi panitia.');
    }
  };
  handlers.getCompetitionContext = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data.registrationId);
    const {registration, team, leader, canEdit} = await db.runTransaction((tx) => registrationAccess(tx, registrationId, user));
    const scope = scopeFor(registration);
    const [period, submission, results, config, challenges, solves, certificates] = await Promise.all([
      db.doc(`periods/${registration.periodId}`).get(), db.doc(`submissions/${registrationId}`).get(), activeResults(scope), db.doc(`competitionConfigs/${scope}`).get(),
      registration.package === 'cyber' ? db.collection(`ctfSecrets/${scope}/challenges`).get() : Promise.resolve({docs: []}),
      db.collection(`flagSolves/${registrationId}/challenges`).get(), db.collection('certificates').where('ownerUid', '==', user.uid).where('registrationId', '==', registrationId).get()
    ]);
    const work = submission.data();
    const schedule = scheduleFor(period.data(), registration);
    const resultRow = results?.rows?.find((item) => item.registrationId === registrationId) || null;
    const files = await Promise.all((work?.artifactIds || []).map(async (key) => {
      const item = (await db.doc(`submissionUploads/${key}`).get()).data();
      return item ? {uploadId: key, fileName: item.fileName, sizeBytes: item.sizeBytes, mimeType: item.mimeType} : null;
    }));
    // Never use a Firebase UID as a visible participant name. This projection is
    // only returned AFTER registrationAccess verifies the caller belongs to this
    // team. Names are optional; a missing/legacy profile gets a neutral label.
    const teamMembers = registration.package === 'team'
      ? await Promise.all((Array.isArray(team.memberUids) ? team.memberUids : [registration.userId]).slice(0, 4).map(async (uid, index) => {
        const isLeader = uid === registration.userId;
        if (isLeader) return {uid, name: text(registration.userName, 100) || 'Ketua tim', role: 'leader'};
        let displayName = '';
        try {
          const memberProfile = (await db.doc(`users/${uid}`).get()).data() || {};
          // Prefer the verified account's own profile; do not return email,
          // phone, or private profile fields to teammates.
          displayName = text(memberProfile.participantName || memberProfile.legalName || memberProfile.displayName, 100);
        } catch (error) {
          logger.warn('team_member_name_unavailable', {code: error?.code || 'read-failed'});
        }
        return {uid, name: displayName || `Anggota tim ${index + 1}`, role: 'member'};
      }))
      : null;
    return {serverNow: Date.now(), materialsAvailable: eligibleForMaterials(registration, team, user.uid), registration: {registrationId, userName: registration.userName, referenceNumber: registration.referenceNumber, periodId: registration.periodId, package: registration.package, packageLabel: registration.packageLabel, wave: registration.wave, waveLabel: registration.waveLabel, status: registration.status, paymentStatus: registration.paymentStatus, rejectionReason: registration.rejectionReason, ticketNumber: registration.ticketNumber, teamName: registration.teamName, memberCount: registration.memberCount},
      leader, canEdit, team: registration.package === 'team' ? {leaderUid: registration.userId, memberUids: team.memberUids, editorUids: team.editorUids || [], members: teamMembers} : null, schedule,
      submission: work ? {...work, effectiveStatus: work.status === 'reviewed' ? 'reviewed' : work.submittedAt && Date.now() > schedule.deadlineAt ? 'locked' : work.status} : null,
      files: files.filter(Boolean), rubric: RUBRICS[registration.package], result: resultRow, resultsRevision: results?.revision || null,
      appealDeadlineAt: millis(config.data()?.appealDeadlineAt) || null,
      challenges: challenges.docs.filter((doc) => doc.data().active === true).map((doc) => ({id: doc.id, title: doc.data().title, points: doc.data().points, solved: solves.docs.some((solve) => solve.id === doc.id)})),
      certificates: certificates.docs.map((doc) => ({id: doc.id, revoked: doc.data().revoked === true, resultRevision: doc.data().resultRevision, name: doc.data().recipientName}))};
  };
  handlers.getParticipantWorkspace = async (request) => {
    const user = await participant(request);
    const [profile, own, teams, notices] = await Promise.all([
      db.doc(`users/${user.uid}`).get(), db.collection('registrations').where('userId', '==', user.uid).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('teams').where('memberUids', 'array-contains', user.uid).limit(50).get(), db.collection(`users/${user.uid}/notifications`).orderBy('createdAt', 'desc').limit(20).get()
    ]);
    const registrations = new Map(own.docs.map((doc) => [doc.id, doc.data()]));
    for (const team of teams.docs) {
      if (!registrations.has(team.id)) {
        const doc = await db.doc(`registrations/${team.id}`).get();
        if (doc.exists && doc.data().active !== false) registrations.set(doc.id, doc.data());
      }
    }
    const items = await Promise.all([...registrations].map(async ([registrationId, reg]) => {
      const [period, work, result] = await Promise.all([db.doc(`periods/${reg.periodId}`).get(), db.doc(`submissions/${registrationId}`).get(), activeResults(scopeFor(reg))]);
      const schedule = scheduleFor(period.data(), reg);
      return {registrationId, referenceNumber: reg.referenceNumber, package: reg.package, packageLabel: reg.packageLabel, wave: reg.wave, waveLabel: reg.waveLabel, periodId: reg.periodId, periodLabel: reg.periodLabel, active: reg.active !== false, materialsAvailable: Boolean(reg.active !== false && reg.status === 'terverifikasi' && reg.paymentStatus === 'sesuai' && /^ECF-(?!ECF-)[A-Z0-9_-]{4,80}$/.test(String(reg.ticketNumber || ''))), status: reg.status, paymentStatus: reg.paymentStatus, rejectionReason: reg.rejectionReason || '', ticketNumber: reg.ticketNumber || '', proofAttached: reg.paymentProofAttached === true,
        submissionStatus: work.data()?.submittedAt && Date.now() > schedule.deadlineAt ? work.data()?.status === 'reviewed' ? 'reviewed' : 'locked' : work.data()?.status || 'belum_ada', submissionRevision: work.data()?.revision || 0, schedule, result: result?.rows?.find((item) => item.registrationId === registrationId) || null};
    }));
    const data = profile.data() || {};
    return {serverNow: Date.now(), profile: {participantName: data.participantName, profileComplete: data.profileComplete, institution: data.institution, city: data.city}, registrations: items,
      notices: notices.docs.map((doc) => ({id: doc.id, title: doc.data().title, message: doc.data().message, createdAt: millis(doc.data().createdAt), read: doc.data().read === true})), truncated: own.size === 50 || teams.size === 50};
  };

  // Isolated callable with Secret Manager binding. Flags/answers never enter public documents or logs.
  const submitFlag = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data.registrationId);
    const challengeId = id(request.data.challengeId);
    const supplied = required(request.data.flag, 'Flag', 1, 500);
    const {registration, leader} = await db.runTransaction((tx) => registrationAccess(tx, registrationId, user));
    if (!leader || registration.package !== 'cyber') fail('permission-denied', 'Flag hanya untuk peserta CTF individu.');
    const scope = scopeFor(registration);
    const expected = flagDigest(process.env.CTF_FLAG_PEPPER, scope, challengeId, supplied);
    return db.runTransaction(async (tx) => {
      const solveRef = db.doc(`flagSolves/${registrationId}/challenges/${challengeId}`);
      const counterRef = db.doc(`securityRateLimits/${sha256(`ctf:${user.uid}:${Math.floor(Date.now() / 60000)}`)}`);
      const [period, challenge, solved, counter, submission] = await Promise.all([
        tx.get(db.doc(`periods/${registration.periodId}`)), tx.get(db.doc(`ctfSecrets/${scope}/challenges/${challengeId}`)), tx.get(solveRef), tx.get(counterRef), tx.get(db.doc(`submissions/${registrationId}`))
      ]);
      assertWindow(registration, period.data());
      if (['locked', 'reviewed'].includes(submission.data()?.status)) fail('failed-precondition', 'Kiriman sudah dikunci.');
      if (!challenge.exists || challenge.data().active !== true) fail('not-found', 'Challenge tidak aktif.');
      if (solved.exists) return {accepted: true, alreadySolved: true, points: solved.data().points};
      const count = Number(counter.data()?.count || 0);
      if (count >= 10) fail('resource-exhausted', 'Batas 10 percobaan per menit. Tunggu sebentar.');
      const accepted = sameDigest(expected, challenge.data().digest);
      tx.set(counterRef, {count: count + 1, action: 'submitFlag', expiresAt: Timestamp.fromMillis(Date.now() + 120000)});
      if (accepted) {
        tx.create(solveRef, {challengeId, registrationId, ownerUid: user.uid, points: challenge.data().points, challengeRevision: challenge.data().revision || 1, solvedAt: stamp()});
        event(tx, {...user, role: 'participant'}, 'ctf.flag_accepted', 'submission', registrationId, {challengeId});
      }
      return {accepted, points: accepted ? challenge.data().points : 0};
    });
  };

  const flagPercentage = async (registrationId, scope) => {
    const [challenges, solves] = await Promise.all([db.collection(`ctfSecrets/${scope}/challenges`).get(), db.collection(`flagSolves/${registrationId}/challenges`).get()]);
    const active = challenges.docs.filter((doc) => doc.data().active === true);
    const total = active.reduce((sum, doc) => sum + Number(doc.data().points || 0), 0);
    if (total <= 0) fail('failed-precondition', 'Konfigurasi challenge CTF belum disahkan.');
    const earned = active.reduce((sum, doc) => sum + (solves.docs.some((solve) => solve.id === doc.id) ? Number(doc.data().points || 0) : 0), 0);
    return Math.round(earned / total * 1000000) / 10000;
  };
  handlers.assignJudge = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const judgeUid = request.data.judgeUid ? id(request.data.judgeUid) : actor.uid;
    const ref = db.doc(`juryAssignments/${gradeId(registrationId, judgeUid)}`);
    const judge = await auth.getUser(judgeUid);
    if (judge.disabled || !judge.emailVerified) fail('failed-precondition', 'Akun admin penilai harus aktif dan terverifikasi.');
    await db.runTransaction(async (tx) => {
      const [regDoc, workDoc, admin, prior] = await Promise.all([tx.get(db.doc(`registrations/${registrationId}`)), tx.get(db.doc(`submissions/${registrationId}`)), tx.get(db.doc(`admins/${judgeUid}`)), tx.get(ref)]);
      const reg = regDoc.data(), work = workDoc.data();
      if (!reg || reg.active === false || reg.status !== 'terverifikasi' || !work?.submittedAt) fail('failed-precondition', 'Karya final dan pendaftaran diterima diperlukan.');
      const [periodDoc, resultDoc, teamDoc] = await Promise.all([tx.get(db.doc(`periods/${reg.periodId}`)), tx.get(db.doc(`results/${scopeFor(reg)}`)), tx.get(db.doc(`teams/${registrationId}`))]);
      if (Date.now() <= scheduleFor(periodDoc.data(), reg).deadlineAt) fail('failed-precondition', 'Penugasan penilaian dibuka setelah deadline.');
      if (resultDoc.data()?.published === true) fail('failed-precondition', 'Hasil sudah diumumkan.');
      if (admin.data()?.active !== true) fail('failed-precondition', 'Penilai harus administrator aktif.');
      if (reg.userId === judgeUid || teamDoc.data()?.memberUids?.includes(judgeUid)) fail('permission-denied', 'Juri tidak boleh menilai karya sendiri atau timnya.');
      if (prior.data()?.active === true) return;
      tx.set(ref, {registrationId, judgeUid, scope: scopeFor(reg), submissionRevision: work.revision, active: true, assignedAt: stamp(), assignedByUid: actor.uid});
      tx.update(db.doc(`submissions/${registrationId}`), {status: 'locked', lockedAt: stamp()});
      event(tx, actor, 'jury.assigned', 'submission', registrationId, {judgeUid, submissionRevision: work.revision});
    });
    return {ok: true};
  };
  handlers.deactivateJudgeAssignment = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const judgeUid = id(request.data.judgeUid);
    const reason = required(request.data.reason, 'Alasan pencabutan penugasan', 10, 1000);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`juryAssignments/${gradeId(registrationId, judgeUid)}`);
      const assignment = await tx.get(ref);
      if (!assignment.data()?.active) fail('not-found', 'Penugasan aktif tidak ditemukan.');
      const result = await tx.get(db.doc(`results/${assignment.data().scope}`));
      if (result.data()?.published === true) fail('failed-precondition', 'Tarik pengumuman sebelum mencabut penugasan.');
      tx.update(ref, {active: false, revokedAt: stamp()});
      event(tx, actor, 'jury.assignment_revoked', 'submission', registrationId, {judgeUid, reason});
    });
    return {ok: true};
  };
  handlers.getJuryWorkspace = async (request) => {
    const actor = await authorize(request);
    let query = db.collection('juryAssignments').where('judgeUid', '==', actor.uid).where('active', '==', true).orderBy('__name__');
    if (request.data?.cursor) query = query.startAfter(id(request.data.cursor));
    const assignments = await query.limit(50).get();
    const items = await Promise.all(assignments.docs.map(async (doc) => {
      const assignment = doc.data();
      const [registrationDoc, submissionDoc, gradeDoc, results] = await Promise.all([db.doc(`registrations/${assignment.registrationId}`).get(), db.doc(`submissions/${assignment.registrationId}`).get(), db.doc(`juryGrades/${doc.id}`).get(), activeResults(assignment.scope)]);
      const reg = registrationDoc.data();
      return {assignmentId: doc.id, ...assignment, registration: {referenceNumber: reg?.referenceNumber, package: reg?.package, packageLabel: reg?.packageLabel, teamName: reg?.teamName}, submission: submissionDoc.data() || null, grade: gradeDoc.data() || null, rubric: RUBRICS[reg?.package], flagScore: reg?.package === 'cyber' ? await flagPercentage(assignment.registrationId, assignment.scope) : null, resultsPublished: Boolean(results)};
    }));
    return {assignments: items, nextCursor: assignments.size === 50 ? assignments.docs.at(-1).id : null};
  };
  handlers.saveJuryGrade = async (request) => {
    const actor = await authorize(request);
    const input = request.data;
    const registrationId = id(input.registrationId);
    const key = gradeId(registrationId, actor.uid);
    const assignmentRef = db.doc(`juryAssignments/${key}`);
    const assignment = await assignmentRef.get();
    if (!assignment.data()?.active || assignment.data()?.judgeUid !== actor.uid) fail('permission-denied', 'Penugasan juri tidak tersedia.');
    const regDoc = await db.doc(`registrations/${registrationId}`).get();
    const reg = regDoc.data();
    const flags = reg?.package === 'cyber' ? await flagPercentage(registrationId, assignment.data().scope) : null;
    let total;
    try { total = weightedScore(reg.package, input.scores, flags); } catch (error) { fail('invalid-argument', error.message); }
    const scores = {...input.scores};
    if (reg.package === 'cyber') scores.flags = flags;
    const comment = required(input.comment, 'Komentar penilaian', 10, 3000);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`juryGrades/${key}`);
      const [assignmentDoc, work, prior, results, currentReg] = await Promise.all([tx.get(assignmentRef), tx.get(db.doc(`submissions/${registrationId}`)), tx.get(ref), tx.get(db.doc(`results/${assignment.data().scope}`)), tx.get(db.doc(`registrations/${registrationId}`))]);
      if (!assignmentDoc.data()?.active || !work.data()?.submittedAt || work.data().revision !== assignmentDoc.data().submissionRevision || currentReg.data()?.active === false || currentReg.data()?.status !== 'terverifikasi') fail('failed-precondition', 'Penugasan atau karya berubah.');
      if (prior.data()?.finalized === true || results.data()?.published === true) fail('failed-precondition', 'Penilaian sudah dikunci.');
      revision(input.expectedRevision, prior.data()?.revision);
      const next = Number(prior.data()?.revision || 0) + 1;
      tx.set(ref, {registrationId, scope: assignment.data().scope, judgeUid: actor.uid, scores, total, comment, finalized: input.finalize === true, revision: next, submissionRevision: work.data().revision, rubricHash: sha256(canonical(RUBRICS[reg.package])), updatedAt: stamp(), finalizedAt: input.finalize === true ? stamp() : null});
      event(tx, actor, input.finalize ? 'jury.grade_finalized' : 'jury.grade_saved', 'submission', registrationId, {gradeRevision: next});
    });
    return {ok: true, total};
  };
  handlers.reopenJuryGrade = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const judgeUid = id(request.data.judgeUid);
    const reason = required(request.data.reason, 'Alasan pembukaan ulang', 10, 1000);
    const key = gradeId(registrationId, judgeUid);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`juryGrades/${key}`);
      const prior = await tx.get(ref);
      if (!prior.exists) fail('not-found', 'Penilaian tidak ditemukan.');
      const results = await tx.get(db.doc(`results/${prior.data().scope}`));
      if (results.data()?.published === true) fail('failed-precondition', 'Tarik pengumuman sebelum mengubah nilai final.');
      tx.update(ref, {finalized: false, revision: Number(prior.data().revision) + 1, reopenedAt: stamp()});
      event(tx, actor, 'jury.grade_reopened', 'submission', registrationId, {judgeUid, reason});
    });
    return {ok: true};
  };
  handlers.getSubmissionFile = async (request) => {
    const user = requireVerified(request);
    const uploadId = id(request.data.uploadId);
    const file = (await db.doc(`submissionUploads/${uploadId}`).get()).data();
    if (!file || !['attached', 'uploaded'].includes(file.status)) fail('not-found', 'Lampiran karya tidak tersedia.');
    let allowed = false;
    try { await db.runTransaction((tx) => registrationAccess(tx, file.registrationId, user)); allowed = true; } catch (error) { if (error.code !== 'permission-denied') throw error; }
    if (!allowed) {
      if (file.status !== 'attached') fail('permission-denied', 'Lampiran belum disertakan dalam karya.');
      // With two account types, only Admin may inspect another member's work.
      await authorize(request);
    }
    const [bytes] = await bucket.file(file.storagePath).download();
    if (sha256(bytes) !== file.sha256) fail('data-loss', 'Integritas lampiran gagal. Hubungi panitia.');
    return {base64: bytes.toString('base64'), fileName: file.fileName || 'lampiran', mimeType: file.mimeType};
  };

  handlers.configureCompetition = async (request) => {
    const actor = await authorize(request);
    const input = scopeInput(request.data);
    const reason = required(request.data.reason, 'Dasar keputusan panitia', 10, 1000);
    const count = Number(request.data.requiredJudgeCount);
    const appealDeadline = Date.parse(request.data.appealDeadlineAt || '');
    if (!Number.isInteger(count) || count < 1 || count > 5 || !Number.isFinite(appealDeadline)) fail('invalid-argument', 'Tetapkan 1–5 juri dan batas klarifikasi yang resmi.');
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`competitionConfigs/${input.scope}`);
      const [period, prior, results] = await Promise.all([tx.get(db.doc(`periods/${input.periodId}`)), tx.get(ref), tx.get(db.doc(`results/${input.scope}`))]);
      if (!period.exists) fail('not-found', 'Periode tidak ditemukan.');
      const announcement = scheduleFor(period.data(), input).announcementAt;
      if (!Number.isFinite(announcement) || appealDeadline <= announcement) fail('invalid-argument', 'Batas klarifikasi harus setelah jadwal pengumuman kategori.');
      if (results.data()?.published === true) fail('failed-precondition', 'Tarik hasil sebelum mengubah kebijakan penjurian.');
      revision(request.data.expectedRevision, prior.data()?.revision);
      tx.set(ref, {...input, requiredJudgeCount: count, appealDeadlineAt: Timestamp.fromMillis(appealDeadline), tiePolicy: 'explicit_committee_decision', rubricHash: sha256(canonical(RUBRICS[input.package])), revision: Number(prior.data()?.revision || 0) + 1, updatedAt: stamp()});
      event(tx, actor, 'competition.policy_approved', 'competition', input.scope, {reason, requiredJudgeCount: count, appealDeadlineAt: appealDeadline});
    });
    return {ok: true};
  };
  handlers.setDisqualification = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const reason = required(request.data.reason, 'Dasar keputusan', 10, 1500);
    await db.runTransaction(async (tx) => {
      const reg = await tx.get(db.doc(`registrations/${registrationId}`));
      if (!reg.exists) fail('not-found', 'Pendaftaran tidak ditemukan.');
      const scope = scopeFor(reg.data());
      const ref = db.doc(`competitionDecisions/${registrationId}`);
      const [results, prior] = await Promise.all([tx.get(db.doc(`results/${scope}`)), tx.get(ref)]);
      if (results.data()?.published === true) fail('failed-precondition', 'Tarik pengumuman sebelum mengubah status kelayakan.');
      revision(request.data.expectedRevision, prior.data()?.revision);
      tx.set(ref, {registrationId, scope, disqualified: request.data.disqualified === true, reason, revision: Number(prior.data()?.revision || 0) + 1, updatedAt: stamp()});
      event(tx, actor, 'competition.eligibility_changed', 'registration', registrationId, {disqualified: request.data.disqualified === true, reason});
      notify(tx, reg.data().userId, 'Kelayakan kompetisi diperbarui', request.data.disqualified === true ? `Panitia mencatat diskualifikasi: ${reason}` : 'Panitia memulihkan kelayakan kompetisi Anda.', registrationId);
    });
    return {ok: true};
  };
  const buildResults = async (tx, input) => {
    const scope = input.scope;
    const queries = [queryScope('submissions', scope), queryScope('juryAssignments', scope), queryScope('juryGrades', scope), queryScope('competitionDecisions', scope),
      db.collection('registrations').where('periodId', '==', input.periodId).where('package', '==', input.package).where('wave', '==', input.wave)];
    const [periodDoc, configDoc, works, assignments, grades, decisions, regs] = await Promise.all([tx.get(db.doc(`periods/${input.periodId}`)), tx.get(db.doc(`competitionConfigs/${scope}`)), ...queries.map((query) => tx.get(query))]);
    const config = configDoc.data();
    if (!config || !Number.isInteger(config.requiredJudgeCount)) fail('failed-precondition', 'Panitia harus mengesahkan jumlah juri dan periode klarifikasi terlebih dahulu.');
    const schedule = scheduleFor(periodDoc.data(), input);
    if (!Number.isFinite(schedule.deadlineAt) || Date.now() <= schedule.deadlineAt) fail('failed-precondition', 'Hasil hanya disusun setelah deadline.');
    if (regs.size > 100 || works.size > 100 || assignments.size > 500) fail('resource-exhausted', 'Lingkup melebihi batas transaksi. Hubungi pengelola sebelum menambah kuota.');
    const rows = [];
    for (const work of works.docs) {
      const submission = work.data();
      const reg = regs.docs.find((doc) => doc.id === work.id)?.data();
      if (!submission.submittedAt || !reg || reg.active === false || reg.status !== 'terverifikasi') continue;
      const decision = decisions.docs.find((doc) => doc.id === work.id)?.data();
      const displayName = submission.payload.publicNameConsent === true ? (reg.package === 'team' ? reg.teamName : reg.userName) : (reg.ticketNumber || reg.referenceNumber);
      if (decision?.disqualified === true) {rows.push({registrationId: work.id, displayName, total: null, rank: null, disqualified: true, certificateEligible: false}); continue;}
      const assigned = assignments.docs.filter((doc) => doc.data().registrationId === work.id && doc.data().active === true);
      const finalGrades = assigned.map((assignment) => grades.docs.find((grade) => grade.id === assignment.id)?.data());
      if (assigned.length < config.requiredJudgeCount || finalGrades.some((grade) => !grade?.finalized || grade.submissionRevision !== submission.revision || grade.rubricHash !== config.rubricHash)) fail('failed-precondition', `Penilaian ${reg.referenceNumber || work.id} belum lengkap/final sesuai kebijakan.`);
      const total = Math.round(finalGrades.reduce((sum, grade) => sum + grade.total, 0) / finalGrades.length * 10000) / 10000;
      rows.push({registrationId: work.id, displayName, total, rank: null, disqualified: false, certificateEligible: true});
    }
    if (!rows.length) fail('failed-precondition', 'Belum ada karya final yang dapat diumumkan.');
    const documents = [periodDoc, configDoc, ...works.docs, ...assignments.docs, ...grades.docs, ...decisions.docs, ...regs.docs];
    const fingerprint = sha256(canonical(documents.map((doc) => [doc.ref.path, doc.data()]).sort(([a], [b]) => a.localeCompare(b))));
    return {rows, fingerprint, announcementAt: schedule.announcementAt, appealDeadlineAt: millis(config.appealDeadlineAt)};
  };
  const rankRows = (rows, tieOrder = [], tieReason = '') => {
    const eligible = rows.filter((item) => !item.disqualified).sort((a, b) => b.total - a.total);
    for (let start = 0; start < eligible.length;) {
      let end = start + 1;
      while (end < eligible.length && eligible[end].total === eligible[start].total) end++;
      if (end - start > 1 && start < 3) {
        const group = eligible.slice(start, end);
        if (tieReason.length < 10 || !group.every((item) => tieOrder.includes(item.registrationId)) || new Set(tieOrder).size !== tieOrder.length) fail('failed-precondition', 'Skor seri memengaruhi Top 3. Panitia harus menetapkan urutan lengkap kelompok seri beserta dasar keputusan.');
        group.sort((a, b) => tieOrder.indexOf(a.registrationId) - tieOrder.indexOf(b.registrationId));
        eligible.splice(start, group.length, ...group);
      }
      start = end;
    }
    eligible.forEach((item, index) => {item.rank = index >= 3 && index > 0 && item.total === eligible[index - 1].total && eligible[index - 1].rank >= 4 ? eligible[index - 1].rank : index + 1;});
    return [...eligible, ...rows.filter((item) => item.disqualified)];
  };
  handlers.prepareResults = async (request) => {
    const actor = await authorize(request);
    const input = scopeInput(request.data);
    const tieOrder = Array.isArray(request.data.tieOrder) ? request.data.tieOrder.map(id).slice(0, 100) : [];
    const tieReason = text(request.data.tieReason, 1500);
    return db.runTransaction(async (tx) => {
      const built = await buildResults(tx, input);
      const results = await tx.get(db.doc(`results/${input.scope}`));
      if (results.data()?.published === true) fail('failed-precondition', 'Hasil sudah diumumkan.');
      const draftId = crypto.randomUUID();
      const rows = rankRows(built.rows, tieOrder, tieReason);
      tx.set(db.doc(`resultDrafts/${input.scope}`), {...input, ...built, rows, draftId, tieOrder, tieReason, createdAt: stamp()});
      event(tx, actor, 'results.prepared', 'competition', input.scope, {draftId, count: rows.length, tieReason});
      return {draftId, rows, fingerprint: built.fingerprint, expectedRevision: results.data()?.revision || 0, announcementAt: built.announcementAt};
    });
  };
  handlers.publishResults = async (request) => {
    const actor = await authorize(request);
    const input = scopeInput(request.data);
    const reason = required(request.data.reason, 'Catatan pengesahan hasil', 10, 1000);
    return db.runTransaction(async (tx) => {
      const [draftDoc, prior, built] = await Promise.all([tx.get(db.doc(`resultDrafts/${input.scope}`)), tx.get(db.doc(`results/${input.scope}`)), buildResults(tx, input)]);
      const draft = draftDoc.data();
      revision(request.data.expectedRevision, prior.data()?.revision);
      if (!draft || draft.draftId !== request.data.draftId || draft.fingerprint !== built.fingerprint) fail('aborted', 'Pratinjau hasil berubah. Susun dan periksa kembali.');
      if (prior.data()?.published === true) fail('already-exists', 'Hasil sudah diumumkan.');
      if (!Number.isFinite(built.announcementAt) || Date.now() < built.announcementAt) fail('failed-precondition', 'Jadwal pengumuman resmi belum tiba.');
      const rows = rankRows(built.rows, draft.tieOrder, draft.tieReason);
      const resultRevision = Number(prior.data()?.revision || 0) + 1;
      const regs = await Promise.all(rows.map((entry) => tx.get(db.doc(`registrations/${entry.registrationId}`))));
      tx.set(db.doc(`results/${input.scope}`), {...input, rows, revision: resultRevision, published: true, announcementAt: Timestamp.fromMillis(built.announcementAt), publishedAt: stamp(), fingerprint: built.fingerprint});
      rows.forEach((entry, index) => {
        tx.update(db.doc(`submissions/${entry.registrationId}`), {status: 'reviewed', reviewedAt: stamp()});
        notify(tx, regs[index].data().userId, 'Hasil kompetisi diumumkan', 'Hasil yang telah disahkan tersedia di dashboard peserta.', entry.registrationId, `result_${input.scope}_${resultRevision}_${index}`);
      });
      event(tx, actor, 'results.published', 'competition', input.scope, {revision: resultRevision, reason, tieReason: draft.tieReason});
      return {ok: true, revision: resultRevision};
    });
  };
  handlers.unpublishResults = async (request) => {
    const actor = await requireAdmin(request);
    const input = scopeInput(request.data);
    const reason = required(request.data.reason, 'Alasan penarikan', 10, 1500);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`results/${input.scope}`);
      const prior = await tx.get(ref);
      if (!prior.exists || !prior.data().published) fail('failed-precondition', 'Hasil tidak sedang dipublikasikan.');
      revision(request.data.expectedRevision, prior.data().revision);
      tx.update(ref, {published: false, withdrawnAt: stamp()});
      // Certificate validation checks this publication and its exact revision on every lookup.
      event(tx, actor, 'results.withdrawn', 'competition', input.scope, {reason, revision: prior.data().revision});
    });
    return {ok: true};
  };
  // Public list of released scopes only. No unpublished scores, private IDs or
  // fabricated production awards are exposed. The local emulator can show its
  // isolated historical dataset through the same server-side release policy.
  handlers.getPublishedArchive = async () => {
    const snapshot = await db.collection('results').where('published', '==', true).limit(100).get();
    const items = snapshot.docs.map((doc) => {
      const result = doc.data();
      if (!officiallyReleased(result)) return null;
      const periodId = result.periodId;
      const track = result.package;
      const wave = result.wave;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) || !RUBRICS[track] || !['wave-01', 'wave-02'].includes(wave)) return null;
      if (doc.id !== `${periodId}__${track}__${wave}`) return null;
      return {periodId, package: track, wave, scope: doc.id};
    }).filter(Boolean).sort((a,b) => b.periodId.localeCompare(a.periodId)
      || ['web','cyber','team'].indexOf(a.package) - ['web','cyber','team'].indexOf(b.package)
      || a.wave.localeCompare(b.wave));
    return {items, truncated: snapshot.size === 100};
  };
  handlers.getPublishedResults = async (request) => {
    const input = scopeInput(request.data);
    const result = await activeResults(input.scope);
    if (!result) return {published: false, rows: []};
    return {published: true, scope: input.scope, revision: result.revision, rows: result.rows.map((entry) => ({entryId: sha256(entry.registrationId).slice(0, 16), displayName: entry.displayName, rank: entry.rank, total: entry.total, disqualified: entry.disqualified}))};
  };
  handlers.submitAppeal = async (request) => {
    const user = await participant(request);
    const registrationId = id(request.data.registrationId);
    const message = required(request.data.message, 'Penjelasan klarifikasi', 20, 3000);
    await db.runTransaction(async (tx) => {
      const {registration, leader} = await registrationAccess(tx, registrationId, user);
      const scope = scopeFor(registration);
      const [result, config, prior] = await Promise.all([tx.get(db.doc(`results/${scope}`)), tx.get(db.doc(`competitionConfigs/${scope}`)), tx.get(db.doc(`appeals/${registrationId}`))]);
      if (!leader || !officiallyReleased(result.data()) || !result.data().rows.some((entry) => entry.registrationId === registrationId)) fail('failed-precondition', 'Klarifikasi hanya untuk peserta/ketua setelah hasil resmi diumumkan sesuai jadwal.');
      const deadline = millis(config.data()?.appealDeadlineAt);
      if (!Number.isFinite(deadline) || Date.now() > deadline) fail('failed-precondition', 'Periode klarifikasi belum diatur atau sudah berakhir.');
      if (prior.data()?.status === 'open') fail('already-exists', 'Permintaan sebelumnya belum ditanggapi.');
      const next = Number(prior.data()?.revision || 0) + 1;
      tx.set(db.doc(`appeals/${registrationId}`), {registrationId, scope, userId: user.uid, message, status: 'open', response: '', revision: next, resultRevision: result.data().revision, createdAt: stamp()});
      event(tx, {...user, role: 'participant'}, 'appeal.submitted', 'registration', registrationId, {revision: next});
    });
    return {ok: true};
  };
  handlers.resolveAppeal = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const response = required(request.data.response, 'Tanggapan klarifikasi', 20, 3000);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`appeals/${registrationId}`);
      const prior = await tx.get(ref);
      if (prior.data()?.status !== 'open') fail('failed-precondition', 'Klarifikasi tidak sedang terbuka.');
      revision(request.data.expectedRevision, prior.data()?.revision);
      tx.update(ref, {status: 'resolved', response, revision: prior.data().revision + 1, resolvedAt: stamp()});
      event(tx, actor, 'appeal.resolved', 'registration', registrationId);
      notify(tx, prior.data().userId, 'Klarifikasi ditanggapi', response, registrationId);
    });
    return {ok: true};
  };

  // An administrator can print a clearly identified preview for imported internal
  // records. This is not a certificate issuance: it does not create entitlements,
  // public verification IDs, official results, or Storage objects.
  handlers.downloadCertificatePreview = async (request) => {
    await authorize(request);
    const registrationId = id(request.data.registrationId);
    const regDoc = await db.doc(`registrations/${registrationId}`).get();
    if (!regDoc.exists) fail('not-found', 'Pendaftaran tidak ditemukan.');
    const registration = regDoc.data();
    const result = await db.doc(`results/${scopeFor(registration)}`).get();
    const resultData = result.data();
    if (resultData?.demoFixture !== true) fail('failed-precondition', 'Pratinjau arsip internal hanya tersedia untuk data peninjauan. Untuk hasil yang sah, gunakan sertifikat resmi.');
    const row = resultData?.rows?.find((entry) => entry.registrationId === registrationId);
    if (!row) fail('failed-precondition', 'Data hasil untuk pendaftaran ini belum tersedia.');
    const profile = await db.doc(`users/${registration.userId}`).get();
    const recipientName = profile.data()?.legalName || profile.data()?.participantName || registration.userName || registration.teamName;
    const pdf = await PDFDocument.create();
    await drawEsoriaCertificatePreview(pdf, {
      recipientName,
      registrationId,
      category: registration.packageLabel || registration.package,
      period: registration.periodLabel || registration.periodId,
      wave: registration.waveLabel || registration.wave,
      rank: row.rank
    });
    const bytes = Buffer.from(await pdf.save());
    return {base64: bytes.toString('base64'), mimeType: 'application/pdf', fileName: `ESORIA-Pratinjau-${registrationId}.pdf`, previewOnly: true};
  };

  handlers.issueCertificate = async (request) => {
    const login = requireVerified(request);
    const adminDoc = await db.doc(`admins/${login.uid}`).get();
    const isAdmin = adminDoc.data()?.active === true;
    const issuer = isAdmin ? await authorize(request) : await participant(request);
    const registrationId = id(request.data.registrationId);
    return db.runTransaction(async (tx) => {
      const registrationRef = db.doc(`registrations/${registrationId}`);
      const teamRef = db.doc(`teams/${registrationId}`);
      const [regDoc, teamDoc] = await Promise.all([tx.get(registrationRef), tx.get(teamRef)]);
      if (!regDoc.exists || regDoc.data().active === false) fail('not-found', 'Pendaftaran aktif tidak ditemukan.');
      const registration = regDoc.data();
      const team = teamDoc.data() || {memberUids: [registration.userId]};
      const uid = isAdmin ? registration.userId : issuer.uid;
      if (!isAdmin && !team.memberUids.includes(uid)) fail('permission-denied', 'Pendaftaran bukan milik akun Anda.');
      const scope = scopeFor(registration);
      const [result, profile, work] = await Promise.all([tx.get(db.doc(`results/${scope}`)), tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`submissions/${registrationId}`))]);
      const entry = result.data()?.rows?.find((item) => item.registrationId === registrationId);
      if (!officiallyReleased(result.data())
        || !entry?.certificateEligible || entry.disqualified || !work.data()?.submittedAt || registration.status !== 'terverifikasi') {
        fail('failed-precondition', 'Sertifikat hanya diterbitkan setelah hasil resmi diumumkan dan kelayakan disahkan.');
      }
      if (isAdmin && (!entry.rank || entry.rank > 3)) fail('failed-precondition', 'Cetak admin hanya untuk pemenang resmi peringkat 1–3.');
      if (profile.data()?.profileComplete !== true || profile.data()?.archived === true || !team.memberUids.includes(uid)) fail('permission-denied', 'Identitas penerima belum lengkap atau tidak aktif.');
      const entitlement = sha256(`${registrationId}:${uid}:${result.data().revision}`);
      const mapRef = db.doc(`certificateEntitlements/${entitlement}`);
      const prior = await tx.get(mapRef);
      if (prior.exists) return {certificateId: prior.data().certificateId, duplicate: true};
      const certificateId = crypto.randomBytes(16).toString('hex');
      const recipientName = required(profile.data().legalName || profile.data().participantName, 'Nama legal', 2, 100);
      const data = {certificateId, registrationId, scope, ownerUid: uid, recipientName, publicName: uid === registration.userId && work.data()?.payload?.publicNameConsent === true ? recipientName : maskName(recipientName), packageLabel: registration.packageLabel, periodLabel: registration.periodLabel, waveLabel: registration.waveLabel, rank: entry.rank <= 3 ? entry.rank : null, resultRevision: result.data().revision, revoked: false, issuedAt: stamp()};
      tx.create(db.doc(`certificates/${certificateId}`), data);
      tx.create(mapRef, {certificateId, ownerUid: uid, registrationId, resultRevision: result.data().revision});
      event(tx, issuer, 'certificate.issued', 'certificate', certificateId, {registrationId, resultRevision: result.data().revision, recipientUid: uid});
      notify(tx, uid, 'Sertifikat diterbitkan', 'Sertifikat Anda siap diunduh dari dashboard.', registrationId);
      return {certificateId, duplicate: false};
    });
  };
  const certificateState = async (certificateId) => {
    const certificate = await db.doc(`certificates/${certificateId}`).get();
    if (!certificate.exists) return {valid: false, status: 'not_found'};
    const data = certificate.data();
    // A legacy fabricated credential must never validate as an official award.
    if (data.demoFixture === true && !isolatedDatasetRuntime()) return {valid: false, status: 'not_found'};
    const results = await activeResults(data.scope);
    const entry = results?.rows?.find((item) => item.registrationId === data.registrationId);
    const valid = data.revoked !== true && results?.revision === data.resultRevision && entry?.certificateEligible === true && !entry?.disqualified;
    return {valid, status: data.revoked === true ? 'revoked' : valid ? 'valid' : 'withdrawn', data};
  };
  handlers.verifyCertificate = async (request) => {
    const certificateId = text(request.data.certificateId, 32);
    if (!/^[a-f0-9]{32}$/.test(certificateId)) return {valid: false, status: 'not_found'};
    const state = await certificateState(certificateId);
    if (!state.data) return {valid: false, status: state.status};
    const data = state.data;
    return {valid: state.valid, status: state.status, certificateId, recipient: data.publicName, category: data.packageLabel, period: data.periodLabel, wave: data.waveLabel, rank: data.rank, issuedAt: millis(data.issuedAt)};
  };
  handlers.revokeCertificate = async (request) => {
    const actor = await requireAdmin(request);
    const certificateId = id(request.data.certificateId);
    const reason = required(request.data.reason, 'Alasan pencabutan', 10, 1000);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`certificates/${certificateId}`);
      const prior = await tx.get(ref);
      if (!prior.exists) fail('not-found', 'Sertifikat tidak ditemukan.');
      if (prior.data().revoked === true) return;
      tx.update(ref, {revoked: true, revokedAt: stamp(), revocationReason: reason});
      event(tx, actor, 'certificate.revoked', 'certificate', certificateId, {reason});
      notify(tx, prior.data().ownerUid, 'Status sertifikat diperbarui', 'Panitia mencabut sertifikat. Hubungi kanal resmi untuk klarifikasi.', prior.data().registrationId);
    });
    return {ok: true};
  };
  handlers.downloadCertificate = async (request) => {
    const user = requireVerified(request);
    const certificateId = id(request.data.certificateId);
    const state = await certificateState(certificateId);
    if (!state.valid) fail('failed-precondition', 'Sertifikat tidak berlaku atau hasil belum disahkan.');
    if (state.data.ownerUid !== user.uid) await requireAdmin(request);
    const data = state.data;
    const {readFile} = await import('node:fs/promises');
    const pdf = await PDFDocument.create();
    let font;
    let unicodeFont = false;
    try {
      // A licensed Unicode font may be supplied by the project owner in the
      // private Functions asset directory. Do not require a bundled font file.
      const fontBytes = await readFile(new URL('./assets/DejaVuSans.ttf', import.meta.url));
      const {default: fontkit} = await import('@pdf-lib/fontkit');
      pdf.registerFontkit(fontkit);
      font = await pdf.embedFont(fontBytes, {subset: true});
      unicodeFont = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      font = await pdf.embedFont(StandardFonts.Helvetica);
      logger?.warn('certificate_unicode_font_missing', {message: 'Using Latin fallback for certificate PDF.'});
    }
    const pdfText = (value) => {
      const raw = String(value ?? '');
      if (unicodeFont) return raw;
      const normalized = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      return [...normalized].map((character) => {
        try { font.encodeText(character); return character; } catch { return '?'; }
      }).join('');
    };
    const titleFont = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const bodyBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    // Local emulator certificates may point to the isolated localhost site.
    // Production certificates must always use an HTTPS origin.
    const inLocalEmulator = isolatedDatasetRuntime();
    const origin = process.env.SITE_ORIGIN || (inLocalEmulator ? 'http://127.0.0.1:5000' : process.env.GCLOUD_PROJECT === 'esoria-codefest' ? 'https://esoria-codefest.web.app' : '');
    if (!origin) fail('failed-precondition', 'Origin verifikasi lingkungan ini belum dikonfigurasi.');
    const parsed = new URL(origin);
    const allowedLocal = inLocalEmulator && parsed.origin === 'http://127.0.0.1:5000';
    if (!(parsed.protocol === 'https:' || allowedLocal) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) fail('failed-precondition', 'Origin verifikasi sertifikat belum valid.');
    const verificationUrl = `${parsed.origin}/verify-certificate.html?id=${certificateId}`;
    await drawEsoriaCertificate({pdf, rgb, QRCode, font, titleFont, bodyBold, pdfText, data, certificateId, verificationUrl});
    pdf.setTitle(`Sertifikat ESORIA CodeFest ${certificateId}`);
    pdf.setAuthor('ESORIA CodeFest');
    const bytes = Buffer.from(await pdf.save());
    try {
      await bucket.file(`certificates/${data.ownerUid}/${certificateId}.pdf`).save(bytes, {resumable: false, contentType: 'application/pdf', metadata: {cacheControl: 'private,no-store', contentDisposition: 'attachment'}});
    } catch (error) {
      // The certificate entitlement is authoritative; PDF can always be regenerated.
      // A failed optional archive must not discard a PDF already rendered for its owner.
      logger?.warn('certificate_archive_failed', {code: error?.code || 'internal', targetHash: sha256(certificateId)});
    }
    return {base64: bytes.toString('base64'), fileName: `ESORIA-Sertifikat-${certificateId}.pdf`, mimeType: 'application/pdf', verificationUrl};
  };

  handlers.recordPrizePayment = async (request) => {
    const actor = await requireAdmin(request);
    const registrationId = id(request.data.registrationId);
    const reason = required(request.data.note, 'Catatan pembayaran hadiah', 10, 1000);
    const reference = required(request.data.reference, 'Referensi pembayaran manual', 3, 120);
    if (request.data.bankTransferConfirmed !== true) fail('invalid-argument', 'Konfirmasikan pembayaran hadiah dari catatan transfer resmi.');
    await db.runTransaction(async (tx) => {
      const reg = await tx.get(db.doc(`registrations/${registrationId}`));
      if (!reg.exists) fail('not-found', 'Pendaftaran tidak ditemukan.');
      const scope = scopeFor(reg.data());
      const [results, prior] = await Promise.all([tx.get(db.doc(`results/${scope}`)), tx.get(db.doc(`prizePayments/${registrationId}`))]);
      const entry = results.data()?.rows?.find((item) => item.registrationId === registrationId);
      if (!officiallyReleased(results.data())
        || !entry || entry.disqualified || !entry.rank || entry.rank > 3) {
        fail('failed-precondition', 'Hadiah hanya bisa dicatat bagi pemenang setelah pengumuman resmi.');
      }
      if (prior.data()?.paid === true) fail('already-exists', 'Hadiah telah dicatat dibayar. Periksa audit sebelum tindak lanjut.');
      tx.set(db.doc(`prizePayments/${registrationId}`), {registrationId, scope, paid: true, amountValue: PRIZES[reg.data().package][entry.rank - 1], rank: entry.rank, reference, note: reason, resultRevision: results.data().revision, paidAt: stamp(), paidByUid: actor.uid});
      event(tx, actor, 'prize.manual_payment_recorded', 'registration', registrationId, {amountValue: PRIZES[reg.data().package][entry.rank - 1], reference});
      notify(tx, reg.data().userId, 'Hadiah dicatat dibayar', 'Panitia telah mencatat pembayaran hadiah secara manual. Periksa penerimaan dana Anda.', registrationId);
    });
    return {ok: true};
  };
  handlers.reviewPayment = async (request) => {
    const actor = await authorize(request);
    return reviewRegistrationCore(actor, request.data);
  };
  handlers.getPaymentEvidence = async (request) => {
    const actor = await authorize(request);
    const registrationId = id(request.data.registrationId);
    const [registration, proofDoc] = await Promise.all([db.doc(`registrations/${registrationId}`).get(), db.doc(`paymentProofs/${registrationId}`).get()]);
    const reg = registration.data(), proof = proofDoc.data();
    if (!reg?.paymentProofAttached || !proof?.storagePath || Number.isFinite(millis(reg.proofRetentionUntil)) && millis(reg.proofRetentionUntil) < Date.now()) fail('not-found', 'Bukti tidak tersedia atau telah melewati masa retensi.');
    const [bytes] = await bucket.file(proof.storagePath).download();
    if (sha256(bytes) !== proof.sha256) fail('data-loss', 'Integritas bukti tidak cocok.');
    await auditRef(crypto.randomUUID()).set(auditData(actor, 'payment.evidence_accessed', 'registration', registrationId));
    return {base64: bytes.toString('base64'), mimeType: 'image/jpeg', fileName: 'bukti-transfer.jpg'};
  };
  handlers.getOperationsWorkspace = async (request) => {
    await authorize(request);
    const input = scopeInput(request.data);
    let query = db.collection('registrations').where('periodId', '==', input.periodId).where('package', '==', input.package).where('wave', '==', input.wave).orderBy('__name__');
    if (request.data.cursor) query = query.startAfter(id(request.data.cursor));
    const [regs, slot, period, count, pending, verified, workCount, policy, results] = await Promise.all([
      query.limit(50).get(), db.doc(`periodSlots/${input.scope}`).get(), db.doc(`periods/${input.periodId}`).get(),
      db.collection('registrations').where('periodId', '==', input.periodId).where('package', '==', input.package).where('wave', '==', input.wave).where('active', '==', true).count().get(),
      db.collection('registrations').where('periodId', '==', input.periodId).where('package', '==', input.package).where('wave', '==', input.wave).where('active', '==', true).where('status', '==', 'menunggu').count().get(),
      db.collection('registrations').where('periodId', '==', input.periodId).where('package', '==', input.package).where('wave', '==', input.wave).where('active', '==', true).where('status', '==', 'terverifikasi').count().get(),
      queryScope('submissions', input.scope).count().get(), db.doc(`competitionConfigs/${input.scope}`).get(), db.doc(`results/${input.scope}`).get()
    ]);
    const items = await Promise.all(regs.docs.map(async (doc) => {
      const reg = doc.data();
      const [work, decision, appeal, prize, assignments] = await Promise.all([
        db.doc(`submissions/${doc.id}`).get(),
        db.doc(`competitionDecisions/${doc.id}`).get(),
        db.doc(`appeals/${doc.id}`).get(),
        db.doc(`prizePayments/${doc.id}`).get(),
        db.collection('juryAssignments').where('registrationId', '==', doc.id).get()
      ]);
      return {
        registrationId: doc.id, userId: reg.userId, userName: reg.userName,
        referenceNumber: reg.referenceNumber, packageLabel: reg.packageLabel,
        status: reg.status, paymentStatus: reg.paymentStatus, ticketNumber: reg.ticketNumber,
        checkedIn: reg.checkedIn === true, checkedInAt: millis(reg.checkedInAt),
        active: reg.active !== false, teamName: reg.teamName, memberCount: reg.memberCount,
        reviewRevision: reg.reviewRevision || 0,
        amountValue: reg.amountValue, senderName: reg.senderName,
        senderInstitution: reg.senderInstitution, transferDate: reg.transferDate,
        rejectionReason: reg.rejectionReason, proofAttached: reg.paymentProofAttached === true,
        proofDuplicateSuspected: reg.proofDuplicateSuspected === true,
        submission: work.data() ? {
          status: work.data().status, revision: work.data().revision,
          title: work.data().payload?.title || '', submitted: Boolean(work.data().submittedAt),
          artifactIds: work.data().artifactIds, payload: work.data().payload
        } : null,
        decision: decision.data() || null, appeal: appeal.data() || null,
        prize: prize.data() || null,
        assignments: assignments.docs.map((entry) => ({id: entry.id, ...entry.data()}))
      };
    }));
    return {
      roles: ['admin'], admin: true, scope: input.scope, serverNow: Date.now(),
      schedule: period.exists ? scheduleFor(period.data(), input) : null,
      metrics: {
        registrations: count.data().count, pending: pending.data().count,
        verified: verified.data().count, submissions: workCount.data().count,
        capacity: slot.data()?.capacity || 0, occupiedSlots: slot.data()?.count || 0
      },
      policy: policy.data() || null, result: results.data() || null,
      items, nextCursor: regs.size === 50 ? regs.docs.at(-1).id : null
    };
  };
  handlers.exportCompetitionCsv = async (request) => {
    const actor = await authorize(request);
    const input = scopeInput(request.data);
    const results = await activeResults(input.scope);
    if (!results) fail('failed-precondition', 'Ekspor hasil dibuka setelah pengumuman disahkan.');
    const output = csv([['ID publik', 'Nama publik/tiket', 'Peringkat', 'Skor final', 'Diskualifikasi'], ...results.rows.map((entry) => [sha256(entry.registrationId).slice(0, 16), entry.displayName, entry.rank || '', entry.total ?? '', entry.disqualified ? 'Ya' : 'Tidak'])]);
    await auditRef(crypto.randomUUID()).set(auditData(actor, 'results.csv_exported', 'competition', input.scope, {rows: results.rows.length}));
    return {base64: Buffer.from(output).toString('base64'), fileName: `ESORIA-Hasil-${input.scope}.csv`, mimeType: 'text/csv;charset=utf-8'};
  };

  const purgeStaleUploads = async () => {
    const stale = await db.collection('submissionUploads').where('status', 'in', ['pending', 'uploaded', 'purging']).where('expiresAt', '<', Timestamp.fromMillis(Date.now() - 86400000)).limit(100).get();
    let purged = 0;
    for (const doc of stale.docs) {
      // Take a transaction lease; finalization/attachment sees purging and cannot reference it.
      const claimed = await db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        if (!['pending', 'uploaded', 'purging'].includes(current.data()?.status) || millis(current.data().expiresAt) > Date.now() - 86400000 || current.data().status === 'purging' && millis(current.data().purgeLeaseAt) > Date.now() - 360000) return false;
        tx.update(doc.ref, {status: 'purging', purgeLeaseAt: stamp()});
        return true;
      });
      if (!claimed) continue;
      try {
        await bucket.file(doc.data().storagePath).delete({ignoreNotFound: true});
        await doc.ref.update({status: 'purged', purgedAt: stamp()});
        purged++;
      } catch {
        await doc.ref.update({status: doc.data().status});
      }
    }
    const maintenanceRef = db.doc('system/storageMaintenance');
    const maintenance = (await maintenanceRef.get()).data() || {};
    const [files, next] = await bucket.getFiles({prefix: 'payment-proofs/', maxResults: 100, autoPaginate: false, ...(maintenance.proofPageToken ? {pageToken: maintenance.proofPageToken} : {})});
    let orphanProofs = 0;
    for (const file of files) {
      const parts = file.name.split('/');
      if (parts.length !== 4) continue;
      const created = Date.parse(file.metadata?.timeCreated || '');
      if (!Number.isFinite(created) || created > Date.now() - 48 * 3600000) continue;
      const reg = await db.doc(`registrations/${parts[2]}`).get();
      if (reg.data()?.proofStoragePath === file.name && reg.data()?.paymentProofAttached === true) continue;
      await file.delete({ignoreNotFound: true});
      orphanProofs++;
    }
    await maintenanceRef.set({proofPageToken: next?.pageToken || '', scannedAt: stamp()}, {merge: true});
    return {inspected: stale.size, purged, orphanProofs};
  };
  return {handlers, submitFlag, purgeStaleUploads, authorize};
}
