/*
  MY POLYMATH — sign-in and the student access admin dashboard  (v1.6.0)
  ======================================================================
  polymathlc.com.sg/student          a student / parent signs in here once; the
                                     enrolment pop-up (access-gate.js, the SAME
                                     script every Polymath app loads) asks a new
                                     account for the parent and children, and the
                                     account stays blocked in every app until an
                                     admin approves it.
  polymathlc.com.sg/student/#admin   the access admins only (chungzhikai@gmail.com,
                                     admin@polymathlc.com.sg, support@polymathlc.com.sg):
                                     every request, live, with Approve / Pause /
                                     Edit / Delete.

  The tiles stay plain links that work with no script: each app checks access
  itself, so the dashboard showing a tile never lets anybody past the gate.

  CLASSIFY AND FILTER (v1.6.0) — at #admin the accounts can be narrowed by
  status, by a child's LEVEL (P1–S5, Other) and by SUBJECTS (Math only, Science
  only, Both, or any Math / any Science), grouped by level or by subjects,
  sorted, and shown as cards or as a compact one-row-per-child table. The
  "Students by level" grid counts children per level and subject; tapping a
  number filters to exactly those. A family matches when ONE of its children
  matches both the level and the subject chosen. The choices are remembered
  on this device.

  SUBJECTS (v1.5.0) — this dashboard controls every app:
  • Each child is Math only, Science only or Both. The Science, Science PSLE and
    Math tiles (data-subject) lock for an approved account without that subject
    ("🔒 Not in your subjects"); the apps refuse at their direct addresses too.
    Answer Keys, Study Buddy, Rewards, Chinese and English open for every
    approved account.
  • Polymath Online (/online): approving, editing or pausing here also writes
    the account's onlineMembers/{uid} row — each child's own level (P3–P6) and
    subjects as `access` — and the portal reads the approval itself as well, so
    the worksheets follow this page even before that row is written.
  Firestore: studentAccess/{uid}; the rules (tools/student-access-rules.mjs) let
  only these three admins list, approve, edit or delete.
*/
(function () {
  'use strict';

  var VERSION = 'v1.6.0';
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
    authDomain: 'mathgen--app.firebaseapp.com',
    projectId: 'mathgen--app',
    storageBucket: 'mathgen--app.firebasestorage.app',
    messagingSenderId: '165654161198',
    appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf'
  };
  // Keep equal to ACCESS_ADMINS in access-gate.js and tools/student-access-rules.mjs (a test checks).
  var ACCESS_ADMINS = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg'];
  // Centre usernames (no @) sign in as username@this domain — the same mapping the Science app uses.
  var STUDENT_USERNAME_DOMAIN = 'students.sciencequest.app';
  var RESET_SUFFIX_MAX = 9;
  var LEVELS = [
    ['P1', 'Primary 1'], ['P2', 'Primary 2'], ['P3', 'Primary 3'], ['P4', 'Primary 4'],
    ['P5', 'Primary 5'], ['P6', 'Primary 6'], ['S1', 'Secondary 1'], ['S2', 'Secondary 2'],
    ['S3', 'Secondary 3'], ['S4', 'Secondary 4'], ['S5', 'Secondary 5'], ['Other', 'Other']
  ];
  var SUBJECTS = [['math', 'Math only'], ['science', 'Science only'], ['both', 'Both Math and Science']];
  var STATUS_LABEL = { pending: 'Waiting', approved: 'Approved', revoked: 'Paused' };
  // The two subjects a tile (or an app) can belong to, in the order shown.
  var APP_SUBJECTS = [['science', 'Science'], ['math', 'Math']];
  // Polymath Online has classes for these levels only; P3 is Science only.
  var ONLINE_LEVELS = ['P3', 'P4', 'P5', 'P6'];
  var ONLINE_MEMBERS = 'onlineMembers';
  var WHATSAPP_NUMBER = '+65 9645 0588';
  // Markers onlineMemberPatch() returns; the page swaps in the Firestore sentinels.
  var SERVER_TIME = '__serverTimestamp__';
  var DELETE_FIELD = '__deleteField__';

  /* ---------------------------- pure helpers ---------------------------- */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lower(value) { return String(value == null ? '' : value).trim().toLowerCase(); }
  function isAdmin(user) { return !!(user && user.emailVerified && ACCESS_ADMINS.indexOf(lower(user.email)) >= 0); }
  function levelLabel(key) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === key) return LEVELS[i][1]; return key || '—'; }
  function subjectsLabel(key) { for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i][0] === key) return SUBJECTS[i][1]; return key || '—'; }
  function statusOf(record) {
    var s = lower(record && record.status);
    return s === 'approved' || s === 'revoked' ? s : 'pending';
  }
  function loginCandidates(raw) {
    var s = String(raw || '').trim();
    if (!s) return [];
    if (s.indexOf('@') >= 0) return [s];
    var u = s.toLowerCase(), out = [u + '@' + STUDENT_USERNAME_DOMAIN];
    for (var n = 2; n <= RESET_SUFFIX_MAX; n++) out.push(u + '.r' + n + '@' + STUDENT_USERNAME_DOMAIN);
    return out;
  }
  function accountLabel(email) {
    var e = lower(email);
    var at = e.lastIndexOf('@' + STUDENT_USERNAME_DOMAIN);
    if (at > 0) return 'username ' + e.slice(0, at).replace(/\.r\d$/, '');
    return e || '(no email)';
  }
  /** Firestore Timestamp, ISO string, Date or millis → Date (or null). */
  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') { try { return value.toDate(); } catch (error) { return null; } }
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  /** "13 Nov 2026, 6:32 pm" in Singapore time, whatever the device's zone. */
  function sgTime(value) {
    var d = toDate(value);
    if (!d) return '—';
    try {
      return d.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (error) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function matches(record, query) {
    var q = lower(query);
    if (!q) return true;
    var hay = [record.parentName, record.parentEmail, record.email, record.app, record.adminNote]
      .concat((record.children || []).map(function (c) { return (c && c.name) + ' ' + levelLabel(c && c.level) + ' ' + subjectsLabel(c && c.subjects); }))
      .join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function sortRecords(list) {
    var rank = { pending: 0, revoked: 1, approved: 2 };
    return list.slice().sort(function (a, b) {
      var r = rank[statusOf(a)] - rank[statusOf(b)];
      if (r) return r;
      var ta = toDate(a.submittedAt), tb = toDate(b.submittedAt);
      return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
    });
  }
  function counts(list) {
    var c = { all: list.length, pending: 0, approved: 0, revoked: 0 };
    list.forEach(function (r) { c[statusOf(r)]++; });
    return c;
  }
  /** The admin's edit form → a clean record update (never touches uid). */
  function editedRecord(original, form) {
    var children = (form.children || []).map(function (c) {
      return { name: String(c.name || '').replace(/\s+/g, ' ').trim().slice(0, 120), level: c.level || '', subjects: c.subjects || '' };
    }).filter(function (c) { return c.name; });
    var out = {};
    Object.keys(original || {}).forEach(function (k) { out[k] = original[k]; });
    out.parentName = String(form.parentName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    out.parentEmail = lower(form.parentEmail).slice(0, 200);
    out.children = children;
    out.childCount = children.length;
    out.adminNote = String(form.adminNote || '').trim().slice(0, 500);
    if (form.status === 'approved' || form.status === 'pending' || form.status === 'revoked') out.status = form.status;
    return out;
  }

  /* ---------------------------- subjects (v1.5.0) ---------------------------- */
  /** One child's choice → the subjects it opens ("both" → math and science). */
  function subjectsOfChoice(choice) {
    var key = lower(choice);
    if (key === 'both') return ['math', 'science'];
    if (key === 'math' || key === 'science') return [key];
    return [];
  }
  /** Every subject a record's children have, sorted (the same rule as access-gate.js). */
  function approvedSubjects(record) {
    var out = [];
    ((record && record.children) || []).forEach(function (child) {
      subjectsOfChoice(child && child.subjects).forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); });
    });
    return out.sort();
  }
  function appSubjectLabel(key) { for (var i = 0; i < APP_SUBJECTS.length; i++) if (APP_SUBJECTS[i][0] === key) return APP_SUBJECTS[i][1]; return key || ''; }
  /** "Science and Math", "Math", or "" — in the order of APP_SUBJECTS. */
  function subjectsWords(list) {
    var words = APP_SUBJECTS.filter(function (p) { return (list || []).indexOf(p[0]) >= 0; }).map(function (p) { return p[1]; });
    return words.join(' and ');
  }
  /**
   * Which subjects the tiles on this page may open for the signed-in account:
   * null = no subject locks at all (signed out, an admin, staff, or an account the
   * enrolment pop-up is still deciding — the pop-up covers the page then), or the
   * approved list (possibly empty).
   */
  function tileSubjects(signedIn, gate) {
    if (!signedIn || !signedIn.uid || isAdmin(signedIn)) return null;
    if (!gate || (gate.phase !== 'approved' && gate.phase !== 'subject')) return null;
    return Array.isArray(gate.subjects) ? gate.subjects.slice() : null;
  }
  /** Is a tile for this subject locked? (A tile with no subject never is.) */
  function tileLocked(tileSubject, allowed) {
    if (!tileSubject || !allowed) return false;
    return allowed.indexOf(tileSubject) < 0;
  }
  /**
   * Each child's Polymath Online (level, subjects): only levels Online has
   * classes for, P3 Science only, children of the same level merged.
   */
  function onlineAccessFor(record) {
    var out = [];
    ((record && record.children) || []).forEach(function (child) {
      if (!child || ONLINE_LEVELS.indexOf(child.level) < 0) return;
      var subjects = subjectsOfChoice(child.subjects).filter(function (s) { return child.level !== 'P3' || s === 'science'; });
      if (!subjects.length) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i].level === child.level) {
          subjects.forEach(function (s) { if (out[i].subjects.indexOf(s) < 0) out[i].subjects.push(s); });
          out[i].subjects.sort();
          return;
        }
      }
      out.push({ level: child.level, subjects: subjects.slice().sort() });
    });
    return out;
  }
  /**
   * What to write to onlineMembers/{uid} so Polymath Online follows this record,
   * or null when nothing needs writing. `existing` is the member row now (or null).
   * Approved with Online levels → the row says exactly those levels and subjects
   * (and an old removal is lifted). Approved with no Online level, waiting or
   * paused → an existing row is closed; no row is made for it.
   */
  function onlineMemberPatch(record, existing, uid) {
    var status = statusOf(record);
    var access = status === 'approved' ? onlineAccessFor(record) : [];
    var same = existing && JSON.stringify(existing.access || null) === JSON.stringify(access) && existing.source === 'student-access';
    if (access.length) {
      if (same && !existing.revoked && existing.level === access[0].level) return null;
      var names = ((record && record.children) || []).map(function (c) { return c && c.name ? String(c.name) : ''; }).filter(Boolean);
      var email = lower(record && record.email);
      var patch = {
        uid: uid || (record && record.uid) || '',
        level: access[0].level,
        subjects: access[0].subjects.slice(),
        access: access,
        source: 'student-access',
        syncedAt: SERVER_TIME
      };
      if (!existing) {
        patch.role = 'student';
        patch.name = names.join(' & ');
        patch.email = email;
        patch.emailLower = email;
        patch.joinedAt = SERVER_TIME;
      }
      if (existing && (existing.revoked || existing.revokedAt)) { patch.revoked = DELETE_FIELD; patch.revokedAt = DELETE_FIELD; }
      return patch;
    }
    if (!existing) return null;
    if (same && existing.revoked === true) return null;
    return { access: [], source: 'student-access', revoked: true, revokedAt: SERVER_TIME, syncedAt: SERVER_TIME };
  }

  /* ---------------------- classify and filter (v1.6.0) ---------------------- */
  // Subject filters: a child's own choice, or "takes Math / Science at all".
  var SUBJECT_FILTERS = [
    ['all', 'All subjects'], ['math', 'Math only'], ['science', 'Science only'], ['both', 'Both'],
    ['has-math', 'Any Math'], ['has-science', 'Any Science']
  ];
  var GROUPS = [['none', 'No grouping'], ['level', 'Group by level'], ['subjects', 'Group by subjects']];
  var SORTS = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['level', 'Level (P1 → S5)'], ['parent', 'Parent A–Z'], ['child', 'Child A–Z']];
  var VIEWS = [['cards', 'Cards'], ['table', 'Table']];
  function levelRank(level) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][0] === level) return i;
    return LEVELS.length;   // no level / unknown: last
  }
  function shortLevel(key) { return key && key !== 'Other' ? key : (key || '—'); }
  /** Does this child fit a level ('all' or a key) and a subject filter? */
  function childMatches(child, level, subject) {
    if (!child) return false;
    var lv = level || 'all', sub = subject || 'all';
    if (lv !== 'all' && child.level !== lv) return false;
    var choice = lower(child.subjects);
    if (sub === 'all') return true;
    if (sub === 'has-math') return choice === 'math' || choice === 'both';
    if (sub === 'has-science') return choice === 'science' || choice === 'both';
    return choice === sub;
  }
  /** A family fits when ONE of its children fits both the level and the subject. */
  function recordMatchesClass(record, level, subject) {
    if ((level || 'all') === 'all' && (subject || 'all') === 'all') return true;
    return ((record && record.children) || []).some(function (child) { return childMatches(child, level, subject); });
  }
  /** The children of a family that fit (all of them when nothing is chosen). */
  function matchingChildren(record, level, subject) {
    return ((record && record.children) || []).filter(function (child) { return childMatches(child, level, subject); });
  }
  /**
   * Children counted per level and subject choice:
   * { rows: [{ level, label, math, science, both, total }], total: {...} } — levels in
   * school order, only those with a child; families counted once per child.
   */
  function classify(records) {
    var byLevel = {}, total = { math: 0, science: 0, both: 0, none: 0, total: 0 };
    (records || []).forEach(function (record) {
      ((record && record.children) || []).forEach(function (child) {
        if (!child) return;
        var level = child.level || '';
        var row = byLevel[level] || (byLevel[level] = { level: level, label: level ? levelLabel(level) : 'No level', math: 0, science: 0, both: 0, none: 0, total: 0 });
        var choice = lower(child.subjects);
        var key = choice === 'math' || choice === 'science' || choice === 'both' ? choice : 'none';
        row[key]++; row.total++; total[key]++; total.total++;
      });
    });
    var rows = Object.keys(byLevel).map(function (k) { return byLevel[k]; })
      .sort(function (a, b) { return levelRank(a.level) - levelRank(b.level); });
    return { rows: rows, total: total };
  }
  /** Families per level / per subject choice, for the chip counts (a family counts once per chip). */
  function chipCounts(records, level, subject) {
    var levels = {}, subjects = {};
    (records || []).forEach(function (record) {
      LEVELS.forEach(function (pair) { if (recordMatchesClass(record, pair[0], subject)) levels[pair[0]] = (levels[pair[0]] || 0) + 1; });
      SUBJECT_FILTERS.forEach(function (pair) { if (recordMatchesClass(record, level, pair[0])) subjects[pair[0]] = (subjects[pair[0]] || 0) + 1; });
    });
    levels.all = (records || []).filter(function (r) { return recordMatchesClass(r, 'all', subject); }).length;
    return { levels: levels, subjects: subjects };
  }
  function firstChildName(record) {
    var c = ((record && record.children) || [])[0];
    return lower(c && c.name);
  }
  /** The lowest school level among the family's children that fit (for sorting and grouping). */
  function recordLevel(record, level, subject) {
    var kids = matchingChildren(record, level, subject);
    if (!kids.length) kids = (record && record.children) || [];
    var best = null;
    kids.forEach(function (c) { if (c && (best === null || levelRank(c.level) < levelRank(best))) best = c.level || ''; });
    return best === null ? '' : best;
  }
  /** The family's subject choice for grouping: one choice, or "Mixed" when its children differ. */
  function recordSubjects(record, level, subject) {
    var kids = matchingChildren(record, level, subject);
    if (!kids.length) kids = (record && record.children) || [];
    var seen = [];
    kids.forEach(function (c) { var k = lower(c && c.subjects) || 'none'; if (seen.indexOf(k) < 0) seen.push(k); });
    if (seen.length === 1) return seen[0];
    return seen.length ? 'mixed' : 'none';
  }
  /** Sort a list by one of SORTS (waiting families always first, as before, for "newest"). */
  function sortBy(list, mode, level, subject) {
    var time = function (r) { var d = toDate(r.submittedAt); return d ? d.getTime() : 0; };
    var text = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
    if (mode === 'oldest') return list.slice().sort(function (a, b) { return time(a) - time(b); });
    if (mode === 'level') return list.slice().sort(function (a, b) {
      return (levelRank(recordLevel(a, level, subject)) - levelRank(recordLevel(b, level, subject))) || text(lower(a.parentName), lower(b.parentName));
    });
    if (mode === 'parent') return list.slice().sort(function (a, b) { return text(lower(a.parentName), lower(b.parentName)) || time(b) - time(a); });
    if (mode === 'child') return list.slice().sort(function (a, b) { return text(firstChildName(a), firstChildName(b)) || time(b) - time(a); });
    return sortRecords(list);
  }
  var SUBJECT_GROUP_ORDER = ['math', 'science', 'both', 'mixed', 'none'];
  var SUBJECT_GROUP_LABEL = { math: 'Math only', science: 'Science only', both: 'Both Math and Science', mixed: 'Children with different subjects', none: 'No subjects chosen' };
  /** [{ key, label, records }] in school / subject order; one group when not grouping. */
  function groupRecords(list, by, level, subject) {
    if (by !== 'level' && by !== 'subjects') return [{ key: 'all', label: '', records: list.slice() }];
    var groups = {}, order = [];
    list.forEach(function (record) {
      var key = by === 'level' ? recordLevel(record, level, subject) : recordSubjects(record, level, subject);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(record);
    });
    order.sort(function (a, b) {
      return by === 'level' ? levelRank(a) - levelRank(b) : SUBJECT_GROUP_ORDER.indexOf(a) - SUBJECT_GROUP_ORDER.indexOf(b);
    });
    return order.map(function (key) {
      return { key: key, label: by === 'level' ? (key ? levelLabel(key) : 'No level') : SUBJECT_GROUP_LABEL[key] || key, records: groups[key] };
    });
  }
  /** Saved filters → only known values (a stale or tampered entry falls back to the default). */
  function cleanPrefs(raw) {
    var known = function (list, value, fallback) { for (var i = 0; i < list.length; i++) if (list[i][0] === value) return value; return fallback; };
    raw = raw || {};
    return {
      filter: known([['pending'], ['approved'], ['revoked'], ['all']], raw.filter, 'pending'),
      level: raw.level === 'all' ? 'all' : known(LEVELS, raw.level, 'all'),
      subject: known(SUBJECT_FILTERS, raw.subject, 'all'),
      group: known(GROUPS, raw.group, 'none'),
      sort: known(SORTS, raw.sort, 'newest'),
      view: known(VIEWS, raw.view, 'cards')
    };
  }

  var helpers = { esc: esc, isAdmin: isAdmin, statusOf: statusOf, loginCandidates: loginCandidates, accountLabel: accountLabel,
    toDate: toDate, sgTime: sgTime, matches: matches, sortRecords: sortRecords, counts: counts, editedRecord: editedRecord,
    subjectsOfChoice: subjectsOfChoice, approvedSubjects: approvedSubjects, appSubjectLabel: appSubjectLabel, subjectsWords: subjectsWords,
    tileSubjects: tileSubjects, tileLocked: tileLocked, onlineAccessFor: onlineAccessFor, onlineMemberPatch: onlineMemberPatch,
    SERVER_TIME: SERVER_TIME, DELETE_FIELD: DELETE_FIELD, ONLINE_LEVELS: ONLINE_LEVELS, APP_SUBJECTS: APP_SUBJECTS,
    childMatches: childMatches, recordMatchesClass: recordMatchesClass, matchingChildren: matchingChildren, classify: classify,
    chipCounts: chipCounts, recordLevel: recordLevel, recordSubjects: recordSubjects, sortBy: sortBy, groupRecords: groupRecords,
    cleanPrefs: cleanPrefs, levelRank: levelRank, SUBJECT_FILTERS: SUBJECT_FILTERS, GROUPS: GROUPS, SORTS: SORTS, VIEWS: VIEWS,
    ACCESS_ADMINS: ACCESS_ADMINS, LEVELS: LEVELS, SUBJECTS: SUBJECTS };
  window.MyPolymathAccount = { version: VERSION, helpers: helpers };

  if (typeof document === 'undefined') return;

  /* ------------------------------ elements ------------------------------ */
  var accountCard = document.getElementById('accountCard');
  var adminButton = document.getElementById('adminButton');
  var adminView = document.getElementById('adminView');
  var appSections = document.querySelectorAll('[data-apps-view]');
  var subjectsNote = document.getElementById('subjectsNote');

  /* ---------------------- subject locks on the tiles ---------------------- */
  // Runs before sign-in is known too (signed out → every tile as it is in the HTML).
  var LOCK_TEXT = function (subject) {
    return appSubjectLabel(subject) + ' is not one of your Polymath subjects. WhatsApp us on ' + WHATSAPP_NUMBER + ' to add it.';
  };
  function lockTile(tile, subject) {
    if (tile.classList.contains('is-subject-locked')) return;
    tile.setAttribute('data-subject-href', tile.getAttribute('href') || '');
    tile.removeAttribute('href');
    tile.classList.add('is-locked', 'is-subject-locked');
    tile.setAttribute('role', 'link');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-disabled', 'true');
    tile.setAttribute('data-locked', LOCK_TEXT(subject));
    var words = tile.querySelector('.tile-words');
    if (words && !words.querySelector('.tile-lock')) {
      var pill = document.createElement('span');
      pill.className = 'tile-lock';
      pill.setAttribute('data-subject-lock', '');
      pill.innerHTML = '<span aria-hidden="true">🔒</span> Not in your subjects';
      words.insertBefore(pill, words.firstChild);
    }
    Array.prototype.forEach.call(tile.querySelectorAll('.tile-go, .tile-badge'), function (el) { el.setAttribute('data-was-hidden', el.hidden ? '1' : ''); el.hidden = true; });
  }
  function unlockTile(tile) {
    if (!tile.classList.contains('is-subject-locked')) return;
    var href = tile.getAttribute('data-subject-href');
    if (href) tile.setAttribute('href', href);
    tile.removeAttribute('data-subject-href');
    tile.classList.remove('is-locked', 'is-subject-locked', 'is-nudged');
    tile.removeAttribute('role');
    tile.removeAttribute('tabindex');
    tile.removeAttribute('aria-disabled');
    tile.removeAttribute('data-locked');
    var pill = tile.querySelector('[data-subject-lock]');
    if (pill) pill.remove();
    Array.prototype.forEach.call(tile.querySelectorAll('.tile-go, .tile-badge'), function (el) {
      if (el.hasAttribute('data-was-hidden')) { el.hidden = el.getAttribute('data-was-hidden') === '1'; el.removeAttribute('data-was-hidden'); }
    });
  }
  function applySubjectLocks() {
    var allowed = tileSubjects(user, gateState);
    Array.prototype.forEach.call(document.querySelectorAll('.app-tile[data-subject]'), function (tile) {
      var subject = tile.getAttribute('data-subject');
      if (tileLocked(subject, allowed)) lockTile(tile, subject); else unlockTile(tile);
    });
    if (subjectsNote) {
      var missing = allowed ? APP_SUBJECTS.filter(function (p) { return allowed.indexOf(p[0]) < 0; }) : [];
      if (allowed && missing.length) {
        var have = subjectsWords(allowed);
        subjectsNote.hidden = false;
        subjectsNote.innerHTML = (have ? 'Your account is approved for <b>' + esc(have) + '</b>. ' : 'Your account has no subjects yet. ') +
          esc(missing.map(function (p) { return p[1]; }).join(' and ')) + ' stays locked until the centre adds it — WhatsApp us on ' + esc(WHATSAPP_NUMBER) + '.';
      } else {
        subjectsNote.hidden = true;
        subjectsNote.textContent = '';
      }
    }
  }
  // A subject-locked tile has no address; tapping it says why (the page's own note).
  document.addEventListener('click', function (event) {
    var tile = event.target && event.target.closest ? event.target.closest('.app-tile.is-subject-locked') : null;
    if (!tile) return;
    event.preventDefault();
    tile.classList.remove('is-nudged');
    void tile.offsetWidth;
    tile.classList.add('is-nudged');
    var note = tile.getAttribute('data-locked') || 'This app is not one of your subjects.';
    if (window.MyPolymath && typeof window.MyPolymath.showLockedNote === 'function') window.MyPolymath.showLockedNote(note);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var tile = event.target && event.target.closest ? event.target.closest('.app-tile.is-subject-locked') : null;
    if (tile) { event.preventDefault(); tile.click(); }
  });

  /* ------------------------------ Firebase ------------------------------ */
  var fb = window.firebase;
  if (!fb || typeof fb.initializeApp !== 'function') {
    // Offline, or the sign-in library was blocked: the tiles still work, and every app asks itself.
    if (accountCard) {
      accountCard.hidden = false;
      accountCard.innerHTML = '<p class="account-note">Sign-in is not available right now. Your apps below still open, and each one will ask you to sign in.</p>';
    }
    return;
  }
  if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
  var auth = fb.auth();
  var db = fb.firestore ? fb.firestore() : null;
  var user = null;
  var gateState = null;
  var loginMode = 'google';
  var loginBusy = false;
  var loginError = '';

  /* ---------------------------- account card ---------------------------- */
  function statusChip() {
    if (!user) return '';
    if (isAdmin(user)) return '<span class="status-chip is-staff">Admin</span>';
    var phase = gateState && gateState.phase;
    if (phase === 'staff') return '<span class="status-chip is-staff">Staff</span>';
    if (phase === 'approved' || phase === 'subject') {
      var words = subjectsWords(gateState.subjects);
      return '<span class="status-chip is-approved">✓ Approved' + (words ? ' · ' + esc(words) : '') + '</span>';
    }
    if (phase === 'pending') return '<span class="status-chip is-pending">Waiting for approval</span>';
    if (phase === 'revoked') return '<span class="status-chip is-revoked">Access paused</span>';
    if (phase === 'form') return '<span class="status-chip is-pending">Details needed</span>';
    return '';
  }

  function renderAccount() {
    if (!accountCard) return;
    accountCard.hidden = false;
    if (user) {
      accountCard.innerHTML =
        '<div class="account-row">' +
          '<div class="account-who"><span class="account-label">Signed in as</span> <b>' + esc(accountLabel(user.email)) + '</b> ' + statusChip() + '</div>' +
          '<div class="account-actions">' +
            (isAdmin(user) && !wantsAdmin() ? '<a class="button button-accent" href="#admin">Approve students</a>' : '') +
            '<button type="button" class="button" data-account="sign-out">Sign out</button>' +
          '</div>' +
        '</div>';
      return;
    }
    accountCard.innerHTML =
      '<div class="signin">' +
        '<div class="signin-text"><b>Sign in once</b><span>Use the account you use in the Polymath apps. New here? After you sign in we will ask a parent to confirm your enrolment.</span></div>' +
        (loginMode === 'google'
          ? '<div class="signin-actions">' +
              '<button type="button" class="button button-accent" data-account="google"' + (loginBusy ? ' disabled' : '') + '>' +
                '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
                '<span>' + (loginBusy ? 'Signing in…' : 'Sign in with Google') + '</span></button>' +
              '<button type="button" class="button" data-account="use-password">Username &amp; password</button>' +
            '</div>'
          : '<form class="signin-form" data-account-form="password">' +
              '<label>Username or email<input type="text" name="loginId" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
              '<label>Password<input type="password" name="loginPass" autocomplete="current-password" required></label>' +
              '<div class="signin-actions">' +
                '<button type="submit" class="button button-accent"' + (loginBusy ? ' disabled' : '') + '>' + (loginBusy ? 'Signing in…' : 'Sign in') + '</button>' +
                '<button type="button" class="button" data-account="use-google">Use Google instead</button>' +
              '</div>' +
            '</form>') +
        (loginError ? '<p class="signin-error" role="alert">' + esc(loginError) + '</p>' : '') +
      '</div>';
  }

  function friendlyError(error) {
    var code = error && error.code;
    var map = {
      'auth/user-not-found': 'No account with that username or email.',
      'auth/wrong-password': 'That password is not right. Please try again.',
      'auth/invalid-credential': 'That username or password is not right. Please try again.',
      'auth/invalid-login-credentials': 'That username or password is not right. Please try again.',
      'auth/invalid-email': 'Please type a username or a full email address.',
      'auth/too-many-requests': 'Too many tries. Please wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection. Please check the internet and try again.',
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': ''
    };
    return code in map ? map[code] : 'Sign-in did not work. Please try again.';
  }

  function signInGoogle() {
    loginBusy = true; loginError = ''; renderAccount();
    var provider = new fb.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).catch(function (error) {
      if (error && (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment')) {
        return auth.signInWithRedirect(provider);
      }
      loginError = friendlyError(error);
    }).then(function () { loginBusy = false; renderAccount(); });
  }

  function signInPassword(form) {
    var id = form.querySelector('[name="loginId"]').value;
    var pass = form.querySelector('[name="loginPass"]').value;
    var candidates = loginCandidates(id);
    if (!candidates.length || !pass) { loginError = 'Please type your username (or email) and password.'; renderAccount(); return; }
    loginBusy = true; loginError = ''; renderAccount();
    var i = 0;
    (function next(firstError) {
      if (i >= candidates.length) { loginBusy = false; loginError = friendlyError(firstError); renderAccount(); return; }
      auth.signInWithEmailAndPassword(candidates[i++], pass).then(function () {
        loginBusy = false; loginError = ''; renderAccount();
      }).catch(function (error) {
        var code = error && error.code;
        var keepTrying = code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/wrong-password';
        if (!keepTrying) { loginBusy = false; loginError = friendlyError(error); renderAccount(); return; }
        next(firstError || error);
      });
    })(null);
  }

  if (accountCard) {
    accountCard.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-account]') : null;
      if (!target) return;
      var action = target.getAttribute('data-account');
      if (action === 'google') signInGoogle();
      else if (action === 'use-password') { loginMode = 'password'; loginError = ''; renderAccount(); var f = accountCard.querySelector('[name="loginId"]'); if (f) f.focus(); }
      else if (action === 'use-google') { loginMode = 'google'; loginError = ''; renderAccount(); }
      else if (action === 'sign-out') auth.signOut();
    });
    accountCard.addEventListener('submit', function (event) {
      var form = event.target;
      if (form && form.getAttribute('data-account-form') === 'password') { event.preventDefault(); signInPassword(form); }
    });
  }

  /* ---------------------------- admin view ---------------------------- */
  var admin = { records: [], filter: 'pending', query: '', editing: null, confirming: null, unsubscribe: null, error: '', notice: '', loaded: false, busy: {},
    level: 'all', subject: 'all', group: 'none', sort: 'newest', view: 'cards' };
  // The admin's filters, remembered on this device only (storage may be refused: then the defaults).
  var PREFS_KEY = 'polymath-access-admin-filters-v1';
  (function loadPrefs() {
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) || 'null'); } catch (error) { saved = null; }
    var prefs = cleanPrefs(saved);
    Object.keys(prefs).forEach(function (k) { admin[k] = prefs[k]; });
  })();
  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: admin.filter, level: admin.level, subject: admin.subject, group: admin.group, sort: admin.sort, view: admin.view }));
    } catch (error) { /* not remembered: fine */ }
  }
  function classFiltered() { return admin.level !== 'all' || admin.subject !== 'all'; }

  function wantsAdmin() { return location.hash === '#admin'; }

  function showView() {
    var showAdmin = wantsAdmin();
    if (adminView) adminView.hidden = !showAdmin;
    Array.prototype.forEach.call(appSections, function (el) { el.hidden = showAdmin; });
    if (showAdmin) {
      if (isAdmin(user)) startAdmin(); else stopAdmin();
      renderAdmin();
      try { window.scrollTo(0, 0); } catch (error) { /* fine */ }
    } else {
      stopAdmin();
    }
    if (adminButton) {
      adminButton.hidden = !isAdmin(user);
      adminButton.setAttribute('href', showAdmin ? '#' : '#admin');
      adminButton.querySelector('span:last-child').textContent = showAdmin ? 'Back to apps' : 'Approve students';
    }
  }

  function startAdmin() {
    if (admin.unsubscribe || !db) return;
    admin.error = '';
    admin.unsubscribe = db.collection('studentAccess').onSnapshot(function (snap) {
      admin.records = snap.docs.map(function (doc) {
        var data = doc.data() || {};
        data.uid = data.uid || doc.id;
        data._id = doc.id;
        return data;
      });
      admin.loaded = true;
      admin.error = '';
      renderAdmin();
      updatePendingBadge();
      reconcileOnline();
    }, function (error) {
      admin.error = (error && error.code === 'permission-denied')
        ? 'This account is not allowed to see student requests. Sign in as one of the Polymath admin accounts.'
        : 'Could not load the requests: ' + (error && error.message ? error.message : 'unknown error');
      admin.unsubscribe = null;
      renderAdmin();
    });
  }

  function stopAdmin() {
    if (admin.unsubscribe) { admin.unsubscribe(); admin.unsubscribe = null; }
  }

  function updatePendingBadge() {
    if (!adminButton) return;
    var badge = adminButton.querySelector('.count-badge');
    var n = counts(admin.records).pending;
    if (badge) { badge.textContent = String(n); badge.hidden = !n; }
  }

  function protectionBanner() {
    var p = gateState && gateState.protected;
    if (p === false) {
      return '<div class="admin-banner is-warning"><b>The approval gate is not switched on yet.</b> The database rules that keep parents\' details private and stop students approving themselves have not been published, so the apps are not asking anybody yet. Once they are published, every student is asked the first time they sign in.</div>';
    }
    return '';
  }

  function childRows(children) {
    if (!children || !children.length) return '<p class="muted">No children listed.</p>';
    var mark = classFiltered();
    return '<table class="child-table"><thead><tr><th>Child</th><th>Level</th><th>Subjects</th></tr></thead><tbody>' +
      children.map(function (c) {
        // With a level or subject filter on, the children that fit it stand out.
        var hit = mark && childMatches(c, admin.level, admin.subject);
        return '<tr' + (hit ? ' class="is-match"' : '') + '><td>' + esc(c && c.name) + '</td><td>' + esc(levelLabel(c && c.level)) + '</td><td>' + esc(subjectsLabel(c && c.subjects)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------------- classify and filter: the controls (v1.6.0) ---------------- */
  function chip(kind, value, label, count, active) {
    return '<button type="button" class="filter-chip' + (active ? ' is-active' : '') + '" aria-pressed="' + active + '" data-admin="' + kind + '" data-value="' + esc(value) + '">' +
      esc(label) + (count === null ? '' : ' <span>' + count + '</span>') + '</button>';
  }
  function optionsHtml(list, value) {
    return list.map(function (p) { return '<option value="' + esc(p[0]) + '"' + (p[0] === value ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
  }
  function classControls(base) {
    var cc = chipCounts(base, admin.level, admin.subject);
    var levels = [chip('level', 'all', 'All levels', cc.levels.all, admin.level === 'all')];
    LEVELS.forEach(function (pair) {
      var n = cc.levels[pair[0]] || 0;
      if (n || admin.level === pair[0]) levels.push(chip('level', pair[0], pair[0] === 'Other' ? 'Other' : pair[0], n, admin.level === pair[0]));
    });
    var subjects = SUBJECT_FILTERS.map(function (pair) {
      return chip('subject', pair[0], pair[1], cc.subjects[pair[0]] || 0, admin.subject === pair[0]);
    });
    return '<div class="class-filters" aria-label="Filter by level and subjects">' +
      '<div class="class-row"><span class="class-label">Level</span><div class="filter-chips">' + levels.join('') + '</div></div>' +
      '<div class="class-row"><span class="class-label">Subjects</span><div class="filter-chips">' + subjects.join('') + '</div></div>' +
      '<div class="class-row class-arrange">' +
        '<label class="class-select">Show<select data-admin-select="group">' + optionsHtml(GROUPS, admin.group) + '</select></label>' +
        '<label class="class-select">Sort<select data-admin-select="sort">' + optionsHtml(SORTS, admin.sort) + '</select></label>' +
        '<div class="view-toggle" role="group" aria-label="Layout">' + VIEWS.map(function (p) {
          return '<button type="button" class="filter-chip' + (admin.view === p[0] ? ' is-active' : '') + '" aria-pressed="' + (admin.view === p[0]) + '" data-admin="view" data-value="' + p[0] + '">' + esc(p[1]) + '</button>';
        }).join('') + '</div>' +
        (classFiltered() || admin.query ? '<button type="button" class="button button-small" data-admin="clear-class">Clear filters</button>' : '') +
      '</div>' +
    '</div>';
  }
  /** "Students by level": children per level × subject choice; each number filters to exactly those. */
  function classGrid(base) {
    var grid = classify(base);
    if (!grid.rows.length) return '';
    var cell = function (level, subject, n) {
      var active = admin.level === level && admin.subject === subject;
      return n ? '<button type="button" class="grid-cell' + (active ? ' is-active' : '') + '" data-admin="cell" data-level="' + esc(level) + '" data-subject="' + esc(subject) + '" aria-label="' + n + ' ' + esc(level === 'all' ? 'children' : levelLabel(level)) + ' ' + esc(subject === 'all' ? '' : subjectsLabel(subject)) + '">' + n + '</button>'
        : '<span class="grid-zero">·</span>';
    };
    var rows = grid.rows.map(function (r) {
      var key = r.level || 'all';
      return '<tr><th scope="row">' + esc(r.level ? levelLabel(r.level) : 'No level') + '</th>' +
        '<td>' + cell(key, 'math', r.math) + '</td><td>' + cell(key, 'science', r.science) + '</td><td>' + cell(key, 'both', r.both) + '</td>' +
        '<td class="grid-total">' + cell(key, 'all', r.total) + '</td></tr>';
    }).join('');
    var t = grid.total;
    return '<details class="class-grid"' + (admin.gridClosed ? '' : ' open') + '><summary>Students by level <span class="muted">· ' + t.total + ' child' + (t.total === 1 ? '' : 'ren') + ' · tap a number to list them</span></summary>' +
      '<div class="grid-scroll"><table><thead><tr><th scope="col">Level</th><th scope="col">Math only</th><th scope="col">Science only</th><th scope="col">Both</th><th scope="col">Total</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><th scope="row">All levels</th><td>' + cell('all', 'math', t.math) + '</td><td>' + cell('all', 'science', t.science) + '</td><td>' + cell('all', 'both', t.both) + '</td><td class="grid-total">' + cell('all', 'all', t.total) + '</td></tr></tfoot>' +
      '</table></div></details>';
  }
  /** One row per child that fits, for scanning many families at once. */
  /** Each family → its child rows (only the children that fit when a filter is on). */
  function childRowsOf(list) {
    var out = [];
    list.forEach(function (record) {
      var kids = classFiltered() ? matchingChildren(record, admin.level, admin.subject) : ((record.children && record.children.length) ? record.children : [null]);
      kids.forEach(function (c) { out.push({ record: record, child: c }); });
    });
    return out;
  }
  function tableHtml(pairs) {
    var rows = [];
    pairs.forEach(function (pair) {
      var record = pair.record, c = pair.child;
      var status = statusOf(record);
      (function () {
        rows.push('<tr class="is-' + status + '">' +
          '<td data-label="Child">' + esc(c ? c.name : '—') + '</td>' +
          '<td data-label="Level">' + esc(c ? shortLevel(c.level) : '—') + '</td>' +
          '<td data-label="Subjects">' + esc(c ? subjectsLabel(c.subjects) : '—') + '</td>' +
          '<td data-label="Parent"><b>' + esc(record.parentName || '(no name)') + '</b><div class="muted">' + esc(record.parentEmail || '') + '</div></td>' +
          '<td data-label="Status"><span class="status-chip is-' + status + '">' + esc(STATUS_LABEL[status]) + '</span></td>' +
          '<td data-label="Sent" class="muted">' + esc(sgTime(record.submittedAt)) + '</td>' +
          '<td class="row-actions">' +
            (status !== 'approved' ? '<button type="button" class="button button-small button-accent" data-admin="approve" data-id="' + esc(record._id) + '"' + (admin.busy[record._id] ? ' disabled' : '') + '>✓ Approve</button>' : '') +
            '<button type="button" class="button button-small" data-admin="open-card" data-id="' + esc(record._id) + '">Edit</button>' +
          '</td></tr>');
      })();
    });
    return '<div class="table-scroll"><table class="account-table"><thead><tr><th>Child</th><th>Level</th><th>Subjects</th><th>Parent</th><th>Status</th><th>Sent</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div>';
  }
  function listHtml(shown) {
    var sorted = sortBy(shown, admin.sort, admin.level, admin.subject);
    if (admin.view === 'table' && (admin.group === 'level' || admin.group === 'subjects')) {
      // In the table each CHILD goes under its own level / subjects (a P3 and a P5 sibling part ways).
      var buckets = {}, keys = [];
      childRowsOf(sorted).forEach(function (pair) {
        var key = admin.group === 'level' ? ((pair.child && pair.child.level) || '') : ((pair.child && lower(pair.child.subjects)) || 'none');
        if (!buckets[key]) { buckets[key] = []; keys.push(key); }
        buckets[key].push(pair);
      });
      var subjectOrder = ['math', 'science', 'both', 'none'];
      keys.sort(function (a, b) { return admin.group === 'level' ? levelRank(a) - levelRank(b) : subjectOrder.indexOf(a) - subjectOrder.indexOf(b); });
      return keys.map(function (key) {
        var pairs = buckets[key], fams = [];
        pairs.forEach(function (p) { if (fams.indexOf(p.record._id) < 0) fams.push(p.record._id); });
        var label = admin.group === 'level' ? (key ? levelLabel(key) : 'No level') : (key === 'none' ? 'No subjects chosen' : subjectsLabel(key));
        return '<section class="record-group"><h3 class="group-head">' + esc(label) + ' <span class="muted">· ' + pairs.length + ' child' + (pairs.length === 1 ? '' : 'ren') + ', ' + fams.length + ' famil' + (fams.length === 1 ? 'y' : 'ies') + '</span></h3>' + tableHtml(pairs) + '</section>';
      }).join('');
    }
    var groups = groupRecords(sorted, admin.group, admin.level, admin.subject);
    return groups.map(function (g) {
      var kids = 0;
      g.records.forEach(function (r) { kids += classFiltered() ? matchingChildren(r, admin.level, admin.subject).length : ((r.children || []).length); });
      var head = g.label ? '<h3 class="group-head">' + esc(g.label) + ' <span class="muted">· ' + g.records.length + ' famil' + (g.records.length === 1 ? 'y' : 'ies') + ', ' + kids + ' child' + (kids === 1 ? '' : 'ren') + '</span></h3>' : '';
      return '<section class="record-group">' + head + (admin.view === 'table' ? tableHtml(childRowsOf(g.records)) : '<div class="record-list">' + g.records.map(recordHtml).join('') + '</div>') + '</section>';
    }).join('');
  }

  /** Which subject apps this family opens, as the admin sees it on each request. */
  function appChips(record) {
    var have = approvedSubjects(record);
    var online = onlineAccessFor(record).map(function (p) { return p.level + ' ' + p.subjects.map(appSubjectLabel).join(' + '); });
    return '<div class="record-apps" aria-label="Apps this family opens">' +
      APP_SUBJECTS.map(function (p) {
        var on = have.indexOf(p[0]) >= 0;
        return '<span class="app-chip ' + (on ? 'is-on' : 'is-off') + '">' + (on ? '✓ ' : '') + esc(p[1]) + '</span>';
      }).join('') +
      '<span class="app-chip is-on">✓ English, Chinese, Study Buddy, Answer Keys, Rewards</span>' +
      (online.length ? '<span class="app-chip is-on">Worksheets: ' + esc(online.join(', ')) + '</span>' : '<span class="app-chip is-off">Worksheets</span>') +
    '</div>';
  }

  function selectHtml(name, list, value, placeholder) {
    return '<select name="' + name + '">' + (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      list.map(function (p) { return '<option value="' + esc(p[0]) + '"' + (p[0] === value ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select>';
  }

  function editHtml(record) {
    // What the admin has typed so far wins over the record (the list redraws live).
    var draft = (admin.editing && admin.editing.draft) || null;
    var shown = {};
    Object.keys(record).forEach(function (k) { shown[k] = record[k]; });
    if (draft) { shown.parentName = draft.parentName; shown.parentEmail = draft.parentEmail; shown.status = draft.status; shown.adminNote = draft.adminNote; }
    record = shown;
    var children = (admin.editing && admin.editing.children) || record.children || [];
    var rows = children.map(function (c, i) {
      return '<div class="edit-child" data-index="' + i + '">' +
        '<input type="text" name="childName" placeholder="Full name" value="' + esc(c.name) + '" maxlength="120">' +
        selectHtml('childLevel', LEVELS, c.level, 'Level') +
        selectHtml('childSubjects', SUBJECTS, c.subjects, 'Subjects') +
        '<button type="button" class="button button-small" data-admin="remove-child" data-index="' + i + '" aria-label="Remove child ' + (i + 1) + '">Remove</button>' +
      '</div>';
    }).join('');
    return '<form class="edit-form" data-admin-form="' + esc(record._id) + '">' +
      '<div class="edit-grid">' +
        '<label>Parent\'s name<input type="text" name="parentName" value="' + esc(record.parentName) + '" maxlength="120"></label>' +
        '<label>Parent\'s email<input type="email" name="parentEmail" value="' + esc(record.parentEmail) + '" maxlength="200"></label>' +
        '<label>Access' + selectHtml('status', [['approved', 'Approved'], ['pending', 'Waiting for approval'], ['revoked', 'Paused']], statusOf(record)) + '</label>' +
      '</div>' +
      '<div class="edit-children"><b>Children</b>' + rows +
        '<button type="button" class="button button-small" data-admin="add-child">+ Add a child</button></div>' +
      '<label class="edit-note">Note (the student sees it when access is paused)<input type="text" name="adminNote" value="' + esc(record.adminNote) + '" maxlength="500"></label>' +
      '<div class="record-actions">' +
        '<button type="submit" class="button button-accent">Save changes</button>' +
        '<button type="button" class="button" data-admin="cancel-edit">Cancel</button>' +
      '</div>' +
    '</form>';
  }

  function recordHtml(record) {
    var status = statusOf(record);
    var id = esc(record._id);
    var editing = admin.editing && admin.editing.id === record._id;
    var confirming = admin.confirming && admin.confirming.id === record._id ? admin.confirming.action : '';
    var busy = admin.busy[record._id];
    var actions = '';
    if (!editing) {
      if (status !== 'approved') actions += '<button type="button" class="button button-accent" data-admin="approve" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>✓ Approve</button>';
      if (status !== 'revoked') actions += '<button type="button" class="button" data-admin="revoke" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>' +
        (confirming === 'revoke' ? 'Tap again to pause access' : (status === 'pending' ? 'Decline' : 'Pause access')) + '</button>';
      actions += '<button type="button" class="button" data-admin="edit" data-id="' + id + '">Edit</button>';
      actions += '<button type="button" class="button button-danger" data-admin="delete" data-id="' + id + '"' + (busy ? ' disabled' : '') + '>' +
        (confirming === 'delete' ? 'Tap again to delete' : 'Delete') + '</button>';
    }
    var decided = record.decidedBy ? '<div class="muted">' + esc(STATUS_LABEL[status] || status) + ' by ' + esc(record.decidedBy) + ' · ' + esc(sgTime(record.decidedAt)) + '</div>' : '';
    return '<article class="record is-' + status + '" data-record="' + id + '">' +
      '<header class="record-head">' +
        '<div><h3>' + esc(record.parentName || '(no name)') + '</h3>' +
          '<div class="muted">' + esc(record.parentEmail || '') + '</div></div>' +
        '<span class="status-chip is-' + status + '">' + esc(STATUS_LABEL[status]) + '</span>' +
      '</header>' +
      (editing ? editHtml(record) :
        childRows(record.children) +
        '<div class="record-meta">' +
          '<div><span class="muted">Account:</span> ' + esc(accountLabel(record.email)) + '</div>' +
          '<div><span class="muted">Sent:</span> ' + esc(sgTime(record.submittedAt)) + (record.app ? ' from ' + esc(record.app) : '') +
            (record.submissions > 1 ? ' · sent ' + esc(record.submissions) + ' times' : '') + '</div>' +
          (record.enrolled === true ? '<div><span class="muted">Confirmed still enrolled</span> ✓</div>' : '') +
          appChips(record) +
          (record.adminNote ? '<div><span class="muted">Note:</span> ' + esc(record.adminNote) + '</div>' : '') +
          decided +
        '</div>' +
        '<div class="record-actions">' + actions + '</div>') +
    '</article>';
  }

  function renderAdmin() {
    if (!adminView || !wantsAdmin()) return;
    if (!user) {
      adminView.innerHTML = '<div class="admin-card"><h2 id="adminTitle">Student access — admin</h2><p>Sign in with an admin account (above) to approve students.</p><p><a href="#">← Back to apps</a></p></div>';
      return;
    }
    if (!isAdmin(user)) {
      adminView.innerHTML = '<div class="admin-card"><h2 id="adminTitle">Admins only</h2><p>This page is only for Polymath\'s admin accounts. You are signed in as <b>' + esc(accountLabel(user.email)) + '</b>.</p><p><a href="#">← Back to your apps</a></p></div>';
      return;
    }
    // Keep an open Edit form's unsaved answers across the live redraw.
    if (admin.editing && admin.editing.fresh) {
      delete admin.editing.fresh;   // the rows were just changed on purpose (add / remove a child)
    } else if (admin.editing) {
      var openForm = adminView.querySelector('[data-admin-form="' + admin.editing.id + '"]');
      if (openForm) {
        var typed = readEditForm(openForm);
        admin.editing.children = typed.children;
        admin.editing.draft = typed;
      }
    }
    var c = counts(admin.records);
    var filters = [['pending', 'Waiting', c.pending], ['approved', 'Approved', c.approved], ['revoked', 'Paused', c.revoked], ['all', 'All', c.all]];
    // The status chips and the search narrow first; level and subjects then classify what is left.
    var base = admin.records.filter(function (r) {
      return (admin.filter === 'all' || statusOf(r) === admin.filter) && matches(r, admin.query);
    });
    var shown = base.filter(function (r) { return recordMatchesClass(r, admin.level, admin.subject); });
    var shownKids = 0;
    shown.forEach(function (r) { shownKids += classFiltered() ? matchingChildren(r, admin.level, admin.subject).length : (r.children || []).length; });
    // Keep the search box (and its caret) while the list below redraws.
    var existingSearch = adminView.querySelector('#adminSearch');
    var hadFocus = existingSearch && document.activeElement === existingSearch;
    var caret = hadFocus ? existingSearch.selectionStart : null;
    adminView.innerHTML =
      '<div class="admin-head">' +
        '<div><h2 id="adminTitle">Student access</h2>' +
        '<p class="muted">Approve each family before they can use any Polymath app. Signed in as ' + esc(user.email) + '.</p></div>' +
        '<a class="button" href="#">← Back to apps</a>' +
      '</div>' +
      protectionBanner() +
      (admin.error ? '<div class="admin-banner is-error">' + esc(admin.error) + '</div>' : '') +
      (admin.notice ? '<div class="admin-banner is-warning">' + esc(admin.notice) + '</div>' : '') +
      '<div class="admin-tools">' +
        '<div class="filter-chips" role="tablist">' + filters.map(function (f) {
          return '<button type="button" role="tab" class="filter-chip' + (admin.filter === f[0] ? ' is-active' : '') + '" aria-selected="' + (admin.filter === f[0]) + '" data-admin="filter" data-filter="' + f[0] + '">' + f[1] + ' <span>' + f[2] + '</span></button>';
        }).join('') + '</div>' +
        '<input type="search" id="adminSearch" placeholder="Search parent, child or email" value="' + esc(admin.query) + '" aria-label="Search requests">' +
      '</div>' +
      (admin.loaded ? classControls(base) + classGrid(base) : '') +
      (!admin.loaded && !admin.error ? '<p class="muted">Loading requests…</p>' : '') +
      (admin.loaded && shown.length ? '<p class="muted result-line" id="adminResultLine">Showing ' + shown.length + ' famil' + (shown.length === 1 ? 'y' : 'ies') + ' · ' + shownKids + ' child' + (shownKids === 1 ? '' : 'ren') + '</p>' : '') +
      (admin.loaded && !shown.length ? '<div class="admin-empty">' + (admin.filter === 'pending' && !admin.query && !classFiltered() ? 'Nobody is waiting for approval. 🎉' : 'No accounts match these filters.') + '</div>' : '') +
      '<div id="adminList">' + listHtml(shown) + '</div>' +
      '<p class="muted admin-foot">Each child\'s subjects decide the apps: Math only opens Math, Science only opens Science and Science PSLE, Both opens all three. English, Chinese, Study Buddy, Answer Keys and Rewards open for every approved family, and the Worksheets portal shows each child\'s own level (P3 to P6) and subjects. Change them with Edit; every app follows. Staff and teacher accounts (the three admins, Elsie, Abigail and Keertana) are never asked. Anyone else who signs in to a Polymath app is asked once and waits here.</p>';
    if (hadFocus) {
      var search = adminView.querySelector('#adminSearch');
      if (search) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (error) { /* fine */ } }
    }
  }

  function findRecord(id) {
    for (var i = 0; i < admin.records.length; i++) if (admin.records[i]._id === id) return admin.records[i];
    return null;
  }

  function decide(id, status) {
    var record = findRecord(id);
    if (!record || !db) return;
    admin.busy[id] = true; renderAdmin();
    db.collection('studentAccess').doc(id).update({
      status: status,
      decidedBy: lower(user.email),
      decidedAt: fb.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      var next = {};
      Object.keys(record).forEach(function (k) { next[k] = record[k]; });
      next.status = status;
      return syncOnline(id, next);
    }).catch(function (error) {
      admin.error = 'Could not save: ' + (error && error.message ? error.message : 'unknown error');
    }).then(function () { delete admin.busy[id]; admin.confirming = null; renderAdmin(); });
  }

  /* -------- Polymath Online follows this page (onlineMembers/{uid}) -------- */
  function firestoreValue(value) {
    if (value === SERVER_TIME) return fb.firestore.FieldValue.serverTimestamp();
    if (value === DELETE_FIELD) return fb.firestore.FieldValue.delete();
    return value;
  }
  /** Bring one account's Online row in line with its record. Never fails the admin's save. */
  function syncOnline(id, record) {
    if (!db || !id) return Promise.resolve(false);
    var ref = db.collection(ONLINE_MEMBERS).doc(id);
    return ref.get().then(function (snap) {
      var existing = snap && snap.exists ? (snap.data() || {}) : null;
      var patch = onlineMemberPatch(record, existing, id);
      if (!patch) return false;
      var data = {};
      Object.keys(patch).forEach(function (k) { data[k] = firestoreValue(patch[k]); });
      return ref.set(data, { merge: true }).then(function () { return true; });
    }).catch(function (error) {
      admin.notice = 'Saved. The Worksheets portal could not be updated just now (' + (error && error.code ? error.code : 'error') + '); it still follows this page when the student opens it.';
      return false;
    });
  }
  /**
   * Once per visit: every request whose Online row disagrees with it (approved
   * before v1.5.0, or changed elsewhere) is brought in line. Quietly; a failure
   * only means the portal keeps reading the approval itself.
   */
  var reconciled = false;
  function reconcileOnline() {
    if (reconciled || !db || !admin.loaded || !admin.records.length) return;
    reconciled = true;
    var list = admin.records.slice();
    (function next(i) {
      if (i >= list.length) return;
      syncOnline(list[i]._id, list[i]).then(function () { next(i + 1); });
    })(0);
  }

  function remove(id) {
    if (!db) return;
    admin.busy[id] = true; renderAdmin();
    db.collection('studentAccess').doc(id).delete().catch(function (error) {
      admin.error = 'Could not delete: ' + (error && error.message ? error.message : 'unknown error');
    }).then(function () { delete admin.busy[id]; admin.confirming = null; renderAdmin(); });
  }

  function readEditForm(form) {
    var children = Array.prototype.map.call(form.querySelectorAll('.edit-child'), function (row) {
      return {
        name: row.querySelector('[name="childName"]').value,
        level: row.querySelector('[name="childLevel"]').value,
        subjects: row.querySelector('[name="childSubjects"]').value
      };
    });
    return {
      parentName: form.querySelector('[name="parentName"]').value,
      parentEmail: form.querySelector('[name="parentEmail"]').value,
      status: form.querySelector('[name="status"]').value,
      adminNote: form.querySelector('[name="adminNote"]').value,
      children: children
    };
  }

  function saveEdit(form) {
    var id = form.getAttribute('data-admin-form');
    var record = findRecord(id);
    if (!record || !db) return;
    var values = readEditForm(form);
    var next = editedRecord(record, values);
    delete next._id;
    if (next.status !== statusOf(record)) {
      next.decidedBy = lower(user.email);
      next.decidedAt = fb.firestore.FieldValue.serverTimestamp();
    }
    next.updatedBy = lower(user.email);
    next.updatedAt = fb.firestore.FieldValue.serverTimestamp();
    admin.busy[id] = true;
    db.collection('studentAccess').doc(id).set(next).then(function () {
      admin.editing = null;
      return syncOnline(id, next);
    }).catch(function (error) {
      admin.error = 'Could not save: ' + (error && error.message ? error.message : 'unknown error');
    }).then(function () { delete admin.busy[id]; renderAdmin(); });
  }

  if (adminView) {
    adminView.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-admin]') : null;
      if (!target) return;
      var action = target.getAttribute('data-admin');
      var id = target.getAttribute('data-id');
      if (action === 'filter') { admin.filter = target.getAttribute('data-filter'); savePrefs(); renderAdmin(); return; }
      if (action === 'level' || action === 'subject' || action === 'view') {
        admin[action] = target.getAttribute('data-value');
        savePrefs(); renderAdmin(); return;
      }
      if (action === 'cell') {
        var lv = target.getAttribute('data-level'), sb = target.getAttribute('data-subject');
        var same = admin.level === lv && admin.subject === sb;
        admin.level = same ? 'all' : lv; admin.subject = same ? 'all' : sb;   // a second tap clears it
        savePrefs(); renderAdmin();
        var list = adminView.querySelector('#adminResultLine');
        if (list && list.scrollIntoView) { try { list.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (error) { /* fine */ } }
        return;
      }
      if (action === 'clear-class') { admin.level = 'all'; admin.subject = 'all'; admin.query = ''; savePrefs(); renderAdmin(); return; }
      if (action === 'open-card') {
        var rec0 = findRecord(id);
        admin.view = 'cards';
        admin.editing = { id: id, children: ((rec0 && rec0.children) || []).map(function (c) { return { name: c.name || '', level: c.level || '', subjects: c.subjects || '' }; }) };
        savePrefs(); renderAdmin();
        var card0 = adminView.querySelector('[data-record="' + id + '"]');
        if (card0 && card0.scrollIntoView) { try { card0.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (error) { /* fine */ } }
        return;
      }
      if (action === 'approve') { decide(id, 'approved'); return; }
      if (action === 'revoke' || action === 'delete') {
        if (admin.confirming && admin.confirming.id === id && admin.confirming.action === action) {
          if (action === 'revoke') decide(id, 'revoked'); else remove(id);
        } else {
          admin.confirming = { id: id, action: action };
          renderAdmin();
          setTimeout(function () {
            if (admin.confirming && admin.confirming.id === id && admin.confirming.action === action) { admin.confirming = null; renderAdmin(); }
          }, 4000);
        }
        return;
      }
      if (action === 'edit') {
        var record = findRecord(id);
        admin.editing = { id: id, children: ((record && record.children) || []).map(function (c) { return { name: c.name || '', level: c.level || '', subjects: c.subjects || '' }; }) };
        renderAdmin();
        return;
      }
      if (action === 'cancel-edit') { admin.editing = null; renderAdmin(); return; }
      if (action === 'add-child' || action === 'remove-child') {
        var form = target.closest('form');
        if (!form || !admin.editing) return;
        var values = readEditForm(form);
        admin.editing.children = values.children;
        if (action === 'add-child') admin.editing.children.push({ name: '', level: '', subjects: '' });
        else admin.editing.children.splice(parseInt(target.getAttribute('data-index'), 10), 1);
        admin.editing.draft = values;
        admin.editing.fresh = true;
        var rec = findRecord(admin.editing.id);
        if (rec) {
          // Keep what was typed in the other boxes while the rows change.
          rec._draft = values;
        }
        renderAdmin();
        var again = adminView.querySelector('[data-admin-form="' + admin.editing.id + '"]');
        if (again && rec && rec._draft) {
          again.querySelector('[name="parentName"]').value = rec._draft.parentName;
          again.querySelector('[name="parentEmail"]').value = rec._draft.parentEmail;
          again.querySelector('[name="status"]').value = rec._draft.status;
          again.querySelector('[name="adminNote"]').value = rec._draft.adminNote;
          delete rec._draft;
        }
      }
    });
    adminView.addEventListener('submit', function (event) {
      var form = event.target;
      if (form && form.hasAttribute('data-admin-form')) { event.preventDefault(); saveEdit(form); }
    });
    adminView.addEventListener('change', function (event) {
      var which = event.target && event.target.getAttribute && event.target.getAttribute('data-admin-select');
      if (which === 'group' || which === 'sort') { admin[which] = event.target.value; savePrefs(); renderAdmin(); }
    });
    adminView.addEventListener('toggle', function (event) {
      if (event.target && event.target.classList && event.target.classList.contains('class-grid')) admin.gridClosed = !event.target.open;
    }, true);
    adminView.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'adminSearch') { admin.query = event.target.value; renderAdmin(); }
    });
  }

  /* ------------------------------ wiring ------------------------------ */
  auth.onAuthStateChanged(function (next) {
    user = next && !next.isAnonymous ? next : null;
    loginBusy = false;
    if (!user) { stopAdmin(); admin.records = []; admin.loaded = false; }
    renderAccount();
    showView();
    applySubjectLocks();
    // Admins see how many are waiting, even from the apps view.
    if (isAdmin(user) && !admin.unsubscribe) startAdmin();
  });
  window.addEventListener('hashchange', function () { renderAccount(); showView(); });

  function watchGate() {
    if (!window.PolymathAccess || typeof window.PolymathAccess.onChange !== 'function') return false;
    window.PolymathAccess.onChange(function (snapshot) { gateState = snapshot; renderAccount(); applySubjectLocks(); if (wantsAdmin()) renderAdmin(); });
    return true;
  }
  if (!watchGate()) document.addEventListener('DOMContentLoaded', watchGate);

  renderAccount();
  showView();
})();
