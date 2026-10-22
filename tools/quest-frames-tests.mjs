// 🎮 Quest frames: the shared switch, the art this site serves, the portal's
// page-1 lead / gems / quest-page sheets and planner box, and the creators' Quest pages. Runs the REAL
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

test('the portal\'s page-1 lead: the quest it is on, and the room the start header needs', () => {
  const { QF, QC } = load();
  const q = QC.ctx({ subject: 'science', title: 'Food chains', topics: ['Food chains'], questions: 9, total: 23 });
  assert.equal(q.total, 23, 'the chest is scored out of the marks the questions carry');
  assert.equal(QC.ctx({ title: 'x', total: -4 }).total, 0, 'never a negative total');
  const start = QC.portalLead(q, false, false);
  assert.match(start, /^<div class="qf-print-lead qf-print-lead--start" aria-hidden="true" data-qf="/, 'with the name fields on, page 1 is a START page');
  const extra = QF.PAGE.safeTop.start - QF.PAGE.safeTop.trail;
  assert.equal(QC.SHEET.startExtra, extra);
  assert.ok(start.includes('style="height:calc(' + extra + 'px / var(--qf-pz, 1))"'), 'its room is the start header\'s, at any fit-to-page zoom');
  const plain = QC.portalLead(q, false, true);
  assert.match(plain, /^<div class="qf-print-lead" aria-hidden="true" data-qf="/, 'with the fields off, page 1 is a trail page…');
  assert.doesNotMatch(plain, /style=/, '…and the lead takes no room at all');
  assert.equal(QC.portalLead(q, true, false), start, 'a cover in front changes nothing: the strip printed under a cover too');
  assert.equal(QC.portalLead(null, false, false), '', 'no quest, no lead');
  // It is markup the planner, the printer and the preview all read back.
  const attr = start.match(/data-qf="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const el = { getAttribute: (k) => (k === 'data-qf' ? attr : null) };
  assert.deepEqual({ ...QC.leadCtxOf(el) }, { subject: 'science', world: q.world, seed: 'Food chains', title: 'Food chains', questions: 9, total: 23, start: true });
  assert.deepEqual({ ...QC.leadCtx({ querySelector: (sel) => (sel === '.qf-print-lead' ? el : null) }) }, { ...QC.leadCtxOf(el) }, 'found in the page it sits in');
  assert.equal(QC.leadCtx({ querySelector: () => null }), null, 'an unframed page has no lead');
  assert.equal(QC.leadCtxOf({ getAttribute: () => '{not json' }), null, 'a broken lead frames nothing');
  const odd = QC.leadCtxOf({ getAttribute: () => JSON.stringify({ world: 'nowhere', title: '', questions: -3, total: 'lots' }) });
  assert.ok(QF.pure.worldOf(odd.world), 'an unknown world becomes a real one');
  assert.equal(odd.title, 'Worksheet');
  assert.equal(odd.questions, 0);
  assert.equal(odd.total, 0);
  // A title carrying markup is data, never markup.
  const sly = QC.portalLead(QC.ctx({ title: '"><img src=x onerror=alert(1)>' }), false, false);
  assert.doesNotMatch(sly, /<img/, 'the title is escaped inside the attribute');
});

test('which page of the quest a sheet is: start, trail, finale', () => {
  const { QC } = load();
  const sheet = (start) => ({ querySelector: (sel) => (start && sel === '.qf-print-lead--start' ? {} : null) });
  assert.equal(QC.variantOf(sheet(true), 0, 4), 'start', 'the sheet holding the start lead');
  assert.equal(QC.variantOf(sheet(false), 1, 4), 'trail');
  assert.equal(QC.variantOf(sheet(false), 3, 4), 'finale', 'the last framed sheet holds the treasure');
  assert.equal(QC.variantOf(sheet(false), 0, 4), 'trail', 'page 1 without the name fields is a trail page');
  assert.equal(QC.variantOf(sheet(true), 0, 1), 'start', 'a one-sheet worksheet with the fields is a start page');
  assert.equal(QC.variantOf(sheet(false), 0, 1), 'finale', 'and without them, the finale');
  const tail = SRC.slice(SRC.indexOf('function frameSheets('), SRC.indexOf('function framePrintPages('));
  assert.match(tail, /QF\.decorate\(sheet, \{/, 'every sheet is dressed by the design system\'s own page layout');
  assert.match(tail, /fields: PORTAL_FIELDS/);
  assert.match(SRC, /var PORTAL_FIELDS = \[\['HERO NAME', 'name'\], \['DATE', 'date'\]\];/, 'the hero card is Name and Date, like the portal\'s strip (Class went in v1.438.0)');
  assert.match(tail, /cheer: i === 0 && variant === 'trail' \? QF\.CHEERS\[0\] : undefined/, 'page 1 is never told it is almost at the treasure');
  assert.equal(QC.contentPx(), 296 * 96 / 25.4 - QC.SHEET.top - QC.SHEET.bottom);
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

test('the frame\'s walls and bands never reach the box the questions print in', () => {
  const { QF, QC } = load();
  const px = (mm) => mm * 96 / 25.4;
  const S = QC.SHEET;
  const G = QF.FITS.frame;
  // The box on a 794 x 1123 design page: the 16mm sides, under the header
  // band's line, above the tallest footer.
  const box = { l: px(S.sideMm), r: 794 - px(S.sideMm), t: S.top, b: px(S.heightMm) - S.bottom };
  assert.ok(G.inset + G.band + 6 < box.l, 'the side walls and their rim end before the 16mm side');
  assert.ok(box.r < 794 - (G.inset + G.band + 6), 'on both sides');
  // Every header piece's top and every footer piece's top, as the design
  // system's own stylesheet places them.
  const tops = (re) => [...CSS.matchAll(re)].map((m) => +m[1]);
  const foot = tops(/\.qf-foot-(?:hero|xp|cheer|chest)\s*\{[^}]*?top:\s*([\d.]+)px/g);
  assert.equal(foot.length, 4, 'hero, XP trail, cheer and chest found');
  foot.forEach((t) => assert.ok(t >= box.b + 10, `a footer piece at ${t}px starts clear of the box (its foot is ${box.b.toFixed(1)}px)`));
  assert.equal(Math.min(...foot), 966, 'the chest is the tallest footer…');
  assert.equal(S.bottom, Math.max(QF.PAGE.safeBottom.start, QF.PAGE.safeBottom.trail, QF.PAGE.safeBottom.finale) + 14, '…and the box keeps the finale\'s line plus a gap on every sheet');
  assert.equal(S.top, QF.PAGE.safeTop.trail, 'the box starts on the trail header\'s line');
  assert.equal(S.top + S.startExtra, QF.PAGE.safeTop.start, 'and page 1\'s lead takes it to the start header\'s line');
  assert.ok(S.heightMm <= 296, 'never a hair over A4, or a blank sheet follows every page');
});

test('framed portal sheets: margin-free A4, padded down to the box the planner plans', () => {
  const { QC } = load();
  const S = QC.SHEET;
  const rule = CSS.match(/#printOutput > \.print-question-page\.qf-sheet \{([^}]*)\}/)[1];
  assert.match(CSS, /@page qf-sheet \{ size: A4 portrait; margin: 0; \}/);
  assert.match(rule, /page: qf-sheet/);
  assert.match(rule, /width: 210mm/);
  assert.equal(parseFloat(rule.match(/height: ([\d.]+)mm/)[1]), S.heightMm);
  const pad = (r) => { const m = r.match(/padding: ([\d.]+)px ([\d.]+)mm ([\d.]+)px/); return m && m.slice(1).map(Number); };
  assert.deepEqual(pad(rule), [S.top, S.sideMm, S.bottom], 'the printed sheet\'s padding IS quest-frames.js SHEET');
  const preview = CSS.match(/\.wspv-sheet\.qf-sheet \{([^}]*)\}/)[1];
  assert.deepEqual(pad(preview), [S.top, S.sideMm, S.bottom], 'and so is the live preview\'s');
  assert.match(preview, /height: 296mm/);
  // THE BUG v1.444.0 SHIPPED: Chrome lets a later stylesheet's plain @page beat
  // an earlier one's named page, so the named page has to be declared in
  // index.html too, AFTER its plain @page — or every framed sheet prints shrunk.
  const plainAt = INDEX.search(/@page \{\s*size: A4 portrait;\s*margin: 18mm 16mm 20mm 16mm;/);
  const namedAt = INDEX.indexOf('@page qf-sheet { size: A4 portrait; margin: 0; }');
  assert.ok(plainAt > 0, 'the portal\'s plain @page is where the test expects it');
  assert.ok(namedAt > plainAt, 'index.html declares @page qf-sheet AFTER its plain @page');
  assert.ok(INDEX.indexOf('<link rel="stylesheet" media="print" onload="this.media=\'all\'" href="quest-frames.css') < plainAt, 'quest-frames.css loads before it, which is why');
  assert.doesNotMatch(CSS, /qf-sheet-frame|qf-print-head/, 'the margin-only rampart and the in-column header are gone');
  assert.doesNotMatch(CSS, /@import/, 'no extra font request: index.html asks for Pixelify Sans in its print-only font link');
  assert.match(INDEX, /media="print" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Crimson\+Pro[^"]*family=Pixelify\+Sans/);
  assert.match(INDEX, /<link rel="stylesheet" media="print" onload="this\.media='all'" href="quest-frames\.css\?v=/, 'non-blocking, like every other stylesheet the screen does not need');
});

test('app.js: both print doors, the preview and the planner all carry the frame', () => {
  assert.match(APP, /function _qfPrintCtx\(selected, title\) \{\n  const QC = window\.QuestFramesCer;\n  if \(!QC \|\| !_isAdmin\(\) \|\| !QC\.on\(\)\) return null;/, 'off, missing or not the teacher → null → the old sheet');
  assert.match(APP, /const total = qs\.reduce\(\(t, x\) => t \+ _qfQuestionMarks\(x\), 0\);\n  const q = QC\.ctx\(\{ subject: 'science', title, topics: qs\.map\(x => x && x\.topic\), questions: qs\.length, total \}\);/, 'the chest is scored out of the sheet\'s marks');
  assert.match(APP, /objBoxPrintOn\('builder'\), wsArtwork, _qfPrintCtx\(selected, title\)\);/, 'worksheet builder passes it');
  assert.match(APP, /objBoxPrintOn\('saved'\), ws\.artwork, _qfPrintCtx\(selected, ws\.title\)\);/, 'My Worksheets passes it');
  assert.match(APP, /questFrame: \(!o\.noTags && \(ctx\.where === 'builder' \|\| ctx\.where === 'saved'\)\) \? _qfPrintCtx\(selected, title\) : null,/, 'the preview paginates with the same lead; the Study Buddy photograph stays plain');
  assert.match(APP, /function _wsHeaderHtml\(worksheetTitle, hasCover, noFields, questFrame\) \{\n(?:  \/\/[^\n]*\n)*  if \(questFrame && window\.QuestFramesCer\) return window\.QuestFramesCer\.portalLead\(questFrame, hasCover, noFields\);/);
  assert.equal((APP.match(/_wsHeaderHtml\(worksheetTitle, hasCover, noFields, questFrame\)/g) || []).length, 3, 'both header call sites pass it');
  assert.match(APP, /autoscaleAndPrint\(output, \{ forcedBreakIds: wsManualBreaks, mergeUpIds: wsMergeUp, questFrame: questFrame \|\| null \}\);/);
  const tail = APP.slice(APP.indexOf('function doScaleAndPrint('), APP.indexOf('// EXAM PAPER BUILDER'));
  const numbered = tail.indexOf('_printApplyPageNumbers(output);');
  const framed = tail.indexOf('QC.framePrintPages(output, questFrame);');
  assert.ok(numbered > 0 && framed > numbered, 'the frame goes on AFTER the sheets are planned and numbered');
  assert.ok(tail.indexOf('QC.ready(output, 8000).then(') > framed, 'and the print waits for the sprites');
  // The planner plans a framed sheet to the box between the bands…
  const plan = APP.slice(APP.indexOf('function _printPlanIn('), APP.indexOf('function _printFontLinksHtml('));
  assert.match(plan, /const pagePx = _printPagePxFor\(root, opts\);\n  const usable = pagePx - numH - PRINT_FIT_SAFETY;/, 'the questions are planned to the framed box');
  assert.match(plan, /_classifyPrintChunks\(heights, footerH, budget, usable, pagePx\)/, 'and classified against it');
  assert.match(plan, /const akUsable = PRINT_PAGE_PX - numH - PRINT_FIT_SAFETY;/, 'the answer key prints plain, so it is planned to the ordinary sheet');
  assert.match(plan, /_printSetContentZoom\(content, zoom\);/, 'the planner measures a shrunk page with the lead\'s room held');
  // …and the printer and the preview paint the same zoom, and the preview the same frame.
  assert.match(APP, /function _printApplyZoom\(page, z\) \{\n  page\.style\.zoom = '';\n  page\.style\.height = '';\n  const content = page\.querySelector\(':scope > \.print-page-content'\);\n  _printSetContentZoom\(content, z\);\n\}/);
  const pv = APP.slice(APP.indexOf('function _wsPreviewPack('), APP.indexOf('// WORKSHEET QUICK EDIT'));
  assert.match(pv, /questFrame = \(QC && typeof QC\.leadCtx === 'function'\) \? QC\.leadCtx\(measure\) : null;/, 'the preview reads the quest off the same lead');
  assert.match(pv, /const framedHere = !!questFrame && !plan\.pageTall\[gi\];/, 'a tall (flowing) page stays plain, as it prints');
  assert.match(pv, /QC\.frameSheets\(framedSheets, questFrame, \{ still: true \}\)/, 'and dresses its sheets through the printer\'s own frameSheets');
  assert.equal((pv.match(/content\.style\.zoom = /g) || []).length, 0, 'every zoom in the preview goes through _printSetContentZoom');
});

// The planner's half, cut out of app.js and run.
function planner(QuestFramesCer) {
  const cut = (name, end) => { const i = APP.indexOf('function ' + name + '('); return APP.slice(i, APP.indexOf(end, i)); };
  const src = [
    APP.match(/\nconst PRINT_PAGE_PX = [^\n]*;/)[0],
    APP.match(/\nconst PRINT_ZOOM_FLOOR = [^\n]*;/)[0],
    cut('_classifyPrintChunks', '\n// ---- Accurate A4 print measurement'),
    cut('_printPagePxFor', '\n// A page\'s fit-to-page zoom'),
    cut('_printSetContentZoom', '\n// Plan the whole document'),
    'this.out = { PRINT_PAGE_PX, _classifyPrintChunks, _printPagePxFor, _printSetContentZoom };'
  ].join('\n');
  const ctx = vm.createContext({ window: { QuestFramesCer } });
  vm.runInContext(src, ctx);
  return ctx.out;
}

test('the planner: a framed worksheet plans to the box between the bands, everything else to the sheet', () => {
  const { QC } = load();
  const root = (framed) => ({ querySelector: (sel) => (framed && sel === '.qf-print-lead' ? { getAttribute: () => JSON.stringify({ world: 'volcano', title: 'Heat', questions: 3 }) } : null) });
  const P = planner(QC);
  assert.equal(P._printPagePxFor(root(false), {}), P.PRINT_PAGE_PX, 'no lead: byte for byte the old planner');
  assert.equal(P._printPagePxFor(root(true), {}), QC.contentPx(), 'a lead: the framed box');
  assert.ok(QC.contentPx() < P.PRINT_PAGE_PX * 0.9, 'which is really shorter');
  assert.equal(P._printPagePxFor(root(false), { pagePx: 700 }), 700, 'a caller that knows is honoured');
  assert.equal(P._printPagePxFor(root(false), { pagePx: 5000 }), P.PRINT_PAGE_PX, 'never taller than a sheet');
  assert.equal(planner(null)._printPagePxFor(root(true), {}), P.PRINT_PAGE_PX, 'no frame script: the old planner');
  assert.equal(planner({ leadCtx: () => { throw new Error('x'); }, contentPx: () => 800 })._printPagePxFor(root(true), {}), P.PRINT_PAGE_PX, 'a lead that throws frames nothing');
  assert.equal(planner({ leadCtx: () => ({}), contentPx: () => 200 })._printPagePxFor(root(true), {}), P.PRINT_PAGE_PX, 'an unbelievable box is refused');
  // Two compact questions share a sheet when each is half a page: half of the SHEET they print on.
  const ord = P._classifyPrintChunks([480], 30, 900, 930);
  const framed = P._classifyPrintChunks([480], 30, 760, 790, QC.contentPx());
  assert.equal(ord.half, Math.round(P.PRINT_PAGE_PX / 2));
  assert.equal(ord.pairFlags[0], true, 'half an ordinary sheet');
  assert.equal(framed.half, Math.round(QC.contentPx() / 2));
  assert.equal(framed.pairFlags[0], false, 'is more than half a framed box');
  // The zoom and the lead's room travel together, and clear together.
  const style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
  const content = { style };
  P._printSetContentZoom(content, 0.82);
  assert.equal(style.zoom, 0.82);
  assert.equal(style['--qf-pz'], '0.82');
  P._printSetContentZoom(content, 1);
  assert.equal(style.zoom, '');
  assert.equal(style['--qf-pz'], undefined);
  P._printSetContentZoom(null, 0.5);
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
