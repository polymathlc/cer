// Regression tests for 🪄 TELL THE AI WHAT TO CHANGE — the command box in the
// question creator.
// Run with:
//     node tools/ai-command-tests.mjs            all cases
//     node tools/ai-command-tests.mjs <name>     one case
//
// It loads the REAL helpers out of the app source. The block is byte-for-byte
// the same in all four portals, so this harness is the same file in all four.
//
// Every failure this pins is SILENT — a question comes back, it renders, it
// prints, and it is wrong in a way only a class sitting in front of it finds:
//
//  • THE CHANGE GOES TO THE WRONG PICTURE. "diagramChanges" is POSITIONAL: entry
//    i belongs to picture i and to nothing else. A model that answers about the
//    second figure alone, lined up against the first, redraws a figure nobody
//    asked about while leaving the one that had to change showing the old
//    numbers. Both pictures still look like perfectly good pictures.
//  • A NON-ANSWER IS PAINTED INTO THE FIGURE. Asked what must change, a model
//    says "none", "-", "N/A" and "no change" at least as often as it returns an
//    empty string. Any of those treated as an instruction hands the image model
//    a word to draw — and spends an image call redrawing a figure that was
//    already right.
//  • THE FIGURE IS REDRAWN FROM NOTHING. The existing picture is the reference
//    on every image call and the model is told to change only what the
//    instruction names. Lose either and the reply is a fresh picture of roughly
//    the same thing, in a different style and at a different size — which is
//    exactly what an author holding a scanned exam figure does not want.
//  • A FAILED REDRAW GOES QUIET. The picture is KEPT, never dropped, and the
//    author is TOLD — a question whose new wording talks about a figure still
//    showing the old numbers is the one outcome nothing on screen reveals.
import fs from 'fs';

const SRC = ['../app.js', '../index.html']
  .map(p => new URL(p, import.meta.url).pathname)
  .find(p => fs.existsSync(p));
if (!SRC) throw new Error('neither app.js nor index.html found beside tools/');
const src = fs.readFileSync(SRC, 'utf8');

// The pure core: the constants down to the end of qcmdSummary.
const start = src.indexOf('const QCMD_MAX_CHARS');
if (start < 0) throw new Error('the command-box core was not found — has QCMD_MAX_CHARS been renamed?');
const sumAt = src.indexOf('function qcmdSummary(', start);
if (sumAt < 0) throw new Error('qcmdSummary not found after QCMD_MAX_CHARS');
const endAt = src.indexOf('\n}', sumAt);
if (endAt < 0) throw new Error('qcmdSummary never closes');
const M = new Function(src.slice(start, endAt + 2) + `
return { MAX: QCMD_MAX_CHARS, REF: QCMD_MAX_REF, RULES: QCMD_DIAGRAM_RULES,
         needs: qcmdNeedsRedraw, changesFor: qcmdChangesFor,
         prompt: qcmdDiagramPrompt, rules: qcmdDiagramPromptRules, summary: qcmdSummary };`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error((what || 'value') + ':\n           got  ' + g + '\n           want ' + w);
};

// ---------------------------------------------------------------------
// "nothing to change" in every spelling a model actually uses
// ---------------------------------------------------------------------
test('an empty answer is never a redraw', () => {
  for (const v of ['', '   ', null, undefined, '-', '--', '—', 'none', 'None.', 'NONE',
                   'n/a', 'N/A', 'na', 'no', 'nil', 'null', 'undefined', 'false',
                   'no change', 'No change.', 'nochange', 'unchanged', 'not changed',
                   'same', 'the same', 'keep', 'keep it', 'keep the same', 'keep as is',
                   'as is', 'no changes needed', 'not applicable']) {
    ok(!M.needs(v), `"${v}" was read as an instruction to redraw the picture`);
  }
});

test('a real instruction IS a redraw', () => {
  for (const v of ['change the label from 20 °C to 55 °C',
                   'four bars instead of three',
                   'no arrow on the left-hand beaker',   // opens with "no" and is a real change
                   'same shape but label it Q instead of P',
                   'nothing is drawn above the water line any more']) {
    ok(M.needs(v), `"${v}" was thrown away as a non-answer`);
  }
});

// ---------------------------------------------------------------------
// which picture a change belongs to
// ---------------------------------------------------------------------
test('changes are positional, one per picture', () => {
  eq(M.changesFor({ diagramChanges: ['', 'change the second'] }, 2), ['', 'change the second'],
     'a change must stay at its own index');
});

test('a short reply is padded, never shifted', () => {
  // The dangerous reading is "the model only mentioned one picture, so it must
  // mean the one that changes" — which slides a change onto picture 1.
  eq(M.changesFor({ diagramChanges: ['change picture one'] }, 3), ['change picture one', '', ''],
     'a short list must pad on the RIGHT');
  eq(M.changesFor({ diagramChanges: ['', '', 'change picture three'] }, 3), ['', '', 'change picture three'],
     'the third entry belongs to the third picture');
});

test('a long reply is cut to the pictures that exist', () => {
  eq(M.changesFor({ diagramChanges: ['a', 'b', 'c'] }, 2), ['a', 'b'], 'extra entries must be dropped');
});

test('a bare string is picture one and nothing else', () => {
  eq(M.changesFor({ diagramChange: 'redraw the ramp steeper' }, 2), ['redraw the ramp steeper', ''],
     'one string must land on picture 1 only');
});

test('junk is not an instruction', () => {
  eq(M.changesFor({ diagramChanges: [null, 12, {}, 'real change'] }, 4), ['', '', '', 'real change'],
     'only real text may reach the image model');
  eq(M.changesFor({}, 2), ['', ''], 'a reply with no diagramChanges changes no picture');
  eq(M.changesFor(null, 2), ['', ''], 'an unreadable reply changes no picture');
});

test('a question with no picture asks for no redraw', () => {
  eq(M.changesFor({ diagramChanges: ['change something'] }, 0), [],
     'a question with no figure must never redraw one');
});

// ---------------------------------------------------------------------
// what the image model is told
// ---------------------------------------------------------------------
test('the image prompt carries the change and the keep-it-the-same rules', () => {
  const p = M.prompt('change the label from 20 °C to 55 °C');
  ok(p.includes('change the label from 20 °C to 55 °C'), 'the change itself must be in the prompt');
  ok(/EDITING one existing/i.test(p), 'the prompt must say it is EDITING the attached figure');
  ok(/ONLY the change/i.test(p), 'the prompt must limit the model to the one change');
  ok(/aspect ratio/i.test(p), 'the aspect ratio must be pinned or the figure comes back a different shape');
  ok(/Output ONLY the image/i.test(p), 'the model must be told to return the image alone');
  ok(/never invent a label|Never invent a label/i.test(p), 'inventing labels must be forbidden');
});

test('the image prompt never asks for a new drawing', () => {
  const p = M.prompt('four bars instead of three');
  ok(!/draw (a|the) new|from scratch|redesign/i.test(p),
     'the prompt must not license a picture drawn from nothing');
});

// ---------------------------------------------------------------------
// what the BUILD prompt is told
// ---------------------------------------------------------------------
test('the build rules ask for exactly one entry per picture', () => {
  const r = M.rules(3);
  ok(r.includes('EXACTLY 3'), 'the count must be stated');
  ok(/SAME ORDER/i.test(r), 'the order must be stated — this is what keeps it positional');
  ok(/empty string/i.test(r), 'an unchanged picture must have a way of saying so');
  ok(/EDIT of the existing picture/i.test(r), 'a change must be an EDIT, never a new picture');
  ok(/never asks for a picture the original does not have/i.test(r),
     'the model must not invent a figure the question has not got');
});

test('one picture reads as one picture', () => {
  const r = M.rules(1);
  ok(r.includes('EXACTLY 1 entry'), 'a single picture asks for one entry, in the singular');
  ok(!/1 pictures/.test(r), 'the singular must read as English');
});

test('the placeholder line is optional, the rest is not', () => {
  // The three portals rebuild the question from blocks and need the "image"
  // placeholder rule; the Maths app returns wording only and would be told to
  // emit a placeholder that has nowhere to go.
  const withP = M.rules(2, true), withoutP = M.rules(2, false);
  ok(/"image" placeholder/.test(withP), 'the block-based apps must keep the placeholder rule');
  ok(!/"image" placeholder/.test(withoutP), 'the wording-only app must not be asked for placeholders');
  for (const frag of ['EXACTLY 2', 'SAME ORDER', 'EDIT of the existing picture']) {
    ok(withoutP.includes(frag), `"${frag}" must survive with the placeholder line off`);
  }
});

// ---------------------------------------------------------------------
// what the author is told afterwards
// ---------------------------------------------------------------------
test('a failed redraw is reported in words', () => {
  const s = M.summary({ redrawn: 0, kept: 1 });
  ok(/could NOT be redrawn/i.test(s), 'a kept picture must say it was kept');
  ok(/check the wording still matches/i.test(s), 'the author must be told what to check');
});

test('a successful redraw is reported, and silence means nothing happened', () => {
  ok(/redrawn/.test(M.summary({ redrawn: 2, kept: 0 })), '2 redraws must be reported');
  eq(M.summary({ redrawn: 0, kept: 0 }), '', 'nothing happening says nothing');
  eq(M.summary({}), '', 'an empty report says nothing');
  ok(M.summary({ redrawn: 1, kept: 1 }).includes(';'), 'both halves are reported together');
});

// ---------------------------------------------------------------------
// the wiring — the half no pure function can pin
// ---------------------------------------------------------------------
test('the redraw is an EDIT of the picture already on the question', () => {
  const at = src.indexOf('async function qcmdRedrawDiagram');
  ok(at > 0, 'qcmdRedrawDiagram — the ONE door a picture is redrawn through — is missing');
  const body = src.slice(at, at + 1200);
  ok(/_urlToDataUrlRobust\(transformImageUrl\(url\)\)/.test(body),
     'the redraw must read the picture that is on the question NOW');
  ok(/qcmdDiagramPrompt\(change\)/.test(body), 'the redraw must go through the shared image prompt');
  ok(/uploadImageDataUrl\(/.test(body), 'the result must be uploaded, not left as a data URL on the question');
  ok(/imageAiReady\(\)/.test(body), 'a project with no image model must refuse rather than fail silently');
});

test('a picture that could not be redrawn is KEPT, never blanked', () => {
  ok(/catch \(e\) \{[\s\S]{0,400}?kept\+\+/.test(src) || /catch \(e\) \{[\s\S]{0,400}?picsKept\+\+/.test(src),
     'a failed redraw must count as kept so the author can be told');
  const at = src.indexOf('const QCMD_MAX_CHARS');
  const region = src.slice(at, at + 30000);
  ok(!/b\.url = ['"]{2}/.test(region), 'a failed redraw must never empty the picture off the question');
});

test('the variant is a NEW question — the original is never overwritten', () => {
  ok(/currentEditingQuestion = null|currentEditingId = null/.test(src),
     'the editing id must be cleared, or Save overwrites the question the variant came from');
});

test('the instruction box is capped', () => {
  ok(/\.trim\(\)\.slice\(0, QCMD_MAX_CHARS\)/.test(src),
     'the typed instruction must be capped at QCMD_MAX_CHARS where it is read');
  ok(M.MAX > 0 && M.MAX <= 2000, 'QCMD_MAX_CHARS must be a sane cap');
  ok(M.REF >= 1, 'at least one picture must reach the reading call');
});

// ---------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); pass++; console.log('  ✓ ' + c.name); }
  catch (e) { fail++; console.log('  ✗ ' + c.name + '\n      ' + e.message); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
