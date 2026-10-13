/* Polymath Online — the page. The rules it follows are in portal-core.js;
   what lives here is Firebase, the screens and the buttons.
   See the comment at the top of online/index.html for the data model. */
(function () {
  'use strict';

  var APP_VERSION = 'v1.0.1';
  var Core = window.PolymathOnlineCore;

  // Who runs the portal. Anyone else signs in as a student or a parent.
  var ONLINE_ADMINS = ['chungzhikai@gmail.com', 'elsielcr@gmail.com', 'admin@polymathlc.com.sg'];
  // The teacher whose Ans Key notebook a worksheet's AI features read.
  var TEACHER_EMAIL = 'chungzhikai@gmail.com';
  // Invitations always point at the public address, wherever they are sent from.
  var PORTAL_URL = 'https://polymathlc.com.sg/online/';
  var ANSKEY_URL = '../anskey/';
  var WORKSHEETS = 'pdfAnnotator';
  var STORAGE_DIR = 'pdf-annotator';
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
    adminTab: 'overview',
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
  function pdfUrl(id) {
    var d = state.docs[id];
    if (!d || !d.storagePath) return Promise.reject(new Error('This worksheet has no PDF yet.'));
    if (!pdfUrlCache[d.storagePath]) {
      pdfUrlCache[d.storagePath] = storage.ref(d.storagePath).getDownloadURL();
      pdfUrlCache[d.storagePath].catch(function () { delete pdfUrlCache[d.storagePath]; });
    }
    return pdfUrlCache[d.storagePath];
  }
  function pdfBlob(id) {
    var d = state.docs[id];
    if (!d || !d.storagePath) return Promise.reject(new Error('This worksheet has no PDF yet.'));
    if (!pdfBlobCache[d.storagePath]) {
      pdfBlobCache[d.storagePath] = pdfUrl(id).then(function (url) { return fetch(url); }).then(function (resp) {
        if (!resp.ok) throw new Error('download failed (HTTP ' + resp.status + ')');
        return resp.blob();
      }).then(function (blob) { return new Blob([blob], { type: 'application/pdf' }); });
      pdfBlobCache[d.storagePath].catch(function () { delete pdfBlobCache[d.storagePath]; });
    }
    return pdfBlobCache[d.storagePath];
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
    state.courses = {}; state.coursesLoaded = false; state.invites = []; state.members = [];
  }

  auth.onAuthStateChanged(function (user) {
    stopListening();
    state.user = user && !user.isAnonymous ? user : null;
    state.isAdmin = !!(state.user && isAdminEmail(state.user.email));
    state.member = null;
    state.accessError = '';
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
  // The invitation link, a member row, or an invitation to this email —
  // in that order. Anything else is a signed-in visitor with no access yet.
  async function resolveMembership(user) {
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
    var keep = active && active.id && $('app').contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
      ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    renderInner();
    if (keep && $(keep.id)) {
      var again = $(keep.id);
      if (again.value !== keep.value) again.value = keep.value;
      again.focus();
      try { if (keep.start != null) again.setSelectionRange(keep.start, keep.end); } catch (e) {}
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
    var subjects = Core.cleanSubjects(member.level, member.subjects);
    var first = String(member.name || (state.user && state.user.displayName) || '').split(' ')[0];
    var parent = member.role === 'parent';
    var html = '<div class="reveal">' +
      '<section class="welcome">' +
        '<div><div class="eyebrow">' + (preview ? 'Student view preview' : parent ? 'Parent view' : 'Your worksheets') + '</div>' +
        '<h1 class="page-title" style="margin-top:8px">' + (preview ? 'What a ' + h(member.level) + ' student sees' : 'Hello' + (first ? ', ' + h(first) : '') + ' 👋') + '</h1>' +
        '<p class="page-subtitle">' + (parent ? 'Your child\'s worksheets and answer keys, released as the class goes.' : 'New worksheets appear here on their own as your class goes.') + '</p>' +
        '<div class="chips">' + levelChip(member.level) + subjects.map(subjectChip).join('') + '</div></div>' +
      '</section>';
    if (!courses.length) {
      html += '<div class="card section empty"><div class="big">📚</div><h3>No classes yet</h3><p>Your ' + h(member.level) + ' worksheets will appear here as soon as the centre sets up your class.</p></div>';
      return html + '</div>';
    }
    html += '<div class="section">';
    courses.forEach(function (course) { html += classCardHtml(course); });
    html += '</div></div>';
    return html;
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
        '<div class="class-cta">' + (cur >= 0 ? '<a class="btn btn-sm" href="' + h(answerKeyUrl(ids[cur])) + '" target="_blank" rel="noopener" data-tooltip="Open this lesson\'s worksheet in the Ans Key app">This lesson\'s answer key</a>' : '') + '</div>' +
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
      html += '<div class="ws-list">';
      released.slice().reverse().forEach(function (w) {
        var tag = w.state === 'current' ? '<span class="chip chip-dark">This lesson</span>' : w.state === 'next' ? '<span class="chip chip-level">Up next</span>' : '';
        html += '<div class="ws-row' + (w.state === 'current' ? ' is-current' : w.state === 'next' ? ' is-next' : '') + '">' +
          '<div class="ws-num" aria-hidden="true">' + (w.seq + 1) + '</div>' +
          '<div><div class="ws-name">' + h(docName(w.id)) + '</div>' +
            '<div class="ws-sub"><span>Worksheet ' + (w.seq + 1) + '</span>' + (pagesLabel(w.id) ? '<span>· ' + h(pagesLabel(w.id)) + '</span>' : '') + tag + '</div></div>' +
          '<div class="ws-actions">' +
            '<button class="btn btn-sm btn-ghost" type="button" data-action="view" data-id="' + h(w.id) + '">View</button>' +
            '<button class="btn btn-sm" type="button" data-action="download" data-id="' + h(w.id) + '">Download</button>' +
            '<button class="btn btn-sm" type="button" data-action="print" data-id="' + h(w.id) + '">Print</button>' +
            '<a class="btn btn-sm btn-primary" href="' + h(answerKeyUrl(w.id)) + '" target="_blank" rel="noopener" data-tooltip="Opens in the Ans Key app">Answer key</a>' +
          '</div></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="empty" style="border-top:1px solid var(--border-subtle)"><p>No worksheets have been released yet. They appear here as your lessons begin.</p></div>';
    }
    if (locked > 0) {
      html += '<div class="locked-row"><div class="lock-icon" aria-hidden="true">🔒</div><div><b style="color:var(--text-secondary)">' + locked + ' more worksheet' + (locked === 1 ? '' : 's') + '</b> unlock as the class goes. Nothing to do, they appear here on their own.</div></div>';
    }
    return html + '</article>';
  }
  function afterStudentRender(member) {
    var ids = [];
    Core.coursesForMember(state.courses, member).forEach(function (c) {
      Core.releasedWorksheets(c).forEach(function (w) { ids.push(w.id); });
    });
    ensureDocs(ids);
  }
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
      '</button>';
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
        '<p class="page-subtitle">' + total + ' worksheet' + (total === 1 ? '' : 's') + ' in teaching order. Opening one in Ans Key moves the class there.</p></div>' +
        '<div class="row"><button class="btn btn-sm" type="button" data-action="edit-course">Edit class</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-action="delete-course">Delete class</button></div></div>' +
      '<div class="control-strip">' +
        '<div class="card control"><div class="label">Class is on</div><div class="big">' + (cur >= 0 ? 'Worksheet ' + (cur + 1) : 'Not started') + '</div>' +
          '<div class="stepper"><button class="btn btn-xs" type="button" data-action="step" data-target="currentInput" data-delta="-1" aria-label="Earlier">−</button>' +
          '<input id="currentInput" type="number" min="1" max="' + Math.max(1, total) + '" value="' + Math.max(1, cur + 1) + '" aria-label="Worksheet the class is on">' +
          '<button class="btn btn-xs" type="button" data-action="step" data-target="currentInput" data-delta="1" aria-label="Later">+</button>' +
          '<button class="btn btn-xs btn-primary" type="button" data-action="set-current"' + (total ? '' : ' disabled') + '>Set</button></div>' +
          '<div class="small muted" style="margin-top:8px">Releases up to ' + Core.RELEASE_AHEAD + ' ahead, as Ans Key does.</div></div>' +
        '<div class="card control"><div class="label">Released to students</div><div class="big">' + (rel >= 0 ? 'Up to ' + (rel + 1) : 'None yet') + '</div>' +
          '<div class="stepper"><button class="btn btn-xs" type="button" data-action="step" data-target="releaseInput" data-delta="-1" aria-label="Fewer">−</button>' +
          '<input id="releaseInput" type="number" min="0" max="' + total + '" value="' + (rel + 1) + '" aria-label="Release up to worksheet">' +
          '<button class="btn btn-xs" type="button" data-action="step" data-target="releaseInput" data-delta="1" aria-label="More">+</button>' +
          '<button class="btn btn-xs btn-primary" type="button" data-action="set-release"' + (total ? '' : ' disabled') + '>Set</button></div>' +
          '<div class="small muted" style="margin-top:8px">0 hides them all. Never lower than the class position.</div></div>' +
        '<div class="card control"><div class="label">Students see</div><div class="big">' + Core.releasedCount(course) + ' <span class="small muted">of ' + total + '</span></div>' +
          '<div class="small muted" style="margin-top:10px">' + countSeeing(course) + '</div>' +
          '<button class="btn btn-xs" type="button" data-action="preview-course" style="margin-top:10px">👁 Preview as a student</button></div>' +
      '</div>';
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Add worksheets</h2>' +
      '<div class="section-note">Upload the full list once. Files are added in name order (Worksheet 2 before Worksheet 10), after any already here.</div></div>' +
      '<button class="btn" type="button" data-action="add-existing">Add from Ans Key</button></div>' +
      '<label class="dropzone" id="dropzone" for="fileInput"><input id="fileInput" type="file" accept="application/pdf,.pdf" multiple class="visually-hidden">' +
        '<div style="font-size:1.6rem">📄</div><div style="margin-top:6px"><b>Drop PDFs here</b> or click to choose files</div>' +
        '<div class="small muted" style="margin-top:4px">Each one becomes a worksheet in Ans Key, ready for you to write its answer key.</div>' +
        uploadsHtml() + '</label></div>';
    html += '<div class="section"><div class="section-head"><div><h2 class="section-heading">Teaching order</h2><div class="section-note">Rename in place, reorder with the arrows, or open one in Ans Key.</div></div></div>';
    if (!total) html += '<div class="card empty"><p>No worksheets in this class yet.</p></div>';
    else {
      html += '<div class="card seq-list">';
      ids.forEach(function (id, i) {
        var st = Core.worksheetState(course, i);
        var status = st === 'current' ? '<span class="chip chip-dark">Class is here</span>' : i <= rel ? '<span class="chip chip-ok">Released</span>' : '<span class="chip">Waiting</span>';
        html += '<div class="seq-row' + (st === 'current' ? ' is-current' : i <= rel ? ' is-released' : '') + '">' +
          '<div class="ws-num">' + (i + 1) + '</div>' +
          '<div><input class="name-edit" id="name-' + h(id) + '" type="text" value="' + h(docName(id)) + '" data-action-change="rename" data-id="' + h(id) + '" aria-label="Name of worksheet ' + (i + 1) + '">' +
            '<div class="ws-sub" style="padding-left:8px">' + (pagesLabel(id) ? h(pagesLabel(id)) : '') + '</div></div>' +
          '<div class="seq-status">' + status + '</div>' +
          '<div class="seq-tools">' +
            '<button class="btn btn-xs" type="button" data-action="move" data-index="' + i + '" data-delta="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="btn btn-xs" type="button" data-action="move" data-index="' + i + '" data-delta="1" aria-label="Move down"' + (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
            '<a class="btn btn-xs" href="' + h(answerKeyUrl(id)) + '" target="_blank" rel="noopener" data-tooltip="Open in Ans Key">Ans Key</a>' +
            '<button class="btn btn-xs" type="button" data-action="view" data-id="' + h(id) + '" aria-label="View PDF">PDF</button>' +
            '<button class="btn btn-xs btn-danger" type="button" data-action="remove-ws" data-index="' + i + '" aria-label="Remove from class">✕</button>' +
          '</div></div>';
      });
      html += '</div>';
    }
    return html + '</div></div>';
  }
  function countSeeing(course) {
    var n = state.members.filter(function (m) { return !m.revoked && Core.memberSees(m, course); }).length;
    return n === 0 ? 'No joined students or parents match this class yet.' : n + ' joined student' + (n === 1 ? '' : 's') + ' and parents match this class.';
  }
  function uploadsHtml() {
    if (!state.uploads.length) return '';
    return '<div class="upload-list">' + state.uploads.map(function (u) {
      return '<div class="upload-item"><span>' + h(u.name) + ' <span class="muted small">' + h(u.state) + '</span></span>' +
        '<div class="progress"><div class="done" style="width:' + u.pct + '%"></div></div></div>';
    }).join('') + '</div>';
  }
  function afterAdminRender() {
    if (state.courseId && state.courses[state.courseId]) {
      ensureDocs(Core.courseIds(state.courses[state.courseId]));
      var input = $('fileInput'), zone = $('dropzone');
      if (input) input.addEventListener('change', function () { uploadFiles(Array.from(input.files || [])); input.value = ''; });
      if (zone) {
        ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); }); });
        ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); }); });
        zone.addEventListener('drop', function (e) { uploadFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || [])); });
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
      var newIds = makeIds(oldIds.slice());
      var progress = Core.remapProgress(course, newIds);
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
      await db.collection(WORKSHEETS).doc(id).set({ name: name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
    var rel = Math.max(n - 1, cur);
    if (rel !== n - 1) toast('Kept at worksheet ' + (cur + 1) + ', where the class is.');
    busy(button, true);
    try {
      await db.collection(COURSES).doc(course.id).set({ releasedThrough: rel, releasedAt: FieldValue.serverTimestamp(), releasedBy: state.user.email }, { merge: true });
      busy(button, false); done(button, 'Set');
    } catch (err) { busy(button, false); fail('Could not change the release', err); }
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
  async function uploadFiles(files) {
    var course = state.courses[state.courseId];
    if (!course) return;
    var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    var refused = files.length - pdfs.length;
    if (refused) toast(refused + ' file' + (refused === 1 ? ' is' : 's are') + ' not a PDF and ' + (refused === 1 ? 'was' : 'were') + ' skipped.', { error: true });
    pdfs = pdfs.filter(function (f) {
      if (f.size > MAX_PDF_BYTES) { toast(f.name + ' is larger than 60 MB and was skipped.', { error: true }); return false; }
      return true;
    }).sort(function (a, b) { return Core.naturalCompare(a.name, b.name); });
    if (!pdfs.length) return;
    var courseId = course.id;
    var items = pdfs.map(function (f) { return { name: f.name, pct: 0, state: 'waiting' }; });
    state.uploads = items;
    render();
    var added = [];
    for (var i = 0; i < pdfs.length; i++) {
      var file = pdfs[i], item = items[i];
      try {
        item.state = 'reading'; render();
        var pageCount = await countPages(file);
        var ref = db.collection(WORKSHEETS).doc();
        var path = STORAGE_DIR + '/' + ref.id + '.pdf';
        item.state = 'uploading';
        await new Promise(function (resolve, reject) {
          var task = storage.ref(path).put(file, { contentType: 'application/pdf' });
          task.on('state_changed', function (snap) {
            item.pct = snap.totalBytes ? Math.round(95 * snap.bytesTransferred / snap.totalBytes) : 50;
            var bar = document.querySelectorAll('.upload-item .done')[i];
            if (bar) bar.style.width = item.pct + '%';
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
          onlineSeq: Core.courseIds(course).length + added.length,
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
        added.push(ref.id);
        item.pct = 100; item.state = 'added';
      } catch (err) {
        item.state = 'failed: ' + ((err && err.message) || 'error');
        console.error('Upload failed', file.name, err);
      }
      render();
    }
    if (added.length) {
      try {
        await saveOrder(courseId, function (ids) { return ids.concat(added.filter(function (id) { return ids.indexOf(id) < 0; })); }, { quiet: true });
        toast(added.length + ' worksheet' + (added.length === 1 ? '' : 's') + ' added to the class.');
      } catch (err) { fail('The files uploaded, but the class list could not be updated', err); }
    }
    setTimeout(function () { if (state.uploads === items) { state.uploads = []; render(); } }, 4000);
  }

  /* ---- Adding worksheets already in Ans Key ---- */
  async function addExisting() {
    var course = state.courses[state.courseId];
    if (!course) return;
    var candidates = [];
    var picked = [];
    var loading = true;
    var close = openModal(function () {
      var body;
      if (loading) body = '<div class="loader" style="padding:40px 0"><div class="spinner"></div><div>Finding ' + h(course.level) + ' ' + h(Core.subjectLabel(course.subject)) + ' worksheets…</div></div>';
      else if (!candidates.length) body = '<div class="empty"><p>No other ' + h(course.level) + ' ' + h(Core.subjectLabel(course.subject)) + ' worksheets in Ans Key that are not already in a class.</p></div>';
      else body = '<div class="pick-list">' + candidates.map(function (c) {
        var at = picked.indexOf(c.id);
        return '<label class="pick-row"><input type="checkbox" data-pick="' + h(c.id) + '"' + (at >= 0 ? ' checked' : '') + '><div><div style="font-weight:600">' + h(c.data.name || 'Untitled') + '</div>' +
          '<div class="small muted">' + h([c.data.wsDay, c.data.wsDate, c.data.pageCount ? c.data.pageCount + ' pages' : ''].filter(Boolean).join(' · ')) + '</div></div>' +
          (at >= 0 ? '<span class="ord">#' + (Core.courseIds(course).length + at + 1) + '</span>' : '') + '</label>';
      }).join('') + '</div>';
      return '<div class="modal-head"><div><div class="eyebrow">Add from Ans Key</div><h2>Worksheets already uploaded</h2><div class="small muted" style="margin-top:4px">They are added in the order you tick them.</div></div><button class="btn btn-ghost btn-icon" type="button" data-modal-close aria-label="Close">✕</button></div>' +
        body + '<div class="modal-foot"><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button><button class="btn btn-primary" type="button" data-m="add"' + (picked.length ? '' : ' disabled') + '>Add ' + (picked.length || '') + ' to the class</button></div>';
    }, function (e, rerender, closeModal) {
      var box = e.target.closest('[data-pick]');
      if (box) {
        var id = box.dataset.pick, i = picked.indexOf(id);
        if (box.checked && i < 0) picked.push(id);
        if (!box.checked && i >= 0) picked.splice(i, 1);
        rerender();
        return;
      }
      var t = e.target.closest('[data-m="add"]');
      if (!t || !picked.length) return;
      busy(t, true);
      picked.forEach(function (id) { var c = candidates.find(function (x) { return x.id === id; }); if (c) state.docs[id] = c.data; });
      saveOrder(course.id, function (ids) { return ids.concat(picked.filter(function (id) { return ids.indexOf(id) < 0; })); }, { quiet: true })
        .then(function () { closeModal(); toast(picked.length + ' worksheet' + (picked.length === 1 ? '' : 's') + ' added.'); })
        .catch(function (err) { busy(t, false); fail('Could not add them', err); });
    });
    try {
      var snap = await db.collection(WORKSHEETS).where('level', '==', course.level).limit(500).get();
      snap.forEach(function (doc) {
        var d = doc.data();
        if (d.onlineCourseId) return;
        if (d.subject !== course.subject && d.subject !== 'both') return;
        candidates.push({ id: doc.id, data: d });
      });
      candidates.sort(function (a, b) {
        var da = a.data.wsDate || '', dbb = b.data.wsDate || '';
        if (da !== dbb) return da < dbb ? -1 : 1;
        return Core.naturalCompare(a.data.name, b.data.name);
      });
    } catch (err) { fail('Could not list the worksheets', err); }
    loading = false;
    close.rerender();
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
      case 'download': downloadWorksheet(id, el); break;
      case 'print': printWorksheet(id, el); break;
      case 'tab': state.adminTab = el.dataset.tab; state.courseId = null; render(); break;
      case 'new-course': courseForm(null); break;
      case 'open-course': state.courseId = id; state.uploads = []; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'close-course': state.courseId = null; render(); break;
      case 'edit-course': courseForm(state.courses[state.courseId]); break;
      case 'delete-course': deleteCourse(state.courses[state.courseId]); break;
      case 'move': moveWorksheet(Number(el.dataset.index), Number(el.dataset.delta)); break;
      case 'remove-ws': removeWorksheet(Number(el.dataset.index)); break;
      case 'add-existing': addExisting(); break;
      case 'step': {
        var input = $(el.dataset.target);
        if (input) input.value = Math.max(Number(input.min || 0), Math.min(Number(input.max || 999), Number(input.value || 0) + Number(el.dataset.delta)));
        break;
      }
      case 'set-current': setCurrent(el); break;
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
