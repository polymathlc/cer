'use strict';
// The Free Question of the Day: the bank, the rotation, sign-up (double opt-in),
// confirm, manage, unsubscribe (link and one-click), the admin actions and the
// emails, run against the real store on an in-memory Firestore with subcollections.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttp, hash } = require('../service');
const core = require('../daily-question-core');
const { createDailyQuestionStore } = require('../daily-question-store');
const { createDailyQuestionService, TEST_SUBSCRIBER } = require('../daily-question');
const { MATH, SCIENCE } = require('../daily-question-bank');

const ORIGIN = 'https://polymathlc.com.sg';
// Friday 20 November 2026, 10:00 a.m. in Singapore.
const NOW = Date.UTC(2026, 10, 20, 2, 0, 0);
const HOUR = 3600000, DAY = 86400000;

/* ─── An in-memory Firestore with nested collections ─── */
function database() {
  const rows = new Map();
  const clone = v => (v === undefined ? undefined : structuredClone(v));
  const merge = (a, b) => Object.assign({}, a || {}, b);
  const snapshot = ref => ({ exists: rows.has(ref.path), id: ref.id, ref, data: () => clone(rows.get(ref.path)) });
  const children = prefix => [...rows.keys()].filter(path => path.startsWith(prefix + '/') && path.slice(prefix.length + 1).split('/').length === 1);
  function docRef(path) {
    return {
      path, id: path.split('/').at(-1),
      collection: name => collectionRef(path + '/' + name),
      async get() { return snapshot(this); },
      async set(data, options) { rows.set(path, clone(options && options.merge ? merge(rows.get(path), data) : data)); },
      async create(data) { if (rows.has(path)) { const e = new Error('Document already exists'); e.code = 6; throw e; } rows.set(path, clone(data)); },
      async update(data) { if (!rows.has(path)) throw new Error('No document'); rows.set(path, clone(merge(rows.get(path), data))); },
      async delete() { rows.delete(path); }
    };
  }
  function collectionRef(path, order = null, max = Infinity, filters = []) {
    return {
      doc: id => docRef(path + '/' + id),
      orderBy: (field, direction = 'asc') => collectionRef(path, { field, direction }, max, filters),
      limit: n => collectionRef(path, order, n, filters),
      where: (field, op, value) => collectionRef(path, order, max, filters.concat([[field, op, value]])),
      async get() {
        let docs = children(path).map(p => snapshot(docRef(p)));
        docs = docs.filter(d => filters.every(([field, op, value]) => op === '==' && d.data()[field] === value));
        if (order) docs.sort((a, b) => {
          const x = a.data()[order.field], y = b.data()[order.field];
          return (x < y ? -1 : x > y ? 1 : 0) * (order.direction === 'desc' ? -1 : 1);
        });
        docs = docs.slice(0, max);
        return { docs, empty: !docs.length, size: docs.length };
      }
    };
  }
  let pending = Promise.resolve();
  return {
    rows,
    collection: name => collectionRef(name),
    async getAll(...refs) { return refs.map(snapshot); },
    runTransaction(action) {
      const run = pending.then(async () => {
        const writes = [];
        const result = await action({
          get: async ref => snapshot(ref),
          getAll: async (...refs) => refs.map(snapshot),
          set: (ref, data, options) => writes.push(['set', ref, data, options]),
          create: (ref, data) => writes.push(['create', ref, data]),
          update: (ref, data) => writes.push(['update', ref, data]),
          delete: ref => writes.push(['delete', ref])
        });
        for (const [type, ref] of writes) {
          if (type === 'create' && rows.has(ref.path)) throw new Error('Already exists');
          if (type === 'update' && !rows.has(ref.path)) throw new Error('No document');
        }
        for (const [type, ref, data, options] of writes) {
          if (type === 'delete') rows.delete(ref.path);
          else if (type === 'update' || (type === 'set' && options && options.merge)) rows.set(ref.path, clone(merge(rows.get(ref.path), data)));
          else rows.set(ref.path, clone(data));
        }
        return result;
      });
      pending = run.catch(() => {});
      return run;
    }
  };
}

let tokenCounter = 0;
function harness() {
  const db = database(), logs = [];
  let clock = NOW;
  const store = createDailyQuestionStore(db, null);
  const makeToken = () => ('T' + String(++tokenCounter).padStart(4, '0')).padEnd(32, 'x');
  const verifyIdToken = async token => {
    if (token === 'admin-token-'.padEnd(24, 'a')) return { email: 'admin@polymathlc.com.sg', email_verified: true };
    if (token === 'other-token-'.padEnd(24, 'a')) return { email: 'someone@example.com', email_verified: true };
    if (token === 'unver-token-'.padEnd(24, 'a')) return { email: 'chungzhikai@gmail.com', email_verified: false };
    throw new Error('bad token');
  };
  const service = createDailyQuestionService({ store, http: createHttp(code => logs.push(code)), hashIp: hash, verifyIdToken,
    now: () => clock, makeToken, report: code => logs.push(code) });
  async function call(body, overrides = {}) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json', ...(overrides.headers || {}) };
    const req = { method: 'POST', body, ip: '192.0.2.44', query: {}, ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
      json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, type(t) { this.headers['Content-Type'] = t; return this; },
      redirect(code, url) { this.statusCode = code; this.location = url; return this; } };
    await service.dailyQuestion(req, res);
    return res;
  }
  const admin = body => call(body, { headers: { authorization: 'Bearer ' + 'admin-token-'.padEnd(24, 'a') } });
  const mails = () => [...db.rows.entries()].filter(([path]) => path.startsWith('mail/')).map(([path, doc]) => Object.assign({ id: path.slice(5) }, doc));
  const subscriber = email => {
    const row = db.rows.get('trialSettings/dailyQuestion/subscribers/' + core.subscriberId(email));
    return row ? Object.assign({ id: core.subscriberId(email) }, row) : null;
  };
  return { db, logs, call, admin, mails, subscriber, store, advance: ms => { clock += ms; }, setClock: ms => { clock = ms; } };
}
const signup = (overrides = {}) => ({ action: 'subscribe', email: 'Parent@Example.test', name: 'Mrs Lim', level: 'P5',
  subjects: ['math', 'science'], frequency: 'daily', consent: true, pageVersion: 'v1.0.0', ...overrides });
const keyFromLink = (text, param) => {
  const match = new RegExp('[?]' + param + '=([0-9a-f]{24}\\.[A-Za-z0-9_-]{32})').exec(text);
  assert.ok(match, 'the email has a ?' + param + '= link');
  return match[1];
};

/* ─── The bank ─── */

test('every question has four different options, a valid answer, steps and a key idea', () => {
  const ids = new Set();
  for (const [subject, list] of [['math', MATH], ['science', SCIENCE]]) {
    assert.ok(list.length >= 40, subject + ' has at least 40 questions');
    for (const q of list) {
      assert.match(q.id, subject === 'math' ? /^m\d{3}$/ : /^s\d{3}$/);
      assert.ok(!ids.has(q.id), 'ids are unique: ' + q.id);
      ids.add(q.id);
      assert.ok(['P3', 'P4', 'P5', 'P6'].includes(q.level), q.id + ' level');
      if (subject === 'math') assert.ok(q.level !== 'P3', 'Maths is taught from P4');
      assert.equal(q.options.length, 4, q.id + ' has four options');
      assert.equal(new Set(q.options).size, 4, q.id + ' options differ');
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.id + ' answer');
      assert.ok(q.q.length > 10 && q.topic && q.idea.length > 10, q.id + ' text');
      assert.ok(Array.isArray(q.steps) && q.steps.length >= 1 && q.steps.every(s => typeof s === 'string' && s.length > 5), q.id + ' steps');
    }
  }
});

test('the bank rotation visits every question of a level once before any repeats', () => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (const subject of core.SUBJECTS) {
    for (const level of core.pool.LEVELS) {
      const list = core.BANK_BY_LEVEL[subject][level];
      if (!list.length) { assert.equal(core.defaultPick('2026-11-25').picks[subject][level], '', 'no question at a level the bank lacks'); continue; }
      assert.equal(gcd(core.strideFor(list.length, core.STRIDES[subject]), list.length), 1);
      const seen = new Set();
      for (let i = 0; i < list.length; i++) seen.add(core.defaultPick(core.addDays(core.START_DAY, i)).picks[subject][level]);
      assert.equal(seen.size, list.length, subject + ' ' + level);
      for (const id of seen) assert.equal(core.questionById(id).question.level, level, 'a slot holds its own level');
    }
  }
});

test('days are Singapore days, and the stored pair wins over the default', () => {
  assert.equal(core.sgDayKey(Date.UTC(2026, 10, 19, 16, 30)), '2026-11-20', '12:30 a.m. on the 20th in Singapore');
  assert.equal(core.fmtDay('2026-11-21'), 'Saturday 21 November 2026');
  assert.equal(core.weekdayOf('2026-11-21'), core.WEEKLY_WEEKDAY);
  // A day stored before v2 keeps its two questions, in the slots of their own levels.
  const legacy = core.pickForDay('2026-11-25', { math: 'm010', science: 's020' });
  assert.equal(legacy.picks.math[core.questionById('m010').question.level], 'm010');
  assert.equal(legacy.picks.science[core.questionById('s020').question.level], 's020');
  assert.deepEqual(core.pickForDay('2026-11-25', { math: 's001', science: 'nope' }), core.defaultPick('2026-11-25'), 'wrong-subject ids fall back');
  // A v2 slot holding a question of another level falls back too.
  const wrongLevel = { v: 2, picks: { math: { P4: 'm036' }, science: {} }, items: {} };
  assert.equal(core.pickForDay('2026-11-25', wrongLevel).picks.math.P4, core.defaultPick('2026-11-25').picks.math.P4);
});

test('a question only carries its answer when asked', () => {
  const hidden = core.publicQuestion('m012', '2026-11-20', false);
  assert.equal(hidden.answer, undefined);
  assert.equal(hidden.steps, undefined);
  const shown = core.publicQuestion('m012', '2026-11-20', true);
  assert.equal(shown.answer, 2);
  assert.equal(shown.answerLetter, 'C');
  assert.ok(shown.steps.length);
});

/* ─── Today ─── */

test('today: no answers for today, answers for the days before, nothing before the start', async () => {
  const h = harness();
  const res = await h.call({ action: 'today' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.day, '2026-11-20');
  assert.equal(res.body.isToday, true);
  assert.equal(res.body.questions.math.answer, undefined);
  assert.equal(res.body.questions.science.steps, undefined);
  assert.equal(res.body.previous, null, 'the first day has no yesterday');
  assert.ok(h.db.rows.has('trialSettings/dailyQuestion/days/2026-11-20'), 'today\'s pair is pinned');
  h.advance(2 * DAY);
  const later = await h.call({ action: 'today' });
  assert.equal(later.body.day, '2026-11-22');
  assert.equal(later.body.previous.day, '2026-11-21');
  assert.equal(typeof later.body.previous.questions.math.answer, 'number');
  assert.deepEqual(later.body.recent.map(r => r.day), ['2026-11-20']);
  assert.equal(later.body.recent[0].questions.science.id, res.body.questions.science.id, 'a day keeps its question');
  const past = await h.call({ action: 'today', day: '2026-11-20' });
  assert.equal(past.body.isToday, false);
  assert.equal(typeof past.body.questions.math.answer, 'number', 'a past day shows its answers');
  assert.equal((await h.call({ action: 'today', day: '2026-11-23' })).statusCode, 404, 'tomorrow is a secret');
  assert.equal((await h.call({ action: 'today', day: '2026-11-19' })).statusCode, 404, 'before the start');
  assert.equal((await h.call({ action: 'today', day: 'nope' })).statusCode, 400);
});

test('only the site may call it, and only with POST JSON', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'today' }, { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await h.call({ action: 'today' }, { method: 'GET' })).statusCode, 405);
  assert.equal((await h.call({ action: 'nope' })).statusCode, 400);
  assert.equal((await h.call([])).statusCode, 400);
});

/* ─── Sign-up, confirm, manage, unsubscribe ─── */

test('sign-up sends one confirmation email and nothing else until it is clicked', async () => {
  const h = harness();
  const res = await h.call(signup());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: 'check-email' });
  const sub = h.subscriber('parent@example.test');
  assert.equal(sub.status, 'pending');
  assert.equal(sub.email, 'parent@example.test', 'stored in lower case');
  assert.equal(sub.consent.text, core.CONSENT_TEXT);
  assert.deepEqual(sub.subjects, ['math', 'science']);
  const sent = h.mails();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['parent@example.test']);
  assert.match(sent[0].from, /admin@polymathlc\.com\.sg/);
  assert.match(sent[0].message.subject, /confirm/i);
  assert.match(sent[0].message.html, /Yes, send me the questions/);
  keyFromLink(sent[0].message.text, 'c');
  // A double tap a moment later sends nothing more, and says the same thing.
  const again = await h.call(signup());
  assert.deepEqual(again.body, { ok: true, status: 'check-email' });
  assert.equal(h.mails().length, 1);
  // A few minutes later the confirmation can be sent again, with the same link.
  h.advance(5 * 60000);
  await h.call(signup());
  const both = h.mails();
  assert.equal(both.length, 2);
  assert.equal(keyFromLink(both[0].message.text, 'c'), keyFromLink(both[1].message.text, 'c'));
});

test('sign-up checks the address, the consent box, the subjects and the level', async () => {
  const h = harness();
  assert.equal((await h.call(signup({ email: 'not-an-email' }))).body.error, 'invalid-email');
  assert.equal((await h.call(signup({ consent: false }))).body.error, 'consent-required');
  assert.equal((await h.call(signup({ subjects: [] }))).body.error, 'choose-subject');
  assert.equal((await h.call(signup({ subjects: ['english'] }))).body.error, 'choose-subject');
  assert.equal((await h.call(signup({ frequency: 'hourly' }))).body.error, 'invalid-frequency');
  assert.equal((await h.call(signup({ level: 'P9' }))).body.error, 'choose-level');
  assert.equal((await h.call(signup({ level: 'P2' }))).body.error, 'choose-level', 'questions start at P3');
  assert.equal((await h.call(signup({ level: undefined }))).body.error, 'choose-level', 'the level is needed');
  assert.equal((await h.call(signup({ extra: 1 }))).statusCode, 400);
  assert.equal((await h.call(signup({ name: '<script>' }))).statusCode, 400);
  assert.equal(h.mails().length, 0);
});

test('a robot that fills the hidden field is told to check its email and nothing is stored', async () => {
  const h = harness();
  const res = await h.call(signup({ website: 'http://spam.example' }));
  assert.deepEqual(res.body, { ok: true, status: 'check-email' });
  assert.equal(h.mails().length, 0);
  assert.equal(h.subscriber('parent@example.test'), null);
});

test('one address cannot be sent more than a few confirmations a day, and one IP is limited', async () => {
  const h = harness();
  for (let i = 0; i < 8; i++) { await h.call(signup({ email: 'flood@example.test' })); h.advance(4 * 60000); }
  assert.equal(h.mails().length, core.LIMITS.addressMails);
  const h2 = harness();
  for (let i = 0; i < core.LIMITS.perIpHour; i++) assert.equal((await h2.call(signup({ email: 'p' + i + '@example.test' }))).statusCode, 200);
  const blocked = await h2.call(signup({ email: 'one-more@example.test' }));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, 'too-many-signups');
});

test('confirming makes the parent active and sends the welcome email with today\'s question once', async () => {
  const h = harness();
  await h.call(signup());
  const key = keyFromLink(h.mails()[0].message.text, 'c');
  h.advance(HOUR);
  const res = await h.call({ action: 'confirm', key });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.already, false);
  assert.equal(res.body.subscriber.email, 'pa•••@example.test');
  const sub = h.subscriber('parent@example.test');
  assert.equal(sub.status, 'active');
  assert.equal(sub.lastDailyDay, '2026-11-20', 'today\'s question is in the welcome, so the morning run skips today');
  const welcome = h.mails().find(m => m.polymathQotd.kind === 'welcome');
  assert.ok(welcome);
  assert.match(welcome.message.subject, /Welcome/);
  const today = (await h.call({ action: 'today' })).body.questions;
  assert.ok(welcome.message.text.includes(today.math.q.split('\n')[0]));
  assert.ok(welcome.message.text.includes(today.science.q.split('\n')[0]));
  assert.match(welcome.message.headers['List-Unsubscribe'], /dailyQuestion\?u=/);
  assert.equal(welcome.message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(welcome.message.html, /free diagnostic test/i);
  // Clicking again is fine and sends nothing.
  const again = await h.call({ action: 'confirm', key });
  assert.equal(again.body.already, true);
  assert.equal(h.mails().filter(m => m.polymathQotd.kind === 'welcome').length, 1);
});

test('a wrong or broken link is refused the same way', async () => {
  const h = harness();
  await h.call(signup());
  const key = keyFromLink(h.mails()[0].message.text, 'c');
  const wrong = key.slice(0, 25) + 'Z'.repeat(32);
  assert.equal((await h.call({ action: 'confirm', key: wrong })).statusCode, 404);
  assert.equal((await h.call({ action: 'manage', key: 'f'.repeat(24) + '.' + 'x'.repeat(32) })).statusCode, 404);
  assert.equal((await h.call({ action: 'confirm', key: 'nonsense' })).body.error, 'invalid-link');
});

test('signing up again when already active sends a "you are already subscribed" email', async () => {
  const h = harness();
  await h.call(signup());
  await h.call({ action: 'confirm', key: keyFromLink(h.mails()[0].message.text, 'c') });
  h.advance(HOUR);
  const res = await h.call(signup({ subjects: ['math'] }));
  assert.deepEqual(res.body, { ok: true, status: 'check-email' });
  const already = h.mails().find(m => m.polymathQotd.kind === 'already');
  assert.ok(already);
  assert.match(already.message.subject, /already subscribed/);
  assert.deepEqual(h.subscriber('parent@example.test').subjects, ['math', 'science'], 'a stranger cannot change the settings by signing up');
});

test('manage and update change subjects, frequency, level and name', async () => {
  const h = harness();
  await h.call(signup());
  const key = keyFromLink(h.mails()[0].message.text, 'c');
  await h.call({ action: 'confirm', key });
  const shown = await h.call({ action: 'manage', key });
  assert.deepEqual(shown.body.subscriber, { email: 'pa•••@example.test', name: 'Mrs Lim', level: 'P5', subjects: ['math', 'science'], frequency: 'daily', status: 'active' });
  const res = await h.call({ action: 'update', key, subjects: ['science'], frequency: 'weekly', level: 'P6', name: 'Mdm Lim' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.subscriber.subjects, ['science']);
  assert.equal(res.body.subscriber.frequency, 'weekly');
  assert.equal(h.subscriber('parent@example.test').level, 'P6');
  assert.equal((await h.call({ action: 'update', key, subjects: [] })).statusCode, 400);
  assert.equal((await h.call({ action: 'update', key })).statusCode, 400);
});

test('unsubscribe by link, then resubscribe; one-click POST from a mail app works too', async () => {
  const h = harness();
  await h.call(signup());
  const key = keyFromLink(h.mails()[0].message.text, 'c');
  await h.call({ action: 'confirm', key });
  const res = await h.call({ action: 'unsubscribe', key });
  assert.equal(res.body.status, 'unsubscribed');
  assert.equal(h.subscriber('parent@example.test').status, 'unsubscribed');
  const back = await h.call({ action: 'resubscribe', key });
  assert.equal(back.body.status, 'active');
  // Gmail's one-click: POST to the function's own address, no Origin header.
  const one = await h.call('List-Unsubscribe=One-Click', { query: { u: key }, headers: { origin: undefined, 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(one.statusCode, 200);
  assert.match(one.body, /unsubscribed/);
  assert.equal(h.subscriber('parent@example.test').status, 'unsubscribed');
  // A plain visit to that address goes to the page.
  const visit = await h.call(undefined, { method: 'GET', query: { u: key }, headers: { origin: undefined } });
  assert.equal(visit.statusCode, 302);
  assert.equal(visit.location, core.PAGE_URL + '?u=' + key);
  const bad = await h.call('', { query: { u: 'f'.repeat(24) + '.' + 'x'.repeat(32) }, headers: { origin: undefined } });
  assert.equal(bad.statusCode, 404);
});

test('a pending sign-up cannot skip the confirmation by "resubscribing"', async () => {
  const h = harness();
  await h.call(signup());
  const key = keyFromLink(h.mails()[0].message.text, 'c');
  await h.call({ action: 'unsubscribe', key });
  const res = await h.call({ action: 'resubscribe', key });
  assert.equal(res.body.status, 'unsubscribed');
});

/* ─── Admin ─── */

test('admin actions need an admin\'s verified Google sign-in', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'admin' })).statusCode, 401);
  assert.equal((await h.call({ action: 'admin' }, { headers: { authorization: 'Bearer ' + 'other-token-'.padEnd(24, 'a') } })).statusCode, 403);
  assert.equal((await h.call({ action: 'admin' }, { headers: { authorization: 'Bearer ' + 'unver-token-'.padEnd(24, 'a') } })).statusCode, 403);
  assert.equal((await h.admin({ action: 'admin' })).statusCode, 200);
});

test('the admin list shows every subscriber without their secret link, with totals', async () => {
  const h = harness();
  await h.call(signup());
  await h.call({ action: 'confirm', key: keyFromLink(h.mails()[0].message.text, 'c') });
  await h.call(signup({ email: 'pending@example.test', subjects: ['science'], frequency: 'weekly', source: 'home-page' }));
  const res = await h.admin({ action: 'admin' });
  assert.equal(res.body.subscribers.length, 2);
  assert.ok(res.body.subscribers.every(s => !('token' in s)));
  assert.equal(res.body.stats.active, 1);
  assert.equal(res.body.stats.pending, 1);
  assert.equal(res.body.stats.math, 1);
  assert.equal(res.body.settings.dailyCap, core.DEFAULT_DAILY_CAP);
  assert.equal(res.body.settings.mode, 'on');
  assert.equal(res.body.upcoming.length, 7);
  assert.equal(typeof res.body.upcoming[0].slots.math.P5.answer, 'number', 'the admin sees the answers ahead');
  assert.equal(res.body.upcoming[0].slots.math.P3, null, 'no P3 Maths in the bank');
  assert.deepEqual(res.body.pool.waiting.math, { P3: 0, P4: 0, P5: 0, P6: 0 });
  assert.equal(res.body.gmailLimits.gmail, 500);
});

test('admin can pause, set the cap, send a test, resend a confirmation and delete', async () => {
  const h = harness();
  const paused = await h.admin({ action: 'adminSettings', mode: 'paused', dailyCap: 300 });
  assert.deepEqual(paused.body.settings, { mode: 'paused', dailyCap: 300 });
  assert.equal((await h.admin({ action: 'adminSettings', dailyCap: 99999 })).statusCode, 400);
  for (const kind of ['daily', 'weekly', 'confirm']) {
    const res = await h.admin({ action: 'adminTest', kind });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sentTo, 'admin@polymathlc.com.sg');
  }
  const tests = h.mails().filter(m => /\[Test\]/.test(m.message.subject));
  assert.equal(tests.length, 3);
  assert.ok(tests.every(m => m.to[0] === 'admin@polymathlc.com.sg'));
  await h.call(signup({ email: 'slow@example.test' }));
  const id = core.subscriberId('slow@example.test');
  assert.equal((await h.admin({ action: 'adminResend', id })).statusCode, 429, 'not straight after the first one');
  h.advance(10 * 60000);
  assert.equal((await h.admin({ action: 'adminResend', id })).statusCode, 200);
  assert.equal(h.mails().filter(m => m.to[0] === 'slow@example.test').length, 2);
  assert.equal((await h.admin({ action: 'adminDelete', id })).statusCode, 200);
  assert.equal(h.subscriber('slow@example.test'), null);
});

test('the test subscriber\'s links can never unsubscribe anybody real', () => {
  assert.equal(TEST_SUBSCRIBER.id, '0'.repeat(24));
  assert.notEqual(core.subscriberId('admin@polymathlc.com.sg'), TEST_SUBSCRIBER.id);
});

/* ─── The morning plan and the emails ─── */

test('planRun: daily every day once, weekly on Saturdays, oldest first within the cap', () => {
  const subs = [
    { id: 'a', email: 'a@x.test', status: 'active', frequency: 'daily', subjects: ['math'], confirmedAt: 3 },
    { id: 'b', email: 'b@x.test', status: 'active', frequency: 'daily', subjects: ['science'], confirmedAt: 1 },
    { id: 'c', email: 'c@x.test', status: 'active', frequency: 'weekly', subjects: ['math'], confirmedAt: 0 },
    { id: 'd', email: 'd@x.test', status: 'pending', frequency: 'daily', subjects: ['math'] },
    { id: 'e', email: 'e@x.test', status: 'active', frequency: 'daily', subjects: ['math'], lastDailyDay: '2026-11-21' },
    { id: 'f', email: 'f@x.test', status: 'unsubscribed', frequency: 'daily', subjects: ['math'] }
  ];
  const friday = core.planRun(subs, '2026-11-20', 10);
  assert.deepEqual(friday.send.map(x => x.sub.id), ['e', 'b', 'a'], 'no confirmation time sorts first');
  const saturday = core.planRun(subs, '2026-11-21', 10);
  assert.deepEqual(saturday.send.map(x => x.sub.id + ':' + x.kind), ['b:daily', 'a:daily', 'c:weekly'], 'e already had Saturday\'s');
  const capped = core.planRun(subs, '2026-11-21', 2);
  assert.deepEqual(capped.send.map(x => x.sub.id), ['b', 'a']);
  assert.deepEqual(capped.heldBack.map(x => x.sub.id), ['c']);
});

test('the morning email has today\'s question, yesterday\'s worked answer and an unsubscribe link', () => {
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'p@example.test', name: '', subjects: ['math'], frequency: 'daily', consent: { at: NOW } };
  const day = '2026-11-21';
  const today = core.publicPair(day, core.defaultPick(day), false, 'P5');
  const yesterday = core.publicPair('2026-11-20', core.defaultPick('2026-11-20'), true, 'P5');
  const mail = core.dailyMail(sub, day, today, yesterday);
  assert.match(mail.message.subject, /^Question of the day: P5 Maths/);
  assert.ok(mail.message.html.includes(core.mathHtml(today.math.q).split('<br>')[0]));
  assert.ok(!mail.message.html.includes(core.mathHtml(today.science.q).split('<br>')[0]), 'only the chosen subject');
  assert.ok(mail.message.text.includes('Answer: ' + yesterday.math.answerLetter));
  assert.ok(!mail.message.text.includes('Answer: ' + today.math.answerLetter + '. ' + today.math.options[today.math.answer] + '\n') || today.math.id === yesterday.math.id);
  assert.match(mail.message.html, /Dear Parent,/);
  assert.ok(mail.message.html.includes(core.unsubscribeUrl(sub)));
  assert.ok(mail.message.text.includes(core.manageUrl(sub)));
  assert.ok(mail.message.html.includes(core.escapeHtml(core.tryUrl(day, 'math', 'P5'))));
});

test('the Saturday email lists the week\'s questions with answers', () => {
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'p@example.test', name: 'Mrs Tan', subjects: ['math', 'science'], frequency: 'weekly' };
  const week = [];
  for (let i = 7; i >= 1; i--) { const d = core.addDays('2026-11-28', -i); week.push({ day: d, pair: core.publicPair(d, core.defaultPick(d), true, 'P6') }); }
  const mail = core.weeklyMail(sub, '2026-11-28', week);
  assert.match(mail.message.subject, /This week's 14 questions/);
  assert.equal((mail.message.text.match(/Answer: [ABCD]\./g) || []).length, 14);
  assert.match(mail.message.html, /Dear Mrs Tan,/);
});

test('names are escaped in emails, and the CSV defends against spreadsheet formulas', () => {
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'p@example.test', name: 'A & B "Co"', subjects: ['math'], frequency: 'daily' };
  assert.match(core.confirmMail(sub).message.html, /A &amp; B &quot;Co&quot;/);
  const csv = core.subscribersCsv([{ email: 'x@y.test', name: '=HYPERLINK("bad")', subjects: ['math'], status: 'active', createdAt: NOW }]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv.split('\n')[0], /^Email,Name,Child level/);
});

test('the admin summary lists new subscribers for the centre', () => {
  const mail = core.adminSummaryMail([{ email: 'p@example.test', name: 'Mrs Lim', level: 'P5', subjects: ['math'], frequency: 'daily', source: 'home-page' }],
    { active: 3, daily: 2, weekly: 1 }, '2026-11-21');
  assert.deepEqual(mail.to, core.NOTIFICATION_EMAILS.slice());
  assert.match(mail.message.subject, /1 new subscriber/);
  assert.match(mail.message.html, /Mrs Lim/);
  assert.match(mail.message.html, /Home page/);
});

/* ─── Pool questions: open and multiple choice, pictures, the every-third-day rule ─── */
const pool = require('../daily-question-pool');
function poolItem(n, overrides = {}) {
  const id = pool.itemId('anskey', 'test-' + n);
  return Object.assign({
    id, kind: 'open', source: 'anskey', subject: 'math', level: 'P5', topic: 'Area', q: 'A rectangle is 8 cm long and 5 cm wide. What is its area?',
    images: [], answerType: 'number', answer: '40 cm²', accepted: ['40'], model: 'The area is 40 cm².', steps: ['8 × 5 = 40'], idea: 'Area = length × breadth.',
    keywords: [], marks: 2, status: 'ready', group: 'g' + n
  }, overrides);
}
const mcqItem = (n, overrides = {}) => poolItem(n, Object.assign({ kind: 'mcq', subject: 'science', topic: 'Magnets',
  q: 'The diagram shows four rods. Which rod is made of a magnetic material?', options: ['Copper', 'Plastic', 'Steel', 'Wood'], answerIndex: 2, answer: 'Steel',
  answerType: 'short', accepted: [], images: [{ id: pool.imageId(pool.itemId('anskey', 'test-' + n), 0), w: 600, h: 400, alt: 'Four rods' }] }, overrides));
async function seedQueue(store, items) {
  const queue = pool.emptyQueue();
  for (const item of items) { await store.savePoolItem(item, []); queue[item.subject][item.level].push(item.id); }
  await store.saveQueue(queue, NOW);
}

test('every third day is a multiple-choice day, from Sunday 22 November 2026', () => {
  assert.deepEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'].map(pool.isMcqDay), [false, false, true, false, false, true]);
});

test('a Science question needs a picture; a Maths one may have none', () => {
  const sci = pool.cleanItem({ kind: 'open', subject: 'science', level: 'P5', topic: 'Heat', q: 'Why does the ice melt in the room?', answer: 'It gains heat.',
    model: 'It gains heat from the warmer air.', steps: ['The air is warmer.', 'Ice gains heat and melts.'], idea: 'Gaining heat melts ice.' });
  assert.ok(pool.qualityIssues(sci, []).includes('a Science question needs a picture'));
  const maths = pool.cleanItem(poolItem(1));
  assert.ok(!pool.qualityIssues(maths, []).some(i => /picture/.test(i)));
  assert.ok(!pool.qualityIssues(pool.cleanItem(Object.assign({}, sci, { images: [{ id: 'x', w: 400, h: 300 }] })), [{ ok: true, w: 400, h: 300, bytes: 1000 }]).some(i => /picture/.test(i)));
});

test('a multiple-choice pool question keeps four options and its right one, and is checked like the others', () => {
  const raw = { kind: 'mcq', subject: 'science', level: 'P4', topic: 'Magnets', q: 'The diagram shows four rods. Which rod is made of a magnetic material?',
    options: ['Copper', 'Plastic', 'Steel', 'Wood'], answerIndex: 3, model: 'Steel is a magnetic material.', steps: ['Steel contains iron.', 'Iron is magnetic.'],
    idea: 'Iron and steel are magnetic.', images: [{ id: 'i', w: 600, h: 400 }] };
  const item = pool.cleanItem(raw);
  assert.equal(item.kind, 'mcq');
  assert.equal(item.answerIndex, 2, 'the editor counts 1 to 4; stored 0 to 3');
  assert.equal(item.answer, 'Steel');
  assert.deepEqual(pool.qualityIssues(item, [{ ok: true, w: 600, h: 400, bytes: 1000 }]), []);
  assert.ok(pool.qualityIssues(pool.cleanItem(Object.assign({}, raw, { options: ['Copper', 'Steel', 'Wood'] })), [{ ok: true, w: 600, h: 400, bytes: 1000 }])
    .includes('a multiple-choice question needs exactly 4 options'));
  assert.ok(pool.qualityIssues(pool.cleanItem(Object.assign({}, raw, { q: 'Which rod is magnetic?\n(1) Copper (2) Steel' })), [{ ok: true, w: 600, h: 400, bytes: 1000 }])
    .includes('the options are written into the wording'));
  const good = pool.cleanVerdict({ solvedAnswer: 'Steel', solvedOption: 3, agrees: true, publish: true, scores: { wording: 5, pictures: 5, answer: 5, working: 5, standalone: 5, level: 5 } });
  assert.deepEqual(pool.verdictIssues(good, item), []);
  const other = pool.cleanVerdict(Object.assign({}, good, { solvedOption: 2, scores: good.scores, publish: true, agrees: true }));
  assert.ok(pool.verdictIssues(other, item).includes('the checker picked a different option'));
  assert.match(pool.verifyPrompt(item), /Options: 1\) Copper {2}2\) Plastic {2}3\) Steel {2}4\) Wood/);
  const shown = pool.publicOpen(item, '2026-11-22', false, { imageUrl: id => 'u/' + id, dayLabel: 'x', dayShort: 'y' });
  assert.equal(shown.kind, 'mcq');
  assert.deepEqual(shown.options, ['Copper', 'Plastic', 'Steel', 'Wood']);
  assert.equal(shown.answer, undefined, 'no answer on the day');
  assert.equal(pool.publicOpen(item, '2026-11-22', true, { imageUrl: id => id, dayLabel: '', dayShort: '' }).answerLetter, 'C');
});

test('the pinning takes an open question on open days and a multiple-choice one every third day, each falling back to the other kind', async () => {
  const { store } = harness();
  const open1 = poolItem(1, { subject: 'science', images: [{ id: pool.imageId(pool.itemId('anskey', 'test-1'), 0), w: 600, h: 400, alt: 'x' }], topic: 'Heat',
    q: 'The diagram shows a cup of ice. Why does the ice melt?', answerType: 'explain', answer: 'It gains heat.', accepted: [], model: 'It gains heat from the air.' });
  const choice = mcqItem(2);
  await seedQueue(store, [open1, choice]);
  const friday = await store.ensureDay('2026-11-20', NOW);              // an open day
  assert.equal(friday.picks.science.P5, open1.id);
  const sunday = await store.ensureDay('2026-11-22', NOW + 2 * DAY);    // a multiple-choice day
  assert.equal(sunday.picks.science.P5, choice.id);
  assert.equal(sunday.items[choice.id].kind, 'mcq');
  assert.equal(sunday.items[choice.id].answerIndex, 2);
});

test('a day that fell back to the bank takes waiting questions until its morning emails go out, then never changes', async () => {
  const { store, call } = harness();
  const before = await store.ensureDay('2026-11-20', NOW);
  assert.ok(!Object.keys(before.items).length, 'nothing waiting: the bank');
  const maths = poolItem(3);
  await seedQueue(store, [maths]);
  const after = await store.ensureDay('2026-11-20', NOW + HOUR);
  assert.equal(after.picks.math.P5, maths.id, 'the bank slot took the waiting question');
  assert.equal(after.picks.science.P5, before.picks.science.P5, 'other slots are unchanged');
  const page = await call({ action: 'today', level: 'P5' });
  assert.equal(page.body.questions.math.kind, 'open');
  // The morning run went out: the day is settled, a new question waits for tomorrow.
  await store.saveRun('2026-11-20', { sent: 1 });
  const later = poolItem(4, { level: 'P6', group: 'g4' });
  await seedQueue(store, [later]);
  const settled = await store.ensureDay('2026-11-20', NOW + 2 * HOUR);
  assert.notEqual(settled.picks.math.P6, later.id);
  const pool2 = await store.getPoolItem(later.id);
  assert.equal(pool2.status, 'ready', 'still waiting for another day');
});

test('a multiple-choice pool question is picked on the page, never sent to Chung GPT', async () => {
  const { store, call } = harness();
  await store.ensureDay('2026-11-20', NOW);
  await seedQueue(store, [mcqItem(5)]);
  await store.ensureDay('2026-11-20', NOW);
  const today = await call({ action: 'today', level: 'P5' });
  assert.equal(today.body.questions.science.kind, 'mcq');
  assert.equal(today.body.questions.science.images.length, 1, 'with its picture');
  const marked = await call({ action: 'mark', subject: 'science', level: 'P5', answer: 'Steel' });
  assert.equal(marked.statusCode, 409);
});
