/* 🙋 Consults in the portal — consult-bridge.js, the shared consult-answer.js
   and how this page wires them. Run: node --test tools/consult-bridge-tests.mjs
   The same file runs in polymathlc/cer and polymathlc/math; HOST below is the
   only line that differs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HERE = fs.existsSync(new URL('../app.js', import.meta.url)) && fs.existsSync(new URL('../cs', import.meta.url)) ? 'cer' : 'math';
const HOST = HERE === 'cer'
  ? { app: 'cer', subject: 'science', code: fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8') }
  : { app: 'math', subject: 'math', code: fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8') };
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const BRIDGE = fs.readFileSync(new URL('../consult-bridge.js', import.meta.url), 'utf8');
const CA_SRC = fs.readFileSync(new URL('../consult-answer.js', import.meta.url), 'utf8');
const CA_CSS = fs.readFileSync(new URL('../consult-answer.css', import.meta.url), 'utf8');
const J = (v) => JSON.parse(JSON.stringify(v));

function loadPure(src) {
  const ctx = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, Promise };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'globalThis'), ctx);
  return ctx;
}
const B = loadPure(BRIDGE).ConsultBridge.pure;
const CA = loadPure(CA_SRC).ConsultAnswer.pure;

test('the teacher is the one account, and a guest is nobody', () => {
  assert.equal(B.roleOf({ uid: 'a', email: 'ChungZhiKai@gmail.com ' }), 'teacher');
  assert.equal(B.roleOf({ uid: 'a', email: 'abigail.yew@stanfordmanpower.com' }), 'student', 'another admin of the portal is not the teacher who answers');
  assert.equal(B.roleOf({ uid: 'a', email: 'kid@school.sg' }), 'student');
  assert.equal(B.roleOf({ uid: 'a', isAnonymous: true }), '');
  assert.equal(B.roleOf(null), '');
  assert.equal(B.APPS[HOST.app], HOST.subject);
});

test('the counts agree with the archive', () => {
  const now = 1_700_000_000_000;
  const docs = [
    { status: 'question' },
    { status: 'waiting', at: now - 60_000, seen: now - 5_000 },
    { status: 'waiting', at: now - 3_600_000, seen: now - 3_600_000 },
    { status: 'answered', reply: { url: 'x' } }
  ];
  assert.equal(B.teacherCount(docs, now, CA.callRinging), 2, 'the question and the call still ringing');
  assert.equal(B.studentCount([{ status: 'answered', reply: {}, replySeen: null }, { status: 'answered', reply: {}, replySeen: 9 }, { status: 'question' }]), 1);
  assert.equal(B.buttonWords('teacher', 2).text, '🙋 Consults · 2');
  assert.equal(B.buttonWords('student', 1).text, '🙋 Consults · 1 new');
  assert.equal(B.buttonWords('student', 0).text, '🙋 Consults');
});

test('a question asked here is the one Study Buddy leaves, marked as asked in this portal', () => {
  const d = CA.askDoc({ uid: 'u1', app: HOST.app, name: 'Ann', text: 'Why?', subject: HOST.subject, now: 5 });
  assert.equal(d.status, 'question');
  assert.equal(d.app, HOST.app);
  assert.equal(d.subject, HOST.subject);
  assert.equal(CA.logRow('abcdefghijklmnop', d, 10).appWord, CA.APP_WORDS[HOST.app]);
});

test('the compat wrappers turn the modular calls into the shape consult-answer.js reads', async () => {
  const calls = [];
  const ref = (path) => ({ id: path.split('/').pop(), path });
  const F = {
    collection: (base, name) => ({ id: name, path: (base.path ? base.path + '/' : '') + name }),
    doc: (c, id) => ref(c.path + '/' + (id || 'AUTOID123456')),
    query: (q, c) => ({ ...q, cs: (q.cs || []).concat([c]) }),
    where: (...a) => ['where', ...a], orderBy: (...a) => ['orderBy', ...a], limit: (n) => ['limit', n],
    getDoc: async (r) => ({ id: r.id, ref: r, exists: () => true, data: () => ({ path: r.path }) }),
    getDocs: async (q) => ({ docs: [{ id: 'd1', ref: ref('x/d1'), exists: () => true, data: () => ({ q: q.cs }) }] }),
    setDoc: async (...a) => calls.push(['set', a[0].path, a[1]]),
    updateDoc: async (...a) => calls.push(['update', a[0].path, a[1]]),
    deleteDoc: async (r) => calls.push(['delete', r.path]),
    onSnapshot: (q, next) => { next({ docs: [{ id: 'd2', ref: ref('x/d2'), exists: () => true, data: () => ({ n: (q.cs || []).length }) }] }); return () => calls.push(['unsub']); },
    runTransaction: async (fs, fn) => fn({
      get: async (r) => ({ id: r.id, ref: r, exists: () => false, data: () => undefined }),
      update: (r, d) => calls.push(['tx.update', r.path, d]), set: (r, d) => calls.push(['tx.set', r.path, d]), delete: (r) => calls.push(['tx.delete', r.path])
    })
  };
  const ctx = { console, Promise, setTimeout, clearTimeout, setInterval, clearInterval, document: { getElementById: () => null, documentElement: { classList: { add() {} } } } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(BRIDGE.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  const db = ctx.ConsultBridge._internals.wrapFirestore(F, { path: '' });
  const r = db.collection('tutorConsults').doc();
  assert.equal(r.id, 'AUTOID123456', 'an id of its own, like the compat doc()');
  const snap = await db.collection('tutorConsults').doc('abc').get();
  assert.equal(snap.exists, true, 'exists is a property, as in compat');
  assert.equal(snap.data().path, 'tutorConsults/abc');
  await r.collection('frames').doc('question').set({ img: 'data:image/jpeg;base64,x' });
  assert.deepEqual(calls.pop(), ['set', 'tutorConsults/AUTOID123456/frames/question', { img: 'data:image/jpeg;base64,x' }]);
  let seen = null;
  db.collection('tutorConsults').orderBy('at', 'desc').limit(300).onSnapshot((qs) => { seen = qs; });
  assert.equal(seen.docs[0].data().n, 2);
  const qs = await db.collection('tutorConsults').doc('abc').collection('ink').get();
  assert.equal(qs.docs.length, 1);
  await qs.docs[0].ref.delete();
  assert.deepEqual(calls.pop(), ['delete', 'x/d1']);
  const out = await db.runTransaction(async (tx) => { const s = await tx.get(r); if (!s.exists) return 'gone'; tx.update(r, {}); return 'ok'; });
  assert.equal(out, 'gone');
});

test('this page loads the shared files and attaches the bridge with its own app and App Check', () => {
  assert.match(HTML, /<link rel="stylesheet" href="consult-answer\.css(\?v=[\w.]+)?">/);
  assert.match(HTML, /<script defer src="consult-answer\.js(\?v=[\w.]+)?"><\/script>\s*<script defer src="consult-bridge\.js(\?v=[\w.]+)?"><\/script>/);
  assert.match(HTML, /id="consultLogBtn"[^>]*hidden/);
  // Both classic scripts come before the app module, so the bridge is there to attach to.
  const mod = HERE === 'cer' ? HTML.indexOf('<script type="module" src="app.js') : HTML.indexOf('<script type="module">');
  assert.ok(HTML.indexOf('consult-bridge.js') < mod && mod > 0);
  const at = HOST.code.indexOf('window.ConsultBridge.attach(');
  assert.ok(at > 0);
  const call = HOST.code.slice(at, at + 260);
  assert.match(call, new RegExp("app: '" + HOST.app + "'"));
  const sdk = call.match(/sdk: '([\d.]+)'/)[1];
  assert.ok(HOST.code.includes('https://www.gstatic.com/firebasejs/' + sdk + '/firebase-firestore.js'), 'the bridge loads the very SDK files this page imported');
  assert.match(call, /appCheck: \w+AppCheck/);
});

test('the bridge never names a recipient and never writes on its own', () => {
  const CODE = BRIDGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // The one address in it is the teacher's ACCOUNT, compared — never sent anywhere.
  assert.deepEqual(CODE.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), ['chungzhikai@gmail.com']);
  assert.ok(!/fetch\(|mailto:/.test(CODE));
  const top = CODE.slice(CODE.indexOf('function paint()'));
  assert.ok(!/\.(set|update|delete)\(/.test(top.replace(/B\.F|F\.\w+/g, '')), 'the button only reads');
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(CODE));
});

const SIB = HERE === 'cer' ? 'math' : 'cer';
for (const [repo, file, own] of [[SIB, 'consult-bridge.js', BRIDGE], ['tutor', 'consult-answer.js', CA_SRC], ['tutor', 'consult-answer.css', CA_CSS]]) {
  test(file + ' is byte for byte polymathlc/' + repo + '\'s, when both are checked out', (t) => {
    const twin = new URL('../../' + repo + '/' + file, import.meta.url);
    if (!fs.existsSync(twin)) { t.skip('polymathlc/' + repo + ' is not checked out beside this repository'); return; }
    assert.equal(fs.readFileSync(twin, 'utf8'), own, file + ' differs from ' + repo + '\'s copy');
  });
}
