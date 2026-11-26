// 🗺️ Robux Quest Board — the pure logic (no DOM, no Firebase).
//
// polymathlc.com.sg/cc is Zhi Kai's family quest board for Caius and Caris.
// Dad adds quests, each worth some Robux, for one child or both. When a quest
// is done he marks it Success (the reward is earned) or Failed (nothing is
// earned, and the quest's optional penalty is taken off). When he pays Robux
// out he records a redemption, so
//
//     balance = earned from successful quests + bonuses − penalties − redeemed
//
// This file is loaded by the page (cc/index.html, as an ES module) and by the
// offline tests (tools/cc-quests-tests.mjs), so both always agree on the maths.
//
// Data (Firestore, project mathgen--app; rules in tools/cc-rules.mjs):
//   ccQuests/{id}   { title, details, icon, category, reward, penalty, kids: ['caius','caris'],
//                     results: { caius: { status, at, note }, caris: {…} },
//                     due: 'YYYY-MM-DD' | '', repeat: '' | 'daily' | 'weekly',
//                     archived: bool, createdAt, updatedAt, createdBy }
//   ccLedger/{id}   { kid, type: 'redeem' | 'bonus' | 'penalty', amount (> 0), note, at, by }
//   ccSettings/main { goals: { caius: { amount, label }, caris: {…} } }

export const VERSION = '1.0.0';

export const CC_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);

export const KIDS = Object.freeze([
  Object.freeze({
    id: 'caius', name: 'Caius', title: 'Gas Fruit Master', power: 'Gas',
    tagline: 'Turns into living smoke. Nothing can hold him.',
    colors: Object.freeze({ main: '#8b5cf6', deep: '#4c1d95', glow: '#c4b5fd', accent: '#2dd4bf' })
  }),
  Object.freeze({
    id: 'caris', name: 'Caris', title: 'Kitsune Spirit', power: 'Kitsune',
    tagline: 'Nine tails of blue fox-fire light her way.',
    colors: Object.freeze({ main: '#3b82f6', deep: '#1e3a8a', glow: '#bae6fd', accent: '#f472b6' })
  })
]);
export const KID_IDS = Object.freeze(KIDS.map(k => k.id));
export const kidById = id => KIDS.find(k => k.id === id) || null;

export const STATUSES = Object.freeze(['open', 'success', 'failed']);

export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'study', label: 'Study', icon: '📚' }),
  Object.freeze({ id: 'chores', label: 'Chores', icon: '🧹' }),
  Object.freeze({ id: 'health', label: 'Health & sport', icon: '🏃' }),
  Object.freeze({ id: 'kindness', label: 'Kindness', icon: '💛' }),
  Object.freeze({ id: 'habit', label: 'Good habit', icon: '⏰' }),
  Object.freeze({ id: 'challenge', label: 'Challenge', icon: '🏆' }),
  Object.freeze({ id: 'other', label: 'Other', icon: '⭐' })
]);
export const categoryById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

// Ready-made quests for the "Quick add" chips on the admin form.
export const TEMPLATES = Object.freeze([
  { title: 'Finish today\'s homework', category: 'study', reward: 20, icon: '📚' },
  { title: 'Read for 30 minutes', category: 'study', reward: 15, icon: '📖' },
  { title: 'Full marks on a worksheet', category: 'study', reward: 50, icon: '💯' },
  { title: 'Practise spelling / Chinese', category: 'study', reward: 20, icon: '✍️' },
  { title: 'Tidy your room', category: 'chores', reward: 15, icon: '🧹' },
  { title: 'Help with the dishes', category: 'chores', reward: 10, icon: '🍽️' },
  { title: 'Exercise for 30 minutes', category: 'health', reward: 15, icon: '🏃' },
  { title: 'In bed on time all week', category: 'habit', reward: 40, icon: '🛏️' },
  { title: 'No screen time before homework', category: 'habit', reward: 20, icon: '⏰' },
  { title: 'Be kind to your sibling all day', category: 'kindness', reward: 25, icon: '💛' },
  { title: 'Top 3 in a school test', category: 'challenge', reward: 200, icon: '🏆' }
]);

export const LIMITS = Object.freeze({ title: 80, details: 400, note: 160, reward: 100000, goalLabel: 60 });

// Levels: every level needs a little more Robux than the one before
// (100, 150, 200, …). Earned Robux count, so spending never lowers a level.
export function levelFor(earned) {
  let level = 1, need = 100, floor = 0;
  const total = Math.max(0, Math.floor(Number(earned) || 0));
  while (total >= floor + need && level < 99) { floor += need; level += 1; need += 50; }
  return { level, floor, next: floor + need, into: total - floor, need, progress: Math.min(1, (total - floor) / need) };
}

// A title that grows with the level, themed for each power.
const RANKS = {
  caius: ['Smoke Sprout', 'Mist Walker', 'Fog Rider', 'Haze Knight', 'Storm Vapour', 'Gas Lord', 'Toxic Tempest', 'Cloud Emperor', 'Nebula King'],
  caris: ['Little Ember Fox', 'Two-Tail Kit', 'Blue Flame Fox', 'Spirit Dancer', 'Moon Fox', 'Fox-Fire Sage', 'Seven-Tail Queen', 'Celestial Kitsune', 'Nine-Tail Empress']
};
export function rankFor(kid, level) {
  const list = RANKS[kid] || RANKS.caius;
  return list[Math.min(list.length - 1, Math.floor((Math.max(1, level) - 1) / 2))];
}
// How many fox tails Caris's avatar shows (1 → 9 as she levels up).
export const tailsFor = level => Math.max(1, Math.min(9, Math.ceil(Math.max(1, level) / 2)));

/* ============================== Helpers ============================== */
export const toInt = (v, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};
export const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanMultiline = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

// Firestore Timestamp, Date, millis or ISO string → millis (0 when unknown).
export function millis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function formatRobux(n) {
  const v = toInt(n);
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-SG');
}

// Singapore time (the family's time zone) for dates and "today".
export const TZ = 'Asia/Singapore';
export function sgDate(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return p; // YYYY-MM-DD
}
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
export function formatDay(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}
export function formatWhen(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-SG', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
// "due today", "due tomorrow", "2 days late"…
export function dueLabel(due, today = sgDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return { text: '', tone: '' };
  const diff = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  if (diff === 0) return { text: 'Due today', tone: 'soon' };
  if (diff === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (diff > 1) return { text: diff <= 6 ? `Due in ${diff} days` : 'Due ' + formatDay(due), tone: '' };
  return { text: diff === -1 ? '1 day late' : `${-diff} days late`, tone: 'late' };
}

/* ============================== Quests ============================== */
export function normaliseQuest(raw, id = raw?.id || '') {
  const r = raw || {};
  const kids = Array.isArray(r.kids) ? KID_IDS.filter(k => r.kids.includes(k)) : [];
  const results = {};
  for (const kid of kids) {
    const res = (r.results && r.results[kid]) || {};
    results[kid] = {
      status: STATUSES.includes(res.status) ? res.status : 'open',
      at: millis(res.at),
      note: cleanText(res.note, LIMITS.note)
    };
  }
  const category = categoryById(r.category).id;
  return {
    id: String(id),
    title: cleanText(r.title, LIMITS.title) || 'Untitled quest',
    details: cleanMultiline(r.details, LIMITS.details),
    icon: cleanText(r.icon, 8) || categoryById(category).icon,
    category,
    reward: Math.max(0, Math.min(LIMITS.reward, toInt(r.reward))),
    penalty: Math.max(0, Math.min(LIMITS.reward, toInt(r.penalty))),
    kids,
    results,
    due: /^\d{4}-\d{2}-\d{2}$/.test(r.due || '') ? r.due : '',
    repeat: ['daily', 'weekly'].includes(r.repeat) ? r.repeat : '',
    archived: r.archived === true,
    createdAt: millis(r.createdAt),
    updatedAt: millis(r.updatedAt)
  };
}

// The fields the admin form sends, checked before they are written.
export function validateQuestInput(input) {
  const errors = [];
  const title = cleanText(input?.title, LIMITS.title);
  if (!title) errors.push('Give the quest a name.');
  const reward = toInt(input?.reward, NaN);
  if (!Number.isFinite(reward) || reward < 0) errors.push('The reward must be 0 Robux or more.');
  else if (reward > LIMITS.reward) errors.push(`The reward can be at most ${LIMITS.reward.toLocaleString()} Robux.`);
  const penalty = input?.penalty === '' || input?.penalty == null ? 0 : toInt(input.penalty, NaN);
  if (!Number.isFinite(penalty) || penalty < 0) errors.push('The penalty must be 0 Robux or more.');
  else if (penalty > LIMITS.reward) errors.push('That penalty is too big.');
  const kids = Array.isArray(input?.kids) ? KID_IDS.filter(k => input.kids.includes(k)) : [];
  if (!kids.length) errors.push('Choose who the quest is for.');
  const due = String(input?.due || '');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) errors.push('The due date is not a date.');
  const repeat = ['daily', 'weekly'].includes(input?.repeat) ? input.repeat : '';
  if (repeat && !due) errors.push('A repeating quest needs a due date to repeat from.');
  const category = categoryById(input?.category).id;
  return {
    ok: errors.length === 0,
    errors,
    value: {
      title, reward: Number.isFinite(reward) ? reward : 0, penalty: Number.isFinite(penalty) ? penalty : 0, kids, due, repeat, category,
      details: cleanMultiline(input?.details, LIMITS.details),
      icon: cleanText(input?.icon, 8) || categoryById(category).icon
    }
  };
}

// Results for a quest's children, keeping any outcome already recorded for a
// child who stays on the quest (so editing a quest never loses a result).
export function mergeResults(kids, previous = {}) {
  const out = {};
  for (const kid of kids) {
    const p = previous[kid];
    out[kid] = p && STATUSES.includes(p.status) ? { status: p.status, at: p.at || 0, note: p.note || '' } : { status: 'open', at: 0, note: '' };
  }
  return out;
}

// The next copy of a repeating quest once a child's result is in.
export function nextRepeatDue(quest) {
  if (!quest.repeat || !quest.due) return '';
  return addDays(quest.due, quest.repeat === 'daily' ? 1 : 7);
}
export function isQuestSettled(quest) {
  return quest.kids.length > 0 && quest.kids.every(k => quest.results[k] && quest.results[k].status !== 'open');
}

/* ============================== Ledger ============================== */
export const LEDGER_TYPES = Object.freeze({
  redeem: Object.freeze({ label: 'Robux paid out', sign: -1, icon: '🎁' }),
  bonus: Object.freeze({ label: 'Bonus', sign: 1, icon: '✨' }),
  penalty: Object.freeze({ label: 'Penalty', sign: -1, icon: '⚠️' })
});

export function normaliseLedger(raw, id = raw?.id || '') {
  const r = raw || {};
  return {
    id: String(id),
    kid: KID_IDS.includes(r.kid) ? r.kid : '',
    type: LEDGER_TYPES[r.type] ? r.type : 'redeem',
    amount: Math.max(0, Math.min(LIMITS.reward, toInt(r.amount))),
    note: cleanText(r.note, LIMITS.note),
    at: millis(r.at)
  };
}

export function validateLedgerInput(input, balance = Infinity) {
  const errors = [];
  const kid = KID_IDS.includes(input?.kid) ? input.kid : '';
  if (!kid) errors.push('Choose a child.');
  const type = LEDGER_TYPES[input?.type] ? input.type : '';
  if (!type) errors.push('Choose what kind of entry this is.');
  const amount = toInt(input?.amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Enter how many Robux (more than 0).');
  else if (amount > LIMITS.reward) errors.push('That is too many Robux for one entry.');
  if (type === 'redeem' && Number.isFinite(amount) && amount > balance && !input?.allowOverdraw)
    errors.push(`Only ${formatRobux(balance)} Robux are available to redeem.`);
  return { ok: errors.length === 0, errors, value: { kid, type, amount: Number.isFinite(amount) ? amount : 0, note: cleanText(input?.note, LIMITS.note) } };
}

/* ============================== Totals ============================== */
export function emptyStats() {
  return { earned: 0, bonus: 0, penalty: 0, failedPenalty: 0, redeemed: 0, balance: 0, success: 0, failed: 0, open: 0, streak: 0, best: 0, successRate: 0 };
}

// Every child's totals from the quests and the ledger.
export function computeStats(quests, ledger) {
  const stats = Object.fromEntries(KID_IDS.map(k => [k, emptyStats()]));
  const outcomes = Object.fromEntries(KID_IDS.map(k => [k, []]));
  for (const q of quests) {
    for (const kid of q.kids) {
      const res = q.results[kid];
      if (!res) continue;
      const s = stats[kid];
      if (res.status === 'success') { s.success += 1; s.earned += q.reward; outcomes[kid].push({ at: res.at || q.updatedAt, ok: true }); }
      else if (res.status === 'failed') { s.failed += 1; s.failedPenalty += q.penalty; outcomes[kid].push({ at: res.at || q.updatedAt, ok: false }); }
      else if (!q.archived) s.open += 1;
    }
  }
  for (const e of ledger) {
    const s = stats[e.kid];
    if (!s) continue;
    if (e.type === 'redeem') s.redeemed += e.amount;
    else if (e.type === 'bonus') s.bonus += e.amount;
    else if (e.type === 'penalty') s.penalty += e.amount;
  }
  for (const kid of KID_IDS) {
    const s = stats[kid];
    s.balance = s.earned + s.bonus - s.penalty - s.failedPenalty - s.redeemed;
    const done = s.success + s.failed;
    s.successRate = done ? s.success / done : 0;
    // Streak: successes in a row, most recent first; best: the longest run ever.
    const list = outcomes[kid].sort((a, b) => a.at - b.at);
    let run = 0, best = 0;
    for (const o of list) { run = o.ok ? run + 1 : 0; best = Math.max(best, run); }
    s.streak = run;
    s.best = best;
    s.lifetime = s.earned + s.bonus;
  }
  return stats;
}

// One time-ordered history for a child (or everyone): quest outcomes plus
// ledger entries, each with its signed Robux change, newest first.
export function buildHistory(quests, ledger, kid = '') {
  const rows = [];
  for (const q of quests) {
    for (const k of q.kids) {
      if (kid && k !== kid) continue;
      const res = q.results[k];
      if (!res || res.status === 'open') continue;
      const ok = res.status === 'success';
      rows.push({
        key: `q:${q.id}:${k}`, kind: 'quest', kid: k, at: res.at || q.updatedAt, questId: q.id,
        icon: q.icon, title: q.title, status: res.status, note: res.note,
        delta: ok ? q.reward : -q.penalty
      });
    }
  }
  for (const e of ledger) {
    if (kid && e.kid !== kid) continue;
    if (!e.kid) continue;
    const t = LEDGER_TYPES[e.type];
    rows.push({ key: `l:${e.id}`, kind: 'ledger', kid: e.kid, at: e.at, ledgerId: e.id, icon: t.icon,
      title: e.note || t.label, type: e.type, status: e.type, delta: t.sign * e.amount });
  }
  rows.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  return rows;
}

// Robux earned per week for the last `weeks` weeks (oldest first), for the chart.
export function weeklyEarned(history, kid, weeks = 8, now = Date.now()) {
  const WEEK = 7 * 86400000;
  const out = Array.from({ length: weeks }, (_, i) => ({ start: now - (weeks - i) * WEEK, end: now - (weeks - i - 1) * WEEK, earned: 0, spent: 0 }));
  for (const r of history) {
    if (kid && r.kid !== kid) continue;
    const bucket = out.find(b => r.at > b.start && r.at <= b.end);
    if (!bucket) continue;
    if (r.delta > 0) bucket.earned += r.delta; else bucket.spent += -r.delta;
  }
  return out;
}

export function goalProgress(goal, balance) {
  const amount = Math.max(0, toInt(goal?.amount));
  if (!amount) return null;
  return { amount, label: cleanText(goal?.label, LIMITS.goalLabel) || 'Savings goal', progress: Math.max(0, Math.min(1, balance / amount)), left: Math.max(0, amount - balance) };
}

// The order quests appear on the board: open quests first (overdue, then due
// soonest, then newest), then settled ones, newest result first.
export function sortQuests(quests, kid = '') {
  const pending = q => (kid ? [kid] : q.kids).some(k => q.results[k]?.status === 'open');
  const lastAt = q => Math.max(0, ...q.kids.map(k => q.results[k]?.at || 0));
  return [...quests].sort((a, b) => {
    const pa = pending(a), pb = pending(b);
    if (pa !== pb) return pa ? -1 : 1;
    if (pa) {
      const da = a.due || '9999-99-99', dbb = b.due || '9999-99-99';
      if (da !== dbb) return da < dbb ? -1 : 1;
      return b.createdAt - a.createdAt;
    }
    return lastAt(b) - lastAt(a) || b.createdAt - a.createdAt;
  });
}

export function isAdminEmail(email, verified = true) {
  return !!verified && CC_ADMINS.includes(String(email || '').toLowerCase());
}
