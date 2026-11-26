// 🔍 PSLE answer key checker in a real browser: index.html's real styles and
// overlay markup, the SHIPPED `pkc*` block from app.js and the real cores
// (psle-key-check-core.mjs, ai-cost-core.mjs), over a small fake of the
// past papers and the bank. Desktop, tablet and phone. Nothing here signs in,
// writes to Firestore or calls a real AI.
//
//   PW=/path/to/playwright node tools/psle-key-checker-browser.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PW || process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const out = process.env.PKC_QA_DIR || fileURLToPath(new URL('../test-results/answer-key-checker/', import.meta.url));
fs.mkdirSync(out, { recursive: true });

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../psle-key-check-core.mjs', import.meta.url), 'utf8');
const cost = fs.readFileSync(new URL('../ai-cost-core.mjs', import.meta.url), 'utf8');
const css = [...html.slice(0, html.indexOf('</head>')).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const cut = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + from.length); assert.ok(a >= 0 && b > a, 'found ' + from.slice(0, 40)); return src.slice(a, b); };
const overlay = cut(html, '<div class="pkc-overlay" id="pkcOverlay"', '<!-- ==================== PAST PAPER — EDIT A QUESTION');
const block = cut(app, '// 🔍 PSLE ANSWER KEY CHECKER', '// End PSLE answer key checker');
// 🔑 The app's OWN keyword walker and word list (v1.465.0), cut from app.js like
// the checker block, so the strip is tested against the code the exported
// answer key really prints from, never against a stand-in.
const kwBlock = cut(app, 'const KW_WORD_RE = ', '// ---- rendering: the blanks a student fills in');
const priceOverlay = '<div class="tl-overlay aip-overlay" id="aiPriceOverlay"></div>';
const shell = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css
  + '</style></head><body>' + overlay + priceOverlay + '<div id="toasts"></div></body></html>';

// The fake world, as source so it runs in the page.
const world = String.raw`
const clone = v => JSON.parse(JSON.stringify(v));
const S = { saves: [], qsaves: [], history: [], toasts: [], aiCalls: 0, aiReply: null, paperSaves: 0 };
window.S = S;
var currentUser = { uid: 'admin1', email: 'teacher@example.com', role: 'admin' };
var db = {};
var RLF_HISTORY_COL = 'questionRepairs';
var AI_MODEL = 'gemini-4-hydrogen';
var _ppDataLoaded = true, _ppMapLoaded = true;
var _ppTopicOrder = ['Heat', 'Light'];
var _ppPePrevCache = {};
var PP_ANSWER_KEYS = { '2023': { 1: 2, 2: 3, 3: 4 } };
var PP_OEQ_KEYS = { '2023': { '31': '(a) The metal expands when heated. (b) Heat flows from the hot water to the cold ring.' } };
var PP_OEQ_OCR_YEARS = new Set(['2014']);
var PP_SKILL = { recall: 'Recall', apply: 'Application', open: 'Open-ended' };
const mcq = (id, topic, correct, opts) => ({ id, qno: Number(id.replace(/\D/g, '')) || 1, title: 'Bank ' + id, topic, blocks: [
  { id: id + '_t', type: 'text', content: '<p>Which material is the best conductor of heat? ' + id + '</p>' },
  { id: id + '_i', type: 'image', url: 'https://img.test/' + id + '.png' },
  { id: id + '_m', type: 'mcq', marks: 2, correctId: correct, options: (opts || ['Wood', 'Metal', 'Plastic', 'Glass']).map((t, i) => ({ id: id + '_o' + (i + 1), text: t })) },
  { id: id + '_e', type: 'explanation', content: 'Metal conducts heat well.' } ] });
var questionBank = [
  mcq('b1', 'Heat', 'b1_o2'),          // 2023 Q1: official 2, paper says 2, bank 2 → green
  mcq('b2', 'Heat', 'b2_o1'),          // 2023 Q2: official 3, bank ticks 1 → red
  mcq('b3', 'Light', 'b3_o4'),         // 2023 Q3: paper answer says 2 → red (paper vs official)
  { id: 'b31', qno: 31, title: 'Ring and ball', topic: 'Heat', blocks: [
    { id: 'b31_t', type: 'text', content: '<p>Study the ring and ball.</p>' },
    { id: 'b31_pa', type: 'text', part: 'a', content: '<p>(a) Why does the ball not pass?</p>' },
    { id: 'b31_aa', type: 'plainanswer', part: 'a', marks: 1, content: 'The ball expands.' },
    { id: 'b31_pb', type: 'text', part: 'b', content: '<p>(b) Explain.</p>' },
    { id: 'b31_ab', type: 'plainanswer', part: 'b', marks: 1, content: '' } ],
    answerKeywords: { b31_aa: { 2: true } } },      // "expands" is the keyword the teacher marked
];
var ppData = { questions: [
  { id: 's_2023_1', year: '2023', n: 1, bk: 'A', marks: 2, topic: 'Heat', type: 'recall', title: 'Conductors', ans: 'Option 2 — metal' },
  { id: 's_2023_2', year: '2023', n: 2, bk: 'A', marks: 2, topic: 'Heat', type: 'recall', title: 'Insulators', ans: 'Option 3 — plastic' },
  { id: 's_2023_3', year: '2023', n: 3, bk: 'A', marks: 2, topic: 'Light', type: 'apply', title: 'Shadows', ans: 'Option 2' },
  { id: 's_2023_31', year: '2023', n: 31, bk: 'B', marks: 2, topic: 'Heat', type: 'open', title: 'Ring and ball', ans: 'The ball expands' },
  { id: 's_2022_5', year: '2022', n: 5, bk: 'A', marks: 2, topic: 'Light', type: 'recall', title: 'Not attached yet', ans: 'Option 1' },
], recurring: [{ id: 'c1', concept: 'Conductors of heat', hits: ['s_2023_1', 's_2023_2'] }] };
var paperMap = { s_2023_1: 'b1', s_2023_2: 'b2', s_2023_3: 'b3', s_2023_31: 'b31' };
function ppQuestions() { return ppData.questions; }
function ppRecurring() { return ppData.recurring; }
function ppYears() { return [...new Set(ppData.questions.map(q => String(q.year)))].sort(); }
function ppFindQ(id) { return ppData.questions.find(q => q.id === id); }
function ppBankQ(id) { const b = paperMap[id]; return b ? questionBank.find(q => q.id === b) : null; }
function ppTopicOf(q) { const b = ppBankQ(q.id); return (b && b.topic) || q.topic || ''; }
function ppIsAdmin() { return true; }
function ppHoverHide() {}
function ppTopicClose() {}
function ppRenderBody() {}
async function loadPaperData() {} async function loadPaperMap() {}
async function savePaperData() { S.paperSaves++; S.saves.push(clone(ppData.questions)); }
async function saveQuestion(q) { S.qsaves.push(clone(q)); return true; }
async function setDoc(ref, data) { S.history.push({ ref, data: clone(data), afterQsaves: S.qsaves.length }); }
function doc(c) { return { c }; } function collection(...a) { return a.join('/'); }
function _bankOwnerUid() { return 'admin1'; }
function editQuestionFromPapers(bid, pid) { S.edited = [bid, pid]; }
function aiPriceDialogOpen() { S.prices = true; }
function akcStart(qs, title) { S.cross = [qs.map(q => q.id), title]; }
function showToast(m, t) { S.toasts.push([m, t]); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function stripHtml(c) { return c ? String(c).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function tlRepairClone(v) { return clone(v); }
function rlfFirestoreCopy(q) { return clone(q); }
function tlSig(q) { return JSON.stringify(q.blocks).length + ':' + (q.topic || ''); }
function tlStateOf(q) { return q.id === 'b3' ? { state: 'amber', stale: false, findings: [{ severity: 'med', title: 'Option 4 is hard to read' }] } : { state: 'idle', findings: [] }; }
function currentTopics() { return ['Heat', 'Light', 'Magnets']; }
function ppPeTopicOptions(cur) { const t = currentTopics().slice(); if (cur && t.indexOf(cur) < 0) t.unshift(cur); return t.map(x => '<option ' + (x === cur ? 'selected' : '') + '>' + escapeHtml(x) + '</option>').join(''); }
function ppPeSkillOptions(cur) { return Object.keys(PP_SKILL).map(k => '<option value="' + k + '" ' + (k === cur ? 'selected' : '') + '>' + PP_SKILL[k] + '</option>').join(''); }
function ppPeDiffOptions(cur) { return '<option value="">◻ No difficulty</option><option value="easy" ' + (cur === 'easy' ? 'selected' : '') + '>Easy</option><option value="hard">Hard</option>'; }
function qNoLabel(q) { return q && q.qno ? '#' + q.qno : ''; }
function questionStats(id) { return id === 'b1' ? { attempts: 10, correct: 7, percent: 70 } : { attempts: 0, correct: 0, percent: null }; }
function qHasParts(bl) { return bl.some(b => b.part); }
function qPartMap(bl) { const m = new Map(); bl.forEach(b => { if (b.part) m.set(b, b.part); }); return m; }
function qPartOf(m, b) { return (m && m.get(b)) || ''; }
function qPartLabel(p) { return '(' + p + ')'; }
function qMarksOf(b) { const n = parseInt(b && b.marks, 10); return n > 0 ? n : 0; }
function qMarksBracket(n) { return '[' + n + ']'; }
function cpbQuestionMarks(q) { return (q.blocks || []).reduce((s, b) => s + qMarksOf(b), 0); }
function questionHasMarkableAnswer(q) { return (q.blocks || []).some(b => ['mcq', 'plainanswer', 'answer'].includes(b.type)); }
function _cqOptText(o) { return stripHtml((o && o.text) || ''); }
function _cqImageTargets(q) { return (q.blocks || []).filter(b => b.type === 'image' && b.url).map(b => ({ id: b.id, value: b.url, label: 'Picture', kind: 'image' })); }
function _cqRepr(q) { return (q.blocks || []).map(b => stripHtml(b.content || '') || (b.options || []).map(o => o.text).join(' / ')).join('\n'); }
function mcqLabelStyle() { return 'numbers'; }
function mcqLabelOf(i) { return String(i + 1); }
function transformImageUrl(u) { return u; }
function aiGrounding() { return ''; }
async function _urlToDataUrlRobust() { return 'data:image/png;base64,iVBORw0KGgo='; }
function _parseImageDataUrl(d) { return { mime: 'image/png' }; }
function _parseAIJson(raw) { return JSON.parse(raw); }
function aiEngineOrder() { return ['gemini']; }
function getKimiModel() { return 'kimi-k3'; } function getOpenAiModel() { return 'gpt-6.1-sol'; }
const _meters = new Set();
function aiMeterOpen(fn) { const m = { fn }; _meters.add(m); return { close() { _meters.delete(m); } }; }
let _prices = null;
function aiPrices() { return _prices || (_prices = COST.mergePrices({})); }
function aiMoney(usd) { return COST.formatMoney(usd, { currency: 'USD', rate: 1 }); }
const { createTally, tallyAdd, estimateCheckCost } = COST;
async function _fakeAsk(prompt, media) {
  S.aiCalls++; S.lastPrompt = prompt; S.lastMedia = (media || []).length;
  await new Promise(r => setTimeout(r, 30));
  _meters.forEach(m => m.fn({ kind: 'text', route: 'gemini', model: 'gemini-4-hydrogen', usage: { inTok: 3000, imgInTok: 1000, outTok: 600, images: 1, reported: true }, at: Date.now() }));
  const pick = typeof S.aiReply === 'function' ? S.aiReply(prompt) : S.aiReply;
  if (typeof pick === 'string') return pick;       // a box button gets plain text back, not JSON
  return JSON.stringify(pick || { verdict: 'ok', ownAnswer: 'Option 2', summary: 'Key is right', issues: [] });
}
async function askGemini(p, o) { return _fakeAsk(p, null); }
async function askGeminiVision(p, m, o) { return _fakeAsk(p, m); }
function buildOpenBody(q, sel) { return '<div class="qp-fake">' + (q.blocks || []).map(b => b.type === 'image' ? '<img alt="figure" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="320" height="180">' : b.type === 'mcq' ? '<ol>' + b.options.map(o => '<li>' + escapeHtml(o.text) + '</li>').join('') + '</ol>' : '<p>' + stripHtml(b.content || '') + '</p>').join('') + '</div>'; }
`;

async function fixture(width, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/pkc-core.mjs')) return route.fulfill({ contentType: 'text/javascript', body: core });
    if (p.endsWith('/cost-core.mjs')) return route.fulfill({ contentType: 'text/javascript', body: cost });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell });
  });
  await page.goto('https://pkc.test/');
  await page.evaluate(async ({ world, block, kwBlock }) => {
    const PKC = await import('/pkc-core.mjs');
    const COST = await import('/cost-core.mjs');
    const names = ['pkcOpen', 'pkcClose', 'pkcSetScope', 'pkcSetFilter', 'pkcSelect', 'pkcStep', 'pkcSetP', 'pkcSetBankTopic', 'pkcSetCorrect', 'pkcSetBankText', 'pkcKwToggle', 'pkcKwClear', 'pkcAiField', 'pkcAiUndo', 'pkcApplyFix', 'pkcSave', 'pkcSaveAll', 'pkcTick', 'pkcEditInBlockEditor', 'pkcAiCheckOne', 'pkcAiCheckAll', 'pkcAiStop', 'pkcCrossCheck', '_pkcRows', '_pkcOfficial', '_pkcBankSummary'];
    const api = new Function('PKC', 'COST', world + kwBlock + block + '\nreturn {' + names.map(n => n + ':' + n).join(',') + ', get state(){ return _pkc; }, world: { ppData, questionBank, paperMap } };')(PKC, COST);
    Object.assign(window, api);
    window.api = api;
  }, { world, block, kwBlock });
  return { page, errors, close: () => context.close() };
}
const noOverflow = async (page, what) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  assert.ok(o.sw <= o.w + 1, what + ': no sideways scroll (' + o.sw + ' > ' + o.w + ')');
};
const dot = (page, id) => page.locator('#pkcRi_' + id + ' .pkc-ri-dot').innerText();

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
try {
  // ───────── desktop ─────────
  {
    const f = await fixture(1360), page = f.page;
    await page.evaluate(() => pkcOpen('all'));
    await page.waitForSelector('#pkcOverlay.show #pkcRail .pkc-ri');
    // three panes side by side: list | question | keys
    const box = await page.evaluate(() => ['pkcRail', 'pkcMain', 'pkcSide'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }));
    ok(box[0].x < box[1].x && box[1].x < box[2].x, 'rail, question and keys are left to right');
    ok(box[1].w > box[0].w && box[2].w >= 360, 'question pane is the widest, keys pane at least 360px');
    ok(box.every(b => b.h > 500), 'panes fill the height');
    // the free checks: lights on every question with no AI call
    ok((await page.evaluate(() => S.aiCalls)) === 0, 'opening costs nothing');
    ok((await dot(page, 's_2023_1')) === '🟢', 'clean question is green');
    ok((await dot(page, 's_2023_2')) === '🔴', 'bank ticking the wrong option is red');
    ok((await dot(page, 's_2023_3')) === '🔴', 'paper answer against the official key is red');
    ok((await dot(page, 's_2022_5')) === '⚪', 'not attached is grey');
    ok((await page.locator('#pkcRail .pkc-rail-y').count()) === 2, 'grouped by paper');
    // opens on the first red one
    ok((await page.locator('.pkc-ri.sel').getAttribute('id')) === 'pkcRi_s_2023_2', 'opens on the first question that needs fixing');
    // LEFT is the student view; RIGHT the keys
    ok(await page.locator('#pkcMain #pkcPrev .qp-fake img').count() === 1, 'the question preview is on the left with its picture');
    const side = await page.locator('#pkcSide').innerText();
    ok(/Official PSLE key\s*Option 3/i.test(side), 'official key shown');
    ok(/s_2023_2/.test(side) && /#2/.test(side) && /b2/.test(side), 'paper code, bank number and bank id are shown');
    ok(/Conductors of heat/.test(side), 'recurring concept shown');
    ok(/Students are marked against Option 1, the official key says Option 3/.test(side), 'the finding names both options');
    // apply the fix → draft only → save → before-copy first, then the bank save
    await page.locator('.pkc-apply', { hasText: 'Tick option 3' }).click();
    ok(await page.locator('#pkcSide input[type=radio]:checked').evaluate(el => el.closest('.pkc-opt').innerText.includes('Plastic')), 'option 3 ticked in the draft');
    ok((await page.evaluate(() => S.qsaves.length)) === 0, 'nothing saved before Save');
    ok(/●/.test(await page.locator('#pkcRi_s_2023_2').innerText()), 'rail marks the unsaved question');
    await page.locator('#pkcSaveBtn').click();
    await page.waitForFunction(() => S.qsaves.length === 1);
    const hist = await page.evaluate(() => S.history[0]);
    ok(hist && hist.afterQsaves === 0 && hist.data.before.blocks.find(b => b.type === 'mcq').correctId === 'b2_o1', 'before-copy filed first, holding the old tick');
    ok((await page.evaluate(() => S.qsaves[0].blocks.find(b => b.type === 'mcq').correctId)) === 'b2_o3', 'bank saved with option 3');
    ok((await page.evaluate(() => api.world.questionBank[1].blocks.find(b => b.type === 'mcq').correctId)) === 'b2_o3', 'in-memory bank replaced');
    ok((await dot(page, 's_2023_2')) === '🟢', 'light goes green after the fix');
    await page.screenshot({ path: out + 'desktop-fixed.png' });

    // paper answer edit for Q3 via the fix, then tick off & next
    await page.locator('#pkcRi_s_2023_3').click();
    ok(/Traffic light/i.test(await page.locator('#pkcVerdict').innerText()), 'standing traffic-light finding is shown');
    await page.locator('.pkc-apply', { hasText: 'Record Option 4' }).click();
    ok((await page.locator('#pkcSide textarea').first().inputValue()) === 'Option 4', 'paper answer restamped in the box');
    await page.locator('button', { hasText: 'Looks right — tick off & next' }).click();
    await page.waitForFunction(() => api.world.ppData.questions[2].keyChecked);
    ok((await page.evaluate(() => api.world.ppData.questions[2].ans)) === 'Option 4', 'paper answer saved');
    ok(/✓/.test(await page.locator('#pkcRi_s_2023_3').innerText()), 'ticked off in the rail');
    ok((await page.locator('.pkc-ri.sel').getAttribute('id')) !== 'pkcRi_s_2023_3', 'moved on to the next question');

    // typing in a box updates the light, never loses the caret
    await page.locator('#pkcRi_s_2023_1').click();
    const ta = page.locator('#pkcSide textarea').first();
    await ta.fill('Option 1 — wood');
    ok((await dot(page, 's_2023_1')) === '🔴', 'typing a wrong option turns it red live');
    ok(await ta.evaluate(el => el === document.activeElement), 'the box keeps focus while typing');
    await ta.fill('Option 2 — metal');
    ok((await dot(page, 's_2023_1')) === '🟢', 'and green again');

    // 🔁 the app's own two-engine cross-check, on this one bank question
    await page.locator('button', { hasText: 'Two-engine cross-check' }).click();
    ok(JSON.stringify(await page.evaluate(() => S.cross)) === '[["b1"],"PSLE 2023 Q1 — two-engine cross-check"]', 'two-engine cross-check reused for this question');
    // 🤖 one AI check: metered, cost shown, verdict + a fix it may apply
    await page.evaluate(() => { S.aiReply = { verdict: 'wrong', ownAnswer: 'Option 3', summary: 'Plastic is an insulator; the key should be metal', issues: [{ area: 'Topic', severity: 'low', title: 'Better under Heat', fix: { kind: 'topic', value: 'Heat' } }, { area: 'Answer key', severity: 'high', title: 'Wrong option', detail: 'd', fix: { kind: 'bankOption', option: 3 } }] }; });
    await page.locator('.pkc-ai-one').click();
    await page.waitForFunction(() => document.querySelector('#pkcVerdict .pkc-pill.bad'));
    ok((await page.evaluate(() => S.lastMedia)) === 1, 'the picture went with the question');
    ok(/OFFICIAL PSLE answer key says Option 2/.test(await page.evaluate(() => S.lastPrompt)), 'the official key is in the prompt');
    ok(/\$0\.\d+ · 1 call/.test(await page.locator('.pkc-cost').innerText()), 'the meter shows the cost of the call');
    ok((await dot(page, 's_2023_1')) === '🔴', 'an AI "wrong" turns the light red');
    ok(/The AI's own answer: Option 3/.test(await page.locator('#pkcVerdict').innerText()), 'the AI\'s own answer is shown');
    // editing after the check makes it stale
    await page.locator('#pkcSide textarea').first().fill('Option 2 — metal (checked)');
    ok(/changed since/.test(await page.locator('#pkcVerdict').innerText()), 'an edit after the check marks it stale');

    // 🤖 batch: asks first, checks every question without a fresh verdict, flags
    await page.evaluate(() => { S.aiReply = p => /Ring and ball/.test(p) ? { verdict: 'check', summary: 'Part (b) has no model answer', issues: [{ area: 'Answer key', severity: 'high', title: 'Part (b) blank', fix: { kind: 'bankAnswer', part: 'b', text: 'Heat flows from the hot water to the ring, so the ring expands.' } }] } : { verdict: 'ok', summary: 'fine', issues: [] }; });
    const before = await page.evaluate(() => S.aiCalls);
    await page.locator('.pkc-ai-all').click();
    await page.waitForFunction(() => !api.state.running && S.aiCalls > 1);
    const after = await page.evaluate(() => S.aiCalls);
    ok(after - before === 4, 'batch checked the 4 attached questions without a fresh verdict (got ' + (after - before) + ')');
    ok(/4 calls|5 calls/.test(await page.locator('.pkc-cost').innerText()), 'meter counted the batch');
    ok((await page.locator('.pkc-filter.on').innerText()).includes('Needs a look'), 'flags found → list narrows to what needs a look');
    // OEQ: official marking scheme, per-part model answers, apply the AI's text
    await page.locator('#pkcRi_s_2023_31').click();
    ok(/Official marking scheme/i.test(await page.locator('#pkcSide').innerText()), 'open-ended official answer shown');
    ok((await page.locator('#pkcSide .pkc-part').count()) >= 2, 'model answers labelled by part');
    await page.locator('.pkc-apply', { hasText: 'model answer for (b)' }).click();
    ok(/Heat flows from the hot water/.test(await page.locator('#pkcSide textarea').nth(2).inputValue()), 'part (b) filled in the draft');
    await page.locator('#pkcSaveBtn').click();
    await page.waitForFunction(() => S.qsaves.some(q => q.id === 'b31'));
    ok((await page.evaluate(() => S.qsaves.find(q => q.id === 'b31').blocks.find(b => b.id === 'b31_ab').content)).startsWith('Heat flows'), 'part (b) saved');

    // ───────── 🔑 keywords, as the exported answer key prints them ─────────
    {
      const kwA = page.locator('#pkcKw_b31_aa_content'), kwB = page.locator('#pkcKw_b31_ab_content');
      const onWords = loc => loc.locator('.pkc-kw-w.on').evaluateAll(els => els.map(e => e.textContent));
      ok(JSON.stringify(await onWords(kwA)) === '["expands"]', 'the marked keyword is shown under its model answer');
      const look = await kwA.locator('.pkc-kw-w.on').first().evaluate(el => { const c = getComputedStyle(el); return { w: Number(c.fontWeight), u: c.textDecorationLine }; });
      ok(look.w >= 700 && /underline/.test(look.u), 'bold and underlined, like the exported answer key (' + JSON.stringify(look) + ')');
      const plain = await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).evaluate(el => { const c = getComputedStyle(el); return { w: Number(c.fontWeight), u: c.textDecorationLine }; });
      ok(plain.w < 600 && !/underline/.test(plain.u), 'a word that is not a keyword stays plain');
      ok(/1 marked: expands/.test(await kwA.locator('.pkc-kw-h').innerText()), 'the heading names the keyword');
      ok(/1 keyword marked/.test(await page.locator('#pkcKwTotal').innerText()), 'the question\'s keyword count is shown');
      // the key bolds a keyword wherever it appears: part (b) says "expands" too
      ok(JSON.stringify(await kwB.locator('.pkc-kw-w.echo').evaluateAll(els => els.map(e => e.textContent))) === '["expands"]', 'the same word prints bold in the other part, as on the key');
      ok((await onWords(kwB)).length === 0, 'but it is not marked there');
      ok(await page.locator('.pkc-kw').count() === 2, 'one keyword strip per model answer box, none on the paper answer');
      // click = mark, in the draft only
      const savesBefore = await page.evaluate(() => S.qsaves.length);
      await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).click();
      ok(JSON.stringify(await onWords(kwA)) === '["ball","expands"]', 'clicking a word makes it a keyword');
      ok(/2 marked: ball, expands/.test(await kwA.locator('.pkc-kw-h').innerText()), 'heading follows');
      ok(/2 keywords marked/.test(await page.locator('#pkcKwTotal').innerText()), 'count follows');
      ok((await page.evaluate(() => S.qsaves.length)) === savesBefore, 'nothing is saved by a click');
      ok(/●/.test(await page.locator('#pkcRi_s_2023_31').innerText()), 'the rail marks the question unsaved');
      ok(!(await page.locator('#pkcSaveBtn').isDisabled()), 'Save is offered');
      ok(await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).evaluate(el => el === document.activeElement), 'the clicked word keeps the focus');
      // click again = unmark; Clear = none
      await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).click();
      ok(JSON.stringify(await onWords(kwA)) === '["expands"]', 'clicking it again unmarks it');
      await kwA.locator('.pkc-kw-clear').click();
      ok((await onWords(kwA)).length === 0 && /None marked yet/.test(await kwA.locator('.pkc-kw-h').innerText()), 'Clear unmarks every keyword in that answer');
      ok((await kwB.locator('.pkc-kw-w.echo').count()) === 0, 'and the word stops printing bold in the other part');
      await kwA.locator('.pkc-kw-w', { hasText: 'expands' }).click();
      await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).click();
      // retyping the answer carries the marks to where the words went
      const taA = page.locator('#pkcBox_b31_aa_content');
      await taA.fill('The heated metal ball expands.');
      ok(JSON.stringify(await onWords(kwA)) === '["ball","expands"]', 'two words typed in front: the SAME words stay marked');
      ok(await taA.evaluate(el => el === document.activeElement), 'and the box keeps the caret');
      await taA.fill('The heated metal ball expands a lot.');
      ok(JSON.stringify(await onWords(kwA)) === '["ball","expands"]', 'words typed after: still the same');
      await taA.fill('The heated metal expands a lot.');
      ok(JSON.stringify(await onWords(kwA)) === '["expands"]', 'a deleted keyword loses its mark and no neighbour inherits it');
      await taA.fill('The heated metal ball expands.');
      await kwA.locator('.pkc-kw-w', { hasText: 'ball' }).click();
      // save: before-copy first, then the bank question with its keywords
      const nSaves = await page.evaluate(() => S.qsaves.length), nHist = await page.evaluate(() => S.history.length);
      await page.locator('#pkcSaveBtn').click();
      await page.waitForFunction(n => S.qsaves.length === n + 1, nSaves);
      const saved = await page.evaluate(() => S.qsaves[S.qsaves.length - 1]);
      ok(saved.id === 'b31' && JSON.stringify(saved.answerKeywords) === '{"b31_aa":{"3":true,"4":true}}', 'saved with the keywords at their new positions: ' + JSON.stringify(saved.answerKeywords));
      const h = await page.evaluate(n => S.history[n], nHist);
      ok(h && h.afterQsaves === nSaves && JSON.stringify(h.data.before.answerKeywords) === '{"b31_aa":{"2":true}}', 'the before-copy holds the keywords as they were');
      ok(JSON.stringify(await onWords(page.locator('#pkcKw_b31_aa_content'))) === '["ball","expands"]', 'still shown after the save');
      await page.screenshot({ path: out + 'desktop-keywords.png' });
    }

    // ───────── 🤖 ✂️ ✍️ on every answer box ─────────
    {
      const boxes = await page.locator('#pkcSide .pkc-card').first().locator('textarea').count();
      ok(boxes === 3 && (await page.locator('.pkc-aibar').count()) === boxes, 'every answer box has its own AI buttons');
      ok(JSON.stringify(await page.locator('#pkcAiBar_b31_ab_content .pkc-ai-btn').evaluateAll(els => els.map(e => e.dataset.mode))) === '["answer","shorten","complete"]', 'Answer, Shorten and Complete');
      const calls = () => page.evaluate(() => S.aiCalls);
      const taB = page.locator('#pkcBox_b31_ab_content'), barB = page.locator('#pkcAiBar_b31_ab_content');
      const was = await taB.inputValue();
      // 🤖 Answer: writes THAT part, from the question and the official key
      await page.evaluate(() => { S.aiReply = p => /WRITE: the model answer for part \(b\) ONLY/.test(p) ? '**Answer:** "The ring gains heat from the hot water and expands."' : 'WRONG BOX'; });
      let n = await calls();
      await barB.locator('.pkc-ai-answer').click();
      await page.waitForFunction(() => document.getElementById('pkcBox_b31_ab_content').value.startsWith('The ring gains heat'));
      ok((await taB.inputValue()) === 'The ring gains heat from the hot water and expands.', 'the reply is cleaned of its label, bold and quotes and put in the box');
      ok((await calls()) === n + 1, 'one AI call');
      const prompt = await page.evaluate(() => S.lastPrompt);
      ok(/OFFICIAL answer from the marking scheme/.test(prompt) && /Heat flows from the hot water to the cold ring/.test(prompt), 'the official marking scheme went with it');
      ok(/KEYWORDS[^\n]*"ball"[^\n]*"expands"|KEYWORDS[^\n]*"expands"[^\n]*"ball"/.test(prompt), 'so did the teacher\'s keywords');
      ok(/\(a\) Model answer: The heated metal ball expands\./.test(prompt), 'and what the other boxes already say');
      ok(/It is worth 1 mark/.test(prompt) && /\(b\) Explain\./.test(prompt), 'and the marks and the question');
      ok(/●/.test(await page.locator('#pkcRi_s_2023_31').innerText()) && !(await page.locator('#pkcSaveBtn').isDisabled()), 'it is a draft edit: unsaved until Save');
      ok(JSON.stringify(await page.locator('#pkcKw_b31_ab_content .pkc-kw-w.echo').evaluateAll(els => els.map(e => e.textContent))) === '["expands"]', 'the keyword strip follows the new wording');
      // ↩ Undo: one step back
      ok(await barB.locator('.pkc-ai-undo').count() === 1, 'Undo appears on the box the AI changed');
      await barB.locator('.pkc-ai-undo').click();
      ok((await taB.inputValue()) === was, 'Undo puts back what was there');
      ok(await barB.locator('.pkc-ai-undo').count() === 0, 'and goes away');
      // ✂️ Shorten: shorter, same keywords
      await page.evaluate(() => { S.aiReply = () => 'Heat flows from the hot water, so the ring expands.'; });
      await barB.locator('.pkc-ai-shorten').click();
      await page.waitForFunction(() => document.getElementById('pkcBox_b31_ab_content').value === 'Heat flows from the hot water, so the ring expands.');
      ok(/SHORTEN the text/.test(await page.evaluate(() => S.lastPrompt)) && (await page.evaluate(() => S.lastMedia)) === 0, 'Shorten sends the text, not the pictures');
      ok(/Shortened ✂️ 13 → 10 words/.test(JSON.stringify(await page.evaluate(() => S.toasts.slice(-1)))), 'and says by how much');
      // too short to shorten: no call at all
      n = await calls();
      await barB.locator('.pkc-ai-shorten').click();
      ok((await calls()) === n && /already short/.test(JSON.stringify(await page.evaluate(() => S.toasts.slice(-1)))), 'a short answer is not sent to be shortened');
      // a shorter text that lost a keyword is refused
      await taB.fill('Heat flows from the hot water to the cold metal ring, and so the metal ring expands and gets bigger.');
      await page.evaluate(() => { S.aiReply = () => 'Heat flows from the hot water to the ring, so it gets bigger.'; });
      n = await calls();
      await barB.locator('.pkc-ai-shorten').click();
      await page.waitForFunction(k => S.aiCalls === k + 1 && !document.querySelector('#pkcAiBar_b31_ab_content .pkc-ai-btn:disabled'), n);
      ok((await taB.inputValue()).endsWith('expands and gets bigger.'), 'a shortening that dropped a keyword is not used');
      ok(/dropped the keyword expands/.test(JSON.stringify(await page.evaluate(() => S.toasts.slice(-1)))), 'and the teacher is told which one');
      // ✍️ Complete: adds, never rewrites — on the paper's own answer box
      const taP = page.locator('#pkcBox_paper_ans'), barP = page.locator('#pkcAiBar_paper_ans');
      await taP.fill('(a) The ball gains heat and');
      await page.evaluate(() => { S.aiReply = p => /CARRY ON WRITING/.test(p) ? '(a) The ball gains heat and expands, so it cannot pass through the ring.' : 'WRONG'; });
      await barP.locator('.pkc-ai-complete').click();
      await page.waitForFunction(() => /cannot pass through the ring\.$/.test(document.getElementById('pkcBox_paper_ans').value));
      ok((await taP.inputValue()) === '(a) The ball gains heat and expands, so it cannot pass through the ring.', 'the echoed opening is taken off and only the rest is added');
      ok((await page.evaluate(() => api.state.drafts['s_2023_31'].paper.ans)).endsWith('through the ring.'), 'the paper draft took it');
      // an empty box cannot be completed, and says to use Answer
      await taP.fill('');
      n = await calls();
      await barP.locator('.pkc-ai-complete').click();
      ok((await calls()) === n && /Answer writes it from nothing/.test(JSON.stringify(await page.evaluate(() => S.toasts.slice(-1)))), 'Complete on an empty box makes no call');
      // 🤖 Answer on the paper box of an open-ended question
      await page.evaluate(() => { S.aiReply = p => /answer recorded on the paper for this open-ended question/.test(p) ? '(a) The ball expands.\n(b) Heat flows from the hot water to the ring.' : 'WRONG'; });
      await barP.locator('.pkc-ai-answer').click();
      await page.waitForFunction(() => document.getElementById('pkcBox_paper_ans').value.includes('(b) Heat flows'));
      ok((await taP.inputValue()) === '(a) The ball expands.\n(b) Heat flows from the hot water to the ring.', 'the paper answer is written part by part');
      // the buttons are disabled while their box is being written
      await page.evaluate(() => { S.aiReply = () => 'Heat flows from the hot water to the ring, so the ring expands.'; });
      const pending = page.evaluate(() => pkcAiField('s_2023_31', 'b31_ab|content', 'answer'));
      await page.waitForSelector('#pkcAiBar_b31_ab_content .pkc-ai-answer:disabled');
      ok((await barB.locator('.pkc-ai-btn:disabled').count()) >= 3 && /…/.test(await barB.locator('.pkc-ai-answer').innerText()), 'a busy box disables its buttons and shows which one is working');
      ok((await barP.locator('.pkc-ai-btn:disabled').count()) === 0, 'the other boxes stay usable');
      await pending;
      ok((await taB.inputValue()) === 'Heat flows from the hot water to the ring, so the ring expands.', 'and the answer lands');
      ok(/\d+ calls/.test(await page.locator('.pkc-cost').innerText()), 'every box call is on the meter');
      // a failed call changes nothing
      await page.evaluate(() => { S.aiReply = () => '   '; });
      await barB.locator('.pkc-ai-answer').click();
      await page.waitForFunction(() => /returned nothing/.test(JSON.stringify(S.toasts.slice(-1))));
      ok((await taB.inputValue()) === 'Heat flows from the hot water to the ring, so the ring expands.', 'an empty reply leaves the box alone');
      // save it all: paper and bank
      await page.locator('#pkcSaveBtn').click();
      await page.waitForFunction(() => !document.getElementById('pkcSaveBtn') || document.getElementById('pkcSaveBtn').disabled);
      const last = await page.evaluate(() => S.qsaves[S.qsaves.length - 1]);
      ok(last.id === 'b31' && last.blocks.find(b => b.id === 'b31_ab').content.startsWith('Heat flows from the hot water to the ring') && JSON.stringify(last.answerKeywords) === '{"b31_aa":{"3":true,"4":true}}', 'the AI\'s text is saved like any other edit and the keywords are untouched');
      ok((await page.evaluate(() => api.world.ppData.questions[3].ans)).startsWith('(a) The ball expands.'), 'the paper answer too');
      // an MCQ: the paper box is told the official option, the explanation box explains
      await page.evaluate(() => pkcSetFilter('all'));
      await page.locator('#pkcRi_s_2023_1').click();
      ok(await page.locator('#pkcAiBar_b1_e_content .pkc-ai-btn').count() >= 3 && await page.locator('#pkcAiBar_paper_ans .pkc-ai-btn').count() >= 3, 'the explanation and the paper answer of an MCQ have the buttons too');
      ok(await page.locator('.pkc-kw').count() === 0, 'an MCQ has no keyword strip');
      await page.evaluate(() => { S.aiReply = p => /N MUST be 2/.test(p) ? 'Option 2 — metal is a good conductor of heat.' : 'WRONG'; });
      await page.locator('#pkcAiBar_paper_ans .pkc-ai-answer').click();
      await page.waitForFunction(() => document.getElementById('pkcBox_paper_ans').value.startsWith('Option 2 — metal is a good'));
      ok((await page.evaluate(() => S.lastMedia)) === 1, 'Answer sends the question\'s picture');
      await page.evaluate(() => { S.aiReply = p => /WRITE: the explanation a student reads/.test(p) ? 'Metal is a good conductor of heat, so heat travels through it fastest.' : 'WRONG'; });
      await page.locator('#pkcAiBar_b1_e_content .pkc-ai-answer').click();
      await page.waitForFunction(() => document.getElementById('pkcBox_b1_e_content').value.startsWith('Metal is a good conductor'));
      ok(true, 'the explanation box is written as an explanation');
      await page.locator('#pkcSaveBtn').click();
      await page.waitForFunction(() => S.qsaves.some(q => q.id === 'b1' && /travels through it fastest/.test(q.blocks.find(b => b.type === 'explanation').content)));
      await page.evaluate(() => { S.aiReply = null; });
      await page.screenshot({ path: out + 'desktop-ai-buttons.png' });
    }

    // the topic view: scope by topic
    await page.selectOption('.pkc-scope', { label: 'Light' });
    await page.evaluate(() => pkcSetFilter('all'));
    const lightIds = await page.locator('#pkcRail .pkc-ri').evaluateAll(els => els.map(e => e.id));
    ok(lightIds.length === 2 && lightIds.includes('pkcRi_s_2023_3') && lightIds.includes('pkcRi_s_2022_5'), 'topic scope lists exactly the topic\'s questions');
    // edit the bank topic from the topic view
    await page.locator('#pkcRi_s_2023_3').click();
    await page.locator('#pkcSide select').filter({ has: page.locator('option', { hasText: '— no topic —' }) }).nth(1).selectOption('Heat');
    await page.locator('#pkcSaveBtn').click();
    await page.waitForFunction(() => S.qsaves.some(q => q.id === 'b3' && q.topic === 'Heat'));
    ok(true, 'bank topic edited from the topic view');

    // keyboard: → moves, but never while typing
    await page.evaluate(() => pkcSetScope('all'));
    const first = await page.locator('.pkc-ri.sel').getAttribute('id');
    await page.locator('#pkcMain').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    ok((await page.locator('.pkc-ri.sel').getAttribute('id')) !== first, '→ goes to the next question');
    await page.locator('#pkcSide textarea').first().focus();
    const sel2 = await page.locator('.pkc-ri.sel').getAttribute('id');
    await page.keyboard.press('ArrowRight');
    ok((await page.locator('.pkc-ri.sel').getAttribute('id')) === sel2, '→ inside a box moves the caret, not the question');

    // block editor round trip, and close
    await page.locator('#pkcRi_s_2023_1').click();
    await page.locator('button', { hasText: 'Edit the question itself' }).click();
    ok(JSON.stringify(await page.evaluate(() => S.edited)) === '["b1","s_2023_1"]', 'opens the bank question in the block editor');
    ok(!(await page.locator('#pkcOverlay.show').count()), 'checker closes for the editor');
    ok(!f.errors.length, 'no page errors: ' + f.errors.join(' | '));
    await f.close();
  }
  // ───────── tablet and phone ─────────
  for (const [w, h, tag] of [[1024, 800, 'tablet'], [390, 844, 'phone']]) {
    const f = await fixture(w, h), page = f.page;
    await page.evaluate(() => pkcOpen('year', '2023'));
    await page.waitForSelector('#pkcOverlay.show #pkcRail .pkc-ri');
    await noOverflow(page, tag);
    const inner = await page.evaluate(() => { const b = document.querySelector('.pkc-body'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
    ok(inner.sw <= inner.cw + 1, tag + ': the checker itself never scrolls sideways');
    if (tag === 'phone') {
      const r = await page.evaluate(() => ['pkcRail', 'pkcMain', 'pkcSide'].map(id => document.getElementById(id).getBoundingClientRect().y));
      ok(r[0] < r[1] && r[1] < r[2], 'phone: list, then question, then keys, top to bottom');
    }
    await page.locator('#pkcRi_s_2023_3').click();
    await page.screenshot({ path: out + tag + '.png', fullPage: false });
    // 🔑 keywords and the AI buttons fit a narrow screen too
    await page.locator('#pkcRi_s_2023_31').click();
    await page.waitForSelector('#pkcKw_b31_aa_content .pkc-kw-w.on');
    await noOverflow(page, tag + ' with keywords');
    const fit = await page.evaluate(() => { const s = document.getElementById('pkcSide').getBoundingClientRect(); return [...document.querySelectorAll('.pkc-aibar, .pkc-kw')].every(el => { const r = el.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }); });
    ok(fit, tag + ': the keyword strips and AI buttons stay inside the keys pane');
    await page.locator('#pkcKw_b31_aa_content').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + tag + '-keywords.png', fullPage: false });
    ok(!f.errors.length, tag + ': no page errors: ' + f.errors.join(' | '));
    await f.close();
  }
  console.log(`answer key checker browser: ${passed} checks passed`);
} finally {
  await browser.close();
}
