// Pure workflow helpers: visual state only. Server API remains the authority.
export const PROCESS_STEPS = [
  ['01', 'Pendaftaran', 'Peserta terdaftar dan pembayaran diperiksa'],
  ['02', 'Pengumpulan', 'Karya dikirim dan tenggat berakhir'],
  ['03', 'Penugasan admin', 'Admin mengatur penilai setelah tenggat'],
  ['04', 'Penilaian', 'Admin menyimpan dan memfinalisasi nilai'],
  ['05', 'Pengesahan', 'Admin memeriksa lalu mengumumkan hasil']
];
export function assignmentAction(reg, schedule, result) {
  if (result?.published === true) return {enabled: false, reason: 'Hasil sudah diumumkan.'};
  if (!reg || reg.active === false || reg.status !== 'terverifikasi') return {enabled: false, reason: 'Pendaftaran belum diterima.'};
  if (!reg.submission?.submitted) return {enabled: false, reason: 'Karya belum dikirim secara final.'};
  if (!Number.isFinite(schedule?.deadlineAt)) return {enabled: false, reason: 'Tenggat kategori belum tersedia.'};
  if (Date.now() <= schedule.deadlineAt) return {enabled: false, reason: 'Penugasan dibuka setelah tenggat pengumpulan.'};
  return {enabled: true, reason: 'Karya dapat ditugaskan kepada administrator aktif.'};
}
// Frontend preflight only. The Cloud Function is the final authority for certificate issuance.
export function certificateAction(reg, result, {now = Date.now(), isolated = false} = {}) {
  if (!result?.published) return {enabled:false, reason:'Hasil belum disahkan dan diumumkan.'};
  if (result.demoFixture === true && !isolated) return {enabled:false, reason:'Riwayat internal tidak dapat diterbitkan sebagai sertifikat resmi.'};
  const announced = result.announcementAt;
  const announcedAt = announced?.toMillis?.() ?? (announced?._seconds != null ? announced._seconds * 1000 : announced?.seconds != null ? announced.seconds * 1000 : typeof announced === 'number' ? announced : Date.parse(announced || ''));
  if (!Number.isFinite(announcedAt) || announcedAt > now) return {enabled:false, reason:'Jadwal pengumuman resmi belum tercapai.'};
  const row = result.rows?.find((item) => item.registrationId === reg?.registrationId);
  if (!row || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > 3 || row.disqualified || row.certificateEligible !== true)
    return {enabled:false, reason:'Pendaftaran belum memenuhi kelayakan sertifikat pemenang.'};
  if (reg?.status !== 'terverifikasi' || reg?.active === false || !reg?.submission?.submitted)
    return {enabled:false, reason:'Pembayaran dan karya harus selesai serta tervalidasi sebelum sertifikat diterbitkan.'};
  return {enabled:true, reason:'Sertifikat pemenang dapat diunduh.'};
}
export function workflowPhase(data) {
  if (data?.result?.published) return 5;
  if (!Number.isFinite(data?.schedule?.deadlineAt) || Date.now() <= data.schedule.deadlineAt) return 2;
  if (!data?.policy?.requiredJudgeCount) return 3;
  return 4;
}
export function scoreEstimate(criteria, values) {
  if (!Array.isArray(criteria) || !criteria.length) return null;
  let sum = 0;
  for (const [key,,weight] of criteria) {
    const raw = values?.[key];
    if (raw === null || raw === '' || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    sum += value * Number(weight) / 100;
  }
  return Math.round(sum * 100) / 100;
}
export function jurySummary(assignments) {
  const list = Array.isArray(assignments) ? assignments : [];
  return {
    total: list.length,
    final: list.filter((item) => item.grade?.finalized === true).length,
    draft: list.filter((item) => item.grade && !item.grade.finalized).length,
    pending: list.filter((item) => !item.grade).length
  };
}
export function juryFilter(item, query = '', status = 'all') {
  const isFinal = Boolean(item.grade?.finalized || item.resultsPublished);
  const isDraft = Boolean(item.grade && !item.grade.finalized && !item.resultsPublished);
  if (status === 'final' && !isFinal || status === 'draft' && !isDraft || status === 'pending' && (isFinal || isDraft)) return false;
  const text = [item.registration?.referenceNumber, item.registration?.packageLabel, item.submission?.payload?.title].join(' ').toLocaleLowerCase('id-ID');
  return text.includes(String(query).trim().toLocaleLowerCase('id-ID'));
}
export function httpsUrl(value) {
  try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;} catch {return null;}
}
