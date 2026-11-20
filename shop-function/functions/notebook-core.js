'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   📒 THE MISTAKE NOTEBOOK — the rules (notebook-core.js v1.0.0)

   Zhi Kai, 20 Nov 2026: "implement mistake notebook" — every question a child
   gets wrong in worksheets and live lessons is collected automatically, then
   served back as a short weekly "redo your mistakes" quiz. The promise to
   parents: "We make sure the same mistake never happens twice."

   WHERE THE MISTAKES COME FROM (nothing here is guessed or generated):
     • WORKSHEETS — Study Buddy (polymathlc/tutor) marks a child's worksheet and
       files every wrong, partly right or skipped question in the account's own
       mistake book, users/{uid}/mistakes/{id} (the question's words, its
       options, the right option or answer, the explanation, what the child
       wrote and a picture of the question in Storage under tutor-mistakes/).
       The Science portal writes a different kind of entry into the same
       collection (practice questions by bank id, no wording); those are left
       to the Science app's own "Learn from mistakes" page and skipped here.
     • LIVE LESSONS — Ans Key's live class (polymathlc/anskey) keeps the whole
       lesson in the teacher's tree, users/{teacher}/liveClass/{epoch}: every
       question pushed, every answer, and the TEACHER's own mark (✓ ◐ ✗). Only
       a teacher's mark counts, exactly as in the parent's report: a
       provisional key or AI mark never puts a question in the notebook. Which
       lessons a child was in comes from the teacher's progress book
       (users/{teacher}/liveClassProgress/main).

   Each mistake is COPIED into the child's notebook the first time it is seen
   (mistakeNotebook/{key}), so it stays even after the progress book has
   rolled past that lesson or the worksheet was started afresh.

   THE LIFE OF A MISTAKE
       open      — got wrong (or partly right, or skipped) and not yet redone
       fixed     — redone and right once. It comes back once more as a
                   CHECK-UP in a weekly quiz at least CHECKUP_DAYS later
       mastered  — right again at the check-up. That is "never twice".
     A fixed mistake redone wrong goes back to open.

   THE WEEKLY QUIZ is worked out ON READ, never by a timer (the deploy
   account cannot make Cloud Scheduler jobs): the first time the child opens
   the notebook in a Singapore week (Monday to Sunday) the week's quiz is
   picked and kept, so it stays the same all week. QUIZ_SIZE questions at
   most: mistakes redone wrong last time first, then the ones never redone
   (oldest first), then the check-ups that are due.

   MARKING A REDO, honestly:
     • multiple choice with a known right option → ✓ or ✗ straight away;
     • a short answer or a fill-in-the-keywords answer that matches the key
       (generous on case, spaces, "the", units the key does not name) → ✓;
     • anything else — a different wording, a written answer — shows the
       answer and the child says whether theirs was the same. A written
       answer cannot be judged fairly by a string compare, and a wrong ✗ on a
       right answer is exactly what makes a child stop trying.

   PURE: no Firebase, no network. notebook.js (the HTTP door) and
   notebook-store.js (Firestore and Storage) call these; test/notebook.test.js
   runs every rule offline.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = '1.0.0';
const QUIZ_SIZE = 8;
const QUIZ_CHECKUPS_MAX = 3;          // check-ups in one week's quiz, at most
const CHECKUP_DAYS = 14;              // a fixed mistake is checked again this long after
const KEEP_ITEMS = 400;               // mistakes kept per child (mastered ones go first)
const KEEP_WEEKS = 12;                // weekly quizzes remembered
const KEEP_TRIES = 6;                 // redos remembered per mistake
const DAY_MS = 24 * 3600000;
const SG_OFFSET_MS = 8 * 3600000;     // Singapore has no daylight saving
const KINDS = Object.freeze(['mcq', 'blank', 'cloze', 'open']);
const SOURCES = Object.freeze(['live', 'worksheet']);
const VERDICTS = Object.freeze(['wrong', 'partial', 'skipped']);
const STATUSES = Object.freeze(['open', 'fixed', 'mastered']);
const LIMITS = Object.freeze({
  text: 1200, option: 200, options: 8, accepted: 8, answer: 1500, explain: 1500, yours: 700,
  where: 120, topic: 80, gaps: 8, gap: 120, parts: 80, name: 60, value: 600, id: 140
});
const IMAGE_PATH = /^tutor-mistakes\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.(?:jpg|jpeg|png|webp)$/;
const ROSTER_ID = /^[A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60}$/;
const ACCOUNT_KEY = /^u-[A-Za-z0-9]{1,128}$/;
const ITEM_ID = /^[LW]-[A-Za-z0-9_-]{1,136}$/;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ─────────────────────────── text ─────────────────────────── */
function str(v) { return v == null ? '' : String(v); }
function oneLine(v, max) { return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function paragraph(v, max) {
  return str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function letter(i) { return String.fromCharCode(65 + i); }
function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object' && typeof value._seconds === 'number') return value._seconds * 1000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}
function subjectOf(...words) {
  const w = words.map(x => str(x).toLowerCase()).join(' ');
  if (/scien/.test(w)) return 'science';
  if (/math/.test(w)) return 'math';
  return '';
}
function levelOf(v) {
  const s = str(v).trim();
  const m = /^(?:p|pri|primary)\s*([1-6])$/i.exec(s);
  if (m) return 'P' + m[1];
  const n = /^(?:s|sec|secondary)\s*([1-5])$/i.exec(s);
  if (n) return 'S' + n[1];
  return /^[A-Za-z0-9 ]{1,12}$/.test(s) ? s.toUpperCase() : '';
}

/* ─────────────────────────── Singapore weeks ─────────────────────────── */
// The Monday (Singapore time) of the week `now` falls in, as YYYY-MM-DD.
function weekKey(now) {
  const d = new Date(Number(now) + SG_OFFSET_MS);
  const back = (d.getUTCDay() + 6) % 7;          // Monday → 0 … Sunday → 6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return monday.toISOString().slice(0, 10);
}
function weekLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(key));
  if (!m) return '';
  return 'Week of ' + Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
}
// When this week's quiz turns into next week's: the next Monday 00:00 in Singapore.
function weekEndsAt(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(key));
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 7) - SG_OFFSET_MS;
}
function sgDay(ms) {
  ms = Number(ms) || 0;
  if (!ms) return '';
  const d = new Date(ms + SG_OFFSET_MS);
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

/* ─────────────────────────── marking a short answer ───────────────────────────
   The same rule as Ans Key's live class (live-class.js normAnswer / blankMatches),
   so an answer the class accepted is accepted here too: generous on what a child
   cannot see as different (case, spaces, a full stop, "the"), exact on the word
   or the number. "0.5", ".5" and "1/2" are one number; "3 cm" matches a key of
   "3" only when the key names no unit. */
function normAnswer(s) {
  return oneLine(s, 200).toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[.!?;:,]+$/, '')
    .replace(/\s*([+\-×x*÷/=])\s*/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
function numberOf(s) {
  let m = /^([+-]?\d+)\s+(\d+)\/(\d+)$/.exec(str(s).trim());
  if (m && Number(m[3]) !== 0) return Number(m[1]) + (/^-/.test(m[1]) ? -1 : 1) * Number(m[2]) / Number(m[3]);
  const t = str(s).replace(/,(?=\d{3}\b)/g, '').replace(/\s+/g, '');
  m = /^([+-]?\d+)\/(\d+)$/.exec(t);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  return null;
}
function splitUnit(s) {
  const m = /^\s*([+-]?[\d.,/ ]*\d)\s*([a-z°%$¢µ²³/]+[a-z0-9²³]*)?\s*$/i.exec(str(s));
  if (!m) return null;
  const n = numberOf(m[1]);
  return n == null ? null : { n, unit: (m[2] || '').toLowerCase() };
}
function blankMatches(accepted, value) {
  const v = normAnswer(value);
  if (!v) return false;
  for (const raw of Array.isArray(accepted) ? accepted : []) {
    const a = normAnswer(raw);
    if (!a) continue;
    if (a === v) return true;
    const na = splitUnit(a), nv = splitUnit(v);
    if (na && nv && Math.abs(na.n - nv.n) <= 1e-9 * Math.max(1, Math.abs(na.n))) {
      if (!na.unit || na.unit === nv.unit) return true;
    }
  }
  return false;
}

/* ─────────────────────────── one mistake, cleaned ───────────────────────────
   THE ONE SHAPE every mistake is kept in, whatever it came from:
     { id, src, at, where, sub, lvl, topic, kind, text, options, parts, img,
       yours, verdict, key: { answer, accepted, keys, model, explain } }
   `key` is the answer: it never leaves the server for a mistake that is still
   open, until the child has had a go at it (or asked to see it). */
function cleanKey(kind, k) {
  const key = k && typeof k === 'object' ? k : {};
  const out = {};
  if (kind === 'mcq') {
    const a = Math.floor(Number(key.answer));
    out.answer = Number.isFinite(a) && a >= 0 && a < LIMITS.options ? a : -1;
  }
  if (kind === 'blank') {
    out.accepted = (Array.isArray(key.accepted) ? key.accepted : []).map(a => oneLine(a, LIMITS.option)).filter(Boolean).slice(0, LIMITS.accepted);
  }
  if (kind === 'cloze') {
    out.keys = (Array.isArray(key.keys) ? key.keys : []).slice(0, LIMITS.gaps)
      .map(g => (Array.isArray(g) ? g : g != null ? [g] : []).map(w => oneLine(w, LIMITS.gap)).filter(Boolean).slice(0, LIMITS.accepted));
  }
  const model = paragraph(key.model, LIMITS.answer);
  if (model) out.model = model;
  const explain = paragraph(key.explain, LIMITS.explain);
  if (explain) out.explain = explain;
  return out;
}
function cleanParts(parts) {
  if (!Array.isArray(parts)) return null;
  const out = [];
  let gaps = 0;
  for (const p of parts.slice(0, LIMITS.parts)) {
    if (typeof p === 'number') {
      const k = Math.floor(p);
      if (k >= 0 && k < LIMITS.gaps && gaps < LIMITS.gaps) { out.push(k); gaps++; }
    } else {
      const t = paragraph(p, LIMITS.text);
      if (t) out.push(str(p).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').slice(0, LIMITS.text));
    }
  }
  return gaps ? out : null;
}
function cleanImg(img) {
  if (!img || typeof img !== 'object') return null;
  if (img.t === 'live' && /^[A-Za-z0-9]{1,128}$/.test(str(img.u)) && /^\d{1,16}$/.test(str(img.e)) && /^[A-Za-z0-9_-]{1,64}$/.test(str(img.r))) {
    return { t: 'live', u: str(img.u), e: str(img.e), r: str(img.r) };
  }
  if (img.t === 'storage' && IMAGE_PATH.test(str(img.p))) return { t: 'storage', p: str(img.p) };
  return null;
}
function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  if (!ITEM_ID.test(id)) return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : '';
  if (!kind) return null;
  const out = {
    id, src: SOURCES.includes(raw.src) ? raw.src : (id[0] === 'L' ? 'live' : 'worksheet'),
    at: Math.max(0, millis(raw.at)), where: oneLine(raw.where, LIMITS.where),
    sub: ['math', 'science'].includes(raw.sub) ? raw.sub : '', lvl: levelOf(raw.lvl), topic: oneLine(raw.topic, LIMITS.topic),
    kind, text: paragraph(raw.text, LIMITS.text),
    yours: paragraph(raw.yours, LIMITS.yours),
    verdict: VERDICTS.includes(raw.verdict) ? raw.verdict : 'wrong'
  };
  if (kind === 'mcq') {
    const opts = (Array.isArray(raw.options) ? raw.options : []).map(o => oneLine(o, LIMITS.option)).slice(0, LIMITS.options);
    while (opts.length && !opts[opts.length - 1]) opts.pop();
    if (opts.length < 2) return null;
    out.options = opts.map((o, i) => o || letter(i));
  }
  if (kind === 'cloze') {
    const parts = cleanParts(raw.parts);
    if (!parts) return null;
    out.parts = parts;
  }
  const img = cleanImg(raw.img);
  if (img) out.img = img;
  if (!out.text && !out.img && kind !== 'cloze') return null;
  out.key = cleanKey(kind, raw.key);
  return out;
}

/* ─────────────────────────── from Study Buddy (worksheets) ─────────────────────────── */
// users/{uid}/mistakes/{docId} as fileMistakes() in the tutor app writes it.
// Science-portal entries (qId, no wording) are not worksheet questions: null.
function fromWorksheet(docId, m) {
  if (!m || typeof m !== 'object' || !/^[A-Za-z0-9_-]{1,120}$/.test(str(docId))) return null;
  if (m.qId != null && m.docId == null) return null;               // a Science portal practice entry
  if (!m.docId && !m.docName) return null;
  if (m.cleared === true) return null;                              // the child cleared it in Study Buddy
  const question = paragraph(m.question, LIMITS.text);
  const opts = (Array.isArray(m.options) ? m.options : []).filter(o => o && typeof o === 'object').slice(0, LIMITS.options);
  const answer = paragraph(m.answer, LIMITS.answer);
  const explain = paragraph(m.explanation, LIMITS.explain);
  let kind, options, key;
  if (m.type === 'mcq' && opts.length >= 2) {
    kind = 'mcq';
    options = opts.map(o => oneLine(o.text, LIMITS.option) || oneLine(o.label, 8));
    const want = oneLine(m.option, 8).replace(/[().\s]/g, '').toLowerCase();
    const idx = opts.findIndex(o => oneLine(o.label, 8).replace(/[().\s]/g, '').toLowerCase() === want && want);
    key = { answer: idx, model: answer, explain };
  } else if (answer && answer.length <= 60 && !/\n/.test(answer)) {
    // A short final answer ("24 cm²", "evaporation"): checked against the key,
    // and when it does not match the child is shown it and asked.
    kind = 'blank';
    key = { accepted: [answer], model: answer, explain };
  } else {
    kind = 'open';
    key = { model: answer, explain };
  }
  const number = oneLine(m.number, 12);
  const where = oneLine(m.docName, 80) || 'Worksheet';
  const imgPath = str(m.imagePath);
  let yours = paragraph(m.studentAnswer, LIMITS.yours);
  if (kind === 'mcq' && yours && opts.length) {
    const pick = yours.replace(/[().\s]/g, '').toLowerCase();
    const hit = opts.findIndex(o => oneLine(o.label, 8).replace(/[().\s]/g, '').toLowerCase() === pick);
    if (hit >= 0) yours = '(' + oneLine(opts[hit].label, 8) + ') ' + options[hit];
  }
  return cleanItem({
    id: 'W-' + docId, src: 'worksheet', at: millis(m.createdAt) || millis(m.at),
    where: where + (number ? ' · Q' + number : ''),
    sub: subjectOf(m.subject), lvl: m.level, topic: m.topic || m.sylTopic,
    kind, text: question, options,
    img: IMAGE_PATH.test(imgPath) ? { t: 'storage', p: imgPath } : null,
    yours: m.skipped === true ? '' : yours,
    verdict: m.skipped === true ? 'skipped' : (m.verdict === 'partial' ? 'partial' : 'wrong'),
    key
  });
}

/* ─────────────────────────── from a live lesson ─────────────────────────── */
function meantFor(q, identity) {
  return !!q && (q.to === 'all' || q.to == null || (Array.isArray(q.to) && q.to.includes(identity)));
}
function clozeText(parts, words) {
  return (parts || []).map(p => typeof p !== 'number' ? str(p) : '[' + ((Array.isArray(words) ? oneLine(words[p], LIMITS.gap) : '') || '___') + ']').join('');
}
function liveAnswerText(q, entry) {
  if (!entry) return '';
  const v = entry.v;
  let text = '';
  if (q.kind === 'mcq') {
    const i = Number(v);
    text = Array.isArray(q.options) && q.options[i] != null && v !== null && v !== '' ? letter(i) + '. ' + q.options[i] : '';
  } else if (q.kind === 'cloze') {
    text = Array.isArray(v) ? clozeText(q.parts, v) : '';
  } else {
    text = str(v);
  }
  if (entry.ph) text = (text ? text + '\n' : '') + '(you also sent a photo of your working)';
  return text;
}
// Every question in ONE lesson the teacher marked ✗ or ◐ for this child.
// session: the lesson record (its `json`, parsed); teacher: the teacher's uid.
function fromLiveSession(session, identity, teacher) {
  const out = [];
  if (!session || typeof session !== 'object' || !Array.isArray(session.questions)) return out;
  const epoch = Math.floor(Number(session.epoch)) || 0;
  if (!(epoch > 0) || !/^[rg]:[A-Za-z0-9_-]{1,128}$/.test(str(identity))) return out;
  const answers = session.answers && typeof session.answers === 'object' ? session.answers : {};
  const label = oneLine(session.slotLabel || session.slot, 60);
  const day = sgDay(Number(session.startedAt) || epoch);
  for (const q of session.questions) {
    if (!q || typeof q !== 'object' || !/^[A-Za-z0-9_-]{1,64}$/.test(str(q.id)) || !meantFor(q, identity)) continue;
    const entry = (answers[q.id] || {})[identity];
    if (!entry || typeof entry !== 'object') continue;
    // ONLY the teacher's own mark counts (live-class.js confirmedOf): never a
    // provisional key or AI mark, and never a ✓.
    const mark = entry.ok === false ? 'wrong' : entry.ok === 'partial' ? 'partial' : '';
    if (!mark) continue;
    const kind = KINDS.includes(q.kind) ? q.kind : '';
    if (!kind) continue;
    const key = kind === 'mcq' ? { answer: q.answer, model: '' }
      : kind === 'blank' ? { accepted: q.accepted, model: (q.accepted || [])[0] || '' }
      : kind === 'cloze' ? { keys: q.keys, model: q.model }
      : { model: q.model };
    const item = cleanItem({
      id: 'L-' + epoch + '-' + q.id, src: 'live', at: Number(entry.at) || Number(q.at) || epoch,
      where: 'Live lesson' + (day ? ' · ' + day : '') + (label ? ' · ' + label : ''),
      sub: subjectOf(label, session.subject), lvl: '', topic: '',
      kind, text: q.text, options: q.options, parts: q.parts,
      img: q.img && q.img.ref ? { t: 'live', u: teacher, e: String(epoch), r: q.img.ref } : null,
      yours: liveAnswerText(q, entry), verdict: mark, key
    });
    if (item) out.push(item);
  }
  return out;
}
// The lessons a child (identity) was in, from every teacher's progress book:
// [{ teacher, epoch }], newest first. book: { students: { identity: { rows: [{ e }] } } }.
function lessonsInBooks(books, identity) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(books) ? books : []) {
    const teacher = str(b && b.teacher);
    const book = b && b.book;
    const st = book && book.students && book.students[identity];
    if (!/^[A-Za-z0-9]{1,128}$/.test(teacher) || !st || !Array.isArray(st.rows)) continue;
    for (const row of st.rows) {
      const e = Math.floor(Number(row && row.e)) || 0;
      if (!(e > 0) || seen.has(teacher + '/' + e)) continue;
      seen.add(teacher + '/' + e);
      out.push({ teacher, epoch: e, asked: Number(row.q) || 0, marked: Number(row.k) || 0 });
    }
  }
  return out.sort((a, b) => b.epoch - a.epoch);
}

/* ─────────────────────────── the child's notebook (state) ─────────────────────────── */
function emptyState() { return { v: 1, items: {}, log: {}, weeks: {} }; }
function cleanLog(x) {
  const l = x && typeof x === 'object' ? x : {};
  const tries = (Array.isArray(l.tries) ? l.tries : []).filter(t => Array.isArray(t) && t.length >= 2)
    .map(t => [Math.max(0, Number(t[0]) || 0), t[1] ? 1 : 0, t[2] === 'quiz' ? 'quiz' : 'redo']).slice(-KEEP_TRIES);
  return {
    n: Math.max(0, Math.floor(Number(l.n) || 0)), tries,
    fixedAt: Math.max(0, Number(l.fixedAt) || 0), masteredAt: Math.max(0, Number(l.masteredAt) || 0),
    peekAt: Math.max(0, Number(l.peekAt) || 0), back: Math.max(0, Math.floor(Number(l.back) || 0)),
    hidden: l.hidden === true
  };
}
function cleanState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = emptyState();
  const items = s.items && typeof s.items === 'object' ? s.items : {};
  Object.keys(items).forEach(id => { const it = cleanItem(items[id]); if (it && it.id === id) out.items[id] = it; });
  const log = s.log && typeof s.log === 'object' ? s.log : {};
  Object.keys(log).forEach(id => { if (out.items[id]) out.log[id] = cleanLog(log[id]); });
  const weeks = s.weeks && typeof s.weeks === 'object' ? s.weeks : {};
  Object.keys(weeks).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-KEEP_WEEKS).forEach(k => {
    const w = weeks[k] || {};
    const ids = (Array.isArray(w.ids) ? w.ids : []).map(str).filter(id => ITEM_ID.test(id)).slice(0, QUIZ_SIZE);
    const done = {};
    const d = w.done && typeof w.done === 'object' ? w.done : {};
    ids.forEach(id => { if (d[id] === 1 || d[id] === 0) done[id] = d[id]; });
    out.weeks[k] = { ids, done, at: Math.max(0, Number(w.at) || 0), checkups: (Array.isArray(w.checkups) ? w.checkups : []).map(str).filter(id => ids.includes(id)) };
  });
  return out;
}
function statusOf(log) {
  const l = log || {};
  if (l.masteredAt) return 'mastered';
  if (l.fixedAt) return 'fixed';
  return 'open';
}
// Puts the mistakes just read from the sources into the notebook. A mistake
// already there keeps its history; its words are refreshed (a teacher may have
// corrected the key). Returns { state, added: [ids] }.
function mergeItems(state, items) {
  const s = cleanState(state);
  const added = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const it = cleanItem(raw);
    if (!it) continue;
    if (!s.items[it.id]) added.push(it.id);
    s.items[it.id] = it;
  }
  return { state: trimState(s), added };
}
// Never more than KEEP_ITEMS: mastered mistakes go first (oldest first), then
// fixed ones; an open mistake is only dropped when the notebook is all open.
function trimState(s) {
  const ids = Object.keys(s.items);
  if (ids.length <= KEEP_ITEMS) return s;
  const rank = id => ({ mastered: 0, fixed: 1, open: 2 })[statusOf(s.log[id])];
  ids.sort((a, b) => rank(a) - rank(b) || s.items[a].at - s.items[b].at);
  ids.slice(0, ids.length - KEEP_ITEMS).forEach(id => { delete s.items[id]; delete s.log[id]; });
  return s;
}

/* ─────────────────────────── the weekly quiz ─────────────────────────── */
// A stable shuffle: the same child, week and mistake always land in the same
// place, so a reload never reorders the quiz.
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pickQuiz(state, week, now, seed) {
  const s = state;
  const salt = str(seed) + '|' + week;
  const live = Object.keys(s.items).filter(id => !(s.log[id] && s.log[id].hidden));
  const lastWrong = id => { const t = (s.log[id] || {}).tries || []; return t.length && !t[t.length - 1][1] ? 1 : 0; };
  const open = live.filter(id => statusOf(s.log[id]) === 'open')
    .sort((a, b) => lastWrong(b) - lastWrong(a)
      || ((s.log[a] || {}).n || 0) - ((s.log[b] || {}).n || 0)
      || s.items[a].at - s.items[b].at
      || hashOf(salt + a) - hashOf(salt + b));
  const due = live.filter(id => statusOf(s.log[id]) === 'fixed' && now - s.log[id].fixedAt >= CHECKUP_DAYS * DAY_MS)
    .sort((a, b) => s.log[a].fixedAt - s.log[b].fixedAt || hashOf(salt + a) - hashOf(salt + b));
  const checkups = due.slice(0, Math.min(QUIZ_CHECKUPS_MAX, QUIZ_SIZE));
  const ids = open.slice(0, QUIZ_SIZE - checkups.length).concat(checkups);
  // Room left (few open mistakes): more check-ups, then nothing.
  for (const id of due) { if (ids.length >= QUIZ_SIZE) break; if (!ids.includes(id)) { ids.push(id); checkups.push(id); } }
  // Mixed so the check-ups are not all at the end; still stable.
  ids.sort((a, b) => hashOf(salt + a) - hashOf(salt + b));
  return { ids, checkups };
}
// This week's quiz, picked the first time the notebook is opened this week and
// kept all week. Returns { state, week, changed }.
function ensureWeek(state, now, seed) {
  const s = cleanState(state);
  const week = weekKey(now);
  if (s.weeks[week]) return { state: s, week, changed: false };
  const pick = pickQuiz(s, week, now, seed);
  s.weeks[week] = { ids: pick.ids, done: {}, at: now, checkups: pick.checkups };
  const keys = Object.keys(s.weeks).sort();
  keys.slice(0, Math.max(0, keys.length - KEEP_WEEKS)).forEach(k => { delete s.weeks[k]; });
  return { state: s, week, changed: true };
}
// A quiz picked before any mistake had been collected is empty; once the
// notebook has something in it, that empty week is filled in (at most once).
function refillWeek(state, now, seed) {
  const s = cleanState(state);
  const week = weekKey(now);
  const w = s.weeks[week];
  if (!w || w.ids.length || Object.keys(w.done).length) return { state: s, changed: false };
  const pick = pickQuiz(s, week, now, seed);
  if (!pick.ids.length) return { state: s, changed: false };
  s.weeks[week] = { ids: pick.ids, done: {}, at: now, checkups: pick.checkups };
  return { state: s, changed: true };
}

/* ─────────────────────────── marking and recording a redo ─────────────────────────── */
// true / false when it can be told, null when the child must compare with the answer.
function check(item, value) {
  if (!item) return null;
  const key = item.key || {};
  if (item.kind === 'mcq') {
    if (!(key.answer >= 0)) return null;
    const i = Math.floor(Number(value));
    if (value === null || value === '' || !Number.isFinite(i)) return false;
    return i === key.answer;
  }
  if (item.kind === 'blank') {
    if (!key.accepted || !key.accepted.length) return null;
    return blankMatches(key.accepted, value) ? true : null;
  }
  if (item.kind === 'cloze') {
    const gaps = (item.parts || []).filter(p => typeof p === 'number').length;
    if (!gaps || !Array.isArray(value) || !Array.isArray(key.keys)) return null;
    for (let g = 0; g < gaps; g++) {
      if (!key.keys[g] || !key.keys[g].length || !blankMatches(key.keys[g], value[g])) return null;
    }
    return true;
  }
  return null;
}
function cleanValue(item, value) {
  if (!item) return null;
  if (item.kind === 'mcq') {
    const i = Math.floor(Number(value));
    return Number.isFinite(i) && i >= 0 && i < (item.options || []).length ? i : null;
  }
  if (item.kind === 'cloze') {
    if (!Array.isArray(value)) return null;
    const words = value.slice(0, LIMITS.gaps).map(w => oneLine(w, LIMITS.gap));
    return words.some(Boolean) ? words : null;
  }
  const t = paragraph(value, LIMITS.value);
  return t || null;
}
// One redo: right (true) or not (false). `how` is 'quiz' for this week's quiz.
function record(state, id, right, now, how) {
  const s = cleanState(state);
  if (!s.items[id]) return { state: s, status: '', changed: false };
  const l = cleanLog(s.log[id]);
  const before = statusOf(l);
  l.n += 1;
  l.tries = l.tries.concat([[now, right ? 1 : 0, how === 'quiz' ? 'quiz' : 'redo']]).slice(-KEEP_TRIES);
  if (right) {
    if (!l.fixedAt) l.fixedAt = now;
    else if (!l.masteredAt && now - l.fixedAt >= CHECKUP_DAYS * DAY_MS) l.masteredAt = now;
  } else if (before !== 'open') {
    // Got it wrong again after it was fixed (or even mastered): back to open.
    l.fixedAt = 0; l.masteredAt = 0; l.back += 1;
  }
  s.log[id] = l;
  const week = weekKey(now);
  const w = s.weeks[week];
  if (w && w.ids.includes(id) && !(id in w.done)) w.done[id] = right ? 1 : 0;
  return { state: s, status: statusOf(l), before, changed: true };
}
function peek(state, id, now) {
  const s = cleanState(state);
  if (!s.items[id]) return { state: s, changed: false };
  const l = cleanLog(s.log[id]);
  if (!l.peekAt) l.peekAt = now;
  s.log[id] = l;
  return { state: s, changed: true };
}
function setHidden(state, id, hidden) {
  const s = cleanState(state);
  if (!s.items[id]) return { state: s, changed: false };
  const l = cleanLog(s.log[id]);
  l.hidden = !!hidden;
  s.log[id] = l;
  return { state: s, changed: true };
}

/* ─────────────────────────── what the page is sent ─────────────────────────── */
function publicKey(item) {
  const k = item.key || {};
  const out = {};
  if (item.kind === 'mcq' && k.answer >= 0) { out.answer = k.answer; out.answerText = letter(k.answer) + '. ' + (item.options || [])[k.answer]; }
  if (item.kind === 'blank' && k.accepted && k.accepted.length) out.accepted = k.accepted.slice();
  if (item.kind === 'cloze' && Array.isArray(k.keys)) {
    out.keys = k.keys.map(g => g.slice());
    out.full = (item.parts || []).map(p => typeof p === 'number' ? ((k.keys[p] && k.keys[p][0]) || '___') : str(p)).join('');
  }
  if (k.model) out.model = k.model;
  if (k.explain) out.explain = k.explain;
  out.known = !!(out.answerText || out.accepted || out.keys || out.model);
  return out;
}
// One mistake as the page shows it. The answer goes with it only when the
// mistake is fixed or mastered, or the child already had a go this time.
function publicItem(item, log, reveal) {
  const l = cleanLog(log);
  const status = statusOf(l);
  const out = {
    id: item.id, src: item.src, at: item.at, where: item.where, sub: item.sub, lvl: item.lvl, topic: item.topic,
    kind: item.kind, text: item.text, yours: item.yours, verdict: item.verdict, image: !!item.img,
    status, tries: l.n, last: l.tries.length ? (l.tries[l.tries.length - 1][1] ? 'right' : 'wrong') : '',
    fixedAt: l.fixedAt, masteredAt: l.masteredAt, back: l.back, hidden: l.hidden,
    checkupDue: status === 'fixed' ? l.fixedAt + CHECKUP_DAYS * DAY_MS : 0
  };
  if (item.options) out.options = item.options.slice();
  if (item.parts) out.parts = item.parts.slice();
  if (reveal || status !== 'open') out.key = publicKey(item);
  return out;
}
function statsOf(state, week) {
  const s = state;
  const ids = Object.keys(s.items).filter(id => !(s.log[id] && s.log[id].hidden));
  const count = st => ids.filter(id => statusOf(s.log[id]) === st).length;
  const w = s.weeks[week] || { ids: [], done: {} };
  const doneIds = Object.keys(w.done);
  const fixedThisWeek = ids.filter(id => {
    const l = s.log[id];
    return l && l.fixedAt && weekKey(l.fixedAt) === week;
  }).length;
  // Weeks in a row (ending with this one or the last) whose whole quiz was done.
  let streak = 0;
  const keys = Object.keys(s.weeks).sort().reverse();
  for (let i = 0; i < keys.length; i++) {
    const wk = s.weeks[keys[i]];
    const complete = wk.ids.length > 0 && wk.ids.every(id => id in wk.done);
    if (complete) streak++;
    else if (!(i === 0 && keys[i] === week)) break;     // this week not finished YET does not break it
  }
  return {
    total: ids.length, open: count('open'), fixed: count('fixed'), mastered: count('mastered'),
    live: ids.filter(id => s.items[id].src === 'live').length, worksheet: ids.filter(id => s.items[id].src === 'worksheet').length,
    weekSize: w.ids.length, weekDone: doneIds.length, weekRight: doneIds.filter(id => w.done[id] === 1).length,
    fixedThisWeek, streak
  };
}
function publicWeek(state, week) {
  const w = state.weeks[week] || { ids: [], done: {}, checkups: [] };
  return {
    key: week, label: weekLabel(week), endsAt: weekEndsAt(week),
    ids: w.ids.filter(id => state.items[id]), done: Object.assign({}, w.done), checkups: (w.checkups || []).slice()
  };
}
function publicNotebook(state, week, opts) {
  const o = opts || {};
  const items = Object.keys(state.items).map(id => publicItem(state.items[id], state.log[id], false))
    .sort((a, b) => b.at - a.at);
  return { items, week: publicWeek(state, week), stats: statsOf(state, week), version: VERSION, sources: o.sources || null };
}

module.exports = {
  VERSION, QUIZ_SIZE, QUIZ_CHECKUPS_MAX, CHECKUP_DAYS, KEEP_ITEMS, KEEP_WEEKS, LIMITS, KINDS, STATUSES,
  ROSTER_ID, ACCOUNT_KEY, ITEM_ID, IMAGE_PATH,
  oneLine, paragraph, millis, subjectOf, levelOf,
  weekKey, weekLabel, weekEndsAt, sgDay,
  normAnswer, numberOf, splitUnit, blankMatches,
  cleanItem, cleanKey, cleanImg, fromWorksheet, fromLiveSession, lessonsInBooks, liveAnswerText,
  emptyState, cleanState, cleanLog, statusOf, mergeItems, trimState,
  hashOf, pickQuiz, ensureWeek, refillWeek,
  check, cleanValue, record, peek, setHidden,
  publicKey, publicItem, statsOf, publicWeek, publicNotebook
};
