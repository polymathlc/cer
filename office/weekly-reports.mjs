/* ═══════════════════════════════════════════════════════════════════════════
   📈 POLYMATH OFFICE — the Reports tab (weekly-reports.mjs v1.0.0)

   polymathlc.com.sg/office/#reports. Everything about the weekly parent
   progress reports in one place:
     • what parents get, and a 👁 preview of any family's report as it was built
     • when they go out: Off / Email me a preview each Sunday / Email parents
       every Sunday (6 PM Singapore)
     • "Email me this week's reports now" and "Email parents now"
     • a note from the centre printed at the top of every report
     • which families get it (a family can be taken off the list)
     • the log of recent weeks

   It is a module of its own, loaded after office-app.mjs, and plugs into the
   office through window.PolymathOffice (VIEWS, S, render). The office's own
   click/change wiring is untouched: this tab's controls carry data-wr and are
   wired here.

   The reports are BUILT by tools/weekly-reports.mjs in GitHub Actions (every
   half hour it looks at officeSettings/weeklyReports), because only the server
   can read every class, live lesson and Study Buddy row. The tab writes the
   settings and the "now" requests; the sender writes the log and each built
   report (officeSettings/weekly-*, weeklyfam-*), which the tab reads back.
   ═══════════════════════════════════════════════════════════════════════════ */
import * as W from './weekly-report-core.mjs?v=1.0.0';

const WEEKLY_UI_VERSION = '1.0.0';
const O = window.PolymathOffice;
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;
const COL = 'officeSettings';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const R = {
  weekly: W.normalizeWeekly({}), raw: null, loaded: false, error: '',
  logs: [], noteDraft: null, confirmSend: false, confirmMode: '', busy: '',
  preview: null,           // { familyId, weekKey, subject, html, to } shown in the overlay
  famSearch: '', showAllLog: false, unsubs: []
};

/* ─── Data ─── */
function rerender() { if (O && typeof O.render === 'function') O.render(); }
function stopListening() { while (R.unsubs.length) { try { R.unsubs.pop()(); } catch (e) { /* gone */ } } }
function startListening() {
  stopListening();
  R.unsubs.push(db.collection(COL).doc(W.WEEKLY_DOC).onSnapshot(d => {
    R.raw = d.exists ? d.data() : {};
    R.weekly = W.normalizeWeekly(R.raw);
    R.loaded = true; R.error = '';
    rerender();
  }, err => { R.error = (err && err.message) || 'could not be read'; rerender(); }));
  R.unsubs.push(db.collection(COL).where('kind', '==', W.WEEKLY_LOG_KIND).onSnapshot(snap => {
    R.logs = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
    rerender();
  }, err => { console.warn('weekly logs', err); }));
}
firebase.auth().onAuthStateChanged(user => {
  // The office decides who is an admin; wait for it before reading anything.
  setTimeout(function wait(tries) {
    if (!user) { stopListening(); return; }
    if (O.S.admin) { startListening(); return; }
    if ((tries || 0) < 40) setTimeout(() => wait((tries || 0) + 1), 250);
  }, 0);
});

async function saveWeekly(patch, okText) {
  try {
    await db.collection(COL).doc(W.WEEKLY_DOC).set(Object.assign({}, patch, { updatedAt: FV.serverTimestamp(), updatedBy: (O.S.user && O.S.user.email) || '' }), { merge: true });
    if (okText) toast(okText, 'ok');
  } catch (e) { console.error(e); toast('Could not save: ' + ((e && e.message) || e), 'err'); }
}
function toast(msg, kind) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 7000 : 3800);
}
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
function when(ms) {
  if (!ms) return '';
  return W.dayShort(ms) + ', ' + W.clockText(ms);
}

/* ─── Who gets it ─── */
function familiesThisMonth() {
  return (O.S.families || []).filter(f => {
    const st = O.C.familyStateIn(f, O.C.sgMonthKey());
    return st === 'active' && (f.students || []).some(s => s.status === 'active');
  });
}
function nextSunday() {
  const wk = W.weekKeyFor(Date.now());
  const at = W.weekSendAt(wk);
  return at > Date.now() ? at : W.weekSendAt(W.weekKeyFor(Date.now() + 7 * 86400e3));
}

/* ─── The view ─── */
function radio(v) {
  const m = W.WEEKLY_MODE_META[v];
  const on = R.weekly.mode === v;
  return '<label class="radio-card ' + (on ? 'on' : '') + '"><input type="radio" name="wr-mode" value="' + v + '" data-wr="mode" ' + (on ? 'checked' : '') + '><div><b>' + esc(m.title) + '</b><span>' + esc(m.text) + '</span></div></label>';
}
function statusLine() {
  const w = R.weekly;
  const q = w.request;
  const pending = q && q.id !== w.lastRequestDone;
  const bits = [];
  if (pending) bits.push('<div class="banner amber" style="margin:10px 0 0;"><div class="big">⏳</div><div><b>' + (q.kind === 'send' ? 'Emailing parents' : 'Emailing you the reports') + ' — asked ' + esc(timeAgo(q.at)) + '.</b>The reports are built on the centre\'s server, which looks every half hour, so this happens within 30 minutes. You can close this page.</div></div>');
  const check = W.stampMs(R.raw && R.raw.lastCheckAt);
  if (w.lastResult) bits.push('<div class="small muted" style="margin-top:8px;">Last run ' + esc(timeAgo(w.lastRunAt)) + ': ' + esc(w.lastResult) + '</div>');
  bits.push('<div class="small muted" style="margin-top:4px;">' + (check ? 'The server last checked ' + esc(timeAgo(check)) + '.' : 'The server has not checked in yet — it starts within 30 minutes of this feature going live.') + '</div>');
  return bits.join('');
}
function whatParentsGet() {
  return '<div class="card"><h2>👪 What parents get</h2><div class="sub">One email per family every week, from admin@polymathlc.com.sg, covering each child who did something that week.</div>'
    + '<ul style="margin:6px 0 0;padding-left:20px;line-height:1.7;font-size:14px;">'
    + '<li><b>This week at a glance</b>: worksheets done in class, questions answered and marked right in live lessons, practice worksheets done at home.</li>'
    + '<li><b>In class</b>: the worksheets their class covered (from Polymath Online) and the one coming up next.</li>'
    + '<li><b>Live lessons</b>: answered, correct and focus for each Ans Key live lesson.</li>'
    + '<li><b>Practice at home</b>: each worksheet Study Buddy marked, with the score.</li>'
    + '<li><b>Doing well / needs more work</b>: strong and weak topics, and recurring slips (for example "Misread the question") with whether they are improving.</li>'
    + '<li><b>What to practise this week</b>: up to three concrete next steps.</li></ul>'
    + '<p class="small muted" style="margin:10px 0 0;">Only real data is used. A child with nothing that week is left out, and a family with nothing to report gets no email.</p></div>';
}
function scheduleCard() {
  const next = nextSunday();
  return '<div class="card"><h2>🗓️ When they go out</h2><div class="sub">Next Sunday run: ' + esc(when(next)) + '.</div>'
    + '<div class="radio-cards">' + radio('off') + radio('review') + radio('send') + '</div>'
    + (R.confirmMode === 'send' ? '<div class="banner amber" style="margin:10px 0 0;"><div class="big">📤</div><div><b>Email every family their report each Sunday?</b>'
      + familiesThisMonth().filter(f => !R.weekly.optOut[f.id] && O.C.familyEmails(f).length).length + ' families with an email address are on the list. '
      + '<div class="actions" style="margin-top:8px;"><button class="btn" data-wr="modeSendYes">Yes, email parents every Sunday</button><button class="btn ghost" data-wr="modeSendNo">Cancel</button></div></div></div>' : '')
    + statusLine() + '</div>';
}
function nowCard() {
  const w = R.weekly;
  const pending = w.request && w.request.id !== w.lastRequestDone;
  const count = familiesThisMonth().filter(f => !w.optOut[f.id] && O.C.familyEmails(f).length).length;
  return '<div class="card"><h2>⚡ This week, now</h2><div class="sub">Build this week\'s reports (the last 7 days) straight away.</div>'
    + '<div class="actions" style="flex-wrap:wrap;">'
    + '<button class="btn" data-wr="askPreview" ' + (pending ? 'disabled' : '') + '>📨 Email me this week\'s reports</button>'
    + '<button class="btn ghost" data-wr="askSend" ' + (pending || w.mode === 'off' ? 'disabled' : '') + '>📤 Email parents now</button></div>'
    + (w.mode === 'off' ? '<div class="small muted" style="margin-top:6px;">Switch weekly reports on to email parents.</div>' : '')
    + (R.confirmSend ? '<div class="banner amber" style="margin:10px 0 0;"><div class="big">📤</div><div><b>Email this week\'s report to parents now?</b>'
      + 'Up to ' + count + ' families (those with something to report). A family that already got this week\'s report is never sent a second one. The Sunday run then skips them.'
      + '<div class="actions" style="margin-top:8px;"><button class="btn" data-wr="askSendYes">Yes, email parents</button><button class="btn ghost" data-wr="askSendNo">Cancel</button></div></div></div>' : '')
    + '<div class="small muted" style="margin-top:8px;">The office preview goes to chungzhikai@gmail.com and the "Replies go to" address in Settings.</div></div>';
}
function noteCard() {
  const v = R.noteDraft == null ? R.weekly.note : R.noteDraft;
  const changed = R.noteDraft != null && R.noteDraft.trim() !== R.weekly.note;
  return '<div class="card"><h2>✍ Note from the centre</h2><div class="sub">Printed at the top of every report (for example a holiday, an exam tip or a new class). Leave empty for none.</div>'
    + '<div class="field full"><textarea id="wr-note" data-wr-in="note" data-keep="wr-note" maxlength="' + W.NOTE_MAX + '" rows="3" placeholder="e.g. No lessons on 25 Dec. Happy holidays!">' + esc(v) + '</textarea></div>'
    + '<div class="actions"><button class="btn ' + (changed ? '' : 'ghost') + '" data-wr="saveNote">Save note</button>'
    + (R.weekly.note ? '<button class="btn ghost" data-wr="clearNote">Remove note</button>' : '') + '</div></div>';
}
function logCard() {
  if (!R.logs.length) {
    return '<div class="card"><h2>📜 Recent weeks</h2><div class="sub">Nothing has been built yet. Press "Email me this week\'s reports" to see the first ones.</div></div>';
  }
  const latest = R.logs[0];
  const fams = Array.isArray(latest.families) ? latest.families : [];
  const shown = R.showAllLog ? fams : fams.slice(0, 15);
  const rows = shown.map(f => '<tr><td><b>' + esc(f.parentName) + '</b><div class="small muted">' + esc((f.to || []).join(', ') || 'no email address') + '</div></td>'
    + '<td>' + (f.children || []).map(c => esc(c.name) + ' <span class="small muted">' + esc([
      c.worksheets ? c.worksheets + ' in class' : '', c.lessons ? c.lessons + ' live' + (c.correctPct != null ? ' ' + c.correctPct + '%' : '') : '',
      c.practice ? c.practice + ' practice' + (c.practicePct != null ? ' ' + c.practicePct + '%' : '') : ''].filter(Boolean).join(' · ')) + '</span>').join('<br>') + '</td>'
    + '<td class="r">' + (latest.runKind === 'send' ? ((latest.sent || []).includes(f.familyId) ? '<span class="pill green">✓ Emailed</span>' : (latest.already || []).includes(f.familyId) ? '<span class="pill">Sent earlier</span>' : f.to && f.to.length ? '<span class="pill amber">Not sent</span>' : '<span class="pill amber">No email</span>') : '<span class="small muted">Preview only</span>') + '</td>'
    + '<td class="r"><button class="btn ghost small" data-wr="preview" data-f="' + esc(f.familyId) + '" data-w="' + esc(latest.weekKey) + '">👁 Preview</button></td></tr>').join('');
  const c = latest.counts || {};
  return '<div class="card"><h2>📜 Recent weeks</h2><div class="sub">Latest: <b>' + esc(latest.label) + '</b> · ' + esc(latest.runKind === 'send' ? 'emailed to parents' : 'preview for the office')
    + ' · ' + esc(when(latest.at)) + '</div>'
    + '<div class="small" style="margin:4px 0 10px;">' + esc([
      (c.withReport || 0) + ' families with a report',
      latest.runKind === 'send' ? (c.emailed || 0) + ' emailed' : '',
      c.already ? c.already + ' sent earlier' : '', c.noEmail ? c.noEmail + ' without an email' : '',
      c.nothing ? c.nothing + ' with nothing this week' : '', c.optedOut ? c.optedOut + ' taken off the list' : '', c.failed ? c.failed + ' failed' : ''].filter(Boolean).join(' · ')) + '</div>'
    + (rows ? '<div class="table-wrap" style="box-shadow:none;"><table class="t"><thead><tr><th>Family</th><th>Children this week</th><th class="r">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '')
    + (fams.length > shown.length ? '<div class="actions" style="margin-top:8px;"><button class="btn ghost small" data-wr="logAll">Show all ' + fams.length + '</button></div>' : '')
    + (R.logs.length > 1 ? '<div class="small muted" style="margin-top:10px;">Earlier: ' + R.logs.slice(1, 8).map(l => esc(l.label + ' (' + (l.runKind === 'send' ? (l.counts && l.counts.emailed || 0) + ' emailed' : 'preview') + ')')).join(' · ') + '</div>' : '')
    + '</div>';
}
function listCard() {
  const fams = familiesThisMonth();
  const q = R.famSearch.trim().toLowerCase();
  const list = fams.filter(f => !q || (f.parentName + ' ' + (f.students || []).map(s => s.name).join(' ')).toLowerCase().includes(q));
  const off = fams.filter(f => R.weekly.optOut[f.id]).length;
  const noEmail = fams.filter(f => !O.C.familyEmails(f).length).length;
  return '<div class="card"><h2>📬 Families who get it</h2><div class="sub">' + (fams.length - off) + ' of ' + fams.length + ' current families'
    + (noEmail ? ' · ' + noEmail + ' have no email address (add one in Families)' : '') + '. Untick a family who asked not to get it.</div>'
    + '<input class="search" type="search" placeholder="Search a family or child" value="' + esc(R.famSearch) + '" data-wr-in="search" data-keep="wr-search" style="margin:4px 0 8px;width:100%;max-width:340px;">'
    + '<div style="max-height:320px;overflow:auto;">' + list.map(f => {
      const em = O.C.familyEmails(f);
      return '<label class="check" style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line, #e7eef0);">'
        + '<input type="checkbox" data-wr="optToggle" data-f="' + esc(f.id) + '" ' + (R.weekly.optOut[f.id] ? '' : 'checked') + (em.length ? '' : ' disabled') + '>'
        + '<span><b>' + esc(f.parentName || 'Family') + '</b> <span class="small muted">' + esc((f.students || []).filter(s => s.status === 'active').map(s => s.name).join(', ')) + '</span>'
        + '<br><span class="small muted">' + esc(em.join(', ') || 'No email address') + '</span></span></label>';
    }).join('') + (list.length ? '' : '<div class="small muted">No family matches.</div>') + '</div></div>';
}
function previewOverlay() {
  if (!R.preview) return '';
  const p = R.preview;
  return '<div id="wr-overlay" style="position:fixed;inset:0;background:rgba(10,30,36,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:12px;">'
    + '<div style="background:#fff;border-radius:16px;max-width:720px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);">'
    + '<div style="padding:12px 16px;border-bottom:1px solid #e7eef0;display:flex;gap:10px;align-items:center;"><div style="flex:1;min-width:0;"><b>' + esc(p.subject || 'Weekly report') + '</b>'
    + '<div class="small muted">' + esc(p.loading ? 'Loading…' : 'To ' + ((p.to || []).join(', ') || 'no email address')) + '</div></div>'
    + '<button class="btn ghost small" data-wr="closePreview">Close</button></div>'
    + (p.html ? '<iframe title="Report preview" sandbox="" style="border:0;width:100%;flex:1;min-height:70vh;background:#eef5f6;" srcdoc="' + esc(p.html) + '"></iframe>'
      : '<div style="padding:24px;" class="muted">' + esc(p.loading ? 'Loading the report…' : 'This report could not be found.') + '</div>')
    + '</div></div>';
}
function view() {
  if (!R.loaded) {
    return '<div class="page-head"><div><h1>📈 Weekly progress reports</h1><p>' + (R.error ? 'Could not load the settings: ' + esc(R.error) : 'Loading…') + '</p></div></div>';
  }
  return '<div class="page-head"><div><h1>📈 Weekly progress reports</h1><p>"Know exactly how your child is doing, every week." Each family gets one email every Sunday at 6 PM.</p></div></div>'
    + '<div class="grid two">' + scheduleCard() + nowCard() + whatParentsGet() + noteCard() + '</div>'
    + logCard() + listCard()
    + '<div class="small muted" style="margin:14px 0 30px;text-align:right;">Reports ' + WEEKLY_UI_VERSION + ' · rules ' + W.WEEKLY_VERSION + '</div>'
    + previewOverlay();
}
O.VIEWS.reports = view;

/* ─── Actions ─── */
const ACT = {
  mode(el) {
    if (el.value === 'send' && R.weekly.mode !== 'send') { R.confirmMode = 'send'; rerender(); return; }
    R.confirmMode = '';
    saveWeekly({ mode: el.value }, el.value === 'off' ? 'Weekly reports are off.' : 'Saved: the office gets a preview every Sunday.');
  },
  modeSendYes() { R.confirmMode = ''; saveWeekly({ mode: 'send' }, 'Saved: parents are emailed every Sunday at 6 PM.'); },
  modeSendNo() { R.confirmMode = ''; rerender(); },
  askPreview() { request('preview'); },
  askSend() { R.confirmSend = true; rerender(); },
  askSendNo() { R.confirmSend = false; rerender(); },
  askSendYes() { R.confirmSend = false; request('send'); },
  saveNote() {
    const v = (R.noteDraft == null ? R.weekly.note : R.noteDraft).replace(/\r/g, '').trim().slice(0, W.NOTE_MAX);
    R.noteDraft = null;
    saveWeekly({ note: v }, v ? 'Note saved: it is on the next reports.' : 'Note removed.');
  },
  clearNote() { R.noteDraft = null; saveWeekly({ note: '' }, 'Note removed.'); },
  optToggle(el) {
    const id = el.dataset.f;
    if (!id) return;
    // The whole list is written at once (an update replaces the map), so a
    // family put back on the list really leaves it.
    const opt = Object.assign({}, R.weekly.optOut);
    if (el.checked) delete opt[id]; else opt[id] = true;
    R.weekly.optOut = opt;
    const by = (O.S.user && O.S.user.email) || '';
    db.collection(COL).doc(W.WEEKLY_DOC).update({ optOut: opt, updatedAt: FV.serverTimestamp(), updatedBy: by })
      .then(() => toast(el.checked ? 'Back on the list.' : 'Taken off the list: no weekly report for this family.', 'ok'))
      .catch(() => saveWeekly({ optOut: opt }, el.checked ? 'Back on the list.' : 'Taken off the list.'));
  },
  logAll() { R.showAllLog = true; rerender(); },
  async preview(el) {
    const id = W.familyLogId(el.dataset.w, el.dataset.f);
    R.preview = { loading: true };
    rerender();
    try {
      const d = await db.collection(COL).doc(id).get();
      R.preview = d.exists ? Object.assign({ loading: false }, d.data()) : { loading: false };
    } catch (e) { R.preview = { loading: false }; toast('Could not open the report: ' + ((e && e.message) || e), 'err'); }
    rerender();
  },
  closePreview() { R.preview = null; rerender(); }
};
async function request(kind) {
  const q = W.newRequest(kind, (O.S.user && O.S.user.email) || '', Date.now(), Math.random);
  await saveWeekly({ request: q }, kind === 'send' ? 'Asked: parents are emailed within 30 minutes.' : 'Asked: the reports reach your inbox within 30 minutes.');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-wr]');
  if (el && el.type !== 'radio' && el.type !== 'checkbox' && ACT[el.dataset.wr]) {
    e.preventDefault();
    try { const r = ACT[el.dataset.wr](el, e); if (r && r.catch) r.catch(err => toast(String(err && err.message || err), 'err')); } catch (err) { console.error(err); }
    return;
  }
  if (R.preview && e.target && e.target.id === 'wr-overlay') { R.preview = null; rerender(); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-wr]');
  if (el && (el.type === 'radio' || el.type === 'checkbox') && ACT[el.dataset.wr]) ACT[el.dataset.wr](el, e);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-wr-in]');
  if (!el) return;
  if (el.dataset.wrIn === 'note') R.noteDraft = el.value;
  if (el.dataset.wrIn === 'search') { R.famSearch = el.value; rerender(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && R.preview) { R.preview = null; rerender(); } });

// Opened straight at #reports before this module was ready: show it now.
if ((location.hash || '').replace('#', '') === 'reports' && O.S.admin && O.S.view !== 'reports') { O.S.view = 'reports'; rerender(); }
window.PolymathWeeklyReports = { R, ACT, view, version: WEEKLY_UI_VERSION };
