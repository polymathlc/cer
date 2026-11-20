'use strict';
// The mistake notebook (notebook-core.js rules, notebook.js door, notebook-store.js
// fitting), against an in-memory store. node --test test/notebook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../notebook-core');
const { createNotebookService, childrenFor, matchChild, validateBody, stateDocId } = require('../notebook');
const { fitState, MAX_DOC_CHARS } = require('../notebook-store');
const { createHttp } = require('../service');

const DAY = 24 * 3600000;
// Friday 20 Nov 2026, 1 PM in Singapore.
const T0 = Date.UTC(2026, 10, 20, 5, 0, 0);
const ORIGIN = 'https://polymathlc.com.sg';

/* ───────── sample data, in the shapes the apps really write ───────── */
const SB_MCQ = {
  key: 'doc1|3', docId: 'doc1', docName: 'P5 Science WS 12', level: 'P5', subject: 'Science', page: 2, number: '3',
  question: 'Which part of the plant takes in water?', type: 'mcq',
  options: [{ label: '1', text: 'Leaf' }, { label: '2', text: 'Root' }, { label: '3', text: 'Stem' }, { label: '4', text: 'Flower' }],
  option: '2', studentAnswer: '1', answer: '(2) Root', explanation: 'Root hairs absorb water.', verdict: 'wrong', skipped: false,
  topic: 'Plant transport', imagePath: 'tutor-mistakes/kid1/m1.jpg', createdAt: { _seconds: (T0 - 3 * DAY) / 1000 }
};
const SB_SHORT = {
  docId: 'doc2', docName: 'P5 Math Fractions', level: 'P5', subject: 'Math', number: '7', question: 'What is 3/4 of 24?',
  type: 'open', options: [], answer: '18', studentAnswer: '16', verdict: 'wrong', createdAt: T0 - 5 * DAY
};
const SB_OPEN = {
  docId: 'doc1', docName: 'P5 Science WS 12', level: 'P5', subject: 'Science', number: '9',
  question: 'Explain why the ice cubes melted faster in the metal cup.', type: 'open',
  answer: 'Metal is a good conductor of heat, so heat from the surroundings is gained by the ice faster.', studentAnswer: 'metal is hot',
  verdict: 'partial', createdAt: T0 - 2 * DAY
};
const SB_SKIPPED = { docId: 'doc1', docName: 'P5 Science WS 12', number: '10', question: 'Name the process.', type: 'open', answer: 'Evaporation', studentAnswer: '', verdict: '', skipped: true, createdAt: T0 - 2 * DAY };
const SCIENCE_APP = { id: 'mk_1', qId: 'q123', qTitle: 'Springs', kind: 'open', verdict: 'incorrect', expected: 'stretches', student: 'heavier', at: '2026-11-01T00:00:00Z' };
const ROSTER = 'fam1_kid1';
const IDENT = 'r:' + ROSTER;
const SESSION = {
  v: 1, epoch: T0 - 1 * DAY, slot: 'WED-2', slotLabel: 'Wed 5pm P5 Science', startedAt: T0 - 1 * DAY, endedAt: T0 - 1 * DAY + 6000000,
  questions: [
    { id: 'q1', kind: 'mcq', text: 'Which is a conductor?', options: ['Wood', 'Copper', 'Plastic'], answer: 1, at: T0 - DAY + 60000, to: 'all', open: false },
    { id: 'q2', kind: 'blank', text: 'Water boils at ___ °C.', accepted: ['100', '100 °C'], at: T0 - DAY + 120000, to: 'all', open: false },
    { id: 'q3', kind: 'cloze', text: 'Fill in the keywords.', parts: ['Plants make food by ', 0, ' using ', 1, '.'], keys: [['photosynthesis'], ['light energy', 'sunlight']], model: 'Plants make food by photosynthesis using light energy.', at: T0 - DAY + 180000, to: 'all', open: false },
    { id: 'q4', kind: 'open', text: 'Why do we sweat?', model: 'To lose heat when sweat evaporates.', at: T0 - DAY + 240000, to: 'all', open: false },
    { id: 'q5', kind: 'mcq', text: 'Right answer here', options: ['A', 'B'], answer: 0, at: T0 - DAY + 300000, to: 'all' },
    { id: 'q6', kind: 'open', text: 'Only marked by the AI', model: 'x', at: T0 - DAY + 360000, to: 'all' },
    { id: 'q7', kind: 'mcq', text: 'For someone else', options: ['A', 'B'], answer: 0, at: T0 - DAY + 420000, to: ['r:fam2_kid9'] },
    { id: 'q8', kind: 'open', text: '', img: { ref: 'pic1', n: 2 }, model: 'See the diagram.', at: T0 - DAY + 480000, to: 'all' }
  ],
  answers: {
    q1: { [IDENT]: { aid: 'a1', v: 0, at: T0 - DAY + 70000, ok: false } },
    q2: { [IDENT]: { aid: 'a2', v: '90', at: T0 - DAY + 130000, ok: false } },
    q3: { [IDENT]: { aid: 'a3', v: ['eating', 'water'], at: T0 - DAY + 190000, ok: 'partial' } },
    q4: { [IDENT]: { aid: 'a4', v: 'to cool', at: T0 - DAY + 250000, ok: 'partial', ph: 'ph1' } },
    q5: { [IDENT]: { aid: 'a5', v: 0, at: T0 - DAY + 310000, ok: true } },
    q6: { [IDENT]: { aid: 'a6', v: 'no idea', at: T0 - DAY + 370000, ok: null, ai: { v: 'wrong' } } },
    q7: { 'r:fam2_kid9': { aid: 'a7', v: 1, at: T0 - DAY + 430000, ok: false } },
    q8: { [IDENT]: { aid: 'a8', v: 'dunno', at: T0 - DAY + 490000, ok: false } }
  },
  people: { [IDENT]: { identity: IDENT, name: 'Amy Tan', rosterId: ROSTER } }
};
const BOOK = { v: 1, students: { [IDENT]: { name: 'Amy Tan', rows: [{ e: SESSION.epoch, q: 8, k: 6 }] }, 'r:fam2_kid9': { name: 'Bob', rows: [{ e: SESSION.epoch }] } } };
const FAMILIES = [
  { id: 'fam1', parentName: 'Mrs Tan', email: 'Parent.Tan@Example.test', email2: '', status: 'active',
    students: [{ id: 'kid1', name: 'Amy Tan Mei Ling', level: 'P5', status: 'active' }, { id: 'kid2', name: 'Ben Tan', level: 'P3', status: 'active' }] },
  { id: 'fam2', parentName: 'Mr Lim', email: 'lim@example.test', students: [{ id: 'kid9', name: 'Bob Lim', level: 'P6', status: 'active' }] },
  { id: 'fam3', parentName: 'Gone', email: 'gone@example.test', status: 'withdrawn', students: [{ id: 'kid5', name: 'Old Kid', level: 'P4' }] }
];

/* ───────── an in-memory store with the same calls as notebook-store.js ───────── */
function memoryStore(seed = {}) {
  const states = new Map();
  const calls = [];
  const s = {
    states, calls,
    access: seed.access || {},
    profiles: seed.profiles || {},
    families: seed.families || FAMILIES,
    mistakes: seed.mistakes || {},
    books: seed.books || [{ teacher: 'teach1', book: BOOK }],
    sessions: seed.sessions || { ['teach1/' + SESSION.epoch]: SESSION },
    photos: seed.photos || { ['teach1/' + SESSION.epoch + '/pic1']: 'data:image/jpeg;base64,QUJD' },
    images: seed.images || { 'tutor-mistakes/kid1/m1.jpg': 'data:image/jpeg;base64,WFla' },
    async getAccess(uid) { calls.push('access'); return s.access[uid] || null; },
    async getProfile(uid) { return s.profiles[uid] || null; },
    async listFamilies() { calls.push('families'); return s.families; },
    async uidsForRoster(rosterId) { return Object.keys(s.profiles).filter(uid => s.profiles[uid].officeId === rosterId); },
    async worksheetMistakes(uid) { calls.push('worksheets:' + uid); return (s.mistakes[uid] || []).map((data, i) => ({ id: 'm' + (i + 1) + uid, data })); },
    async progressBooks() { calls.push('books'); return s.books; },
    async liveSession(t, e) { calls.push('session'); return s.sessions[t + '/' + e] || null; },
    async livePhoto(t, e, r) { return s.photos[t + '/' + e + '/' + r] || ''; },
    async storageImage(p) { return s.images[p] || ''; },
    async getState(id) { return states.has(id) ? JSON.parse(states.get(id)) : N.emptyState(); },
    async updateState(id, fn) {
      const raw = states.has(id) ? JSON.parse(states.get(id)) : N.emptyState();
      const out = fn(raw);
      const fitted = fitState(out.state);
      if (out.changed) states.set(id, fitted.json);
      return { state: fitted.state };
    }
  };
  return s;
}
function harness(seed, clock) {
  const store = memoryStore(seed);
  const time = { now: clock || T0 };
  const tokens = Object.assign({
    'tok-parent-tan-0000000000': { uid: 'uidParent', email: 'parent.tan@example.test', email_verified: true, name: 'Mrs Tan' },
    'tok-admin-00000000000000000': { uid: 'uidAdmin', email: 'chungzhikai@gmail.com', email_verified: true },
    'tok-pass-amy-000000000000000': { uid: 'uidStudyAmy', officePass: true, officeId: ROSTER },
    'tok-pending-0000000000000000': { uid: 'uidPending', email: 'p@example.test', email_verified: true },
    'tok-anon-000000000000000000': { uid: 'uidAnon', firebase: { sign_in_provider: 'anonymous' } },
    'tok-lone-000000000000000000': { uid: 'uidLone', email: 'lone@example.test', email_verified: true }
  }, seed && seed.tokens);
  const logs = [];
  const service = createNotebookService({
    store, http: createHttp(code => logs.push(code)), now: () => time.now, report: code => logs.push(code),
    verifyIdToken: async token => { if (!tokens[token]) throw new Error('bad'); return tokens[token]; }
  });
  async function call(token, body, extra = {}) {
    const headers = Object.assign({ origin: ORIGIN, 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, extra.headers);
    const req = { method: extra.method || 'POST', body, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
    await service.mistakeNotebook(req, res);
    return res;
  }
  return { store, time, call, logs, service };
}
const approvedTan = {
  uidParent: { status: 'approved', parentEmail: 'parent.tan@example.test', children: [{ name: 'Amy Tan', level: 'P5', subjects: 'both' }, { name: 'Ben', level: 'P3', subjects: 'science' }] },
  uidPending: { status: 'pending', parentEmail: 'p@example.test', children: [{ name: 'Pat', level: 'P4' }] },
  uidLone: { status: 'approved', parentEmail: 'lone@example.test', children: [{ name: 'Lonely Kid', level: 'P4' }] }
};

/* ═════════════════════════ the rules ═════════════════════════ */
test('weeks run Monday to Sunday in Singapore', () => {
  assert.equal(N.weekKey(T0), '2026-11-16');
  // Sunday 22 Nov 11:59 PM SGT is still that week; Monday 23 Nov 00:00 SGT is the next.
  assert.equal(N.weekKey(Date.UTC(2026, 10, 22, 15, 59)), '2026-11-16');
  assert.equal(N.weekKey(Date.UTC(2026, 10, 22, 16, 0)), '2026-11-23');
  // Monday 16 Nov 00:30 SGT is Sunday evening in UTC, and already the new week.
  assert.equal(N.weekKey(Date.UTC(2026, 10, 15, 16, 30)), '2026-11-16');
  assert.equal(N.weekLabel('2026-11-16'), 'Week of 16 Nov');
  assert.equal(N.weekEndsAt('2026-11-16'), Date.UTC(2026, 10, 22, 16, 0));
  assert.equal(N.sgDay(T0), 'Fri 20 Nov');
});

test('short answers are marked like the live class marks them', () => {
  assert.ok(N.blankMatches(['100'], ' 100. '));
  assert.ok(N.blankMatches(['0.5'], '1/2'));
  assert.ok(N.blankMatches(['3'], '3 cm'));
  assert.ok(!N.blankMatches(['3 cm'], '3 m'));
  assert.ok(N.blankMatches(['Evaporation'], 'the evaporation'));
  assert.ok(!N.blankMatches(['18'], '16'));
  assert.ok(N.blankMatches(['1 1/2'], '1.5'));
  assert.ok(!N.blankMatches([], 'x'));
});

test('Study Buddy worksheet mistakes become notebook mistakes', () => {
  const mcq = N.fromWorksheet('m1', SB_MCQ);
  assert.equal(mcq.id, 'W-m1');
  assert.equal(mcq.kind, 'mcq');
  assert.deepEqual(mcq.options, ['Leaf', 'Root', 'Stem', 'Flower']);
  assert.equal(mcq.key.answer, 1);
  assert.equal(mcq.yours, '(1) Leaf');
  assert.equal(mcq.where, 'P5 Science WS 12 · Q3');
  assert.equal(mcq.sub, 'science');
  assert.equal(mcq.lvl, 'P5');
  assert.deepEqual(mcq.img, { t: 'storage', p: 'tutor-mistakes/kid1/m1.jpg' });
  assert.equal(mcq.at, T0 - 3 * DAY);
  const short = N.fromWorksheet('m2', SB_SHORT);
  assert.equal(short.kind, 'blank');
  assert.deepEqual(short.key.accepted, ['18']);
  const open = N.fromWorksheet('m3', SB_OPEN);
  assert.equal(open.kind, 'open');
  assert.equal(open.verdict, 'partial');
  const skipped = N.fromWorksheet('m4', SB_SKIPPED);
  assert.equal(skipped.verdict, 'skipped');
  assert.equal(skipped.yours, '');
  assert.equal(N.fromWorksheet('m5', SCIENCE_APP), null, 'a Science portal practice entry is not a worksheet question');
  assert.equal(N.fromWorksheet('m6', Object.assign({}, SB_MCQ, { cleared: true })), null);
  assert.equal(N.fromWorksheet('bad id!', SB_MCQ), null);
  // A picture path that is not Study Buddy's own folder is dropped, never fetched.
  assert.equal(N.fromWorksheet('m7', Object.assign({}, SB_MCQ, { imagePath: '../secrets/x.jpg' })).img, undefined);
});

test('a live lesson gives only the questions the TEACHER marked wrong or partly right', () => {
  const items = N.fromLiveSession(SESSION, IDENT, 'teach1');
  assert.deepEqual(items.map(i => i.id), ['L-' + SESSION.epoch + '-q1', 'L-' + SESSION.epoch + '-q2', 'L-' + SESSION.epoch + '-q3', 'L-' + SESSION.epoch + '-q4', 'L-' + SESSION.epoch + '-q8']);
  const [q1, q2, q3, q4, q8] = items;
  assert.equal(q1.yours, 'A. Wood');
  assert.equal(q1.key.answer, 1);
  assert.match(q1.where, /^Live lesson · Thu 19 Nov · Wed 5pm P5 Science$/);
  assert.equal(q1.sub, 'science');
  assert.deepEqual(q2.key.accepted, ['100', '100 °C']);
  assert.equal(q3.verdict, 'partial');
  assert.equal(q3.yours, 'Plants make food by [eating] using [water].');
  assert.deepEqual(q3.key.keys, [['photosynthesis'], ['light energy', 'sunlight']]);
  assert.match(q4.yours, /photo of your working/);
  assert.deepEqual(q8.img, { t: 'live', u: 'teach1', e: String(SESSION.epoch), r: 'pic1' });
  assert.deepEqual(N.fromLiveSession(SESSION, 'r:fam2_kid9', 'teach1').map(i => i.id), ['L-' + SESSION.epoch + '-q7']);
  assert.deepEqual(N.fromLiveSession({ questions: [] }, IDENT, 't'), []);
  assert.deepEqual(N.fromLiveSession(SESSION, 'bad', 't'), []);
});

test('the progress books say which lessons a child was in, newest first, each once', () => {
  const books = [{ teacher: 't1', book: { students: { [IDENT]: { rows: [{ e: 5 }, { e: 9 }] } } } },
    { teacher: 't2', book: { students: { [IDENT]: { rows: [{ e: 7 }] } } } },
    { teacher: 't1', book: { students: { [IDENT]: { rows: [{ e: 5 }] } } } },
    { teacher: 'bad/one', book: { students: { [IDENT]: { rows: [{ e: 3 }] } } } }];
  assert.deepEqual(N.lessonsInBooks(books, IDENT).map(l => l.teacher + ':' + l.epoch), ['t1:9', 't2:7', 't1:5']);
});

test('redoing: multiple choice is marked at once; other answers match the key or ask the child', () => {
  const [q1, q2, q3, q4] = N.fromLiveSession(SESSION, IDENT, 'teach1');
  assert.equal(N.check(q1, 1), true);
  assert.equal(N.check(q1, 0), false);
  assert.equal(N.check(q2, '100'), true);
  assert.equal(N.check(q2, 'one hundred'), null, 'a different way of writing it is the child\'s to judge, never a ✗');
  assert.equal(N.check(q3, ['photosynthesis', 'sunlight']), true);
  assert.equal(N.check(q3, ['photosynthesis', 'the sun']), null);
  assert.equal(N.check(q4, 'evaporation cools us'), null);
  const noKey = N.cleanItem({ id: 'L-1-x', kind: 'mcq', text: 'Q', options: ['a', 'b'], key: { answer: -1 } });
  assert.equal(N.check(noKey, 0), null);
  assert.equal(N.cleanValue(q1, 9), null);
  assert.deepEqual(N.cleanValue(q3, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).length, 8);
});

test('a mistake goes open → fixed → mastered, and back to open when it is got wrong again', () => {
  let s = N.mergeItems(N.emptyState(), N.fromLiveSession(SESSION, IDENT, 'teach1')).state;
  const id = 'L-' + SESSION.epoch + '-q1';
  assert.equal(N.statusOf(s.log[id]), 'open');
  s = N.record(s, id, false, T0, 'redo').state;
  assert.equal(N.statusOf(s.log[id]), 'open');
  s = N.record(s, id, true, T0 + DAY, 'redo').state;
  assert.equal(N.statusOf(s.log[id]), 'fixed');
  // Right again too soon is still "fixed": the check-up must be days later.
  s = N.record(s, id, true, T0 + 2 * DAY, 'redo').state;
  assert.equal(N.statusOf(s.log[id]), 'fixed');
  s = N.record(s, id, true, T0 + DAY + N.CHECKUP_DAYS * DAY, 'quiz').state;
  assert.equal(N.statusOf(s.log[id]), 'mastered');
  s = N.record(s, id, false, T0 + 40 * DAY, 'quiz').state;
  assert.equal(N.statusOf(s.log[id]), 'open');
  assert.equal(s.log[id].back, 1);
  assert.equal(s.log[id].tries.length, 5);
  assert.equal(N.record(s, 'L-1-nothere', true, T0, 'redo').changed, false);
});

test('the weekly quiz: picked once a week, wrong-again first, then never redone, then check-ups', () => {
  const ws = [SB_MCQ, SB_SHORT, SB_OPEN, SB_SKIPPED].map((m, i) => N.fromWorksheet('w' + i, m));
  const live = N.fromLiveSession(SESSION, IDENT, 'teach1');
  let s = N.mergeItems(N.emptyState(), ws.concat(live)).state;
  assert.equal(Object.keys(s.items).length, 9);
  let r = N.ensureWeek(s, T0, ROSTER);
  assert.equal(r.changed, true);
  assert.equal(r.week, '2026-11-16');
  const first = r.state.weeks['2026-11-16'].ids;
  assert.equal(first.length, N.QUIZ_SIZE);
  assert.equal(new Set(first).size, first.length);
  // Same week → the same quiz, however often it is opened.
  const again = N.ensureWeek(r.state, T0 + 3600000, ROSTER);
  assert.equal(again.changed, false);
  assert.deepEqual(again.state.weeks['2026-11-16'].ids, first);
  // A mistake redone WRONG goes to the front of next week's choice; fixed
  // mistakes wait for their check-up.
  s = r.state;
  const wrongAgain = 'W-w3';
  s = N.record(s, wrongAgain, false, T0 + DAY, 'redo').state;
  const fixedOne = 'L-' + SESSION.epoch + '-q1';
  s = N.record(s, fixedOne, true, T0 + DAY, 'redo').state;
  const next = N.ensureWeek(s, T0 + 7 * DAY, ROSTER).state.weeks['2026-11-23'].ids;
  assert.ok(next.includes(wrongAgain));
  assert.ok(!next.includes(fixedOne), 'a mistake fixed a week ago is not checked yet');
  // Three weeks later the fixed one is due for its check-up.
  const later = N.pickQuiz(s, '2026-12-14', T0 + 24 * DAY, ROSTER);
  assert.ok(later.ids.includes(fixedOne));
  assert.ok(later.checkups.includes(fixedOne));
  // Hidden mistakes ("this question was wrong") never come up.
  const hid = N.setHidden(s, wrongAgain, true).state;
  assert.ok(!N.pickQuiz(hid, '2026-12-14', T0 + 24 * DAY, ROSTER).ids.includes(wrongAgain));
});

test('a week picked when the notebook was empty is filled in once mistakes arrive', () => {
  let r = N.ensureWeek(N.emptyState(), T0, 'x');
  assert.deepEqual(r.state.weeks['2026-11-16'].ids, []);
  const s = N.mergeItems(r.state, N.fromLiveSession(SESSION, IDENT, 'teach1')).state;
  const re = N.refillWeek(s, T0 + 1000, 'x');
  assert.equal(re.changed, true);
  assert.equal(re.state.weeks['2026-11-16'].ids.length, 5);
  assert.equal(N.refillWeek(re.state, T0 + 2000, 'x').changed, false);
});

test('the answer is only sent with a mistake that is fixed, or after a go at it', () => {
  let s = N.mergeItems(N.emptyState(), N.fromLiveSession(SESSION, IDENT, 'teach1')).state;
  const id = 'L-' + SESSION.epoch + '-q1';
  assert.equal(N.publicItem(s.items[id], s.log[id], false).key, undefined);
  assert.equal(N.publicItem(s.items[id], s.log[id], true).key.answerText, 'B. Copper');
  s = N.record(s, id, true, T0, 'redo').state;
  assert.ok(N.publicItem(s.items[id], s.log[id], false).key);
  const cloze = N.publicKey(s.items['L-' + SESSION.epoch + '-q3']);
  assert.equal(cloze.full, 'Plants make food by photosynthesis using light energy.');
  assert.equal(cloze.known, true);
});

test('stats count the week, the fixes and a streak of finished weeks', () => {
  let s = N.mergeItems(N.emptyState(), N.fromLiveSession(SESSION, IDENT, 'teach1')).state;
  s = N.ensureWeek(s, T0, 'k').state;
  const ids = s.weeks['2026-11-16'].ids;
  ids.forEach((id, i) => { s = N.record(s, id, i % 2 === 0, T0 + 1000 * (i + 1), 'quiz').state; });
  const st = N.statsOf(s, '2026-11-16');
  assert.equal(st.weekSize, 5);
  assert.equal(st.weekDone, 5);
  assert.equal(st.weekRight, 3);
  assert.equal(st.fixed, 3);
  assert.equal(st.open, 2);
  assert.equal(st.fixedThisWeek, 3);
  assert.equal(st.streak, 1);
  assert.equal(st.live, 5);
});

test('the notebook never outgrows one document', () => {
  let s = N.emptyState();
  const big = 'x'.repeat(1100);
  const items = [];
  for (let i = 0; i < 600; i++) items.push({ id: 'W-big' + i, kind: 'open', text: big + i, at: i, key: { model: big, explain: big } });
  s = N.mergeItems(s, items).state;
  assert.ok(Object.keys(s.items).length <= N.KEEP_ITEMS);
  const fitted = fitState(s);
  assert.ok(fitted.json.length <= MAX_DOC_CHARS);
  assert.ok(Object.keys(fitted.state.items).length > 50);
  // The newest are kept.
  assert.ok(fitted.state.items['W-big599']);
});

test('which children an account belongs to', () => {
  const families = FAMILIES;
  // By the parent's email and the child names on the /student form.
  const kids = childrenFor({ actor: { uid: 'u', email: 'parent.tan@example.test', verified: true }, access: approvedTan.uidParent, profile: null, families });
  assert.deepEqual(kids.map(k => k.key), ['fam1_kid1', 'fam1_kid2']);
  assert.equal(kids[0].level, 'P5');
  // An office pass (personal live link) names the child itself.
  assert.deepEqual(childrenFor({ actor: { uid: 'x', officeId: 'fam2_kid9' }, access: null, profile: null, families }).map(k => k.key), ['fam2_kid9']);
  // studentProfiles.officeId.
  assert.deepEqual(childrenFor({ actor: { uid: 'x' }, access: null, profile: { officeId: 'fam1_kid2' }, families }).map(k => k.key), ['fam1_kid2']);
  // An unverified Google email is not trusted on its own.
  assert.deepEqual(childrenFor({ actor: { uid: 'x', email: 'lim@example.test', verified: false }, access: null, profile: null, families }), []);
  // A roster id pointing at nobody is ignored.
  assert.deepEqual(childrenFor({ actor: { uid: 'x', officeId: 'fam1_nobody' }, access: null, profile: null, families }), []);
  assert.equal(matchChild([{ id: 'a', name: 'Amy Tan' }, { id: 'b', name: 'Ben Tan' }], ['Tan'], ''), null);
  assert.equal(matchChild([{ id: 'a', name: 'Amy Tan' }, { id: 'b', name: 'Ben Tan' }], ['Tan'], 'P5'), null);
  assert.equal(matchChild([{ id: 'a', name: 'Amy Tan', level: 'P5' }, { id: 'b', name: 'Ben Tan', level: 'P3' }], ['Tan'], 'P5').id, 'a');
  assert.equal(stateDocId('fam1_kid1'), 'r_fam1_kid1');
  assert.equal(stateDocId('u-abc'), 'u_abc');
});

test('requests are checked before anything is read', () => {
  assert.throws(() => validateBody(null), /invalid-request/);
  assert.throws(() => validateBody({ action: 'drop' }), /invalid-request/);
  assert.throws(() => validateBody({ action: 'load', extra: 1 }), /invalid-request/);
  assert.throws(() => validateBody({ action: 'answer', id: 'L-1-q', value: { a: 1 } }), /invalid-request/);
  assert.throws(() => validateBody({ action: 'answer', id: '../x', value: 1 }), /invalid-request/);
  assert.throws(() => validateBody({ action: 'self', id: 'L-1-q', right: 'yes' }), /invalid-request/);
  assert.throws(() => validateBody({ action: 'load', child: 'users/x' }), /invalid-request/);
  assert.deepEqual(validateBody({ action: 'answer', id: 'L-1-q', value: ['a'], how: 'quiz', child: 'fam1_kid1' }),
    { action: 'answer', child: 'fam1_kid1', id: 'L-1-q', value: ['a'], how: 'quiz' });
});

/* ═════════════════════════ the door ═════════════════════════ */
test('a signed-out, anonymous or unapproved visitor gets nothing', async () => {
  const h = harness({ access: approvedTan });
  assert.equal((await h.call('', { action: 'load' })).statusCode, 401);
  assert.equal((await h.call('tok-anon-000000000000000000', { action: 'load' })).statusCode, 401);
  assert.equal((await h.call('not-a-real-token-0000000000', { action: 'load' })).statusCode, 401);
  const pending = await h.call('tok-pending-0000000000000000', { action: 'load' });
  assert.equal(pending.statusCode, 403);
  assert.equal(pending.body.error, 'not-approved');
  const elsewhere = await h.call('tok-parent-tan-0000000000', { action: 'load' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(elsewhere.statusCode, 403);
  assert.equal(h.store.states.size, 0);
});

test('a parent opens the notebook: worksheets and live lessons, and this week\'s quiz', async () => {
  const h = harness({ access: approvedTan, mistakes: { uidParent: [SB_MCQ, SB_SHORT, SB_OPEN, SCIENCE_APP, Object.assign({}, SB_SHORT, { level: 'P3', docName: 'P3 sheet' })] } });
  const res = await h.call('tok-parent-tan-0000000000', { action: 'load' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const b = res.body;
  assert.deepEqual(b.children.map(c => c.name), ['Amy Tan Mei Ling', 'Ben Tan']);
  assert.equal(b.child, 'fam1_kid1');
  const ids = b.notebook.items.map(i => i.id);
  // 3 worksheet mistakes at P5 (the P3 sheet is Ben's, the Science app entry is skipped) + 5 from the lesson.
  assert.equal(b.notebook.stats.worksheet, 3);
  assert.equal(b.notebook.stats.live, 5);
  assert.equal(ids.length, 8);
  assert.ok(b.notebook.items.every(i => i.key === undefined), 'no answers are sent for open mistakes');
  assert.equal(b.notebook.week.ids.length, 8);
  assert.equal(b.notebook.week.label, 'Week of 16 Nov');
  assert.equal(b.notebook.sources.lessons, 1);
  assert.ok(h.store.states.has('r_fam1_kid1'));
  // Ben's notebook has only the P3 worksheet and no live lessons.
  const ben = await h.call('tok-parent-tan-0000000000', { action: 'load', child: 'fam1_kid2' });
  assert.equal(ben.body.notebook.stats.total, 1);
  // Another family's child is refused.
  const other = await h.call('tok-parent-tan-0000000000', { action: 'load', child: 'fam2_kid9' });
  assert.equal(other.statusCode, 404);
});

test('redoing in the quiz: ✓ fixes it, ✗ keeps it, and a written answer is the child\'s to judge', async () => {
  const h = harness({ access: approvedTan });
  await h.call('tok-parent-tan-0000000000', { action: 'load' });
  const q1 = 'L-' + SESSION.epoch + '-q1', q4 = 'L-' + SESSION.epoch + '-q4', q2 = 'L-' + SESSION.epoch + '-q2';
  const wrong = await h.call('tok-parent-tan-0000000000', { action: 'answer', child: 'fam1_kid1', id: q1, value: 2, how: 'quiz' });
  assert.equal(wrong.body.right, false);
  assert.equal(wrong.body.key.answerText, 'B. Copper');
  assert.equal(wrong.body.item.status, 'open');
  assert.equal(wrong.body.week.done[q1], 0);
  const right = await h.call('tok-parent-tan-0000000000', { action: 'answer', child: 'fam1_kid1', id: q2, value: '100°C', how: 'quiz' });
  assert.equal(right.body.right, true);
  assert.equal(right.body.item.status, 'fixed');
  const open = await h.call('tok-parent-tan-0000000000', { action: 'answer', child: 'fam1_kid1', id: q4, value: 'sweat evaporates and takes heat away', how: 'quiz' });
  assert.equal(open.body.right, null);
  assert.match(open.body.key.model, /evaporates/);
  assert.equal(open.body.week.done[q4], undefined, 'nothing is recorded until the child says');
  const said = await h.call('tok-parent-tan-0000000000', { action: 'self', child: 'fam1_kid1', id: q4, right: true, how: 'quiz' });
  assert.equal(said.body.status, 'fixed');
  assert.equal(said.body.stats.weekDone, 3);
  assert.equal(said.body.stats.fixed, 2);
  const missing = await h.call('tok-parent-tan-0000000000', { action: 'answer', child: 'fam1_kid1', id: 'L-1-zz', value: 1 });
  assert.equal(missing.statusCode, 404);
});

test('pictures come from the lesson or Study Buddy\'s folder, only for the child\'s own mistakes', async () => {
  const h = harness({ access: approvedTan, mistakes: { uidParent: [SB_MCQ] } });
  await h.call('tok-parent-tan-0000000000', { action: 'load' });
  const live = await h.call('tok-parent-tan-0000000000', { action: 'image', child: 'fam1_kid1', id: 'L-' + SESSION.epoch + '-q8' });
  assert.equal(live.body.image, 'data:image/jpeg;base64,QUJD');
  const ws = await h.call('tok-parent-tan-0000000000', { action: 'image', child: 'fam1_kid1', id: 'W-m1uidParent' });
  assert.equal(ws.body.image, 'data:image/jpeg;base64,WFla');
  const none = await h.call('tok-parent-tan-0000000000', { action: 'image', child: 'fam1_kid1', id: 'L-' + SESSION.epoch + '-q1' });
  assert.equal(none.statusCode, 404);
});

test('a personal-link sign-in sees the same child\'s notebook as the parent', async () => {
  const h = harness({ access: approvedTan, profiles: { uidStudyAmy: { officeId: ROSTER } }, mistakes: { uidStudyAmy: [SB_OPEN] } });
  const kid = await h.call('tok-pass-amy-000000000000000', { action: 'load' });
  assert.equal(kid.statusCode, 200, JSON.stringify(kid.body));
  assert.equal(kid.body.child, ROSTER);
  assert.equal(kid.body.notebook.stats.worksheet, 1);
  const parent = await h.call('tok-parent-tan-0000000000', { action: 'load' });
  // The parent's load also reads the child's own Study Buddy account.
  assert.equal(parent.body.notebook.stats.worksheet, 1);
  assert.deepEqual(parent.body.notebook.week.ids, kid.body.notebook.week.ids);
});

test('an approved account with no Office family keeps its own worksheet notebook', async () => {
  const h = harness({ access: approvedTan, mistakes: { uidLone: [SB_SHORT] } });
  const res = await h.call('tok-lone-000000000000000000', { action: 'load' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.child, 'u-uidLone');
  assert.equal(res.body.children[0].name, 'Lonely Kid');
  assert.equal(res.body.notebook.stats.total, 1);
  assert.equal(res.body.notebook.stats.live, 0);
});

test('the admins can list every child and open any notebook; nobody else can', async () => {
  const h = harness({ access: approvedTan });
  const list = await h.call('tok-admin-00000000000000000', { action: 'roster' });
  assert.deepEqual(list.body.children.map(c => c.key).sort(), ['fam1_kid1', 'fam1_kid2', 'fam2_kid9']);
  const view = await h.call('tok-admin-00000000000000000', { action: 'load', as: 'fam2_kid9' });
  assert.equal(view.statusCode, 200);
  assert.equal(view.body.viewing, true);
  assert.equal(view.body.notebook.stats.live, 1);
  assert.equal((await h.call('tok-parent-tan-0000000000', { action: 'roster' })).statusCode, 403);
  // `as` from a parent is ignored: they still only see their own child.
  const sneaky = await h.call('tok-parent-tan-0000000000', { action: 'load', as: 'fam2_kid9' });
  assert.equal(sneaky.body.child, 'fam1_kid1');
});

test('hiding a mistake takes it out of the quiz and the counts', async () => {
  const h = harness({ access: approvedTan });
  const first = await h.call('tok-parent-tan-0000000000', { action: 'load' });
  const id = first.body.notebook.items[0].id;
  const hid = await h.call('tok-parent-tan-0000000000', { action: 'hide', child: 'fam1_kid1', id, hidden: true });
  assert.equal(hid.body.item.hidden, true);
  assert.equal(hid.body.stats.total, first.body.notebook.stats.total - 1);
  const shown = await h.call('tok-parent-tan-0000000000', { action: 'hide', child: 'fam1_kid1', id, hidden: false });
  assert.equal(shown.body.stats.total, first.body.notebook.stats.total);
});

test('reveal shows the answer and remembers the peek', async () => {
  const h = harness({ access: approvedTan });
  await h.call('tok-parent-tan-0000000000', { action: 'load' });
  const id = 'L-' + SESSION.epoch + '-q3';
  const r = await h.call('tok-parent-tan-0000000000', { action: 'reveal', child: 'fam1_kid1', id });
  assert.equal(r.body.key.full, 'Plants make food by photosynthesis using light energy.');
  const st = N.cleanState(JSON.parse(h.store.states.get('r_fam1_kid1')));
  assert.ok(st.log[id].peekAt > 0);
});

test('a broken lesson record never stops the notebook opening', async () => {
  const h = harness({ access: approvedTan, sessions: {} , mistakes: { uidParent: [SB_MCQ] } });
  h.store.liveSession = async () => { throw new Error('boom'); };
  const res = await h.call('tok-parent-tan-0000000000', { action: 'load' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notebook.stats.worksheet, 1);
  assert.deepEqual(res.body.notebook.sources.problems, ['lesson']);
});
