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
  questionIsMcq, questionSnapshot, questionSearchText, tableRows, escapeHtml, levelRank,
  questionHasParts, questionPartKeys, blockOpensLabel, partBodyHtml, mcqLabelStyle, mcqLabelOf, mcqOptionText,
  fillBlankSegments, questionPracticeItems, practiceScore
} from './mindmap-core.mjs?v=1.3.0';

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
      if (tag === 'SPAN' && child.getAttribute('class') === 'q-marks') keep.class = 'q-marks';   // the [marks] tag partBodyHtml adds
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
  // v1.3.0: parts (a)(b)(ii) and [marks] drawn as the cer app draws them, and numbered MCQ options.
  const keys = questionHasParts(blocks) ? questionPartKeys(blocks) : blocks.map(() => '');
  const style = mcqLabelStyle(q);
  blocks.forEach((b, bi) => {
    if (!b) return;
    switch (b.type) {
      case 'text': case 'part':
        out.push(partRowHtml(blockOpensLabel(blocks, keys, bi) || (b.type === 'part' ? String(b.label || '') : ''), sanitizeHtml(partBodyHtml(b))));
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
        out.push('<div class="qc-options">' + opts.map((o, k) => {
          const id = String(o && o.id || '');
          let cls = 'qc-option';
          if (id && id === b.correctId && (done || reveal || showAnswers)) cls += ' is-right';
          if (done && id === picked && id !== b.correctId) cls += ' is-wrong';
          const body = '<b class="qc-opt-num">' + escapeHtml(mcqLabelOf(k, style)) + '.</b> ' + sanitizeHtml(mcqOptionText(o && o.text, k, style));
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
        if (b.content) answers.push('<div class="qc-answer"><b>Answer:</b> ' + sanitizeHtml(b.content) + '</div>');
        break;
      default: break;
    }
  });
  if ((showAnswers || reveal) && answers.length) out.push(...answers);
  return '<div class="qc">' + (out.join('') || '<p>(This question has no text.)</p>') + '</div>';
}
export function questionHasAnswer(q) {
  return (Array.isArray(q && q.blocks) ? q.blocks : []).some(b => b && (['answer', 'plainanswer', 'explanation'].includes(b.type) || (b.type === 'mcq' && b.correctId) || (b.type === 'fillblank' && /\[\[/.test(b.text || ''))));
}

/** A line of question text with its part tag beside it — cer's _qpTextHtml. */
function partRowHtml(label, inner) {
  const text = '<div class="qp-qtext">' + (inner || '') + '</div>';
  if (!label) return '<div class="qc-block">' + text + '</div>';
  return '<div class="qc-block qp-part-row"><span class="qp-part-tag">' + escapeHtml(label) + '</span>' + text + '</div>';
}

/* ------------------------------------------------------------------ */
/*  v1.3.0 — answering a question on the map, as in the cer app         */
/* ------------------------------------------------------------------ */
const CER_COLOURS = { Claim: ['#E3F2FD', '#1565C0'], Evidence: ['#FFF3E0', '#E65100'], Reasoning: ['#E8F5E9', '#2E7D32'] };
const VERDICT = {
  correct: { icon: '✓', cls: 'is-correct', word: 'Correct' },
  partial: { icon: '≈', cls: 'is-partial', word: 'Partly right' },
  incorrect: { icon: '✗', cls: 'is-incorrect', word: 'Not quite' }
};
function partActionsHtml(key, busy) {
  const k = escapeHtml(key);
  return '<div class="qp-actions">' +
    '<button type="button" class="btn btn-small btn-ghost" data-qact="hint" data-qkey="' + k + '"' + (busy === 'hint' ? ' disabled' : '') + ' title="A nudge that does not give the answer away">' + (busy === 'hint' ? 'Thinking…' : '💡 Hint') + '</button>' +
    '<button type="button" class="btn btn-small qp-check" data-qact="check" data-qkey="' + k + '"' + (busy === 'check' ? ' disabled' : '') + '>' + (busy === 'check' ? 'Checking…' : '✓ Check answer') + '</button>' +
    '</div>';
}
function feedbackHtml(r, extra = '') {
  if (!r) return '';
  if (r.error) return '<div class="qp-feedback is-error">' + escapeHtml(r.error) + '</div>';
  const v = VERDICT[r.verdict] || VERDICT.incorrect;
  return '<div class="qp-feedback ' + v.cls + '"><b>' + v.icon + ' ' + v.word + '</b>' + (r.feedback ? ' — ' + escapeHtml(r.feedback) : '') + extra + '</div>';
}
function fmtScore(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

/**
 * The question as something to ANSWER, laid out like the cer app's practice card (buildOpenBody):
 *  • parts (a)(b)(ii) beside their wording, [marks] at the end, a new card for each part;
 *  • a writing box for every answer area (Claim / Evidence / Reasoning for a CER answer),
 *    with 💡 Hint and ✓ Check answer — the AI marks it and then shows the model answer;
 *  • MCQ options numbered 1. 2. 3. 4. with a radio each, checked on the spot (no AI);
 *  • fill-in-the-blanks with a box per blank (exact matches at once, the rest by the AI);
 *  • the explanation and common mistakes once every part has been checked (or when staff show answers);
 *  • a running score, as cer's practice score: correct 1, partly ½, each blank counts.
 * `state` = { answers, mcq, results, hints, busy, showKey } for this card; none of it is saved to the map.
 */
export function renderQuestionPractice(q, { nodeId = 'q', state = {}, staff = false, reveal = false } = {}) {
  const blocks = Array.isArray(q && q.blocks) ? q.blocks : [];
  const keys = questionHasParts(blocks) ? questionPartKeys(blocks) : blocks.map(() => '');
  const style = mcqLabelStyle(q);
  const items = questionPracticeItems(q);
  const byKey = new Map(items.map(it => [it.key, it]));
  const answers = state.answers || {}, results = state.results || {}, hints = state.hints || {}, busy = state.busy || {}, chosen = state.mcq || {};
  const score = practiceScore(items, results);
  const showKey = !!(reveal || (staff && state.showKey));
  const sections = [];
  let cur = null;
  const sec = () => { if (!cur) { cur = { html: '', hasAnswer: false }; sections.push(cur); } return cur; };
  const add = h => { sec().html += h; };
  const addAnswer = h => { const s2 = sec(); s2.html += h; s2.hasAnswer = true; };
  const hintBox = key => hints[key] ? '<div class="qp-hint">💡 ' + escapeHtml(hints[key]) + '</div>' : '';
  const late = [];
  const modelLine = text => '<div class="qp-model"><b>Model answer:</b> ' + escapeHtml(text) + '</div>';
  const openBox = it => {
    const r = results[it.key];
    const colours = CER_COLOURS[it.title];
    const chip = it.title ? '<div class="qp-chip"' + (colours ? ' style="background:' + colours[0] + ';color:' + colours[1] + '"' : '') + '>' + escapeHtml(it.title) + '</div>' : '';
    const value = escapeHtml(answers[it.key] || '');
    const verdict = r && r.verdict ? ' data-verdict="' + escapeHtml(r.verdict) + '"' : '';
    const box = it.line
      ? '<input class="qp-line" type="text" data-qinput="' + escapeHtml(it.key) + '" value="' + value + '" placeholder="Your answer"' + verdict + ' autocomplete="off">'
      : '<textarea class="qp-open" rows="' + (it.rows || 3) + '" data-qinput="' + escapeHtml(it.key) + '" placeholder="Type your answer…"' + verdict + '>' + value + '</textarea>';
    const model = (r && (r.model || it.model)) || '';
    let fb = '';
    if (r) fb = feedbackHtml(r, model ? modelLine(model) : '');
    else if (showKey && it.model) fb = '<div class="qp-feedback is-key">' + modelLine(it.model) + '</div>';
    return '<div class="qp-answer" data-qitem="' + escapeHtml(it.key) + '">' + chip + box + partActionsHtml(it.key, busy[it.key]) + hintBox(it.key) + fb + '</div>';
  };
  blocks.forEach((b, bi) => {
    if (!b) return;
    const opens = blockOpensLabel(blocks, keys, bi);
    // An answer, blank or MCQ that opens its own part (with no line of text above it) still gets its part tag and marks.
    if (opens && b.type !== 'text' && b.type !== 'part' && b.type !== 'explanation' && b.type !== 'commonMistake') {
      cur = null;
      const marks = Number(b.marks) > 0 ? '<span class="q-marks">[' + Math.round(Number(b.marks)) + ']</span>' : '';
      add(partRowHtml(opens, marks));
    }
    switch (b.type) {
      case 'text':
        // A part label opens a new card; otherwise a text block after an answer area does (cer's rule).
        if (cur && (cur.hasAnswer || opens)) cur = null;
        add(partRowHtml(opens, sanitizeHtml(partBodyHtml(b))));
        break;
      case 'part':
        if (cur) cur = null;
        add(partRowHtml(opens || String(b.label || ''), sanitizeHtml(partBodyHtml(b))));
        break;
      case 'image':
        if (/^https:\/\//i.test(String(b.url || ''))) add('<div class="qc-block"><img src="' + escapeHtml(b.url) + '" alt="' + escapeHtml(b.caption || 'Question picture') + '" loading="lazy" draggable="false">' + (b.caption ? '<small class="qp-caption">' + escapeHtml(b.caption) + '</small>' : '') + '</div>');
        break;
      case 'table': {
        const rows = Array.isArray(b.rows) ? b.rows.map(r => (r && r.c) || []) : tableRows(b.data);
        if (rows.length) add('<table>' + rows.map(r => '<tr>' + r.map(c => '<td>' + sanitizeHtml(c) + '</td>').join('') + '</tr>').join('') + '</table>');
        break;
      }
      case 'mcq': {
        const it = byKey.get(bi + ':mcq');
        if (!it) break;
        const r = results[it.key];
        const pick = chosen[it.key] || '';
        const opts = (b.options || []).map((o, k) => {
          const opt = it.options[k];
          let cls = 'qp-opt';
          if (r || showKey) { if (opt.correct) cls += ' is-right'; else if (r && opt.id === pick) cls += ' is-wrong'; }
          if (opt.id === pick) cls += ' is-picked';
          return '<label class="' + cls + '"><input type="radio" name="mcq_' + escapeHtml(nodeId) + '_' + bi + '" value="' + escapeHtml(opt.id) + '" data-qmcq="' + escapeHtml(it.key) + '"' + (opt.id === pick ? ' checked' : '') + '>' +
            '<span><b>' + escapeHtml(mcqLabelOf(k, style)) + '.</b> ' + sanitizeHtml(mcqOptionText(o && o.text, k, style)) + '</span></label>';
        }).join('');
        const right = it.options.find(o => o.correct);
        const chosenOpt = it.options.find(o => o.id === pick);
        const extra = (chosenOpt ? ' <span class="qp-muted">(you chose ' + escapeHtml(chosenOpt.label) + ')</span>' : '') +
          (right ? '<div class="qp-model"><b>Correct answer:</b> ' + escapeHtml(right.label) + '. ' + escapeHtml(right.text) + '</div>' : '');
        addAnswer('<div class="qp-answer qp-mcq" data-qitem="' + escapeHtml(it.key) + '">' + opts + partActionsHtml(it.key, busy[it.key]) + hintBox(it.key) + feedbackHtml(r, extra) + '</div>');
        break;
      }
      case 'fillblank': {
        const it = byKey.get(bi + ':blank');
        if (!it) { add('<div class="qc-block">' + escapeHtml(String(b.text || '')).replace(/\n/g, '<br>') + '</div>'); break; }
        const segs = fillBlankSegments(b.text);
        const r = results[it.key];
        const vals = Array.isArray(answers[it.key]) ? answers[it.key] : [];
        let n = 0;
        const sentence = segs.map(sg => {
          if (sg.type === 'text') return escapeHtml(sg.text).replace(/\n/g, '<br>');
          const k = n++;
          const v = r && r.blanks ? r.blanks[k] : '';
          return '<input class="qp-blank' + (v ? ' is-' + v : '') + '" type="text" data-qblank="' + escapeHtml(it.key) + '" data-n="' + k + '" value="' + escapeHtml(vals[k] || '') + '" aria-label="Blank ' + (k + 1) + '" autocomplete="off" spellcheck="false">';
        }).join('');
        const wrong = r && r.blanks ? it.answers.filter((a, k) => r.blanks[k] !== 'correct') : [];
        const answersLine = '<div class="qp-model"><b>Answers:</b> ' + it.answers.map(a => escapeHtml(a)).join(', ') + '</div>';
        let fb = '';
        if (r) fb = '<div class="qp-feedback ' + (wrong.length ? (wrong.length === it.answers.length ? 'is-incorrect' : 'is-partial') : 'is-correct') + '"><b>' + (wrong.length ? '' : '✓ ') + (it.answers.length - wrong.length) + ' / ' + it.answers.length + ' correct</b>' + (wrong.length ? answersLine : '') + '</div>';
        else if (showKey) fb = '<div class="qp-feedback is-key">' + answersLine + '</div>';
        addAnswer('<div class="qp-answer" data-qitem="' + escapeHtml(it.key) + '"><div class="qp-sentence">' + sentence + '</div>' + partActionsHtml(it.key, busy[it.key]) + hintBox(it.key) + fb + '</div>');
        break;
      }
      case 'answer': {
        let h = '';
        for (const f of ['claim', 'evidence', 'reasoning']) { const it = byKey.get(bi + ':' + f); if (it) h += openBox(it); }
        addAnswer(h);
        break;
      }
      case 'plainanswer': case 'workingSpace': case 'openLines': case 'answerLine': {
        const it = byKey.get(bi + ':content');
        if (it) addAnswer(openBox(it));
        break;
      }
      case 'studentAnswer':
        add('<div class="qc-mistake"><b>' + escapeHtml(b.label || "Student's Answer") + ':</b> ' + sanitizeHtml(b.answer) + '</div>');
        break;
      case 'explanation':
        if (b.content) late.push('<div class="qp-explain"><b>💡 Explanation</b><div>' + sanitizeHtml(b.content) + '</div></div>');
        break;
      case 'commonMistake':
        late.push('<div class="qc-mistake"><b>⚠ ' + escapeHtml(b.title || 'Common Mistake') + ':</b> ' + sanitizeHtml(b.text) + '</div>');
        break;
      default: break;
    }
  });
  const filled = sections.filter(x => x.html);
  let html = '<div class="qc qp' + (filled.length > 1 ? ' qp-multi' : '') + '">' + (filled.map(x => '<div class="qp-sec">' + x.html + '</div>').join('') || '<p>(This question has no text.)</p>');
  if (late.length && (score.done || showKey)) html += late.join('');
  if (score.marked) {
    html += '<div class="qp-score' + (score.done ? ' is-done' : '') + '">' + (score.done ? '🎉 ' : '') + 'Score: <b>' + fmtScore(score.score) + ' / ' + score.total + '</b>' +
      (score.done ? '' : ' <span class="qp-muted">(' + score.marked + ' of ' + items.length + ' part' + (items.length === 1 ? '' : 's') + ' checked)</span>') + '</div>';
  }
  return html + '</div>';
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
 * `onPlace(questions[], { free, folded })` with the chosen bank questions.
 * `placement` (v1.1.0) = { target, free, folded }: the footer lets the user put the
 * questions under `target` (a topic's name) or each on its own, and folded or open.
 */
export function mountPicker(host, { staff = false, levels = BANK_LEVELS, onPlace, onClose, alreadyOnMap = [], notice = '', placement = null }) {
  const how = { free: !!(placement && placement.free), folded: placement ? placement.folded !== false : false };
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
    const target = placement && placement.target ? placement.target : 'the selected topic';
    const where = how.free ? 'each on its own (attached to no topic)' : 'under “' + target + '”';
    const choices = placement ? `
      <div class="pk-place" role="group" aria-label="Where the questions go">
        <div class="seg" role="radiogroup" aria-label="Place">
          <button type="button" role="radio" data-pk-where="topic" aria-checked="${how.free ? 'false' : 'true'}" class="${how.free ? '' : 'is-on'}" title="Each question hangs from ${escapeHtml(target)}">🔗 Under ${escapeHtml(target.length > 18 ? target.slice(0, 17) + '…' : target)}</button>
          <button type="button" role="radio" data-pk-where="free" aria-checked="${how.free ? 'true' : 'false'}" class="${how.free ? 'is-on' : ''}" title="Each question is its own container, attached to nothing">📦 On its own</button>
        </div>
        <label class="pk-fold"><input type="checkbox" data-pk-folded ${how.folded ? 'checked' : ''}> Folded (one line each)</label>
      </div>` : '';
    foot.innerHTML = `${choices}<span class="grow">${state.picked.size ? state.picked.size + ' chosen. They will be placed ' + escapeHtml(where) + '.' : 'Tap a question to preview, tap again (or its circle) to choose. Double-tap to place at once.'}</span>
      <button class="btn" type="button" data-pk="clear" ${state.picked.size ? '' : 'disabled'}>Clear</button>
      <button class="btn btn-primary" type="button" data-pk="place" ${state.picked.size ? '' : 'disabled'}>Place ${state.picked.size || ''} in map</button>`;
    foot.querySelector('[data-pk="clear"]').addEventListener('click', () => { state.picked.clear(); draw(); });
    foot.querySelector('[data-pk="place"]').addEventListener('click', place);
    foot.querySelectorAll('[data-pk-where]').forEach(b => b.addEventListener('click', () => { how.free = b.dataset.pkWhere === 'free'; footer(); }));
    const folded = foot.querySelector('[data-pk-folded]');
    if (folded) folded.addEventListener('change', () => { how.folded = folded.checked; footer(); });
  }
  function place() {
    if (!state.picked.size) return;
    onPlace([...state.picked.values()], { ...how });
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
    grid.querySelector('#pkRetry').addEventListener('click', () => mountPicker(host, { staff, levels, onPlace, onClose, alreadyOnMap, notice, placement: placement ? { ...placement, ...how } : null }));
  });
  footer();
  return { close: () => onClose && onClose() };
}
