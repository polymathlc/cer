// Regression tests for 🖼 AUTO DIAGRAM and the 🎨 PHOTO EDITOR.
// Run with:
//     node tools/auto-diagram-tests.mjs            all cases
//     node tools/auto-diagram-tests.mjs <name>     one case
//
// It loads the REAL helpers out of app.js and index.html. Both features hang
// off ONE editor and ONE picture slot, and every way they go wrong is quiet:
//
//  • THE DIAGRAM REPLACES A PICTURE SOMEBODY UPLOADED. The answer-key slot is
//    the same field 🖼 Upload answer-key image writes to, so drawing over one
//    without asking destroys a scan that may be the only copy. 🖼 asks; 🔄 is a
//    redraw OF what is there and does not need to.
//  • THE PROMPT STOPS ASKING FOR PAPER. The key is printed and photocopied. A
//    diagram that arrives as a shaded 3D render, or with a paragraph of text
//    in it, is useless at 60mm in grey — and it looks perfectly good on screen.
//  • THE REFERENCE PICTURE IS THE WRONG ONE. generateImageDataUrlGemini takes
//    exactly one: the current diagram when regenerating, the question's own
//    figure when drawing fresh. Swap them and 🔄 silently starts from scratch
//    every time, which reads as the instructions being ignored.
//  • THE EDITOR WRITES BACK TO THE WRONG PLACE. `_annotOpenSrc` takes a target
//    and `applyAnnotTool` branches on it; a target with no branch falls through
//    to the image-block path and writes an answer-key diagram into a question's
//    picture instead.
//  • THE PHOTO EDITOR IS NOT ADMIN-ONLY. It is an admin tool on a page a
//    student must not reach, and a hidden nav item is not a lock.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const HTML = new URL('../index.html', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b);
};

const M = new Function(`
  function stripHtml(c){ return c ? String(c).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim() : ''; }
  function _docClip(s, n){ s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function _cqRepr(q){ return 'REPR:' + (q && q.title || ''); }
` +
  // The end marker keeps its `async`: cutting at the bare `function` leaves a
  // dangling `async ` on the end of the region, which silently makes the NEXT
  // helper concatenated after it an async function.
  cut('const AKD_NOTE_MAX', '\nasync function _akdQuestionFigure', 'auto diagram core') + '\n' +
  cut('function _peCleanName(n) {', '\nfunction _peReadFile', 'photo editor name') + `
return { NOTE_MAX: AKD_NOTE_MAX, RULES: AKD_PRINT_RULES, clip: _akdClipNote,
         prompt: _akdPrompt, answerText: _akdAnswerText, cleanName: _peCleanName,
         dlName: peDownloadName, setName: (n) => { _peName = _peCleanName(n); } };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};

const Q = {
  id: 'q1', title: 'Melting ice', topic: 'Heat', category: 'CER',
  blocks: [
    { type: 'text', content: 'Why did the ice melt?' },
    { type: 'image', url: 'https://example.com/beaker.png' },
    { type: 'plainanswer', content: 'The ice <b>gained heat</b> from the surroundings.' },
    { type: 'explanation', content: 'Heat flows from hotter to colder.' }
  ]
};

// ── what the diagram is asked to explain ────────────────────────────────────

test('the answer text gathers every kind of answer on the question', () => {
  const t = M.answerText(Q, '');
  ok(t.includes('The ice gained heat from the surroundings.'), 'the plain answer, stripped of its markup');
  ok(t.includes('Explanation: Heat flows'), 'the explanation, labelled');
});

test('an MCQ contributes its correct option, by number', () => {
  const q = { blocks: [{ type: 'mcq', correctId: 'b', options: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] }] };
  ok(M.answerText(q, '').includes('The correct option is (2) two'), 'named and numbered');
});

test('a CER answer contributes only the fields that were filled in', () => {
  const q = { blocks: [{ type: 'answer', claim: 'It melted', evidence: '', reasoning: 'It gained heat' }] };
  const t = M.answerText(q, '');
  ok(t.includes('Claim: It melted'), 'claim');
  ok(t.includes('Reasoning: It gained heat'), 'reasoning');
  ok(!t.includes('Evidence:'), 'an empty field must not print a bare label');
});

test('the teacher\'s answer-key note leads', () => {
  const t = M.answerText(Q, 'Tick the beaker on the right.');
  ok(t.indexOf('Tick the beaker') === 0, 'the note comes first');
});

test('a question with no answer at all still yields something usable', () => {
  eq(M.answerText({ blocks: [{ type: 'text', content: 'hello' }] }, ''), '', 'empty rather than throwing');
  eq(M.answerText(null, ''), '', 'null question');
});

// ── the prompt ──────────────────────────────────────────────────────────────

test('it always asks for a printable school diagram', () => {
  const p = M.prompt(Q, 'the ice gained heat', '', 'none');
  ok(p.includes(M.RULES), 'the shared print rules are missing');
  [/black line-work/i, /plain white background/i, /No photograph/i, /photocopied/i, /1-3 words/i, /Landscape/i]
    .forEach(re => ok(re.test(p), 'the style rules lost: ' + re));
  ok(/no title, no watermark/i.test(p), 'a title in the picture is the thing that always comes out wrong');
});

test('the question and the answer both reach the model', () => {
  const p = M.prompt(Q, 'THE ANSWER TEXT', '', 'none');
  ok(p.includes('REPR:Melting ice'), 'the question representation');
  ok(p.includes('THE ANSWER TEXT'), 'the answer');
  ok(p.indexOf('THE QUESTION') < p.indexOf('THE ANSWER IT MUST EXPLAIN'), 'question first, then the answer it explains');
});

test('a question with no written answer says so rather than sending nothing', () => {
  ok(/no written answer was recorded/i.test(M.prompt(Q, '', '', 'none')), 'the model needs telling, or it invents one');
});

test('the reference picture is described for what it IS', () => {
  const cur = M.prompt(Q, 'a', '', 'current');
  ok(/CURRENT diagram/i.test(cur), 'regenerating must say the picture is the current diagram');
  ok(/keeping everything else about it the same/i.test(cur), '…and that it is being edited, not replaced');

  const fig = M.prompt(Q, 'a', '', 'question');
  ok(/FIGURE PRINTED IN THE QUESTION/i.test(fig), 'a fresh draw must say the picture is the question\'s own figure');
  // Without this the model hands the question's figure straight back.
  ok(/NOT to be handed back unchanged/i.test(fig), 'the do-not-copy rule has gone');
  ok(/draw a NEW diagram/i.test(fig), 'and the instruction to draw a new one');

  const none = M.prompt(Q, 'a', '', 'none');
  ok(!/attached to this message/i.test(none), 'with no reference, nothing may claim one is attached');
});

test('the teacher\'s instructions outrank the rest of the prompt', () => {
  const p = M.prompt(Q, 'a', 'side view only, arrows in red', 'none');
  ok(p.includes('side view only, arrows in red'), 'the note is in the prompt');
  ok(/outranks anything below it/i.test(p), 'and is marked as outranking what follows');
  ok(!/WHAT THE TEACHER ASKED FOR/.test(M.prompt(Q, 'a', '', 'none')), 'an empty note must not leave a dangling heading');
});

test('the instructions box is clipped and folded, never trusted raw', () => {
  eq(M.clip('  make   the arrows\nred  '), 'make the arrows red', 'folded');
  eq(M.clip('x'.repeat(M.NOTE_MAX + 50)).length, M.NOTE_MAX, 'clipped to AKD_NOTE_MAX');
  eq(M.clip(null), '', 'null');
  eq(M.clip(undefined), '', 'undefined');
});

// ── the download name ───────────────────────────────────────────────────────

test('a downloaded file keeps the name the picture arrived with', () => {
  M.setName('holiday photo.JPG');
  eq(M.dlName(), 'holiday photo.png', 'extension swapped, name kept');
  M.setName('diagram.png');
  eq(M.dlName(), 'diagram.png', 'already a png');
  M.setName('');
  eq(M.dlName(), 'edited-image.png', 'a picture that arrived with no name still gets one');
});

test('a hostile file name cannot become a path', () => {
  M.setName('../../etc/passwd.png');
  const n = M.dlName();
  ok(!n.includes('/') && !n.includes('\\'), 'no separators survive: ' + n);
  M.setName('a"b<c>d|e.png');
  ok(/^[\w. -]+\.png$/.test(M.dlName()), 'only safe characters: ' + M.dlName());
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('drawing over an existing picture asks first, regenerating does not', () => {
  ['akdRunQuestion', 'akdRunBlock'].forEach(fn => {
    const i = src.indexOf('function ' + fn + '(');
    ok(i > 0, fn + ' is missing');
    const body = src.slice(i, src.indexOf('\n}\n', i));
    ok(/if \(!regen && cur\)[\s\S]*showConfirm\(/.test(body), fn + ': a fresh draw over an existing picture must confirm');
    ok(/if \(regen && !cur\)/.test(body), fn + ': regenerating with nothing there must say so, not draw');
  });
});

test('both surfaces go through the ONE generator', () => {
  // Two generators would be two prompts to improve and two to keep in step.
  eq((src.match(/_akdMake\(/g) || []).length, 3, '_akdMake: its definition and one call from each surface');
  ok(/async function _akdMake\(q, answerText, note, currentUrl, regen\)/.test(src), 'the generator signature moved');
  // …and it draws through the shared core rather than carrying its own copy of
  // the reference / clean-up / upload steps. A second copy is a second place
  // for the paper cleaner to be forgotten.
  const i = src.indexOf('async function _akdMake');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/_diagramDraw\(/.test(body), '_akdMake must go through _diagramDraw');
});

test('every teaching diagram is drawn by the ONE core', () => {
  // Three surfaces draw a teaching diagram — the answer-key panel, the 🔑
  // block and the 💡 explanation box — and every one of them goes through
  // _diagramDraw. A surface with its own copy is a surface where the reference
  // picture, the paper clean-up or the upload quietly differs.
  const calls = src.split('\n').filter(l => /_diagramDraw\(/.test(l) && !/^async function _diagramDraw/.test(l.trim()));
  ok(calls.length >= 2, 'both makers must call the core: ' + calls.length + ' found');
  ok(/async function _diagramDraw\(q, buildPrompt, currentUrl, regen\)/.test(src), 'the core signature moved');
});

test('regenerating reads the current picture, drawing fresh reads the question\'s', () => {
  const i = src.indexOf('async function _diagramDraw');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/if \(regen && currentUrl\)/.test(body), 'the current diagram is only used when regenerating');
  ok(/kind = 'current'/.test(body) && /kind = ref \? 'question' : 'none'/.test(body), 'both reference kinds must be set');
  // A failed read of either must not stop the draw.
  ok((body.match(/catch/g) || []).length >= 1, 'a picture that will not load must fall back, not throw');
});

test('the generated picture goes through the shared paper cleaner', () => {
  const i = src.indexOf('async function _diagramDraw');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/_paperCleanDataUrl\(/.test(body), 'an image model leaves the weave that prints as a grey wash');
  ok(/res && res\.url/.test(body), '_paperCleanDataUrl returns { url, report } — not a bare url');
});

test('every editor destination has a branch that writes it back', () => {
  const i = src.indexOf('async function applyAnnotTool');
  const body = src.slice(i, src.indexOf('\nfunction closeAnnotTool', i));
  ['standalone', 'akQuestion', 'akBlockId', 'artSlot'].forEach(t =>
    ok(new RegExp('if \\(' + t + '\\)').test(body), 'no Apply branch for the ' + t + ' target'));
  // …and the editor has to carry them in the first place.
  const j = src.indexOf('function _annotOpenSrc');
  const open = src.slice(j, src.indexOf('\n}\n', j));
  ['akQuestion', 'akBlockId', 'standalone'].forEach(t =>
    ok(open.includes(t), '_annotOpenSrc drops the ' + t + ' target on the floor'));
});

test('the Photo Editor writes nothing anywhere', () => {
  const i = src.indexOf('async function applyAnnotTool');
  const body = src.slice(i, src.indexOf('\nfunction closeAnnotTool', i));
  const stand = body.slice(body.indexOf('if (standalone)'), body.indexOf('closeAnnotTool();', body.indexOf('if (standalone)')) + 40);
  ok(/annotDownloadPng\(\)/.test(stand), 'the standalone branch should download');
  ok(!/upload|setDoc|saveBlock/i.test(stand), 'nothing about the standalone branch may save: ' + stand);
  // It must be FIRST, before the upload the other targets do.
  ok(body.indexOf('if (standalone)') < body.indexOf('uploadImageDataUrl'), 'the standalone branch must return before anything is uploaded');
});

test('a picture scaled down on the way in says so', () => {
  const i = src.indexOf('function _annotOpenSrc');
  const body = src.slice(i, src.indexOf('\n// Does the eraser CUT', i));
  ok(/ANNOT_MAX_PX_STANDALONE : ANNOT_MAX_PX/.test(body), 'the Photo Editor should get the bigger ceiling');
  ok(/if \(scale < 1\)/.test(body), 'a download quietly smaller than what went in is the one thing this must not do');
  ok(/const ANNOT_MAX_PX = 1600;/.test(src) && /const ANNOT_MAX_PX_STANDALONE = 2400;/.test(src), 'the ceilings moved');
});

test('erasing cuts in the Photo Editor and paints white on a scan', () => {
  ok(/eraseTo: \(target\.artSlot \|\| target\.standalone\) \? 'clear' : 'white'/.test(src),
     'a scanned question is paper; a picture on its way to a PNG is not');
});

test('the Photo Editor is admin-only in the nav AND in navigateTo', () => {
  ok(/data-page="photoedit"/.test(html), 'no nav item');
  const nav = html.slice(html.indexOf('data-page="photoedit"') - 200, html.indexOf('data-page="photoedit"'));
  ok(/admin-only/.test(nav), 'the nav item is not admin-only');
  ok(/if \(page === 'photoedit' && !_isAdmin\(\)\)/.test(src), 'hiding a nav item is not a lock');
  ok(!/'photoedit'/.test(src.slice(src.indexOf('const EMPLOYEE_PAGES'), src.indexOf('\n', src.indexOf('const EMPLOYEE_PAGES')))),
     'photoedit must not be on EMPLOYEE_PAGES');
  ok(/<div class="page" id="page-photoedit">/.test(html), 'no page');
});

test('every way a picture gets into the Photo Editor ends at the one door', () => {
  ['pePickFiles', 'peDrop', '_pePaste'].forEach(fn => {
    const i = src.indexOf('function ' + fn + '(');
    ok(i > 0, fn + ' is missing');
    const body = src.slice(i, src.indexOf('\n}\n', i));
    ok(/_peReadFile\(|_peOpen\(/.test(body), fn + ' does not go through the shared opener');
  });
  const pick = src.slice(src.indexOf('function pePickFiles('), src.indexOf('\n}\n', src.indexOf('function pePickFiles(')));
  // An <input type=file> still holding last time's file fires no change event
  // for the same picture picked twice.
  ok(pick.indexOf("input.value = ''") < pick.indexOf('_peReadFile(file)'), 'the picker must be cleared BEFORE the read');
});

test('the page\'s paste never fights the editor\'s own', () => {
  const i = src.indexOf('function _pePaste(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/page-photoedit/.test(body), 'it must only act on its own page');
  ok(/if \(_annot\) return;/.test(body), 'with the editor open, Ctrl+V belongs to the editor (it pastes ONTO the picture)');
});

test('the buttons that need a picture are hidden until there is one', () => {
  ok(/function _akdSyncQuestionBar/.test(src), '_akdSyncQuestionBar is missing');
  const i = src.indexOf('function _renderAnswerKeyPreview');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/_akdSyncQuestionBar\(\)/.test(body), 'the ONE place the picture\'s presence is reflected should drive the buttons');
  ['akdQuestionRegen', 'akdQuestionTouch', 'akdQuestionNote'].forEach(id =>
    ok(html.includes('id="' + id + '"'), 'no ' + id + ' in the markup'));
});

test('the steering note survives being saved', () => {
  ok(/answerKeyDiagramNote: akdQuestionNote\(\)/.test(src), 'the question-level note is not collected on save');
  const owned = src.slice(src.indexOf('const EDITOR_OWNED_QUESTION_FIELDS'), src.indexOf('\n]', src.indexOf('const EDITOR_OWNED_QUESTION_FIELDS')));
  ok(/answerKeyDiagramNote/.test(owned), 'without this, carryOverQuestionMeta restores a note the author just cleared');
  ok(/_setAnswerKeyFields\(q\.answerKeyNote \|\| '', q\.answerKeyImage \|\| '', q\.answerKeyDiagramNote \|\| ''\)/.test(src),
     'and it has to be read back when a question is opened');
  ok(/function setAkdBlockNote/.test(src), 'the 🔑 block keeps its own note on the block');
});

// ── what the diagram IS, and what it is not ─────────────────────────────────

test('the diagram is answer-key only — it never reaches the question', () => {
  // 🖼 Auto diagram draws an OPTIONAL teaching picture. It must never become
  // part of the question, and it must never turn a question into one the
  // student has to draw on — that is `q.annotation`, a separate flag with its
  // own pads. The block-level 🔑 answer key is hidden from students outright.
  const i = src.indexOf('function renderImportedBlockStudent');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  const ak = body.slice(body.indexOf("case 'answerKey':"));
  ok(/^\s*case 'answerKey':\s*\n\s*return '';/.test(ak), 'a 🔑 answer-key block must render nothing in the question');
  // Nothing in the generator may touch the annotation flag.
  const gen = src.slice(src.indexOf('const AKD_NOTE_MAX'), src.indexOf('\n// =====', src.indexOf('const AKD_NOTE_MAX')));
  ok(!/\.annotation\s*=/.test(gen), 'drawing a diagram must not set q.annotation');
  ok(!/answerImg/.test(gen), 'and must not write an annotation pad\'s model answer');
});

test('the student sees it only AFTER marking', () => {
  // showExplanation is the ONE place the post-marking cards are built, and it
  // is only ever called once a question has been marked. A diagram shown any
  // earlier is the answer, printed above the question.
  const i = src.indexOf('function showExplanation');
  const body = src.slice(i, src.indexOf('\nfunction ', i + 40));
  ok(/_qAnswerDiagrams\(q\)/.test(body), 'the answer diagram card is missing');
  ok(/🖼 Answer diagram/.test(body), 'and its heading');
  // Nowhere else may render it.
  eq((src.match(/_qAnswerDiagrams\(/g) || []).length, 2, '_qAnswerDiagrams: its definition and the ONE card that shows it');
});

test('both answer-key pictures reach that card, deduped', () => {
  const i = src.indexOf('function _qAnswerDiagrams');
  // +3 so the function's own closing brace comes with it.
  const M2 = new Function(src.slice(i, src.indexOf('\n}\n', i) + 3) + '\nreturn _qAnswerDiagrams;')();
  eq(JSON.stringify(M2({ answerKeyImage: ' a.png ', blocks: [{ type: 'answerKey', url: 'b.png' }] })), '["a.png","b.png"]', 'both, trimmed');
  eq(JSON.stringify(M2({ answerKeyImage: 'a.png', blocks: [{ type: 'answerKey', url: 'a.png' }] })), '["a.png"]', 'the same picture filed twice is one card entry');
  eq(JSON.stringify(M2({ blocks: [{ type: 'image', url: 'q.png' }] })), '[]', "a QUESTION's own picture is not an answer diagram");
  eq(JSON.stringify(M2(null)), '[]', 'null');
});

// ── ⏳ the still-loading bar ────────────────────────────────────────────────

test('every question body carries the bar, and starts it', () => {
  const i = src.indexOf('function buildOpenBody');
  const body = src.slice(i, src.indexOf('\n// =====', i));
  ok(/imgWaitBarHtml\(containerSel\)/.test(body), 'the bar is not emitted with the body');
  ok(/_scheduleImgWait\(containerSel\)/.test(body), 'nothing starts the watcher');
  // buildOpenBody is the ONE renderer every practice surface goes through, so
  // one hook covers all ten of them.
  ok((src.match(/buildOpenBody\(q, /g) || []).length >= 8, 'buildOpenBody should still be the shared renderer');
});

test('a reset stops the old watcher', () => {
  const i = src.indexOf('function resetOpenAnswersIn');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/imgWaitStop\(containerSel\)/.test(body), 'a re-render would otherwise leave a second watcher counting');
});

test('the bar shows real progress, and only real progress', () => {
  const i = src.indexOf('function _imgWaitPaint');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/done \/ total/.test(body), 'the fill must be loaded/total, not a timer');
  ok(!/Date\.now\(\) - st\.started[\s\S]{0,80}width/.test(body), 'elapsed time must never drive the width');
  ok(/waited < IMG_WAIT_GRACE/.test(body), 'a cached picture must not flash a loading bar');
  ok(/done >= total/.test(body), 'the bar has to go when the last picture lands');
});

test('a picture that FAILED counts as finished', () => {
  // handleImgError replaces the element with a "could not be loaded"
  // placeholder. A bar still waiting for it is the frozen bar this exists to
  // prevent.
  const i = src.indexOf('function _imgWaitDone');
  ok(/imgwaitFailed/.test(src.slice(i, src.indexOf('\n}\n', i))), 'a failed picture must count as done');
  const j = src.indexOf('function imgWaitStart');
  ok(/'error'[\s\S]{0,90}imgwaitFailed = '1'/.test(src.slice(j, src.indexOf('\n}\n', j))), 'nothing sets the flag');
});

test('data: pictures are never waited on', () => {
  const i = src.indexOf('function _imgWaitImages');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/\^data:/.test(body), 'an inline data: picture is already here — waiting on it would never end');
  ok(/!!s/.test(body), 'an <img> with no src is a placeholder, not a download');
});

test('a slow wait says so and offers a retry', () => {
  const i = src.indexOf('function _imgWaitPaint');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/IMG_WAIT_SLOW/.test(body), 'nothing distinguishes slow from ordinary');
  ok(/connection looks slow/.test(body), 'the wording never changes');
  const r = src.indexOf('function imgWaitRetry');
  const rb = src.slice(r, src.indexOf('\n}\n', r));
  ok(/!_imgWaitDone/.test(rb), 'a retry must re-request only what is still out');
  ok(/_iw=/.test(rb), 'and cache-bust it, or the browser serves the same stalled response');
  ok(/st\.started = Date\.now\(\)/.test(rb), 'a retry restarts the clock');
});

test('the bar is announced to a screen reader and respects reduced motion', () => {
  ok(/role="status" aria-live="polite"/.test(src), 'a silent progress bar tells a screen-reader user nothing');
  const i = html.indexOf('.imgwait{');
  const css = html.slice(i, html.indexOf('/* ──', i + 10));
  ok(/prefers-reduced-motion/.test(html.slice(i, i + 3000)), 'the spinner and the stripe both move');
});

// ── run ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); console.log('  ok   ' + c.name); pass++; }
  catch (e) { console.log('  FAIL ' + c.name + '\n       ' + e.message); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
