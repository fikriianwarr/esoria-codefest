/** Shared, pure UI policy. Backend independently enforces every transition. */
export const normalizeOfficialTicket = (value = '') => String(value ?? '').trim().toUpperCase()
  .replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '')
  .replace(/^(?:ECF-){2,}/, 'ECF-').slice(0, 40);

export function registrationActions(reg = {}) {
  const active = reg.active !== false;
  const accepted = active && reg.status === 'terverifikasi';
  const checkedIn = accepted && reg.checkedIn === true;
  const reference = normalizeOfficialTicket(reg.referenceNumber);
  const ticket = normalizeOfficialTicket(reg.ticketNumber);
  const needsTicketRepair = accepted && Boolean(reference) &&
    (!reg.ticketNumber || String(reg.ticketNumber).trim().toUpperCase() !== reference || ticket !== reference);
  return {
    active, accepted, checkedIn, reference, ticket,
    needsTicketRepair,
    mayReview: active && !accepted,
    mayCancelAcc: accepted && !checkedIn,
    mayRepairTicket: accepted && !checkedIn && needsTicketRepair,
    mayCheckIn: accepted && !checkedIn && Boolean(reg.ticketNumber) && !needsTicketRepair,
    mayCancelCheckIn: checkedIn,
    mayArchive: active && !accepted && !checkedIn
  };
}
