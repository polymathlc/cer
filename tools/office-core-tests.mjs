// 🏢 Polymath Office — tests for office/office-core.mjs (node --test tools/office-core-tests.mjs)
//
// Two of these tests cut the ORIGINAL functions out of the live pages and hold
// the office's copies against them across every combination, because the whole
// point of the office is that it agrees with those pages:
//   • monthlyFeeFor — schedule/index.html, the page that sets the fees
//   • buildPayNow   — products/index.html, the shop's PayNow encoder
// Everything else is the office's own arithmetic: references, invoices, states,
// statement reading, matching, allocation, imports and the words sent to parents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as C from '../office/office-core.mjs';

const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const random = n => Array.from({ length: n }, () => randomBytes(4).readUInt32LE(0));
let seq = 0;
const seqRandom = n => Array.from({ length: n }, () => (seq = (seq * 1103515245 + 12345) >>> 0));

function cutFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' is in the page');
  let depth = 0, i = src.indexOf('{', at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}

/* ───────── agreement with the live pages ───────── */
test('monthlyFeeFor gives exactly the schedule page\'s fee for every slot, mode and default', () => {
  const page = read('schedule/index.html');
  const body = ['feeNum', 'isMaster', 'slotMode', 'slotModes', 'monthlyFeeFor'].map(n => cutFunction(page, n)).join('\n');
  // The page reads a global `config`; give it one per case.
  const pageFee = new Function('config', body + '\nreturn monthlyFeeFor;');
  const configs = [
    { monthlyFee: 220, monthlyFeeOnline: '', masterMonthlyFee: '' },
    { monthlyFee: 220, monthlyFeeOnline: 180, masterMonthlyFee: 320 },
    { monthlyFee: '', monthlyFeeOnline: '', masterMonthlyFee: '' },
    { monthlyFee: '0', monthlyFeeOnline: 'abc', masterMonthlyFee: 300.555 }
  ];
  const slots = [
    {}, { mode: 'Physical' }, { mode: 'Online' }, { mode: 'Both' }, { mode: 'Both', fee: 250 }, { mode: 'Both', feeOnline: 199.99 },
    { mode: 'Online', fee: 150, feeOnline: '' }, { type: 'master' }, { type: 'master', fee: 400 }, { type: 'master', mode: 'Online' },
    { mode: 'Both', fee: '', feeOnline: 0 }
  ];
  let checked = 0;
  for (const cfg of configs) for (const s of slots) for (const mode of [undefined, 'Physical', 'Online']) {
    const slot = Object.assign({ level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' }, s);
    assert.equal(C.monthlyFeeFor(slot, mode, cfg), pageFee(cfg)(slot, mode), JSON.stringify({ cfg, s, mode }));
    checked++;
  }
  assert.ok(checked > 100);
});

test('buildPayNow is byte for byte the products page\'s PayNow encoder', () => {
  const page = read('products/index.html');
  const body = ['tlv', 'crc16', 'cleanRef', 'buildPayNow'].map(n => cutFunction(page, n)).join('\n');
  const shop = new Function('PAYNOW_UEN', 'MERCHANT_NAME', body + '\nreturn buildPayNow;')(C.PAYNOW_UEN, C.MERCHANT_NAME);
  for (const amount of [0.01, 1, 12.5, 128, 256.4, 1000, 1234.56, 99999.99])
    for (const ref of ['PLC K7M2QX NOV26', 'PLC ABC123', 'PLC 2Z9Q3R DEC26', 'POLYMATH']) {
      assert.equal(C.buildPayNow(amount, ref), shop(amount, ref));
    }
});

test('a PayNow payload reads back: UEN, fixed amount, reference, CRC', () => {
  const p = C.buildPayNow(256, 'PLC K7M2QX NOV26');
  const r = C.readPayNow(p);
  assert.equal(r.amount, 256);
  assert.equal(r.uen, 'T16LL2365E');
  assert.equal(r.editable, false, 'the parent cannot change the amount');
  assert.equal(r.reference, 'PLC K7M2QX NOV26');
  assert.equal(r.merchant, 'POLYMATH LEARNING');
  assert.ok(r.crcOk);
  assert.ok(!C.readPayNow(p.slice(0, -1) + (p.endsWith('0') ? '1' : '0')).crcOk, 'a damaged payload fails its CRC');
  assert.equal(C.readPayNow(C.buildPayNow(10, 'x'.repeat(40))).reference.length, 25, 'references are capped at 25 characters');
});

/* ───────── reference codes ───────── */
test('family codes are 6 characters from the unambiguous alphabet, always mixing letters and digits, never reused', () => {
  const taken = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = C.newCode(random, taken);
    assert.ok(C.isCode(code), code);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.match(code, /\d/); assert.match(code, /[A-Z]/);
    assert.ok(!taken.has(code));
    taken.add(code);
  }
  assert.ok(!C.isCode('MERRYX'), 'all letters is not a code');
  assert.ok(!C.isCode('234567'), 'all digits is not a code');
  assert.ok(!C.isCode('K7M2Q0'), 'zero is not in the alphabet');
});

test('references, invoice numbers and periods', () => {
  assert.equal(C.invoiceReference('K7M2QX', '2026-11'), 'PLC K7M2QX NOV26');
  assert.equal(C.invoiceNumber('K7M2QX', '2026-11'), 'PLC-2611-K7M2QX');
  assert.equal(C.familyReference('K7M2QX'), 'PLC K7M2QX');
  assert.equal(C.periodLabel('2026-11'), 'November 2026');
  assert.equal(C.periodFromShort('JAN', '27'), '2027-01');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.issueDayKey('2026-11', 31), '2026-11-30');
  assert.equal(C.issueDayKey('2026-02', 5), '2026-02-05');
  assert.ok(C.invoiceReference('ZZZZ22', '2026-12').length <= 25);
});

test('findCodes finds a family\'s code however the bank printed it, and nothing else', () => {
  const known = new Set(['K7M2QX', 'AB3CD4']);
  const cases = [
    ['PAYNOW TRANSFER OTHR PLC K7M2QX NOV26', 'K7M2QX', '2026-11'],
    ['INCOMING PAYNOW REF PLCK7M2QXNOV26 FROM TAN', 'K7M2QX', '2026-11'],
    ['FAST PAYMENT k7m2qx', 'K7M2QX', ''],
    ['OTHR plc-k7m2qx-dec26', 'K7M2QX', '2026-12'],
    ['K7M2QXNOV26 TAN AH KOW', 'K7M2QX', '2026-11'],
    ['PLC AB3CD4', 'AB3CD4', '']
  ];
  for (const [text, code, period] of cases) {
    const hits = C.findCodes(text, known);
    assert.equal(hits.length, 1, text);
    assert.equal(hits[0].code, code, text);
    assert.equal(hits[0].period, period, text);
  }
  assert.deepEqual(C.findCodes('PLC K7M2Q NOV26', known), [], 'a truncated code is not a match');
  assert.deepEqual(C.findCodes('PLC ZZ22ZZ', known), [], 'only codes that belong to a family count');
  assert.deepEqual(C.findCodes('SALARY OCT 2026 GRAB SINGAPORE', known), []);
  assert.equal(C.findCodes('PLC K7M2QX and PLC AB3CD4', known).length, 2);
});

/* ───────── invoices ───────── */
const SCHEDULE = {
  monthlyFee: 220, monthlyFeeOnline: 180, masterMonthlyFee: 320,
  slots: {
    'MON-2': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' },
    'TUE-3': { level: 'P6', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular', fee: 240, feeOnline: '' },
    'SAT-1': { level: 'P6', subject: 'Science', mode: 'Physical', status: 'full', type: 'master', fee: '', feeOnline: '' },
    'WED-1': { level: 'P4', subject: 'Math', mode: 'Online', status: 'closed', type: 'regular', fee: '', feeOnline: '' },
    'FRI-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open', type: 'regular', fee: '', feeOnline: '' }
  }
};
const FAMILY = {
  id: 'fam1', code: 'K7M2QX', parentName: 'Tan Mei Ling', email: 'MEI@Example.com', whatsapp: '9123 4567',
  students: [
    { id: 's1', name: 'Tan Jun Wei', level: 'P5', status: 'active', classes: [{ slotId: 'MON-2', mode: 'Physical' }, { slotId: 'FRI-2', mode: 'Online' }] },
    { id: 's2', name: 'Tan Jia Hui', level: 'p6', status: 'active', classes: [{ slotId: 'TUE-3', mode: 'Physical' }, { slotId: 'SAT-1', mode: 'Physical', rate: 300 }] },
    { id: 's3', name: 'Tan Old', level: 'P6', status: 'left', classes: [{ slotId: 'MON-2', mode: 'Physical' }] }
  ]
};

test('an invoice is priced from the schedule: defaults, online fallback, a slot\'s own fee, a per-student rate', () => {
  const inv = C.buildInvoice(FAMILY, '2026-11', { schedule: SCHEDULE, settings: { invoiceDay: 1, dueDays: 7 }, today: '2026-10-30' });
  assert.equal(inv.id, 'fam1_2026-11');
  assert.equal(inv.reference, 'PLC K7M2QX NOV26');
  assert.deepEqual(inv.lines.map(l => [l.studentName, l.amount]), [
    ['Tan Jun Wei', 220], ['Tan Jun Wei', 180], ['Tan Jia Hui', 240], ['Tan Jia Hui', 300]
  ]);
  assert.equal(inv.total, 940);
  assert.equal(inv.issueDate, '2026-11-01', 'prepared early, it is dated on the invoice day');
  assert.equal(inv.dueDate, '2026-11-08');
  assert.deepEqual(inv.emails, ['mei@example.com']);
  assert.equal(inv.whatsapp, '6591234567');
  assert.deepEqual(inv.students, ['Tan Jun Wei', 'Tan Jia Hui'], 'a student who left is not billed');
  assert.deepEqual(inv.issues, []);
  const late = C.buildInvoice(FAMILY, '2026-11', { schedule: SCHEDULE, settings: { invoiceDay: 1, dueDays: 7 }, today: '2026-11-12' });
  assert.equal(late.issueDate, '2026-11-12', 'prepared mid-month, it is dated today');
  assert.equal(late.dueDate, '2026-11-19');
});

test('discounts and credit come off the total, and an unpriced class is explained, never billed silently', () => {
  const fam = Object.assign({}, FAMILY, { discount: { kind: 'percent', value: 10, label: 'Sibling discount' }, credit: 50 });
  const inv = C.buildInvoice(fam, '2026-11', { schedule: SCHEDULE, today: '2026-11-01' });
  assert.equal(inv.lines.find(l => l.kind === 'discount').amount, -94);
  assert.equal(inv.lines.find(l => l.kind === 'credit').amount, -50);
  assert.equal(inv.creditUsed, 50);
  assert.equal(inv.total, 796);
  const big = C.buildInvoice(Object.assign({}, FAMILY, { credit: 5000 }), '2026-11', { schedule: SCHEDULE, today: '2026-11-01' });
  assert.equal(big.total, 0);
  assert.equal(big.creditUsed, 940, 'only what the month needs is used');
  const nofee = C.buildInvoice({ id: 'f2', code: 'AB3CD4', parentName: 'X', students: [{ id: 'a', name: 'Kid One', classes: [{ slotId: 'WED-1', mode: 'Online' }] }] },
    '2026-11', { schedule: { slots: SCHEDULE.slots }, today: '2026-11-01' });
  assert.equal(nofee.total, 0);
  assert.match(nofee.issues.join(' '), /no monthly fee/);
  const noclass = C.buildInvoice({ id: 'f3', code: 'AB3CD5', parentName: 'Y', students: [{ id: 'b', name: 'Kid Two', classes: [] }] }, '2026-11', { schedule: SCHEDULE });
  assert.match(noclass.issues.join(' '), /not in any class/);
  const own = C.buildInvoice({ id: 'f4', code: 'AB3CD6', parentName: 'Z', students: [{ id: 'c', name: 'Kid Three', monthlyFee: 120, classes: [{ slotId: 'MON-2', mode: 'Online' }] }] }, '2026-11', { schedule: SCHEDULE });
  assert.equal(own.total, 120, 'a student\'s own monthly fee replaces the class prices');
});

test('invoice states: draft → waiting → part → overdue → paid, and cancelled', () => {
  const base = { total: 200, paid: 0, dueDate: '2026-11-08', status: 'draft' };
  assert.equal(C.invoiceState(base, '2026-11-02').key, 'draft');
  const sent = Object.assign({}, base, { sentAt: 1, status: 'sent' });
  assert.equal(C.invoiceState(sent, '2026-11-02').key, 'waiting');
  assert.equal(C.invoiceState(sent, '2026-11-08').key, 'waiting', 'the due date itself is not late');
  const late = C.invoiceState(sent, '2026-11-12');
  assert.equal(late.key, 'overdue'); assert.equal(late.daysOverdue, 4); assert.equal(late.tone, 'red');
  assert.equal(C.invoiceState(Object.assign({}, sent, { paid: 50 }), '2026-11-02').key, 'part');
  assert.equal(C.invoiceState(Object.assign({}, sent, { paid: 200 }), '2026-12-25').key, 'paid');
  assert.equal(C.invoiceState(Object.assign({}, sent, { paid: 250 }), '2026-12-25').key, 'paid');
  assert.equal(C.invoiceState(Object.assign({}, sent, { status: 'void' }), '2026-12-25').key, 'void');
  assert.equal(C.invoiceState(Object.assign({}, base, { paid: 20 }), '2026-11-02').key, 'part', 'paid before it was even sent');
  const sum = C.periodSummary([sent, Object.assign({}, sent, { paid: 200 }), Object.assign({}, sent, { status: 'void' }), base], '2026-11-02');
  assert.equal(sum.count, 3); assert.equal(sum.billed, 600); assert.equal(sum.collected, 200); assert.equal(sum.outstanding, 400);
  assert.equal(sum.percent, 33); assert.equal(sum.draft, 1); assert.equal(sum.waiting, 1); assert.equal(sum.paid, 1);
});

test('the parent\'s link holds no email, phone or address', () => {
  const inv = C.buildInvoice(Object.assign({}, FAMILY, { address: '1 Clementi Road' }), '2026-11', { schedule: SCHEDULE });
  const pub = C.publicInvoiceDoc(inv, {});
  const flat = JSON.stringify(pub);
  assert.ok(!flat.includes('example.com'));
  assert.ok(!flat.includes('91234567'));
  assert.ok(!flat.includes('Clementi'));
  assert.equal(pub.reference, 'PLC K7M2QX NOV26');
  assert.equal(pub.outstanding, 940);
  assert.deepEqual(pub.lines.map(l => l.studentName), ['Tan Jun Wei', 'Tan Jun Wei', 'Tan Jia Hui', 'Tan Jia Hui'], 'full names — a first word is often a surname');
  assert.equal(C.payLink('abc', { save: true }), 'https://polymathlc.com.sg/pay/?i=abc&save=1');
});

/* ───────── payments ───────── */
test('a payment goes to the month in the reference first, then the oldest month; the rest is credit', () => {
  const invs = [
    { id: 'a', period: '2026-09', total: 100, paid: 0, sentAt: 1 },
    { id: 'b', period: '2026-10', total: 100, paid: 40, sentAt: 1 },
    { id: 'c', period: '2026-11', total: 100, paid: 0, sentAt: 1 },
    { id: 'd', period: '2026-08', total: 100, paid: 100, sentAt: 1 }
  ];
  assert.deepEqual(C.allocatePayment(100, invs, '2026-11'), { allocations: [{ invoiceId: 'c', period: '2026-11', amount: 100 }], credit: 0 });
  assert.deepEqual(C.allocatePayment(180, invs, ''), { allocations: [{ invoiceId: 'a', period: '2026-09', amount: 100 }, { invoiceId: 'b', period: '2026-10', amount: 60 }, { invoiceId: 'c', period: '2026-11', amount: 20 }], credit: 0 });
  assert.equal(C.allocatePayment(500, invs, '').credit, 240);
  const after = C.invoiceWithPayment(invs[2], 100, { paymentId: 'p1', amount: 100 });
  assert.equal(after.status, 'paid');
  const undone = C.invoiceWithPayment(after, -100, { paymentId: 'p1' });
  assert.equal(undone.paid, 0); assert.equal(undone.payments.length, 0); assert.equal(undone.status, 'sent');
});

test('the same credit read twice gets the same key, and a different one does not', () => {
  const a = { date: '2026-11-03', amount: 256, description: 'PAYNOW TRANSFER · OTHR PLC K7M2QX NOV26', payer: 'TAN MEI LING' };
  const b = Object.assign({}, a, { description: 'PAYNOW  TRANSFER  OTHR PLC K7M2QX NOV26 ' });
  assert.equal(C.txKey(a), C.txKey(b));
  assert.notEqual(C.txKey(a), C.txKey(Object.assign({}, a, { amount: 255 })));
  assert.notEqual(C.txKey(a), C.txKey(Object.assign({}, a, { date: '2026-11-04' })));
});

test('matching: reference code, then a remembered payer name, then names and amounts as suggestions', () => {
  const fams = [
    { id: 'f1', code: 'K7M2QX', parentName: 'Tan Mei Ling', payerNames: [], students: [{ id: 'a', name: 'Tan Jun Wei' }] },
    { id: 'f2', code: 'AB3CD4', parentName: 'Rajesh Kumar', payerNames: ['priya rajesh'], students: [{ id: 'b', name: 'Arjun Kumar' }] },
    { id: 'f3', code: 'ZX9W2Q', parentName: 'Siti Nurhaliza', payerNames: [], students: [{ id: 'c', name: 'Aisyah Rahman' }] },
    { id: 'f4', code: 'QQ7W2Q', parentName: 'Lim Wei', payerNames: [], students: [{ id: 'd', name: 'Lim Kai' }] }
  ];
  const invs = [
    { id: 'f1_2026-11', familyId: 'f1', period: '2026-11', total: 256, paid: 0, sentAt: 1 },
    { id: 'f2_2026-11', familyId: 'f2', period: '2026-11', total: 220, paid: 0, sentAt: 1 },
    { id: 'f3_2026-11', familyId: 'f3', period: '2026-11', total: 199, paid: 0, sentAt: 1 },
    { id: 'f4_2026-11', familyId: 'f4', period: '2026-11', total: 180, paid: 0, sentAt: 1 }
  ];
  const txs = [
    { key: 't1', amount: 256, description: 'PAYNOW TRANSFER OTHR PLC K7M2QX NOV26', payer: 'ONG SOMEBODY' },
    { key: 't2', amount: 220, description: 'FAST PAYMENT', payer: 'PRIYA RAJESH' },
    { key: 't3', amount: 199, description: 'PAYNOW FROM SITI NURHALIZA', payer: '' },
    { key: 't4', amount: 180, description: 'PAYNOW TRANSFER', payer: 'MR X' },
    { key: 't5', amount: 77, description: 'INTEREST CREDIT', payer: '' },
    { key: 't6', amount: 50, description: 'TRANSFER FROM AISYAH RAHMAN', payer: '' }
  ];
  const out = C.matchTransactions(txs, fams, invs);
  const m = k => out.find(t => t.key === k).match;
  assert.deepEqual([m('t1').familyId, m('t1').how, m('t1').confidence, m('t1').period], ['f1', 'reference', 'high', '2026-11']);
  assert.deepEqual([m('t2').familyId, m('t2').how, m('t2').confidence], ['f2', 'alias', 'high']);
  assert.deepEqual([m('t3').familyId, m('t3').how, m('t3').confidence], ['f3', 'name+amount', 'high']);
  assert.deepEqual([m('t4').familyId, m('t4').how, m('t4').confidence], ['f4', 'amount', 'low']);
  assert.equal(m('t5').familyId, '');
  assert.deepEqual([m('t6').familyId, m('t6').how, m('t6').confidence], ['f3', 'name', 'medium'], 'a student\'s name, wrong amount: suggest only');
  assert.ok(C.autoTick(out[0], invs) && C.autoTick(out[1], invs) && C.autoTick(out[2], invs));
  assert.ok(!C.autoTick(out[3], invs) && !C.autoTick(out[5], invs));
  assert.ok(!C.autoTick(Object.assign({}, out[0], { unverified: true }), invs), 'an amount not printed on the statement is never ticked');
});

test('ChatGPT\'s matches only fill gaps, only with ids it was given, and only when sure', () => {
  const txs = [
    { key: 'k1', amount: 180, match: { familyId: '' } },
    { key: 'k2', amount: 90, match: { familyId: 'already', how: 'reference', confidence: 'high' } },
    { key: 'k3', amount: 60, match: { familyId: '' } }
  ];
  const ids = { families: new Map([['F1', 'fa'], ['F2', 'fb']]), transactions: new Map([['T1', 'k1'], ['T2', 'k2'], ['T3', 'k3']]) };
  const res = C.applyAiMatches(txs, { matches: [
    { tx: 'T1', family: 'F2', confidence: 0.9, why: 'same surname' },
    { tx: 'T2', family: 'F1', confidence: 0.99 },
    { tx: 'T3', family: 'F9', confidence: 0.99 },
    { tx: 'T3', family: 'F1', confidence: 0.3 }
  ] }, ids);
  assert.equal(res[0].match.familyId, 'fb'); assert.equal(res[0].match.how, 'ai');
  assert.equal(res[1].match.familyId, 'already', 'a certain match is never overwritten');
  assert.equal(res[2].match.familyId, '', 'invented ids and unsure answers are dropped');
  const inv = [{ familyId: 'fb', total: 180, paid: 0, sentAt: 1 }];
  assert.ok(C.autoTick(res[0], inv), 'a sure ChatGPT match for exactly what is owed is ticked');
  assert.ok(!C.autoTick(res[0], [{ familyId: 'fb', total: 181, paid: 0, sentAt: 1 }]));
  // A guess from the amount alone, confirmed by ChatGPT, becomes a ticked match;
  // one it overrules is kept as a candidate.
  const guesses = [
    { key: 'g1', amount: 180, match: { familyId: 'fb', how: 'amount', confidence: 'low', why: 'Only family that owes exactly $180.00', candidates: [] } },
    { key: 'g2', amount: 90, match: { familyId: 'fa', how: 'name', confidence: 'medium', why: 'Name of student X', candidates: [] } },
    { key: 'g3', amount: 90, match: { familyId: 'fa', how: 'manual', confidence: 'medium', candidates: [] } }
  ];
  const ids2 = { families: ids.families, transactions: new Map([['T1', 'g1'], ['T2', 'g2'], ['T3', 'g3']]) };
  const res2 = C.applyAiMatches(guesses, { matches: [{ tx: 'T1', family: 'F2', confidence: 0.92, why: 'surname Kumar' }, { tx: 'T2', family: 'F2', confidence: 0.7 }, { tx: 'T3', family: 'F2', confidence: 0.99 }] }, ids2);
  assert.deepEqual([res2[0].match.familyId, res2[0].match.how], ['fb', 'ai']);
  assert.match(res2[0].match.why, /^ChatGPT agrees: surname Kumar · Only family/);
  assert.ok(C.autoTick(res2[0], inv));
  assert.deepEqual([res2[1].match.familyId, res2[1].match.candidates], ['fb', ['fa']], 'the overruled guess stays a candidate');
  assert.ok(!C.autoTick(res2[1], inv), 'an unsure overrule is not ticked');
  assert.equal(res2[2].match.how, 'manual', 'the admin\'s own choice is never touched');
});

test('ChatGPT\'s statement reading is checked against the statement text', () => {
  const text = '03 Nov | PAYNOW TRANSFER | 256.00 | 1,256.00\nOTHR PLC K7M2QX NOV26\n05 Nov | FAST | 1,200.50 | 2,456.50';
  const json = C.parseAiJson('```json\n{"credits":[{"date":"2026-11-03","amount":"256.00","payer":"TAN","reference":"PLC K7M2QX NOV26","description":"PAYNOW"},'
    + '{"date":"2026-11-05","amount":1200.5,"payer":"","reference":"","description":"FAST"},{"date":"2026-11-09","amount":999,"description":"made up"},{"amount":-5}]}\n```');
  const out = C.cleanAiTransactions(json, text);
  assert.equal(out.length, 3);
  assert.equal(out[0].unverified, false);
  assert.equal(out[1].unverified, false, 'thousands separators are ignored when checking');
  assert.equal(out[2].unverified, true, 'an amount not printed anywhere is flagged');
  assert.ok(out.every(t => t.key));
  assert.equal(C.parseAiJson('not json'), null);
  assert.deepEqual(C.parseAiJson('Sure! {"a":1} hope this helps'), { a: 1 });
});

/* ───────── statements ───────── */
test('a bank spreadsheet: headings found under a preamble, credits kept, debits dropped, wrapped rows joined', () => {
  const rows = [
    ['Account Details For:', 'POSB eSavings 123'],
    ['Statement as at:', '30 Nov 2026'],
    [],
    ['Transaction Date', 'Reference', 'Debit Amount', 'Credit Amount', 'Transaction Ref1', 'Transaction Ref2', 'Transaction Ref3'],
    ['03 Nov 2026', 'ICT', '', '256.00', 'PAYNOW TRANSFER', 'PLC K7M2QX NOV26', 'TAN MEI LING'],
    ['04 Nov 2026', 'POS', '12.50', '', 'NTUC FAIRPRICE', '', ''],
    ['05 Nov 2026', 'ICT', '', '1,220.00', 'FAST', '', ''],
    ['', '', '', '', 'FROM RAJESH', '', ''],
    [45970, 'ICT', '', 180, 'PAYNOW', '', '']
  ];
  const res = C.parseStatementRows(rows);
  assert.equal(res.headerRow, 3);
  assert.equal(res.transactions.length, 3);
  assert.deepEqual(res.transactions.map(t => [t.date, t.amount]), [['2026-11-03', 256], ['2026-11-05', 1220], ['2025-11-09', 180]]);
  assert.match(res.transactions[0].description, /PLC K7M2QX NOV26/);
  assert.match(res.transactions[1].description, /FROM RAJESH/, 'the wrapped row joins the credit above it');
  const signed = C.parseStatementRows([['Date', 'Description', 'Amount'], ['2026-11-01', 'IN', '100.00'], ['2026-11-02', 'OUT', '-40.00'], ['01/11/2026', 'IN2', '(5.00)']]);
  assert.deepEqual(signed.transactions.map(t => t.amount), [100]);
  assert.equal(C.parseStatementRows([['a', 'b'], ['1', '2']]), null, 'no headings → null, so ChatGPT is asked');
});

test('a PDF statement: columns by position, continuation lines folded in, debits ignored', () => {
  const it = (str, x, w) => ({ str, x, w: w || str.length * 5, y: 0 });
  const line = (y, ...items) => items.map(i => Object.assign(i, { y }));
  const page = [
    ...line(100, it('Date', 40), it('Description', 110), it('Withdrawal', 330, 50), it('Deposit', 410, 40), it('Balance', 500, 40)),
    ...line(120, it('03 Nov', 40), it('PAYNOW TRANSFER', 110), it('256.00', 420, 30), it('1,256.00', 500, 40)),
    ...line(132, it('OTHR PLC K7M2QX NOV26', 110)),
    ...line(144, it('TAN MEI LING', 110)),
    ...line(160, it('04 Nov', 40), it('NETS FAIRPRICE', 110), it('12.50', 350, 30), it('1,243.50', 500, 40)),
    ...line(176, it('05 Nov', 40), it('FAST PAYMENT', 110), it('1,220.00', 410, 40), it('2,463.50', 500, 40)),
    ...line(188, it('FROM RAJESH KUMAR', 110))
  ];
  const lines = C.pdfLines([page]);
  assert.ok(lines.some(l => l.text.includes(' | ')), 'wide gaps become column markers');
  const txs = C.parseStatementLines(lines, { hintYear: 2026 });
  assert.deepEqual(txs.map(t => [t.date, t.amount]), [['2026-11-03', 256], ['2026-11-05', 1220]]);
  assert.match(txs[0].description, /PLC K7M2QX NOV26/);
  assert.match(txs[0].description, /TAN MEI LING/);
  assert.match(txs[1].description, /RAJESH/);
  // No headings at all: the running balance says which way the money went.
  const bare = C.parseStatementLines([
    { text: '01 Nov 2026 Balance B/F 1,000.00', items: [] },
    { text: '02 Nov 2026 PAYNOW IN 200.00 1,200.00', items: [] },
    { text: '03 Nov 2026 CARD 50.00 1,150.00', items: [] }
  ]);
  assert.deepEqual(bare.map(t => t.amount), [200]);
});

test('dates as banks and spreadsheets print them', () => {
  assert.equal(C.parseDateLoose('03 Nov 2026'), '2026-11-03');
  assert.equal(C.parseDateLoose('3-NOV-26'), '2026-11-03');
  assert.equal(C.parseDateLoose('03/11/2026'), '2026-11-03', 'day first, as Singapore writes it');
  assert.equal(C.parseDateLoose('2026-11-03'), '2026-11-03');
  assert.equal(C.parseDateLoose('Nov 3, 2026'), '2026-11-03');
  assert.equal(C.parseDateLoose('03 Nov', 2026), '2026-11-03');
  assert.equal(C.parseDateLoose('31 Dec', 2027, 1), '2026-12-31', 'December on a January statement is last year');
  assert.equal(C.parseDateLoose(45970), '2025-11-09');
  assert.equal(C.parseDateLoose(45658), '2025-01-01', 'Excel serial days count from 30 Dec 1899');
  assert.equal(C.parseDateLoose(new Date(2026, 10, 3)), '2026-11-03');
  assert.equal(C.parseDateLoose('hello'), '');
  assert.equal(C.parseDateLoose('31/02/2026x').length, 10);
});

test('money is read and written the way people write it', () => {
  assert.equal(C.parseMoney('S$1,234.50'), 1234.5);
  assert.equal(C.parseMoney('(12.00)'), -12);
  assert.equal(C.parseMoney('12.00 DR'), -12);
  assert.equal(C.parseMoney('12.00 CR'), 12);
  assert.ok(isNaN(C.parseMoney('')));
  assert.ok(isNaN(C.parseMoney('abc')));
  assert.equal(C.money(1234.5), '$1,234.50');
  assert.equal(C.money(-5), '-$5.00');
});

/* ───────── words ───────── */
test('the invoice email carries the amount, the reference, the QR inline, and a Save QR button', () => {
  const inv = Object.assign(C.buildInvoice(FAMILY, '2026-11', { schedule: SCHEDULE, today: '2026-11-01' }), { sentAt: 1 });
  const mail = C.invoiceEmail(inv, {}, { payUrl: 'https://polymathlc.com.sg/pay/?i=TOKEN', qrCid: 'paynowqr' });
  assert.match(mail.subject, /November 2026/); assert.match(mail.subject, /\$940\.00/);
  assert.ok(mail.html.includes('cid:paynowqr'));
  assert.ok(mail.html.includes('PLC K7M2QX NOV26'));
  assert.ok(mail.html.includes('https://polymathlc.com.sg/pay/?i=TOKEN&amp;save=1'), 'the Save QR button');
  assert.ok(mail.html.includes('T16LL2365E'));
  assert.ok(mail.text.includes('Reference: PLC K7M2QX NOV26'));
  assert.ok(mail.text.includes('save=1'));
  assert.ok(!/<script/i.test(mail.html));
  const evil = Object.assign({}, inv, { parentName: '<img src=x onerror=alert(1)>' });
  assert.ok(!C.invoiceEmail(evil, {}, {}).html.includes('<img src=x'), 'names are escaped');
  const r1 = C.reminderEmail(inv, {}, { level: 1, payUrl: 'u' }), r3 = C.reminderEmail(inv, {}, { level: 3 });
  assert.match(r1.subject, /^Reminder/); assert.match(r3.subject, /^Final reminder/);
  const part = Object.assign({}, inv, { paid: 400 });
  assert.match(C.reminderEmail(part, {}, {}).subject, /\$540\.00 outstanding/);
  const doc = C.officeMail(['mei@example.com', 'not-an-email'], mail, { invoiceId: inv.id }, { copyAdmin: true });
  assert.deepEqual(doc.to, ['mei@example.com']);
  assert.equal(doc.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.deepEqual(doc.bcc, ['admin@polymathlc.com.sg']);
  assert.match(C.mailDocId('invoice', 'fam1_2026-11', 5), /^polymath-office-invoice-fam1_2026-11-5$/);
  const att = C.qrAttachment('data:image/png;base64,AAAA', inv.reference);
  assert.deepEqual([att.filename, att.content, att.cid], ['PayNow-PLC-K7M2QX-NOV26.png', 'AAAA', 'paynowqr']);
});

test('WhatsApp: the text names the amount and the reference, and the link opens the right chat', () => {
  const inv = C.buildInvoice(FAMILY, '2026-11', { schedule: SCHEDULE, today: '2026-11-01' });
  const text = C.whatsappInvoiceText(inv, {}, 'https://polymathlc.com.sg/pay/?i=T');
  assert.match(text, /\$940\.00/); assert.match(text, /PLC K7M2QX NOV26/); assert.match(text, /save=1/);
  assert.equal(C.whatsappLink('9123 4567', 'hi there', true), 'https://web.whatsapp.com/send?phone=6591234567&text=hi%20there');
  assert.equal(C.whatsappLink('+65 9123 4567', 'x', false), 'https://wa.me/6591234567?text=x');
  assert.equal(C.normalizeWhatsapp('+44 7700 900123'), '447700900123');
  assert.equal(C.normalizeWhatsapp('12'), '');
  assert.equal(C.displayPhone('6591234567'), '+65 9123 4567');
});

/* ───────── importing ───────── */
test('the centre\'s own sheet imports into families, by WhatsApp number, with classes found in the schedule', () => {
  const rows = [
    ['Online/Physical', 'Student Name', 'Parent', 'Contact number', 'Email address', 'Level', 'Math (Day)', 'Science (Day)', 'Fee', 'Expiry/ Remark', 'Category'],
    ['Physical', 'Ali Bin Test', 'Test Parent', '91110000', 'one@example.com', 'P5', 'Friday', 'Monday', '', 'Feb paid', 'Old Batch'],
    ['online', 'Ali Sister', 'Test Parent', '9111 0000', '', 'Primary 6', '', 'saturday', '120.0', '', 'Old Batch'],
    ['Online', 'Lone Kid', '', '', 'two@example.com / three@example.com', 'P4', 'Wednesday', 'Thursday', '', '', ''],
    ['Physical', '', 'Nobody', '9', '', '', '', '', '', '', '']
  ];
  const ids = { n: 0 };
  const plan = C.planImport(rows, { schedule: SCHEDULE, random: seqRandom, newId: () => 'id' + (++ids.n), today: '2026-10-30' });
  assert.equal(plan.report.rows, 3);
  assert.equal(plan.report.students, 3);
  assert.equal(plan.report.newFamilies, 2);
  assert.equal(plan.families.length, 2);
  const tp = plan.families.find(f => f.parentName === 'Test Parent');
  assert.equal(tp.whatsapp, '6591110000');
  assert.equal(tp.students.length, 2, 'two rows with the same number are one family');
  assert.ok(C.isCode(tp.code));
  const ali = tp.students[0];
  assert.deepEqual(ali.classes.map(c => [c.slotId, c.mode]), [['FRI-2', 'Physical'], ['MON-2', 'Physical']]);
  const sister = tp.students[1];
  assert.equal(sister.level, 'P6');
  assert.deepEqual(sister.classes.map(c => c.slotId), ['SAT-1']);
  assert.match(sister.notes, /Sheet fee: \$120\.00/);
  const lone = plan.families.find(f => f.parentName === "Lone Kid's parent");
  assert.deepEqual([lone.email, lone.email2], ['two@example.com', 'three@example.com']);
  assert.deepEqual(lone.students[0].classes.map(c => [c.slotId, c.mode]), [['WED-1', 'Online']], 'the sheet\'s Online/Physical column sets the mode');
  assert.ok(plan.report.needsClass.some(n => /Lone Kid/.test(n)), 'a class the schedule does not have is reported');
  assert.ok(plan.report.skipped.length === 1);
  // Importing again adds nothing; importing into an existing family only adds new children.
  const again = C.planImport(rows, { schedule: SCHEDULE, random: seqRandom, existing: plan.families, newId: () => 'x' });
  assert.equal(again.report.students, 0);
  const more = C.planImport([rows[0], ['Online', 'New Baby', 'Test Parent', '91110000', '', 'P3', '', '', '', '', '']], { schedule: SCHEDULE, existing: plan.families, newId: () => 'nb' });
  assert.equal(more.report.newFamilies, 0); assert.equal(more.report.updatedFamilies, 1);
  assert.equal(more.families[0].students.length, 3);
  assert.equal(more.families[0].code, tp.code, 'an existing family keeps its code');
});

test('header mapping, day cells and pasted sheets', () => {
  const map = C.mapImportHeaders(['Child Name', 'HP', 'Parent Name', 'Maths', 'Science (Day)', 'Date Joined', 'Home Address', 'E-mail']);
  assert.deepEqual(map, { studentName: 0, whatsapp: 1, parentName: 2, mathDay: 3, scienceDay: 4, signUpDate: 5, address: 6, email: 7 });
  assert.deepEqual(C.parseDayCell('Monday (Phy)'), { day: 'MON', mode: 'Physical', startMin: null, raw: 'Monday (Phy)' });
  assert.equal(C.parseDayCell('Sat 9am').startMin, 540);
  assert.equal(C.parseDayCell('-'), null);
  assert.deepEqual(C.parseDelimited('a\tb\n"x, y"\t"he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(C.parseDelimited('a,b\n1,"2,3"'), [['a', 'b'], ['1', '2,3']]);
  assert.equal(C.toCsv([['a', 'b,c'], ['"q"', '']]), 'a,"b,c"\r\n"""q""",');
});

test('the timetable model and the roster of each slot', () => {
  const rows = C.timetableRows();
  assert.equal(rows.length, 6);
  assert.equal(rows[0].label, '9:00am – 10:45am', 'Saturday mornings come first');
  assert.equal(rows[0].cells.SAT.id, 'SAT-1');
  assert.equal(rows[0].cells.MON, undefined);
  assert.equal(rows[3].cells.MON.id, 'MON-1');
  const roster = C.slotRoster([FAMILY], SCHEDULE);
  assert.equal(roster.get('MON-2').length, 1, 'the student who left is not on the roster');
  assert.equal(roster.get('TUE-3')[0].name, 'Tan Jia Hui');
  const st = C.studentRows([FAMILY], SCHEDULE);
  assert.equal(st.length, 3);
  assert.deepEqual(st[0].subjects.sort(), ['Math', 'Science']);
  assert.equal(st[0].monthly, 400);
});

test('reminders are not repeated inside the gap, and only invoices that were sent are chased', () => {
  const inv = { total: 100, paid: 0, sentAt: 1, dueDate: '2026-11-08', reminders: [{ day: '2026-11-10' }] };
  assert.ok(!C.canRemind(inv, '2026-11-12', 5));
  assert.ok(C.canRemind(inv, '2026-11-15', 5));
  assert.ok(C.canRemind({ reminders: [] }, '2026-11-15', 5));
  const list = [inv, { total: 100, paid: 0, dueDate: '2026-11-08' }, { total: 100, paid: 100, sentAt: 1 }, { total: 100, paid: 0, sentAt: 1, dueDate: '2026-12-08' }];
  assert.equal(C.stillOwing(list, '2026-11-12').length, 2);
  assert.equal(C.stillOwing(list, '2026-11-12', { overdueOnly: true }).length, 1);
});

test('settings are clamped to sensible values', () => {
  const s = C.normalizeSettings({ invoiceDay: 45, dueDays: -3, autopilot: 'yes', replyTo: 'nope', uen: ' t16ll2365e ' });
  assert.equal(s.invoiceDay, 28); assert.equal(s.dueDays, 0); assert.equal(s.autopilot, 'off');
  assert.equal(s.replyTo, 'admin@polymathlc.com.sg'); assert.equal(s.uen, 'T16LL2365E');
});

test('the office admins are the same accounts the rules tool installs', async () => {
  const rules = await import('./office-rules.mjs');
  assert.deepEqual(rules.OFFICE_ADMINS, C.OFFICE_ADMINS);
  assert.deepEqual(rules.OFFICE_COLLECTIONS.slice().sort(), Object.values(C.COLLECTIONS).slice().sort());
  assert.equal(rules.OFFICE_MAIL_PREFIX, C.MAIL_PREFIX);
});
