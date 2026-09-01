// Regression tests for 📝 EVERY PART GETS ITS OWN EXPLANATION and
// 🖼 DRAW THIS EXPLANATION.
// Run with:
//     node tools/part-explanation-tests.mjs            all cases
//     node tools/part-explanation-tests.mjs <name>     one case
//
// It loads the REAL part-explanation section, `_xdPrompt` / `_xdExplText` /
// `_explKeyContentHtml` / `_qExplanationDiagrams` out of app.js, and checks the
// wiring of the three build paths by reading the source.
//
// EVERY FAILURE HERE IS SILENT. The question builds, reads, saves and prints —
// and the answer key has a hole in it, or a picture that says the wrong thing:
//
//  • THE HOLE. A question with (a), (b), (c) is three questions on the key:
//    each printed under its own heading, each marked on its own. A part with no
//    explanation is a part the key has nothing to say about, and the only
//    person who ever finds out is whoever is standing in front of a class
//    holding it.
//  • NOTHING ALREADY WRITTEN MAY BE REPLACED. The filler writes into the gaps
//    and nowhere else. Overwrite an author's own note — or the model's note for
//    another part — and the feature that fills a hole is digging one.
//  • THE DEFAULT DEPTH, ALWAYS. A build path that reaches 📖 or 📚 turns a
//    forty-question paper into forty lectures, which is the exact fault the
//    three depths exist to undo.
//  • ONE CALL PER QUESTION. One per part turns a paper into hundreds.
//  • THE PICTURE DRAWS THE EXPLANATION, NOT THE TOPIC. `_xdPrompt` is bound to
//    the sentence: everything the explanation names appears, nothing it does
//    not name is invented. Lose that and the button draws a generic picture
//    "about heat" beside a note about something else, which looks like a
//    working feature and teaches the wrong thing.
//  • AN EMPTY BOX IS REFUSED. The explanation IS the brief. Drawn from nothing,
//    "exactly what the explanation says" is a promise that cannot be kept.
//  • BOTH PRINT PATHS. They had already drifted over the MCQ answer once; a key
//    that carries the picture from one print button and not the other is that
//    same fault wearing a new hat.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// What the real code leans on. Each is either cut in (so the harness cannot
// drift from the app) or is a one-line contract the app's own version keeps.
const SHIM = [
  cut('function stripHtml(content) {', '\n}\n', 'stripHtml') + '\n}\n',
  "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }",
  "function transformImageUrl(u) { return String(u || ''); }",
  "function _docClip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }",
  "function _nlToBrHtml(s) { return String(s || '').replace(/\\n+/g, '<br>'); }",
  "let _bid = 0; function generateBlockId() { return 'b' + (++_bid); }",
  // Grounding, level wording and the JSON reader are somebody else's tests.
  "let _grounded = []; function aiGrounding(kind, topic) { _grounded.push(kind); return 'NOTES[' + kind + ']'; }",
  "function getTopicLevel() { return 'P5'; }",
  "function schoolFor() { return 'primary-school (PSLE)'; }",
  "function audienceFor() { return 'a P6'; }",
  "function _parseAIJson(raw) { return JSON.parse(raw); }",
  "function sanitizeAnswerKeyHtml(c) { return String(c || '').replace(/<script[\\s\\S]*?<\\/script>/gi, ''); }",
  // The AI doors, recorded so a test can count the calls and answer them.
  "let _calls = []; let _reply = null;",
  "async function askGemini(prompt, o) { _calls.push({ kind: 'text', prompt, o }); if (_reply instanceof Error) throw _reply; return _reply; }",
  "async function askGeminiVision(prompt, media, o) { _calls.push({ kind: 'vision', prompt, media, o }); if (_reply instanceof Error) throw _reply; return _reply; }",
  "var window = { __aiReady: () => true };",
  // The printed-diagram style, shared with the answer-key diagram: cut in, so
  // the harness cannot pass while the two houses have drifted apart.
  cut('const AKD_PRINT_RULES =', ";\n", 'print rules') + ';',
  "function _cqRepr(q) { return 'QUESTION: ' + ((q && q.blocks) || []).map(b => (b && b.content) || '').join(' '); }",
  cut('const EXPL_ASKS_RE', '\nasync function aiGenerateBlockAnswer', 'explanation depth'),
  // The picture-sizing helpers, cut in for the same reason as the print rules:
  // the explanation diagram's size is the picture block's OWN `block.scale`,
  // read through the very same imgHasScale / imgScale, so a harness that
  // stubbed them could pass while the two had drifted apart.
  cut('const IMG_SCALE_MIN = 20;', '// ---- How TALL a picture may print', 'image scale core'),
  cut('function _imgRenderedPct(containerId, fallback) {', '// Back to Auto:', 'the shared + / - stepper'),
  "let blocks = [];",
  "var document = { getElementById: () => null, querySelector: () => null };",
].join('\n');

const M = new Function([
  SHIM,
  cut('const QPART_LETTERS', 'function qPartsUsed', 'part core'),
  cut('function qPartsUsed', 'function qPartOf(map, block)', 'part spans + the AI part passes + the explanation filler'),
  cut('function qPartOf(map, block)', '\n// The next unused letter', 'partOf + opens + hasParts'),
  cut('const XD_FIDELITY =', '\n// The explanation as it reaches an ANSWER KEY', 'the explanation diagram'),
  cut('function _explKeyContentHtml(block) {', '\n// =====', 'key content + explanation diagrams'),
  `return { missing: qPartsWithoutExplanation, split: qSplitMultiPartExplanations,
            ensure: qEnsurePartExplanations, write: aiWritePartExplanations,
            prompt: _partExplPrompt, section: _partExplSection, MAX: PART_EXPL_MAX,
            map: qPartMap, partOf: qPartOf, hasParts: qHasParts, place: qPlacePartExplanation,
            xdPrompt: _xdPrompt, xdText: _xdExplText, keyHtml: _explKeyContentHtml,
            explDiagrams: _qExplanationDiagrams, FIDELITY: XD_FIDELITY,
            xdImgStyle, xdSizeAuto, xdSizeStep, XD_PRINT_MAX_PT,
            imgScaleStep, imgHasScale, imgScale,
            IMG_SCALE_MIN, IMG_SCALE_MAX, IMG_SCALE_STEP,
            setBlocks: v => { blocks = v; }, getBlocks: () => blocks,
            reply: v => { _reply = v; }, calls: () => _calls, resetCalls: () => { _calls = []; },
            grounded: () => _grounded };`,
].join('\n'))();

// The printed-diagram style the drawing prompt borrows, for the assertion that
// the two diagrams still print in the same house.
const AKD_PRINT_RULES = cut('const AKD_PRINT_RULES =', ';\n', 'print rules');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what || 'expected true'); };
const eq = (got, want, what) => {
  if (got !== want) throw new Error((what || 'value') + ':\n           got  ' + JSON.stringify(got) + '\n           want ' + JSON.stringify(want));
};
const deep = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

const txt = (part, content) => ({ id: 't_' + part + '_' + Math.random().toString(36).slice(2, 6), type: 'text', part, content: content || 'Ask something.' });
const ans = (content) => ({ id: 'a_' + Math.random().toString(36).slice(2, 6), type: 'plainanswer', content: content || 'Because it evaporated.' });
const expl = (part, content) => ({ id: 'e_' + Math.random().toString(36).slice(2, 6), type: 'explanation', part, content: content == null ? 'A note.' : content });
// (a) (b) (c), each with an answer and none with an explanation.
const threeParts = () => [
  txt('', 'A beaker of water was left on a windowsill.'),
  txt('a', 'Name the process.'), ans('Evaporation.'),
  txt('b', 'Explain why the level fell.'), ans('The water evaporated.'),
  txt('c', 'Suggest one way to slow it down.'), ans('Cover the beaker.'),
];

console.log('\nWHICH PARTS ARE MISSING ONE');

test('a question with no parts asks for nothing', () => {
  deep(M.missing([txt('', 'Just a question.'), ans()]), []);
});

test('every part of a bare three-part question is missing one', () => {
  deep(M.missing(threeParts()), ['a', 'b', 'c']);
});

test('a part that HAS a note is not missing one', () => {
  const bs = threeParts();
  bs.splice(3, 0, expl('a', 'Water turns to vapour below its boiling point.'));
  deep(M.missing(bs), ['b', 'c']);
});

test('an EMPTY explanation box is not a note', () => {
  const bs = threeParts();
  bs.splice(3, 0, expl('a', '   '));
  deep(M.missing(bs), ['a', 'b', 'c'], 'a blank box on the key says nothing at all');
});

test('the WHOLE-QUESTION note counts for no part', () => {
  // This is the shape `qScopeExplanations` leaves behind when the model wrote
  // one explanation for a question that turned out to have parts. It is a real
  // note and it is not what a pupil reads under part (b).
  const bs = threeParts();
  bs.push({ id: 'ex', type: 'explanation', part: '-', content: 'Evaporation happens at every temperature.' });
  deep(M.missing(bs), ['a', 'b', 'c']);
});

test('a note under a ROMAN sub-part covers its letter', () => {
  // qPartFind is letter-scoped: (b) covers (b)(i) and (b)(ii), which is what
  // lets the marking scheme's note for part (b) land at all.
  const bs = [txt('', 'Stem.'), txt('b', 'Ask (b).'),
    { id: 'sub', type: 'text', part: '', subPart: 'i', content: 'and (i)' },
    { id: 'x', type: 'explanation', part: '', subPart: '', content: 'A note under (b)(i).' }];
  deep(M.missing(bs), []);
});

console.log('\nTHE FREE HALF: "(a) … (b) …" IN ONE BOX IS THE NOTES ALREADY WRITTEN');

test('one box holding both markers becomes two notes, one per part', () => {
  const bs = threeParts();
  bs.push(expl('', '(a) Evaporation is the change to vapour.<br>(b) The water left as vapour.'));
  ok(M.split(bs), 'it should report that it split something');
  deep(M.missing(bs), ['c'], '(a) and (b) now have their own');
  const m = M.map(bs);
  const notes = bs.filter(b => b.type === 'explanation');
  eq(notes.length, 2, 'the one box became two');
  // …filed under their own letters, and with the marker no longer in the text:
  // the label is drawn from the block.
  deep(notes.map(b => M.partOf(m, b)), ['a', 'b']);
  notes.forEach(n => ok(!/^\(?[ab]\)/.test(n.content), 'the marker must not also be in the text: ' + n.content));
});

test('it is IDEMPOTENT — a second pass splits nothing', () => {
  const bs = threeParts();
  bs.push(expl('', '(a) One.<br>(b) Two.'));
  M.split(bs);
  const before = JSON.stringify(bs);
  eq(M.split(bs), false, 'nothing left to split');
  eq(JSON.stringify(bs), before, 'and nothing was moved');
});

test('a lead written before the first marker is KEPT, filed under no part', () => {
  const bs = threeParts();
  bs.push(expl('', 'Both parts are about evaporation.<br>(a) One.<br>(b) Two.'));
  M.split(bs);
  const lead = bs.filter(b => b.type === 'explanation' && b.part === '-');
  eq(lead.length, 1, 'the lead belongs to no part in particular, and is not dropped');
});

test('an ordinary one-part note is never touched', () => {
  const bs = threeParts();
  bs.push(expl('a', 'Just the one note about part (a).'));
  eq(M.split(bs), false);
});

test('qEnsurePartExplanations does the free half and reports the rest', () => {
  const bs = threeParts();
  bs.push(expl('', '(a) One.<br>(b) Two.'));
  deep(M.ensure(bs), ['c'], 'split what it could, named what is left');
});

console.log('\nTHE PROMPT');

const promptFor = (bs, q) => M.prompt(q || { title: 'Water on a windowsill', topic: 'Water' }, M.missing(bs), bs, M.map(bs), false);

test('it asks for the missing parts and NAMES the others as context only', () => {
  const bs = threeParts();
  bs.splice(3, 0, expl('a', 'Already written.'));
  const p = promptFor(bs);
  ok(/\(b\), \(c\)/.test(p), 'it must say which parts it wants');
  const marks = (p.match(/<<< WRITE AN EXPLANATION FOR THIS ONE/g) || []).length;
  eq(marks, 2, 'exactly the missing parts are marked');
  ok(/PART \(a\)\s+\[already has its explanation/.test(p),
     'part (a) goes along so the new notes do not repeat it — but it is never rewritten');
});

test('the SHARED STEM goes in — a part read without it explains nothing', () => {
  ok(/A beaker of water was left on a windowsill/.test(promptFor(threeParts())), 'the stem is missing');
});

test('each part carries its own wording AND its own model answer', () => {
  const p = promptFor(threeParts());
  ok(/Suggest one way to slow it down/.test(p), 'part (c) wording');
  ok(/\[model answer\] Cover the beaker\./.test(p), "part (c)'s own answer");
});

test('it is grounded in the teaching notes, as TEACHING', () => {
  const before = M.grounded().length;
  const p = promptFor(threeParts());
  ok(M.grounded().length > before, 'aiGrounding was never called');
  eq(M.grounded()[M.grounded().length - 1], 'teach',
     "an explanation is science said to a pupil — 'teach', the same kind the 🤖 button uses");
  ok(p.includes('NOTES[teach]'), 'the block was built and then dropped on the floor');
});

test('it is the DEFAULT depth — never the four-point lecture', () => {
  const p = promptFor(threeParts());
  ok(/2-4 sentences/.test(p), 'a build path writes forty of these at once');
  ok(!/  1\. the principle or rule/.test(p),
     '📖 and 📚 are buttons an author presses; a paper of forty lectures is the fault the depths undo');
  // …and the no-repeat rule IS there, because every part here has an answer.
  ok(/THE MODEL ANSWER IS ALREADY WRITTEN/.test(p), 'the shared rule must reach the build filler too');
});

test('the letter is the KEY, so the marker is banned from the text', () => {
  ok(/no "\(a\)" marker inside the text/.test(promptFor(threeParts())),
     'a marker in the text as well as the key prints the label twice');
});

console.log('\nWRITING THEM IN');

const reply = obj => M.reply(JSON.stringify(obj));

test('ONE call fills every missing part', async () => {
  const bs = threeParts();
  const q = { title: 'T', topic: 'Water', blocks: bs };
  M.resetCalls();
  reply({ explanations: { a: 'About (a).', b: 'About (b).', c: 'About (c).' } });
  const done = await M.write(q);
  deep(done, ['a', 'b', 'c']);
  eq(M.calls().length, 1, 'one per part would turn a paper into hundreds');
  deep(M.missing(bs), [], 'no part is left bare');
});

test('the pages go along, so the note is written from the FIGURE', async () => {
  const bs = threeParts();
  M.resetCalls();
  reply({ explanations: { a: 'x', b: 'y', c: 'z' } });
  await M.write({ blocks: bs }, { media: [{ mimeType: 'image/png', data: 'AAA' }] });
  eq(M.calls()[0].kind, 'vision', 'with a page attached it must be a vision call');
});

test('NOTHING already written is replaced', async () => {
  const bs = threeParts();
  bs.splice(3, 0, expl('a', "The author's own words."));
  M.resetCalls();
  reply({ explanations: { a: 'THE MODEL REWROTE IT', b: 'About (b).', c: 'About (c).' } });
  const done = await M.write({ blocks: bs });
  deep(done, ['b', 'c'], 'part (a) was not asked for and is not written');
  ok(bs.some(b => b.type === 'explanation' && b.content === "The author's own words."),
     'the author’s note must survive a model that answered for it anyway');
});

test('a marker the model typed anyway is taken back off', async () => {
  const bs = threeParts();
  M.resetCalls();
  reply({ explanations: { a: '(a) Evaporation.', b: 'B.', c: 'C.' } });
  await M.write({ blocks: bs });
  const m = M.map(bs);
  const a = bs.find(b => b.type === 'explanation' && M.partOf(m, b) === 'a');
  ok(!/^\(a\)/.test(a.content), 'the block wears its own label: ' + a.content);
});

test('a failed call changes NOTHING and never throws', async () => {
  const bs = threeParts();
  const before = JSON.stringify(bs);
  M.reply(new Error('the model is down'));
  const done = await M.write({ blocks: bs });
  deep(done, [], 'nothing was written');
  eq(JSON.stringify(bs), before, 'a question is worth more than a note');
});

test('a reply in the wrong shape is dropped, not written', async () => {
  const bs = threeParts();
  M.reply(JSON.stringify({ explanation: 'one string for a three-part question' }));
  deep(await M.write({ blocks: bs }), []);
  deep(M.missing(bs), ['a', 'b', 'c']);
});

test('an EMPTY string for a part writes no empty box', async () => {
  const bs = threeParts();
  reply({ explanations: { a: '', b: '   ', c: 'Real.' } });
  deep(await M.write({ blocks: bs }), ['c'], 'a blank box on the key says nothing at all');
});

test('a question with no parts is never sent at all', async () => {
  M.resetCalls();
  reply({ explanations: { a: 'x' } });
  deep(await M.write({ blocks: [txt('', 'One question.'), ans()] }), []);
  eq(M.calls().length, 0, 'no parts, no call, no bill');
});

test('the free split runs FIRST, so a call is only made for what is really missing', async () => {
  const bs = threeParts();
  bs.push(expl('', '(a) One.<br>(b) Two.'));
  M.resetCalls();
  reply({ explanations: { c: 'About (c).' } });
  deep(await M.write({ blocks: bs }), ['c']);
  const p = M.calls()[0].prompt;
  eq((p.match(/<<< WRITE AN EXPLANATION FOR THIS ONE/g) || []).length, 1,
     'only (c) should have been asked for');
});

test('a runaway part count is capped', () => {
  ok(M.MAX >= 4 && M.MAX <= 12,
     'more lettered parts than this is not a question, it is a paper that failed to split');
});

console.log('\nTHE THREE BUILD PATHS ARE WIRED');

test('⚡ Rapid add / 📄 whole PDFs fill the parts before the question reaches vetting', () => {
  const i = src.indexOf('async function processRapidJob');
  const body = src.slice(i, src.indexOf('\n// A failure must always leave a card behind', i));
  ok(/aiWritePartExplanations\(q,/.test(body), 'the rapid path never tops the parts up');
  ok(body.indexOf('aiWritePartExplanations') < body.indexOf('_tagDuplicate(q);'),
     'it has to happen BEFORE the question is promoted to vetting, or it is written to a card nobody looks at again');
  ok(/mimeType: file\.type, data: b64/.test(body), 'the page itself must go along as the reference');
  ok(/catch \(e\) \{ console\.warn\('rapid per-part explanations skipped'/.test(body),
     'a failure here must never cost the question');
});

test('🤖 Build from screenshot tops up the question it just loaded', () => {
  const i = src.indexOf('async function _aiBuildFillPartExplanations');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/qHasParts\(blocks\)/.test(body), 'a question with no parts must cost nothing');
  ok(/aiWritePartExplanations\(q, \{ media \}\)/.test(body), 'the pages go along');
  ok(/renderBlocks\(\)/.test(body), 'a note written into a block nobody repaints is a note nobody sees');
  ok(src.includes('await _aiBuildFillPartExplanations(pages);'), 'the builder never calls it');
});

test('the build PROMPT still asks for one per part, in as many words', () => {
  const frag = cut('function _partsPromptRules() {', '\n}', 'parts fragment');
  ok(/EVERY PART GETS ONE, WITHOUT EXCEPTION/.test(frag),
     'the prompt is the primary fix; the filler is the net under it');
  ok(/ONE explanation block PER PART/.test(frag));
});

test('the filler can never reach an expanded tier', () => {
  const i = src.indexOf('function _partExplPrompt');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  ok(/_explDepthRules\([\s\S]*?, ''\);/.test(body),
     "the DEFAULT tier, always — a build path may never write 📖 or 📚");
  ok(!/'more'|'full'/.test(body));
});

console.log('\n🖼 DRAW THIS EXPLANATION');

test('the explanation IS the brief, and it is what the prompt is about', () => {
  const q = { title: 'Windowsill', topic: 'Water', blocks: [txt('', 'A beaker was left out.')] };
  const p = M.xdPrompt(q, 'The water evaporated and left as vapour.', '', 'none');
  ok(/EXACTLY what the EXPLANATION below says/.test(p), 'the whole point of this button');
  ok(/THE EXPLANATION TO DRAW/.test(p) && /The water evaporated and left as vapour\./.test(p),
     'the explanation itself must be in the prompt');
  ok(/for context only/.test(p), 'handed both, a model draws the QUESTION instead');
});

test('it is BOUND to the sentence — nothing named is left out, nothing else invented', () => {
  ok(/Every thing the explanation NAMES must appear/.test(M.FIDELITY));
  ok(/Do NOT add an object, a step, a cause or a claim the explanation does not make/.test(M.FIDELITY));
  ok(/not a picture "about the topic"/.test(M.FIDELITY),
     'a generic picture beside a specific note teaches the wrong thing and looks like it worked');
});

test('it is drawn for PAPER, in the same house as the answer-key diagram', () => {
  const p = M.xdPrompt({ blocks: [] }, 'Something.', '', 'none');
  ok(/AKD_PRINT_RULES/.test(src.slice(src.indexOf('function _xdPrompt'), src.indexOf('function _xdExplText'))),
     'two houses of diagram on one answer key reads as a mistake');
  ok(/black line-work/.test(AKD_PRINT_RULES), 'the shared style constant moved');
  ok(p.length > 200);
});

test("the teacher's instructions outrank the rest", () => {
  const p = M.xdPrompt({ blocks: [] }, 'Something.', 'two panels, side view', 'none');
  ok(/this outranks anything below it/.test(p) && /two panels, side view/.test(p));
});

test('the three reference kinds each say something different', () => {
  const of = k => M.xdPrompt({ blocks: [] }, 'S.', '', k);
  ok(/CURRENT diagram/.test(of('current')), '🔄 edits the picture that is there');
  ok(/FIGURE PRINTED IN THE QUESTION/.test(of('question')), 'the apparatus must match what the pupil saw');
  ok(/NOT to be handed back unchanged/.test(of('question')), 'or the model returns the figure it was given');
  ok(!/CURRENT diagram|FIGURE PRINTED/.test(of('none')));
});

test('an EMPTY explanation is refused before a call is made', () => {
  eq(M.xdText({ content: '   <p></p> ' }), '', 'a picture of nothing is not an outcome');
  const body = src.slice(src.indexOf('function xdRunBlock'), src.indexOf('async function _xdGoBlock'));
  ok(/if \(!_xdExplText\(live\)\)/.test(body), 'xdRunBlock must refuse an empty box');
  ok(/Write the explanation first/.test(body), 'and say why, or the button reads as broken');
});

test('drawing over a picture asks first; regenerating does not', () => {
  const body = src.slice(src.indexOf('function xdRunBlock'), src.indexOf('async function _xdGoBlock'));
  ok(/if \(!regen && cur\) \{ showConfirm/.test(body), '🖼 starts again and replaces what is there');
  ok(/if \(regen && !cur\)/.test(body), '🔄 with nothing to redraw is a no-op that has to say so');
});

test('it goes through the ONE drawing core and the ONE editor', () => {
  const body = src.slice(src.indexOf('async function _xdGoBlock'), src.indexOf('const XD_DONE'));
  ok(/_diagramDraw\(q, kind => _xdPrompt\(/.test(body), 'a second copy of the draw/clean/upload steps drifts');
  ok(/_akdEditorQuestion\(blockId\)/.test(body),
     'emScope: in editing mode `blocks` is the whole sheet, and the picture would be of another question');
  ok(/blocks\.find\(b => b\.id === blockId\)/.test(body.slice(body.indexOf('await'))),
     'the block must be re-resolved after the await — renderBlocks may have replaced it');
  const touch = src.slice(src.indexOf('function xdTouchUpBlock'), src.indexOf('function xdRemoveBlockPic'));
  ok(/akBlockId: blockId/.test(touch), 'the same editor and the same destination — never a second one');
});

console.log('\n…AND IT REACHES THE PAGE');

test('the picture prints on the answer key, under the words', () => {
  const html = M.keyHtml({ type: 'explanation', content: '<p>It evaporated.</p>', url: 'https://x/y.png' });
  ok(/It evaporated\./.test(html), 'the words come first');
  ok(/<img src="https:\/\/x\/y\.png"/.test(html), 'the picture is missing from the key');
  ok(/max-height:180pt/.test(html), 'a diagram that eats the sheet is a diagram that gets cropped');
});

test('an explanation with no picture prints byte for byte what it always did', () => {
  eq(M.keyHtml({ type: 'explanation', content: '<p>Words.</p>' }), '<p>Words.</p>',
     'the overwhelming majority of the bank must be unchanged');
});

test('BOTH print paths go through the shared helper', () => {
  const hits = src.split('\n').filter(l => l.includes('_explKeyContentHtml(')).length;
  ok(hits >= 4, 'its definition, both print paths and the fallback section: ' + hits + ' found');
  ok(!/kind: 'explanation', content: sanitizeAnswerKeyHtml\(block\.content\)/.test(src),
     'a print path left on the raw content is one that prints the words and drops the picture');
});

test('a picture with no words still reaches the key', () => {
  // The section is pushed on content OR url — an explanation whose whole point
  // is the diagram must not be dropped for having few words.
  ['bank', 'akExtras'].forEach(() => {});
  const bothPaths = src.split('\n').filter(l => /stripHtml\(block\.content\) \|\| String\(block\.url \|\| ''\)\.trim\(\)/.test(l));
  eq(bothPaths.length, 2, 'both print paths must test the picture as well as the words');
});

// ── 📐 How big the picture is drawn ────────────────────────────────────────
// One number on the block, read by all three surfaces. Every failure below is
// silent: the picture still draws, the key still prints, and the size the
// author chose is simply not the size anybody gets.
test('no size chosen renders BYTE FOR BYTE what it always did', () => {
  // That is every explanation diagram already in the bank. A control nobody
  // has touched must not resize a single one of them.
  eq(M.xdImgStyle({}, false), 'max-width:100%;', 'on screen');
  eq(M.xdImgStyle({}, true), 'max-width:100%;max-height:' + M.XD_PRINT_MAX_PT + 'pt;', 'on paper');
  eq(M.keyHtml({ content: '<p>Note.</p>', url: 'd.png' }),
     '<p>Note.</p><div><img src="d.png" style="max-width:100%;max-height:180pt;"></div>',
     'the printed key, unchanged');
});

test('a chosen size reaches the SCREEN and the PAPER, and the height cap comes with it', () => {
  eq(M.xdImgStyle({ scale: 0.4 }, false), 'width:40%;max-width:100%;', 'on screen');
  // Half the size has to be half the HEIGHT too, or a tall diagram is half as
  // wide and exactly as tall — which is not what anybody means by half.
  eq(M.xdImgStyle({ scale: 0.5 }, true),
     'width:50%;max-width:100%;max-height:' + Math.round(M.XD_PRINT_MAX_PT / 2) + 'pt;', 'on paper');
  ok(/width:60%/.test(M.keyHtml({ content: 'x', url: 'd.png', scale: 0.6 })),
     'the printed key reads the same number');
});

test('the printed picture can never be made TALLER than the key already allowed', () => {
  // Which is what makes the control safe to hand out: it can only ever come
  // DOWN from the cap, so a resized picture is never the thing that breaks a
  // sheet the print planner had already measured.
  [0.2, 0.35, 0.5, 0.75, 1, 5, -3].forEach(v => {
    const cap = Number((M.xdImgStyle({ scale: v }, true).match(/max-height:(\d+)pt/) || [])[1]);
    ok(cap > 0 && cap <= M.XD_PRINT_MAX_PT, 'scale ' + v + ' gave a cap of ' + cap);
  });
});

test('the size is CLAMPED, and it is the picture block\'s own clamp', () => {
  const pct = b => Number((M.xdImgStyle(b, false).match(/width:(\d+)%/) || [])[1]);
  eq(pct({ scale: 9 }), M.IMG_SCALE_MAX, 'nothing wider than the column');
  eq(pct({ scale: 0.01 }), M.IMG_SCALE_MIN, 'nothing smaller than the floor');
});

test('Auto DELETES the field — it is never a size of 0', () => {
  // `imgHasScale` asks whether the field is there at all, so a 0 left behind
  // would read as "no size chosen" on one line and as a real number on the
  // next, depending on who was asking.
  const b = { id: 'x1', type: 'explanation', url: 'd.png', scale: 0.5 };
  M.setBlocks([b]);
  M.xdSizeAuto('x1');
  ok(!('scale' in b), 'the field is gone, not zeroed');
  ok(!M.imgHasScale(b), 'and it reads as Auto again');
  eq(M.xdImgStyle(b, false), 'max-width:100%;', 'so it renders as it always did');
});

test('+ and − step by the picture block\'s own step, and stop at its own limits', () => {
  const b = { id: 'x2', type: 'explanation', url: 'd.png', scale: 0.5 };
  M.setBlocks([b]);
  M.xdSizeStep('x2', -1);
  eq(Math.round(b.scale * 100), 50 - M.IMG_SCALE_STEP, 'one press smaller');
  M.xdSizeStep('x2', 1);
  eq(Math.round(b.scale * 100), 50, 'and back');
  b.scale = M.IMG_SCALE_MAX / 100;
  M.xdSizeStep('x2', 1);
  eq(Math.round(b.scale * 100), M.IMG_SCALE_MAX, 'the top is the column itself');
  b.scale = M.IMG_SCALE_MIN / 100;
  M.xdSizeStep('x2', -1);
  eq(Math.round(b.scale * 100), M.IMG_SCALE_MIN, 'and the floor holds');
});

test('a block with no picture is not resized', () => {
  const b = { id: 'x3', type: 'explanation', url: '' };
  M.setBlocks([b]);
  M.xdSizeStep('x3', 1);
  ok(!('scale' in b), 'there is nothing there to make bigger');
});

test('imgScaleStep is the ONE stepper both size controls read', () => {
  // Written a second time, + means 5% on a picture block and something else on
  // the explanation diagram beside it.
  eq(M.imgScaleStep({ scale: 0.5 }, 1, 'nope'), 50 + M.IMG_SCALE_STEP, 'from the size that is set');
  const adjust = src.slice(src.indexOf('function adjustImgScale'), src.indexOf('// Back to Auto:'));
  ok(/imgScaleStep\(/.test(adjust), 'the picture block goes through it');
  const xd = src.slice(src.indexOf('function xdSizeStep'), src.indexOf('function xdSizeAuto'));
  ok(/imgScaleStep\(/.test(xd), 'and so does the explanation diagram');
});

test('ALL THREE surfaces read the size through the ONE helper', () => {
  // A surface that read it its own way — or did not read it at all — is the
  // author sizing the picture in the editor and the key printing the old size,
  // with nothing on any screen saying so.
  const bar = src.slice(src.indexOf('function xdBarHtml'), src.indexOf('// The explanation as it reaches an ANSWER KEY'));
  ok(/xdImgStyle\(block, false\)/.test(bar), 'the editor preview');
  const key = src.slice(src.indexOf('function _explKeyContentHtml'), src.indexOf('function _qExplanationDiagrams'));
  ok(/xdImgStyle\(block, true\)/.test(key), 'the printed answer key');
  const card = src.slice(src.indexOf('const explDiagrams = _qExplanationDiagrams'), src.indexOf('// Interactive widget'));
  ok(/d\.style/.test(card), "the pupil's 🖼 Picture it card");
  // …and the size row must survive ✏️ editing mode's fold, or it is a control
  // hidden behind the very ⚙ nobody pressed.
  ok(/EM_KEEP = '[^']*\.xd-size/.test(src), '.xd-size is in EM_KEEP');
  ok(/EM_NO_HOIST_IN = '[^']*\.xd-size/.test(src), "…and its own buttons stay in it");
});

test('the student sees it only AFTER marking, and it is its own reader', () => {
  // It hands back the SIZE with the url — the card is one of the three
  // surfaces that draws this picture, and a reader returning bare urls would
  // leave it the one place that silently ignores the author's size control.
  deep(M.explDiagrams({ blocks: [
    { type: 'explanation', url: 'a.png' },
    { type: 'explanation', url: '' },
    { type: 'answerKey', url: 'k.png' },
    { type: 'explanation', url: 'a.png' },
  ] }), [{ url: 'a.png', style: 'max-width:100%;' }],
    'deduped, and an answer-key picture is not one of these');
  deep(M.explDiagrams({ blocks: [{ type: 'explanation', url: 'b.png', scale: 0.5 }] }),
    [{ url: 'b.png', style: 'width:50%;max-width:100%;' }], 'the size travels with the url');
  // The card is built in showExplanation — the ONE post-marking builder — and
  // renderImportedBlockStudent still renders an explanation block as NOTHING
  // inside the question, so it can never appear above the answer.
  const i = src.indexOf('function showExplanation');
  const body = src.slice(i, src.indexOf('\n// Place the cards', i));
  ok(/_qExplanationDiagrams\(q\)/.test(body), 'the card is never built');
  eq((src.match(/_qExplanationDiagrams\(/g) || []).length, 2,
     'its definition and the one card — a second reader is a second place it can leak out of');
});

// ── run ─────────────────────────────────────────────────────────────────────
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { await c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
