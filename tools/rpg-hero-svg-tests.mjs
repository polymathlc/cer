import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../rpg-hero-svg.js', import.meta.url), 'utf8'), context);
const hero = context.RpgHeroSvg;

test('hero fragments contain every referenced paint and never share definition IDs', () => {
  const seen = new Set();
  for (let n = 0; n < 20; n++) {
    for (const svg of [hero.lower(), hero.arms(), hero.head('male'), hero.head('female'), hero.grip()]) {
      const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]);
      assert.ok(ids.length && refs.length, 'art should have its own dimensional paints');
      for (const ref of refs) assert.ok(ids.includes(ref), `${ref} must resolve inside its fragment`);
      for (const id of ids) {
        assert.ok(!seen.has(id), `${id} would bind another avatar's paint`);
        seen.add(id);
      }
      assert.doesNotMatch(svg, /undefined|NaN|Infinity|<image\b|<script\b|\bon\w+=/);
    }
  }
});

test('both genders retain the helmet landmark and their own layered hairstyles', () => {
  const male = hero.head('male'), female = hero.head('female');
  for (const svg of [male, female]) {
    assert.match(svg, /<circle cx="100" cy="78" r="34"/);
    assert.match(svg, /<rect x="92" y="100" width="16" height="19"/);
    assert.ok(svg.indexOf('cx="100" cy="78"') < svg.lastIndexOf('<path'), 'hair and face belong over the face silhouette');
  }
  assert.match(male, /data-gender="male"/);
  assert.match(female, /data-gender="female"/);
  assert.match(female, /M127 62 Q145 63/, 'female ponytail keeps its separate rear layer');
  assert.doesNotMatch(male, /M127 62 Q145 63/);
  assert.match(hero.head('<script>'), /data-gender="male"/, 'unsupported saved genders fall back safely');
});

test('hands stay centered on both equipment anchors and the animated grip stays local', () => {
  const arms = hero.arms(), grip = hero.grip();
  for (const x of [58, 142]) {
    assert.match(arms, new RegExp(`<g transform="translate\\(${x},158\\)">\\s*<circle cx="0" cy="0" r="8"`));
  }
  assert.match(grip, /<g transform="translate\(0,0\)">\s*<circle cx="0" cy="0" r="8"/);
  assert.doesNotMatch(grip, /translate\(142,158\)/, 'the compositor already translates the weapon hand');
});
