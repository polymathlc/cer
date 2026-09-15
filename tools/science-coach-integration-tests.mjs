// Exercise the real app marking and coach lifecycle against controlled DOM/AI
// boundaries. Grading remains the app's existing per-part implementation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SCIENCE_COACH_INSTRUCTIONS, selectScienceCoaches } from '../science-coach-core.js';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function section(from, to) {
  const start = src.indexOf(from), end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `${from} section exists`);
  return src.slice(start, end);
}
function fn(name, async = false) {
  return section(`${async ? 'async ' : ''}function ${name}(`, '\n}') + '\n}';
}
const helpers = section('const _scienceCoachEpochs =', '// Hint + Check answer buttons');
// The 🐾 mistake taxonomy is the REAL one (shared byte-for-byte with Scan and
// Ans Key), so the analysis that follows a coach is resolved exactly as the
// app resolves it — an invented animal has to come out as no analysis here
// because it comes out as none there.
const taxonomy = section('var MISTAKE_ANIMALS = [', '// ---- The bank');
const grade = fn('markQuestionPart', true);
const resultStore = fn('_setPartResult');
const sourceHelpers = section('function _gradingQuestionSource(', '\n// =====================================================================');
const sourceDependencies = [fn('_cqTableRows'), fn('_parseImageDataUrl'), fn('_decodeBase64'),
  fn('_fbParse'), fn('_fbMergeBlankRuns'), src.match(/^function _fbSegments\([^\n]+/m)[0]].join('\n');
const goodResult = () => ({ verdict: 'partial', feedback: 'Compare both results; your answer describes only one.',
  coachIssues: [{ type: 'comparison', detail: 'Only one result is described.' }], modelAnswer: 'A rose more than B.' });

function harness() {
  const state = { calls: [], mounts: [], resets: [], warnings: [], toasts: [], completed: 0, painted: 0,
    result: goodResult(), active: true, ownsHost: true, selected: 'b', photo: null,
    sourceLoads: [], sourceImages: new Map(), timeouts: [],
    analyses: [], analysisResets: [], coachRoot: { coach: true } };
  const page = { classList: { contains: name => name === 'active' && state.active } };
  const host = { isConnected: true, innerHTML: '', closest: selector => selector === '.page' ? page : null };
  const container = { contains: element => state.ownsHost && element === host };
  const area = { value: 'A rose higher.', dataset: { oidx: '0' }, style: {},
    closest: () => ({ querySelector: () => host }) };
  state.container = container;
  const document = { querySelector: selector => {
    if (selector === '#question') return state.container;
    if (selector.includes('.open-answer')) return area;
    if (selector.includes('[data-mcq-fb=')) return host;
    if (selector.includes(':checked')) return state.selected ? { value: state.selected } : null;
    return null;
  } };
  const api = new Function('state', 'document', 'host', 'area', 'SCIENCE_COACH_INSTRUCTIONS', 'selectScienceCoaches', `
    let currentUser = { uid: 'student-1', role: 'student' };
    const _openQStore = { '#question': { id: 'q1', title: 'Compare the results', blocks: [] } };
    const _openSurfaceCfg = { '#question': { mode: 'practice-open' } };
    const _openItemsStore = { '#question': [{ label: '(b) Evidence', model: 'A rose more than B.' }] };
    const _openMcqStore = { '#question': [{ blockId: 'm1', options: [
      { id: 'a', letter: '1', text: 'A is greater', correct: true },
      { id: 'b', letter: '2', text: 'A is smaller', correct: false }
    ] }] };
    const _openPhoto = {};
    const _openPartResults = {};
    const window = { __aiReady: () => true };
    const _questionContext = q => q.title;
    // Rendering/HTML boundaries; the source collector, table parser, blank
    // parser and attachment pipeline below are extracted from the real app.
    const stripHtml = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
    const qPartMap = () => ({});
    const qBlockOpensKey = block => block.part || '';
    const qPartLabel = part => '(' + part + ')';
    const qPartBodyHtml = block => block.content || '';
    const transformImageUrl = url => url;
    const _urlToDataUrl = async url => {
      state.sourceLoads.push(url);
      const response = state.sourceImages.get(url);
      if (response instanceof Error) throw response;
      if (response === 'pending') return new Promise(() => {});
      return response || 'data:image/png;base64,RklHVVJF';
    };
    const setTimeout = (callback, delay) => {
      state.timeouts.push(delay);
      return globalThis.setTimeout(callback, state.fastTimeout ? 0 : delay);
    };
    const clearTimeout = globalThis.clearTimeout;
    const _markingPreamble = () => 'Existing science marking rules.';
    const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const qKeyPlainHtml = (q, value) => escapeHtml(value);
    const _normMcqChoice = value => String(value);
    const _parseAIJson = JSON.parse;
    const _checkAllPartsMarked = () => { state.completed++; };
    const _mcqPaintResult = () => { state.painted++; };
    const showToast = (message, kind) => state.toasts.push({ message, kind });
    const console = { warn: (...args) => state.warnings.push(args), error() {} };
    const resetScienceCoaches = element => {
      state.resets.push(element);
      if (state.resetError) throw new Error('coach reset failed');
    };
    const mountScienceCoach = (element, result, context) => {
      if (state.mountError) throw new Error('coach paint failed');
      state.mounts.push({ element, result, context, selected: selectScienceCoaches(result, context) });
      return state.coachRoot;
    };
    const mountMistakeAnalysis = (feedback, anchor, input) => {
      if (state.analysisError) throw new Error('mistake paint failed');
      state.analyses.push({ feedback, anchor, input });
      return { mistake: true };
    };
    const resetMistakeAnalysis = element => {
      state.analysisResets.push(element);
      if (state.analysisResetError) throw new Error('mistake reset failed');
    };
    const read = async (kind, prompt, options, media = []) => {
      state.calls.push({ kind, prompt, options, media });
      if (state.aiError) throw new Error('AI unavailable');
      if (state.defer) await new Promise(resolve => { state.resolve = resolve; });
      return JSON.stringify(state.result);
    };
    const askGemini = (prompt, options) => read('text', prompt, options);
    const askGeminiVision = (prompt, media, options) => read('vision', prompt, options, media);
    ${sourceDependencies}
    ${sourceHelpers}
    ${taxonomy}
    ${helpers}
    ${resultStore}
    ${grade}
    return {
      capture: () => _captureScienceCoachTarget('#question', _openQStore['#question'], host),
      show: (target, result, context) => _showScienceCoachFeedback(target, result, context),
      reset: () => _resetOpenScienceCoaches('#question'),
      grade: (kind = 'open') => markQuestionPart('#question', kind, kind === 'open' ? '0' : 'm1', { innerHTML: 'Check', disabled: false }),
      results: () => _openPartResults['#question'] || {},
      question: question => { _openQStore['#question'] = question; },
      source: question => _gradingQuestionSource(question),
      input: (question, leading) => _gradingQuestionInput(question, leading),
      replaceQuestion: () => { _openQStore['#question'] = { ..._openQStore['#question'] }; },
      replaceConfig: () => { _openSurfaceCfg['#question'] = { ..._openSurfaceCfg['#question'] }; },
      mode: mode => { _openSurfaceCfg['#question'].mode = mode; },
      user: user => { currentUser = user; },
      photo: photo => { _openPhoto['#question'] = photo; },
      analysis: (result, context, question) => _mistakeAnalysisFor(result, context, question),
      choice: (options, letter) => _mcqChoiceLabel(options, letter),
      rule: MISTAKE_ANIMAL_RULE,
      animals: MISTAKE_ANIMALS
    };
  `)(state, document, host, area, SCIENCE_COACH_INSTRUCTIONS, selectScienceCoaches);
  return { api, state, host, area, container };
}

test('a valid feedback target forwards the exact grading result and context', () => {
  const h = harness(), target = h.api.capture(), result = goodResult(), context = { kind: 'open', label: '(b) Evidence' };
  h.api.show(target, result, context);
  assert.equal(h.state.resets[0], h.host, 'rechecking clears the previous coach at this feedback host');
  assert.equal(h.state.mounts.length, 1);
  assert.equal(h.state.mounts[0].result, result);
  assert.equal(h.state.mounts[0].context, context);
  assert.equal(h.state.mounts[0].selected[0].id, 'comparison');
});

test('reset invalidates an outstanding target and clears coaches in the container', () => {
  const h = harness(), target = h.api.capture();
  h.api.reset();
  h.api.show(target, goodResult());
  assert.equal(h.state.mounts.length, 0);
  assert.equal(h.state.resets.at(-1), h.container);
  h.api.show(h.api.capture(), goodResult());
  assert.equal(h.state.mounts.length, 1, 'a new check after resetting can display normally');
});

test('only the newest check of the same feedback host may display a coach', () => {
  const h = harness(), old = h.api.capture(), current = h.api.capture();
  h.api.show(old, goodResult());
  assert.equal(h.state.mounts.length, 0);
  h.api.show(current, goodResult());
  assert.equal(h.state.mounts.length, 1);
});

for (const [name, change] of [
  ['same question id with a replacement object', h => h.api.replaceQuestion()],
  ['replacement surface configuration', h => h.api.replaceConfig()],
  ['account change', h => h.api.user({ uid: 'student-2', role: 'student' })],
  ['disconnected feedback', h => { h.host.isConnected = false; }],
  ['hidden page', h => { h.state.active = false; }],
  ['replacement container', h => { h.state.container = { contains: () => true }; }],
  ['feedback removed from its container', h => { h.state.ownsHost = false; }],
  ['surface switched to preview', h => h.api.mode('preview')]
]) {
  test(`a stale target is ignored after ${name}`, () => {
    const h = harness(), target = h.api.capture();
    change(h);
    h.api.show(target, goodResult());
    assert.equal(h.state.mounts.length, 0);
  });
}

test('preview mode does not capture coaches, while a teacher using practice still can', () => {
  const h = harness();
  h.api.mode('preview');
  assert.equal(h.api.capture(), null);
  h.api.mode('practice-open');
  h.api.user({ uid: 'teacher', role: 'admin' });
  h.api.show(h.api.capture(), goodResult());
  assert.equal(h.state.mounts.length, 1);
});

test('missing or invalid grade results never display coaches', () => {
  const h = harness(), target = h.api.capture();
  for (const result of [null, {}, { error: 'AI unavailable' }, { verdict: 'unknown', coachIssues: goodResult().coachIssues }]) {
    h.api.show(target, result);
  }
  assert.equal(h.state.mounts.length, 0);
  h.api.show(target, { verdict: 'incorrect', error: 'AI unavailable', coachIssues: goodResult().coachIssues });
  assert.deepEqual(h.state.mounts.at(-1).selected, [], 'the real selector suppresses technical errors even when a verdict is present');
});

test('the real open-answer marker forwards issue metadata with one existing AI call and unchanged half credit', async () => {
  const h = harness();
  await h.api.grade();
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].kind, 'text');
  assert.ok(h.state.calls[0].prompt.includes(SCIENCE_COACH_INSTRUCTIONS));
  assert.match(h.state.calls[0].prompt, /Existing science marking rules/);
  assert.match(h.state.calls[0].prompt, /ignore wording, grammar and spelling/);
  assert.deepEqual(h.api.results()['open:0'], { verdict: 'partial', pts: 0.5, expected: 'A rose more than B.', student: 'A rose higher.' });
  assert.equal(h.state.completed, 1);
  assert.deepEqual(h.state.mounts[0].result.coachIssues, h.state.result.coachIssues);
  assert.equal(h.state.mounts[0].result.feedback, h.state.result.feedback);
  assert.deepEqual(h.state.mounts[0].context, { kind: 'open', label: '(b) Evidence', student: 'A rose higher.' });
});

test('a local wrong MCQ keeps zero credit, makes no AI call and gets neutral coaching', async () => {
  const h = harness();
  await h.api.grade('mcq');
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.api.results()['mcq:m1'].pts, 0);
  assert.equal(h.state.painted, 1);
  assert.equal(h.state.mounts[0].selected[0].id, 'complete');
  assert.equal(h.state.completed, 1);
});

test('a photo answer is not passed as a confirmed blank typed answer', async () => {
  const h = harness();
  h.area.value = '';
  h.api.photo({ mimeType: 'image/png', data: 'PHOTO' });
  await h.api.grade();
  assert.deepEqual(h.state.calls.map(call => call.kind), ['vision']);
  assert.equal(Object.hasOwn(h.state.mounts[0].context, 'student'), false);
  assert.equal(h.api.results()['open:0'].pts, 0.5);
});

test('grading failure does not create a coach, save a part result or finalize the answer', async () => {
  const h = harness();
  h.state.aiError = true;
  await h.api.grade();
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.mounts.length, 0);
  assert.deepEqual(h.api.results(), {});
  assert.equal(h.state.completed, 0);
});

test('resetting during the actual AI request prevents late coaching', async () => {
  const h = harness();
  h.state.defer = true;
  const pending = h.api.grade();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.calls.length, 1);
  h.api.reset();
  h.state.resolve();
  await pending;
  assert.equal(h.state.mounts.length, 0);
});

test('coach UI failures cannot block the existing grade or completion callback', async () => {
  const h = harness();
  h.state.resetError = h.state.mountError = true;
  assert.doesNotThrow(() => h.api.reset());
  await h.api.grade();
  assert.equal(h.api.results()['open:0'].pts, 0.5);
  assert.equal(h.state.completed, 1);
  assert.ok(h.state.warnings.length >= 2);
});

test('new question rendering and answer reset both invalidate coach state', () => {
  assert.match(fn('buildOpenBody'), /_resetOpenScienceCoaches\(containerSel\)/);
  assert.match(fn('resetOpenAnswersIn'), /_resetOpenScienceCoaches\(containerSel\)/);
});

function fruitQuestion() {
  return { id: 'fruit', title: 'Fruit and seed dispersal', markingGuide: 'Use the question evidence.', blocks: [
    { id: 'stem', type: 'text', content: '<p>' + 'An investigation was carried out. '.repeat(35) + '</p><p>The dull green fruit blends into the green leaves.</p>' },
    { id: 'picture', type: 'image', url: 'fruit.png', caption: 'A dull green fruit among green leaves', dgnLabel: 'Fruit X', annotate: true,
      answerKey: 'HIDDEN DIAGRAM KEY', answerImg: 'hidden-diagram-key.png' },
    { id: 'table', type: 'table', data: { 1: { 1: 'Strong', 0: 'Odour' }, 0: { 1: 'Dull green', 0: 'Colour' } } },
    { id: 'part', type: 'part', label: '(b)', content: 'Explain how its strong odour helps animals locate the fruit.' },
    { id: 'answer', type: 'plainanswer', content: 'HIDDEN MODEL <img src="hidden-model.png">' },
    { id: 'cer', type: 'answer', claim: '<img src="hidden-claim.png">', evidence: 'HIDDEN EVIDENCE', reasoning: 'HIDDEN REASONING' },
    { id: 'explanation', type: 'explanation', content: 'HIDDEN EXPLANATION <img src="hidden-explanation.png">' },
    { id: 'key', type: 'answerKey', text: 'HIDDEN KEY', url: 'hidden-key.png' },
    { id: 'working', type: 'workingSpace', annotate: true, content: 'HIDDEN WORKING', answerKey: 'HIDDEN PAD KEY', answerImg: 'hidden-pad-key.png' }
  ] };
}

test('question source keeps the full late context, table cells, part wording and diagram captions, without hidden answers', () => {
  const h = harness(), q = fruitQuestion(), before = JSON.stringify(q), source = h.api.source(q);
  assert.match(source.text, /The dull green fruit blends into the green leaves/);
  assert.ok(source.text.indexOf('dull green fruit blends') > 800, 'the late context survives the old 800-character cutoff');
  assert.match(source.text, /Colour \| Dull green\nOdour \| Strong/);
  assert.match(source.text, /\(b\) Explain how its strong odour/);
  assert.match(source.text, /Fruit X — A dull green fruit among green leaves/);
  assert.doesNotMatch(source.text, /HIDDEN/);
  assert.deepEqual(source.images.map(image => image.url), ['fruit.png']);
  assert.equal(JSON.stringify(q), before, 'source extraction must not mutate the question or key');
});

test('source HTML pictures and visible options retain order while blank answers stay hidden', () => {
  const h = harness(), source = h.api.source({ blocks: [
    { type: 'text', part: 'a', content: '<p>Compare A and B.</p><img src="a.png?x=1&amp;y=2" alt="Label A">' },
    { type: 'table', data: [['<img src="b.webp" alt="Label B">', '2 cm']] },
    { type: 'mcq', correctId: 'o2', options: [{ id: 'o1', text: 'One <img src="c.jpg">' }, { id: 'o2', text: 'Two' }] },
    { type: 'fillblank', text: 'Fruit is [[dull]] [[green]] and has [[odour]].' },
    { type: 'image', url: 'b.webp' }
  ] });
  assert.deepEqual(source.images.map(image => image.url), ['a.png?x=1&y=2', 'b.webp', 'c.jpg']);
  assert.match(source.text, /\(a\) Compare A and B/);
  assert.match(source.text, /Label A/);
  assert.match(source.text, /Label B/);
  assert.match(source.text, /Option 1: One/);
  assert.match(source.text, /Fruit is ____ and has ____/);
  assert.doesNotMatch(source.text, /dull|green|odour|correctId|o2/);
});

for (const photo of [false, true]) {
  test(`the actual ${photo ? 'handwritten' : 'typed'} per-part request includes diagram context in one vision call`, async () => {
    const h = harness();
    h.api.question(fruitQuestion());
    h.state.result = { verdict: 'partial', feedback: 'Link the odour to the green fruit being hard to see among green leaves.',
      coachIssues: [{ type: 'context', detail: 'You did not link the green fruit to the green leaves.' }], modelAnswer: 'The fruit blends into the leaves, so its odour helps animals locate it.' };
    if (photo) { h.area.value = ''; h.api.photo({ mimeType: 'image/jpeg', data: 'STUDENT_PHOTO' }); }
    await h.api.grade();
    assert.equal(h.state.calls.length, 1, 'source loading must not create another AI request');
    const call = h.state.calls[0];
    assert.equal(call.kind, 'vision');
    assert.deepEqual(call.media, (photo ? [{ mimeType: 'image/jpeg', data: 'STUDENT_PHOTO' }] : [])
      .concat([{ mimeType: 'image/png', data: 'RklHVVJF' }]));
    assert.match(call.prompt, /The dull green fruit blends into the green leaves/);
    assert.match(call.prompt, /Colour \| Dull green\nOdour \| Strong/);
    assert.match(call.prompt, new RegExp('Image ' + (photo ? 2 : 1) + ': QUESTION SOURCE'));
    assert.match(call.prompt, /not the student's answer or the answer key/);
    if (photo) assert.match(call.prompt, /Image 1: STUDENT RESPONSE/);
    assert.doesNotMatch(call.prompt, /HIDDEN/);
    assert.equal(h.api.results()['open:0'].pts, 0.5);
    assert.deepEqual(h.state.mounts[0].result.coachIssues, h.state.result.coachIssues);
    assert.equal(h.state.mounts[0].selected[0].id, 'context');
  });
}

test('attachment roles distinguish the annotated response, correct key and original source diagram', async () => {
  const h = harness(), input = await h.api.input(fruitQuestion(), [
    { mimeType: 'image/jpeg', data: 'STUDENT', role: 'STUDENT RESPONSE — annotated diagram.' },
    { mimeType: 'image/png', data: 'KEY', role: 'CORRECT ANSWER KEY — model annotations.' }
  ]);
  assert.deepEqual(input.media.map(image => image.data), ['STUDENT', 'KEY', 'RklHVVJF']);
  assert.match(input.note, /Image 1: STUDENT RESPONSE/);
  assert.match(input.note, /Image 2: CORRECT ANSWER KEY/);
  assert.match(input.note, /Image 3: QUESTION SOURCE/);
  assert.deepEqual(h.state.sourceLoads, ['fruit.png'], 'hidden model pictures are not treated as source diagrams');
});

test('a repeated diagram keeps each part caption and label while attaching its pixels only once', async () => {
  const h = harness(), input = await h.api.input({ blocks: [
    { type: 'image', url: 'shared.png', dgnLabel: 'Part A', caption: 'Dull green fruit' },
    { type: 'image', url: 'shared.png', dgnLabel: 'Part B', caption: 'Green leaves surrounding the fruit' },
    { type: 'image', url: '', caption: 'Strong odour attracts animals' }
  ] });
  assert.deepEqual(h.state.sourceLoads, ['shared.png']);
  assert.equal(input.media.length, 1);
  assert.match(input.text, /Question figure 1: Part A — Dull green fruit/);
  assert.match(input.text, /Question figure 1: Part B — Green leaves surrounding the fruit/);
  assert.match(input.text, /Strong odour attracts animals/);
  assert.doesNotMatch(input.text, /Question figure 2/);
});

for (const failure of [new Error('network unavailable'), 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/tiff;base64,VE1GRg==', 'not an image']) {
  test(`unavailable source (${failure instanceof Error ? 'load failure' : failure.split(';')[0]}) preserves grading and explicitly says the picture was not seen`, async () => {
    const h = harness();
    h.api.question(fruitQuestion());
    h.state.sourceImages.set('fruit.png', failure);
    await h.api.grade();
    assert.equal(h.state.calls.length, 1);
    assert.equal(h.state.calls[0].kind, 'text');
    assert.deepEqual(h.state.calls[0].media, []);
    assert.match(h.state.calls[0].prompt, /UNAVAILABLE QUESTION PICTURES: Question figure 1/);
    assert.match(h.state.calls[0].prompt, /Do not claim to have seen them or invent their colours, labels or details/);
    assert.doesNotMatch(h.state.calls[0].prompt, /Image 1: QUESTION SOURCE/);
    assert.equal(h.api.results()['open:0'].pts, 0.5);
  });
}

test('failed question source does not drop a handwritten response', async () => {
  const h = harness();
  h.api.question(fruitQuestion());
  h.api.photo({ mimeType: 'image/jpeg', data: 'STUDENT_PHOTO' });
  h.state.sourceImages.set('fruit.png', new Error('offline'));
  await h.api.grade();
  assert.deepEqual(h.state.calls[0].media, [{ mimeType: 'image/jpeg', data: 'STUDENT_PHOTO' }]);
  assert.match(h.state.calls[0].prompt, /Image 1: STUDENT RESPONSE/);
  assert.match(h.state.calls[0].prompt, /UNAVAILABLE QUESTION PICTURES/);
});

test('source attachment cap and timeout leave explicit missing-picture notices', async () => {
  const h = harness(), q = { blocks: Array.from({ length: 14 }, (_, i) => ({ type: 'image', url: 'figure-' + i + '.png' })) };
  h.state.fastTimeout = true;
  h.state.sourceImages.set('figure-0.png', 'pending');
  const input = await h.api.input(q);
  assert.equal(h.state.sourceLoads.length, 12);
  assert.equal(input.media.length, 11);
  assert.deepEqual(new Set(h.state.timeouts), new Set([15000]));
  assert.match(input.note, /UNAVAILABLE QUESTION PICTURES: Question figure 1; Question figure 13; Question figure 14/);
  assert.match(input.note, /Image 1: QUESTION SOURCE — Question figure 2/);
});

test('all three grading paths use the shared source input and explicitly labelled attachments', () => {
  for (const name of ['markOpenAnswersIn', 'markQuestionPart', 'annotAiCheck']) {
    const body = fn(name, true);
    assert.match(body, /await _gradingQuestionInput\(q,/);
    assert.match(body, /askGeminiVision\(prompt, input.media,/);
    assert.match(body, /input.note/);
    assert.match(body, /STUDENT RESPONSE/);
  }
  const annotation = fn('annotAiCheck', true);
  assert.match(annotation, /CORRECT ANSWER KEY/);
  assert.doesNotMatch(annotation, /TWO pictures are attached/);
});

// ---------------------------------------------------------------------------
// 🐾 The mistake analysis that FOLLOWS a sidekick. It rides the same marking
// reply, goes through the shared taxonomy, carries the actual question, and is
// mounted after the coach card — every one of which fails silently if dropped.
// ---------------------------------------------------------------------------
const mistakeResult = () => ({ ...goodResult(), mistake: 'parrot', mistakeWhy: 'You restated the rise instead of comparing the two readings.' });

test('a wrong answer whose reply names a habit mounts the mistake analysis AFTER the coach card', () => {
  const h = harness(), target = h.api.capture();
  h.api.show(target, mistakeResult(), { kind: 'open', label: '(b) Evidence', student: 'A rose higher.' });
  assert.equal(h.state.mounts.length, 1, 'the coach still mounts');
  assert.equal(h.state.analyses.length, 1);
  const { feedback, anchor, input } = h.state.analyses[0];
  assert.equal(feedback, h.host, 'the card is keyed by the same feedback element as the coach');
  assert.equal(anchor, h.state.coachRoot, 'it is inserted after the coach card, not after the feedback');
  assert.equal(input.verdict, 'partial');
  assert.equal(input.animal.id, 'parrot');
  assert.equal(input.animal, h.api.animals.find(m => m.id === 'parrot'), 'the taxonomy entry itself, never a model string');
  assert.equal(input.why, 'You restated the rise instead of comparing the two readings.');
  assert.equal(input.question.title, 'Compare the results');
  assert.equal(input.question.label, '(b) Evidence');
  assert.equal(input.student, 'A rose higher.');
  assert.equal(input.roster, h.api.animals);
  assert.equal(input.roster.length, 10);
});

test('with no coach card the analysis follows the feedback element itself', () => {
  const h = harness();
  h.state.coachRoot = null;
  h.api.show(h.api.capture(), mistakeResult(), { kind: 'open' });
  assert.equal(h.state.analyses[0].anchor, h.host);
});

test('the actual question travels with the analysis: parts, options, figures — never the answer key', () => {
  const h = harness(), q = fruitQuestion(), before = JSON.stringify(q);
  const analysis = h.api.analysis({ verdict: 'incorrect', mistake: 'The Rabbit', mistakeWhy: 'Skimmed the question.' }, { kind: 'open', label: '(b)' }, q);
  assert.equal(analysis.animal.id, 'rabbit', 'the animal name resolves through the shared normaliser');
  assert.equal(analysis.question.title, 'Fruit and seed dispersal');
  assert.doesNotMatch(analysis.question.text, /^Fruit and seed dispersal/, 'the title has its own slot and is not repeated in the wording');
  assert.match(analysis.question.text, /\(b\) Explain how its strong odour/);
  assert.match(analysis.question.text, /Colour \| Dull green/);
  assert.doesNotMatch(analysis.question.text, /HIDDEN/);
  assert.deepEqual(analysis.question.images, ['fruit.png'], 'hidden model pictures are not question figures');
  assert.equal(JSON.stringify(q), before, 'building the analysis must not mutate the question');
});

test('a reply that names no habit, an unknown animal, or a correct answer gives no analysis and clears an old card', () => {
  const h = harness();
  for (const result of [
    { ...goodResult(), mistake: '' },
    { ...goodResult(), mistake: 'unsure' },
    { ...goodResult(), mistake: 'dragon', mistakeWhy: 'An invented eleventh animal.' },
    { ...goodResult() },
    { verdict: 'correct', feedback: 'Good.', mistake: 'parrot', mistakeWhy: 'Never on a correct answer.' }
  ]) {
    h.state.analyses = []; h.state.analysisResets = [];
    h.api.show(h.api.capture(), result, { kind: 'open' });
    assert.equal(h.state.analyses.length, 0, JSON.stringify(result));
    assert.ok(h.state.analysisResets.includes(h.host), 'an earlier card at this feedback is cleared');
  }
});

test('a blank or unmarked reply never becomes an analysis', () => {
  const h = harness();
  for (const result of [null, {}, { mistake: 'parrot' }, { verdict: 'unknown', mistake: 'parrot' }]) {
    assert.equal(h.api.analysis(result, {}, { title: 'Q', blocks: [] }), null);
  }
});

test('the analysis cannot block the coach, the grade or the completion callback', async () => {
  const h = harness();
  h.state.result = mistakeResult();
  h.state.analysisError = true;
  await h.api.grade();
  assert.equal(h.state.mounts.length, 1);
  assert.equal(h.api.results()['open:0'].pts, 0.5);
  assert.equal(h.state.completed, 1);
  assert.ok(h.state.warnings.some(w => /Mistake analysis skipped/.test(w[0])));
});

test('resetting a question and rechecking a part both clear the mistake card with the coach', () => {
  const h = harness();
  h.api.capture();
  assert.ok(h.state.analysisResets.includes(h.host), 'a new check clears the last card at this feedback');
  h.api.reset();
  assert.ok(h.state.analysisResets.includes(h.state.container), 'resetting the question sweeps the container');
});

test('a stale target mounts no analysis either', () => {
  const h = harness(), target = h.api.capture();
  h.api.reset();
  h.api.show(target, mistakeResult(), { kind: 'open' });
  assert.equal(h.state.analyses.length, 0);
});

test('the real per-part marker asks for the habit on the SAME call and mounts the analysis from its reply', async () => {
  const h = harness();
  h.state.result = mistakeResult();
  await h.api.grade();
  assert.equal(h.state.calls.length, 1, 'no second call is made for the habit');
  assert.ok(h.state.calls[0].prompt.includes(h.api.rule), 'the shared MISTAKE_ANIMAL_RULE is in the marking prompt');
  assert.match(h.state.calls[0].prompt, /"mistake":""/);
  assert.match(h.state.calls[0].prompt, /"mistakeWhy":""/);
  assert.ok(h.state.calls[0].prompt.indexOf(h.api.rule) < h.state.calls[0].prompt.indexOf('Return ONLY JSON'), 'the rule precedes the format line');
  assert.equal(h.state.analyses.length, 1);
  assert.equal(h.state.analyses[0].input.animal.id, 'parrot');
  assert.equal(h.state.analyses[0].input.student, 'A rose higher.');
  assert.equal(h.state.analyses[0].input.question.label, '(b) Evidence');
  assert.deepEqual(h.state.mounts[0].context, { kind: 'open', label: '(b) Evidence', student: 'A rose higher.' }, 'the coach context is unchanged');
});

test('a local MCQ makes no AI call, so it never carries a habit', async () => {
  const h = harness();
  await h.api.grade('mcq');
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.analyses.length, 0);
});

test('an MCQ read from a photo quotes the option the student chose', async () => {
  const h = harness();
  h.api.photo({ mimeType: 'image/png', data: 'PHOTO' });
  h.state.result = { verdict: 'incorrect', feedback: 'Read the question again.', chosen: '2', mistake: 'rabbit', mistakeWhy: 'You answered the opposite of what was asked.' };
  await h.api.grade('mcq');
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.mounts[0].context.student, '2) A is smaller');
  assert.equal(h.state.analyses[0].input.student, '2) A is smaller');
  assert.equal(h.api.choice([{ letter: '1', text: 'A <b>is</b> greater' }], '1'), '1) A is greater');
  assert.equal(h.api.choice([], '3'), '3');
});

test('all three grading prompts carry the shared mistake rule and both reply fields', () => {
  for (const name of ['markOpenAnswersIn', 'markQuestionPart', 'annotAiCheck']) {
    const body = fn(name, true);
    assert.match(body, /MISTAKE_ANIMAL_RULE \+ '\\n' \+/, name + ' asks for the habit');
    assert.match(body, /"mistake":"/, name + ' names the field');
    assert.match(body, /"mistakeWhy":"/, name + ' names the reason');
    assert.ok(body.indexOf('SCIENCE_COACH_INSTRUCTIONS') < body.indexOf('MISTAKE_ANIMAL_RULE'), name + ': coach issues first, then the habit');
  }
  const show = fn('_showScienceCoachFeedback');
  assert.ok(show.indexOf('mountScienceCoach(') < show.indexOf('mountMistakeAnalysis('), 'the coach mounts before the analysis');
  assert.match(show, /mountMistakeAnalysis\(host, coachRoot \|\| host, analysis\)/);
  assert.match(fn('_resetOpenScienceCoaches'), /resetMistakeAnalysis\(container\)/);
  assert.match(fn('_captureScienceCoachTarget'), /resetMistakeAnalysis\(host\)/);
  assert.match(src, /import \{ mountMistakeAnalysis, resetMistakeAnalysis \} from "\.\/science-mistakes\.js";/);
});
