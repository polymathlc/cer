import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../ainstein-live.js', import.meta.url), 'utf8');
const { awaitAinsteinVoice } = await import('data:text/javascript;base64,' + Buffer.from(live).toString('base64'));
const start = source.indexOf('function ainsteinVoiceAllowed()');
const end = source.indexOf('ainsteinLive = mountAinsteinLive(', start);
assert.ok(start > 0 && end > start);
function field(id, value, extra = {}) {
  return { id, value, type: 'text', visible: true, getAttribute: () => null, ...extra };
}
function setup(fields = []) {
  const root = { contains: el => fields.includes(el), querySelectorAll: () => fields };
  const c = vm.createContext({ ainsteinVoiceReady: true, ainsteinVoiceEpoch: 1,
    currentUser: { uid: 'admin', role: 'admin' }, auth: { currentUser: { uid: 'admin' } }, _practiceAs: null,
    document: { activeElement: fields[0] }, _ainsteinPageId: () => 'create',
    _ainsteinScreenRoots: () => [root], _ainsteinOnScreen: el => el.visible,
    _ainsteinPageText: () => 'Question editor', _ainsteinScreenImages: async () => [],
    _ainsteinBuildPrompt: () => 'Grounded teaching instructions.',
    runAdminTask: async () => ({ handled: false }), awaitAinsteinVoice, DOMException,
    _parseAIJson: JSON.parse, askGemini: async prompt => { c.prompt = prompt; return '{"answer":"Your answer explains the force."}'; }
  });
  vm.runInContext(source.slice(start, end), c);
  return c;
}
test('visible typed answers and contenteditable drafts reach context; secret, hidden and off-screen fields do not', () => {
  const c = setup([field('answer', 'Spring X exerts a greater force.'),
    field('notes', undefined, { innerText: 'My typed draft.' }),
    field('token', 'private'), field('password', 'private', { type: 'password' }),
    field('hidden', 'private', { type: 'hidden' }), field('offscreen', 'private', { visible: false }),
    field('ordinary', 'private', { name: 'apiKey' })]);
  const text = c.ainsteinVoiceContext();
  assert.match(text, /Spring X exerts a greater force/); assert.match(text, /My typed draft/);
  assert.doesNotMatch(text, /private/);
});
test('the focused overlay answer wins the bounded field list', () => {
  const c = setup(); const focused = field('modalAnswer', 'Latest unsaved modal answer');
  c.document.activeElement = focused;
  c._ainsteinScreenRoots = () => [
    { contains: () => false, querySelectorAll: () => Array.from({ length: 12 }, (_, i) => field('page' + i, 'older')) },
    { contains: el => el === focused, querySelectorAll: () => [focused] }
  ];
  const text = c.ainsteinVoiceContext();
  assert.match(text, /Latest unsaved modal answer/);
  assert.equal(JSON.parse(text.slice(text.indexOf('{'))).typed.length, 8);
});
test('voice context is unavailable to students, practice-as and mismatched accounts', () => {
  const c = setup([field('answer', 'private draft')]);
  c.currentUser.role = 'student'; assert.equal(c.ainsteinVoiceContext(), '');
  c.currentUser.role = 'admin'; c._practiceAs = {}; assert.equal(c.ainsteinVoiceContext(), '');
  c._practiceAs = null; c.auth.currentUser.uid = 'other'; assert.equal(c.ainsteinVoiceContext(), '');
});
test('the academic answering helper receives the exact current unsaved text', async () => {
  const c = setup([field('answer', 'Spring X exerts a greater force.')]);
  const answer = await c.ainsteinVoiceDelegate({ transcript: [{ role: 'user', text: 'Is what I typed correct?' }], signal: new AbortController().signal });
  assert.match(c.prompt, /Grounded teaching instructions/);
  assert.match(c.prompt, /Spring X exerts a greater force/);
  assert.equal(answer, 'Your answer explains the force.');
});
test('a cancelled academic answer releases its task even when the provider never returns', async () => {
  const c = setup(); const controller = new AbortController(); let started;
  const ready = new Promise(resolve => { started = resolve; });
  c.askGemini = () => { started(); return new Promise(() => {}); };
  const task = c.ainsteinVoiceDelegate({ transcript: [{ role: 'user', text: 'Explain this.' }], signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
});
