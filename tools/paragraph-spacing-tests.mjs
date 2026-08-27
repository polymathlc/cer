// Regression tests for 📄 A PARAGRAPH BREAK IS A BLANK LINE, EVERYWHERE.
// Run with:
//     node tools/paragraph-spacing-tests.mjs            all cases
//     node tools/paragraph-spacing-tests.mjs <name>     one case
//
// It loads the REAL `escapeHtmlKeepLines` / `_keepParagraphGaps` / `_nlToBrHtml`
// out of app.js, and checks index.html carries the CSS half.
//
// EVERY FAILURE HERE IS SILENT. The sheet prints, the question reads, and only
// the shape the author gave it is gone:
//
//  • THE PRINT PATH. `escapeHtmlKeepLines` is what both print builders flatten
//    a text block with. It turned `</p>` into ONE newline and then DROPPED
//    every blank line outright, so a paragraph break could not survive even in
//    principle — a two-paragraph question came off the printer as two lines
//    run together.
//  • `<br>` IS NOT `</p>`. A line break inside a paragraph and the end of one
//    are different things — it is the distinction the editor's own Enter and
//    Shift+Enter already make. Collapse them together and either every line
//    break becomes a paragraph or every paragraph becomes a line break.
//  • A LIST ITEM IS NOT A PARAGRAPH. `</li>` and `</tr>` are one line each; a
//    blank line between every option of an inline list is a question that no
//    longer looks like a list.
//  • RUNS AND ENDS. Markup very often ends a paragraph AND carries a typed
//    newline, so two or three blank lines in the source are ONE gap; and the
//    blank the markup leaves at either end is not spacing anybody put there.
//  • THE AI WRITERS. `\n+` collapsed to a single `<br>` turned every paragraph
//    the model wrote into an ordinary line break, so an explanation written as
//    two paragraphs arrived as one block of text.
//  • THE CSS HALF. `* { margin: 0 }` zeroes `<p>` everywhere, so even the
//    surfaces that keep the author's markup — the answer key, the student's
//    question, the explanation card — rendered two paragraphs tight together.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const IDX = new URL('../index.html', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(IDX, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

const SHIM = `
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`;

const F = new Function([
  SHIM,
  cut('function _nlToBrHtml(text) {', '\n// Keep the author', 'nlToBr'),
  cut('function _keepParagraphGaps(lines) {', '\nfunction escapeHtmlKeepLines', 'gaps'),
  cut('function escapeHtmlKeepLines(content) {', '\n}\n', 'keepLines') + '\n}\n',
  'return { keep: escapeHtmlKeepLines, gaps: _keepParagraphGaps, nl: _nlToBrHtml };',
].join('\n'))();

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const only = process.argv[2];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function ok(cond, what) { if (!cond) throw new Error(what); }
function eq(got, want, what) {
  if (got !== want) throw new Error((what || '') + '\n      got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
}

console.log('\nTHE PRINT PATH — a paragraph break survives to paper');

test('two paragraphs print with a blank line between them', () => {
  eq(F.keep('<p>Heat always flows.</p><p>A common mistake is…</p>'),
     'Heat always flows.<br><br>A common mistake is…');
});

test('a <br> is a LINE break, not a paragraph break', () => {
  eq(F.keep('one<br>two'), 'one<br>two');
});

test('the two together keep their own meanings', () => {
  eq(F.keep('<p>a<br>b</p><p>c</p>'), 'a<br>b<br><br>c');
});

test('one paragraph is unchanged — the overwhelming majority of the bank', () => {
  eq(F.keep('<p>Name the two gases.</p>'), 'Name the two gases.');
  eq(F.keep('Name the two gases.'), 'Name the two gases.');
});

test('a LIST ITEM is one line, never a paragraph of its own', () => {
  eq(F.keep('<ul><li>one</li><li>two</li></ul>'), 'one<br>two');
});

test('a TABLE ROW is one line too', () => {
  eq(F.keep('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>'), 'a<br>b');
});

test('a run of blank lines is ONE gap', () => {
  eq(F.keep('<p>a</p>\n\n\n<p>b</p>'), 'a<br><br>b');
  eq(F.keep('a<br><br><br><br>b'), 'a<br><br>b');
});

test('the markup\'s own trailing break is not spacing', () => {
  eq(F.keep('<p>only this</p>'), 'only this', 'a trailing gap pads the bottom of every text block');
  eq(F.keep('<div><p>a</p></div>'), 'a');
});

test('a leading blank line is dropped too', () => {
  eq(F.keep('<br><br>a'), 'a');
});

test('it is still ESCAPED, and empty is still empty', () => {
  eq(F.keep('<p>a &lt; b</p><p>x &amp; y</p>'), 'a &amp;lt; b<br><br>x &amp;amp; y');
  eq(F.keep(''), '');
  eq(F.keep('<p></p>'), '');
});

console.log('\n_keepParagraphGaps ON ITS OWN');

test('it keeps one gap, drops the ends, and never invents a line', () => {
  eq(F.gaps(['a', '', 'b']).join('|'), 'a||b');
  eq(F.gaps(['', '', 'a', '', '', 'b', '', '']).join('|'), 'a||b');
  eq(F.gaps([]).join('|'), '');
  eq(F.gaps(['', '']).join('|'), '');
});

console.log('\nTHE AI WRITERS');

test('a blank line the model wrote stays a blank line', () => {
  eq(F.nl('First paragraph.\n\nSecond paragraph.'),
     'First paragraph.<br><br>Second paragraph.');
});

test('a single newline is still one line break', () => {
  eq(F.nl('a\nb'), 'a<br>b');
});

test('three newlines are still one gap, and \\r\\n is handled', () => {
  eq(F.nl('a\n\n\n\nb'), 'a<br><br>b');
  eq(F.nl('a\r\n\r\nb'), 'a<br><br>b');
});

test('it escapes what it is given', () => {
  eq(F.nl('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  eq(F.nl(null), '');
});

test('every AI writer goes through it', () => {
  ['const toHtml = t => _nlToBrHtml(', 'block.content = _nlToBrHtml(expl);', 'el.innerHTML = _nlToBrHtml(t);']
    .forEach(s => ok(src.includes(s), 'still collapsing \\n+ to one <br>: ' + s));
  ok(!/replace\(\/\\n\+\/g, '<br>'\)/.test(src),
     'a surviving \\n+ collapse is a paragraph break lost on that path alone');
});

console.log('\nTHE CSS HALF — `* { margin: 0 }` is why this is needed at all');

test('the global reset is still there, so the rule is still load-bearing', () => {
  ok(/\*\s*\{\s*margin:\s*0;/.test(html),
     'if the reset has gone, re-read whether these rules are still right');
});

test('the surfaces that render authored html get their paragraphs back', () => {
  ['.content-editable p', '.qp-qtext p', '.preview-block p', '.post-explanation p', '.ak-fullcontent p']
    .forEach(s => ok(html.includes(s + ',') || html.includes(s + ' {'), 'missing: ' + s));
});

test('the last paragraph does not pad the bottom of its box', () => {
  ok(html.includes('.ak-fullcontent p:last-child { margin-bottom: 0; }'));
  ok(html.includes('.print-ak-fulltext .ak-fullcontent p:last-child { margin-bottom: 0; }'));
});

test('paper gets it too', () => {
  ok(html.includes('.print-text-block p,'), 'the printed sheet must match the screen');
  ok(html.includes('.print-ak-fulltext .ak-fullcontent p { margin: 0 0 6pt; }'));
});

test('the print rule is INSIDE @media print, so the planner sees it', () => {
  // The planner and the A4 preview copy the stylesheet and UNWRAP @media print,
  // so a rule left outside it would be measured differently from how it prints.
  const i = html.indexOf('@media print');
  const j = html.indexOf('.print-text-block p,');
  ok(i >= 0 && j > i, 'the paragraph rule must sit inside the @media print block');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
