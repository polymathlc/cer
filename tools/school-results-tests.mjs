// 📊 School results — the rules in office/school-results-core.mjs.
//   node --test tools/school-results-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../office/school-results-core.mjs';

const r = (id, subject, exam, date, mark, max = 100, grade = '', by = 'parent') => ({ id, subject, exam, label: '', date, mark, max, grade, by, at: 1 });

test('AL bands and O-level grades from marks use the schools\' cut-offs', () => {
  const al = [[100, 'AL1'], [90, 'AL1'], [89.5, 'AL2'], [85, 'AL2'], [84, 'AL3'], [80, 'AL3'], [79, 'AL4'], [75, 'AL4'], [74.5, 'AL5'],
    [65, 'AL5'], [64, 'AL6'], [45, 'AL6'], [44, 'AL7'], [20, 'AL7'], [19.5, 'AL8'], [0, 'AL8']];
  al.forEach(([p, g]) => assert.equal(S.gradeFromPercent('AL', p), g, p + '%'));
  const sec = [[75, 'A1'], [70, 'A2'], [65, 'B3'], [60, 'B4'], [55, 'C5'], [50, 'C6'], [45, 'D7'], [40, 'E8'], [39, 'F9']];
  sec.forEach(([p, g]) => assert.equal(S.gradeFromPercent('SEC', p), g, p + '%'));
  assert.equal(S.scaleFor('P5'), 'AL');
  assert.equal(S.scaleFor('S1'), 'SEC');
  assert.equal(S.gradeRank('al3'), 3);
  assert.equal(S.gradeRank('B4'), 4);
  assert.equal(S.gradeRank('A*'), null);
  assert.equal(S.gradeFromPercent('AL', null), '');
});

test('a typed-in result is cleaned, or refused with a sentence for the parent', () => {
  const ok = S.validateResult({ subject: 'Math', exam: 'WA2', date: '2026-05-01', mark: '31.5', max: '40', grade: 'al4' }, { today: '2026-11-20', id: 'rabcd1234', at: 9 });
  assert.deepEqual(ok.result, { id: 'rabcd1234', subject: 'Math', exam: 'WA2', label: '', date: '2026-05-01', mark: 31.5, max: 40, grade: 'AL4', by: 'parent', at: 9 });
  assert.equal(S.validateResult({ subject: 'Math', exam: 'Test', label: '  Topical   test: Fractions ', date: '2026-05-01', mark: 8, max: 10 }, { today: '2026-11-20' }).result.label, 'Topical test: Fractions');
  assert.equal(S.validateResult({ subject: 'Math', exam: 'WA1', label: 'x', date: '2026-05-01', mark: 8 }, { today: '2026-11-20' }).result.label, '', 'only a test or other has its own name');
  assert.equal(S.validateResult({ subject: 'Science', exam: 'PSLE', date: '2026-11-19', grade: 'AL2' }, { today: '2026-11-20' }).result.mark, null);
  const bad = [
    [{ subject: 'English', exam: 'WA1', date: '2026-05-01', mark: 5 }, /Maths or Science/],
    [{ subject: 'Math', exam: 'nope', date: '2026-05-01', mark: 5 }, /which test/],
    [{ subject: 'Math', exam: 'WA1', date: '2026-13-01', mark: 5 }, /date/],
    [{ subject: 'Math', exam: 'WA1', date: '2026-12-30', mark: 5 }, /future/],
    [{ subject: 'Math', exam: 'WA1', date: '2026-05-01', mark: 50, max: 40 }, /between 0 and 40/],
    [{ subject: 'Math', exam: 'WA1', date: '2026-05-01', mark: 5, max: 9999 }, /total marks/],
    [{ subject: 'Math', exam: 'WA1', date: '2026-05-01' }, /marks, or choose the grade/]
  ];
  bad.forEach(([raw, re]) => assert.match(S.validateResult(raw, { today: '2026-11-20' }).error, re));
});

test('the usual exam dates are filled in', () => {
  assert.equal(S.defaultExamDate('WA1', 2026), '2026-03-01');
  assert.equal(S.defaultExamDate('SA2', 2025), '2025-10-25');
  assert.equal(S.defaultExamDate('PSLE', 2026), '2026-11-25');
  assert.equal(S.defaultExamDate('Test', 2026), '', 'a class test has no usual date');
  assert.equal(S.examName({ exam: 'SA1' }), 'Mid-year');
  assert.equal(S.examName({ exam: 'Test', label: 'Fractions quiz' }), 'Fractions quiz');
});

test('percent, grade and the text of a result', () => {
  const a = r('r0001', 'Math', 'WA1', '2026-03-01', 30, 40);
  assert.equal(S.resultPercent(a), 75);
  assert.deepEqual(S.resultGrade(a, 'P5'), { grade: 'AL4', scale: 'AL', rank: 4, worked: true });
  assert.equal(S.resultText(a, 'P5'), '30/40 (75%) · ≈AL4');
  const b = r('r0002', 'Math', 'SA2', '2026-10-25', 82, 100, 'AL3');
  assert.equal(S.resultText(b, 'P5'), '82% · AL3');
  const c = r('r0003', 'Science', 'PSLE', '2026-11-25', null, 100, 'AL2');
  assert.equal(S.resultPercent(c), null);
  assert.equal(S.resultPlotValue(c, 'P6'), 87, 'a grade alone sits in the middle of its band');
});

test('before and after joining: the last result before, against the latest one since', () => {
  const list = [
    r('r1', 'Math', 'WA1', '2026-02-27', 21, 40),       // 52.5% AL6
    r('r2', 'Math', 'SA1', '2026-05-20', 58),            // 58% AL6  ← before (joined 1 Jun)
    r('r3', 'Math', 'WA3', '2026-06-15', 70),            // 15 days in: too soon to count as after
    r('r4', 'Math', 'SA2', '2026-10-25', 81)             // 81% AL3  ← after
  ];
  const c = S.compareSubject(list, '2026-06-01', 'P5');
  assert.equal(c.comparable, true);
  assert.equal(c.before.id, 'r2');
  assert.equal(c.after.id, 'r4');
  assert.equal(c.pctBefore, 58);
  assert.equal(c.pctAfter, 81);
  assert.equal(c.pctDelta, 23);
  assert.equal(c.gradeBefore, 'AL6');
  assert.equal(c.gradeAfter, 'AL3');
  assert.equal(c.gradeDelta, 3, 'AL6 → AL3 is three grades better');
  assert.equal(S.changeText(c), '▲ 3 grades · +23 marks');
  assert.equal(S.changeTone(c), 'up');
});

test('a result in the first three weeks counts as the starting point when there is none before', () => {
  const list = [r('r1', 'Science', 'WA1', '2026-03-10', 60), r('r2', 'Science', 'SA2', '2026-10-25', 55)];
  const c = S.compareSubject(list, '2026-03-01', 'P4');
  assert.equal(c.before.id, 'r1');
  assert.equal(c.gradeDelta, 0, 'AL6 → AL6');
  assert.equal(c.pctDelta, -5);
  assert.equal(S.changeText(c), 'same grade · −5 marks');
  assert.equal(S.changeTone(c), 'same');
});

test('what cannot be compared says why', () => {
  assert.equal(S.compareSubject([], '2026-03-01', 'P5').reason, 'no-results');
  assert.equal(S.compareSubject([r('a1', 'Math', 'WA1', '2026-03-01', 50)], '', 'P5').reason, 'no-join-date');
  assert.equal(S.compareSubject([r('a1', 'Math', 'SA2', '2026-10-01', 50)], '2026-03-01', 'P5').reason, 'no-before');
  assert.equal(S.compareSubject([r('a1', 'Math', 'WA1', '2026-02-01', 50)], '2026-03-01', 'P5').reason, 'no-after');
  // A child who moved from P6 to S1 keeps the marks but the grade scales differ.
  const c = S.compareSubject([r('a1', 'Math', 'PSLE', '2025-11-25', null, 100, 'AL4'), r('a2', 'Math', 'SA1', '2026-05-20', 72, 100, 'A2')], '2026-01-05', 'S1');
  assert.equal(c.comparable, true);
  assert.equal(c.gradeDelta, null);
  assert.equal(c.pctDelta, null);
  assert.equal(S.changeText(c), '');
});

test('the join date: "With us since", else the family\'s sign-up date', () => {
  assert.equal(S.joinDateOf({ startDate: '2026-04-02' }, { signUpDate: '2026-01-01' }), '2026-04-02');
  assert.equal(S.joinDateOf({ startDate: '' }, { signUpDate: '2026-01-01' }), '2026-01-01');
  assert.equal(S.joinDateOf({}, {}), '');
});

const FAMS = [
  { id: 'f1', parentName: 'Mrs Tan', status: 'active', students: [
    { id: 'a', name: 'Ethan Tan', level: 'P5', status: 'active', startDate: '2026-06-01' },
    { id: 'b', name: 'Chloe Tan', level: 'P3', status: 'active', startDate: '2026-06-01' }] },
  { id: 'f2', parentName: 'Mr Lim', status: 'active', students: [{ id: 'c', name: 'Ryan Lim', level: 'P6', status: 'active', startDate: '2026-02-01' }] },
  { id: 'f3', parentName: 'Ms Goh', status: 'active', students: [{ id: 'd', name: 'Zoe Goh', level: 'P5', status: 'active', startDate: '2026-02-01' }] },
  { id: 'f4', parentName: 'Mr Left', status: 'withdrawn', students: [{ id: 'e', name: 'Gone Kid', level: 'P5', status: 'active', startDate: '2026-02-01' }] }
];
const DOCS = {
  f1: S.normalizeResultsDoc({ token: 't', students: {
    a: [r('a1', 'Math', 'SA1', '2026-05-20', 58), r('a2', 'Math', 'SA2', '2026-10-25', 81), r('a3', 'Science', 'SA1', '2026-05-20', 70), r('a4', 'Science', 'SA2', '2026-10-25', 72)],
    b: [r('b1', 'Math', 'Test', '2026-07-01', 9, 10)] } }),
  f2: S.normalizeResultsDoc({ token: 't', students: { c: [r('c1', 'Science', 'WA1', '2026-01-20', 40), r('c2', 'Science', 'Prelim', '2026-08-31', 66)] } }),
  f3: S.normalizeResultsDoc({ token: 't', students: { d: [r('d1', 'Math', 'WA1', '2026-01-20', 77), r('d2', 'Math', 'SA2', '2026-10-25', 70)] } }),
  f4: S.normalizeResultsDoc({ token: 't', students: { e: [r('e1', 'Math', 'WA1', '2026-01-20', 30), r('e2', 'Math', 'SA2', '2026-10-25', 90)] } })
};

test('one row per child, with each subject compared; withdrawn children only on request', () => {
  const rows = S.childRows(FAMS, DOCS);
  assert.deepEqual(rows.map(x => x.name), ['Ethan Tan', 'Chloe Tan', 'Ryan Lim', 'Zoe Goh']);
  const ethan = rows[0];
  assert.deepEqual(ethan.subjects, ['Math', 'Science']);
  assert.equal(ethan.bySubject.Math.gradeDelta, 3);
  assert.equal(ethan.bySubject.Science.gradeDelta, 0, 'AL5 → AL5');
  assert.equal(rows[1].bySubject.Math.reason, 'no-before');
  assert.equal(S.childRows(FAMS, DOCS, { includeLeft: true }).length, 5);
  assert.deepEqual(S.childRows(FAMS, DOCS, { level: 'P5' }).map(x => x.name), ['Ethan Tan', 'Zoe Goh']);
  assert.deepEqual(S.childRows(FAMS, DOCS, { search: 'lim' }).map(x => x.name), ['Ryan Lim']);
});

test('the headline numbers and the sentences to copy', () => {
  const rows = S.childRows(FAMS, DOCS);
  const h = S.headline(rows);
  assert.equal(h.compared, 3, 'Ethan, Ryan and Zoe can be compared');
  assert.equal(h.graded, 3);
  assert.equal(h.improvedGrade, 2, 'Ethan (Maths AL6→AL3) and Ryan (Science AL7→AL5); Zoe dropped');
  assert.equal(h.pairs, 4);
  assert.equal(h.marksUp, 2);
  assert.equal(h.avgBefore, 61.3);
  assert.equal(h.avgAfter, 72.3);
  assert.equal(h.avgGain, 11);
  assert.deepEqual(h.best, { level: 'P5', subject: 'Math', from: 'AL6', to: 'AL3', grades: 3 });
  assert.equal(h.small, true);
  const texts = h.sentences.map(s => s.text);
  assert.deepEqual(texts, [
    '7 in 10 of our students improved by at least one grade in school exams after joining Polymath.',
    'Our students\' average mark rose from 61% to 72% after joining Polymath.',
    '7 in 10 of our students scored higher marks after joining Polymath.',
    'One of our P5 students went from AL6 to AL3 in Maths.'
  ]);
  assert.match(h.sentences[0].basis, /2 of 3 students \(67%\)/);
  texts.forEach(t => ['Ethan', 'Ryan', 'Zoe', 'Tan', 'Lim'].forEach(n => assert.ok(!t.includes(n), 'no names: ' + t)));
  const m = S.headline(rows, { subject: 'Math' });
  assert.equal(m.compared, 2);
  assert.equal(m.improvedGrade, 1);
  assert.equal(m.sentences[0].text, '5 in 10 of our students improved by at least one grade in Maths after joining Polymath.');
  assert.equal(m.sentences[1].text, 'Our students\' average Maths mark rose from 67.5% to 75.5% after joining Polymath.'.replace('67.5%', '68%').replace('75.5%', '76%'));
  assert.equal(S.headline([]).sentences.length, 0, 'nothing to say with no results');
});

test('"x in 10" rounds to the nearest', () => {
  assert.equal(S.inTen(8, 10), '8 in 10');
  assert.equal(S.inTen(2, 3), '7 in 10');
  assert.equal(S.inTen(13, 17), '8 in 10');
  assert.equal(S.inTen(0, 0), '');
});

test('a family\'s document is read leniently and results are kept in date order', () => {
  const d = S.normalizeResultsDoc({ familyId: 'f1', token: 'tok', parentUpdatedAt: { seconds: 5 }, students: {
    a: [r('z9', 'Math', 'SA2', '2026-10-25', 80), { junk: true }, r('z1', 'Math', 'WA1', '2026-03-01', 50), r('bad', 'Math', 'WA1', 'yesterday', 50)],
    empty: [] } });
  assert.deepEqual(d.students.a.map(x => x.id), ['z1', 'z9']);
  assert.equal('empty' in d.students, false);
  assert.equal(d.parentUpdatedAt, 5000);
  assert.equal(S.resultCount(d), 2);
  const up = S.upsertResult(d.students.a, r('z5', 'Math', 'SA1', '2026-05-20', 60));
  assert.deepEqual(up.map(x => x.id), ['z1', 'z5', 'z9']);
  assert.deepEqual(S.upsertResult(up, Object.assign({}, up[1], { mark: 61 })).map(x => x.mark), [50, 61, 80]);
  assert.deepEqual(S.removeResult(up, 'z5').map(x => x.id), ['z1', 'z9']);
  assert.equal(S.resultsDocId('abc'), 'results-abc');
  assert.equal(S.resultsLink('fam 1', 'k/2'), 'https://polymathlc.com.sg/results/?f=fam%201&k=k%2F2');
  assert.match(S.newResultId(n => Array.from({ length: n }, (_, i) => i * 7)), /^r[a-z2-9]{10}$/);
});

test('the chart marks the joining date and every result', () => {
  const list = DOCS.f1.students.a;
  const svg = S.chartSvg(list, { join: '2026-06-01', level: 'P5', title: 'Ethan' });
  assert.match(svg, /^<svg class="sr-chart"/);
  assert.match(svg, /Joined Polymath/);
  assert.equal((svg.match(/<circle /g) || []).length, 4);
  assert.equal((svg.match(/<polyline /g) || []).length, 2, 'a line per subject');
  assert.match(svg, /stroke="#056c76"/);
  assert.match(svg, /stroke="#ec008c"/);
  assert.match(svg, /<title>Maths · Mid-year · 20 May 2026 · 58% · ≈AL6<\/title>/);
  const one = S.chartSvg(list, { join: '2026-06-01', level: 'P5', subjects: ['Science'], compact: true });
  assert.equal((one.match(/<circle /g) || []).length, 2);
  assert.match(S.chartSvg([], {}), /No results yet/);
  assert.ok(!/NaN|undefined/.test(svg + one), 'no broken numbers');
  // A grade alone is a hollow dot.
  const psle = S.chartSvg([r('p1', 'Science', 'PSLE', '2026-11-25', null, 100, 'AL2')], { level: 'P6' });
  assert.match(psle, /fill="#ffffff" stroke="#ec008c"/);
});

test('the email and WhatsApp asking for results', () => {
  const fam = { parentName: 'Mrs Tan', students: [{ name: 'Ethan Tan', status: 'active' }, { name: 'Chloe Tan', status: 'active' }, { name: 'Gone', status: 'left' }] };
  const link = S.resultsLink('f1', 'tok12345678901234567890');
  const e = S.requestEmail(fam, link, { shell: (t, inner) => '<shell title="' + t + '">' + inner + '</shell>', signature: 'Mr Chung' });
  assert.equal(e.subject, 'Share Ethan and Chloe\'s school results with Polymath');
  assert.match(e.html, /^<shell title="School results">/);
  assert.ok(e.html.includes('href="' + S.esc(link) + '"'));
  assert.match(e.text, /Dear Mrs Tan/);
  assert.ok(e.text.includes(link));
  assert.match(e.text, /Mr Chung$/);
  assert.ok(!e.html.includes('Gone'));
  const w = S.requestWhatsappText(fam, link);
  assert.match(w, /^Hi Mrs Tan, this is Polymath Learning Centre/);
  assert.ok(w.includes('Ethan and Chloe\'s'));
  assert.ok(w.includes(link));
});

test('the CSV has a line per result', () => {
  const csv = S.resultsCsv(S.childRows(FAMS, DOCS));
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 1 + 4 + 1 + 2 + 2);
  assert.equal(lines[0], 'Student,Level,Parent,With us since,Subject,Exam,Date,Marks,Out of,Percent,Grade,Grade worked out,Entered by');
  assert.equal(lines[1], 'Ethan Tan,P5,Mrs Tan,2026-06-01,Maths,Mid-year exam (SA1),2026-05-20,58,100,58,AL6,yes,parent');
});

test('a child the parent changed is new until the office opens them', () => {
  const d = S.normalizeResultsDoc({ parentChanged: { a: 200, b: 100 }, officeSeen: { b: 150 } });
  assert.equal(S.changedByParent(d, 'a'), true);
  assert.equal(S.changedByParent(d, 'b'), false);
  assert.equal(S.changedByParent(d, 'c'), false);
  assert.equal(S.changedByParent(null, 'a'), false);
});
