const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
const start = source.indexOf('const PERIOD_MONTH_NAMES = ');
const end = source.indexOf('const showToast = ', start);
if (start < 0 || end < 0) throw new Error('Template periode tidak ditemukan');
const sandbox = {
  wibIsoFromParts: (year, monthIndex, day, hour = 0, minute = 0) => new Date(Date.UTC(year, monthIndex, day, hour - 7, minute)).toISOString(),
  formatWib: () => '',
  document: {querySelector: () => null}
};
vm.runInNewContext(`${source.slice(start,end)}\nthis.build = buildMonthlyPeriodTemplate;`, sandbox);

test('October waves have independent registration windows, in WIB', () => {
  const period = sandbox.build('2026-10');
  assert.equal(period.registrationOpenAt, '2026-09-19T17:01:00.000Z');
  assert.equal(period.registrationCloseAt, '2026-10-14T16:59:00.000Z');
  assert.equal(period.waves['wave-01'].registrationCloseAt, '2026-09-30T16:59:00.000Z');
  assert.equal(period.waves['wave-02'].registrationOpenAt, '2026-10-04T17:01:00.000Z');
  assert.equal(period.waves['wave-02'].registrationCloseAt, '2026-10-14T16:59:00.000Z');
  assert.ok(new Date(period.waves['wave-01'].registrationCloseAt) < new Date(period.waves['wave-01'].startsAt));
  assert.ok(new Date(period.waves['wave-02'].registrationCloseAt) < new Date(period.waves['wave-02'].startsAt));
});

test('January period rolls registration for wave 01 into previous December', () => {
  const period = sandbox.build('2027-01');
  assert.equal(period.waves['wave-01'].registrationOpenAt, '2026-12-19T17:01:00.000Z');
  assert.equal(period.waves['wave-01'].registrationCloseAt, '2026-12-31T16:59:00.000Z');
  assert.equal(period.waves['wave-02'].registrationOpenAt, '2027-01-04T17:01:00.000Z');
  assert.equal(period.waves['wave-02'].startsAt, '2027-01-14T17:01:00.000Z');
});
