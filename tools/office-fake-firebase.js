/* An in-memory stand-in for the Firebase compat SDK, for tools/office-browser.mjs.
   It implements exactly what office/office-app.mjs uses — auth (one admin), Firestore
   (collections, collection groups, documents, where/orderBy/limit, live listeners,
   transactions, batches, serverTimestamp, arrayUnion, FieldPath, deep merges) and a callable askOpenAi — so the real
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
    // set(…, { merge: true }) merges maps all the way down, as Firestore does.
    const isMap = v => v && typeof v === 'object' && !Array.isArray(v) && !v[SENTINEL] && !(typeof v.seconds === 'number' && typeof v.nanoseconds === 'number');
    const mergeInto = (into, from) => {
      Object.keys(from || {}).forEach(k => {
        if (from[k] && from[k][SENTINEL] === 'delete') { delete into[k]; return; }
        if (isMap(from[k]) && isMap(into[k])) { into[k] = Object.assign({}, into[k]); mergeInto(into[k], from[k]); return; }
        const val = resolveValue(from[k], into[k]);
        if (val !== undefined) into[k] = val;
      });
    };
    if (mode === 'merge') mergeInto(base, data || {});
    else Object.keys(data || {}).forEach(k => {
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
    update(data, ...rest) {
      // update(fieldPath, value, fieldPath2, value2, …) with FieldPath objects:
      // each path is set (or deleted) inside the maps, the rest left alone.
      if (data instanceof FieldPath || (typeof data === 'string' && rest.length)) {
        const prev = store.get(this.path);
        if (!prev) return Promise.reject(Object.assign(new Error('No document to update: ' + this.path), { code: 'not-found' }));
        const doc = JSON.parse(JSON.stringify(prev));
        const pairs = [data, ...rest];
        for (let i = 0; i < pairs.length; i += 2) {
          const segs = pairs[i] instanceof FieldPath ? pairs[i].segs : String(pairs[i]).split('.');
          const v = pairs[i + 1];
          let o = doc;
          for (let j = 0; j < segs.length - 1; j++) { if (!o[segs[j]] || typeof o[segs[j]] !== 'object') o[segs[j]] = {}; o = o[segs[j]]; }
          const last = segs[segs.length - 1];
          if (v && v[SENTINEL] === 'delete') delete o[last];
          else o[last] = resolveValue(v, o[last]);
        }
        store.set(this.path, revive(doc));
        notify();
        return Promise.resolve();
      }
      try { applyWrite(this.path, data, 'update'); } catch (e) { return Promise.reject(e); } notify(); return Promise.resolve();
    }
    delete() { applyWrite(this.path, null, 'delete'); notify(); return Promise.resolve(); }
    onSnapshot(cb) { const run = () => cb(snapDoc(this.path)); listeners.add(run); run(); return () => listeners.delete(run); }
  }
  // FieldPath: a path into a document's maps, and documentId() for `where`.
  const DOC_ID = '__name__';
  class FieldPath {
    constructor(...segs) { this.segs = segs; }
    static documentId() { return new FieldPath(DOC_ID); }
  }
  let autoId = 0;
  class Query {
    constructor(col, filters, order, lim, group) { this.col = col; this.filters = filters || []; this.order = order || null; this.lim = lim || 0; this.group = !!group; }
    doc(id) { return new DocRef(this.col + '/' + (id || ('auto' + (++autoId) + Math.random().toString(36).slice(2, 8)))); }
    where(f, op, v) { return new Query(this.col, this.filters.concat([[f, op, v]]), this.order, this.lim, this.group); }
    orderBy(f, dir) { return new Query(this.col, this.filters, [f, dir || 'asc'], this.lim, this.group); }
    limit(n) { return new Query(this.col, this.filters, this.order, n, this.group); }
    _docs() {
      // A collection group: every collection of that name, at any depth.
      let docs = [...store.keys()].filter(p => {
        const parts = p.split('/');
        return this.group ? parts.length % 2 === 0 && parts[parts.length - 2] === this.col : p.startsWith(this.col + '/') && parts.length === 2;
      }).map(snapDoc);
      this.filters.forEach(([f, op, v]) => {
        const isId = f instanceof FieldPath && f.segs[0] === DOC_ID;
        docs = docs.filter(d => {
          const x = isId ? d.id : d.data()[f instanceof FieldPath ? f.segs[0] : f];
          return op === '>=' ? x >= v : op === '==' ? x === v : op === '<=' ? x <= v : op === 'in' ? (v || []).includes(x) : true;
        });
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
    collectionGroup: name => new Query(name, [], null, 0, true),
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
    firestore: Object.assign(() => db, { FieldValue, FieldPath })
  };
})();
