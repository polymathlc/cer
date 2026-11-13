/* ═══════════════════════════════════════════════════════════════════════════
   🏢 POLYMATH OFFICE — the admin app (polymathlc.com.sg/office)

   One page, seven tabs, built so the month is mostly clicking "yes":
     🏠 Home       what needs doing next, and how the month is going
     👪 Families   parents (name, email, WhatsApp, address, sign-up date, their
                   permanent PayNow reference code) with their students under them
     🗓️ Timetable  the /schedule timetable with how many students sit in each class
     📋 Students   every student, filtered by level, subject, mode, day, payment
     🧾 Invoices   prepared from each student's classes and the schedule's fees;
                   sent by email (QR inside) or WhatsApp Web (invoice picture pasted).
                   Custom invoices are written by hand — any parent, any lines,
                   any dates, every field editable — and every invoice chooses
                   its QR: amount filled in, a generic PayNow QR, or none.
     🏦 Payments   drop a bank statement (PDF, Excel, CSV): read, matched to
                   families by reference code / known payer / name / amount /
                   ChatGPT, applied in one click; reminders to whoever still owes
     ⚙️ Settings   invoice day, due days, the autopilot, emails, PayNow, ChatGPT

   Everything that decides a NUMBER or a SENTENCE lives in office-core.mjs, which
   the parents' page (pay/) and the monthly autopilot (tools/office-autopilot.mjs)
   import too. This file is screens, Firestore and the browser's own abilities
   (QR drawing, the clipboard, WhatsApp Web, reading a PDF or a spreadsheet).

   Data (Firestore, CER project mathgen--app, locked by tools/office-rules.mjs):
     officeFamilies/{id}       a parent and their students (embedded)
     officeInvoices/{fam_YYYY-MM}  one invoice per family per month
     officeInvoices/custom_{TAG}   a custom invoice (custom: true), linked to a family or not
     officePayments/{txKey}    every bank credit (or cash) applied — the ledger
     officeStatements/{id}     each uploaded statement and how it was read
     officeSettings/config     the settings; officeSettings/autopilot its heartbeat
     officeLinks/{token}       what a parent's /pay link shows (no contacts)
     mail/polymath-office-*    emails for the Trigger Email extension
   Reads: schedule_config/main (the /schedule page's own document).
   ═══════════════════════════════════════════════════════════════════════════ */
import * as C from './office-core.mjs?v=1.11.0';

const OFFICE_VERSION = 'v1.11.0';

/* ═══════════════ Firebase — the CER project ═══════════════ */
firebase.initializeApp({
  apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
  authDomain: 'mathgen--app.firebaseapp.com',
  projectId: 'mathgen--app',
  storageBucket: 'mathgen--app.firebasestorage.app',
  messagingSenderId: '165654161198',
  appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
  measurementId: 'G-0MWZFG211D'
});
const auth = firebase.auth();
const db = firebase.firestore();
// A field left undefined anywhere must never make a whole save fail.
try { db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) { /* already configured */ }
const fns = firebase.app().functions('us-central1');
const FV = firebase.firestore.FieldValue;
const COL = C.COLLECTIONS;
const PROBE_URL = 'https://firestore.googleapis.com/v1/projects/mathgen--app/databases/(default)/documents/' + COL.settings + '/config';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const AI_TEXT_CHUNK = 45000;          // characters of statement text per ChatGPT call
const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

/* ═══════════════ State ═══════════════ */
const S = {
  user: null, admin: false,
  protected: null,                    // true = locked, false = OPEN (refuse to save), null = could not tell
  schedule: { slots: {} }, scheduleLoaded: false,
  settings: C.normalizeSettings({}), settingsLoaded: false, autopilot: null,
  families: [], familiesLoaded: false,
  invoices: [], invoicesLoaded: false,
  payments: [], paymentsLoaded: false,
  statements: [],
  announcements: [],                  // the log of announcements sent
  listenErrors: {},
  view: 'home',
  period: C.sgMonthKey(),
  ui: {
    famSearch: '', famFilter: 'all', famType: '', famView: savedFamView(),
    famSort: savedFamSort(), famF: C.cleanFamilyFilters({}), famPanel: false,
    statMonth: '', statsOpen: savedStatsOpen(), famZoom: savedFamZoom(),
    ann: { draft: savedAnnDraft(), status: 'active', type: '', F: C.cleanFamilyFilters({}), search: '', excluded: [], panel: false, preview: '' },
    stuSearch: '', stu: { level: '', subject: '', mode: '', day: '', status: 'active', pay: '', cls: '' }, stuSort: { key: 'name', dir: 1 },
    tt: { level: '', subject: '', mode: '' },
    invFilter: 'all', invSearch: ''
  },
  modal: null, drawer: null,
  review: null,                       // the statement being reviewed
  lastApply: null,                    // the result card after applying payments
  mailState: {}                       // mailId → delivery state, read on demand
};
// The Families tab remembers cards or table on this computer only.
function savedFamView() { try { return localStorage.getItem('polymath-office-famview') === 'table' ? 'table' : 'cards'; } catch (e) { return 'cards'; } }
function rememberFamView(v) { try { localStorage.setItem('polymath-office-famview', v); } catch (e) { /* private window */ } }
// …and how the families are sorted (by level unless changed).
function savedFamSort() { try { const v = localStorage.getItem('polymath-office-famsort'); return C.FAMILY_SORT_KEYS.includes(v) ? v : 'level'; } catch (e) { return 'level'; } }
// …and whether the statistics on top of Families are shown or folded away.
function savedStatsOpen() { try { return localStorage.getItem('polymath-office-stats') !== 'closed'; } catch (e) { return true; } }
function rememberStatsOpen(v) { try { localStorage.setItem('polymath-office-stats', v ? 'open' : 'closed'); } catch (e) { /* private window */ } }
// The announcement being written is kept on this computer until it is sent.
function savedAnnDraft() { try { const d = JSON.parse(localStorage.getItem('polymath-office-announce') || 'null'); return Object.assign(C.emptyAnnouncement(), d || {}); } catch (e) { return C.emptyAnnouncement(); } }
function rememberAnnDraft(d) { try { localStorage.setItem('polymath-office-announce', JSON.stringify(d)); } catch (e) { /* private window */ } }
// …and how far the Families list is zoomed out (− / +), so more fits on screen.
const FAM_ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];
function savedFamZoom() { try { const v = Number(localStorage.getItem('polymath-office-famzoom')); return v >= 0.5 && v <= 1.25 ? v : 1; } catch (e) { return 1; } }
function rememberFamZoom(v) { try { localStorage.setItem('polymath-office-famzoom', String(v)); } catch (e) { /* private window */ } }
function rememberFamSort(v) { try { localStorage.setItem('polymath-office-famsort', v); } catch (e) { /* private window */ } }
let IX = { fam: new Map(), invByFam: new Map(), invById: new Map(), payByKey: new Map(), roster: new Map(), rows: [] };
const unsubs = [];

/* ═══════════════ Small helpers ═══════════════ */
const $ = id => document.getElementById(id);
const esc = C.escapeHtml;
const money = C.money;
const rnd = n => Array.from(crypto.getRandomValues(new Uint32Array(n)));
const today = () => C.sgDayKey();
const by = (k, dir = 1) => (a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0);
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function sid() { return 's' + C.newToken(rnd, 9); }
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 7000 : 3800);
}
function busy(el, on) { if (el) { el.classList.toggle('busy', !!on); el.disabled = !!on; } }
function fail(what, err) {
  console.error(what, err);
  toast(what + ': ' + friendlyError(err), 'err');
}
function friendlyError(err) {
  const code = err && (err.code || '');
  const msg = String((err && err.message) || err || '');
  if (/permission/i.test(code) || /permission/i.test(msg)) return 'not allowed — are you signed in with an office account?';
  if (/unavailable|network/i.test(code + msg)) return 'no connection — check the internet and try again.';
  return msg.replace(/^FirebaseError:\s*/, '').slice(0, 220);
}
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' minutes ago';
  if (s < 86400 * 1.5) return Math.round(s / 3600) + ' hours ago';
  return Math.round(s / 86400) + ' days ago';
}
function tsMs(v) { return v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : (v && v.seconds ? v.seconds * 1000 : 0)); }
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || 'Copied', 'ok'); }
  catch (e) { window.prompt('Copy this:', text); }
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-src="' + src + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function greeting() {
  const h = Number(new Date(Date.now() + C.SG_UTC_OFFSET_MS).toISOString().slice(11, 13));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function longToday() {
  const d = new Date(Date.now() + C.SG_UTC_OFFSET_MS);
  return d.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/* ═══════════════ Indexes (rebuilt whenever data arrives) ═══════════════ */
function reindex() {
  const fam = new Map(S.families.map(f => [f.id, f]));
  const invByFam = new Map(), invById = new Map();
  S.invoices.forEach(inv => {
    invById.set(inv.id, inv);
    const a = invByFam.get(inv.familyId) || []; a.push(inv); invByFam.set(inv.familyId, a);
  });
  invByFam.forEach(a => a.sort(by('period', -1)));
  const payByKey = new Map(S.payments.map(p => [p.id, p]));
  IX = { fam, invByFam, invById, payByKey, roster: C.slotRoster(S.families, S.schedule), rows: C.studentRows(S.families, S.schedule), rec: new Map(), shared: C.sharedEmails(S.families) };
}
// A family's payment record (months paid, last payment, last screenshot), worked
// out once per data change and kept until the next one.
function recordOf(f) {
  if (!f) return null;
  if (f.id && IX.rec.has(f.id) && IX.fam.get(f.id) === f) return IX.rec.get(f.id);
  const r = C.familyPaymentRecord(f, S.invoices, S.payments, { today: today(), settings: S.settings });
  if (f.id && IX.fam.get(f.id) === f) IX.rec.set(f.id, r);
  return r;
}
// 🏫 physical · 💻 online · ⭐ Master class — how a child takes one class.
function modeIcon(mode) { return (C.CLASS_MODE_META[mode] || C.CLASS_MODE_META.Physical).icon; }
const MODE_CHOICES = C.CLASS_MODES.map(m => [m, C.classModeLabel(m)]);
function monthDots(months, n) {
  // The months around this one: two before, this month, and the rest ahead.
  return '<span class="mdots">' + C.monthsAround(months, C.sgMonthKey(), 2, Math.max(0, n - 3)).map(m => '<span class="md ' + m.key + (m.current ? ' cur' : '') + (m.joint ? ' joint j-' + m.joint : '') + '" title="' + esc(C.periodLabel(m.period) + ': ' + (m.stateLabel || C.MONTH_STATE_META[m.key].label)) + '">' + esc(m.label) + '</span>').join('') + '</span>';
}
function whenText(dayKey) {
  if (!C.isDayKey(dayKey)) return '';
  return C.daysAgoText(C.daysBetween(dayKey, today()), dayKey);
}
const famById = id => IX.fam.get(id) || null;
const invoicesOf = id => IX.invByFam.get(id) || [];
// The family's MONTHLY invoice for a month — a custom invoice in the same month
// is extra, never the month's bill, so it never stops the month being prepared.
const invoiceFor = (famId, period) => invoicesOf(famId).find(i => i.period === period && !i.custom) || null;
const periodInvoices = period => S.invoices.filter(i => i.period === period);
const familyOwing = id => C.round2(invoicesOf(id).reduce((s, i) => s + C.invoiceOutstanding(i), 0));
const stateOf = inv => C.invoiceState(inv, today());
// The family's status this month: active, paused or withdrawn.
const famNow = f => C.familyStateIn(f, C.sgMonthKey());
function famStateFor(f, period) {
  // A covered month (December 2026) shows the lead month's invoice (November).
  const inv = invoiceFor(f.id, C.billingPeriodOf(period, S.settings));
  if (inv) return Object.assign({ inv }, stateOf(inv));
  const now = C.familyStateIn(f, period);
  if (now === 'withdrawn') return { key: 'withdrawn', label: 'Withdrawn', tone: 'grey', icon: '👋' };
  if (now === 'paused') return { key: 'paused', label: 'Paused', tone: 'grey', icon: '⏸' };
  if (!C.familyIsBillable(f, period)) return C.packageCovers(f, period) ? { key: 'package', label: 'Package', tone: 'green', icon: '📦' } : { key: 'none', label: 'No active students', tone: 'grey', icon: '·' };
  return { key: 'noinv', label: 'Not invoiced', tone: 'grey', icon: '📝' };
}
function studentsWithoutClass() {
  return IX.rows.filter(r => r.status === 'active' && !r.classes.length && !(C.feeNum((r.family.students.find(s => s.id === r.studentId) || {}).monthlyFee)));
}
function billableWithoutInvoice(period) {
  if (C.isCoveredMonth(period, S.settings)) return [];   // paid with the month before
  return S.families.filter(f => C.familyIsBillable(f, period) && !invoiceFor(f.id, period));
}
function allOwing() { return C.stillOwing(S.invoices, today()); }
function overdueInvoices() { return S.invoices.filter(i => stateOf(i).key === 'overdue'); }

/* ═══════════════ Sign-in ═══════════════ */
$('signin-btn').addEventListener('click', async () => {
  $('signin-note').textContent = '';
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithPopup(provider);
  } catch (e) {
    if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
    if (e && e.code === 'auth/popup-blocked') { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; }
    $('signin-note').textContent = 'Sign-in failed: ' + friendlyError(e);
  }
});
auth.onAuthStateChanged(async user => {
  $('loading').classList.add('hidden');
  const email = user && String(user.email || '').toLowerCase();
  const ok = !!(user && user.emailVerified && C.OFFICE_ADMINS.includes(email));
  if (user && !ok) {
    await auth.signOut();
    $('signin-note').textContent = (email || 'That account') + ' is not an office account.';
  }
  S.user = ok ? user : null; S.admin = ok;
  $('signin').classList.toggle('hidden', ok);
  $('app').classList.toggle('hidden', !ok);
  if (ok) start(); else stop();
});
function stop() { while (unsubs.length) { try { unsubs.pop()(); } catch (e) { /* already gone */ } } }

/* ═══════════════ Start: the lock check, then live data ═══════════════ */
async function probeProtection() {
  // A SIGNED-OUT read of an office document must be refused. If it is not, the
  // shared catch-all is still open for office collections and nothing is saved.
  try {
    const r = await fetch(PROBE_URL, { cache: 'no-store', credentials: 'omit' });
    S.protected = r.status === 403 ? true : (r.status === 200 || r.status === 404) ? false : null;
  } catch (e) { S.protected = null; }
  render();
}
function requireProtected() {
  if (S.protected === false) {
    toast('Parent data is not locked yet, so nothing can be saved. See the red note at the top.', 'err');
    return false;
  }
  return true;
}
function listen(name, query, onData) {
  const off = query.onSnapshot(snap => { delete S.listenErrors[name]; onData(snap); reindex(); render(); },
    err => { console.error(name, err); S.listenErrors[name] = friendlyError(err); render(); });
  unsubs.push(off);
}
function start() {
  stop();
  $('who-email').textContent = S.user.email;
  $('version').textContent = 'Polymath Office ' + OFFICE_VERSION;
  $('version').classList.remove('hidden');
  probeProtection();
  listen('schedule', db.collection('schedule_config').doc('main'), d => { S.schedule = Object.assign({ slots: {} }, d.exists ? d.data() : {}); S.scheduleLoaded = true; });
  listen('settings', db.collection(COL.settings).doc('config'), d => { S.settingsRaw = d.exists ? d.data() : {}; S.settings = C.normalizeSettings(S.settingsRaw); S.settingsLoaded = true; });
  listen('autopilot', db.collection(COL.settings).doc('autopilot'), d => { S.autopilot = d.exists ? d.data() : null; });
  listen('families', db.collection(COL.families), snap => {
    S.families = snap.docs.map(d => Object.assign(C.normalizeFamily(Object.assign({}, d.data(), { id: d.id })), { _raw: d.data() })).sort((a, b) => a.parentName.localeCompare(b.parentName));
    S.familiesLoaded = true;
  });
  listen('invoices', db.collection(COL.invoices).where('period', '>=', C.addMonths(C.sgMonthKey(), -14)), snap => {
    S.invoices = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    S.invoicesLoaded = true;
  });
  listen('payments', db.collection(COL.payments).orderBy('appliedAt', 'desc').limit(500), snap => {
    S.payments = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    S.paymentsLoaded = true;
  });
  listen('announcements', db.collection(COL.settings).where('kind', '==', 'announcement'), snap => {
    S.announcements = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.sentAtMs || 0) - (a.sentAtMs || 0));
  });
  listen('statements', db.collection(COL.statements).orderBy('uploadedAt', 'desc').limit(12), snap => {
    S.statements = snap.docs.map(d => { const x = d.data(); return { id: d.id, fileName: x.fileName, uploadedAt: x.uploadedAt, summary: x.summary || {}, appliedAt: x.appliedAt, from: x.from, to: x.to, aiUsed: x.aiUsed }; });
  });
  const hv = (location.hash || '').replace('#', '');
  if (VIEWS[hv]) S.view = hv;
  render();
}

/* ═══════════════ Rendering ═══════════════ */
let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; doRender(); });
}
function keepFocus(fn) {
  const a = document.activeElement;
  const key = a && a.dataset && a.dataset.keep;
  const pos = key && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (key) {
    const el = document.querySelector('[data-keep="' + key + '"]');
    if (el) { el.focus(); if (pos) try { el.setSelectionRange(pos[0], pos[1]); } catch (e) { /* not a text box */ } }
  }
}
function doRender() {
  if (!S.admin) return;
  renderTabs();
  $('banners').innerHTML = bannersHtml();
  keepFocus(() => { $('view').innerHTML = VIEWS[S.view](); });
  hydrate($('view'));
  if (S.drawer) renderDrawer();
  // The invoice dialog only shows data, so it follows every change live
  // (a send, a payment) — unless its lines are being edited.
  if (S.modal && S.modal.type === 'invoice' && !S.modal.edit) renderModal();
}
function go(view) {
  if (!VIEWS[view]) return;
  S.view = view;
  history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0 });
  render();
}
function renderTabs() {
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === S.view));
  const set = (k, n) => { const el = document.querySelector('[data-count="' + k + '"]'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); };
  set('families', S.families.filter(f => famNow(f) === 'active').length);
  set('students', IX.rows.filter(r => r.status === 'active').length);
  const p = periodInvoices(C.sgMonthKey());
  set('invoices', p.filter(i => stateOf(i).key === 'draft').length + billableWithoutInvoice(C.sgMonthKey()).length);
}
// Draw QR codes and invoice pictures into whatever was just rendered.
function hydrate(root) {
  root.querySelectorAll('[data-qr]').forEach(el => {
    if (el.dataset.drawn === el.dataset.qr) return;
    el.dataset.drawn = el.dataset.qr;
    renderQr(el, el.dataset.qr, Number(el.dataset.size) || 200);
  });
  root.querySelectorAll('img[data-invimg]').forEach(async img => {
    if (img.dataset.done) return;
    img.dataset.done = '1';
    const inv = IX.invById.get(img.dataset.invimg);
    if (inv) { try { img.src = await invoiceImage(inv); } catch (e) { img.alt = 'Could not draw the invoice'; } }
  });
}

/* ─── Shared bits of markup ─── */
function pill(st) { return '<span class="pill ' + st.tone + '">' + st.icon + ' ' + esc(st.label) + (st.daysOverdue ? ' · ' + st.daysOverdue + 'd' : '') + '</span>'; }
function subjChip(subject, master, text) {
  const k = master ? 'master' : (C.subjectKey(subject) || 'other');
  const ico = master ? '⭐' : k === 'math' ? '➗' : k === 'science' ? '🔬' : '📘';
  return '<span class="subj ' + k + '">' + ico + ' ' + esc(text || subject || 'Class') + '</span>';
}
function classChips(row) {
  if (!row.classes.length) return '<span class="warn-t">⚠ Not in a class</span>';
  return row.classes.map(c => {
    const slot = c.slotId ? C.scheduleSlot(S.schedule, c.slotId) : null;
    return subjChip(c.subject, c.mode === 'Master' || (slot && C.isMaster(slot)), (c.when ? c.when + ' · ' : '') + (c.subject || c.title) + (c.mode === 'Online' ? ' 💻' : ''));
  }).join(' ');
}
function stepHtml(tone, ico, title, text, buttons) {
  return '<div class="step ' + tone + '"><div class="ico">' + ico + '</div><div class="txt"><b>' + title + '</b><span>' + text + '</span></div>'
    + '<div class="actions">' + (buttons || '') + '</div></div>';
}
function emptyHtml(ico, title, text, buttons) {
  return '<div class="empty"><div class="big">' + ico + '</div><b>' + title + '</b><p>' + text + '</p>' + (buttons ? '<div class="actions" style="justify-content:center;margin-top:16px;">' + buttons + '</div>' : '') + '</div>';
}
function bannersHtml() {
  let h = '';
  if (S.protected === false) {
    h += '<div class="banner red"><div class="big">🔓</div><div><b>Parent data is not locked yet — nothing can be saved.</b>'
      + 'The shared Firestore rules still let anyone read office documents. In GitHub: <code>polymathlc/cer</code> → Actions → <code>Polymath Office rules</code> → Run workflow with <b>apply</b> ticked. Then '
      + '<button class="linkbtn" data-act="recheckLock">check again</button>.</div></div>';
  }
  const errs = Object.entries(S.listenErrors);
  if (errs.length) h += '<div class="banner amber"><div class="big">⚠️</div><div><b>Some data could not be loaded.</b>' + errs.map(([k, v]) => esc(k) + ': ' + esc(v)).join(' · ') + '</div></div>';
  if (S.scheduleLoaded && !Object.keys(S.schedule.slots || {}).length) {
    h += '<div class="banner amber"><div class="big">🗓️</div><div><b>The class schedule is empty.</b>Fees come from <a href="../schedule/#admin" target="_blank" rel="noopener">polymathlc.com.sg/schedule</a> — set up the classes and their monthly fees there.</div></div>';
  }
  return h;
}

/* ═══════════════ 🏠 Home ═══════════════ */
const VIEWS = {};
VIEWS.home = function () {
  if (!S.familiesLoaded || !S.invoicesLoaded) return emptyHtml('⏳', 'Loading…', 'Fetching families and invoices.');
  // In a covered month (December 2026) the month being collected is the lead month's.
  const period = C.billingPeriodOf(C.sgMonthKey(), S.settings);
  const label = C.billingPeriodLabel(period, S.settings);
  const invs = periodInvoices(period);
  const sum = C.periodSummary(invs, today());
  const active = S.families.filter(f => famNow(f) === 'active');
  const students = IX.rows.filter(r => r.status === 'active');
  const noClass = studentsWithoutClass();
  const missing = billableWithoutInvoice(period);
  const overdue = overdueInvoices();
  const owing = allOwing();
  const lastSt = S.statements[0];
  const steps = [];
  if (!S.families.length) {
    steps.push(stepHtml('amber', '👪', 'Add your families', 'Bring in your Excel or Google Sheet in one go, or add families one at a time.',
      '<button class="btn" data-act="openImport">⬆ Import a spreadsheet</button><button class="btn ghost" data-act="newFamily">＋ Add a family</button>'));
  }
  if (noClass.length) {
    steps.push(stepHtml('amber', '🧩', C.plural(noClass.length, 'student is', 'students are') + ' not in a class', 'Put them in a class so their fees can be worked out from the schedule.',
      '<button class="btn ghost" data-act="showNoClass">Show them</button>'));
  }
  if (missing.length) {
    steps.push(stepHtml('', '🧾', label + ' invoices: ' + C.plural(missing.length, 'family has', 'families have') + ' no invoice yet', 'Prices come straight from each student\'s classes on the schedule. You check them before anything is sent.',
      '<button class="btn" data-act="openPrepare">Prepare ' + esc(C.MONTHS[Number(period.slice(5)) - 1]) + ' invoices</button>'));
  }
  if (sum.draft) {
    steps.push(stepHtml('', '📨', C.plural(sum.draft, 'invoice is', 'invoices are') + ' ready to send', 'Email sends each family their invoice with the PayNow QR inside. WhatsApp is for families without email.',
      '<button class="btn" data-act="emailDrafts">✉ Email them</button><button class="btn wa" data-act="waQueueDrafts">💬 WhatsApp</button>'));
  }
  if (overdue.length) {
    steps.push(stepHtml('red', '⚠️', C.plural(overdue.length, 'invoice is', 'invoices are') + ' overdue', 'Upload your latest bank statement first, so families who have paid are not reminded.',
      '<button class="btn ghost" data-act="pickStatement">🏦 Upload statement</button><button class="btn" data-act="openReminders">🔔 Send reminders</button>'));
  }
  const stLine = lastSt ? 'Last statement: ' + esc(lastSt.fileName || '') + ', ' + timeAgo(tsMs(lastSt.uploadedAt)) + '.' : 'No statement uploaded yet.';
  if (owing.length && !overdue.length) {
    steps.push(stepHtml('', '🏦', 'Check who has paid', stLine + ' Drop in the latest one and payments are matched for you.',
      '<button class="btn" data-act="pickStatement">Upload a bank statement</button>'));
  }
  if (!steps.length) steps.push(stepHtml('green', '🎉', 'All caught up', 'Every family is invoiced and nothing is overdue. ' + stLine, '<button class="btn ghost" data-act="pickStatement">Upload a statement</button>'));

  const total = Math.max(1, sum.count);
  const w = n => (n / total * 100).toFixed(2) + '%';
  const ap = S.settings.autopilot;
  const apLine = ap === 'off' ? 'Autopilot is off — invoices are prepared when you press the button.'
    : (ap === 'send' ? 'Autopilot emails invoices on day ' + S.settings.invoiceDay + ' of each month.' : 'Autopilot prepares invoices on day ' + S.settings.invoiceDay + ' and emails you to check them.')
      + (S.autopilot && S.autopilot.lastRunAt ? ' Last ran ' + timeAgo(tsMs(S.autopilot.lastRunAt)) + '.' : ' It has not run yet.');
  return '<div class="page-head"><div><h1>' + greeting() + (S.user.email.startsWith('chungzhikai') ? ', Mr Chung' : '') + '</h1><p>' + esc(longToday()) + '</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="newFamily">＋ Family</button><button class="btn ghost" data-act="recordPayment">💵 Record a payment</button></div></div>'
    + '<div class="card"><h2>Next steps</h2><div class="sub">Do these from top to bottom.</div><div class="steps">' + steps.join('') + '</div></div>'
    + '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;"><h2>' + esc(label) + ' at a glance</h2>'
    + '<button class="linkbtn" data-act="go" data-to="invoices">Open invoices →</button></div>'
    + '<div class="statusbar" title="Paid, waiting, overdue, not sent"><span class="g" style="width:' + w(sum.paid) + '"></span><span class="a" style="width:' + w(sum.waiting + sum.part) + '"></span><span class="r" style="width:' + w(sum.overdue) + '"></span><span class="n" style="width:' + w(sum.draft) + '"></span></div>'
    + '<div class="legend"><span><i style="background:#22c55e"></i>Paid ' + sum.paid + '</span><span><i style="background:#f59e0b"></i>Waiting ' + (sum.waiting + sum.part) + '</span><span><i style="background:#ef4444"></i>Overdue ' + sum.overdue + '</span><span><i style="background:#cbd5d8"></i>Not sent ' + sum.draft + '</span>'
    + (missing.length ? '<span class="muted">· ' + missing.length + ' not invoiced</span>' : '') + '</div>'
    + '<div class="stats" style="margin-top:18px;">'
    + '<div class="stat deep"><div class="label">Billed</div><div class="value">' + money(sum.billed) + '</div><div class="hint">' + C.plural(sum.count, 'invoice') + '</div></div>'
    + '<div class="stat green"><div class="label">Collected</div><div class="value">' + money(sum.collected) + '</div><div class="hint">' + sum.percent + '% of ' + esc(label) + '</div></div>'
    + '<div class="stat amber"><div class="label">Still to collect</div><div class="value">' + money(sum.outstanding) + '</div><div class="hint">this month</div></div>'
    + '<div class="stat ' + (overdue.length ? 'red' : '') + '"><div class="label">Owed overall</div><div class="value">' + money(owing.reduce((s, i) => s + C.invoiceOutstanding(i), 0)) + '</div><div class="hint">' + C.plural(new Set(owing.map(i => i.familyId)).size, 'family', 'families') + ', all months</div></div>'
    + '</div></div>'
    + '<div class="grid two" style="margin-top:18px;">'
    + '<div class="card"><h2>🏦 Drop a bank statement</h2><div class="sub">PDF, Excel or CSV from DBS/POSB or any bank.</div>' + dropHtml() + '</div>'
    + '<div class="card"><h2>📊 The centre</h2><div class="sub">' + esc(apLine) + '</div>'
    + '<div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));">'
    + '<div class="stat"><div class="label">Families</div><div class="value">' + active.length + '</div><div class="hint">active</div></div>'
    + '<div class="stat"><div class="label">Students</div><div class="value">' + students.length + '</div><div class="hint">' + (noClass.length ? noClass.length + ' without a class' : 'all in a class') + '</div></div>'
    + '</div></div></div>';
};
function dropHtml() {
  return '<div class="drop" data-act="pickStatement" data-drop="statement"><div class="big">📄</div><b>Drop the statement here</b><span>or click to choose a file · ' + (S.settings.useAi ? 'ChatGPT reads it and matches payments' : 'read on this computer') + '</span></div>';
}

/* ═══════════════ 👪 Families ═══════════════
   Every confirmed sign-up is a family record: status, the ONE account email,
   the parent, WhatsApp, and each child's school, start date, type of lesson,
   slots on the schedule, payment record and notes. Cards for a quick look;
   the table lists one row per child with every field, and downloads as CSV. */
const FAM_FILTERS = {
  all: f => famNow(f) === 'active',
  owing: f => familyOwing(f.id) > 0,
  unpaid: f => famNow(f) === 'active' && C.familyIsBillable(f, C.sgMonthKey()) && !recordOf(f).thisMonthPaid,
  noshot: f => famNow(f) === 'active' && C.familyIsBillable(f) && !(recordOf(f).lastScreenshot && recordOf(f).lastScreenshot.date.slice(0, 7) === C.sgMonthKey()),
  noemail: f => famNow(f) !== 'withdrawn' && !C.familyEmails(f).length,
  shared: f => C.familyEmails(f).some(e => IX.shared.has(e)),
  noclass: f => studentsWithoutClass().some(r => r.familyId === f.id),
  package: f => famNow(f) !== 'withdrawn' && f.paymentType === 'package',
  hardcopy: f => famNow(f) !== 'withdrawn' && f.hardcopy,
  paused: f => f.status === 'paused',
  withdrawn: f => f.status === 'withdrawn' || f.withdrawn,
  // The older "Not active" chip (a link or a saved choice): the withdrawn families.
  inactive: f => f.status === 'withdrawn' || f.withdrawn
};
function familyMatchesType(f, type) {
  if (!type) return true;
  return f.students.some(s => s.status !== 'left' && C.studentHasLessonType(s, type, S.schedule));
}
function familyMatchesSearch(f, q) {
  if (!q) return true;
  const hay = C.normText([f.parentName, f.email, f.email2, f.whatsapp, f.code, f.address, f.notes,
    ...f.students.map(s => s.name + ' ' + s.school + ' ' + s.notes + ' ' + C.studentLessonTypes(s, S.schedule).map(C.lessonTypeLabel).join(' '))].join(' '));
  return q.split(' ').every(w => hay.includes(w));
}
// The filter panel's context for one family (its payment record is cached).
function famFilterCtx(f) { return { schedule: S.schedule, invoices: S.invoices, payments: S.payments, today: today(), record: recordOf(f) }; }
function familyList() {
  const q = C.normText(S.ui.famSearch);
  const F = S.ui.famF;
  const list = S.families.filter(FAM_FILTERS[S.ui.famFilter] || FAM_FILTERS.all)
    .filter(f => familyMatchesType(f, S.ui.famType))
    .filter(f => familyMatchesSearch(f, q))
    .filter(f => C.familyMatchesFilters(f, F, famFilterCtx(f)));
  if (!childFiltersOn()) return C.sortFamilies(list, S.ui.famSort);
  // With a child filter on, a family is placed by the children who match
  // (filtered to P6, a family with a P4 and a P6 child sits under P6).
  const byId = new Map(list.map(f => [f.id, f]));
  return C.sortFamilies(list.map(shownKidsOnly), S.ui.famSort).map(p => byId.get(p.id));
}
function shownKidsOnly(f) { return Object.assign({}, f, { students: f.students.filter(kidShown) }); }
// A child is shown (in the table, or bright on a card) when it passes the
// type of lesson and every child filter of the panel.
function kidShown(s) {
  if (!s || s.status === 'left') return false;
  if (S.ui.famType && !C.studentHasLessonType(s, S.ui.famType, S.schedule)) return false;
  return !C.hasChildFilters(S.ui.famF) || C.studentMatchesFilters(s, S.ui.famF, S.schedule);
}
function childFiltersOn() { return !!S.ui.famType || C.hasChildFilters(S.ui.famF); }
function recordRows(list) {
  const rows = C.familyRecordRows(list, { schedule: S.schedule, invoices: S.invoices, payments: S.payments, today: today(), settings: S.settings });
  // The table shows only the children of the type and the filters chosen.
  const kids = new Map();
  list.forEach(f => f.students.forEach(s => kids.set(f.id + '|' + s.id, s)));
  const shown = childFiltersOn() ? rows.filter(r => !r.studentId || kidShown(kids.get(r.familyId + '|' + r.studentId))) : rows;
  return C.sortRecordRows(shown, S.ui.famSort);
}
// Sorted by level: the cards and rows fall under a heading per level.
// A family with children at more than one level sits under its youngest
// child's level (oldest when sorted S1 → P3); its card still shows every child.
function levelSorted() { return S.ui.famSort === 'level' || S.ui.famSort === 'level-desc'; }
function familyGroupLevel(f) {
  const r = C.familyLevelRank(childFiltersOn() ? shownKidsOnly(f) : f, S.ui.famSort === 'level-desc');
  return C.LEVELS[r] || '';
}
function levelName(level) {
  if (!level) return 'No level yet';
  return (level[0] === 'S' ? 'Secondary ' : 'Primary ') + level.slice(1);
}
function levelHeading(level, n, one, many) { return levelName(level) + ' · ' + C.plural(n, one, many); }
const FAM_FILTER_LABELS = {
  level: v => C.levelLabel(v),
  subject: v => v,
  mode: v => C.classModeLabel(v),
  day: v => (C.DAYS.find(d => d.code === v) || { name: v }).name,
  slot: v => C.slotChoiceLabel(S.schedule, v),
  school: v => '🏫 ' + v,
  lessonType: v => C.lessonTypeLabel(v),
  payment: v => v === 'package' ? '📦 Package' : 'Monthly',
  hardcopy: v => v === 'yes' ? '📮 Hardcopy' : 'No hardcopy',
  withdrawn: v => v === 'yes' ? '👋 Withdrawn' : 'Not withdrawn',
  paid: v => (v === 'paid' ? '✅ Paid ' : '⏳ Not paid ') + C.periodLabel(C.isPeriod(S.ui.famF.month) ? S.ui.famF.month : C.sgMonthKey())
};
/* ── 📊 Key statistics on top of Families ──
   For every active family, or — once a search, chip or filter narrows the
   list — for the families shown (and, with a child filter, only the children
   who match). The basis of each figure is spelt out under the tiles. */
function famFiltered() {
  return S.ui.famFilter !== 'all' || !!C.normText(S.ui.famSearch) || childFiltersOn() || C.activeFamilyFilters(S.ui.famF).length > 0;
}
function statMonths() {
  const months = [];
  for (let p = C.RECORD_START; p <= C.RECORD_END; p = C.addMonths(p, 1)) months.push(p);
  const cur = C.sgMonthKey();
  if (!months.includes(cur)) months.push(cur);
  return months.sort();
}
// What the statistics count: every family, or the ones the filters show.
function statScope() {
  const filtered = famFiltered();
  return {
    filtered, period: C.isPeriod(S.ui.statMonth) ? S.ui.statMonth : C.sgMonthKey(),
    families: filtered ? familyList() : S.families,
    kidFilter: filtered && childFiltersOn() ? kidShown : null
  };
}
function famStatsHtml(list) {
  const sc = statScope();
  const period = sc.period;
  const filtered = sc.filtered;
  const st = C.familyStats(filtered ? list : S.families, {
    schedule: S.schedule, invoices: S.invoices, period, today: today(), settings: S.settings,
    kidFilter: sc.kidFilter
  });
  const mo = C.monthShort(period);
  const scope = filtered ? '<span class="pill amber" title="The figures follow the search and filters below">Families shown · filters on</span>' : '<span class="pill green">All active families</span>';
  const monthSel = '<select class="plain" id="stat-month" data-ch="statMonth" aria-label="Month for the statistics">'
    + statMonths().map(p => '<option value="' + p + '" ' + (p === period ? 'selected' : '') + '>' + esc(C.periodLabel(p)) + (p === C.sgMonthKey() ? ' (this month)' : '') + '</option>').join('') + '</select>';
  const head = '<div class="kpi-head"><div class="kpi-title"><h2>📊 Key statistics</h2>' + scope + '</div>'
    + '<div class="kpi-tools">' + (S.ui.statsOpen ? monthSel : '') + '<button class="btn ghost small" data-act="toggleStats" aria-expanded="' + !!S.ui.statsOpen + '" aria-controls="fam-stats-body">' + (S.ui.statsOpen ? 'Hide' : 'Show') + '</button></div></div>';
  if (!S.ui.statsOpen) {
    return '<section class="kpis folded" id="fam-stats">' + head
      + '<div class="kpi-mini">' + C.plural(st.students, 'student', 'students') + ' · ➗ ' + st.categories.math.students + ' Math · 🔬 ' + st.categories.science.students + ' Science · ' + money(st.net) + ' a month</div></section>';
  }
  const tile = (cls, label, value, hint, extra) => '<div class="kpi ' + cls + '"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' + (hint ? '<div class="kpi-hint">' + hint + '</div>' : '') + (extra || '') + '</div>';
  const overview = '<div class="kpi-row four">'
    + tile('k-students open-cat" data-act="openCategory" data-k="all" role="button" tabindex="0" title="See every student', '👦 Students', String(st.students),
      'in ' + C.plural(st.families, 'family', 'families') + (st.paused ? ' · ' + st.paused + ' paused' : '') + (st.noClass ? ' · <span class="warn-t">' + st.noClass + ' without a class</span>' : '') + (st.both ? ' · ' + st.both + ' take both subjects' : ''))
    + tile('k-fees', '💵 Monthly fees', money(st.net), money(st.fees) + ' at schedule fees' + (st.discounts ? ' − ' + money(st.discounts) + ' discounts' : '') + ' · ' + money(st.net * 12) + ' a year')
    + tile('k-collected', '✅ Collected for ' + esc(st.billedWith ? C.periodRangeShort(st.billedWith, period).replace(/ \d{4}$/, '') : mo), money(st.collected), st.invoices ? 'of ' + money(st.billed) + ' invoiced · ' + st.percent + '%' : 'no ' + esc(mo) + ' invoices yet',
      st.billed > 0 ? '<div class="kpi-bar" role="img" aria-label="' + st.percent + '% collected"><span style="width:' + Math.min(100, st.percent) + '%"></span></div>' : '')
    + tile('k-owing', '⏳ Still to collect', money(st.outstanding), st.invoices ? 'on ' + esc(C.periodLabel(period)) + ' invoices' : '—')
    + '</div>';
  const group = (g, title) => {
    const cats = C.STAT_CATEGORIES.filter(k => k.group === g).map(k => st.categories[k.key]);
    const total = cats.reduce((a, c) => a + c.fees, 0);
    return '<div class="kpi-group"><div class="kpi-sub">' + title + '</div><div class="kpi-row ' + (cats.length === 2 ? 'two' : 'three') + '">'
      + cats.map(c => {
        const share = total > 0 ? Math.round(c.fees / total * 100) : 0;
        return '<div class="kpi cat open-cat cat-' + c.key + '" data-cat="' + c.key + '" data-act="openCategory" data-k="' + c.key + '" role="button" tabindex="0" title="See the ' + esc(c.label) + ' students"><div class="kpi-label">' + c.icon + ' ' + esc(c.label) + ' <span class="kpi-open">›</span></div>'
          + '<div class="kpi-value">' + c.students + ' <span class="kpi-unit">' + (c.students === 1 ? 'student' : 'students') + '</span></div>'
          + '<div class="kpi-hint">' + C.plural(c.families, 'family', 'families') + '</div>'
          + '<dl class="kpi-money"><div><dt>Fees a month</dt><dd>' + money(c.fees) + '</dd></div><div><dt>Collected ' + esc(mo) + '</dt><dd>' + money(c.collected) + '</dd></div></dl>'
          + '<div class="kpi-bar" role="img" aria-label="' + share + '% of the fees"><span style="width:' + share + '%"></span></div><div class="kpi-share">' + share + '% of ' + (g === 'subject' ? 'subject' : 'lesson') + ' fees</div></div>';
      }).join('') + '</div></div>';
  };
  const unsorted = st.unsortedFees || st.unsortedCollected
    ? ' Not sorted into a category (a child\'s own fee with no class, or a hand-typed invoice line): ' + money(st.unsortedFees) + ' of fees, ' + money(st.unsortedCollected) + ' collected.' : '';
  return '<section class="kpis" id="fam-stats"><div id="fam-stats-body">' + head + overview + '<div class="kpi-groups">' + group('subject', 'By subject') + group('type', 'By type of lesson') + '</div>'
    + '<p class="kpi-note"><b>Monthly fees</b>: one month of lessons for every active child at today\'s schedule fees (a child\'s own fee or a class\'s own rate wins), before sibling discounts in the categories; package families included. '
    + '<b>Collected</b>: payments recorded against ' + esc(C.billingPeriodLabel(period, S.settings)) + ' invoices, split over each invoice\'s classes. '
    + (st.billedWith ? esc(C.periodLabel(period)) + ' is paid with the ' + esc(C.periodLabel(st.billedWith)) + ' invoice, so these are the same invoices. ' : '')
    + 'A child counts once in every subject and type they take a class in, so a child in Math and Science counts in both.' + esc(unsorted) + '</p></div></section>';
}
function famFilterPanelHtml() {
  const F = S.ui.famF;
  const opts = C.familyFilterOptions(S.families, S.schedule);
  const sel = (k, label, choices, any) => '<div class="ff"><label for="ff-' + k + '">' + label + '</label><select id="ff-' + k + '" class="plain' + (F[k] ? ' on' : '') + '" data-ch="famF" data-k="' + k + '">'
    + '<option value="">' + (any || 'Any') + '</option>'
    + choices.map(([v, l]) => '<option value="' + esc(v) + '" ' + (F[k] === v ? 'selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>';
  const months = [];
  for (let p = C.RECORD_START; p <= C.RECORD_END; p = C.addMonths(p, 1)) months.push(p);
  const cur = C.sgMonthKey();
  if (!months.includes(cur)) months.push(cur);
  return '<div class="ffpanel" id="fam-filter-panel">'
    + '<div class="ffgroup"><div class="ffhead">👦 Child</div><div class="ffgrid">'
    + sel('level', 'Level', C.LEVELS.map(l => [l, C.levelLabel(l)]))
    + sel('subject', 'Subject', C.SUBJECTS.map(x => [x, x]))
    + sel('mode', 'Physical, online or master class', MODE_CHOICES)
    + sel('day', 'Day', C.DAYS.map(d => [d.code, d.name]))
    + sel('slot', 'Slot', opts.slots.map(o => [o.id, o.label]))
    + sel('school', 'Primary school', opts.schools.map(x => [x, x]))
    + '</div></div>'
    + '<div class="ffgroup"><div class="ffhead">👪 Family</div><div class="ffgrid">'
    + sel('payment', 'Payment type', C.PAYMENT_TYPES.map(t => [t.key, t.label]))
    + sel('hardcopy', 'Hardcopy', [['yes', 'Yes'], ['no', 'No']])
    + sel('withdrawn', 'Withdrawal', [['yes', 'Yes'], ['no', 'No']])
    + sel('paid', 'Payment for', [['paid', '✅ Paid'], ['unpaid', '⏳ Not paid']], 'Paid or not')
    + '<div class="ff"><label for="ff-month">Month</label><select id="ff-month" class="plain' + (F.paid && F.month ? ' on' : '') + '" data-ch="famF" data-k="month"' + (F.paid ? '' : ' disabled title="Choose Paid or Not paid first"') + '>'
    + '<option value="">This month (' + esc(C.monthShort(cur)) + ')</option>'
    + months.sort().map(p => '<option value="' + p + '" ' + (F.month === p ? 'selected' : '') + '>' + esc(C.periodLabel(p)) + '</option>').join('') + '</select></div>'
    + '</div></div>'
    + '<div class="ffnote small muted">Child filters show a family when <b>one</b> of its children matches; the table lists only the matching children. Filters add up: every one chosen must hold.</div>'
    + '</div>';
}
function famActiveFiltersHtml(shown) {
  const F = S.ui.famF;
  const on = C.activeFamilyFilters(F).filter(k => k !== 'month');
  const total = S.families.filter(FAM_FILTERS[S.ui.famFilter] || FAM_FILTERS.all).length;
  const sortLabel = (C.FAMILY_SORTS.find(x => x.key === S.ui.famSort) || C.FAMILY_SORTS[0]).label;
  return '<div class="ffbar"><span class="ffcount" id="fam-count">' + (shown === total ? C.plural(total, 'family', 'families') : shown + ' of ' + C.plural(total, 'family', 'families')) + ' · sorted by ' + esc(sortLabel) + '</span>'
    + on.map(k => '<button class="chip on fftag" data-act="famFClear" data-k="' + k + '" title="Remove this filter">' + esc(FAM_FILTER_LABELS[k](F[k])) + ' ✕</button>').join('')
    + (on.length ? '<button class="linkbtn" data-act="famFReset">Clear all filters</button>' : '')
    + '</div>';
}
VIEWS.families = function () {
  const period = C.sgMonthKey();
  const count = k => S.families.filter(FAM_FILTERS[k]).length;
  const list = familyList();
  const nOn = C.activeFamilyFilters(S.ui.famF).filter(k => k !== 'month').length;
  const chip = (k, label, hideEmpty) => (hideEmpty && !count(k) && S.ui.famFilter !== k) ? '' : '<button class="chip ' + (S.ui.famFilter === k ? 'on' : '') + '" data-act="famFilter" data-k="' + k + '">' + label + ' <span class="n">' + count(k) + '</span></button>';
  const viewChip = (k, label) => '<button class="seg ' + (S.ui.famView === k ? 'on' : '') + '" data-act="famView" data-k="' + k + '" aria-pressed="' + (S.ui.famView === k) + '">' + label + '</button>';
  const shared = [...IX.shared.entries()];
  const sharedBanner = shared.length ? '<div class="banner amber"><div class="big">✉</div><div><b>' + C.plural(shared.length, 'email is', 'emails are') + ' used by more than one family</b>'
    + 'The email is the family\'s account ID, so each one should belong to one family only. Open them and move the children into one family: '
    + shared.map(([e, fs]) => esc(e) + ' (' + fs.map(f => '<button class="linkbtn" data-act="openFamily" data-id="' + esc(f.id) + '">' + esc(f.parentName || 'Unnamed') + '</button>').join(', ') + ')').join('; ') + '</div></div>' : '';
  let body;
  if (!S.familiesLoaded) body = emptyHtml('⏳', 'Loading…', '');
  else if (!S.families.length) body = emptyHtml('👪', 'No families yet', 'Import your spreadsheet of students and parents, or add a family by hand.', '<button class="btn" data-act="openImport">⬆ Import a spreadsheet</button><button class="btn ghost" data-act="newFamily">＋ Add a family</button>');
  else if (!list.length) body = emptyHtml('🔍', 'Nobody matches', 'Try a different search or filter.', nOn ? '<button class="btn ghost" data-act="famFReset">Clear all filters</button>' : '');
  else if (S.ui.famView === 'table') body = familyTableHtml(recordRows(list));
  else if (levelSorted()) {
    // One heading per level, each with its own grid of cards.
    const groups = [];
    list.forEach(f => { const lv = familyGroupLevel(f); const g = groups[groups.length - 1]; if (g && g.level === lv) g.items.push(f); else groups.push({ level: lv, items: [f] }); });
    body = groups.map(g => '<div class="lvgroup" data-level="' + esc(g.level || 'none') + '"><h2 class="lvhead"><span class="lv">' + esc(g.level || '—') + '</span>' + esc(levelHeading(g.level, g.items.length, 'family', 'families')) + '</h2>'
      + '<div class="fam-grid">' + g.items.map(f => famCardHtml(f, period)).join('') + '</div></div>').join('');
  }
  else body = '<div class="fam-grid">' + list.map(f => famCardHtml(f, period)).join('') + '</div>';
  return '<div class="page-head"><div><h1>Families</h1><p>One record per confirmed sign-up. The email is the family\'s account ID, the same for every child.</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="famAnnounce" title="Write an email to the families shown, with the same filters">📣 Email these families</button><button class="btn ghost" data-act="exportRecords" title="Every field of the families shown, one row per child">⬇ CSV</button><button class="btn ghost" data-act="openImport">⬆ Import spreadsheet</button><button class="btn" data-act="newFamily">＋ Add a family</button></div></div>'
    + sharedBanner
    + (S.familiesLoaded && S.families.length ? famStatsHtml(list) : '')
    + '<div class="toolbar"><div class="search"><input type="search" placeholder="Search parent, student, school, phone, email or code" value="' + esc(S.ui.famSearch) + '" data-in="famSearch" data-keep="famSearch" aria-label="Search families"></div>'
    + '<div class="ffsort"><label for="fam-sort">Sort</label><select id="fam-sort" class="plain" data-ch="famSort">' + C.FAMILY_SORTS.map(o => '<option value="' + o.key + '" ' + (S.ui.famSort === o.key ? 'selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select></div>'
    + '<button class="btn ghost fftoggle' + (S.ui.famPanel ? ' open' : '') + '" data-act="famPanel" aria-expanded="' + !!S.ui.famPanel + '" aria-controls="fam-filter-panel">⚲ Filters' + (nOn ? ' <span class="n">' + nOn + '</span>' : '') + '</button>'
    + '<div class="segs" role="group" aria-label="Show as">' + viewChip('cards', '▦ Cards') + viewChip('table', '☰ Table') + '</div>'
    + '<div class="zoom" role="group" aria-label="Zoom the list"><button class="seg" data-act="famZoom" data-d="-1" title="Zoom out: more rows and columns fit" aria-label="Zoom out"' + (S.ui.famZoom <= FAM_ZOOMS[0] ? ' disabled' : '') + '>−</button>'
    + '<button class="seg zoom-val" data-act="famZoomReset" title="Back to 100%" id="fam-zoom">' + Math.round(S.ui.famZoom * 100) + '%</button>'
    + '<button class="seg" data-act="famZoom" data-d="1" title="Zoom in" aria-label="Zoom in"' + (S.ui.famZoom >= FAM_ZOOMS[FAM_ZOOMS.length - 1] ? ' disabled' : '') + '>+</button>'
    + '<button class="seg zoom-fit" data-act="famZoomFit" title="Zoom so the whole table fits the width — no scrolling sideways">↔ Fit</button></div></div>'
    + (S.ui.famPanel ? famFilterPanelHtml() : '')
    + '<div class="chips" style="margin-bottom:10px;">' + chip('all', 'Active') + chip('owing', '💰 Owing') + chip('unpaid', '⏳ ' + esc(C.monthShort(period)) + ' not paid')
    + chip('noshot', '📸 No screenshot in ' + esc(C.monthShort(period))) + chip('noemail', '✉ No email') + chip('shared', '⚠ Shared email', true) + chip('noclass', '🧩 No class') + chip('package', '📦 Package', true) + chip('hardcopy', '📮 Hardcopy', true) + chip('paused', '⏸ Paused') + chip('withdrawn', '👋 Withdrawn') + '</div>'
    + (S.families.length ? famActiveFiltersHtml(list.length) : '')
    + '<div id="fam-body" class="fam-body" style="zoom:' + S.ui.famZoom + ';">' + body + '</div>';
};
function familyTableHtml(rows) {
  const cur = C.sgMonthKey();
  return '<div class="table-wrap rec-wrap"><table class="t rec"><thead><tr>'
    + '<th>Status</th><th>Email (account ID)</th><th>Student</th><th>Parent · WhatsApp</th><th>Primary school</th><th>With us since</th>'
    + '<th>Slots</th><th>Payment type</th><th>Months paid</th><th>Last payment</th><th>Last screenshot</th><th>Hardcopy</th><th>Withdrawal</th><th>Notes</th><th></th></tr></thead><tbody>'
    + rows.map((r, i) => {
      const first = i === 0 || rows[i - 1].familyId !== r.familyId;
      const lv = C.normalizeLevel(r.level) || '';
      const newLevel = levelSorted() && r.studentId && (i === 0 || (C.normalizeLevel(rows[i - 1].level) || '') !== lv);
      const groupRow = newLevel ? '<tr class="lvrow"><td colspan="15"><span class="lv">' + esc(lv || '—') + '</span>' + esc(levelHeading(lv, rows.filter(x => x.studentId && (C.normalizeLevel(x.level) || '') === lv).length, 'child', 'children')) + '</td></tr>' : '';
      const shotThisMonth = r.lastScreenshot && r.lastScreenshot.date.slice(0, 7) === cur;
      return groupRow + '<tr class="click ' + (first ? 'fam-first' : 'fam-more') + (r.status !== 'active' ? ' off' : '') + '" data-act="openFamily" data-id="' + esc(r.familyId) + '" data-level="' + esc(lv) + '">'
        + '<td>' + (first ? '<span class="pill ' + C.familyStatusMeta(r.status).tone + '" title="' + esc(r.statusText) + '">' + C.familyStatusMeta(r.status).icon + ' ' + esc(r.statusLabel) + '</span>' + (r.status === 'paused' ? '<div class="small muted nowrap">' + esc(r.statusText.replace(/^Paused ?/, '')) + '</div>' : '') : '') + '</td>'
        + '<td class="em">' + (first ? (r.email ? esc(r.email) + (IX.shared.has(r.email) ? ' <span class="warn-t" title="Another family uses this email">⚠</span>' : '') : '<span class="warn-t">no email</span>') : '<span class="muted small">〃</span>') + '</td>'
        + '<td><b>' + esc(r.studentName || '—') + '</b>' + (r.level ? ' <span class="muted small">' + esc(C.levelLabel(r.level)) + '</span>' : '') + (r.studentStatus && r.studentStatus !== 'active' ? ' <span class="pill grey">' + esc(C.cap(r.studentStatus)) + '</span>' : '') + '</td>'
        + '<td>' + (first ? esc(r.parentName) + '<div class="small nowrap">' + (r.whatsapp ? '💬 ' + esc(C.displayPhone(r.whatsapp)) : '<span class="warn-t">💬 no WhatsApp</span>') + '</div>' : '<span class="muted small">〃</span>') + '</td>'
        + '<td>' + (r.school ? esc(r.school) : '<span class="muted">—</span>') + '</td>'
        + '<td class="nowrap">' + (r.since ? esc(C.prettyDate(r.since)) : '<span class="muted">—</span>') + '</td>'
        + '<td class="slots">' + (r.slots.length || r.otherClasses.length ? r.slots.map(x => subjChip(x.subject, x.master, x.label.replace(/ · .*$/, '') + ' · ' + (x.subject || 'Class') + ' ' + modeIcon(x.mode))).join(' ') + r.otherClasses.map(x => ' <span class="subj other">📘 ' + esc(x) + '</span>').join('') : (r.studentId ? '<span class="warn-t">⚠ none</span>' : '')) + '</td>'
        + '<td class="nowrap">' + (first ? (r.paymentType === 'package' ? '<span class="pill green">📦 Package</span><div class="small muted">' + esc(C.prettyDateShort(r.packageStart) + ' – ' + C.prettyDate(r.packageEnd)) + '</div>' : '<span class="muted">Monthly</span>') : '') + '</td>'
        + '<td title="' + esc(r.paidText ? 'Paid: ' + r.paidText : 'No month paid yet') + '">' + (first ? monthDots(r.months, 4) : '') + '</td>'
        + '<td class="nowrap">' + (first ? (r.lastPayment ? '<b>' + esc(C.prettyDateShort(r.lastPayment.date)) + '</b>' + (r.lastPayment.amount ? '<div class="small muted">' + money(r.lastPayment.amount) + '</div>' : '') : '<span class="muted">—</span>') : '') + '</td>'
        + '<td class="nowrap">' + (first ? (r.lastScreenshot ? '<span class="' + (shotThisMonth ? '' : 'muted') + '">📸 ' + esc(C.prettyDateShort(r.lastScreenshot.date)) + '</span><div class="small muted">' + esc(whenText(r.lastScreenshot.date)) + '</div>' : '<span class="muted">—</span>') : '') + '</td>'
        + '<td>' + (first ? (r.hardcopy ? '<span class="pill deep">📮 Yes</span><div class="small muted addr" title="' + esc(r.address) + '">' + esc(r.address) + '</div>' : '<span class="muted">No</span>') : '') + '</td>'
        + '<td class="nowrap">' + (first ? (r.withdrawn ? '<span class="pill amber">👋 Yes</span><div class="small muted">last ' + esc(r.lastMonth ? C.periodLabel(r.lastMonth) : '?') + '</div>' : '<span class="muted">No</span>') : '') + '</td>'
        + '<td class="notes">' + (r.notes ? '<span class="clamp" title="' + esc(r.notes) + '">' + esc(r.notes.length > 70 ? r.notes.slice(0, 68) + '…' : r.notes) + '</span>' : '') + '</td>'
        + '<td class="r">' + (first ? '<button class="iconbtn" data-act="quickShot" data-id="' + esc(r.familyId) + '" title="Log a payment screenshot received today">📸</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>'
    + '<div class="small muted" style="margin-top:8px;">Months: ✅ paid · ✔︎ marked paid by hand · ⏳ waiting · ⚠️ overdue · 📝 not sent · · no invoice. 📸 logs a PayNow screenshot received today.</div>';
}
function famCardHtml(f, period) {
  const st = famStateFor(f, period);
  const owe = familyOwing(f.id);
  const rec = recordOf(f);
  const kids = f.students.filter(s => s.status !== 'left')
    .slice().sort((a, b) => levelSorted() ? (C.levelRank(a.level) - C.levelRank(b.level)) * (S.ui.famSort === 'level-desc' ? -1 : 1) : 0);
  const dimOthers = childFiltersOn();
  const rowsById = new Map(IX.rows.filter(r => r.familyId === f.id).map(r => [r.studentId, r]));
  return '<button type="button" class="fam ' + (f.status === 'withdrawn' && famNow(f) === 'withdrawn' ? 'inactive' : '') + (famNow(f) === 'paused' ? ' paused' : '') + '" data-act="openFamily" data-id="' + esc(f.id) + '" data-levels="' + esc(C.familyLevels(f).join(' ')) + '">'
    + '<div class="fam-top"><div><div class="fam-name">' + esc(f.parentName || 'Unnamed parent') + '</div>'
    + '<span class="code">' + esc(C.familyReference(f.code)) + '</span>' + (f.status === 'paused' ? ' <span class="pill amber" title="Not billed for the paused months">⏸ ' + esc(C.pauseText(f)) + '</span>' : '')
    + (f.paymentType === 'package' ? ' <span class="pill green" title="' + esc(C.packageText(f)) + '">📦 Package</span>' : '')
    + (f.hardcopy ? ' <span class="pill deep" title="Hardcopy posted to: ' + esc(f.address) + '">📮 Hardcopy</span>' : '')
    + (f.withdrawn ? ' <span class="pill ' + (famNow(f) === 'withdrawn' ? 'grey' : 'amber') + '">👋 ' + esc(f.lastMonth ? 'Last month ' + C.monthShort(f.lastMonth) + ' ' + f.lastMonth.slice(2, 4) : 'Withdrawn') + '</span>' : '') + '</div>' + pill(st) + '</div>'
    + '<div class="fam-kids">' + (kids.length ? kids.map(s => {
      const r = rowsById.get(s.id);
      const dim = dimOthers && !kidShown(s) ? ' dim' : '';
      return '<div class="fam-kid' + dim + '"' + (dim ? ' title="Does not match the filters"' : '') + '><span class="kid"><span class="lv">' + esc(C.levelLabel(s.level) || '—') + '</span><b>' + esc(s.name) + '</b></span>'
        + (s.status === 'paused' ? '<span class="pill grey">Paused</span>' : (r ? classChips(r) : '')) + '</div>'
        + (s.school ? '<div class="small muted kid-school' + dim + '">🏫 ' + esc(s.school) + (s.startDate ? ' · since ' + esc(C.prettyDate(s.startDate)) : '') + '</div>' : (s.startDate ? '<div class="small muted kid-school' + dim + '">Since ' + esc(C.prettyDate(s.startDate)) + '</div>' : ''));
    }).join('') : '<span class="muted small">No students yet</span>') + '</div>'
    + '<div class="fam-rec">' + monthDots(rec.months, 4)
    + '<span>' + (rec.lastPayment ? '💵 ' + esc(C.prettyDateShort(rec.lastPayment.date)) : '<span class="muted">💵 —</span>') + '</span>'
    + '<span>' + (rec.lastScreenshot ? '📸 ' + esc(C.prettyDateShort(rec.lastScreenshot.date)) : '<span class="muted">📸 —</span>') + '</span></div>'
    + '<div class="fam-foot"><div class="contact">'
    + (C.familyEmails(f).length ? '<span>✉ ' + esc(C.familyEmails(f)[0]) + '</span>' : '<span class="warn-t">✉ no email</span>')
    + (f.whatsapp ? '<span>💬 ' + esc(C.displayPhone(f.whatsapp)) + '</span>' : '<span class="warn-t">💬 no WhatsApp</span>') + '</div>'
    + (owe > 0 ? '<span class="owe ' + (st.key === 'overdue' ? 'red' : '') + '">Owes ' + money(owe) + '</span>' : (f.credit > 0 ? '<span class="pill green">Credit ' + money(f.credit) + '</span>' : '')) + '</div>'
    + '</button>';
}

/* ═══════════════ 📣 Announcements ═══════════════
   Write one message, choose the families with the Families filters (and a
   tick per family), check the preview, send a test to yourself, then send:
   one email per family to that family's own address(es) only. Every send is
   logged in officeSettings with each family, address and mail id. */
function annCtx() {
  return { schedule: S.schedule, invoices: S.invoices, payments: S.payments, today: today(), record: f => recordOf(famById(f.id) || f) };
}
function annAudience() {
  const a = S.ui.ann;
  return C.announceAudience(S.families, { status: a.status, type: a.type, search: a.search, filters: a.F, excluded: a.excluded }, annCtx());
}
function annSelection() { const a = S.ui.ann; return { status: a.status, type: a.type, search: a.search, filters: a.F }; }
// The family the preview shows: chosen, else the first who gets it, else a sample.
function annPreviewFamily(aud) {
  const pick = S.ui.ann.preview && aud.rows.find(r => r.familyId === S.ui.ann.preview);
  const row = pick || aud.sending[0] || aud.rows[0];
  if (row) return { row, family: famById(row.familyId) || { parentName: row.parentName, students: [] } };
  return { row: null, family: { parentName: 'Mrs Tan', students: [{ name: 'Jun Wei', status: 'active' }, { name: 'Mei', status: 'active' }] } };
}
function annPreviewHtml(aud) {
  const { row, family } = annPreviewFamily(aud);
  const msg = C.announcementEmail(S.ui.ann.draft, family, S.settings, { kidFilter: row ? row.childOk : null });
  const opts = aud.rows.filter(r => r.send);
  return '<div class="ann-prev-head">'
    + '<div class="ann-prev-meta"><div><span class="muted">From</span> ' + esc(S.settings.fromName + ' <' + C.SENDER_EMAIL + '>') + '</div>'
    + '<div><span class="muted">To</span> ' + (row ? (row.to.length ? esc(row.to.join(', ')) : '<span class="warn-t">' + (row.noEmail ? 'no email' : 'not sent') + '</span>') : '<span class="muted">(a sample family)</span>') + '</div>'
    + '<div><span class="muted">Subject</span> <b id="ann-prev-subject">' + esc(msg.subject) + '</b></div></div>'
    + (opts.length > 1 ? '<select class="plain" data-ch="annPreview" aria-label="Preview for">' + opts.map(r => '<option value="' + esc(r.familyId) + '" ' + (row && r.familyId === row.familyId ? 'selected' : '') + '>' + esc(r.parentName || 'Unnamed') + '</option>').join('') + '</select>' : '')
    + '</div><div class="ann-mail">' + msg.html + '</div>';
}
function annProblemsHtml() {
  const probs = C.announcementProblems(S.ui.ann.draft);
  return probs.map(p => '<div class="ann-prob ' + p.level + '">' + (p.level === 'block' ? '✋ ' : '⚠ ') + esc(p.text) + '</div>').join('');
}
function annSendLabel(aud) {
  return aud.families ? '📣 Send to ' + C.plural(aud.families, 'family', 'families') : '📣 Send';
}
function annCanSend(aud) {
  return aud.families > 0 && !C.announcementProblems(S.ui.ann.draft).some(p => p.level === 'block');
}
// Typing re-draws only the preview, the notes and the button (the text box keeps its place).
function annRefreshLive() {
  const aud = annAudience();
  const prev = $('ann-preview'); if (prev) prev.innerHTML = annPreviewHtml(aud);
  const pr = $('ann-problems'); if (pr) pr.innerHTML = annProblemsHtml();
  const b = $('ann-send-btn'); if (b) { b.disabled = !annCanSend(aud); b.textContent = annSendLabel(aud); }
  const n = $('ann-count-subject'); if (n) n.textContent = String(S.ui.ann.draft.subject || '').length + ' / ' + C.ANNOUNCE_LIMITS.subject;
}
function annFilterPanelHtml() {
  const F = S.ui.ann.F;
  const opts = C.familyFilterOptions(S.families, S.schedule);
  const sel = (k, label, choices, any) => '<div class="ff"><label for="af-' + k + '">' + label + '</label><select id="af-' + k + '" class="plain' + (F[k] ? ' on' : '') + '" data-ch="annF" data-k="' + k + '">'
    + '<option value="">' + (any || 'Any') + '</option>'
    + choices.map(([v, l]) => '<option value="' + esc(v) + '" ' + (F[k] === v ? 'selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>';
  const cur = C.sgMonthKey();
  return '<div class="ffgrid ann-ff">'
    + sel('level', 'Level', C.LEVELS.map(l => [l, C.levelLabel(l)]))
    + sel('subject', 'Subject', C.SUBJECTS.map(x => [x, x]))
    + sel('mode', 'Physical, online or master class', MODE_CHOICES)
    + sel('day', 'Day', C.DAYS.map(d => [d.code, d.name]))
    + sel('slot', 'Slot', opts.slots.map(o => [o.id, o.label]))
    + sel('school', 'Primary school', opts.schools.map(x => [x, x]))
    + sel('payment', 'Payment type', C.PAYMENT_TYPES.map(t => [t.key, t.label]))
    + sel('hardcopy', 'Hardcopy', [['yes', 'Yes'], ['no', 'No']])
    + sel('withdrawn', 'Withdrawal', [['yes', 'Yes'], ['no', 'No']])
    + sel('paid', 'Payment for', [['paid', '✅ Paid'], ['unpaid', '⏳ Not paid']], 'Paid or not')
    + '<div class="ff"><label for="af-month">Month</label><select id="af-month" class="plain" data-ch="annF" data-k="month"' + (F.paid ? '' : ' disabled') + '><option value="">This month (' + esc(C.monthShort(cur)) + ')</option>'
    + statMonths().map(p => '<option value="' + p + '" ' + (F.month === p ? 'selected' : '') + '>' + esc(C.periodLabel(p)) + '</option>').join('') + '</select></div>'
    + '</div>';
}
function annRowHtml(r) {
  const note = r.noEmail ? '<span class="warn-t">✉ no email — skipped</span>'
    : (!r.ticked ? '<span class="muted">not ticked</span>'
      : (!r.send ? '<span class="muted">already gets it (same email as ' + esc(r.dupOf.join(', ')) + ')</span>'
        : esc(r.to.join(', ')) + (r.dupOf.length ? ' <span class="muted small">(one address shared with ' + esc(r.dupOf.join(', ')) + ')</span>' : '')));
  return '<label class="ann-row' + (r.send ? '' : ' off') + '" data-fam="' + esc(r.familyId) + '">'
    + '<input type="checkbox" data-ch="annPick" data-id="' + esc(r.familyId) + '" ' + (r.ticked ? 'checked' : '') + (r.noEmail ? ' disabled' : '') + ' aria-label="Send to ' + esc(r.parentName) + '">'
    + '<span class="ann-who"><span><b>' + esc(r.parentName || 'Unnamed') + '</b>' + (r.children.length ? ' <span class="muted">· ' + esc(C.listJoin(r.children)) + '</span>' : '') + '</span>'
    + '<span class="ann-to small">' + note + '</span></span></label>';
}
VIEWS.announce = function () {
  const a = S.ui.ann;
  const aud = annAudience();
  const d = a.draft;
  const nOn = C.activeFamilyFilters(a.F).filter(k => k !== 'month').length;
  const statusSeg = C.ANNOUNCE_STATUSES.map(t => '<button class="seg ' + (a.status === t.key ? 'on' : '') + '" data-act="annStatus" data-k="' + t.key + '" aria-pressed="' + (a.status === t.key) + '">' + esc(t.label) + '</button>').join('');
  const compose = '<div class="card ann-compose"><h2 class="ann-h">1 · Write the message</h2>'
    + '<div class="form"><div class="field full"><label for="ann-subject">Subject <span class="opt" id="ann-count-subject">' + String(d.subject || '').length + ' / ' + C.ANNOUNCE_LIMITS.subject + '</span></label>'
    + '<input id="ann-subject" type="text" maxlength="' + C.ANNOUNCE_LIMITS.subject + '" value="' + esc(d.subject) + '" data-in="annText" data-k="subject" data-keep="ann-subject" placeholder="e.g. No lessons on Deepavali (Mon 9 Nov)"></div>'
    + '<div class="field full"><label for="ann-body">Message</label>'
    + '<textarea id="ann-body" rows="12" maxlength="' + C.ANNOUNCE_LIMITS.body + '" data-in="annText" data-k="body" data-keep="ann-body" placeholder="Write your announcement. A blank line starts a new paragraph. **Two stars** make words bold; links and email addresses become clickable.">' + esc(d.body) + '</textarea>'
    + '<div class="ann-tokens"><span class="small muted">Fill in for each family:</span>' + C.ANNOUNCE_TOKENS.map(t => '<button type="button" class="chip" data-act="annToken" data-t="' + esc(t.token) + '" title="' + esc(t.label + ', e.g. ' + t.example) + '">' + esc(t.token) + '</button>').join('') + '</div></div>'
    + '<div class="field full"><label class="check"><input type="checkbox" data-ch="annGreet" ' + (d.greet ? 'checked' : '') + '> Start with "Dear <i>parent\'s name</i>,"</label>'
    + '<div class="small muted">Your signature from Settings and the centre\'s WhatsApp number are added at the end.</div></div></div>'
    + '<div id="ann-problems">' + annProblemsHtml() + '</div>'
    + '<div class="ann-actions"><button class="btn ghost" data-act="annTest" title="Only to ' + esc(S.user.email) + '">✉ Send a test to me</button>'
    + '<button class="btn" id="ann-send-btn" data-act="annSend" ' + (annCanSend(aud) ? '' : 'disabled') + '>' + annSendLabel(aud) + '</button>'
    + '<button class="linkbtn" data-act="annClear">Clear the message</button></div></div>';
  const who = '<div class="card ann-who-card"><h2 class="ann-h">2 · Choose who gets it</h2>'
    + '<div class="segs ann-status" role="group" aria-label="Which families">' + statusSeg + '</div>'
    + '<div style="height:12px;"></div>'
    + '<div class="ann-search"><div class="search"><input type="search" placeholder="Search parent, student or school" value="' + esc(a.search) + '" data-in="annSearch" data-keep="ann-search" aria-label="Search families"></div>'
    + '<button class="btn ghost fftoggle' + (a.panel ? ' open' : '') + '" data-act="annPanel" aria-expanded="' + !!a.panel + '">⚲ Filters' + (nOn ? ' <span class="n">' + nOn + '</span>' : '') + '</button></div>'
    + (a.panel ? annFilterPanelHtml() : '')
    + (nOn ? '<div class="ffbar" style="margin:8px 0 0;"><span class="ffcount">' + esc(C.audienceSummary(annSelection(), S.schedule)) + '</span><button class="linkbtn" data-act="annFReset">Clear filters</button></div>' : '')
    + '<div class="ann-sum" id="ann-sum"><b>' + C.plural(aud.families, 'family', 'families') + '</b> · ' + C.plural(aud.addresses, 'email address', 'email addresses')
    + (aud.noEmail ? ' · <span class="warn-t">' + aud.noEmail + ' without email</span>' : '') + (aud.unticked ? ' · ' + aud.unticked + ' unticked' : '') + (aud.shared ? ' · ' + aud.shared + ' share an email (sent once)' : '') + '</div>'
    + '<div class="ann-tick"><button class="linkbtn" data-act="annTickAll">Tick all</button> · <button class="linkbtn" data-act="annTickNone">Untick all</button></div>'
    + '<div class="ann-list">' + (aud.rows.length ? aud.rows.map(annRowHtml).join('') : '<div class="muted small" style="padding:14px;">No family matches. Change the filters above.</div>') + '</div></div>';
  const preview = '<div class="card ann-preview-card"><h2 class="ann-h">3 · Check the email</h2><div id="ann-preview">' + annPreviewHtml(aud) + '</div></div>';
  const hist = S.announcements;
  const log = '<div class="card"><h2 class="ann-h">Sent announcements</h2>'
    + (hist.length ? '<div class="table-wrap" style="box-shadow:none;"><table class="t ann-log"><thead><tr><th>Sent</th><th>Subject</th><th>To</th><th class="r">Families</th><th>By</th></tr></thead><tbody>'
      + hist.map(h => '<tr class="click" data-act="openAnnLog" data-id="' + esc(h.id) + '"><td class="nowrap">' + esc(annWhen(h.sentAtMs)) + '</td><td><b>' + esc(h.subject) + '</b>' + (h.failed && h.failed.length ? ' <span class="pill red">' + h.failed.length + ' not sent</span>' : '') + (h.done === false ? ' <span class="pill amber">stopped part way</span>' : '') + '</td><td class="small">' + esc(h.audience || '') + '</td><td class="r">' + (h.families || 0) + '</td><td class="small muted">' + esc(h.sentBy || '') + '</td></tr>').join('')
      + '</tbody></table></div>' : '<p class="muted small">Nothing sent yet. Each announcement you send is listed here, with who got it.</p>')
    + '</div>';
  return '<div class="page-head"><div><h1>Announcements</h1><p>Email parents a message. Each family gets its own email from ' + esc(C.SENDER_EMAIL) + ', so no parent sees another\'s address. Replies come back to ' + esc(S.settings.replyTo) + '.</p></div></div>'
    + (S.familiesLoaded ? '' : emptyHtml('⏳', 'Loading…', ''))
    + '<div class="ann-grid">' + compose + who + '</div>' + preview + log;
};
function annWhen(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const day = C.sgDayKey(d);
  const t = d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' });
  return C.prettyDateShort(day) + ' ' + day.slice(0, 4) + ', ' + t;
}
async function annSendAll() {
  if (!requireProtected()) return;
  const aud = annAudience();
  const draft = C.cleanAnnouncement(S.ui.ann.draft);
  if (!aud.families || C.announcementProblems(draft).some(p => p.level === 'block')) { toast('Nothing to send yet.', 'err'); return; }
  const at = Date.now();
  const logId = C.announcementLogId(at);
  aud.sending.forEach((r, i) => { r.mailId = C.mailDocId('announce', r.familyId, at + i); });
  const audience = C.audienceSummary(annSelection(), S.schedule);
  const logRef = db.collection(COL.settings).doc(logId);
  // The log first, so a send that stops part way is still on record.
  await logRef.set(Object.assign(C.announcementLog(draft, aud, { audience, sentBy: S.user.email, at }), { done: false, sentAt: ts() }));
  openModal({ type: 'progress', title: 'Emailing ' + C.plural(aud.families, 'family', 'families') + '…', sub: 'Keep this page open until it finishes.', done: 0, total: aud.sending.length });
  const ok = [], failed = [];
  for (let i = 0; i < aud.sending.length; i++) {
    const r = aud.sending[i];
    try {
      const fam = famById(r.familyId);
      const msg = C.announcementEmail(draft, fam, S.settings, { kidFilter: r.childOk });
      const doc = C.officeMail(r.to, msg, { kind: 'announcement', logId, familyId: r.familyId, sentBy: S.user.email }, S.settings);
      delete doc.bcc;   // one copy per family only; "Send a test to me" is the admin's copy
      await db.collection('mail').doc(r.mailId).set(doc);
      ok.push(r.mailId);
    } catch (e) { console.error(e); failed.push({ parentName: r.parentName, error: friendlyError(e) }); }
    S.modal.done = i + 1; S.modal.note = r.parentName; renderModal();
  }
  await logRef.update({ done: true, failed, sentCount: ok.length }).catch(e => console.error(e));
  // Sent: the message is in the log now, so the box is cleared for the next one.
  S.ui.ann.draft = C.emptyAnnouncement(); S.ui.ann.excluded = []; S.ui.ann.preview = '';
  rememberAnnDraft(S.ui.ann.draft);
  openModal({ type: 'result', title: '📣 ' + C.plural(ok.length, 'email') + ' queued',
    body: '<p>On their way from ' + esc(C.SENDER_EMAIL) + ', one per family. It is listed under Sent announcements.</p>'
      + (failed.length ? '<div class="banner red" style="margin-top:12px;"><div class="big">⚠️</div><div><b>' + failed.length + ' not sent</b>' + failed.map(f => esc(f.parentName + ': ' + f.error)).join('<br>') + '</div></div>' : '')
      + '<div id="delivery-note" class="small muted" style="margin-top:12px;">Checking delivery…</div>' });
  render();
  checkDelivery(ok);
}
async function annSendTest() {
  if (!requireProtected()) return;
  const draft = C.cleanAnnouncement(S.ui.ann.draft);
  if (C.announcementProblems(draft).some(p => p.level === 'block')) { toast('Write a subject and a message first.', 'err'); return; }
  const aud = annAudience();
  const { row, family } = annPreviewFamily(aud);
  const msg = C.announcementEmail(draft, family, S.settings, { kidFilter: row ? row.childOk : null });
  msg.subject = '[TEST] ' + msg.subject;
  const to = S.user.email;
  const doc = C.officeMail([to], msg, { kind: 'announcement-test', sentBy: to }, S.settings);
  delete doc.bcc;
  const id = C.mailDocId('announce-test', to);
  try { await db.collection('mail').doc(id).set(doc); toast('Test sent to ' + to + ' — as ' + (family.parentName || 'a family') + ' would see it.', 'ok'); }
  catch (e) { toast('The test was not sent: ' + friendlyError(e), 'err'); }
}
async function annCheckDelivery(h) {
  const ids = (h.recipients || []).map(r => r.mailId).filter(Boolean).slice(0, 60);
  const note = $('delivery-note'); if (note) note.textContent = 'Checking…';
  let okN = 0, errN = 0, pend = 0;
  for (const id of ids) {
    try {
      const d = await db.collection('mail').doc(id).get();
      const st = d.exists && d.data().delivery ? d.data().delivery.state : 'PENDING';
      S.mailState[id] = st === 'SUCCESS' ? 'delivered ✓' : st === 'ERROR' ? 'failed: ' + ((d.data().delivery || {}).error || '') : 'on the way';
      if (st === 'SUCCESS') okN++; else if (st === 'ERROR') errN++; else pend++;
    } catch (e) { pend++; }
  }
  if (S.modal && S.modal.type === 'annLog') renderModal();
  const n2 = $('delivery-note'); if (n2) n2.textContent = okN + ' delivered' + (pend ? ', ' + pend + ' still on the way' : '') + (errN ? ', ' + errN + ' failed' : '') + (ids.length < (h.recipients || []).length ? ' (first ' + ids.length + ' checked)' : '') + '.';
}

/* ═══════════════ 🗓️ Timetable ═══════════════ */
VIEWS.timetable = function () {
  const rows = C.timetableRows();
  const f = S.ui.tt;
  const matches = slot => (!f.level || C.normalizeLevel(slot.level) === f.level) && (!f.subject || C.subjectKey(slot.subject) === C.subjectKey(f.subject))
    && (!f.mode || C.slotModes(slot).includes(f.mode));
  const chip = (k, v, label) => '<button class="chip ' + (f[k] === v ? 'on' : '') + '" data-act="ttFilter" data-k="' + k + '" data-v="' + esc(v) + '">' + label + '</button>';
  let totalStudents = 0, totalClasses = 0;
  const body = rows.map(r => '<tr><th class="time" scope="row"><b>' + esc(r.label.split(/\s*[–—-]\s*/)[0]) + '</b>' + esc('to ' + (r.label.split(/\s*[–—-]\s*/)[1] || '')) + '</th>'
    + C.DAYS.map(d => {
      const cell = r.cells[d.code];
      if (!cell) return '<td><div class="tt-off" title="No lesson at this time on ' + d.name + '"></div></td>';
      const slot = C.scheduleSlot(S.schedule, cell.id);
      const roster = IX.roster.get(cell.id) || [];
      if (!C.slotHasClass(slot)) {
        if (roster.length) return '<td><button class="tt-cls" style="background:var(--red-bg);border-color:var(--red-line);" data-act="openSlot" data-id="' + cell.id + '"><span class="t1" style="color:var(--red)">⚠ No class here</span><span class="cnt">' + roster.length + '<small>students</small></span><span class="mix">The schedule has no class in this slot</span></button></td>';
        return '<td><div class="tt-none">No class</div></td>';
      }
      totalClasses++; totalStudents += roster.length;
      const k = C.isMaster(slot) ? 'master' : (C.subjectKey(slot.subject) || 'other');
      const mix = C.CLASS_MODES.map(m => [m, roster.filter(x => x.mode === m).length]).filter(([, n]) => n);
      return '<td><button class="tt-cls ' + k + (matches(slot) ? '' : ' dim') + '" data-act="openSlot" data-id="' + cell.id + '">'
        + '<span class="t1">' + (C.isMaster(slot) ? '⭐ ' : '') + esc(C.levelLabel(slot.level) + ' ' + slot.subject) + '</span>'
        + (slot.status === 'closed' ? '<span class="closed">Hidden on /schedule</span>' : slot.status === 'full' ? '<span class="closed" style="color:var(--amber)">Full</span>' : '')
        + '<span class="cnt">' + roster.length + '<small>' + (roster.length === 1 ? 'student' : 'students') + '</small></span>'
        + '<span class="mix">' + (roster.length ? mix.map(([m, n]) => modeIcon(m) + ' ' + n).join(' · ') : 'Nobody yet') + ' · ' + money(C.monthlyFeeFor(slot, 'Physical', S.schedule)) + '</span></button></td>';
    }).join('') + '</tr>').join('');
  const noClass = studentsWithoutClass();
  return '<div class="page-head"><div><h1>Timetable</h1><p>The classes on <a href="../schedule/#timetable" target="_blank" rel="noopener">/schedule</a>, with how many students are in each. Click a class to see who.</p></div>'
    + '<div class="actions"><span class="pill deep">' + C.plural(totalClasses, 'class', 'classes') + ' · ' + C.plural(totalStudents, 'seat') + '</span></div></div>'
    + '<div class="filterrow"><span class="lbl">Level</span><div class="chips">' + chip('level', '', 'All') + C.LEVELS.map(l => chip('level', l, C.levelLabel(l))).join('') + '</div>'
    + '<span class="lbl">Subject</span><div class="chips">' + chip('subject', '', 'All') + chip('subject', 'Math', '➗ Math') + chip('subject', 'Science', '🔬 Science') + '</div>'
    + '<span class="lbl">Mode</span><div class="chips">' + chip('mode', '', 'All') + chip('mode', 'Physical', '🏫 Physical') + chip('mode', 'Online', '💻 Online') + chip('mode', 'Master', '⭐ Master class') + '</div></div>'
    + '<div class="card" style="padding:12px;"><div class="tt-wrap"><table class="tt"><thead><tr><th></th>' + C.DAYS.map(d => '<th scope="col">' + d.name + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table></div></div>'
    + (noClass.length ? '<div class="card"><h2>🧩 Not in any class (' + noClass.length + ')</h2><div class="sub">Open the family to put each one in a class.</div><div class="chips">'
      + noClass.map(r => '<button class="chip" data-act="openFamily" data-id="' + esc(r.familyId) + '">' + esc(r.name) + ' · ' + esc(C.levelLabel(r.level) || '?') + '</button>').join('') + '</div></div>' : '');
};
function renderDrawer() {
  if (!S.drawer) { $('drawer').classList.remove('show'); return; }
  const id = S.drawer.slotId;
  const slot = C.scheduleSlot(S.schedule, id);
  const roster = (IX.roster.get(id) || []).slice().sort(by('name'));
  const period = C.sgMonthKey();
  $('drawer-box').innerHTML = '<div class="modal-head"><div><h2>' + esc(C.slotTitle(slot)) + '</h2><p>' + esc(C.slotLabel(id)) + ' · ' + C.plural(roster.length, 'student') + '</p></div>'
    + '<button class="iconbtn x" data-act="closeDrawer" aria-label="Close">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="chips" style="margin-bottom:14px;">' + C.slotClassModes(slot).map(m => '<span class="pill deep">' + C.classModeLabel(m) + ' ' + money(C.monthlyFeeFor(slot, m, S.schedule)) + '/month</span>').join('') + '</div>'
    + (roster.length ? '<table class="t"><tbody>' + roster.map(r => {
      const st = famStateFor(r.family, period);
      return '<tr class="click" data-act="openFamily" data-id="' + esc(r.familyId) + '"><td><b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.parentName) + '</div></td>'
        + '<td title="' + esc(C.CLASS_MODE_META[r.mode] ? C.CLASS_MODE_META[r.mode].long : '') + '">' + modeIcon(r.mode) + '</td><td><span class="dot ' + st.tone + '" title="' + esc(st.label) + '"></span></td>'
        + '<td class="r">' + (r.whatsapp ? '<a class="iconbtn" href="' + esc(C.whatsappLink(r.whatsapp, '', !TOUCH)) + '" target="polymath_whatsapp" rel="noopener" title="WhatsApp" data-act="noop">💬</a>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' : emptyHtml('🪑', 'Nobody in this class yet', 'Open a family and choose this class for a student.'))
    + '</div><div class="modal-foot"><button class="btn ghost" data-act="copyRoster" data-id="' + id + '">📋 Copy the list</button></div>';
  $('drawer').classList.add('show');
}

/* ═══════════════ 📋 Students ═══════════════ */
function studentList() {
  const f = S.ui.stu, q = C.normText(S.ui.stuSearch), period = C.sgMonthKey();
  const rows = IX.rows.filter(r => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.level && C.normalizeLevel(r.level) !== f.level) return false;
    if (f.subject && !r.subjects.some(s => C.subjectKey(s) === C.subjectKey(f.subject))) return false;
    if (f.mode && !r.modes.includes(f.mode)) return false;
    if (f.day && !r.days.includes(f.day)) return false;
    if (f.cls === 'none' && r.classes.length) return false;
    if (f.pay) {
      const k = famStateFor(r.family, period).key;
      if (f.pay === 'paid' && !['paid', 'free'].includes(k)) return false;
      if (f.pay === 'owing' && !['waiting', 'part', 'overdue', 'draft'].includes(k)) return false;
      if (f.pay === 'overdue' && k !== 'overdue') return false;
    }
    if (q) {
      const hay = C.normText([r.name, r.parentName, r.school, r.whatsapp, r.email, r.code, r.level].join(' '));
      if (!q.split(' ').every(w => hay.includes(w))) return false;
    }
    return true;
  });
  const { key, dir } = S.ui.stuSort;
  const val = r => key === 'monthly' ? r.monthly : key === 'level' ? (C.LEVELS.indexOf(C.normalizeLevel(r.level)) + 1 || 99) : String(r[key] || '').toLowerCase();
  return rows.sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0) || a.name.localeCompare(b.name));
}
VIEWS.students = function () {
  const f = S.ui.stu, period = C.sgMonthKey();
  const rows = studentList();
  const chip = (k, v, label) => '<button class="chip ' + (f[k] === v ? 'on' : '') + '" data-act="stuFilter" data-k="' + k + '" data-v="' + esc(v) + '">' + label + '</button>';
  const th = (k, label, cls) => '<th class="sort ' + (cls || '') + '" data-act="stuSort" data-k="' + k + '">' + label + (S.ui.stuSort.key === k ? (S.ui.stuSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
  return '<div class="page-head"><div><h1>Students</h1><p>' + C.plural(rows.length, 'student') + ' shown. Click a row to open the family.</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="exportStudents">⬇ Download as CSV</button></div></div>'
    + '<div class="toolbar"><div class="search"><input type="search" placeholder="Search student, parent, school, phone or code" value="' + esc(S.ui.stuSearch) + '" data-in="stuSearch" data-keep="stuSearch" aria-label="Search students"></div>'
    + '<select class="plain" data-ch="stuDay" aria-label="Day"><option value="">Any day</option>' + C.DAYS.map(d => '<option value="' + d.code + '" ' + (f.day === d.code ? 'selected' : '') + '>' + d.name + '</option>').join('') + '</select></div>'
    + '<div class="filterrow"><span class="lbl">Level</span><div class="chips">' + chip('level', '', 'All') + C.LEVELS.map(l => chip('level', l, C.levelLabel(l))).join('') + '</div>'
    + '<span class="lbl">Subject</span><div class="chips">' + chip('subject', '', 'All') + chip('subject', 'Math', '➗ Math') + chip('subject', 'Science', '🔬 Science') + '</div></div>'
    + '<div class="filterrow"><span class="lbl">Mode</span><div class="chips">' + chip('mode', '', 'All') + chip('mode', 'Physical', '🏫 Physical') + chip('mode', 'Online', '💻 Online') + chip('mode', 'Master', '⭐ Master class') + '</div>'
    + '<span class="lbl">This month</span><div class="chips">' + chip('pay', '', 'All') + chip('pay', 'paid', '✅ Paid') + chip('pay', 'owing', '⏳ Not paid') + chip('pay', 'overdue', '⚠️ Overdue') + '</div>'
    + '<span class="lbl">Show</span><div class="chips">' + chip('status', 'active', 'Active') + chip('status', 'paused', 'Paused') + chip('status', 'left', 'Left') + chip('status', 'all', 'Everyone') + chip('cls', 'none', '🧩 No class') + '</div></div>'
    + (!rows.length ? '<div class="card">' + emptyHtml('📋', IX.rows.length ? 'Nobody matches' : 'No students yet', IX.rows.length ? 'Clear a filter to see more.' : 'Students are added inside a family.', IX.rows.length ? '<button class="btn ghost" data-act="stuClear">Clear filters</button>' : '<button class="btn" data-act="openImport">⬆ Import a spreadsheet</button>') + '</div>'
      : '<div class="table-wrap"><table class="t"><thead><tr>' + th('name', 'Student') + th('level', 'Level') + '<th>Classes</th>' + th('parentName', 'Parent') + '<th>WhatsApp</th>' + th('monthly', 'Monthly', 'r') + '<th>' + esc(C.MONTHS[Number(period.slice(5)) - 1]) + '</th></tr></thead><tbody>'
        + rows.map(r => {
          const st = famStateFor(r.family, period);
          return '<tr class="click" data-act="openFamily" data-id="' + esc(r.familyId) + '"><td><b>' + esc(r.name) + '</b>' + (r.school ? '<div class="small muted">' + esc(r.school) + '</div>' : '') + (r.status !== 'active' ? ' <span class="pill grey">' + esc(C.cap(r.status)) + '</span>' : '') + '</td>'
            + '<td><span class="kid"><span class="lv">' + esc(C.levelLabel(r.level) || '—') + '</span></span></td>'
            + '<td style="max-width:360px;"><div class="chips" style="gap:5px;">' + classChips(r) + '</div></td>'
            + '<td>' + esc(r.parentName) + '<div class="small"><span class="code" style="font-size:11px;">' + esc(r.code) + '</span></div></td>'
            + '<td class="nowrap">' + (r.whatsapp ? esc(C.displayPhone(r.whatsapp)) : '<span class="warn-t">—</span>') + '</td>'
            + '<td class="r num">' + (r.monthly ? money(r.monthly) : '—') + '</td>'
            + '<td><span class="pill ' + st.tone + '">' + st.icon + ' ' + esc(st.label) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>');
};

/* ═══════════════ 🧾 Invoices ═══════════════ */
VIEWS.invoices = function () {
  const period = S.period;
  const joint = C.jointMonth(period, S.settings);
  const covered = !!(joint && joint.covered === period);
  const label = covered ? C.periodLabel(period) : C.billingPeriodLabel(period, S.settings);
  const invs = periodInvoices(period);
  const sum = C.periodSummary(invs, today());
  const missing = billableWithoutInvoice(period);
  const counts = { all: invs.filter(i => i.status !== 'void').length };
  ['draft', 'waiting', 'overdue', 'part', 'paid', 'void'].forEach(k => { counts[k] = invs.filter(i => { const s = stateOf(i).key; return k === 'paid' ? (s === 'paid' || s === 'free') : s === k; }).length; });
  const q = C.normText(S.ui.invSearch);
  const list = invs.filter(i => {
    const s = stateOf(i).key;
    const ok = S.ui.invFilter === 'all' ? s !== 'void' : S.ui.invFilter === 'paid' ? (s === 'paid' || s === 'free') : s === S.ui.invFilter;
    if (!ok) return false;
    if (!q) return true;
    const f = famById(i.familyId);
    return C.normText([i.parentName, i.number, i.reference, i.title, ...(i.students || []), f && f.whatsapp, f && f.email, ...(i.emails || [])].join(' ')).includes(q);
  }).sort((a, b) => {
    const order = { overdue: 0, part: 1, waiting: 2, draft: 3, paid: 4, free: 5, void: 6 };
    return (order[stateOf(a).key] - order[stateOf(b).key]) || String(a.parentName).localeCompare(String(b.parentName));
  });
  const drafts = invs.filter(i => stateOf(i).key === 'draft');
  const draftsNoEmail = drafts.filter(i => !recipientsFor(i).length);
  const chip = (k, lbl) => '<button class="chip ' + (S.ui.invFilter === k ? 'on' : '') + '" data-act="invFilter" data-k="' + k + '">' + lbl + ' <span class="n">' + (counts[k] || 0) + '</span></button>';
  let bulk = '';
  if (covered) {
    bulk = '<div class="bulkbar joint-bar"><div class="txt"><b>🔗 ' + esc(C.periodLabel(period)) + ' is paid with the ' + esc(C.periodLabel(joint.lead)) + ' invoice</b><span>One fee covers ' + esc(label) + ', so there is no separate ' + esc(C.periodLabel(period)) + ' invoice. Change this in Settings → Months billed together.</span></div>'
      + '<button class="btn white big" data-act="period" data-d="-1">◀ ' + esc(C.periodLabel(joint.lead)) + ' invoices</button></div>';
  } else if (missing.length) {
    bulk = '<div class="bulkbar"><div class="txt"><b>' + C.plural(missing.length, 'family has', 'families have') + ' no ' + esc(label) + ' invoice yet</b><span>Prices come from each student\'s classes on the schedule — you check them before anything is sent.</span></div>'
      + '<button class="btn white big" data-act="openPrepare">Prepare invoices</button></div>';
  } else if (drafts.length) {
    const byEmail = drafts.length - draftsNoEmail.length;
    bulk = '<div class="bulkbar"><div class="txt"><b>' + C.plural(drafts.length, 'invoice is', 'invoices are') + ' ready to send</b><span>'
      + [byEmail ? byEmail + ' by email' : '', draftsNoEmail.length ? C.plural(draftsNoEmail.length, 'family has', 'families have') + ' no email — send ' + (draftsNoEmail.length === 1 ? 'it' : 'them') + ' by WhatsApp' : ''].filter(Boolean).join(' · ') + '</span></div>'
      + (byEmail ? '<button class="btn white big" data-act="emailDrafts">✉ Email ' + byEmail + '</button>' : '')
      + '<button class="btn ' + (byEmail ? 'ghost' : 'white') + ' big" data-act="waQueueDrafts">💬 WhatsApp' + (byEmail ? ' queue' : ' ' + draftsNoEmail.length) + '</button></div>';
  } else if (sum.overdue) {
    bulk = '<div class="bulkbar"><div class="txt"><b>' + C.plural(sum.overdue, 'family is', 'families are') + ' overdue</b><span>Upload the latest bank statement first so nobody who paid is reminded.</span></div>'
      + '<button class="btn ghost big" data-act="pickStatement">🏦 Upload statement</button><button class="btn white big" data-act="openReminders">🔔 Send reminders</button></div>';
  }
  return '<div class="page-head"><div><h1>Invoices</h1><p>One invoice per family per month, with a PayNow QR that fills in the amount and the family\'s reference. Custom invoices can be written for anyone, for anything.</p></div>'
    + '<div class="actions"><div class="monthnav"><button data-act="period" data-d="-1" aria-label="Previous month">◀</button><b>' + esc(label) + '</b><button data-act="period" data-d="1" aria-label="Next month">▶</button></div>'
    + '<button class="btn" data-act="newCustomInvoice">＋ Custom invoice</button>'
    + '<button class="btn ghost" data-act="openGenericQr" title="The centre\'s PayNow QR, with no amount">📱 Generic QR</button>'
    + '<button class="btn ghost" data-act="openReminders">🔔 Reminders</button></div></div>'
    + '<div class="stats" style="margin-bottom:18px;">'
    + '<div class="stat deep"><div class="label">Billed</div><div class="value">' + money(sum.billed) + '</div><div class="hint">' + C.plural(sum.count, 'invoice') + '</div></div>'
    + '<div class="stat green"><div class="label">Collected</div><div class="value">' + money(sum.collected) + '</div><div class="hint">' + sum.percent + '%</div></div>'
    + '<div class="stat amber"><div class="label">Waiting</div><div class="value">' + money(sum.outstanding) + '</div><div class="hint">' + C.plural(sum.waiting + sum.part + sum.overdue, 'family', 'families') + '</div></div>'
    + '<div class="stat ' + (sum.overdue ? 'red' : '') + '"><div class="label">Overdue</div><div class="value">' + sum.overdue + '</div><div class="hint">past the due date</div></div></div>'
    + bulk
    + '<div class="toolbar"><div class="search"><input type="search" placeholder="Search parent, student, number or reference" value="' + esc(S.ui.invSearch) + '" data-in="invSearch" data-keep="invSearch" aria-label="Search invoices"></div></div>'
    + '<div class="chips" style="margin-bottom:16px;">' + chip('all', 'All') + chip('draft', '📝 Not sent') + chip('waiting', '⏳ Waiting') + chip('overdue', '⚠️ Overdue') + chip('part', '◐ Part paid') + chip('paid', '✅ Paid') + chip('void', '✕ Cancelled') + '</div>'
    + (!invs.length && covered ? '<div class="card">' + emptyHtml('🔗', 'Paid with ' + esc(C.periodLabel(joint.lead)), 'The ' + esc(C.periodLabel(joint.lead)) + ' invoices are for ' + esc(C.billingPeriodLabel(period, S.settings)) + '. A custom invoice dated this month still shows here.') + '</div>'
      : !invs.length ? '<div class="card">' + emptyHtml('🧾', 'No ' + esc(label) + ' invoices yet', missing.length ? 'Prepare them from each student\'s classes.' : 'Add families and put their children in classes first.', missing.length ? '<button class="btn" data-act="openPrepare">Prepare invoices</button>' : '') + '</div>'
      : !list.length ? '<div class="card">' + emptyHtml('🔍', 'Nothing here', 'Try another filter.') + '</div>'
        : '<div class="inv-list">' + list.map(invRowHtml).join('') + '</div>');
};
// A custom invoice (or one whose contacts were changed on the invoice) goes to
// the contacts written on it; a monthly invoice follows the family's current ones.
function recipientsFor(inv) {
  const own = inv.custom || inv.ownContacts;
  const f = famById(inv.familyId);
  return !own && f ? C.familyEmails(f) : (inv.emails || []).filter(C.isEmail);
}
function phoneFor(inv) {
  if (inv.custom || inv.ownContacts) return inv.whatsapp || '';
  const f = famById(inv.familyId); return (f && f.whatsapp) || inv.whatsapp || '';
}
function invRowHtml(inv) {
  const st = stateOf(inv);
  const owe = C.invoiceOutstanding(inv);
  const sends = inv.sends || [];
  const emailed = sends.some(s => s.via === 'email');
  const waed = sends.some(s => s.via === 'whatsapp');
  const rem = (inv.reminders || []).length;
  const kids = (inv.students || []).join(', ');
  const canEmail = recipientsFor(inv).length > 0, canWa = !!phoneFor(inv);
  // Before the due date the invoice itself is what goes out again; after it (or
  // once part is paid) it is a reminder.
  const remind = ['overdue', 'part'].includes(st.key);
  return '<div class="inv ' + st.tone + '" data-act="openInvoice" data-id="' + esc(inv.id) + '" role="button" tabindex="0">'
    + pill(st)
    + '<div class="who"><b>' + esc(inv.parentName) + (inv.custom ? ' <span class="tag-custom">Custom</span>' : '') + '</b><span>' + esc(inv.custom || inv.title ? C.invoiceTitle(inv, S.settings) + (kids ? ' · ' + kids : '') : kids) + '</span></div>'
    + '<div class="amt">' + money(inv.total) + (owe > 0 && owe < inv.total ? '<small>owes ' + money(owe) + '</small>' : '') + '</div>'
    + '<div class="meta">' + esc(inv.number) + '<br>Due ' + esc(C.prettyDateShort(inv.dueDate)) + '<div class="sent">'
    + '<span class="sentmark ' + (emailed ? 'on' : '') + '">✉ ' + (emailed ? 'sent' : canEmail ? '—' : 'no email') + '</span>'
    + '<span class="sentmark ' + (waed ? 'on' : '') + '">💬 ' + (waed ? 'sent' : '—') + '</span>'
    + (rem ? '<span class="sentmark">🔔 ' + rem + '</span>' : '') + '</div></div>'
    + '<div class="t-actions">'
    + (st.key === 'draft' && canEmail ? '<button class="btn sm" data-act="emailInvoice" data-id="' + esc(inv.id) + '" title="Email the invoice">✉ Email</button>' : '')
    + (remind && canEmail ? '<button class="btn sm ghost" data-act="remindOne" data-id="' + esc(inv.id) + '" title="Email a reminder">🔔</button>' : '')
    + (canWa && st.key !== 'paid' && st.key !== 'void' ? '<button class="btn sm wa" data-act="waOne" data-id="' + esc(inv.id) + '" data-kind="' + (remind ? 'reminder' : 'invoice') + '" title="Copy the invoice picture and open WhatsApp">💬</button>' : '')
    + '</div></div>';
}

/* ═══════════════ 🏦 Payments ═══════════════ */
VIEWS.payments = function () {
  if (S.review) return reviewHtml();
  let h = '<div class="page-head"><div><h1>Payments</h1><p>Drop a bank statement and every PayNow is matched to its family. Nothing is recorded until you press Apply.</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="recordPayment">💵 Record a cash / other payment</button></div></div>';
  if (S.lastApply) {
    const la = S.lastApply;
    const owing = allOwing();
    const fams = new Set(owing.map(i => i.familyId)).size;
    h += '<div class="banner green"><div class="big">✅</div><div style="flex:1"><b>' + C.plural(la.count, 'payment') + ' recorded · ' + money(la.total) + '</b>'
      + (la.receipts ? C.plural(la.receipts, 'receipt') + ' emailed. ' : '') + (la.skipped ? la.skipped + ' were already recorded and were skipped. ' : '')
      + (fams ? '<b style="display:inline">' + C.plural(fams, 'family still owes', 'families still owe') + ' ' + money(owing.reduce((s, i) => s + C.invoiceOutstanding(i), 0)) + '.</b>' : 'Nobody owes anything. 🎉') + '</div>'
      + (fams ? '<div class="actions"><button class="btn" data-act="openReminders">🔔 Send reminders</button></div>' : '') + '<button class="iconbtn" data-act="dismissApply" aria-label="Dismiss">✕</button></div>';
  }
  h += '<div class="card"><h2>🏦 Upload a bank statement</h2><div class="sub">PDF (straight from the bank\'s app or website), Excel or CSV. Overlapping statements are fine — a payment already recorded is recognised and skipped.</div>'
    + dropHtml()
    + '<div style="margin-top:14px;" class="check"><input type="checkbox" id="use-ai" data-ch="useAi" ' + (S.settings.useAi ? 'checked' : '') + '><label for="use-ai">Use ChatGPT to read the statement and to suggest who paid when the reference is missing</label></div></div>';
  // The ledger.
  const pays = S.payments.slice(0, 120);
  h += '<div class="card"><h2>Recorded payments</h2><div class="sub">Newest first. Undo puts the money back as unpaid on the invoices it paid.</div>'
    + (!pays.length ? emptyHtml('🧾', 'No payments recorded yet', 'They appear here once you apply a statement.')
      : '<div class="table-wrap" style="box-shadow:none;"><table class="t"><thead><tr><th>Date</th><th>Family</th><th class="r">Amount</th><th>Paid for</th><th>How</th><th></th></tr></thead><tbody>'
        + pays.map(p => '<tr><td class="nowrap">' + esc(C.prettyDate(p.date)) + '</td><td>' + esc(p.parentName || (famById(p.familyId) || {}).parentName || '?') + '</td>'
          + '<td class="r num"><b>' + money(p.amount) + '</b></td>'
          + '<td class="small">' + (p.allocations || []).map(a => esc(C.periodLabel(a.period)) + ' ' + money(a.amount)).join('<br>') + (p.credit > 0 ? '<br><span class="pill green">+' + money(p.credit) + ' credit</span>' : '') + '</td>'
          + '<td><span class="how ' + esc(String(p.how || '').replace('+', '-')) + '">' + esc(howLabel(p.how)) + '</span></td>'
          + '<td class="r"><button class="btn xs ghost" data-act="undoPayment" data-id="' + esc(p.id) + '">Undo</button></td></tr>').join('')
        + '</tbody></table></div>') + '</div>';
  if (S.statements.length) {
    h += '<div class="card"><h2>Statements uploaded</h2><div class="sub">The last ' + S.statements.length + '.</div><div class="history">'
      + S.statements.map(s => '<div><time>' + esc(timeAgo(tsMs(s.uploadedAt))) + '</time><span>' + esc(s.fileName || 'Statement') + ' — ' + (s.summary.credits || 0) + ' money-in, ' + (s.summary.applied || 0) + ' applied' + (s.aiUsed ? ' · read by ChatGPT' : '') + (s.appliedAt ? '' : ' · <i>not applied</i>') + '</span></div>').join('') + '</div></div>';
  }
  return h;
};
function howLabel(how) {
  return { reference: 'Reference', alias: 'Known payer', 'name+amount': 'Name + amount', name: 'Name', amount: 'Amount', ai: 'ChatGPT', manual: 'Chosen by you', cash: 'Cash', bank: 'Bank', other: 'Other' }[how] || how || '';
}

/* ═══════════════ ⚙️ Settings ═══════════════ */
VIEWS.settings = function () {
  const s = S.settingsDraft || (S.settingsDraft = clone(S.settings));
  const ap = S.autopilot;
  const radio = (v, title, text) => '<label class="radio-card ' + (s.autopilot === v ? 'on' : '') + '"><input type="radio" name="autopilot" value="' + v + '" data-ch="setAutopilot" ' + (s.autopilot === v ? 'checked' : '') + '><div><b>' + title + '</b><span>' + text + '</span></div></label>';
  const f = (k, label, type, help, attrs) => '<div class="field"><label for="set-' + k + '">' + label + '</label>'
    + (type === 'textarea' ? '<textarea id="set-' + k + '" data-in="setting" data-k="' + k + '" data-keep="set-' + k + '">' + esc(s[k]) + '</textarea>'
      : '<input id="set-' + k + '" type="' + (type || 'text') + '" value="' + esc(s[k]) + '" data-in="setting" data-k="' + k + '" data-keep="set-' + k + '" ' + (attrs || '') + '>')
    + (help ? '<div class="help">' + help + '</div>' : '') + '</div>';
  return '<div class="page-head"><div><h1>Settings</h1><p>Changes apply to the next invoice, reminder or email.</p></div>'
    + '<div class="actions"><button class="btn" data-act="saveSettings">Save settings</button></div></div>'
    + '<div class="grid two">'
    + '<div class="card"><h2>🧾 Invoices</h2><div class="sub">When invoices are dated and when they are due.</div><div class="form">'
    + f('invoiceDay', 'Invoice day of the month', 'number', 'Invoices are dated this day (1–28).', 'min="1" max="28"')
    + f('dueDays', 'Days to pay', 'number', 'Due date = invoice date + this many days.', 'min="0" max="60"')
    + f('reminderGapDays', 'Days between reminders', 'number', 'The same invoice is never reminded twice inside this gap.', 'min="1" max="60"')
    + f('hardcopyFee', 'Hardcopy printing a month ($)', 'number', 'For families with a hardcopy subscription. Above $0 it is added to their monthly invoices; a custom invoice always lists the line, with this amount filled in.', 'min="0" step="0.01" placeholder="0.00"')
    + '</div></div>'
    + combinedMonthsCard(s)
    + '<div class="card"><h2>🤖 Autopilot</h2><div class="sub">Runs every morning at 9am. ' + (ap && ap.lastRunAt ? 'Last run ' + esc(timeAgo(tsMs(ap.lastRunAt))) + ': ' + esc(ap.result || '') : 'It has not checked in yet.') + '</div>'
    + '<div class="radio-cards">' + radio('off', 'Off', 'You press "Prepare invoices" yourself each month.')
    + radio('review', 'Prepare, then ask me', 'On the invoice day it prepares every family\'s invoice and emails you to check and send them.')
    + radio('send', 'Prepare and email parents', 'On the invoice day it prepares and emails every family that has an email. Families without one wait for you on WhatsApp.') + '</div></div>'
    + '<div class="card"><h2>✉ Emails</h2><div class="sub">Sent from admin@polymathlc.com.sg through the centre\'s mail setup.</div><div class="form">'
    + f('fromName', 'Sender name') + f('replyTo', 'Replies go to', 'email')
    + '<div class="field full"><label class="check"><input type="checkbox" data-ch="settingBool" data-k="copyAdmin" ' + (s.copyAdmin ? 'checked' : '') + '> Send me a copy of every email (bcc)</label></div>'
    + '<div class="field full"><label class="check"><input type="checkbox" data-ch="settingBool" data-k="receipts" ' + (s.receipts ? 'checked' : '') + '> Email a receipt when a payment is recorded</label></div>'
    + '<div class="full">' + f('invoiceNote', 'Line at the end of every invoice', 'textarea') + '</div>'
    + '<div class="full">' + f('reminderNote', 'Line at the end of every reminder', 'textarea') + '</div>'
    + '<div class="full">' + f('signature', 'Signature', 'textarea') + '</div></div></div>'
    + '<div class="card"><h2>📱 PayNow</h2><div class="sub">Every QR pays this UEN, with the amount locked and the family\'s reference filled in.</div><div class="form">'
    + f('uen', 'UEN') + f('merchant', 'Name shown in the banking app') + f('centreWhatsapp', 'Centre WhatsApp number', 'tel')
    + '<div class="full actions"><button class="btn ghost" data-act="qrSelfTest">🔍 Test a QR</button><button class="btn ghost" data-act="openGenericQr">📱 Generic PayNow QR</button><span class="small muted" id="qr-test-out"></span></div></div>'
    + '<h2 style="margin-top:22px;">🧠 ChatGPT</h2><div class="sub">Reads bank statements and suggests who paid, through the centre\'s own server key (the same one the Science portal uses).</div>'
    + '<label class="check"><input type="checkbox" data-ch="settingBool" data-k="useAi" ' + (s.useAi ? 'checked' : '') + '> Use ChatGPT for bank statements</label>'
    + '<div class="actions" style="margin-top:12px;"><button class="btn ghost" data-act="aiTest">Test ChatGPT</button><span class="small muted" id="ai-test-out"></span></div></div>'
    + '<div class="card"><h2>🔒 Privacy check</h2><div class="sub">Parent details must never be readable without signing in.</div>'
    + (S.protected === true ? '<div class="banner green" style="margin:0"><div class="big">🔒</div><div><b>Locked.</b>A signed-out visitor is refused, as it should be.</div></div>'
      : S.protected === false ? '<div class="banner red" style="margin:0"><div class="big">🔓</div><div><b>Not locked.</b>Run the Polymath Office rules workflow with apply ticked.</div></div>'
        : '<div class="banner amber" style="margin:0"><div class="big">❔</div><div><b>Could not check.</b>Try again when online.</div></div>')
    + '<div class="actions" style="margin-top:12px;"><button class="btn ghost" data-act="recheckLock">Check again</button></div></div>'
    + '<div class="card"><h2>💾 Your data</h2><div class="sub">A copy for your own records.</div><div class="actions">'
    + '<button class="btn ghost" data-act="exportBackup">⬇ Download everything (JSON)</button><button class="btn ghost" data-act="exportFamilies">⬇ Families (CSV)</button><button class="btn ghost" data-act="exportInvoices">⬇ This month\'s invoices (CSV)</button></div></div>'
    + '</div>';
};

// Months billed together: a lead month whose fee also covers the next month.
function combinedMonthsCard(s) {
  const list = C.normalizeCombinedMonths(s.combinedMonths);
  const taken = new Set(list.flatMap(p => [p, C.addMonths(p, 1), C.addMonths(p, -1)]));
  const choices = [];
  for (let k = -3; k <= 24; k++) { const p = C.addMonths(C.sgMonthKey(), k); if (!taken.has(p)) choices.push(p); }
  return '<div class="card" id="combined-card"><h2>🔗 Months billed together</h2><div class="sub">When the centre closes for part of two months, one month\'s fee can cover both. The first month\'s invoice reads, say, "November – December 2026", and no invoice is prepared for the second month. In the payment record the second month follows the first.</div>'
    + (list.length ? '<div class="joint-list">' + list.map(p => '<div class="joint-item"><span class="pill deep">🔗 ' + esc(C.periodRangeLabel(p, C.addMonths(p, 1))) + '</span><span class="small muted">' + esc(C.periodLabel(p)) + ' fee pays both · no ' + esc(C.periodLabel(C.addMonths(p, 1))) + ' invoice</span>'
      + '<button class="linkbtn" data-act="combinedDel" data-p="' + p + '" aria-label="Bill ' + esc(C.periodLabel(C.addMonths(p, 1))) + ' separately again">Remove</button></div>').join('') + '</div>'
      : '<div class="small muted">Every month is billed on its own.</div>')
    + '<div class="joint-add"><select class="plain" id="combined-add" aria-label="First month of the pair">' + choices.map(p => '<option value="' + p + '">' + esc(C.periodRangeLabel(p, C.addMonths(p, 1))) + '</option>').join('') + '</select>'
    + '<button class="btn ghost" data-act="combinedAdd">＋ Bill these two months together</button></div>'
    + '<div class="help" style="margin-top:8px;">Press Save settings afterwards. Payments and marks already recorded are kept: a month marked paid on either month counts for both.</div></div>';
}

/* ═══════════════ Modals ═══════════════ */
const MODALS = {};
function openModal(state) {
  S.modal = state;
  renderModal();
  $('modal').scrollTop = 0;   // a new dialog always starts at its title
  $('modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function renderModal() {
  if (!S.modal) return;
  const m = MODALS[S.modal.type](S.modal);
  const box = $('modal-box');
  box.className = 'modal ' + (m.size || '');
  keepFocus(() => {
    box.innerHTML = '<div class="modal-head"><div><h2>' + m.title + '</h2>' + (m.sub ? '<p>' + m.sub + '</p>' : '') + '</div><button class="iconbtn x" data-act="closeModal" aria-label="Close">✕</button></div>'
      + '<div class="modal-body">' + m.body + '</div>' + (m.foot ? '<div class="modal-foot">' + m.foot + '</div>' : '');
  });
  hydrate(box);
}
// Dialogs that only show something (nothing typed into them can be lost).
const VIEW_ONLY_MODALS = new Set(['qr', 'genericQr', 'result']);
function modalIsViewOnly() {
  const m = S.modal;
  if (!m) return true;
  if (m.type === 'invoice') return !m.edit;
  return VIEW_ONLY_MODALS.has(m.type);
}
let nudgeTimer = null;
function nudgeModal() {
  const box = $('modal-box');
  box.classList.remove('nudge'); void box.offsetWidth; box.classList.add('nudge');
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => box.classList.remove('nudge'), 400);
  toast('To close, use ✕ or Cancel — your changes stay until you do.');
}
function closeModal() {
  // A small dialog opened from a bigger one (the QR from a family) goes back to it.
  if (S.modal && S.modal.back) { const back = S.modal.back; S.modal = back; renderModal(); return; }
  S.modal = null;
  $('modal').classList.remove('show');
  document.body.style.overflow = '';
}

/* ─── Family editor ─── */
function newFamilyDraft() {
  return C.normalizeFamily({ id: '', code: '', parentName: '', signUpDate: today(), students: [newStudent()] });
}
function newStudent() { return C.normalizeStudent({ id: sid(), name: '', level: '', status: 'active', startDate: today(), classes: [] }); }
function slotOptionsHtml(selected, level) {
  let html = '<option value="">Choose a class…</option>';
  C.DAYS.forEach(d => {
    html += '<optgroup label="' + d.name + '">';
    d.times.forEach(t => {
      const id = C.slotId(d.code, t.n);
      const s = C.scheduleSlot(S.schedule, id);
      const has = C.slotHasClass(s);
      const n = (IX.roster.get(id) || []).length;
      const star = has && level && C.normalizeLevel(s.level) === C.normalizeLevel(level) ? '★ ' : '';
      const label = star + t.label.split(/\s*[–—-]\s*/)[0] + ' · ' + (has ? C.slotTitle(s) + ' · ' + C.plural(n, 'student') + (s.status === 'closed' ? ' (hidden)' : '') : 'no class');
      html += '<option value="' + id + '" ' + (id === selected ? 'selected' : '') + (!has && id !== selected ? ' disabled' : '') + '>' + esc(label) + '</option>';
    });
    html += '</optgroup>';
  });
  html += '<option value="custom" ' + (selected === 'custom' ? 'selected' : '') + '>Other — a private arrangement…</option>';
  return html;
}
// The slot drop-down: tick as many slots as the child takes (Math on one day,
// Science on another). It opens in place, so it works the same on a phone.
function slotPickerHtml(s, si, open) {
  const ids = C.studentSlotIds(s);
  const type = '';
  const btn = '<button type="button" class="ms-btn ' + (open ? 'open' : '') + '" data-act="togglePicker" data-s="' + si + '" aria-expanded="' + !!open + '">'
    + '<span class="ms-val">' + (ids.length ? ids.map(id => { const sl = C.scheduleSlot(S.schedule, id); return subjChip(sl.subject, C.isMaster(sl), C.slotShortLabel(id) + ' · ' + (C.slotHasClass(sl) ? C.levelLabel(sl.level) + ' ' + sl.subject : 'no class')); }).join(' ') : '<span class="muted">Choose slots from the schedule…</span>') + '</span>'
    + '<span class="ms-caret">▾</span></button>';
  if (!open) return '<div class="ms">' + btn + '</div>';
  const groups = C.slotPickerGroups(S.schedule, { selected: ids, level: s.level, lessonType: type, roster: IX.roster });
  const any = groups.some(g => g.options.some(o => o.has));
  const pop = '<div class="ms-pop" role="group" aria-label="Slots for ' + esc(s.name || 'this child') + '">'
    + '<div class="ms-hint">Tick every slot the child takes; choose physical, online or Master class for each under Mode and fee.'
    + (s.level ? ' ★ = ' + esc(C.levelLabel(s.level)) + '.' : '') + '</div>'
    + (!any ? '<div class="ms-empty">The schedule has no classes yet. Add them at <a href="../schedule/#admin" target="_blank" rel="noopener">/schedule</a>.</div>' : '')
    + groups.map(g => {
      const opts = g.options.filter(o => o.has || o.chosen);
      if (!opts.length) return '';
      return '<div class="ms-day"><div class="ms-dayname">' + esc(g.name) + '</div>' + opts.map(o => {
        const k = o.master ? 'master' : (C.subjectKey(o.subject) || 'other');
        return '<label class="ms-opt ' + k + (o.fits || o.chosen ? '' : ' dim') + (o.chosen ? ' on' : '') + '">'
          + '<input type="checkbox" data-ch="pickSlot" data-s="' + si + '" value="' + o.id + '" ' + (o.chosen ? 'checked' : '') + (o.disabled ? ' disabled' : '') + '>'
          + '<span class="ms-t">' + esc(o.start) + '</span>'
          + '<span class="ms-ttl">' + (o.levelMatch ? '★ ' : '') + esc(o.title) + '</span>'
          + '<span class="ms-meta">' + (o.master ? '⭐' : o.modes.map(md => md === 'Online' ? '💻' : '🏫').join('')) + ' · ' + C.plural(o.count, 'student')
          + (o.status === 'full' ? ' · Full' : o.status === 'closed' ? ' · hidden on /schedule' : '') + '</span></label>';
      }).join('') + '</div>';
    }).join('')
    + '<div class="ms-foot"><span class="small muted">' + C.plural(ids.length, 'slot') + ' chosen</span><button type="button" class="btn xs" data-act="togglePicker" data-s="' + si + '">Done</button></div></div>';
  return '<div class="ms">' + btn + pop + '</div>';
}
function emailWarningsKey(f) {
  return JSON.stringify(C.familyRecordProblems(f, S.families).filter(p => p.field === 'email' || p.field === 'email2').map(p => p.text));
}
function paymentRecordHtml(f) {
  const rec = recordOf(f);
  const m = S.modal;
  const shots = rec.screenshots;
  const shown = m.allShots ? shots : shots.slice(0, 5);
  const periods = [];
  for (let i = -6; i <= 1; i++) periods.push(C.addMonths(C.sgMonthKey(), i));
  const lp = rec.lastPayment;
  const howLbl = !lp ? '' : lp.source === 'hand' ? 'month marked by hand' : (lp.how === 'manual' || lp.how === 'cash') ? 'recorded by hand' : 'matched from the bank statement';
  return '<div class="section-title" style="margin-top:22px;">Payment record</div>'
    + '<div class="rec-sum">'
    + '<div><span class="lbl">Months paid</span><b>' + (rec.paidText ? esc(rec.paidText) : '<span class="muted">None yet</span>') + '</b></div>'
    + '<div><span class="lbl">Last payment</span><b>' + (lp ? esc(C.prettyDate(lp.date)) + (lp.amount ? ' · ' + money(lp.amount) : '') : '<span class="muted">None yet</span>') + '</b>' + (lp ? '<small>' + esc(whenText(lp.date)) + (howLbl ? ' · ' + esc(howLbl) : '') + '</small>' : '') + '</div>'
    + '<div><span class="lbl">Last screenshot</span><b>' + (rec.lastScreenshot ? esc(C.prettyDate(rec.lastScreenshot.date)) : '<span class="muted">None yet</span>') + '</b>' + (rec.lastScreenshot ? '<small>' + esc(whenText(rec.lastScreenshot.date)) + (rec.lastScreenshot.period ? ' · for ' + esc(C.periodLabel(rec.lastScreenshot.period)) : '') + '</small>' : '') + '</div>'
    + '</div>'
    + '<div class="years">' + [...new Set(rec.months.map(mo => mo.year))].map(y => {
      const ms = rec.months.filter(mo => mo.year === y);
      const open = ms.filter(mo => !['paid', 'hand', 'package', 'gone'].includes(mo.key));
      const allHand = !open.length && ms.some(mo => mo.key === 'hand');
      return '<div class="year-row"><div class="year-head"><b>' + y + '</b>'
        + (open.length ? '<button type="button" class="btn xs ghost" data-act="markYear" data-y="' + y + '" title="For a family that paid the whole year">✔︎ Mark ' + (open.length === ms.length ? 'all of ' + y : 'the rest of ' + y) + ' paid</button>'
          : allHand ? '<button type="button" class="btn xs ghost" data-act="unmarkYear" data-y="' + y + '">Undo ' + y + ' marks</button>' : '')
        + '</div><div class="months" role="group" aria-label="' + y + '">' + ms.map(mo => '<button type="button" class="mo ' + mo.key + (mo.current ? ' cur' : '') + (mo.joint ? ' joint j-' + mo.joint : '') + '" data-act="markMonth" data-p="' + mo.period + '" title="' + esc(C.periodLabel(mo.period) + ': ' + (mo.stateLabel || C.MONTH_STATE_META[mo.key].label) + (mo.handDate ? ' on ' + C.prettyDate(mo.handDate) : '') + (mo.outstanding ? ' · ' + money(mo.outstanding) + ' to pay' : '')) + '">'
      + '<span class="mo-i">' + C.MONTH_STATE_META[mo.key].icon + '</span><b>' + esc(mo.label) + '</b><small>' + esc(mo.year.slice(2)) + '</small></button>').join('') + '</div></div>';
    }).join('') + '</div>'
    + '<div class="small muted" style="margin-top:6px;">September 2026 to December 2027. Months come from paid invoices (📦 = covered by a package). Tap a month to mark it paid by hand (cash, a whole year paid in advance, or paid before the office), tap again to undo; tap a paid invoice\'s month to open it.</div>'
    + '<div class="shots-head"><b>📸 Payment screenshots received</b><button type="button" class="btn xs" data-act="addShot">📸 Received today</button></div>'
    + (shown.length ? '<div class="shots">' + shown.map((x, i) => '<div class="shot-row">'
      + '<input type="date" value="' + esc(x.date) + '" data-ch="shot" data-i="' + i + '" data-k="date" aria-label="Date received">'
      + '<select data-ch="shot" data-i="' + i + '" data-k="period" aria-label="For which month"><option value="">For month…</option>' + [...new Set([...periods, x.period].filter(Boolean))].sort().map(p => '<option value="' + p + '" ' + (p === x.period ? 'selected' : '') + '>' + esc(C.periodLabel(p)) + '</option>').join('') + '</select>'
      + '<input type="text" placeholder="Note (optional)" value="' + esc(x.note) + '" data-in="shot" data-i="' + i + '" data-k="note" data-keep="shot-' + i + '">'
      + '<button type="button" class="iconbtn" data-act="delShot" data-i="' + i + '" title="Remove">✕</button></div>').join('') + '</div>'
      + (shots.length > 5 ? '<button type="button" class="linkbtn small" data-act="allShots">' + (m.allShots ? 'Show fewer' : 'Show all ' + shots.length) + '</button>' : '')
      : '<div class="small muted">None logged yet. When a parent WhatsApps a PayNow screenshot, tap “Received today”.</div>');
}
MODALS.family = function (m) {
  const f = m.draft;
  const isNew = !f.id;
  const fld = (k, label, type, extra) => '<div class="field ' + (extra && extra.full ? 'full' : '') + '"><label>' + label + '</label>'
    + (type === 'textarea' ? '<textarea data-in="fam" data-k="' + k + '">' + esc(f[k]) + '</textarea>'
      : '<input type="' + (type || 'text') + '" value="' + esc(k === 'whatsapp' && /^\d{9,}$/.test(f[k] || '') ? C.displayPhone(f[k]) : f[k]) + '" data-in="fam" data-k="' + k + '" data-keep="fam-' + k + '"' + (extra && extra.ch ? ' data-ch="' + extra.ch + '"' : '') + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>')
    + (extra && extra.help ? '<div class="help">' + extra.help + '</div>' : '') + '</div>';
  const inv = f.id ? invoicesOf(f.id) : [];
  const owe = f.id ? familyOwing(f.id) : 0;
  const problems = C.familyRecordProblems(f, S.families);
  const emailProblems = problems.filter(p => p.field === 'email' || p.field === 'email2');
  m.emailKey = emailWarningsKey(f);
  const extraProblems = C.extraFieldProblems(f);
  const stud = f.students.map((s, si) => {
    const classes = s.classes.map((c, ci) => {
      const slot = c.custom ? null : C.scheduleSlot(S.schedule, c.slotId);
      const fee = slot ? C.monthlyFeeFor(slot, C.classMode(c, S.schedule), S.schedule) : 0;
      const modes = slot && c.slotId ? C.slotClassModes(slot) : C.CLASS_MODES;
      const cur = c.custom ? (C.CLASS_MODES.includes(c.mode) ? c.mode : 'Physical') : C.classMode(c, S.schedule);
      return '<div class="class-row">'
        + (c.custom ? '<input type="text" placeholder="What is it? e.g. 1-to-1 Science" value="' + esc(c.label) + '" data-in="cls" data-s="' + si + '" data-c="' + ci + '" data-k="label" data-keep="cl-' + si + '-' + ci + '">'
          : c.slotId ? '<div class="cls-name">' + subjChip(slot.subject, C.isMaster(slot), C.slotShortLabel(c.slotId) + ' · ' + C.slotTitle(slot)) + '</div>'
            : '<select data-ch="clsSlot" data-s="' + si + '" data-c="' + ci + '">' + slotOptionsHtml(c.slotId, s.level) + '</select>')
        + '<select data-ch="cls" data-s="' + si + '" data-c="' + ci + '" data-k="mode" aria-label="Physical, online or master class">' + C.CLASS_MODES.map(md => '<option value="' + md + '" ' + (cur === md ? 'selected' : '') + (modes.includes(md) || cur === md ? '' : ' disabled') + '>' + esc(C.classModeLabel(md)) + '</option>').join('') + '</select>'
        + '<input type="number" min="0" step="0.01" placeholder="' + (c.custom ? 'Fee per month' : (fee ? 'Schedule ' + money(fee) : 'No fee set')) + '" value="' + esc(c.rate) + '" data-in="cls" data-s="' + si + '" data-c="' + ci + '" data-k="rate" data-keep="cr-' + si + '-' + ci + '" title="Leave blank to use the schedule\'s fee" aria-label="Monthly fee">'
        + '<button class="iconbtn" data-act="delClass" data-s="' + si + '" data-c="' + ci + '" title="Remove this class">✕</button></div>';
    }).join('');
    return '<div class="student-card"><div class="form">'
      + '<div class="field"><label>Student name</label><input type="text" value="' + esc(s.name) + '" data-in="stu" data-s="' + si + '" data-k="name" data-keep="sn-' + si + '"></div>'
      + '<div class="field"><label>Level</label><select data-ch="stu" data-s="' + si + '" data-k="level"><option value="">—</option>' + C.LEVELS.map(l => '<option value="' + l + '" ' + (C.normalizeLevel(s.level) === l ? 'selected' : '') + '>' + C.levelLabel(l) + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>Status</label><select data-ch="stu" data-s="' + si + '" data-k="status">' + [['active', 'Active'], ['paused', 'Paused (not billed)'], ['left', 'Left']].map(([v, l]) => '<option value="' + v + '" ' + (s.status === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>Primary school</label><input type="text" value="' + esc(s.school) + '" placeholder="e.g. Nanyang Primary" data-in="stu" data-s="' + si + '" data-k="school" data-keep="ss-' + si + '"></div>'
      + '<div class="field"><label>With us since</label><input type="date" value="' + esc(s.startDate) + '" data-in="stu" data-s="' + si + '" data-k="startDate"></div>'
      + '</div>'
      + '<div class="field" style="margin-top:14px;"><label>Slots <span class="opt">(tick more than one if the child takes Math and Science)</span></label>' + slotPickerHtml(s, si, m.picker === si) + '</div>'
      + (classes ? '<div class="section-title" style="margin-top:14px;">Mode and fee <span class="opt" style="text-transform:none;letter-spacing:0;font-weight:500;">— physical, online or Master class, for each class</span></div>' + classes : '')
      + '<div class="actions" style="margin-top:10px;"><button class="btn xs ghost" data-act="addCustom" data-s="' + si + '">＋ Other arrangement</button>'
      + '<span style="flex:1"></span><button class="btn xs danger" data-act="delStudent" data-s="' + si + '">Remove student</button></div>'
      + '<div class="form" style="margin-top:12px;grid-template-columns:2fr 1fr;">'
      + '<div class="field"><label>Notes about ' + esc(C.firstName(s.name) || 'this child') + ' <span class="opt">(optional)</span></label><input type="text" value="' + esc(s.notes) + '" data-in="stu" data-s="' + si + '" data-k="notes" data-keep="sno-' + si + '"></div>'
      + '<div class="field"><label>Own monthly fee <span class="opt">(optional)</span></label><input type="number" min="0" step="0.01" placeholder="From classes" value="' + esc(s.monthlyFee) + '" data-in="stu" data-s="' + si + '" data-k="monthlyFee" data-keep="sm-' + si + '"></div>'
      + '</div></div>';
  }).join('');
  const d = f.discount || { kind: '', value: '', label: '' };
  const body = '<div class="split"><div>'
    + '<div class="section-title">Family</div><div class="form">'
    + '<div class="field"><label>Status</label><select data-ch="famOpt" data-k="status" id="fam-status">' + C.FAMILY_STATUSES.map(t => '<option value="' + t.key + '" ' + (f.status === t.key ? 'selected' : '') + '>' + t.icon + ' ' + esc(t.label) + '</option>').join('') + '</select>'
    + '<div class="small muted">' + esc(C.familyStatusMeta(f.status).help) + '</div></div>'
    + fld('signUpDate', 'Signed up on', 'date')
    + '<div class="field"><label>Payment type</label><select data-ch="famOpt" data-k="paymentType">' + C.PAYMENT_TYPES.map(t => '<option value="' + t.key + '" ' + (f.paymentType === t.key ? 'selected' : '') + '>' + esc(t.label) + '</option>').join('') + '</select></div>'
    + (f.paymentType === 'package'
      ? '<div class="field help-cell"><div class="help">Months inside the package are not invoiced monthly and count as paid.</div></div>'
        + '<div class="field"><label>Package start</label><input type="date" value="' + esc(f.packageStart) + '" data-in="fam" data-ch="famOpt" data-k="packageStart"></div>'
        + '<div class="field"><label>Package end</label><input type="date" value="' + esc(f.packageEnd) + '" data-in="fam" data-ch="famOpt" data-k="packageEnd"></div>'
      : '<div></div>')
    + '<div class="field"><label>Hardcopy subscription</label><select data-ch="famOpt" data-k="hardcopy"><option value="no" ' + (f.hardcopy ? '' : 'selected') + '>No</option><option value="yes" ' + (f.hardcopy ? 'selected' : '') + '>📮 Yes</option></select></div>'
    + '<div></div>'
    + (f.hardcopy ? '<div class="field full"><label>Postal address for the hardcopy</label><textarea data-in="fam" data-ch="famOpt" data-k="address" placeholder="Block, street, unit, postal code">' + esc(f.address) + '</textarea></div>' : '')
    + (f.status === 'withdrawn' ? '<div class="field"><label>Last month with us</label><input type="month" value="' + esc(f.lastMonth) + '" data-in="fam" data-ch="famOpt" data-k="lastMonth"></div><div class="field help-cell"><div class="help">Billed up to and including this month, nothing after. Leave it empty if nothing more is owed.</div></div>' : '')
    + (f.status === 'paused' ? '<div class="field"><label>Paused from</label><input type="month" id="fam-pause-from" value="' + esc(f.pauseFrom) + '" data-in="fam" data-ch="famOpt" data-k="pauseFrom"></div>'
      + '<div class="field"><label>Paused until <span class="opt">(last paused month)</span></label><input type="month" id="fam-pause-until" value="' + esc(f.pauseUntil) + '" data-in="fam" data-ch="famOpt" data-k="pauseUntil"></div>'
      + '<div class="field full help-cell"><div class="help">These months are not invoiced. After the last paused month the family is billed again by itself; leave it empty to stay paused until you change the status.</div></div>' : '')
    + extraProblems.map(p => '<div class="full fix ' + (p.level === 'block' ? 'block">⛔ ' : 'warn">⚠ ') + esc(p.text) + '</div>').join('')
    + fld('email', 'Email <span class="opt">— the family\'s account ID</span>', 'email', { full: true, ch: 'famEmail', ph: 'one email for every child', help: 'Use the same email for all the family\'s children. One email = one family.' })
    + (emailProblems.length ? '<div class="full">' + emailProblems.map(p => '<div class="fix ' + p.level + '">' + (p.level === 'block' ? '⛔ ' : '✉ ') + esc(p.text)
      + (p.familyId ? ' <button class="linkbtn" data-act="openOwner" data-id="' + esc(p.familyId) + '">Open that family</button>' : '') + '</div>').join('') + '</div>' : '')
    + fld('parentName', 'Parent name', 'text', { full: true })
    + fld('whatsapp', 'WhatsApp number', 'tel', { ph: '9123 4567' }) + fld('email2', 'Second email <span class="opt">(copied on invoices)</span>', 'email', { ch: 'famEmail' })
    + (f.hardcopy ? '' : fld('address', 'Address <span class="opt">(optional)</span>', 'textarea', { full: true }))
    + '<div class="field"><label>Standing discount <span class="opt">(optional)</span></label><div style="display:flex;gap:6px;"><select data-ch="disc" data-k="kind" style="flex:0 0 112px;width:112px;"><option value="">None</option><option value="amount" ' + (d.kind === 'amount' ? 'selected' : '') + '>$ off</option><option value="percent" ' + (d.kind === 'percent' ? 'selected' : '') + '>% off</option></select>'
    + '<input type="number" min="0" step="0.01" value="' + esc(d.value) + '" data-in="disc" data-k="value" data-keep="dv" ' + (d.kind ? '' : 'disabled') + '></div></div>'
    + (d.kind ? '<div class="field"><label>Discount name</label><input type="text" value="' + esc(d.label || 'Sibling discount') + '" data-in="disc" data-k="label" data-keep="dl"></div>' : '<div></div>')
    + fld('notes', 'Notes <span class="opt">(anything — only staff see these)</span>', 'textarea', { full: true }) + '</div>'
    + '<div class="section-title" style="margin-top:20px;">PayNow reference</div>'
    + (f.code ? '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span class="code" style="font-size:15px;padding:6px 12px;">' + esc(C.familyReference(f.code)) + '</span>'
      + '<button class="btn xs ghost" data-act="copy" data-text="' + esc(C.familyReference(f.code)) + '">Copy</button><button class="btn xs ghost" data-act="familyQr">📱 QR for any amount</button></div>'
      + '<div class="small muted" style="margin-top:6px;">Every invoice adds the month, e.g. ' + esc(C.invoiceReference(f.code, C.sgMonthKey())) + '. The bank shows it on your statement, which is how payments are matched.</div>'
      : '<div class="small muted">A permanent code is created when you save.</div>')
    + (f.credit > 0 ? '<div class="banner green" style="margin-top:14px;"><div class="big">💳</div><div><b>Credit ' + money(f.credit) + '</b>Taken off the next invoice automatically.</div></div>' : '')
    + (f.payerNames && f.payerNames.length ? '<div class="small muted" style="margin-top:10px;">🏦 Bank names seen: ' + f.payerNames.map(p => esc(p.toUpperCase())).join(', ') + '</div>' : '')
    + '</div><div>'
    + '<div class="section-title">Children</div>' + stud
    + '<button class="btn ghost sm" data-act="addStudent">＋ Add another child</button>'
    + paymentRecordHtml(f)
    + (inv.length ? '<div class="section-title" style="margin-top:22px;">Invoices' + (owe > 0 ? ' · owes ' + money(owe) : '') + '</div><div class="history">'
      + inv.slice(0, 8).map(i => { const st = stateOf(i); return '<div><time>' + esc(C.invoicePeriodLabel(i, S.settings)) + '</time><span>' + money(i.total) + ' ' + pill(st) + ' <button class="linkbtn small" data-act="openInvoice" data-id="' + esc(i.id) + '">open</button></span></div>'; }).join('') + '</div>' : '')
    + '</div></div>';
  return {
    size: 'wide',
    title: isNew ? 'New family' : esc(f.parentName || 'Family'),
    sub: isNew ? 'One record per confirmed sign-up: the family\'s email, then each child, their type of lesson and slots.' : esc(C.familyStatusLabel(f.status) + ' · ' + C.plural(f.students.filter(s => s.status === 'active').length, 'active student') + (f.email ? ' · ' + f.email : '')),
    body,
    foot: (isNew ? '' : '<button class="btn danger left" data-act="deleteFamily">Delete family</button>')
      + (f.whatsapp ? '<a class="btn wa" href="' + esc(C.whatsappLink(f.whatsapp, 'Hi ' + (f.parentName || ''), !TOUCH)) + '" target="polymath_whatsapp" rel="noopener" data-act="noop">💬 WhatsApp</a>' : '')
      + (isNew ? '' : '<button class="btn ghost" data-act="newCustomInvoice" data-fam="' + esc(f.id) + '" title="Write an invoice by hand for this family">＋ Custom invoice</button>')
      + '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="saveFamily">' + (isNew ? 'Add family' : 'Save changes') + '</button>'
  };
};
MODALS.qr = function (m) {
  const amt = C.round2(m.amount || 0);
  const payload = amt > 0 ? C.buildPayNow(amt, m.reference, { uen: S.settings.uen, merchant: S.settings.merchant }) : '';
  return {
    size: 'narrow', title: '📱 PayNow QR', sub: esc(m.who || '') + ' · reference ' + esc(m.reference),
    body: '<div class="field"><label>Amount (SGD)</label><input type="number" min="0.01" step="0.01" value="' + esc(m.amount || '') + '" data-in="qrAmount" data-keep="qramt" placeholder="e.g. 220"></div>'
      + (payload ? '<div class="qr-box"><div class="amt">' + money(amt) + '</div><div class="q" data-qr="' + esc(payload) + '" data-size="220"></div><div class="ref">Reference <b>' + esc(m.reference) + '</b> · UEN ' + esc(S.settings.uen) + '</div></div>' : '<div class="small muted" style="margin-top:10px;">Type an amount to see the QR.</div>'),
    foot: '<button class="btn ghost" data-act="closeModal">' + (m.back ? '← Back' : 'Close') + '</button>' + (payload ? '<button class="btn" data-act="copy" data-text="' + esc(m.reference) + '">Copy reference</button><button class="btn" data-act="saveQr">⬇ Save the QR</button>' : '')
  };
};

/* ─── Import ─── */
MODALS.import = function (m) {
  if (!m.rows) {
    return {
      size: 'wide', title: '⬆ Import families and students', sub: 'From your Excel or Google Sheet. Nothing is saved until you check the preview.',
      body: '<div class="grid two"><div><div class="section-title">1 · Paste</div><div class="field"><label>Copy the whole table in Google Sheets or Excel — headings included — and paste it here</label>'
        + '<textarea style="min-height:220px;font-family:ui-monospace,Menlo,monospace;font-size:12px;" data-in="importPaste" placeholder="Online/Physical	Student Name	Parent	Contact number	Email address	Level	Math (Day)	Science (Day)…">' + esc(m.paste || '') + '</textarea></div></div>'
        + '<div><div class="section-title">…or choose a file</div><div class="drop" data-act="pickImportFile"><div class="big">📊</div><b>Excel or CSV</b><span>.xlsx, .xls or .csv</span></div>'
        + '<div class="banner blue" style="margin-top:16px;"><div class="big">💡</div><div><b>Columns it understands</b>Parent, Student Name, Contact number / WhatsApp / HP, Email, Address, Level, Online/Physical, Math (Day), Science (Day), Sign-up date, School, Fee, Remarks. '
        + 'Students with the same WhatsApp number (or email) become one family. "Science (Day) = Monday" finds that level\'s Monday Science class on the schedule.</div></div></div></div>',
      foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="importPreview" ' + (m.paste ? '' : 'disabled') + '>Preview →</button>'
    };
  }
  const plan = m.plan;
  const head = m.rows[0] || [];
  const mapSel = fk => '<select data-ch="importMap" data-k="' + fk.key + '"><option value="">— not in the sheet —</option>' + head.map((h, i) => '<option value="' + i + '" ' + (plan.mapping[fk.key] === i ? 'selected' : '') + '>' + esc(h || 'Column ' + (i + 1)) + '</option>').join('') + '</select>';
  const r = plan.report;
  return {
    size: 'wide', title: '⬆ Check the import', sub: esc(m.source || 'Pasted table') + ' · ' + C.plural(m.rows.length - 1, 'row'),
    body: '<div class="stats" style="margin-bottom:18px;"><div class="stat green"><div class="label">New families</div><div class="value">' + r.newFamilies + '</div></div>'
      + '<div class="stat deep"><div class="label">Existing families</div><div class="value">' + r.updatedFamilies + '</div><div class="hint">only new children added</div></div>'
      + '<div class="stat"><div class="label">Students</div><div class="value">' + r.students + '</div></div>'
      + '<div class="stat ' + (r.needsClass.length ? 'amber' : '') + '"><div class="label">Need a class</div><div class="value">' + r.needsClass.length + '</div><div class="hint">pick them after</div></div></div>'
      + '<div class="grid two"><div><div class="section-title">Which column is which</div><div class="form">'
      + C.IMPORT_FIELDS.map(fk => '<div class="field"><label>' + esc(fk.label) + '</label>' + mapSel(fk) + '</div>').join('') + '</div>'
      + '<label class="check" style="margin-top:14px;"><input type="checkbox" data-ch="importFee" ' + (m.useSheetFee ? 'checked' : '') + '> Use the sheet\'s Fee column as each student\'s own monthly fee (instead of the schedule\'s class fees)</label></div>'
      + '<div><div class="section-title">Preview</div><div style="max-height:420px;overflow:auto;" class="history">'
      + plan.families.slice(0, 80).map(f => '<div style="display:block;padding:10px 12px;border:1px solid var(--line);border-radius:10px;"><b>' + esc(f.parentName) + '</b> ' + (f._isNew ? '<span class="pill green">new</span>' : '<span class="pill deep">existing</span>')
        + '<div class="small muted">' + esc([C.familyEmails(f)[0], C.displayPhone(f.whatsapp)].filter(Boolean).join(' · ') || 'no contact') + '</div>'
        + f.students.map(s => '<div class="small">• ' + esc(s.name) + ' ' + esc(C.levelLabel(s.level)) + ' — ' + (s.classes.length ? s.classes.map(c => esc(C.slotShortLabel(c.slotId) + ' ' + (C.scheduleSlot(S.schedule, c.slotId).subject || ''))).join(', ') : '<span class="warn-t">no class</span>') + '</div>').join('') + '</div>').join('')
      + (plan.families.length > 80 ? '<div class="muted small">…and ' + (plan.families.length - 80) + ' more.</div>' : '')
      + '</div>' + (r.needsClass.length ? '<div class="banner amber" style="margin-top:12px;"><div class="big">🧩</div><div><b>Pick these classes after importing</b>' + r.needsClass.slice(0, 12).map(esc).join('<br>') + (r.needsClass.length > 12 ? '<br>…' : '') + '</div></div>' : '')
      + (r.skipped.length ? '<div class="small muted" style="margin-top:8px;">Skipped: ' + r.skipped.slice(0, 6).map(esc).join(' · ') + '</div>' : '') + '</div></div>',
    foot: '<button class="btn ghost left" data-act="importBack">← Back</button><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="importCommit" ' + (plan.families.length ? '' : 'disabled') + '>Import ' + C.plural(plan.families.length, 'family', 'families') + '</button>'
  };
};

/* ─── Prepare invoices ─── */
MODALS.prepare = function (m) {
  if (m.done) {
    const made = m.done.created;
    const noEmail = made.filter(id => { const inv = IX.invById.get(id); return inv && !recipientsFor(inv).length; }).length;
    return {
      size: 'narrow', title: '✅ ' + C.plural(made.length, 'invoice') + ' prepared', sub: esc(C.periodLabel(m.period)),
      body: '<p style="font-size:15px;">They are saved as <b>not sent</b>. Send them now, or look through them first on the Invoices tab.</p>'
        + (m.done.failed ? '<div class="banner amber" style="margin-top:12px;"><div class="big">⚠️</div><div><b>' + m.done.failed + ' could not be saved.</b>Try again in a moment.</div></div>' : '')
        + (noEmail ? '<p class="muted small" style="margin-top:10px;">' + C.plural(noEmail, 'family has', 'families have') + ' no email — use the WhatsApp queue for them.</p>' : ''),
      foot: '<button class="btn ghost" data-act="closeModal">Look through them first</button><button class="btn wa" data-act="waQueueDrafts">💬 WhatsApp</button><button class="btn" data-act="emailDrafts">✉ Email ' + (made.length - noEmail) + ' now</button>'
    };
  }
  const items = m.items;
  const picked = items.filter(x => x.pick);
  const total = C.round2(picked.reduce((s, x) => s + x.inv.total, 0));
  return {
    size: 'wide', title: 'Prepare ' + esc(C.periodLabel(m.period)) + ' invoices', sub: 'Priced from each student\'s classes on the schedule. Untick anyone you do not want to bill.',
    body: '<div class="table-wrap" style="box-shadow:none;max-height:58vh;"><table class="t"><thead><tr><th><input type="checkbox" data-ch="prepAll" ' + (picked.length === items.length ? 'checked' : '') + ' aria-label="Tick all"></th><th>Family</th><th>What is billed</th><th class="r">Total</th></tr></thead><tbody>'
      + items.map((x, i) => '<tr class="' + (x.pick ? '' : 'muted') + '"><td><input type="checkbox" data-ch="prepPick" data-i="' + i + '" ' + (x.pick ? 'checked' : '') + '></td>'
        + '<td><b>' + esc(x.inv.parentName) + '</b><div class="small muted">' + esc(x.inv.reference) + (x.inv.emails.length ? '' : ' · no email') + '</div></td>'
        + '<td class="small">' + x.inv.lines.map(l => esc((l.studentName ? l.studentName + ': ' : '') + l.desc + (l.detail ? ' (' + l.detail + ')' : '')) + ' <b class="num">' + money(l.amount) + '</b>').join('<br>')
        + (x.inv.issues.length ? '<div class="warn-t" style="margin-top:4px;">⚠ ' + x.inv.issues.map(esc).join('<br>⚠ ') + '</div>' : '') + '</td>'
        + '<td class="r num"><b>' + money(x.inv.total) + '</b></td></tr>').join('')
      + '</tbody></table></div>',
    foot: '<span class="left muted">' + C.plural(picked.length, 'invoice') + ' · ' + money(total) + '</span><button class="btn ghost" data-act="closeModal">Cancel</button>'
      + '<button class="btn" data-act="prepareCommit" ' + (picked.length ? '' : 'disabled') + '>Create ' + C.plural(picked.length, 'invoice') + '</button>'
  };
};

/* ─── One invoice ─── */
// The QR box shown on an invoice, by the invoice's own QR choice.
function qrBoxHtml(inv, owe, opts) {
  const o = opts || {};
  const mode = C.invoiceQrMode(inv);
  const payload = C.invoiceQrPayload(inv, S.settings);
  if (!payload) {
    if (!(owe > 0)) return '';
    return '<div class="qr-box none"><div class="amt">' + money(owe) + '</div><div class="ref">No QR on this invoice · quote <b>' + esc(inv.number) + '</b></div></div>';
  }
  return '<div class="qr-box"><div class="amt">' + money(owe) + '</div>'
    + (mode === 'generic' ? '<div class="small muted" style="margin-bottom:6px;">Generic QR — the parent types the amount</div>' : '')
    + '<div class="q" data-qr="' + esc(payload) + '" data-size="' + (o.size || 200) + '"></div><div class="ref">Reference <b>' + esc(inv.reference) + '</b> · UEN ' + esc(S.settings.uen) + '</div>'
    + (o.buttons === false ? '' : '<div class="actions" style="justify-content:center;margin-top:12px;"><button class="btn sm" data-act="saveInvoiceQr">⬇ Save QR</button><button class="btn sm ghost" data-act="saveInvoiceImage">⬇ Save invoice picture</button></div>')
    + '</div>';
}
// The three QR choices as radio cards (used on the invoice and in the editor).
function qrModePicker(current, act, name) {
  return '<div class="qr-modes" role="radiogroup" aria-label="QR on this invoice">' + C.QR_MODES.map(k => {
    const meta = C.QR_MODE_META[k];
    return '<label class="qr-mode ' + (current === k ? 'on' : '') + '"><input type="radio" name="' + esc(name || 'qrmode') + '" value="' + k + '" data-ch="' + act + '" ' + (current === k ? 'checked' : '') + '>'
      + '<span><b>' + (k === 'exact' ? '🔒 ' : k === 'generic' ? '📱 ' : '🚫 ') + esc(meta.label) + '</b><small>' + esc(meta.hint) + '</small></span></label>';
  }).join('') + '</div>';
}
MODALS.invoice = function (m) {
  const inv = IX.invById.get(m.id);
  if (!inv) return { title: 'Invoice', body: emptyHtml('🧾', 'This invoice is gone', 'It may have been deleted.') };
  const st = stateOf(inv);
  const owe = C.invoiceOutstanding(inv);
  const fam = famById(inv.familyId);
  const lines = inv.lines || [];
  const linesHtml = '<table class="inv-lines"><tbody>' + lines.map(l =>
    '<tr><td>' + (l.studentName ? '<b>' + esc(l.studentName) + '</b><br>' : '') + esc(l.desc) + (l.detail ? '<div class="det">' + esc(l.detail) + '</div>' : '') + '</td><td class="r" style="' + (l.amount < 0 ? 'color:var(--green)' : '') + '">' + money(l.amount) + '</td></tr>').join('')
    + '<tr class="total"><td>Total</td><td class="r">' + money(inv.total) + '</td></tr>'
    + (inv.paid > 0 ? '<tr><td class="muted">Received</td><td class="r" style="color:var(--green)">' + money(inv.paid) + '</td></tr><tr><td><b>Still to pay</b></td><td class="r"><b>' + money(owe) + '</b></td></tr>' : '')
    + '</tbody></table>';
  const hist = [];
  if (inv.createdAt) hist.push([tsMs(inv.createdAt), (inv.custom ? 'Written by hand' : 'Prepared') + (inv.createdBy === 'autopilot' ? ' by the autopilot' : '')]);
  if (inv.editedAt) hist.push([tsMs(inv.editedAt), '✏️ Edited' + (inv.editedBy ? ' by ' + inv.editedBy : '')]);
  (inv.sends || []).forEach(s => hist.push([s.at, (s.via === 'email' ? '✉ Emailed' : s.via === 'whatsapp' ? '💬 WhatsApp opened' : '✓ Marked as sent') + (s.to ? ' to ' + s.to.join(', ') : '') + (s.mailId && S.mailState[s.mailId] ? ' — ' + S.mailState[s.mailId] : '')]));
  (inv.reminders || []).forEach(r => hist.push([r.at, '🔔 Reminder ' + (r.level || '') + ' by ' + (r.via === 'email' ? 'email' : 'WhatsApp') + (r.mailId && S.mailState[r.mailId] ? ' — ' + S.mailState[r.mailId] : '')]));
  (inv.payments || []).forEach(p => hist.push([p.at || 0, '💰 ' + money(p.amount) + ' received ' + (p.date ? C.prettyDate(p.date) : '') + (p.how ? ' (' + howLabel(p.how) + ')' : '')]));
  hist.sort((a, b) => a[0] - b[0]);
  const canEmail = recipientsFor(inv).length > 0, canWa = !!phoneFor(inv);
  const live = inv.status !== 'void' && st.key !== 'paid' && st.key !== 'free';
  // Before the due date the invoice itself is what goes out again; after it (or
  // once part is paid) it is a reminder.
  const remind = ['overdue', 'part'].includes(st.key);
  const mode = C.invoiceQrMode(inv);
  const directPaid = (inv.payments || []).some(p => String(p.paymentId || '').startsWith('direct-'));
  const noContact = inv.custom || inv.ownContacts
    ? '<div class="banner amber" style="margin:0;padding:10px 12px;"><div>✉ No email on this invoice — <button class="linkbtn" data-act="editInvoice" data-id="' + esc(inv.id) + '">add one</button>.</div></div>'
    : '<div class="banner amber" style="margin:0;padding:10px 12px;"><div>✉ No email for this family — <button class="linkbtn" data-act="openFamily" data-id="' + esc(inv.familyId) + '">add one</button>.</div></div>';
  return {
    size: 'wide', title: esc(inv.parentName) + ' · ' + esc(inv.custom || inv.title ? C.invoiceTitle(inv, S.settings) : C.invoicePeriodLabel(inv, S.settings)), sub: esc(inv.number) + ' · ' + pill(st) + (inv.custom ? ' <span class="tag-custom">Custom</span>' : '') + (isFinite(Date.parse(inv.dueDate)) ? ' · due ' + esc(C.prettyDate(inv.dueDate)) : ''),
    body: '<div class="split" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);"><div><div class="inv-paper"><div class="hd"><b>POLYMATH LEARNING CENTRE</b><span>Invoice ' + esc(inv.number) + '</span></div><div class="bar"></div><div class="bd">'
      + '<div class="small muted" style="margin-bottom:6px;">For ' + esc(inv.parentName) + ' · issued ' + esc(C.prettyDate(inv.issueDate)) + '</div>'
      + (inv.custom || inv.title ? '<div style="font-weight:700;margin-bottom:6px;">' + esc(C.invoiceTitle(inv, S.settings)) + '</div>' : '')
      + linesHtml
      + qrBoxHtml(inv, owe)
      + (inv.note ? '<div class="small" style="margin-top:12px;white-space:pre-wrap;">' + esc(inv.note) + '</div>' : '')
      + (inv.issues && inv.issues.length ? '<div class="banner amber" style="margin-top:12px;"><div class="big">⚠️</div><div><b>Check these</b>' + inv.issues.map(esc).join('<br>') + '</div></div>' : '')
      + '</div></div>'
      + (inv.status !== 'void' && owe > 0 ? '<div class="section-title" style="margin-top:16px;">QR on this invoice</div>' + qrModePicker(mode, 'invQrMode', 'qr-' + inv.id)
        + '<div class="small muted" style="margin-top:6px;">Changes the office, the parent\'s page and anything sent from now on.</div>' : '')
      + '</div>'
      + '<div><div class="section-title">Send</div><div class="side-actions">'
      + (live ? (canEmail ? '<button class="btn" data-act="emailInvoice" data-id="' + esc(inv.id) + '">✉ ' + ((inv.sends || []).some(s => s.via === 'email') ? 'Email the invoice again' : 'Email the invoice') + '</button>' : noContact)
        + (remind && canEmail ? '<button class="btn ghost" data-act="remindOne" data-id="' + esc(inv.id) + '">🔔 Email a reminder' + ((inv.reminders || []).length ? ' (#' + ((inv.reminders || []).length + 1) + ')' : '') + '</button>' : '')
        + (canWa ? '<button class="btn wa" data-act="waOne" data-id="' + esc(inv.id) + '" data-kind="' + (remind ? 'reminder' : 'invoice') + '">💬 WhatsApp ' + (remind ? 'a reminder' : 'the invoice') + '</button><div class="small muted">Copies the invoice picture' + (mode === 'none' ? '' : ' (with the QR)') + ' and opens the chat — press Ctrl+V there, then Enter.</div>' : '')
        + '<button class="btn ghost" data-act="copyPayLink" data-id="' + esc(inv.id) + '">🔗 Copy the parent\'s pay link</button>'
        + (st.key === 'draft' ? '<button class="btn ghost" data-act="markSent" data-id="' + esc(inv.id) + '">✓ I sent it myself — mark as sent</button>' : '') : '')
      + '<div class="section-title" style="margin-top:12px;">Money</div>'
      + (live && fam ? '<button class="btn ghost" data-act="recordPayment" data-fam="' + esc(inv.familyId) + '" data-amt="' + owe + '">💵 Record a payment</button>' : '')
      + (live && !fam ? '<button class="btn ghost" data-act="markPaidDirect" data-id="' + esc(inv.id) + '">✓ Mark as paid (' + money(owe) + ')</button>' : '')
      + (directPaid && !fam ? '<button class="btn ghost" data-act="undoPaidDirect" data-id="' + esc(inv.id) + '">↩ Undo "marked as paid"</button>' : '')
      + (inv.status !== 'void' ? '<button class="btn ghost" data-act="editInvoice" data-id="' + esc(inv.id) + '">✏️ Edit the invoice</button>' : '')
      + (inv.custom ? '<button class="btn ghost" data-act="duplicateInvoice" data-id="' + esc(inv.id) + '">⧉ Copy into a new custom invoice</button>' : '')
      + (inv.status !== 'void' && !(inv.paid > 0) ? '<button class="btn danger" data-act="voidInvoice" data-id="' + esc(inv.id) + '">✕ Cancel this invoice</button>' : '')
      + (inv.custom && !(inv.paid > 0) && !(inv.sends || []).length ? '<button class="btn danger ghost" data-act="deleteCustomInvoice" data-id="' + esc(inv.id) + '">🗑 Delete this custom invoice</button>' : '')
      + (inv.status === 'void' ? '<button class="btn ghost" data-act="unvoidInvoice" data-id="' + esc(inv.id) + '">↩ Restore this invoice</button>' : '')
      + '</div><div class="section-title" style="margin-top:22px;">History</div><div class="history">'
      + (hist.length ? hist.map(([at, txt]) => '<div><time>' + (at ? esc(new Date(at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })) : '') + '</time><span>' + esc(txt) + '</span></div>').join('') : '<div class="muted">Nothing yet.</div>')
      + '</div>' + (fam ? '<div style="margin-top:16px;"><button class="linkbtn" data-act="openFamily" data-id="' + esc(fam.id) + '">Open the family →</button></div>' : '') + '</div></div>',
    foot: ''
  };
};

/* ─── The invoice editor: a new custom invoice, or any invoice changed ───
   Every field a parent sees is here: who it is for and their contacts, the
   number, title, dates, the month it is listed under, every line, the
   reference, a note, and which QR it carries. The preview on the right is the
   invoice exactly as the parent will see it. */
function editorPreview(d) {
  const res = C.invoiceFromDraft(d);
  const f = res.fields;
  const base = d.id ? IX.invById.get(d.id) : null;
  const preview = Object.assign({}, base || {}, f, { custom: d.custom || (base && base.custom), paid: base ? Number(base.paid) || 0 : 0, status: base && base.status === 'void' ? 'void' : 'draft' });
  const owe = C.invoiceOutstanding(preview);
  return { res, preview, owe };
}
function editorLinesHtml(d) {
  return '<div class="ed-lines">' + (d.lines || []).map((l, i) =>
    '<div class="ed-line' + (l.prefill ? ' pre' : '') + (l.kind === 'arrears' ? ' arrears' : '') + '"' + (l.prefill ? ' title="Filled in from the family record"' : l.kind === 'arrears' ? ' title="An earlier month not yet paid"' : '') + '>'
    + '<div class="field"><label>Student</label><input type="text" value="' + esc(l.studentName || '') + '" placeholder="optional" data-in="edLine" data-i="' + i + '" data-k="studentName" data-keep="es' + i + '"></div>'
    + '<div class="field grow"><label>What it is for</label><input type="text" value="' + esc(l.desc || '') + '" placeholder="e.g. P5 Math — November" data-in="edLine" data-i="' + i + '" data-k="desc" data-keep="ed' + i + '"></div>'
    + '<div class="field grow"><label>Detail</label><input type="text" value="' + esc(l.detail || '') + '" placeholder="optional, e.g. 4 lessons" data-in="edLine" data-i="' + i + '" data-k="detail" data-keep="et' + i + '"></div>'
    + '<div class="field amt"><label>Amount ($)</label><input class="money" type="text" inputmode="decimal" value="' + esc(l.amount === '' || l.amount == null ? '' : String(l.amount)) + '" placeholder="0.00" data-in="edLine" data-i="' + i + '" data-k="amount" data-keep="ea' + i + '"></div>'
    + '<div class="ed-line-x">'
    + (i > 0 ? '<button class="iconbtn" data-act="edLineUp" data-i="' + i + '" title="Move up" aria-label="Move line ' + (i + 1) + ' up">↑</button>' : '')
    + '<button class="iconbtn" data-act="edLineDel" data-i="' + i + '" title="Remove this line" aria-label="Remove line ' + (i + 1) + '">✕</button></div></div>').join('')
    + '</div><div class="actions" style="margin-top:8px;"><button class="btn xs ghost" data-act="edLineAdd">＋ Add a line</button><button class="btn xs ghost" data-act="edLineAdd" data-neg="1">＋ Add a discount</button></div>'
    + '<div class="small muted" style="margin-top:6px;">A discount is a line with a minus amount, e.g. -20.</div>';
}
MODALS.invEdit = function (m) {
  const d = m.draft;
  const isNew = !m.editing;
  const base = d.id ? IX.invById.get(d.id) : null;
  const { res, preview, owe } = editorPreview(d);
  const famOpts = '<option value="">— Not linked to a family —</option>' + S.families.slice().sort(by('parentName')).map(f => '<option value="' + esc(f.id) + '" ' + (f.id === d.familyId ? 'selected' : '') + '>' + esc(C.familyDisplayName(f)) + ' · ' + esc(C.familyReference(f.code)) + '</option>').join('');
  const field = (k, label, opts) => {
    const o = opts || {};
    const v = d[k] == null ? '' : d[k];
    const input = o.textarea
      ? '<textarea data-in="ed" data-k="' + k + '" data-keep="ef-' + k + '" placeholder="' + esc(o.ph || '') + '">' + esc(v) + '</textarea>'
      : '<input type="' + (o.type || 'text') + '" value="' + esc(v) + '" data-in="ed" data-k="' + k + '" data-keep="ef-' + k + '" placeholder="' + esc(o.ph || '') + '"' + (o.attrs ? ' ' + o.attrs : '') + '>';
    return '<div class="field' + (o.full ? ' full' : '') + '"><label>' + label + '</label>' + input + (o.hint ? '<div class="small muted">' + o.hint + '</div>' : '') + '</div>';
  };
  const months = [];
  for (let k = -6; k <= 6; k++) months.push(C.addMonths(C.sgMonthKey(), k));
  if (C.isPeriod(d.period) && !months.includes(d.period)) months.push(d.period);
  months.sort();
  const left = '<div class="ed-form">'
    + '<div class="section-title">Who it is for</div><div class="form">'
    + '<div class="field full"><label>Link to a family (optional)</label><select data-ch="edFamily">' + famOpts + '</select><div class="small muted">Linking fills in the details below and lets a bank payment with this reference be matched to the family. You can still change every field.</div></div>'
    + field('parentName', 'Parent\'s name', { ph: 'e.g. Mrs Tan Mei Ling', full: true })
    + field('emails', 'Email(s)', { ph: 'parent@example.com, second@example.com', hint: 'Separate two addresses with a comma.' })
    + field('whatsapp', 'WhatsApp number', { type: 'tel', ph: '9123 4567' })
    + '</div>'
    + '<div class="section-title" style="margin-top:16px;">The invoice</div><div class="form">'
    + field('title', 'Title', { ph: preview.custom || d.custom ? 'e.g. Holiday programme — December 2026' : C.periodLabel(d.period) + ' tuition fees', full: true, hint: 'Shown at the top of the invoice and in the email subject.' })
    + field('number', 'Invoice number')
    + field('reference', 'PayNow reference', { hint: 'Up to 25 letters and digits. It is printed in the QR and on the bank statement.' })
    + field('issueDate', 'Invoice date', { type: 'date' })
    + field('dueDate', 'Due date', { type: 'date' })
    + '<div class="field"><label>Listed under</label><select data-ch="edPeriod">' + months.map(p => '<option value="' + p + '" ' + (p === d.period ? 'selected' : '') + '>' + esc(C.periodLabel(p)) + '</option>').join('') + '</select><div class="small muted">The month this invoice shows in on the Invoices tab.</div></div>'
    + '</div>'
    + '<div class="section-title ed-lines-head" style="margin-top:16px;"><span>Lines</span>' + editorFillButtons(d) + '</div>'
    + editorDoubleBillHtml(d) + editorLinesHtml(d) + editorArrearsHtml(d)
    + '<div class="section-title" style="margin-top:16px;">QR on the invoice</div>' + qrModePicker(d.qrMode, 'edQrMode', 'ed-qr')
    + '<div class="form" style="margin-top:12px;">' + field('note', 'Note at the end of the invoice', { textarea: true, full: true, ph: S.settings.invoiceNote || 'optional', hint: 'Left empty, the usual line from Settings is used.' }) + '</div>'
    + (base && base.paid > 0 ? '<div class="banner amber" style="margin-top:12px;"><div class="big">💰</div><div><b>' + money(base.paid) + ' has already been received on this invoice.</b>It stays recorded; what is still owed follows the new total.</div></div>' : '')
    + '</div>';
  const right = '<div class="ed-preview"><div class="section-title">Preview</div><div class="inv-paper"><div class="hd"><b>POLYMATH LEARNING CENTRE</b><span>Invoice ' + esc(res.fields.number || '—') + '</span></div><div class="bar"></div><div class="bd">'
    + '<div class="small muted" style="margin-bottom:6px;">For ' + esc(res.fields.parentName || '…') + (C.isDayKey(res.fields.issueDate) ? ' · issued ' + esc(C.prettyDate(res.fields.issueDate)) : '') + '</div>'
    + '<div style="font-weight:700;margin-bottom:6px;">' + esc(C.invoiceTitle(preview, S.settings)) + '</div>'
    + '<table class="inv-lines"><tbody>' + res.fields.lines.map(l => '<tr><td>' + (l.studentName ? '<b>' + esc(l.studentName) + '</b><br>' : '') + esc(l.desc) + (l.detail ? '<div class="det">' + esc(l.detail) + '</div>' : '') + '</td><td class="r" style="' + (l.amount < 0 ? 'color:var(--green)' : '') + '">' + money(l.amount) + '</td></tr>').join('')
    + '<tr class="total"><td>Total</td><td class="r" id="ed-total">' + money(res.fields.total) + '</td></tr>'
    + (preview.paid > 0 ? '<tr><td class="muted">Received</td><td class="r" style="color:var(--green)">' + money(preview.paid) + '</td></tr><tr><td><b>Still to pay</b></td><td class="r"><b>' + money(owe) + '</b></td></tr>' : '')
    + '</tbody></table>'
    + qrBoxHtml(preview, owe, { buttons: false, size: 170 })
    + (C.isDayKey(res.fields.dueDate) ? '<div class="small muted" style="margin-top:10px;">Due ' + esc(C.prettyDate(res.fields.dueDate)) + '</div>' : '')
    + ((res.fields.note || S.settings.invoiceNote) ? '<div class="small" style="margin-top:8px;white-space:pre-wrap;">' + esc(res.fields.note || S.settings.invoiceNote) + '</div>' : '')
    + '</div></div>'
    + (!res.ok && m.tried ? '<div class="banner red" style="margin-top:12px;"><div class="big">⚠️</div><div><b>Not saved yet</b>' + res.errors.map(esc).join('<br>') + '</div></div>' : '')
    + '</div>';
  return {
    size: 'wide', title: isNew ? '＋ Custom invoice' : '✏️ Edit invoice ' + esc((base && base.number) || ''),
    sub: isNew ? 'Write any invoice by hand. Nothing is sent until you press Email or WhatsApp afterwards.' : 'Every field can be changed. The parent\'s page updates when you save.',
    body: '<div class="split ed-split">' + left + right + '</div>',
    foot: (m.back ? '<button class="btn ghost left" data-act="closeModal">← Back</button>' : '<button class="btn ghost left" data-act="closeModal">Cancel</button>')
      + '<span class="muted" id="ed-foot-total">' + C.plural(res.fields.lines.length, 'line') + ' · ' + money(res.fields.total) + '</span>'
      + '<button class="btn" data-act="saveInvoiceEdit">' + (isNew ? 'Create the invoice' : 'Save the changes') + '</button>'
  };
};

// The family's fees: fill them in again, or take them off (a materials invoice).
function editorFillButtons(d) {
  const f = famById(d.familyId);
  const pre = (d.lines || []).some(l => l.prefill);
  return '<span class="ed-fill">'
    + (f ? '<button class="btn xs ghost" data-act="edFill" title="Each child\'s classes and fees from the family record">↻ Fill in ' + esc(C.firstWords ? '' : '') + 'the children\'s fees</button>' : '')
    + (pre ? '<button class="btn xs ghost" data-act="edUnfill" title="Keep only the lines you typed, e.g. for a materials purchase">✕ Take off the children\'s fees</button>' : '')
    + '</span>';
}
// A custom invoice with the children's fees for a month that already has its own invoice charges twice.
function editorDoubleBillHtml(d) {
  if (!d.custom || !d.familyId) return '';
  const pre = (d.lines || []).find(l => l.prefill && C.isPeriod(l.forPeriod));
  if (!pre) return '';
  const inv = invoiceFor(d.familyId, pre.forPeriod);
  if (!inv || inv.status === 'void') return '';
  return '<div class="banner amber ed-double" style="margin:0 0 10px;"><div class="big">⚠️</div><div><b>This family already has a ' + esc(C.invoicePeriodLabel(inv, S.settings)) + ' invoice (' + esc(inv.number) + ', ' + esc(stateOf(inv).label.toLowerCase()) + ').</b>'
    + 'These fee lines would charge the same months again. Take them off for a materials invoice, or add only the unpaid months below.</div></div>';
}
// Earlier months the family has not paid (say October 2026), to collect on this invoice too.
function editorArrears(d) {
  const f = famById(d.familyId);
  if (!f) return [];
  const exclude = (d.lines || []).filter(l => l.kind === 'arrears').map(l => l.period);
  const others = S.invoices.filter(i => i.id !== d.id);
  return C.arrearsMonths(f, others, S.payments, { today: today(), settings: S.settings, schedule: S.schedule, before: d.period, exclude });
}
function editorArrearsHtml(d) {
  const list = editorArrears(d);
  if (!list.length) return '';
  return '<div class="arrears-box"><div class="small"><b>⏳ Not yet paid:</b> add an earlier month to this invoice so the parent pays everything at once. It shows as paid once this invoice is paid.</div>'
    + '<div class="arrears-btns">' + list.map(a => '<button class="btn xs ghost" data-act="edArrears" data-p="' + a.period + '">＋ ' + esc(a.label) + (a.amount ? ' · ' + money(a.amount) : '') + '</button>').join('') + '</div></div>';
}

/* ─── The centre's generic PayNow QR ─── */
MODALS.genericQr = function (m) {
  const payload = C.genericPayNow(S.settings, m.reference || '');
  return {
    size: 'narrow', title: '📱 Generic PayNow QR', sub: 'Pays ' + esc(S.settings.merchant) + ' (UEN ' + esc(S.settings.uen) + '). The parent types the amount.',
    body: '<div class="field"><label>Reference (optional)</label><input type="text" value="' + esc(m.reference || '') + '" placeholder="POLYMATH" maxlength="25" data-in="genericRef" data-keep="genref"><div class="small muted">Left empty, the reference is POLYMATH. Payers can change it in their banking app.</div></div>'
      + '<div class="qr-box"><div class="amt">Any amount</div><div class="q" data-qr="' + esc(payload) + '" data-size="220"></div><div class="ref">' + esc(S.settings.merchant) + ' · UEN ' + esc(S.settings.uen) + ' · reference <b>' + esc(C.cleanRef(m.reference) || 'POLYMATH') + '</b></div></div>',
    foot: '<button class="btn ghost" data-act="closeModal">Close</button><button class="btn" data-act="saveGenericQr">⬇ Save the QR</button>'
  };
};

/* ─── WhatsApp queue ─── */
MODALS.waq = function (m) {
  const list = m.ids.map(id => IX.invById.get(id)).filter(Boolean);
  if (!list.length || m.i >= list.length) {
    return { size: 'narrow', title: '💬 WhatsApp queue — done', body: '<p>' + C.plural(m.sent || 0, 'chat') + ' opened, ' + (m.skipped || 0) + ' skipped.</p>', foot: '<button class="btn" data-act="closeModal">Close</button>' };
  }
  const inv = list[m.i];
  const phone = phoneFor(inv);
  const text = m.kind === 'reminder' ? C.whatsappReminderText(inv, S.settings, inv.linkToken ? C.payLink(inv.linkToken) : '') : C.whatsappInvoiceText(inv, S.settings, inv.linkToken ? C.payLink(inv.linkToken) : '');
  return {
    size: 'wide', title: '💬 ' + (m.kind === 'reminder' ? 'Reminders' : 'Invoices') + ' by WhatsApp — ' + (m.i + 1) + ' of ' + list.length,
    sub: 'For each family: press the green button, then in WhatsApp press <span class="kbd">Ctrl</span>+<span class="kbd">V</span> to paste the picture and <span class="kbd">Enter</span> to send. Come back here for the next one.',
    body: '<div class="meter" style="margin-bottom:16px;"><span style="width:' + (m.i / list.length * 100) + '%"></span></div>'
      + '<div class="waq"><div><img class="preview" data-invimg="' + esc(inv.id) + '" alt="Invoice picture for ' + esc(inv.parentName) + '"></div>'
      + '<div><h3 style="font-size:18px;">' + esc(inv.parentName) + '</h3><div class="muted" style="margin-bottom:12px;">' + (phone ? '💬 ' + esc(C.displayPhone(phone)) : '<span class="warn-t">No WhatsApp number</span>') + ' · ' + money(C.invoiceOutstanding(inv)) + '</div>'
      + '<div class="small muted" style="margin-bottom:6px;">The message typed in for you:</div><pre>' + esc(text) + '</pre>'
      + (m.last === inv.id ? '<div class="banner green" style="margin-top:12px;"><div class="big">📋</div><div><b>Picture copied, chat opened.</b>Paste it in WhatsApp, send, then press Next.</div></div>' : '')
      + '</div></div>',
    foot: '<button class="btn ghost left" data-act="waSkip">Skip <span class="kbd">S</span></button>'
      + '<button class="btn ghost" data-act="waNext">Next ▶ <span class="kbd">→</span></button>'
      + (phone ? '<button class="btn wa big" data-act="waSend">📋 Copy picture &amp; open WhatsApp <span class="kbd">Enter</span></button>' : '')
  };
};

/* ─── Reminders ─── */
MODALS.reminders = function (m) {
  const items = m.items;
  const picked = items.filter(x => x.pick);
  const emailN = picked.filter(x => x.email).length, waN = picked.filter(x => !x.email && x.wa).length;
  const lastSt = S.statements[0];
  return {
    size: 'wide', title: '🔔 Payment reminders', sub: C.plural(items.length, 'invoice') + ' not fully paid. Ticked ones are reminded; anyone reminded in the last ' + S.settings.reminderGapDays + ' days is left unticked.',
    body: (lastSt ? '' : '<div class="banner amber"><div class="big">🏦</div><div><b>No bank statement uploaded yet.</b>Upload one first so families who have already paid are not reminded.</div></div>')
      + (!items.length ? emptyHtml('🎉', 'Nobody owes anything', 'All invoices are paid.') :
        '<div class="table-wrap" style="box-shadow:none;max-height:56vh;"><table class="t"><thead><tr><th><input type="checkbox" data-ch="remAll" ' + (picked.length === items.length ? 'checked' : '') + '></th><th>Family</th><th>Month</th><th class="r">Owes</th><th>Status</th><th>Reminded</th><th>By</th></tr></thead><tbody>'
        + items.map((x, i) => { const st = stateOf(x.inv); const n = (x.inv.reminders || []).length; const last = (x.inv.reminders || []).map(r => r.day).filter(Boolean).sort().pop();
          return '<tr><td><input type="checkbox" data-ch="remPick" data-i="' + i + '" ' + (x.pick ? 'checked' : '') + '></td><td><b>' + esc(x.inv.parentName) + '</b></td><td>' + esc(C.periodLabel(x.inv.period)) + '</td>'
            + '<td class="r num"><b>' + money(C.invoiceOutstanding(x.inv)) + '</b></td><td>' + pill(st) + '</td><td class="small">' + (n ? n + '× · last ' + esc(C.prettyDateShort(last)) : '—') + '</td>'
            + '<td>' + (x.email ? '✉ email' : x.wa ? '💬 WhatsApp' : '<span class="warn-t">no contact</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'),
    foot: '<button class="btn ghost" data-act="closeModal">Cancel</button>'
      + (waN ? '<button class="btn wa" data-act="remindWa">💬 WhatsApp ' + waN + '</button>' : '')
      + '<button class="btn" data-act="remindEmail" ' + (emailN ? '' : 'disabled') + '>🔔 Email ' + C.plural(emailN, 'reminder') + '</button>'
  };
};

/* ─── Record a payment by hand ─── */
MODALS.pay = function (m) {
  const fams = S.families.slice().sort((a, b) => a.parentName.localeCompare(b.parentName));
  const f = m.familyId ? famById(m.familyId) : null;
  const open = f ? invoicesOf(f.id).filter(i => C.invoiceOutstanding(i) > 0) : [];
  return {
    size: 'narrow', title: '💵 Record a payment', sub: 'Cash, a cheque, or a transfer you can see in your banking app.',
    body: '<div class="form"><div class="field full"><label>Family</label><select data-ch="payFam"><option value="">Choose…</option>' + fams.map(x => '<option value="' + esc(x.id) + '" ' + (x.id === m.familyId ? 'selected' : '') + '>' + esc(C.familyDisplayName(x)) + (familyOwing(x.id) > 0 ? ' — owes ' + money(familyOwing(x.id)) : '') + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>Amount</label><input type="number" min="0.01" step="0.01" value="' + esc(m.amount || '') + '" data-in="payM" data-k="amount" data-keep="pamt"></div>'
      + '<div class="field"><label>Date</label><input type="date" value="' + esc(m.date) + '" data-in="payM" data-k="date"></div>'
      + '<div class="field"><label>How</label><select data-ch="payM" data-k="method">' + [['cash', 'Cash'], ['bank', 'Bank transfer'], ['other', 'Other']].map(([v, l]) => '<option value="' + v + '" ' + (m.method === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>Note <span class="opt">(optional)</span></label><input type="text" value="' + esc(m.note || '') + '" data-in="payM" data-k="note" data-keep="pnote"></div></div>'
      + (f ? '<div class="small muted" style="margin-top:12px;">' + (open.length ? 'It pays ' + open.sort(by('period')).map(i => esc(C.invoicePeriodLabel(i, S.settings)) + ' (' + money(C.invoiceOutstanding(i)) + ')').join(', then ') + '; anything extra is kept as credit.' : 'Nothing is owed, so it is kept as credit for the next invoice.') + '</div>' : ''),
    foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="payCommit" ' + (f && Number(m.amount) > 0 ? '' : 'disabled') + '>Record ' + (Number(m.amount) > 0 ? money(m.amount) : 'payment') + '</button>'
  };
};
MODALS.progress = function (m) {
  return { size: 'narrow', title: m.title, sub: m.sub || '', body: '<div class="meter" style="margin:6px 0 12px;"><span style="width:' + (m.total ? (m.done / m.total * 100) : 0) + '%"></span></div><p class="muted">' + m.done + ' of ' + m.total + (m.note ? ' · ' + esc(m.note) : '') + '</p>', foot: '' };
};
MODALS.result = function (m) {
  return { size: 'narrow', title: m.title, body: m.body, foot: '<button class="btn" data-act="closeModal">OK</button>' };
};
// 📊 A statistics category opened: its students, and ways to act on them.
function categoryRows(key) {
  const sc = statScope();
  return C.categoryStudents(sc.families, key, { schedule: S.schedule, period: sc.period, kidFilter: sc.kidFilter });
}
MODALS.category = function (m) {
  const rows = categoryRows(m.key);
  const sc = statScope();
  const fams = new Set(rows.map(r => r.familyId)).size;
  const fees = rows.reduce((n, r) => n + r.fees, 0);
  const label = C.statCategoryLabel(m.key);
  const ico = m.key === 'all' ? '👦' : (C.STAT_CATEGORIES.find(x => x.key === m.key) || {}).icon;
  return {
    size: 'wide', title: ico + ' ' + esc(label) + ' · ' + C.plural(rows.length, 'student'),
    sub: C.plural(fams, 'family', 'families') + ' · ' + money(fees) + ' a month in fees · ' + esc(C.periodLabel(sc.period)) + (sc.filtered ? ' · within the families shown' : ''),
    body: rows.length ? '<div class="table-wrap cat-wrap" style="box-shadow:none;max-height:60vh;"><table class="t cat-list"><thead><tr><th>Student</th><th>' + (m.key === 'all' ? 'Classes' : esc(label) + ' classes') + '</th><th class="r">Fees</th><th>Parent</th><th>Email</th></tr></thead><tbody>'
      + rows.map(r => '<tr class="click" data-act="catOpenFamily" data-id="' + esc(r.familyId) + '"><td><b>' + esc(r.name) + '</b> <span class="muted small">' + esc(C.levelLabel(r.level) || '') + '</span>' + (r.school ? '<div class="small muted">' + esc(r.school) + '</div>' : '') + '</td>'
        + '<td>' + r.classes.map(x => subjChip(x.subject === 'math' ? 'Math' : x.subject === 'science' ? 'Science' : '', x.mode === 'Master', x.label + ' ' + modeIcon(x.mode))).join(' ') + '</td>'
        + '<td class="r nowrap">' + money(r.fees) + '</td>'
        + '<td>' + esc(r.parentName) + (r.whatsapp ? '<div class="small muted nowrap">💬 ' + esc(C.displayPhone(r.whatsapp)) + '</div>' : '') + '</td>'
        + '<td class="small em">' + (r.emails.length ? esc(r.emails.join(', ')) : '<span class="warn-t">no email</span>') + '</td></tr>').join('')
      + '</tbody></table></div>' : emptyHtml('🔍', 'Nobody here', 'No active student is in this category' + (sc.filtered ? ' among the families shown.' : '.')),
    foot: '<button class="btn ghost" data-act="catCsv" data-k="' + esc(m.key) + '"' + (rows.length ? '' : ' disabled') + '>⬇ CSV</button>'
      + (m.key === 'all' ? '' : '<button class="btn ghost" data-act="catShow" data-k="' + esc(m.key) + '">Show these families</button>')
      + '<button class="btn" data-act="catEmail" data-k="' + esc(m.key) + '"' + (rows.length ? '' : ' disabled') + '>📣 Email their families</button>'
  };
};
VIEW_ONLY_MODALS.add('category');
// 📣 Announcements: the confirm step and a sent announcement's log.
MODALS.annConfirm = function (m) {
  const aud = annAudience();
  const d = C.cleanAnnouncement(S.ui.ann.draft);
  const names = aud.sending.map(r => r.parentName || 'Unnamed');
  return {
    size: 'narrow', title: '📣 Send this announcement?', sub: 'It goes out at once and cannot be called back.',
    body: '<div class="ann-confirm"><div><span class="muted">Subject</span><br><b>' + esc(d.subject) + '</b></div>'
      + '<div><span class="muted">To</span><br><b>' + C.plural(aud.families, 'family', 'families') + '</b> (' + C.plural(aud.addresses, 'email address', 'email addresses') + ') · ' + esc(C.audienceSummary(annSelection(), S.schedule)) + '</div>'
      + '<div class="small">' + esc(names.slice(0, 20).join(', ')) + (names.length > 20 ? ' and ' + (names.length - 20) + ' more' : '') + '</div>'
      + (aud.noEmail ? '<div class="small warn-t">' + C.plural(aud.noEmail, 'family has', 'families have') + ' no email and will not get it.</div>' : '')
      + '<label class="check"><input type="checkbox" data-ch="annSure" ' + (m.sure ? 'checked' : '') + '> I have checked the preview and want to email these ' + C.plural(aud.families, 'family', 'families') + '</label></div>',
    foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="annGo" ' + (m.sure && aud.families ? '' : 'disabled') + '>Email ' + C.plural(aud.families, 'family', 'families') + ' now</button>'
  };
};
MODALS.annLog = function (m) {
  const h = S.announcements.find(x => x.id === m.id);
  if (!h) return { size: 'narrow', title: 'Announcement', body: '<p class="muted">Not found.</p>', foot: '<button class="btn" data-act="closeModal">Close</button>' };
  const sample = { parentName: '{parent}', students: [] };
  return {
    title: '📣 ' + esc(h.subject), sub: 'Sent ' + esc(annWhen(h.sentAtMs)) + ' by ' + esc(h.sentBy || '?') + ' · ' + esc(h.audience || ''),
    body: '<div class="ann-log-body">' + (h.greet ? '<p class="muted">Dear {parent},</p>' : '') + C.announcementBodyHtml(h.body || '') + '</div>'
      + '<h3 class="ann-h" style="margin-top:16px;">' + C.plural(h.families || 0, 'family', 'families') + ' · ' + C.plural(h.addresses || 0, 'address', 'addresses') + '</h3>'
      + '<div class="table-wrap" style="box-shadow:none;max-height:40vh;"><table class="t"><thead><tr><th>Family</th><th>Sent to</th><th>Delivery</th></tr></thead><tbody>'
      + (h.recipients || []).map(r => '<tr><td><b>' + esc(r.parentName || '') + '</b></td><td class="small">' + esc((r.to || []).join(', ')) + '</td><td class="small">' + esc(S.mailState[r.mailId] || '—') + '</td></tr>').join('')
      + '</tbody></table></div>'
      + (h.failed && h.failed.length ? '<div class="banner red" style="margin-top:12px;"><div class="big">⚠️</div><div><b>' + h.failed.length + ' not sent</b>' + h.failed.map(f => esc(f.parentName + ': ' + f.error)).join('<br>') + '</div></div>' : '')
      + '<div id="delivery-note" class="small muted" style="margin-top:10px;"></div>',
    foot: '<button class="btn ghost" data-act="annReuse" data-id="' + esc(h.id) + '">Write a new one from this</button><button class="btn ghost" data-act="annCheck" data-id="' + esc(h.id) + '">Check delivery</button><button class="btn" data-act="closeModal">Close</button>'
  };
};

/* ═══════════════ QR codes and invoice pictures ═══════════════ */
function renderQr(el, payload, size) {
  el.innerHTML = '';
  if (typeof QRCode === 'undefined') { el.textContent = 'QR unavailable — PayNow to UEN ' + S.settings.uen; return; }
  new QRCode(el, { text: payload, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}
// The QR as a canvas with a white quiet zone round it (the products page's method).
function qrCanvas(payload, size) {
  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(holder);
    try { renderQr(holder, payload, size); } catch (e) { holder.remove(); reject(e); return; }
    const finish = () => {
      const c = holder.querySelector('canvas'), img = holder.querySelector('img');
      const out = document.createElement('canvas');
      const pad = Math.round(size * 0.08);
      out.width = out.height = size + pad * 2;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
      if (c) { ctx.drawImage(c, pad, pad, size, size); holder.remove(); resolve(out); return; }
      if (img && img.complete && img.naturalWidth) { ctx.drawImage(img, pad, pad, size, size); holder.remove(); resolve(out); return; }
      if (img) { img.onload = finish; return; }
      holder.remove(); reject(new Error('The QR could not be drawn'));
    };
    setTimeout(finish, 30);
  });
}
async function qrPngBase64(payload) { return (await qrCanvas(payload, 480)).toDataURL('image/png'); }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function fitText(ctx, text, max) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
// The picture pasted into WhatsApp and saved from the invoice: everything a
// parent needs on one image, with the QR big enough to scan off a screen.
async function invoiceImage(inv) {
  const owe = C.invoiceOutstanding(inv);
  const W = 760, P = 44, QR = 380;
  const lines = inv.lines || [];
  const payload = C.invoiceQrPayload(inv, S.settings);
  const mode = C.invoiceQrMode(inv);
  const titled = !!(inv.custom || String(inv.title || '').trim());
  const noteLines = String(inv.note || '').trim() ? String(inv.note).trim().split(/\n/).slice(0, 4) : [];
  const H = 128 + 96 + lines.length * 54 + 70 + (owe > 0 ? (payload ? QR + 120 + 4 * 42 + 80 : 3 * 42 + 90) : 120) + noteLines.length * 26 + (noteLines.length ? 20 : 0);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (w, s) => w + ' ' + s + 'px "DM Sans","Plus Jakarta Sans",Arial,sans-serif';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#10303a'; ctx.fillRect(0, 0, W, 112);
  const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#2e9ca6'); g.addColorStop(.5, '#56c4d0'); g.addColorStop(1, '#ec008c');
  ctx.fillStyle = g; ctx.fillRect(0, 108, W, 6);
  ctx.fillStyle = '#fff'; ctx.font = font('bold', 26); ctx.fillText('POLYMATH LEARNING CENTRE', P, 52);
  ctx.fillStyle = '#b8e4e8'; ctx.font = font('500', 19); ctx.fillText(fitText(ctx, 'Invoice ' + inv.number + ' · ' + (titled ? C.prettyDate(inv.issueDate) : C.invoicePeriodLabel(inv, S.settings)), W - P * 2), P, 84);
  let y = 158;
  ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 18); ctx.fillText('For ' + (inv.parentName || ''), P, y);
  y += 30;
  ctx.fillStyle = '#10303a'; ctx.font = font('bold', 24);
  ctx.fillText(fitText(ctx, C.invoiceTitle(inv, S.settings), W - P * 2), P, y);
  y += 26;
  lines.forEach(l => {
    y += 40;
    ctx.textAlign = 'left'; ctx.fillStyle = '#10303a'; ctx.font = font('bold', 19);
    ctx.fillText(fitText(ctx, (l.studentName ? l.studentName + ' — ' : '') + l.desc, W - P * 2 - 150), P, y);
    ctx.textAlign = 'right'; ctx.fillStyle = l.amount < 0 ? '#15803d' : '#10303a'; ctx.fillText(money(l.amount), W - P, y);
    if (l.detail) { ctx.textAlign = 'left'; ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 15); ctx.fillText(fitText(ctx, l.detail, W - P * 2 - 150), P, y + 20); }
    ctx.strokeStyle = '#e7eef0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + 32); ctx.lineTo(W - P, y + 32); ctx.stroke();
  });
  y += 76;
  ctx.textAlign = 'left'; ctx.fillStyle = '#10303a'; ctx.font = font('bold', 22); ctx.fillText(inv.paid > 0 && owe > 0 ? 'Still to pay' : 'Total', P, y);
  ctx.textAlign = 'right'; ctx.fillStyle = '#056c76'; ctx.font = font('bold', 30); ctx.fillText(money(owe > 0 ? owe : inv.total), W - P, y);
  ctx.textAlign = 'left';
  if (owe > 0 && !payload) {
    // No QR on this invoice: the amount, the number and the due date.
    y += 30;
    [['Pay to', C.CENTRE_NAME], ['Amount', money(owe)], ['Quote', inv.number]].forEach(([k, v]) => {
      y += 42;
      ctx.textAlign = 'left'; ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 18); ctx.fillText(k, P, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#10303a'; ctx.font = font('bold', 20); ctx.fillText(v, W - P, y);
      ctx.strokeStyle = '#eef3f4'; ctx.beginPath(); ctx.moveTo(P, y + 14); ctx.lineTo(W - P, y + 14); ctx.stroke();
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 15);
    if (C.isDayKey(inv.dueDate)) ctx.fillText('Due ' + C.prettyDate(inv.dueDate) + '.', W / 2, y + 50);
    y += 60;
  } else if (owe > 0) {
    y += 34;
    const box = QR + 40, bx = (W - box) / 2;
    ctx.fillStyle = '#f2f9fa'; roundRect(ctx, bx, y, box, box, 20); ctx.fill();
    ctx.strokeStyle = '#d1eaee'; ctx.lineWidth = 2; roundRect(ctx, bx, y, box, box, 20); ctx.stroke();
    const qr = await qrCanvas(payload, QR - 30);
    ctx.drawImage(qr, bx + 20, y + 20, QR, QR);
    y += box + 46;
    [['Pay to', S.settings.merchant], ['UEN', S.settings.uen], ['Amount', money(owe) + (mode === 'generic' ? ' (type it in)' : '')], ['Reference', inv.reference]].forEach(([k, v]) => {
      ctx.textAlign = 'left'; ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 18); ctx.fillText(k, P, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#10303a'; ctx.font = font('bold', 20); ctx.fillText(v, W - P, y);
      ctx.strokeStyle = '#eef3f4'; ctx.beginPath(); ctx.moveTo(P, y + 14); ctx.lineTo(W - P, y + 14); ctx.stroke();
      y += 42;
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#3d5a61'; ctx.font = font('500', 17);
    ctx.fillText('Save this picture → open your banking app → Scan QR → choose from gallery', W / 2, y + 22);
    ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 15);
    ctx.fillText((mode === 'generic' ? 'The reference is filled in — type the amount, ' + money(owe) + '.' : 'The amount and the reference are already filled in.') + (C.isDayKey(inv.dueDate) ? ' Due ' + C.prettyDate(inv.dueDate) + '.' : ''), W / 2, y + 48);
    y += 60;
  } else {
    y += 60; ctx.textAlign = 'center'; ctx.fillStyle = '#15803d'; ctx.font = font('bold', 24); ctx.fillText('Paid — thank you!', W / 2, y);
  }
  if (noteLines.length) {
    y += 28; ctx.textAlign = 'center'; ctx.fillStyle = '#3d5a61'; ctx.font = font('500', 16);
    noteLines.forEach(t => { ctx.fillText(fitText(ctx, t, W - P * 2), W / 2, y); y += 26; });
  }
  return cv.toDataURL('image/png');
}
// Save to a phone's photos (share sheet) or download on a computer.
async function savePng(dataUrl, name) {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], name, { type: 'image/png' });
  if (TOUCH && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(dataUrl, name);
}

/* ═══════════════ Writing to Firestore ═══════════════ */
const ts = () => FV.serverTimestamp();
const famRef = id => db.collection(COL.families).doc(id);
const invRef = id => db.collection(COL.invoices).doc(id);
const linkRef = t => db.collection(COL.links).doc(t);
const payRef = id => db.collection(COL.payments).doc(id);
function stripLocal(f) {
  const o = clone(f);
  delete o._raw; delete o._isNew; delete o.id;
  return o;
}
async function saveFamily() {
  if (!requireProtected()) return;
  const draft = C.normalizeFamily(S.modal.draft);
  draft.students = draft.students.filter(s => s.name);
  const problems = C.familyRecordProblems(draft, S.families);
  const block = problems.find(p => p.level === 'block');
  if (block) { S.modal.picker = null; renderModal(); toast(block.text, 'err'); return; }
  if (!draft.id && !draft.email && !confirm('This family has no email yet. The email is the family\'s account ID with the centre. Save without one?')) return;
  draft.students.forEach(s => { if (!s.id) s.id = sid(); });
  const btn = document.querySelector('[data-act="saveFamily"]');
  busy(btn, true);
  try {
    if (!draft.code) draft.code = C.newCode(rnd, new Set(S.families.map(f => f.code)));
    const data = Object.assign(stripLocal(draft), { updatedAt: ts(), updatedBy: S.user.email });
    if (!draft.id) {
      const ref = db.collection(COL.families).doc();
      await ref.set(Object.assign(data, { createdAt: ts() }));
      toast('Family added · reference ' + C.familyReference(draft.code), 'ok');
    } else {
      await famRef(draft.id).set(data, { merge: false });
      toast('Saved', 'ok');
    }
    closeModal();
  } catch (e) { fail('Could not save the family', e); } finally { busy(btn, false); }
}
async function deleteFamily() {
  const f = S.modal.draft;
  if (!f.id || !requireProtected()) return;
  const invs = invoicesOf(f.id);
  if (invs.length) {
    if (!confirm(f.parentName + ' has ' + C.plural(invs.length, 'invoice') + '. A family with invoices is kept for your records and marked Withdrawn instead. Mark withdrawn?')) return;
    await famRef(f.id).update({ status: 'withdrawn', withdrawn: true, updatedAt: ts() });
    toast('Marked withdrawn', 'ok'); closeModal(); return;
  }
  if (!confirm('Delete ' + f.parentName + ' and their students? This cannot be undone.')) return;
  try { await famRef(f.id).delete(); toast('Deleted', 'ok'); closeModal(); } catch (e) { fail('Could not delete', e); }
}

// Prepare: one transaction per family, so a family can never get two invoices
// for a month (the id is family_month) and credit is used exactly once.
async function createInvoice(familyId, period) {
  const ref = invRef(C.invoiceDocId(familyId, period));
  const token = C.newToken(rnd);
  return db.runTransaction(async t => {
    const [iSnap, fSnap] = await Promise.all([t.get(ref), t.get(famRef(familyId))]);
    if (iSnap.exists) return 'exists';
    if (!fSnap.exists) return 'gone';
    const fam = Object.assign({}, fSnap.data(), { id: fSnap.id });
    const inv = C.buildInvoice(fam, period, { schedule: S.schedule, settings: S.settings, today: today() });
    if (!(inv.total > 0)) return 'zero';
    t.set(ref, Object.assign({}, inv, { linkToken: token, createdAt: ts(), updatedAt: ts(), createdBy: S.user.email }));
    t.set(linkRef(token), Object.assign(C.publicInvoiceDoc(inv, S.settings), { updatedAt: ts() }));
    if (inv.creditUsed > 0) t.update(famRef(familyId), { credit: C.round2((Number(fam.credit) || 0) - inv.creditUsed), updatedAt: ts() });
    return 'created';
  });
}
async function prepareCommit() {
  if (!requireProtected()) return;
  const m = S.modal;
  const picked = m.items.filter(x => x.pick);
  const created = []; let failed = 0;
  openModal({ type: 'progress', title: 'Preparing invoices…', done: 0, total: picked.length });
  for (let i = 0; i < picked.length; i += 6) {
    await Promise.all(picked.slice(i, i + 6).map(async x => {
      try { const r = await createInvoice(x.fam.id, m.period); if (r === 'created') created.push(C.invoiceDocId(x.fam.id, m.period)); }
      catch (e) { console.error(e); failed++; }
    }));
    S.modal.done = Math.min(picked.length, i + 6); renderModal();
  }
  await sleep(400);
  openModal({ type: 'prepare', period: m.period, done: { created, failed } });
}
function openPrepare(period) {
  const p = period || (S.view === 'invoices' ? S.period : C.sgMonthKey());
  if (C.isCoveredMonth(p, S.settings)) { toast(C.periodLabel(p) + ' is paid with the ' + C.periodLabel(C.billingPeriodOf(p, S.settings)) + ' invoice — nothing to prepare.', 'ok'); return; }
  const items = billableWithoutInvoice(p).map(fam => {
    const inv = C.buildInvoice(fam, p, { schedule: S.schedule, settings: S.settings, today: today() });
    return { fam, inv, pick: inv.total > 0 };
  }).sort((a, b) => (b.inv.issues.length - a.inv.issues.length) || a.inv.parentName.localeCompare(b.inv.parentName));
  if (!items.length) { toast('Every billable family already has a ' + C.periodLabel(p) + ' invoice.', 'ok'); return; }
  openModal({ type: 'prepare', period: p, items });
}

// Keep the parent's page in step with the invoice.
async function ensureLink(inv) {
  let token = inv.linkToken;
  if (!token) {
    token = C.newToken(rnd);
    await invRef(inv.id).update({ linkToken: token });
    inv.linkToken = token;
  }
  await linkRef(token).set(Object.assign(C.publicInvoiceDoc(inv, S.settings), { updatedAt: ts() }));
  return token;
}
// Email an invoice or a reminder. The QR goes in as an inline image AND as an
// attachment the parent can save; the button in the email opens /pay?save=1.
async function emailInvoice(inv, kind) {
  const to = recipientsFor(inv);
  if (!to.length) throw new Error('no email address for ' + inv.parentName);
  const owe = C.invoiceOutstanding(inv);
  if (!(owe > 0)) throw new Error('nothing is owed on this invoice');
  const token = await ensureLink(inv);
  const payUrl = C.payLink(token);
  // The invoice's own QR choice: none means no picture and no attachment at all.
  const payload = C.invoiceQrPayload(inv, S.settings);
  const qrCid = payload ? 'paynowqr' : '';
  const level = (inv.reminders || []).length + 1;
  const msg = kind === 'reminder' ? C.reminderEmail(inv, S.settings, { payUrl, qrCid, level }) : C.invoiceEmail(inv, S.settings, { payUrl, qrCid });
  if (payload) msg.attachments = [C.qrAttachment(await qrPngBase64(payload), inv.reference, 'paynowqr')];
  const id = C.mailDocId(kind, inv.id);
  await db.collection('mail').doc(id).set(C.officeMail(to, msg, { kind, invoiceId: inv.id, familyId: inv.familyId, period: inv.period, sentBy: S.user.email }, S.settings));
  const upd = { updatedAt: ts() };
  if (kind === 'reminder') upd.reminders = FV.arrayUnion({ day: today(), at: Date.now(), via: 'email', level, mailId: id });
  else { upd.sends = FV.arrayUnion({ via: 'email', at: Date.now(), mailId: id, to }); if (!inv.sentAt) upd.sentAt = ts(); if (inv.status === 'draft') upd.status = 'sent'; }
  await invRef(inv.id).update(upd);
  return id;
}
async function emailMany(list, kind) {
  if (!requireProtected()) return;
  const ok = [], bad = [];
  openModal({ type: 'progress', title: kind === 'reminder' ? 'Emailing reminders…' : 'Emailing invoices…', sub: 'Keep this page open until it finishes.', done: 0, total: list.length });
  for (let i = 0; i < list.length; i++) {
    try { ok.push(await emailInvoice(list[i], kind)); } catch (e) { console.error(e); bad.push(list[i].parentName + ': ' + friendlyError(e)); }
    S.modal.done = i + 1; S.modal.note = list[i].parentName; renderModal();
  }
  openModal({ type: 'result', title: '✉ ' + C.plural(ok.length, 'email') + ' queued',
    body: '<p>They are on their way from admin@polymathlc.com.sg. Delivery is checked in a moment.</p>'
      + (bad.length ? '<div class="banner red" style="margin-top:12px;"><div class="big">⚠️</div><div><b>' + bad.length + ' not sent</b>' + bad.map(esc).join('<br>') + '</div></div>' : '')
      + '<div id="delivery-note" class="small muted" style="margin-top:12px;">Checking delivery…</div>' });
  checkDelivery(ok);
}
// The Trigger Email extension writes delivery.state onto each mail document.
async function checkDelivery(ids) {
  await sleep(12000);
  let okN = 0, errN = 0, pend = 0; const errs = [];
  for (const id of ids) {
    try {
      const d = await db.collection('mail').doc(id).get();
      const st = d.exists && d.data().delivery ? d.data().delivery.state : 'PENDING';
      S.mailState[id] = st === 'SUCCESS' ? 'delivered ✓' : st === 'ERROR' ? 'failed: ' + ((d.data().delivery || {}).error || '') : 'queued';
      if (st === 'SUCCESS') okN++; else if (st === 'ERROR') { errN++; errs.push(String((d.data().delivery || {}).error || '').slice(0, 120)); } else pend++;
    } catch (e) { pend++; }
  }
  const note = $('delivery-note');
  const text = okN + ' delivered' + (pend ? ', ' + pend + ' still on the way' : '') + (errN ? ', ' + errN + ' failed (' + errs[0] + ')' : '') + '.';
  if (note) note.textContent = text;
  if (errN) toast('Some emails failed: ' + errs[0], 'err');
  render();
}
async function markSent(inv, via) {
  await invRef(inv.id).update({ sends: FV.arrayUnion({ via, at: Date.now() }), sentAt: inv.sentAt || ts(), status: inv.status === 'draft' ? 'sent' : inv.status, updatedAt: ts() });
}
// WhatsApp: copy the invoice picture, then open the chat with the words typed in.
// On a phone the share sheet carries both straight into WhatsApp.
async function whatsappInvoice(inv, kind) {
  const phone = phoneFor(inv);
  if (!phone) { toast('No WhatsApp number for ' + inv.parentName, 'err'); return false; }
  const token = await ensureLink(inv);
  const text = kind === 'reminder' ? C.whatsappReminderText(inv, S.settings, C.payLink(token)) : C.whatsappInvoiceText(inv, S.settings, C.payLink(token));
  const imgPromise = invoiceImage(inv);
  if (TOUCH && navigator.canShare) {
    const file = new File([dataUrlToBlob(await imgPromise)], 'Polymath-' + inv.number + '.png', { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); await recordWa(inv, kind); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
  }
  let copied = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': imgPromise.then(dataUrlToBlob) })]);
    copied = true;
  } catch (e) { console.warn('clipboard', e); }
  window.open(C.whatsappLink(phone, text, !TOUCH), 'polymath_whatsapp');
  if (!copied) { download(await imgPromise, 'Polymath-' + inv.number + '.png'); toast('The picture was downloaded instead — drag it into the chat.'); }
  else toast('Picture copied — paste it in WhatsApp with Ctrl+V', 'ok');
  await recordWa(inv, kind);
  return true;
}
async function recordWa(inv, kind) {
  if (kind === 'reminder') await invRef(inv.id).update({ reminders: FV.arrayUnion({ day: today(), at: Date.now(), via: 'whatsapp', level: (inv.reminders || []).length + 1 }), updatedAt: ts() });
  else await markSent(inv, 'whatsapp');
}

/* ═══════════════ Payments: apply and undo ═══════════════ */
function safeDocId(key) { return String(key).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 140); }
async function applyPayment(tx, opts) {
  const o = opts || {};
  const fid = tx.familyId;
  const pRef = payRef(safeDocId(tx.key));
  const openIds = invoicesOf(fid).filter(i => C.invoiceOutstanding(i) > 0).map(i => i.id);
  const how = tx.how || (tx.match && tx.match.how) || 'manual';
  const alias = o.remember ? C.payerAliasFor(tx) : '';
  return db.runTransaction(async t => {
    const pSnap = await t.get(pRef);
    if (pSnap.exists) return { dup: true };
    const fSnap = await t.get(famRef(fid));
    if (!fSnap.exists) throw new Error('family not found');
    const snaps = await Promise.all(openIds.map(id => t.get(invRef(id))));
    const invs = snaps.filter(s => s.exists).map(s => Object.assign({}, s.data(), { id: s.id }));
    const { allocations, credit } = C.allocatePayment(tx.amount, invs, (tx.match && tx.match.period) || '');
    const after = [];
    allocations.forEach(a => {
      const inv = invs.find(x => x.id === a.invoiceId);
      const next = C.invoiceWithPayment(inv, a.amount, { paymentId: pRef.id, amount: a.amount, date: tx.date || today(), how, at: Date.now() });
      t.update(invRef(inv.id), { paid: next.paid, payments: next.payments, status: next.status, updatedAt: ts(), ...(next.status === 'paid' ? { paidAt: ts() } : {}) });
      if (inv.linkToken) t.set(linkRef(inv.linkToken), Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }), { merge: true });
      after.push({ period: inv.period, amount: a.amount, left: C.invoiceOutstanding(next), title: inv.custom || inv.title ? C.invoiceTitle(inv, S.settings) : '' });
    });
    const fam = fSnap.data();
    const fu = { updatedAt: ts() };
    if (credit > 0) fu.credit = C.round2((Number(fam.credit) || 0) + credit);
    if (alias && !(fam.payerNames || []).includes(alias)) fu.payerNames = FV.arrayUnion(alias);
    t.update(famRef(fid), fu);
    t.set(pRef, {
      key: tx.key, date: tx.date || today(), amount: C.round2(tx.amount), familyId: fid, parentName: fam.parentName || '',
      allocations, credit, how, why: (tx.match && tx.match.why) || tx.note || '', payer: tx.payer || '', reference: tx.reference || '',
      description: String(tx.description || '').slice(0, 400), statementId: o.statementId || '', method: tx.method || 'bank',
      appliedAt: ts(), appliedBy: S.user.email
    });
    return { dup: false, fam: Object.assign({ id: fid }, fam), allocations: after, credit };
  });
}
async function sendReceipt(res, tx) {
  const to = C.familyEmails(C.normalizeFamily(res.fam));
  if (!to.length) return false;
  const msg = C.receiptEmail(res.fam, { amount: tx.amount, date: tx.date, credit: res.credit }, res.allocations, S.settings);
  await db.collection('mail').doc(C.mailDocId('receipt', safeDocId(tx.key))).set(C.officeMail(to, msg, { kind: 'receipt', familyId: res.fam.id, sentBy: S.user.email }, S.settings));
  return true;
}
async function undoPayment(id) {
  if (!requireProtected()) return;
  const p = S.payments.find(x => x.id === id);
  if (!p || !confirm('Undo ' + money(p.amount) + ' from ' + (p.parentName || 'this family') + '? The invoices it paid become unpaid again.')) return;
  try {
    await db.runTransaction(async t => {
      const snap = await t.get(payRef(id));
      if (!snap.exists) return;
      const pay = snap.data();
      const invSnaps = await Promise.all((pay.allocations || []).map(a => t.get(invRef(a.invoiceId))));
      const fSnap = await t.get(famRef(pay.familyId));
      invSnaps.forEach((s, i) => {
        if (!s.exists) return;
        const inv = Object.assign({}, s.data(), { id: s.id });
        const next = C.invoiceWithPayment(inv, -pay.allocations[i].amount, { paymentId: id });
        t.update(invRef(inv.id), { paid: next.paid, payments: next.payments, status: next.status, updatedAt: ts() });
        if (inv.linkToken) t.set(linkRef(inv.linkToken), Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }), { merge: true });
      });
      if (fSnap.exists && pay.credit > 0) t.update(famRef(pay.familyId), { credit: Math.max(0, C.round2((Number(fSnap.data().credit) || 0) - pay.credit)), updatedAt: ts() });
      t.delete(payRef(id));
    });
    toast('Payment undone', 'ok');
  } catch (e) { fail('Could not undo', e); }
}

/* ═══════════════ Bank statements ═══════════════ */
async function askChatGpt(prompt, opts) {
  const o = opts || {};
  const call = fns.httpsCallable('askOpenAi', { timeout: 240000 });
  try {
    const res = await call({ prompt, system: o.system || C.AI_STATEMENT_SYSTEM, media: o.media || [], json: o.json !== false, maxOutputTokens: o.maxOutputTokens || 12000, reasoningEffort: 'low' });
    const text = res && res.data && res.data.text;
    if (typeof text !== 'string') throw new Error('ChatGPT gave no answer');
    return text;
  } catch (e) {
    const code = String(e && e.code || '');
    if (code.includes('failed-precondition')) throw new Error('ChatGPT is not switched on on the server yet (the OpenAI key secret).');
    if (code.includes('resource-exhausted')) throw new Error(String(e.message || 'ChatGPT\'s daily limit was reached.'));
    throw e;
  }
}
async function pdfText(file) {
  await loadScript(PDFJS + 'pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push(tc.items.map(it => ({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width })));
  }
  return pages;
}
async function sheetRows(file) {
  await loadScript(SHEETJS);
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const out = [];
  wb.SheetNames.forEach(name => { out.push(...window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })); });
  return out;
}
function setStep(key, state, note) {
  const st = S.review && S.review.steps.find(s => s.key === key);
  if (st) { st.state = state; if (note != null) st.note = note; }
  render();
}
async function handleStatementFile(file) {
  if (!file) return;
  if (!requireProtected()) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const useAi = S.settings.useAi;
  S.lastApply = null;
  S.review = {
    fileName: file.name, stage: 'reading', txs: [], aiUsed: false, notes: [],
    steps: [
      { key: 'read', label: 'Reading ' + file.name, state: 'doing' },
      ...(useAi ? [{ key: 'ai', label: 'ChatGPT reads the statement', state: 'todo' }] : []),
      { key: 'match', label: 'Matching payments to families', state: 'todo' },
      ...(useAi ? [{ key: 'aimatch', label: 'ChatGPT suggests who paid the rest', state: 'todo' }] : [])
    ]
  };
  go('payments');
  try {
    let credits = [], sourceText = '', quick = [];
    if (isPdf) {
      const pages = await pdfText(file);
      const lines = C.pdfLines(pages);
      sourceText = lines.map(l => l.text).join('\n');
      quick = C.parseStatementLines(lines);
      setStep('read', 'done', pages.length + ' pages' + (sourceText.trim() ? '' : ' (a scan — no text)'));
      if (useAi) {
        setStep('ai', 'doing');
        try {
          if (sourceText.trim()) {
            const chunks = [];
            let cur = '';
            sourceText.split('\n').forEach(l => { if (cur.length + l.length > AI_TEXT_CHUNK) { chunks.push(cur); cur = ''; } cur += l + '\n'; });
            if (cur.trim()) chunks.push(cur);
            for (let i = 0; i < chunks.length; i++) {
              if (chunks.length > 1) setStep('ai', 'doing', 'part ' + (i + 1) + ' of ' + chunks.length);
              const json = C.parseAiJson(await askChatGpt(C.statementPrompt(chunks[i], { fileName: file.name })));
              credits.push(...C.cleanAiTransactions(json, sourceText));
            }
          } else {
            const b64 = await fileToBase64(file);
            if (b64.length > 9400000) throw new Error('the scanned PDF is over 7 MB — export a text PDF or a spreadsheet instead');
            const json = C.parseAiJson(await askChatGpt(C.statementPrompt('', { fileName: file.name }), { media: [{ mimeType: 'application/pdf', data: b64 }] }));
            credits = C.cleanAiTransactions(json, '');
          }
          S.review.aiUsed = true;
          setStep('ai', 'done', C.plural(credits.length, 'money-in transaction') + (quick.length ? ' (the quick reader found ' + quick.length + ')' : ''));
        } catch (e) {
          console.error(e);
          setStep('ai', 'fail', friendlyError(e) + ' — using the quick reader instead');
          credits = quick;
        }
        if (!credits.length && quick.length) credits = quick;
      } else credits = quick;
    } else {
      const rows = await sheetRows(file);
      const parsed = C.parseStatementRows(rows);
      setStep('read', 'done', rows.length + ' rows');
      if (parsed && parsed.transactions.length) {
        credits = parsed.transactions;
        if (useAi) setStep('ai', 'done', 'not needed — the columns were clear');
      } else if (useAi) {
        setStep('ai', 'doing');
        const csv = rows.map(r => r.map(v => v instanceof Date ? C.parseDateLoose(v) : String(v)).join(' | ')).join('\n').slice(0, AI_TEXT_CHUNK * 3);
        sourceText = csv;
        try {
          credits = C.cleanAiTransactions(C.parseAiJson(await askChatGpt(C.statementPrompt(csv, { fileName: file.name }))), csv);
          S.review.aiUsed = true;
          setStep('ai', 'done', C.plural(credits.length, 'money-in transaction'));
        } catch (e) { setStep('ai', 'fail', friendlyError(e)); }
      }
    }
    if (!credits.length) throw new Error('no money-in transactions were found in ' + file.name);
    // The same credit twice in one file (two siblings paid separately) stays two.
    const seen = new Map();
    credits.forEach(t => { const n = (seen.get(t.key) || 0) + 1; seen.set(t.key, n); if (n > 1) t.key = t.key + '-' + n; });
    setStep('match', 'doing');
    const openInv = S.invoices.filter(i => C.invoiceOutstanding(i) > 0);
    let txs = C.matchTransactions(credits, S.families, openInv);
    txs.forEach(t => { t.dup = IX.payByKey.has(safeDocId(t.key)); });
    const matchedN = txs.filter(t => !t.dup && t.match.familyId).length;
    setStep('match', 'done', matchedN + ' of ' + txs.filter(t => !t.dup).length + ' matched');
    // ChatGPT looks at everything that is not CERTAIN: the unmatched credits and
    // the guesses made from a name or an amount alone.
    const loose = txs.filter(t => !t.dup && !(t.match.familyId && t.match.confidence === 'high'));
    if (useAi && loose.length && S.families.length) {
      setStep('aimatch', 'doing', C.plural(loose.length, 'credit'));
      try {
        const { roster, ids } = C.rosterForAi(S.families, S.invoices);
        const txIds = new Map();
        const brief = loose.slice(0, 120).map((t, i) => { txIds.set('T' + (i + 1), t.key); return { id: 'T' + (i + 1), date: t.date, amount: t.amount, payer: t.payer, reference: t.reference, description: String(t.description).slice(0, 200) }; });
        const json = C.parseAiJson(await askChatGpt(C.aiMatchPrompt(brief, roster), { system: 'You match bank credits to tuition families and return strict JSON.', maxOutputTokens: 6000 }));
        txs = C.applyAiMatches(txs, json, { families: ids, transactions: txIds });
        S.review.aiUsed = true;
        setStep('aimatch', 'done', txs.filter(t => t.match && t.match.how === 'ai').length + ' suggested or confirmed');
      } catch (e) { setStep('aimatch', 'fail', friendlyError(e)); }
    } else if (useAi) setStep('aimatch', 'done', 'nothing left to ask about');
    txs.forEach(t => { t.familyId = t.match.familyId || ''; t.tick = !t.dup && C.autoTick(t, S.invoices); });
    const ref = db.collection(COL.statements).doc();
    S.review.statementId = ref.id;
    S.review.txs = txs;
    S.review.stage = 'review';
    S.review.from = txs.map(t => t.date).filter(Boolean).sort()[0] || '';
    S.review.to = txs.map(t => t.date).filter(Boolean).sort().pop() || '';
    ref.set({ fileName: file.name, uploadedAt: ts(), uploadedBy: S.user.email, aiUsed: S.review.aiUsed, from: S.review.from, to: S.review.to,
      summary: { credits: txs.length, matched: matchedN, applied: 0, duplicates: txs.filter(t => t.dup).length },
      transactions: txs.slice(0, 600).map(t => ({ key: t.key, date: t.date, amount: t.amount, payer: t.payer, reference: t.reference, description: String(t.description).slice(0, 300), familyId: t.familyId, how: t.match.how || '', dup: !!t.dup, unverified: !!t.unverified })) })
      .catch(e => console.warn('statement not stored', e));
    render();
  } catch (e) {
    console.error(e);
    const doing = S.review.steps.find(s => s.state === 'doing');
    if (doing) { doing.state = 'fail'; doing.note = friendlyError(e); }
    S.review.stage = 'failed';
    render();
  }
}
function reviewHtml() {
  const r = S.review;
  const stepsHtml = '<div class="progress-steps">' + r.steps.map(s => '<div class="pstep ' + s.state + '"><i>' + (s.state === 'done' ? '✓' : s.state === 'fail' ? '!' : s.state === 'doing' ? '…' : '·') + '</i><span>' + esc(s.label) + (s.note ? ' — <span class="small">' + esc(s.note) + '</span>' : '') + '</span></div>').join('') + '</div>';
  if (r.stage !== 'review') {
    return '<div class="page-head"><div><h1>Reading the statement</h1><p>' + esc(r.fileName) + '</p></div></div><div class="card">' + stepsHtml
      + (r.stage === 'failed' ? '<div class="actions" style="margin-top:18px;"><button class="btn" data-act="pickStatement">Try another file</button><button class="btn ghost" data-act="cancelReview">Back</button></div>' : '') + '</div>';
  }
  const famOpts = S.families.slice().sort((a, b) => a.parentName.localeCompare(b.parentName));
  const famSelect = (t, i) => {
    const cands = (t.match.candidates || []).map(famById).filter(Boolean);
    return '<select data-ch="rvFam" data-i="' + i + '"><option value="">' + (t.familyId ? '— not this family —' : 'Who paid this?') + '</option>'
      + (cands.length ? '<optgroup label="Likely">' + cands.map(f => '<option value="' + esc(f.id) + '" ' + (t.familyId === f.id ? 'selected' : '') + '>' + esc(C.familyDisplayName(f)) + (familyOwing(f.id) > 0 ? ' — owes ' + money(familyOwing(f.id)) : '') + '</option>').join('') + '</optgroup>' : '')
      + '<optgroup label="Everyone">' + famOpts.map(f => '<option value="' + esc(f.id) + '" ' + (t.familyId === f.id && !cands.includes(f) ? 'selected' : '') + '>' + esc(C.familyDisplayName(f)) + (familyOwing(f.id) > 0 ? ' — owes ' + money(familyOwing(f.id)) : '') + '</option>').join('') + '</optgroup></select>';
  };
  const row = (t, i) => {
    const f = t.familyId ? famById(t.familyId) : null;
    const owe = f ? familyOwing(f.id) : 0;
    const fits = f && C.sameMoney(owe, t.amount);
    return '<div class="rv ' + (t.tick ? '' : 'off') + '"><input type="checkbox" data-ch="rvTick" data-i="' + i + '" ' + (t.tick ? 'checked' : '') + ' ' + (t.familyId ? '' : 'disabled') + ' aria-label="Apply this payment">'
      + '<div class="date small">' + esc(C.prettyDate(t.date)) + '</div><div class="amt">' + money(t.amount) + (t.unverified ? '<div class="warn-t small" title="This amount is not printed in the statement text">⚠ check</div>' : '') + '</div>'
      + '<div class="desc">' + (t.payer ? '<b>' + esc(t.payer) + '</b><br>' : '') + esc([t.reference, t.description].filter(Boolean).join(' · ').slice(0, 220)) + '</div>'
      + '<div class="to">' + famSelect(t, i)
      + (t.match.how ? '<div class="why"><span class="how ' + esc(t.match.how.replace('+', '-')) + '">' + esc(howLabel(t.match.how)) + '</span> ' + esc(t.match.why || '') + '</div>' : '')
      + (f ? '<div class="why">' + (owe > 0 ? 'Owes ' + money(owe) + (fits ? ' ✓ exact' : (t.amount > owe ? ' — ' + money(t.amount - owe) + ' becomes credit' : ' — part payment')) : 'Owes nothing — kept as credit') + '</div>' : '')
      + '</div></div>';
  };
  const groups = [
    { k: 'sure', title: '✅ Matched', note: 'Reference code or a payer seen before — ticked for you.', test: t => !t.dup && t.match.familyId && t.match.confidence === 'high' && t.match.how !== 'manual' },
    { k: 'check', title: '🤔 Please check', note: 'Good guesses from names, amounts or ChatGPT. Tick the right ones.', test: t => !t.dup && t.familyId && (t.match.confidence !== 'high' || t.match.how === 'manual') },
    { k: 'none', title: '❓ Not matched', note: 'Choose the family, or leave unticked to ignore (interest, other income).', test: t => !t.dup && !t.familyId },
    { k: 'dup', title: '↺ Already recorded', note: 'These were applied from an earlier statement and are skipped.', test: t => t.dup }
  ];
  const picked = r.txs.filter(t => t.tick && t.familyId && !t.dup);
  const sum = C.round2(picked.reduce((s, t) => s + t.amount, 0));
  const all = r.txs.filter(t => !t.dup);
  return '<div class="page-head"><div><h1>Check the payments</h1><p>' + esc(r.fileName) + (r.from ? ' · ' + esc(C.prettyDate(r.from)) + ' – ' + esc(C.prettyDate(r.to)) : '') + (r.aiUsed ? ' · read with ChatGPT' : '') + '</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="cancelReview">Cancel</button></div></div>'
    + '<div class="stats"><div class="stat"><div class="label">Money in</div><div class="value">' + all.length + '</div><div class="hint">' + money(all.reduce((s, t) => s + t.amount, 0)) + '</div></div>'
    + '<div class="stat green"><div class="label">Matched</div><div class="value">' + r.txs.filter(groups[0].test).length + '</div></div>'
    + '<div class="stat amber"><div class="label">To check</div><div class="value">' + r.txs.filter(groups[1].test).length + '</div></div>'
    + '<div class="stat"><div class="label">Not matched</div><div class="value">' + r.txs.filter(groups[2].test).length + '</div><div class="hint">' + r.txs.filter(t => t.dup).length + ' already recorded</div></div></div>'
    + '<details style="margin-top:14px;"><summary class="small muted" style="cursor:pointer;">How it was read</summary><div class="card" style="margin-top:10px;">' + stepsHtml + '</div></details>'
    + groups.map(g => { const items = r.txs.map((t, i) => [t, i]).filter(([t]) => g.test(t)); if (!items.length) return '';
      return '<div class="rv-group"><h3>' + g.title + ' <span class="pill grey">' + items.length + '</span></h3><div class="small muted" style="margin:-4px 0 10px;">' + g.note + '</div>'
        + (g.k === 'check' || g.k === 'sure' ? '<div class="actions" style="margin-bottom:8px;"><button class="btn xs ghost" data-act="rvTickGroup" data-g="' + g.k + '" data-on="1">Tick all</button><button class="btn xs ghost" data-act="rvTickGroup" data-g="' + g.k + '" data-on="0">Untick all</button></div>' : '')
        + (g.k === 'dup' ? '<details><summary class="small muted" style="cursor:pointer;margin-bottom:8px;">Show them</summary>' + items.map(([t, i]) => row(t, i)).join('') + '</details>' : items.map(([t, i]) => row(t, i)).join('')) + '</div>'; }).join('')
    + '<div class="applybar"><div class="txt"><b>Apply ' + C.plural(picked.length, 'payment') + ' · ' + money(sum) + '</b></div>'
    + '<label><input type="checkbox" data-ch="rvReceipts" ' + (r.receipts !== false && S.settings.receipts ? 'checked' : '') + '> Email receipts</label>'
    + '<label><input type="checkbox" data-ch="rvRemember" ' + (r.remember !== false ? 'checked' : '') + '> Remember payer names</label>'
    + '<button class="btn big" style="background:#22c55e;border-color:#22c55e;" data-act="rvApply" ' + (picked.length ? '' : 'disabled') + '>Apply payments</button></div>';
}
async function applyReview() {
  if (!requireProtected()) return;
  const r = S.review;
  const picked = r.txs.filter(t => t.tick && t.familyId && !t.dup);
  const receipts = r.receipts !== false && S.settings.receipts;
  let count = 0, total = 0, skipped = 0, sentReceipts = 0; const errs = [];
  openModal({ type: 'progress', title: 'Recording payments…', done: 0, total: picked.length });
  for (let i = 0; i < picked.length; i++) {
    const t = picked[i];
    try {
      const res = await applyPayment(Object.assign({}, t, { how: t.match.familyId === t.familyId ? t.match.how : 'manual' }), { statementId: r.statementId, remember: r.remember !== false });
      if (res.dup) skipped++;
      else {
        count++; total = C.round2(total + t.amount);
        if (receipts) { try { if (await sendReceipt(res, t)) sentReceipts++; } catch (e) { console.warn('receipt', e); } }
      }
    } catch (e) { console.error(e); errs.push(money(t.amount) + ': ' + friendlyError(e)); }
    S.modal.done = i + 1; renderModal();
  }
  if (r.statementId) db.collection(COL.statements).doc(r.statementId).set({ appliedAt: ts(), summary: { applied: count } }, { merge: true }).catch(() => {});
  S.review = null;
  S.lastApply = { count, total, skipped, receipts: sentReceipts };
  closeModal();
  if (errs.length) openModal({ type: 'result', title: '⚠️ Some payments were not recorded', body: errs.map(esc).join('<br>') });
  go('payments');
}

/* ═══════════════ Import ═══════════════ */
async function importFromRows(rows, source) {
  const m = S.modal;
  m.rows = rows; m.source = source;
  m.plan = C.planImport(rows, { schedule: S.schedule, existing: S.families, random: rnd, newId: () => '', today: today(), useSheetFee: !!m.useSheetFee, mapping: m.mapping });
  if (!m.mapping) m.mapping = m.plan.mapping;
  renderModal();
}
async function importCommit() {
  if (!requireProtected()) return;
  const fams = S.modal.plan.families;
  const btn = document.querySelector('[data-act="importCommit"]');
  busy(btn, true);
  try {
    for (let i = 0; i < fams.length; i += 400) {
      const batch = db.batch();
      fams.slice(i, i + 400).forEach(f => {
        f.students.forEach(s => { if (!s.id) s.id = sid(); });
        const ref = f.id ? famRef(f.id) : db.collection(COL.families).doc();
        const data = Object.assign(stripLocal(f), { updatedAt: ts(), updatedBy: S.user.email });
        if (!f.id) data.createdAt = ts();
        batch.set(ref, data);
      });
      await batch.commit();
    }
    toast(C.plural(fams.length, 'family', 'families') + ' imported', 'ok');
    closeModal();
    go('families');
  } catch (e) { fail('Import failed', e); } finally { busy(btn, false); }
}

/* ═══════════════ Exports ═══════════════ */
function downloadText(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ═══════════════ Actions (every [data-act]) ═══════════════ */
const ACT = {
  noop() {},
  go(el) { go(el.dataset.to); },
  signOut() { auth.signOut(); },
  closeModal, closeDrawer() { S.drawer = null; renderDrawer(); },
  recheckLock() { S.protected = null; render(); probeProtection().then(() => toast(S.protected ? 'Locked ✓' : 'Still not locked', S.protected ? 'ok' : 'err')); },
  copy(el) { copyText(el.dataset.text); },
  // Families
  newFamily() { openModal({ type: 'family', draft: newFamilyDraft() }); },
  openFamily(el) { const f = famById(el.dataset.id); if (!f) return; S.drawer = null; renderDrawer(); openModal({ type: 'family', draft: clone(Object.assign({}, f, { _raw: undefined })) }); },
  famFilter(el) { S.ui.famFilter = el.dataset.k; render(); },
  famType(el) { S.ui.famType = el.dataset.k; render(); },
  famPanel() { S.ui.famPanel = !S.ui.famPanel; render(); },
  famZoom(el) {
    const d = Number(el.dataset.d) || 0;
    const at = FAM_ZOOMS.reduce((best, z, i) => Math.abs(z - S.ui.famZoom) < Math.abs(FAM_ZOOMS[best] - S.ui.famZoom) ? i : best, 0);
    S.ui.famZoom = FAM_ZOOMS[Math.min(FAM_ZOOMS.length - 1, Math.max(0, at + d))];
    rememberFamZoom(S.ui.famZoom); render();
  },
  famZoomReset() { S.ui.famZoom = 1; rememberFamZoom(1); render(); },
  // Fit: zoom so the widest thing in the list (the table) fits the page width.
  famZoomFit() {
    const box = $('fam-body'); if (!box) return;
    const inner = box.querySelector('table.rec') || box.querySelector('.fam-grid') || box.firstElementChild;
    const avail = box.parentElement.clientWidth;
    const z = S.ui.famZoom || 1;
    const need = inner ? inner.scrollWidth * z : avail;   // its width at 100%… times the zoom it is drawn at
    const raw = need > 0 ? avail / (need / z) : 1;
    const fit = Math.max(0.5, Math.min(1, Math.floor(raw * 100) / 100));
    S.ui.famZoom = fit; rememberFamZoom(fit); render();
    toast(fit < 1 ? 'Zoomed to ' + Math.round(fit * 100) + '% so the list fits the width.' : 'It already fits at 100%.', 'ok');
  },
  openCategory(el) { openModal({ type: 'category', key: el.dataset.k }); },
  catOpenFamily(el) { ACT.openFamily(el); },
  catCsv(el) {
    const rows = categoryRows(el.dataset.k);
    downloadText(C.categoryCsv(rows), 'polymath-' + C.statCategoryLabel(el.dataset.k).toLowerCase().replace(/[^a-z]+/g, '-') + '-' + today() + '.csv', 'text/csv');
  },
  // Show the category's families on the Families list (the same filter, on top of any already set).
  catShow(el) {
    S.ui.famF = C.categoryFilters(el.dataset.k, famFiltered() ? S.ui.famF : {});
    if (!famFiltered()) S.ui.famFilter = 'all';
    S.ui.famPanel = true;
    closeModal(); render();
  },
  // Hand the category to Announce: the same families, its children named in {children}.
  catEmail(el) {
    const key = el.dataset.k;
    const sc = statScope();
    const a = S.ui.ann;
    a.F = C.categoryFilters(key, sc.filtered ? S.ui.famF : {});
    a.type = sc.filtered ? S.ui.famType : '';
    a.search = sc.filtered ? S.ui.famSearch : '';
    a.status = 'active';
    a.panel = C.activeFamilyFilters(a.F).length > 0;
    const keep = new Set(categoryRows(key).map(r => r.familyId));
    a.excluded = S.families.filter(f => !keep.has(f.id)).map(f => f.id);
    a.preview = '';
    closeModal(); go('announce');
    toast('Write the message — ' + C.plural(keep.size, 'family is', 'families are') + ' chosen.', 'ok');
  },
  // Families → Announcements with the same families chosen.
  famAnnounce() {
    const a = S.ui.ann;
    a.F = C.cleanFamilyFilters(S.ui.famF); a.type = S.ui.famType; a.search = S.ui.famSearch;
    a.status = ['inactive', 'withdrawn'].includes(S.ui.famFilter) ? 'withdrawn' : (S.ui.famFilter === 'paused' ? 'paused' : 'active');
    a.panel = C.activeFamilyFilters(a.F).length > 0; a.excluded = [];
    if (!['all', 'inactive', 'withdrawn', 'paused'].includes(S.ui.famFilter)) {
      // A quick chip (owing, no screenshot…) has no filter of its own here: untick the others.
      const shown = new Set(familyList().map(f => f.id));
      a.excluded = S.families.filter(f => !shown.has(f.id)).map(f => f.id);
    }
    go('announce');
  },
  annStatus(el) { S.ui.ann.status = el.dataset.k; render(); },
  annType(el) { S.ui.ann.type = el.dataset.k; render(); },
  annPanel() { S.ui.ann.panel = !S.ui.ann.panel; render(); },
  annFReset() { S.ui.ann.F = C.cleanFamilyFilters({}); render(); },
  annTickAll() { S.ui.ann.excluded = []; render(); },
  annTickNone() { S.ui.ann.excluded = annAudience().rows.map(r => r.familyId); render(); },
  annToken(el) {
    const box = $('ann-body'); if (!box) return;
    const t = el.dataset.t, st = box.selectionStart || box.value.length, en = box.selectionEnd || st;
    box.value = box.value.slice(0, st) + t + box.value.slice(en);
    S.ui.ann.draft.body = box.value; rememberAnnDraft(S.ui.ann.draft);
    box.focus(); box.setSelectionRange(st + t.length, st + t.length);
    annRefreshLive();
  },
  annClear() { S.ui.ann.draft = C.emptyAnnouncement(); rememberAnnDraft(S.ui.ann.draft); render(); },
  annTest() { annSendTest(); },
  annSend() {
    const aud = annAudience();
    if (!annCanSend(aud)) { toast(aud.families ? 'Write a subject and a message first.' : 'Nobody is chosen yet.', 'err'); return; }
    openModal({ type: 'annConfirm', sure: false });
  },
  annGo() { if (!S.modal || !S.modal.sure) return; annSendAll().catch(e => { console.error(e); openModal({ type: 'result', title: 'Not sent', body: '<p>' + esc(friendlyError(e)) + '</p>' }); }); },
  openAnnLog(el) { openModal({ type: 'annLog', id: el.dataset.id }); },
  annCheck(el) { const h = S.announcements.find(x => x.id === el.dataset.id); if (h) annCheckDelivery(h); },
  annReuse(el) {
    const h = S.announcements.find(x => x.id === el.dataset.id); if (!h) return;
    S.ui.ann.draft = C.cleanAnnouncement({ subject: h.subject, body: h.body, greet: h.greet });
    rememberAnnDraft(S.ui.ann.draft);
    S.modal = null; $('modal').classList.remove('show'); document.body.style.overflow = '';
    render(); window.scrollTo({ top: 0 });
  },
  toggleStats() { S.ui.statsOpen = !S.ui.statsOpen; rememberStatsOpen(S.ui.statsOpen); render(); },
  famFClear(el) { const k = el.dataset.k; S.ui.famF[k] = ''; if (k === 'paid') S.ui.famF.month = ''; render(); },
  famFReset() { S.ui.famF = C.cleanFamilyFilters({}); render(); },
  famView(el) { S.ui.famView = el.dataset.k === 'table' ? 'table' : 'cards'; rememberFamView(S.ui.famView); render(); },
  exportRecords() {
    const rows = recordRows(familyList());
    if (!rows.length) { toast('Nothing to download — clear a filter first.', 'err'); return; }
    downloadText(C.familyRecordCsv(rows), 'polymath-families-' + today() + '.csv', 'text/csv');
  },
  // The family that already uses this email: leave this (unsaved) one and open it.
  openOwner(el) {
    const f = famById(el.dataset.id); if (!f) return;
    const draft = S.modal && S.modal.draft;
    const unsaved = draft && !draft.id && draft.students.some(x => x.name);
    if (unsaved && !confirm('Leave this new family without saving and open ' + (f.parentName || 'that family') + '? (Add the child there instead.)')) return;
    openModal({ type: 'family', draft: clone(Object.assign({}, f, { _raw: undefined })) });
  },
  togglePicker(el) { const si = +el.dataset.s; S.modal.picker = S.modal.picker === si ? null : si; renderModal(); },
  markMonth(el) {
    const m = S.modal, f = m.draft, period = el.dataset.p;
    const mo = recordOf(f).months.find(x => x.period === period);
    if (!mo) return;
    if (mo.key === 'paid' && mo.invoiceId) { openModal({ type: 'invoice', id: mo.invoiceId, back: m }); refreshMailState(mo.invoiceId); return; }
    if (mo.key !== 'hand' && ['waiting', 'overdue', 'part', 'draft'].includes(mo.key)
        && !confirm(C.periodLabel(period) + ' has an invoice that is not paid (' + money(mo.outstanding) + '). Mark the month paid by hand anyway?\n\nTo record the money against the invoice, use 💵 Record a payment instead.')) return;
    // Months billed together are paid once: taking a mark off clears it on both months.
    if (mo.key === 'hand' && mo.jointWith) {
      f.paidMonths = C.normalizePaidMonths(f.paidMonths).filter(p => p.period !== period && p.period !== mo.jointWith);
      renderModal(); return;
    }
    const next = C.togglePaidMonth(f, period, { date: today(), by: S.user.email });
    f.paidMonths = next.paidMonths;
    renderModal();
  },
  // A family that paid a whole year: mark every month of it not already paid.
  markYear(el) {
    const f = S.modal.draft, y = el.dataset.y;
    const open = recordOf(f).months.filter(mo => mo.year === y && !['paid', 'hand', 'package', 'gone'].includes(mo.key));
    const unpaidInv = open.filter(mo => mo.invoiceId);
    if (unpaidInv.length && !confirm(C.plural(unpaidInv.length, 'month has', 'months have') + ' an unpaid invoice (' + unpaidInv.map(mo => mo.label).join(', ') + '). Mark them paid by hand too?')) return;
    let next = f;
    open.forEach(mo => { next = C.togglePaidMonth(next, mo.period, { date: today(), by: S.user.email, note: 'Paid for the whole of ' + y }); });
    f.paidMonths = next.paidMonths;
    renderModal();
    toast(C.plural(open.length, 'month') + ' of ' + y + ' marked paid — press Save to keep it.', 'ok');
  },
  unmarkYear(el) {
    const f = S.modal.draft, y = el.dataset.y;
    if (!confirm('Take the paid-by-hand mark off every month of ' + y + '?')) return;
    f.paidMonths = C.normalizePaidMonths(f.paidMonths).filter(p => p.period.slice(0, 4) !== y);
    renderModal();
  },
  addShot() {
    const f = S.modal.draft;
    f.screenshots = C.normalizeScreenshots([C.newScreenshot({ by: S.user.email }), ...(f.screenshots || [])]);
    renderModal();
    toast('Screenshot logged for today — press Save to keep it.', 'ok');
  },
  delShot(el) { const f = S.modal.draft; const list = C.normalizeScreenshots(f.screenshots); list.splice(+el.dataset.i, 1); f.screenshots = list; renderModal(); },
  allShots() { S.modal.allShots = !S.modal.allShots; renderModal(); },
  // From the table: a parent has just sent a screenshot. Saved at once.
  async quickShot(el) {
    if (!requireProtected()) return;
    const f = famById(el.dataset.id); if (!f) return;
    busy(el, true);
    try {
      const entry = C.newScreenshot({ by: S.user.email });
      await famRef(f.id).update({ screenshots: C.normalizeScreenshots([entry, ...(f.screenshots || [])]), updatedAt: ts(), updatedBy: S.user.email });
      toast('📸 Screenshot from ' + (f.parentName || 'the family') + ' logged for today', 'ok');
    } catch (e) { fail('Could not log the screenshot', e); } finally { busy(el, false); }
  },
  addStudent() { S.modal.draft.students.push(newStudent()); renderModal(); },
  delStudent(el) { const s = S.modal.draft.students[+el.dataset.s]; if (s.name && !confirm('Remove ' + s.name + '? (To keep their history, set Status to Left instead.)')) return; S.modal.draft.students.splice(+el.dataset.s, 1); renderModal(); },
  addClass(el) { S.modal.draft.students[+el.dataset.s].classes.push({ slotId: '', mode: 'Physical', rate: '', custom: false, label: '' }); renderModal(); },
  addCustom(el) { S.modal.draft.students[+el.dataset.s].classes.push({ slotId: '', mode: 'Physical', rate: '', custom: true, label: '' }); renderModal(); },
  delClass(el) { S.modal.draft.students[+el.dataset.s].classes.splice(+el.dataset.c, 1); renderModal(); },
  saveFamily, deleteFamily,
  familyQr() { const f = S.modal.draft; openModal({ type: 'qr', reference: C.familyReference(f.code), who: f.parentName, amount: familyOwing(f.id) || '', back: S.modal }); },
  async saveQr() { const m = S.modal; const url = await qrPngBase64(C.buildPayNow(m.amount, m.reference, { uen: S.settings.uen, merchant: S.settings.merchant })); savePng(url, C.qrFileName(m.reference)); },
  openImport() { openModal({ type: 'import', paste: '' }); },
  pickImportFile() { $('file-import').click(); },
  importPreview() { const rows = C.parseDelimited(S.modal.paste); if (rows.length < 2) { toast('Paste the table with its headings first.', 'err'); return; } importFromRows(rows, 'Pasted table'); },
  importBack() { S.modal.rows = null; S.modal.plan = null; S.modal.mapping = null; renderModal(); },
  importCommit,
  // Timetable & students
  ttFilter(el) { S.ui.tt[el.dataset.k] = el.dataset.v; render(); },
  openSlot(el) { S.drawer = { slotId: el.dataset.id }; renderDrawer(); },
  copyRoster(el) { const r = (IX.roster.get(el.dataset.id) || []).slice().sort(by('name')); copyText(C.slotTitle(C.scheduleSlot(S.schedule, el.dataset.id)) + ' — ' + C.slotLabel(el.dataset.id) + '\n' + r.map((x, i) => (i + 1) + '. ' + x.name + ' (' + x.mode + ') — ' + x.parentName + ' ' + C.displayPhone(x.whatsapp)).join('\n'), 'List copied'); },
  stuFilter(el) { const k = el.dataset.k, v = el.dataset.v; S.ui.stu[k] = (k === 'cls' && S.ui.stu.cls === v) ? '' : v; render(); },
  stuSort(el) { const k = el.dataset.k; S.ui.stuSort = { key: k, dir: S.ui.stuSort.key === k ? -S.ui.stuSort.dir : 1 }; render(); },
  stuClear() { S.ui.stu = { level: '', subject: '', mode: '', day: '', status: 'active', pay: '', cls: '' }; S.ui.stuSearch = ''; render(); },
  showNoClass() { S.ui.stu = { level: '', subject: '', mode: '', day: '', status: 'active', pay: '', cls: 'none' }; go('students'); },
  exportStudents() {
    const rows = studentList();
    downloadText(C.toCsv([['Student', 'Level', 'School', 'Status', 'Classes', 'Mode', 'Monthly fee', 'Parent', 'Reference', 'WhatsApp', 'Email'],
      ...rows.map(r => [r.name, C.levelLabel(r.level), r.school, r.status, r.classes.map(c => (c.when ? c.when + ' ' : '') + (c.subject || c.title)).join('; '), r.modes.join('/'), r.monthly, r.parentName, C.familyReference(r.code), C.displayPhone(r.whatsapp), r.email])]), 'polymath-students-' + today() + '.csv', 'text/csv');
  },
  // Invoices
  invFilter(el) { S.ui.invFilter = el.dataset.k; render(); },
  period(el) { S.period = C.addMonths(S.period, Number(el.dataset.d)); render(); },
  openPrepare() { closeModal(); openPrepare(); },
  prepareCommit,
  openInvoice(el) { S.drawer = null; renderDrawer(); openModal({ type: 'invoice', id: el.dataset.id }); refreshMailState(el.dataset.id); },
  async emailInvoice(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    busy(el, true);
    try { const id = await emailInvoice(inv, 'invoice'); toast('Emailed to ' + recipientsFor(inv).join(', '), 'ok'); setTimeout(() => refreshMailState(inv.id, [id]), 12000); }
    catch (e) { fail('Could not email', e); } finally { busy(el, false); }
  },
  async remindOne(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    if (!C.canRemind(inv, today(), S.settings.reminderGapDays) && !confirm('A reminder went out less than ' + S.settings.reminderGapDays + ' days ago. Send another?')) return;
    busy(el, true);
    try { await emailInvoice(inv, 'reminder'); toast('Reminder emailed', 'ok'); } catch (e) { fail('Could not email', e); } finally { busy(el, false); }
  },
  async waOne(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    busy(el, true);
    try { await whatsappInvoice(inv, el.dataset.kind || 'invoice'); } catch (e) { fail('WhatsApp', e); } finally { busy(el, false); }
  },
  emailDrafts() {
    const p = S.view === 'invoices' ? S.period : C.sgMonthKey();
    const list = periodInvoices(p).filter(i => stateOf(i).key === 'draft' && recipientsFor(i).length);
    if (!list.length) { toast('No unsent invoices with an email address.', 'err'); return; }
    if (!confirm('Email ' + C.plural(list.length, 'invoice') + ' for ' + C.periodLabel(p) + ' now?')) return;
    emailMany(list, 'invoice');
  },
  waQueueDrafts() {
    const p = S.view === 'invoices' ? S.period : C.sgMonthKey();
    const drafts = periodInvoices(p).filter(i => stateOf(i).key === 'draft');
    const list = drafts.filter(i => phoneFor(i)).sort((a, b) => (recipientsFor(a).length - recipientsFor(b).length) || String(a.parentName).localeCompare(String(b.parentName)));
    if (!list.length) { toast('No unsent invoices with a WhatsApp number.', 'err'); return; }
    openModal({ type: 'waq', ids: list.map(i => i.id), i: 0, kind: 'invoice', sent: 0, skipped: 0 });
  },
  async waSend() {
    const m = S.modal; const inv = IX.invById.get(m.ids[m.i]); if (!inv) return;
    const btn = document.querySelector('[data-act="waSend"]'); busy(btn, true);
    try { if (await whatsappInvoice(inv, m.kind)) { m.sent = (m.sent || 0) + 1; m.last = inv.id; } } catch (e) { fail('WhatsApp', e); }
    busy(btn, false); renderModal();
  },
  waNext() { S.modal.i++; S.modal.last = null; renderModal(); },
  waSkip() { S.modal.i++; S.modal.skipped = (S.modal.skipped || 0) + 1; S.modal.last = null; renderModal(); },
  copyPayLink: async el => { const inv = IX.invById.get(el.dataset.id); if (!inv) return; try { const t = await ensureLink(inv); copyText(C.payLink(t), 'Pay link copied'); } catch (e) { fail('Could not make the link', e); } },
  async markSent(el) { const inv = IX.invById.get(el.dataset.id); if (!inv) return; await markSent(inv, 'other'); toast('Marked as sent', 'ok'); },
  async saveInvoiceQr() { const inv = IX.invById.get(S.modal.id); const payload = inv && C.invoiceQrPayload(inv, S.settings); if (!payload) { toast('This invoice has no QR.', 'err'); return; } savePng(await qrPngBase64(payload), C.qrFileName(inv.reference)); },
  async saveInvoiceImage() { const inv = IX.invById.get(S.modal.id); savePng(await invoiceImage(inv), 'Polymath-' + inv.number + '.png'); },
  // The invoice editor (custom invoices, and changing any invoice)
  newCustomInvoice(el) { openCustomEditor(el && el.dataset.fam ? famById(el.dataset.fam) : null); },
  editInvoice(el) {
    const inv = IX.invById.get(el.dataset.id || (S.modal && S.modal.id)); if (!inv) return;
    openModal({ type: 'invEdit', editing: true, draft: C.draftFromInvoice(inv), start: C.draftFromInvoice(inv), autoDue: false, back: S.modal && S.modal.type === 'invoice' ? S.modal : null });
  },
  editLines(el) { ACT.editInvoice(el); },
  duplicateInvoice(el) {
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    const tag = C.newCustomTag(rnd, customTags());
    const fresh = C.blankCustomInvoice({ tag, today: today(), settings: S.settings, schedule: S.schedule, family: famById(inv.familyId), prefill: false });
    const copy = C.draftFromInvoice(inv);
    const draft = Object.assign({}, fresh, {
      parentName: copy.parentName, emails: copy.emails, whatsapp: copy.whatsapp, title: copy.title,
      lines: copy.lines.map(l => ({ studentName: l.studentName || '', desc: l.desc || '', detail: l.detail || '', amount: l.amount })),
      note: copy.note, qrMode: copy.qrMode
    });
    openModal({ type: 'invEdit', editing: false, draft, autoDue: true });
  },
  edFill() {
    const d = S.modal.draft, f = famById(d.familyId); if (!f) return;
    const fill = fillFamilyLines(d, f);
    renderModal();
    toast(fill.lines.length ? 'Filled in ' + C.plural(fill.lines.length, 'line') + ' for ' + fill.label + '.' : 'No classes or fees on this family yet.', fill.lines.length ? 'ok' : 'err');
  },
  edUnfill() {
    const d = S.modal.draft;
    d.lines = C.withoutPrefillLines(d.lines);
    d.periodTo = '';
    renderModal(); toast('The children\'s fees are off. Add your own lines.', 'ok'); focusLastLine('ed');
  },
  edArrears(el) {
    const d = S.modal.draft, f = famById(d.familyId); if (!f) return;
    const a = editorArrears(d).find(x => x.period === el.dataset.p); if (!a) return;
    d.lines = (d.lines || []).filter(l => !lineIsBlank(l));
    d.lines.push(C.arrearsLine(f, a));
    renderModal(); toast(a.label + ' added' + (a.amount ? ' · ' + money(a.amount) : '') + '.', 'ok');
  },
  edLineAdd(el) { S.modal.draft.lines.push({ studentName: '', desc: el && el.dataset.neg ? 'Discount' : '', detail: '', amount: el && el.dataset.neg ? '-' : '' }); renderModal(); focusLastLine(el && el.dataset.neg ? 'ea' : 'ed'); },
  edLineDel(el) { const ls = S.modal.draft.lines; ls.splice(+el.dataset.i, 1); if (!ls.length) ls.push({ studentName: '', desc: '', detail: '', amount: '' }); renderModal(); },
  edLineUp(el) { const ls = S.modal.draft.lines, i = +el.dataset.i; if (i > 0) { const t = ls[i - 1]; ls[i - 1] = ls[i]; ls[i] = t; } renderModal(); },
  saveInvoiceEdit() { return saveInvoiceEdit(); },
  async deleteCustomInvoice(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv || !inv.custom) return;
    if ((inv.paid > 0) || (inv.sends || []).length) { toast('This invoice was sent or paid — cancel it instead, so it stays on record.', 'err'); return; }
    if (!confirm('Delete custom invoice ' + inv.number + ' for ' + inv.parentName + '? This cannot be undone.')) return;
    try {
      const batch = db.batch();
      batch.delete(invRef(inv.id));
      if (inv.linkToken) batch.delete(linkRef(inv.linkToken));
      await batch.commit();
      S.modal = null; closeModal(); toast('Deleted', 'ok');
    } catch (e) { fail('Could not delete', e); }
  },
  async markPaidDirect(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    const owe = C.invoiceOutstanding(inv);
    if (!(owe > 0)) return;
    if (!confirm('Mark ' + inv.number + ' as paid (' + money(owe) + ' received today)?')) return;
    busy(el, true);
    try { await payInvoiceDirect(inv.id, owe); toast('Marked as paid', 'ok'); } catch (e) { fail('Could not mark it paid', e); } finally { busy(el, false); }
  },
  async undoPaidDirect(el) {
    if (!requireProtected()) return;
    const inv = IX.invById.get(el.dataset.id); if (!inv) return;
    if (!confirm('Undo the payment you marked on ' + inv.number + '? It becomes unpaid again.')) return;
    try { await unpayInvoiceDirect(inv.id); toast('Payment undone', 'ok'); } catch (e) { fail('Could not undo', e); }
  },
  openGenericQr() { openModal({ type: 'genericQr', reference: '', back: S.modal || null }); },
  async saveGenericQr() { const ref = C.cleanRef(S.modal.reference) || 'POLYMATH'; savePng(await qrPngBase64(C.genericPayNow(S.settings, ref)), 'PayNow-Polymath-generic' + (ref === 'POLYMATH' ? '' : '-' + ref.replace(/\s+/g, '-')) + '.png'); },
  async voidInvoice(el) {
    const inv = IX.invById.get(el.dataset.id);
    if (!inv || !requireProtected() || !confirm('Cancel ' + inv.number + ' for ' + inv.parentName + '?' + (inv.creditUsed > 0 ? ' The ' + money(inv.creditUsed) + ' credit it used goes back to the family.' : ''))) return;
    try {
      await db.runTransaction(async t => {
        const s = await t.get(invRef(inv.id));
        // A custom invoice need not belong to a family.
        const f = inv.familyId ? await t.get(famRef(inv.familyId)) : { exists: false };
        if (!s.exists || s.data().paid > 0) throw new Error('it has payments — undo them first');
        t.update(invRef(inv.id), { status: 'void', updatedAt: ts() });
        if (s.data().linkToken) t.set(linkRef(s.data().linkToken), { status: 'void', updatedAt: ts() }, { merge: true });
        if (f.exists && s.data().creditUsed > 0) t.update(famRef(inv.familyId), { credit: C.round2((Number(f.data().credit) || 0) + s.data().creditUsed) });
      });
      toast('Invoice cancelled', 'ok');
    } catch (e) { fail('Could not cancel', e); }
  },
  async unvoidInvoice(el) {
    const inv = IX.invById.get(el.dataset.id);
    if (!inv || !requireProtected()) return;
    try {
      await invRef(inv.id).update({ status: (inv.sends || []).length ? 'sent' : 'draft', updatedAt: ts() });
      if (inv.linkToken) await linkRef(inv.linkToken).set(Object.assign(C.publicInvoiceDoc(Object.assign({}, inv, { status: 'sent' }), S.settings), { updatedAt: ts() }));
      toast('Invoice restored', 'ok');
    } catch (e) { fail('Could not restore', e); }
  },
  // Reminders
  openReminders() {
    const items = allOwing().map(inv => ({ inv, email: recipientsFor(inv).length > 0, wa: !!phoneFor(inv), pick: C.canRemind(inv, today(), S.settings.reminderGapDays) }))
      .sort((a, b) => (stateOf(b.inv).daysOverdue - stateOf(a.inv).daysOverdue) || String(a.inv.parentName).localeCompare(String(b.inv.parentName)));
    openModal({ type: 'reminders', items });
  },
  remindEmail() { const list = S.modal.items.filter(x => x.pick && x.email).map(x => x.inv); emailMany(list, 'reminder'); },
  remindWa() { const list = S.modal.items.filter(x => x.pick && !x.email && x.wa).map(x => x.inv); openModal({ type: 'waq', ids: list.map(i => i.id), i: 0, kind: 'reminder', sent: 0, skipped: 0 }); },
  // Payments
  pickStatement() { $('file-statement').click(); },
  cancelReview() { S.review = null; render(); },
  dismissApply() { S.lastApply = null; render(); },
  rvTickGroup(el) {
    const on = el.dataset.on === '1';
    S.review.txs.forEach(t => {
      if (t.dup || !t.familyId) return;
      const sure = t.match.confidence === 'high' && t.match.how !== 'manual';
      if ((el.dataset.g === 'sure') === sure) t.tick = on;
    });
    render();
  },
  rvApply: applyReview,
  undoPayment(el) { undoPayment(el.dataset.id); },
  recordPayment(el) {
    closeModal();
    openModal({ type: 'pay', familyId: (el && el.dataset.fam) || '', amount: (el && el.dataset.amt) || '', date: today(), method: 'bank', note: '' });
  },
  async payCommit() {
    if (!requireProtected()) return;
    const m = S.modal;
    const btn = document.querySelector('[data-act="payCommit"]'); busy(btn, true);
    const tx = { key: 'manual-' + Date.now() + '-' + C.newToken(rnd, 5), familyId: m.familyId, amount: C.round2(m.amount), date: m.date || today(), method: m.method, how: m.method === 'cash' ? 'cash' : 'manual', description: (m.method === 'cash' ? 'Cash' : m.method === 'bank' ? 'Bank transfer' : 'Other') + (m.note ? ' — ' + m.note : ''), note: m.note, match: { familyId: m.familyId, how: 'manual', period: '' } };
    try {
      const res = await applyPayment(tx, {});
      if (S.settings.receipts) { try { await sendReceipt(res, tx); } catch (e) { console.warn(e); } }
      toast(money(tx.amount) + ' recorded', 'ok'); closeModal();
    } catch (e) { fail('Could not record', e); busy(btn, false); }
  },
  // Settings
  combinedAdd() {
    const d = S.settingsDraft || (S.settingsDraft = clone(S.settings));
    const sel = $('combined-add'); if (!sel || !C.isPeriod(sel.value)) return;
    d.combinedMonths = C.normalizeCombinedMonths([...(d.combinedMonths || []), sel.value]);
    render(); toast(C.periodRangeLabel(sel.value, C.addMonths(sel.value, 1)) + ' added — press Save settings.', 'ok');
  },
  combinedDel(el) {
    const d = S.settingsDraft || (S.settingsDraft = clone(S.settings));
    d.combinedMonths = C.normalizeCombinedMonths((d.combinedMonths || []).filter(p => p !== el.dataset.p));
    render(); toast(C.periodLabel(C.addMonths(el.dataset.p, 1)) + ' will be billed on its own — press Save settings.', 'ok');
  },
  async saveSettings(el) {
    if (!requireProtected()) return;
    const d = C.normalizeSettings(S.settingsDraft);
    busy(el, true);
    try { await db.collection(COL.settings).doc('config').set(Object.assign({}, d, { updatedAt: ts(), updatedBy: S.user.email }), { merge: true }); S.settingsDraft = null; toast('Settings saved', 'ok'); }
    catch (e) { fail('Could not save settings', e); } finally { busy(el, false); }
  },
  async aiTest(el) {
    const out = $('ai-test-out'); busy(el, true); out.textContent = 'Asking…';
    try { const t = await askChatGpt('Reply with JSON {"ok":true,"engine":"your model name"} and nothing else.', { maxOutputTokens: 200, system: 'Reply with strict JSON.' }); out.textContent = '✓ ChatGPT answered: ' + t.slice(0, 80); }
    catch (e) { out.textContent = '✕ ' + friendlyError(e); } finally { busy(el, false); }
  },
  async qrSelfTest(el) {
    const out = $('qr-test-out'); busy(el, true); out.textContent = 'Drawing and scanning a test QR…';
    try {
      await loadScript(JSQR);
      const payload = C.buildPayNow(123.45, 'PLC TEST23 NOV26', { uen: S.settings.uen, merchant: S.settings.merchant });
      const cv = await qrCanvas(payload, 300);
      const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      const res = window.jsQR(data.data, cv.width, cv.height);
      const back = res ? C.readPayNow(res.data) : null;
      out.textContent = res && res.data === payload && back.crcOk ? '✓ It scans: ' + money(back.amount) + ' to ' + back.uen + ', reference ' + back.reference + ', amount locked.' : '✕ The QR did not read back correctly.';
    } catch (e) { out.textContent = '✕ ' + friendlyError(e); } finally { busy(el, false); }
  },
  exportBackup() {
    const data = { exportedAt: new Date().toISOString(), version: OFFICE_VERSION, settings: S.settings, families: S.families.map(f => stripLocal(Object.assign({}, f, { id: undefined }))).map((f, i) => Object.assign({ id: S.families[i].id }, f)), invoices: S.invoices, payments: S.payments };
    downloadText(JSON.stringify(data, null, 2), 'polymath-office-backup-' + today() + '.json', 'application/json');
  },
  exportFamilies() {
    downloadText(C.toCsv([['Parent', 'Reference', 'Email', 'Second email', 'WhatsApp', 'Address', 'Signed up', 'Status', 'Students', 'Owes', 'Credit'],
      ...S.families.map(f => [f.parentName, C.familyReference(f.code), f.email, f.email2, C.displayPhone(f.whatsapp), f.address, f.signUpDate, f.status, f.students.map(s => s.name + ' (' + C.levelLabel(s.level) + ')').join('; '), familyOwing(f.id), f.credit])]), 'polymath-families-' + today() + '.csv', 'text/csv');
  },
  exportInvoices() {
    const p = C.sgMonthKey();
    downloadText(C.toCsv([['Number', 'Parent', 'Students', 'Month', 'For', 'Custom', 'Total', 'Paid', 'Owes', 'Status', 'Due', 'Reference', 'QR'],
      ...periodInvoices(p).map(i => [i.number, i.parentName, (i.students || []).join('; '), C.periodLabel(i.period), C.invoiceTitle(i, S.settings), i.custom ? 'yes' : '', i.total, i.paid || 0, C.invoiceOutstanding(i), stateOf(i).label, i.dueDate, i.reference, C.QR_MODE_META[C.invoiceQrMode(i)].short])]), 'polymath-invoices-' + p + '.csv', 'text/csv');
  }
};

/* ═══════════════ Custom invoices and the invoice editor ═══════════════ */
function customTags() { return new Set(S.invoices.filter(i => i.custom).map(i => String(i.id).replace(/^custom_/, ''))); }
function openCustomEditor(family) {
  const tag = C.newCustomTag(rnd, customTags());
  openModal({ type: 'invEdit', editing: false, draft: C.blankCustomInvoice({ tag, today: today(), settings: S.settings, schedule: S.schedule, family }), autoDue: true });
}
function focusLastLine(prefix) {
  const n = S.modal.draft.lines.length - 1;
  const el = document.querySelector('[data-keep="' + prefix + n + '"]');
  if (el) { el.focus(); try { const v = el.value.length; el.setSelectionRange(v, v); } catch (e) { /* not a text box */ } }
}
// Linking a family fills the parent's details (and, on a new custom invoice,
// the reference with the family's code); unlinking leaves what was typed.
function editorLinkFamily(famId) {
  const d = S.modal.draft;
  const f = famById(famId);
  d.familyId = f ? f.id : '';
  d.code = f ? f.code : '';
  if (f) {
    d.parentName = f.parentName || d.parentName;
    d.emails = C.familyEmails(f).join(', ');
    d.whatsapp = f.whatsapp ? C.displayPhone(f.whatsapp) : '';
    // A new custom invoice: the children's classes and fees (and hardcopy) are filled in.
    if (!S.modal.editing && d.custom) fillFamilyLines(d, f);
    else {
      const kids = C.activeStudents(f).map(s => s.name).filter(Boolean);
      if (kids.length === 1) d.lines.forEach(l => { if (!l.studentName && !l.kind) l.studentName = kids[0]; });
    }
  } else if (!S.modal.editing && d.custom) {
    d.lines = C.withoutPrefillLines(d.lines).filter(l => l.kind !== 'arrears');
    if (!d.lines.length) d.lines.push({ studentName: '', desc: '', detail: '', amount: '' });
    d.periodTo = '';
  }
  if (!S.modal.editing && d.custom) d.reference = C.customInvoiceReference(d.tag || String(d.id).replace(/^custom_/, ''), d.code);
  renderModal();
}
const lineIsBlank = l => !String(l.desc || '').trim() && !String(l.studentName || '').trim() && !String(l.detail || '').trim() && (l.amount === '' || l.amount == null || Number(l.amount) === 0 || l.amount === '-');
// Replace the filled-in lines (and empty rows) with the family's fees; typed lines and added months stay after them.
function fillFamilyLines(d, f) {
  const fill = C.familyFeeLines(f, { schedule: S.schedule, settings: S.settings, period: d.period });
  const keep = (d.lines || []).filter(l => !l.prefill && !lineIsBlank(l));
  d.lines = fill.lines.concat(keep);
  if (!d.lines.length) d.lines.push({ studentName: '', desc: '', detail: '', amount: '' });
  d.periodTo = fill.lines.length ? fill.periodTo : '';
  return fill;
}
async function saveInvoiceEdit() {
  if (!requireProtected()) return;
  const m = S.modal;
  const d = m.draft;
  const res = C.invoiceFromDraft(d);
  m.tried = true;
  if (!res.ok) { renderModal(); toast(res.errors[0], 'err'); return; }
  const btn = document.querySelector('[data-act="saveInvoiceEdit"]');
  busy(btn, true);
  try {
    if (!m.editing) {
      const ref = invRef(d.id);
      const token = C.newToken(rnd);
      const inv = Object.assign({
        id: d.id, custom: true, familyId: d.familyId || '', code: d.code || '', ownContacts: true,
        paid: 0, status: 'draft', payments: [], reminders: [], sends: [], creditUsed: 0
      }, res.fields);
      await db.runTransaction(async t => {
        const snap = await t.get(ref);
        if (snap.exists) throw new Error('an invoice with this tag already exists — close and try again');
        t.set(ref, Object.assign({}, inv, { linkToken: token, createdAt: ts(), updatedAt: ts(), createdBy: S.user.email }));
        t.set(linkRef(token), Object.assign(C.publicInvoiceDoc(inv, S.settings), { updatedAt: ts() }));
      });
      toast('Custom invoice ' + inv.number + ' created', 'ok');
      S.modal = null;
      // Show it in its month, then open it so it can be sent.
      S.period = inv.period;
      if (S.view !== 'invoices') go('invoices'); else render();
      openModal({ type: 'invoice', id: inv.id });
      return;
    }
    const start = m.start || {};
    const ownContacts = !!(d.custom || start.ownContacts || String(d.emails || '') !== String(start.emails || '') || String(d.whatsapp || '') !== String(start.whatsapp || ''));
    await db.runTransaction(async t => {
      const snap = await t.get(invRef(d.id));
      if (!snap.exists) throw new Error('the invoice is gone');
      const cur = Object.assign({}, snap.data(), { id: snap.id });
      const next = C.applyInvoiceEdit(cur, Object.assign({}, res.fields, { ownContacts, familyId: d.familyId || '', code: d.code || cur.code || '' }));
      const upd = Object.assign({}, res.fields, { ownContacts, familyId: next.familyId, code: next.code, status: next.status, updatedAt: ts(), editedAt: ts(), editedBy: S.user.email });
      t.update(invRef(d.id), upd);
      if (cur.linkToken) t.set(linkRef(cur.linkToken), Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }));
    });
    toast('Invoice saved', 'ok');
    const back = m.back;
    S.modal = null;
    if (back) openModal(Object.assign({}, back, { type: 'invoice', id: d.id })); else closeModal();
  } catch (e) { fail('Could not save the invoice', e); } finally { busy(btn, false); }
}
// The QR choice straight from the invoice dialog.
async function setInvoiceQrMode(id, mode) {
  if (!requireProtected()) return;
  if (!C.QR_MODES.includes(mode)) return;
  const inv = IX.invById.get(id); if (!inv) return;
  try {
    const next = Object.assign({}, inv, { qrMode: mode });
    await invRef(id).update({ qrMode: mode, updatedAt: ts() });
    if (inv.linkToken) await linkRef(inv.linkToken).set(Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }));
    toast(C.QR_MODE_META[mode].short + ' on ' + inv.number, 'ok');
  } catch (e) { fail('Could not change the QR', e); }
}
// An invoice with no family (a custom one) is paid straight on the invoice:
// there is no family to hold credit or to match a bank line to.
async function payInvoiceDirect(id, amount) {
  await db.runTransaction(async t => {
    const snap = await t.get(invRef(id));
    if (!snap.exists) throw new Error('the invoice is gone');
    const inv = Object.assign({}, snap.data(), { id: snap.id });
    const take = C.round2(Math.min(amount, C.invoiceOutstanding(inv)));
    if (!(take > 0)) return;
    const next = C.invoiceWithPayment(inv, take, { paymentId: 'direct-' + Date.now(), amount: take, date: today(), how: 'manual', at: Date.now(), by: S.user.email });
    t.update(invRef(id), { paid: next.paid, payments: next.payments, status: next.status, updatedAt: ts(), ...(next.status === 'paid' ? { paidAt: ts() } : {}) });
    if (inv.linkToken) t.set(linkRef(inv.linkToken), Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }), { merge: true });
  });
}
async function unpayInvoiceDirect(id) {
  await db.runTransaction(async t => {
    const snap = await t.get(invRef(id));
    if (!snap.exists) return;
    let inv = Object.assign({}, snap.data(), { id: snap.id });
    (inv.payments || []).filter(p => String(p.paymentId || '').startsWith('direct-')).forEach(p => { inv = C.invoiceWithPayment(inv, -p.amount, { paymentId: p.paymentId }); });
    t.update(invRef(id), { paid: inv.paid, payments: inv.payments, status: inv.status, updatedAt: ts() });
    if (inv.linkToken) t.set(linkRef(inv.linkToken), Object.assign(C.publicInvoiceDoc(inv, S.settings), { updatedAt: ts() }), { merge: true });
  });
}
async function refreshMailState(invId, ids) {
  const inv = IX.invById.get(invId); if (!inv) return;
  const want = ids || [...(inv.sends || []), ...(inv.reminders || [])].map(s => s.mailId).filter(Boolean).slice(-3);
  for (const id of want) {
    try {
      const d = await db.collection('mail').doc(id).get();
      const st = d.exists && d.data().delivery ? d.data().delivery.state : 'PENDING';
      S.mailState[id] = st === 'SUCCESS' ? 'delivered ✓' : st === 'ERROR' ? 'failed: ' + ((d.data().delivery || {}).error || '') : 'queued';
    } catch (e) { /* not readable yet */ }
  }
  if (S.modal && S.modal.type === 'invoice' && S.modal.id === invId && !S.modal.edit) renderModal();
}

/* ═══════════════ Inputs (typing never re-renders the whole screen) ═══════════════ */
const INP = {
  famSearch(el) { S.ui.famSearch = el.value; render(); },
  annText(el) { S.ui.ann.draft[el.dataset.k] = el.value; rememberAnnDraft(S.ui.ann.draft); annRefreshLive(); },
  annSearch(el) { S.ui.ann.search = el.value; render(); },
  stuSearch(el) { S.ui.stuSearch = el.value; render(); },
  invSearch(el) { S.ui.invSearch = el.value; render(); },
  fam(el) { S.modal.draft[el.dataset.k] = el.value; },
  stu(el) { S.modal.draft.students[+el.dataset.s][el.dataset.k] = el.value; },
  cls(el) { S.modal.draft.students[+el.dataset.s].classes[+el.dataset.c][el.dataset.k] = el.value; },
  disc(el) { const d = S.modal.draft.discount || (S.modal.draft.discount = { kind: '', value: '', label: 'Sibling discount' }); d[el.dataset.k] = el.value; },
  // A screenshot's note: typed straight into the (already sorted) list.
  shot(el) { const list = S.modal.draft.screenshots || []; const x = list[+el.dataset.i]; if (x) x[el.dataset.k] = el.value; },
  qrAmount(el) { S.modal.amount = el.value; renderModal(); },
  importPaste(el) { S.modal.paste = el.value; const b = document.querySelector('[data-act="importPreview"]'); if (b) b.disabled = !el.value.trim(); },
  // The invoice editor: every keystroke updates the preview (focus is kept).
  ed(el) { S.modal.draft[el.dataset.k] = el.value; if (el.dataset.k === 'issueDate' && S.modal.autoDue && C.isDayKey(el.value)) { S.modal.draft.dueDate = C.addDays(el.value, S.settings.dueDays); S.modal.draft.period = el.value.slice(0, 7); } if (el.dataset.k === 'dueDate') S.modal.autoDue = false; renderModal(); },
  edLine(el) { S.modal.draft.lines[+el.dataset.i][el.dataset.k] = el.value; renderModal(); },
  genericRef(el) { S.modal.reference = el.value; renderModal(); },
  payM(el) { S.modal[el.dataset.k] = el.value; if (el.dataset.k === 'amount') { const b = document.querySelector('[data-act="payCommit"]'); if (b) { b.disabled = !(S.modal.familyId && Number(el.value) > 0); b.textContent = 'Record ' + (Number(el.value) > 0 ? money(el.value) : 'payment'); } } },
  setting(el) { const d = S.settingsDraft || (S.settingsDraft = clone(S.settings)); d[el.dataset.k] = el.value; }
};
const CHG = {
  stuDay(el) { S.ui.stu.day = el.value; render(); },
  annF(el) {
    const k = el.dataset.k;
    if (!(k in C.EMPTY_FAMILY_FILTERS)) return;
    S.ui.ann.F[k] = el.value;
    if (k === 'paid' && !el.value) S.ui.ann.F.month = '';
    render();
  },
  annPick(el) {
    const ex = new Set(S.ui.ann.excluded);
    if (el.checked) ex.delete(el.dataset.id); else ex.add(el.dataset.id);
    S.ui.ann.excluded = [...ex]; render();
  },
  annGreet(el) { S.ui.ann.draft.greet = el.checked; rememberAnnDraft(S.ui.ann.draft); annRefreshLive(); },
  annPreview(el) { S.ui.ann.preview = el.value; annRefreshLive(); },
  annSure(el) { S.modal.sure = el.checked; renderModal(); },
  statMonth(el) { S.ui.statMonth = C.isPeriod(el.value) ? el.value : ''; render(); },
  famSort(el) { S.ui.famSort = C.FAMILY_SORT_KEYS.includes(el.value) ? el.value : 'level'; rememberFamSort(S.ui.famSort); render(); },
  famF(el) {
    const k = el.dataset.k;
    if (!(k in C.EMPTY_FAMILY_FILTERS)) return;
    S.ui.famF[k] = el.value;
    if (k === 'paid' && !el.value) S.ui.famF.month = '';
    render();
  },
  fam(el) { S.modal.draft[el.dataset.k] = el.value; renderModal(); },
  stu(el) { S.modal.draft.students[+el.dataset.s][el.dataset.k] = el.value; renderModal(); },
  cls(el) { S.modal.draft.students[+el.dataset.s].classes[+el.dataset.c][el.dataset.k] = el.value; renderModal(); },
  // Re-draw only when the email's warnings change, so a click on Save that
  // caused this change event is not lost to a re-drawn button.
  famEmail(el) {
    S.modal.draft[el.dataset.k] = el.value;
    if (emailWarningsKey(S.modal.draft) !== S.modal.emailKey) renderModal();
  },
  // Payment type, package dates, hardcopy (and its address), withdrawal.
  famOpt(el) {
    const f = S.modal.draft, k = el.dataset.k;
    if (k === 'hardcopy' || k === 'withdrawn') f[k] = el.value === 'yes';
    else if (k === 'status') {
      f.status = C.FAMILY_STATUS_KEYS.includes(el.value) ? el.value : 'active';
      f.withdrawn = f.status === 'withdrawn';
      if (f.status === 'withdrawn' && !f.lastMonth) f.lastMonth = C.sgMonthKey();
      if (f.status === 'paused' && !f.pauseFrom) f.pauseFrom = C.sgMonthKey();
      if (f.status !== 'paused') { f.pauseFrom = ''; f.pauseUntil = ''; }
      renderModal(); return;
    }
    else f[k] = el.value;
    if (k === 'withdrawn' && f.withdrawn && !f.lastMonth) f.lastMonth = C.sgMonthKey();
    // Typing the address never re-draws the dialog (a click elsewhere would be lost);
    // Save checks it again anyway.
    if (k === 'address') return;
    renderModal();
  },
  stuType(el) { const st = S.modal.draft.students; st[+el.dataset.s] = C.applyLessonType(st[+el.dataset.s], el.value, S.schedule); renderModal(); },
  pickSlot(el) { const st = S.modal.draft.students; st[+el.dataset.s] = C.toggleStudentSlot(st[+el.dataset.s], el.value, S.schedule); renderModal(); },
  shot(el) {
    const f = S.modal.draft;
    const list = C.normalizeScreenshots(f.screenshots);
    const x = list[+el.dataset.i]; if (!x) return;
    if (el.dataset.k === 'date' && !C.isDayKey(el.value)) { renderModal(); return; }
    x[el.dataset.k] = el.value;
    f.screenshots = C.normalizeScreenshots(list);
    renderModal();
  },
  clsSlot(el) {
    const c = S.modal.draft.students[+el.dataset.s].classes[+el.dataset.c];
    if (el.value === 'custom') { c.custom = true; c.slotId = ''; }
    else {
      c.slotId = el.value;
      const slot = C.scheduleSlot(S.schedule, el.value);
      const modes = C.slotModes(slot);
      if (!modes.includes(c.mode)) c.mode = modes[0];
    }
    renderModal();
  },
  disc(el) { const d = S.modal.draft.discount || (S.modal.draft.discount = { kind: '', value: '', label: 'Sibling discount' }); d[el.dataset.k] = el.value; if (!d.kind) S.modal.draft.discount = null; renderModal(); },
  importMap(el) { S.modal.mapping = Object.assign({}, S.modal.mapping, { [el.dataset.k]: el.value === '' ? undefined : Number(el.value) }); importFromRows(S.modal.rows, S.modal.source); },
  importFee(el) { S.modal.useSheetFee = el.checked; importFromRows(S.modal.rows, S.modal.source); },
  prepPick(el) { S.modal.items[+el.dataset.i].pick = el.checked; renderModal(); },
  prepAll(el) { S.modal.items.forEach(x => { x.pick = el.checked; }); renderModal(); },
  remPick(el) { S.modal.items[+el.dataset.i].pick = el.checked; renderModal(); },
  remAll(el) { S.modal.items.forEach(x => { x.pick = el.checked; }); renderModal(); },
  rvTick(el) { S.review.txs[+el.dataset.i].tick = el.checked; render(); },
  rvFam(el) {
    const t = S.review.txs[+el.dataset.i];
    t.familyId = el.value;
    if (el.value && el.value !== t.match.familyId) t.match = Object.assign({}, t.match, { how: 'manual', confidence: 'medium', why: 'Chosen by you', candidates: t.match.candidates });
    t.tick = !!el.value;
    render();
  },
  rvReceipts(el) { S.review.receipts = el.checked; },
  rvRemember(el) { S.review.remember = el.checked; },
  edFamily(el) { editorLinkFamily(el.value); },
  edPeriod(el) { S.modal.draft.period = el.value; renderModal(); },
  edQrMode(el) { S.modal.draft.qrMode = el.value; renderModal(); },
  invQrMode(el) { setInvoiceQrMode(S.modal.id, el.value); },
  payFam(el) { S.modal.familyId = el.value; if (!S.modal.amount && el.value) S.modal.amount = familyOwing(el.value) || ''; renderModal(); },
  payM(el) { S.modal[el.dataset.k] = el.value; },
  useAi(el) { S.settings.useAi = el.checked; db.collection(COL.settings).doc('config').set({ useAi: el.checked }, { merge: true }).catch(() => {}); },
  setAutopilot(el) { const d = S.settingsDraft || (S.settingsDraft = clone(S.settings)); d.autopilot = el.value; render(); },
  settingBool(el) { const d = S.settingsDraft || (S.settingsDraft = clone(S.settings)); d[el.dataset.k] = el.checked; }
};

/* ═══════════════ Wiring ═══════════════ */
document.addEventListener('click', e => {
  const tab = e.target.closest('#tabs .tab');
  if (tab) { go(tab.dataset.view); return; }
  // A click outside a dialog never closes it — work typed into it would be lost.
  // Only ✕, Close or Cancel close a dialog.
  if (e.target === $('modal')) { nudgeModal(); return; }
  if (e.target === $('drawer')) { S.drawer = null; renderDrawer(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A' || el.dataset.act !== 'noop') e.preventDefault();
  if (el.dataset.act === 'noop') return;
  try { const r = fn(el, e); if (r && r.catch) r.catch(err => fail('Something went wrong', err)); } catch (err) { fail('Something went wrong', err); }
});
// Links inside clickable rows must still open (WhatsApp icons).
document.addEventListener('click', e => { const a = e.target.closest('a[data-act="noop"]'); if (a) e.stopPropagation(); }, true);
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && INP[el.dataset.in]) INP[el.dataset.in](el, e); });
document.addEventListener('change', e => { const el = e.target.closest('[data-ch]'); if (el && CHG[el.dataset.ch]) CHG[el.dataset.ch](el, e); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Esc closes only a dialog that just shows something; one you type into stays.
    if (S.modal) { if (modalIsViewOnly()) closeModal(); else nudgeModal(); }
    else if (S.drawer) { S.drawer = null; renderDrawer(); }
    return;
  }
  if (S.modal && S.modal.type === 'waq' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    if (e.key === 'Enter') { e.preventDefault(); ACT.waSend(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); ACT.waNext(); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); ACT.waSkip(); }
  }
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('inv')) { e.preventDefault(); e.target.click(); }
});
$('file-statement').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleStatementFile(f); });
$('file-import').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !S.modal || S.modal.type !== 'import') return;
  try {
    let rows;
    if (/\.(csv|tsv|txt)$/i.test(f.name)) rows = C.parseDelimited(await f.text());
    else {
      await loadScript(SHEETJS);
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
      rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    }
    importFromRows(rows, f.name);
  } catch (err) { fail('Could not read ' + f.name, err); }
});
// Drag a statement anywhere on the page.
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  if (!S.admin || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  document.querySelectorAll('[data-drop]').forEach(d => d.classList.add('over'));
}));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, () => document.querySelectorAll('[data-drop]').forEach(d => d.classList.remove('over'))));
document.addEventListener('drop', e => {
  if (!S.admin || !e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  if (S.modal && S.modal.type === 'import') return;
  handleStatementFile(e.dataTransfer.files[0]);
});
window.addEventListener('hashchange', () => { const v = location.hash.replace('#', ''); if (VIEWS[v] && v !== S.view) go(v); });
// Re-check the lock when the tab comes back (after running the rules workflow).
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.admin && S.protected !== true) probeProtection(); });

// For the browser checks only.
window.PolymathOffice = { S, C, VIEWS, ACT, reindex, render, invoiceImage, qrCanvas, version: OFFICE_VERSION };
