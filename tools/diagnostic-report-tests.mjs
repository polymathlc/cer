// 🩺 Checks diagnostic/report-core.js, which builds the parent's diagnostic report
// (bands, totals, the teacher's draft note, the study plan, the recommended class,
// the /schedule links, the email and the HTML), with no browser or network:
//   node --test tools/diagnostic-report-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const R = require('../diagnostic/report-core.js');
const server = require('../shop-function/functions/diagnostic-report.js');

const BOOKING = { _id: 'ABC234', code: 'ABC234', childName: 'Ava Tan', parentName: 'Mdm Lim', email: 'parent@example.test',
  level: 'Primary 5', subject: 'Math', diagnosticDate: '2026-12-08' };
const CONFIG = { slots: {
  'TUE-1': { level: 'P5', subject: 'Science', mode: 'Physical', status: 'open', type: 'master' },
  'THU-3': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'master' },
  'MON-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular' },
  'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'master' },
  'FRI-1': { level: 'P5', subject: 'Math', mode: 'Online', status: 'full', type: 'regular' },
  'SAT-1': { level: 'P4', subject: 'Math', mode: 'Online', status: 'open' }
} };
function marked(marks) {
  const report = R.blankReport(BOOKING, 'Mr Chung');
  report.topics = Object.entries(marks).map(([name, [score, max]]) => ({ name, score, max, note: '' }));
  return report;
}
const SAMPLE = () => marked({ Fractions: [3, 10], Percentage: [9, 10], Ratio: [6, 10], Rate: [8, 10], 'Area of triangles': [4, 10], Decimals: [10, 10] });

test('every level and subject has a topic list, and a new report starts from it', () => {
  for (const level of R.LEVELS) for (const subject of R.SUBJECTS) assert.ok(R.topicsFor(level, subject).length >= 7, level + ' ' + subject);
  const blank = R.blankReport(BOOKING);
  assert.equal(blank.topics.length, R.topicsFor('Primary 5', 'Math').length);
  assert.ok(blank.topics.every(t => t.score === null && t.max === null));
  assert.equal(blank.topicSet, 'Primary 5|Math');
  assert.equal(blank.teacher, 'Mr Chung');
  assert.deepEqual(R.topicsFor('Primary 9', 'Math'), []);
});

test('bands: 75% and up strong, 50–74% developing, under 50% needs work', () => {
  assert.equal(R.band(75), R.BANDS.strong);
  assert.equal(R.band(74), R.BANDS.developing);
  assert.equal(R.band(50), R.BANDS.developing);
  assert.equal(R.band(49), R.BANDS.needs);
  assert.equal(R.band(null), null);
  assert.equal(R.topicResult({ name: 'X', score: 7.5, max: 10 }).pct, 75);
  assert.equal(R.topicResult({ name: 'X', score: 11, max: 10 }).scored, false, 'more than the maximum is not a mark');
  assert.equal(R.topicResult({ name: 'X', score: 0, max: 0 }).scored, false);
  assert.equal(R.topicResult({ name: 'X', score: '4', max: '8' }).pct, 50, 'typed numbers count');
});

test('the summary totals the marks and orders the focus areas weakest first', () => {
  const s = R.summarise(SAMPLE());
  assert.equal(s.score, 40);
  assert.equal(s.max, 60);
  assert.equal(s.pct, 67);
  assert.equal(s.band, R.BANDS.developing);
  assert.deepEqual(s.strong.map(t => t.name), ['Decimals', 'Percentage', 'Rate']);
  assert.deepEqual(s.needs.map(t => t.name), ['Fractions', 'Area of triangles']);
  assert.deepEqual(s.focus.map(t => t.name), ['Fractions', 'Area of triangles', 'Ratio']);
  assert.equal(s.complete, true);
});

test('the draft note names strengths and focus areas in plain words', () => {
  const note = R.suggestComment(SAMPLE());
  assert.match(note, /^Ava scored 67% on the Maths diagnostic test/);
  assert.match(note, /confident in decimals, percentage and rate/);
  assert.match(note, /work on first are fractions and area of triangles/);
  assert.match(note, /ratio need more practice/);
  assert.equal(R.suggestComment(R.blankReport(BOOKING)), '', 'nothing to say without marks');
  const top = R.suggestComment(marked({ Fractions: [10, 10], Ratio: [9, 10] }));
  assert.match(top, /did very well/);
  assert.match(top, /stretch Ava further/);
});

test('the plan covers exactly the weeks chosen, weakest topics first, ending with timed practice', () => {
  for (const weeks of R.PLAN_WEEKS) {
    const plan = R.buildPlan(SAMPLE(), weeks);
    assert.equal(plan.weeks, weeks);
    const covered = plan.steps.map(s => s.when).join(' ');
    assert.ok(covered.startsWith('Week'), covered);
    assert.ok(covered.includes(String(weeks)), weeks + ' weeks reach week ' + weeks + ': ' + covered);
    assert.equal(plan.steps.at(-1).focus, 'Timed exam practice');
    assert.ok(plan.steps[0].focus.startsWith('Fractions'), 'weakest first: ' + plan.steps[0].focus);
    assert.ok(plan.steps.every(s => s.tasks.length >= 1 && s.tasks.length <= R.LIMITS.tasks));
  }
  const eight = R.buildPlan(SAMPLE(), 8);
  assert.deepEqual(eight.steps.map(s => s.when), ['Weeks 1–2', 'Weeks 3–4', 'Weeks 5–6', 'Weeks 7–8']);
  assert.deepEqual(eight.steps.map(s => s.focus), ['Fractions', 'Area of triangles', 'Ratio', 'Timed exam practice']);
  const four = R.buildPlan(SAMPLE(), 4);
  assert.deepEqual(four.steps.map(s => s.focus), ['Fractions, Area of triangles, Ratio', 'Timed exam practice']);
  assert.equal(R.buildPlan(SAMPLE(), 5).weeks, R.DEFAULT_WEEKS, 'an unknown length falls back');
  const stretch = R.buildPlan(marked({ Fractions: [10, 10], Ratio: [9, 10] }), 6);
  assert.equal(stretch.steps[0].focus, 'Challenge problems');
  assert.equal(stretch.steps.length, 3);
});

test('Science plans add keywords and open-ended answering', () => {
  const sci = R.blankReport(Object.assign({}, BOOKING, { subject: 'Science' }));
  sci.topics = [{ name: 'Cells', score: 2, max: 10 }, { name: 'Electrical systems', score: 6, max: 10 }];
  const plan = R.buildPlan(sci, 6);
  const text = JSON.stringify(plan);
  assert.match(text, /key words for cells/);
  assert.match(text, /open-ended questions on electrical systems/);
  assert.match(plan.steps.at(-1).tasks.join(' '), /keywords/);
});

test('class options: open classes of the subject, the child\'s level first, Master Class first', () => {
  const options = R.classOptions(CONFIG, 'Primary 5', 'Math');
  assert.deepEqual(options.map(o => o.slot), ['THU-3', 'MON-2', 'TUE-3', 'SAT-1']);
  assert.equal(options[0].label, 'Thursday 7:00pm – 8:45pm');
  assert.equal(options[0].type, 'master');
  assert.equal(options[0].mode, 'Physical');
  assert.equal(options[3].label, 'Saturday 9:00am – 10:45am');
  assert.equal(R.className(options[0]), 'Primary 5 Maths Master Class');
  assert.deepEqual(R.classOptions({}, 'Primary 5', 'Math'), []);
});

test('the Enrol and Trial links open that class on /schedule with the parent\'s details', () => {
  const report = SAMPLE();
  report.recommended = R.classOptions(CONFIG, 'Primary 5', 'Math')[0];
  const enrol = new URL(R.enrolUrl(report));
  assert.equal(enrol.origin + enrol.pathname, 'https://polymathlc.com.sg/schedule/');
  assert.equal(enrol.searchParams.get('book'), 'THU-3');
  assert.equal(enrol.searchParams.get('kind'), 'enrol');
  assert.equal(enrol.searchParams.get('child'), 'Ava Tan');
  assert.equal(enrol.searchParams.get('parent'), 'Mdm Lim');
  assert.equal(enrol.searchParams.get('email'), 'parent@example.test');
  assert.equal(enrol.searchParams.get('from'), 'diagnostic');
  assert.equal(new URL(R.trialUrl(report)).searchParams.get('kind'), 'trial');
  assert.equal(R.enrolUrl(SAMPLE()), 'https://polymathlc.com.sg/schedule/', 'no class, the timetable');
  const why = R.suggestWhy(report, report.recommended);
  assert.match(why, /Primary 5 Maths Master Class is for Primary 5 in 2027/);
  assert.match(why, /start Ava on fractions and area of triangles/);
  // The schedule page reads exactly these parameters.
  const schedule = readFileSync(new URL('../schedule/index.html', import.meta.url), 'utf8');
  for (const name of ['book', 'kind', 'parent', 'child', 'email', 'from']) assert.ok(schedule.includes("p.get('" + name + "')"), name);
});

test('problems block sending until the marks are complete and a plan exists', () => {
  const blank = R.blankReport(BOOKING);
  assert.match(R.reportProblems(blank).join(' '), /Enter the marks/);
  const half = SAMPLE();
  half.topics.push({ name: 'Volume', score: null, max: null });
  half.plan = R.buildPlan(half, 8);
  assert.match(R.reportProblems(half).join(' '), /No marks yet for Volume/);
  const bad = SAMPLE();
  bad.topics[0].score = 12;
  assert.match(R.reportProblems(bad).join(' '), /Fractions: the score must be between 0 and 10/);
  assert.match(R.reportProblems(bad).join(' '), /Build the study plan/);
  const good = SAMPLE();
  good.plan = R.buildPlan(good, 8);
  assert.deepEqual(R.reportProblems(good), []);
});

test('the HTML escapes what staff typed and carries the links', () => {
  const report = SAMPLE();
  report.studentName = 'Ava <script>alert(1)</script>';
  report.comment = 'Good work & "keep going"\n\nSecond paragraph';
  report.topics[0].note = '<b>units</b>';
  report.plan = R.buildPlan(report, 8);
  report.recommended = Object.assign(R.classOptions(CONFIG, 'Primary 5', 'Math')[0], { why: 'Fits <well>' });
  const html = R.renderReport(report, { mode: 'email', code: 'ABC234', token: 'tok_123456789012345' });
  assert.ok(!html.includes('<script>'), 'no raw script');
  assert.ok(html.includes('Ava &lt;script&gt;'));
  assert.ok(html.includes('Good work &amp; &quot;keep going&quot;'));
  assert.ok(html.includes('&lt;b&gt;units&lt;/b&gt;'));
  assert.ok(html.includes('Fits &lt;well&gt;'));
  assert.ok(html.includes('Dear Mdm Lim,'));
  assert.ok(html.includes('https://polymathlc.com.sg/diagnostic/report/?c=ABC234&amp;t=tok_123456789012345'));
  assert.ok(html.includes('https://polymathlc.com.sg/schedule/?book=THU-3&amp;kind=enrol'));
  assert.ok(html.includes('8-week study plan'));
  assert.ok(html.includes('Primary 5 Maths Master Class'));
  const web = R.renderReport(report, { mode: 'web', code: 'ABC234', token: 'tok_123456789012345' });
  assert.ok(!web.includes('Dear Mdm Lim'), 'the web page has no letter greeting');
  assert.ok(!web.includes('View and print this report online'));
  const preview = R.renderReport(report, { mode: 'email', preview: true });
  assert.ok(!preview.includes('/schedule/?book='), 'the admin preview does not link out');
});

test('the email comes from admin@ and a test copy says so', () => {
  const report = SAMPLE();
  report.plan = R.buildPlan(report, 8);
  const mail = R.reportMail(report, { code: 'ABC234', token: 'tok_123456789012345' });
  assert.deepEqual(mail.to, ['parent@example.test']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.replyTo, 'admin@polymathlc.com.sg');
  assert.equal(mail.message.subject, 'Ava Tan\'s diagnostic report and study plan — Maths');
  assert.match(mail.message.text, /Overall: 67% \(40\/60 marks\), Developing/);
  assert.match(mail.message.text, /View this report online: https:\/\/polymathlc\.com\.sg\/diagnostic\/report\/\?c=ABC234&t=tok_/);
  assert.equal(mail.polymathDiagnostic.kind, 'diagnostic-report');
  const testMail = R.reportMail(report, { code: 'ABC234', token: 't', to: 'teacher@example.test', test: true });
  assert.deepEqual(testMail.to, ['teacher@example.test']);
  assert.match(testMail.message.subject, /^\[TEST\] /);
});

test('the stored record is trimmed the same way the function trims it', () => {
  const long = 'y'.repeat(4000);
  const messy = Object.assign(SAMPLE(), { comment: long, studentName: '  Ava\n Tan  ', level: 'Primary 9', recommended: { slot: 'bad' } });
  messy.topics.push(...Array.from({ length: 30 }, (_, i) => ({ name: 'T' + i, score: 1, max: 2, note: long })));
  messy.plan = { weeks: 8, steps: Array.from({ length: 9 }, () => ({ when: 'W', focus: long, tasks: Array(9).fill(long) })) };
  const clean = R.cleanReport(messy);
  assert.equal(clean.studentName, 'Ava Tan');
  assert.equal(clean.level, '');
  assert.equal(clean.comment.length, R.LIMITS.comment);
  assert.equal(clean.topics.length, R.LIMITS.topics);
  assert.equal(clean.recommended, null);
  assert.equal(clean.plan.steps.length, R.LIMITS.steps);
  const viaServer = server.publicReport({ code: 'ABC234', diagnosticReport: clean });
  for (const key of ['studentName', 'level', 'subject', 'testDate', 'comment', 'teacher']) assert.deepEqual(viaServer[key], clean[key], key);
  assert.deepEqual(viaServer.topics, clean.topics);
  assert.deepEqual(viaServer.plan, clean.plan);
});

test('report keys are long, random and link-safe', () => {
  const crypto = globalThis.crypto;
  const a = R.newToken(bytes => crypto.getRandomValues(bytes)), b = R.newToken(bytes => crypto.getRandomValues(bytes));
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, b);
  assert.ok(server.validateRequest({ code: 'ABC234', token: a }));
});
