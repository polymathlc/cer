/* ═══════════════════════════════════════════════════════════════════════════
   📊 POLYMATH OFFICE — the Results tab (school-results.mjs v1.0.0)

   polymathlc.com.sg/office/#results. Every child's school Maths and Science
   results, before and after they joined Polymath:

     • the headline numbers for the centre, worked out from real results
       ("8 in 10 of our students improved by at least one grade after joining
       Polymath"), by subject and level, with the sentences ready to copy. They
       are NOT put on the website: that is the centre's own decision.
     • one card per child: a chart of their marks with the day they joined, and
       for each subject the last result before joining against the latest since
       (▲ 2 grades · +15 marks). Newest parent entries are marked 🆕.
     • a child's results in full: add, change or remove any result (the
       office's own are kept as "entered by the centre", which the parent can
       see but not change)
     • asking parents: each family has its own link
       (polymathlc.com.sg/results/?f=…&k=…), sent by email or WhatsApp from here,
       one family at a time or every family who has not sent results yet
     • a CSV of every result

   It is a module of its own, loaded after office-app.mjs, and plugs into the
   office through window.PolymathOffice (VIEWS, S, C, render), like the Reports
   and Lessons tabs. Its controls carry data-sr and are wired here. The rules —
   grades, before/after, the headline, the chart — are in school-results-core.mjs.

   Reads: officeSettings where kind == 'school-results' (one document per family,
   results-<familyId>) and the office's families. Writes: those documents, and
   mail/polymath-office-results-* for the emails. The parent's page writes the
   same documents through the schoolResults function.
   ═══════════════════════════════════════════════════════════════════════════ */
import * as S from './school-results-core.mjs?v=1.0.0';

const SR_UI_VERSION = '1.0.0';
const O = window.PolymathOffice;
const C = O.C;
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;
const COL = 'officeSettings';
const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const esc = S.esc;
const rnd = n => Array.from(crypto.getRandomValues(new Uint32Array(n)));

const R = {
  docs: {},            // familyId → normalized results document
  raw: {},             // familyId → the stored document (token included)
  loaded: false, error: '',
  subject: '', level: '', includeLeft: false, search: '', sort: 'change',
  showWaiting: false,  // the list of children with no results
  child: null,         // { familyId, studentId } shown in the overlay
  form: null,          // the result being added or changed in the overlay
  confirmBulk: false, bulk: null, busy: '', unsubs: [], copied: ''
};

/* ─── Data ─── */
function rerender() { if (O && typeof O.render === 'function') O.render(); }
function stopListening() { while (R.unsubs.length) { try { R.unsubs.pop()(); } catch (e) { /* gone */ } } }
function startListening() {
  stopListening();
  R.unsubs.push(db.collection(COL).where('kind', '==', S.RESULTS_KIND).onSnapshot(snap => {
    const docs = {}, raw = {};
    snap.docs.forEach(d => {
      const data = d.data() || {};
      const fid = data.familyId || d.id.replace(S.RESULTS_DOC_PREFIX, '');
      raw[fid] = data;
      docs[fid] = S.normalizeResultsDoc(Object.assign({}, data, { familyId: fid }));
    });
    R.docs = docs; R.raw = raw; R.loaded = true; R.error = '';
    rerender();
    setTimeout(updateCount, 0);
  }, err => { R.error = (err && err.message) || 'could not be read'; R.loaded = true; rerender(); }));
}
firebase.auth().onAuthStateChanged(user => {
  // The office decides who is an admin; wait for it before reading anything.
  setTimeout(function wait(tries) {
    if (!user) { stopListening(); return; }
    if (O.S.admin) { startListening(); return; }
    if ((tries || 0) < 40) setTimeout(() => wait((tries || 0) + 1), 250);
  }, 0);
});
function toast(msg, kind) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 7000 : 3800);
}
const me = () => (O.S.user && O.S.user.email) || '';
const docRef = fid => db.collection(COL).doc(S.resultsDocId(fid));
const famById = id => (O.S.families || []).find(f => f.id === id) || null;
function today() { return S.sgToday(); }

// The family's document with its key, made the first time it is needed.
async function ensureLink(fid) {
  const ref = docRef(fid);
  const token = await db.runTransaction(async t => {
    const snap = await t.get(ref);
    const d = snap.exists ? snap.data() || {} : null;
    if (d && typeof d.token === 'string' && d.token.length >= 20 && !d.disabled) return d.token;
    const fresh = C.newToken(rnd, 24);
    if (d) t.update(ref, { token: fresh, disabled: false, updatedAt: Date.now(), updatedBy: me() });
    else t.set(ref, { kind: S.RESULTS_KIND, familyId: fid, token: fresh, students: {}, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: me() });
    return fresh;
  });
  return token;
}
// Changes one child's list inside one transaction, so a parent saving at the
// same moment is never overwritten.
async function changeResults(fid, sid, change) {
  const ref = docRef(fid);
  await db.runTransaction(async t => {
    const snap = await t.get(ref);
    const d = snap.exists ? Object.assign({}, snap.data()) : { kind: S.RESULTS_KIND, familyId: fid, token: C.newToken(rnd, 24), createdAt: Date.now() };
    const students = Object.assign({}, d.students && typeof d.students === 'object' ? d.students : {});
    const list = (Array.isArray(students[sid]) ? students[sid] : []).map(S.normalizeResult).filter(Boolean);
    students[sid] = change(list);
    t.set(ref, Object.assign(d, { kind: S.RESULTS_KIND, familyId: fid, students, updatedAt: Date.now(), updatedBy: me() }));
  });
}
async function markSeen(fid, sid) {
  if (!S.changedByParent(R.docs[fid], sid)) return;
  try { await docRef(fid).set({ officeSeen: { [sid]: Date.now() } }, { merge: true }); } catch (e) { console.warn('seen', e); }
}
async function emailLink(fid) {
  const f = famById(fid);
  if (!f) throw new Error('that family is not loaded yet');
  const to = C.familyEmails(f);
  if (!to.length) throw new Error('no email address for ' + (f.parentName || 'this family'));
  const token = await ensureLink(fid);
  const settings = C.normalizeSettings(O.S.settings || {});
  const link = S.resultsLink(fid, token);
  const msg = S.requestEmail(f, link, { shell: (title, inner) => C.emailShell(title, inner, settings), signature: settings.signature });
  await db.collection('mail').doc(C.mailDocId('results', fid)).set(C.officeMail(to, msg, { kind: 'school-results', familyId: fid, sentBy: me() }, settings));
  await docRef(fid).set({ linkSentAt: Date.now(), linkSentVia: 'email' }, { merge: true });
  return to;
}
async function whatsappLink(fid) {
  const f = famById(fid);
  if (!f) throw new Error('that family is not loaded yet');
  if (!f.whatsapp) throw new Error('no WhatsApp number for ' + (f.parentName || 'this family'));
  const token = await ensureLink(fid);
  const url = C.whatsappLink(f.whatsapp, S.requestWhatsappText(f, S.resultsLink(fid, token)), !TOUCH);
  window.open(url, 'polymath_whatsapp');
  await docRef(fid).set({ linkSentAt: Date.now(), linkSentVia: 'WhatsApp' }, { merge: true });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}

/* ─── What is shown ─── */
function families() { return O.S.families || []; }
function rows(extra) {
  return S.childRows(families(), R.docs, Object.assign({ includeLeft: R.includeLeft, level: R.level }, extra || {}));
}
function isNew(row) { return S.changedByParent(R.docs[row.familyId], row.studentId); }
function newCount() { return rows({ level: '' }).filter(isNew).length; }
function sortRows(list) {
  const score = r => {
    const subs = R.subject ? [R.subject] : S.SUBJECTS;
    const cmp = subs.map(s => r.bySubject[s]).filter(c => c && c.comparable);
    if (!cmp.length) return -999;
    return Math.max(...cmp.map(c => (c.gradeDelta != null ? c.gradeDelta * 100 : 0) + (c.pctDelta || 0)));
  };
  const latest = r => r.results.reduce((m, x) => Math.max(m, x.at || 0), 0);
  const lv = r => C.levelRank(r.level);
  const by = {
    change: (a, b) => score(b) - score(a) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    level: (a, b) => lv(a) - lv(b) || a.name.localeCompare(b.name),
    newest: (a, b) => (isNew(b) - isNew(a)) || latest(b) - latest(a)
  }[R.sort] || ((a, b) => a.name.localeCompare(b.name));
  return list.slice().sort(by);
}
function subjectRows() {
  const all = rows({ search: R.search });
  const shown = all.filter(r => r.results.some(x => !R.subject || x.subject === R.subject));
  const waiting = all.filter(r => !r.results.length);
  return { all, shown: sortRows(shown), waiting };
}
function sentText(d) {
  if (!d || !d.linkSentAt) return '';
  return 'Link sent ' + S.dayLabel(S.sgToday(d.linkSentAt)).replace(/ \d{4}$/, '') + (d.linkSentVia ? ' by ' + d.linkSentVia : '');
}

/* ─── The view ─── */
function seg(name, value, options) {
  return '<div class="sr-seg" role="group">' + options.map(([v, label]) => '<button type="button" class="' + (value === v ? 'on' : '') + '" data-sr="' + name + '" data-v="' + esc(v) + '">' + esc(label) + '</button>').join('') + '</div>';
}
function filters() {
  const levels = C.LEVELS.filter(l => families().some(f => (f.students || []).some(s => s.level === l)));
  return '<div class="sr-filters">'
    + seg('subject', R.subject, [['', 'Both subjects'], ['Math', 'Maths'], ['Science', 'Science']])
    + '<select data-sr-in="level" aria-label="Level"><option value="">All levels</option>' + levels.map(l => '<option' + (R.level === l ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + '<label class="sr-check"><input type="checkbox" data-sr="includeLeft"' + (R.includeLeft ? ' checked' : '') + '> Include students who left</label>'
    + '</div>';
}
function headlineCard() {
  const h = S.headline(rows(), { subject: R.subject });
  const tile = (label, value, hint, tone) => '<div class="sr-tile ' + (tone || '') + '"><div class="l">' + esc(label) + '</div><div class="v">' + value + '</div><div class="h">' + esc(hint) + '</div></div>';
  const tiles = '<div class="sr-tiles">'
    + tile('Went up a grade', h.graded ? esc(S.inTen(h.improvedGrade, h.graded)) : '–', h.graded ? h.improvedGrade + ' of ' + S.plural(h.graded, 'student') + ' since joining' : 'No before-and-after results yet', h.graded ? 'good' : '')
    + tile('Average mark', h.avgBefore != null ? Math.round(h.avgBefore) + '% → ' + Math.round(h.avgAfter) + '%' : '–', h.avgGain != null ? (h.avgGain >= 0 ? '+' : '−') + Math.abs(Math.round(h.avgGain)) + ' marks on average' : 'Before joining → latest', h.avgGain > 0 ? 'good' : '')
    + tile('Students compared', String(h.compared), 'with a result before and after joining')
    + tile('Results entered', String(h.results), S.plural(h.withResults, 'student') + ' of ' + h.children)
    + '</div>';
  const sentences = h.sentences.length
    ? '<div class="sr-sentences">' + h.sentences.map(s => '<div class="sr-sentence"><div><div class="t">“' + esc(s.text) + '”</div><div class="b">' + esc(s.basis) + '</div></div>'
      + '<button class="btn ghost sm" data-sr="copySentence" data-t="' + esc(s.text) + '">' + (R.copied === s.text ? '✓ Copied' : '📋 Copy') + '</button></div>').join('') + '</div>'
    : '<div class="small muted" style="margin-top:10px;">The sentences appear once at least one student has a result from before joining and one since. Ask parents for results below.</div>';
  const caution = h.sentences.length && h.small
    ? '<div class="banner amber" style="margin:12px 0 0;"><div class="big">⚖️</div><div><b>Only ' + S.plural(h.compared, 'student') + ' so far.</b>With fewer than ' + S.MIN_SAMPLE + ' the numbers can swing a lot from one result. Wait for more before quoting them in public.</div></div>' : '';
  return '<div class="card sr-head-card"><div class="sr-card-top"><div><h2>🏆 What our students achieve</h2><div class="sub">Each child\'s last school result before joining Polymath against their latest one since. Grades are AL bands (P3–P6) or A1–F9 (secondary); a result typed in as marks only is given the band its marks fall in.</div></div></div>'
    + filters() + tiles + sentences + caution
    + '<div class="small muted" style="margin-top:12px;">These numbers stay in the Office. Putting them on the home page is your decision: copy a sentence when you are happy with it.</div></div>';
}
function askCard() {
  const fams = families().filter(f => C.familyStateIn(f, C.sgMonthKey()) === 'active' && (f.students || []).some(s => s.status === 'active'));
  const withResults = fams.filter(f => R.docs[f.id] && S.resultCount(R.docs[f.id]) > 0).length;
  const sent = fams.filter(f => R.docs[f.id] && R.docs[f.id].linkSentAt).length;
  const todo = bulkTargets();
  const b = R.bulk;
  return '<div class="card"><h2>📨 Ask parents for results</h2><div class="sub">Each family has its own link where they add their children\'s results. The results come straight into this tab.</div>'
    + '<div class="sr-mini"><span><b>' + withResults + '</b> of ' + fams.length + ' families have sent results</span><span><b>' + sent + '</b> have been sent their link</span></div>'
    + '<div class="actions" style="margin-top:12px;"><button class="btn" data-sr="bulkAsk" ' + (todo.length && !b ? '' : 'disabled') + '>📧 Email every family without results (' + todo.length + ')</button></div>'
    + (R.confirmBulk ? '<div class="banner amber" style="margin:12px 0 0;"><div class="big">📧</div><div><b>Email ' + S.plural(todo.length, 'family', 'families') + ' their results link?</b>'
      + 'Families who already sent results, have no email address, or were sent the link in the last 14 days are left out. Each email comes from admin@polymathlc.com.sg.'
      + '<div class="actions" style="margin-top:8px;"><button class="btn" data-sr="bulkYes">Yes, email them</button><button class="btn ghost" data-sr="bulkNo">Cancel</button></div></div></div>' : '')
    + (b ? '<div class="small" style="margin-top:10px;">' + (b.done < b.total ? '⏳ Sending ' + b.done + ' of ' + b.total + '…' : '✓ Emailed ' + (b.total - b.failed) + ' of ' + b.total + (b.failed ? ' · ' + b.failed + ' failed' : '')) + '</div>' : '')
    + '<div class="small muted" style="margin-top:10px;">Or send one family their link from their child below: 📧 email, 💬 WhatsApp or 🔗 copy. A good time to ask is the week each school\'s results come back (WA, mid-year, end-of-year).</div></div>';
}
function bulkTargets() {
  const cutoff = Date.now() - 14 * 86400e3;
  return families().filter(f => C.familyStateIn(f, C.sgMonthKey()) === 'active' && (f.students || []).some(s => s.status === 'active')
    && C.familyEmails(f).length && !(R.docs[f.id] && S.resultCount(R.docs[f.id]) > 0) && !(R.docs[f.id] && R.docs[f.id].linkSentAt > cutoff));
}
function compareLine(row, sub) {
  const c = row.bySubject[sub];
  const list = row.results.filter(r => r.subject === sub);
  if (!list.length) return '';
  const tone = S.changeTone(c);
  const body = c.comparable
    ? esc(S.examName(c.before)) + ' ' + esc(S.resultText(c.before, row.level)) + ' → ' + esc(S.examName(c.after)) + ' ' + esc(S.resultText(c.after, row.level))
      + (S.changeText(c) ? ' <b class="d">' + esc(S.changeText(c)) + '</b>' : '')
    : esc(S.examName(list[list.length - 1])) + ' ' + esc(S.resultText(list[list.length - 1], row.level)) + ' <span class="why">' + esc(S.REASON_TEXT[c.reason] || '') + '</span>';
  return '<div class="sr-line ' + tone + '"><span class="subj ' + (sub === 'Math' ? 'math' : 'science') + '">' + esc(S.SUBJECT_LABEL[sub]) + '</span><span class="txt">' + body + '</span></div>';
}
function linkButtons(fid, small) {
  const f = famById(fid);
  const cls = 'btn ghost ' + (small ? 'xs' : 'sm');
  return '<button class="' + cls + '" data-sr="email" data-f="' + esc(fid) + '"' + (f && C.familyEmails(f).length ? '' : ' disabled title="No email address"') + '>📧 Email link</button>'
    + '<button class="' + cls + '" data-sr="whatsapp" data-f="' + esc(fid) + '"' + (f && f.whatsapp ? '' : ' disabled title="No WhatsApp number"') + '>💬 WhatsApp</button>'
    + '<button class="' + cls + '" data-sr="copyLink" data-f="' + esc(fid) + '">🔗 Copy link</button>';
}
function childCard(row) {
  const subs = R.subject ? [R.subject] : S.SUBJECTS;
  const d = R.docs[row.familyId];
  return '<div class="sr-kid' + (row.left ? ' left' : '') + '" data-kid="' + esc(row.familyId + '/' + row.studentId) + '">'
    + '<div class="sr-kid-top"><div class="sr-who"><b>' + esc(row.name) + '</b> <span class="lv">' + esc(row.level || '–') + '</span>' + (isNew(row) ? ' <span class="pill green">🆕 New from parent</span>' : '') + (row.left ? ' <span class="pill grey">Left</span>' : '')
    + '<div class="small muted">' + esc(row.parentName) + ' · ' + (row.join ? 'With us since ' + esc(S.dayLabel(row.join)) : '<span class="warn">No joining date</span>') + '</div></div>'
    + '<button class="btn sm" data-sr="open" data-f="' + esc(row.familyId) + '" data-s="' + esc(row.studentId) + '">Open</button></div>'
    + '<div class="sr-chart-box">' + S.chartSvg(row.results, { join: row.join, level: row.level, subjects: subs, compact: true, title: row.name }) + '</div>'
    + subs.map(sub => compareLine(row, sub)).join('')
    + '<div class="small muted sr-foot">' + S.plural(row.results.filter(r => subs.includes(r.subject)).length, 'result') + (d && d.linkSentAt ? ' · ' + esc(sentText(d)) : '') + '</div>'
    + '</div>';
}
function waitingList(list) {
  if (!list.length) return '';
  const shown = R.showWaiting ? list : list.slice(0, 0);
  return '<div class="card" style="margin-top:18px;"><div class="sr-card-top"><div><h2>⏳ No results yet (' + list.length + ')</h2><div class="sub">Children whose families have not sent any results. Send the link, or add a result yourself.</div></div>'
    + '<button class="btn ghost sm" data-sr="toggleWaiting">' + (R.showWaiting ? 'Hide' : 'Show them') + '</button></div>'
    + (shown.length ? '<div class="table-wrap" style="box-shadow:none;"><table class="t sr-wait"><thead><tr><th>Student</th><th>Parent</th><th>Link</th><th></th></tr></thead><tbody>'
      + shown.map(r => '<tr><td><b>' + esc(r.name) + '</b> <span class="small muted">' + esc(r.level) + '</span></td><td>' + esc(r.parentName) + '</td>'
        + '<td class="small">' + (R.docs[r.familyId] && R.docs[r.familyId].linkSentAt ? esc(sentText(R.docs[r.familyId])) : '<span class="muted">Not sent</span>') + '</td>'
        + '<td class="r"><div class="sr-btns">' + linkButtons(r.familyId, true) + '<button class="btn ghost xs" data-sr="open" data-f="' + esc(r.familyId) + '" data-s="' + esc(r.studentId) + '">+ Add result</button></div></td></tr>').join('')
      + '</tbody></table></div>' : '')
    + '</div>';
}
function studentsCard() {
  const { shown, waiting } = subjectRows();
  const sorts = [['change', 'Biggest improvement'], ['newest', 'Newest results'], ['level', 'Level'], ['name', 'Name']];
  return '<div class="card" style="margin-top:18px;"><div class="sr-card-top"><div><h2>👩‍🎓 Every student\'s results</h2><div class="sub">' + S.plural(shown.length, 'student') + ' with results. The shaded part of each chart is before they joined.</div></div>'
    + '<div class="actions"><input class="search" type="search" placeholder="Search a student or parent" value="' + esc(R.search) + '" data-sr-in="search" data-keep="sr-search">'
    + '<select data-sr-in="sort" aria-label="Sort">' + sorts.map(([v, l]) => '<option value="' + v + '"' + (R.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + '<button class="btn ghost sm" data-sr="csv">⬇ CSV</button></div></div>'
    + (shown.length ? '<div class="sr-grid">' + shown.map(childCard).join('') + '</div>' : '<div class="small muted">No results yet' + (R.search ? ' for "' + esc(R.search) + '"' : '') + '.</div>')
    + '</div>' + waitingList(waiting);
}

/* ─── One child, in full (the overlay) ─── */
function resultForm(row) {
  const f = R.form;
  const custom = f.exam === 'Test' || f.exam === 'Other';
  const scale = S.scaleFor(row.level);
  return '<div class="sr-form" id="sr-form"><h3>' + (f.id ? 'Change this result' : 'Add a result') + '</h3><div class="sr-form-grid">'
    + '<label>Subject' + seg('formSubject', f.subject, S.SUBJECTS.map(s => [s, S.SUBJECT_LABEL[s]])) + '</label>'
    + '<label>Test or exam<select data-sr-in="exam"><option value="">Choose…</option>' + S.EXAMS.map(e => '<option value="' + e.key + '"' + (f.exam === e.key ? ' selected' : '') + '>' + esc(e.label) + '</option>').join('') + '</select></label>'
    + '<label>Date<input type="date" data-sr-in="date" value="' + esc(f.date) + '"></label>'
    + (custom ? '<label>Name of the test<input data-sr-in="label" maxlength="' + S.LIMITS.label + '" value="' + esc(f.label) + '" placeholder="e.g. Fractions topical test"></label>' : '')
    + '<label>Marks<span class="sr-marks"><input data-sr-in="mark" inputmode="decimal" value="' + esc(f.mark) + '" placeholder="e.g. 72"> out of <input data-sr-in="max" inputmode="decimal" value="' + esc(f.max) + '"></span></label>'
    + '<label>Grade<select data-sr-in="grade"><option value="">' + (scale === 'AL' ? 'Work out from the marks' : 'Not given') + '</option>' + S.GRADES[scale].map(g => '<option' + (f.grade === g ? ' selected' : '') + '>' + g + '</option>').join('') + '</select></label>'
    + '</div>' + (f.error ? '<div class="sr-err">' + esc(f.error) + '</div>' : '')
    + '<div class="actions" style="margin-top:12px;"><button class="btn" data-sr="saveResult"' + (R.busy === 'save' ? ' disabled' : '') + '>' + (R.busy === 'save' ? 'Saving…' : 'Save result') + '</button><button class="btn ghost" data-sr="cancelForm">Cancel</button></div></div>';
}
function overlay() {
  if (!R.child) return '';
  const row = currentRow();
  if (!row) return '';
  const d = R.docs[row.familyId];
  const list = row.results.slice().reverse();
  const tbl = list.length ? '<div class="table-wrap" style="box-shadow:none;"><table class="t sr-results"><thead><tr><th>Subject</th><th>Test or exam</th><th>Date</th><th class="r">Result</th><th>Entered by</th><th></th></tr></thead><tbody>'
    + list.map(r => '<tr><td><span class="subj ' + (r.subject === 'Math' ? 'math' : 'science') + '">' + esc(S.SUBJECT_LABEL[r.subject]) + '</span></td><td>' + esc(S.examLongName(r)) + '</td><td>' + esc(S.dayLabel(r.date)) + '</td>'
      + '<td class="r"><b>' + esc(S.resultText(r, row.level)) + '</b></td><td class="small">' + (r.by === 'office' ? 'Centre' : 'Parent') + (r.at ? ' · ' + esc(S.dayLabel(S.sgToday(r.at)).replace(/ \d{4}$/, '')) : '') + '</td>'
      + '<td class="r"><div class="sr-btns"><button class="btn ghost xs" data-sr="editResult" data-r="' + esc(r.id) + '">Edit</button><button class="btn danger xs" data-sr="removeResult" data-r="' + esc(r.id) + '" aria-label="Remove">✕</button></div></td></tr>').join('')
    + '</tbody></table></div>' : '<div class="small muted" style="margin:8px 0;">No results yet.</div>';
  return '<div id="sr-overlay" class="sr-overlay"><div class="sr-dialog" role="dialog" aria-modal="true" aria-label="' + esc(row.name) + '">'
    + '<div class="sr-dialog-head"><div style="flex:1;min-width:0;"><b style="font-size:18px;">' + esc(row.name) + '</b> <span class="lv">' + esc(row.level) + '</span>'
    + '<div class="small muted">' + esc(row.parentName) + ' · ' + (row.join ? 'With us since ' + esc(S.dayLabel(row.join)) : 'No joining date') + ' · <button class="linkbtn" data-act="openFamily" data-id="' + esc(row.familyId) + '">' + (row.join ? 'change' : 'set it in the family') + '</button></div></div>'
    + '<button class="btn ghost sm" data-sr="close">Close</button></div>'
    + '<div class="sr-dialog-body">'
    + '<div class="sr-chart-box big">' + S.chartSvg(row.results, { join: row.join, level: row.level, title: row.name + '\'s marks' }) + '</div>'
    + '<div class="legend" style="margin:6px 2px 10px;">' + S.SUBJECTS.map(s => '<span><i style="background:' + S.SUBJECT_COLOUR[s] + ';border-radius:50%"></i>' + S.SUBJECT_LABEL[s] + '</span>').join('') + '<span>┆ Joined Polymath</span><span>○ grade only</span></div>'
    + S.SUBJECTS.map(s => compareLine(row, s)).join('')
    + (R.form ? resultForm(row) : '<div class="actions" style="margin:14px 0 10px;"><button class="btn" data-sr="addResult">+ Add a result</button></div>')
    + tbl
    + '<div class="sr-linkbox"><b>The family\'s results link</b><div class="small muted">' + (d && d.token ? esc(sentText(d) || 'Not sent yet') + ' · ' + esc(S.SITE.replace(/^https:\/\//, '') + S.RESULTS_PATH + '?f=' + row.familyId + '&k=…') : 'Made when you first send or copy it.') + '</div>'
    + '<div class="sr-btns" style="margin-top:8px;">' + linkButtons(row.familyId, false) + (d && d.token ? '<button class="btn ghost sm" data-sr="newLink" data-f="' + esc(row.familyId) + '">↻ New link</button>' : '') + '</div></div>'
    + '</div></div></div>';
}

function view() {
  setTimeout(updateCount, 0);
  if (!R.loaded) {
    return '<div class="page-head"><div><h1>📊 School results</h1><p>' + (R.error ? 'Could not load the results: ' + esc(R.error) : 'Loading…') + '</p></div></div>';
  }
  return '<div class="page-head"><div><h1>📊 School results</h1><p>Every child\'s school Maths and Science results, before and after they joined Polymath. Parents add them with their own link; you can add or correct any.</p></div></div>'
    + (R.error ? '<div class="banner red"><div class="big">⚠️</div><div><b>Could not load the results.</b>' + esc(R.error) + '</div></div>' : '')
    + '<div class="sr-top">' + headlineCard() + askCard() + '</div>'
    + studentsCard()
    + '<div class="small muted" style="margin:14px 0 30px;text-align:right;">Results ' + SR_UI_VERSION + ' · rules ' + S.RESULTS_VERSION + '</div>'
    + overlay();
}
O.VIEWS.results = view;
function updateCount() {
  const el = document.querySelector('[data-count="results"]');
  if (!el) return;
  const n = R.loaded ? newCount() : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hidden', !n);
}

/* ─── Actions ─── */
function blankForm() { return { id: '', subject: R.subject || 'Math', exam: '', date: '', label: '', mark: '', max: '100', grade: '', error: '', by: 'office' }; }
function suggestDate(exam) {
  const t = today();
  const y = Number(t.slice(0, 4));
  const d = S.defaultExamDate(exam, y);
  if (!d) return t;
  return d <= t ? d : S.defaultExamDate(exam, y - 1);
}
function currentRow() {
  if (!R.child) return null;
  return S.childRows(families(), R.docs, { includeLeft: true }).find(r => r.familyId === R.child.familyId && r.studentId === R.child.studentId) || null;
}
const ACT = {
  subject(el) { R.subject = el.dataset.v || ''; rerender(); },
  includeLeft(el) { R.includeLeft = !!el.checked; rerender(); },
  toggleWaiting() { R.showWaiting = !R.showWaiting; rerender(); },
  async copySentence(el) {
    const ok = await copyText(el.dataset.t);
    R.copied = ok ? el.dataset.t : '';
    toast(ok ? 'Copied. Paste it wherever you like.' : 'Could not copy: select the sentence and copy it by hand.', ok ? 'ok' : 'err');
    rerender();
  },
  open(el) {
    R.child = { familyId: el.dataset.f, studentId: el.dataset.s };
    const row = currentRow();
    R.form = row && !row.results.length ? blankForm() : null;
    markSeen(el.dataset.f, el.dataset.s);
    rerender();
  },
  close() { R.child = null; R.form = null; rerender(); },
  addResult() { R.form = blankForm(); rerender(); },
  formSubject(el) { if (R.form) { R.form.subject = el.dataset.v; rerender(); } },
  cancelForm() { R.form = null; rerender(); },
  editResult(el) {
    const row = currentRow();
    const r = row && row.results.find(x => x.id === el.dataset.r);
    if (!r) return;
    R.form = { id: r.id, subject: r.subject, exam: r.exam, date: r.date, label: r.label || '', mark: r.mark == null ? '' : String(r.mark), max: String(r.max || 100), grade: r.grade || '', error: '', by: r.by };
    rerender();
  },
  async saveResult() {
    const f = R.form, row = currentRow();
    if (!f || !row) return;
    const v = S.validateResult({ subject: f.subject, exam: f.exam, date: f.date, label: f.label, mark: f.mark, max: f.max, grade: f.grade },
      { today: today(), by: f.by || 'office', at: Date.now(), id: f.id || S.newResultId(rnd) });
    if (v.error) { f.error = v.error; rerender(); return; }
    R.busy = 'save'; rerender();
    try {
      await changeResults(row.familyId, row.studentId, list => S.upsertResult(list, v.result));
      R.form = null;
      toast('Saved', 'ok');
    } catch (e) { console.error(e); f.error = 'Could not save: ' + ((e && e.message) || e); }
    R.busy = ''; rerender();
  },
  async removeResult(el) {
    const row = currentRow();
    const r = row && row.results.find(x => x.id === el.dataset.r);
    if (!r) return;
    if (!confirm('Remove ' + row.name + '\'s ' + S.SUBJECT_LABEL[r.subject] + ' ' + S.examLongName(r) + ' (' + S.dayLabel(r.date) + ')?' + (r.by === 'parent' ? '\n\nThe parent entered it; it disappears from their page too.' : ''))) return;
    try { await changeResults(row.familyId, row.studentId, list => S.removeResult(list, r.id)); toast('Removed', 'ok'); }
    catch (e) { toast('Could not remove: ' + ((e && e.message) || e), 'err'); }
  },
  async email(el) {
    const fid = el.dataset.f;
    const f = famById(fid);
    if (!confirm('Email ' + ((f && f.parentName) || 'this family') + ' their school results link?\n\nTo: ' + (f ? C.familyEmails(f).join(', ') : ''))) return;
    try { const to = await emailLink(fid); toast('Emailed to ' + to.join(', '), 'ok'); }
    catch (e) { toast('Could not email: ' + ((e && e.message) || e), 'err'); }
  },
  async whatsapp(el) {
    try { await whatsappLink(el.dataset.f); toast('WhatsApp opened with the message typed in. Press send there.', 'ok'); }
    catch (e) { toast('Could not open WhatsApp: ' + ((e && e.message) || e), 'err'); }
  },
  async copyLink(el) {
    try {
      const token = await ensureLink(el.dataset.f);
      const ok = await copyText(S.resultsLink(el.dataset.f, token));
      toast(ok ? 'Link copied. It is for this family only.' : 'Could not copy the link.', ok ? 'ok' : 'err');
    } catch (e) { toast('Could not make the link: ' + ((e && e.message) || e), 'err'); }
  },
  async newLink(el) {
    if (!confirm('Make a new link for this family?\n\nThe old link stops working at once. Their results stay.')) return;
    try {
      await docRef(el.dataset.f).set({ token: C.newToken(rnd, 24), linkSentAt: 0, linkSentVia: '', updatedAt: Date.now(), updatedBy: me() }, { merge: true });
      toast('New link made: send it to the family.', 'ok');
    } catch (e) { toast('Could not make a new link: ' + ((e && e.message) || e), 'err'); }
  },
  bulkAsk() { R.confirmBulk = true; rerender(); },
  bulkNo() { R.confirmBulk = false; rerender(); },
  async bulkYes() {
    R.confirmBulk = false;
    const list = bulkTargets();
    R.bulk = { total: list.length, done: 0, failed: 0 };
    rerender();
    for (const f of list) {
      try { await emailLink(f.id); } catch (e) { console.error(e); R.bulk.failed++; }
      R.bulk.done++;
      rerender();
    }
    toast('Emailed ' + (R.bulk.total - R.bulk.failed) + ' of ' + R.bulk.total + ' families.', R.bulk.failed ? 'err' : 'ok');
    setTimeout(() => { R.bulk = null; rerender(); }, 8000);
  },
  csv() {
    const csv = S.resultsCsv(sortRows(rows({ search: R.search })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'polymath-school-results-' + today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-sr]');
  if (el && el.type !== 'checkbox' && ACT[el.dataset.sr]) {
    e.preventDefault();
    try { const r = ACT[el.dataset.sr](el, e); if (r && r.catch) r.catch(err => toast(String(err && err.message || err), 'err')); } catch (err) { console.error(err); }
    return;
  }
  // Opening the family to set the joining date closes this overlay first.
  if (R.child && e.target.closest('[data-act="openFamily"]')) { R.child = null; R.form = null; setTimeout(rerender, 0); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-sr]');
  if (el && el.type === 'checkbox' && ACT[el.dataset.sr]) { ACT[el.dataset.sr](el, e); return; }
  const inp = e.target.closest('[data-sr-in]');
  if (!inp) return;
  const k = inp.dataset.srIn;
  if (k === 'level') { R.level = inp.value; rerender(); return; }
  if (k === 'sort') { R.sort = inp.value; rerender(); return; }
  if (R.form && k in R.form) {
    R.form[k] = inp.value;
    if (k === 'exam') { R.form.date = suggestDate(inp.value); rerender(); }
  }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-sr-in]');
  if (!el) return;
  const k = el.dataset.srIn;
  if (k === 'search') { R.search = el.value; rerender(); return; }
  if (R.form && k in R.form && k !== 'exam') R.form[k] = el.value;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.child && !R.form) { R.child = null; rerender(); } });

// Opened straight at #results before this module was ready: show it now.
if ((location.hash || '').replace('#', '') === 'results' && O.S.admin && O.S.view !== 'results') { O.S.view = 'results'; rerender(); }
window.PolymathSchoolResults = { R, ACT, view, version: SR_UI_VERSION };
