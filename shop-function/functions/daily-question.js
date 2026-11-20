'use strict';

// The dailyQuestion function: the Free Question of the Day on polymathlc.com.sg/question
// and in the box on the home page.
//
// Every call is a POST from the site (the same origins and CORS gate as the rest of
// the shop functions) with an `action`:
//
//   today         today's Maths and Science questions (no answers), yesterday's with
//                 their worked answers, and the past week's for the archive. With a
//                 past `day`, that day's questions with answers.
//   subscribe     a parent signs up: email, optional name and child's level, the
//                 subjects (Maths, Science or both), daily or weekly, and the consent
//                 box. A confirmation email is sent; nothing else is sent until the
//                 parent clicks it (double opt-in).
//   confirm       the link in the confirmation email (?c=…): the subscriber becomes
//                 active and gets a welcome email with today's question at once.
//   manage        the "Change subjects or how often" link (?m=…): their settings.
//   update        saves new settings from that page.
//   unsubscribe   the "Unsubscribe" link (?u=…). Also answers mail apps' one-click
//                 unsubscribe (RFC 8058): a POST to this function's own address with
//                 ?u=… and no Origin, from the List-Unsubscribe header on every email.
//   resubscribe   "Changed your mind?" on the unsubscribe page.
//
// And for the centre, with the admin's Google sign-in (QOTD_ADMINS, verified email):
//
//   admin          every subscriber, totals, settings, the last runs and the next
//                  week's questions with answers.
//   adminSettings  pause or resume the emails, and the daily email cap.
//   adminTest      emails the admin a test of the confirmation, morning or Saturday email.
//   adminResend    sends a pending subscriber's confirmation email again.
//   adminDelete    deletes a subscriber completely (a parent asking to be forgotten).
//
// The morning emails themselves are sent by tools/daily-question-send.mjs from GitHub
// Actions (.github/workflows/daily-question.yml), because the deploy account cannot
// create Cloud Scheduler jobs.
const core = require('./daily-question-core');

const {
  QotdError, LIMITS, QOTD_ADMINS, START_DAY, SUBJECTS, CONSENT_TEXT, GMAIL_LIMITS, DEFAULT_DAILY_CAP, MAX_DAILY_CAP, PAGE_URL,
  sgDayKey, addDays, validDayKey, publicPair, subscriberId, newToken, parseKey, maskEmail, validateSubscribe, validatePreferences,
  planSubscribe, readCap, stats, millis, confirmMail, alreadyMail, dailyMail, weeklyMail, mailId, DAY_MS
} = core;

const HOUR = 3600000;
const PUBLIC_ACTIONS = ['today', 'subscribe', 'confirm', 'manage', 'update', 'unsubscribe', 'resubscribe'];
const ADMIN_ACTIONS = ['admin', 'adminSettings', 'adminTest', 'adminResend', 'adminDelete'];
const TEST_SUBSCRIBER = Object.freeze({ id: '000000000000000000000000', token: 'TESTTESTTESTTESTTESTTESTTESTTEST' });
const ARCHIVE_DAYS = 7;

function fail(code = 'invalid-request', status = 400) { throw new QotdError(status, code); }

// What the manage and unsubscribe pages show: never the full address or the token.
function publicSubscriber(sub) {
  return {
    email: maskEmail(sub.email), name: sub.name || '', level: sub.level || '', subjects: (sub.subjects || []).filter(s => SUBJECTS.includes(s)),
    frequency: sub.frequency === 'weekly' ? 'weekly' : 'daily', status: sub.status
  };
}
// What the admin page shows: everything but the secret token.
function adminSubscriber(sub) {
  return {
    id: sub.id, email: sub.email, name: sub.name || '', level: sub.level || '', subjects: sub.subjects || [], frequency: sub.frequency || 'daily',
    status: sub.status, source: sub.source || '', createdAt: millis(sub.createdAt), confirmedAt: millis(sub.confirmedAt),
    unsubscribedAt: millis(sub.unsubscribedAt), sentCount: Number(sub.sentCount) || 0,
    lastSentDay: [sub.lastDailyDay, sub.lastWeeklyDay].filter(Boolean).sort().pop() || '', mailCount: Number(sub.mailCount) || 0
  };
}

function createDailyQuestionService({ store, http, hashIp, verifyIdToken = async () => { throw new Error('no auth'); },
  now = Date.now, makeToken = newToken, report = () => {} }) {

  function answerError(res, error, fallback) {
    if (error instanceof QotdError) {
      if (error.status === 429) res.set('Retry-After', '3600');
      return res.status(error.status).json({ ok: false, error: error.code });
    }
    // Never log addresses or names.
    report(fallback);
    return res.status(503).json({ ok: false, error: 'temporarily-unavailable' });
  }

  async function adminFrom(req) {
    const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.get('authorization') || '');
    if (!match) fail('sign-in-required', 401);
    let claims;
    try { claims = await verifyIdToken(match[1]); } catch { fail('sign-in-required', 401); }
    const email = claims && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email || claims.email_verified !== true || !QOTD_ADMINS.includes(email)) fail('admin-only', 403);
    return email;
  }

  // Today's pair, and the pairs for the days before `day` (answers shown).
  async function questionsFor(day, at) {
    const today = sgDayKey(at);
    const todayPick = await store.ensureDay(today, at);
    const earlier = [];
    for (let i = 1; i <= ARCHIVE_DAYS; i++) {
      const d = addDays(day, -i);
      if (d >= START_DAY) earlier.push(d);
    }
    const lookup = day === today ? earlier : [day, ...earlier];
    const stored = lookup.length ? await store.getDays(lookup) : {};
    if (day === today) stored[today] = todayPick;
    return { today, stored };
  }

  async function today(body, at) {
    if (Object.keys(body).some(key => !['action', 'day'].includes(key))) fail();
    const current = sgDayKey(at);
    let day = current;
    if (body.day !== undefined && body.day !== '') {
      if (!validDayKey(body.day)) fail('unknown-day');
      // Tomorrow's question stays a secret; days before the start have none.
      if (body.day > current || body.day < START_DAY) fail('unknown-day', 404);
      day = body.day;
    }
    const { stored } = await questionsFor(day, at);
    const previousDay = addDays(day, -1);
    const recent = [];
    for (let i = 2; i <= ARCHIVE_DAYS; i++) {
      const d = addDays(day, -i);
      if (d >= START_DAY) recent.push({ day: d, questions: publicPair(d, stored[d], true) });
    }
    return {
      ok: true, today: current, day, isToday: day === current, startDay: START_DAY,
      questions: publicPair(day, stored[day], day < current),
      previous: previousDay >= START_DAY ? { day: previousDay, questions: publicPair(previousDay, stored[previousDay], true) } : null,
      recent
    };
  }

  async function subscribe(body, at, req) {
    const request = validateSubscribe(body);
    if (request.robot) return { ok: true, status: 'check-email' };
    const ip = String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
    const hour = Math.floor(at / HOUR), day = Math.floor(at / DAY_MS);
    await store.countAttempts([
      { id: 'qotd-ip-' + hashIp(ip).slice(0, 32) + '-' + hour, maximum: LIMITS.perIpHour, expiresAt: (hour + 1) * HOUR + DAY_MS },
      { id: 'qotd-global-' + day, maximum: LIMITS.globalDay, expiresAt: (day + 2) * DAY_MS }
    ], 'too-many-signups');
    const today = sgDayKey(at);
    await store.subscribe(subscriberId(request.email),
      existing => Object.assign(planSubscribe(request, existing, at, makeToken), {
        mailId: saved => mailId(saved.status === 'active' ? 'already' : 'confirm', today, saved.id + '-' + (Number(saved.mailCount) || 1))
      }),
      (kind, saved) => (kind === 'confirm' ? confirmMail(saved) : alreadyMail(saved)));
    // The same answer whatever happened, so nobody can learn who is on the list.
    return { ok: true, status: 'check-email' };
  }

  // The subscriber behind a link, or a 404 that looks the same for every bad link.
  const owned = (current, token) => {
    if (!current || current.token !== token) fail('invalid-link', 404);
    return current;
  };

  async function confirm(body, at) {
    if (Object.keys(body).some(key => !['action', 'key'].includes(key))) fail();
    const { id, token } = parseKey(body.key);
    const day = sgDayKey(at);
    const { stored } = await questionsFor(day, at);
    const yesterday = addDays(day, -1);
    const todayPair = publicPair(day, stored[day], false);
    const yesterdayPair = yesterday >= START_DAY && stored[yesterday] ? publicPair(yesterday, stored[yesterday], true) : null;
    let already = false;
    const saved = await store.change(id, current => {
      owned(current, token);
      if (current.status === 'active') { already = true; return {}; }
      const patch = { status: 'active', confirmedAt: at, adminNotified: false };
      if (current.status === 'unsubscribed') patch.resubscribedAt = at;
      const mails = [];
      // The welcome email, once in a subscriber's life, with today's question.
      if (!current.welcomedAt) {
        const welcomed = Object.assign({}, current, patch);
        patch.welcomedAt = at;
        patch.sentCount = (Number(current.sentCount) || 0) + 1;
        if (current.frequency !== 'weekly') patch.lastDailyDay = day;
        mails.push([mailId('welcome', day, id), dailyMail(welcomed, day, todayPair, yesterdayPair, { welcome: true })]);
      }
      return { patch, mails };
    });
    return { ok: true, status: 'active', already, subscriber: publicSubscriber(saved) };
  }

  async function manage(body) {
    if (Object.keys(body).some(key => !['action', 'key'].includes(key))) fail();
    const { id, token } = parseKey(body.key);
    const current = owned(await store.getSubscriber(id), token);
    return { ok: true, subscriber: publicSubscriber(current) };
  }

  async function update(body, at) {
    const { key, patch } = validatePreferences(body);
    const saved = await store.change(key.id, current => {
      owned(current, key.token);
      return { patch: Object.assign({}, patch, { updatedAt: at }) };
    });
    return { ok: true, subscriber: publicSubscriber(saved) };
  }

  async function unsubscribe(key, at) {
    const saved = await store.change(key.id, current => {
      owned(current, key.token);
      if (current.status === 'unsubscribed') return {};
      return { patch: { status: 'unsubscribed', unsubscribedAt: at } };
    });
    return { ok: true, status: 'unsubscribed', subscriber: publicSubscriber(saved) };
  }

  async function resubscribe(body, at) {
    if (Object.keys(body).some(key => !['action', 'key'].includes(key))) fail();
    const { id, token } = parseKey(body.key);
    const saved = await store.change(id, current => {
      owned(current, token);
      // Only someone who had confirmed before comes straight back; a pending sign-up
      // still needs the link in its confirmation email.
      if (current.status !== 'unsubscribed' || !current.confirmedAt) return {};
      return { patch: { status: 'active', resubscribedAt: at, unsubscribedAt: null } };
    });
    return { ok: true, status: saved.status, subscriber: publicSubscriber(saved) };
  }

  /* ─── Admin ─── */
  async function admin(at) {
    const [settings, subscribers, runs] = await Promise.all([store.getSettings(), store.listSubscribers(), store.listRuns(14)]);
    const day = sgDayKey(at);
    const todayPick = await store.ensureDay(day, at);
    const upcoming = [{ day, questions: publicPair(day, todayPick, true) }];
    // Days ahead have no stored pair yet; they will get the default one.
    for (let i = 1; i < 7; i++) {
      const d = addDays(day, i);
      upcoming.push({ day: d, questions: publicPair(d, core.pickForDay(d, null), true) });
    }
    const list = subscribers.map(adminSubscriber).sort((a, b) => (b.confirmedAt || b.createdAt) - (a.confirmedAt || a.createdAt));
    return {
      ok: true, today: day,
      settings: { mode: settings.mode === 'paused' ? 'paused' : 'on', dailyCap: readCap(settings), defaultCap: DEFAULT_DAILY_CAP, maxCap: MAX_DAILY_CAP },
      gmailLimits: GMAIL_LIMITS, consentText: CONSENT_TEXT,
      stats: stats(subscribers, at), subscribers: list,
      runs: runs.map(r => ({ day: r.day, sent: Number(r.sent) || 0, daily: Number(r.daily) || 0, weekly: Number(r.weekly) || 0,
        heldBack: Number(r.heldBack) || 0, failed: Number(r.failed) || 0, paused: !!r.paused, finishedAt: millis(r.finishedAt) })),
      upcoming
    };
  }

  async function adminSettings(body, at, who) {
    if (Object.keys(body).some(key => !['action', 'mode', 'dailyCap'].includes(key))) fail();
    const patch = { updatedAt: at, updatedBy: who };
    if (body.mode !== undefined) {
      if (!['on', 'paused'].includes(body.mode)) fail();
      patch.mode = body.mode;
    }
    if (body.dailyCap !== undefined) {
      if (!Number.isInteger(body.dailyCap) || body.dailyCap < 0 || body.dailyCap > MAX_DAILY_CAP) fail('invalid-cap');
      patch.dailyCap = body.dailyCap;
    }
    await store.saveSettings(patch);
    const settings = await store.getSettings();
    return { ok: true, settings: { mode: settings.mode === 'paused' ? 'paused' : 'on', dailyCap: readCap(settings) } };
  }

  async function adminTest(body, at, who) {
    if (Object.keys(body).some(key => !['action', 'kind'].includes(key))) fail();
    const kind = body.kind === undefined ? 'daily' : body.kind;
    if (!['daily', 'weekly', 'confirm'].includes(kind)) fail();
    const minute = Math.floor(at / 60000);
    await store.countAttempts([{ id: 'qotd-admin-test-' + minute, maximum: 3, expiresAt: at + DAY_MS }], 'test-just-sent');
    const day = sgDayKey(at);
    const sub = Object.assign({}, TEST_SUBSCRIBER, { email: who, name: '', subjects: SUBJECTS.slice(), frequency: kind === 'weekly' ? 'weekly' : 'daily',
      status: 'active', consent: { at } });
    let message;
    if (kind === 'confirm') message = confirmMail(sub);
    else {
      const { stored } = await questionsFor(day, at);
      if (kind === 'daily') {
        const yesterday = addDays(day, -1);
        message = dailyMail(sub, day, publicPair(day, stored[day], false),
          yesterday >= START_DAY ? publicPair(yesterday, stored[yesterday], true) : null, { test: true });
      } else {
        const week = [];
        for (let i = 7; i >= 1; i--) {
          const d = addDays(day, -i);
          if (d >= START_DAY && stored[d]) week.push({ day: d, pair: publicPair(d, stored[d], true) });
        }
        // Before a week has passed, show today's so the test is never empty.
        if (!week.length) week.push({ day, pair: publicPair(day, stored[day], true) });
        message = weeklyMail(sub, day, week, { test: true });
      }
    }
    message.message.subject = message.message.subject.startsWith('[Test]') ? message.message.subject : '[Test] ' + message.message.subject;
    await store.addMail('polymath-qotd-test-' + kind + '-' + at, message);
    return { ok: true, sentTo: who };
  }

  async function adminResend(body, at) {
    if (Object.keys(body).some(key => !['action', 'id'].includes(key))) fail();
    if (typeof body.id !== 'string' || !/^[0-9a-f]{24}$/.test(body.id)) fail();
    const day = sgDayKey(at);
    await store.change(body.id, current => {
      if (!current) fail('not-found', 404);
      if (current.status !== 'pending') fail('not-pending', 409);
      if (current.lastMailAt && at - Number(current.lastMailAt) < LIMITS.addressGapMs) fail('just-sent', 429);
      const count = (Number(current.mailCount) || 0) + 1;
      return { patch: { lastMailAt: at, mailCount: count }, mails: [[mailId('confirm', day, body.id + '-' + count + '-admin'), confirmMail(current)]] };
    });
    return { ok: true };
  }

  async function adminDelete(body) {
    if (Object.keys(body).some(key => !['action', 'id'].includes(key))) fail();
    if (typeof body.id !== 'string' || !/^[0-9a-f]{24}$/.test(body.id)) fail();
    await store.deleteSubscriber(body.id);
    return { ok: true };
  }

  // Mail apps' one-click unsubscribe and plain visits to the function's own link.
  async function oneClick(req, res, raw) {
    res.set('Cache-Control', 'no-store');
    let key = null;
    try { key = parseKey(String(raw)); } catch { key = null; }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(302, PAGE_URL + (key ? '?u=' + key.id + '.' + key.token : ''));
    }
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    if (!key) return res.status(404).send('This unsubscribe link is not valid.');
    try {
      await unsubscribe(key, now());
      return res.status(200).type('text/plain').send('You are unsubscribed from the Polymath Question of the Day.');
    } catch (error) {
      if (error instanceof QotdError) return res.status(error.status).type('text/plain').send('This unsubscribe link is not valid.');
      report('qotd-one-click-failed');
      return res.status(503).type('text/plain').send('Please try again later.');
    }
  }

  async function dailyQuestion(req, res) {
    const raw = req.query && typeof req.query.u === 'string' ? req.query.u : '';
    if (raw && !req.get('origin')) return oneClick(req, res, raw);
    if (!http.cors(req, res)) return;
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') fail();
      const at = now();
      const action = body.action;
      if (PUBLIC_ACTIONS.includes(action)) {
        let result;
        switch (action) {
          case 'today': result = await today(body, at); break;
          case 'subscribe': result = await subscribe(body, at, req); break;
          case 'confirm': result = await confirm(body, at); break;
          case 'manage': result = await manage(body); break;
          case 'update': result = await update(body, at); break;
          case 'unsubscribe': {
            if (Object.keys(body).some(key => !['action', 'key'].includes(key))) fail();
            result = await unsubscribe(parseKey(body.key), at); break;
          }
          case 'resubscribe': result = await resubscribe(body, at); break;
        }
        return res.status(200).json(result);
      }
      if (ADMIN_ACTIONS.includes(action)) {
        const who = await adminFrom(req);
        let result;
        switch (action) {
          case 'admin': result = await admin(at); break;
          case 'adminSettings': result = await adminSettings(body, at, who); break;
          case 'adminTest': result = await adminTest(body, at, who); break;
          case 'adminResend': result = await adminResend(body, at); break;
          case 'adminDelete': result = await adminDelete(body); break;
        }
        return res.status(200).json(result);
      }
      fail('unknown-action');
    } catch (error) {
      return answerError(res, error, 'qotd-failed');
    }
  }

  return { dailyQuestion };
}

module.exports = { createDailyQuestionService, publicSubscriber, adminSubscriber, PUBLIC_ACTIONS, ADMIN_ACTIONS, TEST_SUBSCRIBER };
