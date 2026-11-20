/* Polymath option tables — v1.0.0
 *
 * A multiple-choice question whose answer options are printed as a TABLE (column
 * headings, one row per option, e.g. Circle | Triangle | Square) used to come out
 * as flattened lines: "Circle: X; triangle: Y; square: Z". This file is the one
 * place that knows how such options are written, checked and drawn, so every app
 * shows them the same way.
 *
 * THE RULE: an option that is a table row is written as "Heading: cell; Heading:
 * cell", with the SAME headings in the SAME order in every option. That text is
 * what every question already stores (so nothing new has to be saved, older
 * screens keep working, and a teacher editing the words in the editor edits the
 * table), and `fromOptions` turns it back into a table on the screen. Options
 * that are not written that way are never touched: they stay as lines.
 *
 * Copies of this file (kept identical, checked by tests):
 *   polymathlc/cer   shop-function/functions/option-table.js   (canonical)
 *   polymathlc/cer   option-table.js                            (pages, CER app)
 *   polymathlc/anskey option-table.js                           (live class)
 *
 * Works as a CommonJS module (require) and in a browser (window.PolymathOptionTable).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PolymathOptionTable = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var MIN_COLS = 2;          // one heading is just a label, not a table
  var MAX_COLS = 6;
  var MIN_ROWS = 2;
  var MAX_ROWS = 6;
  var HEAD_MAX = 40;         // a heading is a short name, never a sentence
  var CELL_MAX = 80;

  /* ───────── small helpers ───────── */
  function str(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') v = v.text !== undefined ? v.text : v.v !== undefined ? v.v : v.value !== undefined ? v.value : '';
    return String(v);
  }
  // One cell or heading: HTML tags and markup gone, spaces collapsed, trimmed.
  function cellText(v) {
    return str(v).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // How two pieces of text are compared: case, spacing and a trailing full stop
  // never make two cells different.
  function same(a, b) { return norm(a) === norm(b); }
  function norm(v) { return cellText(v).toLowerCase().replace(/\s*([;:,|])\s*/g, '$1').replace(/[.]+$/, '').trim(); }
  // A heading as the table prints it: the first letter capital ("triangle" → "Triangle").
  function headingCase(h) { h = cellText(h); return h ? h.charAt(0).toUpperCase() + h.slice(1) : h; }
  // An option label a paper prints in front of an option: "(1) ", "A. ", "B) ".
  // ("A: 5" is NOT a label: a column can be headed A.)
  var LEAD = /^\s*(?:\(\s*(?:[1-9]|[A-Fa-f])\s*\)|(?:[1-9]|[A-F])\s*[).])\s+/;
  function stripLead(s) { return String(s).replace(LEAD, ''); }

  /* ───────── text → table ───────── */
  // "Circle: X; triangle: Y; square: Z" → { keys: ['Circle', 'triangle', 'square'], cells: ['X', 'Y', 'Z'] }
  // or null when the option is not written as "Heading: cell" pairs.
  function splitPairs(option) {
    var text = cellText(stripLead(str(option)));
    if (!text || text.indexOf(':') < 0) return null;
    var seps = [/\s*;\s*/, /\s*\|\s*/, /\s*,\s*/];
    for (var s = 0; s < seps.length; s++) {
      var parts = text.split(seps[s]).filter(function (p) { return p !== ''; });
      if (parts.length < MIN_COLS || parts.length > MAX_COLS) continue;
      var keys = [], cells = [], ok = true;
      for (var i = 0; i < parts.length && ok; i++) {
        var m = /^([^:]{1,40}?)\s*:\s*(.+)$/.exec(parts[i]);
        if (!m) { ok = false; break; }
        var key = m[1].trim(), cell = m[2].trim().replace(/[.]+$/, '');
        // A heading has a letter in it ("3: 4" is a ratio, not a heading) and is short.
        if (!/[A-Za-zÀ-ɏ]/.test(key) || key.split(/\s+/).length > 5 || /[.?!]$/.test(key)) { ok = false; break; }
        if (!cell || cell.length > CELL_MAX) { ok = false; break; }
        keys.push(key); cells.push(cell);
      }
      if (ok) return { keys: keys, cells: cells };
    }
    return null;
  }
  // The table a list of options spells out, or null. Every option must be written
  // as the same headings in the same order, or the options are left as they are.
  function fromOptions(options) {
    var list = Array.isArray(options) ? options : [];
    if (list.length < MIN_ROWS || list.length > MAX_ROWS) return null;
    var rows = [], keys = null;
    for (var i = 0; i < list.length; i++) {
      var pair = splitPairs(list[i]);
      if (!pair) return null;
      if (!keys) keys = pair.keys;
      else {
        if (pair.keys.length !== keys.length) return null;
        for (var k = 0; k < keys.length; k++) if (!same(pair.keys[k], keys[k])) return null;
      }
      rows.push(pair.cells);
    }
    var head = keys.map(headingCase);
    var lower = head.map(function (h) { return h.toLowerCase(); });
    for (var a = 0; a < lower.length; a++) if (lower.indexOf(lower[a]) !== a) return null;
    return { head: head, rows: rows };
  }
  // One row as option text: "Circle: X; Triangle: Y; Square: Z".
  function rowText(head, row) {
    return head.map(function (h, i) { return cellText(h) + ': ' + cellText(row[i]); }).join('; ');
  }
  function toOptions(table) {
    var t = clean(table);
    return t ? t.rows.map(function (r) { return rowText(t.head, r); }) : [];
  }

  /* ───────── a table an AI returned ───────── */
  // Accepts { head|headings|columns: [...], rows: [[...]] | [{cells|c: [...]}] }.
  // Returns { head, rows } with text cells, or null when it is not table-shaped.
  // Nothing is repaired here beyond trimming: a wrong table must fail its checks.
  function clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var head = raw.head || raw.headings || raw.columns || raw.header;
    var rows = raw.rows;
    if (!Array.isArray(head) || !Array.isArray(rows)) return null;
    head = head.map(cellText);
    rows = rows.map(function (r) {
      var cells = Array.isArray(r) ? r : r && (Array.isArray(r.cells) ? r.cells : Array.isArray(r.c) ? r.c : null);
      return Array.isArray(cells) ? cells.map(cellText) : null;
    });
    if (rows.some(function (r) { return !r; })) return null;
    return { head: head, rows: rows };
  }

  /* ───────── the checks ───────── */
  // Every reason a table cannot be shown as the options of a question with
  // `count` options (plain English, for logs, the admin page and the vetting list).
  function shapeIssues(table, count) {
    var t = clean(table);
    if (!t) return ['the options table is not a table'];
    var out = [];
    if (t.head.length < MIN_COLS) out.push('the options table has fewer than ' + MIN_COLS + ' columns');
    if (t.head.length > MAX_COLS) out.push('the options table has more than ' + MAX_COLS + ' columns');
    if (t.head.some(function (h) { return !h; })) out.push('a column of the options table has no heading');
    if (t.head.some(function (h) { return h.length > HEAD_MAX; })) out.push('a heading of the options table is too long');
    if (t.head.some(function (h) { return /[:;|]/.test(h); })) out.push('a heading of the options table has a colon or semicolon in it');
    var lower = t.head.map(function (h) { return h.toLowerCase(); });
    if (lower.some(function (h, i) { return h && lower.indexOf(h) !== i; })) out.push('two columns of the options table have the same heading');
    if (count !== undefined && t.rows.length !== count) out.push('the options table has ' + t.rows.length + ' rows for ' + count + ' options');
    if (t.rows.length < MIN_ROWS || t.rows.length > MAX_ROWS) out.push('the options table has ' + t.rows.length + ' rows');
    t.rows.forEach(function (r, i) {
      if (r.length !== t.head.length) out.push('row ' + (i + 1) + ' of the options table has ' + r.length + ' cells for ' + t.head.length + ' columns');
      if (r.some(function (c) { return !c; })) out.push('row ' + (i + 1) + ' of the options table has an empty cell');
      if (r.some(function (c) { return c.length > CELL_MAX; })) out.push('row ' + (i + 1) + ' of the options table has a cell that is too long');
      if (r.some(function (c) { return /;/.test(c); })) out.push('row ' + (i + 1) + ' of the options table has a semicolon in a cell');
    });
    var seen = t.rows.map(function (r) { return r.map(norm).join('|'); });
    if (seen.some(function (r, i) { return seen.indexOf(r) !== i; })) out.push('two rows of the options table are the same');
    return unique(out);
  }
  // The table and the option text must say exactly the same thing, row for row,
  // so the right answer still points at the right row.
  function matchIssues(table, options) {
    var t = clean(table);
    var list = Array.isArray(options) ? options : [];
    if (!t) return ['the options table is not a table'];
    if (t.rows.length !== list.length) return ['the options table has ' + t.rows.length + ' rows for ' + list.length + ' options'];
    var read = fromOptions(list);
    if (!read) return ['the options are not written as the table\'s rows'];
    var out = [];
    if (read.head.length !== t.head.length || read.head.some(function (h, i) { return !same(h, t.head[i]); })) out.push('the option headings are not the table\'s headings');
    read.rows.forEach(function (r, i) {
      var want = t.rows[i] || [];
      if (r.length !== want.length || r.some(function (c, j) { return !same(c, want[j]); })) out.push('option ' + (i + 1) + ' is not row ' + (i + 1) + ' of the options table');
    });
    return out;
  }
  // Options that look as if they came off a table but do not line up (some written
  // as "Heading: cell" pairs, others not, or with different headings): almost
  // always a table that was read wrongly. Returns a reason, or ''.
  function misreadTable(options) {
    var list = Array.isArray(options) ? options : [];
    if (list.length < MIN_ROWS || fromOptions(list)) return '';
    var pairs = list.map(splitPairs);
    var n = pairs.filter(Boolean).length;
    if (n < 2) return '';
    if (n < list.length) return n + ' of the ' + list.length + ' options are written as table rows and the others are not';
    var keyed = pairs.map(function (p) { return p.keys.map(norm).join('|'); });
    if (keyed.some(function (k) { return k !== keyed[0]; })) return 'the options are written as table rows, but not with the same headings in the same order';
    return 'the options are written as table rows but the table does not hold together';
  }
  function unique(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }

  /* ───────── the second reading, off the source ───────── */
  // A second AI reader that has NOT seen our copy reads the question's options
  // straight off the source (the page, or the bank question and its pictures)
  // and replies { found, readable, printedAsTable, head, rows, options }. This
  // compares the two cell by cell. A table on the source must be the same table
  // here (same headings, same cells in every row, so the right answer is still
  // the right row), and options that are NOT a table on the source must not have
  // been turned into one. Returns plain-English reasons; [] when they agree.
  function readSource(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    return {
      found: r.found !== false, readable: r.readable !== false, printedAsTable: r.printedAsTable === true,
      table: r.printedAsTable === true ? clean({ head: r.head, rows: r.rows }) : null,
      options: (Array.isArray(r.options) ? r.options : []).map(cellText),
      note: cellText(r.note).slice(0, 200)
    };
  }
  function sourceIssues(raw, options) {
    var c = raw && raw.table !== undefined && raw.printedAsTable !== undefined && raw.options !== undefined ? raw : readSource(raw);
    var ours = fromOptions(options);
    if (!c.found) return ['the second reading could not find the question on the source'];
    if (!c.readable) return ['the second reading could not read every option on the source'];
    if (!c.printedAsTable) return ours ? ['the options were made into a table, but they are not a table on the source'] : [];
    if (!ours) return ['the options are a table on the source, but they did not come out as a table'];
    if (!c.table) return ['the second reading could not copy the options table'];
    var out = [];
    if (c.table.rows.length !== ours.rows.length) out.push('the source table has ' + c.table.rows.length + ' rows, ours has ' + ours.rows.length);
    if (c.table.head.length !== ours.head.length) out.push('the source table has ' + c.table.head.length + ' columns, ours has ' + ours.head.length);
    if (out.length) return out;
    if (ours.head.some(function (h, i) { return !same(h, c.table.head[i]); })) out.push('the column headings are not the ones on the source');
    ours.rows.forEach(function (row, i) {
      var want = c.table.rows[i] || [];
      if (row.length !== want.length || row.some(function (cell, j) { return !same(cell, want[j]); })) out.push('row ' + (i + 1) + ' of the options table is not the same as on the source');
    });
    return out;
  }
  var SOURCE_CHECK_SYSTEM = 'You are a careful proof-reader at Polymath Learning Centre, Singapore. '
    + 'You are shown the source of ONE multiple-choice question (a worksheet page, a screenshot, or a bank question with its pictures) and told which question it is. '
    + 'Find THAT question\'s answer options and copy them out exactly as printed. You have not seen anyone else\'s copy. '
    + 'First decide "printedAsTable": true ONLY when the options are printed as a TABLE: column headings across the top and one row per option '
    + '(the row labels 1, 2, 3, 4 or A, B, C, D are not a column). '
    + 'In typed wording (not a picture), options written as "Heading: cell; Heading: cell" with the same headings in the same order in every option ARE a table: '
    + 'give it as one. '
    + 'When it is a table, give "head": the column headings in printed order (without the label column) and "rows": one array of cells per option, in printed order, '
    + 'each cell copied exactly (a tick as ✓, a cross as ✗, an empty cell as ""). '
    + 'When the options are not a table, give "options": each option\'s words in printed order without its label, and "head": [] and "rows": []. '
    + 'Set "found" false when that question is not on the source, and "readable" false when its options cannot all be read with certainty. '
    + 'Reply with STRICT JSON only: {"found":true,"readable":true,"printedAsTable":true,"head":["…"],"rows":[["…"]],"options":["…"],"note":"…"}';
  function sourcePrompt(wording, count, opts) {
    var o = opts || {};
    return [
      o.where || 'Image 1 is the source.',
      o.number ? 'The question is number ' + o.number + ' (a part of it may have been rewritten to stand on its own).' : '',
      'Its wording, as we wrote it: ' + JSON.stringify(String(wording || '').slice(0, 1500)),
      'It has ' + count + ' options. Copy them out as printed.'
    ].filter(Boolean).join('\n');
  }

  /* ───────── the table as text (AI prompts, plain-text emails) ───────── */
  function promptText(table, labels) {
    var t = clean(table);
    if (!t) return '';
    var lab = labels || ['1', '2', '3', '4', '5', '6'];
    return 'The options are a table with the columns ' + t.head.join(' | ') + ':\n'
      + t.rows.map(function (r, i) { return '  ' + lab[i] + ') ' + r.join(' | '); }).join('\n');
  }
  // Fixed-width lines for a plain-text email.
  function plainText(table, labels, mark) {
    var t = clean(table);
    if (!t) return [];
    var lab = labels || ['A', 'B', 'C', 'D', 'E', 'F'];
    var widths = t.head.map(function (h, c) {
      return Math.max(h.length, Math.max.apply(null, t.rows.map(function (r) { return String(r[c] || '').length; })));
    });
    var pad = function (s, w) { s = String(s); while (s.length < w) s += ' '; return s; };
    var line = function (first, cells) { return '  ' + pad(first, 3) + cells.map(function (c, i) { return pad(c, widths[i]); }).join('  ').replace(/\s+$/, ''); };
    var out = [line('', t.head)];
    t.rows.forEach(function (r, i) { out.push(line(lab[i] + '.', r) + (mark === i ? '   ✓' : '')); });
    return out;
  }

  /* ───────── the table as HTML ───────── */
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // A read-only table (answer keys, admin previews, emails). Options:
  //   labels:  what each row is called (default A, B, C, D)
  //   correct: the index of the right row, drawn green with a tick
  //   picked:  the index of the row a child picked (drawn red when it is not right)
  //   cell:    function(text) → HTML for a cell (default: escaped text), for maths
  //   inline:  true for an email: every style written on the element
  //   className: a class for the <table> (pages style it themselves)
  function html(table, opts) {
    var t = clean(table);
    if (!t) return '';
    var o = opts || {};
    var lab = o.labels || ['A', 'B', 'C', 'D', 'E', 'F'];
    var cell = typeof o.cell === 'function' ? o.cell : esc;
    var inline = !!o.inline;
    var border = '1px solid ' + (o.line || '#cbd5e1');
    var th = inline ? ' style="border:' + border + ';padding:7px 10px;background:' + (o.headBg || '#f2f9fa') + ';color:' + (o.ink || '#10303a') + ';font-weight:700;text-align:center;font-size:14px"' : '';
    var labTh = inline ? ' style="border:' + border + ';padding:7px 8px;background:' + (o.headBg || '#f2f9fa') + ';width:34px"' : '';
    var out = '<table' + (o.className ? ' class="' + esc(o.className) + '"' : '')
      + (inline ? ' role="table" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px;margin:4px 0 12px;font-size:15px;color:' + (o.ink || '#10303a') + '"' : '')
      + '><thead><tr><th scope="col"' + labTh + '><span class="ot-sr"' + (inline ? ' style="font-size:0;line-height:0"' : '') + '>Option</span></th>'
      + t.head.map(function (h) { return '<th scope="col"' + th + '>' + cell(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    t.rows.forEach(function (r, i) {
      var right = o.correct === i, wrong = o.picked === i && o.correct !== undefined && o.correct !== i;
      var bg = right ? (o.rightBg || '#dcfce7') : wrong ? '#fee2e2' : '#ffffff';
      var colour = right ? (o.right || '#15803d') : wrong ? '#b91c1c' : (o.ink || '#10303a');
      var td = inline ? ' style="border:' + border + ';padding:7px 10px;text-align:center;background:' + bg + ';color:' + colour + (right ? ';font-weight:700' : '') + '"' : '';
      var labTd = inline ? ' style="border:' + border + ';padding:7px 8px;text-align:center;font-weight:700;background:' + bg + ';color:' + colour + '"' : '';
      out += '<tr' + (inline ? '' : ' class="' + (right ? 'ot-right' : wrong ? 'ot-wrong' : '') + '"') + '><th scope="row"' + labTd + '>' + esc(lab[i] || String(i + 1)) + (right ? ' ✓' : '') + '</th>'
        + r.map(function (c) { return '<td' + td + '>' + cell(c) + '</td>'; }).join('') + '</tr>';
    });
    return out + '</tbody></table>';
  }

  return {
    VERSION: VERSION, MIN_COLS: MIN_COLS, MAX_COLS: MAX_COLS, CELL_MAX: CELL_MAX,
    cellText: cellText, splitPairs: splitPairs, fromOptions: fromOptions, rowText: rowText, toOptions: toOptions, clean: clean,
    shapeIssues: shapeIssues, matchIssues: matchIssues, misreadTable: misreadTable,
    readSource: readSource, sourceIssues: sourceIssues, SOURCE_CHECK_SYSTEM: SOURCE_CHECK_SYSTEM, sourcePrompt: sourcePrompt, promptText: promptText, plainText: plainText,
    html: html, esc: esc,
    // The one sentence every AI reader is given, so every door writes table options the same way.
    PROMPT_RULE: 'ANSWER OPTIONS PRINTED AS A TABLE: when the answer options are printed as a TABLE (column headings across the top and one row per option), '
      + 'write EACH option as that row\'s cells paired with the printed column headings, in the printed column order, as "Heading: cell; Heading: cell" '
      + '(for example "Circle: X; Triangle: Y; Square: Z"), with the SAME headings in the SAME order in every option and each cell copied exactly as printed '
      + '(a tick as ✓ and a cross as ✗). Never leave out a column or a heading. When the options are NOT printed as a table, write them exactly as printed '
      + 'and never invent headings or turn them into "Heading: cell" pairs.'
  };
});
