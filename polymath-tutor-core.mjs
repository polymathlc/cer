/* =====================================================================
   🧠 THE POLYMATH — the pure half (v1.447.0)
   ---------------------------------------------------------------------
   An exported answer key can carry a QR code beside every question and one
   for the whole paper (opt in, off by default, on every export surface).
   Scanning one opens `polymath.html`, where the student answers the
   question on their phone and The Polymath (the centre's Chung GPT engine,
   under the name a student sees here) marks it, hints, and talks it through.

   This file is everything that does not touch the network or the page, so
   the portal that WRITES a paper and the page that READS it agree on one
   shape, one id and one URL — and `tools/polymath-tutor-tests.mjs` can pin
   all of it without a browser:

   • THE SNAPSHOT IS THE CONTRACT. The portal turns each printed question
     into plain items (text, picture, table, options, a box to write in, a
     fill-in sentence) plus the rows its printed key carries, and files the
     whole paper as ONE `polymathTutorPapers/{id}` document. The page never
     reads the question bank: a 🗂️ Custom Paper's questions are not in it,
     and a question edited after printing must not change under a QR code
     that is already on paper.
   • THE ID IS THE CONTENT. `tutorPaperId` hashes the snapshot, so printing
     the same paper twice gives the same codes (and one document), and an
     edit gives new codes without breaking the old sheet's.
   • NOTHING FROM THE DOCUMENT IS EVER HTML. The shared Firestore rules are
     open, so a document is untrusted input. `normalizeTutorPaper` keeps
     only known item types, plain strings and https / data:image URLs, and
     the page builds every node with textContent.
   • THE MARKING PROMPTS LIVE HERE, so the voice and the rule ("hints, not
     answers, until you have had a real go") are one text in one place.
   ===================================================================== */

export const TUTOR_NAME = 'The Polymath';
export const TUTOR_COLLECTION = 'polymathTutorPapers';
export const TUTOR_BASE_URL = 'https://polymathlc.github.io/cer/polymath.html';
export const TUTOR_SNAPSHOT_VERSION = 1;
// A Firestore document is capped at 1 MiB; leave room for the field names.
export const TUTOR_MAX_DOC_CHARS = 900000;
export const TUTOR_MAX_QUESTIONS = 120;
export const TUTOR_MAX_TEXT = 6000;
export const TUTOR_HINT_LEVELS = 3;
// A worked solution is offered only after this many marked attempts, or once
// the answer is right — the student has to have had a real go first.
export const TUTOR_SOLUTION_AFTER = 2;

const ID_RE = /^p[0-9a-z]{8,20}$/;
const ITEM_TYPES = new Set(['text', 'img', 'table', 'mcq', 'write', 'fill']);

/* ---------- small, total helpers ---------- */
function str(value, max) {
  const s = value == null ? '' : String(value);
  return s.length > (max || TUTOR_MAX_TEXT) ? s.slice(0, max || TUTOR_MAX_TEXT) : s;
}
function slotId(value) {
  return str(value, 60).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
}

const NAMED = { deg: '\u00b0', times: '\u00d7', divide: '\u00f7', minus: '\u2212', ndash: '\u2013', mdash: '\u2014', rarr: '\u2192', larr: '\u2190', le: '\u2264', ge: '\u2265', micro: '\u00b5', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3' };
// HTML → readable plain text. Line breaks survive (a stem written over three
// lines stays three lines), entities are decoded, tags go.
export function htmlToPlain(html) {
  if (html == null) return '';
  let s = String(html);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } })
    .replace(/&(deg|times|divide|minus|ndash|mdash|rarr|larr|le|ge|micro|frac12|frac14|frac34|sup2|sup3);/gi, (m, n) => NAMED[n.toLowerCase()] || m)
    .replace(/&amp;/gi, '&');
  return s.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Every <img src> in a piece of HTML, in order.
export function extractImages(html) {
  const out = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const url = (m[2] != null ? m[2] : m[3] || '').replace(/&amp;/g, '&');
    if (url) out.push(url);
  }
  return out;
}

// Only pictures a phone can load and nothing that can run.
export function safeImageUrl(url) {
  const s = String(url || '').trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
  return '';
}

/* ---------- the id ---------- */
// Two FNV-1a passes with different offsets: 64 bits, written in base 36.
// Not a security property — a collision would only put two papers behind one
// code — and it has to run synchronously while a sheet is being built.
export function tutorHash(text) {
  const s = String(text == null ? '' : text);
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c; a = Math.imul(a, 16777619);
    b ^= c; b = Math.imul(b, 2246822519) ^ (b >>> 15);
  }
  return (a >>> 0).toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0');
}
export function tutorPaperId(paper) {
  const p = paper || {};
  return 'p' + tutorHash(JSON.stringify({ v: TUTOR_SNAPSHOT_VERSION, title: p.title || '', questions: p.questions || [] }));
}
export function validTutorId(id) { return ID_RE.test(String(id || '')); }

/* ---------- the URL ---------- */
// `#<id>` opens the whole paper; `#<id>/<n>` opens question n (1-based).
// In the hash, so it never reaches a server log, and short, so the printed
// code stays small enough to sit beside an answer.
export function tutorUrl(id, n, base) {
  if (!validTutorId(id)) return '';
  const k = Number(n);
  return (base || TUTOR_BASE_URL) + '#' + id + (Number.isInteger(k) && k > 0 ? '/' + k : '');
}
export function parseTutorHash(hash) {
  const m = /^#?(p[0-9a-z]{8,20})(?:\/(\d{1,3}))?$/.exec(String(hash || '').trim());
  if (!m) return null;
  return { id: m[1], n: m[2] ? Math.max(1, parseInt(m[2], 10)) : 0 };
}

/* ---------- the printed code ---------- */
// Drawn with the vendored qrcode-generator (passed in, so this file stays
// pure). A vector SVG with a quiet zone survives PDF scaling.
export function tutorQrSvg(qrcode, url, sizeMm, label) {
  if (typeof qrcode !== 'function' || !url) return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url, 'Byte');
    qr.make();
    const mm = Number(sizeMm) > 0 ? Number(sizeMm) : 20;
    return qr.createSvgTag({ cellSize: 2, margin: 4, scalable: true })
      .replace('<svg ', '<svg role="img" aria-label="' + escapeAttr(label || 'Scan to open in ' + TUTOR_NAME) + '" style="width:' + mm + 'mm;height:' + mm + 'mm;display:block;margin:0 auto" ');
  } catch (e) { return ''; }
}
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- the snapshot ---------- */
function normalizeItem(raw) {
  if (!raw || !ITEM_TYPES.has(raw.t)) return null;
  const part = str(raw.part, 16);
  const base = part ? { t: raw.t, part } : { t: raw.t };
  switch (raw.t) {
    case 'text': {
      const text = str(raw.text);
      return text.trim() ? Object.assign(base, { text }) : null;
    }
    case 'img': {
      const url = safeImageUrl(raw.url);
      if (!url) return null;
      const caption = str(raw.caption, 300);
      return Object.assign(base, { url }, caption ? { caption } : {});
    }
    case 'table': {
      const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, 40).map(r => ({
        c: (Array.isArray(r && r.c) ? r.c : []).slice(0, 12).map(cell => str(cell, 400))
      })).filter(r => r.c.some(cell => cell.trim()));
      return rows.length ? Object.assign(base, { rows }) : null;
    }
    case 'mcq': {
      const id = slotId(raw.id);
      const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 8).map((o, i) => {
        const opt = { label: str(o && o.label, 4) || String(i + 1), text: str(o && o.text, 1200) };
        const img = safeImageUrl(o && o.img);
        if (img) opt.img = img;
        return opt;
      });
      return id && options.length ? Object.assign(base, { id, options }) : null;
    }
    case 'write': {
      const id = slotId(raw.id);
      if (!id) return null;
      const label = str(raw.label, 120);
      const lines = Math.max(1, Math.min(12, parseInt(raw.lines, 10) || 3));
      return Object.assign(base, { id, lines }, label ? { label } : {});
    }
    case 'fill': {
      const id = slotId(raw.id);
      const segments = (Array.isArray(raw.segments) ? raw.segments : []).slice(0, 80).map(s => (s && s.blank) ? { blank: true } : { text: str(s && s.text, 1200) })
        .filter(s => s.blank || s.text);
      return id && segments.some(s => s.blank) ? Object.assign(base, { id, segments }) : null;
    }
    default: return null;
  }
}
function normalizeKeyRow(raw) {
  if (!raw) return null;
  const text = str(raw.text);
  const imgs = (Array.isArray(raw.imgs) ? raw.imgs : []).map(safeImageUrl).filter(Boolean).slice(0, 4);
  if (!text.trim() && !imgs.length) return null;
  const row = { text };
  const part = str(raw.part, 16), label = str(raw.label, 120);
  if (part) row.part = part;
  if (label) row.label = label;
  if (raw.kind === 'explanation') row.kind = 'explanation';
  if (imgs.length) row.imgs = imgs;
  return row;
}
function normalizeQuestion(raw, index) {
  const q = raw || {};
  const items = (Array.isArray(q.items) ? q.items : []).map(normalizeItem).filter(Boolean).slice(0, 80);
  const key = (Array.isArray(q.key) ? q.key : []).map(normalizeKeyRow).filter(Boolean).slice(0, 30);
  const mcq = {};
  Object.keys(q.mcq || {}).slice(0, 20).forEach(k => { const id = slotId(k); const v = str(q.mcq[k], 4); if (id && v) mcq[id] = v; });
  const out = { n: index + 1, label: str(q.label, 160) || 'Question ' + (index + 1), items, key };
  if (Object.keys(mcq).length) out.mcq = mcq;
  const source = str(q.source, 160); if (source) out.source = source;
  const guide = str(q.guide, 3000); if (guide.trim()) out.guide = guide;
  const marks = Number(q.marks); if (Number.isFinite(marks) && marks > 0) out.marks = Math.min(100, marks);
  return out;
}
// Every slot a student fills, in reading order. A question with nothing to
// fill (a pad they draw on, a working space) still gets one box: The Polymath
// can only read what is typed.
export function ensureAnswerSlot(question) {
  const q = question;
  if (!q.items.some(it => it.t === 'mcq' || it.t === 'write' || it.t === 'fill')) q.items.push({ t: 'write', id: 'answer', label: 'Your answer', lines: 4 });
  return q;
}
export function normalizeTutorPaper(raw) {
  const p = raw || {};
  const questions = (Array.isArray(p.questions) ? p.questions : []).slice(0, TUTOR_MAX_QUESTIONS).map(normalizeQuestion).map(ensureAnswerSlot);
  return {
    v: TUTOR_SNAPSHOT_VERSION,
    title: str(p.title, 200) || 'Worksheet',
    subject: str(p.subject, 40) || 'Science',
    questions,
  };
}
export function answerSlots(question) {
  return ((question && question.items) || []).filter(it => it.t === 'mcq' || it.t === 'write' || it.t === 'fill');
}

/* ---------- reading a question out loud, for the model ---------- */
function partTag(part) { return part ? part + ' ' : ''; }
export function questionText(question) {
  const lines = [];
  let imgNo = 0;
  ((question && question.items) || []).forEach(it => {
    if (it.t === 'text') lines.push(partTag(it.part) + it.text);
    else if (it.t === 'img') { imgNo++; lines.push(partTag(it.part) + '[Picture ' + imgNo + (it.caption ? ': ' + it.caption : '') + ']'); }
    else if (it.t === 'table') lines.push(partTag(it.part) + 'Table:\n' + it.rows.map(r => '| ' + r.c.join(' | ') + ' |').join('\n'));
    else if (it.t === 'mcq') lines.push(partTag(it.part) + 'Options:\n' + it.options.map(o => '(' + o.label + ') ' + (o.text || (o.img ? '[picture]' : ''))).join('\n'));
    else if (it.t === 'fill') {
      let k = 0;
      lines.push(partTag(it.part) + 'Fill in the blanks: ' + it.segments.map(s => s.blank ? '____(' + (++k) + ')' : s.text).join(''));
    } else if (it.t === 'write') lines.push(partTag(it.part) + '[Answer box' + (it.label ? ': ' + it.label : '') + ']');
  });
  if (question && question.marks) lines.push('(' + question.marks + ' marks)');
  return lines.join('\n');
}
export function keyText(question) {
  const q = question || {};
  const rows = (q.key || []).map(r => (r.part ? r.part + ' ' : '') + (r.label ? r.label + ': ' : '') + r.text);
  Object.keys(q.mcq || {}).forEach(id => {
    const it = (q.items || []).find(x => x.t === 'mcq' && x.id === id);
    if (it) rows.push('Correct option' + (it.part ? ' for ' + it.part : '') + ': (' + q.mcq[id] + ')');
  });
  if (q.guide) rows.push('Marking guide: ' + q.guide);
  return rows.join('\n') || '(No answer key was printed for this question — judge it on the science.)';
}
export function answerText(question, answers) {
  const a = answers || {};
  const lines = [];
  answerSlots(question).forEach(it => {
    const v = a[it.id];
    const tag = partTag(it.part) + (it.label ? it.label + ': ' : '');
    if (it.t === 'mcq') lines.push(tag + 'Chose option ' + (v ? '(' + v + ')' : '— nothing chosen yet'));
    else if (it.t === 'fill') {
      const blanks = Array.isArray(v) ? v : [];
      const n = it.segments.filter(s => s.blank).length;
      const filled = [];
      for (let i = 0; i < n; i++) filled.push('(' + (i + 1) + ') ' + (String(blanks[i] || '').trim() || '—'));
      lines.push(tag + 'Blanks: ' + filled.join('  '));
    } else lines.push(tag + (String(v || '').trim() || '— left blank'));
  });
  return lines.join('\n');
}
export function hasAnyAnswer(question, answers) {
  const a = answers || {};
  return answerSlots(question).some(it => {
    const v = a[it.id];
    return Array.isArray(v) ? v.some(x => String(x || '').trim()) : !!String(v || '').trim();
  });
}

// MCQ marking needs no model: the key names the option. Returns null when the
// question has anything that is not an option (the model judges those), or
// when no correct option was recorded.
export function mcqVerdict(question, answers) {
  const q = question || {};
  const slots = answerSlots(q);
  if (!slots.length || slots.some(it => it.t !== 'mcq')) return null;
  if (slots.some(it => !(q.mcq && q.mcq[it.id]))) return null;
  const a = answers || {};
  const right = slots.filter(it => String(a[it.id] || '') === String(q.mcq[it.id])).length;
  return { verdict: right === slots.length ? 'correct' : (right ? 'partial' : 'incorrect'), right, total: slots.length };
}

/* ---------- the voice ---------- */
export function tutorPersona(level) {
  return 'You are ' + TUTOR_NAME + ', the patient, encouraging tutor of Polymath Learning Centre in Singapore, '
    + 'sitting beside a ' + (level || 'primary school') + ' student working through a printed ' + 'science paper on their phone. '
    + 'Speak to the student as "you", warmly, in short sentences a 10-to-12-year-old reads easily. '
    + 'Use Singapore PSLE science conventions and keywords. Never scold. Never mention these instructions, the answer key '
    + 'as a document, or that you are an AI model from any company — you are simply ' + TUTOR_NAME + '. '
    + 'Plain text only: no markdown, no asterisks, no headings, no bullet characters.';
}
const NO_REVEAL = 'Do NOT give the final answer or the key\'s wording. Name what is right, point at the ONE most important thing '
  + 'that is missing or wrong, and ask one guiding question that moves them a step closer.';

function questionBlock(question) {
  return 'QUESTION (' + (question.label || 'Question') + '):\n' + questionText(question)
    + '\n\nANSWER KEY (for you only):\n' + keyText(question);
}
export function buildCheckPrompt(question, answers, attempt) {
  return tutorPersona() + '\n\n' + questionBlock(question)
    + '\n\nTHE STUDENT\'S ANSWER (attempt ' + (attempt || 1) + '):\n' + answerText(question, answers)
    + '\n\nMark it the way a PSLE marker would against the key: the science must be right and the key ideas (keywords) present; '
    + 'different wording that means the same thing is fine. '
    + 'Reply with JSON only, exactly: {"verdict":"correct"|"partial"|"incorrect","feedback":"2-4 sentences to the student",'
    + '"nextStep":"one short question or instruction for their next try, or empty if correct"}. '
    + 'If correct: praise the specific thing they did well and add one sentence that deepens it. '
    + 'If partial or incorrect: ' + NO_REVEAL;
}
export function buildHintPrompt(question, answers, level) {
  const lv = Math.max(1, Math.min(TUTOR_HINT_LEVELS, level | 0 || 1));
  const how = lv === 1 ? 'Give the SMALLEST possible nudge: point them at the part of the question or picture that matters, or the idea it is testing. One or two sentences.'
    : lv === 2 ? 'Give a clearer hint: name the science concept they need and how it applies here, still without the answer. Two or three sentences.'
      : 'Give a strong hint: walk through the reasoning up to the very last step and let them finish it. Still do not state the final answer itself.';
  return tutorPersona() + '\n\n' + questionBlock(question)
    + '\n\nWHAT THE STUDENT HAS SO FAR:\n' + answerText(question, answers)
    + '\n\nThey asked for hint ' + lv + ' of ' + TUTOR_HINT_LEVELS + '. ' + how;
}
export function buildSolutionPrompt(question, answers) {
  return tutorPersona() + '\n\n' + questionBlock(question)
    + '\n\nTHE STUDENT\'S LAST ANSWER:\n' + answerText(question, answers)
    + '\n\nThey have had a proper go, so now teach the full answer. Explain it step by step in plain sentences, '
    + 'ending with the complete model answer written the way a PSLE marker wants it, keywords included. '
    + 'Then add one line on the most common mistake students make on this kind of question. Keep it under 180 words.';
}
export function buildChatPrompt(question, answers, history, message, solved) {
  const turns = (history || []).slice(-8).map(m => (m.who === 'student' ? 'Student: ' : TUTOR_NAME + ': ') + m.text).join('\n');
  return tutorPersona() + '\n\n' + questionBlock(question)
    + '\n\nWHAT THE STUDENT HAS WRITTEN:\n' + answerText(question, answers)
    + (turns ? '\n\nCONVERSATION SO FAR:\n' + turns : '')
    + '\n\nStudent: ' + str(message, 1500)
    + '\n\nAnswer what they asked in a few sentences. '
    + (solved ? 'They have already worked through this question, so you may discuss the full answer freely.'
      : 'Explaining a concept, a similar example with different details, and checking their reasoning are all fine, but ' + NO_REVEAL)
    + '\n' + TUTOR_NAME + ':';
}

// The model is asked for JSON and usually sends it — sometimes fenced,
// sometimes with a sentence around it. Anything unreadable becomes a
// "partial" with the raw words as the feedback, never a crash.
export function parseCheckReply(text) {
  const raw = String(text || '').trim();
  let obj = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch (e) { obj = null; } }
  if (!obj || typeof obj !== 'object') return { verdict: 'partial', feedback: stripMarkdown(raw) || 'I could not read that properly. Try checking again.', nextStep: '' };
  const v = String(obj.verdict || '').toLowerCase();
  return {
    verdict: v === 'correct' || v === 'incorrect' ? v : 'partial',
    feedback: stripMarkdown(str(obj.feedback, 2000)),
    nextStep: stripMarkdown(str(obj.nextStep, 600)),
  };
}
export function stripMarkdown(text) {
  return String(text || '').replace(/```[a-z]*\n?|```/gi, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '').trim();
}

/* ---------- progress on this phone ---------- */
export function progressKey(id) { return 'polymath-tutor:' + id; }
// `filed` is what this phone has put into the Study Buddy mistake book, per
// question: 'filed' (a card is there) or 'cleared' (it was got right since).
export function emptyProgress() { return { answers: {}, results: {}, attempts: {}, hints: {}, chats: {}, solutions: {}, filed: {} }; }
export function readProgress(storage, id) {
  try {
    const raw = storage && storage.getItem(progressKey(id));
    const p = raw ? JSON.parse(raw) : null;
    const base = emptyProgress();
    if (!p || typeof p !== 'object') return base;
    Object.keys(base).forEach(k => { if (p[k] && typeof p[k] === 'object') base[k] = p[k]; });
    return base;
  } catch (e) { return emptyProgress(); }
}
export function writeProgress(storage, id, progress) {
  try { storage && storage.setItem(progressKey(id), JSON.stringify(progress)); return true; } catch (e) { return false; }
}
// { done, correct, total } across the paper — "done" is any marked attempt.
export function paperScore(paper, progress) {
  const qs = (paper && paper.questions) || [];
  const res = (progress && progress.results) || {};
  let done = 0, correct = 0;
  qs.forEach(q => { const r = res[q.n]; if (r) { done++; if (r.verdict === 'correct') correct++; } });
  return { done, correct, total: qs.length };
}
export function solutionUnlocked(progress, n) {
  const p = progress || {};
  const r = p.results && p.results[n];
  return !!(r && r.verdict === 'correct') || ((p.attempts && p.attempts[n]) || 0) >= TUTOR_SOLUTION_AFTER;
}

/* =====================================================================
   🎙 THE POLYMATH, OUT LOUD — the pure half of the voice (v1.448.0)
   ---------------------------------------------------------------------
   The voice is Study Buddy's live tutor brought to the QR page: a live
   voice model over WebRTC that DELEGATES every academic thing the student
   says back to this page, where the same tutor engine that marks, hints and
   chats answers it with the question and the key in front of it. These are
   the words of that answer and the words of what the voice is told about
   the screen. Neither ever carries the key to the VOICE: only the delegated
   tutor sees it, and it is told the same "hints, not answers" rule as every
   other prompt in this file.
   ===================================================================== */
export const TUTOR_LIVE_ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/polymathLive';
// The server's own call length is the truth (`maxDurationSeconds`); this is
// only what the page assumes before the first call answers.
export const TUTOR_LIVE_MAX_SECONDS = 900;
// What a spoken reply may be: long enough for one step and a question back,
// short enough that a child is not lectured at through a phone speaker.
export const TUTOR_VOICE_MAX_CHARS = 700;
// Two quiet minutes and the microphone is switched off by itself.
export const TUTOR_VOICE_IDLE_MS = 120000;

// What the VOICE model is told about the screen. The question as printed and
// what the student has typed — never the key, which the voice must not have
// to keep secret.
export function voiceContext(question, answers, result) {
  if (!question) return 'The student is looking at the whole paper and has not opened a question yet. Ask which question they want help with.';
  const lines = ['THE QUESTION ON THE STUDENT\'S SCREEN (' + (question.label || 'Question') + '):', str(questionText(question), 2400),
    '', 'WHAT THE STUDENT HAS TYPED OR CHOSEN SO FAR:', str(answerText(question, answers), 1200)];
  if (result && result.verdict) lines.push('', 'The page last marked their answer: ' + result.verdict.toUpperCase() + '.');
  lines.push('', 'Delegate every request about this question to the client tutor.');
  return lines.join('\n');
}

// The conversation as the tutor reads it: the last few turns, labelled.
export function voiceTranscript(rows) {
  return (Array.isArray(rows) ? rows : []).slice(-10).map(r => (r && r.role === 'user' ? 'Student: ' : TUTOR_NAME + ': ') + str(r && r.text, 800).trim())
    .filter(line => !/:\s*$/.test(line)).join('\n');
}

// The DELEGATED tutor's prompt: the same persona, question, key and rule as
// the typed chat, with the spoken conversation in place of the typed one and
// an answer shaped to be SAID.
export function buildVoicePrompt(question, answers, rows, solved) {
  const said = voiceTranscript(rows);
  const rule = solved ? 'They have already worked through this question, so you may talk through the full answer.'
    : 'Explaining an idea, giving a similar example with different details and checking their reasoning are all fine, but ' + NO_REVEAL;
  const head = tutorPersona() + '\n\nYou are TALKING to the student out loud, through their phone. What you write is read aloud word for word.';
  if (!question) {
    return head + '\n\nThe student is on the paper\'s list of questions and has not opened one.\n\nCONVERSATION:\n' + (said || '(they have just started)')
      + '\n\nReply in one or two short spoken sentences: help them pick a question to start with, or answer a general science question simply. '
      + 'No lists, no symbols, nothing that only makes sense on a screen.\n' + TUTOR_NAME + ':';
  }
  return head + '\n\n' + questionBlock(question)
    + '\n\nWHAT THE STUDENT HAS TYPED OR CHOSEN:\n' + answerText(question, answers)
    + '\n\nTHE SPOKEN CONVERSATION SO FAR (the last line is what they just said):\n' + (said || '(nothing yet)')
    + '\n\nReply to what they just said, in at most three short spoken sentences, then usually end with one small question that gets them thinking. '
    + rule + ' If they tell you an answer out loud, say whether they are on the right track without reading the key out, and suggest they type it and press Check. '
    + 'Write numbers and units the way you would say them (say "degrees Celsius", not the symbol). No lists, no brackets, no symbols, no markdown.\n'
    + TUTOR_NAME + ':';
}

// A reply made fit to be spoken: no markdown, no stage directions, no
// leading "The Polymath:", one paragraph, and a cap that ends on a sentence.
export function speakable(text) {
  let s = stripMarkdown(text).replace(new RegExp('^\\s*' + TUTOR_NAME + '\\s*:\\s*', 'i'), '')
    .replace(/\[[^\]]{0,80}\]/g, ' ').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (s.length > TUTOR_VOICE_MAX_CHARS) {
    const cut = s.slice(0, TUTOR_VOICE_MAX_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    s = end > TUTOR_VOICE_MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut.trim() + '…';
  }
  return s;
}

// How long a call may last, from the server's answer. A junk value never
// SHRINKS the clock below what the page assumed.
export function voiceMaxSeconds(answer) {
  const n = answer && answer.maxDurationSeconds;
  return Number.isFinite(n) && n >= 60 && n <= 14400 ? Math.floor(n) : TUTOR_LIVE_MAX_SECONDS;
}
export function voiceClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* =====================================================================
   📕 THE STUDY BUDDY MISTAKE BOOK REMEMBERS (v1.448.0)
   ---------------------------------------------------------------------
   A student who has a Study Buddy account (polymathlc/tutor) can sign in
   on this page with it, and every question The Polymath marks wrong or
   partly right goes into THAT book: `users/{uid}/mistakes/{id}`, the very
   collection Study Buddy files its own marked worksheets into, in its own
   shape. So the next time they open Study Buddy, the question is there to
   practise again, with what they wrote and what was wrong with it.

   • ONE DOCUMENT PER QUESTION PER PAPER (`mistakeDocId`), so checking a
     question three times is one card that keeps the latest try, never
     three cards. Getting it right later marks that card `cleared` — Study
     Buddy's own "Sorted".
   • IT IS STUDY BUDDY'S SHAPE, field for field, with `source: 'polymath'`
     on top. A card with no picture is Study Buddy's 'text' tier, which is
     exactly what a question typed out on a phone is.
   • ONLY THE STUDENT'S OWN UID, and only a real (Google) account. An
     anonymous phone has no book to remember into.
   ===================================================================== */
export const MISTAKE_SOURCE = 'polymath';
export function mistakeDocId(paperId, n) {
  if (!validTutorId(paperId)) return '';
  const k = Number(n);
  return Number.isInteger(k) && k > 0 && k <= TUTOR_MAX_QUESTIONS ? MISTAKE_SOURCE + '-' + paperId + '-' + k : '';
}
// Study Buddy's subject values.
export function subjectKey(subject) {
  const s = String(subject || '').toLowerCase();
  if (/math/.test(s)) return 'math';
  if (/english/.test(s)) return 'english';
  if (/chinese|中文|华文/.test(s)) return 'chinese';
  return 'science';
}
// Study Buddy's levels are P3–P6; anything else is left blank rather than guessed.
export function levelKey(level) {
  const m = /^\s*p(?:rimary)?\s*([3-6])\s*$/i.exec(String(level || ''));
  return m ? 'P' + m[1] : '';
}
// The question's own number, for the card's "Q4" chip.
export function questionNumber(question) {
  const m = /(?:^|\b)(?:Q(?:uestion)?\s*)(\d{1,3}[a-z]?)\b/i.exec((question && question.label) || '');
  return m ? m[1] : String((question && question.n) || '');
}
export function shouldFileMistake(result) {
  return !!(result && (result.verdict === 'incorrect' || result.verdict === 'partial'));
}
// The document, in Study Buddy's own field names. `createdAt` is added by
// the writer (a server timestamp), and only on the FIRST write.
export function mistakeDoc(paper, paperId, question, answers, result, opts) {
  const o = opts || {};
  const q = question || {};
  const mcqSlots = answerSlots(q).filter(it => it.t === 'mcq');
  const onlyMcq = mcqSlots.length === 1 && answerSlots(q).length === 1;
  const it = onlyMcq ? mcqSlots[0] : null;
  const a = answers || {};
  const r = result || {};
  return {
    key: MISTAKE_SOURCE + '|' + paperId + '|' + (q.n || ''),
    source: MISTAKE_SOURCE,
    polymathPaper: paperId,
    polymathQuestion: q.n || 0,
    polymathUrl: tutorUrl(paperId, q.n),
    docId: '',
    docName: str(paper && paper.title, 200) || 'The Polymath',
    level: levelKey(o.level),
    subject: subjectKey(paper && paper.subject),
    page: 0,
    number: questionNumber(q),
    question: str(questionText(q), 4000),
    type: it ? 'mcq' : 'open',
    options: it ? it.options.slice(0, 8).map(opt => ({ label: str(opt.label, 4), text: str(opt.text, 240) })) : [],
    option: it ? str(a[it.id], 8) : '',
    studentAnswer: str(answerText(q, a), 2000),
    answer: str(keyText(q), 3000),
    explanation: '',
    feedback: str([r.feedback, r.nextStep].filter(Boolean).join(' '), 2000),
    verdict: r.verdict === 'partial' ? 'partial' : 'wrong',
    skipped: false,
    marks: q.marks ? String(q.marks) : '',
    topic: '', lo: '', sylTopic: '',
    blocks: [], imagePath: '', shot: '',
    attempts: Math.max(1, Number(o.attempts) || 1),
    cleared: false
  };
}
