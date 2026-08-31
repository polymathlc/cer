// Regression tests for THE SUBJECT SWITCHER and ⚡ RAPID ADD'S BATCH LEVEL.
// Run with:
//     node tools/subject-level-tests.mjs            all cases
//     node tools/subject-level-tests.mjs <name>     one case
//
// It loads the REAL SUBJECT_APPS table, the real `_rapidApplyLevel` and the
// real build prompt out of app.js. Both features fail SILENTLY, in opposite
// directions, and neither throws anything:
//
//  • THE SWITCHER is four links. A url pointing at the wrong folder does not
//    error — it loads a working app, the WRONG subject's, and a student who
//    lands in Science when they pressed Math reads that as the app being
//    broken. The Science one is the trap: its repo, and therefore its folder,
//    is `cer`, so the obvious `../science/` is a 404 for every student at once.
//  • AN ABSOLUTE url is the slower version of the same failure. It works
//    perfectly today and pins all four apps to github.io on the day the centre
//    moves to a domain of its own.
//  • THE BATCH LEVEL has no field to check itself against. A level is read off
//    the TOPIC in this app (`getTopicLevel`), so "file this batch at P5" is
//    carried out by narrowing the topics the AI may choose from. Narrow
//    nothing and the picker still says "filed at P5", the toast still says
//    "at P5", and forty questions land at whatever level the AI's topic
//    happened to belong to.
//  • THE SNAP is the guard for a reply that ignored the list, and it can fail
//    both ways: too loose and an off-level topic is kept while the author was
//    promised a level, too eager and it overwrites a topic that was right.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The topic lists these tests run against. Deliberately NOT the app's own —
// the point is the SHAPE of the narrowing, and a fixture keeps the harness
// from failing every time a teacher adds a topic.
const FIXTURE = `
const QRETIRED_TOPIC_RE = /cell\\s*systems?/i;
function currentTopicsByLevel() {
  return {
    P3: ['Magnets', 'Materials'],
    P4: ['Heat'],
    // 'Cell Systems' is the RETIRED topic, still reachable as a custom topic an
    // admin added years ago — it must never be a snap target.
    P5: ['Cell Systems', 'Electrical Systems', 'Water and its 3 States'],
    P6: [],                                  // a level whose topics were all removed
    S1: ['Separation Techniques', 'Atoms and Molecules']
  };
}
function currentTopics() {
  const b = currentTopicsByLevel();
  return TOPIC_LEVELS.reduce((a, lv) => a.concat(b[lv]), []);
}
function escapeHtml(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function qSecondaryTopic(q) { return (q && typeof q.topic2 === 'string') ? q.topic2.trim() : ''; }
function _genPreamble() { return ''; }
function _aiTagsPromptLine() { return ''; }
function _rectangleRules() { return ''; }
function _partsPromptRules() { return ''; }
const SCAN_READING_NOTE = '';
`;

const section = [
  cut('const SUBJECT_KEY =', '\n// The menu is BUILT from SUBJECT_APPS', 'subject table'),
  // The REAL level ladder, not a stub: the whole point of S1 is that it is a
  // RUNG rather than a number sliced out of the string, and a fixture copy
  // could hold the right answer while app.js held the wrong one.
  cut('// ── THE LEVEL LADDER', '\nlet customTopics = {}', 'level ladder'),
  cut('function getLevelNumber(level) {', '\nfunction openStudentSetup()', 'level number'),
  // The REAL topic tables. A topic listed in the practice grid but missing
  // from topicLevelMap resolves to the P6 default, so it appears under S1 on
  // screen and is served to P6 children — right-looking on both surfaces.
  cut('const topicLevelMap = {', '\n// ── Custom topic management', 'topic level map'),
  cut('const topicsByLevel = {', '\nconst levelColors', 'topics by level'),
  cut('const levelColors = {', '\nconst topicEmojis', 'level colours'),
  cut('const topicEmojis = {', '\nlet tpQueue', 'topic emojis'),
  cut('function _rapidApplyLevel(q, level)', '\nfunction openRapidAdd()', 'level snap'),
  cut('function _aiBuildQuestionPrompt(isPdf, imageCount, levelHint)', '\n// The lettered-parts rules', 'build prompt'),
  FIXTURE
].join('\n');

const M = new Function(section +
  '\nreturn { SUBJECT_KEY, SUBJECT_APPS, subjectCurrent, _rapidApplyLevel, _aiBuildQuestionPrompt, currentTopicsByLevel,\n  TOPIC_LEVELS, LEVEL_ORDER, LEVEL_MAX, LEVEL_MIN, isLevelCode, isSecondaryLevel, getLevelNumber, levelFromNumber, audienceFor, schoolFor, levelOptionsHtml,\n  topicLevelMap, topicsByLevel, levelColors, topicEmojis };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

// ── the switcher: four links that have to go where they say ─────────────────

test('all four subjects are listed, once each', () => {
  eq(M.SUBJECT_APPS.length, 4, 'there are not four subjects');
  const keys = M.SUBJECT_APPS.map(s => s.key).sort();
  eq(keys, ['chinese', 'english', 'math', 'science'], 'the four subject keys');
  eq(new Set(keys).size, 4, 'two subjects share a key — the menu would mark the wrong one "You are here"');
});

test('every subject has something to show and somewhere to go', () => {
  M.SUBJECT_APPS.forEach(s => {
    ok(s.ico && s.ico.trim(), s.key + ' has no icon — the narrow pill is icon-only, so it would show nothing at all');
    ok(s.label && s.label.trim(), s.key + ' has no label');
    ok(s.sub && s.sub.trim(), s.key + ' has no sub-title');
    ok(s.url && s.url.trim(), s.key + ' has no url');
  });
});

test('THIS app knows which of the four it is', () => {
  // subjectCurrent falls back to SUBJECT_APPS[0] — Math — so a SUBJECT_KEY
  // that matches nothing does not throw. It silently labels the Chinese
  // portal "Math" and offers a link back to the app you are already in.
  eq(M.SUBJECT_KEY, 'science', 'SUBJECT_KEY is not this app');
  const me = M.SUBJECT_APPS.find(s => s.key === M.SUBJECT_KEY);
  ok(me, 'SUBJECT_KEY names no subject in SUBJECT_APPS');
  eq(M.subjectCurrent().key, M.SUBJECT_KEY, 'subjectCurrent() fell through to the first entry');
});

test('Science lives at ../cer/ — the folder is the REPO name, not the subject', () => {
  // The one everybody gets wrong. `../science/` is a 404 on GitHub Pages for
  // every student at once, and it looks exactly like a link that was never
  // finished.
  const sci = M.SUBJECT_APPS.find(s => s.key === 'science');
  eq(sci.url, '../cer/', 'the Science url');
  eq(M.SUBJECT_APPS.find(s => s.key === 'math').url, '../math/');
  eq(M.SUBJECT_APPS.find(s => s.key === 'english').url, '../english/');
  eq(M.SUBJECT_APPS.find(s => s.key === 'chinese').url, '../chinese/');
});

test('every url is RELATIVE — no host is baked into the app', () => {
  // The four are sibling folders on one host (GitHub Pages project sites), so
  // a relative hop works there, on a local checkout and on a custom domain
  // later. An absolute https://polymathlc.github.io/... works perfectly right
  // up until the centre moves, and then sends every student back to the old
  // host from inside the new one.
  M.SUBJECT_APPS.forEach(s => {
    ok(!/^[a-z]+:/i.test(s.url), s.key + ': "' + s.url + '" names a protocol');
    ok(!/^\/\//.test(s.url), s.key + ': "' + s.url + '" is protocol-relative, which still pins the host');
    ok(s.url.startsWith('../'), s.key + ': "' + s.url + '" is not a sibling-folder hop');
    ok(s.url.endsWith('/'), s.key + ': "' + s.url + '" should end in / so the folder index is served');
  });
});

// ── the level LADDER: P3 → P6 → S1 ─────────────────────────────────────────
// Every failure here is silent and the app renders perfectly either way. Read
// 'S1' as a number and Secondary 1 sorts BELOW P3, so every Sec 1 question is
// served to the youngest child in the school; reject 'S1' as a level code and
// a Sec 1 student's assignment is thrown away and they are quietly capped at
// the default instead. Neither throws, and neither shows on any screen.

test('S1 is the TOP rung, not the number 1', () => {
  // parseInt('S1'.replace('P','')) is 1. That is the bug this pins.
  ok(M.getLevelNumber('S1') > M.getLevelNumber('P6'), 'S1 must outrank P6');
  eq(M.getLevelNumber('S1'), 7, 'S1 rung');
  ['P3', 'P4', 'P5', 'P6'].forEach(lv => {
    ok(M.getLevelNumber('S1') > M.getLevelNumber(lv), 'S1 must outrank ' + lv);
  });
});

test('the ladder is in order and has no gaps', () => {
  const nums = M.TOPIC_LEVELS.map(M.getLevelNumber);
  nums.forEach((n, i) => {
    if (i) ok(n === nums[i - 1] + 1, 'the ladder skips a rung at ' + M.TOPIC_LEVELS[i]);
  });
  eq(M.LEVEL_MIN, M.TOPIC_LEVELS[0], 'LEVEL_MIN is not the bottom of the ladder');
  eq(M.LEVEL_MAX, M.TOPIC_LEVELS[M.TOPIC_LEVELS.length - 1], 'LEVEL_MAX is not the top');
  // LEVEL_MAX is what an UNASSIGNED student is capped at, i.e. no restriction.
  // Pinned to 'P6' it would hide every Sec 1 question from the whole school
  // until an admin went round assigning levels one child at a time.
  eq(M.LEVEL_MAX, 'S1', 'the top of the ladder');
});

test('every rung is a valid level code, and nothing else is', () => {
  M.TOPIC_LEVELS.forEach(lv => ok(M.isLevelCode(lv), lv + ' is not accepted as a level'));
  ['', 'P2', 'P7', 'S2', 's1', 'Sec 1', '1', 'P', null, undefined, 'P6 ']
    .forEach(v => ok(!M.isLevelCode(v), JSON.stringify(v) + ' must not pass as a level'));
});

test('levelFromNumber is the inverse, and clamps to the ladder', () => {
  M.TOPIC_LEVELS.forEach(lv => eq(M.levelFromNumber(M.getLevelNumber(lv)), lv, 'round trip ' + lv));
  // Off the ends. clampToStudentLevel eases a level DOWN by one, so 2 is
  // reachable and must land on the bottom rung rather than on 'P2'.
  eq(M.levelFromNumber(2), 'P3', 'below the ladder');
  eq(M.levelFromNumber(0), 'P3', 'zero');
  eq(M.levelFromNumber(99), 'S1', 'above the ladder');
  eq(M.levelFromNumber('nonsense'), 'P3', 'junk');
});

test('an unknown level is still the BOTTOM rung, as it always was', () => {
  // getLevelNumber has always answered for junk rather than throwing, and
  // callers rely on that — a level read off a half-written profile must not
  // take a page down.
  eq(M.getLevelNumber(''), 3, 'empty');
  eq(M.getLevelNumber('banana'), 3, 'junk');
  eq(M.getLevelNumber('p5'), 5, 'lower case still resolves');
});

test('only S1 is secondary', () => {
  ok(M.isSecondaryLevel('S1'), 'S1 is secondary');
  ['P3', 'P4', 'P5', 'P6', '', 'junk'].forEach(lv =>
    ok(!M.isSecondaryLevel(lv), lv + ' must not read as secondary'));
});

test('a prompt never tells the model a Sec 1 question is primary', () => {
  // The one way adding S1 could look like it worked and not have: the level
  // is filed correctly and the AI writes P3 science into the question.
  eq(M.schoolFor('S1'), 'lower-secondary', 'S1 role line');
  eq(M.schoolFor('P5'), 'primary-school', 'P5 role line');
  eq(M.schoolFor(''), 'primary-school', 'no level = the old wording');
  ok(/Secondary 1/.test(M.audienceFor('S1')), 'the S1 audience must say Secondary 1');
  ok(!/primary/.test(M.audienceFor('S1')), 'the S1 audience must not say primary');
  ok(/P5/.test(M.audienceFor('P5')), 'a known primary level names the year');
  // With NO level in hand it must name the whole ladder — a prompt that says
  // "primary" is the default for every ungrounded call in the app.
  ok(/Secondary 1/.test(M.audienceFor('')), 'the unknown-level audience must include Secondary 1');
});

test('every level dropdown is built from the ladder', () => {
  const html = M.levelOptionsHtml('S1');
  M.TOPIC_LEVELS.forEach(lv => ok(html.indexOf('value="' + lv + '"') >= 0, lv + ' is missing from the dropdown'));
  ok(/value="S1" selected/.test(html), 'the chosen level is not selected');
  // The blank row is opt-in: a level picker that quietly offers "no level"
  // where none was asked for lets a student be saved with no cap at all.
  ok(M.levelOptionsHtml('P5').indexOf('value=""') < 0, 'an unasked-for blank option');
  ok(M.levelOptionsHtml('', '—').indexOf('value="" selected') >= 0, 'the blank option is not selected when nothing is set');
});

test('the S1 topics really are filed at S1', () => {
  // The narrowing is by TOPIC — there is no q.level field in this app — so a
  // Sec 1 topic filed at P6 is a Sec 1 question served to P6 children.
  const s1 = M.topicsByLevel.S1 || [];
  ok(s1.length, 'S1 has no topics — nothing could be filed there at all');
  s1.forEach(t => eq(M.topicLevelMap[t], 'S1', t + ' is in the S1 grid but topicLevelMap files it elsewhere'));
});

test('every level has topics, a colour and an emoji per topic', () => {
  // A level with no colour throws when the topical-practice grid draws its
  // badge (`colors.bg`); a topic with no emoji falls back to 📘, which is only
  // untidy — so the colour is the one pinned hard.
  M.TOPIC_LEVELS.forEach(lv => {
    ok((M.topicsByLevel[lv] || []).length, lv + ' has no topics in the practice grid');
    ok(M.levelColors[lv] && M.levelColors[lv].bg && M.levelColors[lv].fg,
      lv + ' has no colour — the topical-practice grid throws drawing its badge');
    (M.topicsByLevel[lv] || []).forEach(t =>
      ok(M.topicEmojis[t], t + ' has no emoji'));
  });
});

test('the practice grid and the level map name the SAME topics', () => {
  Object.keys(M.topicsByLevel).forEach(lv => {
    (M.topicsByLevel[lv] || []).forEach(t =>
      eq(M.topicLevelMap[t], lv, t + ' is shown under ' + lv + ' but filed under ' + M.topicLevelMap[t]));
  });
  Object.keys(M.topicLevelMap).forEach(t => {
    const lv = M.topicLevelMap[t];
    ok((M.topicsByLevel[lv] || []).indexOf(t) >= 0,
      t + ' is filed at ' + lv + ' but never appears in the topical-practice grid');
  });
});

// ── the batch level: narrowing the topics is the whole mechanism ────────────

test('a level narrows the prompt to THAT level\'s topics', () => {
  const p = M._aiBuildQuestionPrompt(false, 1, 'P5');
  ok(p.indexOf('Electrical Systems') >= 0, 'the P5 topics are not offered');
  ok(p.indexOf('Water and its 3 States') >= 0, 'the P5 topics are not all offered');
  ok(p.indexOf('Magnets') < 0, 'a P3 topic is still on offer — the batch level does nothing');
  ok(p.indexOf('Heat') < 0, 'a P4 topic is still on offer');
  ok(/Every question on this page is P5 level/.test(p), 'the model is never told which level this is');
});

test('NO level leaves the prompt exactly as it always was', () => {
  // Every other caller — 🤖 Build from screenshot — passes nothing, and must
  // see the whole topic list chosen from freely.
  const p = M._aiBuildQuestionPrompt(false, 1);
  ['Magnets', 'Heat', 'Electrical Systems'].forEach(t =>
    ok(p.indexOf(t) >= 0, 'the unlevelled prompt dropped "' + t + '"'));
  ok(!/Every question on this page is/.test(p), 'an unlevelled build was told a level anyway');
});

test('a level with no topics left falls back to the whole list', () => {
  // Sending an empty "choose from EXACTLY this list" leaves the model nothing
  // to choose from, and it invents a topic instead.
  const p = M._aiBuildQuestionPrompt(false, 1, 'P6');
  ok(p.indexOf('Magnets') >= 0, 'an empty level sent an empty topic list');
  ok(!/Every question on this page is P6 level/.test(p), 'it promised a level it could not file at');
});

// ── the snap: the guard for a reply that ignored the list ───────────────────

test('a topic already in the level is left alone', () => {
  const q = { topic: 'Electrical Systems', topicConfidence: 'high' };
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic, 'Electrical Systems', 'a correct topic was overwritten');
  eq(q.topicConfidence, 'high', 'a correct topic was flagged for checking');
});

test('an OFF-level topic is snapped into the level and flagged', () => {
  // The author said P5. Keeping 汉语拼音 files it at P3 while the toast says
  // P5 — so it is snapped, and the one thing that had to be guessed (which
  // P5 topic) is marked 'low', which draws the ⚠ check topic badge in vetting.
  const q = { topic: 'Magnets', topicConfidence: 'high' };
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic, 'Electrical Systems', 'an off-level topic survived the batch level');
  eq(q.topicConfidence, 'low', 'a guessed topic was not flagged for checking');
});

test('a topic on NO list is snapped too', () => {
  const q = { topic: 'Something the model invented' };
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic, 'Electrical Systems', 'an unknown topic was kept');
  eq(q.topicConfidence, 'low');
});

test('a SECONDARY topic above the level is dropped', () => {
  // qLevelNum takes the MAX over both topics, so a P6 secondary topic puts the
  // question above the level the author chose while the primary topic looks
  // perfectly right — the level is wrong and nothing on the card shows it.
  const q = { topic: 'Electrical Systems', topic2: 'Forces' };
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic2, '', 'an out-of-level secondary topic survived');
  eq(q.topic, 'Electrical Systems', 'the primary topic was disturbed');
});

test('a secondary topic INSIDE the level is kept', () => {
  const q = { topic: 'Electrical Systems', topic2: 'Water and its 3 States' };
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic2, 'Water and its 3 States', 'a valid secondary topic was thrown away');
});

test('no level chosen changes nothing at all', () => {
  const q = { topic: 'Magnets', topic2: 'Forces', topicConfidence: 'high' };
  M._rapidApplyLevel(q, '');
  eq(q.topic, 'Magnets', 'an unlevelled batch was re-filed');
  eq(q.topic2, 'Forces', 'an unlevelled batch lost its secondary topic');
  eq(q.topicConfidence, 'high', 'an unlevelled batch was flagged');
});

test('a level with no topics behind it never re-files a question', () => {
  // Better the AI's own topic than a level with nothing to file into.
  const q = { topic: 'Magnets', topicConfidence: 'high' };
  M._rapidApplyLevel(q, 'P6');
  eq(q.topic, 'Magnets', 'a question was filed into an empty level');
  eq(q.topicConfidence, 'high');
});

test('a RETIRED topic is never the snap target', () => {
  // Cell Systems has left the syllabus, and qInSyllabus keeps it out of every
  // practice mode and every game. Snapping a brand-new question into it would
  // file one no student can ever be served — worse than an off-level topic,
  // and completely invisible: the vetting card looks perfectly normal.
  const q = { topic: 'Magnets' };
  M._rapidApplyLevel(q, 'P5');
  ok(!/cell\s*systems?/i.test(q.topic), 'a question was filed into the retired topic');
  eq(q.topic, 'Electrical Systems', 'it should fall to the first LIVE topic of the level');
});

test('the snap survives a question with no topic at all', () => {
  const q = {};
  M._rapidApplyLevel(q, 'P5');
  eq(q.topic, 'Electrical Systems', 'a topicless question was left topicless');
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
