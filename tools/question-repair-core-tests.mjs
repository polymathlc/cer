import test from 'node:test';
import assert from 'node:assert/strict';
import { questionRepairTargets, normalizeQuestionRepairPlan, applyQuestionRepairPlan } from '../question-repair-core.mjs';

const imageOne = '<img class="diagram" data-src="ignore" src="https://example.test/first.png" width="150">';
const imageTwo = "<img src='https://example.test/second.png' alt='second > first'>";
const fixture = () => ({
  id: 'question-1', title: 'Compare mass', topic: 'Matter', category: 'Multiple Choice Question',
  status: 'approved', releaseOn: '2027-01-01', holdBack: true, tags: ['air'], los: ['objective-1'],
  source: { paper: 'original', page: 3 }, answerKeyImage: 'https://example.test/key.png',
  autoCheck: { state: 'red', sig: 'original-signature' },
  blocks: [
    { id: 'stem', type: 'text', content: '<p>Compare ' + imageOne + ' with ' + imageTwo + '.</p>', marks: 2, part: 'a' },
    { id: 'figure', type: 'image', url: 'https://example.test/balance.png', caption: 'Balance', scale: 0.7,
      printImg: 'lg', annotate: false, answerImg: 'https://example.test/marked.png', answerKey: 'B is lower.' },
    { id: 'choices', type: 'mcq', options: [{ id: 'left', text: 'A lower', weight: 1 }, { id: 'right', text: 'B lower' }], correctId: 'left' },
    { id: 'cer', type: 'answer', claim: '<b>A is heavier.</b>', evidence: 'A is lower.', reasoning: 'More mass pulls down.' },
    { id: 'table', type: 'table', data: [['Volume', '300 cm<sup>3</sup>'], ['Mass', '20 g']], colWidths: [50, 50], headerRow: true },
    { id: 'lines', type: 'answerLine', answer: 'B', label: 'Ans:', lineLength: 30 },
    { id: 'pad', type: 'workingSpace', annotate: true, answerKey: 'Draw a horizontal beam.', lines: 6 },
  ],
  answerKeywords: { cer_claim: [0], cer_evidence: [1], other: [2] },
  keywords: { cer_claim: [3], other: [4] },
  blanks: { cer_claim: { 0: true }, cer_reasoning: { 1: true }, other: { 2: true } },
});
const action = (kind, target, extra = {}) => ({ kind, target, reason: 'Correct the checker finding.', ...extra });
const normalized = (q, actions) => normalizeQuestionRepairPlan({ actions }, q);
const apply = (q, actions, images = {}, makeId) => applyQuestionRepairPlan(q, { actions }, images, makeId);

test('catalog gives stable, explicit targets including inline images and existing metadata', () => {
  const targets = questionRepairTargets(fixture());
  const find = id => targets.find(t => t.id === id);
  assert.equal(find('block:stem:content').value, 'Compare [[IMAGE_1]] with [[IMAGE_2]].');
  assert.equal(find('block:stem:content:inline:1').value, 'https://example.test/first.png');
  assert.equal(find('block:stem:content:inline:2').value, 'https://example.test/second.png');
  assert.deepEqual(find('block:choices:correctId').choices.map(x => x.id), ['left', 'right']);
  assert.equal(find('block:table:cell:0:1').value, '300 cm³');
  assert.equal(find('block:stem:content').label, 'Question wording (item 1)');
  assert.equal(find('block:cer:claim').label, 'Claim (item 4)');
  assert.equal(find('block:choices:option:left').label, 'Choice 1 (item 3)');
  assert.equal(find('block:figure:url').label, 'Diagram (item 2)');
  assert.ok(find('block:figure:answerImg'));
  assert.ok(find('block:pad:answerKey'));
  assert.ok(find('block:lines:answer'));
  assert.equal(find('new:image').kind, 'insertion');
});

test('targeted wording and image edits apply together without mutating the original', () => {
  const q = fixture(), before = structuredClone(q);
  const actions = [
    action('redraw_image', 'block:figure:url', { instruction: 'Draw option 2 with a horizontal beam; keep every other option unchanged.' }),
    action('replace_text', 'block:stem:content', { value: 'Compare the masses in [[IMAGE_1]] and [[IMAGE_2]].' }),
    action('replace_text', 'block:cer:claim', { value: 'B is heavier.' }),
    action('select_option', 'block:choices:correctId', { value: 'right' }),
  ];
  const result = apply(q, actions, { a1: 'https://example.test/repaired.png' });
  assert.deepEqual(q, before);
  assert.equal(result.question.blocks[0].content, 'Compare the masses in ' + imageOne + ' and ' + imageTwo + '.');
  assert.equal(result.question.blocks[1].url, 'https://example.test/repaired.png');
  assert.equal(result.question.blocks[1].printImg, 'lg');
  assert.equal(result.question.blocks[1].answerImg, q.blocks[1].answerImg);
  assert.equal(result.question.blocks[2].correctId, 'right');
  assert.deepEqual(result.question.blocks[2].options, q.blocks[2].options);
  assert.equal(result.question.blocks[3].claim, 'B is heavier.');
  assert.deepEqual(result.changedTargets, actions.map(a => a.target));
  for (const key of ['id', 'status', 'releaseOn', 'holdBack', 'tags', 'los', 'source', 'answerKeyImage', 'autoCheck']) {
    assert.deepEqual(result.question[key], q[key]);
  }
  assert.deepEqual(result.question.blocks.slice(4), q.blocks.slice(4));
});

test('only changed field word-position selections are cleared', () => {
  const q = fixture();
  const result = apply(q, [action('replace_text', 'block:cer:claim', { value: 'B is heavier.' })]).question;
  assert.deepEqual(result.answerKeywords, { cer_evidence: [1], other: [2] });
  assert.deepEqual(result.keywords, { other: [4] });
  assert.deepEqual(result.blanks, { cer_reasoning: { 1: true }, other: { 2: true } });
  assert.deepEqual(q.answerKeywords.cer_claim, [0]);
});

test('an unchanged text action preserves original formatting and selections', () => {
  const q = fixture();
  const result = apply(q, [action('replace_text', 'block:cer:claim', { value: 'A is heavier.' })]);
  assert.deepEqual(result.question, q);
  assert.deepEqual(result.changedTargets, []);
});

test('inline image follows its original token when wording reorders images', () => {
  const q = fixture();
  const result = apply(q, [
    action('redraw_image', 'block:stem:content:inline:1', { instruction: 'Change the first label to A.' }),
    action('replace_text', 'block:stem:content', { value: 'Second [[IMAGE_2]], then first [[IMAGE_1]].' }),
    action('redraw_image', 'block:stem:content:inline:2', { instruction: 'Change the second label to B.' }),
  ], { a1: 'https://example.test/a.png', a3: 'https://example.test/b.png' }).question;
  assert.equal(result.blocks[0].content,
    'Second <img src="https://example.test/b.png" alt=\'second > first\'>, then first '
    + '<img class="diagram" data-src="ignore" src="https://example.test/a.png" width="150">.');
});

test('inline-only edit keeps all surrounding HTML and untouched image tags exactly', () => {
  const q = fixture();
  const result = apply(q, [action('redraw_image', 'block:stem:content:inline:2', { instruction: 'Fix this balance.' })],
    new Map([['a1', 'https://example.test/new.png']])).question;
  assert.equal(result.blocks[0].content, '<p>Compare ' + imageOne + ' with <img src="https://example.test/new.png" alt=\'second > first\'>.</p>');
});

test('inline source extraction ignores src-like strings inside other attributes', () => {
  const q = fixture();
  q.blocks[0].content = '<img alt="A label with src=\'https://wrong.test/alt.png\'" data-src="https://wrong.test/lazy.png" src="https://example.test/right.png">';
  const catalog = questionRepairTargets(q);
  assert.equal(catalog.find(t => t.id === 'block:stem:content:inline:1').value, 'https://example.test/right.png');
  const result = apply(q, [action('redraw_image', 'block:stem:content:inline:1', { instruction: 'Correct the label.' })],
    { a1: 'https://example.test/new.png' }).question;
  assert.equal(result.blocks[0].content, '<img alt="A label with src=\'https://wrong.test/alt.png\'" data-src="https://wrong.test/lazy.png" src="https://example.test/new.png">');
});

test('plain text is escaped for editable HTML without losing science comparisons', () => {
  const q = fixture();
  const result = apply(q, [action('replace_text', 'block:cer:claim', { value: 'A < B & B > C.\nUse "mass".' })]).question;
  assert.equal(result.blocks[3].claim, 'A &lt; B &amp; B &gt; C.<br>Use &quot;mass&quot;.');
});

test('table cell repair retains array or Firestore object shape and table settings', () => {
  for (const objectShape of [false, true]) {
    const q = fixture();
    if (objectShape) q.blocks[4].data = { 0: { 0: 'Volume', 1: '300 cm<sup>3</sup>' }, 1: { 0: 'Mass', 1: '20 g' } };
    const result = apply(q, [action('replace_text', 'block:table:cell:1:1', { value: '30 g' })]).question;
    assert.equal(Array.isArray(result.blocks[4].data), !objectShape);
    assert.equal(result.blocks[4].data[1][1], '30 g');
    assert.equal(result.blocks[4].data[0][1], '300 cm<sup>3</sup>');
    assert.deepEqual(result.blocks[4].colWidths, [50, 50]);
    assert.equal(result.blocks[4].headerRow, true);
  }
});

test('table inline image can be repaired alongside its cell wording', () => {
  const q = fixture();
  q.blocks[4].data[1][1] = '20 g ' + imageOne;
  const result = apply(q, [
    action('replace_text', 'block:table:cell:1:1', { value: '30 g [[IMAGE_1]]' }),
    action('redraw_image', 'block:table:cell:1:1:inline:1', { instruction: 'Change 20 g to 30 g.' }),
  ], { a2: 'https://example.test/thirty.png' }).question;
  assert.equal(result.blocks[4].data[1][1], '30 g <img class="diagram" data-src="ignore" src="https://example.test/thirty.png" width="150">');
});

test('option wording and choice corrections retain option IDs and metadata', () => {
  const q = fixture();
  const result = apply(q, [
    action('replace_text', 'block:choices:option:left', { value: 'A and B balance' }),
    action('select_option', 'block:choices:correctId', { value: 'right' }),
  ]).question;
  assert.deepEqual(result.blocks[2], { id: 'choices', type: 'mcq',
    options: [{ id: 'left', text: 'A and B balance', weight: 1 }, { id: 'right', text: 'B lower' }], correctId: 'right' });
});

test('MCQ option text exposes, preserves and independently redraws inline option diagrams', () => {
  const q = fixture();
  q.blocks[2].options[0].text = '<b>First</b> ' + imageOne + '<br>Second ' + imageTwo;
  const before = structuredClone(q);
  const targets = questionRepairTargets(q);
  assert.equal(targets.find(t => t.id === 'block:choices:option:left').value, 'First [[IMAGE_1]]\nSecond [[IMAGE_2]]');
  assert.equal(targets.find(t => t.id === 'block:choices:option:left:inline:2').value, 'https://example.test/second.png');
  assert.throws(() => normalized(q, [action('replace_text', 'block:choices:option:left', { value: 'Just words' })]), /image token/i);
  const result = apply(q, [
    action('redraw_image', 'block:choices:option:left:inline:1', { instruction: 'Make the beam horizontal.' }),
    action('replace_text', 'block:choices:option:left', { value: 'Compare [[IMAGE_2]] to [[IMAGE_1]].' }),
    action('select_option', 'block:choices:correctId', { value: 'right' }),
  ], { a1: 'https://example.test/option-balance.png' }).question;
  assert.equal(result.blocks[2].options[0].text, 'Compare ' + imageTwo + ' to '
    + '<img class="diagram" data-src="ignore" src="https://example.test/option-balance.png" width="150">.');
  assert.deepEqual(result.blocks[2].options.map(o => o.id), ['left', 'right']);
  assert.equal(result.blocks[2].options[0].weight, 1);
  assert.deepEqual(result.blocks[2].options[1], q.blocks[2].options[1]);
  assert.equal(result.blocks[2].correctId, 'right');
  assert.deepEqual(q, before);
});

test('a diagram-only repair preserves MCQ option formatting exactly', () => {
  const q = fixture();
  q.blocks[2].options[0].text = '<b>Option</b> ' + imageOne;
  const result = apply(q, [action('redraw_image', 'block:choices:option:left:inline:1', { instruction: 'Make the beam level.' })],
    { a1: 'https://example.test/level-option.png' }).question;
  assert.equal(result.blocks[2].options[0].text,
    '<b>Option</b> <img class="diagram" data-src="ignore" src="https://example.test/level-option.png" width="150">');
});

test('imported answer, mistake and answer-key rich text keep inline diagrams and line breaks', () => {
  for (const [type, field] of [['answerKey', 'text'], ['commonMistake', 'text'], ['studentAnswer', 'answer']]) {
    const q = fixture();
    q.blocks.push({ id: 'extra', type, [field]: '<b>First line</b><br>' + imageOne, color: 'teal' });
    const target = 'block:extra:' + field;
    const catalog = questionRepairTargets(q);
    assert.equal(catalog.find(t => t.id === target).value, 'First line\n[[IMAGE_1]]');
    assert.equal(catalog.find(t => t.id === target + ':inline:1').value, 'https://example.test/first.png');
    assert.throws(() => normalized(q, [action('replace_text', target, { value: 'Lose the diagram' })]), /image token/);
    const result = apply(q, [
      action('replace_text', target, { value: 'Correct line\n[[IMAGE_1]]' }),
      action('redraw_image', target + ':inline:1', { instruction: 'Correct the label.' }),
    ], { a2: 'https://example.test/correct-extra.png' }).question;
    assert.equal(result.blocks.at(-1)[field], 'Correct line<br><img class="diagram" data-src="ignore" src="https://example.test/correct-extra.png" width="150">');
    assert.equal(result.blocks.at(-1).color, 'teal');
  }
});

test('explanation diagrams are visible as distinct image targets and keep their settings', () => {
  const q = fixture();
  q.blocks.push({ id: 'why', type: 'explanation', content: 'Equal masses balance.', url: 'https://example.test/explanation.png', diagramNote: 'Use both pans.', scale: 0.6 });
  const catalog = questionRepairTargets(q);
  assert.equal(catalog.find(t => t.id === 'block:why:url').value, 'https://example.test/explanation.png');
  const result = apply(q, [action('redraw_image', 'block:why:url', { instruction: 'Correct the equal-mass diagram.' })],
    { a1: 'https://example.test/explanation-fixed.png' }).question;
  assert.deepEqual(result.blocks.at(-1), { ...q.blocks.at(-1), url: 'https://example.test/explanation-fixed.png' });
});

test('insertions use fresh IDs and maintain action order after their existing anchor', () => {
  const q = fixture();
  let n = 0;
  const result = apply(q, [
    action('add_block', 'new:image', { instruction: 'Draw a horizontal balance.', afterBlockId: 'stem' }),
    action('add_block', 'new:plainanswer', { value: 'The balance is level.', afterBlockId: 'stem' }),
    action('add_block', 'new:explanation', { value: 'Equal masses balance.' }),
  ], { a1: 'https://example.test/new-diagram.png' }, () => 'new-' + (++n)).question;
  assert.deepEqual(result.blocks.slice(0, 4).map(b => b.id), ['stem', 'new-1', 'new-2', 'figure']);
  assert.equal(result.blocks[1].url, 'https://example.test/new-diagram.png');
  assert.equal(result.blocks[2].type, 'plainanswer');
  assert.equal(result.blocks.at(-1).type, 'explanation');
  assert.equal(q.blocks.length, 7);
});

test('missing image and annotation answers use their own image target', () => {
  const q = fixture();
  q.blocks[1].url = '';
  const result = apply(q, [
    action('generate_image', 'block:figure:url', { instruction: 'Draw the missing balance.' }),
    action('generate_image', 'block:pad:answerImg', { instruction: 'Show the correct labelled answer.' }),
    action('replace_text', 'block:pad:answerKey', { value: 'The beam is horizontal.' }),
  ], { a1: 'https://example.test/balance-new.png', a2: 'data:image/png;base64,aGVsbG8=' }).question;
  assert.equal(result.blocks[1].url, 'https://example.test/balance-new.png');
  assert.equal(result.blocks[6].answerImg, 'data:image/png;base64,aGVsbG8=');
  assert.equal(result.blocks[6].answerKey, 'The beam is horizontal.');
});

test('generation cannot bypass the reference edit of an existing picture', () => {
  const q = fixture();
  assert.throws(() => normalized(q, [action('generate_image', 'block:figure:url', { instruction: 'Draw a different balance.' })]), /must use a redraw/);
  assert.throws(() => normalized(q, [action('generate_image', 'block:stem:content:inline:1', { instruction: 'Draw a new picture.' })]), /must use a redraw/);
  q.blocks[1].url = '';
  assert.throws(() => normalized(q, [action('redraw_image', 'block:figure:url', { instruction: 'Edit the missing picture.' })]), /needs an existing picture/);
});

test('normalizer does not mutate source action objects and reassigns deterministic IDs', () => {
  const q = fixture();
  const raw = { actions: [action('replace_text', 'q:title', { value: 'Corrected title', id: 'evil-id' })], notes: ['Keep the rest unchanged.'] };
  const before = structuredClone(raw);
  const plan = normalizeQuestionRepairPlan(raw, q);
  assert.deepEqual(raw, before);
  assert.equal(plan.actions[0].id, 'a1');
  assert.deepEqual(plan.notes, raw.notes);
});

test('malformed action shapes, arbitrary paths and prototype targets are rejected', () => {
  const q = fixture();
  const bad = [
    { actions: 'wrong' }, { actions: [null] }, { actions: [{ ...action('replace_text', 'q:title', { value: 'x' }), path: ['__proto__', 'polluted'] }] },
    { actions: [action('replace_text', '__proto__.polluted', { value: 'yes' })] },
    { actions: [action('run_code', 'q:title', { value: 'alert(1)' })] },
    { actions: [action('replace_text', 'q:title', { value: { html: '<b>bad</b>' } })] },
    { actions: [action('select_option', 'block:choices:correctId', { value: 'missing' })] },
    { actions: [action('select_option', 'q:title', { value: 'right' })] },
    { actions: [action('replace_text', 'block:figure:url', { value: 'https://unapproved.test/image.png' })] },
    { actions: [action('redraw_image', 'block:figure:url', { instruction: 'Fix it', value: 'https://unapproved.test/image.png' })] },
  ];
  for (const raw of bad) assert.throws(() => normalizeQuestionRepairPlan(raw, q), /Repair plan:/);
  assert.equal({}.polluted, undefined);
});

test('new markup, duplicated targets, oversized plans and unbounded text are rejected', () => {
  const q = fixture();
  const edit = action('replace_text', 'q:title', { value: 'Title' });
  for (const markup of ['<img src="https://x.test/y">', '<script>alert(1)</script>', '<b>text</b>']) {
    assert.throws(() => normalized(q, [action('replace_text', 'q:title', { value: markup })]), /plain text/);
  }
  assert.throws(() => normalized(q, [edit, edit]), /conflict/);
  assert.throws(() => normalized(q, Array(21).fill(edit)), /At most 20/);
  assert.throws(() => normalized(q, [action('replace_text', 'q:title', { value: 'x'.repeat(16001) })]), /too long/);
  assert.throws(() => normalized(q, [action('redraw_image', 'block:figure:url', { instruction: '' })]), /empty/);
  assert.throws(() => normalized(q, [action('replace_text', 'q:title', { value: 'x', reason: '' })]), /empty/);
});

test('wording edits cannot lose, duplicate, fabricate or misspell an inline image token', () => {
  const q = fixture();
  for (const value of ['No pictures', '[[IMAGE_1]] only', '[[IMAGE_1]] [[IMAGE_1]]', '[[IMAGE_1]] [[IMAGE_3]]',
    '[[IMAGE_1]] [[IMAGE_2]] [[IMAGE_99]]', '[[IMAGE_1]] [[IMAGE_2]] [[IMAGE_x]]']) {
    assert.throws(() => normalized(q, [action('replace_text', 'block:stem:content', { value })]), /image token/i);
  }
  assert.throws(() => normalized(q, [action('replace_text', 'q:title', { value: '[[IMAGE_1]]' })]), /image token/i);
});

test('all generated images must be present and safe before a candidate can be returned', () => {
  const q = fixture(), before = structuredClone(q);
  const actions = [action('replace_text', 'q:title', { value: 'Changed' }),
    action('redraw_image', 'block:figure:url', { instruction: 'Fix the beam.' })];
  for (const url of [undefined, '', 'javascript:alert(1)', 'file:///secret', 'https://x.test/a"onerror="oops', 'data:text/html;base64,aGVsbG8=']) {
    assert.throws(() => apply(q, actions, { a2: url }), /picture/);
    assert.deepEqual(q, before);
  }
});

test('insertion cannot use unknown anchors, duplicate IDs, arbitrary block types or picture URLs', () => {
  const q = fixture();
  assert.throws(() => normalized(q, [action('add_block', 'new:plainanswer', { value: 'Answer', afterBlockId: 'unknown' })]), /position/);
  assert.throws(() => normalized(q, [action('add_block', 'new:script', { value: 'bad' })]), /Unknown target/);
  assert.throws(() => normalized(q, [action('add_block', 'new:image', { value: 'https://x.test/image', instruction: 'Draw' })]), /never a URL/);
  assert.throws(() => apply(q, [action('add_block', 'new:plainanswer', { value: 'Answer' })], {}, () => 'stem'), /already used/);
  assert.throws(() => apply(q, [action('add_block', 'new:plainanswer', { value: 'Answer' })]), /identifier factory/);
});

test('ambiguous source identifiers refuse a repair instead of changing an arbitrary block', () => {
  const q = fixture();
  q.blocks[1].id = q.blocks[0].id;
  assert.throws(() => questionRepairTargets(q), /duplicate block/);
  const other = fixture();
  other.blocks[2].options[1].id = other.blocks[2].options[0].id;
  assert.throws(() => questionRepairTargets(other), /unique stable/);
});
