// 💲 AI cost core + the meter hooks in every AI route.
// Run with:  node tools/ai-cost-tests.mjs
//
// The 🚨 Red light fixer shows a running total that a teacher stops a run
// by, so every way that total can lie is pinned here:
//  • a model priced at the wrong row (a dated snapshot, a fallback route),
//  • an unknown model priced at zero instead of its family's rate,
//  • reasoning tokens dropped, so a thinking model looks cheap,
//  • an estimate presented as if it were measured,
//  • a route added later that never reports to the meter at all,
//  • a meter hook that can throw into the very call it is watching.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../ai-cost-core.mjs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('every model the app calls has a published price row', () => {
  for (const id of ['gpt-6.1-sol', 'gpt-6-luna', 'gemini-3.8-flash', 'kimi-k3', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
    const p = core.priceFor(id, '');
    assert.ok(p.row && p.row.out > 0, id + ' has a price');
  }
  assert.equal(core.priceFor('gpt-6.1-sol').row.in, 2);
  assert.equal(core.priceFor('gpt-6.1-sol').row.out, 10);
  assert.equal(core.priceFor('gpt-6-luna').row.in, 0.1);
  assert.equal(core.priceFor('gemini-3.8-flash').row.out, 3.75);
  assert.equal(core.priceFor('kimi-k3').row.out, 15);
});

test('a dated snapshot or variant is priced as its family', () => {
  assert.equal(core.priceKeyFor('gpt-6.1-sol-2026-09-01').key, 'gpt-6.1-sol');
  assert.equal(core.priceKeyFor('gpt-image-2.5-sunburst-2026-09-08').key, 'gpt-image-2.5');
  assert.equal(core.priceKeyFor('gemini-3.1-flash-image-preview').key, 'gemini-image');
  assert.equal(core.priceKeyFor('kimi-k3-turbo').key, 'kimi-k3');
});

test('an unknown model is never free: it takes its route family and is flagged assumed', () => {
  const p = core.priceFor('gpt-9-nova', 'openai');
  assert.equal(p.key, 'gpt-6.1-sol');
  assert.equal(p.assumed, true);
  const g = core.priceFor('gemini-9-pro', 'gemini');
  assert.equal(g.key, 'gemini-3.8-flash');
  assert.equal(g.assumed, true);
  const c = core.costOf({ kind: 'text', route: 'kimi', model: 'kimi-k9', usage: { inTok: 1e6, outTok: 0, reported: true } });
  assert.ok(c.usd > 0, 'an unknown Kimi model still costs Kimi money');
});

test('chat-completions usage is read as reported, reasoning included', () => {
  const u = core.normalizeUsage('openai', { prompt_tokens: 1000, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: 400 } });
  assert.deepEqual(u, { inTok: 1000, imgInTok: 0, outTok: 600, images: 0, reported: true });
  const c = core.costOf({ kind: 'text', route: 'openaiKey', model: 'gpt-6.1-sol', usage: u });
  near(c.usd, 1000 * 2 / 1e6 + 600 * 10 / 1e6, 'sol cost');
  assert.equal(c.estimated, false);
});

test('Gemini thinking tokens are billed as output', () => {
  const u = core.normalizeUsage('gemini', { promptTokenCount: 2000, candidatesTokenCount: 300, thoughtsTokenCount: 700 });
  assert.equal(u.outTok, 1000);
  const c = core.costOf({ kind: 'text', route: 'gemini', model: 'gemini-3.8-flash', usage: u });
  near(c.usd, 2000 * 0.75 / 1e6 + 1000 * 3.75 / 1e6, 'flash cost');
});

test('image usage prices text, image input and output separately; no usage falls back per picture', () => {
  const u = core.normalizeUsage('openaiImage', { input_tokens: 600, output_tokens: 1760, input_tokens_details: { text_tokens: 100, image_tokens: 500 } });
  assert.deepEqual(u, { inTok: 100, imgInTok: 500, outTok: 1760, images: 1, reported: true });
  const c = core.costOf({ kind: 'image', route: 'imgServer', model: 'gpt-image-2.5-flare', usage: u });
  near(c.usd, 100 * 6.25 / 1e6 + 500 * 10 / 1e6 + 1760 * 37.5 / 1e6, 'image cost');
  const fallback = core.costOf({ kind: 'image', route: 'imgKey', model: 'gpt-image-2.5-flare', usage: { images: 1, reported: false } });
  near(fallback.usd, 0.067, 'per picture');
  assert.equal(fallback.estimated, true);
});

test('missing or empty usage is null, so the caller estimates instead of billing zero', () => {
  assert.equal(core.normalizeUsage('openai', null), null);
  assert.equal(core.normalizeUsage('openai', {}), null);
  assert.equal(core.normalizeUsage('gemini', { promptTokenCount: 0 }), null);
});

test('an estimate counts characters, pictures and thinking, and says it is an estimate', () => {
  const plain = core.estimateUsage({ promptChars: 4000, images: 2, outChars: 800 });
  assert.equal(plain.inTok, 1000 + 2 * core.EST_TOKENS_PER_IMAGE);
  assert.equal(plain.outTok, 200);
  assert.equal(plain.reported, false);
  const thinking = core.estimateUsage({ promptChars: 4000, outChars: 800, reasoning: true });
  assert.ok(thinking.outTok > plain.outTok, 'a reasoning model is estimated dearer');
  const c = core.costOf({ kind: 'text', route: 'openai', model: 'gpt-6.1-sol', usage: thinking });
  assert.equal(c.estimated, true);
});

test('overrides change only real numbers, field by field', () => {
  const p = core.mergePrices({ 'gpt-6.1-sol': { in: 1.5, out: 'abc' }, 'kimi-k3': { out: -2 }, nonsense: { in: 1 } });
  assert.equal(p['gpt-6.1-sol'].in, 1.5);
  assert.equal(p['gpt-6.1-sol'].out, 10, 'a typo does not become NaN');
  assert.equal(p['gpt-6.1-sol'].edited, true);
  assert.equal(p['kimi-k3'].out, 15, 'a negative price is ignored');
  assert.equal(p.nonsense, undefined);
  assert.equal(core.AI_DEFAULT_PRICES['gpt-6.1-sol'].in, 2, 'the defaults are never mutated');
});

test('a tally adds by model and by phase and counts estimates', () => {
  const t = core.createTally();
  core.tallyAdd(t, { kind: 'text', route: 'openai', model: 'gpt-6.1-sol', usage: core.estimateUsage({ promptChars: 4000, outChars: 400 }) }, null, 'check');
  core.tallyAdd(t, { kind: 'text', route: 'gemini', model: 'gemini-3.8-flash', usage: { inTok: 1000, outTok: 100, reported: true } }, null, 'check');
  core.tallyAdd(t, { kind: 'image', route: 'imgServer', model: 'gpt-image-2.5-flare', usage: { images: 1, reported: false } }, null, 'fix round 1');
  assert.equal(t.calls, 3);
  assert.equal(t.estimatedCalls, 2);
  assert.equal(t.images, 1);
  assert.equal(Object.keys(t.byModel).length, 3);
  assert.equal(t.byPhase.check.calls, 2);
  near(t.usd, Object.values(t.byModel).reduce((a, m) => a + m.usd, 0), 'models add up to the total');
  near(t.usd, Object.values(t.byPhase).reduce((a, m) => a + m.usd, 0), 'phases add up to the total');
});

test('money keeps enough places to move with each call, in either currency', () => {
  assert.equal(core.formatMoney(0), '$0.00');
  assert.equal(core.formatMoney(0.0123), '$0.0123');
  assert.equal(core.formatMoney(1.23456), '$1.235');
  assert.equal(core.formatMoney(12.345), '$12.35');
  assert.equal(core.formatMoney(1, { currency: 'SGD', rate: 1.35 }), 'S$1.350');
});

test('a check estimate uses measured history when there is some', () => {
  assert.equal(core.estimateCheckCost(100, 0.01, 'gpt-6.1-sol', 'openai'), 1);
  const first = core.estimateCheckCost(100, 0, 'gpt-6.1-sol', 'openai');
  assert.ok(first > 0.5 && first < 10, 'a first estimate is in a sensible range: ' + first);
  assert.equal(core.estimateCheckCost(0, 0.01, 'gpt-6.1-sol', 'openai'), 0);
});

// ── The hooks in app.js ─────────────────────────────────────────────────────
function fnBody(name) {
  const re = new RegExp('(?:async )?function ' + name + '\\(');
  const m = re.exec(src);
  assert.ok(m, name + ' exists');
  const next = src.indexOf('\nfunction ', m.index + 10);
  const nextAsync = src.indexOf('\nasync function ', m.index + 10);
  const end = Math.min(...[next, nextAsync].filter(i => i > 0));
  return src.slice(m.index, end);
}
test('CENSUS: every text route reports to the meter, with its own route name', () => {
  for (const [fn, route] of [['askOpenAI', 'openaiKey'], ['askOpenAiServer', 'openai'], ['askKimiDirect', 'kimiKey'], ['askKimiServer', 'kimi'], ['askGeminiDirect', 'gemini']]) {
    const body = fnBody(fn);
    assert.match(body, new RegExp("_aiMeterText\\('" + route + "'"), fn + ' meters as ' + route);
    assert.match(body, /typeof _aiMeterText === 'function'/, fn + ' guards the hook');
  }
});
test('CENSUS: every image route reports to the meter', () => {
  for (const [fn, route] of [['_openAiImageRequest', 'imgKey'], ['openAiImageServer', 'imgServer'], ['generateImageDataUrlGemini', 'imgGemini']]) {
    assert.match(fnBody(fn), new RegExp("_aiMeterImage\\('" + route + "'"), fn + ' meters as ' + route);
  }
});
test('a reply is metered BEFORE a cut-off reply throws — it was billed all the same', () => {
  for (const fn of ['askOpenAI', 'askKimiDirect', 'askGeminiDirect']) {
    const body = fnBody(fn);
    assert.ok(body.indexOf('_aiMeterText(') < body.indexOf('incomplete'), fn + ' meters before the length check');
  }
});
test('the route list the core names matches the routes the app has', () => {
  for (const r of ['gemini', 'openai', 'openaiKey', 'kimi', 'kimiKey']) assert.match(src, new RegExp(`${r}: '`), r);
  for (const r of Object.keys(core.AI_ROUTE_NAMES)) assert.ok(src.includes("'" + r + "'"), r + ' is a route in app.js');
});

// ── The meter glue, run for real ────────────────────────────────────────────
const meterSrc = src.slice(src.indexOf('const AI_PRICE_STORE ='), src.indexOf('// ── 💲 The price dialog'));
assert.ok(meterSrc.length > 200, 'meter section found');
function meter() {
  const store = {};
  const warn = [];
  const api = new Function('core', 'store', 'warn', `
    const { mergePrices, normalizeUsage, estimateUsage, formatMoney } = core;
    const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
    const console = { warn: (...a) => warn.push(a) };
    ${meterSrc}
    return { aiMeterOpen, _aiMeterText, _aiMeterImage, aiPrices, aiPriceSaveOverrides, aiCostSetCurrency, aiMoney, _aiMeters };
  `)(core, store, warn);
  return { api, store, warn };
}
test('nobody listening: the hook does no work at all', () => {
  const { api } = meter();
  let read = 0;
  api._aiMeterText('openai', 'gpt-6.1-sol', 'openai', { get prompt_tokens() { read++; return 1; } }, 'p', [], 'r', true);
  assert.equal(read, 0);
});
test('a listener gets the reported usage, or an estimate marked as one', () => {
  const { api } = meter();
  const got = [];
  const h = api.aiMeterOpen(r => got.push(r));
  api._aiMeterText('openaiKey', 'gpt-6.1-sol', 'openai', { prompt_tokens: 10, completion_tokens: 5 }, 'p', [], 'r', true);
  api._aiMeterText('openai', 'gpt-6.1-sol', 'openai', undefined, 'x'.repeat(400), [{ data: 'a' }, null], 'y'.repeat(40), false);
  api._aiMeterImage('imgServer', 'gpt-image-2.5-flare', null);
  h.close();
  api._aiMeterText('openaiKey', 'gpt-6.1-sol', 'openai', { prompt_tokens: 10, completion_tokens: 5 }, 'p', [], 'r', true);
  assert.equal(got.length, 3, 'nothing after close');
  assert.equal(got[0].usage.reported, true);
  assert.equal(got[1].usage.reported, false);
  assert.equal(got[1].usage.inTok, 100 + core.EST_TOKENS_PER_IMAGE, 'one real picture counted, the null one not');
  assert.equal(got[2].kind, 'image');
  assert.equal(got[2].usage.images, 1);
});
test('a listener that throws never reaches the AI call', () => {
  const { api, warn } = meter();
  api.aiMeterOpen(() => { throw new Error('boom'); });
  api._aiMeterText('openaiKey', 'gpt-6.1-sol', 'openai', { prompt_tokens: 10, completion_tokens: 5 }, 'p', [], 'r', true);
  assert.equal(warn.length, 1);
});
test('saved prices and currency are read back, and a broken store falls back to the defaults', () => {
  const { api, store } = meter();
  api.aiPriceSaveOverrides({ 'gpt-6.1-sol': { in: 3 } });
  assert.equal(api.aiPrices()['gpt-6.1-sol'].in, 3);
  store.sq_ai_price_overrides = '{not json';
  api.aiPriceSaveOverrides(undefined);
  store.sq_ai_price_overrides = '{not json';
  assert.equal(meter().api.aiPrices()['gpt-6.1-sol'].in, 2);
  api.aiCostSetCurrency('SGD', 1.4);
  assert.equal(api.aiMoney(1), 'S$1.400');
});

let failed = 0;
for (const c of cases) {
  try { await c.fn(); console.log('  ✓ ' + c.name); }
  catch (e) { failed++; console.log('  ✗ ' + c.name + '\n    ' + (e && e.message)); }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
