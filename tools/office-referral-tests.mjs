// 🎁 Polymath Office referral rewards (office-core §10), under node --test.
//   node --test tools/office-referral-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../office/office-core.mjs';

const SCHEDULE = { monthlyFee: 240, slots: { 'MON-1': { level: 'P5', subject: 'Math', mode: 'Physical', status: 'open', type: 'regular' } } };
const fam = (id, extra) => C.normalizeFamily(Object.assign({
  id, code: 'CODE' + id.toUpperCase().padEnd(2, 'X').slice(0, 2), parentName: 'Parent ' + id, email: id + '@example.test',
  students: [{ id: id + '-s', name: 'Child ' + id, level: 'P5', status: 'active', classes: [{ slotId: 'MON-1', mode: 'Physical' }] }]
}, extra || {}));
const tan = () => fam('tan', { code: 'TAN2AA', referralCode: 'K7M2QX', parentName: 'Tan Mei Ling' });
const lim = () => fam('lim', { code: 'LIM3BB', parentName: 'Lim Wei Jie', email: 'lim@example.test', whatsapp: '91234567' });

test('a referral code is read from a link, a typed code or a bank-style reference', () => {
  assert.equal(C.cleanReferralCode('k7m2qx'), 'K7M2QX');
  assert.equal(C.cleanReferralCode(' K7M 2QX '), 'K7M2QX');
  assert.equal(C.cleanReferralCode('PLC K7M2QX'), 'K7M2QX');
  assert.equal(C.cleanReferralCode('https://polymathlc.com.sg/schedule/?ref=K7M2QX#week'), 'K7M2QX');
  for (const bad of ['', 'K7M2Q', 'K7M2QXX', 'I0O1LZ', null, undefined, 42]) assert.equal(C.cleanReferralCode(bad), '', String(bad));
  assert.equal(C.referralLink('K7M2QX'), 'https://polymathlc.com.sg/schedule/?ref=K7M2QX');
  assert.equal(C.referralLink('nope'), '');
});

test('a new referral code clashes with no family code and no other referral code', () => {
  const fams = [tan(), lim()];
  let n = 0;
  // A random source that first offers the taken codes, then a free one.
  const seq = ['TAN2AA', 'K7M2QX', 'LIM3BB', 'NEW4CD'];
  const idx = c => C.CODE_CHARS.indexOf(c);
  const random = () => Array.from(seq[Math.min(n++, seq.length - 1)], idx);
  assert.equal(C.newReferralCode(random, fams), 'NEW4CD');
});

test('families load with no referral data at all, and keep what they have', () => {
  const f = C.normalizeFamily({ id: 'x', parentName: 'X' });
  assert.equal(f.referralCode, '');
  assert.deepEqual(f.rewards, []);
  assert.equal(f.referredBy, null);
  const g = C.normalizeFamily({ id: 'y', referralCode: 'k7m2qx', rewards: [{ id: 'r', kind: 'weird', amount: '30' }, { id: '', amount: 5 }, { id: 'z', amount: 0 }], referredBy: { familyId: 'tan', name: 'Tan' } });
  assert.equal(g.referralCode, 'K7M2QX');
  assert.equal(g.rewards.length, 1, 'a reward without an id or an amount is dropped');
  assert.equal(g.rewards[0].kind, 'goodwill');
  assert.equal(g.rewards[0].amount, 30);
  assert.equal(g.referredBy.familyId, 'tan');
});

test('settings: $50 each to start, any amount after, 0 for no reward', () => {
  const d = C.normalizeSettings({});
  assert.equal(d.referralReward, 50);
  assert.equal(d.referralFriendReward, 50);
  const s = C.normalizeSettings({ referralReward: '80', referralFriendReward: '0' });
  assert.equal(s.referralReward, 80);
  assert.equal(s.referralFriendReward, 0);
  assert.equal(C.normalizeSettings({ referralReward: '' }).referralReward, 50, 'a cleared box goes back to the starting amount');
  assert.equal(C.normalizeSettings({ referralReward: -5 }).referralReward, 0);
});

test('confirming a referral rewards both families and remembers who introduced whom', () => {
  const plan = C.referralPlan(tan(), lim(), { settings: { referralReward: 60, referralFriendReward: 40 }, today: '2026-11-19', by: 'admin@polymathlc.com.sg', ids: ['ra', 'rb'], bookingId: 'BK1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.forReferrer, 60);
  assert.equal(plan.forFriend, 40);
  assert.deepEqual(plan.referrerRewards.map(r => [r.id, r.kind, r.amount, r.otherFamilyId, r.bookingId, r.confirmedAt]), [['ra', 'referrer', 60, 'lim', 'BK1', '2026-11-19']]);
  assert.deepEqual(plan.friendRewards.map(r => [r.id, r.kind, r.amount, r.otherFamilyId]), [['rb', 'friend', 40, 'tan']]);
  assert.equal(plan.referrerRewards[0].otherName, 'Lim Wei Jie\'s family');
  assert.equal(plan.friendRewards[0].otherName, 'Tan Mei Ling\'s family');
  assert.equal(plan.referredBy.familyId, 'tan');
  assert.equal(plan.referredBy.code, 'K7M2QX');
  assert.match(plan.text, /\$60\.00 off their next invoice.*\$40\.00 off theirs/);
  // Amounts changed for this one referral only.
  const once = C.referralPlan(tan(), lim(), { settings: {}, amounts: { referrer: '100', friend: 0 }, ids: ['a', 'b'], today: '2026-11-19' });
  assert.equal(once.referrerRewards[0].amount, 100);
  assert.equal(once.friendRewards.length, 0, 'a $0 reward is not stored');
});

test('a family cannot refer itself, be referred twice, or refer back the family that referred it', () => {
  assert.match(C.referralPlan(tan(), tan(), {}).problems.join(' '), /cannot refer itself/);
  assert.match(C.referralPlan(null, lim(), {}).problems.join(' '), /introduced them/);
  assert.match(C.referralPlan(tan(), null, {}).problems.join(' '), /Add the family first/);
  const first = C.referralPlan(tan(), lim(), { ids: ['a', 'b'], today: '2026-11-19' });
  const limAfter = Object.assign(lim(), { rewards: first.friendRewards, referredBy: first.referredBy });
  const tanAfter = Object.assign(tan(), { rewards: first.referrerRewards });
  assert.match(C.referralPlan(fam('ong'), limAfter, {}).problems.join(' '), /already referred by Tan Mei Ling/);
  assert.match(C.referralPlan(limAfter, tanAfter, {}).problems.join(' '), /cannot refer each other back/);
});

test('a reward is its own line on the next invoice, after the discount and before credit', () => {
  const f = Object.assign(tan(), {
    discount: { kind: 'amount', value: 20, label: 'Sibling discount' }, credit: 15,
    rewards: [{ id: 'r1', kind: 'referrer', amount: 50, otherName: 'Lim Wei Jie\'s family', confirmedAt: '2026-11-19' }]
  });
  const inv = C.buildInvoice(f, '2026-12', { schedule: SCHEDULE, settings: {}, today: '2026-12-01' });
  assert.deepEqual(inv.lines.map(l => [l.kind, l.amount]), [['class', 240], ['discount', -20], ['reward', -50], ['credit', -15]]);
  const line = inv.lines.find(l => l.kind === 'reward');
  assert.equal(line.desc, 'Referral reward');
  assert.equal(line.detail, 'Thank you for introducing Lim Wei Jie\'s family to Polymath');
  assert.equal(inv.total, 155);
  assert.deepEqual(inv.rewardUses, [{ id: 'r1', amount: 50 }]);
  assert.equal(inv.rewardsUsed, 50);
  // The same write takes the credit and marks the reward used.
  const fu = C.familyUpdateForInvoice(f, inv);
  assert.equal(fu.credit, 0);
  assert.equal(fu.rewards[0].used, 50);
  assert.deepEqual(fu.rewards[0].uses, [{ invoiceId: inv.id, period: '2026-12', amount: 50 }]);
  // The next invoice has no reward left to give.
  const next = C.buildInvoice(Object.assign({}, f, fu), '2027-01', { schedule: SCHEDULE, settings: {}, today: '2027-01-01' });
  assert.equal(next.lines.some(l => l.kind === 'reward'), false);
  assert.deepEqual(next.rewardUses, []);
  // The parent's page shows the line as it is.
  const pub = C.publicInvoiceDoc(inv, {});
  assert.ok(pub.lines.some(l => l.desc === 'Referral reward' && l.amount === -50));
});

test('a reward bigger than the invoice carries on to the next one, and a welcome reward reads as one', () => {
  const f = Object.assign(lim(), { rewards: [{ id: 'w', kind: 'friend', amount: 300, otherName: 'Tan Mei Ling\'s family', confirmedAt: '2026-11-19' }] });
  const dec = C.buildInvoice(f, '2026-12', { schedule: SCHEDULE, settings: {}, today: '2026-12-01' });
  assert.equal(dec.total, 0, 'never below zero');
  const line = dec.lines.find(l => l.kind === 'reward');
  assert.equal(line.amount, -240);
  assert.equal(line.desc, 'Welcome reward');
  assert.match(line.detail, /joined through Tan Mei Ling's family's referral \(\$60\.00 more next month\)/);
  const after = Object.assign({}, f, C.familyUpdateForInvoice(f, dec));
  assert.equal(C.familyRewardsLeft(after), 60);
  const jan = C.buildInvoice(after, '2027-01', { schedule: SCHEDULE, settings: {}, today: '2027-01-01' });
  assert.equal(jan.lines.find(l => l.kind === 'reward').amount, -60);
  assert.equal(jan.total, 180);
});

test('two rewards are used oldest first', () => {
  const f = Object.assign(tan(), { rewards: [
    { id: 'new', kind: 'referrer', amount: 200, confirmedAt: '2026-11-20', otherName: 'B' },
    { id: 'old', kind: 'referrer', amount: 100, confirmedAt: '2026-11-02', otherName: 'A' }
  ] });
  const inv = C.buildInvoice(f, '2026-12', { schedule: SCHEDULE, settings: {}, today: '2026-12-01' });
  assert.deepEqual(inv.rewardUses, [{ id: 'old', amount: 100 }, { id: 'new', amount: 140 }]);
});

test('cancelling an invoice gives its reward and its credit back', () => {
  const f = Object.assign(tan(), { credit: 10, rewards: [{ id: 'r1', kind: 'referrer', amount: 50, confirmedAt: '2026-11-19' }] });
  const inv = C.buildInvoice(f, '2026-12', { schedule: SCHEDULE, settings: {}, today: '2026-12-01' });
  const used = Object.assign({}, f, C.familyUpdateForInvoice(f, inv));
  assert.equal(C.familyRewardsLeft(used), 0);
  const back = C.familyUpdateForVoid(used, inv);
  assert.equal(back.credit, 10);
  assert.equal(C.familyRewardsLeft(Object.assign({}, used, back)), 50);
  // An invoice that used no reward changes no rewards.
  assert.equal('rewards' in C.familyUpdateForVoid(used, { id: 'other', creditUsed: 0 }), false);
  // Recording the same invoice twice never uses a reward twice.
  const twice = C.rewardsAfterUse(used.rewards, inv.rewardUses, inv.id, inv.period);
  assert.equal(twice[0].uses.length, 1);
});

test('custom invoices never touch rewards', () => {
  const f = Object.assign(tan(), { rewards: [{ id: 'r1', kind: 'referrer', amount: 50, confirmedAt: '2026-11-19' }] });
  const d = C.blankCustomInvoice({ family: f, today: '2026-12-01', settings: {}, schedule: SCHEDULE, tag: 'ABCDE' });
  assert.equal((d.lines || []).some(l => l.kind === 'reward'), false);
});

test('bookings through a link are matched to the family who referred and to the new family', () => {
  const t = tan(), l = lim();
  const bookings = [
    { id: 'b1', referralCode: 'k7m2qx', kind: 'enrol', childName: 'Child lim', parentName: 'Lim', email: 'LIM@example.test', createdAtMs: 3 },
    { id: 'b2', referralCode: 'ZZZ9ZZ', kind: 'trial', childName: 'Someone', email: 'x@example.test', createdAtMs: 2 },
    { id: 'b3', referralCode: 'K7M2QX', kind: 'diagnostic', studentName: 'Nobody', email: 'tan@example.test', referralStatus: 'dismissed', createdAtMs: 1 },
    { id: 'b4', kind: 'trial', childName: 'No code' },
    { id: 'b5', referralCode: 'TAN2AA', kind: 'trial', childName: 'By bank code', whatsapp: '+65 9123 4567', createdAtMs: 4 }
  ];
  const rows = C.referralBookings(bookings, [t, l]);
  assert.deepEqual(rows.map(r => [r.id, r.state]), [['b5', 'waiting'], ['b1', 'waiting'], ['b2', 'unknown'], ['b3', 'dismissed']]);
  const b1 = rows.find(r => r.id === 'b1');
  assert.equal(b1.referrer.id, 'tan');
  assert.equal(b1.friend.id, 'lim', 'matched by email, whatever its case');
  assert.equal(b1.kind, 'Enrolment');
  assert.equal(rows.find(r => r.id === 'b5').friend.id, 'lim', 'matched by WhatsApp');
  assert.equal(rows.find(r => r.id === 'b5').referrer.id, 'tan', 'the family\'s PayNow code works as a referral code too');
  assert.equal(rows.find(r => r.id === 'b3').friend, null, 'a family booking through its own link is not its own friend');
  // Once confirmed, the booking reads as confirmed.
  const plan = C.referralPlan(t, l, { ids: ['a', 'b'], bookingId: 'b1', today: '2026-11-19' });
  const t2 = Object.assign({}, t, { rewards: plan.referrerRewards }), l2 = Object.assign({}, l, { rewards: plan.friendRewards, referredBy: plan.referredBy });
  assert.equal(C.referralBookings(bookings, [t2, l2]).find(r => r.id === 'b1').state, 'confirmed');
  const done = C.confirmedReferrals([t2, l2]);
  assert.equal(done.length, 1);
  assert.equal(done[0].referrer.id, 'tan');
  assert.equal(done[0].friend.id, 'lim');
  assert.equal(done[0].friendReward.id, 'b');
  const stats = C.referralStats([t2, l2], C.referralBookings(bookings, [t2, l2]));
  assert.equal(stats.confirmed, 1);
  assert.equal(stats.left, 100);
  assert.equal(stats.given, 0);
});

test('a referral can be undone until a reward reaches an invoice', () => {
  const plan = C.referralPlan(tan(), lim(), { ids: ['a', 'b'], bookingId: 'b1', today: '2026-11-19' });
  const t = Object.assign(tan(), { rewards: plan.referrerRewards }), l = Object.assign(lim(), { rewards: plan.friendRewards, referredBy: plan.referredBy });
  const undo = C.undoReferralPlan(t, l, 'a');
  assert.equal(undo.ok, true);
  assert.deepEqual(undo.referrerRewards, []);
  assert.deepEqual(undo.friendRewards, []);
  assert.equal(undo.clearReferredBy, true);
  assert.equal(undo.bookingId, 'b1');
  const inv = C.buildInvoice(l, '2026-12', { schedule: SCHEDULE, settings: {}, today: '2026-12-01' });
  const lUsed = Object.assign({}, l, C.familyUpdateForInvoice(l, inv));
  assert.match(C.undoReferralPlan(t, lUsed, 'a').problems.join(' '), /already on an invoice/);
  assert.equal(C.undoReferralPlan(t, l, 'nope').ok, false);
});

test('the link email: the family\'s own link, both rewards, a WhatsApp share, nothing unescaped', () => {
  const f = Object.assign(tan(), { parentName: 'Tan <b>Mei</b> Ling' });
  const m = C.referralEmail(f, { referralReward: 50, referralFriendReward: 50 });
  assert.match(m.subject, /\$50\.00 off for every friend who joins/);
  assert.ok(m.html.includes('https://polymathlc.com.sg/schedule/?ref=K7M2QX'));
  assert.ok(m.html.includes('Tan &lt;b&gt;Mei&lt;/b&gt; Ling'));
  assert.ok(!m.html.includes('<b>Mei</b>'));
  assert.match(m.html, /you both get <b>\$50\.00 off<\/b>/);
  assert.match(m.html, /https:\/\/wa\.me\/\?text=/);
  assert.match(m.text, /K7M2QX/);
  const diff = C.referralEmail(tan(), { referralReward: 80, referralFriendReward: 30 });
  assert.match(diff.text, /you get \$80\.00 off your next month's fees, and your friend gets \$30\.00 off theirs/);
  assert.match(C.referralShareText(tan(), { referralFriendReward: 30 }), /\?ref=K7M2QX.*\$30\.00 off your fees/);
  const thanks = C.referralConfirmedEmail(tan(), { kind: 'referrer', amount: 50, otherName: 'Lim Wei Jie\'s family' }, {});
  assert.match(thanks.subject, /\$50\.00 off your next invoice/);
  assert.match(thanks.text, /introducing Lim Wei Jie's family/);
  const welcome = C.referralConfirmedEmail(lim(), { kind: 'friend', amount: 40, otherName: 'Tan Mei Ling\'s family' }, {});
  assert.match(welcome.subject, /^Welcome to Polymath/);
});
