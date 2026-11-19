'use strict';
// Exam countdown revision packs (revision.js): the starter packs made from the
// /online P6 classes, buying by card and PayNow, the access code, the pack page's
// links and PDFs, and the admin's editing, against an in-memory store with the
// same contract as revision-store.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../revision');
const { createHttp, hash } = require('../service');
const { fakeStripe } = require('./fakes');
const { NOW, TOKEN, keyUrl, fakeStore } = require('./revision-fakes');

const ORIGIN = 'https://polymathlc.com.sg';
const DAY = 86400000;

const ADMIN_TOKEN = 'admin-token-'.padEnd(40, 'x');
const STRANGER_TOKEN = 'stranger-token-'.padEnd(40, 'x');
async function verifyIdToken(token) {
  if (token === ADMIN_TOKEN) return { email: 'chungzhikai@gmail.com', email_verified: true };
  if (token === STRANGER_TOKEN) return { email: 'someone@example.com', email_verified: true };
  throw new Error('bad token');
}

function harness({ cardConfigured = true, data } = {}) {
  const store = fakeStore(data), stripe = fakeStripe(), logs = [];
  let clock = NOW, seq = 0;
  const service = R.createRevisionService({ store, stripe, http: createHttp(c => logs.push(c)), hashIp: hash, verifyIdToken, cardConfigured,
    now: () => clock, random: max => (seq++ * 7 + 3) % max, report: c => logs.push(c) });
  const response = () => ({ headers: {}, statusCode: 200, chunks: [], headersSent: false,
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; },
    type(t) { this.headers['content-type'] = t; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; },
    write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; return this; },
    on() { return this; }, once() { return this; }, emit() { return true; }, removeListener() { return this; } });
  async function post(handler, body, { headers = {}, ip = '192.0.2.40' } = {}) {
    const all = { origin: ORIGIN, 'content-type': 'application/json', ...headers };
    const req = { method: 'POST', body, ip, get: name => all[name.toLowerCase()] };
    const res = response();
    await service[handler](req, res);
    return res;
  }
  async function get(url, ip = '192.0.2.41') {
    const query = Object.fromEntries(new URL(url).searchParams);
    const req = { method: 'GET', query, ip, get: () => undefined };
    const res = response();
    await service.revisionPack(req, res);
    return res;
  }
  return {
    store, stripe, logs, service, get,
    call: (body, opts) => post('revisionPack', body, opts),
    admin: (body, token = ADMIN_TOKEN) => post('revisionPackAdmin', body, { headers: { authorization: 'Bearer ' + token } }),
    advance: ms => { clock += ms; }, now: () => clock
  };
}
const BUYER = { name: 'Mrs Tan', email: 'Parent@Example.com', phone: '9123 4567', student: 'Ah Boy' };
const buy = (h, packId, method = 'card', extra = {}) => h.call(Object.assign({ action: 'checkout', packId, method, buyer: BUYER,
  returnUrl: ORIGIN + '/revision/', pageVersion: 'v1.0.0' }, extra));

test('the first catalogue makes the P6 Maths and Science starter packs from /online, once', async () => {
  const h = harness();
  const res = await h.call({ action: 'catalogue' });
  assert.equal(res.statusCode, 200);
  const ids = res.body.packs.map(p => p.id).sort();
  assert.deepEqual(ids, ['psle-p6-math-2027', 'psle-p6-science-2027']);
  const math = h.store.state.packs.get('psle-p6-math-2027');
  // The P6 class with the most worksheets, without the hidden one, one topic each, plus the maths mind maps.
  assert.deepEqual(math.topics.map(t => t.worksheetIds), [['w1'], ['w2'], []]);
  assert.deepEqual(math.topics.at(-1).mindmapIds, ['m1']);
  assert.equal(math.price, 49);
  assert.equal(math.active, true);
  assert.equal(math.examDate, '2027-09-30');
  const science = h.store.state.packs.get('psle-p6-science-2027');
  assert.deepEqual(science.topics.at(-1).mindmapIds, ['m2']);
  // Public numbers, never links.
  const entry = res.body.packs.find(p => p.id === 'psle-p6-math-2027');
  assert.deepEqual(entry.counts, { topics: 3, papers: 2, keys: 1, videos: 1, maps: 1 });
  assert.equal(entry.daysLeft, R.daysUntil('2027-09-30', NOW));
  assert.ok(!JSON.stringify(res.body).includes('pdf-annotator'));
  assert.equal(res.body.cardPayments, true);
  assert.equal(res.body.paynow.uen, 'T16LL2365E');
  // Deleting a starter pack never brings it back.
  h.store.state.packs.delete('psle-p6-science-2027');
  const again = await h.call({ action: 'catalogue' });
  assert.deepEqual(again.body.packs.map(p => p.id), ['psle-p6-math-2027']);
});

test('the catalogue only lists packs on sale', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  const p = h.store.state.packs.get('psle-p6-math-2027');
  p.active = false;
  h.store.state.packs.get('psle-p6-science-2027').examDate = '2026-11-01';
  const res = await h.call({ action: 'catalogue' });
  assert.deepEqual(res.body.packs, []);
});

test('card: checkout prices on the server, payment gives an access code and emails it once', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  const res = await buy(h, 'psle-p6-math-2027', 'card', { price: 1 });
  assert.equal(res.statusCode, 400, 'unknown fields are refused');
  const ok = await buy(h, 'psle-p6-math-2027');
  assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.method, 'card');
  assert.equal(ok.body.total, 49);
  const call = h.stripe.calls[0];
  assert.equal(call.params.line_items[0].price_data.unit_amount, 4900);
  assert.equal(call.params.metadata.source, R.REVISION_SOURCE);
  assert.equal(call.params.customer_email, 'parent@example.com');
  assert.ok(call.params.success_url.startsWith(ORIGIN + '/revision/?order=' + ok.body.code));
  const order = h.store.state.orders.get(ok.body.code);
  assert.equal(order.status, 'open');
  const sessionId = order.sessionId;
  const before = await h.call({ action: 'status', code: ok.body.code, sessionId });
  assert.deepEqual(before.body, { ok: true, paid: false, state: 'open' });
  h.stripe.pay(sessionId);
  const after = await h.call({ action: 'status', code: ok.body.code, sessionId });
  assert.equal(after.body.paid, true);
  assert.match(after.body.order.accessCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // The webhook landing afterwards is a no-op.
  const hook = await h.service.handlePaidSession(await h.stripe.retrieveCheckoutSession(sessionId));
  assert.equal(hook.already, true);
  const mails = [...h.store.state.mail.keys()].sort();
  assert.deepEqual(mails, ['polymath-revision-' + ok.body.code + '-1', 'polymath-revision-' + ok.body.code + '-admin']);
  const mail = h.store.state.mail.get('polymath-revision-' + ok.body.code + '-1');
  assert.deepEqual(mail.to, ['parent@example.com']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.ok(mail.message.text.includes(after.body.order.accessCode));
  assert.ok(mail.message.html.includes('https://polymathlc.com.sg/revision/?access=' + after.body.order.accessCode.replace('-', '')));
  // Access lasts until the end of exam day + 30 days.
  assert.equal(h.store.state.orders.get(ok.body.code).accessEndsAt, Date.UTC(2027, 8, 30) - 8 * 3600000 + 31 * DAY);
  // A wrong session id cannot read anyone's order.
  const wrong = await h.call({ action: 'status', code: ok.body.code, sessionId: 'cs_test_9999999999' });
  assert.equal(wrong.statusCode, 404);
});

test('the Hide card payment switch and a missing key both refuse card checkouts but keep PayNow', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  h.store.state.shopSettings = { cardPayments: false };
  assert.equal((await h.call({ action: 'catalogue' })).body.cardPayments, false);
  const card = await buy(h, 'psle-p6-math-2027');
  assert.equal(card.statusCode, 503);
  assert.equal(card.body.error, 'card-payments-off');
  assert.equal((await buy(h, 'psle-p6-math-2027', 'paynow')).statusCode, 201);
  const off = harness({ cardConfigured: false });
  await off.call({ action: 'catalogue' });
  assert.equal((await buy(off, 'psle-p6-math-2027')).body.error, 'card-payments-off');
});

test('PayNow: pending until an admin marks it paid, then the code is emailed', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  const res = await buy(h, 'psle-p6-science-2027', 'paynow', { returnUrl: undefined });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.reference, 'PLC RV ' + res.body.code);
  assert.equal(h.store.state.orders.get(res.body.code).status, 'pending');
  const notice = h.store.state.mail.get('polymath-revision-' + res.body.code + '-new');
  assert.ok(notice.to.includes('admin@polymathlc.com.sg'));
  assert.match(notice.message.subject, /^PayNow revision pack order to check/);
  // Not open until paid.
  assert.equal((await h.admin({ action: 'markPaid', code: res.body.code }, STRANGER_TOKEN)).statusCode, 403);
  const paid = await h.admin({ action: 'markPaid', code: res.body.code });
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.order.status, 'paid');
  assert.equal(paid.body.order.paidBy, 'chungzhikai@gmail.com');
  assert.equal((await h.admin({ action: 'markPaid', code: res.body.code })).body.error, 'already-paid');
  assert.ok(h.store.state.mail.has('polymath-revision-' + res.body.code + '-1'));
  assert.ok(!h.store.state.mail.has('polymath-revision-' + res.body.code + '-admin'), 'the admin marked it, so no sold email to the admin');
  // Resend once a minute.
  assert.equal((await h.admin({ action: 'resend', code: res.body.code })).body.error, 'receipt-just-sent');
  h.advance(61000);
  const resent = await h.admin({ action: 'resend', code: res.body.code });
  assert.equal(resent.body.sentTo, 'parent@example.com');
  assert.ok(h.store.state.mail.get('polymath-revision-' + res.body.code + '-2').message.subject.startsWith('Again: '));
});

test('the access code opens the pack with fresh links, PDFs stream, and nothing else does', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  const res = await buy(h, 'psle-p6-math-2027');
  const order = h.store.state.orders.get(res.body.code);
  h.stripe.pay(order.sessionId);
  const status = await h.call({ action: 'status', code: res.body.code, sessionId: order.sessionId });
  const code = status.body.order.accessCode;
  const open = await h.call({ action: 'open', access: code.toLowerCase().replace('-', ' ') });
  assert.equal(open.statusCode, 200, JSON.stringify(open.body));
  const pack = open.body.pack;
  assert.equal(pack.title, 'PSLE Countdown: Primary 6 Maths');
  assert.equal(open.body.buyer.student, 'Ah Boy');
  const [first, second, maps] = pack.topics;
  assert.equal(first.papers[0].name, 'Fractions: Paper 1');
  assert.equal(first.papers[0].keyDay, '2026-11-09', 'the newest answer key');
  assert.ok(first.papers[0].videos.startsWith('https://polymathlc.com.sg/anskey/videos.html?'));
  assert.equal(first.papers[0].videoCount, 3);
  assert.equal(second.papers[0].key, '', 'no answer key filed yet');
  assert.equal(maps.maps[0].title, 'Fractions big picture');
  assert.ok(!maps.maps[0].nodes.some(n => n.type === 'code'), 'code windows are left out');
  assert.equal(maps.maps[0].nodes.find(n => n.id === 'q').text, 'Q1 fractions');
  assert.equal(h.store.state.orders.get(res.body.code).opens, 1);

  const paper = await h.get(first.papers[0].paper);
  assert.equal(paper.statusCode, 200);
  assert.equal(paper.headers['content-type'], 'application/pdf');
  const key = await h.get(first.papers[0].key);
  assert.equal(key.statusCode, 200);
  assert.ok(Buffer.concat(key.chunks).toString().includes('lesson-key-w1-2026-11-09'));
  // A tampered link, another worksheet, or an expired one is refused.
  assert.equal((await h.get(first.papers[0].paper.replace('d=w1', 'd=w2'))).statusCode, 404);
  assert.equal((await h.get(first.papers[0].paper.replace(/s=[\w-]+/, 's=' + 'A'.repeat(32)))).statusCode, 404);
  h.advance(DAY + 1000);
  assert.equal((await h.get(first.papers[0].paper)).statusCode, 410);
  // Wrong codes are refused, and so is a cancelled order.
  assert.equal((await h.call({ action: 'open', access: 'ZZZZ-ZZZZ' })).statusCode, 404);
  await h.admin({ action: 'cancel', code: res.body.code });
  assert.equal((await h.call({ action: 'open', access: code })).body.error, 'access-cancelled');
});

test('access ends after the exam, and wrong codes are rate limited', async () => {
  const h = harness();
  await h.call({ action: 'catalogue' });
  const res = await buy(h, 'psle-p6-math-2027', 'paynow');
  await h.admin({ action: 'markPaid', code: res.body.code });
  const code = h.store.state.orders.get(res.body.code).accessCode;
  assert.equal((await h.call({ action: 'open', access: code })).statusCode, 200);
  h.advance(Date.UTC(2027, 10, 1) - NOW);
  assert.equal((await h.call({ action: 'open', access: code })).body.error, 'access-ended');
  const g = harness();
  for (let i = 0; i < 20; i++) assert.equal((await g.call({ action: 'open', access: 'AAAA-AAAA' })).statusCode, 404);
  assert.equal((await g.call({ action: 'open', access: 'AAAA-AAAA' })).statusCode, 429);
});

test('admin: load, read a class, save, rename-proof ids, delete only unsold packs', async () => {
  const h = harness();
  assert.equal((await h.admin({ action: 'load' }, STRANGER_TOKEN)).statusCode, 403);
  const load = await h.admin({ action: 'load' });
  assert.equal(load.statusCode, 200, JSON.stringify(load.body));
  assert.equal(load.body.packs.length, 2, 'starter packs are made when the admin opens first, too');
  assert.ok(load.body.courses.some(c => c.id === 'c-p6m' && c.worksheets === 3));
  assert.deepEqual(load.body.maps.map(m => m.id).sort(), ['m1', 'm2']);
  assert.equal(load.body.sheets.w1.hasKey, true);
  const course = await h.admin({ action: 'course', courseId: 'c-p6s' });
  assert.deepEqual(course.body.worksheets.map(w => [w.id, w.hasKey]), [['s1', false], ['s2', false]], 'a key that is not Firebase Storage\'s own is ignored');
  const pack = { title: 'Year-end Countdown: P5 Maths', level: 'P5', subject: 'math', examName: 'Year-end exam', examDate: '2027-10-20',
    price: 29.9, active: true, topics: [{ title: 'Whole numbers', worksheetIds: ['x1', 'x2'], mindmapIds: [], minutes: 45 }] };
  const saved = await h.admin({ action: 'savePack', pack });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.pack.id, 'year-end-countdown-p5-maths');
  assert.equal(saved.body.pack.price, 29.9);
  const again = await h.admin({ action: 'savePack', pack });
  assert.equal(again.body.pack.id, 'year-end-countdown-p5-maths-2', 'a new pack never overwrites another');
  const edited = await h.admin({ action: 'savePack', pack: Object.assign({}, pack, { id: saved.body.pack.id, price: 35 }) });
  assert.equal(h.store.state.packs.get(edited.body.pack.id).price, 35);
  for (const bad of [{ price: 0 }, { price: 5000 }, { examDate: '2027-02-30' }, { level: 'P7' }, { title: '' }, { topics: [{ title: 'x', minutes: 1 }] }, { secret: 1 }])
    assert.equal((await h.admin({ action: 'savePack', pack: Object.assign({}, pack, bad) })).statusCode, 400, JSON.stringify(bad));
  // A pack someone bought stays.
  const order = await buy(h, 'psle-p6-math-2027', 'paynow');
  await h.admin({ action: 'markPaid', code: order.body.code });
  assert.equal((await h.admin({ action: 'deletePack', packId: 'psle-p6-math-2027' })).body.error, 'pack-has-buyers');
  assert.equal((await h.admin({ action: 'deletePack', packId: 'year-end-countdown-p5-maths-2' })).statusCode, 200);
  const list = await h.admin({ action: 'load' });
  assert.equal(list.body.orders.length, 1);
  assert.equal(list.body.orders[0].buyer.email, 'parent@example.com');
  assert.equal(list.body.packs.find(p => p.id === 'psle-p6-math-2027').sold, 1);
});

test('requests from other sites and bad bodies are refused', async () => {
  const h = harness();
  const res = await h.call({ action: 'catalogue' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.statusCode, 403);
  assert.equal((await h.call({ action: 'nope' })).statusCode, 400);
  await h.call({ action: 'catalogue' });
  assert.equal((await buy(h, 'psle-p6-math-2027', 'card', { returnUrl: 'https://evil.example/revision/' })).body.error, 'return-url-not-allowed');
  assert.equal((await buy(h, 'no-such-pack')).body.error, 'pack-unavailable');
  assert.equal((await h.call({ action: 'checkout', packId: 'psle-p6-math-2027', method: 'card', buyer: Object.assign({}, BUYER, { email: 'nope' }),
    returnUrl: ORIGIN + '/revision/' })).body.error, 'invalid-email');
});

test('helpers: codes, days, video page link and answer key paths', () => {
  assert.equal(R.normalAccessCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(R.normalAccessCode('ABCD-EFG1'), '', 'no 1, 0, O, I or L');
  assert.equal(R.showAccessCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.equal(R.daysUntil('2026-11-19', NOW), 0);
  assert.equal(R.daysUntil('2026-11-20', Date.UTC(2026, 10, 19, 16, 30)), 0, 'after midnight in Singapore it is already the 20th');
  assert.equal(R.answerKeyObject(keyUrl('w1', '2026-11-09')), 'pdf-annotator/lesson-key-w1-2026-11-09.pdf');
  assert.equal(R.answerKeyObject('https://firebasestorage.googleapis.com/v0/b/x/o/' + encodeURIComponent('other/file.pdf') + '?alt=media'), '');
  // online/portal-core.js packs the same code.
  const core = require('../../../online/portal-core.js');
  assert.equal(R.videoPackCode('vp1-1234-abcd', TOKEN), core.videoPackCode('vp1-1234-abcd', TOKEN));
  assert.equal(R.guessSubject('Energy conversions'), 'science');
  assert.equal(R.guessSubject('Fractions big picture'), 'math');
});
