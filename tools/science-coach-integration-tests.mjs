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
const grade = fn('markQuestionPart', true);
const resultStore = fn('_setPartResult');
const goodResult = () => ({ verdict: 'partial', feedback: 'Compare both results; your answer describes only one.',
  coachIssues: [{ type: 'comparison', detail: 'Only one result is described.' }], modelAnswer: 'A rose more than B.' });

function harness() {
  const state = { calls: [], mounts: [], resets: [], warnings: [], toasts: [], completed: 0, painted: 0,
    result: goodResult(), active: true, ownsHost: true, selected: 'b', photo: null };
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
    };
    const read = async (kind, prompt, options) => {
      state.calls.push({ kind, prompt, options });
      if (state.aiError) throw new Error('AI unavailable');
      if (state.defer) await new Promise(resolve => { state.resolve = resolve; });
      return JSON.stringify(state.result);
    };
    const askGemini = (prompt, options) => read('text', prompt, options);
    const askGeminiVision = (prompt, media, options) => read('vision', prompt, options);
    ${helpers}
    ${resultStore}
    ${grade}
    return {
      capture: () => _captureScienceCoachTarget('#question', _openQStore['#question'], host),
      show: (target, result, context) => _showScienceCoachFeedback(target, result, context),
      reset: () => _resetOpenScienceCoaches('#question'),
      grade: (kind = 'open') => markQuestionPart('#question', kind, kind === 'open' ? '0' : 'm1', { innerHTML: 'Check', disabled: false }),
      results: () => _openPartResults['#question'] || {},
      replaceQuestion: () => { _openQStore['#question'] = { ..._openQStore['#question'] }; },
      replaceConfig: () => { _openSurfaceCfg['#question'] = { ..._openSurfaceCfg['#question'] }; },
      mode: mode => { _openSurfaceCfg['#question'].mode = mode; },
      user: user => { currentUser = user; },
      photo: photo => { _openPhoto['#question'] = photo; }
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
