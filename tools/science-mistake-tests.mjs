// 🐾 The mistake analysis card that FOLLOWS a Science Sidekick — the pure half.
// Run with:  node --test tools/science-mistake-tests.mjs
//
// The card is drawn from three things that can each go quietly wrong: the
// ten animal figures in science-mistake-art.js, the analysis object
// science-mistakes.js builds from what app.js hands it, and the stylesheet
// and workflow that carry both. Every failure here is silent — the answer
// is still marked, the coach still appears, and the habit is simply not
// shown, shown for the wrong animal, or shown with a classmate's exact
// words rendered unescaped into the page.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MISTAKE_ANIMAL_ART_IDS, renderMistakeAnimalAvatar, mistakeAnimalAccent } from '../science-mistake-art.js';
import { prepareMistakeAnalysis } from '../science-mistakes.js';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/science-coaches.yml', import.meta.url), 'utf8');

/* The taxonomy as app.js really declares it — the ids in declaration order. */
function taxonomyIds() {
  const start = src.indexOf('var MISTAKE_ANIMALS = [');
  const end = src.indexOf('var MISTAKE_ANIMAL_RULE =', start);
  assert.ok(start > 0 && end > start, 'the shared taxonomy block exists in app.js');
  return [...src.slice(start, end).matchAll(/\{ id: '([a-z]+)',/g)].map(m => m[1]);
}
const animal = (id, extra = {}) => ({ id, emoji: '🦜', animal: 'The Parrot', name: 'Repeated the question',
  desc: 'Restated the question instead of answering it.', spot: 'Nothing new in the answer.', fix: 'Add the science.', ...extra });
const good = (extra = {}) => ({ verdict: 'partial', animal: animal('parrot'), why: 'You restated the rise.',
  question: { title: 'Compare the results', label: '(b) Evidence', text: 'Which cup cooled fastest?\nOption 1: Cup A', images: ['fruit.png'] },
  student: 'A rose higher.', roster: [animal('parrot'), animal('rabbit', { animal: 'The Rabbit', name: 'Rushed it' })], ...extra });

test('the art knows exactly the ten shared animals, in the shared order', () => {
  assert.deepEqual([...MISTAKE_ANIMAL_ART_IDS], taxonomyIds());
  assert.ok(Object.isFrozen(MISTAKE_ANIMAL_ART_IDS));
});

test('every animal renders a self-contained animated figure with no ids, filters, gradients or scripts', () => {
  const seen = new Set();
  for (const id of MISTAKE_ANIMAL_ART_IDS) {
    const svg = renderMistakeAnimalAvatar(id);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 180 180"/, id);
    assert.match(svg, new RegExp(`class="sc-avatar sc-avatar--mistake-${id}"`), id + ' carries the shared avatar class');
    assert.match(svg, /data-animal="[a-z]+"/, id + ' names its species');
    assert.match(svg, /aria-hidden="true"/, id + ' is decorative');
    for (const part of ['sc-avatar-float', 'sc-avatar-blink', 'sc-avatar-hand', 'sc-avatar-spark']) {
      assert.ok(svg.includes(`class="${part}"`), `${id} carries ${part} so the coaches' motion rules animate it`);
    }
    // Repeated on one page beside a coach and in a roster of ten: an id or a
    // url(#…) reference resolves against the wrong copy, and a script or a
    // handler is a way into the page from a data file.
    assert.doesNotMatch(svg, /\sid=/, id + ' has no id attribute');
    assert.doesNotMatch(svg, /url\(#|<filter|<linearGradient|<radialGradient|<script|\son[a-z]+=|<image|href=/i, id);
    assert.equal(svg, renderMistakeAnimalAvatar(id), id + ' renders deterministically');
    seen.add(svg);
  }
  assert.equal(seen.size, MISTAKE_ANIMAL_ART_IDS.length, 'ten different animals, not one drawing relabelled');
});

test('a still figure carries no motion classes and an unknown animal draws nothing', () => {
  const still = renderMistakeAnimalAvatar('sloth', { animated: false });
  assert.match(still, /sc-avatar--still/);
  assert.doesNotMatch(still, /sc-avatar-float|sc-avatar-blink|sc-avatar-hand|sc-avatar-spark/);
  for (const bad of ['dragon', '', null, undefined, 42, {}, 'toString', '__proto__', 'constructor']) {
    assert.equal(renderMistakeAnimalAvatar(bad), '', String(bad));
    assert.equal(mistakeAnimalAccent(bad), null, String(bad));
  }
});

test('every animal has its own accent and wash colour', () => {
  const accents = new Set();
  for (const id of MISTAKE_ANIMAL_ART_IDS) {
    const colours = mistakeAnimalAccent(id);
    assert.match(colours.accent, /^#[0-9a-f]{6}$/i, id);
    assert.match(colours.wash, /^#[0-9a-f]{6}$/i, id);
    accents.add(colours.accent);
  }
  assert.equal(accents.size, MISTAKE_ANIMAL_ART_IDS.length, 'no two animals share an accent');
});

test('a valid analysis is prepared whole, frozen, and with "wrong" read as "incorrect"', () => {
  const data = prepareMistakeAnalysis(good());
  assert.ok(data && Object.isFrozen(data) && Object.isFrozen(data.question) && Object.isFrozen(data.roster));
  assert.equal(data.id, 'parrot');
  assert.equal(data.verdict, 'partial');
  assert.equal(data.animal, 'The Parrot');
  assert.equal(data.name, 'Repeated the question');
  assert.equal(data.fix, 'Add the science.');
  assert.equal(data.why, 'You restated the rise.');
  assert.equal(data.question.title, 'Compare the results');
  assert.equal(data.question.label, '(b) Evidence');
  assert.equal(data.question.text, 'Which cup cooled fastest?\nOption 1: Cup A');
  assert.deepEqual([...data.question.images], ['fruit.png']);
  assert.equal(data.student, 'A rose higher.');
  assert.deepEqual(data.roster.map(m => m.id), ['parrot', 'rabbit']);
  assert.equal(prepareMistakeAnalysis(good({ verdict: 'wrong' })).verdict, 'incorrect');
  assert.equal(prepareMistakeAnalysis(good({ verdict: ' Incorrect ' })).verdict, 'incorrect');
});

test('a correct, unmarked or unknown verdict is never analysed', () => {
  for (const verdict of ['correct', '', 'unknown', undefined, null, 7]) {
    assert.equal(prepareMistakeAnalysis(good({ verdict })), null, String(verdict));
  }
  for (const input of [null, undefined, 'partial', 42, []]) assert.equal(prepareMistakeAnalysis(input), null);
});

test('an animal the art cannot draw, or one missing its own words, is no analysis at all', () => {
  assert.equal(prepareMistakeAnalysis(good({ animal: animal('dragon') })), null, 'an invented animal');
  assert.equal(prepareMistakeAnalysis(good({ animal: 'parrot' })), null, 'a bare string is not a taxonomy entry');
  assert.equal(prepareMistakeAnalysis(good({ animal: null })), null);
  assert.equal(prepareMistakeAnalysis(good({ animal: animal('parrot', { fix: '' }) })), null, 'no lesson, no card');
  assert.equal(prepareMistakeAnalysis(good({ animal: animal('parrot', { name: '   ' }) })), null);
  assert.equal(prepareMistakeAnalysis(good({ animal: animal('parrot', { animal: '' }) })), null);
});

test('missing detail degrades to a card with less on it, never to no card', () => {
  const data = prepareMistakeAnalysis(good({ why: undefined, student: null, question: null, roster: 'not a list' }));
  assert.ok(data);
  assert.equal(data.why, '');
  assert.equal(data.student, '');
  assert.deepEqual({ ...data.question, images: [...data.question.images] }, { title: '', label: '', text: '', images: [] });
  assert.deepEqual([...data.roster], []);
});

test('every string is clipped and stripped of control characters before it can reach the page', () => {
  const long = 'x'.repeat(2000);
  const data = prepareMistakeAnalysis(good({ why: long, student: long, question: { title: long, label: long, text: long + '\n\n\n\n' + long, images: [] } }));
  assert.equal(data.why.length, 280);
  assert.equal(data.student.length, 420);
  assert.equal(data.question.title.length, 160);
  assert.equal(data.question.label.length, 40);
  assert.equal(data.question.text.length, 900);
  assert.ok(data.why.endsWith('…') && data.question.text.endsWith('…'));
  const dirty = prepareMistakeAnalysis(good({ why: 'a bc \t d', student: 'one\n\n\n\n\ntwo', question: { title: 'Title\nwith\nlines', label: 'x', text: 'keep\n\nparagraph', images: [] } }));
  assert.equal(dirty.why, 'abc d');
  assert.equal(dirty.student, 'one\n\ntwo', 'a run of blank lines is one paragraph gap');
  assert.equal(dirty.question.title, 'Title with lines', 'a title is one line');
  assert.equal(dirty.question.text, 'keep\n\nparagraph', 'the wording keeps its paragraphs');
});

test('only a picture from where a question figure can come from is kept, and at most two', () => {
  const data = prepareMistakeAnalysis(good({ question: { text: 'q', images: [
    'https://firebasestorage.googleapis.com/v0/b/x/o/cer-images%2Fa.png?alt=media&token=1',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,RklHVVJF',
    'https://example.com/"onerror="x',
    'blob:https://example.com/12345',
    'assets/figure.png',
    '../cer-images/b.png',
    'vbscript:msgbox',
    'https://example.com/third.png'
  ] } }));
  assert.deepEqual([...data.question.images], [
    'https://firebasestorage.googleapis.com/v0/b/x/o/cer-images%2Fa.png?alt=media&token=1',
    'data:image/png;base64,RklHVVJF'
  ], 'unsafe schemes and quote-bearing urls are dropped, and the card shows at most two figures');
  const relative = prepareMistakeAnalysis(good({ question: { text: 'q', images: ['assets/figure.png', 'blob:https://example.com/12345'] } }));
  assert.deepEqual([...relative.question.images], ['assets/figure.png', 'blob:https://example.com/12345']);
});

test('the roster keeps only animals the art can draw and never more than the card shows', () => {
  const roster = [...MISTAKE_ANIMAL_ART_IDS, 'dragon', 'unicorn', 'rabbit'].map(id => animal(id));
  roster.push(null, 'parrot', { id: 42 });
  const data = prepareMistakeAnalysis(good({ roster }));
  assert.deepEqual(data.roster.map(m => m.id), [...MISTAKE_ANIMAL_ART_IDS, 'rabbit']);
  assert.ok(data.roster.every(m => Object.isFrozen(m)));
});

test('the card is drawn from the shared coach shell: stylesheet, workflow and print rules carry it', () => {
  const css = html.split('/* SCIENCE COACHES START')[1].split('/* SCIENCE COACHES END */')[0];
  for (const rule of ['.sc-mistake-mount', '.sc-signal--mistake', '.sc-question ', '.sc-question-text', '.sc-question-wrote', '.sc-question-pics img', '.sc-team-grid--mistake', '.sc-team-member--here']) {
    assert.ok(css.includes(rule), rule + ' is styled inside the coach block, so the browser fixture and print rules cover it');
  }
  assert.match(css, /@media print \{ \.sc-coach-mount \{ display:none !important; \} \}/, 'a card that wears .sc-coach-mount never prints');
  assert.match(html, /\.mk-lesson\.has-figure\{/, 'the practice page places the figure beside the lesson');
  assert.match(html, /\.mk-figure\[data-motion="on"\] \.sc-avatar-float\{ animation:sc-float/, 'the practice page reuses the coaches\' keyframes');
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{ \.mk-figure \*\{ animation:none !important; \} \}/);
  assert.match(workflow, /science-mistake\*\.js/, 'a change to the art or the card runs the coach workflow');
  assert.match(workflow, /tools\/science-mistake\*\.mjs/);
  assert.match(workflow, /science-mistake-tests\.mjs/, 'this file runs in CI');
});

test('app.js draws the same figure on the practice page and reads the one motion preference', () => {
  assert.match(src, /import \{ renderMistakeAnimalAvatar \} from "\.\/science-mistake-art\.js";/);
  assert.match(src, /import \{ mountScienceCoach, resetScienceCoaches, scienceCoachMotion \} from "\.\/science-coaches\.js";/);
  assert.match(src, /function _mkFigure\(id, opts\)/);
  assert.match(src, /function _mkMotion\(\)/);
  assert.match(src, /<div class="mk-figure" data-motion="\$\{_mkMotion\(\)\}" aria-hidden="true">\$\{figure\}<\/div>/);
  assert.match(src, /<div class="mk-animal-figure" aria-hidden="true">\$\{_mkFigure\(m\.id, \{ animated: false \}\)\}<\/div>/, 'the roster cards are still');
});
