// The schedule page's 🗓 weekly timetable and its 📅 3-business-day trial
// notice. The functions are cut out of the SHIPPED schedule/index.html, so this
// fails if the page and the test ever disagree. The browser half of the check
// (rendering, clicks, phone widths, the booking document) is
// tools/schedule-timetable-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../schedule/index.html', import.meta.url), 'utf8');

function between(start, end) {
  const a = html.indexOf(start);
  assert.ok(a > -1, `The schedule page must still carry the marker "${start}".`);
  const b = html.indexOf(end, a + start.length);
  assert.ok(b > a, `The schedule page must still carry the marker "${end}" after "${start}".`);
  return html.slice(a, b);
}

const timetableConsts = between('// ─── Fixed weekly timetable ───', '// A fee left blank means');
const trialDates = between('// BEGIN TRIAL DATES', '// END TRIAL DATES');
const timetableModel = between('// BEGIN TIMETABLE MODEL', '// END TIMETABLE MODEL');

const api = new Function(`${timetableConsts}\n${trialDates}\n${timetableModel}
return { DAYS, slotId, slotLabel, TRIAL_NOTICE_DAYS, SG_PUBLIC_HOLIDAYS, sgDayKey, addDays, weekdayOfKey,
  holidaysKnown, isPublicHoliday, isBusinessDay, addBusinessDays, earliestTrialDay, earliestTrialFor,
  fmtDayKey, timeStartMin, ttSplitLabel, timetableRows };`)();

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = key => WEEKDAY[api.weekdayOfKey(key)];

// ─── The rule ───

test('a trial needs three business days of notice', () => {
  assert.equal(api.TRIAL_NOTICE_DAYS, 3);
});

test('"today" is Singapore\'s date, whatever the device says', () => {
  assert.equal(api.sgDayKey(Date.parse('2026-10-08T15:59:59Z')), '2026-10-08', '11:59pm in Singapore is still the 8th.');
  assert.equal(api.sgDayKey(Date.parse('2026-10-08T16:00:00Z')), '2026-10-09', 'Midnight in Singapore is the 9th.');
  assert.equal(api.sgDayKey(new Date('2026-10-08T23:30:00-07:00')), '2026-10-09',
    'A parent abroad on the evening of the 8th is already booking on Singapore\'s 9th.');
  assert.equal(api.sgDayKey(new Date('2026-10-09T00:30:00+08:00')), '2026-10-09');
  assert.match(api.sgDayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('the day of booking never counts', () => {
  assert.equal(api.earliestTrialDay('2026-10-05'), '2026-10-08', 'Booked on a Monday: Tuesday, Wednesday, Thursday.');
  assert.equal(dayName(api.earliestTrialDay('2026-10-05')), 'Thu');
});

test('a weekend is not a business day', () => {
  const cases = {
    '2026-10-08': '2026-10-13', // Thu → Fri, Mon, Tue
    '2026-10-09': '2026-10-14', // Fri → Mon, Tue, Wed
    '2026-10-10': '2026-10-14', // Sat → Mon, Tue, Wed
    '2026-10-11': '2026-10-14'  // Sun → Mon, Tue, Wed
  };
  for (const [booked, earliest] of Object.entries(cases)) {
    assert.equal(api.earliestTrialDay(booked), earliest, `Booked on ${dayName(booked)} ${booked}.`);
  }
});

test('a Saturday class booked midweek is the one a week later', () => {
  // Wed 7 Oct: Thursday and Friday are only two days to prepare for Sat 10 Oct.
  assert.equal(api.earliestTrialDay('2026-10-07'), '2026-10-12');
  assert.equal(api.earliestTrialFor('SAT', '2026-10-07'), '2026-10-17');
  // Tue 6 Oct: Wednesday, Thursday and Friday are three — Sat 10 Oct is fine.
  assert.equal(api.earliestTrialFor('SAT', '2026-10-06'), '2026-10-10');
});

test('every class day, booked on Thursday 8 October 2026', () => {
  const expected = { MON: '2026-10-19', TUE: '2026-10-13', WED: '2026-10-14', THU: '2026-10-15', FRI: '2026-10-16', SAT: '2026-10-17' };
  for (const day of api.DAYS) {
    const key = api.earliestTrialFor(day.code, '2026-10-08');
    assert.equal(key, expected[day.code], `${day.name} class.`);
    assert.equal(dayName(key), day.name.slice(0, 3), `The ${day.name} class's earliest trial falls on a ${day.name}.`);
  }
  assert.equal(api.earliestTrialFor('SUN', '2026-10-08'), '2026-10-18', 'Any weekday code resolves: the first Sunday on or after Tue 13 Oct.');
  assert.equal(api.earliestTrialFor('XYZ', '2026-10-08'), '', 'An unknown day code gives no date rather than a wrong one.');
});

test('a public holiday is not a business day', () => {
  // Deepavali is Sunday 8 Nov 2026; Monday 9 Nov is the holiday in lieu.
  assert.equal(api.isPublicHoliday('2026-11-09'), true);
  assert.equal(api.isBusinessDay('2026-11-09'), false);
  assert.equal(api.earliestTrialDay('2026-11-04'), '2026-11-10', 'Wed 4 Nov: Thu, Fri, (Mon 9 is a holiday) Tue.');
});

test('a lesson that falls on a public holiday is skipped', () => {
  assert.equal(api.earliestTrialDay('2026-11-03'), '2026-11-06');
  assert.equal(api.earliestTrialFor('MON', '2026-11-03'), '2026-11-16', 'Mon 9 Nov is a public holiday, so the Monday after.');
  // Christmas Day is Friday 25 Dec 2026 and New Year's Day Friday 1 Jan 2027.
  assert.equal(api.earliestTrialDay('2026-12-22'), '2026-12-28');
  assert.equal(api.earliestTrialFor('FRI', '2026-12-22'), '2027-01-08');
});

test('Chinese New Year 2027 holds up the notice too', () => {
  // Sat 6 and Sun 7 Feb 2027, with Mon 8 Feb in lieu of the Sunday.
  assert.equal(api.earliestTrialDay('2027-02-03'), '2027-02-09');
  assert.equal(api.earliestTrialFor('SAT', '2027-02-03'), '2027-02-13');
  assert.equal(api.earliestTrialFor('MON', '2027-02-01'), '2027-02-15', 'Booked Mon 1 Feb: Thu 4 Feb earliest; Mon 8 Feb is a holiday.');
});

test('a window the holiday list does not cover gives no date at all', () => {
  assert.equal(api.holidaysKnown('2028-01-03'), false);
  assert.equal(api.earliestTrialDay('2027-12-29'), '', 'Thu 30, Fri 31 Dec, then 2028, which nobody has listed.');
  assert.equal(api.earliestTrialFor('MON', '2027-12-29'), '');
  assert.equal(api.earliestTrialDay('2028-03-01'), '');
  // Inside the list it still works right up to the edge…
  assert.equal(api.earliestTrialDay('2027-12-20'), '2027-12-23');
  assert.equal(api.earliestTrialFor('FRI', '2027-12-20'), '2027-12-24');
  // …and a lesson pushed over the edge by a holiday is refused, not guessed.
  assert.equal(api.isPublicHoliday('2027-12-25'), true, 'Christmas 2027 is a Saturday.');
  assert.equal(api.earliestTrialFor('SAT', '2027-12-20'), '', 'The Saturday after Christmas is in 2028.');
});

test('the holiday list is MOM\'s, and every Sunday holiday brings its Monday', () => {
  const years = Object.keys(api.SG_PUBLIC_HOLIDAYS);
  assert.ok(years.includes('2026') && years.includes('2027'), 'This year and next must be listed.');
  for (const year of years) {
    const list = api.SG_PUBLIC_HOLIDAYS[year];
    assert.deepEqual([...list].sort(), list, `${year} is in date order.`);
    assert.equal(new Set(list).size, list.length, `${year} lists no date twice.`);
    for (const key of list) {
      assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(key.slice(0, 4), year, `${key} is filed under its own year.`);
      assert.equal(api.addDays(key, 0), key, `${key} is a real calendar date.`);
      if (api.weekdayOfKey(key) === 0) {
        assert.ok(list.includes(api.addDays(key, 1)) || api.addDays(key, 1).slice(0, 4) !== year,
          `${key} is a Sunday, so the Monday after it is a public holiday too.`);
      }
    }
  }
  // Spot checks against the gazette.
  assert.equal(dayName('2026-11-09'), 'Mon');
  assert.equal(dayName('2026-12-25'), 'Fri');
  assert.equal(dayName('2027-02-08'), 'Mon');
  assert.equal(dayName('2027-05-17'), 'Mon');
  assert.equal(dayName('2027-10-28'), 'Thu');
  assert.equal(api.SG_PUBLIC_HOLIDAYS['2027'].length, 12);
});

test('dates are written the way a parent reads them', () => {
  assert.equal(api.fmtDayKey('2026-10-13', false, '2026-10-08'), 'Tue 13 Oct');
  assert.equal(api.fmtDayKey('2026-10-13', true, '2026-10-08'), 'Tuesday 13 October');
  assert.equal(api.fmtDayKey('2026-10-13', true, ''), 'Tuesday 13 October 2026', 'An email always carries the year.');
  assert.equal(api.fmtDayKey('2027-01-08', false, '2026-12-22'), 'Fri 8 Jan 2027', 'Next year\'s date says so.');
  assert.equal(api.fmtDayKey('', false, '2026-10-08'), '');
});

// ─── The timetable ───

test('every lesson label says when it starts', () => {
  assert.equal(api.timeStartMin('9:00am – 10:45am'), 540);
  assert.equal(api.timeStartMin('11:00am – 12:45pm'), 660);
  assert.equal(api.timeStartMin('1:00pm – 2:45pm'), 780);
  assert.equal(api.timeStartMin('3:00pm – 4:45pm'), 900);
  assert.equal(api.timeStartMin('12:30pm – 2:15pm'), 750, 'Noon is 12pm, not midnight.');
  assert.equal(api.timeStartMin('12:00am'), 0);
  assert.equal(api.timeStartMin('no time here'), 1440, 'A label without a time sorts last instead of throwing.');
  for (const day of api.DAYS) for (const t of day.times) {
    const m = api.timeStartMin(t.label);
    assert.ok(m >= 0 && m < 1440, `${day.name} ${t.label} must parse.`);
  }
  assert.deepEqual(api.ttSplitLabel('3:00pm – 4:45pm'), ['3:00pm', '4:45pm']);
  assert.deepEqual(api.ttSplitLabel('9:00am-10:45am'), ['9:00am', '10:45am']);
  assert.deepEqual(api.ttSplitLabel('4pm'), ['4pm', '']);
});

test('the timetable runs earliest first and holds every slot exactly once', () => {
  const rows = api.timetableRows();
  assert.deepEqual(rows.map(r => r.label), [
    '9:00am – 10:45am', '11:00am – 12:45pm', '1:00pm – 2:45pm',
    '3:00pm – 4:45pm', '5:00pm – 6:45pm', '7:00pm – 8:45pm'
  ]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].start > rows[i - 1].start, 'Rows run in time order.');
  const seen = [];
  for (const row of rows) {
    for (const [code, cell] of Object.entries(row.cells)) {
      assert.equal(cell.day.code, code);
      assert.equal(cell.t.label, row.label, 'A cell sits in the row of its own lesson time.');
      assert.equal(cell.id, api.slotId(code, cell.t.n));
      assert.equal(api.slotLabel(cell.id), cell.day.name + ' ' + row.label);
      seen.push(cell.id);
    }
  }
  const all = api.DAYS.flatMap(d => d.times.map(t => api.slotId(d.code, t.n)));
  assert.equal(seen.length, all.length, 'No slot is lost and none is drawn twice.');
  assert.deepEqual([...seen].sort(), [...all].sort());
  assert.deepEqual(Object.keys(rows[0].cells), ['SAT'], 'Saturday mornings sit at the top on their own.');
  assert.deepEqual(Object.keys(rows[5].cells), ['MON', 'TUE', 'WED', 'THU', 'FRI'], 'The evening lesson runs on weekdays.');
});

// ─── Wiring that would fail silently ───

test('the three views are all reachable', () => {
  for (const id of ['view-level', 'view-week', 'view-day']) {
    assert.match(html, new RegExp(`<button[^>]*id="${id}"`), `The ${id} button must exist.`);
    assert.match(html, new RegExp(`\\['${id}', '\\w+'\\]`), `renderViewControls must light ${id}.`);
  }
  assert.match(html, /const SCHEDULE_VIEWS = \['level', 'week', 'day'\];/);
  assert.match(html, /else if \(view === 'week'\) document\.getElementById\('schedule-grid'\)\.innerHTML = renderTimetableView\(\);/);
  assert.match(html, /location\.hash === '#timetable'/, '/schedule/#timetable opens the timetable.');
});

test('the notice is everywhere a trial is booked', () => {
  assert.match(html, /<div class="join-strip trial-notice" id="trial-notice"/, 'The strip above Find a class.');
  assert.match(html, /<div class="trial-note hidden" id="trial-note"/, 'The note in the booking form.');
  const uses = html.match(/trialNoticeHtml\(/g) || [];
  assert.ok(uses.length >= 3, 'Declared once, used by the class details and by the booking form.');
  assert.match(html, /trialNote\.classList\.toggle\('hidden', enrol\)/, 'Shown for a trial, hidden for an enrolment.');
  assert.match(html, /sendBookingEmails\(booking, earliestKey\)/, 'The emails are told the earliest date.');
  assert.match(html, /noticeText \? '<p><b>Your trial date:<\/b> '/, 'The parent\'s confirmation email states the notice.');
});

test('the booking document keeps exactly its fields', () => {
  // The bookings collection's Firestore rules live only in the console. A new
  // field could make every booking fail, so the notice reaches the emails and
  // the confirmation as words, and never the stored booking.
  const block = between('const booking = {', '};');
  let body = block.slice('const booking = {'.length).replace(/\/\/.*$/gm, '');
  // Drop call arguments, so `monthlyFeeFor(s, mode)` is not split at its comma.
  while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, '');
  const keys = body
    .split(/[,\n]/)
    .map(s => s.trim().split(':')[0].trim())
    .filter(Boolean);
  assert.deepEqual(keys.sort(), [
    'childLevel2027', 'childName', 'classLevel', 'classType', 'createdAt', 'email', 'kind', 'mode', 'monthlyFee',
    'parentName', 'paymentRef', 'price', 'receiptFilename', 'receiptURL', 'slot', 'slotLabel', 'slotMode', 'status',
    'subject', 'whatsapp'
  ]);
  assert.doesNotMatch(block, /earliest|notice/i);
});

test('the page version is shown to the teacher only', () => {
  assert.match(html, /const SCHEDULE_PAGE_VERSION = 'v\d+\.\d+\.\d+';/);
  assert.match(html, /version\.classList\.toggle\('hidden', !isAdmin\);/);
});
