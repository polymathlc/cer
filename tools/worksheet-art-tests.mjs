import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup() {
  const context = vm.createContext({
    window: {}, URL,
    document: {
      currentScript: { src: 'https://polymathlc.github.io/cer/worksheet-art.js' },
      getElementById() { return null; },
      createElement() { return {}; },
      head: { appendChild() {} }
    },
    location: { href: 'https://polymathlc.github.io/cer/science-worksheet.html' }
  });
  for (const filename of ['worksheet-art.js', 'worksheet-art-editor.js']) {
    vm.runInContext(readFileSync(new URL('../' + filename, import.meta.url), 'utf8'), context, { filename });
  }
  return { art: context.window.WorksheetArt, editor: context.window.WorksheetArtEditor };
}

test('every listed companion pose ships as a local WebP with reserved dimensions', () => {
  const { art } = setup();
  assert.equal(art.characters.length, 3);
  assert.equal(art.poses.length, 4);
  for (const character of art.characters) {
    for (const pose of art.poses) {
      const filename = `${character.id}-${pose.id}.webp`;
      const bytes = readFileSync(new URL('../assets/worksheet-characters/' + filename, import.meta.url));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      assert.equal(art.characterSrc(character.id, pose.id), 'https://polymathlc.github.io/cer/assets/worksheet-characters/' + filename);
      assert.match(art.renderCharacter(character.id, pose.id), /width="128" height="128"/);
    }
  }
});

test('science catalogue renders self-contained repeatable SVG without network references or duplicate IDs', () => {
  const { art } = setup();
  assert.ok(art.science.length >= 10);
  assert.equal(new Set(art.science.map(x => x.id)).size, art.science.length);
  for (const item of art.science) {
    const html = art.scienceSvg(item.id);
    assert.match(html, /^<svg /);
    assert.match(html, /viewBox="0 0 160 160"/);
    assert.match(html, /<title>/);
    assert.doesNotMatch(html, /\bid=|\bhref=|<script|<foreignObject|\bon\w+=|url\(/i);
  }
  assert.equal(art.scienceSvg('missing'), '');
  assert.equal(art.renderElement({ kind: 'science', artId: '<img src=x onerror=alert(1)>' }), '');
});

test('teacher and AI speech text stays literal, including newlines, quotes and markup', () => {
  const { art } = setup();
  const text = 'Compare A & B.\n<img src=x onerror="alert(1)"> <script>alert(1)</script> \'quoted\'';
  for (const kind of ['character', 'science']) {
    const html = art.renderElement({ kind, character: 'nova', pose: 'thinking', artId: 'plant', text, bubbleType: 'reminder', size: 'large' });
    assert.ok(html.includes('Compare A &amp; B.\n&lt;img'));
    assert.ok(html.includes('&quot;alert(1)&quot;'));
    assert.doesNotMatch(html, /<script>|<img src=x/);
    assert.match(html, /wa-size-large/);
  }
  assert.match(art.renderElement({ kind: 'character', character: 'nova', text: 'Check the evidence.', bubbleType: 'reminder' }), /Nova’s reminder/);
});

test('untrusted character, pose and size values cannot turn into remote requests or HTML attributes', () => {
  const { art } = setup();
  const html = art.renderElement({ kind: 'character', character: 'https://evil.invalid/a', pose: '../../b', size: '" onmouseover="alert(1)', bubbleType: '<script>', text: 'Think.' });
  assert.match(html, /orbit-welcome.webp/);
  assert.match(html, /wa-size-medium/);
  assert.doesNotMatch(html, /evil\.invalid|onmouseover|<script>/);
  assert.equal(art.renderElement({ kind: '<script>' }), '');
});

test('saved decorations normalize bounded fields and preserve authored choices after JSON storage', () => {
  const { editor } = setup();
  const original = [{ id: 'my-art', kind: 'character', character: 'pip', pose: 'celebrate', bubbleType: 'tip', text: 'Use evidence.', size: 'small', beforeQuestionId: 'question-2' }];
  const restored = editor.normalize(JSON.parse(JSON.stringify(original)))[0];
  for (const [key, value] of Object.entries(original[0])) assert.equal(restored[key], value);
  const bad = editor.normalize([null, { kind: 'script' }, { id: '<bad>', kind: 'science', artId: 'missing', text: 'x'.repeat(1000), beforeQuestionId: 'q'.repeat(400) }]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].id, 'bad');
  assert.equal(bad[0].artId, 'flask');
  assert.equal(bad[0].text.length, 600);
  assert.equal(bad[0].beforeQuestionId.length, 200);
  assert.equal(editor.normalize(Array.from({ length: 30 }, () => ({ kind: 'science' }))).length, 20);
  assert.equal(editor.normalize(null).length, 0);
});

test('worksheet placement keeps each illustration next to its selected question', () => {
  const { editor } = setup();
  const items = [
    { kind: 'character', character: 'orbit', text: 'Start here.', beforeQuestionId: '' },
    { kind: 'character', character: 'nova', text: 'Compare these results.', beforeQuestionId: 'question-2' }
  ];
  assert.match(editor.render(items, ''), /Start here\./);
  assert.doesNotMatch(editor.render(items, ''), /Compare these results/);
  assert.match(editor.render(items, 'question-2'), /Compare these results\./);
  assert.doesNotMatch(editor.render(items, 'question-2'), /Start here/);
  assert.equal(editor.render(items, 'question-1'), '');
});
