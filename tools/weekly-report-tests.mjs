// Tests for the weekly parent progress reports (office/weekly-report-core.mjs and
// tools/weekly-reports.mjs). Offline: Firestore is a small in-memory fake.
//   node --test tools/weekly-report-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../office/weekly-report-core.mjs';
import { runWeekly, buildReports, loadConceptTags } from './weekly-reports.mjs';


import { clock, sg, SUNDAY_6PM, schedule, families, courses, docNames, progressBook, profiles, access, data } from './weekly-report-fixtures.mjs';

/* ─── 1. The week ─── */
test('week keys are the Sunday a week ends on, in Singapore time', () => {
  assert.equal(W.weekKeyFor(SUNDAY_6PM), '2026-11-22');
  assert.equal(W.weekKeyFor(sg(2026, 11, 18, 10)), '2026-11-22');        // Wednesday → coming Sunday
  assert.equal(W.weekKeyFor(sg(2026, 11, 23, 0, 30)), '2026-11-29');     // Monday 00:30 → next Sunday
  assert.equal(W.weekKeyFor(Date.UTC(2026, 10, 22, 17, 0)), '2026-11-29');     // Mon 1am SGT (Sun 5pm UTC)
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM + 3600e3);
  assert.equal(win.end, SUNDAY_6PM);
  assert.equal(win.end - win.start, 7 * 24 * 3600e3);
  assert.equal(W.weekLabel(win), '15 – 22 Nov 2026');
  const mid = W.weekWindow('2026-11-22', sg(2026, 11, 18, 10));
  assert.equal(mid.end, sg(2026, 11, 18, 10));
  assert.equal(W.weekLabel({ start: sg(2026, 11, 26, 18), end: sg(2026, 12, 3, 18) }), '26 Nov – 3 Dec 2026');
});

test('the Sunday run is due from 6 PM Sunday until Monday noon, once a week', () => {
  assert.equal(W.dueWeekKey(sg(2026, 11, 22, 17, 59)), '');
  assert.equal(W.dueWeekKey(SUNDAY_6PM), '2026-11-22');
  assert.equal(W.dueWeekKey(sg(2026, 11, 23, 11, 30)), '2026-11-22');
  assert.equal(W.dueWeekKey(sg(2026, 11, 23, 12, 0)), '');
  assert.equal(W.dueWeekKey(sg(2026, 11, 20, 19)), '');
  assert.deepEqual(W.weeklyPlan({ mode: 'off' }, SUNDAY_6PM).act, false);
  const p = W.weeklyPlan({ mode: 'review' }, SUNDAY_6PM + 60e3);
  assert.equal(p.act, true); assert.equal(p.kind, 'preview'); assert.equal(p.auto, true); assert.equal(p.weekKey, '2026-11-22');
  assert.equal(W.weeklyPlan({ mode: 'send' }, SUNDAY_6PM).kind, 'send');
  assert.equal(W.weeklyPlan({ mode: 'send', lastAutoWeek: '2026-11-22' }, SUNDAY_6PM + 3600e3).act, false);
  assert.equal(W.weeklyPlan({}, SUNDAY_6PM).kind, 'preview', 'no settings yet = preview to the office only');
});

test('a "now" request from the office is acted on once, and never sends when off', () => {
  const now = sg(2026, 11, 18, 10);
  const req = { id: 'rabc123', kind: 'preview', at: now - 60e3, by: 'admin@polymathlc.com.sg' };
  const p = W.weeklyPlan({ mode: 'off', request: req }, now);
  assert.equal(p.act, true); assert.equal(p.kind, 'preview'); assert.equal(p.requestId, 'rabc123'); assert.equal(p.weekKey, '2026-11-22');
  assert.equal(W.weeklyPlan({ mode: 'review', request: req, lastRequestDone: 'rabc123' }, now).act, false);
  const send = W.weeklyPlan({ mode: 'off', request: Object.assign({}, req, { kind: 'send' }) }, now);
  assert.equal(send.act, false); assert.equal(send.staleRequest, 'rabc123');
  const old = W.weeklyPlan({ mode: 'send', request: Object.assign({}, req, { at: now - 3 * 86400e3 }) }, now);
  assert.equal(old.act, false); assert.equal(old.staleRequest, 'rabc123');
  assert.equal(W.newRequest('send', 'x', now, () => 0.5).kind, 'send');
  assert.match(W.newRequest('weird', 'x', now, () => 0.5).id, /^r[a-z0-9]+$/);
});

test('settings are cleaned', () => {
  const w = W.normalizeWeekly({ mode: 'nonsense', note: '  Hello\r\nparents ', optOut: { famA: true, famB: 'yes', 'bad id!': true }, request: { id: 'x', kind: 'send' } });
  assert.equal(w.mode, 'review');
  assert.equal(w.note, 'Hello\nparents');
  assert.deepEqual(w.optOut, { famA: true });
  assert.equal(w.request, null);
  assert.equal(W.normalizeWeekly({ note: 'x'.repeat(2000) }).note.length, W.NOTE_MAX);
});

/* ─── 2. Classes, live lessons, practice ─── */
test('a timetable slot finds its Polymath Online class (never an archived one)', () => {
  assert.equal(W.courseForSlot(courses, schedule, 'SAT-1', 'P5').id, 'c1');
  assert.equal(W.courseForSlot(courses, schedule, 'WED-2', 'P5').id, 'c2');
  assert.equal(W.courseForSlot(courses, schedule, 'MON-1', 'P5'), null);
  assert.equal(W.courseForSlot(courses.filter(c => c.id !== 'c1'), schedule, 'SAT-1', 'P5'), null);
});

test('the worksheets a class did this week follow the lesson clock', () => {
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM);
  const cov = W.classCoverage(courses[0], win, clock, docNames);
  assert.deepEqual(cov.taught.map(t => t.name), ['Plant Transport']);
  assert.equal(W.dayShort(cov.taught[0].date), 'Sat 21 Nov');
  assert.equal(cov.next.name, 'Human Circulatory System');
  assert.equal(W.dayShort(cov.next.date), 'Sat 28 Nov');
  const notStarted = W.classCoverage(courses[2], win, clock, docNames);
  assert.equal(notStarted.started, false); assert.equal(notStarted.taught.length, 0);
  const wed = W.classCoverage(courses[1], win, clock, docNames);
  assert.deepEqual(wed.taught.map(t => t.name), ['Fractions: Word Problems']);
  assert.equal(wed.next.name, 'Ratio 1');
});

test('the live-lesson progress book is read per roster child', () => {
  const live = W.liveRowsByRoster([progressBook, progressBook]);
  assert.deepEqual(Object.keys(live).sort(), ['famA_kid1', 'famB_kid3']);
  assert.equal(live.famA_kid1.length, 3, 'a lesson in two books counts once');
  assert.equal(W.liveScore({ r: 3, h: 1, k: 7 }), 50);
  assert.equal(W.liveScore({ r: 0, h: 0, k: 0 }), null);
  assert.equal(W.cleanLiveRow({ e: 0 }), null);
});

test('Study Buddy rows find their child by officeId, or by the parent email and name', () => {
  const p = W.practiceByRoster(profiles, access, families);
  assert.deepEqual(Object.keys(p).sort(), ['famA_kid1', 'famA_kid2']);
  assert.equal(p.famA_kid1.length, 3);
  assert.equal(p.famA_kid2[0].ws, 'Living Things');
  assert.equal(W.matchChild([{ name: 'Ethan Tan' }, { name: 'Chloe Tan' }], ['chloe'], '').name, 'Chloe Tan');
  assert.equal(W.matchChild([{ name: 'Ethan Tan', level: 'P5' }, { name: 'Chloe Tan', level: 'P3' }], ['Tan'], 'P3').name, 'Chloe Tan');
  assert.equal(W.matchChild([{ name: 'Ethan Tan' }, { name: 'Chloe Tan' }], ['Tan'], ''), null);
});

/* ─── 3. The reports ─── */
test('one child\'s week: totals, strengths, weaknesses, next steps', () => {
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM);
  const reports = buildReports(data(), {}, win, SUNDAY_6PM, clock);
  const tan = reports.find(r => r.familyId === 'famA');
  assert.equal(tan.empty, false);
  const ethan = tan.children.find(c => c.name === 'Ethan Tan');
  assert.equal(ethan.totals.lessons, 2);
  assert.equal(ethan.totals.classWorksheets, 2);
  assert.equal(ethan.totals.asked, 13); assert.equal(ethan.totals.answered, 12);
  assert.equal(ethan.totals.correctPct, Math.round(8.5 / 12 * 100));
  assert.equal(ethan.totals.practiceSheets, 2);
  assert.equal(ethan.live.find(r => W.sgDay(r.d) === '2026-11-21').topic, 'Plant Transport');
  assert.ok(ethan.strong.some(s => s.what === 'Circulatory System Quiz (Science)'));
  assert.ok(ethan.strong.some(s => /Wed 18 Nov|Fractions/.test(s.what)));
  assert.ok(ethan.weak.some(s => s.what === 'Ratio Practice B (Maths)'));
  assert.ok(ethan.weak.some(s => s.what === 'Plant Transport'));
  assert.ok(ethan.weak.some(s => s.gap && /Misread question/.test(s.what)), 'a recurring slip, named from its id without concept-tags.js');
  assert.ok(ethan.next.length >= 1 && ethan.next.length <= 3);
  assert.ok(ethan.next.some(n => /Ratio Practice B/.test(n)));
  const chloe = tan.children.find(c => c.name === 'Chloe Tan');
  assert.equal(chloe.totals.practiceSheets, 1);
  assert.equal(chloe.totals.classWorksheets, 0);
});

test('who gets a report: withdrawn, opted out, nothing to say, no email', () => {
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM);
  const reports = buildReports(data(), { optOut: {} }, win, SUNDAY_6PM, clock);
  const by = id => reports.find(r => r.familyId === id);
  assert.equal(by('famB').empty, false); assert.equal(by('famB').reason, 'no email');
  assert.equal(by('famC').empty, true); assert.equal(by('famC').reason, 'withdrawn');
  assert.equal(by('famD').empty, true); assert.equal(by('famD').reason, 'nothing this week');
  const out = buildReports(data(), W.normalizeWeekly({ optOut: { famA: true } }), win, SUNDAY_6PM, clock);
  assert.equal(out.find(r => r.familyId === 'famA').reason, 'opted out');
});

test('the email: one per family, every child, escaped, with the centre\'s note', () => {
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM);
  const evil = JSON.parse(JSON.stringify(families));
  evil[0].students[0].name = 'Ethan <script>x</script> Tan';
  const reports = buildReports(data({ families: evil }), {}, win, SUNDAY_6PM, clock);
  const tan = reports.find(r => r.familyId === 'famA');
  const msg = W.weeklyEmail(tan, {}, { note: 'No lessons on 25 Dec.' }, win);
  assert.match(msg.subject, /^Weekly progress report: Ethan and Chloe · 15 – 22 Nov 2026$/);
  assert.ok(!msg.html.includes('<script>'));
  assert.ok(msg.html.includes('&lt;script&gt;'));
  assert.ok(msg.html.includes('No lessons on 25 Dec.'));
  assert.ok(msg.html.includes('Chloe Tan'));
  assert.ok(msg.html.includes('Human Circulatory System'));
  assert.ok(msg.text.includes('What to practise this week:'));
  const mail = W.weeklyMail(tan, msg, {}, { weekKey: '2026-11-22' });
  assert.deepEqual(mail.to, ['tan@example.com']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.bcc, undefined);
  assert.equal(W.weeklyMailId('2026-11-22', 'famA'), 'polymath-office-weekly-2026-11-22-famA');
});

test('the office preview lists every family and stays under the mail size limit', () => {
  const win = W.weekWindow('2026-11-22', SUNDAY_6PM);
  const many = [];
  for (let i = 0; i < 60; i++) many.push(Object.assign(JSON.parse(JSON.stringify(families[0])), { id: 'f' + i, parentName: 'Parent ' + i }));
  const book = { v: 1, students: {} };
  many.forEach(f => { book.students['r:' + f.id + '_kid1'] = progressBook.students['r:famA_kid1']; });
  const reports = buildReports(data({ families: many, live: W.liveRowsByRoster([book]) }), {}, win, SUNDAY_6PM, clock);
  const p = W.previewEmail(reports, {}, {}, win, { mode: 'review' });
  assert.ok(p.html.length < 900000, 'html ' + p.html.length);
  assert.ok(p.shown <= W.PREVIEW_MAX_FAMILIES_FULL);
  assert.ok(p.more > 0);
  assert.match(p.subject, /preview/);
  const sent = W.previewEmail(reports, {}, {}, win, { mode: 'sent', sentCount: 60 });
  assert.match(sent.subject, /sent/);
  const log = W.weekLog('2026-11-22', win, reports, { kind: 'send', sent: ['f1'], at: 1 });
  assert.equal(log.counts.emailed, 1);
  assert.ok(JSON.stringify(log).length < 900000);
});

/* ─── 4. The sender, against a fake Firestore ─── */
function fakeDb(seed) {
  const store = new Map(Object.entries(seed));     // 'col/doc' → data
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, data: () => data === undefined ? undefined : JSON.parse(JSON.stringify(data)), ref: { path } });
  const docRef = path => ({
    path, id: path.split('/').pop(),
    async get() { return snap(path, store.get(path)); },
    async set(v, o) { store.set(path, o && o.merge ? Object.assign({}, store.get(path) || {}, strip(v)) : strip(v)); },
    async create(v) { if (store.has(path)) { const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; } store.set(path, strip(v)); }
  });
  const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (x && x.__ts ? 'TS' : x)));
  const query = (match) => ({
    select() { return this; },
    async get() { return { docs: [...store.keys()].filter(match).map(k => snap(k, store.get(k))) }; }
  });
  const db = {
    store,
    collection: name => Object.assign(query(k => k.startsWith(name + '/') && k.split('/').length === 2), { doc: id => docRef(name + '/' + id) }),
    collectionGroup: name => query(k => { const p = k.split('/'); return p.length >= 2 && p[p.length - 2] === name; }),
    async getAll(...refs) { if (refs.length && !refs[refs.length - 1].path) refs.pop(); return refs.map(r => snap(r.path, store.get(r.path))); },
    batch() { const ops = []; return { set: (r, v) => ops.push([r, v]), commit: async () => { for (const [r, v] of ops) await r.set(v); } }; },
    async runTransaction(fn) { return fn({ get: r => r.get(), set: (r, v, o) => r.set(v, o) }); }
  };
  return db;
}
const FieldValue = { serverTimestamp: () => ({ __ts: true }) };
function seed(weekly) {
  const s = {
    'officeSettings/config': {}, 'officeSettings/weeklyReports': weekly,
    'schedule_config/main': schedule,
    'users/teacher1/liveClassProgress/main': { v: 1, json: JSON.stringify(progressBook) }
  };
  families.forEach(f => { s['officeFamilies/' + f.id] = f; });
  courses.forEach(c => { s['onlineCourses/' + c.id] = c; });
  Object.entries(docNames).forEach(([id, name]) => { s['pdfAnnotator/' + id] = { name, pages: 'big' }; });
  profiles.forEach(p => { s['studentProfiles/' + p.uid] = p.data; });
  Object.entries(access).forEach(([uid, a]) => { s['studentAccess/' + uid] = a; });
  return s;
}
const noFetch = async () => ({ ok: false });

test('Sunday in preview mode: the office gets one email, parents get nothing', async () => {
  const db = fakeDb(seed({ mode: 'review' }));
  const logs = [];
  const res = await runWeekly({ db, FieldValue, now: SUNDAY_6PM + 5 * 60e3, log: l => logs.push(l), fetchImpl: noFetch, clock });
  assert.equal(res.plan.kind, 'preview');
  const mails = [...db.store.keys()].filter(k => k.startsWith('mail/'));
  assert.equal(mails.length, 1);
  assert.match(mails[0], /^mail\/polymath-office-weekly-preview-2026-11-22-/);
  const m = db.store.get(mails[0]);
  assert.deepEqual(m.to, ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);
  assert.ok(m.message.html.includes('Mrs Tan'));
  assert.equal(db.store.get('officeSettings/weeklyReports').lastAutoWeek, '2026-11-22');
  assert.ok(db.store.get('officeSettings/weeklyfam-2026-11-22-famA').html.includes('Ethan Tan'));
  assert.equal(db.store.get('officeSettings/weekly-2026-11-22-preview').counts.withReport, 2);
  // The public log never names anybody.
  assert.ok(!logs.join('\n').match(/Tan|Lim|example\.com|fam[A-D]/), logs.join('\n'));
  // The next check the same evening does nothing.
  const again = await runWeekly({ db, FieldValue, now: SUNDAY_6PM + 35 * 60e3, log: () => {}, fetchImpl: noFetch, clock });
  assert.equal(again.plan.act, false);
});

test('Sunday in send mode: each family once, never twice in a week', async () => {
  const db = fakeDb(seed({ mode: 'send' }));
  const res = await runWeekly({ db, FieldValue, now: SUNDAY_6PM + 60e3, log: () => {}, fetchImpl: noFetch, clock });
  assert.deepEqual(res.sent, ['famA']);
  const fam = db.store.get('mail/polymath-office-weekly-2026-11-22-famA');
  assert.deepEqual(fam.to, ['tan@example.com']);
  assert.match(fam.message.subject, /Ethan and Chloe/);
  assert.ok([...db.store.keys()].some(k => /^mail\/polymath-office-weekly-preview-/.test(k)), 'the office gets a copy');
  // "Email parents now" pressed again the same week: nobody gets a second one.
  db.store.set('officeSettings/weeklyReports', Object.assign({}, db.store.get('officeSettings/weeklyReports'), { request: { id: 'rsend1', kind: 'send', at: SUNDAY_6PM + 2 * 3600e3, by: 'x' } }));
  const res2 = await runWeekly({ db, FieldValue, now: SUNDAY_6PM + 2.5 * 3600e3, log: () => {}, fetchImpl: noFetch, clock });
  assert.deepEqual(res2.sent, []);
  assert.deepEqual(res2.already, ['famA']);
  assert.equal(db.store.get('officeSettings/weeklyReports').lastRequestDone, 'rsend1');
});

test('a dry run writes nothing', async () => {
  const db = fakeDb(seed({ mode: 'send' }));
  const before = db.store.size;
  const res = await runWeekly({ db, FieldValue, now: SUNDAY_6PM + 60e3, dryRun: true, log: () => {}, fetchImpl: noFetch, clock });
  assert.deepEqual(res.sent, ['famA']);
  assert.equal(db.store.size, before);
});

test('concept-tags.js is optional and loaded safely', async () => {
  assert.equal(await loadConceptTags(noFetch), null);
  assert.equal(await loadConceptTags(async () => { throw new Error('offline'); }), null);
  const api = await loadConceptTags(async () => ({ ok: true, text: async () => 'module.exports = { label: function (id) { return id === "a" ? "Alpha" : ""; }, fix: function () { return "Do this."; } };' }));
  assert.equal(W.tagLabel(api, 'a'), 'Alpha');
  assert.equal(W.tagLabel(null, 'unit-conversion'), 'Unit conversion');
});
