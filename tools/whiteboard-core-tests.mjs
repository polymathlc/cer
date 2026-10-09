import test from 'node:test';
import assert from 'node:assert/strict';
import '../question-apps.js';
import { sampleQuestions, fixtureImage } from './summary-sheet-fixtures.mjs';
import {
  WB_LIMITS, newWhiteboard, createWhiteboardCard, normalizeWhiteboard, whiteboardQuestionSnapshot,
  whiteboardPublicSnapshot, whiteboardQuestionIds, normalizeWhiteboardApp, whiteboardQuestionHtml,
  whiteboardWorksheetHtml, sanitizeWhiteboardQuestionHtml, whiteboardBounds, worldToScreen, screenToWorld,
} from '../whiteboard-core.mjs';

function boardWith(question = sampleQuestions()[0]) {
  const board = newWhiteboard({ title: 'Heat revision', createdBy: 'teacher-1' }, 'wb-1');
  board.cards.push(createWhiteboardCard(question, { x: -600, y: 80, width: 440 }, 'card-1'));
  return board;
}

test('many named boards keep independent snapshots and unbounded positions without editing the bank', () => {
  const source = sampleQuestions()[0], before = structuredClone(source), board = boardWith(source);
  const other = newWhiteboard({ title: 'Light revision', createdBy: 'teacher-1' }, 'wb-2');
  board.cards[0].question.blocks[0].content = 'Teacher changed this snapshot only';
  assert.deepEqual(source, before);
  assert.equal(board.cards[0].x, -600); assert.equal(board.cards[0].width, 440);
  assert.equal(other.title, 'Light revision'); assert.equal(other.cards.length, 0);
  assert.equal(normalizeWhiteboard(other).kind, 'infinite-whiteboard');
  assert.equal(newWhiteboard().id.startsWith('wb_'), true);
});

test('question snapshot includes complete stem, table and every MCQ option while excluding model answers and answer diagrams', () => {
  const original = sampleQuestions()[0], snapshot = whiteboardQuestionSnapshot(original);
  const json = JSON.stringify(snapshot), html = whiteboardQuestionHtml(snapshot);
  for (const name of ['apparatus', 'table-figure', 'option-a', 'option-b']) {
    assert.ok(json.includes(fixtureImage(name)), name + ' remains in the snapshot');
    assert.ok(html.includes(fixtureImage(name)), name + ' remains in the rendered question');
  }
  assert.match(html, /80°C/); assert.match(html, /50/); assert.match(html, /Heat moves to the surroundings/);
  assert.equal(snapshot.blocks.find(block => block.type === 'table').rows, 3);
  assert.equal(snapshot.blocks.find(block => block.type === 'table').cols, 2);
  for (const value of ['correctId', 'key-only', 'annotated-answer', 'explanation-only', 'Water loses heat to its cooler surroundings.', 'Heat transfers from a hotter place to a cooler place.']) {
    assert.ok(!json.includes(value), value + ' cannot be published');
    assert.ok(!html.includes(value), value + ' cannot be rendered');
  }
  assert.deepEqual(snapshot.blocks.find(block => block.type === 'plainanswer'), { id: 'answer', type: 'plainanswer' });
});

test('CER and answer-line solutions become blank response sections; supplied student-answer prompts remain readable', () => {
  const question = sampleQuestions()[1];
  question.blocks.push({ id: 'line', type: 'answerLine', label: 'Answer:', answer: 'hidden-line-key' },
    { id: 'student', type: 'studentAnswer', label: "Ben's answer", answer: '<b>Cup B</b> cools slower.' });
  const snapshot = whiteboardQuestionSnapshot(question), json = JSON.stringify(snapshot), html = whiteboardQuestionHtml(snapshot);
  assert.ok(!json.includes('Cup A keeps water hot longer.')); assert.ok(!json.includes('hidden-line-key'));
  assert.match(html, /Claim/); assert.match(html, /Evidence/); assert.match(html, /Reasoning/);
  assert.match(html, /Cup B/); assert.match(html, /Ben&#39;s answer/);
});

test('public snapshot rejects injected private answer fields recursively and omits the teacher account identity', () => {
  const board = boardWith();
  board.notes = 'teacher-secret'; board.cards[0].sourceAnswer = 'teacher-secret';
  board.cards[0].question.answerKeyImage = 'teacher-secret';
  board.cards[0].question.blocks[0].answer = 'teacher-secret';
  board.cards[0].question.blocks[2].data[0][0] = '<b>Time / min</b>';
  board.cards[0].question.blocks[3].options[0].correct = 'teacher-secret';
  const published = whiteboardPublicSnapshot(board), json = JSON.stringify(published);
  assert.ok(!json.includes('teacher-secret')); assert.ok(!json.includes('teacher-1'));
  assert.ok(!own(published, 'createdAt')); assert.ok(!own(published, 'updatedAt'));
  assert.equal(published.cards[0].questionId, 'heat-1');
  assert.equal(normalizeWhiteboard(published).createdBy, '');
});
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

test('fill-in-the-blank public content uses one standard blank instead of any hidden word or answer-length hint', () => {
  const q = { id: 'blank-question', title: 'Plant food', blocks: [{ id: 'blank', type: 'fillblank', text: 'Leaves take in [[carbon]] [[dioxide]] and release [[oxygen]].' }] };
  const snapshot = whiteboardQuestionSnapshot(q), html = whiteboardQuestionHtml(snapshot);
  assert.equal(snapshot.blocks[0].text, 'Leaves take in [[blank]] and release [[blank]].');
  assert.equal((html.match(/class="wb-blank"/g) || []).length, 2);
  for (const answer of ['carbon', 'dioxide', 'oxygen']) assert.ok(!JSON.stringify(snapshot).includes(answer) && !html.includes(answer));
});

test('rich question HTML retains safe formatting but strips scripts, event handlers, active embeds and executable CSS', () => {
  const html = sanitizeWhiteboardQuestionHtml('<p onclick="alert(1)"><b>80°C</b><sub>2</sub><sup>3</sup></p>'
    + '<script>private answer</script><iframe src="https://evil.test">hidden</iframe>'
    + '<img src="https://example.test/diagram.png" onerror="alert(1)" alt="cup > thermometer">'
    + '<span style="color:#126;position:fixed;background-color:url(javascript:alert(1))">Safe</span>');
  assert.match(html, /<b>80°C<\/b>/); assert.match(html, /<sub>2<\/sub>/); assert.match(html, /<sup>3<\/sup>/);
  assert.match(html, /cup &gt; thermometer/); assert.match(html, /style="color:#126"/);
  for (const value of ['onclick', 'onerror', 'script', 'iframe', 'private answer', 'position', 'javascript:', 'url(']) assert.ok(!html.includes(value), value);
  for (const source of ['javascript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html;base64,ZXZpbA==', 'blob:temporary']) {
    assert.throws(() => sanitizeWhiteboardQuestionHtml('<img src="' + source + '">'), /image|URL/i);
  }
  assert.throws(() => sanitizeWhiteboardQuestionHtml('<img alt="no source">'), /image.*source/i);
});

test('malformed quotes and unusual HTML tokens cannot introduce host event handlers or active elements', () => {
  const sources = [
    '<img src="https://example.test/image.png"/onerror=alert(1)>',
    '<img src=https://example.test/image.png onerror=alert(1)//>',
    '<div title="unclosed><img src=https://example.test/image.png onerror=alert(1)>',
    '<!--><img src=https://example.test/image.png onerror=alert(1)>',
    '<style><img src=https://example.test/image.png onerror=alert(1)></style><b>safe</b>',
    '<a href="https://example.test/&quot; onclick=&quot;alert(1)">safe</a>',
    '<span style="color:red;position:fixed;--x:url(javascript:alert(1))">safe</span>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ];
  for (const source of sources) {
    const html = sanitizeWhiteboardQuestionHtml(source);
    assert.ok(!/<(?:script|iframe|style|object|embed)\b/i.test(html), source);
    assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), source);
    assert.ok(!/<[^>]+(?:src|href)\s*=\s*["']?javascript:/i.test(html), source);
  }
});

test('merged tables preserve safe colours, cell content and images through repeated storage normalization', () => {
  const question = { id: 'table-question', title: 'Temperature table', blocks: [{ id: 'table', type: 'table', rows: 2, cols: 2,
    data: [['<b>Trial</b>', ''], ['80°C', '<img src="https://example.test/graph.png" alt="graph">']],
    merges: [{ sr: 0, sc: 0, er: 0, ec: 1 }], cellStyles: { '0_0': { textAlign: 'center', backgroundColor: '#eee', color: '#123' } }, colWidths: [180, 220] }] };
  const first = normalizeWhiteboard(boardWith(question)), second = normalizeWhiteboard(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(first, second);
  const html = whiteboardQuestionHtml(second.cards[0].question, { imageUrl: value => value.replace('example.test', 'cdn.test') });
  assert.match(html, /colspan="2"/); assert.match(html, /background-color:#eee/); assert.match(html, /text-align:center/);
  assert.match(html, /80°C/); assert.match(html, /https:\/\/cdn.test\/graph.png/);
});

test('legacy table headers are migrated completely without mutating the bank question', () => {
  const question = { id: 'legacy-table', title: 'Measurements', blocks: [{ id: 'table', type: 'table', rows: 2, cols: 2,
    headers: ['Time / min', 'Temperature / °C'], data: [['0', '80'], ['5', '50']],
    merges: [{ sr: 0, sc: 0, er: 0, ec: 0 }], cellStyles: { '-1_0': { fontWeight: 'bold' } } }] };
  const before = structuredClone(question), snapshot = whiteboardQuestionSnapshot(question), table = snapshot.blocks[0];
  assert.equal(table.rows, 3); assert.deepEqual(table.data[0], ['Time / min', 'Temperature / °C']);
  assert.equal(table.merges[0].sr, 1); assert.equal(table.cellStyles['0_0'], 'font-weight:bold');
  assert.deepEqual(question, before); assert.match(whiteboardQuestionHtml(snapshot), /Temperature \/ °C/);
  assert.throws(() => whiteboardQuestionSnapshot({ ...question, blocks: [{ ...question.blocks[0], cols: 1000000000 }] }), /too large/);
});

test('unsupported or oversized sources fail explicitly instead of quietly dropping content', () => {
  assert.throws(() => createWhiteboardCard({ id: 'bad', title: 'New block', blocks: [{ id: 'b', type: 'unknown', content: 'Must not disappear' }] }), /cannot be copied completely/);
  assert.throws(() => createWhiteboardCard({ id: 'big', title: 'Long', blocks: [{ id: 'b', type: 'text', content: 'q'.repeat(WB_LIMITS.text + 1) }] }), /too long/);
  assert.throws(() => createWhiteboardCard({ id: 'no-content', title: 'Empty', blocks: [{ id: 'b', type: 'explanation', content: 'Only solution' }] }), /student-facing/);
  assert.throws(() => createWhiteboardCard({ id: 'bad-table', blocks: [{ id: 'b', type: 'table', rows: 1, cols: 1, data: [['a', 'b']] }] }), /outside/);
  assert.throws(() => createWhiteboardCard({ id: 'bad-picture', blocks: [{ id: 'b', type: 'image', url: '' }] }), /image URL/);
  assert.throws(() => createWhiteboardCard({ id: 'inline-svg', blocks: [{ id: 'b', type: 'text', content: '<svg><text>Critical graph</text></svg>' }] }), /cannot be copied completely/);
});

test('saved cards reject invalid IDs, mismatched source identity and duplicate card IDs', () => {
  for (const id of ['', '../question', 'users/teacher/question', '\\path', 'whiteboard with spaces']) {
    assert.throws(() => newWhiteboard({}, id), /ID.*invalid/i);
    assert.throws(() => createWhiteboardCard({ ...sampleQuestions()[0], id }), /ID.*invalid/i);
  }
  const board = boardWith();
  board.cards[0].questionId = 'different-question'; assert.throws(() => normalizeWhiteboard(board), /different question/);
  board.cards[0].questionId = 'heat-1'; board.cards.push(structuredClone(board.cards[0]));
  assert.throws(() => normalizeWhiteboard(board), /duplicate/);
  assert.equal(normalizeWhiteboard({ kind: 'summary-sheet' }), null);
});

test('byte and card budgets stop sharing a partial board, while a valid app keeps exact code', () => {
  const source = '<!doctype html><html><body><button onclick="alert(1)">Try</button><script>function solve(){return 42}</script></body></html>';
  const app = normalizeWhiteboardApp({ html: source, title: 'Question solver', height: 700, notes: 'do not publish' });
  assert.equal(app.html, source); assert.equal(app.height, 700); assert.equal(app.notes, undefined);
  assert.equal(normalizeWhiteboardApp(null), null);
  assert.equal(normalizeWhiteboardApp('```html\n' + source + '\n```').html, source);
  assert.throws(() => normalizeWhiteboardApp({ html: 'a'.repeat(WB_LIMITS.appHtml + 1) }), /too long/);
  const board = boardWith();
  board.cards = Array.from({ length: WB_LIMITS.cards + 1 }, (_, index) => ({ ...board.cards[0], id: 'card-' + index }));
  assert.throws(() => whiteboardPublicSnapshot(board), /complete question cards/);
  board.cards = board.cards.slice(0, 4); board.cards.forEach(card => { card.app = { title: 'Large app', html: '界'.repeat(90000), height: 560 }; });
  assert.throws(() => normalizeWhiteboard(board), /too large.*completely/);
  const empty = newWhiteboard(); assert.throws(() => whiteboardPublicSnapshot(empty), /at least one question/);
});

test('existing question apps retain their student-facing code and use the established QuestionApps opaque-origin sandbox', () => {
  const question = sampleQuestions()[0]; question.blocks.push({ id: 'app', type: 'widget', html: '<button>Try this</button><script>window.answer=42</script>', title: 'Explore heat', height: 480, comments: 'private generation instructions', engine: 'gemini' });
  const board = boardWith(question), published = whiteboardPublicSnapshot(board), json = JSON.stringify(published);
  assert.ok(json.includes('Try this')); assert.ok(!json.includes('private generation instructions'));
  const html = whiteboardQuestionHtml(published.cards[0].question);
  assert.match(html, /sandbox="allow-scripts"/); assert.match(html, /connect-src &amp;#39;none&amp;#39;/);
  assert.ok(!html.includes('allow-same-origin')); assert.ok(!html.includes('<script>window.answer'));
  const printed = whiteboardWorksheetHtml(board); assert.match(printed, /Interactive app: Explore heat/); assert.ok(!printed.includes('<iframe'));
});

test('question practice IDs deduplicate by bank ID and selected-card practice has one target', () => {
  const board = boardWith();
  board.cards.push(createWhiteboardCard(sampleQuestions()[0], {}, 'copy'), createWhiteboardCard(sampleQuestions()[1], {}, 'second'));
  assert.deepEqual(whiteboardQuestionIds(board), ['heat-1', 'heat-2']);
  assert.deepEqual(whiteboardQuestionIds(board, 'copy'), ['heat-1']);
  assert.throws(() => whiteboardQuestionIds(board, 'deleted-card'), /no longer/);
});

test('pan and zoom geometry round-trips negative positions and fits separated cards', () => {
  const point = { x: -810, y: 1250 }, view = { x: 300, y: -220, zoom: 0.5 };
  assert.deepEqual(screenToWorld(worldToScreen(point, view), view), point);
  assert.deepEqual(whiteboardBounds([{ x: -400, y: -120, width: 440, height: 400 }, { x: 850, y: 100, width: 350, height: 900 }]), { x: -400, y: -120, width: 1600, height: 1120 });
  assert.equal(normalizeWhiteboard({ ...boardWith(), view: { x: Infinity, y: 5, zoom: 99 } }).view.zoom, WB_LIMITS.maxZoom);
});

test('public question view preserves part labels, source marks and every native blank response type', () => {
  const q = { id: 'responses', title: 'Question with parts', level: ['P5', 'P6'], topic: 'Heat', blocks: [
    { id: 'stem', type: 'text', part: 'b.ii', marks: 2, content: 'Explain your conclusion.' },
    { id: 'cer', type: 'answer', claim: 'secret', evidence: 'secret', reasoning: 'secret' },
    { id: 'plain', type: 'plainanswer', content: 'secret' }, { id: 'line', type: 'answerLine', label: 'Ans:', answer: 'secret' },
    { id: 'open', type: 'openLines', lines: 3 }, { id: 'working', type: 'workingSpace', lines: 6, answerKey: 'secret' },
    { id: 'objectives', type: 'objectivesBox', lines: 2, label: 'What did you learn?' },
    { id: 'note', type: 'commonMistake', title: 'Read carefully', text: 'Compare the two readings.' },
  ] };
  const snapshot = whiteboardQuestionSnapshot(q), html = whiteboardQuestionHtml(snapshot);
  assert.deepEqual(snapshot.level, ['P5', 'P6']); assert.match(html, /\(b\)\(ii\)/); assert.match(html, /\[2 marks\]/);
  for (const text of ['Claim', 'Evidence', 'Reasoning', 'Ans:', 'What did you learn?', 'Compare the two readings.']) assert.ok(html.includes(text));
  assert.equal((html.match(/class="wb-answer-space"/g) || []).length, 7); assert.ok(!html.includes('secret'));
});

test('public worksheet export follows question order with answer spaces and no model answers or app code', () => {
  const board = boardWith(); board.title = '<script>Worksheet</script>';
  board.cards.push(createWhiteboardCard(sampleQuestions()[1], {}, 'second'));
  board.cards[0].app = { title: 'A helper', html: '<script>privateAnswer=42</script>', height: 560 };
  const html = whiteboardWorksheetHtml(board);
  assert.ok(html.indexOf('1. Cooling hot water') < html.indexOf('2. Comparing insulation'));
  assert.match(html, /@page\{size:A4/); assert.match(html, /Name: /); assert.match(html, /wb-answer-space/);
  assert.match(html, /&lt;script&gt;Worksheet&lt;\/script&gt;/);
  for (const answer of ['Water loses heat to its cooler surroundings.', 'Cup A keeps water hot longer.', 'privateAnswer', 'key-only', 'explanation-only']) assert.ok(!html.includes(answer), answer);
});
