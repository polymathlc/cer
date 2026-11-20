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
  function collectionRef(path, order = null, max = Infinity) {
    return {
      doc: id => docRef(path + '/' + id),
      orderBy: (field, direction = 'asc') => collectionRef(path, { field, direction }, max),
      limit: n => collectionRef(path, order, n),
      async get() {
        let docs = children(path).map(p => snapshot(docRef(p)));
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

test('the strides visit every question once before any repeats', () => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (const subject of core.SUBJECTS) {
    assert.equal(gcd(core.STRIDES[subject], core.BANK[subject].length), 1, subject + ' stride shares no factor with the bank size');
    const seen = new Set();
    for (let i = 0; i < core.BANK[subject].length; i++) seen.add(core.defaultPick(core.addDays(core.START_DAY, i))[subject]);
    assert.equal(seen.size, core.BANK[subject].length);
  }
});

test('days are Singapore days, and the stored pair wins over the default', () => {
  assert.equal(core.sgDayKey(Date.UTC(2026, 10, 19, 16, 30)), '2026-11-20', '12:30 a.m. on the 20th in Singapore');
  assert.equal(core.fmtDay('2026-11-21'), 'Saturday 21 November 2026');
  assert.equal(core.weekdayOf('2026-11-21'), core.WEEKLY_WEEKDAY);
  const stored = { math: 'm010', science: 's020' };
  assert.deepEqual(core.pickForDay('2026-11-25', stored), stored);
  assert.deepEqual(core.pickForDay('2026-11-25', { math: 's001', science: 'nope' }), core.defaultPick('2026-11-25'), 'wrong-subject ids fall back');
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
  assert.equal((await h.call(signup({ level: 'P9' }))).body.error, 'invalid-level');
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
  assert.equal(typeof res.body.upcoming[0].questions.math.answer, 'number', 'the admin sees the answers ahead');
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
  const today = core.publicPair(day, core.defaultPick(day), false);
  const yesterday = core.publicPair('2026-11-20', core.defaultPick('2026-11-20'), true);
  const mail = core.dailyMail(sub, day, today, yesterday);
  assert.match(mail.message.subject, /^Question of the day: P\d Maths/);
  assert.ok(mail.message.html.includes(core.escapeHtml(today.math.q).split('\n')[0]));
  assert.ok(!mail.message.html.includes(core.escapeHtml(today.science.q).split('\n')[0]), 'only the chosen subject');
  assert.ok(mail.message.text.includes('Answer: ' + yesterday.math.answerLetter));
  assert.ok(!mail.message.text.includes('Answer: ' + today.math.answerLetter + '. ' + today.math.options[today.math.answer] + '\n') || today.math.id === yesterday.math.id);
  assert.match(mail.message.html, /Dear Parent,/);
  assert.ok(mail.message.html.includes(core.unsubscribeUrl(sub)));
  assert.ok(mail.message.text.includes(core.manageUrl(sub)));
  assert.ok(mail.message.html.includes(core.tryUrl(day, 'math')));
});

test('the Saturday email lists the week\'s questions with answers', () => {
  const sub = { id: 'a'.repeat(24), token: 'b'.repeat(32), email: 'p@example.test', name: 'Mrs Tan', subjects: ['math', 'science'], frequency: 'weekly' };
  const week = [];
  for (let i = 7; i >= 1; i--) { const d = core.addDays('2026-11-28', -i); week.push({ day: d, pair: core.publicPair(d, core.defaultPick(d), true) }); }
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
