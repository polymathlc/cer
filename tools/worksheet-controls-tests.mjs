/* The worksheet builder's controls sit ABOVE the question list and stick there.
   Every failure here is silent — the page renders perfectly either way, and the
   only symptom is a teacher scrolling past a hundred questions to find Print. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const page = html.slice(
  html.indexOf('<div class="page" id="page-worksheet">'),
  html.indexOf('<!-- ===== PAGE: MY WORKSHEETS (Students) ===== -->'));
assert.ok(page.length > 500, 'the worksheet builder page is in index.html');

test('the controls come BEFORE the question grid, not after it', () => {
  const at = needle => { const i = page.indexOf(needle); assert.notEqual(i, -1, needle); return i; };
  const actions = at('class="ws-actions-bar"');
  const extras = at('>Extras</span>');
  const selectAll = at('id="wsSelectAll"');
  const grid = at('id="wsQuestionGrid"');
  assert.ok(actions < grid, 'Preview / Save / Print must not sit below the list');
  assert.ok(extras < grid, 'the print extras must not sit below the list');
  // Select All governs the grid, so it stays next to it — below the controls.
  assert.ok(actions < extras && extras < selectAll && selectAll < grid);
  assert.equal(page.match(/class="ws-actions-bar"/g).length, 1, 'one bar, not a copy top and bottom');
});

test('every action the page had is still on the bar', () => {
  const bar = page.slice(page.indexOf('class="ws-actions-bar"'), page.indexOf('>Extras</span>'));
  for (const id of ['wsPreviewBtn', 'wsSaveBtn', 'wsPrintBtn', 'wsSyllabusBtn', 'wsPracticeBtn', 'wsFibPracticeBtn']) {
    assert.ok(bar.includes('id="' + id + '"'), id + ' must survive the move');
  }
});

test('the sticky rule is scoped to this page, and below the header it sticks under', () => {
  const rule = html.slice(html.indexOf('#page-worksheet .ws-actions-bar {'));
  assert.ok(rule.startsWith('#page-worksheet .ws-actions-bar {'), 'the sticky rule exists');
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /position:\s*sticky/);
  assert.match(body, /top:\s*var\(--ws-tools-top/, 'the offset is measured, never a per-breakpoint guess');
  // .ws-question-grid is reused by the community quest picker, which scrolls
  // inside itself — an unscoped rule would give it a sticky bar it has no room for.
  assert.equal(/^\s*\.ws-actions-bar\s*\{[^}]*position:\s*sticky/m.test(html), false,
    'the bare class must not be made sticky: other surfaces reuse this markup');
  const z = /z-index:\s*(\d+)/.exec(body);
  assert.ok(z && Number(z[1]) < 50, 'it must sit under .page-header (z-index 50) rather than over it');
  assert.match(body, /var\(--ws-gutter/, 'it bleeds into .page-body padding or cards scroll through the gutters');
});

test('a phone gets the controls on top without a bar eating the screen', () => {
  const at = html.indexOf('#page-worksheet .ws-actions-bar { position: static');
  assert.notEqual(at, -1, 'six buttons wrap to three rows on a phone');
  const guard = html.lastIndexOf('@media', at);
  assert.match(html.slice(guard, at), /max-width:\s*640px/);
});

test('the offset is measured from the real header and re-measured when it changes', () => {
  assert.match(app, /function wsSyncToolsTop\(\)/);
  const fn = app.slice(app.indexOf('function wsSyncToolsTop()'), app.indexOf('function wsSyncToolsTop()') + 600);
  assert.match(fn, /#page-worksheet|getElementById\('page-worksheet'\)/);
  assert.match(fn, /\.page-header/, 'measured from the header it sticks beneath');
  assert.match(fn, /--ws-tools-top/);
  // A ResizeObserver fires on first layout and on every change, so there is no
  // navigation hook to forget when a page is added or a header reflows.
  assert.match(app.slice(app.indexOf('const _wsToolsInit'), app.indexOf('const _wsToolsInit') + 700), /ResizeObserver/);
  assert.match(app.slice(app.indexOf('const _wsToolsInit'), app.indexOf('const _wsToolsInit') + 700), /addEventListener\('resize'/,
    'a browser without ResizeObserver still re-measures');
});
