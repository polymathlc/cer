// 📋 Answer options printed as a table, in the CER app (⚡ Rapid add, the
// editor, the student view and every printed sheet). Loads the REAL helpers out
// of app.js and the real option-table.js.
//   node tools/rapid-option-table-tests.mjs
// With SHOTS=<dir> it also saves a picture of the student view and the editor preview.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const T = require('../option-table.js');
const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker "' + to + '" not found');
  return src.slice(a, b) + '\n';
};
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); } };

const HOOK = { saved: [], toasts: [], vision: [], reply: null };
const sandbox = {
  window: { PolymathOptionTable: T, __aiReady: () => true }, console, JSON, Date, Math, String, Array, Object, Set, Map, RegExp, Number,
  document: { getElementById: () => null, querySelector: () => null },
  HOOK
};
vm.createContext(sandbox);
vm.runInContext(`
var blocks = [];
var vettingList = [];
var questionBank = [];
const _tlCache = new Map();
const _cqReviews = new Map();
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' '); }
function mcqLabelStyle(q) { return q && q.mcqLabels === 'letters' ? 'letters' : 'numbers'; }
function mcqStyleForBlock() { return 'numbers'; }
function mcqLabelOf(i, style) { return style === 'letters' ? String.fromCharCode(65 + i) : String(i + 1); }
function mcqOptionText(t) { return t; }
function _cqMcqBlock(q) { return ((q && q.blocks) || []).find(b => b && b.type === 'mcq'); }
function _cqFinding(type, severity, title, detail, fix) { return { type, severity, title, detail, fix: fix || '' }; }
async function askGeminiVision(prompt, media) { HOOK.vision.push({ prompt, media }); return HOOK.reply; }
function _parseAIJson(r) { return typeof r === 'string' ? JSON.parse(r) : r; }
async function saveVettingQuestion(q) { HOOK.saved.push(JSON.parse(JSON.stringify(q))); return true; }
async function saveQuestion(q) { HOOK.saved.push(JSON.parse(JSON.stringify(q))); return true; }
function showToast(m, k) { HOOK.toasts.push([m, k]); }
function renderVettingList() {}
function tlRenderPanel() {}
function renderQuestionBank() {}
function _cqRender() {}
function _docQById(id) { return questionBank.find(q => q.id === id) || null; }
` + cut('// 📋 ANSWER OPTIONS PRINTED AS A TABLE', '\nfunction markMcqChoice', 'table helpers')
  + cut('function renderImportedBlockStudent(block, q) {', '\n    case \'answerLine\':', 'student render').replace(/\n    case 'answerLine':[\s\S]*$/, '') + '\n  }\n}\n'
  + cut('// 📋 The options-table findings, decidable in code:', '\nfunction _cqFinding', 'findings + source check + fix'), sandbox);
const run = code => vm.runInContext(code, sandbox);

const FRUIT = ['Circle: X; triangle: Y; square: Z', 'Circle: Y; triangle: Z; square: X', 'Circle: Z; triangle: X; square: Y', 'Circle: Y; triangle: X; square: Z'];
const mcqBlock = texts => ({ id: 'm1', type: 'mcq', options: texts.map((t, i) => ({ id: 'o' + i, text: t })), correctId: 'o3' });
const question = texts => ({ id: 'q1', blocks: [{ id: 't1', type: 'text', content: 'Which option correctly matches each fruit to its shape?' }, mcqBlock(texts)] });

console.log('📋 Options printed as a table — CER app');

{
  sandbox.q = question(FRUIT);
  const html = run('renderImportedBlockStudent(q.blocks[1], q)');
  ok('the student view draws table options as a table with the printed headings', /class="mcq-block mcq-otable"/.test(html) && /<span style="[^"]*">Circle<\/span>/.test(html) && /Triangle/.test(html) && /Square/.test(html));
  ok('…one <label> per option, so every marker and painter still walks them by index', (html.match(/<label /g) || []).length === 4 && (html.match(/type="radio"/g) || []).length === 4);
  ok('…the header is not a label (an index-walker must not count it)', !/<label[^>]*mcq-ot-head/.test(html));
  ok('…the cells of row 4 are Y, X, Z', /value="o3"[\s\S]*?<b>4\.<\/b><\/span><span class="mcq-ot-cell"[^>]*>Y<\/span><span class="mcq-ot-cell"[^>]*>X<\/span><span class="mcq-ot-cell"[^>]*>Z<\/span>/.test(html));
  ok('…every style is on the element (a print window has no stylesheet)', /<label class="mcq-ot-row"[^>]*style="display:grid;/.test(html));
  sandbox.q2 = question(['It melts', 'It boils', 'It freezes', 'It condenses']);
  const plain = run('renderImportedBlockStudent(q2.blocks[1], q2)');
  ok('ordinary options are drawn exactly as before', !/mcq-otable/.test(plain) && /It melts/.test(plain));
  ok('the editor preview shows the table the student will see', /Students see these options as a table/.test(run('_mcqTablePreviewHtml(q.blocks[1])')) && run('_mcqTablePreviewHtml(q2.blocks[1])') === '');
  ok('every AI reader is given the same table rule', run('_optionTableRule()') === '- ' + T.PROMPT_RULE + '\n');
  const promptRules = (src.match(/^\s*_optionTableRule\(\) \+/gm) || []).length;
  ok('the rule is in every question-building prompt (Rapid add, screenshot, PDF import, regenerate, repair, exam builder)', promptRules >= 6, 'found ' + promptRules);
}

{
  sandbox.q = question(['Circle: X; triangle: Y', 'Circle: Y; triangle: X', 'X and Y', 'Y and X']);
  const f = run('_otLocalFindings(q, q.blocks[1])');
  ok('half a table is a RED "Options table needs checking"', f.length === 1 && f[0].severity === 'high' && f[0].title === 'Options table needs checking');
  sandbox.q = question(FRUIT);
  ok('a clean table has nothing to say', run('_otLocalFindings(q, q.blocks[1])').length === 0);
  ok('the local checks call it', /out\.push\(\.\.\._otLocalFindings\(q, mcq\)\);/.test(src));
}

const page = { mimeType: 'image/png', data: 'UEFHRQ==' };
const rows = [['X', 'Y', 'Z'], ['Y', 'Z', 'X'], ['Z', 'X', 'Y'], ['Y', 'X', 'Z']];
await (async () => {
  // The page agrees.
  sandbox.q = question(FRUIT);
  HOOK.reply = { found: true, readable: true, printedAsTable: true, head: ['Circle', 'Triangle', 'Square'], rows };
  const good = await run('otRapidSourceCheck(q, [' + JSON.stringify(page) + '])');
  ok('Rapid add reads the options again off the source page', HOOK.vision.length === 1 && HOOK.vision[0].media[0].data === page.data && /printedAsTable/.test(HOOK.vision[0].prompt));
  ok('…and a matching table is fine', good.state === 'ok' && run('_otLocalFindings(q, q.blocks[1])').length === 0);
  ok('…stored without arrays inside arrays (Firestore refuses them)', good.table.rows.every(r => r && Array.isArray(r.c)));

  // The page's row 4 is different: the answer would point at the wrong row.
  sandbox.q = question(FRUIT);
  HOOK.reply = { found: true, readable: true, printedAsTable: true, head: ['Circle', 'Triangle', 'Square'], rows: [rows[0], rows[1], rows[2], ['Y', 'Z', 'Z']] };
  const bad = await run('otRapidSourceCheck(q, [' + JSON.stringify(page) + '])');
  const f = run('_otLocalFindings(q, q.blocks[1])');
  ok('a cell that differs from the page lights the card red, naming the row', bad.state === 'mismatch' && f.length === 1 && /row 4/.test(f[0].detail) && f[0].fix === 'optionsTable');
  ok('…and says what the page shows', /The page shows: Circle \| Triangle \| Square — 1\) X \| Y \| Z/.test(f[0].detail));

  // A table on the page that came out as lines, then the one-tap fix.
  sandbox.q = question(['X, Y, Z', 'Y, Z, X', 'Z, X, Y', 'Y, X, Z']);
  run('vettingList = [q]');
  HOOK.reply = { found: true, readable: true, printedAsTable: true, head: ['Circle', 'Triangle', 'Square'], rows };
  await run('otRapidSourceCheck(q, [' + JSON.stringify(page) + '])');
  ok('options that were a table on the page but came out as lines are flagged', /did not come out as a table/.test(run('_otLocalFindings(q, q.blocks[1])')[0].detail));
  run('q.autoCheck = { state: "red", findings: [{ title: "Options table needs checking", fix: "optionsTable" }, { title: "other", fix: "" }] }');
  await run('otFixOptions("vet", "q1")');
  const fixed = run('q');
  ok('"📋 Make the table" writes the page\'s table into the options, row for row', JSON.stringify(fixed.blocks[1].options.map(o => o.text)) === JSON.stringify(T.toOptions({ head: ['Circle', 'Triangle', 'Square'], rows })));
  ok('…keeps the option ids, so the ticked answer stays on row 4', fixed.blocks[1].correctId === 'o3' && fixed.blocks[1].options[3].id === 'o3');
  ok('…saves the vetting question and clears the finding', HOOK.saved.length === 1 && run('_otLocalFindings(q, q.blocks[1])').length === 0 && fixed.autoCheck.findings.length === 1);

  // Lines on the page that were made into a table: never shown as one.
  sandbox.q = question(FRUIT);
  HOOK.reply = { found: true, readable: true, printedAsTable: false, options: ['a', 'b', 'c', 'd'] };
  await run('otRapidSourceCheck(q, [' + JSON.stringify(page) + '])');
  ok('options made into a table that is not on the page are flagged', /not a table on the source/.test(run('_otLocalFindings(q, q.blocks[1])')[0].detail));
  // Editing the options by hand retires the finding (it was about the old words).
  run('q.blocks[1].options[0].text = "Circle: Z; triangle: Y; square: X"');
  ok('a finding about options that have since been edited is not shown', run('_otLocalFindings(q, q.blocks[1])').length === 0);
  // An open question, or no page: nothing is asked.
  HOOK.vision.length = 0;
  sandbox.q = { id: 'q9', blocks: [{ id: 't', type: 'text', content: 'Why?' }] };
  ok('an open question is never sent', (await run('otRapidSourceCheck(q, [' + JSON.stringify(page) + '])')) === null && HOOK.vision.length === 0);
})();

{
  const job = cut('async function processRapidJob(jobId, file, batchLevel, opts) {', '\nfunction _failRapidJob', 'rapid job');
  const at = job.indexOf('otRapidSourceCheck(q, [{ mimeType: file.type, data: b64 }])');
  ok('⚡ Rapid add runs the source check on the untouched page, after the auto-check and before the card is filed',
    at > job.indexOf('autoChkRun(q, {') && at < job.indexOf('vettingList.unshift(q)'));
  ok('the vetting finding offers the fix button', /f\.fix === 'optionsTable' && scope !== 'create'/.test(src) && /otFixOptions\(/.test(src));
  ok('index.html loads option-table.js before app.js', (() => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const a = html.indexOf('<script src="option-table.js"'), b = html.indexOf('src="app.js');
    return a > 0 && b > a;
  })());
}

// ✂️ v1.461.0: the first read says whether the options were printed as a
// table, and the second reading is skipped ONLY when it plainly says not and
// our options are not table-shaped either.
{
  vm.runInContext(cut('function _rapidOptionsCheckNeeded(q, payload) {', '\nasync function processRapidJob', 'options-check gate'), sandbox);
  const plain = ['It melts.', 'It boils.', 'It freezes.', 'It condenses.'];
  const need = (texts, raw) => { sandbox.__q = question(texts); sandbox.__p = { blocks: raw }; return run('_rapidOptionsCheckNeeded(__q, __p)'); };
  ok('plain options the first read called "not a table" skip the second reading', need(plain, [{ type: 'text' }, { type: 'mcq', printedAsTable: false }]) === false);
  ok('a first read that did not say still gets the second reading', need(plain, [{ type: 'mcq' }]) === true);
  ok('a first read that saw a table still gets the second reading', need(plain, [{ type: 'mcq', printedAsTable: true }]) === true);
  ok('table-shaped options are always read again, whatever the first read said', need(FRUIT, [{ type: 'mcq', printedAsTable: false }]) === true);
  ok('half-table options are always read again', need([FRUIT[0], 'It boils.', FRUIT[2], 'It condenses.'], [{ type: 'mcq', printedAsTable: false }]) === true);
  sandbox.__q = { id: 'q0', blocks: [{ id: 't', type: 'text', content: 'Explain.' }] };
  ok('an open question is left to otRapidSourceCheck, which turns it away itself', run('_rapidOptionsCheckNeeded(__q, { blocks: [] })') === true);
  const job = cut('async function processRapidJob(jobId, file, batchLevel, opts) {', '\nfunction _failRapidJob', 'rapid job');
  ok('the page read runs on medium thinking with room for it', /reasoningEffort: 'medium'/.test(job) && /maxOutputTokens: 12288/.test(job));
  ok('the build prompt asks the first read whether the options are a table', /"printedAsTable":false/.test(cut('function _aiBuildQuestionPrompt(', '\nfunction ', 'build prompt')));
}

if (process.env.SHOTS) {
  const { chromium } = require('playwright');
  sandbox.q = question(FRUIT);
  const student = run('renderImportedBlockStudent(q.blocks[1], q)');
  const preview = run('_mcqTablePreviewHtml(q.blocks[1])');
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 760, height: 600 }, deviceScaleFactor: 2 });
  await p.setContent('<body style="font-family:Arial;padding:16px;--border:#cbd5e1"><p><b>Student view / printed sheet</b></p>' + student + '<p style="margin-top:24px"><b>Editor</b></p>' + preview + '</body>');
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await p.screenshot({ path: process.env.SHOTS + '/cer-option-table.png', fullPage: true });
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
