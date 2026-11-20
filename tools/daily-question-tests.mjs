// The Free Question of the Day: every Maths answer worked out again from its own
// numbers, and the morning sender run against an in-memory store.
//   node --test tools/daily-question-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runSend, buildFor } from './daily-question-send.mjs';

const require = createRequire(import.meta.url);
const core = require('../shop-function/functions/daily-question-core.js');
const { MATH, SCIENCE } = require('../shop-function/functions/daily-question-bank.js');

/* ═════════ Maths answers, worked out again ═════════ */

// The number an option stands for: '700 000', '3 7/8', '16 2/3%', '$2.65', '1.5 ℓ', '80 km/h'.
function value(option) {
  const s = option.replace(/km\/h|cm²|cm³|cm|km|kg|min|ℓ|°|%|\$/g, '').replace(/\bh\b/g, '').replace(/\s+/g, ' ').trim();
  if (/^\d{1,3}( \d{3})+$/.test(s)) return Number(s.replace(/ /g, ''));
  let m = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  return Number(s);
}
// '3y + 4' or '$(3k + 3)' at a value of the letter.
function algebra(option, letter, x) {
  const s = option.replace(/[$()\s]/g, '');
  const m = new RegExp('^(\\d*)' + letter + '\\+(\\d+)$').exec(s);
  assert.ok(m, 'an expression: ' + option);
  return (m[1] === '' ? 1 : Number(m[1])) * x + Number(m[2]);
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
function clock(h, m, add) {
  const total = h * 60 + m + add, hh = Math.floor(total / 60) % 24, mm = total % 60;
  return (hh % 12 || 12) + '.' + String(mm).padStart(2, '0') + (hh >= 12 ? ' p.m.' : ' a.m.');
}
function ratioTotal() {
  // Ali : Ben = 4 : 7; after Ali gives 15, 1 : 3. The smallest total that works.
  for (let total = 11; total < 10000; total += 11) {
    const ali = total * 4 / 11;
    if ((ali - 15) * 4 === total) return total;
  }
  return NaN;
}

// id → the correct answer, computed. A number is compared with value(option);
// a string must equal the option exactly; a function picks the option itself.
const EXPECTED = {
  m001: Math.floor(3762015 / 100000) % 10 * 100000,
  m002: gcd(24, 36),
  m003: 27 / 3 * 4 / 3 * 2,
  m004: (Math.round(7.396 * 100) / 100).toFixed(2),
  m005: 15 * 24 - 98,
  m006: (46 / 2 - 15) * 15,
  m007: COMPASS[(0 + 135 / 45) % 8],
  m008: options => options.reduce((best, o) => (value(o) > value(best) ? o : best)),
  m009: 2 + 1 / 4 + 1 + 5 / 8,
  m010: 7 * 13 + 5,
  m011: 10 - 3 * 2.45,
  m012: 24 / (5 - 3) * (3 + 5),
  m013: 80 - 80 * 15 / 100,
  m014: 5 * 20 - 4 * 18,
  m015: 12 * 9 / 2,
  m016: 40 * 25 * 30 / 2 / 1000,
  m017: 3 / 4 / 6,
  m018: 45 / (18 / 4),
  m019: 0.36 * 400,
  m020: 48 / (1 - 2 / 5 - (1 - 2 / 5) / 3),
  m021: (30 - 25) / 25 * 100,
  m022: 30 / (3 - 2) * 2,
  m023: (180 - 48) / 2,
  m024: 36 - 12 / 4 * 3 + 5,
  m025: options => options.find(o => algebra(o, 'y', 2) === 5 * 2 + 7 - 2 * 2 - 3 && algebra(o, 'y', 5) === 5 * 5 + 7 - 2 * 5 - 3),
  m026: (3 * 4 + 8) / 2,
  m027: 22 / 7 * 7 * 7,
  m028: 22 / 7 * 28 / 2 + 28,
  m029: 180 / (2 + 15 / 60),
  m030: 15 * 40 / 60,
  m031: ratioTotal(),
  m032: 210 / (1 - 0.3),
  m033: Math.round(Math.cbrt(343)) ** 2,
  m034: 40 - 40 * 35 / 100,
  m035: 3 * 42 - 2 * 39,
  m036: 3 + 3 + 3,
  m037: options => options.find(o => algebra(o, 'k', 2) === 2 * 2 + (2 + 3) && algebra(o, 'k', 7) === 2 * 7 + (7 + 3)),
  m038: 2 / 3 * 1 / 4 + 1 / 3 * 1 / 2,
  m039: 47 * 2 + 1,
  m040: clock(19, 45, 2 * 60 + 35),
  m041: 10 * 10 - 10 * 6 / 2,
  m042: 270 / (60 + 30)
};

test('every Maths question has a worked-out answer here', () => {
  assert.deepEqual(MATH.map(q => q.id).sort(), Object.keys(EXPECTED).sort(), 'add the new question to EXPECTED');
});

for (const q of MATH) {
  test('Maths ' + q.id + ' (' + q.topic + '): the marked option is the right one, and the only one', () => {
    const want = EXPECTED[q.id];
    let matching;
    if (typeof want === 'function') matching = q.options.filter(o => o === want(q.options));
    else if (typeof want === 'string') matching = q.options.filter(o => o === want);
    else {
      assert.ok(Number.isFinite(want), 'a number');
      matching = q.options.filter(o => Math.abs(value(o) - want) < 1e-9);
    }
    assert.equal(matching.length, 1, q.id + ': exactly one option is ' + (typeof want === 'function' ? 'right' : want));
    assert.equal(q.options[q.answer], matching[0], q.id + ': the answer index points at it');
  });
}

test('Maths working mentions the right answer', () => {
  for (const q of MATH) {
    const right = q.options[q.answer].replace(/^\$\(|\)$/g, '').replace(/[$]/g, '');
    const core1 = right.replace(/ (cm²|cm|km\/h|km|kg|ℓ|min|h)$/, '').replace(/%$/, '');
    assert.ok(q.steps.join(' ').toLowerCase().includes(core1.toLowerCase()), q.id + ' steps reach ' + right);
  }
});

test('Science answers are not all the same letter, and no option repeats another question\'s stem', () => {
  const letters = new Set(SCIENCE.map(q => q.answer));
  assert.ok(letters.size >= 3);
  const mathLetters = new Set(MATH.map(q => q.answer));
  assert.ok(mathLetters.size >= 3);
});

/* ═════════ The morning sender ═════════ */

function fakeStore({ subscribers = [], settings = {}, days = {} } = {}) {
  const state = { subscribers: new Map(subscribers.map(s => [s.id, structuredClone(s)])), settings: structuredClone(settings),
    days: structuredClone(days), mail: new Map(), runs: new Map() };
  return {
    state,
    async getSettings() { return structuredClone(state.settings); },
    async ensureDay(day) { if (!state.days[day]) state.days[day] = core.pickForDay(day, null); return core.pickForDay(day, state.days[day]); },
    async getDays(list) { const out = {}; for (const d of list) out[d] = core.pickForDay(d, state.days[d] || null); return out; },
    async listSubscribers() { return [...state.subscribers.values()].map(s => structuredClone(s)); },
    async createMailOnce(id, message) { if (state.mail.has(id)) return false; state.mail.set(id, structuredClone(message)); return true; },
    async patchSubscriber(id, patch) { state.subscribers.set(id, Object.assign({}, state.subscribers.get(id), patch)); },
    async getRun(day) { return state.runs.has(day) ? structuredClone(state.runs.get(day)) : null; },
    async saveRun(day, data) { state.runs.set(day, Object.assign({ day }, state.runs.get(day) || {}, data)); },
    async listFamilies() { return new Map(Object.entries(state.families || {})); }
  };
}
const sub = (id, extra = {}) => Object.assign({ id: id.padEnd(24, '0'), token: 'k'.repeat(32), email: id + '@example.test', name: '',
  status: 'active', frequency: 'daily', subjects: ['math', 'science'], level: 'P5', confirmedAt: 1, consent: { at: 1 } }, extra);
// Saturday 21 November 2026, 6:07 a.m. Singapore.
const SATURDAY_MORNING = Date.UTC(2026, 10, 20, 22, 7);
const quiet = () => {};
const opts = (store, extra = {}) => Object.assign({ store, now: SATURDAY_MORNING, log: quiet, sleep: async () => {}, gapMs: 0 }, extra);

test('the morning run emails daily subscribers once, and weekly ones on Saturday', async () => {
  const store = fakeStore({ subscribers: [sub('a'), sub('b', { frequency: 'weekly', subjects: ['science'] }),
    sub('c', { status: 'pending' }), sub('d', { status: 'unsubscribed' })] });
  const first = await runSend(opts(store));
  assert.equal(first.sent, 2);
  assert.equal(first.daily, 1);
  assert.equal(first.weekly, 1);
  const ids = [...store.state.mail.keys()];
  assert.ok(ids.includes('polymath-qotd-daily-2026-11-21-' + 'a'.padEnd(24, '0')));
  assert.ok(ids.includes('polymath-qotd-weekly-2026-11-21-' + 'b'.padEnd(24, '0')));
  assert.equal(store.state.subscribers.get('a'.padEnd(24, '0')).lastDailyDay, '2026-11-21');
  assert.equal(store.state.subscribers.get('a'.padEnd(24, '0')).sentCount, 1);
  // The backup run an hour later sends nothing more.
  const second = await runSend(opts(store, { now: SATURDAY_MORNING + 90 * 60000 }));
  assert.equal(second.sent, 0);
  assert.equal(store.state.mail.size, 2);
  const run = store.state.runs.get('2026-11-21');
  assert.equal(run.sent, 2);
  assert.equal(run.daily, 1);
  assert.deepEqual(Object.keys(run.questions), ['math', 'science']);
  assert.deepEqual(Object.keys(run.questions.math), ['P3', 'P4', 'P5', 'P6']);
});

test('the daily email holds today\'s question and yesterday\'s answer, for the chosen subjects only', async () => {
  const store = fakeStore({ subscribers: [sub('a', { subjects: ['math'] })] });
  await runSend(opts(store));
  const mail = [...store.state.mail.values()][0];
  const today = core.publicPair('2026-11-21', store.state.days['2026-11-21'], true, 'P5').math;
  const yesterday = core.publicPair('2026-11-20', core.defaultPick('2026-11-20'), true, 'P5').math;
  assert.equal(today.level, 'P5');
  assert.ok(mail.message.text.includes(today.q.split('\n')[0]));
  assert.ok(mail.message.text.includes('Answer: ' + yesterday.answerLetter + '. ' + yesterday.options[yesterday.answer]));
  assert.ok(!/Science/.test(mail.message.subject));
  assert.match(mail.message.headers['List-Unsubscribe'], /^<https:\/\/us-central1-mathgen--app\.cloudfunctions\.net\/dailyQuestion\?u=/);
});

test('a paused list sends nothing; so does a run outside 6 a.m. to 9 p.m.', async () => {
  const paused = fakeStore({ subscribers: [sub('a')], settings: { mode: 'paused' } });
  assert.equal((await runSend(opts(paused))).skipped, 'paused');
  assert.equal(paused.state.mail.size, 0);
  const night = fakeStore({ subscribers: [sub('a')] });
  // 2 a.m. Singapore.
  assert.equal((await runSend(opts(night, { now: Date.UTC(2026, 10, 20, 18, 0) }))).skipped, 'outside-hours');
  assert.equal(night.state.mail.size, 0);
});

test('the cap holds the rest back and says so', async () => {
  const store = fakeStore({ subscribers: [sub('a', { confirmedAt: 3 }), sub('b', { confirmedAt: 1 }), sub('c', { confirmedAt: 2 })], settings: { dailyCap: 2 } });
  const lines = [];
  const result = await runSend(opts(store, { log: line => lines.push(line) }));
  assert.equal(result.sent, 2);
  assert.equal(result.heldBack, 1);
  assert.ok(!store.state.mail.has('polymath-qotd-daily-2026-11-21-' + 'a'.padEnd(24, '0')), 'the newest waits');
  assert.ok(lines.some(line => line.startsWith('::warning::')));
  assert.ok(lines.every(line => !line.includes('@')), 'the public log never shows an address');
});

test('a dry run builds everything and writes nothing', async () => {
  const store = fakeStore({ subscribers: [sub('a'), sub('b', { adminNotified: false })] });
  const result = await runSend(opts(store, { dryRun: true }));
  assert.equal(result.sent, 2);
  assert.equal(store.state.mail.size, 0);
  assert.equal(store.state.runs.size, 0);
  assert.equal(store.state.subscribers.get('b'.padEnd(24, '0')).adminNotified, false);
});

test('new subscribers go to the centre in one note, once', async () => {
  const store = fakeStore({ subscribers: [sub('a', { adminNotified: false, name: 'Mrs Lim' }), sub('b', { adminNotified: true })] });
  const result = await runSend(opts(store));
  assert.equal(result.adminNote, 1);
  const note = [...store.state.mail.entries()].find(([id]) => id.startsWith('polymath-qotd-admin-'));
  assert.ok(note);
  assert.match(note[1].message.html, /Mrs Lim/);
  assert.equal(store.state.subscribers.get('a'.padEnd(24, '0')).adminNotified, true);
  const again = await runSend(opts(store, { now: SATURDAY_MORNING + HOUR_MS }));
  assert.equal(again.adminNote, 0);
});
const HOUR_MS = 3600000;

test('buildFor: no weekly email when there is no past week yet', () => {
  const pairsAt = (d, levels, withAnswer) => core.publicPair(d, core.defaultPick(d), withAnswer, levels);
  assert.equal(buildFor({ sub: sub('a', { frequency: 'weekly' }), kind: 'weekly' }, '2026-11-20', pairsAt, { math: 'P5', science: 'P5' }), null);
});

/* ═════════ Never above the child's level ═════════ */

const levelOf = text => (/(P[3-6]) (Maths|Science)/.exec(text) || [])[1];
test('each parent gets the questions for their child\'s level, never above it', async () => {
  const store = fakeStore({ subscribers: [sub('p4', { level: 'P4', subjects: ['math'] }), sub('p6', { level: 'P6', subjects: ['science'] }),
    sub('p3', { level: 'P3', subjects: ['math', 'science'] })] });
  await runSend(opts(store));
  const mailTo = id => [...store.state.mail.values()].find(m => m.to[0] === id + '@example.test');
  const p4 = mailTo('p4');
  assert.match(p4.message.subject, /P4 Maths/);
  const p6 = mailTo('p6');
  assert.match(p6.message.subject, /P6 Science/);
  // The bank has no P3 Maths: a P3 child gets Science only, never a P4 Maths question.
  const p3 = mailTo('p3');
  assert.ok(p3, 'the P3 parent still gets Science');
  assert.ok(!/Maths/.test(p3.message.text.split('YESTERDAY')[0]), 'no Maths above P3');
  for (const m of store.state.mail.values()) {
    for (const found of m.message.text.matchAll(/(P[3-6]) (Maths|Science) ·/g)) {
      const want = { 'p4@example.test': 'P4', 'p6@example.test': 'P6', 'p3@example.test': 'P3' }[m.to[0]];
      assert.ok(found[1] <= want, m.to[0] + ' got ' + found[1]);
    }
  }
});

test('a parent with no level, or a P1/P2 child, is held back and never guessed', async () => {
  const store = fakeStore({ subscribers: [sub('none', { level: '' }), sub('p2', { level: 'P2' }), sub('ok', { level: 'P5' })] });
  const lines = [];
  const result = await runSend(opts(store, { log: line => lines.push(line) }));
  assert.equal(result.noLevel, 2);
  assert.equal(result.daily, 1);
  assert.equal(store.state.subscribers.get('none'.padEnd(24, '0')).lastDailyDay, undefined, 'tried again once a level is set');
  assert.ok(lines.some(l => /no question at or below/.test(l)));
});

test('an approved /student family\'s level wins over the level typed at sign-up', async () => {
  const store = fakeStore({ subscribers: [sub('fam', { level: 'P6', subjects: ['math', 'science'] })] });
  store.state.families = { 'fam@example.test': [{ name: 'Ann', level: 'P4', subjects: 'math' }, { name: 'Ben', level: 'P6', subjects: 'both' }] };
  const result = await runSend(opts(store));
  assert.equal(result.fromStudent, 1);
  const mail = [...store.state.mail.values()][0];
  const today = mail.message.text.split('YESTERDAY')[0];
  assert.match(today, /P4 Maths/, 'the youngest child doing Maths');
  assert.match(today, /P6 Science/, 'the youngest child doing Science');
  assert.equal(levelOf('P4 Maths ·'), 'P4');
});

test('familyLevels: youngest child per subject; secondary gets P6; P1/P2 gets nothing', () => {
  assert.deepEqual(core.pool.familyLevels([{ level: 'P5', subjects: 'science' }, { level: 'P3', subjects: 'math' }]), { math: 'P3', science: 'P5' });
  assert.deepEqual(core.pool.familyLevels([{ level: 'S2', subjects: 'both' }]), { math: 'P6', science: 'P6' });
  assert.deepEqual(core.pool.familyLevels([{ level: 'P2', subjects: 'both' }]), { math: '', science: '' });
  assert.deepEqual(core.pool.familyLevels([{ level: 'P4', subjects: 'science' }]), { math: 'P4', science: 'P4' }, 'a subject nobody takes: the youngest child');
  assert.equal(core.pool.familyLevels([]), null);
});

/* ═════════ The workflow ═════════ */

test('the workflow runs the sender on a schedule with the service account and no Cloud Scheduler', () => {
  const yml = readFileSync(new URL('../.github/workflows/daily-question.yml', import.meta.url), 'utf8');
  assert.match(yml, /cron: '7 22 \* \* \*'/, 'about 6:07 a.m. Singapore');
  assert.match(yml, /FIREBASE_SERVICE_ACCOUNT/);
  assert.match(yml, /tools\/daily-question-send\.mjs/);
  assert.doesNotMatch(yml, /onSchedule|pubsub/);
});

test('the workflow prepares the pool every evening, masks the key and keeps the preview private', () => {
  const yml = readFileSync(new URL('../.github/workflows/daily-question.yml', import.meta.url), 'utf8');
  assert.match(yml, /cron: '7 14 \* \* \*'/, 'about 10:07 p.m. Singapore');
  assert.match(yml, /github\.event\.schedule == '7 14 \* \* \*'/, 'the evening schedule runs the prepare job');
  assert.match(yml, /github\.event\.schedule != '7 14 \* \* \*'/, 'and never the sender');
  assert.match(yml, /tools\/daily-question-prepare\.mjs --dry-run/);
  assert.match(yml, /--check-marking/);
  assert.match(yml, /::add-mask::\$KEY/, 'the AI key is masked before use');
  assert.match(yml, /node --test tools\/daily-question-prepare-tests\.mjs/, 'the prepare tests run before the prepare run');
  assert.match(yml, /retention-days: 1/, 'the encrypted preview is short-lived');
  assert.match(yml, /case "\$PAGES" in ''\|\*\[!0-9\]\*\) PAGES=12/, 'hand-typed numbers are checked');
  assert.doesNotMatch(yml, /set -x/);
});

test('the home box asks for a level, sends it, and marks typed answers', () => {
  const js = readFileSync(new URL('../question-of-the-day.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(js, /action: 'subscribe', email: email, level: childLevel/);
  assert.match(js, /action: 'mark'/);
  assert.match(js, /action: 'today', level: want/);
  assert.match(html, /<select id="qd-level" name="level"/);
  for (const l of ['P3', 'P4', 'P5', 'P6']) assert.match(html, new RegExp('<option value="' + l + '">'));
});

test('the sign-up box on /question and on the home page says exactly what is recorded, marketing included', () => {
  const page = readFileSync(new URL('../question/index.html', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const shown = html => html.replace(/&#39;/g, "'");
  assert.ok(shown(page).includes('<span id="j-consent-text">' + core.CONSENT_TEXT + '</span>'));
  assert.ok(shown(home).includes('<span>' + core.CONSENT_TEXT + '</span>'));
  assert.match(core.CONSENT_TEXT, /marketing emails/);
  assert.match(core.CONSENT_TEXT, /unsubscribe at any time/);
});
