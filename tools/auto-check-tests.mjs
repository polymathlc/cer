// Regression tests for 🚦 THE AUTO-CHECK — the loop that reads every question
// ⚡ Rapid add builds, hands the findings back to be fixed, and reads it again
// before it reaches the Vetting list.
// Run with:
//     node tools/auto-check-tests.mjs            all cases
//     node tools/auto-check-tests.mjs <name>     one case
//
// It loads the REAL `autoChk*` core and the REAL `tlVerdict` out of app.js.
//
// The whole point of this loop is that an author reads four cards instead of
// forty, so every way it goes wrong costs exactly the thing it was added to
// give back — and all of them are silent:
//
//  • A GREEN LAMP THAT LIES is the worst of them. A check that could not run
//    has cleared nothing, so an AI failure must be its own state and can never
//    read as green; a question the author then approves unread is one nothing
//    ever looked at.
//  • A QUESTION WITHHELD is the second. Whatever the lamp says, the question
//    reaches Vetting: one quietly held back because a model disliked it is one
//    its author never finds out about, which is far worse than an amber card.
//  • A REPAIR THAT MADE IT WORSE must be thrown away. The loop finishes on the
//    BEST question it saw, or a red repaired to amber and back to red files
//    the red one — three AI calls spent to hand back something worse than what
//    went in.
//  • A REPAIR THAT LOSES THE PICTURES is the silent one that looks like
//    somebody else's bug. The model returns an EMPTY "image" placeholder, so
//    without the positional re-attach every repaired question lands wearing
//    "Diagram missing" — indistinguishable from a page whose rectangles failed.
//  • …AND ONE THAT LOSES THE BATCH LEVEL. A repair may move the topic, and in
//    this app the level is read off the topic, so a re-file silently undoes the
//    level the author set for the whole pile.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

// Every cut ends with a NEWLINE. A window that stops mid-comment glues the
// next window's first line onto a `//`, which comments the declaration out and
// surfaces a thousand lines later as "X is not defined".
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};

// The world the loop runs in. Everything the auto-check does NOT own is a
// counted stub — what the checker finds is pinned by its own harness; what
// matters here is what the loop does with it.
const preamble = `
const HOOK = {
  reads: 0, repairs: 0, aiChecks: 0, media: 0, levels: [],
  prompts: [], warned: [], aiOn: true, plan: [], replies: [],
};
let _idSeq = 0;
function generateBlockId() { return 'gen_' + (++_idSeq); }
const console = { warn: (...a) => HOOK.warned.push(a.join(' ')), error: (...a) => HOOK.warned.push(a.join(' ')) };
const window = { __aiReady: () => HOOK.aiOn };
const document = { getElementById: () => null };
const localStorage = {
  _v: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
  setItem(k, v) { this._v[k] = String(v); },
};
const _imgEnhanceState = {};
const _tlCache = new Map();
function tlSig(q) { return 'sig:' + JSON.stringify((q && q.blocks) || []).length; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _docClip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function normalizeCategoryValue(c) { return String(c || ''); }
function applyMcqCategory(q) { return q; }
function qEnsurePartExplanations() { return []; }
function currentTopics() { return ['Heat', 'Light']; }
function currentTopicsByLevel() { return { P5: ['Heat'] }; }
function _partsPromptRules() { return '- PARTS RULES\\n'; }
function aiGrounding() { return 'GROUNDED\\n'; }
function _serializeQuestionForRegen(q) { return 'SERIALISED ' + (q.title || ''); }
function _rapidApplyLevel(q, level) { HOOK.levels.push(level); }

// The two layers of the real checker, driven by HOOK.plan: one entry per read,
// each a list of findings. The AI half throws when the entry says 'throw'.
function _sevRank(s) { return s === 'high' ? 0 : s === 'med' ? 1 : 2; }
async function _cqAiCheck(q) {
  HOOK.aiChecks++;
  const step = HOOK.plan[Math.min(HOOK.reads, HOOK.plan.length - 1)];
  if (step === 'throw') throw new Error('model refused');
  return (step || []).filter(f => f.ai);
}
function _cqLocalFindings(q, ran) {
  HOOK.reads++;
  const step = HOOK.plan[Math.min(HOOK.reads - 1, HOOK.plan.length - 1)];
  return step === 'throw' ? [] : (step || []).filter(f => !f.ai);
}
async function _cqMedia(q) {
  HOOK.media++;
  return ((q.blocks || []).filter(b => b.type === 'image' && b.url)).map(() => ({ mimeType: 'image/png', data: 'x' }));
}
async function askGeminiVision(prompt) { HOOK.repairs++; HOOK.prompts.push(prompt); return HOOK.replies.shift(); }
async function askGemini(prompt) { HOOK.repairs++; HOOK.prompts.push(prompt); return HOOK.replies.shift(); }
function _parseAIJson(raw) { if (raw === 'THROW') throw new Error('bad json'); return raw; }

// The real builder is pinned by its own harness; here it only has to turn a
// payload into blocks with FRESH ids, which is the fact the picture re-attach
// exists to survive.
function buildBlocksFromAi(payload) {
  const blocks = ((payload && payload.blocks) || []).map(b => {
    const o = { id: generateBlockId(), type: b.type };
    if (b.type === 'text') { o.content = b.text || ''; if (b.marks) o.marks = b.marks; }
    else if (b.type === 'image') { o.url = ''; o.caption = b.caption || ''; }
    else if (b.type === 'plainanswer') o.content = b.text || '';
    else if (b.type === 'explanation') o.content = b.text || '';
    return o;
  });
  return { blocks, selectedBlanks: {} };
}
`;

const M = new Function(
  preamble +
  cut('function tlVerdict(findings) {', '\nfunction tlSig', 'tlVerdict') +
  cut('const QMARKS_MAX = 99;', '\n// …and put one back', 'marks core') +
  cut('const AI_MARKS_MAX_LIFT = 20;', '\n// The rectangle-selection', 'marks lifter') +
  cut('const AUTOCHK_TRIES = 3;', '\nasync function processRapidJob', 'auto-check core') +
  `\nreturn { HOOK, tlVerdict, autoChkOn, setAutoChkOn, autoChkRead, autoChkState, autoChkBetter,
    autoChkRun, autoChkStamp, autoChkCardHtml, autoChkTally, autoChkBatchNote,
    _autoChkApply, _autoChkRepairPrompt, _aiLiftMarks, _aiMarksSane, _tlCache, _imgEnhanceState,
    AUTOCHK_TRIES };\n`
)();

const { HOOK } = M;
const reset = (plan, replies) => {
  HOOK.reads = 0; HOOK.repairs = 0; HOOK.aiChecks = 0; HOOK.media = 0;
  HOOK.levels = []; HOOK.prompts = []; HOOK.warned = []; HOOK.aiOn = true;
  HOOK.plan = plan || [[]];
  HOOK.replies = replies || [];
};
const F = (severity, ai) => ({ type: 'MCQ', severity, title: 't', detail: 'd', ai: !!ai });
const Q = (over) => Object.assign({
  id: 'q1', title: 'A question', topic: 'Heat', category: 'CER',
  blocks: [
    { id: 'b1', type: 'text', content: 'Why did it melt?' },
    { id: 'b2', type: 'image', url: 'https://pic/1.png', caption: 'Fig 1' },
    { id: 'b3', type: 'plainanswer', content: 'It absorbed heat.' },
  ],
  blanks: {},
}, over || {});
const reply = (blocks) => ({ title: 'A question', topic: 'Heat', category: 'CER', blocks });

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'expected true'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'mismatch') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); };

// ── the verdict, and what "green" is allowed to mean ────────────────────────

test('a clean question costs ONE read and no repair at all', async () => {
  reset([[]]);
  const q = Q();
  const res = await M.autoChkRun(q);
  eq(res.state, 'green');
  eq(res.tries, 1, 'stopped at the first green');
  eq(HOOK.repairs, 0, 'nothing to fix, so nothing was paid for');
});

test('a check that could not RUN is never green', async () => {
  reset(['throw']);
  const res = await M.autoChkRun(Q());
  eq(res.state, 'error', '"the check found nothing" and "the check could not run" are opposite things');
  ok(res.error, 'and it says what went wrong');
});

test('…and an error STOPS the loop rather than repairing three times', async () => {
  reset(['throw', 'throw', 'throw']);
  const res = await M.autoChkRun(Q());
  eq(res.tries, 1, 'a repair is another AI call down the same road');
  eq(HOOK.repairs, 0);
});

test('AI switched off on the device is an error, not a clean bill of health', async () => {
  reset([[F('high')]]);
  HOOK.aiOn = false;
  const res = await M.autoChkRun(Q());
  eq(res.state, 'error');
  eq(HOOK.aiChecks, 0, 'the AI half was never called');
  eq(res.findings.length, 1, 'and the free structural half still came through');
});

test('the verdict is the traffic light’s own plain code, not a second opinion', () => {
  eq(M.tlVerdict([]), 'green');
  eq(M.tlVerdict([F('low')]), 'amber', 'a low finding is still worth a look');
  eq(M.tlVerdict([F('low'), F('high')]), 'red');
});

// ── the loop ────────────────────────────────────────────────────────────────

test('red → repaired → green stops at green and keeps the repair', async () => {
  reset([[F('high')], []], [reply([{ type: 'text', text: 'Fixed wording' }, { type: 'image' }, { type: 'plainanswer', text: 'It absorbed heat.' }])]);
  const q = Q();
  const res = await M.autoChkRun(q);
  eq(res.state, 'green');
  eq(res.tries, 2);
  eq(HOOK.repairs, 1);
  eq(q.blocks[0].content, 'Fixed wording', 'the repaired blocks are the ones kept');
});

test('a question still red after three tries is RETURNED, never dropped', async () => {
  reset([[F('high')], [F('high')], [F('high')]],
    [reply([{ type: 'text', text: 'v2' }, { type: 'image' }]), reply([{ type: 'text', text: 'v3' }, { type: 'image' }])]);
  const q = Q();
  const res = await M.autoChkRun(q);
  eq(res.state, 'red');
  eq(res.tries, M.AUTOCHK_TRIES, 'it used its three tries');
  eq(HOOK.repairs, M.AUTOCHK_TRIES - 1, 'and repaired between them, never after the last read');
  ok(q.blocks.length, 'the question still exists — it goes to vetting wearing its lamp');
});

test('a repair that came back WORSE is thrown away', async () => {
  // amber → repair → red. The loop must finish on the amber question.
  reset([[F('med')], [F('high')], [F('high')]],
    [reply([{ type: 'text', text: 'WORSE' }, { type: 'image' }]), reply([{ type: 'text', text: 'WORSE2' }, { type: 'image' }])]);
  const q = Q();
  const res = await M.autoChkRun(q);
  eq(res.state, 'amber', 'the best verdict seen');
  eq(q.blocks[0].content, 'Why did it melt?', 'and the question that earned it');
});

test('at the same colour, FEWER findings wins', () => {
  const a = { state: 'amber', findings: [F('med')] };
  const b = { state: 'amber', findings: [F('med'), F('low')] };
  ok(M.autoChkBetter(a, b), 'two problems cleared to one is a better question');
  ok(!M.autoChkBetter(b, a));
  ok(M.autoChkBetter({ state: 'green', findings: [] }, a), 'green still beats amber');
  ok(M.autoChkBetter({ state: 'red', findings: [] }, { state: 'error', findings: [] }), 'a verdict beats no verdict');
});

test('the batch LEVEL is re-applied after every repair', async () => {
  reset([[F('high')], []], [reply([{ type: 'text', text: 'v2' }, { type: 'image' }])]);
  await M.autoChkRun(Q(), { level: 'P5' });
  eq(HOOK.levels.length, 1, 'once per repair');
  eq(HOOK.levels[0], 'P5', 'a repair that moved the topic would otherwise undo the level for the whole pile');
});

test('a repair call that FAILS leaves the question with the verdict it has', async () => {
  reset([[F('high')]], ['THROW']);
  const q = Q();
  const res = await M.autoChkRun(q);
  eq(res.state, 'red');
  eq(q.blocks[0].content, 'Why did it melt?', 'untouched');
});

test('the repair prompt carries the findings, the question and its pictures', async () => {
  reset([[F('high')], []], [reply([{ type: 'text', text: 'v2' }, { type: 'image' }])]);
  await M.autoChkRun(Q());
  const p = HOOK.prompts[0];
  ok(/WHAT THE CHECKER FOUND/.test(p), 'the findings are in the prompt');
  ok(/SERIALISED/.test(p), 'and the question as it stands');
  ok(/GROUNDED/.test(p), 'and it is grounded in the teaching notes like every other authoring call');
  ok(/Fix ONLY what the checker listed/.test(p), 'a repair is a correction, not a rewrite');
  ok(/never add or remove one/.test(p), 'and it may not touch the picture placeholders');
});

// ── applying a repair ───────────────────────────────────────────────────────

test('the pictures are re-attached POSITIONALLY and never re-fetched', () => {
  reset();
  const q = Q();
  M._imgEnhanceState['b2'] = { originalUrl: 'https://pic/1.png' };
  ok(M._autoChkApply(q, reply([{ type: 'text', text: 'v2' }, { type: 'image' }, { type: 'plainanswer', text: 'a' }])));
  const img = q.blocks.find(b => b.type === 'image');
  eq(img.url, 'https://pic/1.png', 'the model returns an EMPTY placeholder — without this every repair strips the figure');
  eq(img.caption, 'Fig 1');
  ok(M._imgEnhanceState[img.id], 'and Crop / Touch up / Enhance still have their original to work from');
});

test('a SHORT reply never loses a picture', () => {
  reset();
  const q = Q({ blocks: [
    { id: 'b1', type: 'text', content: 'x' },
    { id: 'b2', type: 'image', url: 'https://pic/1.png' },
    { id: 'b3', type: 'image', url: 'https://pic/2.png' },
  ] });
  ok(M._autoChkApply(q, reply([{ type: 'text', text: 'v2' }, { type: 'image' }])));
  const urls = q.blocks.filter(b => b.type === 'image').map(b => b.url);
  eq(urls.length, 2, 'the leftover is appended rather than dropped');
  ok(urls.includes('https://pic/2.png'));
});

test('…and a LONG one never gains an empty picture block', () => {
  reset();
  const q = Q();
  ok(M._autoChkApply(q, reply([{ type: 'text', text: 'v2' }, { type: 'image' }, { type: 'image' }])));
  const imgs = q.blocks.filter(b => b.type === 'image');
  eq(imgs.length, 1, 'an extra placeholder with nothing to put in it prints as a blank space');
  eq(imgs[0].url, 'https://pic/1.png');
});

test('an EMPTY reply is refused rather than replacing the question with nothing', () => {
  reset();
  const q = Q();
  const before = JSON.stringify(q.blocks);
  eq(M._autoChkApply(q, reply([])), false);
  eq(M._autoChkApply(q, null), false);
  eq(JSON.stringify(q.blocks), before, 'a truncated repair must not destroy the question');
});

// ── what the author is left with ────────────────────────────────────────────

test('the stamp lights the traffic light’s OWN lamp rather than inventing a second', () => {
  reset();
  M._tlCache.clear();
  const q = Q();
  M.autoChkStamp(q, { state: 'amber', tries: 2, findings: [F('med')], error: '' });
  eq(q.autoCheck.state, 'amber');
  eq(q.autoCheck.tries, 2);
  eq(q.autoCheck.found, 1, 'how many were found');
  eq(q.autoCheck.findings.length, 1, '…and WHAT they were, so the panel can still show them tomorrow');
  ok(q.autoCheck.sig, 'signed, so an edit since puts the remembered lamp out');
  const rec = M._tlCache.get('q1');
  ok(rec, 'the vetting card already draws a lamp — it just had nothing to draw');
  eq(rec.verdict, 'amber');
  eq(rec.state, 'done');
  ok(rec.sig, 'signed from the finished question, so an edit puts the lamp out as it does anywhere else');
});

test('an errored check never seeds a colour', () => {
  reset();
  M._tlCache.clear();
  const q = Q();
  M.autoChkStamp(q, { state: 'error', tries: 1, findings: [], error: 'AI is off' });
  const rec = M._tlCache.get('q1');
  eq(rec.state, 'error');
  eq(rec.verdict, '', 'a lamp that lit green here would say a question was read when nothing read it');
  eq(q.autoCheck.error, 'AI is off');
});

test('a stamp survives the session it was made in', () => {
  // `_tlCache` dies with the tab. A card opened the next morning must not wear
  // a red badge over a grey lamp with nothing behind it.
  const fn = cut('function _tlFromStamp(q) {', '\nfunction tlFresh', 'stamp adopter + tlStateOf');
  ok(/q\.autoCheck/.test(fn), 'tlStateOf reads the verdict off the question');
  ok(/a\.sig !== tlSig\(q\)/.test(fn), 'and reports it stale once the question has changed');
  ok(/if \(!rec\) return _tlFromStamp\(q\)/.test(fn), 'a live check always outranks a remembered one');
  ok(/state: 'error'/.test(fn), 'and a failed check is remembered as a failure, never as a colour');
});

test('the findings kept on the question are capped and trimmed', () => {
  reset();
  const many = Array.from({ length: 30 }, () => F('med'));
  const q = Q();
  M.autoChkStamp(q, { state: 'red', tries: 3, findings: many, error: '' });
  eq(q.autoCheck.found, 30, 'the honest count');
  ok(q.autoCheck.findings.length <= 12, 'an attempt is a document and a document dies at 1 MB');
  const badge = M.autoChkCardHtml(q);
  ok(/30 things/.test(badge), 'and the badge reports what was found, not what was kept');
});

test('the card badge says which of the four states it is, and a question with none says nothing', () => {
  eq(M.autoChkCardHtml({}), '', 'a question built before this shipped wears no badge at all');
  const g = M.autoChkCardHtml({ autoCheck: { state: 'green', tries: 1, findings: 0 } });
  ok(/🟢/.test(g) && !/fixed/.test(g), 'clean first time');
  const r = M.autoChkCardHtml({ autoCheck: { state: 'red', tries: 3, found: 2 } });
  ok(/🔴/.test(r) && /fixed 2×/.test(r), 'and how many tries it took');
});

test('the batch note tallies the lamps and stays silent on an unchecked pile', () => {
  eq(M.autoChkBatchNote([{}, {}]), '', 'nothing checked, nothing claimed');
  const note = M.autoChkBatchNote([
    { autoCheck: { state: 'green' } }, { autoCheck: { state: 'green' } }, { autoCheck: { state: 'red' } },
  ]);
  ok(/2 🟢/.test(note) && /1 🔴/.test(note), note);
  eq(M.autoChkTally([{ autoCheck: { state: 'amber' } }]).checked, 1);
});

test('the switch is remembered, and defaults ON', () => {
  reset();
  eq(M.autoChkOn(), true, 'an author who never finds the switch still gets checked questions');
  M.setAutoChkOn(false);
  eq(M.autoChkOn(), false);
  M.setAutoChkOn(true);
  eq(M.autoChkOn(), true);
});

// ── [2] the marks come off the paper ────────────────────────────────────────

test('the model’s own marks field wins, and the printed marker comes out of the wording', () => {
  const r = M._aiLiftMarks('<p>Explain why. [2]</p>', 3);
  eq(r.marks, 3, 'the field the model filled in');
  ok(!/\[\s*2\s*\]/.test(r.content), 'and the marker is not left in the text as well');
});

test('a printed [2] with no field is LIFTED, not left in the sentence', () => {
  const r = M._aiLiftMarks('<p>Explain why the bulb lit up. [2]</p>');
  eq(r.marks, 2);
  eq(r.content, '<p>Explain why the bulb lit up.</p>');
});

test('an implausible bracketed number is left exactly where the paper had it', () => {
  const r = M._aiLiftMarks('<p>…as reported in 1998. [1998]</p>');
  eq(r.marks, 0, 'a citation or a year is not what one part of a question is worth');
  ok(/\[1998\]/.test(r.content), 'and the wording is untouched');
  eq(M._aiMarksSane(0), 0);
  eq(M._aiMarksSane(21), 0, 'past the lift cap');
  eq(M._aiMarksSane('4'), 4);
});

test('a block with no marks anywhere is byte-for-byte what it always was', () => {
  const html = '<p>Name the process shown in Diagram 1 [see page 4].</p>';
  const r = M._aiLiftMarks(html);
  eq(r.marks, 0);
  eq(r.content, html, 'a bracket in the MIDDLE of a question is prose');
});

// ── the wiring, read out of app.js itself ───────────────────────────────────

test('the loop runs after the pictures are attached and BEFORE the vetting save', () => {
  const fn = cut('async function processRapidJob(jobId, file, batchLevel, opts) {', '\nfunction _failRapidJob', 'rapid job');
  const chk = fn.indexOf('autoChkRun(q,');
  ok(chk > -1, 'the loop is wired in');
  ok(chk > fn.indexOf('_fillBlocksFromAiBoxes'), 'after the crop, or every question reads as one whose figure is missing');
  ok(chk > fn.indexOf('aiWritePartExplanations'), 'and after the per-part explanations');
  ok(chk < fn.indexOf('saveVettingQuestion(q)'), 'and before the question is written');
  ok(/autoChkStamp\(q, res\)/.test(fn), 'and the verdict is stamped on it');
});

test('nothing in the loop withholds a question or writes one', () => {
  // The LOOP reads a question and repairs it in memory; the pipeline it sits
  // inside is what saves. The ONE exception is `autoChkAfterMerge`, which
  // re-saves a question the merge has ALREADY written — so it is cut away and
  // named rather than quietly permitted.
  const block = cut('const AUTOCHK_TRIES = 3;', '\nasync function autoChkAfterMerge', 'auto-check loop');
  ok(!/saveVettingQuestion|saveQuestion|setDoc|deleteDoc/.test(block), 'the loop READS a question; the pipeline saves it');
  ok(!/vettingList/.test(block), 'and it never reaches into the list itself');
  ok(!/return null|continue;/.test(block.slice(block.indexOf('async function autoChkRun'))),
    'and it never hands back nothing — the question reaches vetting whatever the lamp says');
  const after = cut('async function autoChkAfterMerge(q, level) {', '\n// How a batch came out', 'after-merge');
  eq((after.match(/saveVettingQuestion/g) || []).length, 1, 'the one write, on a document that already exists');
});

test('it calls the SAME checker, never a second prompt of its own', () => {
  const block = cut('const AUTOCHK_TRIES = 3;', '\nasync function processRapidJob', 'auto-check core');
  ok(/_cqAiCheck\(q\)/.test(block), "✅ Check Questions' own AI pass");
  ok(/_cqLocalFindings\(q, ran\)/.test(block), 'and its own instant checks');
  ok(/tlVerdict\(findings\)/.test(block), "and 🚦 the traffic light's own plain-code colour");
  // The repair is allowed its own prompt — it is a different job — but the
  // CHECK may never be, or the lamp and the queue disagree about the same
  // question the week after they shipped.
  const readFn = block.slice(block.indexOf('async function autoChkRead'), block.indexOf('function autoChkState'));
  ok(!/askGemini/.test(readFn), 'the check itself asks no model of its own');
});

test('a question stitched across a page break is read again, as a whole', () => {
  const fn = cut('async function _rapidExpandPdf(file, level, release) {', '\nfunction startRapidJob', 'pdf feeder');
  const settle = fn.slice(fn.indexOf('const settle'), fn.indexOf('for (let p = 1'));
  ok(/autoChkAfterMerge\(merged, level\)/.test(settle),
    'the halves were each checked ALONE — one with no last parts, one with no stem');
  const helper = cut('async function autoChkAfterMerge(q, level) {', '\n// How a batch came out', 'after-merge');
  ok(/autoChkRun\(q, \{ level \}\)/.test(helper), 'the same loop');
  ok(/autoChkStamp\(q, res\)/.test(helper), 'stamped');
  ok(/await saveVettingQuestion\(q\)/.test(helper), 'and written back — the merge already saved it, so this is one small write more');
});

test('a merged question loses its verdict — neither half describes what now exists', () => {
  const fn = cut('function qMergeQuestions(sources, opts) {', '\n// What the merged question', 'merge');
  ok(/delete merged\.autoCheck/.test(fn), 'a green badge on a stitched question would say it had been read when nothing has');
});

test('every build prompt asks for the marks, and the shared parts fragment says how', () => {
  // The repair prompt asks for it too and lives inside the auto-check block, so
  // that one is cut away before the four BUILD prompts are counted.
  const block = cut('const AUTOCHK_TRIES = 3;', '\nasync function processRapidJob', 'auto-check core');
  const builds = src.replace(block, '');
  eq((builds.match(/include "marks" ONLY when/g) || []).length, 4,
    'Build from screenshot, ⚡ Rapid add / the bulk import, 🔄 Regenerate and the exam paper builder');
  const rules = cut('function _partsPromptRules() {', '\n// The rectangle-selection', 'parts rules');
  ok(/- MARKS:/.test(rules), 'stated ONCE, in the fragment all four carry');
  ok(/NEVER invent a number the page does not show/.test(rules), 'a mark allocation nobody wrote is one a class can never earn');
});

test('the lift is wired into the ONE door every AI authoring path goes through', () => {
  const fn = cut('function buildBlocksFromAi(data) {', '\nfunction _aiSuggestedTags', 'buildBlocksFromAi');
  ok(/_aiLiftMarks\(txt, b && b\.marks\)/.test(fn), 'in the text branch');
  ok(/if \(mk\.marks\) blk\.marks = mk\.marks;/.test(fn), 'and a block with none is left exactly as it was');
});

// ── runner ──────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  try { await c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
