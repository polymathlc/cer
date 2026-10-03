/* ✨ Hold-to-snap in pdf-annotator.html: the SHIPPED pointer handlers cut out of
   the page and driven with the real shape-snap.js. The page needs pdf.js from a
   CDN to boot, so this is the gate that proves a held pen stroke is committed as
   the clean shape — one undo step, still an ordinary pen annotation. */
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, make } from './shape-snap-fixtures.mjs';

const html = fs.readFileSync(new URL('../pdf-annotator.html', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../shape-snap.js', import.meta.url), 'utf8');
const a = html.indexOf('function attachOverlayHandlers(p) {'), b = html.indexOf('function redrawTemp()', a);
assert(a >= 0 && b > a, 'attachOverlayHandlers not found in pdf-annotator.html');
const handlers = html.slice(a, b);

function world({ withLib = true, fakeHold = true } = {}) {
  const holds = [], undo = [], committed = [];
  class Node {
    constructor() { this.listeners = {}; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    emit(t, e) { (this.listeners[t] || []).forEach((f) => f(e)); }
    setPointerCapture() {} getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 400 }; }
    querySelector() { return null; }
  }
  const svg = new Node();
  const sb = {
    console, Math, JSON, Object, Array, Number, Date, isFinite,
    tool: 'pen', editingId: null, drawing: null, draggingSel: null, selectedId: null, annotations: committed,
    color: '#E53935', strokeW: 3, fontSize: 18,
    eventPoint: (e) => ({ x: e.clientX * 2, y: e.clientY * 2 }),     // page units = 2 × screen px, like a half-zoom page
    newAnnId: () => 'a' + (committed.length + 1),
    redrawTemp: () => { sb._temp = (sb._temp || 0) + 1; },
    renderOverlay: () => { sb._renders = (sb._renders || 0) + 1; },
    renderAllOverlays: () => {}, pushUndo: () => undo.push(1), snapshot: () => 'S', setDirty: () => {},
    round2: (n) => Math.round(n * 100) / 100, translateAnn: () => {}, focusTextAnn: () => {}, toast: () => {},
    toggleKeyword: () => {}
  };
  sb.window = sb;
  vm.createContext(sb);
  if (withLib) {
    vm.runInContext(lib, sb);
    if (fakeHold) sb.ShapeSnap.createHold = (o) => { const h = { opts: o, cancelled: false, moves: [], start() {}, move(x, y) { this.moves.push([x, y]); }, cancel() { this.cancelled = true; } }; holds.push(h); return h; };
  }
  sb.p = { num: 1, baseW: 600, baseH: 800, svg };
  vm.runInContext(handlers + '\nattachOverlayHandlers(p);', sb);
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, target: { closest: () => null }, preventDefault() {}, ...extra });
  return { sb, svg, holds, undo, committed, ev, plain: (x) => JSON.parse(JSON.stringify(x)) };
}
function stroke(w, pts, { hold = false, then = [] } = {}) {
  w.svg.emit('pointerdown', w.ev(pts[0].x / 2, pts[0].y / 2));
  for (const q of pts.slice(1)) w.svg.emit('pointermove', w.ev(q.x / 2, q.y / 2));
  if (hold && w.holds[0]) w.holds[0].opts.onHold();
  for (const q of then) w.svg.emit('pointermove', w.ev(q.x / 2, q.y / 2));
  const last = then.length ? then[then.length - 1] : pts[pts.length - 1];
  w.svg.emit('pointerup', w.ev(last.x / 2, last.y / 2));
}

test('a held straight stroke is committed as a two-point pen annotation, in one undo step', () => {
  const w = world();
  stroke(w, make.line(rng(1), 260, 3), { hold: true });
  assert.equal(w.holds.length, 1);
  assert.equal(w.committed.length, 1);
  const ann = w.committed[0];
  assert.equal(ann.type, 'pen');
  assert.equal(ann.points.length, 2);
  assert.equal(ann.points[0].y, ann.points[1].y, 'a near-level line is levelled');
  assert.equal(w.undo.length, 1);
  assert.equal(w.holds[0].cancelled, true, 'lifting stops the watch');
});
test('page units: recognition is told how big one screen pixel is', () => {
  const w = world({ fakeHold: true });
  let seen = null;
  const real = w.sb.ShapeSnap.recognize;
  w.sb.ShapeSnap.recognize = (pts, o) => { seen = o; return real(pts, o); };
  stroke(w, make.line(rng(1), 260, 3), { hold: true });
  assert.ok(Math.abs(seen.unit - 2) < 1e-9, `baseW 600 over a 300px page = 2 page units per pixel (${seen.unit})`);
});
test('a held circle is committed as a closed outline of many points; a held rectangle keeps four corners', () => {
  const w = world();
  stroke(w, make.circle(rng(2), 260), { hold: true });
  assert.ok(w.committed[0].points.length >= 80);
  const w2 = world();
  stroke(w2, make.rect(rng(3), 300, 180, 0), { hold: true });
  assert.equal(w2.committed[0].points.length, 5);
});
test('keep dragging after the snap: the shape adjusts and no freehand points are added', () => {
  const w = world();
  const c = make.circle(rng(4), 160);
  stroke(w, c, { hold: true, then: [{ x: c[0].x + 200, y: c[0].y }, { x: c[0].x + 360, y: c[0].y }] });
  const xs = w.committed[0].points.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 300, 'the radius followed the pen');
  assert.equal(w.committed[0].points.length, 91, 'still the 91-point snapped circle: dragging added no freehand points');
  assert.equal(w.committed.length, 1);
});
test('the highlighter snaps too and stays a highlighter', () => {
  const w = world();
  w.sb.tool = 'highlight';
  stroke(w, make.line(rng(5), 280, 80), { hold: true });
  assert.equal(w.committed[0].type, 'highlight');
  assert.equal(w.committed[0].points.length, 2);
});
test('no hold means plain freehand — every point kept, nothing replaced', () => {
  const w = world();
  const pts = make.circle(rng(6), 220);
  stroke(w, pts);
  assert.ok(w.committed[0].points.length >= pts.length - 2, 'every freehand point kept');
  assert.notEqual(w.committed[0].points.length, 91, 'not the snapped circle');
  assert.equal(w.holds[0].cancelled, true);
});
test('every move is reported to the hold timer so real movement restarts the wait', () => {
  const w = world();
  const pts = make.line(rng(1), 200, 10);
  stroke(w, pts);
  assert.equal(w.holds[0].moves.length, pts.length - 1);
});
test('only the pen and the highlighter watch for a hold (rect / line / arrow tools do not)', () => {
  for (const tool of ['rect', 'ellipse', 'line', 'arrow', 'text']) {
    const w = world();
    w.sb.tool = tool;
    w.svg.emit('pointerdown', w.ev(10, 10));
    assert.equal(w.holds.length, 0, tool);
  }
});
test('pointercancel stops the watch and discards the stroke, as before', () => {
  const w = world();
  w.svg.emit('pointerdown', w.ev(10, 10));
  w.svg.emit('pointercancel', w.ev(10, 10));
  assert.equal(w.holds[0].cancelled, true);
  assert.equal(w.sb.drawing, null);
  assert.equal(w.committed.length, 0);
});
test('a held scribble is not a shape: it is committed untouched', () => {
  const w = world();
  const z = make.zigzag(rng(7), 260);
  stroke(w, z, { hold: true });
  assert.ok(w.committed[0].points.length >= z.length - 2);
});
test('without shape-snap.js the pen draws exactly as it always did', () => {
  const w = world({ withLib: false });
  const pts = make.line(rng(1), 220, 10);
  stroke(w, pts, { hold: true });
  assert.equal(w.holds.length, 0);
  assert.equal(w.committed.length, 1);
  assert.ok(w.committed[0].points.length >= pts.length - 2);
});
