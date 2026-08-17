// Regression tests for 🧻 CLEAN PAPER — the pass that takes the faint texture
// out of a picture's background. Run with:
//     node tools/paper-clean-tests.mjs            all cases
//     node tools/paper-clean-tests.mjs <name>     one case
//
// It loads the REAL `_paperCleanPixels` / `_paperWhitePoint` out of app.js and
// runs them over synthetic pictures — a diagonally-woven white like the one an
// image model's decoder actually leaves behind, a photograph, a coloured
// diagram, a cut-out sprite.
//
// BOTH directions are silent and both end up in front of a class:
//   too timid  — every diagram keeps its weave, which is invisible on screen
//                and prints as a striped grey wash over the whole figure;
//   too greedy — the pass reaches past the background into the drawing, and a
//                pale grey shading, a blue water fill or a photograph's
//                highlights are flattened to blank white. The picture still
//                looks clean. That is what makes it dangerous: nothing throws,
//                and the damage is only visible against the original nobody
//                kept.
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

const M = new Function(
  cut('const PAPER_WHITE_MIN', '// Canvas wrapper', 'clean-paper core')
  + '\nreturn { _paperCleanPixels, _paperWhitePoint, PAPER_WHITE_MIN, PAPER_BG_MIN,'
  + ' PAPER_TEX_DEPTH, PAPER_TEX_CHROMA, PAPER_INK_MIN, PAPER_INK_MAX };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };

// ---- synthetic pictures ----------------------------------------------------
// A picture is { px, w, h }; `at(x, y)` reads a pixel back out.
const make = (w, h, fn) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y) || [255, 255, 255, 255];
    const i = (y * w + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3] === undefined ? 255 : c[3];
  }
  return { px, w, h };
};
const at = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
};
const count = (img, pred) => {
  let n = 0;
  for (let i = 0; i < img.px.length; i += 4) if (pred(img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3])) n++;
  return n;
};
// The artefact this whole feature exists for: a flat white page carrying a
// faint diagonal weave a few units deep, with black line work on it.
const woven = (opts = {}) => {
  const depth = opts.depth === undefined ? 6 : opts.depth;
  return make(120, 120, (x, y) => {
    if (y >= 40 && y <= 44) return [0, 0, 0, 255];              // a drawn line
    if (x >= 20 && x <= 24 && y >= 20 && y <= 100) return [0, 0, 0, 255];
    const weave = ((x + y) % 7 === 0) ? 255 - depth : 255;      // the diagonal
    return [weave, weave, weave, 255];
  });
};

// ---- it takes the weave out ------------------------------------------------
test('the diagonal weave is gone and the background is pure white', () => {
  const img = woven();
  ok(count(img, (r) => r !== 255) > 500, 'the fixture has no weave to remove');
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(rep.ok, 'refused a plain woven page: ' + rep.reason);
  const offWhite = count(img, (r, g, b) => r > M.PAPER_INK_MAX && !(r === 255 && g === 255 && b === 255));
  ok(offWhite === 0, offWhite + ' background pixels are still off-white');
});

test('the line work survives untouched', () => {
  const img = woven();
  const inkBefore = count(img, (r, g, b) => r <= M.PAPER_INK_MAX);
  M._paperCleanPixels(img.px, img.w, img.h);
  const inkAfter = count(img, (r, g, b) => r <= M.PAPER_INK_MAX);
  ok(inkBefore === inkAfter, 'ink pixels changed: ' + inkBefore + ' → ' + inkAfter);
  ok(at(img, 22, 60).slice(0, 3).join() === '0,0,0', 'a drawn line was whitened');
});

test('a deeper weave — a grey scan background — goes too', () => {
  const img = woven({ depth: 14 });
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(rep.ok, 'refused: ' + rep.reason);
  ok(at(img, 7, 0)[0] === 255, 'a 14-deep weave survived: ' + at(img, 7, 0));
});

// ---- and nothing else ------------------------------------------------------
test('a pale COLOUR wash is part of the drawing and is kept', () => {
  // The blue of water in a beaker: bright, but nothing like grey. Whitening it
  // deletes half of what the question is about.
  const img = make(120, 120, (x, y) => {
    if (y >= 40 && y <= 44) return [0, 0, 0, 255];
    if (y > 60) return [223, 234, 245, 255];         // pale blue fill
    const w = ((x + y) % 7 === 0) ? 249 : 255;
    return [w, w, w, 255];
  });
  M._paperCleanPixels(img.px, img.w, img.h);
  ok(at(img, 60, 80).slice(0, 3).join() === '223,234,245',
    'the pale blue fill was whitened: ' + at(img, 60, 80));
  ok(at(img, 7, 0)[0] === 255, 'and the weave should still have gone');
});

test('a deliberate grey SHADING is kept', () => {
  // A shaded region in a diagram sits well below the white point. If this ever
  // starts failing, PAPER_TEX_DEPTH has been opened too wide.
  const img = make(120, 120, (x, y) => {
    if (y >= 40 && y <= 44) return [0, 0, 0, 255];
    if (y > 70) return [205, 205, 205, 255];
    const w = ((x + y) % 7 === 0) ? 249 : 255;
    return [w, w, w, 255];
  });
  M._paperCleanPixels(img.px, img.w, img.h);
  ok(at(img, 60, 90)[0] === 205, 'grey shading was whitened: ' + at(img, 60, 90));
});

test('a PHOTOGRAPH is refused outright', () => {
  // Highlights and mid-tones everywhere, no page and no line work. Flattening
  // its bright end into a plate is the quiet damage this guard exists for.
  const img = make(120, 120, (x, y) => {
    const v = 90 + ((x * 3 + y * 2) % 150);
    return [v, v - 10, v - 25, 255];
  });
  const before = img.px.slice();
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(!rep.ok, 'cleaned a photograph: ' + JSON.stringify(rep));
  ok(before.join() === img.px.join(), 'a refusal must write NOTHING');
});

test('a picture with no line work is refused', () => {
  const img = make(120, 120, (x, y) => {
    const w = ((x + y) % 7 === 0) ? 249 : 255;
    return [w, w, w, 255];
  });
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(!rep.ok && rep.reason === 'no-ink', 'expected no-ink, got ' + JSON.stringify(rep));
});

test('a dark picture is refused', () => {
  const img = make(120, 120, () => [18, 20, 34, 255]);
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(!rep.ok && rep.reason === 'no-white', 'expected no-white, got ' + JSON.stringify(rep));
});

test('a hole stays a hole', () => {
  // Card art and sprites stand on nothing. Filling their transparency with
  // white is how a cut-out sprite comes back boxed.
  const img = woven();
  for (let x = 0; x < 20; x++) { const i = (x * 120 + 110) * 4; img.px[i + 3] = 0; }
  M._paperCleanPixels(img.px, img.w, img.h);
  ok(at(img, 110, 5)[3] === 0, 'a transparent pixel was painted');
});

test('an already-clean picture reports nothing changed', () => {
  const img = make(120, 120, (x, y) => (y >= 40 && y <= 44) ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  const rep = M._paperCleanPixels(img.px, img.w, img.h);
  ok(rep.ok && rep.changed === 0, 'expected a no-op, got ' + JSON.stringify(rep));
});

// ---- the white point -------------------------------------------------------
test('one blown-out speck does not set the white point', () => {
  // The maximum would be 255 whatever the page really is; the 98th percentile
  // lands in the paper. On a grey scan that difference is the whole pass.
  const img = make(100, 100, (x, y) => (x === 0 && y === 0) ? [255, 255, 255, 255] : [228, 228, 228, 255]);
  const wp = M._paperWhitePoint(img.px);
  ok(wp.white === 228, 'white point should follow the page, got ' + wp.white);
});

// ---- the wiring: every diagram re-render must go through the door -----------
test('every diagram enhance goes through generateCleanEnhancedImage', () => {
  // A picture cleaned on one authoring path and not on another is exactly the
  // drift the shared print helpers exist to prevent. The two exceptions are
  // the annot AI patches, which must MATCH the scan around them, not clean it.
  const re = /generateEnhancedImageDataUrl\(/g;
  let m, bad = [];
  while ((m = re.exec(src))) {
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
    if (/^(async )?function generateEnhancedImageDataUrl/.test(line.trim())) continue;
    if (line.indexOf('const out = await') >= 0) continue;              // the door itself
    if (line.indexOf("mimeType: 'image/png', data: dataUrl.split") >= 0) continue; // annot patches
    bad.push(line.trim());
  }
  ok(bad.length === 0, 'these bypass the cleaning door:\n  ' + bad.join('\n  '));
});

test('_BW_ENHANCE_PROMPT is never called raw', () => {
  ok(src.indexOf('generateEnhancedImageDataUrl(_BW_ENHANCE_PROMPT') < 0,
    'a diagram enhance still calls the raw generator');
  ok((src.match(/generateCleanEnhancedImage\(_BW_ENHANCE_PROMPT/g) || []).length === 3,
    'expected the three _BW_ENHANCE_PROMPT sites to go through the door');
});

test('the manual 🧻 tool is on the toolbar and exported to window', () => {
  // The module has its own scope, so an inline onclick with no window
  // assignment is a button that throws ReferenceError and looks dead.
  const html = fs.readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');
  ok(html.indexOf('annotCleanPaper()') >= 0, 'no 🧻 button in the Touch up toolbar');
  ok(src.indexOf('window.annotCleanPaper = annotCleanPaper;') >= 0, 'annotCleanPaper is not on window');
});

// ---- run -------------------------------------------------------------------
const only = process.argv[2];
let pass = 0, fail = 0;
for (const c of cases) {
  if (only && c.name.indexOf(only) < 0) continue;
  try { c.fn(); pass++; console.log('  ok   ' + c.name); }
  catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + e.message); }
}
console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
