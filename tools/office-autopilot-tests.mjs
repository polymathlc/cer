// Tests for tools/office-autopilot.mjs against an in-memory Firestore that speaks
// the Admin SDK's shape. node --test tools/office-autopilot-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { autopilotPlan, runAutopilot, AUTOPILOT_WINDOW_DAYS } from './office-autopilot.mjs';
import * as C from '../office/office-core.mjs';

function fakeDb(seed) {
  const store = new Map(Object.entries(JSON.parse(JSON.stringify(seed || {}))));
  const SENT = Symbol('fv');
  const FieldValue = { serverTimestamp: () => ({ [SENT]: 'ts' }), arrayUnion: (...items) => ({ [SENT]: 'union', items }) };
  const resolve = (v, prev) => v && v[SENT] === 'ts' ? 'TS' : v && v[SENT] === 'union' ? [...(prev || []), ...v.items] : JSON.parse(JSON.stringify(v));
  const write = (path, data, merge) => {
    const base = merge ? Object.assign({}, store.get(path) || {}) : {};
    Object.keys(data).forEach(k => { base[k] = resolve(data[k], base[k]); });
    store.set(path, base);
  };
  const snap = path => ({ id: path.split('/')[1], exists: store.has(path), data: () => JSON.parse(JSON.stringify(store.get(path))) });
  const doc = (col, id) => ({
    path: col + '/' + id, id,
    get: async () => snap(col + '/' + id),
    set: async (d, o) => write(col + '/' + id, d, o && o.merge),
    update: async d => { if (!store.has(col + '/' + id)) throw new Error('missing'); write(col + '/' + id, d, true); }
  });
  const db = {
    collection: col => ({
      doc: id => doc(col, id),
      get: async () => ({ docs: [...store.keys()].filter(k => k.startsWith(col + '/')).map(snap) })
    }),
    runTransaction: async fn => {
      const ops = [];
      const t = { get: async ref => snap(ref.path), set: (ref, d) => ops.push(() => write(ref.path, d, false)), update: (ref, d) => ops.push(() => write(ref.path, d, true)) };
      const r = await fn(t); ops.forEach(o => o()); return r;
    }
  };
  return { db, FieldValue, store };
}
const SCHEDULE = { monthlyFee: 220, monthlyFeeOnline: 180, slots: { 'MON-2': { level: 'P5', subject: 'Science', mode: 'Both' }, 'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', fee: 240 } } };
const fam = (id, code, name, email, kids, extra) => Object.assign({ code, parentName: name, email, whatsapp: '9111000' + id.slice(-1), status: 'active', students: kids }, extra || {});
const SEED = {
  'schedule_config/main': SCHEDULE,
  'officeFamilies/f1': fam('f1', 'AB2CD3', 'Tan Mei Ling', 'tan@example.com', [{ id: 'a', name: 'Tan Jun Wei', status: 'active', classes: [{ slotId: 'MON-2', mode: 'Physical' }] }], { credit: 20 }),
  'officeFamilies/f2': fam('f2', 'EF4GH5', 'Siti Rahman', '', [{ id: 'b', name: 'Aisyah', status: 'active', classes: [{ slotId: 'TUE-3', mode: 'Physical' }] }]),
  'officeFamilies/f3': fam('f3', 'JK6MN7', 'Paused Family', 'p@example.com', [{ id: 'c', name: 'Kid', status: 'paused', classes: [{ slotId: 'MON-2', mode: 'Physical' }] }]),
  'officeFamilies/f4': fam('f4', 'PQ8RS9', 'No Class', 'n@example.com', [{ id: 'd', name: 'Kiddo', status: 'active', classes: [] }])
};
const at = day => Date.UTC(2026, 11, day, 1, 7);   // 09:07 SGT in December 2026
const qrPng = async payload => Buffer.from('PNG:' + payload).toString('base64');
const quiet = () => {};

test('the plan: off, before the day, the window, after it, and once a month', () => {
  assert.equal(autopilotPlan({ autopilot: 'off' }, {}, '2026-12-01').act, false);
  assert.match(autopilotPlan({ autopilot: 'send', invoiceDay: 5 }, {}, '2026-12-04').why, /Waiting for day 5/);
  assert.equal(autopilotPlan({ autopilot: 'send', invoiceDay: 5 }, {}, '2026-12-05').act, true);
  assert.equal(autopilotPlan({ autopilot: 'review', invoiceDay: 5 }, {}, '2026-12-0' + (5 + AUTOPILOT_WINDOW_DAYS)).act, true, 'a missed morning is caught up');
  assert.match(autopilotPlan({ autopilot: 'send', invoiceDay: 5 }, {}, '2026-12-20').why, /Past the invoice-day window/, 'never bills mid-month');
  assert.match(autopilotPlan({ autopilot: 'send', invoiceDay: 1 }, { lastPeriod: '2026-12' }, '2026-12-02').why, /already prepared/);
  assert.equal(autopilotPlan({ autopilot: 'send', invoiceDay: 1 }, { lastPeriod: '2026-11' }, '2026-12-01').mode, 'send');
});

test('off: a heartbeat and nothing else', async () => {
  const { db, FieldValue, store } = fakeDb(Object.assign({ 'officeSettings/config': { autopilot: 'off' } }, SEED));
  const res = await runAutopilot({ db, FieldValue, now: at(1), qrPng, log: quiet });
  assert.equal(res.created.length, 0);
  assert.equal([...store.keys()].filter(k => k.startsWith('officeInvoices/')).length, 0);
  assert.equal(store.get('officeSettings/autopilot').result, 'Autopilot is off.');
});

test('review: prepares every billable family, uses credit, and tells the office — parents get nothing', async () => {
  const { db, FieldValue, store } = fakeDb(Object.assign({ 'officeSettings/config': { autopilot: 'review', invoiceDay: 1 } }, SEED));
  const res = await runAutopilot({ db, FieldValue, now: at(1), qrPng, log: quiet });
  const invs = [...store.entries()].filter(([k]) => k.startsWith('officeInvoices/')).map(([k, v]) => Object.assign({ id: k }, v));
  assert.deepEqual(invs.map(i => i.parentName).sort(), ['Siti Rahman', 'Tan Mei Ling']);
  const tan = invs.find(i => i.parentName === 'Tan Mei Ling');
  assert.equal(tan.total, 200, '$220 less the $20 credit');
  assert.equal(tan.status, 'draft');
  assert.equal(tan.createdBy, 'autopilot');
  assert.equal(tan.reference, 'PLC AB2CD3 DEC26');
  assert.equal(store.get('officeFamilies/f1').credit, 0, 'the credit is used up');
  assert.ok(store.has('officeLinks/' + tan.linkToken), 'the parent\'s link exists');
  const mails = [...store.entries()].filter(([k]) => k.startsWith('mail/'));
  assert.equal(mails.length, 1, 'only the summary to the office');
  const [id, summary] = mails[0];
  assert.match(id, /^mail\/polymath-office-autopilot-2026-12-/);
  assert.deepEqual(summary.to, ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);
  assert.match(summary.message.subject, /December 2026 invoices are ready/);
  assert.match(summary.message.text, /Not billed: No Class/);
  assert.match(summary.message.text, /without an email.*Siti Rahman/);
  assert.equal(store.get('officeSettings/autopilot').lastPeriod, '2026-12');
  assert.equal(res.sent.length, 0);
  // The next morning does nothing.
  const again = await runAutopilot({ db, FieldValue, now: at(2), qrPng, log: quiet });
  assert.equal(again.plan.act, false);
  assert.equal([...store.keys()].filter(k => k.startsWith('mail/')).length, 1);
});

test('send: emails every family with an address, QR attached, and never makes a second invoice', async () => {
  const seed = Object.assign({ 'officeSettings/config': { autopilot: 'send', invoiceDay: 1 } }, SEED);
  // The admin had already prepared Tan's invoice by hand that morning.
  seed['officeInvoices/f1_2026-12'] = { familyId: 'f1', period: '2026-12', total: 220, status: 'draft', parentName: 'Tan Mei Ling' };
  const { db, FieldValue, store } = fakeDb(seed);
  const res = await runAutopilot({ db, FieldValue, now: at(1), qrPng, log: quiet });
  assert.deepEqual(res.created.map(i => i.parentName), ['Siti Rahman']);
  assert.deepEqual(res.noEmail, ['Siti Rahman']);
  assert.equal(res.sent.length, 0, 'the hand-made draft is left for the admin; Siti has no email');
  // A clean month: Tan is prepared and emailed.
  const fresh = fakeDb(Object.assign({ 'officeSettings/config': { autopilot: 'send', invoiceDay: 1 } }, SEED));
  const r2 = await runAutopilot({ db: fresh.db, FieldValue: fresh.FieldValue, now: at(1), qrPng, log: quiet });
  assert.deepEqual(r2.sent, ['Tan Mei Ling']);
  const mail = [...fresh.store.entries()].find(([k]) => k.startsWith('mail/polymath-office-invoice-'))[1];
  assert.deepEqual(mail.to, ['tan@example.com']);
  assert.equal(mail.message.attachments[0].cid, 'paynowqr');
  assert.equal(Buffer.from(mail.message.attachments[0].content, 'base64').toString(), 'PNG:' + C.buildPayNow(200, 'PLC AB2CD3 DEC26'));
  const tan = fresh.store.get('officeInvoices/f1_2026-12');
  assert.equal(tan.status, 'sent');
  assert.equal(tan.sends[0].by, 'autopilot');
});

test('dry run writes nothing at all', async () => {
  const { db, FieldValue, store } = fakeDb(Object.assign({ 'officeSettings/config': { autopilot: 'send', invoiceDay: 1 } }, SEED));
  const before = JSON.stringify([...store.entries()]);
  const res = await runAutopilot({ db, FieldValue, now: at(1), qrPng, dryRun: true, log: quiet });
  assert.equal(res.created.length, 2);
  assert.equal(JSON.stringify([...store.entries()]), before);
});
