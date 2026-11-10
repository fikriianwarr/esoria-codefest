import crypto from 'node:crypto';

// Exact weights and prizes from the original three ticket pages, not sample rubrics.
export const RUBRICS = Object.freeze({
  web: { source: 'tickets/tiket-coding-individu.html', criteria: [
    ['functionality', 'Functionality', 30], ['responsive', 'Responsive UI', 25],
    ['code', 'Code & semantics', 25], ['documentation', 'Deployment & docs', 20]
  ] },
  cyber: { source: 'tickets/tiket-cybersecurity-individu.html', criteria: [
    ['flags', 'Valid flags & score', 40], ['analysis', 'Analysis methodology', 25],
    ['ethics', 'Safety & ethics', 20], ['writeup', 'Technical writeup', 15]
  ] },
  team: { source: 'tickets/tiket-tim-digital.html', criteria: [
    ['frontend', 'Frontend & UX', 25], ['backend', 'Backend & API', 25],
    ['data', 'Data architecture', 20], ['reliability', 'Reliability & deployment', 15],
    ['presentation', 'Presentation & documentation', 15]
  ] }
});
export const PRIZES = Object.freeze({web: [1500000, 1000000, 500000], cyber: [3000000, 2000000, 1000000], team: [6000000, 4000000, 2000000]});
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const canonical = (value) => JSON.stringify(value, (_, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    if (typeof item.toMillis === 'function') return item.toMillis();
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});
// Firebase callable responses must never contain NaN or Infinity. An absent
// timestamp is represented as null, not Date.parse('') (which returns NaN).
export const millis = (value) => {
  if (value == null || value === '') return null;
  const parsed = value?.toMillis?.() ?? (typeof value?.seconds === 'number'
    ? value.seconds * 1000 : (typeof value === 'number' ? value : Date.parse(value)));
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
// Reject malformed retention configuration before it reaches Firestore timestamps.
// Bounds also prevent a typo from setting an unreasonably large retention period.
export const boundedRetentionDays = (raw, fallback = 365) => {
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(30, Math.min(3650, Math.trunc(value))) : fallback;
};
// Shared release gate for public results, certificates and winner prize records.
export const isolatedDatasetRuntime = () => {
  const projectIds = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].filter(Boolean);
  return process.env.FUNCTIONS_EMULATOR === 'true' && projectIds.length > 0
    && projectIds.every((value) => value === 'demo-esoria-codefest');
};
export const officiallyReleased = (result, now = Date.now()) => {
  const announcedAt = millis(result?.announcementAt);
  // Published fixture is viewable ONLY inside a local isolated emulator, never in production.
  return (result?.demoFixture !== true || isolatedDatasetRuntime())
    && result?.published === true && Number.isFinite(announcedAt) && announcedAt <= now;
};
export const scopeFor = (registration) => `${registration.periodId}__${registration.package}__${registration.wave}`;
export const maskName = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((part) => `${Array.from(part)[0]}***`).join(' ');
export function attachmentName(value, mimeType) {
  const extension = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg'}[mimeType];
  if (!extension) throw new Error('Tipe lampiran tidak didukung.');
  const base = String(value || 'lampiran').split(/[\\/]/).at(-1)
    .replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/\.[a-z0-9]{1,16}$/i, '')
    .replace(/[. ]+$/g, '').slice(0, 100) || 'lampiran';
  return `${base}.${extension}`;
}
export function scheduleFor(period, registration) {
  const globalWave = period?.waves?.[registration.wave] || {};
  const wave = period?.packages?.[registration.package]?.waves?.[registration.wave] || globalWave;
  return {startsAt: millis(wave.startsAt), deadlineAt: millis(wave.deadlineAt || wave.closesAt || globalWave.closesAt), announcementAt: millis(wave.announcementAt || period?.announcementAt)};
}
export function safeHttps(value, {required = false} = {}) {
  const input = String(value || '').trim();
  if (!input && !required) return '';
  if (input.length > 1500) throw new Error('URL terlalu panjang.');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')
      || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)
      || url.hostname.endsWith('.local') || url.hostname.includes(':') || url.hash.includes('\u0000')) {
    throw new Error('Gunakan URL HTTPS publik tanpa kredensial.');
  }
  return url.href;
}
export function weightedScore(track, scores, flagScore = null) {
  const rubric = RUBRICS[track];
  if (!rubric || !scores || typeof scores !== 'object') throw new Error('Rubrik atau skor tidak valid.');
  if (Object.keys(scores).some((key) => !rubric.criteria.some(([id]) => key === id))) throw new Error('Kriteria di luar rubrik.');
  let total = 0;
  for (const [id, , weight] of rubric.criteria) {
    const score = track === 'cyber' && id === 'flags' ? flagScore : scores[id];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('Setiap skor harus angka 0–100.');
    total += score * weight / 100;
  }
  return Math.round(total * 10000) / 10000;
}
export function flagDigest(pepper, scope, challengeId, flag) {
  pepper = String(pepper || '').trim();
  if (!pepper || pepper.length < 32) throw new Error('Secret CTF belum dikonfigurasi.');
  return crypto.createHmac('sha256', pepper).update(`${scope}\n${challengeId}\n${String(flag).trim()}`).digest('hex');
}
export function sameDigest(actual, expected) {
  return /^[a-f0-9]{64}$/.test(String(actual)) && /^[a-f0-9]{64}$/.test(String(expected))
    && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export const csv = (rows) => '\ufeff' + rows.map((row) => row.map((value) => {
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}).join(',')).join('\r\n');
