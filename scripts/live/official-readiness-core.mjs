/**
 * Deterministic, read-only summaries of official competition release state.
 * Do not classify fixture records as real winners or genuine transactions.
 */
const timeValue = (value) => {
  if (value == null || value === '') return null;
  const valueMs = value?.toMillis?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000
    : typeof value === 'number' ? value : Date.parse(value));
  return Number.isFinite(valueMs) ? valueMs : null;
};

export function classifyPublicResult(record, now = Date.now()) {
  if (!record || record.demoFixture === true) return 'internal';
  if (record.published !== true) return 'unpublished';
  const announcement = timeValue(record.announcementAt);
  if (announcement == null) return 'missing-announcement';
  if (announcement > now) return 'scheduled';
  return 'public';
}

export function classifyCertificateCandidate({result, row, registration, submission, profile, now = Date.now()}) {
  if (classifyPublicResult(result, now) !== 'public') return 'result-not-public';
  if (!row || row.disqualified === true || row.certificateEligible !== true || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > 3)
    return 'not-eligible';
  if (!registration || registration.demoFixture === true || registration.active === false || registration.status !== 'terverifikasi')
    return 'registration-not-verified';
  if (!submission || submission.demoFixture === true || !submission.submittedAt)
    return 'submission-not-finished';
  if (!profile || profile.demoFixture === true || !String(profile.legalName || profile.participantName || '').trim())
    return 'identity-not-complete';
  return 'ready';
}

export function validPublicScope(item) {
  const result = item?.data || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(result.periodId || ''))) return false;
  if (!['web','cyber','team'].includes(result.package) || !['wave-01','wave-02'].includes(result.wave)) return false;
  return item.id === `${result.periodId}__${result.package}__${result.wave}`;
}

export function aggregateReadiness(results, {now = Date.now()} = {}) {
  const summary = {total: 0, public: 0, scheduled: 0, unpublished: 0, internal: 0, missingAnnouncement: 0, invalidScope: 0, publicScopes: []};
  for (const item of results) {
    summary.total++;
    const status = classifyPublicResult(item.data, now);
    if (status === 'public' && !validPublicScope(item)) summary.invalidScope++;
    else if (status === 'missing-announcement') summary.missingAnnouncement++;
    else summary[status]++;
    if (status === 'public' && validPublicScope(item)) summary.publicScopes.push(item.id);
  }
  return summary;
}

