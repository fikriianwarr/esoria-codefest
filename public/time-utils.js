export const WIB_TIME_ZONE = 'Asia/Jakarta';

export const wibParts = (date = new Date()) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value])
);

export const wibDateValue = (date = new Date()) => {
  const parts = wibParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const wibMonthValue = (date = new Date()) => {
  const parts = wibParts(date);
  return `${parts.year}-${parts.month}`;
};

export const wibDateTimeLocalValue = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return '';
  const parts = wibParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

// WIB tidak memakai daylight-saving time, sehingga offset selalu UTC+07:00.
export const wibIsoFromParts = (year, monthIndex, day, hour = 0, minute = 0) => (
  new Date(Date.UTC(year, monthIndex, day, hour - 7, minute, 0, 0)).toISOString()
);

export const formatWib = (value, options = {}) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return 'Belum tersedia';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TIME_ZONE,
    ...options
  }).format(date);
};

export const calculateAgeInWib = (birthDate, now = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) return null;
  const [birthYear, birthMonth, birthDay] = String(birthDate).split('-').map(Number);
  const birth = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));
  if (birth.getUTCFullYear() !== birthYear || birth.getUTCMonth() !== birthMonth - 1 || birth.getUTCDate() !== birthDay) return null;
  const parts = wibParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
};
