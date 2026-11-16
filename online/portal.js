/* Polymath Online — the page. The rules it follows are in portal-core.js;
   what lives here is Firebase, the screens and the buttons.
   See the comment at the top of online/index.html for the data model. */
(function () {
  'use strict';

  var APP_VERSION = 'v1.14.0';
  var Core = window.PolymathOnlineCore;

  // Who runs the portal. Anyone else signs in as a student or a parent.
  var ONLINE_ADMINS = ['chungzhikai@gmail.com', 'elsielcr@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
  // The teacher whose Ans Key notebook a worksheet's AI features read.
  var TEACHER_EMAIL = 'chungzhikai@gmail.com';
  // Invitations always point at the public address, wherever they are sent from.
  var PORTAL_URL = 'https://polymathlc.com.sg/online/';
  var ANSKEY_URL = '../anskey/';
  var WORKSHEETS = 'pdfAnnotator';
  var STORAGE_DIR = 'pdf-annotator';
  var ANN_INLINE_LIMIT = 600000;   // as Ans Key: an answer key bigger than this sits in Storage
  var COURSES = 'onlineCourses';
  var INVITES = 'onlineInvites';
  var MEMBERS = 'onlineMembers';
  var SETTINGS = 'onlineSettings';
  var PROFILES = 'studentProfiles';
  var MAIL = 'mail';
  var MAX_PDF_BYTES = 60 * 1024 * 1024;
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  firebase.initializeApp({
    apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
    authDomain: 'mathgen--app.firebaseapp.com',
    projectId: 'mathgen--app',
    storageBucket: 'mathgen--app.firebasestorage.app',
    messagingSenderId: '165654161198',
    appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf',
    measurementId: 'G-0MWZFG211D'
  });
  var db = firebase.firestore();
  var auth = firebase.auth();
  var storage = firebase.storage();
  var FieldValue = firebase.firestore.FieldValue;

  var params = new URLSearchParams(location.search);
  var state = {
    user: null,
    isAdmin: false,
    member: null,              // the joined student or parent
    accessError: '',           // why a signed-in visitor has no access
    inviteId: params.get('invite') || '',
    invitePreview: null,       // the invitation shown on the sign-in screen
    courses: {},
    coursesLoaded: false,
    invites: [],
    members: [],
    docs: {},                  // worksheet id → pdfAnnotator data
    docsLoading: {},
    recordings: {},            // worksheet id → its recorded lessons, newest first
    adminTab: 'overview',
    studentTab: Core.studentTab(location.hash),   // 🗂 v1.12.0: worksheets | answers | videos | timeline
    courseId: null,            // the class open in the admin's class view
    preview: null,             // { level, subjects } while an admin previews the student view
    uploads: [],               // [{ name, pct, state }]
    teacherUid: null
  };
  var unsubscribers = [];
  var pdfUrlCache = {};
  var pdfBlobCache = {};
  var renderQueued = false;

  /* ================= Little helpers ================= */
  function $(id) { return document.getElementById(id); }
  var h = Core.escapeHtml;
  function isAdminEmail(email) { return ONLINE_ADMINS.indexOf(Core.normalizeEmail(email)) >= 0; }
  function ms(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts === 'number') return ts;
    if (ts.seconds) return ts.seconds * 1000;
    return 0;
  }
  function toast(message, options) {
    var opts = options || {};
    var node = document.createElement('div');
    node.className = 'toast' + (opts.error ? ' is-error' : '');
    node.textContent = message;
    $('toasts').appendChild(node);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 260);
    }, opts.ms || (opts.error ? 6000 : 3800));
  }
  function fail(prefix, err) {
    console.error(prefix, err);
    var msg = err && err.message ? err.message : String(err || 'Something went wrong');
    if (err && err.code === 'permission-denied') msg = 'this account is not allowed to do that';
    toast(prefix + ': ' + msg, { error: true });
  }
  function busy(button, on) {
    if (!button) return;
    if (on) { button.dataset.width = button.offsetWidth; button.style.minWidth = button.offsetWidth + 'px'; button.classList.add('is-busy'); button.disabled = true; }
    else { button.classList.remove('is-busy'); button.disabled = false; button.style.minWidth = ''; }
  }
  function done(button, label) {
    if (!button) return;
    var old = button.innerHTML;
    button.classList.add('is-done');
    button.textContent = '✓ ' + (label || 'Done');
    setTimeout(function () { button.classList.remove('is-done'); button.innerHTML = old; }, 1500);
  }
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }
  function courseList() {
    return Object.keys(state.courses).map(function (k) { return state.courses[k]; }).sort(Core.compareCourses);
  }
  function subjectChip(subject) {
    var cls = subject === 'math' ? 'chip-math' : subject === 'science' ? 'chip-science' : '';
    return '<span class="chip ' + cls + '">' + h(Core.subjectLabel(subject, true)) + '</span>';
  }
  function levelChip(level) { return level ? '<span class="chip chip-level">' + h(level) + '</span>' : ''; }
  function dayChip(course) {
    if (!course.day) return '';
    var slot = Core.slotLabel(course.day, course.slot);
    return '<span class="chip chip-outline">' + h(course.day + (slot ? ' · ' + slot : '')) + '</span>';
  }
  function docName(id) {
    var d = state.docs[id];
    if (!d) return state.docsLoading[id] ? 'Loading…' : 'Worksheet';
    return d.name || 'Untitled worksheet';
  }
  function pagesLabel(id) {
    var d = state.docs[id];
    if (!d || !d.pageCount) return '';
    return d.pageCount + (d.pageCount === 1 ? ' page' : ' pages');
  }
  function avatarHtml(user) {
    if (user && user.photoURL) return '<img src="' + h(user.photoURL) + '" alt="" referrerpolicy="no-referrer">';
    return h(Core.initials(user && user.displayName, user && user.email));
  }
  function setUrlWithout(key) {
    try {
      var url = new URL(location.href);
      url.searchParams.delete(key);
      history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
    } catch (e) { /* the address bar is cosmetic */ }
  }

  /* ================= Worksheet files ================= */
  function ensureDocs(ids) {
    var missing = ids.filter(function (id) { return id && !state.docs[id] && !state.docsLoading[id]; });
    if (!missing.length) return Promise.resolve();
    missing.forEach(function (id) { state.docsLoading[id] = true; });
    var path = firebase.firestore.FieldPath.documentId();
    return Promise.all(Core.chunk(missing, 10).map(function (group) {
      return db.collection(WORKSHEETS).where(path, 'in', group).get().then(function (snap) {
        snap.forEach(function (doc) { state.docs[doc.id] = doc.data(); });
      });
    })).catch(function (err) {
      console.warn('Worksheets could not be read', err);
    }).then(function () {
      missing.forEach(function (id) {
        delete state.docsLoading[id];
        if (!state.docs[id]) state.docs[id] = { name: 'Worksheet unavailable', missing: true };
      });
      queueRender();
    });
  }
  // The student timeline follows the teacher live: each released worksheet
  // is watched, so a new edit date or a new recording shows up as it lands.
  var watchedSig = '', watchedStops = [], annotationStamps = {};
  function watchDocs(ids) {
    ids = ids.filter(Boolean).slice().sort();
    var sig = ids.join('|');
    if (sig === watchedSig) return;
    watchedSig = sig;
    watchedStops.forEach(function (stop) { try { stop(); } catch (e) {} });
    watchedStops = [];
    if (!ids.length) return;
    var path = firebase.firestore.FieldPath.documentId();
    Core.chunk(ids, 10).forEach(function (group) {
      var stop = db.collection(WORKSHEETS).where(path, 'in', group).onSnapshot(function (snap) {
        var seen = {};
        snap.forEach(function (doc) {
          seen[doc.id] = true;
          state.docs[doc.id] = doc.data();
          readRecordings(doc.id, doc.data());
        });
        group.forEach(function (id) { if (!seen[id] && !state.docs[id]) state.docs[id] = { name: 'Worksheet unavailable', missing: true }; });
        queueRender();
      }, function (err) {
        console.warn('Worksheets could not be followed', err);
        ensureDocs(group);
      });
      watchedStops.push(stop);
    });
  }
  function stopWatchingDocs() {
    watchedStops.forEach(function (stop) { try { stop(); } catch (e) {} });
    watchedStops = []; watchedSig = '';
  }
  // A big worksheet keeps its annotations in Storage (`annotationsPath`);
  // a small one inline. Either way only the recorded lessons are kept here.
  function readRecordings(id, d) {
    if (!d) return;
    if (!d.annotationsPath) {
      state.recordings[id] = Core.lessonRecordings(d.annotations || '[]');
      annotationStamps[id] = 'inline';
      return;
    }
    var stamp = d.annotationsPath + '#' + (d.annotationsStamp || Core.editedMillis(d));
    if (annotationStamps[id] === stamp) return;
    annotationStamps[id] = stamp;
    storage.ref(d.annotationsPath).getDownloadURL().then(function (url) {
      return fetch(url, { cache: 'no-store' });
    }).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function (text) {
      if (annotationStamps[id] !== stamp) return;
      state.recordings[id] = Core.lessonRecordings(text);
      queueRender();
    }).catch(function (err) {
      console.warn('Recordings could not be read for ' + id, err);
      if (annotationStamps[id] === stamp) delete annotationStamps[id];
    });
  }

  function pdfUrl(id) {
    var d = state.docs[id];
    if (!d || !d.storagePath) return Promise.reject(new Error('This worksheet has no PDF yet.'));
    // 🔁 Keyed on path + pdfVersion: a replaced PDF is fetched afresh.
    var key = Core.pdfCacheKey(d);
    if (!pdfUrlCache[key]) {
      pdfUrlCache[key] = storage.ref(d.storagePath).getDownloadURL();
      pdfUrlCache[key].catch(function () { delete pdfUrlCache[key]; });
    }
    return pdfUrlCache[key];
  }
  function pdfBlob(id) {
    var d = state.docs[id];
    if (!d || !d.storagePath) return Promise.reject(new Error('This worksheet has no PDF yet.'));
    var key = Core.pdfCacheKey(d);
    if (!pdfBlobCache[key]) {
      pdfBlobCache[key] = pdfUrl(id).then(function (url) { return fetch(url, d.pdfVersion ? { cache: 'no-cache' } : undefined); }).then(function (resp) {
        if (!resp.ok) throw new Error('download failed (HTTP ' + resp.status + ')');
        return resp.blob();
      }).then(function (blob) { return new Blob([blob], { type: 'application/pdf' }); });
      pdfBlobCache[key].catch(function () { delete pdfBlobCache[key]; });
    }
    return pdfBlobCache[key];
  }
  function viewWorksheet(id, button) {
    // Opened synchronously so a phone's pop-up blocker lets it through.
    var win = window.open('', '_blank');
    busy(button, true);
    pdfUrl(id).then(function (url) {
      if (win) win.location.href = url; else location.href = url;
    }).catch(function (err) {
      if (win) win.close();
      fail('Could not open the worksheet', err);
    }).then(function () { busy(button, false); });
  }
  function downloadWorksheet(id, button) {
    busy(button, true);
    pdfBlob(id).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = Core.safeFileName(docName(id));
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      busy(button, false); done(button, 'Saved');
    }).catch(function (err) { busy(button, false); fail('Could not download', err); });
  }
  function printWorksheet(id, button) {
    busy(button, true);
    pdfBlob(id).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
      frame.src = url;
      frame.onload = function () {
        setTimeout(function () {
          try { frame.contentWindow.focus(); frame.contentWindow.print(); }
          catch (e) { window.open(url, '_blank'); }
          busy(button, false);
        }, 300);
      };
      document.body.appendChild(frame);
      setTimeout(function () { frame.remove(); URL.revokeObjectURL(url); }, 10 * 60000);
    }).catch(function (err) { busy(button, false); fail('Could not print', err); });
  }
  function answerKeyUrl(id) { return ANSKEY_URL + '?ws=' + encodeURIComponent(id); }

  /* ================= Signing in ================= */
  function signIn(button) {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    busy(button, true);
    auth.signInWithPopup(provider).catch(function (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
        return auth.signInWithRedirect(provider);
      }
      if (err && err.code === 'auth/popup-closed-by-user') return;
      fail('Sign-in failed', err);
    }).then(function () { busy(button, false); });
  }
  function signOut() {
    stopListening();
    state.member = null; state.isAdmin = false; state.preview = null; state.courseId = null;
    auth.signOut();
  }
  function stopListening() {
    unsubscribers.forEach(function (fn) { try { fn(); } catch (e) {} });
    unsubscribers = [];
    stopWatchingDocs();
    state.courses = {}; state.coursesLoaded = false; state.invites = []; state.members = [];
  }

  auth.onAuthStateChanged(function (user) {
    stopListening();
    state.user = user && !user.isAnonymous ? user : null;
    state.isAdmin = !!(state.user && isAdminEmail(state.user.email));
    state.member = null;
    state.accessError = '';
    state.studentLevels = [];
    renderHeader();
    if (!state.user) {
      if (state.inviteId && !state.invitePreview) loadInvitePreview();
      render();
      return;
    }
    if (state.isAdmin) { startAdmin(); return; }
    render();   // "Opening…" while membership is worked out
    resolveMembership(state.user).then(function (member) {
      if (state.user !== user) return;
      state.member = member;
      if (member) listenCourses();
      render();
    }).catch(function (err) {
      if (state.user !== user) return;
      console.error(err);
      state.accessError = 'error';
      render();
    });
  });

  function loadInvitePreview() {
    db.collection(INVITES).doc(state.inviteId).get().then(function (snap) {
      state.invitePreview = snap.exists ? snap.data() : { missing: true };
      if (!state.user) render();
    }).catch(function () {
      // Reading an invitation can need a signed-in account; the sign-in
      // screen simply says there is one waiting.
      state.invitePreview = { unknown: true };
      if (!state.user) render();
    });
  }

  /* ================= Joining ================= */
  // Since November 2026 the approval at polymathlc.com.sg/student decides who
  // sees which classes: an approved account sees exactly its children's levels
  // and subjects there, whatever an older invitation or member row said; an
  // account waiting there (or paused) sees nothing here. Only an account with
  // no approval record at all (staff, or a student the enrolment pop-up is
  // still asking) falls back to the invitations below.
  var STUDENT_ACCESS = 'studentAccess';
  async function readStudentAccess(user) {
    try {
      var snap = await db.collection(STUDENT_ACCESS).doc(user.uid).get();
      return snap.exists ? (snap.data() || {}) : null;
    } catch (err) {
      // Unreadable (offline, or the rules refuse): the invitations decide, as before.
      console.warn('studentAccess', err && err.code);
      return null;
    }
  }
  async function resolveMembership(user) {
    var record = await readStudentAccess(user);
    var status = Core.studentAccessStatus(record);
    if (status === 'approved') {
      var existing = null;
      try {
        var own = await db.collection(MEMBERS).doc(user.uid).get();
        if (own.exists) existing = own.data();
      } catch (err) { existing = null; }
      if (state.inviteId) { setUrlWithout('invite'); state.inviteId = ''; }
      state.accessError = '';
      state.studentLevels = Core.studentAccessLevels(record);
      if (existing) touchMember(user, existing);
      return Core.memberFromStudentAccess(record, existing, user);
    }
    if (status === 'pending' || status === 'revoked') {
      state.accessError = status === 'pending' ? 'student-pending' : 'student-revoked';
      return null;
    }
    return invitedMembership(user);
  }
  // The invitation link, a member row, or an invitation to this email —
  // in that order. Anything else is a signed-in visitor with no access yet.
  async function invitedMembership(user) {
    var email = Core.normalizeEmail(user.email);
    if (state.inviteId) {
      var ref = db.collection(INVITES).doc(state.inviteId);
      var snap = await ref.get();
      if (!snap.exists) {
        state.accessError = 'invite-missing';
      } else {
        var inv = snap.data();
        if (inv.status === 'revoked') state.accessError = 'invite-revoked';
        else if (inv.status === 'joined' && inv.joinedUid && inv.joinedUid !== user.uid && Core.normalizeEmail(inv.joinedEmail) !== email) state.accessError = 'invite-used';
        else {
          var joined = await acceptInvite(user, snap.id, inv);
          setUrlWithout('invite');
          state.inviteId = '';
          return joined;
        }
      }
    }
    var memberSnap = await db.collection(MEMBERS).doc(user.uid).get();
    if (memberSnap.exists) {
      var m = memberSnap.data();
      if (m.revoked) { state.accessError = 'revoked'; return null; }
      touchMember(user, m);
      return Object.assign({ uid: user.uid }, m);
    }
    if (email) {
      var byEmail = await db.collection(INVITES).where('emailLower', '==', email).get();
      var pending = null;
      byEmail.forEach(function (doc) {
        var d = doc.data();
        if (!pending && d.status !== 'revoked' && (d.status !== 'joined' || d.joinedUid === user.uid)) pending = { id: doc.id, data: d };
      });
      if (pending) return acceptInvite(user, pending.id, pending.data);
    }
    if (!state.accessError) state.accessError = 'no-invite';
    return null;
  }
  async function acceptInvite(user, inviteId, inv) {
    var subjects = Core.cleanSubjects(inv.level, inv.subjects);
    var member = {
      uid: user.uid,
      email: user.email || '',
      emailLower: Core.normalizeEmail(user.email),
      name: inv.name || user.displayName || '',
      googleName: user.displayName || '',
      photoURL: user.photoURL || '',
      role: inv.role === 'parent' ? 'parent' : 'student',
      level: inv.level,
      subjects: subjects,
      inviteId: inviteId,
      invitedEmail: inv.email || '',
      joinedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp()
    };
    var batch = db.batch();
    batch.set(db.collection(MEMBERS).doc(user.uid), member, { merge: true });
    batch.set(db.collection(INVITES).doc(inviteId), {
      status: 'joined', joinedUid: user.uid, joinedEmail: user.email || '', joinedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    // The Ans Key app reads a student's level and subject from here, so the
    // answer key opens on the right worksheets with no setup screen.
    var profile = {
      name: member.name || user.displayName || '',
      level: inv.level,
      subject: Core.profileSubjectFor(subjects),
      email: user.email || '',
      onlineMember: true,
      updatedAt: FieldValue.serverTimestamp()
    };
    var profileRef = db.collection(PROFILES).doc(user.uid);
    var existing = null;
    try { existing = await profileRef.get(); } catch (e) { existing = null; }
    if (!existing || !existing.exists) profile.createdAt = FieldValue.serverTimestamp();
    batch.set(profileRef, profile, { merge: true });
    await batch.commit();
    toast('Welcome to Polymath Online' + (member.name ? ', ' + member.name.split(' ')[0] : '') + '!');
    return Object.assign({}, member, { joinedAt: null });
  }
  function touchMember(user, m) {
    var update = { lastSeenAt: FieldValue.serverTimestamp() };
    if (user.photoURL && user.photoURL !== m.photoURL) update.photoURL = user.photoURL;
    db.collection(MEMBERS).doc(user.uid).set(update, { merge: true }).catch(function () {});
  }

  /* ================= Live data ================= */
  function listenCourses() {
    unsubscribers.push(db.collection(COURSES).onSnapshot(function (snap) {
      var next = {};
      snap.forEach(function (doc) { next[doc.id] = Object.assign({ id: doc.id }, doc.data()); });
      state.courses = next;
      state.coursesLoaded = true;
      queueRender();
    }, function (err) { fail('Classes could not be loaded', err); state.coursesLoaded = true; queueRender(); }));
  }
  function startAdmin() {
    listenCourses();
    unsubscribers.push(db.collection(INVITES).onSnapshot(function (snap) {
      var list = [];
      snap.forEach(function (doc) { list.push(Object.assign({ id: doc.id }, doc.data())); });
      list.sort(function (a, b) { return ms(b.createdAt) - ms(a.createdAt); });
      state.invites = list;
      queueRender();
    }, function (err) { console.warn('Invitations could not be loaded', err); }));
    unsubscribers.push(db.collection(MEMBERS).onSnapshot(function (snap) {
      var list = [];
      snap.forEach(function (doc) { list.push(Object.assign({ uid: doc.id }, doc.data())); });
      list.sort(function (a, b) { return Core.naturalCompare(a.name || a.email, b.name || b.email); });
      state.members = list;
      queueRender();
    }, function (err) { console.warn('Members could not be loaded', err); }));
    // Uploads made by another admin should still feed the teacher's own
    // Ans Key notebook, so the teacher's uid is kept where they can read it.
    var settingsRef = db.collection(SETTINGS).doc('main');
    if (Core.normalizeEmail(state.user.email) === TEACHER_EMAIL) {
      state.teacherUid = state.user.uid;
      settingsRef.set({ teacherUid: state.user.uid, teacherEmail: TEACHER_EMAIL, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(function () {});
    } else {
      settingsRef.get().then(function (snap) { if (snap.exists) state.teacherUid = snap.data().teacherUid || null; }).catch(function () {});
    }
    render();
  }

  /* ================= Rendering ================= */
  function renderHeader() {
    var u = state.user;
    $('userChip').hidden = !u;
    $('versionTag').hidden = !state.isAdmin;
    $('versionTag').textContent = APP_VERSION;
    if (!u) return;
    $('userAvatar').innerHTML = avatarHtml(u);
    $('userName').textContent = u.displayName || u.email;
    $('userRole').textContent = state.isAdmin ? 'Admin' : state.member ? (state.member.role === 'parent' ? 'Parent' : 'Student') : 'Guest';
  }
  // Live updates re-draw the page; whatever the admin is typing in survives it.
  function render() {
    var active = document.activeElement;
    // Only what someone is typing is carried across a re-render. A file
    // picker's value can never be set back (the browser throws), and doing so
    // used to stop an upload at "waiting" before its first file was read.
    var keep = active && active.id && $('app').contains(active) && Core.keepsTyping(active.tagName, active.type)
      ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    renderInner();
    if (keep && $(keep.id)) {
      var again = $(keep.id);
      try {
        if (again.value !== keep.value) again.value = keep.value;
        again.focus();
        if (keep.start != null) again.setSelectionRange(keep.start, keep.end);
      } catch (e) {}
    }
  }
  function renderInner() {
    renderHeader();
    var app = $('app');
    if (!state.user) { app.innerHTML = signInHtml(); return; }
    if (state.isAdmin) {
      if (state.preview) { app.innerHTML = previewBarHtml() + studentHtml(state.preview, true); afterStudentRender(state.preview); return; }
      app.innerHTML = adminHtml();
      afterAdminRender();
      return;
    }
    if (state.member) { app.innerHTML = studentHtml(state.member, false); afterStudentRender(state.member); return; }
    if (state.accessError) { app.innerHTML = noAccessHtml(); return; }
    app.innerHTML = '<div class="loader"><div class="spinner" aria-hidden="true"></div><div>Finding your classes…</div></div>';
  }

  /* ---- Sign-in screen ---- */
  function signInHtml() {
    var inv = state.invitePreview;
    var banner = '';
    if (state.inviteId) {
      if (inv && inv.missing) banner = '<div class="invite-banner"><span>⚠️</span><div>This invitation link is no longer valid. Ask the centre to send you a new one.</div></div>';
      else if (inv && inv.level) banner = '<div class="invite-banner"><span>✉️</span><div><b>You have been invited' + (inv.name ? ', ' + h(inv.name) : '') + '.</b> Sign in with Google to join ' + h(inv.level) + ' ' + h((inv.subjects || []).map(function (s) { return Core.subjectLabel(s); }).join(' & ')) + '. Use any Google account. It does not have to be ' + h(inv.email || 'the invited address') + '.</div></div>';
      else banner = '<div class="invite-banner"><span>✉️</span><div><b>Your invitation is waiting.</b> Sign in with Google to join. Any Google account works.</div></div>';
    }
    return '' +
      '<section class="hero reveal">' +
        '<div>' +
          '<div class="eyebrow">Polymath Learning Centre</div>' +
          '<h1 style="margin-top:12px">Every worksheet, <em>right when your class needs it.</em></h1>' +
          '<p>Your class\'s worksheets and answer keys in one place. New worksheets appear on their own as lessons go, ready to view, download or print.</p>' +
          banner +
          '<div class="actions">' +
            '<button class="btn btn-dark btn-google" type="button" data-action="sign-in">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/></svg>' +
              'Continue with Google</button>' +
            '<span class="hero-note">Students and parents join by invitation from the centre.</span>' +
          '</div>' +
        '</div>' +
        '<div class="hero-art" aria-hidden="true">' +
          '<div class="sheet sheet-1"><span class="chip chip-science tag">Science</span><div class="line"></div><div class="line mid"></div><div class="line short"></div><div class="line"></div><div class="line mid"></div></div>' +
          '<div class="sheet sheet-2"><span class="chip chip-level tag">Up next</span><div class="line mid"></div><div class="line"></div><div class="line short"></div><div class="line"></div><div class="line"></div><div class="line short"></div>' +
            '<div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#2E6B34" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div></div>' +
          '<div class="sheet sheet-3"><span class="chip chip-math tag">Maths</span><div class="line"></div><div class="line short"></div><div class="line mid"></div><div class="line"></div></div>' +
        '</div>' +
      '</section>';
  }

  /* ---- No access ---- */
  function noAccessHtml() {
    var map = {
      'invite-missing': ['🔗', 'That invitation link has expired', 'Ask the centre to send you a new invitation, then open the link in this browser.'],
      'invite-revoked': ['✋', 'This invitation was withdrawn', 'Please contact the centre if you think this is a mistake.'],
      'invite-used': ['👥', 'This invitation is already in use', 'Someone has already joined with this link on another Google account. Sign in with that account, or ask the centre for a new invitation.'],
      'revoked': ['✋', 'Your access has ended', 'This account no longer has access to Polymath Online. Please contact the centre if you think this is a mistake.'],
      'student-pending': ['⏳', 'Waiting for approval', 'Your worksheets open here as soon as the centre approves your account at My Polymath (polymathlc.com.sg/student). It usually takes one working day.'],
      'student-revoked': ['✋', 'Your access is paused', 'This account cannot open the Polymath apps at the moment. Open My Polymath (polymathlc.com.sg/student) to update your details, or WhatsApp us on +65 9645 0588.'],
      'no-invite': ['✉️', 'You have not been invited yet', 'Polymath Online is for students and parents at the centre. If you have an invitation email, open its link. Otherwise ask the centre to invite ' + (state.user ? state.user.email : 'you') + '.'],
      'error': ['⚠️', 'We could not open your classes', 'Check your connection and try again.']
    };
    var m = map[state.accessError] || map['no-invite'];
    return '<div class="card state-card reveal"><div class="state-icon">' + m[0] + '</div><h2>' + h(m[1]) + '</h2><p>' + h(m[2]) + '</p>' +
      '<div class="actions"><button class="btn" type="button" data-action="reload">Try again</button><button class="btn btn-ghost" type="button" data-action="sign-out">Use another account</button></div></div>';
  }

  /* ---- The student (and parent) view ---- */
  function studentHtml(member, preview) {
    if (!state.coursesLoaded) return '<div class="loader"><div class="spinner" aria-hidden="true"></div><div>Loading your classes…</div></div>';
    var courses = Core.coursesForMember(state.courses, member);
    // One chip group per (level, subjects) the member may see: an approved
    // family with two children has two.
    var pairs = Core.accessPairs(member);
    var chips = pairs.map(function (pair) { return levelChip(pair.level) + pair.subjects.map(subjectChip).join(''); }).join('');
    var levelWords = pairs.length ? pairs.map(function (pair) { return pair.level; }).join(' and ') : (member.level || '');
    var first = String(member.name || (state.user && state.user.displayName) || '').split(' ')[0];
    var parent = member.role === 'parent';
    var html = '<div class="reveal">' +
      '<section class="welcome">' +
        '<div><div class="eyebrow">' + (preview ? 'Student view preview' : parent ? 'Parent view' : 'Your worksheets') + '</div>' +
        '<h1 class="page-title" style="margin-top:8px">' + (preview ? 'What a ' + h(member.level) + ' student sees' : 'Hello' + (first ? ', ' + h(first) : '') + ' 👋') + '</h1>' +
        '<p class="page-subtitle">' + (parent ? 'Your child\'s worksheets and answer keys, released as the class goes.' : 'New worksheets appear here on their own as your class goes.') + '</p>' +
        '<div class="chips">' + chips + '</div></div>' +
      '</section>';
    if (!pairs.length && !preview) {
      var asked = (state.studentLevels || []).join(', ');
      html += '<div class="card section empty"><div class="big">📚</div><h3>No online worksheets for your level yet</h3><p>Polymath Online has worksheets for Primary 3 to Primary 6' +
        (asked ? ' (your account is approved for ' + h(asked) + ')' : '') + '. If this is not right, please WhatsApp the centre on +65 9645 0588.</p></div>';
      return html + '</div>';
    }
    if (!courses.length) {
      html += '<div class="card section empty"><div class="big">📚</div><h3>No classes yet</h3><p>Your ' + h(levelWords) + ' worksheets will appear here as soon as the centre sets up your class.</p></div>';
      return html + '</div>';
    }
    // 🗂 v1.12.0: three plain tabs (and the full timeline as a fourth), so a
    // child finds the worksheets first and nothing else gets in the way.
    html += studentTabsHtml(courses);
    html += '<div class="section st-panel" role="tabpanel" id="studentPanel" aria-labelledby="st-tab-' + state.studentTab + '">';
    if (state.studentTab === 'timeline') courses.forEach(function (course) { html += classCardHtml(course); });
    else courses.forEach(function (course) {
      html += state.studentTab === 'answers' ? answersTabHtml(course, courses.length > 1)
        : state.studentTab === 'videos' ? videosTabHtml(course, courses.length > 1)
        : worksheetsTabHtml(course, courses.length > 1);
    });
    html += '</div></div>';
    return html;
  }

  /* ---- 🗂 The student tabs (v1.12.0) ----
     Big, plain buttons that fit a phone: Worksheets (where a student lands),
     Answer keys, Videos, and the full Timeline. The choice lives in the
     address (#answers), so a reload or a shared link keeps it. */
  function studentTabsHtml(courses) {
    var counts = { worksheets: 0, answers: 0, videos: 0, timeline: '' };
    courses.forEach(function (course) {
      var items = Core.timelineItems(course, state.docs, state.recordings);
      counts.worksheets += items.length;
      counts.answers += Core.answerKeyRows(course, items).filter(function (row) { return row.latest; }).length;
      counts.videos += Core.videoRows(course, items).length;
    });
    return '<nav class="st-tabs" role="tablist" aria-label="Choose what to see">' +
      Core.STUDENT_TABS.map(function (t) {
        var on = state.studentTab === t[0];
        var count = counts[t[0]];
        return '<button class="st-tab" role="tab" type="button" id="st-tab-' + t[0] + '" data-action="student-tab" data-tab="' + t[0] + '" aria-selected="' + on + '" aria-controls="studentPanel">' +
          '<span class="st-tab-icon" aria-hidden="true">' + t[2] + '</span>' +
          '<span class="st-tab-label">' + h(t[1]) + '</span>' +
          (count !== '' && count > 0 ? '<span class="st-tab-count">' + count + '</span>' : '') +
        '</button>';
      }).join('') +
    '</nav>';
  }
  function setStudentTab(tab) {
    tab = Core.studentTab(tab);
    if (tab === state.studentTab) return;
    state.studentTab = tab;
    try { history.replaceState(null, '', location.pathname + location.search + (tab === 'worksheets' ? '' : '#' + tab)); } catch (e) {}
    render();
    var bar = document.querySelector('.st-tabs');
    if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  // The class's name over its rows, only when the student has more than one.
  function stClassHead(course, many) {
    if (!many) return '';
    return '<div class="st-class-head"><span class="st-class-name">' + h(Core.courseTitle(course)) + '</span>' +
      '<span class="st-class-chips">' + levelChip(course.level) + subjectChip(course.subject) + dayChip(course) + '</span></div>';
  }
  function stEmpty(icon, title, text) {
    return '<div class="st-empty"><div class="st-empty-icon" aria-hidden="true">' + icon + '</div><b>' + h(title) + '</b><p>' + h(text) + '</p></div>';
  }
  function stPages(it) {
    return it.pages ? it.pages + (it.pages === 1 ? ' page' : ' pages') : '';
  }

  /* 📄 Worksheets: only the worksheets, one per row, with Download and Print
     (and Open, to look at it on the screen). This lesson and the ones out
     ahead first, then the earlier ones, the latest first. */
  function worksheetsTabHtml(course, many) {
    var items = Core.timelineItems(course, state.docs, state.recordings);
    var groups = Core.worksheetRows(course, items);
    var locked = Core.lockedCount(course);
    var html = '<section class="card st-card" aria-label="Worksheets · ' + h(Core.courseTitle(course)) + '">' + stClassHead(course, many);
    if (!items.length) {
      html += stEmpty('📄', 'No worksheets yet', 'Your worksheets appear here as soon as your class starts. Nothing to do.');
      return html + '</section>';
    }
    if (groups.now.length) {
      html += '<h2 class="st-group">' + (Core.currentIndex(course) >= 0 ? 'This lesson and the next ones' : 'Ready for your class') + '</h2>' +
        '<ol class="st-rows">' + groups.now.map(worksheetRowHtml).join('') + '</ol>';
    }
    if (groups.earlier.length) {
      html += '<h2 class="st-group">Earlier worksheets</h2>' +
        '<ol class="st-rows">' + groups.earlier.map(worksheetRowHtml).join('') + '</ol>';
    }
    if (locked > 0) {
      html += '<p class="st-foot">🔒 ' + locked + ' more worksheet' + (locked === 1 ? '' : 's') + ' will appear here later in the term.</p>';
    }
    return html + '</section>';
  }
  function worksheetRowHtml(it) {
    var tag = it.when === 'current' ? '<span class="st-tag st-tag-now">This lesson</span>'
      : it.when === 'next' ? '<span class="st-tag st-tag-next">Next lesson</span>'
      : it.when === 'ahead' ? '<span class="st-tag">Coming up</span>'
      : '';
    var sub = ['Worksheet ' + (it.seq + 1)];
    if (stPages(it)) sub.push(stPages(it));
    return '<li class="st-row' + (it.when === 'current' ? ' is-now' : it.when === 'next' ? ' is-next' : '') + (it.when === 'done' ? ' is-done' : '') + '">' +
      '<span class="st-num" aria-hidden="true">' + (it.seq + 1) + '</span>' +
      '<div class="st-main"><div class="st-name">' + h(it.name) + '</div>' +
        '<div class="st-sub">' + tag + '<span>' + h(sub.join(' · ')) + '</span></div></div>' +
      '<div class="st-acts">' +
        '<button class="btn st-btn st-btn-main" type="button" data-action="download" data-id="' + h(it.id) + '" aria-label="Download ' + h(it.name) + '"><span aria-hidden="true">⬇</span> Download</button>' +
        '<button class="btn st-btn" type="button" data-action="print" data-id="' + h(it.id) + '" aria-label="Print ' + h(it.name) + '"><span aria-hidden="true">🖨</span> Print</button>' +
        '<button class="btn st-btn st-btn-quiet" type="button" data-action="view" data-id="' + h(it.id) + '" aria-label="Open ' + h(it.name) + '"><span aria-hidden="true">👁</span> Open</button>' +
      '</div></li>';
  }

  /* 🔑 Answer keys: one row per worksheet with its newest answer key PDF.
     Earlier class days' keys sit under it as small links. */
  function answersTabHtml(course, many) {
    var items = Core.timelineItems(course, state.docs, state.recordings);
    var rows = Core.answerKeyRows(course, items);
    var html = '<section class="card st-card" aria-label="Answer keys · ' + h(Core.courseTitle(course)) + '">' + stClassHead(course, many);
    if (!rows.length) {
      html += stEmpty('🔑', 'No answer keys yet', 'Each answer key appears here after its lesson.');
      return html + '</section>';
    }
    html += '<ol class="st-rows">' + rows.map(function (row) {
      var k = row.latest;
      var sub = k ? 'After the ' + k.label + ' lesson' + (k.pages ? ' · ' + k.pages + (k.pages === 1 ? ' page' : ' pages') : '') : 'Appears here after the lesson';
      var earlier = row.earlier.length
        ? '<div class="st-more"><span>Earlier:</span>' + row.earlier.map(function (e) {
            return '<a href="' + h(e.url) + '" target="_blank" rel="noopener" data-tooltip="The answer key after the ' + h(e.label) + ' lesson">' + h(e.label) + '</a>';
          }).join('') + '</div>'
        : '';
      return '<li class="st-row' + (row.current ? ' is-now' : '') + '">' +
        '<span class="st-num" aria-hidden="true">' + (row.seq + 1) + '</span>' +
        '<div class="st-main"><div class="st-name">' + h(row.name) + '</div>' +
          '<div class="st-sub">' + (row.current ? '<span class="st-tag st-tag-now">This lesson</span>' : '') + '<span>' + h(sub) + '</span></div>' + earlier + '</div>' +
        '<div class="st-acts">' +
          (k ? '<a class="btn st-btn st-btn-main" href="' + h(k.url) + '" target="_blank" rel="noopener" aria-label="Open the answer key for ' + h(row.name) + '"><span aria-hidden="true">🔑</span> Open answer key</a>'
             : '') +
        '</div></li>';
    }).join('') + '</ol>';
    return html + '</section>';
  }

  /* ▶ Videos: one row per worksheet with recorded lessons. Watch plays every
     lesson on it in order on the video page (watch.html), never Ans Key;
     the class-day links start from that day. */
  function videosTabHtml(course, many) {
    var items = Core.timelineItems(course, state.docs, state.recordings);
    var rows = Core.videoRows(course, items);
    var html = '<section class="card st-card" aria-label="Videos · ' + h(Core.courseTitle(course)) + '">' + stClassHead(course, many);
    if (!rows.length) {
      html += stEmpty('▶', 'No lesson videos yet', 'The videos of each lesson appear here after the class.');
      return html + '</section>';
    }
    html += '<ol class="st-rows">' + rows.map(function (row) {
      var sub = row.count + (row.count === 1 ? ' video' : ' videos') + (row.seconds ? ' · ' + Core.formatDuration(row.seconds) : '');
      var days = row.days.length > 1
        ? '<div class="st-more"><span>Start from:</span>' + row.days.map(function (d) {
            return '<a href="' + h(watchHref(row.id, course, d.key)) + '" data-tooltip="Play from the ' + h(d.label) + ' lesson">' + h(d.label) + '</a>';
          }).join('') + '</div>'
        : '';
      return '<li class="st-row' + (row.current ? ' is-now' : '') + '">' +
        '<span class="st-num" aria-hidden="true">' + (row.seq + 1) + '</span>' +
        '<div class="st-main"><div class="st-name">' + h(row.name) + '</div>' +
          '<div class="st-sub">' + (row.current ? '<span class="st-tag st-tag-now">This lesson</span>' : '') + '<span>' + h(sub) + '</span></div>' + days + '</div>' +
        '<div class="st-acts">' +
          '<a class="btn st-btn st-btn-play" href="' + h(watchHref(row.id, course)) + '" aria-label="Watch the videos of ' + h(row.name) + '"><span aria-hidden="true">▶</span> Watch</a>' +
        '</div></li>';
    }).join('') + '</ol>';
    return html + '</section>';
  }
  function classCardHtml(course) {
    var ids = Core.courseIds(course);
    var total = ids.length;
    var cur = Core.currentIndex(course);
    var released = Core.releasedWorksheets(course);
    var next = Core.nextWorksheets(course);
    var locked = Core.lockedCount(course);
    var pct = Core.percent(cur + 1, total);
    var circumference = 2 * Math.PI * 30;
    var summary = cur >= 0
      ? 'Class is on worksheet ' + (cur + 1) + ' of ' + total + ' · ' + released.length + ' released'
      : released.length ? released.length + ' worksheet' + (released.length === 1 ? '' : 's') + ' ready before the first lesson' : 'Worksheets are released as lessons begin';
    var html = '<article class="card class-card" aria-label="' + h(Core.courseTitle(course)) + '">' +
      '<div class="class-top">' +
        '<div class="ring" role="img" aria-label="' + pct + '% through the class list">' +
          '<svg viewBox="0 0 74 74"><circle class="track" cx="37" cy="37" r="30" fill="none" stroke-width="7"/>' +
          '<circle class="bar" cx="37" cy="37" r="30" fill="none" stroke-width="7" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + (circumference * (1 - pct / 100)).toFixed(1) + '"/></svg>' +
          '<div class="label"><div><b>' + (cur >= 0 ? cur + 1 : 0) + '</b><br><span>of ' + total + '</span></div></div>' +
        '</div>' +
        '<div><div class="class-title">' + h(Core.courseTitle(course)) + '</div>' +
          '<div class="class-meta">' + levelChip(course.level) + subjectChip(course.subject) + dayChip(course) + '</div>' +
          '<div class="class-summary">' + h(summary) + '</div></div>' +
        '<div class="class-cta">' + (function () {
          // 📄 The newest answer key PDF Ans Key filed for this lesson's worksheet.
          // 🗄 v1.13.0: never from an archived worksheet or an archived class day.
          var k = cur >= 0 && !Core.isArchived(course, ids[cur]) ? Core.visibleAnswerKeys(course, ids[cur], state.docs[ids[cur]])[0] : null;
          return k ? '<a class="btn btn-sm" href="' + h(k.url) + '" target="_blank" rel="noopener" data-tooltip="The answer key after the ' + h(k.label) + ' lesson, as a PDF">This lesson\'s answer key</a>' : '';
        })() + '</div>' +
      '</div>';
    if (next.length) {
      html += '<section class="up-next" aria-label="The next two worksheets">' +
        '<div class="up-next-head"><span class="eyebrow">Up next · the next ' + (next.length === 2 ? 'two worksheets' : 'worksheet') + '</span></div>' +
        '<div class="up-next-grid">';
      next.forEach(function (n, k) {
        html += '<div class="next-tile">' +
          '<div class="when">' + (k === 0 ? 'Next lesson' : 'The lesson after') + ' · Worksheet ' + (n.seq + 1) + '</div>' +
          '<div class="name">' + h(docName(n.id)) + '</div>' +
          (pagesLabel(n.id) ? '<div class="sub">' + h(pagesLabel(n.id)) + '</div>' : '') +
          '<div class="row">' +
            '<button class="btn btn-primary btn-sm" type="button" data-action="download" data-id="' + h(n.id) + '">Download</button>' +
            '<button class="btn btn-sm" type="button" data-action="print" data-id="' + h(n.id) + '">Print</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="view" data-id="' + h(n.id) + '">View</button>' +
          '</div></div>';
      });
      html += '</div></section>';
    }
    if (released.length) {
      html += timelineHtml(course);
    } else {
      html += '<div class="empty" style="border-top:1px solid var(--border-subtle)"><p>No worksheets have been released yet. They appear here as your lessons begin.</p></div>';
    }
    if (locked > 0) {
      html += '<div class="locked-row"><div class="lock-icon" aria-hidden="true">🔒</div><div><b style="color:var(--text-secondary)">' + locked + ' more worksheet' + (locked === 1 ? '' : 's') + '</b> unlock as the class goes. Nothing to do, they appear here on their own.</div></div>';
    }
    return html + '</article>';
  }
  /* ---- The timeline: every released worksheet, top to bottom ----
     Worksheet 1 at the top, the one the class is on highlighted, and the
     ones released ahead of it after. Each shows when the teacher last
     changed it in Ans Key, its recorded lessons, and the worksheet and its
     answer key to view or print. */
  function timelineHtml(course) {
    var items = Core.timelineItems(course, state.docs, state.recordings);
    // 🗄 v1.13.0: an admin previewing the student view archives from here.
    var admin = state.isAdmin && !!state.preview;
    var html = '<section class="timeline" aria-label="Worksheets, in the order they are taught">' +
      '<div class="tl-head"><span class="eyebrow">Worksheet timeline</span><span class="tl-legend"><span class="dot dot-current"></span>Current worksheet<span class="dot dot-done"></span>Done<span class="dot dot-ahead"></span>Released ahead</span></div>' +
      '<ol class="tl-list">';
    items.forEach(function (it) {
      var cls = it.state === 'current' ? 'is-current' : it.state === 'next' ? 'is-next' : (Core.currentIndex(course) > it.seq ? 'is-done' : 'is-ahead');
      var tag = it.state === 'current' ? '<span class="tl-tag tag-current">Current worksheet</span>'
        : it.state === 'next' ? '<span class="tl-tag tag-next">Up next</span>'
        : cls === 'is-done' ? '<span class="tl-tag tag-done">Done</span>' : '<span class="tl-tag tag-ahead">Released</span>';
      var when = it.edited
        ? '<span class="tl-when-label">' + (it.marked ? 'Edited' : 'Uploaded') + '</span> <time datetime="' + new Date(it.edited).toISOString() + '" title="' + (it.marked ? 'Last edited in Ans Key' : 'Not written on in Ans Key yet') + '">' + h(Core.formatDay(it.edited)) + '<span class="tl-clock"> · ' + h(Core.formatClock(it.edited)) + '</span></time>'
        : (it.loading ? '<span class="tl-muted">…</span>' : '<span class="tl-muted">Not edited yet</span>');
      var recs = it.recordings;
      var page = Core.videoPlaylistCurrent(it.playlist, recs) ? it.playlist : null;
      // 🎬 v1.11.0: the lesson videos open on a page of their own (watch.html),
      // a media player with every lesson on the worksheet one after another,
      // oldest first, and the questions and pages marked on its timeline —
      // never the Ans Key app.
      var videoCount = recs.length;
      var videoBtn = videoCount
        ? '<a class="btn btn-sm btn-video" href="' + h(watchHref(it.id, course)) + '" data-action="video" data-id="' + h(it.id) + '" data-tooltip="Every lesson on this worksheet, one after another, with each question marked">▶ ' + (videoCount === 1 ? 'Video' : videoCount + ' videos') + '</a>'
        : '';
      // 📅 Every class day, newest first: that day's lesson videos beside the
      // answer key exactly as it stood after that lesson (a PDF Ans Key filed
      // with the video QR code on it). The newest three show; older days fold.
      var dayRow = function (d, i) {
        var v = d.video, k = d.answerKey;
        return '<li class="tl-cday' + (i === 0 ? ' is-latest' : '') + '">' +
          '<span class="tl-cday-date"><b>' + h(d.label) + '</b>' + (i === 0 ? '<span class="tl-cday-new">Latest</span>' : '') + '</span>' +
          '<span class="tl-cday-acts">' +
            (v ? '<a class="tl-day" href="' + h(watchHref(it.id, course, d.key)) + '" data-action="video-day" data-id="' + h(it.id) + '" data-day="' + h(d.key) + '" data-tooltip="Play from the ' + h(d.label) + ' lesson">' +
                '<span class="tl-day-play" aria-hidden="true">▶</span><span><b>' + (v.count === 1 ? 'Video' : v.count + ' videos') + '</b>' +
                (v.seconds ? '<small>' + h(Core.formatDuration(v.seconds)) + '</small>' : '') + '</span></a>'
              : '<span class="tl-cday-none">No video</span>') +
            (k ? '<a class="tl-key" href="' + h(k.url) + '" target="_blank" rel="noopener" data-tooltip="The answer key after the ' + h(d.label) + ' lesson, with the QR code to its videos">' +
                '<span class="tl-key-icon" aria-hidden="true">📄</span><span><b>Answer key</b><small>PDF' + (k.pages ? ' · ' + k.pages + (k.pages === 1 ? ' page' : ' pages') : '') + '</small></span></a>'
              : '<span class="tl-cday-none">Answer key after the lesson</span>') +
            (admin ? archiveButtonHtml(course, 'day', it.id, d.key, true, 'Hide the ' + d.label + ' videos and answer key of ' + it.name + ' from students. Nothing is deleted.') : '') +
          '</span></li>';
      };
      var cdays = it.classDays || [];
      var daysRow = cdays.length
        ? '<div class="tl-cdays" role="group" aria-label="Lesson videos and answer keys by the day of the class">' +
            '<span class="tl-group-label">By class day</span>' +
            '<ol class="tl-cday-list">' + cdays.slice(0, 3).map(dayRow).join('') + '</ol>' +
            (cdays.length > 3
              ? '<details class="tl-cday-more"><summary>' + (cdays.length - 3) + ' earlier ' + (cdays.length - 3 === 1 ? 'day' : 'days') + '</summary>' +
                  '<ol class="tl-cday-list">' + cdays.slice(3).map(function (d, j) { return dayRow(d, j + 3); }).join('') + '</ol></details>'
              : '') +
          '</div>'
        : '';
      // The answer key button opens the newest filed PDF — never the Ans Key app.
      var latestKey = (it.answerKeys || [])[0] || null;
      var keyGroup = latestKey
        ? '<span class="tl-group"><span class="tl-group-label">Answer key</span>' +
            '<a class="btn btn-sm btn-primary" href="' + h(latestKey.url) + '" target="_blank" rel="noopener" data-tooltip="The newest answer key (' + h(latestKey.label) + '), as a PDF with the QR code to every video">View · ' + h(latestKey.label) + '</a></span>'
        : '<span class="tl-group"><span class="tl-group-label">Answer key</span><span class="tl-muted tl-key-wait">Appears after the lesson</span></span>';
      html += '<li class="tl-item ' + cls + '"' + (it.state === 'current' ? ' aria-current="step"' : '') + '>' +
        '<div class="tl-rail" aria-hidden="true"><span class="tl-node">' + (it.seq + 1) + '</span></div>' +
        '<div class="tl-card">' +
          '<div class="tl-date">' + when + '</div>' +
          '<div class="tl-title-row"><div class="tl-name">' + h(it.name) + '</div>' + tag + '</div>' +
          '<div class="tl-sub"><span>Worksheet ' + (it.seq + 1) + '</span>' + (it.pages ? '<span>· ' + it.pages + (it.pages === 1 ? ' page' : ' pages') + '</span>' : '') +
            (recs.length ? '<span>· ' + recs.length + ' recorded lesson' + (recs.length === 1 ? '' : 's') + (recs[0].duration ? ' (' + h(Core.formatDuration(recs[0].duration)) + ')' : '') + '</span>' : '') +
            (page && page.at ? '<span>· videos updated ' + h(Core.formatDay(page.at)) + '</span>' : '') + '</div>' +
          daysRow +
          '<div class="tl-actions">' +
            videoBtn +
            '<span class="tl-group"><span class="tl-group-label">Worksheet</span>' +
              '<button class="btn btn-sm btn-ghost" type="button" data-action="view" data-id="' + h(it.id) + '">View</button>' +
              '<button class="btn btn-sm btn-ghost" type="button" data-action="print" data-id="' + h(it.id) + '">Print</button></span>' +
            keyGroup +
            (admin ? archiveButtonHtml(course, 'worksheet', it.id, '', true, 'Hide ' + it.name + ' from students, with its answer keys and videos. Nothing is deleted and the class stays where it is.') : '') +
          '</div>' +
        '</div></li>';
    });
    html += '</ol>';
    if (admin) html += archivedListHtml(course, true);
    return html + '</section>';
  }

  /* ---- 🗄 Archive for students (v1.13.0) ----
     An admin can take a worksheet, or one class day of it (that day's lesson
     videos and answer key), out of what students see, and bring it back with
     one tap. Nothing is deleted: the worksheet keeps its place and number,
     the class keeps its position and its release, and Ans Key is unchanged
     for the teacher. The rules are in portal-core.js (`archiveUpdate`,
     `releasedWorksheets`, `timelineItems`). */
  function archiveButtonHtml(course, kind, id, day, archive, tip) {
    var label = archive ? (kind === 'day' ? '🗄 Archive day' : '🗄 Archive') : '↩ Restore';
    return '<button class="btn btn-xs ' + (archive ? 'btn-archive' : 'btn-restore') + '" type="button" data-action="' + (archive ? 'archive-item' : 'restore-item') + '"' +
      ' data-course="' + h(course.id) + '" data-kind="' + kind + '" data-id="' + h(id) + '"' + (day ? ' data-day="' + h(day) + '"' : '') +
      ' data-tooltip="' + h(tip || '') + '" aria-label="' + h((archive ? 'Archive ' : 'Restore ') + (kind === 'day' ? 'class day ' + day : 'worksheet')) + '">' + label + '</button>';
  }
  // The admin's Archived list for one class: everything hidden from
  // students, each with Restore. `folded` keeps it in a fold (the timeline).
  function archivedListHtml(course, folded) {
    var a = Core.archivedItems(course, state.docs);
    if (!a.count) {
      return folded ? '' : '<div class="card empty archived-empty"><p>Nothing archived in this class. Use 🗄 Archive on a worksheet here, or on a worksheet or class day in 👁 Preview as a student (Timeline tab), to hide it from students without deleting it.</p></div>';
    }
    var rows = a.worksheets.map(function (w) {
      return '<li class="arch-row"><span class="arch-kind">Worksheet</span>' +
        '<span class="arch-main"><b>' + h(w.name) + '</b><small>' + (w.inClass ? 'Worksheet ' + (w.seq + 1) + (w.released ? ' · released, hidden from students' : ' · not released yet') : 'No longer in this class list') + '</small></span>' +
        archiveButtonHtml(course, 'worksheet', w.id, '', false, 'Show ' + w.name + ' to students again') + '</li>';
    }).concat(a.days.map(function (d) {
      return '<li class="arch-row"><span class="arch-kind">Class day</span>' +
        '<span class="arch-main"><b>' + h(d.label) + ' · ' + h(d.name) + '</b><small>That day\'s lesson videos and answer key' + (d.inClass ? ' · worksheet ' + (d.seq + 1) : ' · no longer in this class list') + (d.worksheetArchived ? ' · the whole worksheet is archived too' : '') + '</small></span>' +
        archiveButtonHtml(course, 'day', d.id, d.key, false, 'Show the ' + d.label + ' videos and answer key to students again') + '</li>';
    }));
    var list = '<ol class="arch-list">' + rows.join('') + '</ol>';
    if (folded) {
      return '<details class="arch-fold"><summary>🗄 Archived · ' + a.count + ' hidden from students <span class="muted">(only you see this)</span></summary>' + list + '</details>';
    }
    return '<div class="card arch-card">' + list + '</div>';
  }
  async function setArchived(button, archive) {
    var courseId = button.dataset.course, kind = button.dataset.kind, id = button.dataset.id, day = button.dataset.day || '';
    if (!state.isAdmin || !courseId || !state.courses[courseId]) return;
    busy(button, true);
    try {
      var ref = db.collection(COURSES).doc(courseId);
      // A transaction with the live class, so two devices archiving at once
      // both land, and a list another admin just changed is not overwritten.
      var done = await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        if (!snap.exists) return null;
        var live = Object.assign({ id: courseId }, snap.data());
        var update = Core.archiveUpdate(live, kind, id, day, archive);
        if (!update) return 'same';
        var data = { archivedAt: FieldValue.serverTimestamp(), archivedBy: state.user.email };
        data[update.field] = update.value;
        tx.set(ref, data, { merge: true });
        return update;
      });
      busy(button, false);
      if (!done) { toast('That class no longer exists.', { error: true }); return; }
      var what = kind === 'day' ? 'The ' + Core.formatDay(new Date(day + 'T12:00:00').getTime()) + ' videos and answer key' : '“' + docName(id) + '”';
      if (done === 'same') toast(what + (archive ? ' was already archived.' : ' is already showing.'));
      else toast(archive ? what + ' archived. Students no longer see ' + (kind === 'day' ? 'them' : 'it') + '. Restore it any time from Archived.'
        : what + ' restored. Students see ' + (kind === 'day' ? 'them' : 'it') + ' again.');
    } catch (err) { busy(button, false); fail(archive ? 'Could not archive it' : 'Could not restore it', err); }
  }

  /* ---- Ans Key inside the portal ----
     The answer key and the lesson replays are Ans Key's own (the writing
     follows the voice), so they open in a window over the portal. Same site,
     same sign-in: nothing to log into twice. */
  function openAnskey(id, action, rec, title) {
    var url = Core.anskeyLink(ANSKEY_URL, id, action, rec);
    var heading = (action === 'play' ? 'Lesson video' : action === 'print-answers' ? 'Printing the answer key' : 'Answer key') + ' · ' + docName(id);
    var hint = action === 'play' ? 'The writing follows the teacher\'s voice. Tap a question chip to jump there.'
      : action === 'print-answers' ? 'The print window opens by itself once the answers are ready.'
      : 'Pinch or scroll to zoom. Use Print answer key on the timeline for a paper copy.';
    openModal(function () {
      return '<div class="modal-head anskey-head"><div><h2>' + h(title || heading) + '</h2><p class="muted" style="margin-top:4px;font-size:var(--font-size-sm)">' + h(hint) + '</p></div>' +
        '<div class="row"><a class="btn btn-sm btn-ghost" href="' + h(url) + '" target="_blank" rel="noopener">Open in a new tab</a>' +
        '<button class="btn btn-sm" type="button" data-modal-close aria-label="Close">Close</button></div></div>' +
        '<div class="anskey-frame-wrap"><div class="anskey-loading"><div class="spinner" aria-hidden="true"></div><div>Opening Ans Key…</div></div>' +
        '<iframe class="anskey-frame" title="' + h(heading) + '" src="' + h(url) + '" allow="autoplay; fullscreen; clipboard-write" allowfullscreen></iframe></div>';
    }, null, function () {
      var backs = document.querySelectorAll('.modal-back');
      if (backs.length) backs[backs.length - 1].classList.add('modal-wide');
      var frame = document.querySelector('.anskey-frame');
      if (frame) frame.addEventListener('load', function () { var l = document.querySelector('.anskey-loading'); if (l) l.remove(); });
    });
  }
  /* ---- 🎬 The lesson videos: a page of their own (v1.11.0) ----
     watch.html plays every lesson recorded on the worksheet, oldest first,
     one after another, with the question and page marks on its timeline.
     `day` starts it at that class day's first lesson. Plain links, so a
     long press or a middle click opens them in a new tab too. */
  function watchHref(id, course, day) {
    return Core.watchLink(id, { day: day, course: course && course.id });
  }

  function afterStudentRender(member) {
    var ids = [];
    Core.coursesForMember(state.courses, member).forEach(function (c) {
      Core.releasedWorksheets(c).forEach(function (w) { ids.push(w.id); });
    });
    watchDocs(ids);
    // 🗄 The admin's Archived fold names its worksheets.
    if (state.isAdmin) {
      var archivedIds = [];
      Core.coursesForMember(state.courses, member).forEach(function (c) {
        Core.archivedItems(c, {}).worksheets.forEach(function (w) { archivedIds.push(w.id); });
        Core.archivedDayList(c).forEach(function (d) { archivedIds.push(d.id); });
      });
      if (archivedIds.length) ensureDocs(archivedIds);
    }
    // The current worksheet is brought into view once, on arrival — on the
    // Timeline tab only; the other tabs open at the top, where the rows start.
    if (!scrolledToCurrent && state.studentTab === 'timeline') {
      var cur = document.querySelector('.tl-item.is-current');
      if (cur && cur.scrollIntoView) { scrolledToCurrent = true; setTimeout(function () { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350); }
    }
  }
  var scrolledToCurrent = false;
  function previewBarHtml() {
    var p = state.preview;
    var levels = Core.LEVELS.map(function (l) { return '<option' + (l === p.level ? ' selected' : '') + '>' + l + '</option>'; }).join('');
    var subjects = Core.levelSubjects(p.level).map(function (s) {
      return '<button type="button" class="choice" data-action="preview-subject" data-subject="' + s + '" aria-pressed="' + (p.subjects.indexOf(s) >= 0) + '">' + h(Core.subjectLabel(s, true)) + '</button>';
    }).join('');
    return '<div class="preview-bar"><b>👁 Preview</b><span>Showing exactly what a student with this level and subjects sees.</span>' +
      '<select id="previewLevel" class="btn btn-sm" aria-label="Level">' + levels + '</select><div class="choice-row">' + subjects + '</div><span class="spacer"></span>' +
      '<button type="button" class="btn btn-sm" data-action="preview-exit">Back to admin</button></div>';
  }

  /* ---- The admin view ---- */
  function adminHtml() {
    if (state.courseId && state.courses[state.courseId]) return courseDetailHtml(state.courses[state.courseId]);
    var pending = state.invites.filter(function (i) { return i.status !== 'joined' && i.status !== 'revoked'; }).length;
    var tabs = [['overview', 'Overview', ''], ['classes', 'Classes', courseList().length], ['people', 'Students & parents', state.members.length + (pending ? ' · ' + pending + ' invited' : '')]];
    var html = '<div class="reveal"><section class="welcome"><div><div class="eyebrow">Admin</div>' +
      '<h1 class="page-title" style="margin-top:8px">Polymath Online</h1>' +
      '<p class="page-subtitle">Upload each class\'s worksheets once. The Ans Key app releases them as you teach.</p></div>' +
      '<div class="row"><button class="btn" type="button" data-action="preview-start">👁 Preview student view</button></div></section>' +
      '<nav class="tabs" role="tablist" aria-label="Admin sections">' +
      tabs.map(function (t) {
        return '<button class="tab" role="tab" type="button" data-action="tab" data-tab="' + t[0] + '" aria-selected="' + (state.adminTab === t[0]) + '">' + t[1] + (t[2] !== '' ? '<span class="count">' + h(t[2]) + '</span>' : '') + '</button>';
      }).join('') + '</nav></div>';
    if (state.adminTab === 'classes') html += classesTabHtml();
    else if (state.adminTab === 'people') html += peopleTabHtml();
    else html += overviewHtml();
    return html;
  }
  function overviewHtml() {
    var courses = courseList();
    var worksheets = courses.reduce(function (n, c) { return n + Core.courseIds(c).length; }, 0);
    var released = courses.reduce(function (n, c) { return n + Core.releasedCount(c); }, 0);
    var students = state.members.filter(function (m) { return !m.revoked && m.role !== 'parent'; }).length;
    var parents = state.members.filter(function (m) { return !m.revoked && m.role === 'parent'; }).length;
    var pending = state.invites.filter(function (i) { return i.status !== 'joined' && i.status !== 'revoked'; }).length;
    var html = '<div class="section reveal"><div class="stats">' +
      statHtml(courses.length, 'Classes') +
      statHtml(released + ' / ' + worksheets, 'Worksheets released') +
      statHtml(students + parents, students + ' students · ' + parents + ' parents') +
      statHtml(pending, 'Invitations waiting') +
      '</div></div>';
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Where each class is</h2>' +
      '<div class="section-note">Opening a class worksheet in Ans Key moves its class along and releases up to ' + Core.RELEASE_AHEAD + ' worksheets ahead.</div></div>' +
      '<button class="btn btn-primary" type="button" data-action="new-course">+ New class</button></div>';
    html += courses.length ? '<div class="grid-3 reveal">' + courses.map(courseTileHtml).join('') + '</div>' : emptyClassesHtml();
    return html + '</div>';
  }
  function statHtml(value, label) { return '<div class="card stat"><div class="value">' + h(value) + '</div><div class="label">' + h(label) + '</div></div>'; }
  function emptyClassesHtml() {
    return '<div class="card empty"><div class="big">🗂</div><h3>No classes yet</h3><p>Create a class, then upload its whole list of worksheets in teaching order.</p>' +
      '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn btn-primary" type="button" data-action="new-course">+ New class</button></div></div>';
  }
  function courseTileHtml(course) {
    var total = Core.courseIds(course).length, cur = Core.currentIndex(course), rel = Core.releasedCount(course);
    return '<button class="card course-tile" type="button" data-action="open-course" data-id="' + h(course.id) + '">' +
      '<div class="row">' + levelChip(course.level) + subjectChip(course.subject) + (course.archived ? '<span class="chip">Archived</span>' : '') + '</div>' +
      '<div class="title">' + h(Core.courseTitle(course)) + '</div>' +
      '<div class="progress" aria-hidden="true"><div class="released" style="width:' + Core.percent(rel, total) + '%"></div><div class="done" style="width:' + Core.percent(cur + 1, total) + '%"></div></div>' +
      '<div class="small muted">' + (total ? (cur >= 0 ? 'On worksheet ' + (cur + 1) + ' of ' + total : 'Not started · ' + total + ' worksheets') + ' · ' + rel + ' released' : 'No worksheets yet') + '</div>' +
      (total ? '<div class="small muted tile-next">' + h(nextInAnsKeyText(course)) + '</div>' : '') +
      '</button>';
  }
  // 📌 What Ans Key has loaded for this class right now, in one line.
  function nextInAnsKeyText(course) {
    var at = Core.ansKeyAt(course), total = Core.courseIds(course).length;
    if (at < 0) return '';
    return 'In Ans Key: current ' + (at + 1) + (at + 1 < total ? ' · next ' + (at + 2) : ' · the last one');
  }
  function classesTabHtml() {
    var courses = courseList();
    var html = '<div class="section"><div class="section-head"><div><h2 class="section-heading">Classes</h2>' +
      '<div class="section-note">One class list per level, subject and lesson slot, in teaching order.</div></div>' +
      '<button class="btn btn-primary" type="button" data-action="new-course">+ New class</button></div>';
    if (!courses.length) return html + emptyClassesHtml() + '</div>';
    html += '<div class="legend" style="margin-bottom:12px"><span><i style="background:var(--accent-dark)"></i>Taught</span><span><i style="background:var(--accent-light)"></i>Released to students</span><span><i style="background:var(--bg-tertiary)"></i>Waiting</span></div>';
    html += '<div class="grid-3 reveal">' + courses.map(courseTileHtml).join('') + '</div>';
    return html + '</div>';
  }

  /* ---- One class ---- */
  function courseDetailHtml(course) {
    var ids = Core.courseIds(course);
    var total = ids.length, cur = Core.currentIndex(course), rel = Core.releasedThrough(course);
    var html = '<div class="reveal">' +
      '<button class="back-link" type="button" data-action="close-course">← All classes</button>' +
      '<div class="course-head"><div><div class="row">' + levelChip(course.level) + subjectChip(course.subject) + dayChip(course) + '</div>' +
        '<h1 class="page-title" style="margin-top:10px">' + h(Core.courseTitle(course)) + '</h1>' +
        '<p class="page-subtitle">' + total + ' worksheet' + (total === 1 ? '' : 's') + ' in teaching order. Ans Key shows the current worksheet and loads the next one by itself; the rest wait their turn here.</p></div>' +
        '<div class="row"><button class="btn btn-sm" type="button" data-action="edit-course">Edit class</button>' +
        '<button class="btn btn-sm" type="button" data-action="duplicate-course" data-tooltip="A copy with the same level, subject and worksheets, ready for another time slot">Duplicate class</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-action="delete-course">Delete class</button></div></div>' +
      '<div class="control-strip">' +
        '<div class="card control"><div class="label">Class is on</div><div class="big">' + (cur >= 0 ? 'Worksheet ' + (cur + 1) : 'Not started') + '</div>' +
          '<div class="stepper"><button class="btn btn-xs" type="button" data-action="step" data-target="currentInput" data-delta="-1" aria-label="Earlier">−</button>' +
          '<input id="currentInput" type="number" min="1" max="' + Math.max(1, total) + '" value="' + Math.max(1, cur + 1) + '" aria-label="Worksheet the class is on">' +
          '<button class="btn btn-xs" type="button" data-action="step" data-target="currentInput" data-delta="1" aria-label="Later">+</button>' +
          '<button class="btn btn-xs btn-primary" type="button" data-action="set-current"' + (total ? '' : ' disabled') + '>Set</button></div>' +
          '<div class="small muted" style="margin-top:8px">Releases up to ' + Core.RELEASE_AHEAD + ' ahead, as Ans Key does.</div>' +
          finishControlHtml(course) + '</div>' +
        '<div class="card control"><div class="label">Released to students</div><div class="big">' + (rel >= 0 ? 'Up to ' + (rel + 1) : 'None yet') + '</div>' +
          '<div class="stepper"><button class="btn btn-xs" type="button" data-action="step" data-target="releaseInput" data-delta="-1" aria-label="Fewer">−</button>' +
          '<input id="releaseInput" type="number" min="0" max="' + total + '" value="' + (rel + 1) + '" aria-label="Release up to worksheet">' +
          '<button class="btn btn-xs" type="button" data-action="step" data-target="releaseInput" data-delta="1" aria-label="More">+</button>' +
          '<button class="btn btn-xs btn-primary" type="button" data-action="set-release"' + (total ? '' : ' disabled') + '>Set</button></div>' +
          '<div class="small muted" style="margin-top:8px">' + (cur >= 0 ? 'Always at least ' + Core.RELEASE_AHEAD + ' ahead of where the class is. Raise it to release more.' : '0 hides them all until the class starts.') + '</div></div>' +
        '<div class="card control"><div class="label">Students see</div><div class="big">' + Core.releasedWorksheets(course).length + ' <span class="small muted">of ' + total + '</span></div>' +
          '<div class="small muted" style="margin-top:10px">' + countSeeing(course) + '</div>' +
          (Core.archivedCount(course) ? '<div class="small muted" style="margin-top:6px">🗄 ' + Core.archivedCount(course) + ' archived item' + (Core.archivedCount(course) === 1 ? '' : 's') + ' hidden from students (see Archived below).</div>' : '') +
          '<button class="btn btn-xs" type="button" data-action="preview-course" style="margin-top:10px">👁 Preview as a student</button></div>' +
      '</div>';
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Add worksheets</h2>' +
      '<div class="section-note">Upload the full list once. Files are added in name order (Worksheet 2 before Worksheet 10), after any already here.</div></div>' +
      '<button class="btn btn-browse" type="button" data-action="browse-anskey" data-tooltip="Pick worksheets from the Ans Key app as previous or future worksheets, with their answer keys and videos">📂 Browse Ans Key app</button></div>' +
      '<label class="dropzone" id="dropzone" for="fileInput"><input id="fileInput" type="file" accept="application/pdf,.pdf" multiple class="visually-hidden">' +
        '<div style="font-size:1.6rem">📄</div><div style="margin-top:6px"><b>Drop PDFs here</b>, as many as you like, or click to choose files</div>' +
        '<div class="small muted" style="margin-top:4px">Select several at once with Shift or Ctrl (⌘ on a Mac). Each one becomes a worksheet in Ans Key, ready for you to write its answer key.</div>' +
        uploadsHtml() + '</label></div>';
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Teaching order</h2><div class="section-note">Rename in place, reorder with the arrows, or open one in Ans Key.</div></div></div>';
    if (!total) html += '<div class="card empty"><p>No worksheets in this class yet.</p></div>';
    else {
      html += '<div class="card seq-list">';
      ids.forEach(function (id, i) {
        var st = Core.worksheetState(course, i);
        var status = seqStatusHtml(course, i);
        var ak = Core.ansKeyState(course, i);
        var archived = Core.isArchived(course, id);
        var dayCount = Core.archivedDaysOf(course, id).length;
        html += '<div class="seq-row' + (st === 'current' ? ' is-current' : i <= rel ? ' is-released' : '') + (ak === 'current' ? ' ak-current' : ak === 'next' ? ' ak-next' : '') + (archived ? ' is-archived' : '') + '">' +
          '<div class="ws-num">' + (i + 1) + '</div>' +
          '<div><input class="name-edit" id="name-' + h(id) + '" type="text" value="' + h(docName(id)) + '" data-action-change="rename" data-id="' + h(id) + '" aria-label="Name of worksheet ' + (i + 1) + '">' +
            '<div class="ws-sub" style="padding-left:8px">' + (pagesLabel(id) ? h(pagesLabel(id)) : '') + '</div></div>' +
          '<div class="seq-status">' + status +
            (archived ? '<span class="chip chip-archived" data-tooltip="Hidden from students. Ans Key and the class position are unchanged.">🗄 Archived</span>' : '') +
            (!archived && dayCount ? '<span class="chip chip-archived" data-tooltip="Class days whose videos and answer key are hidden from students">🗄 ' + dayCount + ' day' + (dayCount === 1 ? '' : 's') + ' archived</span>' : '') + '</div>' +
          '<div class="seq-tools">' +
            '<button class="btn btn-xs" type="button" data-action="move" data-index="' + i + '" data-delta="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="btn btn-xs" type="button" data-action="move" data-index="' + i + '" data-delta="1" aria-label="Move down"' + (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
            '<a class="btn btn-xs" href="' + h(answerKeyUrl(id)) + '" target="_blank" rel="noopener" data-tooltip="Open in Ans Key">Ans Key</a>' +
            '<button class="btn btn-xs" type="button" data-action="view" data-id="' + h(id) + '" aria-label="View PDF">PDF</button>' +
            '<button class="btn btn-xs" type="button" data-action="replace-pdf" data-id="' + h(id) + '" aria-label="Replace the PDF of worksheet ' + (i + 1) + '" data-tooltip="Upload a corrected PDF. The answer key stays.">Replace</button>' +
            '<button class="btn btn-xs" type="button" data-action="link-anskey" data-id="' + h(id) + '" aria-label="Answer key and videos for worksheet ' + (i + 1) + ' from Ans Key" data-tooltip="Take the answer key and the video recordings from another worksheet in Ans Key">From Ans Key</button>' +
            archiveButtonHtml(course, 'worksheet', id, '', !archived, archived ? 'Show it to students again' : 'Hide it from students, with its answer keys and videos. Nothing is deleted and the class stays where it is.') +
            '<button class="btn btn-xs btn-danger" type="button" data-action="remove-ws" data-index="' + i + '" aria-label="Remove from class">✕</button>' +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    // 🗄 v1.13.0: everything archived in this class, each with Restore.
    var arch = Core.archivedItems(course, state.docs);
    html += '<div class="section" id="archivedSection"><div class="section-head"><div><h2 class="section-heading">🗄 Archived' + (arch.count ? ' <span class="count-pill">' + arch.count + '</span>' : '') + '</h2>' +
      '<div class="section-note">Hidden from students on every tab, the video page and Ans Key. Nothing is deleted, and the class position and releases are unchanged. Restore puts it back as it was.</div></div></div>' +
      archivedListHtml(course, false) + '</div>';
    return html + '</div>';
  }
  /* 📌 The labels in the teaching order say what Ans Key shows: the
     worksheet the class has yet to finish is the Current worksheet, the one
     after it is loaded into Ans Key as the Next worksheet, and the rest are
     queued here (released to students or still waiting). */
  function seqStatusHtml(course, i) {
    var ak = Core.ansKeyState(course, i);
    var rel = Core.releasedThrough(course);
    var started = Core.currentIndex(course) >= 0;
    if (ak === 'current') return '<span class="chip chip-current" data-tooltip="' + (started ? 'The class is on this one and has yet to finish it' : 'The first lesson starts here') + '">▶ Current worksheet</span>';
    if (ak === 'next') return '<span class="chip chip-next" data-tooltip="Loaded into Ans Key, ready for the next lesson">⏭ Next worksheet</span>';
    if (ak === 'done') return '<span class="chip chip-ok">✓ Done</span>';
    return i <= rel ? '<span class="chip chip-ok">Released · queued</span>' : '<span class="chip">Queued</span>';
  }
  // ✓ Finished: the same move as opening the Next worksheet in Ans Key.
  function finishControlHtml(course) {
    var total = Core.courseIds(course).length;
    if (!total) return '';
    var at = Core.ansKeyAt(course);
    if (at + 1 >= total) return '<div class="small muted finish-note">The class is on the last worksheet in its list.</div>';
    return '<button class="btn btn-xs btn-finish" type="button" data-action="finish-current" data-tooltip="Worksheet ' + (at + 2) + ' becomes current and worksheet ' + (at + 3 <= total ? at + 3 : at + 2) + ' loads into Ans Key as next">' +
      '✓ Worksheet ' + (at + 1) + ' finished · load the next</button>';
  }
  async function finishCurrent(button) {
    var course = state.courses[state.courseId];
    if (!course) return;
    var update = Core.finishUpdate(course);
    if (!update) { toast('The class is already on the last worksheet.'); return; }
    busy(button, true);
    try {
      // A transaction, so two devices pressing at once move the class one step, not two.
      var ref = db.collection(COURSES).doc(course.id);
      var moved = await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        if (!snap.exists) return null;
        var live = Object.assign({ id: course.id }, snap.data());
        if (Core.ansKeyAt(live) !== update.lastFinishedIndex) return null;
        var fresh = Core.finishUpdate(live);
        if (!fresh) return null;
        tx.set(ref, Object.assign({}, fresh, { progressAt: FieldValue.serverTimestamp(), finishedAt: FieldValue.serverTimestamp(), progressBy: state.user.email }), { merge: true });
        return fresh;
      });
      busy(button, false);
      if (!moved) { toast('The class had already moved on.'); return; }
      var total = Core.courseIds(course).length;
      toast('Worksheet ' + (moved.lastFinishedIndex + 1) + ' finished. Worksheet ' + (moved.currentIndex + 1) + ' is now current' +
        (moved.currentIndex + 1 < total ? ' and worksheet ' + (moved.currentIndex + 2) + ' is loaded into Ans Key as next.' : ', the last one.'));
    } catch (err) { busy(button, false); fail('Could not move the class on', err); }
  }
  function countSeeing(course) {
    var n = state.members.filter(function (m) { return !m.revoked && Core.memberSees(m, course); }).length;
    return n === 0 ? 'No joined students or parents match this class yet.' : n + ' joined student' + (n === 1 ? '' : 's') + ' and parents match this class.';
  }
  function uploadsHtml() {
    if (!state.uploads.length) return '';
    var sum = Core.uploadSummary(state.uploads);
    return '<div class="upload-list" aria-live="polite">' +
      '<div class="upload-total"><span><b>' + h(sum.label) + '</b></span><span class="muted small">' + sum.pct + '%</span>' +
        '<div class="progress"><div class="done" id="uploadTotalBar" style="width:' + sum.pct + '%"></div></div></div>' +
      state.uploads.map(function (u) {
        var cls = /^failed/.test(u.state) ? ' is-failed' : u.state === 'added' ? ' is-added' : '';
        return '<div class="upload-item' + cls + '"><span>' + h(u.name) + ' <span class="muted small">' + h(Core.uploadStateLabel(u.state)) + '</span></span>' +
          '<div class="progress"><div class="done" data-upload="' + u.key + '" style="width:' + u.pct + '%"></div></div></div>';
      }).join('') + '</div>';
  }
  // Progress moves often; only the bars change, never the whole page.
  function paintUploadBar(item) {
    var bar = document.querySelector('.upload-item .done[data-upload="' + item.key + '"]');
    if (bar) bar.style.width = item.pct + '%';
    var total = $('uploadTotalBar');
    if (total) total.style.width = Core.uploadSummary(state.uploads).pct + '%';
  }
  function afterAdminRender() {
    if (state.courseId && state.courses[state.courseId]) {
      ensureDocs(Core.courseIds(state.courses[state.courseId]));
      var input = $('fileInput'), zone = $('dropzone');
      if (input) input.addEventListener('change', function () {
        var chosen = Array.from(input.files || []);
        input.value = '';
        input.blur();
        startUpload(chosen);
      });
      if (zone) {
        ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); }); });
        ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); }); });
        zone.addEventListener('drop', function (e) { startUpload(Array.from((e.dataTransfer && e.dataTransfer.files) || [])); });
      }
    }
    // A class just created is not in the live list yet: state.courseId stays
    // set, and the class opens as soon as the list catches up.
    if (state.adminTab === 'people') wirePeopleForm();
  }

  /* ---- Students & parents ---- */
  var inviteDraft = { level: 'P5', subjects: ['math', 'science'], role: 'student' };
  function peopleTabHtml() {
    var d = inviteDraft;
    var allowed = Core.levelSubjects(d.level);
    var html = '<div class="section"><div class="card"><div class="section-head" style="margin-bottom:8px"><div><h2 class="section-heading">Invite a student or parent</h2>' +
      '<div class="section-note">They get an email with a link, and join with any Google account. Several emails at once are fine.</div></div></div>' +
      '<form id="inviteForm" class="form-grid" autocomplete="off" novalidate>' +
        '<div class="field span-2"><label for="inviteEmails">Email address(es)</label><textarea id="inviteEmails" rows="2" placeholder="parent@example.com, student@example.com"></textarea><span class="hint">Separate several with commas or new lines.</span></div>' +
        '<div class="field"><label for="inviteName">Name <span class="muted">(optional)</span></label><input id="inviteName" type="text" placeholder="e.g. Ethan Tan"><span class="hint">Used when inviting one person.</span></div>' +
        '<div class="field"><span class="label">They are a</span><div class="choice-row">' + Core.ROLES.map(function (r) {
          return '<button type="button" class="choice" data-action="draft-role" data-role="' + r.value + '" aria-pressed="' + (d.role === r.value) + '">' + r.label + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><span class="label">Level</span><div class="choice-row">' + Core.LEVELS.map(function (l) {
          return '<button type="button" class="choice" data-action="draft-level" data-level="' + l + '" aria-pressed="' + (d.level === l) + '">' + l + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><span class="label">Subjects</span><div class="choice-row">' + Core.SUBJECTS.map(function (s) {
          var ok = allowed.indexOf(s.value) >= 0;
          return '<button type="button" class="choice" data-action="draft-subject" data-subject="' + s.value + '" aria-pressed="' + (ok && d.subjects.indexOf(s.value) >= 0) + '"' + (ok ? '' : ' disabled title="P3 is Science only"') + '>' + s.short + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field span-2" style="align-items:flex-end"><button class="btn btn-primary" id="inviteSend" type="submit">Send invitation</button></div>' +
      '</form></div></div>';
    var pending = state.invites.filter(function (i) { return i.status !== 'joined'; });
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Invitations</h2><div class="section-note">Waiting for them to open the link and sign in.</div></div></div>';
    if (!pending.length) html += '<div class="card empty"><p>No invitations waiting.</p></div>';
    else {
      html += '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Invited</th><th>Level &amp; subjects</th><th>Status</th><th>Sent</th><th></th></tr></thead><tbody>';
      pending.forEach(function (inv) {
        var revoked = inv.status === 'revoked';
        html += '<tr><td><div class="person"><span class="avatar">' + h(Core.initials(inv.name, inv.email)) + '</span><div class="who"><b>' + h(inv.name || inv.email) + '</b><span>' + h(inv.name ? inv.email : '') + ' ' + (inv.role === 'parent' ? '· Parent' : '· Student') + '</span></div></div></td>' +
          '<td><div class="row">' + levelChip(inv.level) + (inv.subjects || []).map(subjectChip).join('') + '</div></td>' +
          '<td>' + (revoked ? '<span class="chip chip-danger">Revoked</span>' : inv.mailError ? '<span class="chip chip-warn" title="' + h(inv.mailError) + '">Email not sent</span>' : '<span class="chip chip-warn">Invited</span>') + '</td>' +
          '<td class="small muted">' + h(Core.timeAgo(ms(inv.lastSentAt || inv.createdAt))) + '</td>' +
          '<td class="actions">' +
            (revoked ? '' : '<button class="btn btn-xs" type="button" data-action="copy-link" data-id="' + h(inv.id) + '">Copy link</button> <button class="btn btn-xs" type="button" data-action="resend" data-id="' + h(inv.id) + '">Resend</button> ') +
            '<button class="btn btn-xs btn-danger" type="button" data-action="' + (revoked ? 'delete-invite' : 'revoke') + '" data-id="' + h(inv.id) + '">' + (revoked ? 'Delete' : 'Revoke') + '</button></td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    html += '</div>';
    var members = state.members;
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Joined</h2><div class="section-note">Each sees only the classes for their level and subjects.</div></div></div>';
    if (!members.length) html += '<div class="card empty"><p>Nobody has joined yet.</p></div>';
    else {
      html += '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Who</th><th>Level &amp; subjects</th><th>Classes</th><th>Last seen</th><th></th></tr></thead><tbody>';
      members.forEach(function (m) {
        var classes = Core.coursesForMember(state.courses, m).length;
        html += '<tr' + (m.revoked ? ' style="opacity:.55"' : '') + '><td><div class="person"><span class="avatar">' + (m.photoURL ? '<img src="' + h(m.photoURL) + '" alt="" referrerpolicy="no-referrer">' : h(Core.initials(m.name, m.email))) + '</span>' +
          '<div class="who"><b>' + h(m.name || m.googleName || m.email) + '</b><span>' + h(m.email) + ' · ' + (m.role === 'parent' ? 'Parent' : 'Student') + '</span></div></div></td>' +
          '<td><div class="row">' + levelChip(m.level) + Core.cleanSubjects(m.level, m.subjects).map(subjectChip).join('') + '</div></td>' +
          '<td class="small">' + (m.revoked ? '<span class="chip chip-danger">No access</span>' : classes + (classes === 1 ? ' class' : ' classes')) + '</td>' +
          '<td class="small muted">' + h(Core.timeAgo(ms(m.lastSeenAt))) + '</td>' +
          '<td class="actions"><button class="btn btn-xs" type="button" data-action="edit-member" data-id="' + h(m.uid) + '">Edit</button> ' +
            (m.revoked ? '<button class="btn btn-xs" type="button" data-action="restore-member" data-id="' + h(m.uid) + '">Restore</button>' : '<button class="btn btn-xs btn-danger" type="button" data-action="remove-member" data-id="' + h(m.uid) + '">Remove</button>') + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    return html + '</div>';
  }
  function wirePeopleForm() {
    var form = $('inviteForm');
    if (!form) return;
    var emails = $('inviteEmails'), name = $('inviteName');
    if (inviteDraft.emails) emails.value = inviteDraft.emails;
    if (inviteDraft.name) name.value = inviteDraft.name;
    emails.addEventListener('input', function () { inviteDraft.emails = emails.value; });
    name.addEventListener('input', function () { inviteDraft.name = name.value; });
    form.addEventListener('submit', function (e) { e.preventDefault(); sendInvites($('inviteSend')); });
  }

  /* ================= Admin actions: invitations ================= */
  function parseEmails(text) {
    var seen = {};
    return String(text || '').split(/[\s,;]+/).map(function (s) { return s.trim().replace(/^<|>$/g, ''); }).filter(function (s) {
      var key = Core.normalizeEmail(s);
      if (!s || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  async function sendInvites(button) {
    var list = parseEmails($('inviteEmails').value);
    var bad = list.filter(function (e) { return !Core.isEmail(e); });
    if (!list.length) { toast('Type at least one email address.', { error: true }); return; }
    if (bad.length) { toast('These do not look like email addresses: ' + bad.join(', '), { error: true }); return; }
    var subjects = Core.cleanSubjects(inviteDraft.level, inviteDraft.subjects);
    if (!subjects.length) { toast('Choose at least one subject.', { error: true }); return; }
    var name = list.length === 1 ? $('inviteName').value.trim() : '';
    busy(button, true);
    var sent = 0, skipped = [];
    try {
      for (var i = 0; i < list.length; i++) {
        var email = list[i], lower = Core.normalizeEmail(email);
        var already = state.members.find(function (m) { return !m.revoked && (Core.normalizeEmail(m.email) === lower || Core.normalizeEmail(m.invitedEmail) === lower); });
        if (already) { skipped.push(email + ' (already joined)'); continue; }
        var open = state.invites.find(function (inv) { return inv.emailLower === lower && inv.status !== 'revoked' && inv.status !== 'joined'; });
        var ref = open ? db.collection(INVITES).doc(open.id) : db.collection(INVITES).doc();
        var invite = {
          email: email, emailLower: lower, name: name || (open && open.name) || '', role: inviteDraft.role,
          level: inviteDraft.level, subjects: subjects, status: 'pending',
          invitedBy: state.user.email, invitedByName: state.user.displayName || '',
          lastSentAt: FieldValue.serverTimestamp(), mailError: FieldValue.delete()
        };
        if (!open) invite.createdAt = FieldValue.serverTimestamp();
        await ref.set(invite, { merge: true });
        await queueInviteEmail(ref.id, Object.assign({}, invite, { name: invite.name }));
        sent++;
      }
      busy(button, false);
      if (sent) {
        done(button, sent === 1 ? 'Sent' : sent + ' sent');
        toast(sent === 1 ? 'Invitation sent.' : sent + ' invitations sent.');
        inviteDraft.emails = ''; inviteDraft.name = '';
        $('inviteEmails').value = ''; $('inviteName').value = '';
      }
      if (skipped.length) toast('Skipped: ' + skipped.join(', '), { ms: 6000 });
    } catch (err) { busy(button, false); fail('Could not send the invitation', err); }
  }
  // The project's "Trigger Email from Firestore" extension sends whatever
  // lands in `mail`. The id names this app, so the enquiry rules' protected
  // `polymath-enquiry-*` documents are never touched.
  function queueInviteEmail(inviteId, invite) {
    var link = Core.inviteLink(PORTAL_URL, inviteId);
    // Sent as the centre (admin@polymathlc.com.sg), whichever admin invited.
    var message = Core.inviteEmail(invite, link, Core.SENDER_NAME);
    var id = 'polymath-online-invite-' + inviteId + '-' + Date.now();
    return db.collection(MAIL).doc(id).set(Core.portalMail(invite.email, message, { inviteId: inviteId, sentBy: state.user.email })).catch(function (err) {
      db.collection(INVITES).doc(inviteId).set({ mailError: (err && err.message) || 'not sent' }, { merge: true }).catch(function () {});
      toast('The invitation was saved, but its email could not be queued. Use “Copy link” to send it yourself.', { error: true, ms: 8000 });
    });
  }
  function inviteById(id) { return state.invites.find(function (i) { return i.id === id; }); }
  function copyInviteLink(id, button) {
    var link = Core.inviteLink(PORTAL_URL, id);
    var write = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(link) : Promise.reject(new Error('no clipboard'));
    write.then(function () { done(button, 'Copied'); toast('Invitation link copied. Paste it into WhatsApp or an email.'); })
      .catch(function () { window.prompt('Copy this invitation link:', link); });
  }
  async function resendInvite(id, button) {
    var inv = inviteById(id);
    if (!inv) return;
    busy(button, true);
    try {
      await db.collection(INVITES).doc(id).set({ lastSentAt: FieldValue.serverTimestamp(), mailError: FieldValue.delete() }, { merge: true });
      await queueInviteEmail(id, inv);
      busy(button, false); done(button, 'Sent');
    } catch (err) { busy(button, false); fail('Could not resend', err); }
  }
  async function revokeInvite(id) {
    var inv = inviteById(id);
    if (!inv || !confirm('Withdraw the invitation to ' + inv.email + '? Its link will stop working.')) return;
    try { await db.collection(INVITES).doc(id).set({ status: 'revoked', revokedAt: FieldValue.serverTimestamp() }, { merge: true }); toast('Invitation withdrawn.'); }
    catch (err) { fail('Could not withdraw it', err); }
  }
  async function deleteInvite(id) {
    try { await db.collection(INVITES).doc(id).delete(); } catch (err) { fail('Could not delete it', err); }
  }

  /* ================= Admin actions: members ================= */
  function memberById(uid) { return state.members.find(function (m) { return m.uid === uid; }); }
  function editMember(uid) {
    var m = memberById(uid);
    if (!m) return;
    var draft = { level: m.level || 'P5', subjects: Core.cleanSubjects(m.level, m.subjects), role: m.role === 'parent' ? 'parent' : 'student', name: m.name || '' };
    openModal(function () {
      var allowed = Core.levelSubjects(draft.level);
      return '<div class="modal-head"><div><div class="eyebrow">Edit</div><h2>' + h(m.name || m.email) + '</h2></div><button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button></div>' +
        '<div class="field"><label for="memberName">Name</label><input id="memberName" type="text" value="' + h(draft.name) + '"></div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Role</span><div class="choice-row">' + Core.ROLES.map(function (r) { return '<button type="button" class="choice" data-m="role" data-v="' + r.value + '" aria-pressed="' + (draft.role === r.value) + '">' + r.label + '</button>'; }).join('') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Level</span><div class="choice-row">' + Core.LEVELS.map(function (l) { return '<button type="button" class="choice" data-m="level" data-v="' + l + '" aria-pressed="' + (draft.level === l) + '">' + l + '</button>'; }).join('') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Subjects</span><div class="choice-row">' + Core.SUBJECTS.map(function (s) {
          var ok = allowed.indexOf(s.value) >= 0;
          return '<button type="button" class="choice" data-m="subject" data-v="' + s.value + '" aria-pressed="' + (ok && draft.subjects.indexOf(s.value) >= 0) + '"' + (ok ? '' : ' disabled') + '>' + s.short + '</button>';
        }).join('') + '</div></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button><button class="btn btn-primary" type="button" data-m="save">Save</button></div>';
    }, function (e, rerender, close) {
      var t = e.target.closest('[data-m]');
      if (!t) return;
      var kind = t.dataset.m, v = t.dataset.v;
      draft.name = $('memberName') ? $('memberName').value : draft.name;
      if (kind === 'role') draft.role = v;
      if (kind === 'level') { draft.level = v; draft.subjects = Core.cleanSubjects(v, draft.subjects.length ? draft.subjects : Core.levelSubjects(v)); if (!draft.subjects.length) draft.subjects = Core.levelSubjects(v).slice(0, 1); }
      if (kind === 'subject') {
        var i = draft.subjects.indexOf(v);
        if (i >= 0) { if (draft.subjects.length > 1) draft.subjects.splice(i, 1); } else draft.subjects.push(v);
        draft.subjects = Core.cleanSubjects(draft.level, draft.subjects);
      }
      if (kind === 'save') {
        busy(t, true);
        var batch = db.batch();
        batch.set(db.collection(MEMBERS).doc(uid), { name: draft.name.trim(), role: draft.role, level: draft.level, subjects: draft.subjects, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        batch.set(db.collection(PROFILES).doc(uid), { name: draft.name.trim(), level: draft.level, subject: Core.profileSubjectFor(draft.subjects), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        batch.commit().then(function () { close(); toast('Saved.'); }).catch(function (err) { busy(t, false); fail('Could not save', err); });
        return;
      }
      rerender();
    });
  }
  async function setMemberAccess(uid, allowed) {
    var m = memberById(uid);
    if (!m) return;
    if (!allowed && !confirm('Remove ' + (m.name || m.email) + '\'s access to Polymath Online? You can restore it later.')) return;
    try {
      var batch = db.batch();
      batch.set(db.collection(MEMBERS).doc(uid), allowed ? { revoked: FieldValue.delete(), revokedAt: FieldValue.delete() } : { revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (m.inviteId) batch.set(db.collection(INVITES).doc(m.inviteId), { status: allowed ? 'joined' : 'revoked' }, { merge: true });
      await batch.commit();
      toast(allowed ? 'Access restored.' : 'Access removed.');
    } catch (err) { fail('Could not change access', err); }
  }

  /* ================= Admin actions: classes ================= */
  function courseForm(course) {
    var draft = course ? { level: course.level, subject: course.subject, day: course.day || '', slot: course.slot, title: course.title || '' }
      : { level: 'P5', subject: 'math', day: 'Monday', slot: 1, title: '' };
    var titleTouched = !!(course && course.title && course.title !== Core.autoCourseTitle(course.level, course.subject, course.day, course.slot));
    openModal(function () {
      var allowed = Core.levelSubjects(draft.level);
      if (allowed.indexOf(draft.subject) < 0) draft.subject = allowed[0];
      var auto = Core.autoCourseTitle(draft.level, draft.subject, draft.day, draft.slot);
      if (!titleTouched) draft.title = auto;
      return '<div class="modal-head"><div><div class="eyebrow">' + (course ? 'Edit class' : 'New class') + '</div><h2>' + h(draft.title || auto) + '</h2></div><button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button></div>' +
        '<div class="field"><span class="label">Level</span><div class="choice-row">' + Core.LEVELS.map(function (l) { return '<button type="button" class="choice" data-m="level" data-v="' + l + '" aria-pressed="' + (draft.level === l) + '"' + (course && Core.courseIds(course).length ? ' disabled' : '') + '>' + l + '</button>'; }).join('') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Subject</span><div class="choice-row">' + Core.SUBJECTS.map(function (s) {
          var ok = allowed.indexOf(s.value) >= 0;
          return '<button type="button" class="choice" data-m="subject" data-v="' + s.value + '" aria-pressed="' + (draft.subject === s.value) + '"' + (ok && !(course && Core.courseIds(course).length) ? '' : ' disabled') + '>' + s.label + '</button>';
        }).join('') + '</div>' + (course && Core.courseIds(course).length ? '<span class="hint">Level and subject are fixed once a class has worksheets, because each worksheet carries them.</span>' : '') + '</div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Lesson day</span><div class="choice-row">' + Core.DAYS.map(function (d) { return '<button type="button" class="choice" data-m="day" data-v="' + d + '" aria-pressed="' + (draft.day === d) + '">' + d.slice(0, 3) + '</button>'; }).join('') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><span class="label">Session</span><div class="choice-row">' + Core.slotsForDay(draft.day).map(function (s, i) { return '<button type="button" class="choice" data-m="slot" data-v="' + i + '" aria-pressed="' + (draft.slot === i) + '">' + s + '</button>'; }).join('') + '</div></div>' +
        '<div class="field" style="margin-top:14px"><label for="courseTitle">Class name</label><input id="courseTitle" type="text" value="' + h(draft.title) + '" maxlength="80"><span class="hint">Students see this name.</span></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button><button class="btn btn-primary" type="button" data-m="save">' + (course ? 'Save' : 'Create class') + '</button></div>';
    }, function (e, rerender, close) {
      var t = e.target.closest('[data-m]');
      if (!t) return;
      var kind = t.dataset.m, v = t.dataset.v;
      var typed = $('courseTitle') ? $('courseTitle').value.trim() : '';
      if (typed && typed !== draft.title) { draft.title = typed; titleTouched = true; }
      if (kind === 'level') draft.level = v;
      if (kind === 'subject') draft.subject = v;
      if (kind === 'day') draft.day = v;
      if (kind === 'slot') draft.slot = Number(v);
      if (kind === 'save') {
        var data = { title: (typed || Core.autoCourseTitle(draft.level, draft.subject, draft.day, draft.slot)).slice(0, 80), level: draft.level, subject: draft.subject, day: draft.day || '', slot: (draft.slot === 0 || draft.slot === 1 || draft.slot === 2) ? draft.slot : null, updatedAt: FieldValue.serverTimestamp() };
        busy(t, true);
        var write;
        if (course) write = db.collection(COURSES).doc(course.id).set(data, { merge: true });
        else {
          var ref = db.collection(COURSES).doc();
          data.worksheetIds = []; data.currentIndex = -1; data.releasedThrough = -1; data.createdAt = FieldValue.serverTimestamp(); data.createdBy = state.user.email;
          write = ref.set(data).then(function () { state.courseId = ref.id; state.adminTab = 'classes'; });
        }
        write.then(function () {
          // The class's day and session follow onto its worksheets, so Ans Key files them in the same lesson group.
          if (course) return syncDocsDaySlot(course, data);
        }).then(function () { close(); toast(course ? 'Class saved.' : 'Class created. Now add its worksheets.'); render(); })
          .catch(function (err) { busy(t, false); fail('Could not save the class', err); });
        return;
      }
      rerender();
    }, function () {
      var input = $('courseTitle');
      if (input) input.addEventListener('input', function () { titleTouched = true; draft.title = input.value; });
    });
  }
  /* ---- Duplicating a class ----
     Every worksheet is copied (its PDF, name, pages and answer key), so the
     two classes move along and release on their own, and editing the copy's
     time slot refiles all of its worksheets in Ans Key at once. */
  var COPY_AT_ONCE = 3;
  async function readAnnotationsText(d) {
    if (!d.annotationsPath) return d.annotations || '[]';
    var url = await storage.ref(d.annotationsPath).getDownloadURL();
    var resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('the answer key could not be read (HTTP ' + resp.status + ')');
    return resp.text();
  }
  async function copyWorksheet(fromId, courseId, course, seq, bring) {
    // Duplicate class copies the answer key alone; 📂 Browse Ans Key says
    // what comes along (answer key, videos), and files the copy under the
    // class's own day and session so Ans Key shows it in that lesson.
    var b = bring || { answers: true, videos: false };
    var snap = await db.collection(WORKSHEETS).doc(fromId).get();
    if (!snap.exists) throw new Error('it is no longer in Ans Key');
    var d = snap.data();
    if (!d.storagePath) throw new Error('it has no PDF');
    var ref = db.collection(WORKSHEETS).doc();
    var url = await storage.ref(d.storagePath).getDownloadURL();
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('its PDF could not be read (HTTP ' + resp.status + ')');
    var pdf = await resp.blob();
    var payload = Core.worksheetCopy(d, { id: ref.id, storageDir: STORAGE_DIR, courseId: courseId, seq: seq, fromId: fromId,
      level: course.level, subject: course.subject, by: state.user.email, teacherEmail: TEACHER_EMAIL });
    await storage.ref(payload.storagePath).put(pdf, { contentType: 'application/pdf' });
    var answers = bring ? Core.pickAnnotations(await readAnnotationsText(d), b) : Core.stripLessonRecordings(await readAnnotationsText(d));
    if (bring) {
      payload.wsDay = course.day || '';
      payload.wsSlot = (course.slot === 0 || course.slot === 1 || course.slot === 2) ? course.slot : null;
      if (b.answers) {
        var keys = Core.mergeAnswerKeyMaps(null, d);
        if (Object.keys(keys).length) payload.answerKeys = keys;
      }
    }
    if (new Blob([answers.json]).size <= ANN_INLINE_LIMIT) payload.annotations = answers.json;
    else {
      // As Ans Key does: an answer key too big for the document sits beside the PDF.
      var annPath = STORAGE_DIR + '/' + ref.id + '.annotations.json';
      await storage.ref(annPath).put(new Blob([answers.json], { type: 'application/json' }), { contentType: 'application/json', cacheControl: 'no-cache' });
      payload.annotations = ''; payload.annotationsPath = annPath; payload.annotationsStamp = String(Date.now());
    }
    payload.createdAt = FieldValue.serverTimestamp();
    payload.updatedAt = FieldValue.serverTimestamp();
    await ref.set(payload);
    state.docs[ref.id] = payload;
    return ref.id;
  }
  function duplicateCourse(course) {
    if (!course) return;
    var ids = Core.courseIds(course);
    var job = { phase: 'ask', done: 0, failed: [], total: ids.length };
    var modal = openModal(function () {
      var head = '<div class="modal-head"><div><div class="eyebrow">Duplicate class</div><h2>' + h(Core.courseTitle(course)) + '</h2></div>' +
        (job.phase === 'copying' ? '' : '<button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button>') + '</div>';
      if (job.phase === 'ask') {
        return head + '<p>The copy keeps the level (' + h(course.level) + '), the subject (' + h(Core.subjectLabel(course.subject)) + ') and ' +
          (ids.length ? 'all ' + ids.length + ' worksheet' + (ids.length === 1 ? '' : 's') + ' in the same order, with their answer keys.' : 'no worksheets yet.') + '</p>' +
          '<ul class="small muted" style="margin:10px 0 0 18px;line-height:1.7">' +
            '<li>It has no day or time yet. You choose the time slot next.</li>' +
            '<li>It starts not started, with nothing released to students.</li>' +
            '<li>Lesson recordings stay with this class.</li></ul>' +
          '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>' +
          '<button class="btn btn-primary" type="button" data-m="go">Duplicate</button></div>';
      }
      var pct = job.total ? Math.round(100 * (job.done + job.failed.length) / job.total) : 100;
      return head + '<p><b>' + (job.phase === 'copying' ? 'Copying worksheet ' + Math.min(job.total, job.done + job.failed.length + 1) + ' of ' + job.total + '…' : 'Copied') + '</b></p>' +
        '<div class="progress" style="margin-top:10px"><div class="done" style="width:' + pct + '%"></div></div>' +
        '<p class="small muted" style="margin-top:8px">Keep this page open until it finishes.</p>';
    }, function (e, rerender, close) {
      var t = e.target.closest('[data-m="go"]');
      if (!t || job.phase !== 'ask') return;
      job.phase = 'copying'; rerender();
      run(rerender, close);
    });
    async function run(rerender, close) {
      var ref = db.collection(COURSES).doc();
      var data = Core.duplicateCourseData(course, state.user.email);
      data.createdAt = FieldValue.serverTimestamp();
      try { await ref.set(data); }
      catch (err) { close(); fail('Could not duplicate the class', err); return; }
      var made = new Array(ids.length), next = 0;
      async function worker() {
        while (next < ids.length) {
          var i = next++;
          try { made[i] = await copyWorksheet(ids[i], ref.id, course, i); job.done++; }
          catch (err) { job.failed.push((docName(ids[i]) || 'A worksheet') + ': ' + ((err && err.message) || err)); console.error('Copy failed', ids[i], err); }
          rerender();
        }
      }
      var workers = [];
      for (var w = 0; w < Math.min(COPY_AT_ONCE, ids.length); w++) workers.push(worker());
      await Promise.all(workers);
      var copied = made.filter(Boolean);
      try {
        if (copied.length) await saveOrder(ref.id, function () { return copied; }, { quiet: true });
      } catch (err) { fail('The worksheets were copied, but the new class list could not be saved', err); }
      job.phase = 'done'; rerender();
      close();
      state.courseId = ref.id; state.adminTab = 'classes'; state.uploads = [];
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (job.failed.length) toast(job.failed.length + ' worksheet' + (job.failed.length === 1 ? '' : 's') + ' could not be copied. ' + job.failed[0], { error: true, ms: 9000 });
      else toast('Class duplicated with ' + copied.length + ' worksheet' + (copied.length === 1 ? '' : 's') + '. Now choose its day and time.');
      // Straight on to the time slot, which is why the copy was made.
      var fresh = Object.assign({ id: ref.id }, data, { worksheetIds: copied });
      courseForm(state.courses[ref.id] && Core.courseIds(state.courses[ref.id]).length === copied.length ? state.courses[ref.id] : fresh);
    }
    return modal;
  }
  function syncDocsDaySlot(course, data) {
    if (course.day === data.day && course.slot === data.slot) return Promise.resolve();
    var ids = Core.courseIds(course);
    return Promise.all(Core.chunk(ids, 400).map(function (group) {
      var batch = db.batch();
      group.forEach(function (id) { batch.set(db.collection(WORKSHEETS).doc(id), { wsDay: data.day || '', wsSlot: data.slot }, { merge: true }); });
      return batch.commit();
    }));
  }
  async function deleteCourse(course) {
    var ids = Core.courseIds(course), rel = Core.releasedThrough(course);
    var unreleased = ids.length - Core.releasedCount(course);
    var msg = 'Delete the class “' + Core.courseTitle(course) + '”?\n\nIts worksheets stay in Ans Key.' +
      (unreleased > 0 ? ' The ' + unreleased + ' not yet released are moved to Hidden there, so students do not suddenly see them.' : '');
    if (!confirm(msg)) return;
    try {
      await Promise.all(Core.chunk(ids.map(function (id, i) { return { id: id, i: i }; }), 400).map(function (group) {
        var batch = db.batch();
        group.forEach(function (w) {
          var upd = { onlineCourseId: FieldValue.delete(), onlineSeq: FieldValue.delete() };
          if (w.i > rel) { upd.hidden = true; upd.hiddenAt = FieldValue.serverTimestamp(); }
          batch.set(db.collection(WORKSHEETS).doc(w.id), upd, { merge: true });
        });
        return batch.commit();
      }));
      await db.collection(COURSES).doc(course.id).delete();
      state.courseId = null;
      toast('Class deleted.');
      render();
    } catch (err) { fail('Could not delete the class', err); }
  }
  // The one writer of a class's order. The class keeps pointing at the
  // worksheet it is on; every worksheet's onlineSeq follows its new place;
  // worksheets taken out lose their class and stay in Ans Key as before.
  async function saveOrder(courseId, makeIds, options) {
    var opts = options || {};
    var ref = db.collection(COURSES).doc(courseId);
    var outcome = await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      if (!snap.exists) throw new Error('This class no longer exists.');
      var course = Object.assign({ id: snap.id }, snap.data());
      var oldIds = Core.courseIds(course);
      var newIds = makeIds(oldIds.slice(), course);
      // 📂 Previous worksheets move the class past them; anything else keeps
      // the class on the worksheet it is on.
      var progress = opts.progress ? opts.progress(course, newIds) : Core.remapProgress(course, newIds);
      tx.set(ref, Object.assign({ worksheetIds: newIds, updatedAt: FieldValue.serverTimestamp() }, progress), { merge: true });
      return { oldIds: oldIds, newIds: newIds };
    });
    var removed = outcome.oldIds.filter(function (id) { return outcome.newIds.indexOf(id) < 0; });
    var writes = outcome.newIds.map(function (id, i) { return { id: id, data: { onlineCourseId: courseId, onlineSeq: i, listOrder: i } }; })
      .concat(removed.map(function (id) { return { id: id, data: { onlineCourseId: FieldValue.delete(), onlineSeq: FieldValue.delete() } }; }));
    await Promise.all(Core.chunk(writes, 400).map(function (group) {
      var batch = db.batch();
      group.forEach(function (w) { batch.set(db.collection(WORKSHEETS).doc(w.id), w.data, { merge: true }); });
      return batch.commit();
    }));
    if (opts.quiet !== true && removed.length) toast(removed.length === 1 ? 'Removed from the class. It is still in Ans Key.' : removed.length + ' removed from the class.');
    return outcome;
  }
  async function moveWorksheet(index, delta) {
    try { await saveOrder(state.courseId, function (ids) { return Core.moveItem(ids, index, index + delta); }, { quiet: true }); }
    catch (err) { fail('Could not reorder', err); }
  }
  async function removeWorksheet(index) {
    var course = state.courses[state.courseId];
    var id = Core.courseIds(course)[index];
    if (!id || !confirm('Take “' + docName(id) + '” out of this class? The worksheet itself stays in Ans Key.')) return;
    try { await saveOrder(state.courseId, function (ids) { return ids.filter(function (x) { return x !== id; }); }); }
    catch (err) { fail('Could not remove it', err); }
  }
  async function renameWorksheet(id, name) {
    name = String(name || '').trim().slice(0, 120);
    if (!name || !state.docs[id] || name === state.docs[id].name) return;
    try {
      // Not `updatedAt`: that date is "last edited in Ans Key" on the student timeline.
      await db.collection(WORKSHEETS).doc(id).set({ name: name, renamedAt: FieldValue.serverTimestamp() }, { merge: true });
      state.docs[id].name = name;
      toast('Renamed.');
    } catch (err) { fail('Could not rename', err); }
  }
  async function setCurrent(button) {
    var course = state.courses[state.courseId];
    var n = Number($('currentInput').value) - 1;
    var update = Core.progressUpdate(course, n, { force: true });
    if (!update) { toast('Choose a worksheet between 1 and ' + Core.courseIds(course).length + '.', { error: true }); return; }
    busy(button, true);
    try {
      await db.collection(COURSES).doc(course.id).set(Object.assign({}, update, { progressAt: FieldValue.serverTimestamp(), progressBy: state.user.email }), { merge: true });
      busy(button, false); done(button, 'Set');
    } catch (err) { busy(button, false); fail('Could not set the class position', err); }
  }
  async function setRelease(button) {
    var course = state.courses[state.courseId];
    var total = Core.courseIds(course).length, cur = Core.currentIndex(course);
    var n = Math.round(Number($('releaseInput').value));
    if (!(n >= 0 && n <= total)) { toast('Choose a number between 0 and ' + total + '.', { error: true }); return; }
    // v1.12.0: never less than RELEASE_AHEAD past where the class is.
    var floor = Math.min(total - 1, Core.releaseFloor(course));
    var rel = Math.max(n - 1, floor);
    if (rel !== n - 1) toast('Kept at worksheet ' + (rel + 1) + ': students always have the ' + Core.RELEASE_AHEAD + ' after the one the class is on.');
    busy(button, true);
    try {
      await db.collection(COURSES).doc(course.id).set({ releasedThrough: rel, releasedAt: FieldValue.serverTimestamp(), releasedBy: state.user.email }, { merge: true });
      busy(button, false); done(button, 'Set');
    } catch (err) { busy(button, false); fail('Could not change the release', err); }
  }

  /* ---- 🔁 Replacing one worksheet's PDF ----
     For fixing a mistake in a worksheet already uploaded. The corrected PDF
     goes to the same storage path, so the answer key, name, place in the
     class and release all stay; `pdfVersion` tells every cache (here and in
     Ans Key) that the file is new. Copies made by Duplicate class can be
     replaced in the same go, as they are the same worksheet in other classes. */
  var REPLACE_AT_ONCE = 3;
  async function loadCopyFamily(id) {
    var known = {};
    known[id] = state.docs[id];
    // Up to the first original…
    var at = id, guard = 0;
    while (known[at] && known[at].onlineCopiedFrom && guard++ < 20) {
      var parent = known[at].onlineCopiedFrom;
      if (!(parent in known)) {
        var snap = await db.collection(WORKSHEETS).doc(parent).get();
        known[parent] = snap.exists ? snap.data() : { missing: true };
      }
      if (known[parent].missing) { at = parent; break; }
      at = parent;
    }
    // …then down through every copy of it, and copies of copies.
    var frontier = [at], seen = {};
    seen[at] = true;
    guard = 0;
    while (frontier.length && guard++ < 10) {
      var nextRound = [];
      for (var g = 0, groups = Core.chunk(frontier, 10); g < groups.length; g++) {
        var found = await db.collection(WORKSHEETS).where('onlineCopiedFrom', 'in', groups[g]).get();
        found.forEach(function (doc) {
          if (seen[doc.id]) return;
          seen[doc.id] = true;
          known[doc.id] = doc.data();
          nextRound.push(doc.id);
        });
      }
      frontier = nextRound;
    }
    return known;
  }
  function replacePdf(id) {
    var d = state.docs[id];
    if (!d || d.missing) { toast('That worksheet is not in Ans Key any more.', { error: true }); return; }
    if (!d.storagePath) { toast('That worksheet has no PDF to replace.', { error: true }); return; }
    var course = state.courses[state.courseId];
    var place = course ? Core.courseIds(course).indexOf(id) : -1;
    var job = {
      phase: 'pick', file: null, pages: null, counting: false,
      copies: null, copiesError: '', include: {},
      done: [], failed: [], total: 0, pct: 0
    };
    loadCopyFamily(id).then(function (known) {
      job.copies = Core.copyTargets(id, known, state.courses);
      job.copies.forEach(function (c) { job.include[c.id] = true; });
      job.known = known;
      if (modal) modal.rerender();
    }).catch(function (err) {
      console.warn('Copies could not be looked up', err);
      job.copies = []; job.copiesError = 'Copies in other classes could not be looked up, so only this one will change.';
      if (modal) modal.rerender();
    });
    function chosenTargets() {
      var list = [{ id: id, data: d }];
      (job.copies || []).forEach(function (c) {
        if (job.include[c.id] && job.known && job.known[c.id] && job.known[c.id].storagePath) list.push({ id: c.id, data: job.known[c.id] });
      });
      return list;
    }
    function pickHtml() {
      var html = '<p>Upload the corrected PDF for <b>' + h(d.name || 'this worksheet') + '</b>' + (place >= 0 ? ' (worksheet ' + (place + 1) + ' in this class)' : '') + '.</p>' +
        '<ul class="small muted" style="margin:10px 0 0 18px;line-height:1.7">' +
          '<li>The answer key, name and place in the class stay as they are.</li>' +
          '<li>Students and Ans Key get the new file the next time they open it.</li>' +
          '<li>Keep the pages in the same order so the answers still line up.</li></ul>' +
        '<label class="dropzone replace-drop" id="replaceDrop" for="replaceInput" style="margin-top:14px">' +
          '<input id="replaceInput" type="file" accept="application/pdf,.pdf" class="visually-hidden">' +
          (job.file
            ? '<div style="font-size:1.4rem">📄</div><div style="margin-top:4px"><b>' + h(job.file.name) + '</b></div>' +
              '<div class="small muted" style="margin-top:2px">' + h([job.file.size < 102400 ? Math.max(1, Math.round(job.file.size / 1024)) + ' KB' : (job.file.size / 1048576).toFixed(1) + ' MB',
                job.counting ? 'counting pages…' : (job.pages ? job.pages + (job.pages === 1 ? ' page' : ' pages') : '')].filter(Boolean).join(' · ')) +
              ' · <u>choose another</u></div>'
            : '<div style="font-size:1.4rem">📄</div><div style="margin-top:4px"><b>Drop the corrected PDF here</b>, or click to choose it</div>' +
              '<div class="small muted" style="margin-top:2px">Now: ' + h(pagesLabel(id) || 'page count unknown') + '</div>') +
        '</label>';
      var note = job.file && !job.counting ? Core.pageChangeNote(d.pageCount, job.pages) : '';
      if (note) html += '<div class="replace-warn" role="note">⚠ ' + h(note) + '</div>';
      if (job.copies === null) html += '<p class="small muted" style="margin-top:12px">Looking for copies of this worksheet in other classes…</p>';
      else if (job.copiesError) html += '<p class="small muted" style="margin-top:12px">' + h(job.copiesError) + '</p>';
      else if (job.copies.length) {
        html += '<div class="replace-copies"><div class="small" style="font-weight:600;margin-bottom:6px">Also replace it in ' +
          (job.copies.length === 1 ? 'its copy' : 'its ' + job.copies.length + ' copies') + ' made by Duplicate class:</div>' +
          job.copies.map(function (c) {
            return '<label class="replace-copy"><input type="checkbox" data-copy="' + h(c.id) + '"' + (job.include[c.id] ? ' checked' : '') + '>' +
              '<span><b>' + h(c.where) + '</b><span class="small muted"> · ' + h(c.name) + '</span></span></label>';
          }).join('') + '</div>';
      }
      var count = chosenTargets().length;
      return html + '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" data-m="replace"' + (job.file && !job.counting ? '' : ' disabled') + '>' +
        (count > 1 ? 'Replace in ' + count + ' worksheets' : 'Replace PDF') + '</button></div>';
    }
    function progressHtml() {
      var finished = job.done.length + job.failed.length;
      return '<p><b>' + (job.phase === 'uploading' ? (job.total > 1 ? 'Replacing ' + Math.min(job.total, finished + 1) + ' of ' + job.total + '…' : 'Uploading the corrected PDF…') : 'Replaced') + '</b></p>' +
        '<div class="progress" style="margin-top:10px"><div class="done" id="replaceBar" style="width:' + job.pct + '%"></div></div>' +
        '<p class="small muted" style="margin-top:8px">Keep this page open until it finishes.</p>';
    }
    var modal = openModal(function () {
      var head = '<div class="modal-head"><div><div class="eyebrow">Replace PDF</div><h2>' + h(d.name || 'Worksheet') + '</h2></div>' +
        (job.phase === 'uploading' ? '' : '<button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button>') + '</div>';
      return head + (job.phase === 'pick' ? pickHtml() : progressHtml());
    }, function (e, rerender, close) {
      var go = e.target.closest('[data-m="replace"]');
      if (!go || job.phase !== 'pick' || !job.file || job.counting) return;
      job.phase = 'uploading'; rerender();
      run(rerender, close);
    }, function () {
      var input = $('replaceInput'), zone = $('replaceDrop');
      if (input) input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.value = '';
        if (f) choose(f);
      });
      if (zone) {
        ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); }); });
        ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); }); });
        zone.addEventListener('drop', function (e) {
          var list = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
          if (list.length > 1) toast('One PDF at a time here. The first one is used.');
          if (list[0]) choose(list[0]);
        });
      }
      Array.prototype.forEach.call(document.querySelectorAll('.modal [data-copy]'), function (box) {
        box.addEventListener('change', function () {
          job.include[box.dataset.copy] = box.checked;
          if (modal) modal.rerender();
        });
      });
    });
    async function choose(file) {
      if (!(/\.pdf$/i.test(file.name) || file.type === 'application/pdf')) { toast(file.name + ' is not a PDF.', { error: true }); return; }
      if (file.size > MAX_PDF_BYTES) { toast(file.name + ' is larger than 60 MB.', { error: true }); return; }
      job.file = file; job.pages = null; job.counting = true;
      modal.rerender();
      var pages = await countPages(file);
      if (job.file !== file) return;   // another file was chosen meanwhile
      job.pages = pages; job.counting = false;
      modal.rerender();
    }
    async function run(rerender, close) {
      var targets = chosenTargets();
      var file = job.file;
      var version = Date.now();
      var update = Core.replacementUpdate({ version: version, fileName: file.name, by: state.user.email, pageCount: job.pages });
      job.total = targets.length;
      var shares = targets.map(function () { return 0; });
      function paint() {
        job.pct = Math.round(shares.reduce(function (a, b) { return a + b; }, 0) / targets.length);
        var bar = $('replaceBar');
        if (bar) bar.style.width = job.pct + '%';
      }
      var next = 0;
      async function one(i) {
        var t = targets[i];
        try {
          await new Promise(function (resolve, reject) {
            var task = storage.ref(t.data.storagePath).put(file, { contentType: 'application/pdf', cacheControl: 'no-cache' });
            task.on('state_changed', function (snap) {
              shares[i] = snap.totalBytes ? Math.round(95 * snap.bytesTransferred / snap.totalBytes) : 50;
              paint();
            }, reject, resolve);
          });
          var payload = Object.assign({}, update, { pdfReplacedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          await db.collection(WORKSHEETS).doc(t.id).set(payload, { merge: true });
          if (state.docs[t.id]) Object.assign(state.docs[t.id], update);
          shares[i] = 100; paint();
          job.done.push(t.id);
        } catch (err) {
          shares[i] = 100; paint();
          var where = t.id === id ? 'This class' : ((job.copies || []).filter(function (c) { return c.id === t.id; })[0] || {}).where || 'A copy';
          job.failed.push(where + ': ' + ((err && err.message) || err));
          console.error('Replace failed', t.id, err);
        }
        rerender();
      }
      async function worker() { while (next < targets.length) await one(next++); }
      var workers = [];
      for (var w = 0; w < Math.min(REPLACE_AT_ONCE, targets.length); w++) workers.push(worker());
      await Promise.all(workers);
      job.phase = 'done'; rerender();
      close();
      render();
      var text = Core.replaceSummary(job.done, job.failed);
      toast(text, job.failed.length ? { error: true, ms: 9000 } : undefined);
    }
  }

  /* ---- Uploading the whole list ---- */
  var pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = PDFJS_URL; s.async = true;
        s.onload = function () {
          if (!window.pdfjsLib) { reject(new Error('PDF reader missing')); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(window.pdfjsLib);
        };
        s.onerror = function () { pdfjsPromise = null; reject(new Error('PDF reader could not load')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }
  // The page count Ans Key shows in its list. Nice to have, never a reason to refuse a file.
  async function countPages(file) {
    try {
      var lib = await loadPdfJs();
      var doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      var n = doc.numPages;
      doc.destroy();
      return n;
    } catch (e) { return null; }
  }
  // Several files go up at once, so a whole term's list does not wait on one
  // PDF at a time; each batch is still added to the class in name order.
  var UPLOAD_AT_ONCE = 3;
  var uploadKey = 0;
  function startUpload(files) {
    uploadFiles(files).catch(function (err) { fail('The upload stopped', err); });
  }
  async function uploadFiles(files) {
    var course = state.courses[state.courseId];
    if (!course || !files.length) return;
    var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    var refused = files.length - pdfs.length;
    if (refused) toast(refused + ' file' + (refused === 1 ? ' is' : 's are') + ' not a PDF and ' + (refused === 1 ? 'was' : 'were') + ' skipped.', { error: true });
    pdfs = pdfs.filter(function (f) {
      if (f.size > MAX_PDF_BYTES) { toast(f.name + ' is larger than 60 MB and was skipped.', { error: true }); return false; }
      return true;
    }).sort(function (a, b) { return Core.naturalCompare(a.name, b.name); });
    if (!pdfs.length) return;
    var courseId = course.id;
    var items = pdfs.map(function (f) { return { key: ++uploadKey, name: f.name, pct: 0, state: 'waiting' }; });
    // A second drop while the first is still going joins the same list.
    state.uploads = state.uploads.filter(function (u) { return u.state !== 'added'; }).concat(items);
    render();
    var made = new Array(pdfs.length), next = 0;
    async function one(i) {
      var file = pdfs[i], item = items[i];
      try {
        item.state = 'reading'; render();
        var pageCount = await countPages(file);
        var ref = db.collection(WORKSHEETS).doc();
        var path = STORAGE_DIR + '/' + ref.id + '.pdf';
        item.state = 'uploading'; render();
        await new Promise(function (resolve, reject) {
          var task = storage.ref(path).put(file, { contentType: 'application/pdf' });
          task.on('state_changed', function (snap) {
            item.pct = snap.totalBytes ? Math.round(95 * snap.bytesTransferred / snap.totalBytes) : 50;
            paintUploadBar(item);
          }, reject, resolve);
        });
        var teacher = Core.normalizeEmail(state.user.email) === TEACHER_EMAIL;
        var payload = {
          name: Core.worksheetNameFromFile(file.name),
          level: course.level, subject: course.subject,
          wsDay: course.day || '', wsSlot: (course.slot === 0 || course.slot === 1 || course.slot === 2) ? course.slot : null,
          hidden: false,
          storagePath: path,
          annotations: '',
          starPages: [],
          onlineCourseId: courseId,
          // Its place for now; the class list below settles every number.
          onlineSeq: Core.courseIds(course).length + i,
          onlineUploadedBy: state.user.email,
          ownerEmail: TEACHER_EMAIL,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        var ownerUid = teacher ? state.user.uid : state.teacherUid;
        if (ownerUid) payload.ownerUid = ownerUid;
        if (pageCount) payload.pageCount = pageCount;
        await ref.set(payload);
        state.docs[ref.id] = payload;
        made[i] = ref.id;
        item.pct = 100; item.state = 'added';
      } catch (err) {
        item.state = 'failed: ' + ((err && err.message) || 'error');
        console.error('Upload failed', file.name, err);
      }
      render();
    }
    async function worker() { while (next < pdfs.length) await one(next++); }
    var workers = [];
    for (var w = 0; w < Math.min(UPLOAD_AT_ONCE, pdfs.length); w++) workers.push(worker());
    await Promise.all(workers);
    var added = made.filter(Boolean);
    var failed = pdfs.length - added.length;
    if (added.length) {
      try {
        await saveOrder(courseId, function (ids) { return ids.concat(added.filter(function (id) { return ids.indexOf(id) < 0; })); }, { quiet: true });
        toast(added.length + ' worksheet' + (added.length === 1 ? '' : 's') + ' added to the class.' + (failed ? ' ' + failed + ' could not be uploaded.' : ''), failed ? { error: true } : undefined);
      } catch (err) { fail('The files uploaded, but the class list could not be updated', err); }
    } else if (failed) toast('The upload failed. Check the connection and try again.', { error: true });
    // Finished rows clear by themselves; a failed one stays so it can be seen.
    setTimeout(function () {
      var left = state.uploads.filter(function (u) { return items.indexOf(u) < 0 || /^failed/.test(u.state); });
      if (left.length !== state.uploads.length) { state.uploads = left; render(); }
    }, 4000);
  }

  /* ---- 📂 Browse Ans Key app (v1.10.0) ----
     Every worksheet in the Ans Key app, to add to the class without
     uploading it again: as PREVIOUS worksheets (lessons the class has had,
     done and released) or FUTURE worksheets (still to come, queued), each
     with its answer key and/or its video recordings as chosen. The rules
     are Core.placeWorksheets, Core.libraryNeedsCopy and Core.pickAnnotations;
     this is the window around them. */
  var library = { items: null, loading: null, scopeAll: false };
  function loadLibrary(course, all) {
    // The class's level (subject is filtered in the list) or, asked for, everything.
    var key = all ? 'all' : course.level;
    if (library.items && library.key === key) return Promise.resolve(library.items);
    if (library.loading && library.key === key) return library.loading;
    library.key = key;
    var q = all ? db.collection(WORKSHEETS).limit(1500) : db.collection(WORKSHEETS).where('level', '==', course.level).limit(800);
    library.loading = q.get().then(function (snap) {
      var list = [];
      snap.forEach(function (doc) { list.push({ id: doc.id, data: doc.data() }); });
      library.items = Core.libraryOrder(list);
      library.loading = null;
      return library.items;
    }).catch(function (err) { library.loading = null; library.key = ''; throw err; });
    return library.loading;
  }
  function libraryClassName(courseId) {
    var c = state.courses[courseId];
    return c ? Core.courseTitle(c) : 'another class';
  }
  function libraryBadges(info) {
    var out = '';
    out += info.answers ? '<span class="lib-badge ok" title="Written on in Ans Key">✍ Answer key</span>' : '<span class="lib-badge" title="Nothing written on it yet">No answers yet</span>';
    if (info.videos) out += '<span class="lib-badge video">▶ ' + info.videos + (info.videos === 1 ? ' video' : ' videos') + '</span>';
    if (info.keys) out += '<span class="lib-badge">📄 ' + info.keys + ' key PDF' + (info.keys === 1 ? '' : 's') + '</span>';
    if (info.inClass) out += '<span class="lib-badge class" title="Already in ' + h(libraryClassName(info.inClass)) + '; a copy is added here">In ' + h(libraryClassName(info.inClass)) + '</span>';
    if (info.hidden) out += '<span class="lib-badge">🔒 Hidden in Ans Key</span>';
    return out;
  }
  function libraryMeta(d) {
    return [d.wsDay, d.wsDate ? Core.formatDay(new Date(d.wsDate + 'T12:00:00').getTime()) : '', d.level, Core.subjectLabel(d.subject), d.pageCount ? d.pageCount + ' pages' : '']
      .filter(Boolean).join(' · ');
  }

  async function browseAnsKey() {
    var course = state.courses[state.courseId];
    if (!course) return;
    var ui = { query: '', all: false, picked: [], mode: 'future', bring: { answers: true, videos: true }, phase: 'pick', done: 0, failed: [], error: '' };
    function visible() {
      // Not what the class already has, nor the original of a copy it has.
      var live = state.courses[course.id] || course;
      var have = Core.courseIds(live).slice();
      Core.courseIds(live).forEach(function (id) { var d = state.docs[id]; if (d && d.onlineCopiedFrom) have.push(d.onlineCopiedFrom); });
      return (library.items || []).filter(function (c) {
        return have.indexOf(c.id) < 0 && Core.libraryMatches(c.data, course, ui.all ? 'all' : 'class', ui.query);
      });
    }
    function itemById(id) { return (library.items || []).find(function (x) { return x.id === id; }); }
    function whereText() {
      var at = Core.ansKeyAt(course), total = Core.courseIds(course).length;
      if (ui.mode === 'future') return total ? 'After worksheet ' + total + ', at the end of the list. They wait their turn, like any upload.' : 'As the first worksheets of the class.';
      if (Core.currentIndex(course) < 0) return 'At the start of the list, done and released to students. The class is then on the first worksheet after them.';
      return 'Before worksheet ' + (at + 1) + ' (the current worksheet), done and released to students. The class stays on the same worksheet.';
    }
    var modal = openModal(function () {
      var head = '<div class="modal-head"><div><div class="eyebrow">📂 Browse Ans Key app</div><h2>' + h(Core.courseTitle(course)) + '</h2>' +
        '<div class="small muted" style="margin-top:4px">Pick worksheets from Ans Key, choose whether the class has had them or has them to come, and what comes with them.</div></div>' +
        (ui.phase === 'adding' ? '' : '<button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button>') + '</div>';
      if (ui.phase === 'adding') {
        var pct = ui.picked.length ? Math.round(100 * (ui.done + ui.failed.length) / ui.picked.length) : 100;
        return head + '<p><b>Adding ' + Math.min(ui.picked.length, ui.done + ui.failed.length + 1) + ' of ' + ui.picked.length + '…</b></p>' +
          '<div class="progress" style="margin-top:10px"><div class="done" style="width:' + pct + '%"></div></div>' +
          '<p class="small muted" style="margin-top:8px">Copies carry their PDF' + (ui.bring.answers ? ', answer key' : '') + (ui.bring.videos ? ' and videos' : '') + '. Keep this page open until it finishes.</p>';
      }
      var body;
      if (ui.error) body = '<div class="empty"><p>' + h(ui.error) + '</p></div>';
      else if (!library.items) body = '<div class="loader" style="padding:40px 0"><div class="spinner"></div><div>Opening the Ans Key library…</div></div>';
      else {
        var list = visible();
        body = list.length ? '<div class="pick-list lib-list" id="libList">' + list.map(function (c) {
          var info = Core.libraryInfo(c.data);
          var at = ui.picked.indexOf(c.id);
          return '<label class="pick-row lib-row' + (at >= 0 ? ' is-picked' : '') + '"><input type="checkbox" data-pick="' + h(c.id) + '"' + (at >= 0 ? ' checked' : '') + '>' +
            '<div class="lib-text"><div class="lib-name">' + h(c.data.name || 'Untitled') + '</div>' +
            '<div class="small muted">' + h(libraryMeta(c.data)) + '</div>' +
            '<div class="lib-badges">' + libraryBadges(info) + '</div></div>' +
            (at >= 0 ? '<span class="ord">' + (ui.mode === 'previous' ? 'Previous' : 'Future') + ' #' + (at + 1) + '</span>' : '') + '</label>';
        }).join('') + '</div>'
          : '<div class="empty"><p>' + (ui.query ? 'Nothing in Ans Key matches “' + h(ui.query) + '”.' : 'No other ' + (ui.all ? '' : h(course.level) + ' ' + h(Core.subjectLabel(course.subject)) + ' ') + 'worksheets in Ans Key.') + '</p></div>';
      }
      var controls = '<div class="lib-tools">' +
        '<input id="libSearch" class="lib-search" type="search" placeholder="Search Ans Key by name, day or date" value="' + h(ui.query) + '" aria-label="Search Ans Key worksheets">' +
        '<div class="choice-row lib-scope">' +
          '<button type="button" class="choice" aria-pressed="' + (!ui.all ? 'true' : 'false') + '" data-m="scope" data-v="class">' + h(course.level) + ' ' + h(Core.subjectLabel(course.subject, true)) + '</button>' +
          '<button type="button" class="choice" aria-pressed="' + (ui.all ? 'true' : 'false') + '" data-m="scope" data-v="all">All levels</button></div></div>';
      var n = ui.picked.length;
      var foot = '<div class="lib-options">' +
        '<div class="field"><span class="label">Add them as</span><div class="choice-row">' +
          '<button type="button" class="choice" aria-pressed="' + (ui.mode === 'previous' ? 'true' : 'false') + '" data-m="mode" data-v="previous">⏮ Previous worksheets</button>' +
          '<button type="button" class="choice" aria-pressed="' + (ui.mode === 'future' ? 'true' : 'false') + '" data-m="mode" data-v="future">⏭ Future worksheets</button></div>' +
          '<div class="small muted lib-where">' + h(whereText()) + '</div></div>' +
        '<div class="field"><span class="label">Bring with each</span><div class="lib-bring">' +
          '<label class="lib-check"><input type="checkbox" data-bring="answers"' + (ui.bring.answers ? ' checked' : '') + '><span><b>Answer key</b><small>The writing on it in Ans Key, and its answer key PDFs</small></span></label>' +
          '<label class="lib-check"><input type="checkbox" data-bring="videos"' + (ui.bring.videos ? ' checked' : '') + '><span><b>Video recordings</b><small>The lessons recorded on it</small></span></label></div></div></div>';
      return head + controls + body + foot +
        '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" data-m="add"' + (n ? '' : ' disabled') + '>' +
          (n ? 'Add ' + n + ' as ' + (ui.mode === 'previous' ? 'previous' : 'future') + ' worksheet' + (n === 1 ? '' : 's') : 'Tick the worksheets to add') + '</button></div>';
    }, function (e, rerender, close) {
      if (ui.phase !== 'pick') return;
      var box = e.target.closest('[data-pick]');
      if (box) {
        var id = box.dataset.pick, i = ui.picked.indexOf(id);
        if (box.checked && i < 0) ui.picked.push(id);
        if (!box.checked && i >= 0) ui.picked.splice(i, 1);
        keepScroll(rerender);
        return;
      }
      var bringBox = e.target.closest('[data-bring]');
      if (bringBox) { ui.bring[bringBox.dataset.bring] = !!bringBox.checked; keepScroll(rerender); return; }
      var t = e.target.closest('[data-m]');
      if (!t) return;
      if (t.dataset.m === 'mode') { ui.mode = t.dataset.v === 'previous' ? 'previous' : 'future'; keepScroll(rerender); return; }
      if (t.dataset.m === 'scope') {
        ui.all = t.dataset.v === 'all';
        if (library.key !== (ui.all ? 'all' : course.level)) library.items = null;
        rerender();
        loadLibrary(course, ui.all).then(function () { rerender(); }).catch(function (err) { ui.error = 'Ans Key could not be read: ' + ((err && err.message) || err); rerender(); });
        return;
      }
      if (t.dataset.m === 'add' && ui.picked.length) run(rerender, close);
    }, function () {
      var input = $('libSearch');
      if (input) {
        input.addEventListener('input', function () {
          ui.query = input.value;
          // Redrawn as it is typed; the box gets its caret back at the end.
          keepScroll(function () { modal.rerender(); });
          var again = $('libSearch');
          if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (err) {} }
        });
      }
    });
    function keepScroll(rerender) {
      var listEl = $('libList');
      var top = listEl ? listEl.scrollTop : 0;
      rerender();
      var after = $('libList');
      if (after) after.scrollTop = top;
    }
    async function run(rerender, close) {
      var picks = ui.picked.slice();
      var bring = { answers: !!ui.bring.answers, videos: !!ui.bring.videos };
      var mode = ui.mode;
      ui.phase = 'adding'; ui.done = 0; ui.failed = []; rerender();
      // Each pick joins as it is, or as a copy: the order ticked is the order kept.
      var made = new Array(picks.length), nextPick = 0;
      var direct = [];
      async function one(i) {
        var c = itemById(picks[i]);
        try {
          if (!c) throw new Error('it is no longer in Ans Key');
          if (Core.libraryNeedsCopy(c.data, bring, course.id)) {
            made[i] = await copyWorksheet(c.id, course.id, course, Core.courseIds(course).length + i, bring);
          } else {
            made[i] = c.id;
            direct.push(c.id);
            state.docs[c.id] = c.data;
          }
          ui.done++;
        } catch (err) {
          ui.failed.push(((c && c.data && c.data.name) || 'A worksheet') + ': ' + ((err && err.message) || err));
          console.error('Browse Ans Key: could not add', picks[i], err);
        }
        rerender();
      }
      async function worker() { while (nextPick < picks.length) await one(nextPick++); }
      var workers = [];
      for (var w = 0; w < Math.min(COPY_AT_ONCE, picks.length); w++) workers.push(worker());
      await Promise.all(workers);
      var added = made.filter(Boolean);
      try {
        // A worksheet joining as it is takes the class's lesson day and time in Ans Key.
        if (direct.length) {
          await Promise.all(Core.chunk(direct, 400).map(function (group) {
            var batch = db.batch();
            group.forEach(function (id) {
              batch.set(db.collection(WORKSHEETS).doc(id), { wsDay: course.day || '', wsSlot: (course.slot === 0 || course.slot === 1 || course.slot === 2) ? course.slot : null, hidden: false }, { merge: true });
            });
            return batch.commit();
          }));
        }
        if (added.length) {
          await saveOrder(course.id, function (ids, live) {
            return Core.placeWorksheets(live, added, mode).worksheetIds;
          }, {
            quiet: true,
            progress: function (live) {
              var plan = Core.placeWorksheets(live, added, mode);
              var out = { currentIndex: plan.currentIndex, currentDocId: plan.currentDocId, releasedThrough: plan.releasedThrough };
              if (mode === 'previous') { out.progressAt = FieldValue.serverTimestamp(); out.progressBy = state.user.email; }
              return out;
            }
          });
        }
      } catch (err) { close(); fail('The worksheets were prepared, but the class list could not be saved', err); return; }
      close();
      if (ui.failed.length) toast(ui.failed.length + ' could not be added. ' + ui.failed[0], { error: true, ms: 9000 });
      if (added.length) {
        toast(added.length + ' ' + (mode === 'previous' ? 'previous' : 'future') + ' worksheet' + (added.length === 1 ? '' : 's') + ' added from Ans Key' +
          (bring.answers || bring.videos ? ', with ' + (bring.answers && bring.videos ? 'answer keys and videos' : bring.answers ? 'answer keys' : 'videos') : '') +
          (mode === 'previous' ? ', done and released to students.' : '.'), { ms: 6000 });
      }
    }
    loadLibrary(course, false).then(function () { modal.rerender(); }).catch(function (err) {
      ui.error = 'Ans Key could not be read: ' + ((err && err.message) || err);
      modal.rerender();
    });
    return modal;
  }

  /* ---- 📂 One worksheet's answer key and videos, from another in Ans Key ----
     For a worksheet already in the class (an upload with nothing written on
     it, say): pick the Ans Key worksheet that has the answers and the
     lessons, and choose what to take. The answer key REPLACES this
     worksheet's writing; the videos are ADDED beside its own recordings.
     Core.mergeAnnotations decides, and the answer key PDFs filed per lesson
     day come too (this worksheet's own days win). */
  async function writeAnnotationsFor(id, d, json) {
    var data = { annotationsStamp: String(Date.now()), updatedAt: FieldValue.serverTimestamp() };
    if (new Blob([json]).size <= ANN_INLINE_LIMIT) {
      data.annotations = json;
      if (d.annotationsPath) data.annotationsPath = FieldValue.delete();
    } else {
      var annPath = d.annotationsPath || (STORAGE_DIR + '/' + id + '.annotations.json');
      await storage.ref(annPath).put(new Blob([json], { type: 'application/json' }), { contentType: 'application/json', cacheControl: 'no-cache' });
      data.annotations = ''; data.annotationsPath = annPath;
    }
    return data;
  }
  async function linkFromAnsKey(targetId) {
    var course = state.courses[state.courseId];
    if (!course || !targetId) return;
    var ui = { query: '', all: false, source: '', bring: { answers: true, videos: true }, phase: 'pick', error: '' };
    var targetName = docName(targetId);
    var seq = Core.courseIds(course).indexOf(targetId);
    var modal = openModal(function () {
      var head = '<div class="modal-head"><div><div class="eyebrow">📂 From Ans Key · worksheet ' + (seq + 1) + '</div><h2>' + h(targetName) + '</h2>' +
        '<div class="small muted" style="margin-top:4px">Choose the Ans Key worksheet whose answer key and video recordings this one should use.</div></div>' +
        (ui.phase === 'saving' ? '' : '<button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button>') + '</div>';
      if (ui.phase === 'saving') return head + '<div class="loader" style="padding:30px 0"><div class="spinner"></div><div>Copying across…</div></div>';
      var body;
      if (ui.error) body = '<div class="empty"><p>' + h(ui.error) + '</p></div>';
      else if (!library.items) body = '<div class="loader" style="padding:40px 0"><div class="spinner"></div><div>Opening the Ans Key library…</div></div>';
      else {
        var list = (library.items || []).filter(function (c) {
          if (c.id === targetId) return false;
          var info = Core.libraryInfo(c.data);
          return (info.answers || info.videos || info.keys) && Core.libraryMatches(c.data, course, ui.all ? 'all' : 'class', ui.query);
        });
        body = list.length ? '<div class="pick-list lib-list" id="libList">' + list.map(function (c) {
          var info = Core.libraryInfo(c.data);
          return '<label class="pick-row lib-row' + (ui.source === c.id ? ' is-picked' : '') + '"><input type="radio" name="libSource" data-source="' + h(c.id) + '"' + (ui.source === c.id ? ' checked' : '') + '>' +
            '<div class="lib-text"><div class="lib-name">' + h(c.data.name || 'Untitled') + '</div>' +
            '<div class="small muted">' + h(libraryMeta(c.data)) + '</div>' +
            '<div class="lib-badges">' + libraryBadges(info) + '</div></div></label>';
        }).join('') + '</div>'
          : '<div class="empty"><p>' + (ui.query ? 'Nothing in Ans Key matches “' + h(ui.query) + '”.' : 'No worksheet in Ans Key has an answer key or videos to take yet.') + '</p></div>';
      }
      var controls = '<div class="lib-tools">' +
        '<input id="libSearch" class="lib-search" type="search" placeholder="Search Ans Key by name, day or date" value="' + h(ui.query) + '" aria-label="Search Ans Key worksheets">' +
        '<div class="choice-row lib-scope">' +
          '<button type="button" class="choice" aria-pressed="' + (!ui.all ? 'true' : 'false') + '" data-m="scope" data-v="class">' + h(course.level) + ' ' + h(Core.subjectLabel(course.subject, true)) + '</button>' +
          '<button type="button" class="choice" aria-pressed="' + (ui.all ? 'true' : 'false') + '" data-m="scope" data-v="all">All levels</button></div></div>';
      var src = ui.source ? (library.items || []).find(function (x) { return x.id === ui.source; }) : null;
      var foot = '<div class="lib-options"><div class="field"><span class="label">Use from it</span><div class="lib-bring">' +
        '<label class="lib-check"><input type="checkbox" data-bring="answers"' + (ui.bring.answers ? ' checked' : '') + '><span><b>As the answer key</b><small>Its writing replaces what is written on this worksheet, and its answer key PDFs come too</small></span></label>' +
        '<label class="lib-check"><input type="checkbox" data-bring="videos"' + (ui.bring.videos ? ' checked' : '') + '><span><b>Its videos as the video recording</b><small>Added beside this worksheet\'s own recordings</small></span></label></div></div>' +
        '<div class="small muted lib-where">If this worksheet is open in Ans Key, close it there first, or its next save puts the old answers back.</div></div>';
      var ready = src && (ui.bring.answers || ui.bring.videos);
      return head + controls + body + foot +
        '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>' +
        '<button class="btn btn-primary" type="button" data-m="use"' + (ready ? '' : ' disabled') + '>' +
          (src ? 'Use ' + h(Core.libraryBringLabel(Core.libraryInfo(src.data), ui.bring)) : 'Choose a worksheet') + '</button></div>';
    }, function (e, rerender, close) {
      if (ui.phase !== 'pick') return;
      var radio = e.target.closest('[data-source]');
      if (radio) { ui.source = radio.dataset.source; keepScroll(rerender); return; }
      var bringBox = e.target.closest('[data-bring]');
      if (bringBox) { ui.bring[bringBox.dataset.bring] = !!bringBox.checked; keepScroll(rerender); return; }
      var t = e.target.closest('[data-m]');
      if (!t) return;
      if (t.dataset.m === 'scope') {
        ui.all = t.dataset.v === 'all';
        if (library.key !== (ui.all ? 'all' : course.level)) library.items = null;
        rerender();
        loadLibrary(course, ui.all).then(function () { rerender(); }).catch(function (err) { ui.error = 'Ans Key could not be read: ' + ((err && err.message) || err); rerender(); });
        return;
      }
      if (t.dataset.m === 'use' && ui.source) run(rerender, close);
    }, function () {
      var input = $('libSearch');
      if (input) input.addEventListener('input', function () {
        ui.query = input.value;
        keepScroll(function () { modal.rerender(); });
        var again = $('libSearch');
        if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (err) {} }
      });
    });
    function keepScroll(rerender) {
      var listEl = $('libList');
      var top = listEl ? listEl.scrollTop : 0;
      rerender();
      var after = $('libList');
      if (after) after.scrollTop = top;
    }
    async function run(rerender, close) {
      var bring = { answers: !!ui.bring.answers, videos: !!ui.bring.videos };
      ui.phase = 'saving'; rerender();
      try {
        var srcSnap = await db.collection(WORKSHEETS).doc(ui.source).get();
        var tgtSnap = await db.collection(WORKSHEETS).doc(targetId).get();
        if (!srcSnap.exists) throw new Error('that worksheet is no longer in Ans Key');
        if (!tgtSnap.exists) throw new Error('this worksheet is no longer in Ans Key');
        var src = srcSnap.data(), tgt = tgtSnap.data();
        var merged = Core.mergeAnnotations(await readAnnotationsText(tgt), await readAnnotationsText(src), bring);
        var data = await writeAnnotationsFor(targetId, tgt, merged.json);
        if (bring.answers) {
          var keys = Core.mergeAnswerKeyMaps(tgt, src);
          if (Object.keys(keys).length) data.answerKeys = keys;
        }
        data.onlineAnswersFrom = bring.answers ? ui.source : (tgt.onlineAnswersFrom || '');
        if (bring.videos) data.onlineVideosFrom = ui.source;
        await db.collection(WORKSHEETS).doc(targetId).set(data, { merge: true });
        close();
        var bits = [];
        if (bring.answers) bits.push(merged.answers ? 'its answer key' : 'its (empty) answer key');
        if (bring.videos) bits.push(merged.videos ? merged.videos + ' video' + (merged.videos === 1 ? '' : 's') : 'no new videos');
        toast('“' + targetName + '” now uses ' + bits.join(' and ') + ' from “' + (src.name || 'Untitled') + '”.', { ms: 6000 });
      } catch (err) {
        ui.phase = 'pick'; rerender();
        fail('Could not copy across', err);
      }
    }
    loadLibrary(course, false).then(function () { modal.rerender(); }).catch(function (err) {
      ui.error = 'Ans Key could not be read: ' + ((err && err.message) || err);
      modal.rerender();
    });
    return modal;
  }

  /* ================= Modal ================= */
  function openModal(build, onClick, afterBuild) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    var box = document.createElement('div');
    box.className = 'modal';
    back.appendChild(box);
    function rerender() {
      var active = document.activeElement && document.activeElement.id;
      box.innerHTML = build();
      if (afterBuild) afterBuild();
      if (active && $(active)) $(active).focus();
    }
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-modal-close]')) { close(); return; }
      if (onClick) onClick(e, rerender, close);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    rerender();
    var first = box.querySelector('input, button:not([data-modal-close])');
    if (first) first.focus();
    return { close: close, rerender: rerender };
  }

  // 🗂 A typed or shared #answers / #videos / #timeline picks that tab.
  window.addEventListener('hashchange', function () {
    var tab = Core.studentTab(location.hash);
    if (tab !== state.studentTab) { state.studentTab = tab; render(); }
  });
  // ← → move between the student tabs, as a tab list should.
  document.addEventListener('keydown', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.st-tab') : null;
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    var tabs = Core.STUDENT_TABS.map(function (t) { return t[0]; });
    var at = tabs.indexOf(el.dataset.tab);
    var to = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    e.preventDefault();
    setStudentTab(to);
    var again = document.getElementById('st-tab-' + to);
    if (again) again.focus();
  });

  /* ================= One click handler for the page ================= */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.closest('.modal-back')) return;
    var action = el.dataset.action, id = el.dataset.id;
    switch (action) {
      case 'sign-in': signIn(el); break;
      case 'sign-out': signOut(); break;
      case 'reload': location.reload(); break;
      case 'view': viewWorksheet(id, el); break;
      case 'replace-pdf': replacePdf(id); break;
      case 'download': downloadWorksheet(id, el); break;
      case 'print': printWorksheet(id, el); break;
      case 'answer-key': openAnskey(id, 'view'); break;
      case 'print-key': openAnskey(id, 'print-answers'); break;
      // 🎬 'video' / 'video-day' are links to watch.html: the browser follows them.
      case 'tab': state.adminTab = el.dataset.tab; state.courseId = null; render(); break;
      case 'student-tab': setStudentTab(el.dataset.tab); break;
      case 'new-course': courseForm(null); break;
      case 'open-course': state.courseId = id; state.uploads = []; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'close-course': state.courseId = null; render(); break;
      case 'edit-course': courseForm(state.courses[state.courseId]); break;
      case 'duplicate-course': duplicateCourse(state.courses[state.courseId]); break;
      case 'delete-course': deleteCourse(state.courses[state.courseId]); break;
      case 'move': moveWorksheet(Number(el.dataset.index), Number(el.dataset.delta)); break;
      case 'remove-ws': removeWorksheet(Number(el.dataset.index)); break;
      case 'archive-item': setArchived(el, true); break;
      case 'restore-item': setArchived(el, false); break;
      case 'browse-anskey': browseAnsKey(); break;
      case 'link-anskey': linkFromAnsKey(id); break;
      case 'step': {
        var input = $(el.dataset.target);
        if (input) input.value = Math.max(Number(input.min || 0), Math.min(Number(input.max || 999), Number(input.value || 0) + Number(el.dataset.delta)));
        break;
      }
      case 'set-current': setCurrent(el); break;
      case 'finish-current': finishCurrent(el); break;
      case 'set-release': setRelease(el); break;
      case 'draft-role': inviteDraft.role = el.dataset.role; render(); break;
      case 'draft-level':
        inviteDraft.level = el.dataset.level;
        inviteDraft.subjects = Core.cleanSubjects(inviteDraft.level, inviteDraft.subjects);
        if (!inviteDraft.subjects.length) inviteDraft.subjects = Core.levelSubjects(inviteDraft.level).slice();
        render(); break;
      case 'draft-subject': {
        var s = el.dataset.subject, list = inviteDraft.subjects.slice(), at = list.indexOf(s);
        if (at >= 0) list.splice(at, 1); else list.push(s);
        inviteDraft.subjects = Core.cleanSubjects(inviteDraft.level, list);
        render(); break;
      }
      case 'copy-link': copyInviteLink(id, el); break;
      case 'resend': resendInvite(id, el); break;
      case 'revoke': revokeInvite(id); break;
      case 'delete-invite': deleteInvite(id); break;
      case 'edit-member': editMember(id); break;
      case 'remove-member': setMemberAccess(id, false); break;
      case 'restore-member': setMemberAccess(id, true); break;
      case 'preview-start': state.preview = { level: 'P5', subjects: ['math', 'science'], name: 'Student', role: 'student' }; render(); break;
      case 'preview-course': {
        var c = state.courses[state.courseId];
        state.preview = { level: c.level, subjects: [c.subject], name: 'Student', role: 'student' };
        render(); window.scrollTo({ top: 0 }); break;
      }
      case 'preview-exit': state.preview = null; render(); break;
      case 'preview-subject': {
        var p = state.preview, sub = el.dataset.subject, i = p.subjects.indexOf(sub);
        if (i >= 0) { if (p.subjects.length > 1) p.subjects.splice(i, 1); } else p.subjects.push(sub);
        render(); break;
      }
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'previewLevel' && state.preview) {
      state.preview.level = el.value;
      state.preview.subjects = Core.cleanSubjects(el.value, state.preview.subjects);
      if (!state.preview.subjects.length) state.preview.subjects = Core.levelSubjects(el.value).slice();
      render();
    }
    if (el.dataset && el.dataset.actionChange === 'rename') renameWorksheet(el.dataset.id, el.value);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.actionChange === 'rename') e.target.blur();
  });
  $('signOutBtn').addEventListener('click', signOut);
  $('printBtn').addEventListener('click', function () { window.print(); });

  // For tests and the console.
  window.PolymathOnline = { version: APP_VERSION, state: state, render: render };
})();
