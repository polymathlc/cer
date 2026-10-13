/* An in-memory stand-in for the Firebase compat SDK, just big enough for
   online/portal.js. tools/online-portal-browser-check.mjs serves it in place
   of firebase-app-compat.js, so the portal runs end to end in a real browser
   with no network: sign-in, invitations, classes, uploads and releases.

   window.__fake.db      the documents, as { 'collection/id': data }
   window.__fake.signIn(user) / signOut()
   window.__fake.files   uploaded Storage objects, by path */
(function () {
  'use strict';
  var docs = window.__initialDocs ? JSON.parse(JSON.stringify(window.__initialDocs)) : {};
  var listeners = [];
  var files = {};
  var authListeners = [];
  var currentUser = window.__initialUser || null;
  var seq = 0;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function now() { return { _ts: Date.now(), toMillis: function () { return this._ts; } }; }
  var SERVER_TS = { __op: 'serverTimestamp' };
  var DELETE = { __op: 'delete' };
  function applyValue(v) {
    if (v && v.__op === 'serverTimestamp') return { seconds: Math.floor(Date.now() / 1000) };
    return v;
  }
  function write(path, data, merge) {
    var base = merge && docs[path] ? clone(docs[path]) : {};
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (v && v.__op === 'delete') delete base[k];
      else base[k] = clone(applyValue(v));
    });
    docs[path] = base;
  }
  function notify() {
    listeners.slice().forEach(function (l) { l.fire(); });
  }
  function snapOf(path) {
    var exists = Object.prototype.hasOwnProperty.call(docs, path);
    var id = path.split('/').pop();
    return { id: id, exists: exists, ref: docRef(path), data: function () { return exists ? clone(docs[path]) : undefined; } };
  }
  function querySnap(items) {
    return { size: items.length, empty: !items.length, docs: items, forEach: function (fn) { items.forEach(fn); } };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path: path,
      get: function () { return Promise.resolve(snapOf(path)); },
      set: function (data, opts) { write(path, data, opts && opts.merge); setTimeout(notify, 0); return Promise.resolve(); },
      update: function (data) { write(path, data, true); setTimeout(notify, 0); return Promise.resolve(); },
      delete: function () { delete docs[path]; setTimeout(notify, 0); return Promise.resolve(); },
      onSnapshot: function (next) {
        var l = { fire: function () { next(snapOf(path)); } };
        listeners.push(l); setTimeout(l.fire, 0);
        return function () { listeners.splice(listeners.indexOf(l), 1); };
      }
    };
  }
  function query(name, filters, limitN) {
    function run() {
      var prefix = name + '/';
      var items = Object.keys(docs).filter(function (p) { return p.indexOf(prefix) === 0 && p.split('/').length === 2; }).map(snapOf);
      filters.forEach(function (f) {
        items = items.filter(function (s) {
          var v = f.field === '__name__' ? s.id : (s.data() || {})[f.field];
          if (f.op === '==') return v === f.value;
          if (f.op === 'in') return f.value.indexOf(v) >= 0;
          return true;
        });
      });
      if (limitN) items = items.slice(0, limitN);
      return querySnap(items);
    }
    return {
      where: function (field, op, value) { return query(name, filters.concat([{ field: field && field.__documentId ? '__name__' : field, op: op, value: value }]), limitN); },
      limit: function (n) { return query(name, filters, n); },
      get: function () { return Promise.resolve(run()); },
      onSnapshot: function (next) {
        var l = { fire: function () { next(run()); } };
        listeners.push(l); setTimeout(l.fire, 0);
        return function () { var i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      }
    };
  }
  function collection(name) {
    var q = query(name, [], 0);
    q.doc = function (id) { return docRef(name + '/' + (id || ('auto' + (++seq) + Math.random().toString(36).slice(2, 8)))); };
    q.add = function (data) { var r = q.doc(); return r.set(data).then(function () { return r; }); };
    return q;
  }
  function firestore() {
    return {
      collection: collection,
      batch: function () {
        var ops = [];
        return {
          set: function (ref, data, opts) { ops.push(function () { write(ref.path, data, opts && opts.merge); }); },
          update: function (ref, data) { ops.push(function () { write(ref.path, data, true); }); },
          delete: function (ref) { ops.push(function () { delete docs[ref.path]; }); },
          commit: function () { ops.forEach(function (op) { op(); }); setTimeout(notify, 0); return Promise.resolve(); }
        };
      },
      runTransaction: function (fn) {
        var ops = [];
        var tx = {
          get: function (ref) { return Promise.resolve(snapOf(ref.path)); },
          set: function (ref, data, opts) { ops.push(function () { write(ref.path, data, opts && opts.merge); }); },
          update: function (ref, data) { ops.push(function () { write(ref.path, data, true); }); }
        };
        return Promise.resolve(fn(tx)).then(function (result) { ops.forEach(function (op) { op(); }); setTimeout(notify, 0); return result; });
      }
    };
  }
  firestore.FieldValue = { serverTimestamp: function () { return SERVER_TS; }, delete: function () { return DELETE; } };
  firestore.FieldPath = { documentId: function () { return { __documentId: true }; } };

  function GoogleAuthProvider() {}
  GoogleAuthProvider.prototype.setCustomParameters = function () {};
  function authApi() {
    return {
      get currentUser() { return currentUser; },
      onAuthStateChanged: function (fn) { authListeners.push(fn); setTimeout(function () { fn(currentUser); }, 0); return function () {}; },
      signInWithPopup: function () { return Promise.resolve({ user: currentUser }); },
      signInWithRedirect: function () { return Promise.resolve(); },
      signOut: function () { setUser(null); return Promise.resolve(); }
    };
  }
  authApi.GoogleAuthProvider = GoogleAuthProvider;
  function setUser(user) { currentUser = user; authListeners.forEach(function (fn) { fn(user); }); }

  function storageApi() {
    return {
      ref: function (path) {
        return {
          put: function (file) {
            var handlers = null;
            var task = {
              on: function (_evt, progress, error, complete) {
                handlers = { progress: progress, complete: complete };
                setTimeout(function () {
                  files[path] = { size: file.size, name: file.name };
                  progress({ bytesTransferred: file.size, totalBytes: file.size });
                  complete();
                }, 10);
              },
              then: function (a, b) { return new Promise(function (res) { setTimeout(res, 20); }).then(a, b); }
            };
            return task;
          },
          getDownloadURL: function () { return files[path] || path.indexOf('seed') >= 0 ? Promise.resolve('data:application/pdf;base64,JVBERi0xLjQK') : Promise.reject(new Error('object-not-found')); }
        };
      }
    };
  }

  window.firebase = {
    initializeApp: function () { return {}; },
    firestore: firestore,
    auth: authApi,
    storage: storageApi
  };
  window.__fake = {
    db: docs,
    files: files,
    signIn: function (user) { setUser(user); },
    signOut: function () { setUser(null); },
    seed: function (path, data) { docs[path] = clone(data); notify(); },
    get: function (path) { return clone(docs[path]); },
    list: function (name) { return Object.keys(docs).filter(function (p) { return p.indexOf(name + '/') === 0; }).map(function (p) { return { path: p, data: clone(docs[p]) }; }); }
  };
})();
