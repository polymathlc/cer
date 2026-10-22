/* =====================================================================
   🌐 CONSULT BRIDGE — the 🙋 Consults button in the Science portal and
   the Maths portal (v1.445.0 Science, v1.106.0 Maths).

   THIS FILE IS BYTE FOR BYTE THE SAME IN polymathlc/cer AND
   polymathlc/math. Each repository's test compares the two copies
   whenever both are checked out side by side.

   Every consult lives in ONE collection, `tutorConsults`, on the one
   Firebase project the four apps share. Study Buddy and Ans Key read it
   through the compat SDK; consult-answer.js (byte for byte the same in all
   four repositories) is written against that compat shape. The two portals
   run the MODULAR SDK, so this file:

     ① loads the modular functions it needs from the SAME gstatic URLs the
       portal already imported (an ES module is one instance per URL, so
       `getFirestore(app)` here is the portal's own Firestore, with the same
       signed-in user and the same App Check);
     ② wraps them in the small compat-shaped surface consult-answer.js uses
       (`collection().doc()`, `where/orderBy/limit`, `onSnapshot`, `get`,
       `set/update/delete`, `runTransaction`, Storage `ref().put()`);
     ③ sets `window.ConsultEnv`, the only way consult-answer.js learns who
       is signed in and who is the teacher in a portal;
     ④ paints `#consultLogBtn`: the teacher's list of every call and
       question with a count of what is waiting, or the student's window to
       ask and to watch the answers, with a count of the new ones.

   THE TEACHER IS ONE ACCOUNT. A portal's own "admin" is a wider set of
   people (other staff, employees), and a consult is for the one teacher
   who answers them, so `isTeacher` is that account's email and nothing
   else. A teacher practising as a student is still the teacher here: the
   signed-in account is what the rules and the server see.

   AN ANONYMOUS GUEST GETS NO BUTTON. A guest has no name for the email and
   no way back to the answer (the server refuses them too).

   The portal calls `ConsultBridge.attach({...})` once, after its own
   `initializeApp` and `initializeAppCheck`. Nothing here runs before that,
   and a page where the scripts failed to load simply has no button.
   ===================================================================== */
(function (global) {
  'use strict';

  var TEACHER_EMAIL = 'chungzhikai@gmail.com';
  var TEACHER_NAME = 'Mr Chung';
  var APPS = { cer: 'science', math: 'math' };
  var COLLECTION = 'tutorConsults';
  var SDK_OK = /^\d{1,2}\.\d{1,3}\.\d{1,3}$/;
  var COUNT_TICK_MS = 30 * 1000;

  /* ---- Pure ---- */
  function teacherEmail(email) {
    return typeof email === 'string' && email.trim().toLowerCase() === TEACHER_EMAIL;
  }
  // Who the button is for: '' (nobody signed in, or a guest), 'teacher' or
  // 'student'.
  function roleOf(u) {
    if (!u || !u.uid || u.isAnonymous) return '';
    return teacherEmail(u.email) ? 'teacher' : 'student';
  }
  // The teacher's count: every question not yet answered, and every call
  // still ringing (the archive's own rule, so the count and the list agree).
  function teacherCount(docs, now, ringing) {
    var n = 0;
    (docs || []).forEach(function (d) {
      if (!d) return;
      if (d.status === 'question') n++;
      else if (d.status === 'waiting' && typeof ringing === 'function' && ringing(d, now)) n++;
    });
    return n;
  }
  // The student's count: answers they have not watched yet.
  function studentCount(docs) {
    var n = 0;
    (docs || []).forEach(function (d) {
      if (d && d.status === 'answered' && d.reply && !d.replySeen) n++;
    });
    return n;
  }
  function buttonWords(role, n) {
    if (role === 'teacher') {
      return {
        text: '🙋 Consults' + (n ? ' · ' + n : ''),
        title: n ? n + ' waiting — every call and question students have sent you' : 'Every call and question students have sent you, and the videos you answered with'
      };
    }
    if (role === 'student') {
      return {
        text: '🙋 Consults' + (n ? ' · ' + n + ' new' : ''),
        title: n ? n + ' new video answer' + (n === 1 ? '' : 's') + ' from ' + TEACHER_NAME : 'Ask ' + TEACHER_NAME + ' a question, and watch his video answers'
      };
    }
    return { text: '🙋 Consults', title: '' };
  }

  var pure = { TEACHER_EMAIL: TEACHER_EMAIL, APPS: APPS, COLLECTION: COLLECTION, teacherEmail: teacherEmail, roleOf: roleOf,
    teacherCount: teacherCount, studentCount: studentCount, buttonWords: buttonWords };

  if (!global.document) { global.ConsultBridge = { pure: pure }; return; }

  /* ---- ② The compat-shaped wrappers ---- */
  function wrapFirestore(F, fs) {
    function docSnap(snap) {
      return {
        id: snap.id,
        exists: snap.exists(),
        data: function () { return snap.data(); },
        ref: docRef(snap.ref)
      };
    }
    function querySnap(qs) {
      var docs = qs.docs.map(docSnap);
      return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
    }
    function docRef(r) {
      return {
        _r: r, id: r.id, path: r.path,
        get: function () { return F.getDoc(r).then(docSnap); },
        set: function (data, opts) { return opts ? F.setDoc(r, data, opts) : F.setDoc(r, data); },
        update: function (data) { return F.updateDoc(r, data); },
        delete: function () { return F.deleteDoc(r); },
        collection: function (name) { return collRef(F.collection(r, name)); },
        onSnapshot: function (next, err) {
          return F.onSnapshot(r, function (s) { next(docSnap(s)); }, err);
        }
      };
    }
    function queryRef(q) {
      return {
        _q: q,
        where: function (f, op, v) { return queryRef(F.query(q, F.where(f, op, v))); },
        orderBy: function (f, dir) { return queryRef(F.query(q, dir ? F.orderBy(f, dir) : F.orderBy(f))); },
        limit: function (n) { return queryRef(F.query(q, F.limit(n))); },
        get: function () { return F.getDocs(q).then(querySnap); },
        onSnapshot: function (next, err) {
          return F.onSnapshot(q, function (qs) { next(querySnap(qs)); }, err);
        }
      };
    }
    function collRef(c) {
      var q = queryRef(c);
      q.id = c.id; q.path = c.path;
      q.doc = function (id) { return docRef(id ? F.doc(c, id) : F.doc(c)); };
      return q;
    }
    return {
      collection: function (path) { return collRef(F.collection(fs, path)); },
      runTransaction: function (fn) {
        return F.runTransaction(fs, function (t) {
          return fn({
            get: function (r) { return t.get(r._r).then(docSnap); },
            set: function (r, data, opts) { if (opts) t.set(r._r, data, opts); else t.set(r._r, data); },
            update: function (r, data) { t.update(r._r, data); },
            delete: function (r) { t.delete(r._r); }
          });
        });
      }
    };
  }
  function wrapStorage(S, st) {
    function fileRef(r) {
      return {
        _r: r, fullPath: r.fullPath,
        put: function (blob, meta) {
          var task = S.uploadBytesResumable(r, blob, meta || undefined);
          function snap(s) { return { ref: fileRef(s.ref), bytesTransferred: s.bytesTransferred, totalBytes: s.totalBytes, state: s.state }; }
          return {
            on: function (ev, next, err, done) {
              return task.on('state_changed',
                function (s) { if (next) next(snap(s)); },
                function (e) { if (err) err(e); },
                function () { if (done) done(); });
            },
            get snapshot() { return snap(task.snapshot); },
            cancel: function () { return task.cancel(); },
            then: function (a, b) { return task.then(function (s) { return snap(s); }).then(a, b); }
          };
        },
        getDownloadURL: function () { return S.getDownloadURL(r); },
        delete: function () { return S.deleteObject(r); }
      };
    }
    return { ref: function (path) { return fileRef(S.ref(st, path)); } };
  }

  /* ---- A toast, when the portal does not hand one over ---- */
  var toastEl = null, toastTimer = 0;
  function ownToast(msg, ms) {
    try {
      if (!toastEl) {
        toastEl = global.document.createElement('div');
        toastEl.className = 'caBridgeToast';
        toastEl.setAttribute('role', 'status');
        toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1600;max-width:min(520px,92vw);'
          + 'background:#1A1A1A;color:#FFFFFF;padding:10px 16px;border-radius:10px;font:14px/1.4 "Century Gothic","Segoe UI",sans-serif;'
          + 'box-shadow:0 6px 20px rgba(0,0,0,.25);display:none';
        global.document.body.appendChild(toastEl);
      }
      toastEl.textContent = String(msg || '');
      toastEl.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, ms || 4000);
    } catch (e) {}
  }

  /* ---- ①③④ attach ---- */
  var B = { attached: false, ready: false, app: '', auth: null, authUser: null, db: null, storage: null,
    F: null, AC: null, appCheck: null, toast: null, unsub: null, docs: [], role: '', tick: 0, gen: 0 };

  function btnEl() { return global.document.getElementById('consultLogBtn'); }
  function CA() { return global.ConsultAnswer || null; }

  function paint() {
    var b = btnEl();
    if (!b) return;
    var role = B.ready ? roleOf(B.authUser) : '';
    var ca = CA();
    var usable = !!role && !!ca && (role === 'teacher' ? typeof ca.openLog === 'function' : typeof ca.openLibrary === 'function');
    b.hidden = !usable;
    b.style.display = usable ? '' : 'none';
    if (!usable) return;
    var ringing = ca.pure && ca.pure.callRinging;
    var n = role === 'teacher' ? teacherCount(B.docs, Date.now(), ringing) : studentCount(B.docs);
    var w = buttonWords(role, n);
    b.textContent = w.text;
    b.title = w.title;
    b.setAttribute('aria-label', w.title || w.text);
    b.classList.toggle('consultOn', n > 0);
  }
  function stopWatch() {
    if (B.unsub) { try { B.unsub(); } catch (e) {} }
    B.unsub = null;
    B.docs = [];
    if (B.tick) { clearInterval(B.tick); B.tick = 0; }
  }
  function watch() {
    stopWatch();
    var u = B.authUser, role = roleOf(u);
    B.role = role;
    if (!role || !B.db) { paint(); return; }
    var gen = ++B.gen;
    var q = role === 'teacher'
      ? B.db.collection(COLLECTION).where('status', 'in', ['waiting', 'question'])
      : B.db.collection(COLLECTION).where('studentUid', '==', u.uid);
    try {
      B.unsub = q.onSnapshot(function (qs) {
        if (gen !== B.gen) return;
        B.docs = qs.docs.map(function (d) { return d.data() || {}; });
        paint();
      }, function (err) {
        if (gen !== B.gen) return;
        console.warn('consult: the button count', err);
        B.docs = [];
        paint();
      });
    } catch (e) { console.warn('consult: the button count', e); }
    // A call stops ringing by the clock, not by a write, so the count is
    // re-read every half a minute.
    if (role === 'teacher') B.tick = setInterval(paint, COUNT_TICK_MS);
    paint();
  }
  function onClick() {
    var ca = CA(), role = B.ready ? roleOf(B.authUser) : '';
    if (!ca || !role) return;
    if (role === 'teacher') ca.openLog({});
    else ca.openLibrary({});
  }
  function onAuth(u) {
    var before = B.authUser && B.authUser.uid;
    B.authUser = u || null;
    // Another account: everything the last one had open comes down.
    if (before && (!u || u.uid !== before)) { try { var ca = CA(); if (ca && ca.stop) ca.stop(); } catch (e) {} }
    watch();
  }

  function attach(opts) {
    var o = opts || {};
    if (B.attached) return Promise.resolve(false);
    if (!Object.prototype.hasOwnProperty.call(APPS, o.app) || !o.firebaseApp || !SDK_OK.test(String(o.sdk || ''))) {
      console.warn('consult: the bridge was attached without an app, a Firebase app or an SDK version');
      return Promise.resolve(false);
    }
    B.attached = true;
    B.app = o.app;
    B.toast = typeof o.toast === 'function' ? o.toast : (typeof global.showToast === 'function' ? function (m) { global.showToast(m, 'info'); } : ownToast);
    B.appCheck = o.appCheck || null;
    var base = 'https://www.gstatic.com/firebasejs/' + o.sdk + '/';
    var b = btnEl();
    if (b && !b._consultBound) { b._consultBound = true; b.addEventListener('click', onClick); }
    return Promise.all([
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-storage.js'),
      import(base + 'firebase-auth.js'),
      B.appCheck ? import(base + 'firebase-app-check.js') : Promise.resolve(null)
    ]).then(function (m) {
      var F = m[0], S = m[1], A = m[2];
      B.F = F; B.AC = m[3];
      B.db = wrapFirestore(F, F.getFirestore(o.firebaseApp));
      B.storage = wrapStorage(S, S.getStorage(o.firebaseApp));
      B.auth = A.getAuth(o.firebaseApp);
      global.ConsultEnv = {
        app: B.app,
        subject: function () { return APPS[B.app]; },
        title: function () { try { return typeof o.title === 'function' ? o.title() : ''; } catch (e) { return ''; } },
        user: function () { return B.authUser; },
        isTeacher: function () { return roleOf(B.authUser) === 'teacher'; },
        studentName: function () { try { return typeof o.studentName === 'function' ? o.studentName() : ''; } catch (e) { return ''; } },
        teacherName: function () { return TEACHER_NAME; },
        db: function () { return B.db; },
        storage: function () { return B.storage; },
        serverStamp: function () { return F.serverTimestamp(); },
        toast: function (msg, ms) { try { B.toast(msg, ms); } catch (e) { ownToast(msg, ms); } },
        appCheckToken: function () {
          if (!B.AC || !B.appCheck) return Promise.resolve('');
          return B.AC.getToken(B.appCheck, false).then(function (r) { return r && r.token || ''; }, function () { return ''; });
        }
      };
      global.document.documentElement.classList.add('caPortal');
      B.ready = true;
      A.onAuthStateChanged(B.auth, onAuth);
      return true;
    }).catch(function (e) {
      console.warn('consult: the bridge could not load', e);
      B.attached = false;
      return false;
    });
  }

  global.ConsultBridge = {
    pure: pure,
    attach: attach,
    open: onClick,
    _internals: { state: function () { return B; }, wrapFirestore: wrapFirestore, wrapStorage: wrapStorage, paint: paint }
  };
})(typeof window !== 'undefined' ? window : globalThis);
