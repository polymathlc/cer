// Offline checks for the /cc Robux Quest Board: the Robux maths (earned,
// penalties, payouts, balance, streaks, levels), the form checks, the
// avatars, that the page stays private (noindex, not in the sitemap, not
// linked from the site), and the Firestore rules patch for its collections.
//
//   node --test tools/cc-quests-tests.mjs
import './cc-arcade-tests.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as C from '../cc/cc-core.mjs';
import { ARCADE_VERSION } from '../cc/cc-arcade-core.mjs';
import { caiusAvatar, carisAvatar, avatarFor, coinSvg } from '../cc/cc-avatars.mjs';
import { addCcRules, CC_RULE, CC_COLLECTIONS, CC_ADMINS, ccRuleTests, ccPreservedTests, publishCcRules } from './cc-rules.mjs';
import { addTrialRules } from './trial-rules.mjs';
import { addShopGuardRules } from './shopguard-rules.mjs';
import { addOfficeRules } from './office-rules.mjs';
import { addEnquiryRules } from './enquiry-rules.mjs';
import { addOnlineRules } from './online-rules.mjs';
import { addCsRules } from './cs-rules.mjs';

const root = new URL('..', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');
const page = read('cc/index.html');

/* ============================== Helpers ============================== */
const T0 = Date.UTC(2026, 10, 20, 2); // 20 Nov 2026, 10 am in Singapore
const H = 3600000;
function quest(id, extra = {}) {
  return C.normaliseQuest({ title: 'Q ' + id, reward: 50, kids: ['caius', 'caris'], results: {}, createdAt: T0, ...extra }, id);
}
const res = (status, at) => ({ status, at, note: '' });

/* ============================== The maths ============================== */
test('balance = quest rewards + bonuses − penalties − failed-quest penalties − payouts', () => {
  const quests = [
    quest('a', { reward: 100, results: { caius: res('success', T0), caris: res('failed', T0 + H) }, penalty: 20 }),
    quest('b', { reward: 30, kids: ['caius'], results: { caius: res('success', T0 + 2 * H) } }),
    quest('c', { reward: 40, kids: ['caris'], results: { caris: res('open', 0) } }),
    quest('d', { reward: 70, kids: ['caris'], results: { caris: res('success', T0 + 3 * H) }, archived: true })
  ];
  const ledger = [
    C.normaliseLedger({ kid: 'caius', type: 'redeem', amount: 80, at: T0 + 5 * H }, 'l1'),
    C.normaliseLedger({ kid: 'caius', type: 'bonus', amount: 15, at: T0 + 6 * H }, 'l2'),
    C.normaliseLedger({ kid: 'caris', type: 'penalty', amount: 5, at: T0 + 7 * H }, 'l3'),
    C.normaliseLedger({ kid: 'nobody', type: 'bonus', amount: 999 }, 'l4')
  ];
  const s = C.computeStats(quests, ledger);
  assert.equal(s.caius.earned, 130);
  assert.equal(s.caius.redeemed, 80);
  assert.equal(s.caius.bonus, 15);
  assert.equal(s.caius.balance, 130 + 15 - 80);
  assert.equal(s.caius.success, 2);
  assert.equal(s.caius.failed, 0);
  assert.equal(s.caius.lifetime, 145);
  // Caris: the archived success still counts; the open quest is "to do".
  assert.equal(s.caris.earned, 70);
  assert.equal(s.caris.failedPenalty, 20);
  assert.equal(s.caris.penalty, 5);
  assert.equal(s.caris.balance, 70 - 20 - 5);
  assert.equal(s.caris.open, 1);
  assert.equal(s.caris.success, 1);
  assert.equal(s.caris.failed, 1);
  assert.equal(s.caris.successRate, 0.5);
});

test('streaks count successes in a row, and the best run is kept', () => {
  const at = i => T0 + i * H;
  const quests = [
    quest('1', { kids: ['caius'], results: { caius: res('success', at(1)) } }),
    quest('2', { kids: ['caius'], results: { caius: res('success', at(2)) } }),
    quest('3', { kids: ['caius'], results: { caius: res('success', at(3)) } }),
    quest('4', { kids: ['caius'], results: { caius: res('failed', at(4)) } }),
    quest('5', { kids: ['caius'], results: { caius: res('success', at(5)) } }),
    quest('6', { kids: ['caius'], results: { caius: res('success', at(6)) } })
  ];
  const s = C.computeStats(quests, []);
  assert.equal(s.caius.streak, 2);
  assert.equal(s.caius.best, 3);
  assert.equal(s.caris.streak, 0);
});

test('levels need 100, then 150, 200 … Robux, and Caris grows a tail every two levels', () => {
  assert.deepEqual([0, 99, 100, 249, 250, 449, 450].map(n => C.levelFor(n).level), [1, 1, 2, 2, 3, 3, 4]);
  const lv = C.levelFor(175);
  assert.equal(lv.level, 2); assert.equal(lv.into, 75); assert.equal(lv.need, 150); assert.equal(lv.next, 250);
  assert.ok(lv.progress > 0.49 && lv.progress < 0.51);
  assert.equal(C.levelFor(-50).level, 1);
  assert.equal(C.levelFor(1e9).level, 99, 'levels stop at 99');
  assert.deepEqual([1, 2, 3, 4, 5, 17, 18, 40].map(C.tailsFor), [1, 1, 2, 2, 3, 9, 9, 9]);
  assert.equal(C.rankFor('caris', 1), 'Little Ember Fox');
  assert.equal(C.rankFor('caris', 99), 'Nine-Tail Empress');
  assert.equal(C.rankFor('caius', 1), 'Smoke Sprout');
});

test('history: one timeline, newest first, with signed Robux changes; open quests are left out', () => {
  const quests = [
    quest('a', { reward: 100, penalty: 10, results: { caius: res('success', T0 + H), caris: res('failed', T0 + 2 * H) } }),
    quest('b', { reward: 30, kids: ['caius'], results: { caius: res('open', 0) } })
  ];
  const ledger = [C.normaliseLedger({ kid: 'caius', type: 'redeem', amount: 60, note: 'Game pass', at: T0 + 3 * H }, 'l1')];
  const all = C.buildHistory(quests, ledger);
  assert.deepEqual(all.map(r => [r.kid, r.delta]), [['caius', -60], ['caris', -10], ['caius', 100]]);
  assert.equal(all[0].title, 'Game pass');
  assert.deepEqual(C.buildHistory(quests, ledger, 'caris').map(r => r.delta), [-10]);
  const weeks = C.weeklyEarned(all, 'caius', 4, T0 + 4 * H);
  assert.equal(weeks.length, 4);
  assert.equal(weeks[3].earned, 100);
  assert.equal(weeks[3].spent, 60);
});

test('sorting: open quests first (late, then soonest due), then finished ones newest first', () => {
  const qs = [
    quest('done-old', { results: { caius: res('success', T0), caris: res('success', T0) } }),
    quest('open-nodue', { createdAt: T0 + 5 }),
    quest('open-late', { due: '2026-11-01' }),
    quest('open-soon', { due: '2026-11-21' }),
    quest('done-new', { results: { caius: res('failed', T0 + 9 * H), caris: res('success', T0 + 8 * H) } })
  ];
  assert.deepEqual(C.sortQuests(qs).map(q => q.id), ['open-late', 'open-soon', 'open-nodue', 'done-new', 'done-old']);
  // For one child, a quest the other child still has open is "finished" for this one.
  const half = quest('half', { results: { caius: res('success', T0 + H), caris: res('open', 0) } });
  assert.deepEqual(C.sortQuests([half, qs[1]], 'caius').map(q => q.id), ['open-nodue', 'half']);
});

test('due labels are worked out in Singapore days', () => {
  assert.equal(C.dueLabel('2026-11-20', '2026-11-20').text, 'Due today');
  assert.equal(C.dueLabel('2026-11-21', '2026-11-20').text, 'Due tomorrow');
  assert.equal(C.dueLabel('2026-11-23', '2026-11-20').text, 'Due in 3 days');
  assert.equal(C.dueLabel('2026-11-19', '2026-11-20').tone, 'late');
  assert.equal(C.dueLabel('2026-11-17', '2026-11-20').text, '3 days late');
  assert.equal(C.dueLabel('', '2026-11-20').text, '');
  // 11:30 pm UTC on the 20th is already the 21st in Singapore.
  assert.equal(C.sgDate(Date.UTC(2026, 10, 20, 23, 30)), '2026-11-21');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
});

/* ============================== Forms ============================== */
test('a new quest needs a name, a child and a reward of 0 or more', () => {
  const bad = C.validateQuestInput({ title: '  ', reward: -5, kids: [], due: 'soon' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
  const good = C.validateQuestInput({ title: '  Read   20 min ', reward: '25', penalty: '', kids: ['caris', 'hacker'], due: '2026-11-30', repeat: 'weekly', category: 'nope' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.kids, ['caris']);
  assert.equal(good.value.title, 'Read 20 min');
  assert.equal(good.value.reward, 25);
  assert.equal(good.value.penalty, 0);
  assert.equal(good.value.category, 'other');
  assert.equal(good.value.icon, '⭐');
  assert.equal(C.validateQuestInput({ title: 'x', reward: 1, kids: ['caius'], repeat: 'daily' }).ok, false, 'a repeat needs a due date');
  assert.equal(C.validateQuestInput({ title: 'x', reward: 100001, kids: ['caius'] }).ok, false);
});

test('a payout cannot be more than the balance unless it is an advance', () => {
  assert.equal(C.validateLedgerInput({ kid: 'caius', type: 'redeem', amount: 50 }, 40).ok, false);
  assert.equal(C.validateLedgerInput({ kid: 'caius', type: 'redeem', amount: 50, allowOverdraw: true }, 40).ok, true);
  assert.equal(C.validateLedgerInput({ kid: 'caius', type: 'bonus', amount: 50 }, 0).ok, true);
  assert.equal(C.validateLedgerInput({ kid: 'caius', type: 'redeem', amount: 0 }, 100).ok, false);
  assert.equal(C.validateLedgerInput({ kid: 'x', type: 'gift', amount: 5 }, 100).errors.length, 2);
});

test('editing a quest keeps the results of children still on it', () => {
  const merged = C.mergeResults(['caius'], { caius: res('success', 5), caris: res('failed', 6) });
  assert.deepEqual(merged, { caius: { status: 'success', at: 5, note: '' } });
  assert.deepEqual(C.mergeResults(['caris']), { caris: { status: 'open', at: 0, note: '' } });
});

test('repeating quests roll on by a day or a week', () => {
  assert.equal(C.nextRepeatDue(quest('r', { repeat: 'daily', due: '2026-11-30' })), '2026-12-01');
  assert.equal(C.nextRepeatDue(quest('r', { repeat: 'weekly', due: '2026-11-30' })), '2026-12-07');
  assert.equal(C.nextRepeatDue(quest('r', { repeat: '', due: '2026-11-30' })), '');
  assert.equal(C.isQuestSettled(quest('s', { results: { caius: res('success', 1), caris: res('open', 0) } })), false);
  assert.equal(C.isQuestSettled(quest('s', { results: { caius: res('success', 1), caris: res('failed', 2) } })), true);
});

test('normalising never trusts stored data', () => {
  const q = C.normaliseQuest({ title: '<b>x</b>'.repeat(40), reward: '1e9', penalty: -4, kids: ['caius', 'caius', 'evil'], results: { caius: { status: 'won' } }, due: 'tomorrow', repeat: 'hourly' }, 'id1');
  assert.equal(q.title.length, C.LIMITS.title);
  assert.equal(q.reward, C.LIMITS.reward);
  assert.equal(q.penalty, 0);
  assert.deepEqual(q.kids, ['caius']);
  assert.equal(q.results.caius.status, 'open');
  assert.equal(q.due, '');
  assert.equal(q.repeat, '');
  assert.equal(C.millis({ seconds: 2, nanoseconds: 5e6 }), 2005);
  assert.equal(C.millis({ toMillis: () => 7 }), 7);
  assert.equal(C.formatRobux(-1234), '−1,234');
});

test('only verified admin emails may change the board, and the page and rules agree on who', () => {
  assert.equal(C.isAdminEmail(C.CC_ADMINS[0].toUpperCase(), true), true);
  assert.equal(C.isAdminEmail(C.CC_ADMINS[0], false), false);
  assert.equal(C.isAdminEmail('someone@example.com', true), false);
  assert.deepEqual([...C.CC_ADMINS], [...CC_ADMINS]);
});

/* ============================== Avatars ============================== */
test('avatar badges use distinct ids, Caius wears his Gas Knight form and Caris shows her tails', () => {
  const a = caiusAvatar({ uid: 'one' }), b = caiusAvatar({ uid: 'two' });
  assert.match(a, /^<svg[^>]+viewBox="0 0 200 200"/);
  assert.ok(a.includes('id="cgone-bg"') && b.includes('id="cgtwo-bg"'));
  const portrait = './assets/caius-form.webp?v=' + ARCADE_VERSION;
  assert.deepEqual([...a.matchAll(/<image\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]), [portrait]);
  const mini = avatarFor('caius', { uid: 'mini', level: 99, animate: false });
  assert.ok(mini.includes('href="' + portrait + '"') && !mini.includes('@keyframes'));
  assert.equal((mini.match(/class="cgmini-wisp"/g) || []).length, 10);
  assert.equal((a.match(/class="cgone-wisp"/g) || []).length, 4);
  assert.ok(a.includes('(prefers-reduced-motion: no-preference)'), 'animate only when motion is enabled');
  for (const n of [1, 5, 9]) {
    const svg = carisAvatar({ uid: 't' + n, tails: n, animate: false });
    assert.equal((svg.match(/fill="url\(#kft\d-tail\)"/g) || []).length, n, `${n} tails`);
    assert.ok(!svg.includes('<animate'), 'still picture when animate is false');
  }
  assert.ok(carisAvatar({ uid: 'z', tails: 40 }).match(/-tail\)"/g).length === 9, 'never more than nine tails');
  assert.ok(avatarFor('caris', { uid: 'q' }).includes('Kitsune'));
  assert.ok(avatarFor('caius', { uid: 'q' }).includes('Gas'));
  assert.ok(coinSvg().includes('R$'));
});

/* ============================== The page ============================== */
test('the page is private: noindex, not in the sitemap, not linked from the site', () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.ok(!read('sitemap.xml').includes('/cc/'), 'not in the sitemap');
  const linking = [];
  const walk = dir => {
    for (const name of readdirSync(new URL(dir || '.', root))) {
      if (['.git', 'node_modules', 'cc', 'tools', '.github', 'vendor', 'assets', 'docs'].includes(name)) continue;
      const rel = dir ? dir + '/' + name : name;
      const st = statSync(new URL(rel, root));
      if (st.isDirectory()) { if (rel.split('/').length < 3) walk(rel); continue; }
      if (!/\.(html|js|mjs|xml|txt)$/.test(name)) continue;
      const text = readFileSync(new URL(rel, root), 'utf8');
      if (/href=["'][^"']*\/cc\/?["'#]|polymathlc\.com\.sg\/cc\b/.test(text)) linking.push(rel);
    }
  };
  walk('');
  assert.deepEqual(linking, []);
});

test('the page loads its logic as modules and uses the shared Firebase project', () => {
  assert.ok(page.includes("from './cc-core.mjs?v=" + C.VERSION + "'"), 'the core import carries the version');
  assert.ok(page.includes("from './cc-avatars.mjs?v=" + ARCADE_VERSION + "'"));
  assert.ok(page.includes('projectId: "mathgen--app"'));
  for (const name of CC_COLLECTIONS) {
    if (name === 'ccSettings') assert.ok(page.includes("collection('ccSettings').doc('main')"));
    else assert.ok(page.includes(`collection('${name}')`), name);
  }
  assert.ok(page.includes('C.isAdminEmail(user.email, user.emailVerified)'), 'admin mode follows the verified email');
  assert.ok(!/localStorage\.setItem\('cc_(?!tab|kid)/.test(page), 'browser storage only keeps the view');
});

/* ============================== Rules ============================== */
const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isLiveServerPath() {
      return request.path[3] in ['cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'];
    }
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`;
const live = addTrialRules(addShopGuardRules(addOfficeRules(addCsRules(addOnlineRules(addEnquiryRules(original))))));
const PREDICATE = ' && !isPolymathCcPath()';

test('rules: one block and one predicate, on every shape of the catch-all', () => {
  for (const source of [original, live]) {
    const updated = addCcRules(source);
    assert.notEqual(updated, source);
    assert.equal(updated.replace(CC_RULE, '').replace(PREDICATE + ';', ';'), source);
    assert.match(updated, /&& !isPolymathCcPath\(\);\n    \}/);
    assert.ok(updated.includes(CC_RULE + '    match /{document=**} {'));
    assert.equal(addCcRules(updated), updated, 'installing twice changes nothing');
  }
  for (const name of CC_COLLECTIONS) {
    assert.ok(CC_RULE.includes("'" + name + "'"));
    assert.ok(CC_RULE.includes(`match /${name}/{ccDoc=**}`));
  }
  for (const email of CC_ADMINS) assert.ok(CC_RULE.includes("'" + email + "'"));
  assert.ok(CC_RULE.includes("get('email_verified', false) == true"));
});

test('rules: the other tools still install over ours, and ours over theirs', () => {
  const ours = addCcRules(addEnquiryRules(original));
  const theirs = addTrialRules(addShopGuardRules(addOfficeRules(addCsRules(addOnlineRules(ours)))));
  assert.equal(addCcRules(theirs), theirs);
  assert.ok(theirs.includes('!isPolymathCcPath()'));
  assert.ok(theirs.includes('!isPolymathTrialPath()'));
});

test('rules: unrecognised, partial and duplicate rules fail closed', () => {
  assert.throws(() => addCcRules('nonsense'), /Unrecognized/);
  assert.throws(() => addCcRules(original.replace('allow read, write: if', 'allow read: if')), /catch-all/);
  assert.throws(() => addCcRules(original.replace('match /{document=**}', 'match /ccQuests/{x} { allow read: if true; }\n    match /{document=**}')), /partial/);
  const installed = addCcRules(original);
  assert.throws(() => addCcRules(installed.replace('// END polymath-cc-quests-v1', '// END polymath-cc-quests-v1\n    // BEGIN polymath-cc-quests-v1')), /Ambiguous/);
});

test('rules: everyone may read, only the verified admins may write, look-alikes keep their access', () => {
  const cases = ccRuleTests();
  assert.ok(cases.length >= 100);
  assert.ok(cases.filter(c => c.request.method === 'get' || c.request.method === 'list').every(c => c.expectation === 'ALLOW'));
  const writes = cases.filter(c => ['create', 'update', 'delete'].includes(c.request.method));
  assert.ok(writes.filter(c => c.request.auth?.token?.email_verified && C.isAdminEmail(c.request.auth.token.email)).every(c => c.expectation === 'ALLOW'));
  assert.ok(writes.filter(c => !c.request.auth).every(c => c.expectation === 'DENY'));
  assert.ok(writes.some(c => c.request.auth?.uid === 'cc-test-staff' && c.expectation === 'DENY'), 'staff accounts cannot change the family board');
  assert.ok(writes.some(c => c.request.auth?.uid === 'cc-test-owner-unverified' && c.expectation === 'DENY'));
  const preserved = ccPreservedTests(live);
  assert.ok(preserved.some(c => c.request.path.endsWith('/cc_quests/probe') && c.expectation === 'ALLOW'));
  assert.ok(preserved.some(c => c.request.path.includes('/trialCodes/') && c.expectation === 'DENY'), 'the trial protection is checked too');
});

test('rules: test and read modes never publish; apply publishes once', async () => {
  const calls = [];
  let active = 'projects/mathgen--app/rulesets/abc';
  const request = async (path, options = {}) => {
    calls.push([options.method || 'GET', path]);
    if (path.endsWith('/releases/cloud.firestore') && options.method === 'PATCH') { active = options.body.release.rulesetName; return {}; }
    if (path.endsWith('/releases/cloud.firestore')) return { rulesetName: active, updateTime: 't1' };
    if (path === 'projects/mathgen--app/rulesets/abc') return { source: { files: [{ name: 'firestore.rules', content: live }] } };
    if (path.endsWith(':test')) return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) };
    if (path === 'projects/mathgen--app/rulesets' && options.method === 'POST') {
      assert.ok(options.body.source.files[0].content.includes('polymath-cc-quests-v1'));
      return { name: 'projects/mathgen--app/rulesets/new1' };
    }
    throw new Error('unexpected ' + path);
  };
  const read = await publishCcRules({ request, readOnly: true });
  assert.equal(read.changeNeeded, true);
  const dry = await publishCcRules({ request });
  assert.equal(dry.changed, false);
  assert.ok(dry.validated > 100);
  assert.ok(calls.every(([method, path]) => method === 'GET' || path.endsWith(':test')));
  const applied = await publishCcRules({ request, deploy: true });
  assert.equal(applied.changed, true);
  assert.equal(active, 'projects/mathgen--app/rulesets/new1');
  assert.equal(calls.filter(([m]) => m === 'PATCH').length, 1);
});
