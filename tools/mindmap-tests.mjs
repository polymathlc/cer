// Polymath Mind Map (polymathlc.com.sg/mindmap) — tests for the pure core and the page's wiring.
//   node --test tools/mindmap-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../mindmap/mindmap-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('a new map has one centre and normalises cleanly', () => {
  const map = core.newMap({ title: 'Magnets' });
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].id, map.rootId);
  const again = core.normalizeMap(JSON.parse(JSON.stringify(map)));
  assert.equal(again.rootId, map.rootId);
  assert.equal(again.title, 'Magnets');
});

test('normalizeMap repairs broken parents, cycles, duplicate ids and bad links', () => {
  const raw = {
    rootId: 'r1',
    nodes: [
      { id: 'r1', type: 'topic', text: 'Root', parentId: 'a' },
      { id: 'a', type: 'topic', text: 'A', parentId: 'b' },
      { id: 'b', type: 'topic', text: 'B', parentId: 'a' },          // a ↔ b cycle
      { id: 'c', type: 'topic', text: 'C', parentId: 'missing' },    // missing parent
      { id: 'c', type: 'topic', text: 'dup' },                       // duplicate id
      { id: 'bad id!', type: 'topic' },                              // invalid id
      { id: 'd', type: 'weird', text: 'D', parentId: 'r1', color: 'neon', shape: 'star' }
    ],
    links: [{ id: 'l1', from: 'a', to: 'c' }, { id: 'l2', from: 'a', to: 'a' }, { id: 'l3', from: 'a', to: 'nope' }, { id: 'l4', from: 'a', to: 'c' }]
  };
  const map = core.normalizeMap(raw);
  assert.deepEqual(map.nodes.map(n => n.id), ['r1', 'a', 'b', 'c', 'd']);
  assert.equal(core.nodeById(map, 'r1').parentId, '');
  assert.equal(core.nodeById(map, 'c').parentId, 'r1');
  // No node can be its own ancestor.
  for (const n of map.nodes) assert.ok(!core.ancestorsOf(map, n.id).some(a => a.id === n.id), n.id);
  const d = core.nodeById(map, 'd');
  assert.equal(d.type, 'topic');
  assert.equal(d.color, 'white');
  assert.equal(d.shape, 'rounded');
  assert.deepEqual(map.links.map(l => l.id), ['l1']);
});

test('only https or inline pictures survive on a picture node', () => {
  const ok = core.normalizeNode({ id: 'p', type: 'image', image: { url: 'https://x.test/a.png' } });
  const inline = core.normalizeNode({ id: 'p', type: 'image', image: { url: 'data:image/png;base64,AAAA' } });
  const js = core.normalizeNode({ id: 'p', type: 'image', image: { url: 'javascript:alert(1)' } });
  const svg = core.normalizeNode({ id: 'p', type: 'image', image: { url: 'data:image/svg+xml;base64,AAAA' } });
  assert.equal(ok.image.url, 'https://x.test/a.png');
  assert.equal(inline.image.url, 'data:image/png;base64,AAAA');
  assert.equal(js.image.url, '');
  assert.equal(svg.image.url, '', 'SVG can carry script, so it is never kept');
});

test('question snapshots never store arrays inside arrays (Firestore refuses them)', () => {
  const q = { id: 'q1', topic: 'Heat', blocks: [
    { type: 'text', content: '<p>Which?</p>' },
    { type: 'table', data: { 0: { 0: 'a', 1: 'b' }, 1: { 0: 'c', 1: 'd' } } },
    { type: 'mcq', correctId: 'o2', options: [{ id: 'o1', text: 'x' }, { id: 'o2', text: 'y' }] },
    { type: 'widget', html: '<script>bad()</script>' }
  ] };
  const snap = core.questionSnapshot(q);
  assert.equal(snap.level, 'P4');
  assert.deepEqual(snap.blocks.map(b => b.type), ['text', 'table', 'mcq'], 'unknown blocks (widgets) are dropped');
  assert.deepEqual(snap.blocks[1].rows, [{ c: ['a', 'b'] }, { c: ['c', 'd'] }]);
  const walk = (v, insideArray) => {
    if (Array.isArray(v)) { assert.ok(!insideArray, 'array inside an array'); v.forEach(x => walk(x, true)); }
    else if (v && typeof v === 'object') Object.values(v).forEach(x => walk(x, false));
  };
  const map = core.newMap();
  map.nodes.push(core.normalizeNode({ id: 'qq', type: 'question', parentId: map.rootId, question: snap }));
  walk(core.serializeMap(map), false);
});

test('the question gate follows the cer app: held back, scheduled, out of syllabus and Sec 1 are never served', () => {
  const base = { id: 'q', topic: 'Magnets', blocks: [{ type: 'text', content: 'x' }] };
  const today = '2026-11-14';
  assert.equal(core.questionServable(base, { today }), true);
  assert.equal(core.questionServable({ ...base, holdBack: true }, { today }), false);
  assert.equal(core.questionServable({ ...base, releaseOn: '2026-11-20' }, { today }), false);
  assert.equal(core.questionServable({ ...base, releaseOn: '2026-11-01' }, { today }), true);
  assert.equal(core.questionServable({ ...base, notInSyllabus: true }, { today }), false);
  assert.equal(core.questionServable({ ...base, topic: 'Cell Systems' }, { today }), false);
  assert.equal(core.questionServable({ ...base, topic: 'Atoms and Molecules' }, { today }), false);
  assert.equal(core.questionServable({ ...base, blocks: [] }, { today }), false);
});

test('a question\'s level is the highest of its topics', () => {
  assert.equal(core.questionLevel({ topic: 'Magnets' }), 'P3');
  assert.equal(core.questionLevel({ topic: 'Magnets', topic2: 'Forces' }), 'P6');
  assert.equal(core.questionLevel({ topic: 'My custom topic' }, { ...core.TOPIC_LEVELS, 'My custom topic': 'P5' }), 'P5');
  assert.equal(core.questionLevel({ topic: 'Unknown', level: 'P4' }), 'P4');
});

test('students pick from their approved Science levels and below; staff see every level', () => {
  assert.deepEqual(core.allowedBankLevels({ staff: true }), ['P3', 'P4', 'P5', 'P6']);
  assert.deepEqual(core.allowedBankLevels({ pairs: [{ level: 'P5', subjects: ['science'] }] }), ['P3', 'P4', 'P5']);
  assert.deepEqual(core.allowedBankLevels({ pairs: [{ level: 'P6', subjects: ['math'] }] }), [], 'Math only: no Science questions');
  assert.deepEqual(core.allowedBankLevels({ pairs: [{ level: 'P3', subjects: ['math', 'science'] }, { level: 'P4', subjects: ['math'] }] }), ['P3']);
  assert.deepEqual(core.allowedBankLevels({ pairs: [{ level: 'S2', subjects: ['science'] }] }), ['P3', 'P4', 'P5', 'P6']);
  assert.deepEqual(core.allowedBankLevels({}), []);
});

test('filterQuestions searches text, topic, kind and level', () => {
  const qs = [
    { id: '1', topic: 'Magnets', blocks: [{ type: 'text', content: 'Which <b>pole</b> attracts?' }, { type: 'mcq', options: [] }], createdAt: { seconds: 1 } },
    { id: '2', topic: 'Light', blocks: [{ type: 'text', content: 'Shadows form when' }, { type: 'image', url: 'https://x/y.png' }], createdAt: { seconds: 2 } },
    { id: '3', topic: 'Forces', blocks: [{ type: 'text', content: 'Friction pole' }], createdAt: { seconds: 3 } }
  ];
  assert.deepEqual(core.filterQuestions(qs, { search: 'pole' }).map(q => q.id), ['3', '1']);
  assert.deepEqual(core.filterQuestions(qs, { search: 'pole', levels: ['P3', 'P4'] }).map(q => q.id), ['1']);
  assert.deepEqual(core.filterQuestions(qs, { kind: 'mcq' }).map(q => q.id), ['1']);
  assert.deepEqual(core.filterQuestions(qs, { kind: 'picture' }).map(q => q.id), ['2']);
  assert.deepEqual(core.filterQuestions(qs, { topic: 'Light' }).map(q => q.id), ['2']);
  assert.equal(core.questionHeadline(qs[0]), 'Which pole attracts?');
});

test('voice operations build branches, refer to new nodes by ref, and hand back the slow jobs', () => {
  const map = core.newMap({ title: 'Flowers' });
  const out = core.applyOps(map, [
    { op: 'add_topic', ref: 'p', text: 'Parts' },
    { op: 'add_topic', parent: 'p', text: 'Petal' },
    { op: 'add_topic', parent: 'p', text: 'Stamen', color: 'purple' },
    { op: 'add_note', parent: 'p', text: 'Why', note: 'Petals attract insects.' },
    { op: 'add_image', parent: 'p', prompt: 'a flower cross-section', caption: 'Inside a flower' },
    { op: 'build_app', parent: 'p', title: 'Pollinate', description: 'Drag the bee to each flower' },
    { op: 'add_questions', parent: 'p', topic: 'Plant Reproduction', count: 9 },
    { op: 'connect', from: 'p', to: map.rootId, label: 'of' },
    { op: 'rename', node: 'p', text: 'Flower parts' },
    { op: 'delete', node: map.rootId },
    { op: 'nonsense' }
  ]);
  assert.equal(out.created.length, 6);
  const parts = map.nodes.find(n => n.text === 'Flower parts');
  assert.ok(parts);
  assert.equal(core.childrenOf(map, parts.id).length, 5);
  assert.equal(map.nodes.find(n => n.text === 'Stamen').color, 'purple');
  assert.deepEqual(out.jobs.map(j => j.kind), ['image', 'build_app', 'questions']);
  assert.equal(out.jobs[2].count, 6, 'at most six questions per command');
  assert.equal(map.links.length, 1);
  assert.ok(core.nodeById(map, map.rootId), 'the centre can never be deleted');
  assert.equal(out.tidy, true);
});

test('update_app only changes an app window; moving a branch into itself is refused', () => {
  const map = core.newMap();
  const a = core.applyOps(map, [{ op: 'add_topic', ref: 'x', text: 'X' }, { op: 'add_topic', ref: 'y', parent: 'x', text: 'Y' }]);
  const [x, y] = a.created;
  const bad = core.applyOps(map, [{ op: 'update_app', node: x, change: 'bigger' }]);
  assert.equal(bad.jobs.length, 0);
  assert.equal(bad.errors.length, 1);
  assert.equal(core.reparent(map, x, y), false);
  assert.equal(core.reparent(map, y, map.rootId), true);
});

test('the layout keeps the centre at 0,0 and never overlaps two branches on the same side', () => {
  const map = core.newMap();
  const ops = [];
  for (let i = 0; i < 6; i++) { ops.push({ op: 'add_topic', ref: 'b' + i, text: 'Branch ' + i }); for (let j = 0; j < 3; j++) ops.push({ op: 'add_topic', parent: 'b' + i, text: 'Leaf ' + i + j }); }
  core.applyOps(map, ops);
  const pos = core.layoutMap(map);
  assert.deepEqual(pos.get(map.rootId), { x: 0, y: 0 });
  const boxes = map.nodes.filter(n => n.id !== map.rootId).map(n => ({ id: n.id, ...pos.get(n.id), w: 160, h: 46 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
    assert.ok(!overlap, 'overlap between ' + a.id + ' and ' + b.id);
  }
  const sides = core.childrenOf(map, map.rootId).map(n => Math.sign(pos.get(n.id).x));
  assert.ok(sides.includes(1) && sides.includes(-1), 'branches on both sides');
});

test('undo and redo walk back and forth', () => {
  const h = new core.History(3);
  h.push({ v: 1 }); h.push({ v: 2 }); h.push({ v: 3 }); h.push({ v: 4 });
  assert.equal(h.past.length, 3, 'the oldest step is dropped');
  assert.deepEqual(h.undo({ v: 5 }), { v: 4 });
  assert.deepEqual(h.redo({ v: 4 }), { v: 5 });
  assert.equal(h.canRedo, false);
});

test('the sandbox document joins HTML, CSS and JS and keeps a pasted page whole', () => {
  const doc = core.buildSandboxDoc({ html: '<button id=b>Hi</button>', css: 'b{color:red}', js: 'b.onclick=()=>1' }, { channel: 'n1' });
  assert.match(doc, /^<!doctype html>/);
  assert.ok(doc.includes('<button id=b>Hi</button>') && doc.includes('b{color:red}') && doc.includes('b.onclick'));
  assert.ok(doc.includes('mindmapConsole'), 'console bridge');
  const page = core.buildSandboxDoc({ html: '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>', js: 'go()' });
  assert.equal((page.match(/<html/g) || []).length, 1);
  assert.ok(page.indexOf('go()') < page.indexOf('</body>'));
  const jsOnly = core.buildSandboxDoc({ html: 'const a = 1; console.log(a);' });
  assert.ok(jsOnly.includes('<script>\nconst a = 1;'), 'plain JS pasted in the HTML box runs as JS');
  const sneaky = core.buildSandboxDoc({ js: 'var s = "</script><img src=x>";' });
  assert.ok(!/"<\/script><img/.test(sneaky), 'a closing script tag inside JS cannot end the script early');
  assert.ok(!core.SANDBOX_FLAGS.includes('allow-same-origin'), 'apps never share the page\'s origin');
});

test('model replies are parsed even when fenced, chatty or cut off', () => {
  assert.deepEqual(core.parseAiJson('```json\n{"say":"hi","ops":[]}\n```'), { say: 'hi', ops: [] });
  assert.deepEqual(core.parseAiJson('Sure! {"say":"ok","ops":[{"op":"tidy"}]}'), { say: 'ok', ops: [{ op: 'tidy' }] });
  assert.deepEqual(core.parseAiJson('{"say":"cut","ops":[{"op":"add_topic","text":"Ro'), { say: 'cut', ops: [{ op: 'add_topic', text: 'Ro' }] });
  assert.throws(() => core.parseAiJson(''));
  assert.equal(core.extractHtmlDocument('Here you go:\n```html\n<!doctype html><html><body>x</body></html>\n```'), '<!doctype html><html><body>x</body></html>');
  assert.equal(core.extractHtmlDocument('no page here'), '');
});

test('outlines import with nesting and export as Markdown', () => {
  const map = core.newMap({ title: 'Water' });
  core.importOutlineText(map, map.rootId, 'Evaporation\n  Heat\n  Wind\nCondensation\n- Clouds');
  const evap = map.nodes.find(n => n.text === 'Evaporation');
  assert.equal(core.childrenOf(map, evap.id).length, 2);
  assert.match(core.mapToOutline(map), /- Evaporation\n {2}- Heat/);
  const built = core.newMap();
  core.buildFromOutline(built, { title: 'Cycle', branches: [{ text: 'A', children: [{ text: 'A1' }] }, 'B'] });
  assert.equal(built.title, 'Cycle');
  assert.equal(built.nodes.length, 4);
});

test('the voice prompt lists every operation the page can apply', () => {
  const prompt = core.voiceSystemPrompt({ topicNames: ['Magnets'] });
  for (const op of ['add_topic', 'add_note', 'rename', 'recolor', 'delete', 'connect', 'move', 'add_image', 'build_app', 'update_app', 'add_questions', 'set_title', 'select', 'tidy']) {
    assert.ok(prompt.includes('"op":"' + op + '"') || prompt.includes('{"op":"' + op), op);
  }
  assert.ok(prompt.includes('Magnets'));
});

test('the page: noindex, the access gate last, the module, and no keys beyond the public web config', () => {
  const page = read('mindmap/index.html');
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.ok(page.trimEnd().endsWith('<script defer src="../student/access-gate.js?v=1.1.0" data-app="mindmap"></script>\n</body>\n</html>'));
  assert.ok(page.includes('<script type="module" src="mindmap-app.js?v=1.2.0"></script>'));
  const services = read('mindmap/mindmap-services.js');
  assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(services + read('mindmap/mindmap-app.js')), 'no OpenAI key in page code');
  assert.ok(services.includes("httpsCallable(functions, 'askOpenAi'") && services.includes("httpsCallable(functions, 'openAiImage'"), 'ChatGPT goes through the server');
  const app = read('mindmap/mindmap-app.js');
  // Messages from code windows are trusted only from their own iframe.
  assert.ok(app.includes('e.source === frame.contentWindow'));
  // The same version everywhere.
  assert.ok(read('mindmap/mindmap-core.mjs').includes(`MINDMAP_VERSION = '1.2.0'`));
  assert.ok(page.includes('>v1.2.0<'));
});

test('the access lists match the gate', () => {
  const gate = read('student/access-gate.js');
  const services = read('mindmap/mindmap-services.js');
  const admins = /var ACCESS_ADMINS = (\[[^\]]+\])/.exec(gate)[1].replace(/'/g, '"');
  const mine = /export const ACCESS_ADMINS = (\[[^\]]+\])/.exec(services)[1].replace(/'/g, '"');
  assert.deepEqual(JSON.parse(mine), JSON.parse(admins));
});

// ───────────── v1.1.0: folded question cards and free-standing questions ─────────────
function mapWithQuestions() {
  const map = core.newMap({ title: 'Light' });
  const branch = core.normalizeNode({ id: 'topicA', type: 'topic', parentId: map.rootId, x: 200, y: 0, text: 'Shadows' });
  const attached = core.normalizeNode({ id: 'qAttached', type: 'question', parentId: 'topicA', x: 500, y: 0, w: 320, h: 90,
    question: { qid: 'q1', title: 'Why does a shadow form?', topic: 'Light', level: 'P4', blocks: [], folded: true } });
  const free = core.normalizeNode({ id: 'qFree', type: 'question', parentId: '', x: -900, y: 700, w: 400, h: 280,
    question: { qid: 'q2', title: 'Which material lets light through?', topic: 'Light', level: 'P4', blocks: [] } });
  map.nodes.push(branch, attached, free);
  return map;
}

test('v1.1.0: a question card remembers whether it is folded, and old maps open unfolded', () => {
  const map = core.normalizeMap(JSON.parse(JSON.stringify(mapWithQuestions())));
  assert.equal(core.nodeById(map, 'qAttached').question.folded, true);
  assert.equal(core.nodeById(map, 'qFree').question.folded, false);
  const old = core.normalizeNode({ id: 'old1', type: 'question', parentId: 'x', question: { qid: 'q', title: 'Old' } });
  assert.equal(old.question.folded, false, 'a map saved before v1.1.0 shows its questions open');
  assert.equal(core.normalizeNode({ id: 'z1', type: 'question', question: { folded: 'yes' } }).question.folded, false, 'only true folds');
});

test('v1.1.0: a free-standing question survives saving, is not the centre, and grows to the right', () => {
  const map = core.normalizeMap(JSON.parse(JSON.stringify(mapWithQuestions())));
  assert.equal(map.nodes.length, 4);
  assert.equal(core.nodeById(map, 'qFree').parentId, '', 'it stays attached to nothing');
  assert.notEqual(map.rootId, 'qFree', 'the centre is still the centre');
  assert.equal(core.isFree(map, 'qFree'), true);
  assert.equal(core.isFree(map, 'qAttached'), false);
  assert.equal(core.isFree(map, map.rootId), false, 'the centre is not "free"');
  assert.equal(core.sideOf(map, 'qFree'), 'right');
  assert.equal(core.depthOf(map, 'qFree'), 0);
  assert.equal(core.isHidden(map, 'qFree'), false);
  // Folding the centre's branches never hides a free card.
  core.nodeById(map, map.rootId).collapsed = true;
  assert.equal(core.isHidden(map, 'qFree'), false);
  assert.equal(core.isHidden(map, 'qAttached'), true);
});

test('v1.1.0: tidy-up never moves a free-standing card, and tidies what hangs from it', () => {
  const map = mapWithQuestions();
  const child = core.normalizeNode({ id: 'freeKid', type: 'topic', parentId: 'qFree', x: 0, y: 0, w: 120, h: 40, text: 'Hint' });
  map.nodes.push(child);
  const pos = core.layoutMap(map);
  assert.deepEqual(pos.get('qFree'), { x: -900, y: 700 }, 'the free card keeps its place');
  const kid = pos.get('freeKid');
  assert.ok(kid.x > -900, 'its own child grows to the right of it');
  assert.equal(kid.y, 700, 'a single child lines up with it');
  assert.equal(core.sideOf(map, 'freeKid'), 'right');
  assert.ok(pos.has('qAttached'), 'attached questions are laid out with their branch');
});

test('v1.1.0: detachNode unhooks a branch (never the centre); reparent attaches it again', () => {
  const map = mapWithQuestions();
  assert.equal(core.detachNode(map, map.rootId), false, 'the centre cannot be detached');
  assert.equal(core.detachNode(map, 'qFree'), false, 'already on its own');
  assert.equal(core.detachNode(map, 'qAttached'), true);
  assert.equal(core.isFree(map, 'qAttached'), true);
  assert.equal(core.reparent(map, 'qAttached', 'topicA'), true);
  assert.equal(core.nodeById(map, 'qAttached').parentId, 'topicA');
  assert.equal(core.treeTopOf(map, 'qAttached').id, map.rootId);
  assert.equal(core.treeTopOf(map, 'qFree').id, 'qFree');
});

test('v1.1.0: free cards are listed in the outline and in what the AI sees', () => {
  const map = mapWithQuestions();
  const outline = core.mapToOutline(map);
  assert.match(outline, /## On their own\n- ❓ Which material lets light through\?/);
  const seen = core.describeMapForAi(map);
  assert.match(seen, /FREE-STANDING/);
  assert.match(seen, /\(qFree\)/);
});

test('v1.1.0: "add questions on their own" by voice becomes a free questions job', () => {
  const map = mapWithQuestions();
  const out = core.applyOps(map, [{ op: 'add_questions', parent: 'none', topic: 'Light', count: 2 }], { selectedId: 'topicA' });
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].free, true);
  assert.equal(out.jobs[0].parentId, '');
  const attached = core.applyOps(map, [{ op: 'add_questions', parent: 'topicA', topic: 'Light' }]);
  assert.equal(attached.jobs[0].free, false);
  assert.equal(attached.jobs[0].parentId, 'topicA');
  assert.match(core.voiceSystemPrompt({}), /on their own/);
});
