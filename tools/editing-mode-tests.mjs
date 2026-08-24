// Regression tests for ✏️ EDITING MODE — the whole worksheet, condensed, in
// one scroll.
// Run with:
//     node tools/editing-mode-tests.mjs            all cases
//     node tools/editing-mode-tests.mjs <name>     one case
//
// It loads the REAL `em*` section out of app.js and runs it against stubs.
// Editing mode puts EVERY question of a sheet into the one block editor at
// once, which is the thing that makes it useful and also the thing that makes
// every failure here silent — the editor still renders, still types, still
// saves, and is quietly working on the wrong question:
//
//  • emScope is the ONE place a block's question is resolved. Hand back the
//    whole array and qPartMap — which inherits FORWARD — files every block of
//    question 4 under the last part of question 3, and the 🤖 AI answer button
//    sends the model the entire paper as one question. Nothing throws; the
//    answer just comes back about the wrong thing.
//  • A block id must be unique across the SHEET. Two questions duplicated from
//    each other carry the same ids, and every handler in the editor finds its
//    block BY ID — so a collision is typing into question 7 and watching
//    question 2 change.
//  • A newly inserted block adopts the question ABOVE it, which is where the
//    insert bar that made it was drawn. Adopt the wrong one and the block is
//    saved onto a question it was never part of.
//  • Only what CHANGED may be written. A signature that reports every question
//    as changed turns one edit into forty writes; one that reports none turns
//    Save into a button that does nothing.
//  • emMayRemove is what stops a question being emptied — a question with no
//    blocks has nowhere to draw its heading and nothing to own the next block
//    inserted into it.
//  • emStays decides what folds behind the ⚙, and a panel a RAIL ICON OPENS
//    must never be one of them. 🔑 Assign keywords renders its chip panel as a
//    sibling of the answer box, so the fold hid it behind the very ⚙ the author
//    had not pressed: the button lit up and nothing appeared — the whole
//    keyword feature dead in editing mode and perfect everywhere else.
//  • emHoistable decides what reaches the rail. A self-contained panel's own
//    buttons act on what is IN it, not on the block, so on the rail they read
//    as block actions: the answer screenshot's "× Remove" beside the block's
//    own 🗑 is a second, differently-meaning bin.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};

const section = cut('var _em = {', '\n// A question with no blocks has nowhere', 'editing mode')
  + cut('function emMayRemove(id) {', '\n}\n', 'emMayRemove') + '\n}\n';

const PRELUDE = `
let blocks = [];
let editorKeywords = {};
let selectedBlanks = {};
let questionBank = [];
let savedWorksheets = [];
const toasts = [];
let idSeq = 0;
function generateBlockId() { return 'gen_' + (++idSeq); }
function kwFieldKey(blockId, field) {
  const f = String(field || 'content');
  return (f === 'content' || f === 'text') ? String(blockId) : String(blockId) + '_' + f;
}
function showToast(msg, kind) { toasts.push({ msg, kind }); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function syncEditorDomToBlocks() {}
function renderBlocks() {}
function renderQuestionBank() {}
function renderWsPreview() {}
function editQuestion() {}
function closeWorksheetPreview() {}
function _canAuthor() { return true; }
function _wsSavedQuestions() { return []; }
function _wsEmptyMsg() { return 'empty'; }
async function saveQuestion() { return true; }
let _wsPreviewPaper = null, _wsPreviewSaved = null;
const document = { getElementById: () => null, body: { classList: { add(){}, remove(){}, toggle(){} } } };
`;

const TAIL = `
return {
  em: _em, emActive, emScope, emOwnerQuestion, emTitleFor, emTopicFor,
  emBlocksOf, emKwFor, emBlanksFor, emSigOf, emChangedEntries,
  emAdoptOwners, emIconFor, emMayRemove, emStays, emHoistable,
  EM_PRIMARY, EM_KEEP,
  state: {
    set blocks(v) { blocks = v; }, get blocks() { return blocks; },
    set editorKeywords(v) { editorKeywords = v; }, get editorKeywords() { return editorKeywords; },
    set selectedBlanks(v) { selectedBlanks = v; }, get selectedBlanks() { return selectedBlanks; },
    set questionBank(v) { questionBank = v; }, get questionBank() { return questionBank; },
    toasts,
  },
};`;

const M = new Function(PRELUDE + section + TAIL)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
  }
};

// A sheet of `n` questions, each with `per` blocks, loaded the way
// emOpenQuestions loads one.
function sheet(spec) {
  M.state.blocks = [];
  M.state.editorKeywords = {};
  M.state.selectedBlanks = {};
  M.state.questionBank = [];
  M.em.owner = {};
  M.em.qs = [];
  M.em.on = true;
  spec.forEach((q, i) => {
    M.state.questionBank.push({ id: q.id, title: q.title || ('Q' + (i + 1)), topic: q.topic || 'Heat' });
    q.blocks.forEach(b => {
      M.state.blocks.push(b);
      M.em.owner[String(b.id)] = String(q.id);
    });
    M.em.qs.push({ id: String(q.id), key: 'k' + (i + 1), n: i + 1, title: q.title || ('Q' + (i + 1)), label: '', sig: '' });
  });
  M.em.qs.forEach(e => { e.sig = M.emSigOf(e); });
}
const tb = (id, content) => ({ id, type: 'text', content: content || '', part: '' });

// ── emScope: the boundary between two questions ─────────────────────────────
test('scope hands back only the blocks of the block\'s own question', () => {
  sheet([
    { id: 'qa', blocks: [tb('a1'), tb('a2')] },
    { id: 'qb', blocks: [tb('b1'), tb('b2'), tb('b3')] },
  ]);
  eq(M.emScope('a2').map(b => b.id), ['a1', 'a2'], 'question A');
  eq(M.emScope('b1').map(b => b.id), ['b1', 'b2', 'b3'], 'question B');
});

test('scope is the WHOLE array when editing mode is off — the ordinary editor', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }, { id: 'qb', blocks: [tb('b1')] }]);
  M.em.on = false;
  ok(!M.emActive(), 'not active');
  eq(M.emScope('a1').map(b => b.id), ['a1', 'b1'], 'unchanged editor');
  M.em.on = true;
});

test('a block nobody owns still scopes to something rather than to nothing', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }]);
  eq(M.emScope('nosuch').map(b => b.id), ['a1'], 'falls back to the whole array');
});

// ── the AI prompts are grounded on the OWNING question ──────────────────────
test('the title and topic come from the owning question, not the create page', () => {
  sheet([
    { id: 'qa', blocks: [tb('a1')], title: 'Melting ice', topic: 'Heat' },
    { id: 'qb', blocks: [tb('b1')], title: 'Shadows', topic: 'Light' },
  ]);
  eq(M.emTitleFor('b1'), 'Shadows', 'title');
  eq(M.emTopicFor('b1'), 'Light', 'topic');
  // …and the heading's own edit wins, because that is what will be saved.
  M.em.qs[1].title = 'Shadows and light';
  eq(M.emTitleFor('b1'), 'Shadows and light', 'edited title');
});

// ── a new block joins the question ABOVE it ─────────────────────────────────
test('an inserted block adopts the question above it', () => {
  sheet([
    { id: 'qa', blocks: [tb('a1'), tb('a2')] },
    { id: 'qb', blocks: [tb('b1')] },
  ]);
  M.state.blocks.splice(2, 0, tb('new'));   // right after the last block of A
  M.emAdoptOwners();
  eq(M.em.owner['new'], 'qa', 'joined the question above');
});

test('a block inserted at the very top adopts the question below it', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }, { id: 'qb', blocks: [tb('b1')] }]);
  M.state.blocks.unshift(tb('new'));
  M.emAdoptOwners();
  eq(M.em.owner['new'], 'qa', 'joined the first question');
});

test('adopting never re-files a block that already has an owner', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }, { id: 'qb', blocks: [tb('b1')] }]);
  M.emAdoptOwners();
  eq(M.em.owner['b1'], 'qb', 'still question B');
});

// ── keywords and blanks split back out by question ──────────────────────────
test('keywords and blanks are split by the block they are marked on', () => {
  sheet([
    { id: 'qa', blocks: [tb('a1'), { id: 'a2', type: 'answer' }] },
    { id: 'qb', blocks: [tb('b1')] },
  ]);
  M.state.editorKeywords = { a1: { 2: true }, a2_claim: { 0: true }, b1: { 1: true } };
  M.state.selectedBlanks = { a1: [3], b1: [4] };
  eq(M.emKwFor(M.emBlocksOf('qa')), { a1: { 2: true }, a2_claim: { 0: true } }, 'question A keywords');
  eq(M.emKwFor(M.emBlocksOf('qb')), { b1: { 1: true } }, 'question B keywords');
  eq(M.emBlanksFor(M.emBlocksOf('qb')), { b1: [4] }, 'question B blanks');
});

// ── only what changed is written ────────────────────────────────────────────
test('a sheet nobody has touched reports nothing to save', () => {
  sheet([{ id: 'qa', blocks: [tb('a1', 'x')] }, { id: 'qb', blocks: [tb('b1', 'y')] }]);
  eq(M.emChangedEntries().length, 0, 'nothing changed');
});

test('editing one question reports that one and no other', () => {
  sheet([{ id: 'qa', blocks: [tb('a1', 'x')] }, { id: 'qb', blocks: [tb('b1', 'y')] }]);
  M.state.blocks[1].content = 'y — corrected';
  const changed = M.emChangedEntries();
  eq(changed.map(c => c.e.id), ['qb'], 'only question B');
});

test('a keyword marked on one question changes that question only', () => {
  sheet([{ id: 'qa', blocks: [tb('a1', 'x')] }, { id: 'qb', blocks: [tb('b1', 'y')] }]);
  M.state.editorKeywords = { b1: { 0: true } };
  eq(M.emChangedEntries().map(c => c.e.id), ['qb'], 'only question B');
});

test('retitling a question in its heading counts as a change', () => {
  sheet([{ id: 'qa', blocks: [tb('a1', 'x')] }]);
  M.em.qs[0].title = 'A better title';
  eq(M.emChangedEntries().map(c => c.e.id), ['qa'], 'the retitled question');
});

// ── a question may never be emptied ─────────────────────────────────────────
test('the last block of a question may not be deleted', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }, { id: 'qb', blocks: [tb('b1'), tb('b2')] }]);
  ok(M.emMayRemove('b1'), 'question B has two — one may go');
  ok(!M.emMayRemove('a1'), 'question A has one — it may not');
  ok(/at least one block/i.test(M.state.toasts[M.state.toasts.length - 1].msg), 'and it says why');
});

test('outside editing mode every block may be deleted, as it always could', () => {
  sheet([{ id: 'qa', blocks: [tb('a1')] }]);
  M.em.on = false;
  ok(M.emMayRemove('a1'), 'the ordinary editor is untouched');
  M.em.on = true;
});

// ── the rail's icons ────────────────────────────────────────────────────────
test('a button that opens with an emoji keeps that emoji', () => {
  eq(M.emIconFor('✨ Improve'), '✨', 'improve');
  eq(M.emIconFor('✂️ Shorten'), '✂️', 'shorten — the variation selector goes with it');
  eq(M.emIconFor('✍️ AI complete'), '✍️', 'complete');
  eq(M.emIconFor('🎨 Enhance with colour'), '🎨', 'colour');
  eq(M.emIconFor('🤖 AI answer'), '🤖', 'answer');
});

test('a button with no emoji is read from its words, never sliced mid-label', () => {
  eq(M.emIconFor('Auto'), '⤢', 'Auto');
  eq(M.emIconFor('Use original'), '↩', 'use original');
  ok(M.emIconFor('−').length <= 2, 'a one-character button is left as it is');
  eq(M.emIconFor('−'), '−', 'minus');
  eq(M.emIconFor('+'), '+', 'plus');
});

test('a label nobody has a rule for still yields something to click', () => {
  const ic = M.emIconFor('Wobble the thing');
  ok(ic && ic.length && ic.length <= 2, 'one glyph: ' + JSON.stringify(ic));
});

// ── what stays on screen, and what folds behind the ⚙ ──────────────────────
// Fake elements: every selector in play is a plain class selector or a
// comma-separated list of them, which is all these need to answer.
function fake(cls, kids, attrs) {
  const e = {
    _cls: String(cls || '').split(/\s+/).filter(Boolean),
    children: kids || [],
    parent: null,
    attrs: attrs || {},
  };
  e.classList = { contains: c => e._cls.indexOf(c) >= 0 };
  e.matches = sel => String(sel).split(',').map(x => x.trim()).filter(Boolean)
    .some(x => x[0] === '.' && e._cls.indexOf(x.slice(1)) >= 0);
  e.querySelector = sel => {
    for (const k of e.children) { if (k.matches(sel)) return k; const d = k.querySelector(sel); if (d) return d; }
    return null;
  };
  e.closest = sel => { let n = e; while (n) { if (n.matches(sel)) return n; n = n.parent; } return null; };
  e.getAttribute = n => (e.attrs[n] === undefined ? null : e.attrs[n]);
  e.children.forEach(k => { k.parent = e; });
  return e;
}

test('the 🔑 keyword panel NEVER folds — on a plain answer or on a CER answer', () => {
  ok(M.emStays(fake('kw-panel'), M.EM_PRIMARY.plainanswer), 'plain answer');
  ok(M.emStays(fake('kw-panel'), M.EM_PRIMARY.answer), 'CER answer');
  ok(M.emStays(fake('kw-panel'), M.EM_PRIMARY.image), 'and on any other type it ever lands on');
});

test('the block\'s own content stays, and the furniture folds', () => {
  ok(M.emStays(fake('content-editable'), M.EM_PRIMARY.text), 'the text box stays');
  ok(M.emStays(fake('image-preview'), M.EM_PRIMARY.image), 'the picture stays');
  ok(M.emStays(fake('cer-section'), M.EM_PRIMARY.answer), 'each CER box stays');
  ok(!M.emStays(fake('text-toolbar'), M.EM_PRIMARY.text), 'the toolbar folds');
  ok(!M.emStays(fake('image-paste-zone'), M.EM_PRIMARY.image), 'the paste pad folds');
  ok(!M.emStays(fake('annot-ans'), M.EM_PRIMARY.image), 'the answer-screenshot panel folds');
});

test('a wrapper holding the content stays with it', () => {
  ok(M.emStays(fake('wrap', [fake('content-editable')]), M.EM_PRIMARY.text), 'contains the content');
  ok(M.emStays(fake('wrap', [fake('inner', [fake('kw-panel')])]), M.EM_PRIMARY.text), 'contains the panel');
});

test('the header is never folded — it carries the part and marks pickers', () => {
  ok(M.emStays(fake('block-header'), M.EM_PRIMARY.text), 'header');
});

// ── what reaches the rail ───────────────────────────────────────────────────
test('an AI button is lifted onto the rail', () => {
  ok(M.emHoistable(fake('improve-btn', [], { 'data-improve-block': 'b1' })), 'improve');
  ok(M.emHoistable(fake('btn btn-outline', [], { 'data-crop-open': 'b1' })), 'crop');
});

test('a self-contained panel keeps its own buttons', () => {
  const panel = fake('kw-panel', [fake('improve-btn kw-btn')]);
  ok(!M.emHoistable(panel.children[0]), 'Clear all / Done stay in the 🔑 panel');
  const annot = fake('annot-ans', [fake('annot-ans-tools', [fake('btn btn-ghost')])]);
  ok(!M.emHoistable(annot.children[0].children[0]), '× Remove stays with the answer screenshot');
});

test('the rich-text toolbar buttons stay where they are', () => {
  ok(!M.emHoistable(fake('toolbar-btn')), 'B / I / U');
  ok(!M.emHoistable(fake('block-insert-btn')), 'the insert menu');
  ok(!M.emHoistable(fake('em-ico')), 'and nothing is lifted twice');
});

test('a mic with no target of its own is left inside its wrap', () => {
  ok(M.emHoistable(fake('mic-btn', [], { 'data-mic-block': 'b1' })), 'a mic that names its box');
  ok(!M.emHoistable(fake('mic-btn', [], { 'data-mic': '' })), 'a mic that finds it by walking up');
});

// ── run ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
cases.filter(c => !only || c.name.indexOf(only) >= 0).forEach(c => {
  try { c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
