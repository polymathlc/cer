// The clone stamp's live preview — what the ring is filled with.
//
// This is the one part of the feature that fails SILENTLY. A preview that does
// not appear is obvious the first time somebody picks the tool; a preview
// centred on the WRONG source point looks exactly like a working preview and
// aims every stamp a little way off, which is worse than the pin-and-guess it
// replaced. So the two cases that decide it are pinned here:
//
//   * BEFORE the first dab there is no offset yet. Starting the drag under the
//     pointer is what would put the source point itself there, so the preview
//     must show the source POINT — not the pointer, and not the two subtracted.
//   * MID-STROKE the offset was locked in at pointer-down, so the patch under
//     the pointer comes from (pointer in image px) − offset. Getting that
//     backwards drifts the preview away from the mark at exactly the rate the
//     hand is moving, which reads as the app lagging rather than as a bug.
//
// It also pins the pointer conversion: `_annot.ptr` is in STAGE coordinates and
// the source is in IMAGE pixels, so zoom and pan have to come off first. Read
// the pointer raw and the preview is right only at 100% zoom with no panning —
// which is how the editor opens, and therefore how it would be tested by hand.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The same file in every portal: app.js where there is one, and index.html in
// math, which keeps the whole module inline. One harness, four repos.
const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..', 'app.js');
const SRC = existsSync(APP) ? APP : join(here, '..', 'index.html');
const src = readFileSync(SRC, 'utf8');

const from = src.indexOf('function _annotClonePeekSrc()');
const to = src.indexOf('// Show the ring and its "12 px" badge');
if (from < 0 || to < 0 || to < from) {
  console.error('could not find _annotClonePeekSrc in ' + SRC);
  process.exit(1);
}
const section = src.slice(from, to);

// The real function, run against a stub of the editor state it reads.
let _annot = null;
const _annotDisplayScale = () => _annot.fit * _annot.zoom;
const ANNOT_PEEK_MIN = 14;
const _annotClonePeekSrc = new Function('_annot', '_annotDisplayScale', 'ANNOT_PEEK_MIN',
  section + '\nreturn _annotClonePeekSrc;')(
  new Proxy({}, { get: (_, k) => _annot[k] }), _annotDisplayScale, ANNOT_PEEK_MIN);

let ok = 0, bad = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; return; }
  bad++; console.log('FAIL  ' + name + '\n      got  ' + g + '\n      want ' + w);
};

// A picture at 200%, panned 100/50, brush source at (40,40), pointer at (300,300)
// on the stage — which is image pixel ((300−100)/2, (300−50)/2) = (100, 125).
const base = () => ({ tool: 'clone', cloneSrc: { x: 40, y: 40 }, cloneOff: null,
  ptr: { x: 300, y: 300 }, panX: 100, panY: 50, fit: 1, zoom: 2, size: 20 });

_annot = base();
eq('no offset yet — the preview is the source point itself', _annotClonePeekSrc(), { x: 40, y: 40 });

_annot = base(); _annot.cloneOff = { x: 60, y: 80 };
eq('mid-stroke — pointer in image px, minus the locked offset', _annotClonePeekSrc(), { x: 40, y: 45 });

// Zoom and pan really do come off: at 100% and no pan the same pointer is a
// different image pixel, so a version that skipped the conversion would agree
// with the case above and disagree here.
_annot = base(); _annot.cloneOff = { x: 60, y: 80 }; _annot.zoom = 1; _annot.panX = 0; _annot.panY = 0;
eq('zoom and pan are taken off the pointer', _annotClonePeekSrc(), { x: 240, y: 220 });

_annot = base(); _annot.tool = 'erase';
eq('another tool shows no preview', _annotClonePeekSrc(), null);

_annot = base(); _annot.cloneSrc = null;
eq('no source set yet shows no preview', _annotClonePeekSrc(), null);

_annot = base(); _annot.ptr = null;
eq('pointer never seen shows no preview', _annotClonePeekSrc(), null);

// The rest of the feature: the preview must read the FROZEN snapshot while a
// stroke is running, or dragging back over ground already covered previews the
// copy instead of the source.
if (!/_annot\.cloneSnap \|\| _annot\.canvas/.test(src)) {
  bad++; console.log('FAIL  mid-stroke the preview must read cloneSnap, not the live canvas');
} else ok++;
// And the ring has to be told to stop previewing when it is hidden, or a stale
// picture is left sitting on the stage.
if (!/ring\.classList\.remove\('peeking'\)/.test(src)) {
  bad++; console.log('FAIL  the ring must drop .peeking when it is hidden');
} else ok++;

console.log(bad ? '\n' + bad + ' failed, ' + ok + ' passed' : 'clone preview: all ' + ok + ' passed');
process.exit(bad ? 1 : 0);
