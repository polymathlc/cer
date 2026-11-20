/* ═══════════════════════════════════════════════════════════════════════════
   💬 POLYMATH OFFICE — the Lesson updates tab (lesson-updates.mjs v1.1.0)

   polymathlc.com.sg/office/#lessons. After each lesson, a WhatsApp to every
   parent of the class with what was covered, how their child did and the
   homework — one tap each, from the centre's own WhatsApp:

     • pick the day (today by default) and see each class held that day
     • per class: the worksheet covered and the next one, a homework line
       (and an optional note) typed once for the whole class
     • per family: the message, already written, and a green 💬 Send button
       that opens WhatsApp (phone) or WhatsApp Web (computer) with the text
       typed in. Pressing it marks the family ✓ Sent for that lesson.
     • ▶ Send to everyone: the same WhatsApp queue the invoices use, one
       family after another (Open WhatsApp → send → Next)
     • families with no WhatsApp number are shown, with a link to add one;
       a family can be taken off the list; any message can be edited first

   It extends the office's WhatsApp queue for invoices and payment reminders
   to lesson updates: the same C.whatsappLink, the same "polymath_whatsapp"
   window (so WhatsApp Web opens in one tab, not a new one each time), the
   same Send ▶ Next flow.

   It is a module of its own, loaded after office-app.mjs, and plugs into the
   office through window.PolymathOffice (VIEWS, S, C, render), like the
   Reports tab. Its controls carry data-lu and are wired here. The rules —
   what the message says — are in lesson-updates-core.mjs.

   🙋 v1.1.0 — attendance. Each child shows whether they were in the lesson
   (from the Ans Key live class: officeSettings/attend-<day>, see
   attendance-core.mjs), with ✓ Here / ✗ Absent buttons to correct it by hand.
   An absent child's message says so and how to catch up. During a lesson a
   child who has not joined gets a one-tap "💬 Not joined yet" WhatsApp.

   Reads: onlineCourses (the classes' worksheet lists), pdfAnnotator (the
   worksheets' names only), every teacher's liveClassProgress book (how each
   child did in the Ans Key live lesson), officeSettings/attend-<day>.
   Writes: officeSettings/lessonUpdates, officeSettings/lessonupd-<day> and
   the hand marks and "not joined" taps in officeSettings/attend-<day>.
   ═══════════════════════════════════════════════════════════════════════════ */
import * as L from './lesson-updates-core.mjs?v=1.1.0';
import * as W from './weekly-report-core.mjs?v=1.1.0';
import * as A from './attendance-core.mjs?v=1.0.0';

const LU_UI_VERSION = '1.1.0';
const O = window.PolymathOffice;
const C = O.C;
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;
const FP = firebase.firestore.FieldPath;
const COL = 'officeSettings';
const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const CLOCK = window.PolymathLessonClock || null;
const LIVE_REFRESH_MS = 3 * 60 * 1000;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const R = {
  day: L.sgToday(),
  lu: L.normalizeLu({}), luLoaded: false,
  dayDoc: L.normalizeDay({}), dayLoaded: false, dayError: '',
  att: A.normalizeAttendDay({}), attLoaded: false, attError: '', attUnsub: null,
  courses: [], coursesLoaded: false, coursesError: '',
  docNames: {}, namesAsked: {},
  live: null, liveAt: 0, liveError: '', liveLoading: false,
  open: {},            // key → true: the family's message is shown
  editing: {},         // key → draft text of an edited message
  hwDraft: {},         // slotId → homework draft
  noteDraft: {},       // slotId → note draft
  settingsOpen: false, setDraft: null,
  queue: null,         // { items:[{slotId,key}], i, opened, sent, skipped, title }
  unsubs: [], dayUnsub: null, started: false, timer: 0
};

/* ─── Data ─── */
function rerender() { if (O && typeof O.render === 'function') O.render(); }
function who() { return (O.S.user && O.S.user.email) || ''; }
function toast(msg, kind) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 7000 : 3800);
}
function settingsRef() { return db.collection(COL).doc(L.LU_SETTINGS_DOC); }
function dayRef(day) { return db.collection(COL).doc(L.dayDocId(day || R.day)); }
function attRef(day) { return db.collection(COL).doc(A.attendDocId(day || R.day)); }

function listenDay() {
  if (R.attUnsub) { try { R.attUnsub(); } catch (e) { /* gone */ } }
  R.attLoaded = false; R.attError = ''; R.att = A.normalizeAttendDay({});
  const aday = R.day;
  R.attUnsub = attRef(aday).onSnapshot(d => {
    if (aday !== R.day) return;
    R.att = A.normalizeAttendDay(d.exists ? Object.assign({}, d.data(), { day: aday }) : { day: aday });
    R.attLoaded = true; R.attError = '';
    rerender();
  }, err => { R.attError = (err && err.message) || 'could not be read'; R.attLoaded = true; rerender(); });
  if (R.dayUnsub) { try { R.dayUnsub(); } catch (e) { /* gone */ } }
  R.dayLoaded = false; R.dayError = ''; R.dayDoc = L.normalizeDay({});
  const day = R.day;
  R.dayUnsub = dayRef(day).onSnapshot(d => {
    if (day !== R.day) return;
    R.dayDoc = L.normalizeDay(d.exists ? d.data() : {});
    R.dayLoaded = true; R.dayError = '';
    rerender();
  }, err => { R.dayError = (err && err.message) || 'could not be read'; R.dayLoaded = true; rerender(); });
}
function start() {
  if (R.started) return;
  R.started = true;
  R.unsubs.push(settingsRef().onSnapshot(d => { R.lu = L.normalizeLu(d.exists ? d.data() : {}); R.luLoaded = true; rerender(); },
    err => { console.warn('lesson updates settings', err); R.luLoaded = true; rerender(); }));
  R.unsubs.push(db.collection('onlineCourses').onSnapshot(snap => {
    R.courses = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    R.coursesLoaded = true; R.coursesError = '';
    rerender();
  }, err => { R.coursesError = (err && err.message) || 'could not be read'; R.coursesLoaded = true; rerender(); }));
  listenDay();
  loadLive();
  R.timer = setInterval(() => {
    if (document.hidden || O.S.view !== 'lessons') return;
    if (R.day === L.sgToday() || R.day === L.addDays(L.sgToday(), -1)) loadLive(true);
    else rerender();   // the lesson states move on with the clock
  }, LIVE_REFRESH_MS);
}
function stop() {
  while (R.unsubs.length) { try { R.unsubs.pop()(); } catch (e) { /* gone */ } }
  if (R.dayUnsub) { try { R.dayUnsub(); } catch (e) { /* gone */ } R.dayUnsub = null; }
  if (R.attUnsub) { try { R.attUnsub(); } catch (e) { /* gone */ } R.attUnsub = null; }
  clearInterval(R.timer); R.started = false;
}
/* Every teacher's live-class progress book → { rosterId: rows }. The book may
   be stored as one JSON string (`json`) or as plain fields. */
async function loadLive(quiet) {
  if (R.liveLoading) return;
  R.liveLoading = true;
  if (!quiet) rerender();
  try {
    const snap = await db.collectionGroup('liveClassProgress').get();
    const books = [];
    snap.docs.forEach(d => {
      const x = d.data() || {};
      try { books.push(x.json ? JSON.parse(x.json) : x); } catch (e) { /* a broken book is skipped */ }
    });
    R.live = W.liveRowsByRoster(books);
    R.liveAt = Date.now(); R.liveError = '';
  } catch (e) {
    console.warn('live class progress', e);
    R.liveError = (e && e.message) || 'could not be read';
    if (!R.live) R.live = null;
  }
  R.liveLoading = false;
  rerender();
}
// The names of the worksheets shown (names only), asked for once each.
function askNames(ids) {
  const want = [...new Set(ids.filter(id => id && !(id in R.docNames) && !R.namesAsked[id]))];
  if (!want.length) return;
  want.forEach(id => { R.namesAsked[id] = true; });
  const path = FP.documentId();
  const groups = [];
  for (let i = 0; i < want.length; i += 10) groups.push(want.slice(i, i + 10));
  Promise.all(groups.map(g => db.collection('pdfAnnotator').where(path, 'in', g).get().then(snap => {
    snap.forEach(doc => { R.docNames[doc.id] = String((doc.data() || {}).name || ''); });
  }))).catch(e => console.warn('worksheet names', e)).then(() => {
    want.forEach(id => { if (!(id in R.docNames)) R.docNames[id] = ''; });
    rerender();
  });
}

firebase.auth().onAuthStateChanged(user => {
  setTimeout(function wait(tries) {
    if (!user) { stop(); return; }
    if (O.S.admin) { start(); return; }
    if ((tries || 0) < 40) setTimeout(() => wait((tries || 0) + 1), 250);
  }, 0);
});

/* ─── Working the day out ─── */
function roster() { return C.slotRoster(O.S.families || [], O.S.schedule || { slots: {} }); }
function classes() {
  if (!CLOCK) return [];
  const list = L.dayClasses({
    day: R.day, now: Date.now(), schedule: O.S.schedule || { slots: {} }, roster: roster(), families: O.S.families || [],
    courses: R.courses, docNames: R.docNames, live: R.live, clock: CLOCK, lu: R.lu, dayDoc: R.dayDoc, att: R.att
  });
  askNames(list.flatMap(cl => [cl.ws.covered && cl.ws.covered.id, cl.ws.next && cl.ws.next.id]).filter(Boolean));
  return list;
}
function findFamily(list, slotId, key) {
  const cl = list.find(c => c.slotId === slotId);
  return cl ? { cl, f: cl.families.find(x => x.key === key) } : { cl: null, f: null };
}
function updateCount(list) {
  const el = document.querySelector('[data-count="lessons"]');
  if (!el) return;
  const today = R.day === L.sgToday();
  const n = today ? list.filter(cl => cl.state === 'ending' || cl.state === 'over' || cl.state === 'live').reduce((t, cl) => t + cl.counts.ready, 0) : 0;
  el.textContent = n; el.classList.toggle('hidden', !n);
}

/* ─── The view ─── */
function sentText(s) {
  if (!s) return '';
  const by = s.by ? s.by.split('@')[0] : '';
  return '✓ Sent ' + W.clockText(s.at) + (L.sgToday(s.at) !== R.day ? ' (' + W.dayShort(s.at) + ')' : '') + (by ? ' · ' + by : '');
}
// 🙋 One child's attendance: a pill, and (in the class card) the buttons to correct it.
function attPill(ch) {
  const a = ch.attendance;
  if (!a || a.s === 'unknown' || a.s === 'upcoming') return '';
  const meta = A.STATUS_META[a.s] || A.STATUS_META.unknown;
  return ' <span class="pill ' + meta.pill + ' lu-att" style="padding:1px 7px;">' + meta.icon + ' ' + esc(A.statusWords(a, W.clockText)) + '</span>';
}
function attButtons(cl, ch) {
  const a = ch.attendance;
  if (!a || cl.state === 'upcoming') return '';
  const b = (v, label, on) => '<button class="btn ghost small lu-attbtn' + (on ? ' on' : '') + '" data-lu="attMark" data-s="' + esc(cl.slotId) + '" data-r="' + esc(ch.rosterId) + '" data-v="' + v + '"'
    + ' title="' + (v === 'here' ? 'Mark ' + esc(ch.first) + ' as in the lesson (e.g. on Zoom)' : v === 'absent' ? 'Mark ' + esc(ch.first) + ' as absent' : 'Use what the live class saw') + '">' + label + '</button>';
  return ' <span class="lu-attbtns">' + b('here', '✓ Here', a.how === 'mark' && a.s === 'here') + b('absent', '✗ Absent', a.how === 'mark' && a.s === 'absent')
    + (a.how === 'mark' ? b('', '↺ Auto', false) : '') + '</span>';
}
function childSummary(ch, cl) {
  const att = attPill(ch) + (cl ? attButtons(cl, ch) : '');
  if (ch.absent) return esc(ch.first) + att;
  if (!ch.row) return esc(ch.first) + ' <span class="muted">· no live-lesson record</span>' + att;
  const sc = W.liveScore(ch.row);
  const col = sc == null ? '' : sc >= L.STRONG_PCT ? 'green' : sc >= L.WEAK_PCT ? 'amber' : 'red';
  return esc(ch.first) + ' · ' + (ch.row.q > 0 ? ch.row.a + '/' + ch.row.q + ' answered' : 'in the lesson')
    + (sc != null ? ' <span class="pill ' + col + '" style="padding:1px 7px;">' + sc + '%</span>' : '') + att;
}
// 💬 "Not joined yet": the one-tap WhatsApp during the lesson.
function notJoinedButton(cl, f) {
  if (!f.notJoined || !f.phone || f.optedOut) return '';
  const tapped = f.children.filter(ch => ch.attendance && ch.attendance.wa).length;
  return '<a class="btn small lu-nj" href="' + esc(L.chatLink(f.phone, f.notJoined, !TOUCH)) + '" target="polymath_whatsapp" rel="noopener" data-lu="notJoined" data-s="' + esc(cl.slotId) + '" data-k="' + esc(f.key) + '"'
    + ' title="WhatsApp the parent that their child has not joined yet">⏰ ' + (tapped ? 'Not joined (sent)' : 'Not joined yet') + '</a>';
}
function sendButton(cl, f, big) {
  if (!f.phone) return '';
  const href = L.chatLink(f.phone, f.text, !TOUCH);
  return '<a class="btn wa' + (big ? ' big' : ' small') + '" href="' + esc(href) + '" target="polymath_whatsapp" rel="noopener" data-lu="send" data-s="' + esc(cl.slotId) + '" data-k="' + esc(f.key) + '">💬 ' + (f.sent ? 'Send again' : 'Send') + '</a>';
}
function familyRow(cl, f) {
  const open = !!R.open[f.key];
  const editing = Object.prototype.hasOwnProperty.call(R.editing, f.key);
  const status = f.optedOut ? '<span class="pill grey">Off the list</span>'
    : f.sent ? '<span class="pill green">' + esc(sentText(f.sent)) + '</span>'
      : !f.phone ? '<span class="pill amber">No WhatsApp number</span>' : '';
  let h = '<div class="lu-fam' + (f.sent ? ' sent' : '') + (f.optedOut ? ' off' : '') + '">'
    + '<div class="lu-fam-main">'
    + '<div class="lu-who"><b>' + esc(f.parentName) + '</b>' + (f.phone ? ' <span class="small muted nowrap">' + esc(C.displayPhone(f.phone)) + '</span>' : '')
    + '<div class="small">' + f.children.map(ch => childSummary(ch, cl)).join('<br>') + '</div></div>'
    + '<div class="lu-acts">' + status + notJoinedButton(cl, f)
    + (!f.optedOut && !f.phone ? '<button class="btn ghost small" data-act="openFamily" data-id="' + esc(f.familyId) + '">Add number</button>' : '')
    + '<button class="btn ghost small" data-lu="toggle" data-k="' + esc(f.key) + '">' + (open ? 'Hide' : '👁 Message') + '</button>'
    + (!f.optedOut ? sendButton(cl, f, false) : '')
    + '</div></div>';
  if (open) {
    h += '<div class="lu-msg">';
    if (editing) {
      h += '<textarea rows="12" data-lu-in="edit" data-k="' + esc(f.key) + '" data-keep="lu-edit-' + esc(f.key) + '" maxlength="' + L.MESSAGE_MAX + '">' + esc(R.editing[f.key]) + '</textarea>'
        + '<div class="actions"><button class="btn small" data-lu="saveEdit" data-k="' + esc(f.key) + '">Save message</button><button class="btn ghost small" data-lu="cancelEdit" data-k="' + esc(f.key) + '">Cancel</button></div>';
    } else {
      h += '<pre>' + esc(f.text) + '</pre>'
        + '<div class="actions">'
        + '<button class="btn ghost small" data-lu="edit" data-s="' + esc(cl.slotId) + '" data-k="' + esc(f.key) + '">✏️ Edit this message</button>'
        + (f.edited ? '<button class="btn ghost small" data-lu="resetEdit" data-k="' + esc(f.key) + '">↺ Use the automatic message</button>' : '')
        + '<button class="btn ghost small" data-lu="copy" data-s="' + esc(cl.slotId) + '" data-k="' + esc(f.key) + '">📋 Copy</button>'
        + (f.sent ? '<button class="btn ghost small" data-lu="unsend" data-k="' + esc(f.key) + '">Mark as not sent</button>' : (f.phone && !f.optedOut ? '<button class="btn ghost small" data-lu="markSent" data-k="' + esc(f.key) + '">Mark as sent</button>' : ''))
        + '</div>'
        + (f.edited ? '<div class="small muted" style="margin-top:4px;">You edited this message, so it no longer follows the class\'s homework line or new live results.</div>' : '')
        + (f.absent ? '<div class="small muted" style="margin-top:4px;">🙋 ' + esc(C.listJoin(f.children.filter(c => c.absent).map(c => c.first))) + (f.absent > 1 ? ' were' : ' was') + ' absent, so the message says so and how to catch up. If that is wrong, press ✓ Here beside the name.</div>' : '')
        + (!f.hasLive ? '<div class="small muted" style="margin-top:4px;">No live-lesson record for ' + esc(C.listJoin(f.children.map(c => c.first))) + ' in this lesson, so the message has no "How they did" line. Edit it to add one.</div>' : '');
    }
    h += '<label class="check" style="margin-top:8px;"><input type="checkbox" data-lu="optOut" data-f="' + esc(f.familyId) + '" ' + (f.optedOut ? 'checked' : '') + '> Don\'t send lesson updates to ' + esc(f.parentName) + '</label>';
    h += '</div>';
  }
  return h + '</div>';
}
function classCard(cl) {
  const st = L.STATE_META[cl.state] || L.STATE_META.none;
  const hw = Object.prototype.hasOwnProperty.call(R.hwDraft, cl.slotId) ? R.hwDraft[cl.slotId] : cl.homework;
  const note = Object.prototype.hasOwnProperty.call(R.noteDraft, cl.slotId) ? R.noteDraft[cl.slotId] : cl.note;
  const hwChanged = Object.prototype.hasOwnProperty.call(R.hwDraft, cl.slotId) && R.hwDraft[cl.slotId].trim() !== cl.homework;
  const noteChanged = Object.prototype.hasOwnProperty.call(R.noteDraft, cl.slotId) && R.noteDraft[cl.slotId].trim() !== cl.note;
  const c = cl.counts;
  const ws = cl.online
    ? (cl.ws.covered ? '✏️ Covered: <b>' + esc(cl.ws.covered.name) + '</b>' : '<span class="muted">The class has not started its worksheet list on Polymath Online.</span>')
      + (cl.ws.next ? '<br>⏭ Next: ' + esc(cl.ws.next.name) + (cl.nextDate ? ' (' + esc(cl.nextDate) + ')' : '') : '')
    : '<span class="muted">This class is not on Polymath Online, so the message has no worksheet or answer-key line.</span>';
  const counts = [c.sent ? c.sent + ' sent' : '', c.ready ? c.ready + ' to send' : '', c.noPhone ? c.noPhone + ' without a number' : '', c.optedOut ? c.optedOut + ' off the list' : ''].filter(Boolean).join(' · ');
  return '<div class="card lu-class" id="lu-' + esc(cl.slotId) + '">'
    + '<div class="lu-head"><div><h2>' + esc(cl.title) + ' <span class="pill ' + st.pill + '">' + esc(st.label) + '</span></h2>'
    + '<div class="sub" style="margin-bottom:6px;">' + esc(cl.when) + (cl.timeText ? ' · ' + esc(cl.timeText) : '') + ' · ' + C.plural(c.families, 'family', 'families') + (counts ? ' · ' + esc(counts) : '') + '</div></div>'
    + (c.ready ? '<button class="btn wa" data-lu="queue" data-s="' + esc(cl.slotId) + '">▶ Send to ' + C.plural(c.ready, 'parent') + '</button>' : (c.sent && !c.ready ? '<span class="pill green">✓ All sent</span>' : ''))
    + '</div>'
    + '<div class="lu-ws small">' + ws + '</div>'
    + attLine(cl)
    + (cl.state === 'upcoming' ? '<div class="small muted" style="margin:6px 0 0;">This lesson has not started yet. You can still send, but "How they did" fills in only once the teacher marks answers in the live lesson.</div>' : '')
    + (cl.state === 'live' ? '<div class="small muted" style="margin:6px 0 0;">The lesson is on now: "How they did" keeps filling in as the teacher marks answers. Best sent when the lesson ends.</div>' : '')
    + '<div class="lu-fields">'
    + '<div class="field"><label>📝 Homework for this class <span class="opt">' + (cl.homeworkIsDefault ? '(the usual line from the settings)' : '') + '</span></label>'
    + '<textarea rows="2" maxlength="' + L.HOMEWORK_MAX + '" data-lu-in="hw" data-s="' + esc(cl.slotId) + '" data-keep="lu-hw-' + esc(cl.slotId) + '" placeholder="e.g. Complete Q11–20 of the worksheet. (Leave empty for no homework line.)">' + esc(hw) + '</textarea>'
    + '<div class="actions" style="margin-top:4px;">' + (hwChanged ? '<button class="btn small" data-lu="saveHw" data-s="' + esc(cl.slotId) + '">Save homework</button>' : '')
    + (!cl.homeworkIsDefault ? '<button class="btn ghost small" data-lu="resetHw" data-s="' + esc(cl.slotId) + '">Use the usual line</button>' : '') + '</div></div>'
    + '<div class="field"><label>✍ A note for these parents <span class="opt">(optional)</span></label>'
    + '<textarea rows="2" maxlength="' + L.NOTE_MAX + '" data-lu-in="note" data-s="' + esc(cl.slotId) + '" data-keep="lu-note-' + esc(cl.slotId) + '" placeholder="e.g. Test on fractions next week. Please bring a protractor.">' + esc(note) + '</textarea>'
    + (noteChanged ? '<div class="actions" style="margin-top:4px;"><button class="btn small" data-lu="saveNote" data-s="' + esc(cl.slotId) + '">Save note</button></div>' : '')
    + '</div></div>'
    + '<div class="lu-fams">' + cl.families.map(f => familyRow(cl, f)).join('') + '</div>'
    + '</div>';
}
// 🙋 The class's attendance at a glance.
function attLine(cl) {
  const a = cl.attendance;
  if (!a || cl.state === 'upcoming') return '';
  if (!a.live && !a.taken) return '<div class="small muted lu-attline">🙋 Attendance was not taken by the live class for this lesson. Mark anyone absent by hand with ✗ Absent: their message then says so.</div>';
  const bits = [a.here + ' here', a.absent ? a.absent + ' absent' : '', a.missing ? a.missing + ' not joined yet' : ''].filter(Boolean).join(' · ');
  return '<div class="small lu-attline">🙋 <b>Attendance:</b> ' + esc(bits) + ' <span class="muted">(of ' + a.total + ', from the live class; ✓ Here / ✗ Absent to correct)</span></div>';
}
function dayBar(list) {
  const t = L.dayTotals(list);
  const today = L.sgToday();
  return '<div class="lu-daybar">'
    + '<div class="monthnav"><button data-lu="dayPrev" aria-label="Day before">◀</button><b>' + esc(L.dayLabel(R.day)) + '</b><button data-lu="dayNext" aria-label="Day after">▶</button></div>'
    + '<input type="date" value="' + esc(R.day) + '" data-lu="dayPick" aria-label="Pick a day">'
    + (R.day !== today ? '<button class="btn ghost small" data-lu="dayToday">Today</button>' : '')
    + '<div class="lu-tot small">' + (t.classes ? esc([C.plural(t.classes, 'class', 'classes'), t.sent + ' of ' + t.families + ' families sent', t.noPhone ? t.noPhone + ' without a number' : ''].filter(Boolean).join(' · ')) : '') + '</div>'
    + (t.ready > 1 && list.length > 1 ? '<button class="btn wa" data-lu="queueAll">▶ Send all ' + t.ready + '</button>' : '')
    + '</div>';
}
function liveBanner() {
  if (R.liveError) return '<div class="banner amber"><div class="big">⚠️</div><div><b>How each child did could not be loaded.</b>The live-lesson results could not be read (' + esc(R.liveError) + '), so the messages have no "How they did" line. <button class="linkbtn" data-lu="reloadLive">Try again</button></div></div>';
  return '<div class="small muted lu-livebar">' + (R.liveLoading ? 'Loading the live-lesson results…' : R.liveAt ? 'Live-lesson results as of ' + esc(W.clockText(R.liveAt)) + '. ' : '')
    + (R.liveLoading ? '' : '<button class="linkbtn" data-lu="reloadLive">↻ Refresh</button>') + '</div>';
}
function settingsCard() {
  const s = R.setDraft || R.lu;
  if (!R.settingsOpen) return '<div class="actions" style="margin:18px 0 6px;"><button class="btn ghost small" data-lu="settingsOpen">⚙️ Message settings</button></div>';
  const chk = (k, label) => '<label class="check"><input type="checkbox" data-lu="setChk" data-k="' + k + '" ' + (s[k] ? 'checked' : '') + '> ' + label + '</label>';
  return '<div class="card" style="margin-top:18px;"><h2>⚙️ Message settings</h2><div class="sub">These apply to every lesson update. A class\'s own homework line and note win over the usual line.</div>'
    + '<div class="form"><div class="field full"><label>The usual homework line</label><textarea rows="2" maxlength="' + L.HOMEWORK_MAX + '" data-lu-in="set" data-k="homeworkDefault" data-keep="lu-set-hw">' + esc(s.homeworkDefault) + '</textarea><div class="small muted">Leave empty for no homework line unless a class has its own.</div></div>'
    + '<div class="field full"><label>Last line</label><input type="text" maxlength="200" value="' + esc(s.signoff) + '" data-lu-in="set" data-k="signoff" data-keep="lu-set-sign"></div></div>'
    + '<div style="display:grid;gap:6px;margin-top:10px;">'
    + chk('showScore', 'Say how the child did in the live lesson (answered and marked right)')
    + chk('showFocus', 'Also give the focus % from the live lesson')
    + chk('showNext', 'Give the next lesson\'s date and worksheet')
    + chk('showLink', 'Say the answer key and lesson video are on Polymath Online')
    + '</div><div class="actions" style="margin-top:12px;"><button class="btn" data-lu="settingsSave">Save settings</button><button class="btn ghost" data-lu="settingsClose">Close</button></div></div>';
}
function queueOverlay(list) {
  const q = R.queue;
  if (!q) return '';
  const done = q.i >= q.items.length;
  let body;
  if (done) {
    body = '<div style="padding:22px;"><h3 style="font-size:18px;margin-bottom:6px;">💬 All done</h3><p>' + C.plural(q.opened, 'chat') + ' opened' + (q.skipped ? ', ' + q.skipped + ' skipped' : '') + '.</p>'
      + '<div class="actions" style="margin-top:14px;"><button class="btn" data-lu="queueClose">Close</button></div></div>';
  } else {
    const it = q.items[q.i];
    const { cl, f } = findFamily(list, it.slotId, it.key);
    if (!cl || !f) {
      body = '<div style="padding:22px;"><p class="muted">This family is no longer in the class.</p><div class="actions"><button class="btn" data-lu="queueNext">Next ▶</button></div></div>';
    } else {
      const was = q.last === f.key;
      body = '<div class="meter" style="margin:0 18px 0;"><span style="width:' + (q.i / q.items.length * 100) + '%"></span></div>'
        + '<div style="padding:14px 18px;overflow:auto;flex:1;">'
        + '<div class="small muted">' + esc(cl.title) + ' · ' + esc(cl.when) + '</div>'
        + '<h3 style="font-size:18px;margin:2px 0;">' + esc(f.parentName) + '</h3>'
        + '<div class="muted small" style="margin-bottom:10px;">💬 ' + esc(C.displayPhone(f.phone)) + ' · ' + f.children.map(ch => childSummary(ch, null)).join(' · ') + '</div>'
        + '<pre class="lu-pre">' + esc(f.text) + '</pre>'
        + (was ? '<div class="banner green" style="margin:12px 0 0;"><div class="big">✅</div><div><b>WhatsApp opened with the message typed in.</b>Press send in WhatsApp, then come back and press Next.</div></div>' : '')
        + '</div>'
        + '<div class="lu-qfoot"><button class="btn ghost" data-lu="queueSkip">Skip</button>'
        + (was ? '<button class="btn" data-lu="queueNext">Next ▶</button>' : '<button class="btn ghost" data-lu="queueNext">Next ▶</button>')
        + '<a class="btn wa big" href="' + esc(L.chatLink(f.phone, f.text, !TOUCH)) + '" target="polymath_whatsapp" rel="noopener" data-lu="queueSend" data-s="' + esc(cl.slotId) + '" data-k="' + esc(f.key) + '">💬 Open WhatsApp</a></div>';
    }
  }
  return '<div id="lu-overlay" class="lu-overlay"><div class="lu-qbox">'
    + '<div class="lu-qtop"><div style="flex:1;min-width:0;"><b>💬 ' + esc(q.title) + (done ? '' : ' — ' + (q.i + 1) + ' of ' + q.items.length) + '</b>'
    + '<div class="small muted">Tap Open WhatsApp, press send there, then come back for the next parent.</div></div>'
    + '<button class="btn ghost small" data-lu="queueClose">Close</button></div>' + body + '</div></div>';
}
function view() {
  const head = '<div class="page-head"><div><h1>💬 Lesson updates</h1><p>After each lesson, send every parent a WhatsApp with what was covered, how their child did and the homework. Tap 💬 Send: WhatsApp opens with the message typed in, and you press send. It goes from your own WhatsApp, one tap per parent.</p></div></div>';
  if (!CLOCK) return head + '<div class="banner red"><div class="big">⚠️</div><div><b>The lesson clock did not load.</b>Reload the page.</div></div>';
  if (!O.S.scheduleLoaded || !R.coursesLoaded) return head + '<p class="muted">Loading the classes…</p>';
  const list = classes();
  updateCount(list);
  let h = head + dayBar(list) + liveBanner();
  if (R.dayError) h += '<div class="banner amber"><div class="big">⚠️</div><div><b>This day\'s record could not be read.</b>' + esc(R.dayError) + '. What was sent may not show.</div></div>';
  if (R.attError) h += '<div class="banner amber"><div class="big">⚠️</div><div><b>Attendance could not be read.</b>' + esc(R.attError) + '. Nobody is shown as absent until it loads.</div></div>';
  if (R.coursesError) h += '<div class="banner amber"><div class="big">⚠️</div><div><b>Polymath Online could not be read.</b>The messages have no worksheet line (' + esc(R.coursesError) + ').</div></div>';
  if (!list.length) {
    const wd = L.weekdayName(R.day);
    h += '<div class="card"><h2>No classes on ' + esc(L.dayLabel(R.day).split(', ').pop()) + '</h2><div class="sub">' + (wd === 'Sunday' ? 'There are no lessons on Sundays.' : 'No class on the timetable has students on a ' + esc(wd) + '.') + ' Use ◀ ▶ to pick another day.</div></div>';
  } else {
    h += list.map(classCard).join('');
  }
  h += settingsCard();
  h += '<div class="small muted" style="margin:14px 0 30px;text-align:right;">Lesson updates ' + LU_UI_VERSION + ' · rules ' + L.LU_VERSION + '</div>';
  h += queueOverlay(list);
  return h;
}
O.VIEWS.lessons = view;

/* ─── Writes ─── */
async function writeDay(patch, okText) {
  try {
    await dayRef().set(Object.assign({ kind: L.LU_DAY_KIND, day: R.day }, patch, { updatedAt: FV.serverTimestamp(), updatedBy: who() }), { merge: true });
    if (okText) toast(okText, 'ok');
  } catch (e) { console.error(e); toast('Could not save: ' + ((e && e.message) || e), 'err'); }
}
async function clearDayField(...path) {
  try { await dayRef().update(new FP(...path), FV.delete(), 'updatedAt', FV.serverTimestamp()); }
  catch (e) { console.error(e); toast('Could not save: ' + ((e && e.message) || e), 'err'); }
}
function markSent(key, phone) {
  // Shown at once; the write follows.
  R.dayDoc.sent[key] = { at: Date.now(), by: who(), phone: phone || '' };
  writeDay({ sent: { [key]: { at: Date.now(), by: who(), phone: phone || '' } } });
}

// 🙋 A hand mark (here / absent), or back to what the live class saw ('').
async function writeMark(slotId, rosterId, v, cl) {
  const key = A.attendKey(slotId, rosterId);
  const lesson = cl && cl.lesson;
  if (v) R.att.marks[key] = { s: v, by: who(), at: Date.now(), start: lesson ? lesson.start : 0, label: cl ? cl.title : '' };
  else delete R.att.marks[key];
  rerender();
  try {
    await attRef().set({ kind: A.ATTEND_KIND, day: R.day, marks: { [key]: v ? { s: v, by: who(), at: Date.now(), start: lesson ? lesson.start : 0, label: cl ? cl.title + ' · ' + cl.shortWhen : '' } : FV.delete() },
      updatedAt: FV.serverTimestamp(), updatedBy: who() }, { merge: true });
    toast(v === 'here' ? 'Marked here.' : v === 'absent' ? 'Marked absent: their message and weekly report say so.' : 'Back to what the live class saw.', 'ok');
  } catch (e) { console.error(e); toast('Could not save: ' + ((e && e.message) || e), 'err'); }
}

/* ─── Actions ─── */
const ACT = {
  attMark(el) {
    const cl = classes().find(c => c.slotId === el.dataset.s);
    return writeMark(el.dataset.s, el.dataset.r, el.dataset.v || '', cl);
  },
  notJoined(el) {
    const { f } = findFamily(classes(), el.dataset.s, el.dataset.k);
    if (!f) return;
    const wa = {};
    f.children.filter(ch => ch.attendance && ch.attendance.s === 'missing').forEach(ch => {
      const key = A.attendKey(el.dataset.s, ch.rosterId);
      wa[key] = { at: Date.now(), by: who() };
      R.att.wa[key] = wa[key];
    });
    attRef().set({ kind: A.ATTEND_KIND, day: R.day, wa, updatedAt: FV.serverTimestamp(), updatedBy: who() }, { merge: true }).catch(e => console.warn('not joined', e));
    toast('WhatsApp opened — press send there.', 'ok');
    rerender();
  },
  dayPrev() { setDay(L.addDays(R.day, -1)); },
  dayNext() { setDay(L.addDays(R.day, 1)); },
  dayToday() { setDay(L.sgToday()); },
  dayPick(el) { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) setDay(el.value); },
  reloadLive() { loadLive(); },
  toggle(el) { const k = el.dataset.k; if (R.open[k]) delete R.open[k]; else R.open[k] = true; rerender(); },
  send(el) {
    // The link itself opens WhatsApp; this only records it.
    markSent(el.dataset.k, (el.getAttribute('href').match(/phone=(\d+)|wa\.me\/(\d+)/) || []).slice(1).find(Boolean));
    toast('WhatsApp opened — press send there.', 'ok');
    rerender();
  },
  markSent(el) { markSent(el.dataset.k, ''); toast('Marked as sent.', 'ok'); rerender(); },
  unsend(el) { delete R.dayDoc.sent[el.dataset.k]; clearDayField('sent', el.dataset.k); rerender(); },
  async copy(el) {
    const { f } = findFamily(classes(), el.dataset.s, el.dataset.k);
    if (!f) return;
    try { await navigator.clipboard.writeText(f.text); toast('Message copied.', 'ok'); } catch (e) { toast('Could not copy: select the text and copy it.', 'err'); }
  },
  edit(el) {
    const { f } = findFamily(classes(), el.dataset.s, el.dataset.k);
    if (!f) return;
    R.editing[f.key] = f.text; R.open[f.key] = true; rerender();
  },
  cancelEdit(el) { delete R.editing[el.dataset.k]; rerender(); },
  saveEdit(el) {
    const k = el.dataset.k;
    const v = String(R.editing[k] || '').replace(/\r/g, '').trim().slice(0, L.MESSAGE_MAX);
    delete R.editing[k];
    if (!v) { R.dayDoc.edits[k] = undefined; delete R.dayDoc.edits[k]; clearDayField('edits', k); rerender(); return; }
    R.dayDoc.edits[k] = v;
    writeDay({ edits: { [k]: v } }, 'Message saved.');
    rerender();
  },
  resetEdit(el) { delete R.dayDoc.edits[el.dataset.k]; clearDayField('edits', el.dataset.k); toast('Back to the automatic message.', 'ok'); rerender(); },
  saveHw(el) {
    const s = el.dataset.s;
    const v = String(R.hwDraft[s] || '').replace(/\r/g, '').trim().slice(0, L.HOMEWORK_MAX);
    delete R.hwDraft[s];
    R.dayDoc.notes[s] = Object.assign({ note: '' }, R.dayDoc.notes[s], { homework: v });
    writeDay({ notes: { [s]: { homework: v } } }, v ? 'Homework saved: it is in every message of this class.' : 'Saved: no homework line for this class.');
    rerender();
  },
  resetHw(el) {
    const s = el.dataset.s;
    delete R.hwDraft[s];
    if (R.dayDoc.notes[s]) R.dayDoc.notes[s].homework = null;
    clearDayField('notes', s, 'homework');
    rerender();
  },
  saveNote(el) {
    const s = el.dataset.s;
    const v = String(R.noteDraft[s] || '').replace(/\r/g, '').trim().slice(0, L.NOTE_MAX);
    delete R.noteDraft[s];
    R.dayDoc.notes[s] = Object.assign({ homework: null }, R.dayDoc.notes[s], { note: v });
    writeDay({ notes: { [s]: { note: v } } }, v ? 'Note saved.' : 'Note removed.');
    rerender();
  },
  optOut(el) {
    const id = el.dataset.f;
    if (!id) return;
    const opt = Object.assign({}, R.lu.optOut);
    if (el.checked) opt[id] = true; else delete opt[id];
    R.lu.optOut = opt;
    settingsRef().set({ updatedAt: FV.serverTimestamp(), updatedBy: who() }, { merge: true })
      .then(() => settingsRef().update({ optOut: opt }))
      .then(() => toast(el.checked ? 'Taken off the list: no lesson updates for this family.' : 'Back on the list.', 'ok'))
      .catch(e => toast('Could not save: ' + ((e && e.message) || e), 'err'));
    rerender();
  },
  queue(el) { openQueue(el.dataset.s); },
  queueAll() { openQueue(''); },
  queueSend(el) {
    const q = R.queue; if (!q) return;
    markSent(el.dataset.k, '');
    q.opened++; q.last = el.dataset.k;
    rerender();
  },
  queueNext() { const q = R.queue; if (!q) return; q.i++; q.last = null; rerender(); },
  queueSkip() { const q = R.queue; if (!q) return; q.i++; q.skipped++; q.last = null; rerender(); },
  queueClose() { R.queue = null; rerender(); },
  settingsOpen() { R.settingsOpen = true; R.setDraft = Object.assign({}, R.lu); rerender(); },
  settingsClose() { R.settingsOpen = false; R.setDraft = null; rerender(); },
  setChk(el) { if (!R.setDraft) R.setDraft = Object.assign({}, R.lu); R.setDraft[el.dataset.k] = !!el.checked; rerender(); },
  async settingsSave() {
    const s = R.setDraft || R.lu;
    const patch = {
      homeworkDefault: String(s.homeworkDefault || '').replace(/\r/g, '').trim().slice(0, L.HOMEWORK_MAX),
      signoff: String(s.signoff || '').trim().slice(0, 200),
      showScore: !!s.showScore, showFocus: !!s.showFocus, showNext: !!s.showNext, showLink: !!s.showLink,
      updatedAt: FV.serverTimestamp(), updatedBy: who()
    };
    try { await settingsRef().set(patch, { merge: true }); toast('Settings saved.', 'ok'); R.settingsOpen = false; R.setDraft = null; }
    catch (e) { toast('Could not save: ' + ((e && e.message) || e), 'err'); }
    rerender();
  }
};
function setDay(day) {
  if (day === R.day) return;
  R.day = day; R.open = {}; R.editing = {}; R.hwDraft = {}; R.noteDraft = {}; R.queue = null;
  listenDay();
  rerender();
}
function openQueue(slotId) {
  const list = classes();
  const items = L.queueOf(list, slotId);
  if (!items.length) { toast('Everyone with a WhatsApp number has been sent.', 'ok'); return; }
  const cl = slotId ? list.find(c => c.slotId === slotId) : null;
  R.queue = { items, i: 0, opened: 0, skipped: 0, last: null, title: cl ? cl.title + ' lesson updates' : 'Lesson updates' };
  rerender();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-lu]');
  if (el && el.type !== 'checkbox' && el.type !== 'date' && ACT[el.dataset.lu]) {
    // The WhatsApp links open by themselves (a real link is never blocked as
    // a pop-up on a phone); everything else is a button.
    if (el.tagName !== 'A') e.preventDefault();
    try { const r = ACT[el.dataset.lu](el, e); if (r && r.catch) r.catch(err => toast(String(err && err.message || err), 'err')); } catch (err) { console.error(err); }
    return;
  }
  if (R.queue && e.target && e.target.id === 'lu-overlay') { R.queue = null; rerender(); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-lu]');
  if (el && (el.type === 'checkbox' || el.type === 'date') && ACT[el.dataset.lu]) ACT[el.dataset.lu](el, e);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-lu-in]');
  if (!el) return;
  const k = el.dataset.luIn;
  if (k === 'edit') R.editing[el.dataset.k] = el.value;
  else if (k === 'hw' || k === 'note') {
    const store = k === 'hw' ? R.hwDraft : R.noteDraft;
    const had = Object.prototype.hasOwnProperty.call(store, el.dataset.s);
    store[el.dataset.s] = el.value;
    if (!had) rerender();     // shows the Save button once
  } else if (k === 'set') { if (!R.setDraft) R.setDraft = Object.assign({}, R.lu); R.setDraft[el.dataset.k] = el.value; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.queue) { R.queue = null; rerender(); } });

// Opened straight at #lessons before this module was ready: show it now.
if ((location.hash || '').replace('#', '') === 'lessons' && O.S.admin && O.S.view !== 'lessons') { O.S.view = 'lessons'; rerender(); }
window.PolymathLessonUpdates = { R, ACT, view, classes, version: LU_UI_VERSION };
