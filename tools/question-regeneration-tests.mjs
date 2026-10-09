// Exercise the shipped regeneration entry point and approval controller with
// deterministic checker, AI, image and persistence fixtures. No paid calls.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as repairCore from '../question-repair-core.mjs';
import * as cropCore from '../question-crop-core.mjs';
import { appSource, htmlSource, controllerSection, harnessBody, sampleQuestion, sampleFindings, samplePlan, deferred, settle } from './question-repair-tests.mjs';

const core = { ...repairCore, ...cropCore };
export { appSource, htmlSource, sampleQuestion, sampleFindings, samplePlan };
export function regenerationModalSection() {
  const start = appSource.indexOf('// ── Regenerate the current draft:');
  const end = appSource.indexOf('// Turn an existing question into plain text', start);
  const confirm = appSource.indexOf('async function confirmRegenerate()');
  const confirmEnd = appSource.indexOf('function deleteQuestion(', confirm);
  assert.ok(start >= 0 && end > start && confirm >= 0 && confirmEnd > confirm, 'The shipped regeneration modal controller is present');
  return 'document.addEventListener ||= () => {};\n' + appSource.slice(start, end) + '\n' + appSource.slice(confirm, confirmEnd);
}
function shippedFunction(startText, endText) {
  const start = appSource.indexOf(startText), end = appSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText + ' is present');
  return appSource.slice(start, end);
}
export function regenerationEditorSection() {
  return `
// Use shipped editor reads and answer-key writes, rather than shadowing them
// with the existing harness's simpler question fixture.
let editorLos=[],editorMcqLabels='';
function applyMcqCategory(q){return q;}
function parseTagInput(v){return v.split(',').filter(Boolean);}
function _snapTagsToBank(v){return v;}
function akdQuestionNote(){return document.getElementById('akdQuestionNote')?.value || '';}
function _renderAnswerKeyPreview(){H.events.push(['answerKeyPreview']);}
${shippedFunction('function collectQuestionData() {', 'function setEditMode(')}
${shippedFunction('function tlCreateQuestion() {', '// The wording lives in contenteditable')}
${shippedFunction('function _setAnswerKeyFields(', '// 🖼 AUTO DIAGRAM')}
for(const [id,value] of Object.entries({questionAnswerKeyNote:env.question.answerKeyNote || '',questionAnswerKeyImage:env.question.answerKeyImage || '',akdQuestionNote:env.question.answerKeyDiagramNote || '',questionTags:'',questionMarkingGuide:'',categorySelect2:'',topicSelect2:''})){
  let input=document.getElementById(id);
  if(!input && env.document){input=document.createElement('input');input.id=id;input.hidden=true;document.body.append(input);}
  input.value=value;
}
_editorImageSources=env.question.imageSources?clone(env.question.imageSources):null;
`;
}
export function regenerationHarnessBody() {
  assert.ok(appSource.includes('function qregenStart('), 'The shipped regeneration entry point is present');
  return harnessBody(controllerSection() + '\n' + regenerationModalSection() + '\n' + regenerationEditorSection()).replace('return {H,document,elements,auth,', 'return {H,document,elements,auth,qregenStart,openRegenerateModal,openQuestionRegenerator,closeRegenerateModal,confirmRegenerate,tlCreateQuestion,collectQuestionData,get imageSources(){return _editorImageSources;},');
}
export function regenerationHarness(options = {}) {
  const env = { question: sampleQuestion(), findings: sampleFindings(), plan: samplePlan(true), ...options };
  return new Function('core', 'env', regenerationHarnessBody())(core, env);
}

const cases = [];
const test = (name, run) => cases.push({ name, run });
async function start(h, command = '') {
  await h.qregenStart(h.scope, 'q1', command);
  await settle();
}
function unchanged(h, before = sampleQuestion().blocks) {
  assert.deepEqual(h.blocks, before, 'The original editor draft remains intact');
  assert.equal(h.H.saves.length, 0, 'Regeneration never saves the draft or creates a new question');
}

test('opening the optional command modal reads the current draft and sends no AI or image requests', async () => {
  const h = regenerationHarness();
  h.blocks[0].content = 'An unsaved teacher correction.';
  h.document.getElementById('regenRemark').value = 'A previous command';
  h.openRegenerateModal();
  assert.equal(h.document.getElementById('regenRemark').value, '');
  assert.equal(h.document.activeElement.id, 'regenRemark');
  assert.equal(h.document.getElementById('regenConfirmBtn').disabled, false);
  assert.deepEqual([h.H.ai.length, h.H.image.length, h.H.uploads.length, h.H.saves.length, h.H.checks.length], [0, 0, 0, 0, 0]);
  await h.confirmRegenerate();
  assert.equal(h.H.checks[0].blocks[0].content, 'An unsaved teacher correction.');
  assert.equal(h.session.instruction, '');
  assert.equal(h.session.stage, 'ready');
});

test('the worksheet heading launches the selected question and delivers its optional command', async () => {
  const h = regenerationHarness({ scope: 'em' });
  h.em.on = true;
  const extra = { id: 'other', type: 'text', content: 'Other question' };
  h.blocks = [...h.blocks, extra];
  h.em.owner.other = 'q2';
  h.em.qs.push({ id: 'q2', key: 'two', title: 'Other question' });
  h.openQuestionRegenerator('one');
  h.document.getElementById('regenRemark').value = '  Use three sealed containers.  ';
  await h.confirmRegenerate();
  assert.equal(h.session.scope, 'em');
  assert.equal(h.session.id, 'q1');
  assert.equal(h.session.instruction, 'Use three sealed containers.');
  assert.ok(h.H.ai[0].prompt.includes('Use three sealed containers.'));
  assert.equal(h.H.checks[0].blocks.length, sampleQuestion().blocks.length);
  assert.deepEqual(h.blocks.find(b => b.id === 'other'), extra);
  assert.equal(h.H.saves.length, 0);
});

test('editing or changing account after opening the command modal refuses the stale request', async () => {
  for (const mutate of [h => { h.blocks[0].content = 'A newer edit after the modal opened'; }, h => { h.user = { uid: 'other', role: 'admin' }; }]) {
    const h = regenerationHarness();
    h.openRegenerateModal();
    mutate(h);
    const before = structuredClone(h.blocks);
    await h.confirmRegenerate();
    assert.equal(h.H.ai.length, 0);
    assert.equal(h.H.image.length, 0);
    assert.equal(h.H.checks.length, 0);
    unchanged(h, before);
  }
});

test('an empty command checks even a green question and proposes an autonomous reviewable regeneration', async () => {
  const h = regenerationHarness();
  h.H.recheckImpl = async () => {
    assert.equal(h.H.ai.length, 0, 'The traffic-light check completes before planning');
    return { state: 'green', findings: [] };
  };
  await start(h);
  assert.equal(h.H.checks.length, 1);
  assert.equal(h.H.ai.length, 1);
  assert.equal(h.session.stage, 'ready');
  assert.equal(h.session.mode, 'regeneration');
  assert.match(h.H.ai[0].prompt, /regenerat/i);
  assert.match(h.H.ai[0].prompt, /different|new variation|meaningful.*chang/i);
  assert.match(h.document.getElementById('tlRepairApplyBtn').textContent, /Approve regeneration plan/);
  assert.deepEqual([h.H.image.length, h.H.uploads.length, h.H.saves.length], [0, 0, 0]);
  unchanged(h);
});

test('a failed initial traffic-light check never proposes or executes regeneration', async () => {
  for (const throws of [false, true]) {
    const h = regenerationHarness();
    h.H.recheckImpl = async () => {
      if (throws) throw Error('Checker unavailable');
      return { state: 'error', findings: [], error: 'Checker unavailable' };
    };
    await start(h);
    assert.equal(h.session.stage, 'error');
    assert.equal(h.H.ai.length, 0);
    assert.equal(h.H.image.length, 0);
    unchanged(h);
    h.tlRepairRevise();
    h.tlRepairDraftChanged('Try this question again.');
    h.H.recheckImpl = async () => ({ state: 'green', findings: [] });
    await h.tlRepairRevise(true);
    await settle();
    assert.equal(h.H.checks.length, 2, 'Revising after a failed check retries the checker before planning');
    assert.equal(h.H.ai.length, 1);
    assert.equal(h.session.stage, 'ready');
    assert.equal(h.H.image.length, 0);
    unchanged(h);
  }
});

test('regeneration cannot run outside an authorized question editor', async () => {
  for (const mutate of [h => { h.user = { uid: 'student', role: 'student' }; }, h => { h.H.createActive = false; }, h => { h.scope = 'bank'; }, h => { h.scope = 'vet'; }]) {
    const h = regenerationHarness();
    mutate(h);
    await start(h);
    assert.deepEqual([h.H.ai.length, h.H.image.length, h.H.checks.length, h.H.saves.length], [0, 0, 0, 0]);
    unchanged(h);
  }
});

test('a new regeneration supersedes a pending check without reviving the older command', async () => {
  const h = regenerationHarness(), initial = deferred();
  h.H.recheckImpl = () => initial.promise;
  const old = h.qregenStart('create', 'q1', 'Old command');
  await settle();
  h.H.recheckImpl = async () => ({ state: 'green', findings: [] });
  await h.qregenStart('create', 'q1', 'Latest command');
  assert.equal(h.session.stage, 'ready');
  initial.resolve({ state: 'green', findings: [] });
  await old;
  await settle();
  assert.equal(h.H.ai.length, 1);
  assert.equal(h.session.instruction, 'Latest command');
  assert.ok(h.H.ai[0].prompt.includes('Latest command'));
  assert.equal(h.H.image.length, 0);
  unchanged(h);
});

test('the optional teacher command and traffic-light findings reach the reviewed plan without editing', async () => {
  const h = regenerationHarness();
  h.H.recheckResult = { state: 'amber', findings: sampleFindings() };
  const command = 'Use three containers instead of two, and keep the answer about mass of air.';
  await start(h, command);
  assert.equal(h.session.stage, 'ready');
  assert.ok(h.H.ai[0].prompt.includes(command));
  for (const finding of sampleFindings()) assert.ok(h.H.ai[0].prompt.includes(finding.title));
  assert.equal(h.H.ai[0].media.length, 2, 'The current diagram and answer image are available to planning');
  assert.deepEqual([h.H.image.length, h.H.uploads.length], [0, 0]);
  unchanged(h);
});

test('approval applies the exact reviewed wording and diagram together, then checks the changed draft', async () => {
  const h = regenerationHarness();
  await start(h, 'Create another question about containers and air.');
  const reviewed = structuredClone(h.session.plan);
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'applied');
  assert.equal(h.H.ai.length, 1, 'Approval does not silently rewrite the reviewed text');
  assert.equal(h.blocks[0].content, reviewed.actions[0].value);
  assert.deepEqual(h.H.image, [{ url: sampleQuestion().blocks[1].url, instruction: reviewed.actions[1].instruction, kind: 'redraw' }]);
  assert.equal(h.blocks[1].url, 'https://fixtures.test/redrawn.png');
  assert.equal(h.blocks[1].answerImg, sampleQuestion().blocks[1].answerImg);
  assert.equal(h.editing, 'q1');
  assert.equal(h.H.saves.length, 0);
  assert.deepEqual(h.bank[0], sampleQuestion());
  assert.equal(h.H.checks.length, 2, 'The checker runs before the plan and after applying it');
  assert.equal(h.H.checks[1].blocks[0].content, reviewed.actions[0].value);
  assert.equal(h.H.checks[1].blocks[1].url, 'https://fixtures.test/redrawn.png');
  assert.equal(h.blocks[0].marks, 2);
  assert.deepEqual(h.editorKeywords, sampleQuestion().answerKeywords);
});

test('the shipped editor audits, updates and undoes dependent top-level answer-key fields', async () => {
  const question = { ...sampleQuestion(), answerKeyNote: 'Original explanation', answerKeyImage: 'https://fixtures.test/key.png', answerKeyDiagramNote: 'Original key diagram labels' };
  const plan = samplePlan(true);
  plan.actions.push(
    { kind: 'replace_text', target: 'q:answerKeyNote', reason: 'Match the new containers.', value: 'Container B holds more air and has greater mass.' },
    { kind: 'replace_text', target: 'q:answerKeyDiagramNote', reason: 'Match the new labels.', value: 'Label the heavier container B.' },
    { kind: 'redraw_image', target: 'q:answerKeyImage', reason: 'Match the regenerated question.', instruction: 'Show container B lower than A and label its greater air mass.' },
  );
  const h = regenerationHarness({ question, plan });
  h.openRegenerateModal();
  await h.confirmRegenerate();
  assert.equal(h.session.stage, 'ready');
  assert.equal(h.H.checks[0].answerKeyImage, question.answerKeyImage, 'The real editor snapshot includes the answer-key diagram in the initial audit');
  assert.equal(h.H.ai[0].media.length, 3, 'The plan sees the answer-key image alongside block diagrams');
  assert.ok(h.H.ai[0].prompt.includes('q:answerKeyImage'));
  assert.equal(h.document.getElementById('questionAnswerKeyImage').value, question.answerKeyImage);
  let call = 0;
  h.H.imageImpl = async () => ++call === 1 ? 'https://fixtures.test/question-new.png' : 'https://fixtures.test/key-new.png';
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'applied');
  assert.equal(h.document.getElementById('questionAnswerKeyNote').value, plan.actions[2].value);
  assert.equal(h.document.getElementById('akdQuestionNote').value, plan.actions[3].value);
  assert.equal(h.document.getElementById('questionAnswerKeyImage').value, 'https://fixtures.test/key-new.png');
  assert.equal(h.H.checks[1].answerKeyImage, 'https://fixtures.test/key-new.png', 'The follow-up audit reads the updated key from its actual editor field');
  assert.equal(h.collectQuestionData().answerKeyNote, plan.actions[2].value, 'Save collects the reviewed answer key');
  assert.equal(h.H.saves.length, 0);
  await h.tlRepairUndo();
  for (const [key, id] of [['answerKeyNote', 'questionAnswerKeyNote'], ['answerKeyImage', 'questionAnswerKeyImage'], ['answerKeyDiagramNote', 'akdQuestionNote']]) {
    assert.equal(h.document.getElementById(id).value, question[key]);
    assert.equal(h.H.checks[2][key], question[key]);
  }
  assert.deepEqual(h.blocks, question.blocks);
  assert.equal(h.H.image.length, 2);
  assert.equal(h.H.saves.length, 0);
});

test('a failed dependent answer-key redraw cannot partially replace the question or its key', async () => {
  const question = { ...sampleQuestion(), answerKeyNote: 'Original key note', answerKeyImage: 'https://fixtures.test/key.png' };
  const plan = samplePlan(true);
  plan.actions.push(
    { kind: 'replace_text', target: 'q:answerKeyNote', reason: 'Match the new question.', value: 'New key note' },
    { kind: 'redraw_image', target: 'q:answerKeyImage', reason: 'Match the new question.', instruction: 'Show the answer to the regenerated question.' },
  );
  const h = regenerationHarness({ question, plan });
  await start(h);
  let call = 0;
  h.H.imageImpl = async () => {
    if (++call === 2) throw Error('Answer-key redraw failed');
    return 'https://fixtures.test/question-new.png';
  };
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'error');
  unchanged(h, question.blocks);
  assert.equal(h.document.getElementById('questionAnswerKeyImage').value, question.answerKeyImage);
  assert.equal(h.document.getElementById('questionAnswerKeyNote').value, question.answerKeyNote);
  assert.equal(h.H.checks.length, 1);
});

test('answer-key crop provenance survives editor application, Save collection and Undo', async () => {
  const question = { ...sampleQuestion(), answerKeyImage: 'https://fixtures.test/key.png', imageSources: {
    'q:answerKeyImage': { url: 'https://fixtures.test/key-original.png', imageUrl: 'https://fixtures.test/key.png', original: true, box_2d: [100, 100, 700, 800] },
  } };
  const plan = samplePlan();
  plan.actions.push({ kind: 'recrop_image', target: 'q:answerKeyImage', reason: 'Restore all labels.', instruction: 'Keep the entire answer diagram and every label.' });
  const h = regenerationHarness({ question, plan });
  await start(h);
  h.session.manualCrops['q:answerKeyImage'] = {
    dataUrl: 'data:image/png;base64,Y3JvcA==', box: [100, 100, 800, 900],
    source: { id: 'source-1', url: 'https://fixtures.test/key-original.png', original: true },
  };
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'applied');
  assert.equal(h.imageSources['q:answerKeyImage'].url, 'https://fixtures.test/key-original.png');
  assert.equal(h.imageSources['q:answerKeyImage'].imageUrl, 'https://fixtures.test/generated.png');
  assert.deepEqual(h.collectQuestionData().imageSources, h.imageSources, 'The real Save collector retains the new crop source');
  assert.deepEqual(h.tlRepairRead('create', 'q1').imageSources, h.imageSources);
  assert.deepEqual(h.bank[0].imageSources, question.imageSources, 'The saved bank still holds the original until Save');
  await h.tlRepairUndo();
  assert.deepEqual(h.imageSources, question.imageSources);
  assert.deepEqual(h.collectQuestionData().imageSources, question.imageSources);
  assert.equal(h.H.saves.length, 0);
});

test('worksheet answer-key regeneration and Undo preserve metadata for the next Save', async () => {
  const question = { ...sampleQuestion(), answerKeyNote: 'Original key note', answerKeyImage: 'https://fixtures.test/key.png' };
  const plan = samplePlan();
  plan.actions.push(
    { kind: 'replace_text', target: 'q:answerKeyNote', reason: 'Match the variation.', value: 'Container B has greater mass.' },
    { kind: 'redraw_image', target: 'q:answerKeyImage', reason: 'Match the variation.', instruction: 'Show B with greater mass than A.' },
  );
  const h = regenerationHarness({ question, plan, scope: 'em' });
  h.em.on = true;
  await start(h);
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'applied');
  assert.equal(h.em.qs[0].repairMeta.answerKeyNote, plan.actions[1].value);
  assert.equal(h.em.qs[0].repairMeta.answerKeyImage, 'https://fixtures.test/redrawn.png');
  assert.equal(h.H.checks[1].answerKeyImage, 'https://fixtures.test/redrawn.png');
  assert.deepEqual(h.bank[0], question);
  await h.tlRepairUndo();
  assert.equal(h.em.qs[0].repairMeta, undefined);
  assert.equal(h.H.checks[2].answerKeyImage, question.answerKeyImage);
  assert.equal(h.H.saves.length, 0);
});

test('worksheet regeneration changes only the selected question and leaves other answers and blanks intact', async () => {
  const h = regenerationHarness({ scope: 'em' });
  h.em.on = true;
  const extra = { id: 'other', type: 'plainanswer', content: 'Another question answer remains untouched.' };
  h.blocks = [...h.blocks, extra];
  h.em.owner.other = 'q2';
  h.em.qs.push({ id: 'q2', key: 'two', title: 'Other question' });
  h.editorKeywords.other = ['unrelated'];
  h.selectedBlanks.other = [1];
  await start(h);
  assert.deepEqual(h.H.checks[0].blocks, sampleQuestion().blocks, 'The initial checker receives only this question');
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'applied');
  assert.deepEqual(h.blocks.find(b => b.id === 'other'), extra);
  assert.equal(h.em.owner.other, 'q2');
  assert.equal(h.em.qs[1].title, 'Other question');
  assert.deepEqual(h.editorKeywords.other, ['unrelated']);
  assert.deepEqual(h.selectedBlanks.other, [1]);
  assert.equal(h.H.saves.length, 0);
  assert.equal(h.H.checks[1].blocks.length, sampleQuestion().blocks.length);
});

test('a missing diagram is generated and uploaded only after the regeneration plan is approved', async () => {
  const question = sampleQuestion();
  question.blocks[1].url = '';
  const plan = { actions: [samplePlan().actions[0], {
    kind: 'generate_image', target: 'block:diagram:url', reason: 'Provide the changed figure.',
    instruction: 'Draw two airtight containers on a balance, with container B holding more air.',
  }], notes: [] };
  const h = regenerationHarness({ question, plan });
  await start(h);
  assert.deepEqual([h.H.image.length, h.H.uploads.length], [0, 0]);
  assert.deepEqual(h.blocks, question.blocks);
  await h.tlRepairApply();
  assert.equal(h.H.image.length, 1);
  assert.equal(h.H.uploads.length, 1);
  assert.equal(h.H.image[0].media.purpose, 'education');
  assert.equal(h.blocks[1].url, 'https://fixtures.test/generated.png');
  assert.equal(h.H.saves.length, 0);
});

test('an empty action list cannot be approved and preserves the original question', async () => {
  const h = regenerationHarness({ plan: { actions: [], notes: ['The intended diagram cannot be inferred safely.'] } });
  await start(h);
  assert.equal(h.session.stage, 'ready');
  assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled, true);
  await h.tlRepairApply();
  assert.equal(h.H.image.length, 0);
  assert.equal(h.H.checks.length, 1);
  unchanged(h);
});

test('a title, answer, key or unchanged-stem proposal cannot masquerade as question regeneration', async () => {
  const question = { ...sampleQuestion(), answerKeyNote: 'Old key note', answerKeyImage: 'https://fixtures.test/key.png' };
  const actions = [
    { kind: 'replace_text', target: 'q:title', value: 'A different title' },
    { kind: 'replace_text', target: 'block:answer:content', value: 'A different model answer' },
    { kind: 'replace_text', target: 'q:answerKeyNote', value: 'A different key note' },
    { kind: 'redraw_image', target: 'q:answerKeyImage', instruction: 'Redraw only the answer diagram.' },
    { kind: 'replace_text', target: 'block:wording:content', value: 'Two containers of water was placed on the balance.' },
  ];
  for (const action of actions) {
    const h = regenerationHarness({ question, plan: { actions: [{ ...action, reason: 'Suggested variation.' }], notes: [] } });
    await start(h);
    assert.equal(h.session.stage, 'error');
    assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled, true);
    await h.tlRepairApply();
    assert.equal(h.H.image.length, 0);
    unchanged(h, question.blocks);
  }
});

test('editing, switching question, changing account or leaving author mode invalidates the approved plan', async () => {
  const mutations = [
    h => { h.blocks[0].content = 'A newer teacher edit.'; },
    h => { h.editing = 'q2'; },
    h => { h.panelId = 'q2'; },
    h => { h.scope = 'bank'; },
    h => { h.user = { uid: 'another', role: 'admin' }; },
    h => { h.H.owner = 'another-bank'; },
    h => { h.practice = { uid: 'student' }; },
  ];
  for (const mutate of mutations) {
    const h = regenerationHarness();
    await start(h);
    mutate(h);
    const before = structuredClone(h.blocks);
    await h.tlRepairApply();
    assert.equal(h.session.stage, 'error');
    assert.equal(h.H.image.length, 0);
    unchanged(h, before);
  }
});

test('cancelling a pending traffic-light check cannot launch a late regeneration plan', async () => {
  const h = regenerationHarness(), pendingCheck = deferred();
  h.H.recheckImpl = () => pendingCheck.promise;
  const pending = h.qregenStart('create', 'q1', 'Use different containers.');
  await settle();
  assert.equal(h.H.checks.length, 1);
  assert.equal(h.H.ai.length, 0);
  h.tlRepairCancel();
  pendingCheck.resolve({ state: 'green', findings: [] });
  await pending;
  await settle();
  assert.equal(h.session.stage, 'cancelled');
  assert.equal(h.H.ai.length, 0);
  unchanged(h);
});

test('closing the panel while its initial check is running ignores the late check', async () => {
  const h = regenerationHarness(), pendingCheck = deferred();
  h.H.recheckImpl = () => pendingCheck.promise;
  const pending = h.qregenStart('create', 'q1', 'Use different containers.');
  await settle();
  assert.equal(h.tlRepairReset(), true);
  pendingCheck.resolve({ state: 'green', findings: [] });
  await pending;
  assert.equal(h.session, null);
  assert.equal(h.H.ai.length, 0);
  unchanged(h);
});

test('cancelled AI planning cannot revive its proposal or generate a diagram', async () => {
  const h = regenerationHarness(), model = deferred();
  h.H.aiImpl = () => model.promise;
  const pending = h.qregenStart('create', 'q1');
  await settle();
  assert.equal(h.session.stage, 'planning');
  h.tlRepairCancel();
  model.resolve(samplePlan(true));
  await pending;
  await settle();
  assert.equal(h.session.stage, 'cancelled');
  assert.equal(h.session.plan, null);
  assert.equal(h.H.image.length, 0);
  unchanged(h);
});

test('cancelled image work cannot apply late wording or image results', async () => {
  const h = regenerationHarness(), image = deferred();
  await start(h);
  h.H.imageImpl = () => image.promise;
  const pending = h.tlRepairApply();
  await settle();
  h.tlRepairCancel();
  image.resolve('https://fixtures.test/late.png');
  await pending;
  assert.equal(h.session.stage, 'cancelled');
  assert.equal(h.H.checks.length, 1);
  unchanged(h);
});

test('a newer edit or account change during image work cannot be overwritten', async () => {
  for (const mutate of [h => { h.blocks[0].content = 'Newer teacher edit'; }, h => { h.user = { uid: 'other', role: 'admin' }; }]) {
    const h = regenerationHarness(), image = deferred();
    await start(h);
    h.H.imageImpl = () => image.promise;
    const pending = h.tlRepairApply();
    await settle();
    mutate(h);
    const before = structuredClone(h.blocks);
    image.resolve('https://fixtures.test/late.png');
    await pending;
    assert.equal(h.session.stage, 'error');
    assert.equal(h.H.checks.length, 1);
    unchanged(h, before);
  }
});

test('image failure is atomic: reviewed wording is not partially applied', async () => {
  const h = regenerationHarness();
  await start(h);
  h.H.imageImpl = async () => { throw Error('The diagram service failed.'); };
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'error');
  assert.equal(h.H.checks.length, 1);
  unchanged(h);
});

test('a fresh autonomous revision still requires approval and does not apply the old plan', async () => {
  const h = regenerationHarness();
  await start(h, 'Use different containers.');
  h.tlRepairRevise();
  h.tlRepairDraftChanged('');
  assert.equal(h.document.getElementById('tlRepairApplyBtn').disabled, true);
  assert.equal(h.document.getElementById('tlRepairUpdateBtn').disabled, false, 'Blank command means autonomous regeneration');
  await h.tlRepairApply();
  unchanged(h);
  const next = samplePlan(true);
  next.actions[0].value = 'Three sealed containers are placed on a balance.';
  h.H.aiReply = next;
  await h.tlRepairRevise(true);
  assert.equal(h.session.stage, 'ready');
  assert.equal(h.session.instruction, '');
  assert.equal(h.H.ai.length, 2);
  assert.equal(h.session.plan.actions[0].value, next.actions[0].value);
  assert.equal(h.H.image.length, 0);
  unchanged(h);
});

test('follow-up findings create a repair proposal which awaits separate approval', async () => {
  const h = regenerationHarness();
  await start(h);
  h.H.recheckResult = { state: 'amber', findings: [sampleFindings()[0]] };
  h.H.aiReply = { actions: [{ ...samplePlan(true).actions[1], instruction: 'Keep the new question and correct the beam height.' }], notes: [] };
  await h.tlRepairApply();
  assert.equal(h.session.stage, 'ready');
  assert.notEqual(h.session.mode, 'regeneration', 'A recheck fixes this regenerated question instead of creating another variation');
  assert.equal(h.H.ai.length, 2);
  assert.equal(h.H.image.length, 1, 'The follow-up repair still awaits its own approval');
  assert.equal(h.H.saves.length, 0);
  assert.ok(h.session.undo);
  assert.match(h.session.message, /approve this new plan/);
});

test('Undo restores the original editor draft without regenerating or creating a new question', async () => {
  const h = regenerationHarness();
  await start(h);
  await h.tlRepairApply();
  await h.tlRepairUndo();
  assert.equal(h.editing, 'q1');
  assert.equal(h.H.ai.length, 1);
  assert.equal(h.H.image.length, 1);
  assert.equal(h.H.checks.length, 3);
  unchanged(h);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = 0;
  for (const item of cases) {
    try { await item.run(); console.log('PASS', item.name); }
    catch (error) { failed++; console.error('FAIL', item.name, error.stack); }
  }
  console.log(cases.length - failed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}
