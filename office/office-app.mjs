/* ═══════════════════════════════════════════════════════════════════════════
   🏢 POLYMATH OFFICE — the admin app (polymathlc.com.sg/office)

   One page, seven tabs, built so the month is mostly clicking "yes":
     🏠 Home       what needs doing next, and how the month is going
     👪 Families   parents (name, email, WhatsApp, address, sign-up date, their
                   permanent PayNow reference code) with their students under them
     🗓️ Timetable  the /schedule timetable with how many students sit in each class
     📋 Students   every student, filtered by level, subject, mode, day, payment
     🧾 Invoices   prepared from each student's classes and the schedule's fees;
                   sent by email (QR inside) or WhatsApp Web (invoice picture pasted)
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
     officePayments/{txKey}    every bank credit (or cash) applied — the ledger
     officeStatements/{id}     each uploaded statement and how it was read
     officeSettings/config     the settings; officeSettings/autopilot its heartbeat
     officeLinks/{token}       what a parent's /pay link shows (no contacts)
     mail/polymath-office-*    emails for the Trigger Email extension
   Reads: schedule_config/main (the /schedule page's own document).
   ═══════════════════════════════════════════════════════════════════════════ */
import * as C from './office-core.mjs?v=1.0.0';

const OFFICE_VERSION = 'v1.0.0';

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
  listenErrors: {},
  view: 'home',
  period: C.sgMonthKey(),
  ui: {
    famSearch: '', famFilter: 'all',
    stuSearch: '', stu: { level: '', subject: '', mode: '', day: '', status: 'active', pay: '', cls: '' }, stuSort: { key: 'name', dir: 1 },
    tt: { level: '', subject: '', mode: '' },
    invFilter: 'all', invSearch: ''
  },
  modal: null, drawer: null,
  review: null,                       // the statement being reviewed
  lastApply: null,                    // the result card after applying payments
  mailState: {}                       // mailId → delivery state, read on demand
};
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
  IX = { fam, invByFam, invById, payByKey, roster: C.slotRoster(S.families, S.schedule), rows: C.studentRows(S.families, S.schedule) };
}
const famById = id => IX.fam.get(id) || null;
const invoicesOf = id => IX.invByFam.get(id) || [];
const invoiceFor = (famId, period) => invoicesOf(famId).find(i => i.period === period) || null;
const periodInvoices = period => S.invoices.filter(i => i.period === period);
const familyOwing = id => C.round2(invoicesOf(id).reduce((s, i) => s + C.invoiceOutstanding(i), 0));
const stateOf = inv => C.invoiceState(inv, today());
function famStateFor(f, period) {
  const inv = invoiceFor(f.id, period);
  if (inv) return Object.assign({ inv }, stateOf(inv));
  if (f.status === 'inactive') return { key: 'inactive', label: 'Inactive', tone: 'grey', icon: '💤' };
  if (!C.familyIsBillable(f)) return { key: 'none', label: 'No active students', tone: 'grey', icon: '·' };
  return { key: 'noinv', label: 'Not invoiced', tone: 'grey', icon: '📝' };
}
function studentsWithoutClass() {
  return IX.rows.filter(r => r.status === 'active' && !r.classes.length && !(C.feeNum((r.family.students.find(s => s.id === r.studentId) || {}).monthlyFee)));
}
function billableWithoutInvoice(period) {
  return S.families.filter(f => C.familyIsBillable(f) && !invoiceFor(f.id, period));
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
  set('families', S.families.filter(f => f.status === 'active').length);
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
    return subjChip(c.subject, slot && C.isMaster(slot), (c.when ? c.when + ' · ' : '') + (c.subject || c.title) + (c.mode === 'Online' ? ' 💻' : ''));
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
  const period = C.sgMonthKey();
  const label = C.periodLabel(period);
  const invs = periodInvoices(period);
  const sum = C.periodSummary(invs, today());
  const active = S.families.filter(f => f.status === 'active');
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

/* ═══════════════ 👪 Families ═══════════════ */
VIEWS.families = function () {
  const period = C.sgMonthKey();
  const q = C.normText(S.ui.famSearch);
  const noClassFam = new Set(studentsWithoutClass().map(r => r.familyId));
  const filters = {
    all: f => f.status === 'active',
    owing: f => familyOwing(f.id) > 0,
    noemail: f => f.status === 'active' && !C.familyEmails(f).length,
    noclass: f => noClassFam.has(f.id),
    inactive: f => f.status === 'inactive'
  };
  const count = k => S.families.filter(filters[k]).length;
  const list = S.families.filter(filters[S.ui.famFilter] || filters.all).filter(f => {
    if (!q) return true;
    const hay = C.normText([f.parentName, f.email, f.email2, f.whatsapp, f.code, f.address, ...f.students.map(s => s.name + ' ' + s.school)].join(' '));
    return q.split(' ').every(w => hay.includes(w));
  });
  const chip = (k, label) => '<button class="chip ' + (S.ui.famFilter === k ? 'on' : '') + '" data-act="famFilter" data-k="' + k + '">' + label + ' <span class="n">' + count(k) + '</span></button>';
  return '<div class="page-head"><div><h1>Families</h1><p>Each family has its own PayNow reference code. Students sit under their parent.</p></div>'
    + '<div class="actions"><button class="btn ghost" data-act="openImport">⬆ Import spreadsheet</button><button class="btn" data-act="newFamily">＋ Add a family</button></div></div>'
    + '<div class="toolbar"><div class="search"><input type="search" placeholder="Search parent, student, phone, email or code" value="' + esc(S.ui.famSearch) + '" data-in="famSearch" data-keep="famSearch" aria-label="Search families"></div></div>'
    + '<div class="chips" style="margin-bottom:18px;">' + chip('all', 'Active') + chip('owing', '💰 Owing') + chip('noemail', '✉ No email') + chip('noclass', '🧩 No class') + chip('inactive', '💤 Inactive') + '</div>'
    + (!S.familiesLoaded ? emptyHtml('⏳', 'Loading…', '')
      : !S.families.length ? emptyHtml('👪', 'No families yet', 'Import your spreadsheet of students and parents, or add a family by hand.', '<button class="btn" data-act="openImport">⬆ Import a spreadsheet</button><button class="btn ghost" data-act="newFamily">＋ Add a family</button>')
        : !list.length ? emptyHtml('🔍', 'Nobody matches', 'Try a different search or filter.')
          : '<div class="fam-grid">' + list.map(f => famCardHtml(f, period)).join('') + '</div>');
};
function famCardHtml(f, period) {
  const st = famStateFor(f, period);
  const owe = familyOwing(f.id);
  const kids = f.students.filter(s => s.status !== 'left');
  const rowsById = new Map(IX.rows.filter(r => r.familyId === f.id).map(r => [r.studentId, r]));
  return '<button type="button" class="fam ' + (f.status === 'inactive' ? 'inactive' : '') + '" data-act="openFamily" data-id="' + esc(f.id) + '">'
    + '<div class="fam-top"><div><div class="fam-name">' + esc(f.parentName || 'Unnamed parent') + '</div>'
    + '<span class="code">' + esc(C.familyReference(f.code)) + '</span></div>' + pill(st) + '</div>'
    + '<div class="fam-kids">' + (kids.length ? kids.map(s => {
      const r = rowsById.get(s.id);
      return '<div class="fam-kid"><span class="kid"><span class="lv">' + esc(C.levelLabel(s.level) || '—') + '</span><b>' + esc(s.name) + '</b></span>'
        + (s.status === 'paused' ? '<span class="pill grey">Paused</span>' : (r ? classChips(r) : '')) + '</div>';
    }).join('') : '<span class="muted small">No students yet</span>') + '</div>'
    + '<div class="fam-foot"><div class="contact">'
    + (C.familyEmails(f).length ? '<span>✉ ' + esc(C.familyEmails(f)[0]) + '</span>' : '<span class="warn-t">✉ no email</span>')
    + (f.whatsapp ? '<span>💬 ' + esc(C.displayPhone(f.whatsapp)) + '</span>' : '<span class="warn-t">💬 no WhatsApp</span>') + '</div>'
    + (owe > 0 ? '<span class="owe ' + (st.key === 'overdue' ? 'red' : '') + '">Owes ' + money(owe) + '</span>' : (f.credit > 0 ? '<span class="pill green">Credit ' + money(f.credit) + '</span>' : '')) + '</div>'
    + '</button>';
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
      const phys = roster.filter(x => x.mode === 'Physical').length;
      return '<td><button class="tt-cls ' + k + (matches(slot) ? '' : ' dim') + '" data-act="openSlot" data-id="' + cell.id + '">'
        + '<span class="t1">' + (C.isMaster(slot) ? '⭐ ' : '') + esc(C.levelLabel(slot.level) + ' ' + slot.subject) + '</span>'
        + (slot.status === 'closed' ? '<span class="closed">Hidden on /schedule</span>' : slot.status === 'full' ? '<span class="closed" style="color:var(--amber)">Full</span>' : '')
        + '<span class="cnt">' + roster.length + '<small>' + (roster.length === 1 ? 'student' : 'students') + '</small></span>'
        + '<span class="mix">' + (roster.length ? '🏫 ' + phys + ' · 💻 ' + (roster.length - phys) : 'Nobody yet') + ' · ' + money(C.monthlyFeeFor(slot, 'Physical', S.schedule)) + '</span></button></td>';
    }).join('') + '</tr>').join('');
  const noClass = studentsWithoutClass();
  return '<div class="page-head"><div><h1>Timetable</h1><p>The classes on <a href="../schedule/#timetable" target="_blank" rel="noopener">/schedule</a>, with how many students are in each. Click a class to see who.</p></div>'
    + '<div class="actions"><span class="pill deep">' + C.plural(totalClasses, 'class', 'classes') + ' · ' + C.plural(totalStudents, 'seat') + '</span></div></div>'
    + '<div class="filterrow"><span class="lbl">Level</span><div class="chips">' + chip('level', '', 'All') + C.LEVELS.map(l => chip('level', l, C.levelLabel(l))).join('') + '</div>'
    + '<span class="lbl">Subject</span><div class="chips">' + chip('subject', '', 'All') + chip('subject', 'Math', '➗ Math') + chip('subject', 'Science', '🔬 Science') + '</div>'
    + '<span class="lbl">Mode</span><div class="chips">' + chip('mode', '', 'All') + chip('mode', 'Physical', '🏫 Physical') + chip('mode', 'Online', '💻 Online') + '</div></div>'
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
    + '<div class="chips" style="margin-bottom:14px;">' + C.slotModes(slot).map(m => '<span class="pill deep">' + (m === 'Online' ? '💻' : '🏫') + ' ' + m + ' ' + money(C.monthlyFeeFor(slot, m, S.schedule)) + '/month</span>').join('') + '</div>'
    + (roster.length ? '<table class="t"><tbody>' + roster.map(r => {
      const st = famStateFor(r.family, period);
      return '<tr class="click" data-act="openFamily" data-id="' + esc(r.familyId) + '"><td><b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.parentName) + '</div></td>'
        + '<td>' + (r.mode === 'Online' ? '💻' : '🏫') + '</td><td><span class="dot ' + st.tone + '" title="' + esc(st.label) + '"></span></td>'
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
    + '<div class="filterrow"><span class="lbl">Mode</span><div class="chips">' + chip('mode', '', 'All') + chip('mode', 'Physical', '🏫 Physical') + chip('mode', 'Online', '💻 Online') + '</div>'
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
  const label = C.periodLabel(period);
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
    return C.normText([i.parentName, i.number, i.reference, ...(i.students || []), f && f.whatsapp, f && f.email].join(' ')).includes(q);
  }).sort((a, b) => {
    const order = { overdue: 0, part: 1, waiting: 2, draft: 3, paid: 4, free: 5, void: 6 };
    return (order[stateOf(a).key] - order[stateOf(b).key]) || String(a.parentName).localeCompare(String(b.parentName));
  });
  const drafts = invs.filter(i => stateOf(i).key === 'draft');
  const draftsNoEmail = drafts.filter(i => !recipientsFor(i).length);
  const chip = (k, lbl) => '<button class="chip ' + (S.ui.invFilter === k ? 'on' : '') + '" data-act="invFilter" data-k="' + k + '">' + lbl + ' <span class="n">' + (counts[k] || 0) + '</span></button>';
  let bulk = '';
  if (missing.length) {
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
  return '<div class="page-head"><div><h1>Invoices</h1><p>One invoice per family per month, with a PayNow QR that fills in the amount and the family\'s reference.</p></div>'
    + '<div class="actions"><div class="monthnav"><button data-act="period" data-d="-1" aria-label="Previous month">◀</button><b>' + esc(label) + '</b><button data-act="period" data-d="1" aria-label="Next month">▶</button></div>'
    + '<button class="btn ghost" data-act="openReminders">🔔 Reminders</button></div></div>'
    + '<div class="stats" style="margin-bottom:18px;">'
    + '<div class="stat deep"><div class="label">Billed</div><div class="value">' + money(sum.billed) + '</div><div class="hint">' + C.plural(sum.count, 'invoice') + '</div></div>'
    + '<div class="stat green"><div class="label">Collected</div><div class="value">' + money(sum.collected) + '</div><div class="hint">' + sum.percent + '%</div></div>'
    + '<div class="stat amber"><div class="label">Waiting</div><div class="value">' + money(sum.outstanding) + '</div><div class="hint">' + C.plural(sum.waiting + sum.part + sum.overdue, 'family', 'families') + '</div></div>'
    + '<div class="stat ' + (sum.overdue ? 'red' : '') + '"><div class="label">Overdue</div><div class="value">' + sum.overdue + '</div><div class="hint">past the due date</div></div></div>'
    + bulk
    + '<div class="toolbar"><div class="search"><input type="search" placeholder="Search parent, student, number or reference" value="' + esc(S.ui.invSearch) + '" data-in="invSearch" data-keep="invSearch" aria-label="Search invoices"></div></div>'
    + '<div class="chips" style="margin-bottom:16px;">' + chip('all', 'All') + chip('draft', '📝 Not sent') + chip('waiting', '⏳ Waiting') + chip('overdue', '⚠️ Overdue') + chip('part', '◐ Part paid') + chip('paid', '✅ Paid') + chip('void', '✕ Cancelled') + '</div>'
    + (!invs.length ? '<div class="card">' + emptyHtml('🧾', 'No ' + esc(label) + ' invoices yet', missing.length ? 'Prepare them from each student\'s classes.' : 'Add families and put their children in classes first.', missing.length ? '<button class="btn" data-act="openPrepare">Prepare invoices</button>' : '') + '</div>'
      : !list.length ? '<div class="card">' + emptyHtml('🔍', 'Nothing here', 'Try another filter.') + '</div>'
        : '<div class="inv-list">' + list.map(invRowHtml).join('') + '</div>');
};
function recipientsFor(inv) {
  const f = famById(inv.familyId);
  return f ? C.familyEmails(f) : (inv.emails || []).filter(C.isEmail);
}
function phoneFor(inv) { const f = famById(inv.familyId); return (f && f.whatsapp) || inv.whatsapp || ''; }
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
    + '<div class="who"><b>' + esc(inv.parentName) + '</b><span>' + esc(kids) + '</span></div>'
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
    + '</div></div>'
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
    + '<div class="full actions"><button class="btn ghost" data-act="qrSelfTest">🔍 Test a QR</button><span class="small muted" id="qr-test-out"></span></div></div>'
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
MODALS.family = function (m) {
  const f = m.draft;
  const isNew = !f.id;
  const fld = (k, label, type, extra) => '<div class="field ' + (extra && extra.full ? 'full' : '') + '"><label>' + label + '</label>'
    + (type === 'textarea' ? '<textarea data-in="fam" data-k="' + k + '">' + esc(f[k]) + '</textarea>'
      : '<input type="' + (type || 'text') + '" value="' + esc(k === 'whatsapp' && /^\d{9,}$/.test(f[k] || '') ? C.displayPhone(f[k]) : f[k]) + '" data-in="fam" data-k="' + k + '" data-keep="fam-' + k + '"' + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>') + '</div>';
  const inv = f.id ? invoicesOf(f.id) : [];
  const owe = f.id ? familyOwing(f.id) : 0;
  const stud = f.students.map((s, si) => {
    const classes = s.classes.map((c, ci) => {
      const slot = c.custom ? null : C.scheduleSlot(S.schedule, c.slotId);
      const fee = slot ? C.monthlyFeeFor(slot, c.mode, S.schedule) : 0;
      return '<div class="class-row">'
        + (c.custom ? '<input type="text" placeholder="What is it? e.g. 1-to-1 Science" value="' + esc(c.label) + '" data-in="cls" data-s="' + si + '" data-c="' + ci + '" data-k="label" data-keep="cl-' + si + '-' + ci + '">'
          : '<select data-ch="clsSlot" data-s="' + si + '" data-c="' + ci + '">' + slotOptionsHtml(c.slotId, s.level) + '</select>')
        + '<select data-ch="cls" data-s="' + si + '" data-c="' + ci + '" data-k="mode"><option value="Physical" ' + (c.mode === 'Physical' ? 'selected' : '') + '>🏫 Physical</option><option value="Online" ' + (c.mode === 'Online' ? 'selected' : '') + '>💻 Online</option></select>'
        + '<input type="number" min="0" step="0.01" placeholder="' + (c.custom ? 'Fee per month' : (fee ? 'Schedule ' + money(fee) : 'No fee set')) + '" value="' + esc(c.rate) + '" data-in="cls" data-s="' + si + '" data-c="' + ci + '" data-k="rate" data-keep="cr-' + si + '-' + ci + '" title="Leave blank to use the schedule\'s fee">'
        + '<button class="iconbtn" data-act="delClass" data-s="' + si + '" data-c="' + ci + '" title="Remove this class">✕</button></div>';
    }).join('');
    return '<div class="student-card"><div class="form">'
      + '<div class="field"><label>Student name</label><input type="text" value="' + esc(s.name) + '" data-in="stu" data-s="' + si + '" data-k="name" data-keep="sn-' + si + '"></div>'
      + '<div class="field"><label>Level</label><select data-ch="stu" data-s="' + si + '" data-k="level"><option value="">—</option>' + C.LEVELS.map(l => '<option value="' + l + '" ' + (C.normalizeLevel(s.level) === l ? 'selected' : '') + '>' + C.levelLabel(l) + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>Status</label><select data-ch="stu" data-s="' + si + '" data-k="status">' + [['active', 'Active'], ['paused', 'Paused (not billed)'], ['left', 'Left']].map(([v, l]) => '<option value="' + v + '" ' + (s.status === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></div>'
      + '<div class="field"><label>School <span class="opt">(optional)</span></label><input type="text" value="' + esc(s.school) + '" data-in="stu" data-s="' + si + '" data-k="school" data-keep="ss-' + si + '"></div>'
      + '<div class="field"><label>Started</label><input type="date" value="' + esc(s.startDate) + '" data-in="stu" data-s="' + si + '" data-k="startDate"></div>'
      + '<div class="field"><label>Own monthly fee <span class="opt">(optional)</span></label><input type="number" min="0" step="0.01" placeholder="From classes" value="' + esc(s.monthlyFee) + '" data-in="stu" data-s="' + si + '" data-k="monthlyFee" data-keep="sm-' + si + '"></div>'
      + '</div><div class="section-title" style="margin-top:14px;">Classes</div>' + (classes || '<div class="small muted">Not in a class yet.</div>')
      + '<div class="actions" style="margin-top:10px;"><button class="btn xs ghost" data-act="addClass" data-s="' + si + '">＋ Add a class</button><button class="btn xs ghost" data-act="addCustom" data-s="' + si + '">＋ Other arrangement</button>'
      + '<span style="flex:1"></span><button class="btn xs danger" data-act="delStudent" data-s="' + si + '">Remove student</button></div>'
      + (s.notes ? '<div class="small muted" style="margin-top:8px;">📝 ' + esc(s.notes) + '</div>' : '') + '</div>';
  }).join('');
  const d = f.discount || { kind: '', value: '', label: '' };
  const body = '<div class="split"><div>'
    + '<div class="section-title">Parent</div><div class="form">'
    + fld('parentName', 'Parent name', 'text', { full: true })
    + fld('email', 'Email', 'email') + fld('email2', 'Second email <span class="opt">(optional)</span>', 'email')
    + fld('whatsapp', 'WhatsApp number', 'tel', { ph: '9123 4567' }) + fld('signUpDate', 'Date of sign-up', 'date')
    + fld('address', 'Address', 'textarea', { full: true })
    + '<div class="field"><label>Status</label><select data-ch="fam" data-k="status"><option value="active" ' + (f.status === 'active' ? 'selected' : '') + '>Active</option><option value="inactive" ' + (f.status === 'inactive' ? 'selected' : '') + '>Inactive (not billed)</option></select></div>'
    + '<div class="field"><label>Standing discount <span class="opt">(optional)</span></label><div style="display:flex;gap:6px;"><select data-ch="disc" data-k="kind" style="flex:0 0 112px;width:112px;"><option value="">None</option><option value="amount" ' + (d.kind === 'amount' ? 'selected' : '') + '>$ off</option><option value="percent" ' + (d.kind === 'percent' ? 'selected' : '') + '>% off</option></select>'
    + '<input type="number" min="0" step="0.01" value="' + esc(d.value) + '" data-in="disc" data-k="value" data-keep="dv" ' + (d.kind ? '' : 'disabled') + '></div></div>'
    + (d.kind ? '<div class="field full"><label>Discount name</label><input type="text" value="' + esc(d.label || 'Sibling discount') + '" data-in="disc" data-k="label" data-keep="dl"></div>' : '')
    + fld('notes', 'Notes <span class="opt">(only you see these)</span>', 'textarea', { full: true }) + '</div>'
    + '<div class="section-title" style="margin-top:20px;">PayNow reference</div>'
    + (f.code ? '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span class="code" style="font-size:15px;padding:6px 12px;">' + esc(C.familyReference(f.code)) + '</span>'
      + '<button class="btn xs ghost" data-act="copy" data-text="' + esc(C.familyReference(f.code)) + '">Copy</button><button class="btn xs ghost" data-act="familyQr">📱 QR for any amount</button></div>'
      + '<div class="small muted" style="margin-top:6px;">Every invoice adds the month, e.g. ' + esc(C.invoiceReference(f.code, C.sgMonthKey())) + '. The bank shows it on your statement, which is how payments are matched.</div>'
      : '<div class="small muted">A permanent code is created when you save.</div>')
    + (f.credit > 0 ? '<div class="banner green" style="margin-top:14px;"><div class="big">💳</div><div><b>Credit ' + money(f.credit) + '</b>Taken off the next invoice automatically.</div></div>' : '')
    + (f.payerNames && f.payerNames.length ? '<div class="small muted" style="margin-top:10px;">🏦 Bank names seen: ' + f.payerNames.map(p => esc(p.toUpperCase())).join(', ') + '</div>' : '')
    + '</div><div>'
    + '<div class="section-title">Students</div>' + stud
    + '<button class="btn ghost sm" data-act="addStudent">＋ Add another child</button>'
    + (inv.length ? '<div class="section-title" style="margin-top:22px;">Invoices' + (owe > 0 ? ' · owes ' + money(owe) : '') + '</div><div class="history">'
      + inv.slice(0, 8).map(i => { const st = stateOf(i); return '<div><time>' + esc(C.periodLabel(i.period)) + '</time><span>' + money(i.total) + ' ' + pill(st) + ' <button class="linkbtn small" data-act="openInvoice" data-id="' + esc(i.id) + '">open</button></span></div>'; }).join('') + '</div>' : '')
    + '</div></div>';
  return {
    size: 'wide',
    title: isNew ? 'New family' : esc(f.parentName || 'Family'),
    sub: isNew ? 'Parent details, then each child and their classes. Fees come from the schedule.' : esc(C.plural(f.students.filter(s => s.status === 'active').length, 'active student')),
    body,
    foot: (isNew ? '' : '<button class="btn danger left" data-act="deleteFamily">Delete family</button>')
      + (f.whatsapp ? '<a class="btn wa" href="' + esc(C.whatsappLink(f.whatsapp, 'Hi ' + (f.parentName || ''), !TOUCH)) + '" target="polymath_whatsapp" rel="noopener" data-act="noop">💬 WhatsApp</a>' : '')
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
MODALS.invoice = function (m) {
  const inv = IX.invById.get(m.id);
  if (!inv) return { title: 'Invoice', body: emptyHtml('🧾', 'This invoice is gone', 'It may have been deleted.') };
  const st = stateOf(inv);
  const owe = C.invoiceOutstanding(inv);
  const fam = famById(inv.familyId);
  const editing = !!m.edit;
  const lines = editing ? m.edit : inv.lines;
  const payload = owe > 0 ? C.buildPayNow(owe, inv.reference, { uen: S.settings.uen, merchant: S.settings.merchant }) : '';
  const linesHtml = '<table class="inv-lines"><tbody>' + lines.map((l, i) => editing
    ? '<tr><td><input type="text" value="' + esc(l.studentName || '') + '" placeholder="Student" data-in="line" data-i="' + i + '" data-k="studentName" data-keep="ls' + i + '"><input type="text" value="' + esc(l.desc) + '" data-in="line" data-i="' + i + '" data-k="desc" data-keep="ld' + i + '" style="margin-top:4px;"></td>'
      + '<td class="r"><input class="money" type="number" step="0.01" value="' + esc(l.amount) + '" data-in="line" data-i="' + i + '" data-k="amount" data-keep="la' + i + '"><br><button class="linkbtn small" data-act="delLine" data-i="' + i + '">remove</button></td></tr>'
    : '<tr><td>' + (l.studentName ? '<b>' + esc(l.studentName) + '</b><br>' : '') + esc(l.desc) + (l.detail ? '<div class="det">' + esc(l.detail) + '</div>' : '') + '</td><td class="r" style="' + (l.amount < 0 ? 'color:var(--green)' : '') + '">' + money(l.amount) + '</td></tr>').join('')
    + (editing ? '<tr><td colspan="2"><button class="btn xs ghost" data-act="addLine">＋ Add a line</button></td></tr>' : '')
    + '<tr class="total"><td>Total</td><td class="r">' + money(editing ? Math.max(0, lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)) : inv.total) + '</td></tr>'
    + (!editing && inv.paid > 0 ? '<tr><td class="muted">Received</td><td class="r" style="color:var(--green)">' + money(inv.paid) + '</td></tr><tr><td><b>Still to pay</b></td><td class="r"><b>' + money(owe) + '</b></td></tr>' : '')
    + '</tbody></table>';
  const hist = [];
  if (inv.createdAt) hist.push([tsMs(inv.createdAt), 'Prepared' + (inv.createdBy === 'autopilot' ? ' by the autopilot' : '')]);
  (inv.sends || []).forEach(s => hist.push([s.at, (s.via === 'email' ? '✉ Emailed' : '💬 WhatsApp opened') + (s.to ? ' to ' + s.to.join(', ') : '') + (s.mailId && S.mailState[s.mailId] ? ' — ' + S.mailState[s.mailId] : '')]));
  (inv.reminders || []).forEach(r => hist.push([r.at, '🔔 Reminder ' + (r.level || '') + ' by ' + (r.via === 'email' ? 'email' : 'WhatsApp') + (r.mailId && S.mailState[r.mailId] ? ' — ' + S.mailState[r.mailId] : '')]));
  (inv.payments || []).forEach(p => hist.push([p.at || 0, '💰 ' + money(p.amount) + ' received ' + (p.date ? C.prettyDate(p.date) : '') + (p.how ? ' (' + howLabel(p.how) + ')' : '')]));
  hist.sort((a, b) => a[0] - b[0]);
  const canEmail = recipientsFor(inv).length > 0, canWa = !!phoneFor(inv);
  const live = inv.status !== 'void' && st.key !== 'paid' && st.key !== 'free';
  // Before the due date the invoice itself is what goes out again; after it (or
  // once part is paid) it is a reminder.
  const remind = ['overdue', 'part'].includes(st.key);
  return {
    size: 'wide', title: esc(inv.parentName) + ' · ' + esc(C.periodLabel(inv.period)), sub: esc(inv.number) + ' · ' + pill(st) + (isFinite(Date.parse(inv.dueDate)) ? ' · due ' + esc(C.prettyDate(inv.dueDate)) : ''),
    body: '<div class="split" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);"><div><div class="inv-paper"><div class="hd"><b>POLYMATH LEARNING CENTRE</b><span>Invoice ' + esc(inv.number) + '</span></div><div class="bar"></div><div class="bd">'
      + '<div class="small muted" style="margin-bottom:6px;">For ' + esc(inv.parentName) + ' · issued ' + esc(C.prettyDate(inv.issueDate)) + '</div>' + linesHtml
      + (payload && !editing ? '<div class="qr-box"><div class="amt">' + money(owe) + '</div><div class="q" data-qr="' + esc(payload) + '" data-size="200"></div><div class="ref">Reference <b>' + esc(inv.reference) + '</b> · UEN ' + esc(S.settings.uen) + '</div>'
        + '<div class="actions" style="justify-content:center;margin-top:12px;"><button class="btn sm" data-act="saveInvoiceQr">⬇ Save QR</button><button class="btn sm ghost" data-act="saveInvoiceImage">⬇ Save invoice picture</button></div></div>' : '')
      + (inv.issues && inv.issues.length ? '<div class="banner amber" style="margin-top:12px;"><div class="big">⚠️</div><div><b>Check these</b>' + inv.issues.map(esc).join('<br>') + '</div></div>' : '')
      + '</div></div></div>'
      + '<div><div class="section-title">Send</div><div class="side-actions">'
      + (editing ? '<button class="btn" data-act="saveLines">Save the changes</button><button class="btn ghost" data-act="cancelLines">Cancel editing</button>'
        : (live ? (canEmail ? '<button class="btn" data-act="emailInvoice" data-id="' + esc(inv.id) + '">✉ ' + ((inv.sends || []).some(s => s.via === 'email') ? 'Email the invoice again' : 'Email the invoice') + '</button>' : '<div class="banner amber" style="margin:0;padding:10px 12px;"><div>✉ No email for this family — <button class="linkbtn" data-act="openFamily" data-id="' + esc(inv.familyId) + '">add one</button>.</div></div>')
          + (remind && canEmail ? '<button class="btn ghost" data-act="remindOne" data-id="' + esc(inv.id) + '">🔔 Email a reminder' + ((inv.reminders || []).length ? ' (#' + ((inv.reminders || []).length + 1) + ')' : '') + '</button>' : '')
          + (canWa ? '<button class="btn wa" data-act="waOne" data-id="' + esc(inv.id) + '" data-kind="' + (remind ? 'reminder' : 'invoice') + '">💬 WhatsApp ' + (remind ? 'a reminder' : 'the invoice') + '</button><div class="small muted">Copies the invoice picture (with the QR) and opens the chat — press Ctrl+V there, then Enter.</div>' : '')
          + '<button class="btn ghost" data-act="copyPayLink" data-id="' + esc(inv.id) + '">🔗 Copy the parent\'s pay link</button>'
          + (st.key === 'draft' ? '<button class="btn ghost" data-act="markSent" data-id="' + esc(inv.id) + '">✓ I sent it myself — mark as sent</button>' : '') : '')
          + '<div class="section-title" style="margin-top:12px;">Money</div>'
          + (live ? '<button class="btn ghost" data-act="recordPayment" data-fam="' + esc(inv.familyId) + '" data-amt="' + owe + '">💵 Record a payment</button>' : '')
          + (inv.status !== 'void' && !(inv.paid > 0) ? '<button class="btn ghost" data-act="editLines">✏️ Change the lines</button>' : '')
          + (inv.status !== 'void' && !(inv.paid > 0) ? '<button class="btn danger" data-act="voidInvoice" data-id="' + esc(inv.id) + '">✕ Cancel this invoice</button>' : '')
          + (inv.status === 'void' ? '<button class="btn ghost" data-act="unvoidInvoice" data-id="' + esc(inv.id) + '">↩ Restore this invoice</button>' : ''))
      + '</div><div class="section-title" style="margin-top:22px;">History</div><div class="history">'
      + (hist.length ? hist.map(([at, txt]) => '<div><time>' + (at ? esc(new Date(at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })) : '') + '</time><span>' + esc(txt) + '</span></div>').join('') : '<div class="muted">Nothing yet.</div>')
      + '</div>' + (fam ? '<div style="margin-top:16px;"><button class="linkbtn" data-act="openFamily" data-id="' + esc(fam.id) + '">Open the family →</button></div>' : '') + '</div></div>',
    foot: ''
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
      + (f ? '<div class="small muted" style="margin-top:12px;">' + (open.length ? 'It pays ' + open.sort(by('period')).map(i => esc(C.periodLabel(i.period)) + ' (' + money(C.invoiceOutstanding(i)) + ')').join(', then ') + '; anything extra is kept as credit.' : 'Nothing is owed, so it is kept as credit for the next invoice.') + '</div>' : ''),
    foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn" data-act="payCommit" ' + (f && Number(m.amount) > 0 ? '' : 'disabled') + '>Record ' + (Number(m.amount) > 0 ? money(m.amount) : 'payment') + '</button>'
  };
};
MODALS.progress = function (m) {
  return { size: 'narrow', title: m.title, sub: m.sub || '', body: '<div class="meter" style="margin:6px 0 12px;"><span style="width:' + (m.total ? (m.done / m.total * 100) : 0) + '%"></span></div><p class="muted">' + m.done + ' of ' + m.total + (m.note ? ' · ' + esc(m.note) : '') + '</p>', foot: '' };
};
MODALS.result = function (m) {
  return { size: 'narrow', title: m.title, body: m.body, foot: '<button class="btn" data-act="closeModal">OK</button>' };
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
  const H = 128 + 96 + lines.length * 54 + 70 + (owe > 0 ? QR + 120 + 4 * 42 + 80 : 120);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (w, s) => w + ' ' + s + 'px "DM Sans","Plus Jakarta Sans",Arial,sans-serif';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#10303a'; ctx.fillRect(0, 0, W, 112);
  const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#2e9ca6'); g.addColorStop(.5, '#56c4d0'); g.addColorStop(1, '#ec008c');
  ctx.fillStyle = g; ctx.fillRect(0, 108, W, 6);
  ctx.fillStyle = '#fff'; ctx.font = font('bold', 26); ctx.fillText('POLYMATH LEARNING CENTRE', P, 52);
  ctx.fillStyle = '#b8e4e8'; ctx.font = font('500', 19); ctx.fillText('Invoice ' + inv.number + ' · ' + C.periodLabel(inv.period), P, 84);
  let y = 158;
  ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 18); ctx.fillText('For ' + (inv.parentName || ''), P, y);
  y += 30;
  ctx.fillStyle = '#10303a'; ctx.font = font('bold', 24);
  ctx.fillText(C.periodLabel(inv.period) + ' tuition fees', P, y);
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
  if (owe > 0) {
    y += 34;
    const box = QR + 40, bx = (W - box) / 2;
    ctx.fillStyle = '#f2f9fa'; roundRect(ctx, bx, y, box, box, 20); ctx.fill();
    ctx.strokeStyle = '#d1eaee'; ctx.lineWidth = 2; roundRect(ctx, bx, y, box, box, 20); ctx.stroke();
    const qr = await qrCanvas(C.buildPayNow(owe, inv.reference, { uen: S.settings.uen, merchant: S.settings.merchant }), QR - 30);
    ctx.drawImage(qr, bx + 20, y + 20, QR, QR);
    y += box + 46;
    [['Pay to', S.settings.merchant], ['UEN', S.settings.uen], ['Amount', money(owe)], ['Reference', inv.reference]].forEach(([k, v]) => {
      ctx.textAlign = 'left'; ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 18); ctx.fillText(k, P, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#10303a'; ctx.font = font('bold', 20); ctx.fillText(v, W - P, y);
      ctx.strokeStyle = '#eef3f4'; ctx.beginPath(); ctx.moveTo(P, y + 14); ctx.lineTo(W - P, y + 14); ctx.stroke();
      y += 42;
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#3d5a61'; ctx.font = font('500', 17);
    ctx.fillText('Save this picture → open your banking app → Scan QR → choose from gallery', W / 2, y + 22);
    ctx.fillStyle = '#6b7f85'; ctx.font = font('500', 15);
    ctx.fillText('The amount and the reference are already filled in. Due ' + C.prettyDate(inv.dueDate) + '.', W / 2, y + 48);
  } else {
    y += 60; ctx.textAlign = 'center'; ctx.fillStyle = '#15803d'; ctx.font = font('bold', 24); ctx.fillText('Paid — thank you!', W / 2, y);
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
  if (!draft.parentName) { toast('Type the parent\'s name first.', 'err'); return; }
  if (draft.email && !C.isEmail(draft.email)) { toast('That email address does not look right.', 'err'); return; }
  draft.students = draft.students.filter(s => s.name);
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
    if (!confirm(f.parentName + ' has ' + C.plural(invs.length, 'invoice') + '. A family with invoices is kept for your records and marked Inactive instead. Mark inactive?')) return;
    await famRef(f.id).update({ status: 'inactive', updatedAt: ts() });
    toast('Marked inactive', 'ok'); closeModal(); return;
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
  const png = await qrPngBase64(C.buildPayNow(owe, inv.reference, { uen: S.settings.uen, merchant: S.settings.merchant }));
  const level = (inv.reminders || []).length + 1;
  const msg = kind === 'reminder' ? C.reminderEmail(inv, S.settings, { payUrl, qrCid: 'paynowqr', level }) : C.invoiceEmail(inv, S.settings, { payUrl, qrCid: 'paynowqr' });
  msg.attachments = [C.qrAttachment(png, inv.reference, 'paynowqr')];
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
      after.push({ period: inv.period, amount: a.amount, left: C.invoiceOutstanding(next) });
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
  async saveInvoiceQr() { const inv = IX.invById.get(S.modal.id); const owe = C.invoiceOutstanding(inv); savePng(await qrPngBase64(C.buildPayNow(owe, inv.reference, { uen: S.settings.uen, merchant: S.settings.merchant })), C.qrFileName(inv.reference)); },
  async saveInvoiceImage() { const inv = IX.invById.get(S.modal.id); savePng(await invoiceImage(inv), 'Polymath-' + inv.number + '.png'); },
  editLines() { const inv = IX.invById.get(S.modal.id); S.modal.edit = clone(inv.lines || []); renderModal(); },
  cancelLines() { S.modal.edit = null; renderModal(); },
  addLine() { S.modal.edit.push({ studentId: '', studentName: '', desc: 'Materials', detail: '', amount: 0, kind: 'extra' }); renderModal(); },
  delLine(el) { S.modal.edit.splice(+el.dataset.i, 1); renderModal(); },
  async saveLines() {
    if (!requireProtected()) return;
    const inv = IX.invById.get(S.modal.id);
    const next = C.recomputeInvoice(Object.assign({}, inv, { lines: S.modal.edit.filter(l => l.desc || Number(l.amount)) }));
    try {
      await invRef(inv.id).update({ lines: next.lines, total: next.total, subtotal: next.subtotal, issues: [], updatedAt: ts() });
      if (inv.linkToken) await linkRef(inv.linkToken).set(Object.assign(C.publicInvoiceDoc(next, S.settings), { updatedAt: ts() }));
      S.modal.edit = null; toast('Invoice updated', 'ok');
    } catch (e) { fail('Could not save', e); }
  },
  async voidInvoice(el) {
    const inv = IX.invById.get(el.dataset.id);
    if (!inv || !requireProtected() || !confirm('Cancel ' + inv.number + ' for ' + inv.parentName + '?' + (inv.creditUsed > 0 ? ' The ' + money(inv.creditUsed) + ' credit it used goes back to the family.' : ''))) return;
    try {
      await db.runTransaction(async t => {
        const s = await t.get(invRef(inv.id)), f = await t.get(famRef(inv.familyId));
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
    downloadText(C.toCsv([['Number', 'Parent', 'Students', 'Month', 'Total', 'Paid', 'Owes', 'Status', 'Due', 'Reference'],
      ...periodInvoices(p).map(i => [i.number, i.parentName, (i.students || []).join('; '), C.periodLabel(i.period), i.total, i.paid || 0, C.invoiceOutstanding(i), stateOf(i).label, i.dueDate, i.reference])]), 'polymath-invoices-' + p + '.csv', 'text/csv');
  }
};
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
  stuSearch(el) { S.ui.stuSearch = el.value; render(); },
  invSearch(el) { S.ui.invSearch = el.value; render(); },
  fam(el) { S.modal.draft[el.dataset.k] = el.value; },
  stu(el) { S.modal.draft.students[+el.dataset.s][el.dataset.k] = el.value; },
  cls(el) { S.modal.draft.students[+el.dataset.s].classes[+el.dataset.c][el.dataset.k] = el.value; },
  disc(el) { const d = S.modal.draft.discount || (S.modal.draft.discount = { kind: '', value: '', label: 'Sibling discount' }); d[el.dataset.k] = el.value; },
  qrAmount(el) { S.modal.amount = el.value; renderModal(); },
  importPaste(el) { S.modal.paste = el.value; const b = document.querySelector('[data-act="importPreview"]'); if (b) b.disabled = !el.value.trim(); },
  line(el) { const l = S.modal.edit[+el.dataset.i]; l[el.dataset.k] = el.dataset.k === 'amount' ? Number(el.value) : el.value; },
  payM(el) { S.modal[el.dataset.k] = el.value; if (el.dataset.k === 'amount') { const b = document.querySelector('[data-act="payCommit"]'); if (b) { b.disabled = !(S.modal.familyId && Number(el.value) > 0); b.textContent = 'Record ' + (Number(el.value) > 0 ? money(el.value) : 'payment'); } } },
  setting(el) { const d = S.settingsDraft || (S.settingsDraft = clone(S.settings)); d[el.dataset.k] = el.value; }
};
const CHG = {
  stuDay(el) { S.ui.stu.day = el.value; render(); },
  fam(el) { S.modal.draft[el.dataset.k] = el.value; renderModal(); },
  stu(el) { S.modal.draft.students[+el.dataset.s][el.dataset.k] = el.value; renderModal(); },
  cls(el) { S.modal.draft.students[+el.dataset.s].classes[+el.dataset.c][el.dataset.k] = el.value; renderModal(); },
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
  if (e.target === $('modal')) { closeModal(); return; }
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
  if (e.key === 'Escape') { if (S.modal) closeModal(); else if (S.drawer) { S.drawer = null; renderDrawer(); } return; }
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
