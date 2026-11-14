/* =====================================================================
   POLYMATH MIND MAP — the app (v1.2.0, November 2026)
   ---------------------------------------------------------------------
   polymathlc.com.sg/mindmap. See index.html for the overview.

   The parts, in the order they appear below:
     1. state, small helpers, toasts and modals
     2. sign-in and the access gate (who may use it, who is staff, which
        Science levels a student may pick questions from)
     3. the canvas: pan / zoom, drawing the nodes and branches, the minimap
     4. editing: select, drag (drop on a topic to move a branch), text
        editing, keyboard shortcuts, copy / paste, undo / redo
     5. the inspector (the details panel on the right)
     6. AI: voice building, AI ideas, a whole map from a topic, pictures,
        building and changing learning apps, questions by voice
     7. code windows: the sandboxed iframes, their console and the big editor
     8. saving, opening, sharing, importing and printing
   ===================================================================== */
import {
  auth, db, fb, watchUser, signInGoogle, signInUsername, signOut, friendlyAuthError, isStaffEmail, isPublisherEmail, isPublisherAddress,
  aiText, aiImage, transcribe, uploadDataUrl
} from './mindmap-services.js';
import {
  MINDMAP_VERSION, LIMITS, NODE_COLORS, SHAPES, colorOf, makeId, escapeHtml, htmlToText,
  newMap, normalizeMap, normalizeNode, nodeById, childrenOf, descendantsOf, depthOf, isHidden, sideOf, colorForNewChild,
  removeNode, reparent, isFree, detachNode, layoutMap, spotForNewChild, boundsOf, fitView, branchPath, linkPath, History,
  serializeMap, mapBytes, mapToOutline, nodeLabel, parseAiJson, extractHtmlDocument, buildSandboxDoc, SANDBOX_FLAGS,
  allowedBankLevels, BANK_LEVELS, voiceSystemPrompt, voiceUserPrompt, expandPrompt, mapFromTopicPrompt,
  APP_SYSTEM, appBuildPrompt, appUpdatePrompt, imagePrompt, applyOps, buildFromOutline, importOutlineText
} from './mindmap-core.mjs?v=1.2.0';
import {
  renderQuestionHtml, questionHasAnswer, mountPicker, loadBank, findQuestions, snapshotOf, bankTopics, pickableQuestions, bankState
} from './mindmap-questions.js?v=1.2.0';

/* =====================================================================
   1. STATE AND HELPERS
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const S = {
  user: null,
  staff: false,
  publisher: false,           // v1.2.0: may publish maps to every student (Mr Chung's Maps)
  published: false,           // the open map is published
  publishedAtMs: 0,
  levels: [],                 // Science levels the question picker may show
  accessPhase: '',
  map: null,
  selected: '',
  selectedLink: '',
  editing: '',
  readOnly: false,
  connectFrom: '',
  connectMode: false,
  dirty: false,
  saving: false,
  saveTimer: 0,
  savedAt: 0,
  saveError: '',
  history: new History(),
  jobs: new Map(),            // nodeId → { kind, status: 'working' | 'error', message, job }
  consoles: new Map(),        // nodeId → [{ kind, text }]
  codeKeys: new Map(),        // nodeId → the source last loaded into its iframe
  inspectorFor: null,         // what the inspector is drawing (to know when to redraw)
  speak: (() => { try { return localStorage.getItem('mindmap-speak') !== 'off'; } catch (e) { return true; } })(),
  clipboard: null,
  started: false
};
const els = new Map();        // nodeId → { el, hash }
const ui = {};

function toast(message, kind = '', { action, onAction, ms = 3800 } = {}) {
  const box = document.createElement('div');
  box.className = 'toast' + (kind ? ' ' + kind : '');
  box.innerHTML = '<span></span>';
  box.firstChild.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action;
    b.addEventListener('click', () => { box.remove(); onAction && onAction(); });
    box.appendChild(b);
  }
  $('#toasts').appendChild(box);
  setTimeout(() => { box.style.transition = 'opacity 0.3s'; box.style.opacity = '0'; setTimeout(() => box.remove(), 320); }, ms);
}

/** A modal. Returns { el, body, foot, close }. */
function openModal({ title, size = '', body = '', foot = '', onClose } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="btn btn-small btn-ghost btn-icon" type="button" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>${foot !== null ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  $('#modalRoot').appendChild(back);
  const modal = { el: back, body: $('.modal-body', back), foot: $('.modal-foot', back), close: () => closeModal() };
  modal.onClose = onClose;
  back.addEventListener('pointerdown', e => { if (e.target === back) back._downOnBack = true; });
  back.addEventListener('click', e => { if (e.target === back && back._downOnBack) closeModal(); back._downOnBack = false; });
  $('[data-close]', back).addEventListener('click', () => closeModal());
  ui.modal = modal;
  setTimeout(() => { const f = $('input, textarea, select', modal.body); if (f && !matchMedia('(pointer: coarse)').matches) f.focus(); }, 60);
  return modal;
}
function closeModal() {
  const m = ui.modal;
  if (!m) return;
  ui.modal = null;
  m.el.remove();
  if (m.onClose) try { m.onClose(); } catch (e) {}
}
function confirmBox(title, message, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal({ title, body: `<p>${escapeHtml(message)}</p>`,
      foot: `<button class="btn" type="button" data-no>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-yes>${escapeHtml(okLabel)}</button>`,
      onClose: () => { if (!answered) resolve(false); } });
    $('[data-no]', m.foot).addEventListener('click', () => { answered = true; closeModal(); resolve(false); });
    $('[data-yes]', m.foot).addEventListener('click', () => { answered = true; closeModal(); resolve(true); });
  });
}
function busy(btn, on) { if (!btn) return; btn.classList.toggle('is-busy', !!on); btn.disabled = !!on; }
function flashDone(btn, label = '✓ Done') {
  if (!btn) return;
  const old = btn.innerHTML;
  btn.classList.add('is-done'); btn.innerHTML = label;
  setTimeout(() => { btn.classList.remove('is-done'); btn.innerHTML = old; }, 1500);
}
function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function safeName(s) { return String(s || 'mind-map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'mind-map'; }
function local(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch (e) { return null; }
  return null;
}
function timeLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* =====================================================================
   2. SIGN-IN AND ACCESS
   ===================================================================== */
function showSignin(show) {
  $('#signinScreen').hidden = !show;
  $('#app').hidden = show;
}
$('#googleSignIn').addEventListener('click', async () => {
  const btn = $('#googleSignIn');
  $('#signinError').textContent = '';
  busy(btn, true);
  try { await signInGoogle(); }
  catch (e) { $('#signinError').textContent = friendlyAuthError(e); }
  finally { busy(btn, false); }
});
$('#usernameForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $('#usernameSubmit');
  $('#signinError').textContent = '';
  busy(btn, true);
  try { await signInUsername(form.loginId.value, form.password.value); }
  catch (err) { $('#signinError').textContent = friendlyAuthError(err); }
  finally { busy(btn, false); }
});

function accessApi() { return window.PolymathAccess && window.PolymathAccess.version ? window.PolymathAccess : null; }
function readAccess() {
  const api = accessApi();
  const st = api ? api.state : null;
  S.accessPhase = st ? st.phase : '';
  S.staff = isStaffEmail(S.user) || !!(st && (st.phase === 'staff' || st.isAdmin));
  S.publisher = isPublisherEmail(S.user);
  S.levels = allowedBankLevels({ staff: S.staff, pairs: st && st.pairs || [] });
  $('#versionBadge').hidden = !S.staff;
}
function watchAccess() {
  const tryHook = () => {
    const api = accessApi();
    if (!api) return false;
    api.onChange(() => { readAccess(); if (S.started) refreshInspector(true); });
    return true;
  };
  if (!tryHook()) {
    let n = 0;
    const t = setInterval(() => { if (tryHook() || ++n > 120) clearInterval(t); }, 250);
  }
}
watchAccess();

watchUser(async user => {
  S.user = user || null;
  if (!user || user.isAnonymous) {
    showSignin(true);
    S.started = false;
    return;
  }
  showSignin(false);
  readAccess();
  const name = user.displayName || (user.email || '').split('@')[0] || 'You';
  $('#userName').textContent = name;
  const av = $('#userAvatar');
  av.innerHTML = '';
  if (user.photoURL) { const img = document.createElement('img'); img.src = user.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer'; av.appendChild(img); }
  else av.textContent = name.slice(0, 1).toUpperCase();
  if (!S.started) {
    S.started = true;
    await waitForAccess();
    if (!S.user || S.user.uid !== user.uid) { S.started = false; return; }
    await startApp();
    announcePublished();
  }
});

/** v1.2.0: tell a student when Mr Chung has published maps they have not seen yet. */
async function announcePublished() {
  if (!S.user || S.publisher) return;
  try {
    const list = await listPublishedMaps();
    if (!list.length) return;
    const key = 'polymath-mindmap:seen-published:' + S.user.uid;
    const seen = new Set(String(local(key) || '').split(',').filter(Boolean));
    const fresh = list.filter(x => !seen.has(x.id));
    local(key, list.map(x => x.id).join(','));
    if (!fresh.length) return;
    toast(fresh.length === 1 ? '📌 New in Mr Chung\'s Maps: “' + fresh[0].title.slice(0, 50) + '”' : '📌 ' + fresh.length + ' new maps in Mr Chung\'s Maps', '',
      { action: 'Show me', onAction: openMapsModal, ms: 9000 });
  } catch (e) { console.warn('[mindmap] published maps', e); }
}

/** Wait until the access gate has let this account in (it shows its own screens meanwhile). */
function waitForAccess() {
  const OPEN = ['approved', 'staff', 'inactive', 'guest'];
  return new Promise(resolve => {
    const t0 = Date.now();
    const check = () => {
      readAccess();
      const api = accessApi();
      if (S.staff || (api && OPEN.includes(api.state.phase))) return resolve();
      // No gate script at all (blocked or offline): carry on; the gate is a front door, not the lock.
      if (!api && Date.now() - t0 > 8000) return resolve();
      setTimeout(check, 400);
    };
    check();
  });
}

/* =====================================================================
   3. THE CANVAS
   ===================================================================== */
ui.viewport = $('#viewport');
ui.world = $('#world');
ui.nodes = $('#nodes');
ui.edges = $('#edges');
ui.inspector = $('#inspector');
ui.minimap = $('#minimap');

function view() { return S.map.view; }
function applyView() {
  const v = view();
  ui.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  $('#zoomLabel').textContent = Math.round(v.zoom * 100) + '%';
  scheduleMinimap();
}
function screenToWorld(sx, sy) {
  const r = ui.viewport.getBoundingClientRect();
  const v = view();
  return { x: (sx - r.left - v.x) / v.zoom, y: (sy - r.top - v.y) / v.zoom };
}
function zoomAt(factor, sx, sy) {
  const r = ui.viewport.getBoundingClientRect();
  const v = view();
  const px = sx == null ? r.width / 2 : sx - r.left;
  const py = sy == null ? r.height / 2 : sy - r.top;
  const nz = clamp(v.zoom * factor, 0.15, 3);
  v.x = px - (px - v.x) * (nz / v.zoom);
  v.y = py - (py - v.y) * (nz / v.zoom);
  v.zoom = nz;
  applyView();
  softDirty();
}
function fitAll(animate = true) {
  const r = ui.viewport.getBoundingClientRect();
  const target = fitView(boundsOf(S.map), r.width, r.height - 110, 70);
  target.y += 0; // leave room for the voice dock at the bottom
  animateView(target, animate ? 320 : 0);
}
/** Bring a group of items into view, without zooming in past 100 %. */
function fitTo(ids, animate = true) {
  const r = ui.viewport.getBoundingClientRect();
  const target = fitView(boundsOf(S.map, ids), r.width, r.height - 110, 80, 1);
  if (target.zoom > view().zoom && view().zoom >= 0.6) {
    // Already readable: only pan, so the cards are centred and nothing jumps in size.
    const b = boundsOf(S.map, ids);
    const v = view();
    animateView({ zoom: v.zoom, x: r.width / 2 - ((b.minX + b.maxX) / 2) * v.zoom, y: (r.height - 110) / 2 - ((b.minY + b.maxY) / 2) * v.zoom }, animate ? 300 : 0);
    return;
  }
  animateView(target, animate ? 320 : 0);
}
function centerOn(id, animate = true) {
  const n = nodeById(S.map, id);
  if (!n) return;
  const r = ui.viewport.getBoundingClientRect();
  const v = view();
  const sx = n.x * v.zoom + v.x, sy = n.y * v.zoom + v.y;
  const margin = 90;
  if (sx > margin && sx < r.width - margin && sy > margin && sy < r.height - 140) return;
  animateView({ zoom: v.zoom, x: r.width / 2 - n.x * v.zoom, y: (r.height - 110) / 2 - n.y * v.zoom }, animate ? 260 : 0);
}
let viewAnim = 0;
function animateView(target, ms) {
  cancelAnimationFrame(viewAnim);
  const v = view();
  if (!ms) { Object.assign(v, target); applyView(); return; }
  const from = { ...v };
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    v.x = from.x + (target.x - from.x) * e;
    v.y = from.y + (target.y - from.y) * e;
    v.zoom = from.zoom + (target.zoom - from.zoom) * e;
    applyView();
    if (t < 1) viewAnim = requestAnimationFrame(step); else softDirty();
  };
  viewAnim = requestAnimationFrame(step);
}

/* ---------- drawing the nodes ---------- */
function nodeHash(n) {
  const job = S.jobs.get(n.id);
  const kids = childrenOf(S.map, n.id).length;
  const base = [n.type, n.text, n.color, n.shape, n.collapsed, kids, n.id === S.map.rootId, job ? job.status + job.message : '', S.readOnly, S.staff];
  if (n.type === 'note') base.push(n.note);
  if (n.type === 'image') base.push(n.image.url, n.image.width, n.image.alt);
  if (n.type === 'code') base.push(n.code.title, n.code.width, n.code.height, !!(n.code.html || n.code.css || n.code.js));
  if (n.type === 'question') base.push(n.question.qid, n.question.width, n.question.blocks.length, n.question.folded);
  base.push(isFree(S.map, n));
  if (n.type !== 'code') base.push(sideOf(S.map, n.id));
  return JSON.stringify(base);
}
function nodeStyle(el, n) {
  const c = colorOf(n.color);
  el.style.setProperty('--node-fill', c.fill);
  el.style.setProperty('--node-ink', c.ink);
  el.style.setProperty('--node-line', c.line);
}
function buildNodeEl(n) {
  const el = document.createElement('div');
  el.className = 'mm-node';
  el.dataset.id = n.id;
  el.tabIndex = -1;
  return el;
}
function fillNodeEl(el, n) {
  const isRoot = n.id === S.map.rootId;
  el.className = 'mm-node type-' + n.type + ' shape-' + n.shape + (isRoot ? ' is-root' : '') + (isFree(S.map, n) ? ' is-free' : '') +
    (n.type === 'question' && n.question.folded ? ' is-folded' : '') + (el.classList.contains('is-new') ? ' is-new' : '');
  nodeStyle(el, n);
  const side = isRoot ? 'right' : sideOf(S.map, n.id);
  const kids = childrenOf(S.map, n.id).length;
  const job = S.jobs.get(n.id);
  const addBtn = !S.readOnly && n.type !== 'code' ? `<button class="add-child ${side}" type="button" data-act="add-child" aria-label="Add a sub-topic" title="Add a sub-topic">+</button>` : '';
  const fold = kids && !isRoot ? `<button class="fold ${side}" type="button" data-act="fold" aria-label="${n.collapsed ? 'Show' : 'Hide'} ${kids} sub-topics" title="${n.collapsed ? 'Show' : 'Hide'} sub-topics">${n.collapsed ? kids : '−'}</button>` : '';
  switch (n.type) {
    case 'topic':
      el.innerHTML = `<div class="mm-text">${escapeHtml(n.text || (isRoot ? 'Central idea' : 'New topic'))}</div>${addBtn}${fold}`;
      break;
    case 'note':
      el.innerHTML = `${n.text ? `<div class="note-title mm-text">${escapeHtml(n.text)}</div>` : ''}<div class="note-body">${escapeHtml(n.note || 'Write your note in the panel on the right.')}</div>${addBtn}${fold}`;
      break;
    case 'image': {
      const w = n.image.width || 260;
      let pic;
      if (job && job.status === 'working') pic = `<div class="pic-loading" style="width:${w}px;height:${Math.round(w * 0.75)}px"><span>🎨</span>${escapeHtml(job.message || 'Drawing your picture…')}</div>`;
      else if (job && job.status === 'error') pic = `<div class="pic-error" style="width:${w}px;min-height:${Math.round(w * 0.6)}px"><span>${escapeHtml(job.message || 'The picture could not be drawn.')}</span><button class="btn btn-small" type="button" data-act="retry-job">Try again</button></div>`;
      else if (n.image.url) pic = `<img class="pic" src="${escapeHtml(n.image.url)}" alt="${escapeHtml(n.image.alt || n.text || 'Picture')}" style="width:${w}px" draggable="false">`;
      else pic = `<div class="pic-error" style="width:${w}px;min-height:${Math.round(w * 0.6)}px;background:var(--bg-tertiary);color:var(--text-secondary)"><span>No picture yet</span>${S.readOnly ? '' : '<button class="btn btn-small" type="button" data-act="draw-image">🎨 Draw it</button>'}</div>`;
      el.innerHTML = `${pic}${n.text ? `<div class="pic-caption mm-text">${escapeHtml(n.text)}</div>` : ''}${addBtn}${fold}`;
      break;
    }
    case 'code': {
      // Built once; later updates only touch the title, the size and the console, so the app keeps running.
      if (!el.querySelector('.code-frame')) {
        el.innerHTML = `<div class="code-bar" data-drag-handle>
            <span class="code-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="code-title"></span>
            <button type="button" data-act="code-run" title="Run again">▶</button>
            <button type="button" data-act="code-edit" title="Open the code editor">&lt;/&gt;</button>
            <button type="button" data-act="code-big" title="Open big">⤢</button>
          </div>
          <div class="code-frame-wrap"><iframe class="code-frame" sandbox="${SANDBOX_FLAGS}" referrerpolicy="no-referrer" loading="lazy" title="Learning app"></iframe><div class="code-shield"></div><div class="code-empty" hidden></div></div>
          <div class="code-console" hidden></div>
          ${S.readOnly ? '' : '<div class="resize-grip" data-act="resize" aria-hidden="true"></div>'}${fold}`;
      }
      $('.code-title', el).textContent = '💻 ' + (n.code.title || 'Learning app');
      const wrap = $('.code-frame-wrap', el);
      wrap.style.width = n.code.width + 'px';
      wrap.style.height = n.code.height + 'px';
      const empty = $('.code-empty', el);
      const has = !!(n.code.html || n.code.css || n.code.js);
      if (job && job.status === 'working') { empty.hidden = false; empty.className = 'code-empty pic-loading'; empty.textContent = job.message || 'Building your app…'; }
      else if (job && job.status === 'error') { empty.hidden = false; empty.className = 'code-empty pic-error'; empty.innerHTML = escapeHtml(job.message || 'The app could not be built.') + ' <button class="btn btn-small" type="button" data-act="retry-job">Try again</button>'; }
      else if (!has) { empty.hidden = false; empty.className = 'code-empty'; empty.innerHTML = S.readOnly ? 'This window is empty.' : 'Paste code with <b>&lt;/&gt;</b>, or describe an app in the panel and the AI builds it.'; }
      else empty.hidden = true;
      loadCodeFrame(n);
      drawConsole(n.id);
      break;
    }
    case 'question': {
      const q = n.question;
      const reveal = el.dataset.reveal === '1';
      const picked = el.dataset.picked || '';
      // v1.1.0: the ▾ / ▸ button folds the card down to its headline and opens it again (anyone may, even on a shared map).
      const foldBtn = `<button class="q-fold" type="button" data-act="q-fold" aria-expanded="${q.folded ? 'false' : 'true'}" title="${q.folded ? 'Open the question' : 'Fold the question away'}" aria-label="${q.folded ? 'Open the question' : 'Fold the question away'}">${q.folded ? '▸' : '▾'}</button>`;
      const freeTag = isFree(S.map, n) ? '<span class="q-badge q-free" title="Not attached to any topic">On its own</span>' : '';
      const head = `<div class="q-head" data-drag-handle>${foldBtn}❓ <span class="q-topic">${escapeHtml(q.topic || 'Question')}</span>${q.level ? `<span class="q-badge">${escapeHtml(q.level)}</span>` : ''}${q.marks ? `<span class="q-badge">${escapeHtml(q.marks)}m</span>` : ''}${freeTag}</div>`;
      if (q.folded) {
        el.innerHTML = `${head}<button class="q-mini" type="button" data-act="q-fold" style="width:${Math.min(q.width, 300)}px" title="Open the question">${escapeHtml(questionHeadlineOf(q))}</button>${addBtn}${fold}`;
      } else {
        el.innerHTML = `${head}
        <div class="q-body" style="width:${q.width}px">${renderQuestionHtml(q, { showAnswers: S.staff && reveal, interactive: true, picked, reveal: reveal })}</div>
        <div class="q-foot">${questionHasAnswer(q) && (S.staff || picked) ? `<button class="btn btn-small" type="button" data-act="q-reveal">${reveal ? 'Hide answer' : 'Show answer'}</button>` : ''}${picked ? '<button class="btn btn-small btn-ghost" type="button" data-act="q-reset">Try again</button>' : ''}<button class="btn btn-small btn-ghost" type="button" data-act="q-fold">▴ Fold</button></div>${addBtn}${fold}`;
      }
      break;
    }
  }
}

/** One line that names a folded question: its title, else the start of its first text block. */
function questionHeadlineOf(q) {
  let text = String(q.title || '').trim();
  if (!text) {
    for (const b of q.blocks || []) {
      const raw = b && (b.text || b.html || b.content || '');
      const plain = htmlToText(String(raw || '')).replace(/\s+/g, ' ').trim();
      if (plain) { text = plain; break; }
    }
  }
  if (!text) text = 'Question';
  return text.length > 110 ? text.slice(0, 107).trimEnd() + '…' : text;
}

/**
 * Fold or open question cards. The card keeps its top edge and the edge that faces its topic,
 * so opening one grows away from the branch instead of jumping. On a read-only (shared) map
 * the change is only for this viewer and is not saved.
 */
function setQuestionsFolded(ids, folded) {
  const list = ids.map(id => nodeById(S.map, id)).filter(n => n && n.type === 'question' && n.question.folded !== folded);
  if (!list.length) return 0;
  const before = new Map(list.map(n => [n.id, { left: n.x - (n.w || 0) / 2, right: n.x + (n.w || 0) / 2, top: n.y - (n.h || 0) / 2 }]));
  const apply = () => { for (const n of list) n.question.folded = folded; };
  if (S.readOnly) { apply(); render(); }
  else if (!commit(apply, { keepInspector: true })) return 0;
  // render() has measured the new sizes: move each card so its anchor edges stay put.
  for (const n of list) {
    const b = before.get(n.id);
    if (!b || !n.w || !n.h) continue;
    const growsLeft = !isFree(S.map, n) && n.parentId && sideOf(S.map, n.id) === 'left';
    n.x = Math.round(growsLeft ? b.right - n.w / 2 : b.left + n.w / 2);
    n.y = Math.round(b.top + n.h / 2);
    placeNodeEl(n);
  }
  renderEdges();
  drawMinimap();
  if (S.readOnly) return list.length;
  S.inspectorFor = null;
  refreshInspector(true);
  return list.length;
}
function toggleQuestionFold(id) {
  const n = nodeById(S.map, id);
  if (!n || n.type !== 'question') return;
  setQuestionsFolded([id], !n.question.folded);
}
function foldAllQuestions(folded) {
  const ids = S.map.nodes.filter(n => n.type === 'question').map(n => n.id);
  if (!ids.length) { toast('There are no questions on this map yet.'); return; }
  const changed = setQuestionsFolded(ids, folded);
  toast(changed ? (folded ? 'Folded ' : 'Opened ') + changed + ' question' + (changed === 1 ? '' : 's') + '.' : (folded ? 'All questions are already folded.' : 'All questions are already open.'));
}
/** Take a question (or anything) off its branch so it stands on its own, where it is now. */
function detachSelected(id) {
  const n = nodeById(S.map, id);
  if (!n || n.id === S.map.rootId) return;
  if (!n.parentId) { toast('It is already on its own.'); return; }
  const from = nodeById(S.map, n.parentId);
  const ok = commit(() => {
    if (!detachNode(S.map, n.id)) return false;
    // Nudge it a little away from where the branch ended, so it visibly stands apart.
    n.y += 30;
  }, { keepInspector: true });
  if (ok) toast(`“${nodeLabel(n).slice(0, 40)}” now stands on its own. Drag it onto a topic to attach it again.`, '', { action: 'Undo', onAction: undo });
  return ok && from;
}

function renderNodes() {
  const map = S.map;
  const live = new Set();
  for (const n of map.nodes) {
    if (isHidden(map, n.id)) continue;
    live.add(n.id);
    let rec = els.get(n.id);
    if (!rec) {
      rec = { el: buildNodeEl(n), hash: '' };
      els.set(n.id, rec);
      ui.nodes.appendChild(rec.el);
      if (S.started && S.map._fresh !== true) rec.el.classList.add('is-new');
      setTimeout(() => rec.el.classList.remove('is-new'), 600);
    }
    const hash = nodeHash(n);
    if (rec.hash !== hash && S.editing !== n.id) { fillNodeEl(rec.el, n); rec.hash = hash; }
    rec.el.classList.toggle('is-selected', S.selected === n.id);
    // Measure (unscaled) and place by the centre.
    const w = rec.el.offsetWidth, h = rec.el.offsetHeight;
    if (w && h) { n.w = w; n.h = h; }
    rec.el.style.left = Math.round(n.x - (n.w || w) / 2) + 'px';
    rec.el.style.top = Math.round(n.y - (n.h || h) / 2) + 'px';
  }
  for (const [id, rec] of els) {
    if (!live.has(id)) { rec.el.remove(); els.delete(id); S.codeKeys.delete(id); }
  }
  S.map._fresh = false;
}
function placeNodeEl(n) {
  const rec = els.get(n.id);
  if (!rec) return;
  rec.el.style.left = Math.round(n.x - n.w / 2) + 'px';
  rec.el.style.top = Math.round(n.y - n.h / 2) + 'px';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function renderEdges(ghost) {
  const map = S.map;
  const parts = ['<defs><marker id="mmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9E9E9E"/></marker><marker id="mmArrowOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#FFA726"/></marker></defs>'];
  for (const n of map.nodes) {
    if (!n.parentId || isHidden(map, n.id)) continue;
    const p = nodeById(map, n.parentId);
    if (!p) continue;
    const depth = depthOf(map, n.id);
    // The branch takes the colour of its first-level ancestor, so each branch reads as one family.
    let top = n;
    while (top.parentId && top.parentId !== map.rootId) { const up = nodeById(map, top.parentId); if (!up) break; top = up; }
    const stroke = top.color === 'white' ? '#BDBDBD' : colorOf(top.color).line;
    const width = depth <= 1 ? 4 : depth === 2 ? 3 : 2;
    parts.push(`<path class="branch" d="${branchPath(p, n)}" stroke="${stroke}" stroke-width="${width}"/>`);
  }
  for (const l of map.links) {
    const a = nodeById(map, l.from), b = nodeById(map, l.to);
    if (!a || !b || isHidden(map, a.id) || isHidden(map, b.id)) continue;
    const path = linkPath(a, b);
    const on = S.selectedLink === l.id;
    parts.push(`<path class="link${on ? ' is-selected' : ''}" d="${path.d}" marker-end="url(#${on ? 'mmArrowOn' : 'mmArrow'})"/>`);
    parts.push(`<path class="link-hit" data-link="${l.id}" d="${path.d}"/>`);
    if (l.label) parts.push(`<text class="link-label" data-link="${l.id}" x="${path.mid.x}" y="${path.mid.y}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(l.label)}</text>`);
  }
  if (ghost) parts.push(`<path class="ghost" d="M ${ghost.x1} ${ghost.y1} L ${ghost.x2} ${ghost.y2}"/>`);
  ui.edges.innerHTML = parts.join('');
}

function render() {
  if (!S.map) return;
  renderNodes();
  renderEdges();
  applyView();
  updateTools();
  refreshInspector();
}

/* ---------- the minimap ---------- */
let miniTimer = 0;
function scheduleMinimap() { if (!miniTimer) miniTimer = requestAnimationFrame(() => { miniTimer = 0; drawMinimap(); }); }
function drawMinimap() {
  const c = ui.minimap;
  if (!c || !S.map || c.offsetParent === null) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const b = boundsOf(S.map);
  const r = ui.viewport.getBoundingClientRect();
  const v = view();
  const vis = { minX: -v.x / v.zoom, minY: -v.y / v.zoom, maxX: (r.width - v.x) / v.zoom, maxY: (r.height - v.y) / v.zoom };
  const all = { minX: Math.min(b.minX, vis.minX), minY: Math.min(b.minY, vis.minY), maxX: Math.max(b.maxX, vis.maxX), maxY: Math.max(b.maxY, vis.maxY) };
  const pad = 14;
  const s = Math.min((W - pad * 2) / (all.maxX - all.minX || 1), (H - pad * 2) / (all.maxY - all.minY || 1));
  const ox = pad - all.minX * s + ((W - pad * 2) - (all.maxX - all.minX) * s) / 2;
  const oy = pad - all.minY * s + ((H - pad * 2) - (all.maxY - all.minY) * s) / 2;
  ui.miniXform = { s, ox, oy };
  for (const n of S.map.nodes) {
    if (isHidden(S.map, n.id)) continue;
    const c2 = colorOf(n.color);
    ctx.fillStyle = n.color === 'white' ? '#E0E0E0' : c2.line;
    const w = Math.max(3, (n.w || 120) * s), h = Math.max(2, (n.h || 40) * s);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect((n.x * s + ox) - w / 2, (n.y * s + oy) - h / 2, w, h, 3); else ctx.rect((n.x * s + ox) - w / 2, (n.y * s + oy) - h / 2, w, h);
    ctx.fill();
  }
  ctx.strokeStyle = '#FFA726';
  ctx.lineWidth = 3;
  ctx.strokeRect(vis.minX * s + ox, vis.minY * s + oy, (vis.maxX - vis.minX) * s, (vis.maxY - vis.minY) * s);
}
ui.minimap.addEventListener('click', e => {
  if (!ui.miniXform) return;
  const rect = ui.minimap.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (ui.minimap.width / rect.width);
  const my = (e.clientY - rect.top) * (ui.minimap.height / rect.height);
  const { s, ox, oy } = ui.miniXform;
  const wx = (mx - ox) / s, wy = (my - oy) / s;
  const r = ui.viewport.getBoundingClientRect();
  const v = view();
  animateView({ zoom: v.zoom, x: r.width / 2 - wx * v.zoom, y: r.height / 2 - wy * v.zoom }, 260);
});

/* =====================================================================
   4. EDITING
   ===================================================================== */
/** Every change goes through here: snapshot for undo, change, redraw, save later. */
function commit(fn, { tidy = false, select, keepInspector = false } = {}) {
  if (S.readOnly) { toast('This map is read-only. Make your own copy to change it.'); return false; }
  const before = JSON.stringify(serializeMap(S.map));
  const out = fn();
  if (out === false) return false;
  S.history.push(before);
  if (select !== undefined) setSelected(select, { quiet: true });
  if (tidy) tidyUp(false);
  markDirty();
  if (!keepInspector) S.inspectorFor = null;
  render();
  return true;
}
function markDirty() {
  S.dirty = true;
  S.map.updatedAt = new Date().toISOString();
  setStatus('Saving soon…');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveNow, 1400);
  backupLocal();
}
/** A view change (pan / zoom) is saved too, but quietly and without an undo step. */
let softTimer = 0;
function softDirty() {
  if (S.readOnly || !S.map) return;
  clearTimeout(softTimer);
  softTimer = setTimeout(() => { S.dirty = true; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 2500); }, 600);
}
function setSelected(id, { quiet = false, link = '' } = {}) {
  if (S.editing && S.editing !== id) finishEditing(true);
  S.selected = id || '';
  S.selectedLink = link || '';
  S.inspectorFor = null;
  if (!quiet) render();
}
function selectedNode() { return S.selected ? nodeById(S.map, S.selected) : null; }

function tidyUp(animate = true) {
  const pos = layoutMap(S.map, n => ({ w: n.w, h: n.h }));
  const from = new Map(S.map.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  for (const n of S.map.nodes) { const p = pos.get(n.id); if (p) { n.x = Math.round(p.x); n.y = Math.round(p.y); } }
  if (animate) {
    // Glide the boxes to their new places.
    const t0 = performance.now();
    const ms = 360;
    const targets = S.map.nodes.map(n => ({ n, a: from.get(n.id), b: { x: n.x, y: n.y } }));
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      for (const { n, a, b } of targets) { if (!a) continue; n.x = a.x + (b.x - a.x) * e; n.y = a.y + (b.y - a.y) * e; placeNodeEl(n); }
      renderEdges();
      if (t < 1) requestAnimationFrame(step);
      else { for (const { n, b } of targets) { n.x = b.x; n.y = b.y; } render(); }
    };
    requestAnimationFrame(step);
  }
}

/* ---------- adding things ---------- */
function defaultSize(type) {
  return { topic: { w: 150, h: 46 }, note: { w: 220, h: 90 }, image: { w: 280, h: 230 }, code: { w: 440, h: 380 }, question: { w: 390, h: 260 } }[type] || { w: 150, h: 46 };
}
function addChild(parentId, fields = {}, { edit = true, select = true } = {}) {
  let created = null;
  commit(() => {
    if (S.map.nodes.length >= LIMITS.nodes) { toast('This map is full (' + LIMITS.nodes + ' items). Start a new map for more.', 'error'); return false; }
    const parent = nodeById(S.map, parentId) || nodeById(S.map, S.map.rootId);
    const type = fields.type || 'topic';
    const size = defaultSize(type);
    const spot = spotForNewChild(S.map, parent.id, size);
    created = normalizeNode({ id: makeId('n'), type, parentId: parent.id, x: spot.x, y: spot.y, w: size.w, h: size.h,
      color: fields.color || (type === 'note' ? 'yellow' : type === 'topic' ? colorForNewChild(S.map, parent.id) : 'white'),
      shape: 'rounded', text: '', ...fields });
    if (parent.id === S.map.rootId && spot.side) created.side = spot.side;
    parent.collapsed = false;
    S.map.nodes.push(created);
  }, { select: undefined });
  if (!created) return null;
  if (select) setSelected(created.id);
  centerOn(created.id);
  if (edit && created.type === 'topic') startEditing(created.id, true);
  return created;
}
function addSibling(id) {
  const n = nodeById(S.map, id);
  if (!n || !n.parentId) return addChild(S.map.rootId);
  return addChild(n.parentId);
}
function deleteSelected() {
  if (S.selectedLink) {
    const id = S.selectedLink;
    commit(() => { S.map.links = S.map.links.filter(l => l.id !== id); });
    S.selectedLink = '';
    render();
    return;
  }
  const n = selectedNode();
  if (!n) return;
  if (n.id === S.map.rootId) { toast('The centre of the map stays. You can rename it instead.'); return; }
  const count = descendantsOf(S.map, n.id).length;
  const parent = n.parentId;
  commit(() => { removeNode(S.map, n.id); }, { select: parent });
  toast(count ? `Deleted “${nodeLabel(n)}” and ${count} item${count === 1 ? '' : 's'} under it.` : `Deleted “${nodeLabel(n)}”.`, '', { action: 'Undo', onAction: undo });
}
function undo() {
  const snap = S.history.undo(JSON.stringify(serializeMap(S.map)));
  if (!snap) { toast('Nothing to undo.'); return; }
  restoreSnapshot(snap);
}
function redo() {
  const snap = S.history.redo(JSON.stringify(serializeMap(S.map)));
  if (!snap) { toast('Nothing to redo.'); return; }
  restoreSnapshot(snap);
}
function restoreSnapshot(snap) {
  const keepView = { ...S.map.view };
  S.map = normalizeMap(snap);
  S.map.view = keepView;
  if (S.selected && !nodeById(S.map, S.selected)) S.selected = '';
  for (const rec of els.values()) rec.hash = '';
  S.inspectorFor = null;
  markDirty();
  render();
}

/* ---------- text editing on the canvas ---------- */
function startEditing(id, selectAll = true, initial = '') {
  if (S.readOnly) return;
  const n = nodeById(S.map, id);
  const rec = els.get(id);
  if (!n || !rec || !['topic', 'note', 'image'].includes(n.type)) return;
  let textEl = $('.mm-text', rec.el);
  if (!textEl) {
    if (n.type === 'note') { textEl = document.createElement('div'); textEl.className = 'note-title mm-text'; rec.el.prepend(textEl); }
    else if (n.type === 'image') { textEl = document.createElement('div'); textEl.className = 'pic-caption mm-text'; rec.el.appendChild(textEl); }
    else return;
  }
  S.editing = id;
  S.editBefore = JSON.stringify(serializeMap(S.map));
  textEl.contentEditable = 'true';
  textEl.spellcheck = true;
  textEl.textContent = initial || n.text || '';
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  if (!selectAll || initial) range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const onInput = () => {
    n.text = textEl.textContent.slice(0, LIMITS.text);
    const w = rec.el.offsetWidth, h = rec.el.offsetHeight;
    n.w = w; n.h = h;
    placeNodeEl(n);
    renderEdges();
  };
  textEl.oninput = onInput;
  textEl.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEditing(true); if (e.ctrlKey || e.metaKey) return; }
    else if (e.key === 'Escape') { e.preventDefault(); finishEditing(false); }
    else if (e.key === 'Tab') { e.preventDefault(); finishEditing(true); addChild(id); }
    e.stopPropagation();
  };
  textEl.onblur = () => { if (S.editing === id) finishEditing(true); };
}
function finishEditing(keep) {
  const id = S.editing;
  if (!id) return;
  S.editing = '';
  const rec = els.get(id);
  const n = nodeById(S.map, id);
  const textEl = rec && $('.mm-text[contenteditable="true"]', rec.el);
  if (textEl) { textEl.contentEditable = 'false'; textEl.oninput = textEl.onkeydown = textEl.onblur = null; }
  if (!n) return;
  const before = S.editBefore;
  if (!keep) {
    const old = normalizeMap(JSON.parse(before));
    const o = nodeById(old, id);
    if (o) n.text = o.text;
  } else {
    n.text = String(n.text || '').replace(/\s+\n/g, '\n').trim();
    if (!n.text && n.type === 'topic') n.text = n.id === S.map.rootId ? 'Central idea' : 'New topic';
    if (id === S.map.rootId && (S.map.title === 'My mind map' || !S.map.title)) { S.map.title = n.text.slice(0, LIMITS.title); $('#mapTitle').value = S.map.title; }
  }
  if (before !== JSON.stringify(serializeMap(S.map))) { S.history.push(before); markDirty(); }
  if (rec) rec.hash = '';
  S.inspectorFor = null;
  render();
  ui.viewport.focus({ preventScroll: true });
}

/* ---------- pointer gestures ---------- */
const pointers = new Map();
let gesture = null;
const DRAG_THRESHOLD = 5;

ui.viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') { if (e.button === 1) startPan(e); return; }
  if (e.target.closest('.tool-rail, .zoom-dock, .voice-dock, .readonly-banner, .connect-hint')) return;
  if (e.target.closest('[contenteditable="true"]')) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { startPinch(); return; }
  const linkEl = e.target.closest('[data-link]');
  const nodeEl = e.target.closest('.mm-node');
  const actEl = e.target.closest('[data-act]');
  if (actEl && actEl.dataset.act === 'resize' && nodeEl) { startResize(e, nodeEl.dataset.id); return; }
  if (actEl || e.target.closest('.qc-option, a, input, textarea, select')) return; // a button inside a node: let its click run
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (S.connectMode) { finishConnect(id); return; }
    if (S.selected !== id) setSelected(id);
    const n = nodeById(S.map, id);
    const codeBody = nodeEl.classList.contains('type-code') && !e.target.closest('[data-drag-handle]') && S.selected === id;
    if (codeBody) return; // the app itself takes the pointer
    if (S.readOnly) { startPan(e); return; }
    gesture = { kind: 'drag', id, start: { x: e.clientX, y: e.clientY }, moved: false, pointerId: e.pointerId,
      from: [n, ...(e.altKey ? [] : descendantsOf(S.map, id))].map(m => ({ n: m, x: m.x, y: m.y })), before: JSON.stringify(serializeMap(S.map)) };
    // The pointer is only captured once the drag really starts, so a double-click still lands on the node.
    return;
  }
  if (linkEl) { setSelected('', { link: linkEl.dataset.link }); return; }
  if (S.connectMode) { cancelConnect(); return; }
  startPan(e);
});
function startPan(e) {
  gesture = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, view: { ...view() }, moved: false, pointerId: e.pointerId };
  ui.viewport.classList.add('is-panning', 'is-busy-gesture');
  try { ui.viewport.setPointerCapture(e.pointerId); } catch (_) {}
}
function startPinch() {
  const [a, b] = [...pointers.values()];
  gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...view() } };
  ui.viewport.classList.add('is-busy-gesture');
}
function startResize(e, id) {
  const n = nodeById(S.map, id);
  if (!n) return;
  e.preventDefault();
  gesture = { kind: 'resize', id, start: { x: e.clientX, y: e.clientY }, w: n.code ? n.code.width : 0, h: n.code ? n.code.height : 0, before: JSON.stringify(serializeMap(S.map)) };
  ui.viewport.classList.add('is-busy-gesture');
  ui.viewport.setPointerCapture(e.pointerId);
}
ui.viewport.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.connectMode && S.connectFrom) {
    const a = nodeById(S.map, S.connectFrom);
    const p = screenToWorld(e.clientX, e.clientY);
    if (a) renderEdges({ x1: a.x, y1: a.y, x2: p.x, y2: p.y });
  }
  if (!gesture) return;
  const v = view();
  if (gesture.kind === 'pan') {
    const dx = e.clientX - gesture.start.x, dy = e.clientY - gesture.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
    v.x = gesture.view.x + dx; v.y = gesture.view.y + dy;
    applyView();
  } else if (gesture.kind === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = ui.viewport.getBoundingClientRect();
    const nz = clamp(gesture.view.zoom * dist / (gesture.dist || 1), 0.15, 3);
    const px = gesture.mid.x - r.left, py = gesture.mid.y - r.top;
    v.zoom = nz;
    v.x = px - (px - gesture.view.x) * (nz / gesture.view.zoom) + (mid.x - gesture.mid.x);
    v.y = py - (py - gesture.view.y) * (nz / gesture.view.zoom) + (mid.y - gesture.mid.y);
    applyView();
  } else if (gesture.kind === 'drag') {
    const dx = (e.clientX - gesture.start.x) / v.zoom, dy = (e.clientY - gesture.start.y) / v.zoom;
    if (!gesture.moved && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) < DRAG_THRESHOLD) return;
    if (!gesture.moved) {
      gesture.moved = true;
      ui.viewport.classList.add('is-busy-gesture');
      els.get(gesture.id)?.el.classList.add('is-dragging');
      try { ui.viewport.setPointerCapture(gesture.pointerId); } catch (_) {}
    }
    for (const f of gesture.from) { f.n.x = Math.round(f.x + dx); f.n.y = Math.round(f.y + dy); placeNodeEl(f.n); }
    renderEdges();
    // Drop target: a node under the pointer that is not the dragged branch.
    const dragged = new Set(gesture.from.map(f => f.n.id));
    const under = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest && el.closest('.mm-node')).find(el => el && !dragged.has(el.dataset.id));
    const target = under ? under.dataset.id : '';
    if (target !== gesture.target) {
      if (gesture.target) els.get(gesture.target)?.el.classList.remove('is-drop-target');
      gesture.target = target;
      if (target) els.get(target)?.el.classList.add('is-drop-target');
    }
  } else if (gesture.kind === 'resize') {
    const n = nodeById(S.map, gesture.id);
    const dx = (e.clientX - gesture.start.x) / v.zoom, dy = (e.clientY - gesture.start.y) / v.zoom;
    if (n && n.code) {
      n.code.width = clamp(Math.round(gesture.w + dx * 2), 240, 1600);
      n.code.height = clamp(Math.round(gesture.h + dy * 2), 160, 1400);
      const rec = els.get(n.id);
      const wrap = rec && $('.code-frame-wrap', rec.el);
      if (wrap) { wrap.style.width = n.code.width + 'px'; wrap.style.height = n.code.height + 'px'; }
      n.w = rec.el.offsetWidth; n.h = rec.el.offsetHeight;
      placeNodeEl(n);
      renderEdges();
    }
  }
});
function endGesture(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  const g = gesture;
  if (g.kind === 'pinch' && pointers.size) return;
  gesture = null;
  ui.viewport.classList.remove('is-panning', 'is-busy-gesture');
  if (g.kind === 'pan') {
    if (!g.moved && e.type === 'pointerup') { setSelected(''); }
    else softDirty();
  } else if (g.kind === 'pinch') {
    softDirty();
  } else if (g.kind === 'drag') {
    els.get(g.id)?.el.classList.remove('is-dragging');
    if (g.target) els.get(g.target)?.el.classList.remove('is-drop-target');
    if (!g.moved) return;
    if (g.target && g.target !== g.id) {
      // Dropped on another item: the branch moves under it.
      const ok = reparent(S.map, g.id, g.target);
      if (ok) {
        const n = nodeById(S.map, g.id);
        if (n.color !== 'white' && n.type === 'topic') n.color = colorForNewChild(S.map, g.target) || n.color;
        S.history.push(g.before);
        tidyUp(true);
        markDirty();
        toast(`Moved under “${nodeLabel(nodeById(S.map, g.target))}”.`, '', { action: 'Undo', onAction: undo });
        render();
        return;
      }
      toast('A branch cannot go inside itself.');
    }
    // Dropped on empty canvas: the branch keeps its new place (on the root's left or right).
    const n = nodeById(S.map, g.id);
    if (n && n.parentId === S.map.rootId) { const root = nodeById(S.map, S.map.rootId); n.side = n.x < root.x ? 'left' : 'right'; }
    S.history.push(g.before);
    markDirty();
    render();
  } else if (g.kind === 'resize') {
    S.history.push(g.before);
    markDirty();
    render();
  }
}
ui.viewport.addEventListener('pointerup', endGesture);
ui.viewport.addEventListener('pointercancel', endGesture);
ui.viewport.addEventListener('lostpointercapture', e => { if (gesture && gesture.pointerId === e.pointerId) endGesture(e); });

ui.viewport.addEventListener('wheel', e => {
  if (e.target.closest('.voice-dock, .tool-rail, .zoom-dock')) return;
  // Scrolling inside a long question card scrolls the card.
  const scroller = e.target.closest('.q-body, .code-console');
  if (scroller && scroller.scrollHeight > scroller.clientHeight && !e.ctrlKey) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
  else {
    const v = view();
    const k = e.deltaMode === 1 ? 16 : 1;
    v.x -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
    v.y -= (e.shiftKey ? 0 : e.deltaY) * k;
    applyView();
    softDirty();
  }
}, { passive: false });

ui.viewport.addEventListener('dblclick', e => {
  if (S.readOnly) return;
  const nodeEl = e.target.closest('.mm-node');
  if (nodeEl) {
    const n = nodeById(S.map, nodeEl.dataset.id);
    if (!n) return;
    if (n.type === 'code') { if (e.target.closest('[data-drag-handle]')) openCodeStudio(n.id); return; }
    if (n.type === 'question') return;
    startEditing(n.id, true);
    return;
  }
  if (e.target.closest('.tool-rail, .zoom-dock, .voice-dock')) return;
  // Double-tap on empty canvas: a new topic there, under the selected item (or the centre).
  const p = screenToWorld(e.clientX, e.clientY);
  const parentId = S.selected && nodeById(S.map, S.selected) ? S.selected : S.map.rootId;
  const created = addChild(parentId, { type: 'topic' }, { edit: false });
  if (created) {
    created.x = Math.round(p.x); created.y = Math.round(p.y); created.pinned = false;
    if (parentId === S.map.rootId) created.side = p.x < 0 ? 'left' : 'right';
    render();
    startEditing(created.id, true);
  }
});

/* Clicks on buttons inside nodes. */
ui.nodes.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  const nodeEl = e.target.closest('.mm-node');
  if (!nodeEl) return;
  const id = nodeEl.dataset.id;
  const n = nodeById(S.map, id);
  if (!n) return;
  const opt = e.target.closest('[data-option-id]');
  if (opt && n.type === 'question') {
    nodeEl.dataset.picked = opt.dataset.optionId;
    els.get(id).hash = '';
    render();
    return;
  }
  if (!act) return;
  e.stopPropagation();
  switch (act.dataset.act) {
    case 'add-child': addChild(id); break;
    case 'fold': commit(() => { n.collapsed = !n.collapsed; }); break;
    case 'retry-job': retryJob(id); break;
    case 'draw-image': setSelected(id); openImageStudio({ nodeId: id }); break;
    case 'code-run': rerunCode(id); break;
    case 'code-edit': setSelected(id); S.codeTab = 'html'; S.inspectorFor = null; openInspector(); render(); break;
    case 'code-big': openCodeStudio(id); break;
    case 'q-reveal': nodeEl.dataset.reveal = nodeEl.dataset.reveal === '1' ? '' : '1'; els.get(id).hash = ''; render(); break;
    case 'q-reset': nodeEl.dataset.picked = ''; nodeEl.dataset.reveal = ''; els.get(id).hash = ''; render(); break;
    case 'q-fold': toggleQuestionFold(id); break;
  }
});

/* ---------- connecting ---------- */
function startConnect() {
  if (S.readOnly) return;
  S.connectMode = true;
  S.connectFrom = S.selected || '';
  ui.viewport.classList.add('is-connecting');
  $('#connectHint').hidden = false;
  $('#connectHint').textContent = S.connectFrom ? 'Now tap the item to connect “' + nodeLabel(nodeById(S.map, S.connectFrom)).slice(0, 40) + '” to · Esc to cancel' : 'Tap the first item, then the second · Esc to cancel';
  updateTools();
}
function finishConnect(id) {
  if (!S.connectFrom) { S.connectFrom = id; setSelected(id); startConnect(); return; }
  const from = S.connectFrom;
  cancelConnect();
  if (from === id) return;
  if (S.map.links.some(l => (l.from === from && l.to === id))) { toast('Those two are already connected.'); return; }
  const lid = makeId('l');
  commit(() => { S.map.links.push({ id: lid, from, to: id, label: '' }); });
  setSelected('', { link: lid });
  toast('Connected. Give the connection a label in the panel if you like.');
}
function cancelConnect() {
  S.connectMode = false; S.connectFrom = '';
  ui.viewport.classList.remove('is-connecting');
  $('#connectHint').hidden = true;
  renderEdges();
  updateTools();
}

/* ---------- the tool rail ---------- */
function updateTools() {
  const n = selectedNode();
  const ro = S.readOnly;
  $('#toolChild').disabled = ro || (n && n.type === 'code');
  $('#toolSibling').disabled = ro;
  $('#toolNote').disabled = ro;
  $('#toolImage').disabled = ro;
  $('#toolCode').disabled = ro;
  $('#toolQuestion').disabled = ro;
  $('#toolExpand').disabled = ro || !n || n.type !== 'topic';
  $('#toolConnect').disabled = ro;
  $('#toolConnect').classList.toggle('is-on', S.connectMode);
  $('#toolTidy').disabled = ro;
  $('#toolDelete').disabled = ro || (!S.selectedLink && (!n || n.id === S.map.rootId));
  $('#toolUndo').disabled = ro || !S.history.canUndo;
  $('#toolRedo').disabled = ro || !S.history.canRedo;
  $('#micBtn').disabled = ro;
  $('#commandInput').disabled = ro;
}
const parentForNew = () => (S.selected && nodeById(S.map, S.selected) && nodeById(S.map, S.selected).type !== 'code') ? S.selected : (S.selected ? nodeById(S.map, S.selected)?.parentId || S.map.rootId : S.map.rootId);
$('#toolChild').addEventListener('click', () => addChild(S.selected || S.map.rootId));
$('#toolSibling').addEventListener('click', () => addSibling(S.selected || S.map.rootId));
$('#toolNote').addEventListener('click', () => { const n = addChild(parentForNew(), { type: 'note', text: 'Note', note: '' }, { edit: false }); if (n) openInspector(); });
$('#toolImage').addEventListener('click', () => openImageStudio({ parentId: parentForNew() }));
$('#toolCode').addEventListener('click', () => {
  const n = addChild(parentForNew(), { type: 'code', text: 'Learning app', code: { title: 'Learning app', html: '', css: '', js: '', width: 440, height: 320 } }, { edit: false });
  if (n) { S.codeTab = 'ai'; openInspector(); toast('Paste code, or describe an app for the AI to build, in the panel on the right.'); }
});
$('#toolQuestion').addEventListener('click', () => openQuestionPicker(parentForNew()));
$('#toolExpand').addEventListener('click', () => { const n = selectedNode(); if (n) expandWithAi(n.id, 5, false, $('#toolExpand')); });
$('#toolConnect').addEventListener('click', () => (S.connectMode ? cancelConnect() : startConnect()));
$('#toolTidy').addEventListener('click', () => { commit(() => {}, { keepInspector: true }); tidyUp(true); setTimeout(() => fitAll(), 380); });
$('#toolDelete').addEventListener('click', deleteSelected);
$('#toolUndo').addEventListener('click', undo);
$('#toolRedo').addEventListener('click', redo);
$('#zoomIn').addEventListener('click', () => zoomAt(1.2));
$('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.2));
$('#zoomFit').addEventListener('click', () => fitAll());

/* ---------- keyboard ---------- */
function typingInField(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
document.addEventListener('keydown', e => {
  if (!S.map || $('#app').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (ui.modal) { closeModal(); return; }
    if (S.connectMode) { cancelConnect(); return; }
    if (S.selected || S.selectedLink) { setSelected(''); return; }
  }
  if (ui.modal || typingInField(e)) {
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true); }
    return;
  }
  const n = selectedNode();
  const key = e.key;
  if (mod && key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && key.toLowerCase() === 's') { e.preventDefault(); saveNow(true); return; }
  if (mod && key.toLowerCase() === 'c' && n) { copyBranch(n.id); return; }
  if (mod && key.toLowerCase() === 'x' && n && n.id !== S.map.rootId) { copyBranch(n.id); deleteSelected(); return; }
  if (mod && key.toLowerCase() === 'd' && n && n.id !== S.map.rootId) { e.preventDefault(); duplicateBranch(n.id); return; }
  if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomAt(1.2); return; }
  if (mod && key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
  if (mod && key === '0') { e.preventDefault(); fitAll(); return; }
  if (mod) return;
  if (S.readOnly) { if (key === 'f') fitAll(); return; }
  switch (key) {
    case 'Tab': e.preventDefault(); addChild(n && n.type !== 'code' ? n.id : (n ? n.parentId || S.map.rootId : S.map.rootId)); return;
    case 'Enter': e.preventDefault(); if (n && e.shiftKey) startEditing(n.id); else addSibling(n ? n.id : S.map.rootId); return;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); return;
    case 'F2': case ' ': if (n) { e.preventDefault(); startEditing(n.id, true); } return;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': e.preventDefault(); navigate(key); return;
  }
  if (key === 'c' || key === 'C') { startConnect(); return; }
  if (key === 't' || key === 'T') { $('#toolTidy').click(); return; }
  if (key === 'f' || key === 'F') { fitAll(); return; }
  if (key === 'm' || key === 'M') { $('#micBtn').click(); return; }
  if (key === '?') { openHelp(); return; }
  // Typing on a selected topic starts editing it with that letter.
  if (n && key.length === 1 && /\S/.test(key) && ['topic', 'note', 'image'].includes(n.type)) { e.preventDefault(); startEditing(n.id, false, key); }
});
function navigate(key) {
  const map = S.map;
  const n = selectedNode() || nodeById(map, map.rootId);
  if (!n) return;
  const side = n.id === map.rootId ? '' : sideOf(map, n.id);
  const toChild = (dir) => {
    let kids = childrenOf(map, n.id).filter(k => !isHidden(map, k.id));
    if (n.id === map.rootId) kids = kids.filter(k => (k.x >= n.x ? 'right' : 'left') === dir);
    if (!kids.length) return '';
    return kids.sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0].id;
  };
  let next = '';
  if (key === 'ArrowRight') next = side === 'left' ? n.parentId : toChild('right');
  if (key === 'ArrowLeft') next = side === 'left' || n.id === map.rootId ? toChild('left') : n.parentId;
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const sibs = (n.parentId ? childrenOf(map, n.parentId) : []).filter(k => !isHidden(map, k.id) && (n.parentId !== map.rootId || sideOf(map, k.id) === side)).sort((a, b) => a.y - b.y);
    const i = sibs.findIndex(s => s.id === n.id);
    const j = key === 'ArrowUp' ? i - 1 : i + 1;
    if (sibs[j]) next = sibs[j].id;
  }
  if (next) { setSelected(next); centerOn(next); }
}

/* ---------- copy / paste ---------- */
function branchJson(id) {
  const top = nodeById(S.map, id);
  if (!top) return null;
  const nodes = [top, ...descendantsOf(S.map, id)].map(n => JSON.parse(JSON.stringify(n)));
  const ids = new Set(nodes.map(n => n.id));
  const links = S.map.links.filter(l => ids.has(l.from) && ids.has(l.to)).map(l => ({ ...l }));
  return { kind: 'polymath-mindmap-branch', topId: id, nodes, links };
}
function copyBranch(id) {
  const data = branchJson(id);
  if (!data) return;
  S.clipboard = data;
  try { navigator.clipboard.writeText(JSON.stringify(data)); } catch (e) {}
  toast('Copied “' + nodeLabel(nodeById(S.map, id)).slice(0, 40) + '”' + (data.nodes.length > 1 ? ' with ' + (data.nodes.length - 1) + ' item(s) under it' : '') + '.');
}
function pasteBranch(data, parentId) {
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return false;
  const remap = new Map();
  for (const n of data.nodes) remap.set(n.id, makeId('n'));
  const parent = nodeById(S.map, parentId) || nodeById(S.map, S.map.rootId);
  const top = data.nodes.find(n => n.id === data.topId) || data.nodes[0];
  const spot = spotForNewChild(S.map, parent.id, { w: top.w || 150, h: top.h || 46 });
  const dx = spot.x - top.x, dy = spot.y - top.y;
  let topNew = '';
  commit(() => {
    if (S.map.nodes.length + data.nodes.length > LIMITS.nodes) { toast('That would make the map too big.', 'error'); return false; }
    for (const raw of data.nodes) {
      const n = normalizeNode({ ...raw, id: remap.get(raw.id), parentId: raw.id === top.id ? parent.id : (remap.get(raw.parentId) || parent.id), x: raw.x + dx, y: raw.y + dy });
      if (!n) continue;
      if (raw.id === top.id) { topNew = n.id; if (parent.id === S.map.rootId) n.side = spot.side || ''; else n.side = ''; }
      S.map.nodes.push(n);
    }
    for (const l of data.links || []) if (remap.has(l.from) && remap.has(l.to)) S.map.links.push({ id: makeId('l'), from: remap.get(l.from), to: remap.get(l.to), label: l.label || '' });
  }, { tidy: true });
  if (topNew) { setSelected(topNew); centerOn(topNew); }
  return true;
}
function duplicateBranch(id) {
  const data = branchJson(id);
  const n = nodeById(S.map, id);
  if (data && n) pasteBranch(data, n.parentId || S.map.rootId);
}
document.addEventListener('paste', async e => {
  if (!S.map || S.readOnly || ui.modal || typingInField(e) || $('#app').hidden) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const parent = parentForNew();
  // A picture from the clipboard → a picture item.
  const file = [...dt.items || []].find(i => i.kind === 'file' && /^image\//.test(i.type));
  if (file) {
    e.preventDefault();
    const blob = file.getAsFile();
    if (blob) placeImageFile(blob, parent);
    return;
  }
  const text = dt.getData('text/plain') || '';
  if (!text.trim()) return;
  e.preventDefault();
  try {
    const data = JSON.parse(text);
    if (data && data.kind === 'polymath-mindmap-branch') { pasteBranch(data, parent); return; }
  } catch (_) {}
  if (S.clipboard && text === JSON.stringify(S.clipboard)) { pasteBranch(S.clipboard, parent); return; }
  // Code → a code window that runs it.
  if (/<!doctype html|<html[\s>]|<script[\s>]|<body[\s>]|<canvas[\s>]|<svg[\s>]/i.test(text) || /^\s*(function|const|let|var|document\.|class )\b/m.test(text) && /[;{}]/.test(text) && text.split('\n').length > 2) {
    const isJs = !/<[a-z!]/i.test(text);
    const n = addChild(parent, { type: 'code', text: 'Pasted app', code: { title: 'Pasted app', html: isJs ? '' : text, css: '', js: isJs ? text : '', width: 460, height: 340 } }, { edit: false });
    if (n) toast('Your code is running in a sandboxed window. Select it to edit the code.');
    return;
  }
  // A list (several lines) → topics, keeping the indentation.
  if (text.includes('\n')) {
    commit(() => { importOutlineText(S.map, parent, text); }, { tidy: true });
    toast('Added the pasted list as topics.');
    return;
  }
  addChild(parent, { type: 'topic', text: text.trim().slice(0, LIMITS.text) }, { edit: false });
});

/* =====================================================================
   5. THE INSPECTOR
   ===================================================================== */
function openInspector() { ui.inspector.classList.remove('is-closed'); $('#inspectorToggle').hidden = true; S.inspectorFor = null; refreshInspector(true); }
function closeInspector() { ui.inspector.classList.add('is-closed'); $('#inspectorToggle').hidden = false; }
$('#inspectorToggle').addEventListener('click', openInspector);
if (matchMedia('(max-width: 900px)').matches) closeInspector();

/** Remember the map before a run of edits in a field, push it once when the field is left. */
let fieldBefore = null;
function beginField() { if (!fieldBefore) fieldBefore = JSON.stringify(serializeMap(S.map)); }
function endField() {
  if (!fieldBefore) return;
  const b = fieldBefore;
  fieldBefore = null;
  if (b !== JSON.stringify(serializeMap(S.map))) { S.history.push(b); updateTools(); }
}
/** A live edit from a field: change, redraw the canvas (not the panel), save later. */
function liveEdit(fn) {
  if (S.readOnly) return;
  beginField();
  fn();
  markDirty();
  renderNodes();
  renderEdges();
  scheduleMinimap();
}

function inspectorKey() {
  const n = selectedNode();
  return JSON.stringify([S.selected, S.selectedLink, n ? n.type : '', S.readOnly, S.staff, S.codeTab || '', n ? S.jobs.get(n.id)?.status || '' : '', S.map && S.map.id]);
}
function refreshInspector(force = false) {
  if (!S.map) return;
  const key = inspectorKey();
  if (!force && S.inspectorFor === key) { refreshInspectorBits(); return; }
  if (ui.inspector.contains(document.activeElement) && !force && S.inspectorFor && S.inspectorFor.split(',')[0] === key.split(',')[0]) { refreshInspectorBits(); return; }
  S.inspectorFor = key;
  const n = selectedNode();
  const link = S.selectedLink ? S.map.links.find(l => l.id === S.selectedLink) : null;
  let html;
  if (link) html = inspectLink(link);
  else if (!n) html = inspectMap();
  else if (n.type === 'topic') html = inspectTopic(n);
  else if (n.type === 'note') html = inspectNote(n);
  else if (n.type === 'image') html = inspectImage(n);
  else if (n.type === 'code') html = inspectCode(n);
  else if (n.type === 'question') html = inspectQuestion(n);
  ui.inspector.innerHTML = `<div class="row" style="justify-content:flex-end;margin:-6px -6px -10px 0"><button class="btn btn-small btn-ghost btn-icon" type="button" data-i="close" aria-label="Hide the panel" title="Hide the panel">⟩</button></div>` + html;
  bindInspector(n, link);
}
/** Small live parts that change without a full redraw (stats, undo state). */
function refreshInspectorBits() {
  const stats = $('#mapStats', ui.inspector);
  if (stats) stats.innerHTML = statsHtml();
  updateTools();
}
function statsHtml() {
  const c = t => S.map.nodes.filter(n => n.type === t).length;
  return `<div class="stat"><b>${c('topic')}</b><span>topics</span></div><div class="stat"><b>${c('image')}</b><span>pictures</span></div><div class="stat"><b>${c('code')}</b><span>apps</span></div>
    <div class="stat"><b>${c('question')}</b><span>questions</span></div><div class="stat"><b>${c('note')}</b><span>notes</span></div><div class="stat"><b>${S.map.links.length}</b><span>links</span></div>`;
}
const swatchesHtml = cur => `<div class="swatches" role="radiogroup" aria-label="Colour">${NODE_COLORS.map(c => `<button type="button" class="swatch${c.id === cur ? ' is-on' : ''}" data-color="${c.id}" style="--fill:${c.fill};--line:${c.line}" aria-label="${c.label}" title="${c.label}"></button>`).join('')}</div>`;
const shapesHtml = cur => `<div class="seg" role="group" aria-label="Shape">${SHAPES.map(s => `<button type="button" data-shape="${s}" class="${s === cur ? 'is-on' : ''}">${{ rounded: 'Rounded', pill: 'Pill', rect: 'Box', cloud: 'Cloud' }[s]}</button>`).join('')}</div>`;
const linksOf = id => S.map.links.filter(l => l.from === id || l.to === id);
function linksListHtml(n) {
  const ls = linksOf(n.id);
  if (!ls.length) return '';
  return `<h3>Connections</h3><div class="card">${ls.map(l => {
    const other = nodeById(S.map, l.from === n.id ? l.to : l.from);
    return `<div class="row"><span style="flex:1;font-size:0.85rem">${l.from === n.id ? '→' : '←'} ${escapeHtml(nodeLabel(other).slice(0, 40))}${l.label ? ' <i>(' + escapeHtml(l.label) + ')</i>' : ''}</span><button class="btn btn-small btn-ghost" type="button" data-i="select-link" data-link="${l.id}">Edit</button></div>`;
  }).join('')}</div>`;
}
function readOnlyNote() { return S.readOnly ? '<p class="hint">This is a shared map. Make your own copy (top of the map) to change it.</p>' : ''; }

function inspectMap() {
  return `<h2>🗺 This mind map</h2>${readOnlyNote()}
    <div class="stat-grid" id="mapStats">${statsHtml()}</div>
    ${S.readOnly ? '' : `
    <h3>Build with AI</h3>
    <div class="card">
      <label class="field">What is the map about?<input class="input" id="iAiTopic" placeholder="e.g. Plant transport system" maxlength="200"></label>
      <label class="field">For<select class="select" id="iAiLevel"><option value="">Any level</option>${['P3', 'P4', 'P5', 'P6'].map(l => `<option>${l}</option>`).join('')}</select></label>
      <button class="btn btn-primary" type="button" data-i="ai-map">🪄 Build the branches</button>
      <p class="hint">Adds main branches and ideas around the centre. You can undo it.</p>
    </div>
    <h3>❓ Questions</h3>
    <div class="card">
      <div class="row">
        <button class="btn btn-small" type="button" data-i="add-free-question">❓ Add questions on their own</button>
      </div>
      ${S.map.nodes.some(n => n.type === 'question') ? `<div class="row">
        <button class="btn btn-small" type="button" data-i="fold-all-q">▾ Fold all questions</button>
        <button class="btn btn-small" type="button" data-i="open-all-q">▸ Open all questions</button>
      </div>` : ''}
      <p class="hint">Folded questions show one line each, so the map stays neat. A question “on its own” is its own container, attached to no topic.</p>
    </div>
    <h3>Paste a list</h3>
    <div class="card">
      <textarea class="textarea" id="iOutline" placeholder="One idea per line. Indent with spaces for sub-ideas."></textarea>
      <button class="btn" type="button" data-i="outline">Add to the map</button>
    </div>`}
    <h3>Tips</h3>
    <div class="card hint">
      <div>🎙 Tap the mic and say things like “add three sub-topics to Roots”, “draw a labelled diagram of a flower”, “build an app where I drag a magnet”, or “add two P4 questions about light”.</div>
      <div>⌨️ Tab adds a sub-topic, Enter adds one beside it, double-click to rename, drag one topic onto another to move it. Press ? for all shortcuts.</div>
    </div>`;
}
function inspectTopic(n) {
  const isRoot = n.id === S.map.rootId;
  const kids = childrenOf(S.map, n.id).length;
  return `<h2>${isRoot ? '🎯 Centre' : '🔹 Topic'}</h2>${readOnlyNote()}
    <label class="field">Text<textarea class="textarea" id="iText" rows="2" ${S.readOnly ? 'readonly' : ''}>${escapeHtml(n.text)}</textarea></label>
    ${S.readOnly ? '' : `<h3>Colour</h3>${swatchesHtml(n.color)}<h3>Shape</h3>${shapesHtml(n.shape)}
    <div class="row">
      <button class="btn btn-small" type="button" data-i="child">➕ Sub-topic</button>
      ${isRoot ? '' : '<button class="btn btn-small" type="button" data-i="sibling">↕️ Beside</button>'}
      ${kids && !isRoot ? `<button class="btn btn-small" type="button" data-i="fold">${n.collapsed ? 'Show' : 'Hide'} ${kids} sub-topic${kids === 1 ? '' : 's'}</button>` : ''}
      ${isRoot ? '' : '<button class="btn btn-small btn-danger" type="button" data-i="delete">🗑 Delete</button>'}
    </div>
    <h3>✨ AI ideas</h3>
    <div class="card">
      <div class="range-row"><span class="hint">How many</span><input type="range" min="2" max="8" value="5" id="iIdeaCount"><output id="iIdeaCountOut">5</output></div>
      <label class="row hint"><input type="checkbox" id="iIdeaNotes"> Add a short explanation note to each</label>
      <button class="btn btn-primary" type="button" data-i="expand">✨ Suggest sub-topics</button>
    </div>
    <h3>Add to this topic</h3>
    <div class="row">
      <button class="btn btn-small" type="button" data-i="add-image">🖼 Picture</button>
      <button class="btn btn-small" type="button" data-i="add-code">💻 App</button>
      <button class="btn btn-small" type="button" data-i="add-question">❓ Questions</button>
      <button class="btn btn-small" type="button" data-i="add-note">📝 Note</button>
    </div>`}
    ${linksListHtml(n)}`;
}
function inspectNote(n) {
  return `<h2>📝 Note</h2>${readOnlyNote()}
    <label class="field">Title<input class="input" id="iText" value="${escapeHtml(n.text)}" ${S.readOnly ? 'readonly' : ''}></label>
    <label class="field">Note<textarea class="textarea" id="iNote" rows="7" ${S.readOnly ? 'readonly' : ''}>${escapeHtml(n.note || '')}</textarea></label>
    ${S.readOnly ? '' : `<h3>Colour</h3>${swatchesHtml(n.color)}
    <div class="row"><button class="btn btn-small" type="button" data-i="note-ai">✨ Explain it for me</button><button class="btn btn-small btn-danger" type="button" data-i="delete">🗑 Delete</button></div>`}
    ${linksListHtml(n)}`;
}
function inspectImage(n) {
  const job = S.jobs.get(n.id);
  return `<h2>🖼 Picture</h2>${readOnlyNote()}
    ${n.image.url ? `<div class="pic-preview"><img src="${escapeHtml(n.image.url)}" alt=""></div>` : ''}
    <label class="field">Caption<input class="input" id="iText" value="${escapeHtml(n.text)}" placeholder="Optional" ${S.readOnly ? 'readonly' : ''}></label>
    ${S.readOnly ? '' : `
    <div class="range-row"><span class="hint">Size</span><input type="range" min="120" max="700" step="10" value="${n.image.width}" id="iImgW"><output id="iImgWOut">${n.image.width}px</output></div>
    <h3>Draw with AI</h3>
    <div class="card">
      <textarea class="textarea" id="iImgPrompt" rows="3" placeholder="Describe the picture">${escapeHtml(n.image.prompt || '')}</textarea>
      <div class="seg" id="iImgStyle">${['illustration', 'diagram', 'sketch', 'photo', 'icon'].map(s => `<button type="button" data-style="${s}" class="${(n.image.style || 'illustration') === s ? 'is-on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <button class="btn btn-primary" type="button" data-i="redraw" ${job && job.status === 'working' ? 'disabled' : ''}>🎨 ${n.image.url ? 'Draw again' : 'Draw it'}</button>
    </div>
    <div class="row">
      <button class="btn btn-small" type="button" data-i="upload">⬆️ Use my own picture</button>
      ${n.image.url ? `<a class="btn btn-small" href="${escapeHtml(n.image.url)}" target="_blank" rel="noopener">↗ Full size</a>` : ''}
      <button class="btn btn-small btn-danger" type="button" data-i="delete">🗑 Delete</button>
    </div>`}
    ${linksListHtml(n)}`;
}
function inspectCode(n) {
  const tab = S.codeTab || (n.code.html || n.code.css || n.code.js ? 'html' : 'ai');
  const job = S.jobs.get(n.id);
  const has = !!(n.code.html || n.code.css || n.code.js);
  const lines = (S.consoles.get(n.id) || []).slice(-6);
  return `<h2>💻 Code window</h2>${readOnlyNote()}
    <label class="field">Title<input class="input" id="iCodeTitle" value="${escapeHtml(n.code.title)}" ${S.readOnly ? 'readonly' : ''}></label>
    <div class="seg" id="iCodeTabs">${[['ai', '✨ AI'], ['html', 'HTML'], ['css', 'CSS'], ['js', 'JS']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'is-on' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'ai' ? `
      <div class="card">
        <label class="field">${has ? 'What should change?' : 'Describe the app'}<textarea class="textarea" id="iCodeAsk" rows="5" placeholder="${has ? 'e.g. add a reset button and make the numbers bigger' : 'e.g. a slider for the number of batteries that shows how bright the bulb gets'}" ${S.readOnly ? 'readonly' : ''}>${has ? '' : escapeHtml(n.code.prompt || '')}</textarea></label>
        ${S.readOnly ? '' : `<button class="btn btn-primary" type="button" data-i="code-ai" ${job && job.status === 'working' ? 'disabled' : ''}>${has ? '✨ Change the app' : '✨ Build the app'}</button>`}
        <p class="hint">${job && job.status === 'working' ? escapeHtml(job.message || 'Working…') : 'The AI writes a complete HTML page. Building takes about a minute. You can also speak the change with the mic.'}</p>
      </div>`
    : `<textarea class="textarea code-area" id="iCode" spellcheck="false" placeholder="${{ html: 'Paste HTML here (a whole page works too)', css: 'Paste CSS here', js: 'Paste JavaScript here' }[tab]}" ${S.readOnly ? 'readonly' : ''}>${escapeHtml(n.code[tab] || '')}</textarea>
      <div class="row">
        <button class="btn btn-small btn-primary" type="button" data-i="run">▶ Run</button>
        <label class="row hint"><input type="checkbox" id="iAutoRun" ${local('mindmap-autorun') === 'off' ? '' : 'checked'}> Run as I type</label>
      </div>`}
    <div class="row">
      <button class="btn btn-small" type="button" data-i="studio">⤢ Big editor</button>
      ${has ? '<button class="btn btn-small" type="button" data-i="download-code">⬇ .html</button><button class="btn btn-small" type="button" data-i="copy-code">📋 Copy</button>' : ''}
      ${S.readOnly ? '' : '<button class="btn btn-small btn-danger" type="button" data-i="delete">🗑 Delete</button>'}
    </div>
    ${S.readOnly ? '' : `<h3>Window size</h3>
    <div class="range-row"><span class="hint">Width</span><input type="range" min="240" max="1200" step="10" value="${n.code.width}" id="iCodeW"><output id="iCodeWOut">${n.code.width}</output></div>
    <div class="range-row"><span class="hint">Height</span><input type="range" min="160" max="1000" step="10" value="${n.code.height}" id="iCodeH"><output id="iCodeHOut">${n.code.height}</output></div>`}
    ${lines.length ? `<h3>Console</h3><div class="card code-console" style="max-height:140px">${lines.map(l => `<div class="${l.kind}">${escapeHtml(l.text)}</div>`).join('')}</div>` : ''}
    <p class="hint">🔒 The app runs in a sealed sandbox: it cannot see your account, this page or your saved maps.</p>
    ${linksListHtml(n)}`;
}
function inspectQuestion(n) {
  const q = n.question;
  return `<h2>❓ Question</h2>
    <div class="row">${q.level ? `<span class="chip science is-on">${escapeHtml(q.level)}</span>` : ''}${q.topic ? `<span class="chip">${escapeHtml(q.topic)}</span>` : ''}${q.marks ? `<span class="chip">${escapeHtml(q.marks)} marks</span>` : ''}</div>
    <div class="card">${renderQuestionHtml(q, { showAnswers: S.staff })}</div>
    ${S.staff ? '' : '<p class="hint">Tap an option on the map to check your answer.</p>'}
    ${S.readOnly ? `<div class="row"><button class="btn btn-small" type="button" data-i="q-fold">${q.folded ? '▸ Open the card' : '▾ Fold the card'}</button></div>` : `
    <div class="range-row"><span class="hint">Width</span><input type="range" min="240" max="800" step="10" value="${q.width}" id="iQW"><output id="iQWOut">${q.width}</output></div>
    <div class="row">
      <button class="btn btn-small" type="button" data-i="q-fold">${q.folded ? '▸ Open the card' : '▾ Fold the card'}</button>
      ${isFree(S.map, n) ? '' : '<button class="btn btn-small" type="button" data-i="detach">↗ Stand on its own</button>'}
    </div>
    <p class="hint">${isFree(S.map, n) ? '📦 This question stands on its own, attached to no topic. Drag it by its blue bar onto a topic to attach it.' : '🔗 Attached to “' + escapeHtml(nodeLabel(nodeById(S.map, n.parentId)).slice(0, 40)) + '”. “Stand on its own” unhooks it so it is its own container.'}</p>
    <div class="row">
      <button class="btn btn-small" type="button" data-i="more-questions">➕ More on ${escapeHtml(q.topic || 'this topic')}</button>
      <button class="btn btn-small btn-danger" type="button" data-i="delete">🗑 Remove</button>
    </div>`}
    ${linksListHtml(n)}`;
}
function inspectLink(l) {
  const a = nodeById(S.map, l.from), b = nodeById(S.map, l.to);
  return `<h2>🔗 Connection</h2>${readOnlyNote()}
    <p class="hint">${escapeHtml(nodeLabel(a))} → ${escapeHtml(nodeLabel(b))}</p>
    <label class="field">Label<input class="input" id="iLinkLabel" value="${escapeHtml(l.label)}" placeholder="e.g. causes, is part of" maxlength="80" ${S.readOnly ? 'readonly' : ''}></label>
    ${S.readOnly ? '' : `<div class="row"><button class="btn btn-small" type="button" data-i="swap-link">⇄ Swap direction</button><button class="btn btn-small btn-danger" type="button" data-i="delete-link">🗑 Delete</button></div>`}`;
}

function bindInspector(n, link) {
  const root = ui.inspector;
  const field = (sel, fn) => { const el = $(sel, root); if (el) { el.addEventListener('input', () => liveEdit(() => fn(el.value, el))); el.addEventListener('change', endField); el.addEventListener('blur', endField); } };
  root.onclick = async e => {
    const b = e.target.closest('[data-i], [data-color], [data-shape], [data-tab], [data-style]');
    if (!b) return;
    if (b.dataset.color && n) { commit(() => { n.color = b.dataset.color; }); return; }
    if (b.dataset.shape && n) { commit(() => { n.shape = b.dataset.shape; }); return; }
    if (b.dataset.tab) { S.codeTab = b.dataset.tab; refreshInspector(true); return; }
    if (b.dataset.style && n) { $$('[data-style]', root).forEach(x => x.classList.toggle('is-on', x === b)); liveEdit(() => { n.image.style = b.dataset.style; }); endField(); return; }
    switch (b.dataset.i) {
      case 'close': closeInspector(); break;
      case 'child': addChild(n.id); break;
      case 'sibling': addSibling(n.id); break;
      case 'fold': commit(() => { n.collapsed = !n.collapsed; }); break;
      case 'delete': deleteSelected(); break;
      case 'expand': expandWithAi(n.id, Number($('#iIdeaCount', root).value) || 5, $('#iIdeaNotes', root).checked, b); break;
      case 'add-image': openImageStudio({ parentId: n.id }); break;
      case 'add-code': $('#toolCode').click(); break;
      case 'add-question': openQuestionPicker(n.id); break;
      case 'add-note': { const c = addChild(n.id, { type: 'note', text: 'Note', note: '' }, { edit: false }); if (c) setTimeout(() => $('#iNote', root)?.focus(), 50); break; }
      case 'note-ai': explainNote(n.id, b); break;
      case 'ai-map': buildMapFromTopic($('#iAiTopic', root).value, $('#iAiLevel', root).value, b); break;
      case 'outline': { const t = $('#iOutline', root).value; if (t.trim()) { commit(() => { importOutlineText(S.map, S.map.rootId, t); }, { tidy: true }); setTimeout(fitAll, 400); } break; }
      case 'redraw': {
        const prompt = $('#iImgPrompt', root).value.trim();
        if (!prompt) { toast('Describe the picture first.'); return; }
        liveEdit(() => { n.image.prompt = prompt; }); endField();
        runJob({ kind: 'image', nodeId: n.id, prompt, style: n.image.style || 'illustration' });
        break;
      }
      case 'upload': S.uploadTarget = { nodeId: n.id }; $('#imageFileInput').click(); break;
      case 'code-ai': {
        const ask = $('#iCodeAsk', root).value.trim();
        if (!ask) { toast('Say what the app should do first.'); return; }
        const has = !!(n.code.html || n.code.css || n.code.js);
        if (has) runJob({ kind: 'update_app', nodeId: n.id, change: ask });
        else { liveEdit(() => { n.code.prompt = ask; }); endField(); runJob({ kind: 'build_app', nodeId: n.id, title: n.code.title, description: ask }); }
        break;
      }
      case 'run': rerunCode(n.id); flashDone(b, '✓ Running'); break;
      case 'studio': openCodeStudio(n.id); break;
      case 'download-code': download(safeName(n.code.title) + '.html', buildSandboxDoc(n.code, { bridge: false }), 'text/html'); break;
      case 'copy-code': try { await navigator.clipboard.writeText(buildSandboxDoc(n.code, { bridge: false })); flashDone(b, '✓ Copied'); } catch (err) { toast('Could not copy. Use the big editor to select the code.'); } break;
      case 'more-questions': openQuestionPicker(n.parentId || S.map.rootId, { topic: n.question.topic, free: isFree(S.map, n) }); break;
      case 'q-fold': toggleQuestionFold(n.id); break;
      case 'detach': detachSelected(n.id); break;
      case 'fold-all-q': foldAllQuestions(true); break;
      case 'open-all-q': foldAllQuestions(false); break;
      case 'add-free-question': openQuestionPicker(S.map.rootId, { free: true }); break;
      case 'select-link': setSelected('', { link: b.dataset.link }); break;
      case 'swap-link': commit(() => { const t = link.from; link.from = link.to; link.to = t; }, { keepInspector: true }); break;
      case 'delete-link': deleteSelected(); break;
    }
  };
  if (!n && !link) return;
  if (link) { field('#iLinkLabel', v => { link.label = v.slice(0, 80); }); return; }
  field('#iText', v => {
    n.text = v.slice(0, LIMITS.text);
    if (n.id === S.map.rootId && (!S.map.title || S.map.title === 'My mind map')) { S.map.title = n.text.slice(0, LIMITS.title); $('#mapTitle').value = S.map.title; }
  });
  field('#iNote', v => { n.note = v.slice(0, LIMITS.note); });
  field('#iImgW', (v) => { n.image.width = Number(v); $('#iImgWOut', root).textContent = v + 'px'; });
  field('#iQW', v => { n.question.width = Number(v); $('#iQWOut', root).textContent = v; });
  field('#iCodeTitle', v => { n.code.title = v.slice(0, 120); n.text = n.code.title; });
  field('#iCodeW', v => { n.code.width = Number(v); $('#iCodeWOut', root).textContent = v; });
  field('#iCodeH', v => { n.code.height = Number(v); $('#iCodeHOut', root).textContent = v; });
  const ideaCount = $('#iIdeaCount', root);
  if (ideaCount) ideaCount.addEventListener('input', () => { $('#iIdeaCountOut', root).textContent = ideaCount.value; });
  const auto = $('#iAutoRun', root);
  if (auto) auto.addEventListener('change', () => local('mindmap-autorun', auto.checked ? 'on' : 'off'));
  const code = $('#iCode', root);
  if (code) {
    const tab = S.codeTab || 'html';
    let runTimer = 0;
    code.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart, en = code.selectionEnd; code.setRangeText('  ', s, en, 'end'); code.dispatchEvent(new Event('input')); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); rerunCode(n.id); }
    });
    code.addEventListener('input', () => {
      liveEdit(() => { n.code[tab] = code.value.slice(0, LIMITS.codePart); });
      clearTimeout(runTimer);
      if (local('mindmap-autorun') !== 'off') runTimer = setTimeout(() => rerunCode(n.id), 700);
    });
    code.addEventListener('change', endField);
    code.addEventListener('blur', endField);
  }
  const textEl = $('#iText', root);
  if (textEl && textEl.tagName === 'TEXTAREA') textEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); } });
}

/* =====================================================================
   6. AI
   ===================================================================== */
/* ---------- the jobs: pictures, apps, questions ---------- */
function setJob(nodeId, data) {
  if (data) S.jobs.set(nodeId, data); else S.jobs.delete(nodeId);
  const rec = els.get(nodeId);
  if (rec) rec.hash = '';
  S.inspectorFor = null;
  render();
}
function retryJob(nodeId) {
  const j = S.jobs.get(nodeId);
  if (j && j.job) runJob(j.job);
  else { const n = nodeById(S.map, nodeId); if (n && n.type === 'image') runJob({ kind: 'image', nodeId, prompt: n.image.prompt, style: n.image.style }); }
}
async function runJob(job) {
  try {
    if (job.kind === 'image') return await jobImage(job);
    if (job.kind === 'build_app' || job.kind === 'update_app') return await jobApp(job);
    if (job.kind === 'questions') return await jobQuestions(job);
  } catch (e) {
    console.warn('[mindmap] job', job, e);
  }
}
async function jobImage(job) {
  const n = nodeById(S.map, job.nodeId);
  if (!n) return;
  setJob(n.id, { kind: 'image', status: 'working', message: 'Drawing your picture…', job });
  try {
    const out = await aiImage(imagePrompt(job.prompt, job.style), { size: '1024x1024', quality: 'medium' });
    const url = await storePicture(out.dataUrl, n.id);
    const live = nodeById(S.map, job.nodeId);
    if (!live) return;
    live.image.url = url;
    live.image.prompt = job.prompt;
    live.image.style = job.style || live.image.style;
    if (!live.image.alt) live.image.alt = job.prompt.slice(0, 300);
    setJob(n.id, null);
    markDirty();
    render();
  } catch (e) {
    setJob(n.id, { kind: 'image', status: 'error', message: e.message || 'The picture could not be drawn.', job });
  }
}
/** Keep a picture: Storage first (small map documents), the picture itself in the map if Storage refuses. */
async function storePicture(dataUrl, nodeId) {
  try {
    return await uploadDataUrl('mindmap-images/' + S.user.uid + '/' + S.map.id + '/' + nodeId + '-' + Date.now().toString(36) + '.' + (/^data:image\/jpe?g/.test(dataUrl) ? 'jpg' : 'png'), dataUrl);
  } catch (e) {
    console.warn('[mindmap] Storage refused the picture; keeping a smaller copy in the map', e);
    return await shrinkDataUrl(dataUrl, 640, 0.82);
  }
}
function shrinkDataUrl(dataUrl, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('The picture could not be read.'));
    img.src = dataUrl;
  });
}
function mapContext(nodeId) {
  const n = nodeById(S.map, nodeId);
  if (!n) return S.map.title;
  const trail = [];
  let p = n.parentId ? nodeById(S.map, n.parentId) : null;
  while (p) { trail.unshift(nodeLabel(p)); p = p.parentId ? nodeById(S.map, p.parentId) : null; }
  return S.map.title + (trail.length ? ' > ' + trail.join(' > ') : '');
}
async function jobApp(job) {
  const n = nodeById(S.map, job.nodeId);
  if (!n || n.type !== 'code') return;
  const updating = job.kind === 'update_app';
  const steps = updating ? ['Reading your app…', 'Making the change…', 'Checking it works…', 'Almost there…'] : ['Planning the app…', 'Writing the code…', 'Adding the interactions…', 'Polishing…', 'Almost there…'];
  let step = 0;
  setJob(n.id, { kind: job.kind, status: 'working', message: steps[0], job });
  const ticker = setInterval(() => {
    step = Math.min(steps.length - 1, step + 1);
    const cur = S.jobs.get(n.id);
    if (cur && cur.status === 'working') setJob(n.id, { ...cur, message: steps[step] });
  }, 9000);
  try {
    const prompt = updating
      ? appUpdatePrompt({ title: n.code.title, change: job.change, html: buildSandboxDoc(n.code, { bridge: false }) })
      : appBuildPrompt({ title: job.title || n.code.title, description: job.description, context: mapContext(n.id) });
    const { text } = await aiText(prompt, { system: APP_SYSTEM, maxTokens: 16000, temperature: 0.5, order: ['openai', 'gemini'], effort: 'medium' });
    const html = extractHtmlDocument(text);
    if (!html) throw new Error('The AI did not send back a working page. Try describing it a little differently.');
    const live = nodeById(S.map, job.nodeId);
    if (!live) return;
    const before = JSON.stringify(serializeMap(S.map));
    live.code.html = html; live.code.css = ''; live.code.js = '';
    if (!updating && job.title) { live.code.title = job.title; live.text = job.title; }
    S.history.push(before);
    S.consoles.delete(live.id);
    S.codeTab = 'ai';
    setJob(live.id, null);
    markDirty();
    rerunCode(live.id);
    toast(updating ? 'Your app has been updated.' : 'Your app is ready. Try it in the window!', 'good');
  } catch (e) {
    setJob(n.id, { kind: job.kind, status: 'error', message: e.message || 'The app could not be built.', job });
  } finally {
    clearInterval(ticker);
  }
}
async function jobQuestions(job) {
  if (!S.levels.length) { toast('Science questions are for students approved for Science. Ask the centre if you need them.'); return; }
  try {
    await loadBank();
  } catch (e) { toast('The question bank could not be loaded: ' + e.message, 'error'); return; }
  const onMap = S.map.nodes.filter(n => n.type === 'question').map(n => n.question.qid);
  const qs = findQuestions({ search: job.search, topic: job.topic, level: job.level, count: job.count, exclude: onMap, staff: S.staff, levels: S.levels });
  if (!qs.length) { toast('No questions matched “' + (job.topic || job.search) + '”. Try the ❓ button to browse.'); return; }
  placeQuestions(qs, job.parentId, { free: !!job.free || !job.parentId, folded: local('mindmap-q-folded') === 'on' });
}

/* ---------- AI ideas, notes and whole maps ---------- */
async function expandWithAi(nodeId, count, withNotes, btn) {
  const n = nodeById(S.map, nodeId);
  if (!n) return;
  busy(btn, true);
  try {
    const { text } = await aiText(expandPrompt(S.map, nodeId, count), { json: true, maxTokens: 2000, order: ['gemini', 'openai-light', 'openai'] });
    const data = parseAiJson(text);
    const ideas = (Array.isArray(data) ? data : data.ideas || []).filter(i => i && (i.text || typeof i === 'string')).slice(0, count);
    if (!ideas.length) throw new Error('The AI had no ideas this time. Try again.');
    commit(() => {
      for (const idea of ideas) {
        const label = String(typeof idea === 'string' ? idea : idea.text).slice(0, LIMITS.text);
        const spot = spotForNewChild(S.map, n.id);
        const t = normalizeNode({ id: makeId('n'), type: 'topic', parentId: n.id, x: spot.x, y: spot.y, text: label, color: colorForNewChild(S.map, n.id), shape: 'rounded' });
        if (n.id === S.map.rootId && spot.side) t.side = spot.side;
        S.map.nodes.push(t);
        if (withNotes && idea.note) {
          const s2 = spotForNewChild(S.map, t.id);
          S.map.nodes.push(normalizeNode({ id: makeId('n'), type: 'note', parentId: t.id, x: s2.x, y: s2.y, text: '', note: String(idea.note).slice(0, LIMITS.note), color: 'yellow' }));
        }
      }
      n.collapsed = false;
    }, { tidy: true });
    flashDone(btn, '✓ Added');
  } catch (e) {
    toast(e.message || 'The AI could not answer.', 'error');
  } finally { busy(btn, false); }
}
async function explainNote(nodeId, btn) {
  const n = nodeById(S.map, nodeId);
  if (!n) return;
  busy(btn, true);
  try {
    const parent = n.parentId ? nodeById(S.map, n.parentId) : null;
    const { text } = await aiText(`In a mind map titled "${S.map.title}", under "${nodeLabel(parent)}", a student wants a short note${n.text && n.text !== 'Note' ? ' titled "' + n.text + '"' : ''}. ${n.note ? 'Improve and complete this draft: ' + n.note : 'Write it.'} Write 2-4 clear sentences a 10-year-old in Singapore understands, correct for the Singapore primary syllabus, British spelling. Reply with the note text only.`, { maxTokens: 600, order: ['gemini', 'openai-light', 'openai'] });
    commit(() => { n.note = text.replace(/^["']|["']$/g, '').slice(0, LIMITS.note); }, { keepInspector: false });
    flashDone(btn, '✓ Written');
  } catch (e) { toast(e.message, 'error'); }
  finally { busy(btn, false); }
}
async function buildMapFromTopic(topic, level, btn) {
  topic = String(topic || '').trim();
  if (!topic) { toast('Type what the map is about first.'); return; }
  busy(btn, true);
  try {
    const { text } = await aiText(mapFromTopicPrompt(topic, level), { json: true, maxTokens: 4000, order: ['gemini', 'openai'] });
    const outline = parseAiJson(text);
    commit(() => { buildFromOutline(S.map, outline); $('#mapTitle').value = S.map.title; }, { tidy: true });
    setTimeout(() => fitAll(), 420);
    if (btn) flashDone(btn, '✓ Built');
    toast('Your map is ready. Tap any topic to change it, or ask the mic for more.', 'good');
  } catch (e) { toast(e.message || 'The AI could not build the map.', 'error'); }
  finally { busy(btn, false); }
}

/* ---------- the picture studio ---------- */
function openImageStudio({ parentId = '', nodeId = '' } = {}) {
  if (S.readOnly) return;
  const target = nodeId ? nodeById(S.map, nodeId) : null;
  const parent = parentId || (target ? target.parentId : S.map.rootId);
  const context = nodeLabel(nodeById(S.map, parent));
  let result = null;
  let style = target ? (target.image.style || 'illustration') : 'illustration';
  const m = openModal({
    title: '🖼 Add a picture', size: 'mid',
    body: `<label class="field">Describe the picture<textarea class="textarea" id="imPrompt" rows="3" placeholder="e.g. a labelled diagram of the parts of a flower">${escapeHtml(target ? target.image.prompt : (context && parent !== S.map.rootId ? context : ''))}</textarea></label>
      <div class="seg" id="imStyle">${['illustration', 'diagram', 'sketch', 'photo', 'icon'].map(s => `<button type="button" data-style="${s}" class="${s === style ? 'is-on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="pic-preview" id="imPreview"><span class="hint" style="padding:20px;text-align:center">Your picture appears here.<br>Drawing takes about 20 to 40 seconds.</span></div>`,
    foot: `<button class="btn" type="button" id="imUpload">⬆️ Upload instead</button><span class="grow"></span>
      <button class="btn" type="button" id="imDraw">🎨 Draw</button><button class="btn btn-primary" type="button" id="imPlace" disabled>Place in map</button>`
  });
  $$('[data-style]', m.body).forEach(b => b.addEventListener('click', () => { style = b.dataset.style; $$('[data-style]', m.body).forEach(x => x.classList.toggle('is-on', x === b)); }));
  $('#imUpload', m.foot).addEventListener('click', () => { S.uploadTarget = nodeId ? { nodeId } : { parentId: parent }; closeModal(); $('#imageFileInput').click(); });
  $('#imDraw', m.foot).addEventListener('click', async () => {
    const prompt = $('#imPrompt', m.body).value.trim();
    if (!prompt) { toast('Describe the picture first.'); return; }
    const btn = $('#imDraw', m.foot);
    busy(btn, true);
    $('#imPreview', m.body).innerHTML = '<div class="pic-loading" style="width:100%;height:260px">🎨 Drawing…</div>';
    try {
      result = { ...(await aiImage(imagePrompt(prompt, style), { size: '1024x1024', quality: 'medium' })), prompt, style };
      if (!ui.modal || ui.modal !== m) return;
      $('#imPreview', m.body).innerHTML = `<img src="${result.dataUrl}" alt="">`;
      $('#imPlace', m.foot).disabled = false;
      btn.innerHTML = '🎨 Draw again';
    } catch (e) {
      if (ui.modal === m) $('#imPreview', m.body).innerHTML = `<div class="pic-error" style="width:100%;min-height:200px">${escapeHtml(e.message)}</div>`;
    } finally { busy(btn, false); }
  });
  $('#imPlace', m.foot).addEventListener('click', async () => {
    if (!result) return;
    const btn = $('#imPlace', m.foot);
    busy(btn, true);
    let node = target;
    if (!node) node = addChild(parent, { type: 'image', text: '', image: { url: '', prompt: result.prompt, alt: result.prompt.slice(0, 300), style: result.style, width: 280 } }, { edit: false });
    closeModal();
    if (!node) return;
    setJob(node.id, { kind: 'image', status: 'working', message: 'Saving your picture…' });
    try {
      const url = await storePicture(result.dataUrl, node.id);
      const live = nodeById(S.map, node.id);
      if (live) { commit(() => { live.image.url = url; live.image.prompt = result.prompt; live.image.style = result.style; }); }
      setJob(node.id, null);
    } catch (e) { setJob(node.id, { kind: 'image', status: 'error', message: e.message, job: { kind: 'image', nodeId: node.id, prompt: result.prompt, style: result.style } }); }
  });
}
$('#imageFileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const t = S.uploadTarget || {};
  S.uploadTarget = null;
  placeImageFile(file, t.parentId || parentForNew(), t.nodeId);
});
async function placeImageFile(file, parentId, nodeId) {
  if (!/^image\//.test(file.type)) { toast('That is not a picture.'); return; }
  if (file.size > 12 * 1024 * 1024) { toast('That picture is too big (over 12 MB).', 'error'); return; }
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const small = file.size > 1.5 * 1024 * 1024 ? await shrinkDataUrl(dataUrl, 1600, 0.86) : dataUrl;
  let node = nodeId ? nodeById(S.map, nodeId) : null;
  if (!node) node = addChild(parentId, { type: 'image', text: '', image: { url: '', prompt: '', alt: file.name.replace(/\.[^.]+$/, '').slice(0, 300), width: 280 } }, { edit: false });
  if (!node) return;
  setJob(node.id, { kind: 'image', status: 'working', message: 'Uploading…' });
  try {
    const url = await storePicture(small, node.id);
    const live = nodeById(S.map, node.id);
    if (live) commit(() => { live.image.url = url; });
    setJob(node.id, null);
  } catch (e) { setJob(node.id, { kind: 'image', status: 'error', message: 'The upload failed. ' + (e.message || '') }); }
}

/* ---------- questions ---------- */
function openQuestionPicker(parentId, { topic = '', free } = {}) {
  if (S.readOnly) return;
  readAccess();
  if (!S.levels.length) {
    openModal({ title: '❓ Questions', body: '<p>Questions come from the Polymath Science question bank, so they are only for students approved for Science.</p><p class="hint">If you should have Science, ask the centre to update your subjects at My Polymath.</p>', foot: '<button class="btn btn-primary" type="button" data-close>OK</button>' });
    $('.modal-foot [data-close]').addEventListener('click', closeModal);
    return;
  }
  const m = openModal({ title: '❓ Add questions from the question bank', size: 'wide', body: '', foot: '' });
  m.body.style.padding = '0';
  m.body.style.overflow = 'hidden';
  m.body.style.flex = '1';
  m.body.footerEl = m.foot;
  mountPicker(m.body, {
    staff: S.staff, levels: S.levels,
    alreadyOnMap: S.map.nodes.filter(n => n.type === 'question').map(n => n.question.qid),
    notice: S.staff ? 'You are signed in as staff: every question is shown, with answers.' : 'Showing ' + S.levels.join(', ') + ' questions, from your Science approval.',
    // v1.1.0: where they go (under a topic, or each on its own) and whether they arrive folded.
    placement: {
      target: nodeLabel(nodeById(S.map, parentId) || nodeById(S.map, S.map.rootId)).slice(0, 40),
      free: free === undefined ? local('mindmap-q-free') === 'on' : !!free,
      folded: local('mindmap-q-folded') === 'on'
    },
    onPlace: (qs, how = {}) => {
      local('mindmap-q-free', how.free ? 'on' : 'off');
      local('mindmap-q-folded', how.folded ? 'on' : 'off');
      closeModal();
      placeQuestions(qs, parentId, how);
    }
  });
  if (topic) setTimeout(() => { const sel = $('#pkTopic', m.body); if (sel) { const iv = setInterval(() => { if (sel.options.length > 1) { sel.value = topic; sel.dispatchEvent(new Event('change')); clearInterval(iv); } }, 200); setTimeout(() => clearInterval(iv), 15000); } }, 50);
}
/**
 * Put bank questions on the map.
 *   attached (default): each is a child of `parentId`, laid out with the branch;
 *   free: each is its own container, attached to nothing, set out in a neat grid in the middle of the screen.
 * folded: the cards arrive folded to one line each (tap ▸ to open one).
 */
function placeQuestions(qs, parentId, { free = false, folded = false } = {}) {
  let firstId = '';
  const placed = [];
  commit(() => {
    const parent = nodeById(S.map, parentId) || nodeById(S.map, S.map.rootId);
    const size = folded ? { w: 320, h: 86 } : { w: 400, h: 280 };
    // Free cards: a grid of up to three across, starting at the centre of what is on screen, below anything already there.
    const r = ui.viewport.getBoundingClientRect();
    const centre = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const cols = Math.min(3, Math.max(1, qs.length));
    const gap = 36;
    const startX = Math.round(centre.x - ((cols - 1) * (size.w + gap)) / 2);
    let startY = Math.round(centre.y - size.h / 2);
    if (free) {
      // Do not land on top of another free card: step down until the spot is clear.
      const clash = (x, y) => S.map.nodes.some(o => Math.abs(o.x - x) < (size.w + (o.w || 160)) / 2 && Math.abs(o.y - y) < (size.h + (o.h || 46)) / 2);
      let guard = 0;
      while (guard++ < 30 && qs.slice(0, cols).some((_, i) => clash(startX + i * (size.w + gap), startY))) startY += size.h + gap;
    }
    qs.forEach((q, i) => {
      if (S.map.nodes.length >= LIMITS.nodes) return;
      const snap = snapshotOf(q);
      snap.folded = !!folded;
      let n;
      if (free) {
        const x = startX + (i % cols) * (size.w + gap);
        const y = startY + Math.floor(i / cols) * (size.h + gap);
        n = normalizeNode({ id: makeId('n'), type: 'question', parentId: '', x, y, w: size.w, h: size.h, text: snap.title, color: 'blue', question: snap });
      } else {
        const spot = spotForNewChild(S.map, parent.id, size);
        n = normalizeNode({ id: makeId('n'), type: 'question', parentId: parent.id, x: spot.x, y: spot.y, w: size.w, h: size.h, text: snap.title, color: 'blue', question: snap });
        if (parent.id === S.map.rootId && spot.side) n.side = spot.side;
      }
      S.map.nodes.push(n);
      placed.push(n.id);
      if (!firstId) firstId = n.id;
    });
    if (!free) parent.collapsed = false;
    if (mapBytes(serializeMap(S.map)) > LIMITS.mapBytes) { toast('That is too much for one map. Try fewer questions.', 'error'); return false; }
  });
  if (!placed.length) return;
  // Lay out once the cards have been measured (free cards keep their places; the branch is tidied).
  requestAnimationFrame(() => {
    if (!free) tidyUp(true);
    setTimeout(() => { if (placed.length > 1) fitTo(placed); else if (firstId) centerOn(firstId); }, 400);
  });
  const what = qs.length === 1 ? '1 question' : qs.length + ' questions';
  toast('Placed ' + what + (free ? ' on ' + (qs.length === 1 ? 'its' : 'their') + ' own' : '') + (folded ? '. Tap ▸ to open one.' : '.'), 'good');
}

/* ---------- voice ---------- */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = {
  mode: SpeechRec ? (local('mindmap-voice-mode') || 'live') : 'record',
  active: false,
  rec: null,
  recorder: null,
  stream: null,
  analyser: null,
  pending: '',
  pendingTimer: 0,
  interim: '',
  queue: [],
  busy: false,
  recent: [],
  speaking: false,
  restartTimer: 0,
  silenceSince: 0,
  heardSpeech: false,
  meterRaf: 0,
  lastHeard: 0
};
function setVoiceStatus(text) { $('#voiceStatus').textContent = text; }
function setMicState() {
  const b = $('#micBtn');
  b.classList.toggle('is-live', voice.active && !voice.busy);
  b.classList.toggle('is-thinking', voice.busy);
  b.setAttribute('aria-pressed', String(voice.active));
  b.textContent = voice.active ? (voice.busy ? '💭' : '⏹') : '🎙';
  b.setAttribute('aria-label', voice.active ? 'Stop listening' : 'Build by voice');
  $('#voiceModeBtn').textContent = voice.mode === 'live' ? 'Live' : 'Recorder';
  $('#voiceLevel').hidden = !(voice.active && voice.mode === 'record');
}
function showTranscript(finalText, interim = '') {
  $('#voiceTranscript').innerHTML = escapeHtml(finalText) + (interim ? ' <span class="interim">' + escapeHtml(interim) + '</span>' : '');
}
$('#voiceModeBtn').addEventListener('click', () => {
  if (!SpeechRec) { toast('This browser has no live speech recognition, so the mic records and the AI writes down what you said.'); return; }
  const wasActive = voice.active;
  if (wasActive) stopVoice();
  voice.mode = voice.mode === 'live' ? 'record' : 'live';
  local('mindmap-voice-mode', voice.mode);
  toast(voice.mode === 'live' ? 'Live mode: your words appear as you speak.' : 'Recorder mode: each thing you say is recorded and written down by the AI (works well in noisy rooms).');
  setMicState();
  if (wasActive) startVoice();
});
$('#micBtn').addEventListener('click', () => (voice.active ? stopVoice() : startVoice()));

async function startVoice() {
  if (S.readOnly) return;
  voice.active = true;
  voice.lastHeard = Date.now();
  setMicState();
  if (voice.mode === 'live' && SpeechRec) startLive();
  else await startRecorder();
  idleWatch();
}
function stopVoice(reason) {
  voice.active = false;
  clearTimeout(voice.restartTimer);
  try { voice.rec && voice.rec.stop(); } catch (e) {}
  voice.rec = null;
  stopRecorder(true);
  if (voice.pending.trim()) flushPending();
  setVoiceStatus(reason || 'Tap the mic and talk to build your map');
  setMicState();
}
function idleWatch() {
  // Two quiet minutes and the mic switches itself off: a forgotten mic is a privacy problem.
  const tick = () => {
    if (!voice.active) return;
    if (Date.now() - voice.lastHeard > 120000) { stopVoice('The mic switched off after two quiet minutes'); return; }
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && voice.active) stopVoice('The mic switched off when you left the page'); });

function startLive() {
  const rec = new SpeechRec();
  voice.rec = rec;
  rec.lang = 'en-SG';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  setVoiceStatus('Listening… say what to add');
  rec.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) addHeard(r[0].transcript);
      else interim += r[0].transcript;
    }
    voice.interim = interim;
    if (interim) voice.lastHeard = Date.now();
    showTranscript(voice.pending, interim);
  };
  rec.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { stopVoice('The microphone is blocked. Allow it in the browser to talk.'); return; }
    if (ev.error === 'language-not-supported') { rec.lang = 'en-GB'; return; }
    if (ev.error === 'network') { voice.mode = 'record'; toast('Live speech needs a connection to the browser\'s speech service. Switching to recorder mode.'); stopVoice(); startVoice(); }
  };
  rec.onend = () => {
    if (!voice.active || voice.mode !== 'live' || voice.rec !== rec) return;
    if (voice.speaking) return; // resumed after the reply is spoken
    voice.restartTimer = setTimeout(() => { try { rec.start(); } catch (e) {} }, 250);
  };
  try { rec.start(); } catch (e) { stopVoice('The microphone could not start.'); }
}
function addHeard(text) {
  text = String(text || '').trim();
  if (!text) return;
  voice.lastHeard = Date.now();
  voice.pending = (voice.pending + ' ' + text).trim();
  showTranscript(voice.pending);
  clearTimeout(voice.pendingTimer);
  // Wait for a short pause, so "add roots … and stem … and leaves" is one command.
  voice.pendingTimer = setTimeout(flushPending, 1100);
}
function flushPending() {
  clearTimeout(voice.pendingTimer);
  const text = voice.pending.trim();
  voice.pending = '';
  if (!text) return;
  enqueueCommand(text);
}

async function startRecorder() {
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    stopVoice('The microphone is blocked. Allow it in the browser to talk.');
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  try {
    const ac = new AC();
    const src = ac.createMediaStreamSource(voice.stream);
    const an = ac.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    voice.analyser = an;
    voice.audioCtx = ac;
  } catch (e) { voice.analyser = null; }
  recordOne();
}
function recordOne() {
  if (!voice.active || !voice.stream) return;
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const type = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try { rec = new MediaRecorder(voice.stream, type ? { mimeType: type } : undefined); }
  catch (e) { stopVoice('This browser cannot record audio.'); return; }
  const chunks = [];
  voice.recorder = rec;
  voice.heardSpeech = false;
  voice.silenceSince = performance.now();
  const startedAt = performance.now();
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = async () => {
    const heard = voice.heardSpeech;
    if (voice.active) setTimeout(recordOne, 120); // keep listening while the last one is written down
    if (!heard || !chunks.length) return;
    const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
    setVoiceStatus('Writing down what you said…');
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
      const text = await transcribe(b64, (blob.type || 'audio/webm').split(';')[0]);
      if (text && !/^\(?(silence|no speech|inaudible)\)?\.?$/i.test(text)) { showTranscript(text); enqueueCommand(text); }
      else setVoiceStatus(voice.active ? 'Listening… say what to add' : 'Tap the mic and talk to build your map');
    } catch (e) {
      setVoiceStatus('Could not write that down. Please say it again.');
    }
  };
  rec.start(250);
  setVoiceStatus('Listening… say what to add');
  const bars = $$('#voiceLevel i');
  const data = voice.analyser ? new Uint8Array(voice.analyser.fftSize) : null;
  const meter = () => {
    if (voice.recorder !== rec || rec.state !== 'recording') return;
    const now = performance.now();
    let level = 0;
    if (voice.analyser) {
      voice.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      level = Math.sqrt(sum / data.length);
    } else level = 0.05;
    bars.forEach((b, i) => { b.style.height = Math.max(3, Math.min(12, level * 120 * (0.6 + ((i * 37) % 5) / 6))) + 'px'; });
    if (level > 0.035) { voice.heardSpeech = true; voice.silenceSince = now; voice.lastHeard = Date.now(); }
    const quietFor = now - voice.silenceSince;
    // Stop at a pause after speech, at 30 s, or after 8 s of nothing at all (and start again).
    if ((voice.heardSpeech && quietFor > 1300) || now - startedAt > 30000 || (!voice.heardSpeech && now - startedAt > 8000)) { try { rec.stop(); } catch (e) {} return; }
    voice.meterRaf = requestAnimationFrame(meter);
  };
  voice.meterRaf = requestAnimationFrame(meter);
}
function stopRecorder(all) {
  cancelAnimationFrame(voice.meterRaf);
  if (voice.recorder && voice.recorder.state === 'recording') { try { voice.recorder.stop(); } catch (e) {} }
  voice.recorder = null;
  if (all) {
    if (voice.stream) voice.stream.getTracks().forEach(t => t.stop());
    voice.stream = null;
    try { voice.audioCtx && voice.audioCtx.close(); } catch (e) {}
    voice.audioCtx = null; voice.analyser = null;
  }
}

/* Typed commands go the same way as spoken ones. */
$('#commandForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#commandInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  showTranscript(text);
  enqueueCommand(text);
});

function enqueueCommand(text) {
  voice.queue.push(text);
  if (!voice.busy) processQueue();
}
async function processQueue() {
  if (voice.busy) return;
  const text = voice.queue.shift();
  if (!text) return;
  voice.busy = true;
  setMicState();
  try { await handleCommand(text); }
  finally {
    voice.busy = false;
    setMicState();
    if (voice.queue.length) processQueue();
    else setVoiceStatus(voice.active ? 'Listening… say what to add' : 'Tap the mic and talk to build your map');
  }
}
/** Quick commands that need no AI (and should feel instant). */
function localCommand(text) {
  const t = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  if (/^(undo|undo that|take that back)$/.test(t)) { undo(); return 'Undone.'; }
  if (/^(redo|redo that)$/.test(t)) { redo(); return 'Redone.'; }
  if (/^(tidy( it)?( up)?|clean( it)? up|arrange( the map)?)$/.test(t)) { $('#toolTidy').click(); return 'Tidied up.'; }
  if (/^(zoom in|closer)$/.test(t)) { zoomAt(1.3); return 'Zoomed in.'; }
  if (/^(zoom out|further)$/.test(t)) { zoomAt(1 / 1.3); return 'Zoomed out.'; }
  if (/^(fit|show everything|show the whole map|fit (it|the map)( on screen)?)$/.test(t)) { fitAll(); return 'Here is the whole map.'; }
  if (/^(stop|stop listening|that's all|thank you|thanks)$/.test(t)) { stopVoice(); return 'Okay, I have stopped listening.'; }
  if (/^(save|save (it|the map))$/.test(t)) { saveNow(true); return 'Saved.'; }
  return '';
}
async function handleCommand(text) {
  const quick = localCommand(text);
  if (quick) { showReply(quick); return; }
  if (S.readOnly) { showReply('This shared map is read-only. Make your own copy to build on it.'); return; }
  setVoiceStatus('Thinking…');
  try {
    let topics = [];
    if (S.levels.length && bankState().status === 'ready') topics = bankTopics(pickableQuestions({ staff: S.staff, levels: S.levels })).map(t => t.topic);
    const { text: raw } = await aiText(voiceUserPrompt(S.map, S.selected, text, voice.recent), {
      system: voiceSystemPrompt({ topicNames: topics, levels: S.levels.length ? S.levels : BANK_LEVELS }),
      json: true, maxTokens: 5000, temperature: 0.3, order: ['gemini', 'openai-light', 'openai']
    });
    const plan = parseAiJson(raw);
    const ops = Array.isArray(plan.ops) ? plan.ops : Array.isArray(plan) ? plan : [];
    let result = null;
    if (ops.length) {
      commit(() => {
        result = applyOps(S.map, ops, { selectedId: S.selected, size: f => defaultSize(f.type || 'topic') });
        if (!result.created.length && !result.changed.length && !result.removed.length && !result.jobs.length && S.map.title === $('#mapTitle').value && !ops.some(o => o && o.op === 'connect')) return false;
        $('#mapTitle').value = S.map.title;
      });
    }
    if (result) {
      if (result.select && nodeById(S.map, result.select)) { setSelected(result.select); centerOn(result.select); }
      if (result.tidy) { requestAnimationFrame(() => { tidyUp(true); if (result.created.length > 4) setTimeout(() => fitAll(), 420); }); }
      for (const job of result.jobs) runJob(job);
      if (result.errors.length) toast(result.errors[0]);
    }
    const say = String(plan.say || (ops.length ? 'Done.' : 'I am not sure what to change. Try saying it another way.')).slice(0, 300);
    showReply(say);
    voice.recent.push({ said: text, reply: say });
    if (voice.recent.length > 8) voice.recent.shift();
  } catch (e) {
    showReply(e.message || 'Something went wrong. Please try again.');
  }
}
function showReply(text) {
  $('#voiceReply').textContent = text;
  if (S.speak && voice.active && 'speechSynthesis' in window) speak(text);
}
function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 1.05;
    const voices = speechSynthesis.getVoices();
    const pick = voices.find(v => /en-(SG|GB)/i.test(v.lang) && /female|samantha|serena|libby|sonia|google uk english female/i.test(v.name)) || voices.find(v => /en-(SG|GB)/i.test(v.lang));
    if (pick) u.voice = pick;
    // Pause live recognition while speaking so the mic does not hear the reply.
    if (voice.mode === 'live' && voice.rec) { voice.speaking = true; try { voice.rec.stop(); } catch (e) {} }
    u.onend = u.onerror = () => {
      voice.speaking = false;
      if (voice.active && voice.mode === 'live' && voice.rec) { try { voice.rec.start(); } catch (e) {} }
    };
    speechSynthesis.speak(u);
  } catch (e) { voice.speaking = false; }
}

/* =====================================================================
   7. CODE WINDOWS
   ===================================================================== */
function codeSource(n) { return buildSandboxDoc(n.code, { channel: n.id }); }
function loadCodeFrame(n, force = false) {
  const rec = els.get(n.id);
  const frame = rec && $('.code-frame', rec.el);
  if (!frame) return;
  const has = !!(n.code.html || n.code.css || n.code.js);
  const src = has ? codeSource(n) : '';
  if (!force && S.codeKeys.get(n.id) === src) return;
  S.codeKeys.set(n.id, src);
  S.consoles.set(n.id, []);
  frame.srcdoc = src || '<!doctype html><html><body></body></html>';
}
function rerunCode(id) {
  const n = nodeById(S.map, id);
  if (!n || n.type !== 'code') return;
  const rec = els.get(id);
  if (rec) rec.hash = '';
  S.codeKeys.delete(id);
  render();
  loadCodeFrame(n, true);
  if (ui.studio && ui.studio.id === id) ui.studio.run();
}
function drawConsole(id) {
  const rec = els.get(id);
  const box = rec && $('.code-console', rec.el);
  if (!box) return;
  const lines = (S.consoles.get(id) || []).filter(l => l.kind === 'error' || l.kind === 'warn').slice(-4);
  box.hidden = !lines.length;
  box.innerHTML = lines.map(l => `<div class="${l.kind}">${escapeHtml(l.text)}</div>`).join('');
}
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || typeof d.mindmapConsole !== 'string') return;
  // Trust a message only from the iframe it names.
  const id = d.mindmapConsole;
  const rec = els.get(id);
  const frame = rec && $('.code-frame', rec.el);
  const studioFrame = ui.studio && ui.studio.id === id ? ui.studio.frame : null;
  if (!((frame && e.source === frame.contentWindow) || (studioFrame && e.source === studioFrame.contentWindow))) return;
  if (d.kind === 'size') return;
  const list = S.consoles.get(id) || [];
  list.push({ kind: ['log', 'info', 'warn', 'error'].includes(d.kind) ? d.kind : 'log', text: String(d.text || '').slice(0, 2000) });
  if (list.length > 60) list.splice(0, list.length - 60);
  S.consoles.set(id, list);
  drawConsole(id);
  if (ui.studio && ui.studio.id === id) ui.studio.drawConsole();
});

/** The big editor: code on the left, the running app on the right, AI along the bottom. */
function openCodeStudio(id) {
  const n = nodeById(S.map, id);
  if (!n || n.type !== 'code') return;
  let tab = n.code.html || !(n.code.css || n.code.js) ? 'html' : (n.code.js ? 'js' : 'css');
  const ro = S.readOnly;
  const m = openModal({
    title: '💻 ' + (n.code.title || 'Learning app'), size: 'wide',
    body: `<div class="code-studio">
        <div class="editor-side">
          <div class="seg" id="csTabs">${[['html', 'HTML'], ['css', 'CSS'], ['js', 'JavaScript']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'is-on' : ''}">${l}</button>`).join('')}</div>
          <textarea class="textarea code-area" id="csCode" spellcheck="false" ${ro ? 'readonly' : ''}></textarea>
        </div>
        <div class="run-side">
          <iframe id="csFrame" sandbox="${SANDBOX_FLAGS}" referrerpolicy="no-referrer" title="App preview"></iframe>
          <div class="code-console" id="csConsole" style="max-height:110px"></div>
        </div>
      </div>
      ${ro ? '' : `<div class="ai-row"><input class="input" id="csAsk" placeholder="✨ Ask the AI to change it: e.g. add a score counter" autocomplete="off"><button class="btn btn-primary" type="button" id="csAskBtn">✨ Change</button></div>`}`,
    foot: `<span class="grow">Ctrl+Enter runs it. 🔒 Sandboxed: the app cannot reach this page or your account.</span>
      <button class="btn" type="button" id="csDownload">⬇ Download .html</button><button class="btn btn-primary" type="button" id="csRun">▶ Run</button>`,
    onClose: () => { ui.studio = null; endField(); rerunCode(id); }
  });
  m.body.style.padding = '0';
  m.body.style.flex = '1';
  m.body.style.overflow = 'hidden';
  const ta = $('#csCode', m.body);
  const frame = $('#csFrame', m.body);
  const studio = {
    id, frame,
    run: () => { const live = nodeById(S.map, id); if (live) { S.consoles.set(id, []); studio.drawConsole(); frame.srcdoc = codeSource(live); } },
    drawConsole: () => { $('#csConsole', m.body).innerHTML = (S.consoles.get(id) || []).slice(-30).map(l => `<div class="${l.kind}">${escapeHtml(l.text)}</div>`).join('') || '<div style="color:var(--text-tertiary)">Console output appears here.</div>'; }
  };
  ui.studio = studio;
  const showTab = () => { const live = nodeById(S.map, id); ta.value = live ? live.code[tab] || '' : ''; $$('[data-tab]', m.body).forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab)); };
  showTab();
  studio.run();
  $$('[data-tab]', m.body).forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; showTab(); }));
  let timer = 0;
  ta.addEventListener('input', () => {
    const live = nodeById(S.map, id);
    if (!live) return;
    liveEdit(() => { live.code[tab] = ta.value.slice(0, LIMITS.codePart); });
    clearTimeout(timer);
    if (local('mindmap-autorun') !== 'off') timer = setTimeout(studio.run, 700);
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); studio.run(); }
  });
  $('#csRun', m.foot).addEventListener('click', studio.run);
  $('#csDownload', m.foot).addEventListener('click', () => { const live = nodeById(S.map, id); if (live) download(safeName(live.code.title) + '.html', buildSandboxDoc(live.code, { bridge: false }), 'text/html'); });
  const askBtn = $('#csAskBtn', m.body);
  if (askBtn) {
    const go = async () => {
      const ask = $('#csAsk', m.body).value.trim();
      if (!ask) return;
      busy(askBtn, true);
      const live = nodeById(S.map, id);
      const has = live && (live.code.html || live.code.css || live.code.js);
      await jobApp(has ? { kind: 'update_app', nodeId: id, change: ask } : { kind: 'build_app', nodeId: id, title: live.code.title, description: ask });
      busy(askBtn, false);
      if (ui.studio === studio) { $('#csAsk', m.body).value = ''; tab = 'html'; showTab(); studio.run(); }
    };
    askBtn.addEventListener('click', go);
    $('#csAsk', m.body).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
}

/* =====================================================================
   8. SAVING, OPENING, SHARING
   ===================================================================== */
function setStatus(text, kind = '') {
  const el = $('#saveStatus');
  el.textContent = text;
  el.className = 'save-status' + (kind ? ' is-' + kind : '');
}
function backupLocal() {
  if (!S.user || !S.map || S.readOnly) return;
  try { localStorage.setItem('polymath-mindmap:backup:' + S.user.uid, JSON.stringify(serializeMap(S.map))); } catch (e) { /* full: the cloud copy is the real one */ }
}
async function saveNow(announce = false) {
  clearTimeout(S.saveTimer);
  if (!S.user || !S.map || S.readOnly) return;
  if (!S.dirty) { if (announce) setStatus('All changes saved · ' + timeLabel(S.savedAt || Date.now())); return; }
  if (S.saving) { S.saveTimer = setTimeout(saveNow, 800); return; }
  const data = serializeMap(S.map);
  const bytes = mapBytes(data);
  if (bytes > LIMITS.mapBytes) {
    setStatus('Too big to save — remove a few pictures or apps', 'error');
    toast('This map is too big to save (' + Math.round(bytes / 1024) + ' KB). Remove some pictures, apps or questions, or split it into two maps.', 'error', { ms: 7000 });
    return;
  }
  S.saving = true;
  S.dirty = false;
  setStatus('Saving…');
  try {
    const now = Date.now();
    await fb.setDoc(fb.doc(db, 'mindmaps', data.id), {
      ...data,
      ownerUid: S.user.uid,
      ownerName: S.user.displayName || '',
      ownerEmail: S.user.email || '',
      updatedAt: new Date(now).toISOString(),
      updatedAtMs: now,
      nodeCount: data.nodes.length,
      // v1.2.0: published maps show to every student under "Mr Chung's Maps". Only a publisher's map can stay published.
      published: !!(S.published && S.publisher),
      publishedAtMs: S.published && S.publisher ? (S.publishedAtMs || now) : 0,
      app: 'polymath-mindmap',
      appVersion: MINDMAP_VERSION
    });
    S.savedAt = now;
    S.saveError = '';
    local('polymath-mindmap:last:' + S.user.uid, data.id);
    setStatus('All changes saved · ' + timeLabel(now));
  } catch (e) {
    console.warn('[mindmap] save failed', e);
    S.dirty = true;
    S.saveError = String(e && e.message || e);
    setStatus('Not saved — will try again (a copy is kept on this device)', 'error');
    S.saveTimer = setTimeout(saveNow, 8000);
  } finally { S.saving = false; }
}
window.addEventListener('beforeunload', e => {
  if (S.map && S.dirty && !S.readOnly) { backupLocal(); saveNow(); e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.dirty) saveNow(); });

async function listMyMaps() {
  const snap = await fb.getDocs(fb.query(fb.collection(db, 'mindmaps'), fb.where('ownerUid', '==', S.user.uid)));
  const out = [];
  snap.forEach(d => { const v = d.data(); out.push({ id: d.id, title: v.title || 'Untitled', updatedAtMs: v.updatedAtMs || Date.parse(v.updatedAt || '') || 0, nodeCount: v.nodeCount || (v.nodes || []).length, raw: v }); });
  return out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
/**
 * v1.2.0 — Mr Chung's Maps: the maps a publisher (Mr Chung, admin@, support@) chose to push to every student.
 * One equality query (no index needed); only maps owned by a publisher address are shown, newest first.
 */
async function listPublishedMaps() {
  const snap = await fb.getDocs(fb.query(fb.collection(db, 'mindmaps'), fb.where('published', '==', true)));
  const out = [];
  snap.forEach(d => {
    const v = d.data();
    if (!isPublisherAddress(v.ownerEmail)) return;
    out.push({ id: d.id, title: v.title || 'Untitled', updatedAtMs: v.updatedAtMs || Date.parse(v.updatedAt || '') || 0,
      publishedAtMs: Number(v.publishedAtMs) || 0, nodeCount: v.nodeCount || (v.nodes || []).length, ownerUid: v.ownerUid, raw: v });
  });
  return out.sort((a, b) => (b.publishedAtMs || b.updatedAtMs) - (a.publishedAtMs || a.updatedAtMs));
}
/** The header chip and the ⋯ menu item follow the open map. */
function updatePublishUi() {
  const chip = $('#publishChip');
  if (chip) chip.hidden = !(S.published && !S.readOnly);
  const item = $('#publishMenuItem');
  if (item) {
    item.hidden = !S.publisher || S.readOnly;
    item.textContent = S.published ? '📌 Unpublish (hide from students)' : '📌 Publish to students';
  }
}
/** Publish or unpublish one of the publisher's own maps. Students see it (read-only) under Mr Chung's Maps. */
async function setPublished(mapId, on) {
  if (!S.publisher) { toast('Only Mr Chung can publish maps to students.'); return false; }
  const isOpen = S.map && S.map.id === mapId && !S.readOnly;
  if (isOpen && S.dirty) await saveNow();
  const now = Date.now();
  try {
    await fb.setDoc(fb.doc(db, 'mindmaps', mapId), { published: !!on, publishedAtMs: on ? now : 0 }, { merge: true });
  } catch (e) { toast('Could not ' + (on ? 'publish' : 'unpublish') + ': ' + (e.message || e), 'error'); return false; }
  if (isOpen) { S.published = !!on; S.publishedAtMs = on ? now : 0; updatePublishUi(); }
  toast(on ? 'Published. Every student now sees this map under Mr Chung\'s Maps.' : 'Unpublished. Students no longer see this map.', 'good');
  return true;
}

function useMap(raw, { readOnly = false } = {}) {
  for (const rec of els.values()) rec.el.remove();
  els.clear();
  S.codeKeys.clear();
  S.consoles.clear();
  S.jobs.clear();
  S.history.clear();
  S.map = normalizeMap(raw);
  S.map._fresh = true;
  S.selected = '';
  S.selectedLink = '';
  S.readOnly = readOnly;
  S.dirty = false;
  S.inspectorFor = null;
  S.sharedOwner = readOnly ? (raw.ownerName || 'someone') : '';
  S.published = raw.published === true;
  S.publishedAtMs = Number(raw.publishedAtMs) || 0;
  const fromMrChung = readOnly && S.published && isPublisherAddress(raw.ownerEmail);
  $('#mapTitle').value = S.map.title;
  $('#mapTitle').readOnly = readOnly;
  $('#readonlyBanner').hidden = !readOnly;
  $('#readonlyText').textContent = !readOnly ? '' : fromMrChung
    ? '📌 “' + S.map.title + '” is one of Mr Chung\'s Maps. You can look, fold and try the questions; make your own copy to change it.'
    : 'You are viewing “' + S.map.title + '”, shared by ' + S.sharedOwner + '.';
  updatePublishUi();
  setStatus(readOnly ? 'Read-only' : (raw.updatedAtMs ? 'Saved · ' + timeLabel(raw.updatedAtMs) : 'Not saved yet'), readOnly ? 'readonly' : '');
  render();
  const v = S.map.view;
  if (!raw.view || (!v.x && !v.y && v.zoom === 1)) requestAnimationFrame(() => { render(); fitAll(false); });
  else applyView();
  // Placeholders left by a closed tab: offer to finish them.
  for (const n of S.map.nodes) {
    if (!readOnly && n.type === 'image' && !n.image.url && n.image.prompt) S.jobs.set(n.id, { kind: 'image', status: 'error', message: 'This picture was not finished.', job: { kind: 'image', nodeId: n.id, prompt: n.image.prompt, style: n.image.style } });
  }
  if (S.jobs.size) render();
  if (!readOnly && S.user) local('polymath-mindmap:last:' + S.user.uid, S.map.id);
  updateUrl(readOnly ? S.map.id : '');
  onboarding();
}
function updateUrl(sharedId) {
  try {
    const u = new URL(location.href);
    if (sharedId) u.searchParams.set('map', sharedId); else u.searchParams.delete('map');
    history.replaceState(null, '', u.toString());
  } catch (e) {}
}
function newBlankMap(title = 'My mind map') {
  if (S.dirty) saveNow();
  const m = newMap({ title, ownerUid: S.user.uid, ownerName: S.user.displayName || '', ownerEmail: S.user.email || '' });
  useMap(m);
  S.dirty = true;
  saveNow();
  setSelected(m.rootId);
  requestAnimationFrame(() => startEditing(m.rootId, true));
}
async function openMapById(id, { quiet = false } = {}) {
  try {
    const snap = await fb.getDoc(fb.doc(db, 'mindmaps', id));
    if (!snap.exists()) { if (!quiet) toast('That mind map no longer exists.', 'error'); return false; }
    const raw = { ...snap.data(), id: snap.id };
    const mine = raw.ownerUid === S.user.uid;
    useMap(raw, { readOnly: !mine });
    return true;
  } catch (e) {
    if (!quiet) toast('That mind map could not be opened: ' + (e.message || e), 'error');
    return false;
  }
}
async function startApp() {
  setStatus('Opening…');
  const params = new URLSearchParams(location.search);
  const shared = params.get('map');
  if (shared && /^[A-Za-z0-9_-]{1,64}$/.test(shared) && await openMapById(shared)) return;
  const last = local('polymath-mindmap:last:' + S.user.uid);
  if (last && await openMapById(last, { quiet: true })) { offerBackup(); return; }
  try {
    const list = await listMyMaps();
    if (list.length) { useMap({ ...list[0].raw, id: list[0].id }); offerBackup(); return; }
  } catch (e) { console.warn('[mindmap] list maps', e); }
  // A device copy that never reached the cloud (offline last time)?
  const backup = local('polymath-mindmap:backup:' + S.user.uid);
  if (backup) { try { useMap(JSON.parse(backup)); S.dirty = true; saveNow(); return; } catch (e) {} }
  newBlankMap();
}
function offerBackup() {
  const backup = local('polymath-mindmap:backup:' + S.user.uid);
  if (!backup) return;
  try {
    const b = normalizeMap(JSON.parse(backup));
    if (b.id === S.map.id && Date.parse(b.updatedAt) > Date.parse(S.map.updatedAt) + 3000) {
      toast('This device has newer changes to this map that were not saved.', '', { action: 'Restore them', onAction: () => { useMap(b); S.dirty = true; saveNow(); }, ms: 12000 });
    }
  } catch (e) {}
}

async function openMapsModal() {
  const m = openModal({ title: '📂 Mind maps', size: 'mid', body: '<div class="loading-bar"><i></i></div>',
    foot: `<button class="btn" type="button" id="mmImport">⬆️ Open a file</button><span class="grow"></span><button class="btn" type="button" id="mmAi">🪄 Build one with AI</button><button class="btn btn-primary" type="button" id="mmNew">✨ New mind map</button>` });
  $('#mmNew', m.foot).addEventListener('click', () => { closeModal(); newBlankMap(); });
  $('#mmAi', m.foot).addEventListener('click', () => { closeModal(); openAiMapModal(); });
  $('#mmImport', m.foot).addEventListener('click', () => { closeModal(); $('#fileInput').click(); });
  try {
    if (S.dirty) await saveNow();
    // v1.2.0: Mr Chung's Maps first (for every student), then the student's own maps.
    const [list, published] = await Promise.all([
      listMyMaps(),
      listPublishedMaps().catch(e => { console.warn('[mindmap] published maps', e); return []; })
    ]);
    if (ui.modal !== m) return;
    const card = (x, { mine, fromMrChung }) => `<div class="map-card${S.map && x.id === S.map.id ? ' is-current' : ''}" role="button" tabindex="0" data-open="${x.id}" data-from="${fromMrChung ? 'published' : 'mine'}">
        <b>${escapeHtml(x.title)}</b>
        ${fromMrChung ? '<span class="by">by Mr Chung</span>' : ''}
        ${mine && x.raw.published && S.publisher ? '<span class="pub-tag">📌 Published to students</span>' : ''}
        <small>${x.nodeCount} item${x.nodeCount === 1 ? '' : 's'} · ${escapeHtml(timeLabel(fromMrChung ? (x.publishedAtMs || x.updatedAtMs) : x.updatedAtMs))}</small>
        ${mine && S.publisher ? `<button class="map-pub${x.raw.published ? ' is-on' : ''}" type="button" data-pub="${x.id}" aria-label="${x.raw.published ? 'Unpublish' : 'Publish'} ${escapeHtml(x.title)}" title="${x.raw.published ? 'Published: tap to hide it from students' : 'Publish to students (Mr Chung\'s Maps)'}">📌</button>` : ''}
        ${mine ? `<button class="map-del" type="button" data-del="${x.id}" aria-label="Delete ${escapeHtml(x.title)}" title="Delete">🗑</button>` : ''}</div>`;
    m.body.innerHTML = `<input class="input" id="mmSearch" placeholder="Search maps" autocomplete="off" style="margin-bottom:14px">
      <section class="maps-section is-published" id="mmPublishedWrap" ${published.length ? '' : 'hidden'}>
        <h3>📌 Mr Chung's Maps</h3>
        <p>${S.publisher ? 'Every student sees these. Tap 📌 on one of your maps below to add or remove it.' : 'From your teacher, for reference. Open one to look, or make your own copy to change it.'}</p>
        <div class="maps-list" id="mmPublished"></div>
      </section>
      <section class="maps-section">
        <h3>🗂 My maps</h3>
        ${S.publisher ? '<p>Tap 📌 on a map to publish it to every student, or tap it again to hide it.</p>' : ''}
        <div class="maps-list" id="mmList"></div>
      </section>`;
    const draw = q => {
      const match = x => !q || x.title.toLowerCase().includes(q.toLowerCase());
      $('#mmPublished', m.body).innerHTML = published.filter(match).map(x => card(x, { mine: false, fromMrChung: true })).join('') || '<div class="empty-state">No published maps match.</div>';
      const mine = list.filter(match);
      $('#mmList', m.body).innerHTML = mine.map(x => card(x, { mine: true, fromMrChung: false })).join('') ||
        `<div class="empty-state">${list.length ? 'No maps match.' : 'No saved maps yet. Start one below.'}</div>`;
    };
    draw('');
    $('#mmSearch', m.body).addEventListener('input', e => draw(e.target.value));
    m.body.addEventListener('click', async e => {
      const pub = e.target.closest('[data-pub]');
      if (pub) {
        e.stopPropagation();
        const item = list.find(x => x.id === pub.dataset.pub);
        if (!item) return;
        const on = !item.raw.published;
        if (await setPublished(item.id, on)) {
          item.raw.published = on;
          item.raw.publishedAtMs = on ? Date.now() : 0;
          const i = published.findIndex(x => x.id === item.id);
          if (on && i < 0) published.unshift({ ...item, publishedAtMs: item.raw.publishedAtMs, ownerUid: S.user.uid });
          if (!on && i >= 0) published.splice(i, 1);
          $('#mmPublishedWrap', m.body).hidden = !published.length;
          draw($('#mmSearch', m.body).value);
        }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const item = list.find(x => x.id === del.dataset.del);
        const extra = item && item.raw.published ? ' It is published, so students will lose it too.' : ' Anyone you shared it with will lose it too.';
        if (!(await confirmBox('Delete this mind map?', '“' + (item ? item.title : '') + '” will be deleted for good.' + extra, 'Delete', true))) { openMapsModal(); return; }
        try {
          await fb.deleteDoc(fb.doc(db, 'mindmaps', del.dataset.del));
          toast('Deleted.');
          if (S.map && S.map.id === del.dataset.del) { S.dirty = false; local('polymath-mindmap:last:' + S.user.uid, null); local('polymath-mindmap:backup:' + S.user.uid, null); await startApp(); }
        } catch (err) { toast('Could not delete: ' + err.message, 'error'); }
        openMapsModal();
        return;
      }
      const cardEl = e.target.closest('[data-open]');
      if (!cardEl) return;
      closeModal();
      if (S.dirty) await saveNow();
      if (cardEl.dataset.from === 'published') {
        const item = published.find(x => x.id === cardEl.dataset.open);
        // Mr Chung opens his own published map to edit it; everyone else sees it read-only.
        if (item) useMap({ ...item.raw, id: item.id }, { readOnly: item.ownerUid !== S.user.uid });
      } else {
        const item = list.find(x => x.id === cardEl.dataset.open);
        if (item) useMap({ ...item.raw, id: item.id });
      }
    });
    m.body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.open) e.target.click(); });
  } catch (e) {
    if (ui.modal === m) m.body.innerHTML = `<div class="empty-state">Your maps could not be loaded. ${escapeHtml(e.message || '')}</div>`;
  }
}
function openAiMapModal() {
  const m = openModal({ title: '🪄 Build a whole map with AI',
    body: `<label class="field">What is it about?<input class="input" id="amTopic" placeholder="e.g. The water cycle" maxlength="200"></label>
      <label class="field">For<select class="select" id="amLevel"><option value="">Any level</option>${['P3', 'P4', 'P5', 'P6'].map(l => `<option>${l}</option>`).join('')}</select></label>
      <label class="row hint"><input type="checkbox" id="amNew" checked> Start a new map (untick to add to this one)</label>`,
    foot: `<button class="btn" type="button" data-close-x>Cancel</button><button class="btn btn-primary" type="button" id="amGo">🪄 Build</button>` });
  $('[data-close-x]', m.foot).addEventListener('click', closeModal);
  const go = async () => {
    const topic = $('#amTopic', m.body).value.trim();
    if (!topic) { toast('Type what the map is about first.'); return; }
    const level = $('#amLevel', m.body).value;
    const fresh = $('#amNew', m.body).checked;
    busy($('#amGo', m.foot), true);
    if (fresh) { newBlankMap(topic); finishEditing(true); }
    closeModal();
    toast('Building your map…');
    await buildMapFromTopic(topic, level, null);
  };
  $('#amGo', m.foot).addEventListener('click', go);
  $('#amTopic', m.body).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
async function shareMap() {
  if (S.dirty) await saveNow();
  const url = location.origin + location.pathname + '?map=' + encodeURIComponent(S.map.id);
  const m = openModal({ title: '🔗 Share this mind map',
    body: `<p>Anyone at Polymath who signs in can open this link and see the map. They cannot change yours, but they can make their own copy.</p>
      <input class="input" id="shUrl" readonly value="${escapeHtml(url)}">`,
    foot: `<button class="btn" type="button" data-close-x>Close</button><button class="btn btn-primary" type="button" id="shCopy">📋 Copy link</button>` });
  $('[data-close-x]', m.foot).addEventListener('click', closeModal);
  $('#shCopy', m.foot).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); flashDone($('#shCopy', m.foot), '✓ Copied'); }
    catch (e) { $('#shUrl', m.body).select(); toast('Press Ctrl+C to copy the link.'); }
  });
  $('#shUrl', m.body).addEventListener('focus', e => e.target.select());
}
function duplicateMap() {
  const copy = JSON.parse(JSON.stringify(serializeMap(S.map)));
  copy.id = makeId('m');
  copy.title = (S.readOnly ? copy.title : 'Copy of ' + copy.title).slice(0, LIMITS.title);
  copy.ownerUid = S.user.uid;
  copy.ownerName = S.user.displayName || '';
  copy.ownerEmail = S.user.email || '';
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  copy.published = false;           // a copy is private until its owner publishes it
  copy.publishedAtMs = 0;
  useMap(copy);
  S.dirty = true;
  saveNow();
  toast('This copy is yours to change.', 'good');
}
$('#copySharedBtn').addEventListener('click', duplicateMap);

$('#fileInput').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.nodes)) throw new Error('not a map');
    const map = normalizeMap(data);
    map.id = makeId('m');
    map.ownerUid = S.user.uid;
    if (S.dirty) await saveNow();
    useMap(map);
    S.dirty = true;
    saveNow();
    toast('Opened “' + map.title + '”.', 'good');
  } catch (err) {
    // Not JSON: treat it as an outline and add it to this map.
    if (S.readOnly) return;
    commit(() => { importOutlineText(S.map, S.selected || S.map.rootId, text.replace(/^#\s+.*\n/, '')); }, { tidy: true });
    setTimeout(fitAll, 400);
    toast('Added the outline to this map.');
  }
});

/* ---------- header ---------- */
$('#mapTitle').addEventListener('input', e => {
  if (S.readOnly) return;
  beginField();
  S.map.title = e.target.value.slice(0, LIMITS.title) || 'My mind map';
  markDirty();
});
$('#mapTitle').addEventListener('change', endField);
$('#mapTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); ui.viewport.focus(); } });
$('#mapsBtn').addEventListener('click', openMapsModal);
$('#shareBtn').addEventListener('click', shareMap);
$('#printBtn').addEventListener('click', () => printMap());
$('#moreBtn').addEventListener('click', e => {
  e.stopPropagation();
  const menu = $('#moreMenu');
  menu.hidden = !menu.hidden;
  $('#moreBtn').setAttribute('aria-expanded', String(!menu.hidden));
  $('#speakState').textContent = S.speak ? 'on' : 'off';
});
document.addEventListener('click', e => { if (!e.target.closest('.menu')) $('#moreMenu').hidden = true; });
$('#moreMenu').addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  $('#moreMenu').hidden = true;
  switch (b.dataset.action) {
    case 'new': newBlankMap(); break;
    case 'ai-map': openAiMapModal(); break;
    case 'duplicate': duplicateMap(); break;
    case 'publish': setPublished(S.map.id, !S.published); break;
    case 'share': shareMap(); break;
    case 'outline': try { await navigator.clipboard.writeText(mapToOutline(S.map)); toast('Copied the map as an outline.', 'good'); } catch (err) { download(safeName(S.map.title) + '.md', mapToOutline(S.map), 'text/markdown'); } break;
    case 'export': download(safeName(S.map.title) + '.json', JSON.stringify(serializeMap(S.map), null, 2)); break;
    case 'import': $('#fileInput').click(); break;
    case 'print': printMap(); break;
    case 'voice-speak': S.speak = !S.speak; local('mindmap-speak', S.speak ? 'on' : 'off'); toast(S.speak ? 'Replies will be read aloud while the mic is on.' : 'Replies will not be read aloud.'); break;
    case 'help': openHelp(); break;
    case 'signout': if (S.dirty) await saveNow(); stopVoice(); signOut(); break;
  }
});

/* ---------- printing ---------- */
let printView = null;
function printMap() { prepPrint(); setTimeout(() => window.print(), 120); }
function prepPrint() {
  if (!S.map || printView) return;
  printView = { ...S.map.view };
  // A4 landscape at 96 dpi, less the margins: about 1050 × 640.
  const target = fitView(boundsOf(S.map), 1050, 640, 20, 1.2);
  Object.assign(S.map.view, target);
  applyView();
}
function endPrint() { if (printView) { Object.assign(S.map.view, printView); printView = null; applyView(); } }
window.addEventListener('beforeprint', prepPrint);
window.addEventListener('afterprint', endPrint);

/* ---------- help ---------- */
function openHelp() {
  const keys = [['Tab', 'Add a sub-topic'], ['Enter', 'Add a topic beside'], ['Shift+Enter / F2 / Space', 'Rename'], ['Type a letter', 'Rename the selected topic'], ['Delete', 'Delete'],
    ['Arrow keys', 'Move between topics'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+C / Ctrl+V', 'Copy / paste a branch'], ['Ctrl+D', 'Duplicate a branch'], ['C', 'Connect two items'],
    ['T', 'Tidy up'], ['F / Ctrl+0', 'Fit the map'], ['Ctrl+scroll / pinch', 'Zoom'], ['M', 'Mic on / off'], ['Ctrl+S', 'Save now'], ['Esc', 'Cancel / deselect']];
  const m = openModal({ title: '⌨️ Shortcuts and help', size: 'mid',
    body: `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:0.9rem">${keys.map(([k, v]) => `<b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span>`).join('')}</div>
      <h3 style="font-size:1rem;margin-top:8px">🎙 Building by voice</h3>
      <p class="hint">Tap the mic and just talk: “make a mind map about the digestive system”, “add mouth, stomach and intestines under organs”, “draw a picture of the small intestine”, “build an app that lets me drag food through the gut”, “make the app's buttons bigger”, “add three P5 questions about digestion”, “connect stomach to enzymes”. Say “undo” or “stop” any time. In Chrome, Edge and Safari your words appear as you speak (Live); the Recorder mode works everywhere.</p>
      <h3 style="font-size:1rem">💻 Code windows</h3>
      <p class="hint">Paste any HTML / CSS / JavaScript (or a whole web page) into a code window, or paste code straight onto the map. Each app runs sealed off in a sandbox, so it can never see your account or this page. Select a window to use the app; drag it by its top bar; resize it from the corner.</p>
      <h3 style="font-size:1rem">💾 Saving</h3>
      <p class="hint">Everything saves by itself to your Polymath account. Share a read-only link with 🔗 Share.</p>`,
    foot: `<span class="grow">Polymath Mind Map v${MINDMAP_VERSION}</span><button class="btn btn-primary" type="button" data-close-x>Got it</button>` });
  $('[data-close-x]', m.foot).addEventListener('click', closeModal);
}

/* ---------- first visit ---------- */
function onboarding() {
  if (S.readOnly || local('mindmap-onboarded') || S.map.nodes.length > 1) return;
  local('mindmap-onboarded', '1');
  setTimeout(() => toast('Welcome! Rename the centre, press Tab to add ideas, or tap 🎙 and say what your map is about.', '', { ms: 9000, action: 'Help', onAction: openHelp }), 900);
}

window.addEventListener('resize', () => { scheduleMinimap(); });
setMicState();
