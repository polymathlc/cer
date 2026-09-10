import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReleaseController, isReleased } from '../interface-studio.mjs';

function setup(saved = new Map()) {
  const listeners = [], writes = [];
  let state, saveImpl = async () => {};
  const controller = createReleaseController({
    subscribe(next, fail) { const item = { next, fail, stopped: false }; listeners.push(item); return () => { item.stopped = true; }; },
    save(...args) { writes.push(args); return saveImpl(...args); },
    onChange(value) { state = value; },
    storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) }
  });
  return { controller, listeners, writes, get state() { return state; }, setSave(fn) { saveImpl = fn; } };
}
const released = { arcadeUi: { version: 1, released: true } };

test('only the explicit current-version boolean releases the interface', () => {
  for (const data of [null, {}, { released: true }, { arcadeUi: { released: true } }, { arcadeUi: { version: 2, released: true } }, { arcadeUi: { version: 1, released: 'true' } }]) assert.equal(isReleased(data), false);
  assert.equal(isReleased(released), true);
});
test('students stay on the original interface until the server confirms release', () => {
  const t = setup(); t.controller.setUser({ uid: 'student', role: 'student' });
  assert.equal(t.state.active, false);
  t.listeners[0].next(released, { fromCache: true }); assert.equal(t.state.active, false);
  t.listeners[0].next(released, { hasPendingWrites: true }); assert.equal(t.state.active, false);
  t.listeners[0].next(released, {}); assert.equal(t.state.active, true);
  t.listeners[0].next({}, {}); assert.equal(t.state.active, false);
});
test('preview never writes a release flag', () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' });
  assert.equal(t.state.active, true);
  t.controller.preview(false); assert.equal(t.state.active, false);
  t.controller.preview(true); assert.equal(t.state.active, true);
  assert.deepEqual(t.writes, []);
});
test('students and employees cannot preview or release', async () => {
  for (const role of ['student', 'employee']) {
    const t = setup(); t.controller.setUser({ uid: role, role }); t.listeners[0].next({}, {});
    assert.equal(t.controller.preview(true), false);
    assert.equal(await t.controller.release(true), false);
    assert.equal(t.state.active, false); assert.equal(t.writes.length, 0);
  }
});
test('admin release waits for a checked setting and for persistence', async () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' });
  assert.equal(await t.controller.release(true), false);
  t.listeners[0].next({}, {});
  let done; t.setSave(() => new Promise(resolve => { done = resolve; }));
  const pending = t.controller.release(true);
  assert.equal(t.state.busy, true); assert.equal(t.state.released, false);
  assert.equal(await t.controller.release(true), false);
  done(); assert.equal(await pending, true);
  assert.equal(t.state.released, true); assert.equal(t.state.busy, false);
  assert.deepEqual(t.writes, [[true, 'admin', false]]);
});
test('failed release preserves the confirmed student setting', async () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' }); t.listeners[0].next({}, {});
  t.setSave(async () => { throw new Error('Offline: not saved'); });
  assert.equal(await t.controller.release(true), false);
  assert.equal(t.state.released, false); assert.equal(t.state.busy, false);
  assert.match(t.state.error, /not saved/);
});
test('rollback uses the same persisted control', async () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' }); t.listeners[0].next(released, {});
  assert.equal(await t.controller.release(false), true);
  assert.equal(t.state.released, false);
  assert.deepEqual(t.writes, [[false, 'admin', true]]);
});
test('switching from admin to student clears preview and ignores stale callbacks', () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' });
  const old = t.listeners[0]; t.controller.setUser({ uid: 'student', role: 'student' });
  assert.equal(old.stopped, true); assert.equal(t.state.active, false);
  old.next(released, {}); old.fail(); assert.equal(t.state.active, false); assert.equal(t.state.error, '');
});
test('late write completion cannot alter a new account', async () => {
  const t = setup(); t.controller.setUser({ uid: 'admin', role: 'admin' }); t.listeners[0].next({}, {});
  let done; t.setSave(() => new Promise(resolve => { done = resolve; }));
  const pending = t.controller.release(true);
  t.controller.setUser({ uid: 'student', role: 'student' }); done();
  assert.equal(await pending, false); assert.equal(t.state.active, false); assert.equal(t.state.released, false);
});
test('sign-out unsubscribes and resets every visible release state', () => {
  const t = setup(); t.controller.setUser({ uid: 'student', role: 'student' }); t.listeners[0].next(released, {});
  t.controller.setUser(null); assert.equal(t.listeners[0].stopped, true); assert.equal(t.state.active, false); assert.equal(t.state.ready, false);
});
test('listener failure fails closed for students and blocks release', () => {
  const t = setup(); t.controller.setUser({ uid: 'student', role: 'student' }); t.listeners[0].next(released, {});
  t.listeners[0].fail(); assert.equal(t.state.active, false); assert.equal(t.state.ready, false);
  t.listeners[0].next(released, {}); assert.equal(t.state.active, true); assert.equal(t.state.error, '');
});
test('preview preference is isolated per admin', () => {
  const t = setup(); t.controller.setUser({ uid: 'a', role: 'admin' }); t.controller.preview(false);
  t.controller.setUser({ uid: 'b', role: 'admin' }); assert.equal(t.state.active, true);
  t.controller.setUser({ uid: 'a', role: 'admin' }); assert.equal(t.state.active, false);
});
test('blocked browser storage does not prevent the app from opening', () => {
  let state;
  const c = createReleaseController({ subscribe: () => () => {}, save: async () => {}, onChange: s => { state = s; }, storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  c.setUser({ uid: 'admin', role: 'admin' }); c.preview(false); assert.equal(state.active, false);
});
test('integration includes auth cleanup, transaction protection, and leaderboard hooks', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const science = html.includes('id="appWrapper"');
  const source = science ? readFileSync(new URL('../app.js', import.meta.url), 'utf8') : html;
  assert.match(html, /href="arcade-ui\.css\?v=1"/);
  assert.match(source, /interfaceStudio\?\.setUser\(null\)/);
  assert.match(source, /syncInterfaceStudio\(\);/);
  assert.match(source, /runTransaction\(db, async transaction/);
  assert.match(source, /auth\.currentUser\?\.uid !== uid/);
  assert.match(source, /transaction\.set\(releaseRef,[\s\S]*?\{ merge: true \}\)/);
  assert.match(source, science ? /doc\(db, 'config', 'admin'\)/ : /doc\(db, 'config', 'mathAdmin'\)/);
  assert.match(source, /data-arcade-rank="\$\{rank\}"/);
});
