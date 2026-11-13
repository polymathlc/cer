/*
  POLYMATH STUDENT ACCESS GATE  (v1.1.0, November 2026)
  ======================================================
  One script, loaded by every student app — Science (/cer), Math, Answer Keys,
  Study Buddy, Rewards, English, Chinese, Worksheets (/online) and the My
  Polymath dashboard (/student) — so the same pop-up appears the first time a
  student signs in ANYWHERE, including at the polymathlc.github.io/... addresses.

      <script defer src="https://polymathlc.github.io/cer/student/access-gate.js" data-app="math"></script>

  WHAT IT DOES
  • It waits for the page's own Firebase sign-in (the apps all share the one
    project, mathgen--app): the compat SDK (window.firebase) or the modular
    11.10.0 SDK (the very same module URL the page imports, so the same instance).
    It never signs anybody in or out by itself and never touches the page's
    Firestore: it talks to Firestore over REST with the student's own ID token.
  • Nobody signed in, an anonymous guest (share links / question QRs), or a
    staff account (the three access admins plus the teachers listed in STAFF,
    with a verified email) → nothing happens.
  • Anybody else → their record studentAccess/{uid} decides:
        none      the enrolment pop-up: still enrolled? parent's name and email,
                  how many children, each child's full name, level and subjects
                  (Math only / Science only / Both Math and Science)
        pending   "Waiting for approval" — checks again every 30 s and unlocks
                  by itself the moment an admin approves
        revoked   "Access paused" — may update the details and ask again
        approved  the app opens; the answer is remembered on the device so the
                  next visit opens at once, and checked again in the background
    The pop-up covers the whole app and the page behind it is made inert.
  • SUBJECTS (v1.1.0). A page that belongs to one subject says so on its tag:

      <script defer src="…/access-gate.js" data-app="math" data-subject="math"></script>

    An approved account only opens it when one of its children is approved for
    that subject (Math only / Science only / Both). Otherwise the "not in your
    subjects" screen shows, with a link back to My Polymath. Pages with no
    data-subject (Study Buddy, English, Chinese, Answer Keys, Rewards, the
    worksheets portal) open for every approved account. The admins change a
    child's subjects at polymathlc.com.sg/student/#admin and the app follows:
    the screen checks again whenever the student comes back to the tab.
  • The admins approve, revoke and edit at polymathlc.com.sg/student/#admin.

  WHY IT IS SAFE TO SHIP BEFORE THE RULES
  The record is protected by the Firestore rules block "polymath-student-access-v1"
  (tools/student-access-rules.mjs): a student may only ever write their own form
  as "pending"; only the admins can approve. Until that block is published the
  shared catch-all would leave parents' details open, so the gate first checks
  that a signed-out read of studentAccess is REFUSED and stays switched off
  (collects nothing, blocks nothing) until it is.

  Tests: tools/student-access-tests.mjs (logic, rules, every app's script tag).
*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : this;
  if (root.PolymathAccess && root.PolymathAccess.version) return;   // loaded twice: the first one wins

  var VERSION = '1.1.0';
  var PROJECT = 'mathgen--app';
  var API_KEY = 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo';
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  var SDK = 'https://www.gstatic.com/firebasejs/11.10.0/';
  // Keep equal to ACCESS_ADMINS in tools/student-access-rules.mjs (a test checks).
  var ACCESS_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
  // Never asked for the form: the admins and the centre's own teachers / staff.
  var STAFF = ACCESS_ADMINS.concat(['elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com']);
  // Keep equal to ACCESS_MAIL in tools/student-access-rules.mjs (a test checks).
  var ACCESS_MAIL = {
    to: ['admin@polymathlc.com.sg'],
    cc: ['support@polymathlc.com.sg'],
    from: 'Polymath Learning Centre <admin@polymathlc.com.sg>'
  };
  var ADMIN_PAGE = 'https://polymathlc.com.sg/student/#admin';
  var WHATSAPP_NUMBER = '+65 9645 0588';
  var WHATSAPP_LINK = 'https://wa.me/6596450588';
  var MAX_CHILDREN = 8;
  var MAX_MAILS = 9;
  var RECHECK_PENDING_MS = 30000;
  var CACHE_PREFIX = 'polymath-access-v1:';
  var PROTECTED_KEY = 'polymath-access-protected-v1';

  var LEVELS = [
    ['P1', 'Primary 1'], ['P2', 'Primary 2'], ['P3', 'Primary 3'], ['P4', 'Primary 4'],
    ['P5', 'Primary 5'], ['P6', 'Primary 6'], ['S1', 'Secondary 1'], ['S2', 'Secondary 2'],
    ['S3', 'Secondary 3'], ['S4', 'Secondary 4'], ['S5', 'Secondary 5'], ['Other', 'Other']
  ];
  var SUBJECTS = [['math', 'Math only'], ['science', 'Science only'], ['both', 'Both Math and Science']];
  // The subjects a page can belong to (data-subject on its tag).
  var APP_SUBJECTS = [['math', 'Math'], ['science', 'Science']];
  var DASHBOARD = 'https://polymathlc.com.sg/student/';

  /* ================================================================== */
  /*  Pure logic (no DOM, no network) — exported as PolymathAccess.core  */
  /* ================================================================== */

  function isDate(value) { return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime()); }

  function lower(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

  function cleanText(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }

  function isEmail(value) {
    var text = String(value == null ? '' : value).trim();
    return text.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text);
  }

  function levelLabel(key) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === key) return LEVELS[i][1];
    return key ? String(key) : '';
  }

  function subjectsLabel(key) {
    for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i][0] === key) return SUBJECTS[i][1];
    return key ? String(key) : '';
  }

  function isAccessAdmin(email, verified) {
    return verified === true && ACCESS_ADMINS.indexOf(lower(email)) >= 0;
  }

  function isStaff(email, verified) {
    return verified === true && STAFF.indexOf(lower(email)) >= 0;
  }

  /** Who the gate must ask: a real (non-anonymous) account that is not staff. */
  function needsGate(user) {
    if (!user || !user.uid) return false;
    if (user.isAnonymous) return false;
    if (isStaff(user.email, user.emailVerified)) return false;
    return true;
  }

  function statusOf(record) {
    if (!record) return 'none';
    var status = lower(record.status);
    if (status === 'approved' || status === 'pending' || status === 'revoked') return status;
    return 'pending';
  }

  /** "math" / "science" for a page's data-subject; anything else means "any subject". */
  function cleanAppSubject(value) {
    var key = lower(value);
    return key === 'math' || key === 'science' ? key : '';
  }

  function appSubjectLabel(key) {
    for (var i = 0; i < APP_SUBJECTS.length; i++) if (APP_SUBJECTS[i][0] === key) return APP_SUBJECTS[i][1];
    return key ? String(key) : '';
  }

  /** One child's choice ("math" | "science" | "both") → the subjects it opens. */
  function subjectsOfChoice(choice) {
    var key = lower(choice);
    if (key === 'both') return ['math', 'science'];
    if (key === 'math' || key === 'science') return [key];
    return [];
  }

  /**
   * Every subject the record's children are approved for, sorted: ["math"],
   * ["science"], ["math", "science"] or [] (a record with no usable children).
   */
  function approvedSubjects(record) {
    var out = [];
    var children = record && Array.isArray(record.children) ? record.children : [];
    children.forEach(function (child) {
      subjectsOfChoice(child && child.subjects).forEach(function (subject) {
        if (out.indexOf(subject) < 0) out.push(subject);
      });
    });
    return out.sort();
  }

  /** Every level on the record, in the order of LEVELS, without repeats. */
  function approvedLevels(record) {
    var seen = {};
    var children = record && Array.isArray(record.children) ? record.children : [];
    children.forEach(function (child) { if (child && child.level) seen[child.level] = true; });
    var out = [];
    LEVELS.forEach(function (pair) { if (seen[pair[0]]) out.push(pair[0]); });
    Object.keys(seen).forEach(function (level) { if (out.indexOf(level) < 0) out.push(level); });
    return out;
  }

  /**
   * Each child as { level, subjects: [...] } — what the worksheets portal (/online)
   * uses to decide which classes an account sees (a P4 Science child and a P6 Math
   * child see P4 Science and P6 Math, never P6 Science).
   */
  function approvedPairs(record) {
    var children = record && Array.isArray(record.children) ? record.children : [];
    var out = [];
    children.forEach(function (child) {
      var subjects = subjectsOfChoice(child && child.subjects);
      if (!child || !child.level || !subjects.length) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i].level === child.level) {
          subjects.forEach(function (s) { if (out[i].subjects.indexOf(s) < 0) out[i].subjects.push(s); });
          out[i].subjects.sort();
          return;
        }
      }
      out.push({ level: String(child.level), subjects: subjects.slice().sort() });
    });
    return out;
  }

  /** May an approved record open a page of this subject? (No subject → yes.) */
  function subjectAllowed(record, subject) {
    var key = cleanAppSubject(subject);
    if (!key) return true;
    return approvedSubjects(record).indexOf(key) >= 0;
  }

  /** A cached subject list (from localStorage) → a clean list, or null if unknown. */
  function cleanSubjectList(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    list.forEach(function (s) { var key = cleanAppSubject(s); if (key && out.indexOf(key) < 0) out.push(key); });
    return out.sort();
  }

  /**
   * Check the pop-up's answers and turn them into the record the rules accept.
   * input: { enrolled, parentName, parentEmail, childCount, children: [{name, level, subjects}] }
   * Returns { ok, errors: { field: message }, record }.
   */
  function validateForm(input, user, options) {
    input = input || {};
    options = options || {};
    var errors = {};
    var enrolled = input.enrolled === true;
    if (!enrolled) errors.enrolled = 'Please confirm that your child is still enrolled with us.';
    var parentName = cleanText(input.parentName, 120);
    if (parentName.length < 2) errors.parentName = "Please type the parent's full name.";
    var parentEmail = cleanText(input.parentEmail, 200).toLowerCase();
    if (!isEmail(parentEmail)) errors.parentEmail = "Please type the parent's email address, like name@gmail.com.";
    var count = parseInt(input.childCount, 10);
    if (!(count >= 1 && count <= MAX_CHILDREN)) { errors.childCount = 'Please choose how many children are enrolled.'; count = 0; }
    var given = Array.isArray(input.children) ? input.children : [];
    var children = [];
    for (var i = 0; i < count; i++) {
      var child = given[i] || {};
      var name = cleanText(child.name, 120);
      var level = String(child.level || '');
      var subjects = String(child.subjects || '');
      var validLevel = LEVELS.some(function (pair) { return pair[0] === level; });
      var validSubjects = SUBJECTS.some(function (pair) { return pair[0] === subjects; });
      if (name.length < 2) errors['child' + i + 'name'] = 'Please type this child\'s full name.';
      if (!validLevel) errors['child' + i + 'level'] = 'Please choose a level.';
      if (!validSubjects) errors['child' + i + 'subjects'] = 'Please choose the subjects.';
      children.push({ name: name, level: validLevel ? level : '', subjects: validSubjects ? subjects : '' });
    }
    var ok = Object.keys(errors).length === 0;
    var record = null;
    if (ok && user) {
      record = {
        uid: String(user.uid),
        email: lower(user.email).slice(0, 200),
        status: 'pending',
        enrolled: true,
        parentName: parentName,
        parentEmail: parentEmail,
        childCount: count,
        children: children,
        submittedAt: isDate(options.now) ? options.now : new Date(),
        app: cleanText(options.app || 'unknown', 40),
        submissions: Math.max(1, Math.min(50, (parseInt(options.previousSubmissions, 10) || 0) + 1))
      };
    }
    return { ok: ok, errors: errors, record: record };
  }

  /** The plain-text email the centre receives for a new (or repeated) request. */
  function buildMail(record) {
    if (!record || !(record.submissions >= 1 && record.submissions <= MAX_MAILS)) return null;
    var lines = [
      (record.submissions > 1 ? 'An updated' : 'A new') + ' request for access to the Polymath apps is waiting for approval.',
      '',
      'Parent: ' + record.parentName,
      'Parent email: ' + record.parentEmail,
      'Signed in as: ' + (record.email || '(no email on the account)'),
      'Sent from: ' + record.app,
      'Children (' + record.childCount + '):'
    ];
    for (var i = 0; i < record.children.length; i++) {
      var child = record.children[i];
      lines.push('  ' + (i + 1) + '. ' + child.name + ' — ' + levelLabel(child.level) + ' — ' + subjectsLabel(child.subjects));
    }
    lines.push('', 'They confirmed that they are still enrolled at Polymath Learning Centre.', '',
      'Approve or decline: ' + ADMIN_PAGE);
    var subject = 'Student access request: ' + record.parentName + ' (' + record.childCount + (record.childCount === 1 ? ' child)' : ' children)');
    return {
      id: 'polymath-access-' + record.uid + '-' + record.submissions,
      data: {
        to: ACCESS_MAIL.to.slice(),
        cc: ACCESS_MAIL.cc.slice(),
        from: ACCESS_MAIL.from,
        replyTo: record.parentEmail,
        message: { subject: subject.slice(0, 200), text: lines.join('\n').slice(0, 6000) }
      }
    };
  }

  /* ---- Firestore REST values ---- */
  function encodeValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (isDate(value)) return { timestampValue: value.toISOString() };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(encodeValue) } : {} };
    if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
    return { stringValue: String(value) };
  }

  function encodeFields(object) {
    var fields = {};
    Object.keys(object || {}).forEach(function (key) {
      if (object[key] !== undefined) fields[key] = encodeValue(object[key]);
    });
    return fields;
  }

  function decodeValue(value) {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('booleanValue' in value) return value.booleanValue === true;
    if ('timestampValue' in value) return value.timestampValue;
    if ('nullValue' in value) return null;
    if ('arrayValue' in value) return ((value.arrayValue && value.arrayValue.values) || []).map(decodeValue);
    if ('mapValue' in value) return decodeFields((value.mapValue && value.mapValue.fields) || {});
    if ('referenceValue' in value) return value.referenceValue;
    if ('geoPointValue' in value) return value.geoPointValue;
    return null;
  }

  function decodeFields(fields) {
    var object = {};
    Object.keys(fields || {}).forEach(function (key) { object[key] = decodeValue(fields[key]); });
    return object;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var core = {
    VERSION: VERSION, ACCESS_ADMINS: ACCESS_ADMINS, STAFF: STAFF, ACCESS_MAIL: ACCESS_MAIL,
    LEVELS: LEVELS, SUBJECTS: SUBJECTS, MAX_CHILDREN: MAX_CHILDREN, MAX_MAILS: MAX_MAILS,
    lower: lower, cleanText: cleanText, isEmail: isEmail, levelLabel: levelLabel, subjectsLabel: subjectsLabel,
    isAccessAdmin: isAccessAdmin, isStaff: isStaff, needsGate: needsGate, statusOf: statusOf,
    validateForm: validateForm, buildMail: buildMail,
    APP_SUBJECTS: APP_SUBJECTS, cleanAppSubject: cleanAppSubject, appSubjectLabel: appSubjectLabel,
    subjectsOfChoice: subjectsOfChoice, approvedSubjects: approvedSubjects, approvedLevels: approvedLevels,
    approvedPairs: approvedPairs, subjectAllowed: subjectAllowed, cleanSubjectList: cleanSubjectList,
    encodeValue: encodeValue, encodeFields: encodeFields, decodeValue: decodeValue, decodeFields: decodeFields,
    escapeHtml: escapeHtml
  };

  /* ================================================================== */
  /*  Storage (every access wrapped: private windows may refuse)          */
  /* ================================================================== */
  function readStore(store, key) {
    try { return root[store] ? root[store].getItem(key) : null; } catch (error) { return null; }
  }
  function writeStore(store, key, value) {
    try { if (root[store]) { if (value === null) root[store].removeItem(key); else root[store].setItem(key, value); } } catch (error) { /* fine */ }
  }
  /** { status, subjects } remembered on this device (subjects null when a v1.0 page saved it). */
  function cachedAccess(uid) {
    var raw = readStore('localStorage', CACHE_PREFIX + uid);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.status) return null;
      return { status: parsed.status, subjects: cleanSubjectList(parsed.subjects) };
    } catch (error) { return null; }
  }
  function cachedStatus(uid) {
    var cached = cachedAccess(uid);
    return cached ? cached.status : null;
  }
  function rememberStatus(uid, status, subjects) {
    var value = null;
    if (status) {
      value = { status: status, at: Date.now() };
      if (Array.isArray(subjects)) value.subjects = cleanSubjectList(subjects);
    }
    writeStore('localStorage', CACHE_PREFIX + uid, value ? JSON.stringify(value) : null);
  }

  /* ================================================================== */
  /*  State                                                               */
  /* ================================================================== */
  var APP = 'unknown';
  var APP_SUBJECT = '';      // data-subject on the tag: 'math', 'science' or '' (any)
  var state = { phase: 'idle', user: null, record: null, error: '', protected: null };
  var listeners = [];
  var adapter = null;
  var recheckTimer = null;
  var runToken = 0;
  var draft = null;          // what the student has typed so far (survives re-renders)
  var editing = false;       // pending / revoked student chose "Edit my details"
  var busy = false;

  function publicState() {
    return {
      phase: state.phase,
      email: state.user ? state.user.email || '' : '',
      uid: state.user ? state.user.uid : '',
      isAdmin: !!(state.user && isAccessAdmin(state.user.email, state.user.emailVerified)),
      record: state.record,
      protected: state.protected,
      appSubject: APP_SUBJECT,
      subjects: state.record && statusOf(state.record) === 'approved' ? approvedSubjects(state.record) : [],
      levels: state.record ? approvedLevels(state.record) : [],
      pairs: state.record && statusOf(state.record) === 'approved' ? approvedPairs(state.record) : []
    };
  }

  function setPhase(phase, extra) {
    state.phase = phase;
    if (extra) Object.keys(extra).forEach(function (key) { state[key] = extra[key]; });
    render();
    var snapshot = publicState();
    listeners.slice().forEach(function (fn) { try { fn(snapshot); } catch (error) { /* a listener's bug is its own */ } });
  }

  /* ================================================================== */
  /*  Network (Firestore REST, the student's own ID token)                */
  /* ================================================================== */
  function http(url, options) {
    return root.fetch(url, options).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (error) { body = null; }
        return { status: response.status, ok: response.ok, body: body };
      });
    });
  }

  function docUrl(path, extra) {
    return DOCS + '/' + path + '?key=' + encodeURIComponent(API_KEY) + (extra || '');
  }

  /** Is the student-access block published? A signed-out read must be refused. */
  function checkProtected() {
    if (readStore('localStorage', PROTECTED_KEY) === '1') return Promise.resolve(true);
    return http(docUrl('studentAccess/protection-probe'), { method: 'GET', cache: 'no-store' }).then(function (answer) {
      if (answer.status === 403 || answer.status === 401) { writeStore('localStorage', PROTECTED_KEY, '1'); return true; }
      if (answer.status === 200 || answer.status === 404) return false;
      throw new Error('probe ' + answer.status);
    });
  }

  function token(user, force) {
    return Promise.resolve(user.getIdToken(!!force));
  }

  function fetchRecord(user) {
    return token(user).then(function (idToken) {
      return http(docUrl('studentAccess/' + encodeURIComponent(user.uid)), {
        method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer ' + idToken }
      });
    }).then(function (answer) {
      if (answer.status === 404) return null;
      if (answer.ok && answer.body) return decodeFields(answer.body.fields || {});
      var error = new Error('read ' + answer.status);
      error.status = answer.status;
      throw error;
    });
  }

  function saveRecord(user, record) {
    return token(user).then(function (idToken) {
      return http(docUrl('studentAccess/' + encodeURIComponent(user.uid)), {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(record) })
      });
    }).then(function (answer) {
      if (!answer.ok) {
        var error = new Error('save ' + answer.status);
        error.status = answer.status;
        throw error;
      }
      return decodeFields((answer.body && answer.body.fields) || {});
    });
  }

  function sendMail(user, record) {
    var mail = buildMail(record);
    if (!mail) return Promise.resolve(false);
    return token(user).then(function (idToken) {
      return http(DOCS + '/mail?documentId=' + encodeURIComponent(mail.id) + '&key=' + encodeURIComponent(API_KEY), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(mail.data) })
      });
    }).then(function (answer) { return answer.ok; }, function () { return false; });
  }

  /* ================================================================== */
  /*  The page's sign-in (compat or modular 11.10.0)                      */
  /* ================================================================== */
  function compatAdapter() {
    var fb = root.firebase;
    if (!fb || !fb.apps || !fb.apps.length || typeof fb.auth !== 'function') return null;
    var auth;
    try { auth = fb.auth(); } catch (error) { return null; }
    if (!auth || typeof auth.onAuthStateChanged !== 'function') return null;
    return {
      kind: 'compat',
      listen: function (fn) { return auth.onAuthStateChanged(fn); },
      signOut: function () { return auth.signOut(); }
    };
  }

  var modular = { loading: null, app: null, auth: null };
  function loadModular() {
    if (modular.loading) return modular.loading;
    modular.loading = Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js')])
      .then(function (modules) { modular.app = modules[0]; modular.auth = modules[1]; })
      .catch(function () { modular.app = null; modular.auth = null; });
    return modular.loading;
  }
  function modularAdapter() {
    if (!modular.app || !modular.auth) return null;
    var apps = [];
    try { apps = modular.app.getApps(); } catch (error) { return null; }
    var app = null;
    for (var i = 0; i < apps.length; i++) if (apps[i].name === '[DEFAULT]') app = apps[i];
    if (!app) return null;
    var auth;
    try { auth = modular.auth.getAuth(app); } catch (error) { return null; }
    return {
      kind: 'modular',
      listen: function (fn) { return modular.auth.onAuthStateChanged(auth, fn); },
      signOut: function () { return modular.auth.signOut(auth); }
    };
  }

  function findAuth(done) {
    var tries = 0;
    (function poll() {
      tries++;
      var found = compatAdapter() || modularAdapter();
      if (found) return done(found);
      // No compat SDK by now → the page is a modular one: load the same 11.10.0
      // modules it imports (the browser hands back the very same instances).
      if (tries === 2) loadModular();
      if (tries < 400) root.setTimeout(poll, tries < 40 ? 250 : 1000);
    })();
  }

  /* ================================================================== */
  /*  The check                                                           */
  /* ================================================================== */
  function onUser(user) {
    runToken++;
    var mine = runToken;
    stopRecheck();
    editing = false;
    state.record = null;
    state.error = '';
    if (!user) { state.user = null; return setPhase('idle'); }
    state.user = user;
    if (!needsGate(user)) return setPhase(user.isAnonymous ? 'guest' : 'staff');
    var remembered = cachedAccess(user.uid);
    // A student approved before opens at once (when this page's subject was one
    // of theirs last time); the check runs quietly behind and still decides.
    var opensAtOnce = !!(remembered && remembered.status === 'approved' &&
      (!APP_SUBJECT || !remembered.subjects || remembered.subjects.indexOf(APP_SUBJECT) >= 0));
    setPhase(opensAtOnce ? 'approved' : 'checking');
    check(mine, opensAtOnce);
  }

  function check(mine, quiet) {
    var user = state.user;
    if (!user) return;
    checkProtected().then(function (isProtected) {
      if (mine !== runToken) return;
      state.protected = isProtected;
      if (!isProtected) return setPhase('inactive');
      return fetchRecord(user).then(function (record) {
        if (mine !== runToken) return;
        var status = statusOf(record);
        rememberStatus(user.uid, status === 'none' ? null : status, status === 'approved' ? approvedSubjects(record) : null);
        state.record = record;
        if (status === 'approved') {
          if (!subjectAllowed(record, APP_SUBJECT)) { setPhase('subject'); return scheduleRecheck(); }
          return setPhase('approved');
        }
        if (status === 'none') { if (!draft) draft = draftFrom(null, user); return setPhase('form'); }
        if (!editing) draft = draftFrom(record, user);
        setPhase(status);
        if (status === 'pending') scheduleRecheck();
      });
    }).catch(function (error) {
      if (mine !== runToken) return;
      if (quiet) return;   // approved before: a network hiccup never locks them out
      setPhase('error', { error: describeError(error) });
    });
  }

  function describeError(error) {
    var status = error && error.status;
    if (status === 401 || status === 403) return 'Your sign-in could not be checked. Please sign out and sign in again.';
    if (root.navigator && root.navigator.onLine === false) return 'You seem to be offline. Connect to the internet, then press Try again.';
    return 'We could not reach Polymath just now. Please press Try again in a moment.';
  }

  function scheduleRecheck() {
    stopRecheck();
    recheckTimer = root.setTimeout(function () {
      if ((state.phase === 'pending' || state.phase === 'subject') && !editing) check(runToken, true);
    }, RECHECK_PENDING_MS);
  }
  function stopRecheck() { if (recheckTimer) { root.clearTimeout(recheckTimer); recheckTimer = null; } }

  function draftFrom(record, user) {
    var children = record && Array.isArray(record.children) ? record.children.map(function (child) {
      return { name: child && child.name || '', level: child && child.level || '', subjects: child && child.subjects || '' };
    }) : [{ name: '', level: '', subjects: '' }];
    var email = record && record.parentEmail ? record.parentEmail
      : (user && isEmail(user.email) && !/@students\.sciencequest\.app$/i.test(user.email) ? lower(user.email) : '');
    return {
      enrolled: false,
      parentName: record && record.parentName || (user && user.displayName) || '',
      parentEmail: email,
      childCount: record && record.childCount ? record.childCount : 1,
      children: children
    };
  }

  function submit() {
    if (busy || !state.user) return;
    readForm();
    var previous = state.record && state.record.submissions ? state.record.submissions : 0;
    var result = validateForm(draft, state.user, { app: APP, previousSubmissions: previous });
    if (!result.ok) { render(result.errors); focusFirstError(); return; }
    busy = true;
    render();
    var user = state.user, mine = runToken;
    saveRecord(user, result.record).then(function (saved) {
      busy = false;
      if (mine !== runToken) return;
      state.record = Object.keys(saved).length ? saved : result.record;
      editing = false;
      rememberStatus(user.uid, 'pending');
      sendMail(user, result.record);
      setPhase('pending');
      scheduleRecheck();
    }).catch(function (error) {
      busy = false;
      if (mine !== runToken) return;
      render({ form: error && (error.status === 403)
        ? 'Your details could not be saved. Please check every answer, then try again — or WhatsApp us on ' + WHATSAPP_NUMBER + '.'
        : describeError(error) });
    });
  }

  function signOut() {
    if (!adapter) return Promise.resolve();
    try { return Promise.resolve(adapter.signOut()); } catch (error) { return Promise.resolve(); }
  }

  /* ================================================================== */
  /*  The pop-up (its own shadow root: no app's CSS can reach it)         */
  /* ================================================================== */
  var host = null, shadow = null, observer = null, madeInert = false, savedOverflow = null;
  var BLOCKING = { checking: true, form: true, pending: true, revoked: true, error: true, subject: true };

  var STYLE = [
    ':host{all:initial}',
    '.veil{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;',
    '  padding:max(16px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom));box-sizing:border-box;',
    "  background:rgba(250,250,250,0.97);font-family:'Century Gothic',CenturyGothic,AppleGothic,'Segoe UI',Roboto,Arial,sans-serif;",
    '  color:#1A1A1A;-webkit-font-smoothing:antialiased;line-height:1.5;font-size:16px}',
    '*{box-sizing:border-box}',
    '.card{width:100%;max-width:640px;margin:24px auto;background:#FFFFFF;border:1px solid #E8E8E4;border-radius:22px;',
    '  box-shadow:0 4px 6px rgba(0,0,0,0.05),0 10px 30px rgba(0,0,0,0.1);padding:28px 24px;animation:rise .35s cubic-bezier(.34,1.56,.64,1)}',
    '@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.card{animation:none}}',
    '.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}',
    '.mark{width:40px;height:40px;border-radius:12px;background:#2E8B6B;color:#FFFFFF;display:grid;place-items:center;font-weight:700;font-size:20px;flex:none}',
    '.brand b{display:block;font-size:15px}.brand span{display:block;font-size:13px;color:#5C5C5C}',
    'h1{font-size:24px;line-height:1.25;margin:0 0 8px;letter-spacing:-0.01em}',
    'h2{font-size:17px;margin:22px 0 10px}',
    'p{margin:0 0 12px;color:#3D3D3D}',
    '.muted{color:#5C5C5C;font-size:14px}',
    '.who{display:inline-block;background:#F1F8F5;color:#0B6B4F;border-radius:999px;padding:2px 10px;font-size:14px;word-break:break-all}',
    'label.field{display:block;margin:14px 0 0;font-weight:600;font-size:15px}',
    'input[type=text],input[type=email],select{display:block;width:100%;margin-top:6px;padding:11px 12px;border:1.5px solid #D4D4CF;',
    '  border-radius:10px;font:inherit;font-weight:400;color:#1A1A1A;background:#FFFFFF;min-height:46px}',
    'input:focus,select:focus{outline:none;border-color:#2E8B6B;box-shadow:0 0 0 3px #DCEFE7}',
    '.confirm{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:14px;background:#F1F8F5;border:1.5px solid #DCEFE7;cursor:pointer;font-weight:600}',
    '.confirm input{width:22px;height:22px;margin:2px 0 0;accent-color:#2E8B6B;flex:none}',
    '.child{border:1px solid #E8E8E4;border-radius:16px;padding:14px 14px 16px;margin-top:14px;background:#FAFAFA}',
    '.child-title{font-weight:700;font-size:15px;color:#0B6B4F}',
    '.row{display:grid;grid-template-columns:1fr;gap:0 12px}',
    '@media (min-width:560px){.row{grid-template-columns:1fr 1fr}}',
    'fieldset{border:0;margin:14px 0 0;padding:0}',
    'legend{font-weight:600;font-size:15px;padding:0}',
    '.choices{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
    '.choice{position:relative}',
    '.choice input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}',
    '.choice span{display:inline-block;padding:9px 14px;border:1.5px solid #D4D4CF;border-radius:999px;background:#FFFFFF;font-size:15px}',
    '.choice input:checked + span{background:#2E8B6B;border-color:#2E8B6B;color:#FFFFFF}',
    '.choice input:focus-visible + span{box-shadow:0 0 0 3px #DCEFE7}',
    '.error{color:#B3261E;font-size:14px;margin-top:6px}',
    '.banner{background:#FDECEA;color:#8C1D18;border-radius:12px;padding:10px 12px;margin-top:16px;font-size:14px}',
    '.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;align-items:center}',
    'button,.button{font:inherit;font-weight:700;border-radius:999px;padding:12px 20px;border:1.5px solid transparent;cursor:pointer;',
    '  text-decoration:none;display:inline-flex;align-items:center;gap:8px;min-height:46px}',
    '.primary{background:#2E8B6B;color:#FFFFFF}.primary:hover{background:#0B6B4F}',
    '.primary[disabled]{opacity:.6;cursor:progress}',
    '.ghost{background:#FFFFFF;color:#1A1A1A;border-color:#D4D4CF}.ghost:hover{border-color:#2E8B6B}',
    '.link{background:none;border:0;padding:8px 4px;color:#5C5C5C;text-decoration:underline;font-weight:400;min-height:0}',
    '.summary{border:1px solid #E8E8E4;border-radius:16px;padding:12px 14px;margin-top:14px;background:#FAFAFA;font-size:15px}',
    '.summary div{margin:2px 0}',
    '.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:700}',
    '.pill.pending{background:#FFF4D6;color:#8A5A00}.pill.revoked{background:#FDECEA;color:#8C1D18}',
    '.pill.approved{background:#F1F8F5;color:#0B6B4F}',
    '.spinner{width:36px;height:36px;border-radius:50%;border:4px solid #DCEFE7;border-top-color:#2E8B6B;animation:spin 1s linear infinite;margin:8px auto 16px}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.center{text-align:center}',
    '.help{margin-top:18px;font-size:14px;color:#5C5C5C}',
    '.help a{color:#0B6B4F}'
  ].join('\n');

  function ensureHost() {
    if (host || typeof document === 'undefined' || !document.documentElement) return;
    host = document.createElement('div');
    host.id = 'polymath-access-gate';
    host.setAttribute('data-version', VERSION);
    shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    shadow.addEventListener('click', onClick);
    shadow.addEventListener('change', onChange);
    shadow.addEventListener('submit', function (event) { event.preventDefault(); submit(); });
    shadow.addEventListener('input', function () { readForm(); });
  }

  function attach() {
    ensureHost();
    if (!host) return;
    if (host.parentNode !== document.documentElement) document.documentElement.appendChild(host);
    if (document.body && !madeInert && !document.body.hasAttribute('inert')) {
      try { document.body.setAttribute('inert', ''); madeInert = true; } catch (error) { /* older browsers: the veil still covers it */ }
    }
    if (savedOverflow === null) {
      savedOverflow = document.documentElement.style.overflow || '';
      document.documentElement.style.overflow = 'hidden';
    }
    if (!observer && root.MutationObserver) {
      // Taking the pop-up out of the page does not open the app.
      observer = new root.MutationObserver(function () {
        if (BLOCKING[state.phase] && host && host.parentNode !== document.documentElement) document.documentElement.appendChild(host);
        if (BLOCKING[state.phase] && document.body && madeInert && !document.body.hasAttribute('inert')) document.body.setAttribute('inert', '');
      });
      observer.observe(document.documentElement, { childList: true, subtree: false, attributes: false });
      if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['inert'] });
    }
  }

  function detach() {
    if (observer) { observer.disconnect(); observer = null; }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (madeInert && document.body) { document.body.removeAttribute('inert'); }
    madeInert = false;
    if (savedOverflow !== null) { document.documentElement.style.overflow = savedOverflow; savedOverflow = null; }
  }

  function header() {
    return '<div class="brand"><div class="mark" aria-hidden="true">P</div><div><b>Polymath Learning Centre</b><span>Student access</span></div></div>';
  }

  function signedInAs() {
    var email = state.user && state.user.email ? state.user.email : 'this account';
    return '<p class="muted">Signed in as <span class="who">' + escapeHtml(email) + '</span></p>';
  }

  function helpLine() {
    return '<p class="help">Questions? WhatsApp us on <a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">' + WHATSAPP_NUMBER + '</a>.</p>';
  }

  function options(list, selected, placeholder) {
    var html = placeholder ? '<option value="">' + escapeHtml(placeholder) + '</option>' : '';
    for (var i = 0; i < list.length; i++) {
      html += '<option value="' + escapeHtml(list[i][0]) + '"' + (String(selected) === String(list[i][0]) ? ' selected' : '') + '>' + escapeHtml(list[i][1]) + '</option>';
    }
    return html;
  }

  function err(errors, key) {
    return errors && errors[key] ? '<div class="error" role="alert">' + escapeHtml(errors[key]) + '</div>' : '';
  }

  function formHtml(errors) {
    var d = draft || draftFrom(null, state.user);
    var count = Math.max(1, Math.min(MAX_CHILDREN, parseInt(d.childCount, 10) || 1));
    var counts = [];
    for (var n = 1; n <= MAX_CHILDREN; n++) counts.push([String(n), n === 1 ? '1 child' : n + ' children']);
    var revoked = statusOf(state.record) === 'revoked';
    var html = header() +
      '<h1>' + (state.record ? 'Update your details' : 'Welcome! Please confirm your enrolment') + '</h1>' +
      '<p>' + (revoked
        ? 'Your access to the Polymath apps is paused. Check the details below and send them again, and our staff will take another look.'
        : 'Before you use the Polymath apps, a parent needs to confirm that your child is still enrolled at Polymath Learning Centre. Our staff will approve your account, usually within one working day. You only need to do this once — it works for every Polymath app.') + '</p>' +
      signedInAs() +
      '<form novalidate>' +
      '<label class="confirm"><input type="checkbox" name="enrolled"' + (d.enrolled ? ' checked' : '') + '>' +
      '<span>I confirm that my child(ren) are currently enrolled at Polymath Learning Centre.</span></label>' + err(errors, 'enrolled') +
      '<h2>Parent</h2>' +
      '<div class="row">' +
      '<label class="field">Parent\'s full name<input type="text" name="parentName" autocomplete="name" maxlength="120" value="' + escapeHtml(d.parentName) + '">' + err(errors, 'parentName') + '</label>' +
      '<label class="field">Parent\'s email<input type="email" name="parentEmail" autocomplete="email" inputmode="email" maxlength="200" value="' + escapeHtml(d.parentEmail) + '">' + err(errors, 'parentEmail') + '</label>' +
      '</div>' +
      '<h2>Children</h2>' +
      '<label class="field">How many of your children are enrolled with us?<select name="childCount">' + options(counts, String(count)) + '</select>' + err(errors, 'childCount') + '</label>';
    for (var i = 0; i < count; i++) {
      var child = (d.children && d.children[i]) || { name: '', level: '', subjects: '' };
      html += '<div class="child" data-child="' + i + '">' +
        '<div class="child-title">Child ' + (i + 1) + '</div>' +
        '<div class="row">' +
        '<label class="field">Full name<input type="text" name="child' + i + 'name" maxlength="120" autocomplete="off" value="' + escapeHtml(child.name) + '">' + err(errors, 'child' + i + 'name') + '</label>' +
        '<label class="field">Level<select name="child' + i + 'level">' + options(LEVELS, child.level, 'Choose a level') + '</select>' + err(errors, 'child' + i + 'level') + '</label>' +
        '</div>' +
        '<fieldset><legend>Subjects with Polymath</legend><div class="choices">';
      for (var s = 0; s < SUBJECTS.length; s++) {
        html += '<label class="choice"><input type="radio" name="child' + i + 'subjects" value="' + SUBJECTS[s][0] + '"' + (child.subjects === SUBJECTS[s][0] ? ' checked' : '') + '><span>' + escapeHtml(SUBJECTS[s][1]) + '</span></label>';
      }
      html += '</div>' + err(errors, 'child' + i + 'subjects') + '</fieldset></div>';
    }
    html += (errors && errors.form ? '<div class="banner" role="alert">' + escapeHtml(errors.form) + '</div>' : '') +
      '<div class="actions">' +
      '<button type="submit" class="primary"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Sending…' : 'Send for approval') + '</button>' +
      (state.record && !revoked ? '<button type="button" class="ghost" data-action="cancel-edit">Cancel</button>' : '') +
      '<button type="button" class="link" data-action="sign-out">Not you? Sign out</button>' +
      '</div></form>' + helpLine();
    return html;
  }

  function summaryHtml(record) {
    if (!record) return '';
    var html = '<div class="summary">' +
      '<div><b>Parent:</b> ' + escapeHtml(record.parentName) + ' · ' + escapeHtml(record.parentEmail) + '</div>';
    (record.children || []).forEach(function (child, index) {
      html += '<div><b>Child ' + (index + 1) + ':</b> ' + escapeHtml(child && child.name) + ' · ' + escapeHtml(levelLabel(child && child.level)) + ' · ' + escapeHtml(subjectsLabel(child && child.subjects)) + '</div>';
    });
    return html + '</div>';
  }

  function pendingHtml() {
    return header() +
      '<h1>Thank you! Waiting for approval</h1>' +
      '<p>We have your details. Our staff will check them and switch on your account, usually within one working day. This page opens by itself once you are approved — you can leave it open, or come back later.</p>' +
      signedInAs() +
      '<p><span class="pill pending">Waiting for approval</span></p>' +
      summaryHtml(state.record) +
      '<div class="actions">' +
      '<button type="button" class="primary" data-action="recheck">Check again</button>' +
      '<button type="button" class="ghost" data-action="edit">Edit my details</button>' +
      '<button type="button" class="link" data-action="sign-out">Sign out</button>' +
      '</div>' + helpLine();
  }

  function revokedHtml() {
    var note = state.record && state.record.adminNote ? '<div class="summary"><b>Note from the centre:</b> ' + escapeHtml(state.record.adminNote) + '</div>' : '';
    return header() +
      '<h1>Your access is paused</h1>' +
      '<p>This account cannot open the Polymath apps at the moment. If your child is still enrolled with us, check your details and send them again, or WhatsApp us.</p>' +
      signedInAs() +
      '<p><span class="pill revoked">Access paused</span></p>' + note +
      '<div class="actions">' +
      '<button type="button" class="primary" data-action="edit">Update my details and ask again</button>' +
      '<button type="button" class="link" data-action="sign-out">Sign out</button>' +
      '</div>' + helpLine();
  }

  function subjectHtml() {
    var wanted = appSubjectLabel(APP_SUBJECT) || 'this subject';
    var have = approvedSubjects(state.record).map(appSubjectLabel);
    var haveText = have.length ? have.join(' and ') : 'no subjects yet';
    return header() +
      '<h1>' + escapeHtml(wanted) + ' is not part of your Polymath subjects</h1>' +
      '<p>Your account is approved for <b>' + escapeHtml(haveText) + '</b>, so this ' + escapeHtml(wanted) +
      ' app is closed for you. Open My Polymath to see the apps that are yours. If your child now takes ' + escapeHtml(wanted) +
      ' with us too, WhatsApp us and we will add it — this page opens by itself once it is added.</p>' +
      signedInAs() +
      '<p><span class="pill approved">Approved: ' + escapeHtml(haveText) + '</span></p>' +
      summaryHtml(state.record) +
      '<div class="actions">' +
      '<a class="button primary" href="' + DASHBOARD + '">Open My Polymath</a>' +
      '<button type="button" class="ghost" data-action="recheck">Check again</button>' +
      '<button type="button" class="link" data-action="sign-out">Sign out</button>' +
      '</div>' + helpLine();
  }

  function checkingHtml() {
    return header() + '<div class="center"><div class="spinner" aria-hidden="true"></div><h1>Checking your access…</h1>' + signedInAs() + '</div>';
  }

  function errorHtml() {
    return header() + '<h1>We could not check your access</h1><p>' + escapeHtml(state.error || 'Please try again.') + '</p>' + signedInAs() +
      '<div class="actions"><button type="button" class="primary" data-action="retry">Try again</button>' +
      '<button type="button" class="link" data-action="sign-out">Sign out</button></div>' + helpLine();
  }

  function render(errors) {
    if (typeof document === 'undefined') return;
    if (!BLOCKING[state.phase]) { detach(); return; }
    attach();
    if (!shadow) return;
    var body;
    if (state.phase === 'checking') body = checkingHtml();
    else if (state.phase === 'error') body = errorHtml();
    else if (state.phase === 'form' || editing) body = formHtml(errors);
    else if (state.phase === 'pending') body = pendingHtml();
    else if (state.phase === 'revoked') body = revokedHtml();
    else if (state.phase === 'subject') body = subjectHtml();
    else body = checkingHtml();
    var focusName = null, active = shadow.activeElement;
    if (active && active.name) focusName = active.name;
    shadow.innerHTML = '<style>' + STYLE + '</style><div class="veil" role="dialog" aria-modal="true" aria-labelledby="pa-title"><div class="card">' + body.replace('<h1>', '<h1 id="pa-title">') + '</div></div>';
    if (focusName && !errors) {
      var again = shadow.querySelector('[name="' + focusName + '"]');
      if (again && again.focus) { try { again.focus({ preventScroll: true }); } catch (error) { again.focus(); } }
    }
  }

  function focusFirstError() {
    if (!shadow) return;
    var first = shadow.querySelector('.error');
    if (!first) return;
    var field = first.parentNode && first.parentNode.querySelector('input,select');
    if (field && field.focus) field.focus();
    if (first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function readForm() {
    if (!shadow || !(state.phase === 'form' || editing)) return;
    var form = shadow.querySelector('form');
    if (!form) return;
    var d = draft || draftFrom(state.record, state.user);
    var value = function (name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; };
    var enrolled = form.querySelector('[name="enrolled"]');
    d.enrolled = !!(enrolled && enrolled.checked);
    d.parentName = value('parentName');
    d.parentEmail = value('parentEmail');
    d.childCount = parseInt(value('childCount'), 10) || 1;
    var children = d.children || [];
    for (var i = 0; i < d.childCount; i++) {
      var picked = form.querySelector('[name="child' + i + 'subjects"]:checked');
      var nameEl = form.querySelector('[name="child' + i + 'name"]');
      children[i] = {
        name: nameEl ? nameEl.value : (children[i] && children[i].name) || '',
        level: form.querySelector('[name="child' + i + 'level"]') ? value('child' + i + 'level') : (children[i] && children[i].level) || '',
        subjects: picked ? picked.value : (children[i] && children[i].subjects) || ''
      };
    }
    d.children = children;
    draft = d;
  }

  function onChange(event) {
    var target = event.target;
    if (target && target.name === 'childCount') { readForm(); render(); }
  }

  function onClick(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'sign-out') { signOut(); }
    else if (action === 'recheck' || action === 'retry') { setPhase('checking'); check(runToken, false); }
    else if (action === 'edit') { editing = true; stopRecheck(); draft = draftFrom(state.record, state.user); draft.enrolled = false; render(); }
    else if (action === 'cancel-edit') { editing = false; render(); if (state.phase === 'pending') scheduleRecheck(); }
  }

  /* ================================================================== */
  /*  Start                                                               */
  /* ================================================================== */
  function start() {
    var script = typeof document !== 'undefined' ? document.currentScript : null;
    APP = cleanText((script && script.getAttribute('data-app')) ||
      (root.location ? root.location.hostname + '/' + (root.location.pathname.split('/')[1] || '') : 'unknown'), 40) || 'unknown';
    APP_SUBJECT = cleanAppSubject(script && script.getAttribute('data-subject'));
    var waiting = function () { return (state.phase === 'pending' || state.phase === 'subject') && !editing; };
    if (typeof document !== 'undefined' && root.addEventListener) {
      root.addEventListener('focus', function () { if (waiting()) check(runToken, true); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && waiting()) check(runToken, true);
      });
    }
    findAuth(function (found) {
      adapter = found;
      try { found.listen(onUser); } catch (error) { /* nothing to listen to: the app has no sign-in here */ }
    });
  }

  root.PolymathAccess = {
    version: VERSION,
    core: core,
    get state() { return publicState(); },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      try { fn(publicState()); } catch (error) { /* its own bug */ }
      return function () { listeners = listeners.filter(function (other) { return other !== fn; }); };
    },
    recheck: function () { if (state.user) { setPhase('checking'); check(runToken, false); } },
    forget: function (uid) { rememberStatus(uid, null); },
    signOut: signOut
  };

  if (typeof document !== 'undefined' && typeof root.fetch === 'function') start();
})();
