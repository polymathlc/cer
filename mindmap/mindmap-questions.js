/* =====================================================================
   POLYMATH MIND MAP — the question bank and its picker (v1.0.0)
   ---------------------------------------------------------------------
   WHERE THE QUESTIONS COME FROM. The cer (Science) app's bank, read the
   way the cer app reads it for a student (app.js loadAdminQuestions):
     config/admin → uid of the primary admin
     userProfiles where email is one of the bank admins → the other admins
     users/{each admin}/questions → the questions (deduplicated by id)
     users/{primary}/settings/topics → the teacher's custom topic levels
   Read-only: the mind map never writes to the bank.

   WHO SEES WHAT. Staff (the access admins and the centre's teachers) see
   every question and its answer. A student sees only questions the cer app
   would serve them (released, in syllabus, not Secondary 1) at the levels
   their Science approval at /student allows, and checks an MCQ answer by
   tapping an option rather than seeing the key.

   Everything the bank stored is SANITISED before it is drawn: question
   text is rich HTML from the cer editor, so only a short list of harmless
   tags survives, with no attributes except an image's https src.
   ===================================================================== */
import { db, fb, BANK_ADMIN_EMAILS } from './mindmap-services.js';
import {
  TOPIC_LEVELS, BANK_LEVELS, questionServable, questionLevel, filterQuestions, questionHeadline, questionFirstImage,
  questionIsMcq, questionSnapshot, questionSearchText, tableRows, escapeHtml, levelRank
} from './mindmap-core.mjs?v=1.0.0';

/* ------------------------------------------------------------------ */
/*  Sanitising                                                          */
/* ------------------------------------------------------------------ */
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'H3', 'H4', 'BLOCKQUOTE', 'SMALL', 'MARK', 'HR']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META']);
let parser = null;
export function sanitizeHtml(html) {
  const source = String(html == null ? '' : html);
  if (!source.trim()) return '';
  if (!/[<&]/.test(source)) return escapeHtml(source).replace(/\n/g, '<br>');
  parser = parser || new DOMParser();
  const docu = parser.parseFromString('<div>' + source + '</div>', 'text/html');
  const rootEl = docu.body.firstElementChild;
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }          // comments
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {                                       // unwrap unknown tags, keep their text
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const keep = {};
      if (tag === 'IMG') {
        const src = child.getAttribute('src') || '';
        if (!/^https:\/\//i.test(src)) { child.remove(); continue; }
        keep.src = src;
        keep.alt = (child.getAttribute('alt') || '').slice(0, 200);
        keep.loading = 'lazy';
      }
      if (tag === 'TD' || tag === 'TH') {
        const cs = parseInt(child.getAttribute('colspan') || '', 10), rs = parseInt(child.getAttribute('rowspan') || '', 10);
        if (cs > 1 && cs < 20) keep.colspan = String(cs);
        if (rs > 1 && rs < 40) keep.rowspan = String(rs);
      }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      for (const [k, v] of Object.entries(keep)) child.setAttribute(k, v);
      walk(child);
    }
  };
  walk(rootEl);
  return rootEl.innerHTML;
}

/* ------------------------------------------------------------------ */
/*  Drawing a question                                                  */
/* ------------------------------------------------------------------ */
/**
 * HTML for a question (a bank question or a node's snapshot — both have
 * `blocks`). `interactive` turns MCQ options into buttons (data-option-id)
 * for "check my answer"; `showAnswers` draws the key (staff only).
 */
export function renderQuestionHtml(q, { showAnswers = false, interactive = false, picked = '', reveal = false } = {}) {
  const blocks = Array.isArray(q && q.blocks) ? q.blocks : [];
  const out = [];
  const answers = [];
  for (const b of blocks) {
    if (!b) continue;
    switch (b.type) {
      case 'text':
        out.push('<div class="qc-block">' + sanitizeHtml(b.content) + '</div>');
        break;
      case 'part':
        out.push('<div class="qc-block">' + (b.label ? '<span class="qc-part">' + escapeHtml(b.label) + '</span>' : '') + sanitizeHtml(b.content) + '</div>');
        break;
      case 'image':
        if (/^https:\/\//i.test(String(b.url || ''))) out.push('<img src="' + escapeHtml(b.url) + '" alt="' + escapeHtml(b.caption || 'Question picture') + '" loading="lazy">' + (b.caption ? '<div class="qc-block"><small>' + escapeHtml(b.caption) + '</small></div>' : ''));
        break;
      case 'table': {
        const rows = Array.isArray(b.rows) ? b.rows.map(r => (r && r.c) || []) : tableRows(b.data);
        if (rows.length) out.push('<table>' + rows.map(r => '<tr>' + r.map(c => '<td>' + sanitizeHtml(c) + '</td>').join('') + '</tr>').join('') + '</table>');
        break;
      }
      case 'mcq': {
        const opts = Array.isArray(b.options) ? b.options : [];
        const done = !!picked;
        out.push('<div class="qc-options">' + opts.map(o => {
          const id = String(o && o.id || '');
          let cls = 'qc-option';
          if (id && id === b.correctId && (done || reveal || showAnswers)) cls += ' is-right';
          if (done && id === picked && id !== b.correctId) cls += ' is-wrong';
          const body = sanitizeHtml(o && o.text);
          return interactive && !done
            ? '<button type="button" class="' + cls + '" data-option-id="' + escapeHtml(id) + '">' + body + '</button>'
            : '<div class="' + cls + '">' + body + '</div>';
        }).join('') + '</div>');
        if (done) {
          const right = picked === b.correctId;
          out.push('<div class="qc-answer"><b>' + (right ? '✓ Correct!' : '✗ Not quite.') + '</b>' + (right ? '' : ' The right option is highlighted in green.') + '</div>');
        }
        break;
      }
      case 'fillblank': {
        const text = String(b.text || '');
        const shown = escapeHtml(text).replace(/\[\[([\s\S]*?)\]\]/g, (m, ans) => showAnswers || reveal ? '<b class="qc-blank">' + ans + '</b>' : '<span class="qc-blank">&nbsp;</span>');
        out.push('<div class="qc-block">' + shown.replace(/\n/g, '<br>') + '</div>');
        break;
      }
      case 'studentAnswer':
        out.push('<div class="qc-mistake"><b>' + escapeHtml(b.label || "Student's Answer") + ':</b> ' + sanitizeHtml(b.answer) + '</div>');
        break;
      case 'commonMistake':
        if (showAnswers || reveal) answers.push('<div class="qc-mistake"><b>' + escapeHtml(b.title || 'Common Mistake') + ':</b> ' + sanitizeHtml(b.text) + '</div>');
        break;
      case 'answer':
        answers.push('<div class="qc-answer"><b>Answer</b>' +
          (b.claim ? '<div><b>Claim:</b> ' + sanitizeHtml(b.claim) + '</div>' : '') +
          (b.evidence ? '<div><b>Evidence:</b> ' + sanitizeHtml(b.evidence) + '</div>' : '') +
          (b.reasoning ? '<div><b>Reasoning:</b> ' + sanitizeHtml(b.reasoning) + '</div>' : '') + '</div>');
        break;
      case 'plainanswer':
        if (b.content) answers.push('<div class="qc-answer"><b>Answer:</b> ' + sanitizeHtml(b.content) + '</div>');
        break;
      case 'explanation':
        if (b.content) answers.push('<div class="qc-answer"><b>Explanation:</b> ' + sanitizeHtml(b.content) + '</div>');
        break;
      case 'workingSpace': case 'openLines': case 'answerLine':
        out.push('<div class="qc-lines" aria-hidden="true"></div>');
        break;
      default: break;
    }
  }
  if ((showAnswers || reveal) && answers.length) out.push(...answers);
  return '<div class="qc">' + (out.join('') || '<p>(This question has no text.)</p>') + '</div>';
}
export function questionHasAnswer(q) {
  return (Array.isArray(q && q.blocks) ? q.blocks : []).some(b => b && (['answer', 'plainanswer', 'explanation'].includes(b.type) || (b.type === 'mcq' && b.correctId) || (b.type === 'fillblank' && /\[\[/.test(b.text || ''))));
}

/* ------------------------------------------------------------------ */
/*  Loading the bank                                                    */
/* ------------------------------------------------------------------ */
const bank = { status: 'idle', list: [], topicLevels: { ...TOPIC_LEVELS }, error: '', promise: null, loadedAt: 0 };
export function bankState() { return bank; }

export function loadBank({ force = false, onProgress } = {}) {
  if (bank.promise && !force) return bank.promise;
  bank.status = 'loading';
  bank.error = '';
  bank.promise = (async () => {
    const cfg = await fb.getDoc(fb.doc(db, 'config', 'admin'));
    if (!cfg.exists() || !cfg.data().uid) throw new Error('The question bank has not been set up yet.');
    const primary = cfg.data().uid;
    const uids = [primary];
    try {
      const snap = await fb.getDocs(fb.query(fb.collection(db, 'userProfiles'), fb.where('email', 'in', BANK_ADMIN_EMAILS)));
      snap.forEach(d => { const p = d.data(); if (p && p.uid && !uids.includes(p.uid)) uids.push(p.uid); });
    } catch (e) { console.warn('[mindmap] other bank owners', e); }
    try {
      const t = await fb.getDoc(fb.doc(db, 'users', primary, 'settings', 'topics'));
      if (t.exists()) {
        const data = t.data() || {};
        const custom = data.custom && typeof data.custom === 'object' ? data.custom : {};
        bank.topicLevels = { ...TOPIC_LEVELS, ...custom };
        for (const removed of Array.isArray(data.removed) ? data.removed : []) delete bank.topicLevels[removed];
      }
    } catch (e) { console.warn('[mindmap] topic levels', e); }
    const seen = new Set();
    const list = [];
    let done = 0;
    for (const uid of uids) {
      try {
        const snap = await fb.getDocs(fb.collection(db, 'users', uid, 'questions'));
        snap.forEach(d => {
          const q = d.data();
          if (!q || !q.id || seen.has(q.id) || !Array.isArray(q.blocks)) return;
          seen.add(q.id);
          list.push(q);
        });
      } catch (e) { console.warn('[mindmap] bank of', uid, e); }
      done++;
      if (onProgress) onProgress(done / uids.length, list.length);
    }
    bank.list = list;
    bank.status = 'ready';
    bank.loadedAt = Date.now();
    return bank;
  })().catch(e => {
    bank.status = 'error';
    bank.error = String(e && e.message || e);
    bank.promise = null;
    throw e;
  });
  return bank.promise;
}

/** The questions this person may pick from (already gated). */
export function pickableQuestions({ staff = false, levels = BANK_LEVELS } = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return bank.list.filter(q => {
    if (staff) return !/cell\s*systems?/i.test(String(q.topic || '') + String(q.topic2 || '')) && questionLevel(q, bank.topicLevels) !== 'S1';
    if (!questionServable(q, { today, topicLevels: bank.topicLevels })) return false;
    const lv = questionLevel(q, bank.topicLevels);
    return !!lv && levels.includes(lv);
  });
}

export function bankTopics(list) {
  const set = new Map();
  for (const q of list) for (const t of [q.topic, q.topic2]) if (t && !set.has(t)) set.set(t, questionLevel({ topic: t }, bank.topicLevels));
  return [...set.entries()].sort((a, b) => levelRank(a[1]) - levelRank(b[1]) || a[0].localeCompare(b[0])).map(([topic, level]) => ({ topic, level }));
}

/** For a voice command: the best `count` questions for a search, skipping ones already on the map. */
export function findQuestions({ search = '', topic = '', level = '', count = 3, exclude = [], staff = false, levels = BANK_LEVELS } = {}) {
  const pool = pickableQuestions({ staff, levels }).filter(q => !exclude.includes(q.id));
  const topicNames = bankTopics(pool).map(t => t.topic);
  const exactTopic = topic && topicNames.find(t => t.toLowerCase() === topic.toLowerCase());
  let found = filterQuestions(pool, { search: exactTopic ? '' : search, topic: exactTopic || '', level: levels.includes(level) ? level : '', levels, topicLevels: bank.topicLevels, sort: 'newest' });
  if (!found.length && search) {
    // Any word, not every word.
    const words = search.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    found = pool.filter(q => { const hay = q._search || (q._search = questionSearchText(q)); return words.some(w => hay.includes(w)); });
  }
  if (!found.length && exactTopic) found = filterQuestions(pool, { topic: exactTopic, levels, topicLevels: bank.topicLevels });
  // A little variety: shuffle the first few dozen matches.
  const head = found.slice(0, 40);
  for (let i = head.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [head[i], head[j]] = [head[j], head[i]]; }
  return head.slice(0, count);
}

export function snapshotOf(q) { return questionSnapshot(q, bank.topicLevels); }
export function levelOf(q) { return questionLevel(q, bank.topicLevels); }

/* ------------------------------------------------------------------ */
/*  The picker                                                          */
/* ------------------------------------------------------------------ */
/**
 * Opens the picker in `host` (a modal body the page made). Calls
 * `onPlace(questions[])` with the chosen bank questions.
 */
export function mountPicker(host, { staff = false, levels = BANK_LEVELS, onPlace, onClose, alreadyOnMap = [], notice = '' }) {
  const state = {
    search: '', topic: '', level: '', kind: '', sort: 'newest', view: (() => { try { return localStorage.getItem('mindmap-picker-view') || 'tiles'; } catch (e) { return 'tiles'; } })(),
    picked: new Map(), active: '', shown: 60, answerShown: false
  };
  host.innerHTML = `
    <div class="picker">
      <aside class="picker-filters" id="pkFilters">
        <label class="field">Search<input class="input" id="pkSearch" placeholder="e.g. magnet poles" autocomplete="off"></label>
        <div class="field">Level<div class="row" id="pkLevels" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
        <label class="field">Topic<select class="select" id="pkTopic"><option value="">All topics</option></select></label>
        <label class="field">Type<select class="select" id="pkKind">
          <option value="">All questions</option><option value="mcq">Multiple choice</option><option value="open">Open-ended</option><option value="picture">With a picture</option>
        </select></label>
        <label class="field">Sort<select class="select" id="pkSort"><option value="newest">Newest first</option><option value="topic">By topic</option><option value="level">By level</option></select></label>
        <p class="hint" id="pkNotice" style="font-size:0.8rem;color:var(--text-secondary)"></p>
      </aside>
      <section class="picker-results">
        <div class="picker-toolbar">
          <button class="btn btn-small btn-ghost" id="pkFilterToggle" type="button" style="display:none">⚙ Filters</button>
          <span class="count" id="pkCount">Loading the question bank…</span>
          <div class="seg" role="group" aria-label="View">
            <button type="button" data-view="tiles">▦ Tiles</button>
            <button type="button" data-view="list">☰ List</button>
          </div>
        </div>
        <div class="loading-bar" id="pkLoading"><i></i></div>
        <div class="picker-grid" id="pkGrid" role="listbox" aria-multiselectable="true"></div>
      </section>
      <aside class="picker-preview" id="pkPreview"><div class="empty-state">Tap a question to preview it here.</div></aside>
    </div>`;
  const $ = sel => host.querySelector(sel);
  const grid = $('#pkGrid');
  if (notice) $('#pkNotice').textContent = notice;
  const narrow = () => window.matchMedia('(max-width: 640px)').matches;
  if (narrow()) $('#pkFilterToggle').style.display = '';
  $('#pkFilterToggle').addEventListener('click', () => $('#pkFilters').classList.toggle('is-open'));

  const levelsWrap = $('#pkLevels');
  levelsWrap.innerHTML = ['', ...levels].map(lv => `<button type="button" class="chip science${lv === '' ? ' is-on' : ''}" data-level="${lv}">${lv || 'All'}</button>`).join('');
  levelsWrap.addEventListener('click', e => {
    const b = e.target.closest('[data-level]'); if (!b) return;
    state.level = b.dataset.level; state.shown = 60;
    levelsWrap.querySelectorAll('.chip').forEach(c => c.classList.toggle('is-on', c === b));
    draw();
  });
  let searchTimer = 0;
  $('#pkSearch').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; state.shown = 60; draw(); }, 160); });
  $('#pkTopic').addEventListener('change', e => { state.topic = e.target.value; state.shown = 60; draw(); });
  $('#pkKind').addEventListener('change', e => { state.kind = e.target.value; state.shown = 60; draw(); });
  $('#pkSort').addEventListener('change', e => { state.sort = e.target.value; draw(); });
  host.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    try { localStorage.setItem('mindmap-picker-view', state.view); } catch (e) {}
    draw();
  }));

  let pool = [];
  let results = [];
  const tileHtml = (q, i) => {
    const lv = levelOf(q);
    const img = questionFirstImage(q);
    const picked = state.picked.has(q.id);
    const onMap = alreadyOnMap.includes(q.id);
    return `<button type="button" class="q-tile${picked ? ' is-picked' : ''}${state.active === q.id ? ' is-active' : ''}" data-qid="${escapeHtml(q.id)}" role="option" aria-selected="${picked}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <span class="q-check" aria-hidden="true">✓</span>
      <span class="q-meta">${lv ? `<span>${lv}</span>` : ''}${q.topic ? `<span>${escapeHtml(q.topic)}</span>` : ''}${questionIsMcq(q) ? '<span>MCQ</span>' : ''}${q.marks ? `<span>${escapeHtml(q.marks)}m</span>` : ''}${onMap ? '<span>On map</span>' : ''}</span>
      ${img ? `<span class="q-thumb" style="background-image:url('${escapeHtml(img).replace(/'/g, '%27')}')"></span>` : ''}
      <span class="q-text">${escapeHtml(questionHeadline(q, 220))}</span>
    </button>`;
  };
  function draw() {
    host.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === state.view));
    grid.classList.toggle('is-list', state.view === 'list');
    results = filterQuestions(pool, { search: state.search, topic: state.topic, level: state.level, kind: state.kind, levels, topicLevels: bank.topicLevels, sort: state.sort });
    $('#pkCount').textContent = results.length + ' question' + (results.length === 1 ? '' : 's') + (state.picked.size ? ' · ' + state.picked.size + ' chosen' : '');
    if (!results.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No questions match. Try fewer words or another topic.</div>';
    } else {
      grid.innerHTML = results.slice(0, state.shown).map(tileHtml).join('') +
        (results.length > state.shown ? '<div class="picker-more"><button class="btn btn-small" type="button" id="pkMore">Show more (' + (results.length - state.shown) + ' left)</button></div>' : '');
    }
    const more = $('#pkMore');
    if (more) more.addEventListener('click', () => { state.shown += 60; draw(); });
    footer();
  }
  function preview(q) {
    const box = $('#pkPreview');
    if (!q) { box.innerHTML = '<div class="empty-state">Tap a question to preview it here.</div>'; return; }
    const lv = levelOf(q);
    const picked = state.picked.has(q.id);
    box.innerHTML = `
      <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${lv ? `<span class="chip science is-on">${lv}</span>` : ''}${q.topic ? `<span class="chip">${escapeHtml(q.topic)}</span>` : ''}${q.category ? `<span class="chip">${escapeHtml(q.category)}</span>` : ''}
      </div>
      ${q.title ? `<h3 style="font-size:1rem">${escapeHtml(q.title)}</h3>` : ''}
      <div id="pkPreviewBody">${renderQuestionHtml(q, { showAnswers: staff && state.answerShown, interactive: !staff })}</div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-small ${picked ? '' : 'btn-primary'}" type="button" id="pkToggle">${picked ? '✓ Chosen — tap to remove' : '＋ Choose this question'}</button>
        ${staff && questionHasAnswer(q) ? `<button class="btn btn-small" type="button" id="pkAnswer">${state.answerShown ? 'Hide answer' : 'Show answer'}</button>` : ''}
        ${narrow() || window.matchMedia('(max-width: 1100px)').matches ? '<button class="btn btn-small btn-ghost" type="button" id="pkClosePreview">Close preview</button>' : ''}
      </div>`;
    box.querySelector('#pkToggle').addEventListener('click', () => { toggle(q); preview(q); });
    const ans = box.querySelector('#pkAnswer');
    if (ans) ans.addEventListener('click', () => { state.answerShown = !state.answerShown; preview(q); });
    const close = box.querySelector('#pkClosePreview');
    if (close) close.addEventListener('click', () => box.classList.remove('is-open'));
    box.querySelectorAll('[data-option-id]').forEach(btn => btn.addEventListener('click', () => {
      box.querySelector('#pkPreviewBody').innerHTML = renderQuestionHtml(q, { picked: btn.dataset.optionId });
    }));
    box.classList.add('is-open');
  }
  function toggle(q) {
    if (state.picked.has(q.id)) state.picked.delete(q.id); else state.picked.set(q.id, q);
    const tile = grid.querySelector(`[data-qid="${CSS.escape(q.id)}"]`);
    if (tile) { tile.classList.toggle('is-picked', state.picked.has(q.id)); tile.setAttribute('aria-selected', String(state.picked.has(q.id))); }
    $('#pkCount').textContent = results.length + ' question' + (results.length === 1 ? '' : 's') + (state.picked.size ? ' · ' + state.picked.size + ' chosen' : '');
    footer();
  }
  grid.addEventListener('click', e => {
    const tile = e.target.closest('[data-qid]'); if (!tile) return;
    const q = pool.find(x => x.id === tile.dataset.qid); if (!q) return;
    const onCheck = e.target.closest('.q-check');
    if (onCheck || e.shiftKey || e.metaKey || e.ctrlKey || state.active === q.id) toggle(q);
    state.active = q.id;
    grid.querySelectorAll('.q-tile.is-active').forEach(t => t.classList.remove('is-active'));
    tile.classList.add('is-active');
    preview(q);
  });
  grid.addEventListener('dblclick', e => {
    const tile = e.target.closest('[data-qid]'); if (!tile) return;
    const q = pool.find(x => x.id === tile.dataset.qid); if (!q) return;
    if (!state.picked.has(q.id)) toggle(q);
    place();
  });
  // The footer lives in the modal (the page gives it to us as host.footer).
  function footer() {
    const foot = host.footerEl;
    if (!foot) return;
    foot.innerHTML = `<span class="grow">${state.picked.size ? state.picked.size + ' chosen. They will be placed under the selected topic.' : 'Tap a question to preview, tap again (or its circle) to choose. Double-tap to place at once.'}</span>
      <button class="btn" type="button" data-pk="clear" ${state.picked.size ? '' : 'disabled'}>Clear</button>
      <button class="btn btn-primary" type="button" data-pk="place" ${state.picked.size ? '' : 'disabled'}>Place ${state.picked.size || ''} in map</button>`;
    foot.querySelector('[data-pk="clear"]').addEventListener('click', () => { state.picked.clear(); draw(); });
    foot.querySelector('[data-pk="place"]').addEventListener('click', place);
  }
  function place() {
    if (!state.picked.size) return;
    onPlace([...state.picked.values()]);
  }

  loadBank({ onProgress: (part, n) => { $('#pkCount').textContent = 'Loading the question bank… ' + n + ' questions'; } }).then(() => {
    pool = pickableQuestions({ staff, levels });
    const topics = bankTopics(pool);
    $('#pkTopic').innerHTML = '<option value="">All topics</option>' + topics.map(t => `<option value="${escapeHtml(t.topic)}">${t.level ? t.level + ' · ' : ''}${escapeHtml(t.topic)}</option>`).join('');
    $('#pkLoading').remove();
    draw();
    setTimeout(() => $('#pkSearch').focus(), 50);
  }).catch(e => {
    $('#pkLoading').remove();
    $('#pkCount').textContent = '';
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">The question bank could not be loaded. ${escapeHtml(e.message || '')}<br><br><button class="btn btn-small" type="button" id="pkRetry">Try again</button></div>`;
    grid.querySelector('#pkRetry').addEventListener('click', () => mountPicker(host, { staff, levels, onPlace, onClose, alreadyOnMap, notice }));
  });
  footer();
  return { close: () => onClose && onClose() };
}
