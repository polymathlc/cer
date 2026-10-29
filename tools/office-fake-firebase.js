/* An in-memory stand-in for the Firebase compat SDK, for tools/office-browser.mjs.
   It implements exactly what office/office-app.mjs uses — auth (one admin), Firestore
   (collections, documents, where/orderBy/limit, live listeners, transactions,
   batches, serverTimestamp, arrayUnion) and a callable askOpenAi — so the real
   page can be driven end to end with nothing sent anywhere.

   The harness seeds it through window.__fakeSeed before the page loads and reads
   it back through window.__fakeStore. */
(function () {
  'use strict';
  const store = new Map();          // 'col/id' → data
  const listeners = new Set();
  let clock = Date.UTC(2026, 10, 3, 2, 0, 0);   // 3 Nov 2026, 10:00 SGT (the harness fixes Date too)
  const seed = window.__fakeSeed || {};
  Object.keys(seed.docs || {}).forEach(p => store.set(p, JSON.parse(JSON.stringify(seed.docs[p]))));
  const user = seed.user === null ? null : Object.assign({ uid: 'admin-uid', email: 'chungzhikai@gmail.com', emailVerified: true }, seed.user || {});
  const callLog = [];
  window.__fakeStore = store;
  window.__fakeCalls = callLog;

  function ts(ms) { return { seconds: Math.floor(ms / 1000), nanoseconds: 0, toMillis() { return ms; }, toDate() { return new Date(ms); } }; }
  const SENTINEL = '__fake_sentinel__';
  const FieldValue = {
    serverTimestamp: () => ({ [SENTINEL]: 'ts' }),
    arrayUnion: (...items) => ({ [SENTINEL]: 'union', items }),
    delete: () => ({ [SENTINEL]: 'delete' })
  };
  function resolveValue(v, prev) {
    if (v && typeof v === 'object' && v[SENTINEL]) {
      if (v[SENTINEL] === 'ts') { clock += 1000; return ts(clock); }
      if (v[SENTINEL] === 'union') {
        const arr = Array.isArray(prev) ? prev.slice() : [];
        v.items.forEach(it => { if (!arr.some(x => JSON.stringify(x) === JSON.stringify(it))) arr.push(JSON.parse(JSON.stringify(it))); });
        return arr;
      }
      return undefined;
    }
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function applyWrite(path, data, mode) {
    const prev = store.get(path);
    if (mode === 'delete') { store.delete(path); return; }
    if (mode === 'update' && !prev) throw Object.assign(new Error('No document to update: ' + path), { code: 'not-found' });
    const base = mode === 'set' ? {} : Object.assign({}, prev || {});
    Object.keys(data || {}).forEach(k => {
      const val = resolveValue(data[k], base[k]);
      if (data[k] && data[k][SENTINEL] === 'delete') delete base[k];
      else if (val !== undefined) base[k] = val;
    });
    // Keep timestamp objects alive (JSON clone strips their methods).
    store.set(path, revive(base));
  }
  function revive(o) {
    if (Array.isArray(o)) return o.map(revive);
    if (o && typeof o === 'object') {
      if (typeof o.seconds === 'number' && typeof o.nanoseconds === 'number' && !o.toMillis) return ts(o.seconds * 1000);
      Object.keys(o).forEach(k => { o[k] = revive(o[k]); });
    }
    return o;
  }
  function snapDoc(path) {
    const id = path.split('/').pop();
    const data = store.get(path);
    return { id, exists: data !== undefined, data: () => (data === undefined ? undefined : revive(JSON.parse(JSON.stringify(data)))), ref: new DocRef(path) };
  }
  function notify() {
    setTimeout(() => listeners.forEach(l => { try { l(); } catch (e) { console.error(e); } }), 0);
  }

  class DocRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    get() { return Promise.resolve(snapDoc(this.path)); }
    set(data, opts) { applyWrite(this.path, data, opts && opts.merge ? 'merge' : 'set'); notify(); return Promise.resolve(); }
    update(data) { try { applyWrite(this.path, data, 'update'); } catch (e) { return Promise.reject(e); } notify(); return Promise.resolve(); }
    delete() { applyWrite(this.path, null, 'delete'); notify(); return Promise.resolve(); }
    onSnapshot(cb) { const run = () => cb(snapDoc(this.path)); listeners.add(run); run(); return () => listeners.delete(run); }
  }
  let autoId = 0;
  class Query {
    constructor(col, filters, order, lim) { this.col = col; this.filters = filters || []; this.order = order || null; this.lim = lim || 0; }
    doc(id) { return new DocRef(this.col + '/' + (id || ('auto' + (++autoId) + Math.random().toString(36).slice(2, 8)))); }
    where(f, op, v) { return new Query(this.col, this.filters.concat([[f, op, v]]), this.order, this.lim); }
    orderBy(f, dir) { return new Query(this.col, this.filters, [f, dir || 'asc'], this.lim); }
    limit(n) { return new Query(this.col, this.filters, this.order, n); }
    _docs() {
      let docs = [...store.keys()].filter(p => p.startsWith(this.col + '/') && p.split('/').length === 2).map(snapDoc);
      this.filters.forEach(([f, op, v]) => {
        docs = docs.filter(d => { const x = d.data()[f]; return op === '>=' ? x >= v : op === '==' ? x === v : op === '<=' ? x <= v : true; });
      });
      if (this.order) {
        const [f, dir] = this.order;
        const val = d => { const x = d.data()[f]; return x && x.toMillis ? x.toMillis() : x; };
        docs.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (this.lim) docs = docs.slice(0, this.lim);
      return docs;
    }
    get() { const docs = this._docs(); return Promise.resolve({ docs, size: docs.length, empty: !docs.length }); }
    onSnapshot(cb) { const run = () => { const docs = this._docs(); cb({ docs, size: docs.length, empty: !docs.length }); }; listeners.add(run); run(); return () => listeners.delete(run); }
  }
  const db = {
    settings() {},
    collection: name => new Query(name),
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push(() => applyWrite(ref.path, data, opts && opts.merge ? 'merge' : 'set')); },
        update(ref, data) { ops.push(() => applyWrite(ref.path, data, 'update')); },
        delete(ref) { ops.push(() => applyWrite(ref.path, null, 'delete')); },
        commit() { ops.forEach(f => f()); notify(); return Promise.resolve(); }
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const t = {
        get: ref => Promise.resolve(snapDoc(ref.path)),
        set(ref, data, opts) { writes.push(() => applyWrite(ref.path, data, opts && opts.merge ? 'merge' : 'set')); return t; },
        update(ref, data) { writes.push(() => applyWrite(ref.path, data, 'update')); return t; },
        delete(ref) { writes.push(() => applyWrite(ref.path, null, 'delete')); return t; }
      };
      const result = await fn(t);
      writes.forEach(w => w());
      notify();
      return result;
    }
  };

  // ── auth ──
  let current = user;
  const authCbs = [];
  const auth = {
    get currentUser() { return current; },
    onAuthStateChanged(cb) { authCbs.push(cb); setTimeout(() => cb(current), 10); return () => {}; },
    signInWithPopup() { current = Object.assign({ uid: 'admin-uid', email: 'chungzhikai@gmail.com', emailVerified: true }, seed.signInAs || {}); authCbs.forEach(cb => cb(current)); return Promise.resolve({ user: current }); },
    signInWithRedirect() { return this.signInWithPopup(); },
    signOut() { current = null; authCbs.forEach(cb => cb(null)); return Promise.resolve(); }
  };
  function GoogleAuthProvider() {}
  GoogleAuthProvider.prototype.setCustomParameters = function () {};

  // ── functions: askOpenAi answers from window.__fakeAi(prompt, data) ──
  const functions = {
    httpsCallable(name) {
      return async data => {
        callLog.push({ name, data: JSON.parse(JSON.stringify(Object.assign({}, data, { media: (data.media || []).map(m => ({ mimeType: m.mimeType, bytes: (m.data || '').length })) }))) });
        if (name !== 'askOpenAi') throw Object.assign(new Error('unknown function'), { code: 'not-found' });
        const answer = window.__fakeAi ? await window.__fakeAi(data.prompt, data) : '{}';
        if (answer instanceof Error) throw answer;
        return { data: { text: answer, model: 'gpt-fake' } };
      };
    }
  };

  const app = { functions: () => functions };
  window.firebase = {
    initializeApp: () => app,
    app: () => app,
    auth: Object.assign(() => auth, { GoogleAuthProvider }),
    firestore: Object.assign(() => db, { FieldValue })
  };
})();
