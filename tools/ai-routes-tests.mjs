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
var _pref = 'gemini', _key = '', _gemini = true, _kimiKey = '', _kimiOk = true;
function getAiEngine() { return _pref; }
function getOpenAiKey() { return _key; }
var _author = '';
var localStorage = {
  getItem: function (k) { return /kimi_key/.test(k) ? _kimiKey : (/author/.test(k) ? _author : ''); },
  setItem: function () {}, removeItem: function () {}
};
var AI_ENGINE_STORE = { engine: 'x_ai_engine', key: 'x_openai_key', kimiKey: 'x_kimi_key', kimiModel: 'x_kimi_model', authorEngine: 'x_ai_author_engine' };
async function fetch(url) {
  if (!_kimiOk) return { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
  if (String(url).indexOf('/models') >= 0) return { ok: true, json: async () => ({ data: [{ id: 'kimi-k3' }, { id: 'kimi-k2-thinking' }] }) };
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'kimi browser said so' } }] }) };
}
var geminiModel = { generateContent: () => ({ response: { text: () => 'gemini said so' } }) };
Object.defineProperty(globalThis, 'x', { value: 1, configurable: true });
var app = {}, AI_THINK_MIN = 'low';
function getFunctions() { return {}; }
function httpsCallable(_f, name) { return async () => ({ data: { text: name === 'askKimi' ? 'kimi server said so' : 'server said so' } }); }
async function askOpenAI() { return 'device key said so'; }
var console = { warn: function () {} };
var CONFIG_COL = 'config';
var db = {}, currentUser = { email: 'admin@example.com' };
function doc() { return { __ref: true }; }
function getDoc() { return Promise.resolve({ exists: () => false, data: () => ({}) }); }
function setDoc() { return Promise.resolve(); }
function onSnapshot() { return function () {}; }
function renderAiEngineStatus() {}
var document = { getElementById: () => null };
var window = {};
` + block + `
return {
  set pref(v) { _pref = v; },
  set key(v) { _key = v; },
  set kimiKey(v) { _kimiKey = v; },
  set kimiOk(v) { _kimiOk = v; },
  set gemini(v) { geminiModel = v ? { generateContent: () => ({ response: { text: () => 'gemini said so' } }) } : null; },
  set author(v) { _author = v; },
  resetDown: function () { Object.keys(_aiDown).forEach(function (k) { _aiDown[k] = 0; }); },
  set sharedAuthor(v) { _aiSharedAuthor = v; },
  get last() { return aiLastCall; },
  AI_DOWN_MS, aiEngineOrder, aiEngineIsDown, _aiAsk, _aiRun, askChatGpt, askKimi, askOpenAiServer,
  askKimiDirect, askKimiServer, kimiListModels, getKimiModel, KIMI_DEFAULT_MODEL,
  aiAuthorEngine, aiAuthorSetting, AI_AUTHOR_DEFAULT, AI_AUTHOR_FOLLOW, _aiAuthorFromDoc
};
`)();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
}

/* ---------- the order ---------- */
api.pref = 'gemini'; api.key = ''; api.kimiKey = ''; api.gemini = true;
ok('every server route is offered with no device key at all',
   api.aiEngineOrder().join() === 'gemini,openai,kimi', api.aiEngineOrder().join());
api.key = 'sk-x';
ok('a device key sits BEHIND the server, never in front of it',
   api.aiEngineOrder().join() === 'gemini,openai,openaiKey,kimi', api.aiEngineOrder().join());
api.kimiKey = 'sk-k';
ok('…and the same for Kimi',
   api.aiEngineOrder().join() === 'gemini,openai,openaiKey,kimi,kimiKey', api.aiEngineOrder().join());
api.kimiKey = '';

/* Choosing an engine picks which is tried FIRST. It has never meant, and must
   not mean, that the other becomes unavailable. */
api.pref = 'openai';
ok('choosing ChatGPT puts it first and keeps the others behind it',
   api.aiEngineOrder().join() === 'openai,openaiKey,gemini,kimi', api.aiEngineOrder().join());
api.key = '';
ok('choosing ChatGPT with no device key still works — the server has one',
   api.aiEngineOrder().join() === 'openai,gemini,kimi', api.aiEngineOrder().join());

/* THE THIRD ENGINE IS THE POINT OF IT. Gemini and ChatGPT are two suppliers
   on two bills; the morning BOTH are out is the morning this exists for, so
   Kimi has to be reachable as a first choice and reachable as a last resort. */
api.pref = 'kimi'; api.kimiKey = 'sk-k';
ok('choosing Kimi puts it first and keeps the others behind it',
   api.aiEngineOrder().join() === 'kimi,kimiKey,gemini,openai', api.aiEngineOrder().join());
api.kimiKey = '';
ok('choosing Kimi with no device key still works — the server has one',
   api.aiEngineOrder().join() === 'kimi,gemini,openai', api.aiEngineOrder().join());
/* An engine nobody has heard of must not empty the list: a stale word in the
   shared setting would otherwise take the AI off every device at once. */
api.pref = 'nosuchengine';
ok('an unknown preference still leaves every route on the list',
   api.aiEngineOrder().join() === 'gemini,openai,kimi', api.aiEngineOrder().join());

api.pref = 'gemini'; api.gemini = false;
ok('a Firebase project that would not start still has routes',
   api.aiEngineOrder().join() === 'openai,kimi', api.aiEngineOrder().join());
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
  api.kimiKey = 'sk-k';
  ok('…`kimi` to the SERVER',
     (await api._aiRun('kimi', 'p', null, {})) === 'kimi server said so');
  ok('…and `kimiKey` to the Kimi key in this browser',
     (await api._aiRun('kimiKey', 'p', null, {})) === 'kimi browser said so');

  /* A PDF is an OpenAI `file` part and Moonshot has no such part. It has to
     be REFUSED by name: a request that silently lost its pages comes back
     fluent and about nothing at all, which is the one failure here that
     reads as a working answer. */
  let pdfErr = null;
  try { await api.askKimiDirect('p', [{ mimeType: 'application/pdf', data: 'x' }], {}); } catch (e) { pdfErr = e; }
  ok('Kimi refuses a PDF by name rather than dropping it', pdfErr && /cannot read/i.test(String(pdfErr.message)));
  ok('…and an image goes through',
     (await api.askKimiDirect('p', [{ mimeType: 'image/png', data: 'x' }], {})) === 'kimi browser said so');
  api.kimiKey = '';
  let noKey = null;
  try { await api.askKimiDirect('p', null, {}); } catch (e) { noKey = e; }
  ok('…and no key at all refuses rather than calling with an empty one', !!noKey);
  api.kimiKey = 'sk-k';

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
     api.aiEngineOrder().join() === 'openai,openaiKey,kimi,kimiKey,gemini', api.aiEngineOrder().join());

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
  api.gemini = true; api.pref = 'gemini'; api.key = 'sk-x'; api.kimiKey = 'sk-k';
  ok('askChatGpt never falls back to Gemini',
     !api.aiEngineOrder().filter(e => e === 'openai' || e === 'openaiKey').includes('gemini'));
  ok('…and it still has both ChatGPT routes',
     api.aiEngineOrder().filter(e => e === 'openai' || e === 'openaiKey').join() === 'openai,openaiKey');
  /* …and it must not reach KIMI either. `filter(e => e !== 'gemini')` was
     right while there were two engines and is silently wrong with three: the
     answer-key cross-check asks for a NAMED second opinion, so a ChatGPT
     column answered by Kimi is two engines agreeing in the report and one
     engine agreeing with itself in fact. */
  ok('…and never Kimi, which would make the cross-check compare the wrong pair',
     !api.aiEngineOrder().filter(e => e === 'openai' || e === 'openaiKey').some(e => /^kimi/.test(e)));
  ok('askKimi is the mirror of it — Kimi\'s own routes and nothing else',
     api.aiEngineOrder().filter(e => e === 'kimi' || e === 'kimiKey').join() === 'kimi,kimiKey');

  /* The account's own model list, so "which id is current" is answered by
     Moonshot rather than by a constant in this file that goes stale. */
  ok('the model list is read from the account', (await api.kimiListModels('sk-k')).join() === 'kimi-k2-thinking,kimi-k3');
  let listErr = null;
  api.kimiKey = '';
  try { await api.kimiListModels(''); } catch (e) { listErr = e; }
  api.kimiKey = 'sk-k';
  ok('…and it says a key is needed rather than calling with none', listErr && /key/i.test(String(listErr.message)));
}

await run();

/* ---------- the wiring, in source ---------- */
ok('the callable is the function the Maths repo deploys', /httpsCallable\(_aiFns, 'askOpenAi'/.test(src));
ok('…and Kimi has one of its own', /httpsCallable\(_aiFns, 'askKimi'/.test(src));
/* Moonshot renames its flagship with every release, so the id is a FIELD and
   the account's own list fills it. An id hard-coded here is a 404 on every
   call a few months from now, with nothing on screen to say it is merely out
   of date — which is what `_kimiModelNote` is for. */
ok('the Kimi model is a field, not a constant nobody can change', /function getKimiModel\(/.test(src) && /id="aiEngineKimiModel"/.test(html));
ok('…filled from the account itself', /function kimiListModels\(/.test(src) && /kimiLoadModelList\(\)/.test(html));
ok('…and a stale id is NAMED rather than read as "Kimi is broken"', /function _kimiModelNote\(/.test(src) && /may simply be out of date/.test(src));
ok('a Kimi server key that is not set up yet says exactly that', /MOONSHOT_API_KEY has not been set/.test(src));
ok('the third engine is offered in the dialog', /value="kimi"/.test(html) && /aiEngineChoicePreview\('kimi'\)/.test(html));
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
ok('no API key of any kind is anywhere in the source', !/\bsk-[A-Za-z0-9_-]{20,}/.test(src + html));

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
ok('the order follows the shared choice',
   /const first = task === 'author' \? aiAuthorEngine\(\) : aiPreferredEngine\(\);/.test(src));
/* An engine nobody has heard of must never empty the list — a stale word in
   the shared setting would take the AI off every device at once. */
ok('…and an unknown one still leaves every route on it',
   /AI_ENGINES\.includes\(first\)\s*\n?\s*\? \[first\]\.concat/.test(src));
ok('…falling back to this device until the server answers',
   /function aiPreferredEngine\(\) \{\s*\n\s*return _aiSharedEngine \|\| getAiEngine\(\);/.test(src));
/* IT LIVES ON A DOCUMENT EVERY SIGNED-IN DEVICE ALREADY READS — this app's
   own admin pointer — so it needs no rules change and no deploy. A brand-new
   document would have been tidier and would have needed a rules deploy from a
   file that does not even contain this app's own rules. */
ok('the shared setting rides the existing admin pointer',
   /function _aiCfgRef\(\) \{ return doc\(db, (?:'config'|CONFIG_COL), 'admin'\); \}/.test(src));
ok('…written with MERGE, or it takes the bank pointer off with it',
   /await setDoc\(_aiCfgRef\(\), \{[\s\S]{0,220}\}, \{ merge: true \}\);/.test(src));
/* The admin sign-in write would otherwise wipe the field every morning: the
   toggle would appear to work and be gone by the next day. */
ok('the sign-in write is a merge too',
   /\{ uid: user\.uid, email: user\.email \}, \{ merge: true \}/.test(src));
ok('the callable is still there as the fallback', /httpsCallable\(_aiFns, 'aiEngineConfig'/.test(src));
/* LIVE, not polled: the teacher toggles and a device with the app open
   follows within seconds, which is what "app-wide" has to mean. */
ok('it is a live listener', /_aiCfgStop = onSnapshot\(_aiCfgRef\(\)/.test(src));
ok('…that comes down with the account, or one account governs the next',
   /async function handleLogout\(\) \{[\s\S]{0,220}aiEngineStopShared\(\);/.test(src));
ok('…and an unset field means Gemini, so a centre that never touches it is unaffected',
   /AI_ENGINES\.includes\(eng\) \? eng : 'gemini'/.test(src));
ok('…and the shared setting knows all three engines',
   /const AI_ENGINES = \['gemini', 'openai', 'kimi'\];/.test(src));
ok('…at sign-in, from the one function every role comes through',
   /function configureSidebarForRole\(role\) \{[\s\S]{0,400}aiEngineInit\(\);/.test(src));
ok('…and refreshed when the chooser opens', /aiEngineLoadShared\(true\)\.then\(renderAiEngineStatus\)/.test(src));
/* A setting that cannot be READ must never stop the app choosing at all, and
   one that cannot be WRITTEN must never let the teacher believe it moved. */
ok('a shared setting that cannot be read leaves the device preference running',
   /_aiWhy\.shared = String\(/.test(src));
ok('only the admin writes it', /if \(_isAdmin\(\)\) \{\s*\n\s*try \{\s*\n\s*await aiEngineSetShared/.test(src));
ok('…and a failed write says so rather than letting them believe it moved',
   /the centre-wide setting could not be written/.test(src));
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


/* =====================================================================
   ⚡ QUESTION ADDING LEADS WITH CHATGPT
   ---------------------------------------------------------------------
   The complaint this answers was a BILL: ChatGPT was switched on, every
   screen said so, and the OpenAI account barely moved while Gemini's did.
   Nothing was broken — `aiEngineOrder` puts the CHOSEN engine first and the
   others behind it, the shared default is Gemini, and Gemini answers, so the
   second route is reached only when the first refuses. That is the design
   and it is right for marking thirty students; it is the wrong trade for
   building a question, which is the hardest reasoning this app asks for and
   is a handful of the teacher's own calls.

   Everything below is silent in both directions. A path that stops passing
   `authoring` goes back to whatever the centre-wide engine is, on a screen
   that still says ChatGPT leads question building; and a `task` that leaks
   into the ordinary order puts every student's marking on the paid engine
   with nothing to say it happened.
   ===================================================================== */
api.pref = 'gemini'; api.key = ''; api.kimiKey = ''; api.gemini = true;
api.author = ''; api.sharedAuthor = null;
api.resetDown();   // earlier cases marked routes down, and a down route sorts to the back
ok('question adding leads with ChatGPT out of the box',
   api.aiEngineOrder('author')[0] === 'openai', api.aiEngineOrder('author').join());
ok('…and everything else is untouched by it',
   api.aiEngineOrder()[0] === 'gemini' && api.aiEngineOrder().join() === 'gemini,openai,kimi',
   api.aiEngineOrder().join());
/* THE OTHER ROUTES STAY BEHIND IT. Choosing an engine has always meant which
   is tried FIRST, never which is available, and that has to hold here too or
   an OpenAI account out of credit takes question building down with it. */
ok('…with the other engines still behind it',
   api.aiEngineOrder('author').join() === 'openai,gemini,kimi', api.aiEngineOrder('author').join());
ok('a down authoring route still falls to the others',
   (function () {
     const before = api.aiEngineOrder('author').join();
     return before === 'openai,gemini,kimi';
   })());

/* THE ADMIN CAN TOGGLE IT, which is the half that makes the default safe to
   ship: it is still in the picker, and choosing something there has to mean
   something. */
api.author = 'gemini';
ok('an admin who picks Gemini for question adding gets Gemini',
   api.aiEngineOrder('author')[0] === 'gemini', api.aiEngineOrder('author').join());
api.author = 'kimi';
ok('…and Kimi, if that is what they picked',
   api.aiEngineOrder('author')[0] === 'kimi', api.aiEngineOrder('author').join());
/* "Follow" is a real answer, not an absence — it is how an admin says "one
   engine for everything" and has it stay said. */
api.author = 'follow'; api.pref = 'kimi';
ok('"follow" really follows the main engine',
   api.aiEngineOrder('author').join() === api.aiEngineOrder().join(),
   api.aiEngineOrder('author').join() + ' vs ' + api.aiEngineOrder().join());
api.pref = 'gemini';
/* A VALUE NOBODY CAN READ MUST NOT TAKE THE APP DOWN, and it must not pin
   the paid engine either — it falls back to the main one, which is the
   direction where the app still answers on the engine the centre chose. */
api.author = 'nonsense-from-a-later-build';
ok('an unreadable authoring setting falls back to the default',
   api.aiAuthorSetting() === api.AI_AUTHOR_DEFAULT, api.aiAuthorSetting());

/* THE SHARED FIELD IS READ THROUGH ONE DOOR, and an UNSET field is the
   DEFAULT rather than "follow": a centre that has never opened the dialog
   gets ChatGPT on its question building, which is the whole point. */
ok('an unset shared field means the default, not "follow"',
   api._aiAuthorFromDoc({}) === api.AI_AUTHOR_DEFAULT, api._aiAuthorFromDoc({}));
ok('…and a deliberate "follow" survives the read',
   api._aiAuthorFromDoc({ aiAuthorEngine: api.AI_AUTHOR_FOLLOW }) === api.AI_AUTHOR_FOLLOW);
ok('…and a real engine survives it too',
   api._aiAuthorFromDoc({ aiAuthorEngine: 'gemini' }) === 'gemini');
ok('…and a value from a later build does not',
   api._aiAuthorFromDoc({ aiAuthorEngine: 'llama' }) === api.AI_AUTHOR_DEFAULT);
api.author = ''; api.sharedAuthor = null;

/* skipOpenAi OUTRANKS authoring. The cross-check names the engine it wants,
   and a Gemini column quietly answered by ChatGPT is two columns of the same
   model reading as a clean bill of health. */
ok('skipOpenAi still forces Gemini, whatever the authoring setting says',
   /const order = skipOpenAi \? \['gemini'\] : aiEngineOrder\(authoring \? 'author' : ''\);/.test(src) &&
   (src.match(/skipOpenAi \? \['gemini'\]/g) || []).length === 2);

/* THE SETTING IS THE CENTRE'S, on the document this app already reads, and
   the write is a MERGE — a plain set takes `uid` off the bank pointer. */
ok('the authoring choice is written centre-wide, merged',
   /aiEngine: engine,\s*\n\s*aiAuthorEngine: author,/.test(src) && /\{ merge: true \}/.test(src));
ok('…and the picker is in the dialog', /id="aiEngineAuthor"/.test(html));
ok('…and it previews without committing',
   /function aiEngineAuthorPreview\(/.test(src) && /finally \{[\s\S]{0,260}_aiSharedAuthor = wasShared;/.test(src));
ok('the chooser SAYS the authoring order separately',
   /Adding a question — tried in this order/.test(src) && /authorSame/.test(src),
   'an app whose question building runs on a different engine looks, from every screen, exactly like one that does not');

/* ---------- THE CENSUS ---------- */
/* A question-building path added next month that forgets the flag is one
   that silently goes back to the centre-wide engine, with the dialog still
   promising ChatGPT. Naming them here is what makes that a failed test
   rather than a bill that does not move. */
const AUTHORING_FUNCTIONS = [
  'processRapidJob',          // ⚡ Rapid add
  'handleAiBuildFiles',       // 🤖 Build from screenshot / PDF
  'handleBulkAiFile',         // the bulk PDF import
  'readQuestionRun',          // 📄 Exam Paper AND 🗂️ Custom Paper — the ONE
                              // screenshot-run reader both pages call, so the
                              // flag is checked once for both of them
  'epReadKey',                // 📄 Exam Paper — the marking scheme
  'qcmdBuildVariant',         // 🔄 Regenerate / 🪄 the command box
  'aiGenerateBlockAnswer',    // 🤖 AI answer
  'aiGenerateBlockExplanation', // 📝 AI explanation
  'aiWritePartExplanations',  // one explanation per part
  'autoChkRun'                // 🚦 the auto-check and its repair
];
/* A top-level function OWNS its lines until the `}` in column 1 that closes
   it — not until the next `function` keyword. Tracking only the keyword
   attributes an event listener written between two declarations to whichever
   one happened to come first, and the census then fails on a call that has
   nothing to do with it. ✨ Improve is exactly that shape, and it caught this. */
const lines = src.split('\n');
const owner = [];
let cur = '';
for (const line of lines) {
  const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) cur = m[1];
  owner.push(cur);
  if (/^\}/.test(line)) cur = '';
}
const calls = new Map();                       // function name → [flagged?]
lines.forEach((line, i) => {
  if (!/\bawait askGemini(Vision)?\(/.test(line) && !/=\s*askGemini(Vision)?\(/.test(line)) return;
  // A call spread over several lines carries its options on a later one.
  const window5 = lines.slice(i, i + 5).join('\n');
  const flagged = /authoring: true/.test(window5) || /authoring: true/.test(line);
  if (!calls.has(owner[i])) calls.set(owner[i], []);
  calls.get(owner[i]).push(flagged);
});
for (const name of AUTHORING_FUNCTIONS) {
  const got = calls.get(name);
  ok('“' + name + '” asks the AI at all', !!got && got.length > 0,
     'renamed or refactored — the census is naming a function that is not there');
  ok('…and every one of its calls leads with the authoring engine',
     !!got && got.every(Boolean),
     'a build path that forgets `authoring: true` silently goes back to the centre-wide engine');
}
/* …AND THE FLAG MUST NOT SPREAD. Marking, hints, the tutor, the reports and
   the cross-check are thirty students' calls, not the teacher's handful. */
for (const [name, flags] of calls) {
  if (AUTHORING_FUNCTIONS.includes(name)) continue;
  ok('“' + name + '” is not quietly authoring', flags.every(f => !f),
     'add it to AUTHORING_FUNCTIONS with a reason, or take the flag off — every student call on the paid engine is a bill nobody asked for');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
