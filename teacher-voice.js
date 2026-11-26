/* 📖 teacher-voice.js — the teacher's OWN answers, question by question, for
   every Polymath app.

   This file is the SAME, byte for byte, in Ans Key (polymathlc/anskey), Study
   Buddy (polymathlc/tutor), the Science portal (polymathlc/cer) and Scan
   (polymathlc/scan). Each repository's tools/teacher-voice-tests.mjs compares
   its copy with every sibling checked out beside it. Change it in all four or
   in none.

   WHY IT EXISTS. The style corpus (users/{admin}/aiTraining/answerStyle) holds
   a few hundred of the teacher's answers and a paragraph describing how they
   write. That makes an answer SOUND like the teacher. It cannot make it BE the
   teacher's answer: a question the teacher has already answered on paper was
   still answered from scratch by every app, and the "similar" exemplars were
   whichever six happened to share the most words. This is the missing half —
   the ANSWER BOOK:

     users/{admin}/aiTraining/answerBook/entries/{id}   one answer per question
       { v, id, k, n, q, a, src, lvl, sub, bucket, ws, doc, page, at, by }
     users/{admin}/aiTraining/answerIndex-<bucket>      the QUESTIONS only
       { v, bucket, rows: [{ id, n, q, ws, doc, page, at, src }], at }
     users/{admin}/aiTraining/answerIndex               which buckets exist
       { v, buckets: { '<bucket>': { n, at } }, at }

   Ans Key is the ONE writer (the teacher's typed and handwritten answers, tied
   to the question they answer). Every app reads.

   ONE QUESTION AT A TIME. The index holds the questions and never an answer,
   so a student's device can find which of the teacher's answers belong to the
   paper in front of it (the questions are printed on that paper anyway) and
   then fetch ONLY those entries. A device never downloads the whole book
   unless it is the teacher's own.

   WHAT THE PROMPT IS TOLD (`block`). For the SAME question the teacher's
   answer is the model answer: an answer is written the way they wrote it, a
   mark is given against it, an explanation walks through it, and a hint uses
   it only to know where the method is going — never states it. The printed
   answer key still wins on the final VALUE (a slip on paper must not become
   the key); the teacher decides the wording, the working and the keywords.
   A SIMILAR question (same words, different numbers) lends its method and its
   layout, never its numbers.

   NOTHING HERE TALKS TO A MODEL, and nothing here knows a Firebase SDK: the
   host hands the reader `getDoc(path) → data|null` and, for the teacher's own
   device, `listEntries(filter) → [data]`. That is what lets one file serve a
   compat-SDK app and a modular-SDK app alike. */
(function (root) {
  'use strict';

  var VERSION = 1;
  var COLL = 'aiTraining';
  var BOOK_DOC = 'answerBook';
  var ENTRIES = 'entries';
  var INDEX_DOC = 'answerIndex';
  var INDEX_PREFIX = 'answerIndex-';

  var Q_CHARS = 600;          // a question, as stored on its entry
  var ROW_Q_CHARS = 320;      // …and on its index row (enough words to match on)
  var A_CHARS = 1800;         // an answer with its working
  var WS_CHARS = 80;
  var ROWS_MAX = 1500;        // index rows per bucket — one Firestore document (~600 KB)
  var PRIME_MAX = 40;         // entries fetched for one paper
  var FETCH_PAR = 6;          // entry reads in flight at once
  var BLOCK_SAME_MAX = 2;     // the teacher's answers to THIS question, in a prompt
  var BLOCK_SIMILAR_MAX = 2;  // …and to questions like it
  var BLOCK_PAPER_MAX = 14;   // answers to questions on the paper, when no one question is in hand
  var BLOCK_CHARS = 5200;     // the whole block, at most

  var SAME_MIN = 0.62;        // word overlap (Dice) for "the same question"
  var SIMILAR_MIN = 0.42;     // …for "a question like it"
  var PAGE_MIN = 0.72;        // share of a question's words found on a page
  var MIN_WORDS = 4;          // fewer content words than this can never match

  var STOP = {};
  ('a an the of to in on at by for from with and or but is are was were be been being it its this that these ' +
   'those as into than then there their they them he she his her we our you your i me my do does did done has ' +
   'have had will would shall should can could may might must not no yes so if which what who whom whose when ' +
   'where why how all any each some such very also just only about after before over under up down out off ' +
   'again more most other own same too both few many much one two three four five six seven eight nine ten ' +
   'question questions answer answers show working marks mark write below above given following ' +
   'statement statements use using box boxes space spaces').split(/\s+/).forEach(function (w) { if (w) STOP[w] = 1; });

  var NUM_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', half: '1/2', quarter: '1/4' };

  /* ---------------------------------------------------------------- text */

  function str(v) { return v == null ? '' : String(v); }

  function clip(s, cap) {
    var t = str(s).replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (t.length <= cap) return t;
    var cut = t.slice(0, Math.max(1, cap - 1));
    var sp = cut.lastIndexOf(' ');
    if (sp > cap * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/\s+$/, '') + '…';
  }

  function oneLine(s, cap) { return clip(str(s).replace(/\s+/g, ' '), cap); }

  /* Folded to what a reader would call "the same text": lower case, curly
     quotes and dashes straightened, the multiplication and division signs
     spelled as the keyboard spells them, a leading question number taken off. */
  function norm(text) {
    var t = str(text).normalize ? str(text).normalize('NFKC') : str(text);
    t = t.toLowerCase()
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/×/g, ' x ')
      .replace(/÷/g, ' / ')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')          // 1,200 → 1200
      .replace(/\[\s*\d+\s*(?:m|mks?|marks?)?\s*\]/g, ' ')   // [2], [2 marks] — the marks, not the question
      .replace(/\(\s*\d+\s*(?:m|mks?|marks?)\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // "Q5", "5." and "(5)" are a question number; "5 pens cost $15" is not.
    t = t.replace(/^(?:q(?:uestion)?\s*\d{1,2}[a-z]?[.):]?|\(?\d{1,2}[a-z]?[.)]|\(\d{1,2}[a-z]?\))\s+/, '');
    return t;
  }

  /* The words that decide what a question is ABOUT. Numbers are kept as words
     of their own ("2.5", "3/4", "40%"), because "the same question with other
     numbers" is a different question with the same method — see `relation`. */
  function words(text) {
    var t = norm(text);
    var out = [];
    var re = /\d+(?:\.\d+)?(?:\/\d+)?%?|[a-z][a-z'-]*/g;
    var m;
    while ((m = re.exec(t))) {
      var w = m[0].replace(/^'+|'+$/g, '').replace(/-+$/, '');
      if (!w) continue;
      if (NUM_WORDS[w]) { out.push(NUM_WORDS[w]); continue; }
      if (/^[a-z]/.test(w)) {
        if (w.length < 2 || STOP[w]) continue;
        w = stem(w);
      }
      out.push(w);
    }
    return out;
  }

  // A light stemmer: plurals and the commonest endings, so "evaporates",
  // "evaporated" and "evaporation" are not three different words to a match.
  function stem(w) {
    if (w.length <= 4) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ss|us|is)$/.test(w)) return w;
    var s = w.replace(/(ations?|itions?|ings?|ments?|ness|edly|ed|es|ly|s)$/, '');
    if (s.length < 3) s = w;
    // Six letters is enough to tell words apart and short enough that
    // "evaporates" and "evaporation" land on one stem.
    return s.length > 6 ? s.slice(0, 6) : s;
  }

  function numbersOf(text) {
    return words(text).filter(function (w) { return /^\d/.test(w); }).sort();
  }

  function bag(list) {
    var b = {};
    (list || []).forEach(function (w) { b[w] = (b[w] || 0) + 1; });
    return b;
  }

  function overlapCount(a, b) {
    var n = 0;
    for (var k in a) if (Object.prototype.hasOwnProperty.call(b, k)) n += Math.min(a[k], b[k]);
    return n;
  }

  function sizeOf(b) { var n = 0; for (var k in b) n += b[k]; return n; }

  // Dice over word bags: 1 is the same words, 0 is none in common.
  function similarity(a, b) {
    var A = bag(Array.isArray(a) ? a : words(a));
    var B = bag(Array.isArray(b) ? b : words(b));
    var na = sizeOf(A), nb = sizeOf(B);
    if (!na || !nb) return 0;
    return (2 * overlapCount(A, B)) / (na + nb);
  }

  // How much of question `q` is found in `text` (a whole page, say).
  function asBag(x) {
    if (Array.isArray(x)) return bag(x);
    if (x && typeof x === 'object') return x;      // already a bag
    return bag(words(x));
  }
  function containment(q, text) {
    var Q = asBag(q);
    var T = asBag(text);
    var n = sizeOf(Q);
    if (!n) return 0;
    return overlapCount(Q, T) / n;
  }

  function sameNumbers(a, b) {
    var x = numbersOf(a), y = numbersOf(b);
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /* 'same' — the teacher answered THIS question: the words agree and so do
              the numbers (a maths answer to other numbers is another answer).
     'similar' — the same kind of question: its method and layout carry over,
              its numbers do not.
     ''     — nothing to say. */
  function relation(a, b) {
    var wa = words(a), wb = words(b);
    var content = function (ws) { return ws.filter(function (w) { return !/^\d/.test(w); }).length; };
    if (content(wa) < MIN_WORDS || content(wb) < MIN_WORDS) {
      // A very short question is "the same" only when it is the same text.
      return norm(a) && norm(a) === norm(b) ? 'same' : '';
    }
    var s = similarity(wa, wb);
    if (s >= SAME_MIN) return sameNumbers(a, b) ? 'same' : 'similar';
    if (s >= SIMILAR_MIN) return 'similar';
    return '';
  }

  /* -------------------------------------------------------- identities */

  // FNV-1a, 32-bit, as hex. Deterministic in every engine; used for ids only.
  function hash32(s) {
    var h = 0x811c9dc5;
    s = str(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function levelKey(lvl) {
    var l = str(lvl).toLowerCase().replace(/\s+/g, '');
    var m = l.match(/^(?:p|pri|primary)(\d)$/);
    if (m) return 'p' + m[1];
    m = l.match(/^(?:s|sec|secondary)(\d)$/);
    if (m) return 's' + m[1];
    return '';
  }

  function subjectKey(sub) {
    var s = str(sub).toLowerCase().trim();
    if (/^(math|maths|mathematics)$/.test(s)) return 'math';
    if (/^sci(ence)?$/.test(s)) return 'science';
    if (/^eng(lish)?$/.test(s)) return 'english';
    if (/^(chinese|cl|mandarin)$/.test(s)) return 'chinese';
    return '';    // 'both', '', anything else: no subject of its own
  }

  // One index document per level and subject; 'any' stands in for unknown.
  function bucketOf(lvl, sub) {
    return (levelKey(lvl) || 'any') + '-' + (subjectKey(sub) || 'any');
  }

  function indexDocId(bucket) {
    var b = str(bucket).toLowerCase().replace(/[^a-z0-9-]/g, '');
    return INDEX_PREFIX + (b || 'any-any');
  }

  // The entry's document id comes from its IDENTITY (`k`), never its content:
  // a corrected answer replaces the old one rather than sitting beside it.
  function entryId(k) {
    var s = str(k);
    return 'e' + hash32(s) + hash32(s.split('').reverse().join('')) + s.length.toString(36);
  }

  function slotKey(docId, ref) { return str(docId || 'local') + ':' + str(ref); }

  /* ------------------------------------------------------------ shapes */

  // THE ONE DOOR into an entry. Every write and every read goes through it,
  // so a field written by something other than Ans Key can never reach a
  // prompt in a shape the prompt was not built for.
  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var a = clip(e.a, A_CHARS);
    var q = clip(e.q, Q_CHARS);
    var k = oneLine(e.k, 200);
    if (!a || !k) return null;
    var lvl = levelKey(e.lvl), sub = subjectKey(e.sub);
    var out = {
      v: VERSION,
      id: entryId(k),
      k: k,
      n: oneLine(e.n, 12),
      q: q,
      a: a,
      src: /^(typed|read|key|edit)$/.test(str(e.src)) ? str(e.src) : 'typed',
      lvl: lvl,
      sub: sub,
      bucket: bucketOf(lvl, sub),
      ws: oneLine(e.ws, WS_CHARS),
      doc: oneLine(e.doc, 80),
      page: Number.isFinite(Number(e.page)) && Number(e.page) > 0 ? Math.floor(Number(e.page)) : 0,
      at: oneLine(e.at, 40) || '',
      by: oneLine(e.by, 20) || 'anskey'
    };
    if (e.fixed) out.fixed = true;      // the teacher corrected the reading in 📖 Answer book
    return out;
  }

  function rowOf(entry) {
    var e = cleanEntry(entry);
    if (!e) return null;
    return { id: e.id, n: e.n, q: oneLine(e.q, ROW_Q_CHARS), ws: e.ws, doc: e.doc, page: e.page, at: e.at, src: e.src };
  }

  function cleanRow(r) {
    if (!r || typeof r !== 'object' || !/^e[0-9a-z]{16,24}$/.test(str(r.id))) return null;
    return {
      id: str(r.id), n: oneLine(r.n, 12), q: oneLine(r.q, ROW_Q_CHARS), ws: oneLine(r.ws, WS_CHARS),
      doc: oneLine(r.doc, 80), page: Number(r.page) > 0 ? Math.floor(Number(r.page)) : 0,
      at: oneLine(r.at, 40), src: oneLine(r.src, 10)
    };
  }

  function cleanIndex(d, bucket) {
    var rows = (d && Array.isArray(d.rows)) ? d.rows.map(cleanRow).filter(Boolean) : [];
    return { v: VERSION, bucket: str((d && d.bucket) || bucket), rows: rows, at: oneLine(d && d.at, 40) };
  }

  /* Rows put in and taken out of one bucket's index. Newest first, at most
     ROWS_MAX — the oldest fall off the end and their entries stay readable by
     id (Ans Key deletes them when it next sweeps). Never edits its input. */
  function upsertRows(rows, add, remove) {
    var gone = {};
    (remove || []).forEach(function (id) { gone[str(id)] = 1; });
    var fresh = {};
    var list = (add || []).map(cleanRow).filter(Boolean);
    list.forEach(function (r) { fresh[r.id] = 1; });
    var kept = (rows || []).map(cleanRow).filter(function (r) { return r && !gone[r.id] && !fresh[r.id]; });
    var out = list.concat(kept);
    out.sort(function (x, y) { return str(y.at).localeCompare(str(x.at)); });
    return out.slice(0, ROWS_MAX);
  }

  /* ------------------------------------------------------- matching */

  // Index rows whose question is on this paper. `texts` are the pages' own
  // printed words (or the questions already read off them).
  function rowsOnPaper(rows, texts, opts) {
    var o = opts || {};
    var page = [];
    (texts || []).forEach(function (t) { page = page.concat(words(t)); });
    if (!page.length) return [];
    var P = bag(page);
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.q) return;
      var w = words(r.q);
      if (w.filter(function (x) { return !/^\d/.test(x); }).length < MIN_WORDS) return;
      var c = containment(bag(w), P);
      var bonus = (o.ws && r.ws && norm(r.ws) === norm(o.ws)) ? 0.1 : 0;
      if (c + bonus >= PAGE_MIN) out.push({ row: r, score: Math.min(1, c + bonus) });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, o.max || PRIME_MAX);
  }

  // Index rows that look like question `q` — what to fetch for one question.
  function rowsForQuestion(rows, q, max) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.q) return;
      var rel = relation(q, r.q);
      if (rel) out.push({ row: r, rel: rel, score: similarity(q, r.q) });
    });
    out.sort(function (x, y) { return (x.rel === y.rel ? 0 : x.rel === 'same' ? -1 : 1) || (y.score - x.score); });
    return out.slice(0, max || (BLOCK_SAME_MAX + BLOCK_SIMILAR_MAX));
  }

  /* The entries to put in a prompt. With a question in hand: the teacher's
     answers to THAT question first, then to questions like it. Without one
     (a whole page being marked): the answers to the questions on the paper,
     in paper order. `exclude` takes ids out — the Voice check hides the
     answer it is about to compare against. */
  function pick(entries, ctx) {
    var c = ctx || {};
    var ex = {};
    (c.exclude || []).forEach(function (id) { ex[str(id)] = 1; });
    var list = (entries || []).map(cleanEntry).filter(function (e) { return e && !ex[e.id]; });
    var sub = subjectKey(c.sub);
    if (sub) list = list.filter(function (e) { return !e.sub || e.sub === sub; });
    if (c.q && words(c.q).length) {
      var same = [], similar = [];
      list.forEach(function (e) {
        if (!e.q) return;
        var rel = relation(c.q, e.q);
        var s = similarity(c.q, e.q);
        if (rel === 'same') same.push({ e: e, s: s });
        else if (rel === 'similar') similar.push({ e: e, s: s });
      });
      var bySim = function (x, y) {
        var lv = levelKey(c.lvl);
        var lx = lv && x.e.lvl === lv ? 1 : 0, ly = lv && y.e.lvl === lv ? 1 : 0;
        return (y.s - x.s) || (ly - lx) || str(y.e.at).localeCompare(str(x.e.at));
      };
      same.sort(bySim); similar.sort(bySim);
      return {
        same: same.slice(0, BLOCK_SAME_MAX).map(function (x) { return x.e; }),
        similar: similar.slice(0, BLOCK_SIMILAR_MAX).map(function (x) { return x.e; }),
        paper: []
      };
    }
    var paper = list.filter(function (e) { return !c.paper || c.paper[e.id]; });
    paper.sort(function (x, y) {
      return (x.page - y.page) || (qNum(x.n) - qNum(y.n)) || str(x.n).localeCompare(str(y.n));
    });
    return { same: [], similar: [], paper: paper.slice(0, BLOCK_PAPER_MAX) };
  }

  function qNum(n) { var m = str(n).match(/\d+/); return m ? Number(m[0]) : 999; }

  /* -------------------------------------------------- the prompt block */

  var KIND_SAME = {
    answer: 'Write your answer THE WAY THE TEACHER WROTE THIS ONE: the same steps in the same order, the same ' +
      'keywords, the same layout and about the same length. Correct a slip only if the worksheet\'s own printed ' +
      'answer key gives a different final value — then the key wins on the value and everything else stays the ' +
      'teacher\'s.',
    mark: 'Mark against the teacher\'s answer as the model answer: credit a student answer that reaches the same ' +
      'result and makes the same key points, in any words; a key point or a step the teacher\'s answer has and ' +
      'the student\'s lacks costs the mark the teacher would take for it. The printed answer key, when one is ' +
      'attached, still decides the correct final value.',
    teach: 'Explain it the way the teacher answered it: walk through their steps in their order and use their ' +
      'keywords, so what the student hears matches what the teacher wrote.',
    hint: 'This is FOR YOU ONLY. Use it to know where the teacher\'s method is going and which keywords they expect, ' +
      'and steer the student down THAT route. NEVER state its final answer, and never give more of it than the help ' +
      'level allows.',
    check: 'Use it as a second reference: an answer that disagrees with the teacher\'s on a fact or a value is worth ' +
      'flagging; one that only words it differently is not.'
  };

  /* Matching is by words, so "a glass of ice water" and "a can of cold drink"
     can read as one question. The model can tell, so it is told to. */
  var SAME_CHECK = 'Check it is really this question: where this question names a different object, person, ' +
    'place or number from the one above, use THIS question\'s and keep the teacher\'s answer for everything else.';

  var KIND_SIMILAR = {
    answer: 'Follow its method, its layout and its keywords. Its NUMBERS belong to a different question — never copy them.',
    mark: 'Use it for the standard the teacher expects (the steps shown, the keywords); its numbers are another question\'s.',
    teach: 'Explain in the same way, with this question\'s own numbers.',
    hint: 'For you only: it shows the route the teacher would take. Never state its answer or this question\'s.',
    check: 'A reference for the method only; its numbers are another question\'s.'
  };

  function kindOf(kind) {
    var k = str(kind);
    if (k === 'gen') return '';                    // writing a question: an answer has no business there
    return KIND_SAME[k] ? k : 'mark';              // unknown → the kind that leaks least
  }

  function entryLines(e, withQ) {
    var lines = [];
    var where = [e.ws, e.n ? 'Q' + e.n : '', e.page ? 'page ' + e.page : ''].filter(Boolean).join(', ');
    if (withQ && e.q) lines.push('Question' + (where ? ' (' + where + ')' : '') + ': ' + oneLine(e.q, 420));
    else if (where) lines.push('From: ' + where);
    lines.push('The teacher\'s answer' + (e.src === 'read' ? ' (handwritten, as read)' : '') + ':\n' +
      clip(e.a, 1400).split('\n').map(function (l) { return '  ' + l; }).join('\n'));
    return lines.join('\n');
  }

  /* The block appended to a system prompt. '' when there is nothing to say,
     so a call site that appends it unconditionally costs nothing. */
  function block(kind, picked, opts) {
    var k = kindOf(kind);
    if (!k || !picked) return '';
    var o = opts || {};
    var out = [];
    if (picked.same && picked.same.length) {
      out.push("THE TEACHER HAS ALREADY ANSWERED THIS QUESTION (from their own worksheets — their answer, " +
        'not an AI\'s):\n' + picked.same.map(function (e) { return entryLines(e, true); }).join('\n\n') +
        '\n' + KIND_SAME[k] + ' ' + SAME_CHECK);
    }
    if (picked.similar && picked.similar.length) {
      out.push("A QUESTION LIKE THIS ONE, AS THE TEACHER ANSWERED IT:\n" +
        picked.similar.map(function (e) { return entryLines(e, true); }).join('\n\n') + '\n' + KIND_SIMILAR[k]);
    }
    if (picked.paper && picked.paper.length) {
      out.push("THE TEACHER'S OWN ANSWERS TO QUESTIONS ON THIS PAPER (match each to its question by its " +
        'wording; a question not listed has none):\n' +
        picked.paper.map(function (e) { return entryLines(e, true); }).join('\n\n') + '\n' + KIND_SAME[k]);
    }
    if (!out.length) return '';
    var text = '\n\n📖 ' + out.join('\n\n');
    if (o.note) text += '\n' + str(o.note);
    if (text.length > BLOCK_CHARS) text = text.slice(0, BLOCK_CHARS - 40).replace(/\s+\S*$/, '') + '\n…[more answers left out]';
    return text;
  }

  /* ---------------------------------------------- how close is an answer */

  /* The Voice check's score: how much an AI's answer reads like the
     teacher's. Three parts, each 0–1:
       words    — Dice over the content words (the same vocabulary);
       keys     — the share of the teacher's numbers and longer terms the AI
                  also used (the facts and keywords a marker looks for);
       length   — how close the two are in length (a one-liner against a
                  paragraph is not the same answer however right it is).
     `score` is 0–100. Pure, so the numbers in the panel are the numbers the
     tests pin. */
  function compare(teacher, ai) {
    var T = words(teacher), A = words(ai);
    if (!T.length || !A.length) return { score: 0, words: 0, keys: 0, length: 0 };
    var w = similarity(T, A);
    var keysT = T.filter(function (x) { return /^\d/.test(x) || x.length >= 6; });
    var Ab = bag(A);
    var keys = keysT.length ? overlapCount(bag(keysT), Ab) / keysT.length : w;
    var lt = str(teacher).replace(/\s+/g, ' ').trim().length;
    var la = str(ai).replace(/\s+/g, ' ').trim().length;
    var length = Math.min(lt, la) / Math.max(lt, la, 1);
    var score = Math.round(100 * (0.45 * w + 0.35 * keys + 0.2 * length));
    return { score: score, words: round2(w), keys: round2(keys), length: round2(length) };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function mean(list) {
    var n = 0, s = 0;
    (list || []).forEach(function (x) { if (Number.isFinite(x)) { s += x; n++; } });
    return n ? Math.round(s / n) : 0;
  }

  /* Which saved answers a Voice check should be run on: ones with a real
     question and a real answer, spread over the buckets, newest first. */
  function checkSample(entries, n, seed) {
    var list = (entries || []).map(cleanEntry).filter(function (e) {
      return e && e.q && words(e.q).length >= MIN_WORDS && words(e.a).length >= 2;
    });
    list.sort(function (x, y) { return str(y.at).localeCompare(str(x.at)); });
    var by = {};
    list.forEach(function (e) { (by[e.bucket] = by[e.bucket] || []).push(e); });
    var keys = Object.keys(by).sort();
    var out = [], i = 0, r = (Number(seed) || 0) >>> 0;
    while (out.length < (n || 8) && keys.length) {
      var key = keys[(i + r) % keys.length];
      var q = by[key];
      if (q.length) out.push(q.shift());
      if (!q.length) keys.splice(keys.indexOf(key), 1);
      i++;
    }
    return out;
  }

  /* --------------------------------------------------------- the reader */

  /* reader(env)
       env.owner()            → the teacher's uid ('' when unknown)
       env.getDoc(segments)   → Promise<data|null>   (segments: ['users', uid, …])
       env.listEntries(f)     → Promise<[data]>      optional; the teacher's own device
       env.log(msg, err)      optional
     Everything is cached by owner, and a change of owner (another account
     signed in on the device) drops it all: one teacher's answers must never
     ground another teacher's prompts. */
  function reader(env) {
    var E = env || {};
    var state = fresh('');

    function fresh(owner) {
      return { owner: owner, buckets: null, index: {}, entries: {}, paper: {}, paperKey: '', loading: {}, all: false };
    }
    function owner() {
      var o = '';
      try { o = str(E.owner && E.owner()); } catch (e) { o = ''; }
      if (o !== state.owner) state = fresh(o);
      return o;
    }
    function log(msg, err) { try { if (E.log) E.log(msg, err); } catch (e) {} }

    function loadBuckets() {
      var o = owner();
      if (!o) return Promise.resolve({});
      if (state.buckets) return Promise.resolve(state.buckets);
      if (state.loading.buckets) return state.loading.buckets;
      var p = Promise.resolve(E.getDoc(['users', o, COLL, INDEX_DOC])).then(function (d) {
        if (state.owner !== o) return {};
        var b = (d && d.buckets && typeof d.buckets === 'object') ? d.buckets : {};
        state.buckets = b;
        return b;
      }).catch(function (e) { log('answer book: bucket list unreadable', e); return {}; })
        .then(function (b) { delete state.loading.buckets; return b; });
      state.loading.buckets = p;
      return p;
    }

    function loadIndex(bucket) {
      var o = owner();
      if (!o) return Promise.resolve([]);
      if (state.index[bucket]) return Promise.resolve(state.index[bucket]);
      var key = 'ix:' + bucket;
      if (state.loading[key]) return state.loading[key];
      var p = Promise.resolve(E.getDoc(['users', o, COLL, indexDocId(bucket)])).then(function (d) {
        if (state.owner !== o) return [];
        var rows = cleanIndex(d, bucket).rows;
        state.index[bucket] = rows;
        return rows;
      }).catch(function (e) { log('answer book: index ' + bucket + ' unreadable', e); return []; })
        .then(function (rows) { delete state.loading[key]; return rows; });
      state.loading[key] = p;
      return p;
    }

    /* Which buckets a paper of this level and subject may hold answers in:
       its own, then the same subject at any level (a P5 paper set to a P6
       class is still the same paper), then the unknown-subject bucket. */
    function bucketsFor(lvl, sub) {
      return loadBuckets().then(function (have) {
        var s = subjectKey(sub);
        var own = bucketOf(lvl, sub);
        var list = [own];
        Object.keys(have).forEach(function (b) {
          var parts = b.split('-');
          if (b === own) return;
          if (!s || parts[1] === s || parts[1] === 'any') list.push(b);
        });
        return list.filter(function (b, i) { return list.indexOf(b) === i && (b === own || have[b]); });
      });
    }

    function rowsFor(lvl, sub) {
      return bucketsFor(lvl, sub).then(function (bs) {
        return Promise.all(bs.map(loadIndex)).then(function (all) {
          var out = [];
          all.forEach(function (rows) { out = out.concat(rows || []); });
          return out;
        });
      });
    }

    function fetchEntries(ids) {
      var o = owner();
      var want = (ids || []).filter(function (id) { return id && !state.entries[id]; });
      if (!o || !want.length) return Promise.resolve(0);
      var got = 0, i = 0;
      function next() {
        if (i >= want.length) return Promise.resolve();
        var id = want[i++];
        return Promise.resolve(E.getDoc(['users', o, COLL, BOOK_DOC, ENTRIES, id])).then(function (d) {
          var e = cleanEntry(d);
          if (e && state.owner === o) { state.entries[e.id] = e; got++; }
        }).catch(function (err) { log('answer book: entry ' + id + ' unreadable', err); }).then(next);
      }
      var lanes = [];
      for (var n = 0; n < Math.min(FETCH_PAR, want.length); n++) lanes.push(next());
      return Promise.all(lanes).then(function () { return got; });
    }

    var api = {
      /* A paper is open: find the teacher's answers to the questions printed
         on it and fetch those, and only those. `key` names the paper, so the
         prompt for it lists THESE answers and no other paper's. */
      primePaper: function (texts, ctx) {
        var c = ctx || {};
        var key = str(c.key || '');
        return rowsFor(c.lvl, c.sub).then(function (rows) {
          var hits = rowsOnPaper(rows, texts, { ws: c.ws, max: PRIME_MAX });
          var ids = hits.map(function (h) { return h.row.id; });
          return fetchEntries(ids).then(function () {
            var mark = {};
            ids.forEach(function (id) { if (state.entries[id]) mark[id] = 1; });
            state.paper[key] = mark;
            state.paperKey = key;
            return Object.keys(mark).length;
          });
        }).catch(function (e) { log('answer book: paper not primed', e); return 0; });
      },
      // One question, about to be asked about: fetch its answer if there is one.
      primeQuestion: function (q, ctx) {
        var c = ctx || {};
        if (!words(q).length) return Promise.resolve(0);
        return rowsFor(c.lvl, c.sub).then(function (rows) {
          var hits = rowsForQuestion(rows, q);
          return fetchEntries(hits.map(function (h) { return h.row.id; }));
        }).catch(function (e) { log('answer book: question not primed', e); return 0; });
      },
      // The teacher's own device: every entry, once (or one subject's).
      loadAll: function (filter) {
        var o = owner();
        if (!o || !E.listEntries) return Promise.resolve(0);
        return Promise.resolve(E.listEntries(filter || {})).then(function (list) {
          if (state.owner !== o) return 0;
          var n = 0;
          (list || []).forEach(function (d) { var e = cleanEntry(d); if (e) { state.entries[e.id] = e; n++; } });
          state.all = true;
          return n;
        }).catch(function (e) { log('answer book: entries unreadable', e); return 0; });
      },
      // Put entries in by hand (Ans Key, just after writing them).
      remember: function (list) {
        (list || []).forEach(function (d) { var e = cleanEntry(d); if (e) state.entries[e.id] = e; });
      },
      forget: function (ids) { (ids || []).forEach(function (id) { delete state.entries[str(id)]; }); },
      entries: function () { owner(); return Object.keys(state.entries).map(function (k) { return state.entries[k]; }); },
      count: function () { owner(); return Object.keys(state.entries).length; },
      paperCount: function (key) { var m = state.paper[str(key == null ? state.paperKey : key)]; return m ? Object.keys(m).length : 0; },
      /* What goes in a prompt, SYNCHRONOUSLY, from what is already fetched.
         ctx: { q, lvl, sub, key (the paper), exclude }. With no question the
         paper's answers are used, and only for that paper. */
      pick: function (ctx) {
        owner();
        var c = Object.assign({}, ctx || {});
        if (!c.q) {
          var key = str(c.key == null ? state.paperKey : c.key);
          c.paper = state.paper[key] || null;
          if (!c.paper) return { same: [], similar: [], paper: [] };
        }
        return pick(api.entries(), c);
      },
      block: function (kind, ctx) {
        return block(kind, api.pick(ctx), ctx);
      },
      reset: function () { state = fresh(state.owner); },
      _state: function () { return state; }
    };
    return api;
  }

  var TeacherVoice = {
    VERSION: VERSION,
    COLL: COLL, BOOK_DOC: BOOK_DOC, ENTRIES: ENTRIES, INDEX_DOC: INDEX_DOC, INDEX_PREFIX: INDEX_PREFIX,
    ROWS_MAX: ROWS_MAX, PRIME_MAX: PRIME_MAX, A_CHARS: A_CHARS, Q_CHARS: Q_CHARS,
    SAME_MIN: SAME_MIN, SIMILAR_MIN: SIMILAR_MIN, PAGE_MIN: PAGE_MIN, BLOCK_CHARS: BLOCK_CHARS,
    reader: reader,
    pure: {
      norm: norm, words: words, stem: stem, numbersOf: numbersOf, similarity: similarity,
      containment: containment, relation: relation, sameNumbers: sameNumbers, hash32: hash32,
      levelKey: levelKey, subjectKey: subjectKey, bucketOf: bucketOf, indexDocId: indexDocId,
      entryId: entryId, slotKey: slotKey, cleanEntry: cleanEntry, rowOf: rowOf, cleanRow: cleanRow,
      cleanIndex: cleanIndex, upsertRows: upsertRows, rowsOnPaper: rowsOnPaper,
      rowsForQuestion: rowsForQuestion, pick: pick, block: block, kindOf: kindOf, compare: compare,
      mean: mean, checkSample: checkSample, clip: clip
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TeacherVoice;
  if (root) root.TeacherVoice = TeacherVoice;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
