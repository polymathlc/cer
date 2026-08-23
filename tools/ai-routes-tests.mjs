// Regression tests for ⚙️ THE THREE AI ROUTES.
// Run with:  node tools/ai-routes-tests.mjs
//
// It loads the REAL route block out of app.js and runs it against stubs.
//
// All four portals answer through Gemini on one shared Firebase project, so a
// billing cap kills every one of them at once and identically. ChatGPT is the
// second engine and this block is how it is reached — and every way it can go
// wrong is silent, with the app looking exactly as it did that morning:
//
//  • THE SERVER ROUTE DROPPING OUT is the whole feature reverting. A key in
//    localStorage rescues the teacher's laptop and no student's phone, so an
//    order that stops listing `openai` looks perfectly healthy to the one
//    person who would notice and to nobody else.
//  • A ONE-WAY FALLBACK is what shipped before this. Falling from ChatGPT to
//    Gemini and never the other way leaves the failure that actually happens
//    — a capped Gemini — with nothing behind it at all.
//  • A "DOWN" NOTE THAT NEVER CLEARS makes the second route permanent; one
//    that takes a route OFF the list instead of to the back leaves the app
//    dead once the cap has been lifted.
//  • THE SECOND ERROR REPORTED INSTEAD OF THE FIRST tells the teacher "no key
//    on this device" about a paper that in fact hit a billing cap.
//  • skipOpenAi IS LOAD-BEARING where it exists: the answer-key cross-check's
//    Gemini column must really be Gemini, or both columns are the same model
//    and the report reads as a clean bill of health.
import fs from 'fs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function section(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('section not found: ' + from.slice(0, 40));
  return src.slice(a, b);
}
const block = section('const AI_DOWN_MS =', 'function aiRouteReport(');

const api = new Function(`
var _pref = 'gemini', _key = '', _gemini = true;
function getAiEngine() { return _pref; }
function getOpenAiKey() { return _key; }
var geminiModel = { generateContent: () => ({ response: { text: () => 'gemini said so' } }) };
Object.defineProperty(globalThis, 'x', { value: 1, configurable: true });
var app = {}, AI_THINK_MIN = 'low';
function getFunctions() { return {}; }
function httpsCallable() { return async () => ({ data: { text: 'server said so' } }); }
async function askOpenAI() { return 'device key said so'; }
var console = { warn: function () {} };
` + block + `
return {
  set pref(v) { _pref = v; },
  set key(v) { _key = v; },
  set gemini(v) { geminiModel = v ? { generateContent: () => ({ response: { text: () => 'gemini said so' } }) } : null; },
  get last() { return aiLastCall; },
  AI_DOWN_MS, aiEngineOrder, aiEngineIsDown, _aiAsk, _aiRun, askChatGpt, askOpenAiServer
};
`)();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
}

/* ---------- the order ---------- */
api.pref = 'gemini'; api.key = ''; api.gemini = true;
ok('the server route is offered with no device key at all',
   api.aiEngineOrder().join() === 'gemini,openai', api.aiEngineOrder().join());
api.key = 'sk-x';
ok('a device key sits BEHIND the server, never in front of it',
   api.aiEngineOrder().join() === 'gemini,openai,openaiKey', api.aiEngineOrder().join());

/* Choosing an engine picks which is tried FIRST. It has never meant, and must
   not mean, that the other becomes unavailable. */
api.pref = 'openai';
ok('choosing ChatGPT puts it first and keeps Gemini behind it',
   api.aiEngineOrder().join() === 'openai,openaiKey,gemini', api.aiEngineOrder().join());
api.key = '';
ok('choosing ChatGPT with no device key still works — the server has one',
   api.aiEngineOrder().join() === 'openai,gemini', api.aiEngineOrder().join());
api.pref = 'gemini'; api.gemini = false;
ok('a Firebase project that would not start still has routes',
   api.aiEngineOrder().join() === 'openai', api.aiEngineOrder().join());
api.gemini = true;

/* ---------- the failover ---------- */
function runner(script) {
  const seen = [];
  return { seen, run: (e) => { seen.push(e); const v = script[e];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v); } };
}
/* _aiAsk reaches _aiRun directly, so the routes are exercised through the
   stubs above rather than through an injected runner — which is the honest
   test: it is the real dispatcher that has to pick the right one. */
async function run() {
  api.pref = 'gemini'; api.key = 'sk-x'; api.gemini = true;
  ok('the dispatcher sends `openai` to the SERVER',
     (await api._aiRun('openai', 'p', null, {})) === 'server said so');
  ok('…`openaiKey` to the key in this browser',
     (await api._aiRun('openaiKey', 'p', null, {})) === 'device key said so');
  ok('…and anything else to Gemini',
     (await api._aiRun('gemini', 'p', null, {})) === 'gemini said so');

  /* A capped Gemini must fall FORWARD to ChatGPT. This is the direction the
     old code did not have, and it is the one that actually fails. */
  api.gemini = false;                      // stands in for a refusing Gemini
  let out = await api._aiAsk('p', null, {}, ['gemini', 'openai']);
  ok('a capped Gemini falls through to the server', out === 'server said so');
  ok('…and the page can say which route answered', api.last.engine === 'openai');
  ok('…and that it fell back', api.last.fellBack === true);
  ok('…and why', /not configured/i.test(api.last.error));
  ok('the refused route is skipped for a while', api.aiEngineIsDown('gemini'));

  /* …but to the BACK, never off the list: a cap is lifted eventually, and an
     app that refuses on a stale note is worse than one that spends a call. */
  api.gemini = true; api.pref = 'gemini';
  ok('a refused route stays on the list, at the back',
     api.aiEngineOrder().join() === 'openai,openaiKey,gemini', api.aiEngineOrder().join());

  out = await api._aiAsk('p', null, {}, ['gemini']);
  ok('an answer clears the mark', out === 'gemini said so' && !api.aiEngineIsDown('gemini'));
  ok('…and an answer from the first route did NOT fall back', api.last.fellBack === false);

  /* When every route refuses, the FIRST error is the one thrown: it names the
     real problem, where the last is usually "no key on this device". */
  api.gemini = false;
  let threw = null;
  try { await api._aiAsk('p', null, {}, ['gemini', 'nosuchroute']); } catch (e) { threw = e; }
  ok('every route refusing throws', !!threw);
  ok('…and no route is claimed to have answered', api.last.engine === '');

  threw = null;
  try { await api._aiAsk('p', null, {}, []); } catch (e) { threw = e; }
  ok('no route at all is refused rather than hanging',
     threw && /not configured/.test(String(threw.message)));

  /* askChatGpt means the OTHER engine, so a caller asking for a second
     opinion cannot be handed the same one twice. */
  api.gemini = true; api.pref = 'gemini'; api.key = 'sk-x';
  ok('askChatGpt never falls back to Gemini',
     !api.aiEngineOrder().filter(e => e !== 'gemini').includes('gemini'));
  ok('…and it still has both ChatGPT routes',
     api.aiEngineOrder().filter(e => e !== 'gemini').join() === 'openai,openaiKey');
}

await run();

/* ---------- the wiring, in source ---------- */
ok('the callable is the function the Maths repo deploys', /httpsCallable\(_aiFns, 'askOpenAi'/.test(src));
ok('the pages travel with it — a route that dropped them would answer about nothing',
   /media: \(media \|\| \[\]\)\.filter\(m => m && m\.data\)/.test(src));
ok('both doors go through the one loop',
   (src.match(/return _aiAsk\(/g) || []).length >= 2);
ok('the raw Gemini call is written ONCE', (src.match(/async function askGeminiDirect\(/g) || []).length === 1);
ok('choosing ChatGPT no longer demands a key',
   !/Paste your OpenAI API key to use ChatGPT/.test(src));
ok('the app is ready because a route always exists', /window\.__aiReady = \(\) => true;/.test(src));
/* The key is never in the repo: these are public static sites served to every
   student's browser. */
ok('no OpenAI key is anywhere in the source', !/\bsk-[A-Za-z0-9_-]{20,}/.test(src + html));

/* The chooser has to SAY what is happening — an app quietly running on its
   second route looks exactly like one running on its first. */
ok('the chooser reports the live route order', /function renderAiEngineStatus\(/.test(src) && /id="aiEngineStatus"/.test(html));
ok('…and is repainted when it opens', /renderAiEngineStatus\(\);\n  document\.getElementById\('aiEngineOverlay'\)/.test(src));
ok('…and previews the order as the radios change', /function aiEngineChoicePreview\(/.test(src) && /aiEngineChoicePreview\('openai'\)/.test(html));
/* A preview that saved would make Cancel a lie. */
ok('…without committing the choice', /finally \{[\s\S]{0,120}AI_ENGINE_STORE\.engine, was/.test(src));
ok('a server key that is not set up yet says exactly that', /OPENAI_API_KEY has not been set/.test(src));
ok('the chooser says the choice is an ORDER, not a switch',
   /never which is available/.test(html));
ok('the key field says it is optional and why', /You should not normally need this/.test(html));

/* ---------- the choice is the CENTRE's, not this browser's ---------- */
/* A device-local engine choice is the bug wearing a feature's clothes: the
   teacher switches to ChatGPT on their laptop, watches it work, and every
   student stays on the capped Gemini with the screen looking exactly right. */
ok('the order follows the shared choice', /const have = aiPreferredEngine\(\) === 'openai'/.test(src));
ok('…falling back to this device until the server answers',
   /function aiPreferredEngine\(\) \{\s*\n\s*return _aiSharedEngine \|\| getAiEngine\(\);/.test(src));
ok('the shared setting is read through the callable', /httpsCallable\(_aiFns, 'aiEngineConfig'/.test(src));
ok('…at sign-in, from the one function every role comes through',
   /function configureSidebarForRole\(role\) \{[\s\S]{0,400}aiEngineInit\(\);/.test(src));
ok('…and refreshed when the chooser opens', /aiEngineLoadShared\(true\)\.then\(renderAiEngineStatus\)/.test(src));
/* A setting that cannot be READ must never stop the app choosing at all, and
   one that cannot be WRITTEN must never let the teacher believe it moved. */
ok('a shared setting that cannot be read leaves the device preference running',
   /_aiWhy\.shared = String\(/.test(src));
ok('only the admin writes it', /if \(_isAdmin\(\)\) \{\s*\n\s*try \{\s*\n\s*await aiEngineSetShared/.test(src));
ok('…and a failed write says so, naming the missing deploy',
   /aiEngineConfig function is not deployed yet/.test(src));
ok('the report says WHOSE setting is in force',
   /This order is the centre-wide setting/.test(src) && /This order is THIS BROWSER/.test(src));
ok('the dialog says the choice covers every device', /every signed-in device/.test(html));

/* ---------- when nothing answers, say what everything said ---------- */
/* Reporting one route hides the rest: a card reading "Gemini: billing cap"
   and nothing else sends the teacher to the Google console when the job is to
   deploy a function. */
ok('every route is named when none of them answered',
   /const why = order\.map\(e => AI_ROUTE_LABEL\[e\] \+ ': ' \+ \(_aiWhy\[e\] \|\| 'refused'\)\)\.join\(' · '\);/.test(src));
ok('…and the first error is kept as the cause rather than discarded', /err\.cause = first;/.test(src));
ok('one label table serves the error and the report',
   (src.match(/const AI_ROUTE_LABEL = /g) || []).length === 1 && /const label = AI_ROUTE_LABEL;/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
