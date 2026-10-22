// 🎮 Quest frames: the shared switch, the art this site serves, the portal's
// header / gems / margin rampart and the creators' Quest pages. Runs the REAL
// quest-frames.js in a vm; the browser half is tools/quest-frames-browser-check.mjs.
// Run: node --test tools/quest-frames-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL('../' + p, import.meta.url));
const SRC = read('quest-frames.js');
const CSS = read('quest-frames.css');
const APP = read('app.js');
const INDEX = read('index.html');
const MATH = read('math-worksheet.html');
const SCIENCE = read('science-worksheet.html');
const APP_VERSION = APP.match(/const APP_VERSION = 'v([^']+)'/)[1];

// A toggle as the page draws it: a checkbox inside a box (the portal's <label>
// carries an inline flex, the creators' none) that the switch hides and gives back.
function toggle(display) {
  const attrs = new Map();
  const box = {
    style: { display },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v))
  };
  const input = {
    checked: false,
    disabled: false,
    matches: (sel) => sel === 'input[data-quest-frame-toggle]',
    closest: (sel) => (sel === 'label' ? box : null)
  };
  return { input, box };
}

function load({ stored = null } = {}) {
  // Storage is watched, never fed: the switch must neither read nor write it.
  const store = new Map(stored == null ? [] : [['cer.questFrame', stored]]);
  const storageCalls = [];
  const listeners = [];
  const toggles = [toggle('flex'), toggle('')];
  const inputs = toggles.map((t) => t.input);
  const boxes = toggles.map((t) => t.box);
  const document = {
    currentScript: { src: 'https://polymathlc.com.sg/quest-frames.js?v=' + APP_VERSION },
    readyState: 'complete',
    addEventListener: (type, fn) => listeners.push([type, fn]),
    querySelectorAll: (sel) => (sel === 'input[data-quest-frame-toggle]' ? inputs : []),
    createElement: () => ({ setAttribute() {}, classList: { add() {} } })
  };
  const window = {
    document,
    location: { href: 'https://polymathlc.com.sg/index.html' },
    localStorage: {
      getItem: (k) => { storageCalls.push(['get', k]); return store.has(k) ? store.get(k) : null; },
      setItem: (k, v) => { storageCalls.push(['set', k]); store.set(k, String(v)); }
    }
  };
  const ctx = vm.createContext({ window, document, URL, Image: function () {}, setTimeout, Promise, console });
  vm.runInContext(SRC, ctx);
  const change = (i, checked) => {
    inputs[i].checked = checked;
    listeners.find(([type]) => type === 'change')[1]({ target: inputs[i] });
  };
  return { QF: window.QuestFrames, QC: window.QuestFramesCer, store, storageCalls, listeners, inputs, boxes, change };
}

test('the script carries the release version the pages load it with', () => {
  const { QC } = load();
  assert.equal(QC.version, APP_VERSION, 'QuestFramesCer.version is APP_VERSION');
  assert.ok(INDEX.includes('quest-frames.js?v=' + APP_VERSION), 'index.html loads quest-frames.js at the release version');
  assert.ok(INDEX.includes('quest-frames.css?v=' + APP_VERSION), 'index.html loads quest-frames.css at the release version');
  for (const [name, page] of [['math', MATH], ['science', SCIENCE]]) {
    assert.match(page, /<script src="quest-frames\.js\?v=[\d.]+"><\/script>/, name + ' creator loads quest-frames.js');
  }
  assert.ok(!/<\/script|<!--/i.test(SRC), 'no sequence that would end an inline copy early');
});

test('ONE switch, the TEACHER\'s alone: hidden and refused until the page names the teacher', () => {
  const page = load();
  // Fails CLOSED: before the page registers who the teacher is, nothing can frame a sheet.
  assert.equal(page.QC.on(), false, 'off on arrival');
  assert.equal(page.QC.isTeacher(), false, 'nobody is the teacher until the page says so');
  assert.deepEqual(page.boxes.map((b) => b.style.display), ['none', 'none'], 'every toggle is hidden');
  assert.deepEqual(page.inputs.map((i) => i.disabled), [true, true], 'and disabled');
  page.QC.set(true);
  assert.equal(page.QC.on(), false, 'a tick from code is refused');
  page.change(0, true);
  assert.equal(page.QC.on(), false, 'a tick from the page is refused');
  assert.equal(page.inputs[0].checked, false, 'and the box is put back unticked');

  let role = 'student';
  page.QC.teacher(() => role === 'admin');
  page.QC.roleChanged('kid:student');
  assert.equal(page.boxes[0].style.display, 'none', 'a student never sees it');
  page.change(0, true);
  assert.equal(page.QC.on(), false, 'and cannot tick it');

  role = 'employee';
  page.QC.roleChanged('writer:employee');
  assert.equal(page.boxes[0].style.display, 'none', 'nor an employee');

  role = 'admin';
  page.QC.roleChanged('teacher:admin');
  assert.deepEqual(page.boxes.map((b) => b.style.display), ['flex', ''], 'the teacher sees each toggle laid out as the page drew it');
  assert.deepEqual(page.inputs.map((i) => i.disabled), [false, false]);
  assert.equal(page.QC.on(), false, 'unticked on arrival: a sheet is framed only when the box is ticked first');
  page.change(1, true);
  assert.equal(page.QC.on(), true, 'the teacher ticks it');
  assert.deepEqual(page.inputs.map((i) => i.checked), [true, true], 'every toggle on the page follows');
  page.QC.roleChanged('teacher:admin');
  assert.equal(page.QC.on(), true, 'redrawing the page for the same teacher keeps the tick just made');
  page.change(0, false);
  assert.equal(page.QC.on(), false, 'unticking any toggle turns it off everywhere');
  page.change(0, true);
  page.QC.roleChanged('second-teacher:admin');
  assert.equal(page.QC.on(), false, 'another teacher signing in on this device starts unticked too');
  assert.deepEqual(page.boxes.map((b) => b.style.display), ['flex', ''], 'and still sees the toggles');
  page.change(0, true);

  // A hand-over: "Practise as" runs as the student, so the role check says no at once.
  role = 'student';
  assert.equal(page.QC.on(), false, 'the moment the person is not the teacher, the frame is off');
  page.QC.roleChanged('kid:student');
  assert.deepEqual(page.boxes.map((b) => b.style.display), ['none', 'none'], 'hidden again for the student');
  assert.deepEqual(page.inputs.map((i) => i.checked), [false, false]);
  role = 'admin';
  page.QC.roleChanged('teacher:admin');
  assert.equal(page.QC.on(), false, 'back to the teacher: unticked, the tick did not survive the hand-over');

  const broken = load();
  broken.QC.teacher(() => { throw new Error('signed-in state not ready'); });
  broken.QC.set(true);
  assert.equal(broken.QC.on(), false, 'a role check that throws is a no');
  broken.QC.teacher(null);
  assert.equal(broken.QC.isTeacher(), false, 'unregistering is a no');
});

test('the switch is NEVER REMEMBERED: every visit starts unticked', () => {
  const page = load({ stored: '1' });
  page.QC.teacher(() => true);
  page.QC.roleChanged('teacher:admin');
  assert.equal(page.QC.on(), false, 'a value left in storage by anything is ignored');
  page.QC.set(true);
  assert.equal(page.QC.on(), true);
  assert.deepEqual(page.storageCalls, [], 'the switch never reads or writes storage');
  const next = load();
  next.QC.teacher(() => true);
  next.QC.roleChanged('teacher:admin');
  assert.equal(next.QC.on(), false, 'the next visit starts unticked');
  const tail = SRC.slice(SRC.indexOf('QUEST FRAMES ON THIS SITE'));
  assert.doesNotMatch(tail, /localStorage|sessionStorage|indexedDB/, 'nothing in this site\'s glue can remember it');
  assert.equal(page.QC.key, undefined, 'no storage key is exported');
});

test('every page names the teacher, and every print door asks again', () => {
  for (const id of ['wsQuestFrame', 'mwQuestFrame']) {
    assert.match(INDEX, new RegExp(`id="${id}" data-quest-frame-toggle`), id + ' is a shared toggle');
  }
  assert.equal((INDEX.match(/Teacher only, and never remembered/g) || []).length, 2, 'both portal toggles say so');
  assert.doesNotMatch(INDEX, /Remembered on this device for every worksheet builder/);
  // The portal: _isAdmin() is the one test (an admin as themselves; "Practise as" runs as the student).
  assert.match(APP, /function _isAdmin\(\) \{ return !!\(currentUser && currentUser\.role === 'admin'\); \}/);
  assert.match(APP, /if \(typeof window !== 'undefined' && window\.QuestFramesCer\) window\.QuestFramesCer\.teacher\(_isAdmin\);/, 'the portal names the teacher');
  assert.match(APP, /window\.QuestFramesCer\.roleChanged\(currentUser \? currentUser\.uid \+ ':' \+ currentUser\.role : ''\)/, 'the person is the account AND its role');
  const sidebar = APP.slice(APP.indexOf('function configureSidebarForRole(role) {'), APP.indexOf('function configureSidebarForRole(role) {') + 600);
  assert.match(sidebar, /_qfRoleChanged\(\);/, 'every sign-in (admin, employee, student, Practise as) re-asks');
  assert.match(APP, /\} else \{\n    currentUser = null;\n    _qfRoleChanged\(\);/, 'a sign-out hides and unticks it');
  assert.match(APP, /if \(!QC \|\| !_isAdmin\(\) \|\| !QC\.on\(\)\) return null;/, 'the print door asks _isAdmin() itself');
  // The creators: isAdmin() (the one teacher e-mail) gates the switch and the print.
  for (const [name, page] of [['math', MATH], ['science', SCIENCE]]) {
    assert.match(page, /<label class="btn preview-toggle admin-only" data-quest-frame-box [^>]*title="[^"]*Teacher only, and never remembered[^"]*"><input type="checkbox" data-quest-frame-toggle/, name + ': the toggle is admin-only and says so');
    assert.match(page, /QuestFramesCer\.teacher\(isAdmin\);\s*QuestFramesCer\.roleChanged\(currentUser \? currentUser\.uid : ['"]{2}\)|QuestFramesCer\.teacher\(isAdmin\);QuestFramesCer\.roleChanged\(currentUser\?currentUser\.uid:""\)/, name + ': names the teacher on every sign-in refresh');
    assert.match(page, /window\.QuestFramesCer\s*&&\s*isAdmin\(\)\s*&&\s*QuestFramesCer\.on\(\)/, name + ': the print asks isAdmin() itself');
    assert.match(page, /function isAdmin\(\)\s*\{\s*return currentUser\s*&&\s*\(currentUser\.email\s*\|\|\s*['"]{2}\)\.toLowerCase\(\)\s*===\s*ALLOWED_EMAIL;?\s*\}/, name + ': isAdmin() is the teacher e-mail');
  }
});

test('every picture is served from this site, and every copy is on disk at its source ratio', () => {
  const { QF } = load();
  const manifest = JSON.parse(read('assets/quest-frames/manifest.json'));
  const byKey = new Map(manifest.assets.map((a) => [a.key, a]));
  for (const key of QF.art.keys()) {
    const url = QF.art.url(key);
    assert.ok(url.startsWith('https://polymathlc.com.sg/'), key + ' resolves on this site, not the design system');
    const rel = url.replace('https://polymathlc.com.sg/', '');
    assert.ok(exists(rel), `${key} → ${rel} exists`);
    const e = QF.art.entry(key);
    if (rel.startsWith('assets/quest-frames/')) {
      const m = byKey.get(key);
      assert.ok(m, key + ' is in the manifest');
      assert.equal(m.source.width, e.w, key + ' source width matches the frame\'s crop units');
      assert.equal(m.source.height, e.h, key + ' source height matches the frame\'s crop units');
      assert.ok(Math.abs(m.width / m.height - e.w / e.h) < 0.005, key + ' keeps its source aspect ratio');
      assert.equal(fs.statSync(new URL('../' + rel, import.meta.url)).size, m.bytes, key + ' bytes match the manifest');
    }
  }
  assert.ok(QF.art.url('logo').endsWith('assets/branding/polymath-learning-centre.png'), 'the logo is the site\'s own copy');
  assert.ok(QF.art.url('nova-thinking').endsWith('assets/worksheet-characters/nova-thinking.webp'), 'companions come from worksheet-characters');
});

test('a worksheet\'s quest: world from its topics, boss seeded by its title, a heart per question', () => {
  const { QF, QC } = load();
  const q = QC.ctx({ subject: 'science', title: 'P5 Heat worksheet', topics: ['Heat', 'Heat', 'Light'], questions: 14 });
  assert.equal(q.world, 'volcano');
  assert.equal(q.questions, 14);
  assert.equal(q.seed, 'P5 Heat worksheet');
  assert.equal(QC.ctx({ subject: 'science', title: 'Circuits', topics: [] }).world, 'clockwork', 'no topics: the title decides');
  const a = QF.bossFor('volcano', null, { seed: q.seed }), b = QF.bossFor('volcano', null, { seed: q.seed });
  assert.equal(a.id, b.id, 'a reprint meets the same boss');
  assert.equal(a.world, 'volcano');
  assert.equal(QC.mostCommon(['', 'Plants', 'Heat', 'Plants']), 'Plants');
});

test('the portal\'s page-1 header: banner + boss + hero card, and the cover variants', () => {
  const { QC } = load();
  const q = QC.ctx({ subject: 'science', title: 'Food chains', topics: ['Food chains'], questions: 9 });
  const plain = QC.portalHeader(q, false, false);
  assert.match(plain, /class="qf-print-head qf-world-swamp"/);
  assert.match(plain, /qf-banner/, 'banner without a cover');
  assert.match(plain, /SCIENCE QUEST/, 'an unnumbered quest says SCIENCE QUEST, never a made-up number');
  assert.match(plain, /Polymath Learning Centre/, 'the logo sticker is in the banner');
  assert.equal((plain.match(/qf-px qf-heart/g) || []).length, 9, 'one heart per question');
  assert.match(plain, /qf-herocard/);
  assert.match(plain, /Colour a heart for each question\./, 'the rule of play is printed');
  assert.doesNotMatch(QC.portalHeader(q, false, true), /qf-herocard/, 'no student fields → no hero card');
  const cover = QC.portalHeader(q, true, false);
  assert.match(cover, /qf-print-head--cover/);
  assert.doesNotMatch(cover, /qf-banner/, 'a cover already carries the title and logo');
  assert.match(cover, /qf-herocard/);
});

test('gems: marks give the rarity; no marks is a plain rare gem with no pips', () => {
  const { QC } = load();
  assert.match(QC.gem(3, 2), /qf-r-uncommon/);
  assert.match(QC.gem(3, 2), /2 MARKS/);
  assert.match(QC.gem(4, 5), /qf-r-legendary/);
  const bare = QC.gem(7, 0);
  assert.match(bare, /qf-r-rare/);
  assert.doesNotMatch(bare, /MARK/);
  assert.match(bare, /aria-label="Question 7"/);
});

test('the margin rampart never reaches the 178 x 258mm text column', () => {
  const { QF } = load();
  const svg = QF.border({ world: 'forest', fit: 'margins', seed: 'x', variant: 'trail' });
  // The text column on a 794 x 1123 sheet: 16mm sides, 18mm top, 20mm foot.
  const px = (mm) => mm * 96 / 25.4;
  const box = { l: px(16), t: px(18), r: 794 - px(16), b: 1123 - px(20) };
  // Every drawn rect and sprite, with its translate() offsets resolved.
  const shapes = [];
  const re = /<(rect|svg)\b([^>]*?)\/?>|<g\b([^>]*)>|<\/g>/g;
  const stack = [[0, 0]];
  let m;
  while ((m = re.exec(svg))) {
    if (m[0] === '</g>') { stack.pop(); continue; }
    if (m[3] != null) {
      const [dx, dy] = stack[stack.length - 1];
      const t = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(m[3]);
      stack.push(t ? [dx + +t[1], dy + +t[2]] : [dx, dy]);
      continue;
    }
    const attrs = m[2];
    if (/class="qf-border/.test(attrs)) continue;
    const get = (n) => { const a = new RegExp(`\\b${n}="([-\\d.]+)"`).exec(attrs); return a ? +a[1] : null; };
    const [dx, dy] = stack[stack.length - 1];
    const x = get('x'), y = get('y'), w = get('width'), h = get('height');
    if (x == null || y == null || w == null || h == null) continue;
    if (/patternUnits|viewBox="0 0 84/.test(attrs)) continue;
    shapes.push({ x: x + dx, y: y + dy, w, h });
  }
  assert.ok(shapes.length > 50, 'the parser found the wall\'s pieces');
  const inside = shapes.filter((s) => s.x < box.r && s.x + s.w > box.l && s.y < box.b && s.y + s.h > box.t && s.w < 700 && s.h < 1000);
  assert.deepEqual(inside, [], 'no bastion, socket, trim, sparkle or rune crosses into the text column');
  // the bands and rims are paths: their inner edge must sit outside the column too
  const g = QF.FITS.margins;
  assert.ok(g.inset + g.band + 6 < box.l, 'side rim clear of the column');
  assert.ok(g.inset + g.band + 6 < box.t, 'top rim clear of the column');
  assert.ok(1123 - (g.inset + g.band + 6) > box.b, 'foot rim clear of the column');
});

test('framed portal sheets: margin-free A4 padded by the old margins, 296mm tall', () => {
  // The page box the planner measures is --print-page-h; the frame must keep it.
  const pageH = parseFloat(INDEX.match(/--print-page-h:\s*([\d.]+)mm/)[1]);
  const at = INDEX.match(/@page \{\s*size: A4 portrait;\s*margin: ([\d.]+)mm ([\d.]+)mm ([\d.]+)mm ([\d.]+)mm;/);
  assert.ok(at, 'the portal\'s @page margins are where the test expects them');
  const rule = CSS.match(/#printOutput > \.print-question-page\.qf-sheet \{([^}]*)\}/)[1];
  assert.match(CSS, /@page qf-sheet \{ size: A4 portrait; margin: 0; \}/);
  assert.match(rule, /page: qf-sheet/);
  assert.match(rule, /width: 210mm/);
  const h = parseFloat(rule.match(/height: ([\d.]+)mm/)[1]);
  const [pt, px, pb] = rule.match(/padding: ([\d.]+)mm ([\d.]+)mm ([\d.]+)mm/).slice(1).map(Number);
  assert.ok(h <= 296, 'never a hair over A4, or a blank sheet follows every page');
  assert.equal(pt, +at[1], 'top padding = the old top margin');
  assert.equal(px, +at[2], 'side padding = the old side margins, so the column is the same 178mm');
  assert.equal(h - pt - pb, pageH, 'content box = the planner\'s page box');
  assert.doesNotMatch(CSS, /@import/, 'no extra font request: index.html asks for Pixelify Sans in its print-only font link');
  assert.match(INDEX, /media="print" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Crimson\+Pro[^"]*family=Pixelify\+Sans/);
  assert.match(INDEX, /<link rel="stylesheet" media="print" onload="this\.media='all'" href="quest-frames\.css\?v=/, 'non-blocking, like every other stylesheet the screen does not need');
});

test('app.js: both print doors, the preview and the planner all carry the frame', () => {
  assert.match(APP, /function _qfPrintCtx\(selected, title\) \{\n  const QC = window\.QuestFramesCer;\n  if \(!QC \|\| !_isAdmin\(\) \|\| !QC\.on\(\)\) return null;/, 'off, missing or not the teacher → null → the old sheet');
  assert.match(APP, /objBoxPrintOn\('builder'\), wsArtwork, _qfPrintCtx\(selected, title\)\);/, 'worksheet builder passes it');
  assert.match(APP, /objBoxPrintOn\('saved'\), ws\.artwork, _qfPrintCtx\(selected, ws\.title\)\);/, 'My Worksheets passes it');
  assert.match(APP, /questFrame: \(!o\.noTags && \(ctx\.where === 'builder' \|\| ctx\.where === 'saved'\)\) \? _qfPrintCtx\(selected, title\) : null,/, 'the preview paginates with the same header; the Study Buddy photograph stays plain');
  assert.match(APP, /function _wsHeaderHtml\(worksheetTitle, hasCover, noFields, questFrame\) \{\n  if \(questFrame && window\.QuestFramesCer\) return window\.QuestFramesCer\.portalHeader\(questFrame, hasCover, noFields\);/);
  assert.equal((APP.match(/_wsHeaderHtml\(worksheetTitle, hasCover, noFields, questFrame\)/g) || []).length, 3, 'both header call sites pass it');
  assert.match(APP, /autoscaleAndPrint\(output, \{ forcedBreakIds: wsManualBreaks, mergeUpIds: wsMergeUp, questFrame: questFrame \|\| null \}\);/);
  const tail = APP.slice(APP.indexOf('function doScaleAndPrint('), APP.indexOf('// EXAM PAPER BUILDER'));
  const numbered = tail.indexOf('_printApplyPageNumbers(output);');
  const framed = tail.indexOf('QC.framePrintPages(output, questFrame);');
  assert.ok(numbered > 0 && framed > numbered, 'the frame goes on AFTER the sheets are planned and numbered');
  assert.ok(tail.indexOf('QC.ready(output, 8000).then(') > framed, 'and the print waits for the sprites');
});

test('creators: one Quest page per question sheet, instructions ride along, gems replace the number', () => {
  const { QC } = load();
  const q = (n, body, extra = '') => `\n<section class="print-question">\n  <article class="question-card">\n    <div class="question-header">\n      <div class="question-number">${n}</div>\n      <div class="question-stem">${body}</div>\n    </div>${extra}\n  </article>\n</section>`;
  const html = QC.creatorBody({
    subject: 'math', title: 'Fractions of a set', topics: ['Fractions', 'Fractions'],
    sections: [
      { html: '<section class="print-instruction">Read carefully.</section>', instruction: true },
      { html: q(1, 'Shade 3/4.') },
      { html: q(2, 'Long one.') + q(2, '', '<div class="continued-note">Continued from previous page</div>') },
      { html: q(3, 'Last.') }
    ]
  });
  const pages = html.match(/<section class="qf-page /g) || [];
  assert.equal(pages.length, 4, 'a question split by a page break is two pages');
  assert.match(html, /qf-page--start[^"]*qf-world-library/, 'page 1 is the start, in the Inkwell Library (fractions)');
  assert.match(html, /qf-page--finale/, 'the last is the finale with the treasure');
  assert.equal((html.match(/qf-page--trail/g) || []).length, 2);
  assert.ok(html.indexOf('Read carefully.') < html.indexOf('Shade 3/4.'), 'the instruction is on the page of the question after it');
  assert.doesNotMatch(html, /<div class="question-number">\d/, 'every number became a gem');
  assert.equal((html.match(/qf-gem-slot/g) || []).length, 4);
  assert.equal((html.match(/qf-px qf-heart/g) || []).length, 3 * 4, 'three questions: three hearts in every page\'s header');
  assert.match(html, /MATHEMATICS QUEST/);
  assert.equal(QC.creatorBody({ subject: 'math', title: 'x', sections: [] }), '', 'nothing to frame → the old document');
  assert.match(QC.creatorCss(), /@page qf-page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(QC.creatorCss(), /\.qf-page\.qf-overflow \{ page: auto;/, 'an over-tall question prints the old way');
  assert.match(QC.printScript(), /function qfFixOverflow\(\)/);
  assert.match(QC.printScript(), /function qfReady\(\)/);
  assert.match(QC.printHead(), /href="https:\/\/polymathlc\.com\.sg\/quest-frames\.css\?v=/, 'absolute, so the blank print window finds it');
});

test('creators: the print document takes the frame only when the switch is on', () => {
  for (const [name, page, subject] of [['math', MATH, 'math'], ['science', SCIENCE, 'science']]) {
    assert.match(page, /QuestFramesCer\.on\(\)\s*\?\s*QuestFramesCer\s*:\s*null/, name + ': reads the shared switch');
    assert.match(page, new RegExp(`subject:\\s*["']${subject}["']`), name + ': its own subject');
    assert.match(page, /qfBody \? qfc\.printHead\(\) : ''|qfBody\?qfc\.printHead\(\):""/, name + ': frame stylesheet in the print window');
    assert.match(page, /qfBody \? qfc\.printScript\(\) : ''|qfBody\?qfc\.printScript\(\):""/, name + ': overflow and sprite wait in the print window');
    assert.match(page, /Promise\.all\(\[waitForImages\(\), fontsReady, window\.qfReady \? qfReady\(\) : null\]\)\.then\(\(\) => \{ if \(window\.qfFixOverflow\) qfFixOverflow\(\);/, name + ': prints after the sprites, and unframes an over-tall page first');
    assert.match(page, /coverOn \|\| qfBody \? '' :|coverOn\|\|qfBody\?"":/, name + ': the hero card replaces the old print header');
  }
});
