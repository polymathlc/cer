// Static checks for cs/index.html — the polymathlc.com.sg/cs page. The page
// mirrors a few of the server's rules so a visitor is told about a mistake
// before they press the button; these tests cut those functions OUT of the
// shipped page and hold them against the real server rules, so the two can
// never drift into a page that refuses what the server accepts (a lost lead)
// or accepts what the server refuses (an error after the visitor pressed go).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'cs/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const all = scripts.join('\n;\n');
const validate = await import(pathToFileURL(join(ROOT, 'cs-function/functions/validate.js')).href);
const service = await import(pathToFileURL(join(ROOT, 'cs-function/functions/service.js')).href);

/** Cut one top-level function out of the page's scripts. */
function cut(name) {
  const start = all.search(new RegExp('\\nfunction ' + name + '\\('));
  assert.ok(start >= 0, name + ' is in the page');
  let depth = 0, i = all.indexOf('{', start);
  for (; i < all.length; i++) {
    if (all[i] === '{') depth++;
    else if (all[i] === '}' && --depth === 0) break;
  }
  return all.slice(start, i + 1);
}
function load(names, extra = '') {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extra + '\n' + names.map(cut).join('\n') + '\nthis.out = {' + names.join(',') + '};', ctx);
  return ctx.out;
}

test('every inline script parses', () => {
  assert.ok(scripts.length >= 4);
  scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code), 'script ' + i));
});

test('the page carries a version for the admin, hidden from everybody else', () => {
  const m = all.match(/const CS_PAGE_VERSION = 'v(\d+)\.(\d+)\.(\d+)';/);
  assert.ok(m, 'CS_PAGE_VERSION is a plain semver');
  assert.match(html, /<div class="version-badge" id="versionBadge" hidden><\/div>/);
  assert.match(all, /\$\('versionBadge'\)\.hidden = !state\.isAdmin/);
});

test('the page never touches Firestore or a contact detail directly', () => {
  assert.ok(!/firebase-firestore/.test(html), 'no Firestore SDK on the page');
  assert.ok(!/\.firestore\(/.test(all));
  assert.ok(!/collection\(['"](mail|csLeads)/.test(all));
  // Unlocks go through the server, with the server's own consent version.
  assert.match(all, /callFn\('csUnlock', \{/);
  assert.match(all, /consent: true, consentVersion: state\.consent\.version/);
});

test('the consent box is never ticked for anybody', () => {
  const box = html.match(/<input type="checkbox" id="inConsent"[^>]*>/)[0];
  assert.ok(!/\bchecked\b/.test(box));
  assert.match(all, /\$\('inConsent'\)\.checked = false;/);
});

test('the page and the server agree on who the admin is and on every limit', () => {
  const admins = JSON.parse(all.match(/const ADMIN_EMAILS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(admins, [...service.ADMIN_EMAILS]);
  const num = name => Function('return ' + all.match(new RegExp('const ' + name + ' = ([^;]+);'))[1])();
  assert.equal(num('PREVIEW_MAX_PAGES'), service.PREVIEW_MAX_PAGES);
  assert.ok(num('PREVIEW_MAX_BYTES') <= service.PREVIEW_MAX_BYTES, 'the page keeps pages under the server\'s size');
  assert.ok(num('PREVIEW_WIDTH') <= service.PREVIEW_MAX_SIDE);
  assert.equal(num('MAX_FILE_BYTES'), validate.MAX_FILE_BYTES);
  assert.equal(num('CHUNK_BYTES'), service.LIMITS.chunkMaxBytes);
});

test('the page\'s WhatsApp check agrees with the server on every case', () => {
  const { checkWhatsApp } = load(['checkWhatsApp']);
  const cases = ['9123 4567', '8123-4567', '+65 9123 4567', '6591234567', '0065 9123 4567', '(+65) 9123-4567', '3123 4567',
    '+60 12-345 6789', '+44 7700 900123', '+1 (415) 555-0132', '', '6123 4567', '+65 6123 4567', '7123 4567', '0123456789',
    '9123456', '+65 9123 456', 'nine one two', '+1234567', '+1234567890123456', '91234567', '65 9123 4567'];
  for (const typed of cases) {
    const server = validate.normaliseWhatsApp(typed).ok;
    const page = checkWhatsApp(typed) === '';
    assert.equal(page, server, JSON.stringify(typed) + ' page=' + page + ' server=' + server);
  }
});

test('the page never refuses a name or email the server would accept', () => {
  const { checkName, checkEmail } = load(['checkName', 'checkEmail']);
  for (const name of ['Tan Wei Ming', 'Siti Nur Aisyah', 'Mary-Jane O\'Neil', '陈伟明', 'Ravi s/o Kumar', 'Ng'])
    assert.equal(checkName(name), '', name);
  for (const email of ['mum@example.com', 'Parent.Name+cs@Gmail.COM', 'a@b.co', 'x_y@school.edu.sg'])
    assert.equal(checkEmail(email), '', email);
  for (const bad of ['', 'A', '12345678', 'me@example.com']) assert.notEqual(checkName(bad), '', bad);
  for (const bad of ['', 'nope', 'a@b', 'a@b..com']) assert.notEqual(checkEmail(bad), '', bad);
});

test('the page suggests the same email corrections as the server', () => {
  const ctx = {};
  vm.createContext(ctx);
  const typos = all.match(/const EMAIL_TYPOS = (\{[\s\S]*?\});/)[1];
  vm.runInContext('const EMAIL_TYPOS = ' + typos + ';\n' + cut('emailSuggestion') + '\nthis.f = emailSuggestion;', ctx);
  for (const e of ['mum@gmial.com', 'dad@hotmial.com', 'kid@yahoo.con', 'x@outlok.com', 'mum@gmail.com', 'odd@example.org'])
    assert.equal(ctx.f(e), validate.emailSuggestion(e), e);
});

test('booklet page choices read the way an admin would type them', () => {
  const { parsePages: inPage, pagesSpecText } = load(['parsePages', 'pagesSpecText'], 'const PREVIEW_DEFAULT_PAGES = 6, PREVIEW_MAX_PAGES = 8;');
  // Arrays made inside the vm come from another realm; copy them out to compare.
  const parsePages = (...args) => JSON.parse(JSON.stringify(inPage(...args)));
  assert.deepEqual(parsePages('', 12), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parsePages('', 3), [1, 2, 3]);
  assert.deepEqual(parsePages('1-4, 7', 12), [1, 2, 3, 4, 7]);
  assert.deepEqual(parsePages('4–2', 12), [2, 3, 4]);
  assert.deepEqual(parsePages('1-20', 30), [1, 2, 3, 4, 5, 6, 7, 8], 'never more than the booklet holds');
  assert.deepEqual(parsePages('9, 10', 5), [1], 'pages past the end fall back to the cover');
  assert.deepEqual(parsePages('rubbish', 5), [1]);
  assert.equal(pagesSpecText([1, 2, 3, 5, 7, 8]), '1-3, 5, 7-8');
  assert.equal(pagesSpecText([]), '');
});

test('the design conventions hold: Century Gothic with Roboto for "?", the real logo, print and phone', () => {
  assert.match(html, /--font-family: 'RobotoQuestion', 'Century Gothic', CenturyGothic, AppleGothic, sans-serif;/);
  assert.match(html, /unicode-range: U\+003F;/);
  assert.ok(existsSync(join(ROOT, 'assets/branding/polymath-learning-centre.png')));
  assert.match(html, /src="\.\.\/assets\/branding\/polymath-learning-centre\.png"/);
  assert.match(html, /@page \{ size: A4;/);
  assert.match(html, /id="printButton"/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
});

test('the booklet always ends on its back cover', () => {
  // facesFor lives inside the Booklet module; its parity rule is the contract.
  assert.match(all, /if \(\(faces\.length \+ 1\) % 2 === 1\) faces\.push\(\{ kind: 'more'/);
  assert.match(all, /faces\.push\(\{ kind: 'back'/);
});

/* ════════════════════════════════════════════════════════════════════
   🖼 THE SOCIAL POST — the picture an admin posts to send parents here.
   ════════════════════════════════════════════════════════════════════ */

/** Cut one top-level `const NAME = …;` out of the page, however many lines it spans. */
function cutConst(name) {
  const start = all.search(new RegExp('\\nconst ' + name + ' = '));
  assert.ok(start >= 0, name + ' is in the page');
  let i = all.indexOf('=', start) + 1, depth = 0, quote = '';
  for (; i < all.length; i++) {
    const ch = all[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return all.slice(start, i + 1);
}
function loadSocial(names, consts = []) {
  const ctx = { TextEncoder };
  vm.createContext(ctx);
  vm.runInContext(consts.map(cutConst).join('\n') + '\n' + names.map(cut).join('\n') +
    '\nthis.out = {' + names.join(',') + '};' + consts.map(c => 'this.out.' + c + ' = ' + c + ';').join('\n'), ctx);
  return ctx.out;
}
const plain = value => JSON.parse(JSON.stringify(value));
const SOCIAL_CONSTS = ['SOCIAL_SITE_URL', 'SOCIAL_LINK_TEXT', 'SOCIAL_FORMATS', 'SOCIAL_THEMES'];
const SOCIAL_FNS = ['typeLabel', 'socialLink', 'socialFirstSentence', 'socialTickList', 'socialSlug', 'socialLayoutMode',
  'socialDefaults', 'socialStickerSub', 'socialCaption', 'socialWrap', 'socialBalance', 'socialFanSlots', 'socialCorners', 'socialLayout'];
const S = loadSocial([...SOCIAL_FNS, 'makeQr'], SOCIAL_CONSTS);
const socialBlock = all.slice(all.indexOf('🖼 THE SOCIAL POST'), all.indexOf('🎬 THE CLIP'));

/* ── An independent reader for the QR code: format, error correction, payload. ── */
const GF_EXP = new Array(512), GF_LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]; }
const gfTimes = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);
// ISO/IEC 18004, level M, versions 1–10: [error-correction codewords per block, blocks].
const QR_M = { 1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5] };
const QR_ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const QR_MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
];
function readQr(q) {
  const { size } = q;
  const grid = q.modules.map(row => Array.from(row, Boolean));
  const version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 10, 'a small version for a short link: ' + version);
  const dark = (x, y) => (grid[y][x] ? 1 : 0);
  // Three finder patterns, each a 7×7 ring around a 3×3 core, in the right corners.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(dark(ox + x, oy + y), ring === 2 ? 0 : 1, 'finder at ' + ox + ',' + oy);
    }
  }
  for (let i = 8; i < size - 8; i++) { assert.equal(dark(i, 6), i % 2 === 0 ? 1 : 0); assert.equal(dark(6, i), i % 2 === 0 ? 1 : 0); }
  // Both copies of the format information agree, carry a valid BCH code, and say level M.
  const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const second = [...Array.from({ length: 8 }, (_, i) => [size - 1 - i, 8]), ...Array.from({ length: 7 }, (_, i) => [8, size - 7 + i])];
  const readBits = coords => coords.reduce((acc, [x, y], i) => acc | (dark(x, y) << i), 0);
  const fmt = readBits(first);
  assert.equal(readBits(second), fmt, 'both copies of the format bits agree');
  const raw = fmt ^ 0x5412;
  const value = raw >>> 10;
  let rem = value;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal((value << 10) | rem, raw, 'the format bits carry a valid BCH code');
  assert.equal(value >>> 3, 0, 'error correction level M');
  const mask = value & 7;
  assert.equal(mask, q.mask);
  // Which modules are function patterns, from the standard's own tables.
  const align = QR_ALIGN[version];
  const isFunction = (x, y) => {
    if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
    if (x === 6 || y === 6) return true;
    if (version >= 7 && ((x < 6 && y >= size - 11 && y < size - 8) || (y < 6 && x >= size - 11 && x < size - 8))) return true;
    for (const ay of align) for (const ax of align) {
      const corner = (ax === 6 && ay === 6) || (ax === 6 && ay === align[align.length - 1]) || (ay === 6 && ax === align[align.length - 1]);
      if (!corner && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
    }
    return false;
  };
  // Read the codewords back along the zig-zag, unmasked.
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!isFunction(x, y)) bits.push(dark(x, y) ^ (QR_MASKS[mask](x, y) ? 1 : 0));
    }
  }
  const total = Math.floor(bits.length / 8);
  const codewords = Array.from({ length: total }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  // Undo the interleaving and check every block's Reed–Solomon syndromes are zero.
  const [ecc, blocks] = QR_M[version];
  const numShort = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks);
  const dataLens = Array.from({ length: blocks }, (_, j) => shortLen - ecc + (j >= numShort ? 1 : 0));
  const split = Array.from({ length: blocks }, () => ({ data: [], ecc: [] }));
  let k = 0;
  for (let i = 0; i < Math.max(...dataLens); i++) for (let j = 0; j < blocks; j++) if (i < dataLens[j]) split[j].data.push(codewords[k++]);
  for (let i = 0; i < ecc; i++) for (let j = 0; j < blocks; j++) split[j].ecc.push(codewords[k++]);
  for (const block of split) {
    const word = block.data.concat(block.ecc);
    for (let i = 0; i < ecc; i++) {
      const root = GF_EXP[i];
      const syndrome = word.reduce((acc, c) => gfTimes(acc, root) ^ c, 0);
      assert.equal(syndrome, 0, 'Reed–Solomon syndrome ' + i + ' is zero');
    }
  }
  // Parse the payload: byte mode, a length, the bytes.
  const dataBits = split.flatMap(b => b.data).flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  const take = n => { const v = dataBits.splice(0, n).reduce((a, b) => (a << 1) | b, 0); return v; };
  assert.equal(take(4), 0b0100, 'byte mode');
  const length = take(version < 10 ? 8 : 16);
  const bytes = Array.from({ length }, () => take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

test('🖼 the QR code on the social post reads back exactly, with valid error correction', () => {
  const inputs = [S.socialLink('fAbCdEfGhIjKlMnOpQrS'), S.socialLink(''), 'hello', '中文 cheat sheet ✓', 'x'.repeat(120)];
  for (const text of inputs) {
    const q = S.makeQr(text, 'M');
    assert.equal(q.level, 'M');
    assert.equal(readQr(q), text, JSON.stringify(text));
  }
  // A real file id fits in a small, easily scanned code.
  assert.equal(S.makeQr(S.socialLink('f' + 'a'.repeat(19))).version, 4);
  assert.throws(() => S.makeQr('z'.repeat(3000)), /Too much text/);
});

test('🖼 a social post opens this very resource, and its words start out true', () => {
  const id = 'fAbCdEfGhIjKlMnOpQrS';
  const link = S.socialLink(id);
  assert.equal(link, 'https://polymathlc.com.sg/cs/#file=' + id);
  // The page's own reader of #file= finds the same id (applyList / the hashchange handler).
  const hash = new URL(link).hash;
  assert.equal((hash.match(/(?:^#|&)file=([A-Za-z0-9_-]+)/) || [])[1], id);
  assert.equal(S.socialLink('f/../<x>'), 'https://polymathlc.com.sg/cs/#file=fx', 'nothing but an id gets into the link');
  assert.equal(S.socialLink(''), 'https://polymathlc.com.sg/cs/');

  const file = { id, title: 'P6 Heat Cheat Sheet', description: '', pageCount: 7, ext: 'pdf' };
  const d = plain(S.socialDefaults({ kind: 'file', file }));
  assert.equal(d.headline, 'P6 Heat Cheat Sheet');
  assert.equal(d.subline, 'A 7-page PDF, ready to print and keep.');
  assert.deepEqual(plain(S.socialTickList(d.ticks)), ['7 pages, ready to print', 'Look inside before you download', 'Free — yours in a minute']);
  assert.equal(d.link, 'polymathlc.com.sg/cs');
  const described = plain(S.socialDefaults({ kind: 'file', file: { ...file, description: 'Every heat idea on one page. Diagrams included.' } }));
  assert.equal(described.subline, 'Every heat idea on one page.', 'the description\'s first sentence leads');
  const notes = plain(S.socialDefaults({ kind: 'file', file: { id, title: 'Notes', pageCount: 0, ext: 'docx' } }));
  assert.equal(S.socialTickList(notes.ticks)[0], 'Word file, ready to print');
  // An advert for a child's education must not claim what nobody measured.
  const claims = /\b(best|guarantee\w*|rated|top|scores?|results?|testimonial|award\w*|A\*|\d+\s?%)/i;
  for (const words of [d, described, notes, plain(S.socialDefaults({ kind: 'page', files: [file, { ...file, title: 'Light' }] }))]) {
    for (const value of Object.values(words)) assert.ok(!claims.test(String(value)), 'no made-up claims: ' + value);
  }

  const page = plain(S.socialDefaults({ kind: 'page', files: [file, { id: 'f2', title: 'Light notes' }], settings: { headline: 'Free resources for P6' } }));
  assert.equal(page.headline, 'Free resources for P6');
  assert.equal(page.ticks, 'P6 Heat Cheat Sheet\nLight notes', 'the whole-page post names the files');
  assert.equal(page.cta, 'Download them free');
  assert.equal(S.socialStickerSub({ kind: 'page', files: [file, file, file] }), '3 resources');
  assert.equal(S.socialStickerSub({ kind: 'file', file }), '7 pages');

  const caption = S.socialCaption({ kind: 'file', file }, d, link);
  assert.match(caption, /^📚 FREE: P6 Heat Cheat Sheet\n/);
  assert.ok(caption.includes('👉 Download free: ' + link), 'the caption carries the full link');
  assert.ok(caption.includes('✅ 7 pages, ready to print'));
  assert.match(caption, /link in our bio/);
  assert.ok(!/link in our bio/.test(S.socialCaption({ kind: 'file', file }, { ...d, note: '' }, link)));

  assert.equal(S.socialFirstSentence('Covers heat. And more.'), 'Covers heat.');
  const long = S.socialFirstSentence('word '.repeat(80), 60);
  assert.ok(long.endsWith('…') && Array.from(long).length <= 61, long);
  assert.equal(S.socialSlug('P6 Heat Cheat Sheet!'), 'p6-heat-cheat-sheet');
  assert.equal(S.socialSlug('华文作文'), '', 'no ascii left: the page falls back to a plain name');
  assert.deepEqual(plain(S.socialTickList('a\n\n b \nc\nd')), ['a', 'b', 'c']);
  assert.equal(S.socialLayoutMode('square', 'auto'), 'beside');
  assert.equal(S.socialLayoutMode('story', 'auto'), 'below');
  assert.equal(S.socialLayoutMode('story', 'beside'), 'beside');
});

/** A stand-in for canvas measureText: wide enough to be honest, the same every time. */
function fakeMeasure(text, size, weight) {
  let w = 0;
  for (const ch of Array.from(String(text))) {
    if (/[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)) w += size;
    else if (ch === ' ') w += size * 0.28;
    else w += size * (weight >= 600 ? 0.6 : 0.53);
  }
  return w;
}

test('🖼 social post words wrap inside their width, and Chinese breaks between characters', () => {
  const at = size => s => fakeMeasure(s, size, 700);
  const wrap = (t, w, n, size = 40) => plain(S.socialWrap(t, w, n, at(size)));
  const out = wrap('The quick brown fox jumps over the lazy dog again and again', 300, 3);
  out.lines.forEach(l => assert.ok(fakeMeasure(l, 40, 700) <= 300, l));
  assert.equal(out.cut, true);
  assert.ok(out.lines[2].endsWith('…'));
  assert.deepEqual(wrap('Heat', 300, 3), { lines: ['Heat'], cut: false });
  const cjk = wrap('华文作文如何写好一篇记叙文的开头和结尾', 200, 4);
  cjk.lines.forEach(l => assert.ok(fakeMeasure(l, 40, 700) <= 200, l));
  assert.ok(cjk.lines.length > 1, 'Chinese with no spaces still breaks');
  const giant = wrap('Supercalifragilisticexpialidocious', 200, 6);
  giant.lines.forEach(l => assert.ok(fakeMeasure(l, 40, 700) <= 200, l));
  assert.equal(giant.lines.join(''), 'Supercalifragilisticexpialidocious', 'a word too long is broken, not lost');
  // Balanced: the same number of lines, the last one no longer stranded.
  const text = 'A 7-page PDF, ready to print and keep.';
  const greedy = wrap(text, 440, 3, 30);
  const even = plain(S.socialBalance(text, 440, 3, s => fakeMeasure(s, 30, 400)));
  assert.equal(even.lines.length, greedy.lines.length);
  const spread = lines => Math.max(...lines.map(l => fakeMeasure(l, 30, 400))) - Math.min(...lines.map(l => fakeMeasure(l, 30, 400)));
  assert.ok(spread(even.lines) <= spread(greedy.lines));
});

test('🖼 every size of social post keeps its words on the picture and off the pages', () => {
  const file = { id: 'fAbC', title: 'P6 Heat Cheat Sheet', description: '', pageCount: 7, ext: 'pdf' };
  const base = plain(S.socialDefaults({ kind: 'file', file }));
  const variants = {
    defaults: base,
    long: { ...base, headline: 'Everything about heat for the PSLE, on seven beautifully clear pages you can print tonight and keep for revision through the year',
      subline: 'Conduction, convection and radiation, with diagrams, worked examples and the keywords examiners look for in every answer. '.repeat(2),
      ticks: 'A tick that goes on for far too long to fit on one line of the picture\nAnother\nA third' },
    chinese: { ...base, headline: '华文作文：如何写好一篇记叙文的开头和结尾——给六年级学生的完整指南', subline: '十个范例，一步一步教你。' },
    unbreakable: { ...base, headline: 'Supercalifragilisticexpialidocious'.repeat(3) },
    bare: { ...base, subline: '', ticks: '', kicker: '', note: '', cta: '', link: '' },
    tiny: { ...base, headline: 'Heat' }
  };
  const shows = [
    { kicker: true, ticks: true, qr: true, sticker: true, note: true },
    { kicker: false, ticks: false, qr: false, sticker: false, note: false }
  ];
  const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  let checked = 0;
  for (const [formatKey, format] of Object.entries(S.SOCIAL_FORMATS)) {
    for (const mode of ['beside', 'below']) {
      for (const [name, texts] of Object.entries(variants)) {
        for (const show of shows) {
          for (const pageCount of [1, 3, 4]) {
            for (const pageRatio of [1.414, 0.7]) {
              const label = [formatKey, mode, name, show.qr ? 'all' : 'none', pageCount + 'p', pageRatio].join(' / ');
              const p = plain(S.socialLayout({ w: format.w, h: format.h, safeTop: format.safeTop, safeBottom: format.safeBottom, mode,
                texts: { ...texts, ticks: S.socialTickList(texts.ticks), stickerSub: '7 pages' }, show, logoRatio: 1.37, pageRatio, pageCount }, fakeMeasure));
              const frame = { x: 0, y: format.safeTop, w: format.w, h: format.h - format.safeTop - format.safeBottom };
              const inside = (b, what) => assert.ok(b.x >= frame.x - 0.5 && b.y >= frame.y - 0.5 && b.x + b.w <= frame.x + frame.w + 0.5 &&
                b.y + b.h <= frame.y + frame.h + 0.5, what + ' stays inside the safe area — ' + label + ' ' + JSON.stringify(b));
              inside(p.header, 'the header'); inside(p.block, 'the words'); inside(p.visual, 'the pages'); inside(p.cta, 'the button card');
              for (const [a, b, what] of [[p.header, p.block, 'header/words'], [p.block, p.cta, 'words/button card'], [p.block, p.visual, 'words/pages'],
                [p.header, p.visual, 'header/pages'], [p.visual, p.cta, 'pages/button card']]) {
                assert.ok(!overlap(a, b), what + ' overlap — ' + label);
              }
              for (const item of p.block.items) {
                if (item.type === 'headline' || item.type === 'subline') {
                  assert.ok(item.lines.length <= 4, 'at most four lines — ' + label);
                  item.lines.forEach((line, i) => {
                    const weight = item.type === 'headline' ? 700 : 400;
                    assert.ok(fakeMeasure(line, item.size, weight) <= p.block.w + 1, 'a line wider than its column — ' + label + ': ' + line);
                    assert.ok(item.xs[i] >= p.block.x - 0.5 && item.xs[i] + item.widths[i] <= p.block.x + p.block.w + 1, 'a line outside its column — ' + label);
                  });
                } else {
                  assert.ok(item.x >= p.block.x - 0.5 && item.x + item.w <= p.block.x + p.block.w + 1, item.type + ' outside the column — ' + label);
                }
                assert.ok(item.y >= p.block.y - 0.5 && item.y + item.h <= p.block.y + p.block.h + 1, item.type + ' below the column — ' + label);
              }
              assert.equal(p.pages.length, pageCount);
              for (const pg of p.pages) {
                for (const [x, y] of S.socialCorners(pg.cx, pg.cy, pg.w, pg.h, pg.rot)) {
                  assert.ok(x >= p.visual.x - 1 && x <= p.visual.x + p.visual.w + 1 && y >= p.visual.y - 1 && y <= p.visual.y + p.visual.h + 1,
                    'a page corner outside its room — ' + label);
                }
              }
              assert.deepEqual(p.pages.map(pg => pg.item).sort(), Array.from({ length: pageCount }, (_, i) => i), 'every page drawn once');
              assert.equal(p.pages[p.pages.length - 1].item, 0, 'the first page is in front');
              if (p.sticker) {
                const box = { x: p.sticker.cx - p.sticker.r, y: p.sticker.cy - p.sticker.r, w: p.sticker.r * 2, h: p.sticker.r * 2 };
                inside(box, 'the sticker');
                for (const [b, what] of [[p.header, 'header'], [p.block, 'words'], [p.cta, 'button card']]) assert.ok(!overlap(box, b), 'the sticker covers the ' + what + ' — ' + label);
              } else {
                assert.ok(!show.sticker || !texts.sticker, 'the sticker is only left off when asked — ' + label);
              }
              const c = p.cta;
              for (const [part, what] of [[c.button, 'button'], [c.link, 'address'], [c.note, 'note']]) {
                if (!part) continue;
                assert.ok(part.x >= c.x && part.x + part.w <= c.x + c.w + 0.5 && part.y >= c.y && part.y + part.h <= c.y + c.h + 0.5, what + ' inside the card — ' + label);
                if (c.qr) assert.ok(part.x + part.w <= c.qr.x, what + ' runs into the QR code — ' + label);
              }
              if (show.qr) {
                assert.ok(c.qr, 'a QR code when asked — ' + label);
                assert.ok(c.qr.y >= c.y && c.qr.capY + c.qr.capH <= c.y + c.h + 0.5 && c.qr.x + c.qr.size <= c.x + c.w);
                assert.ok(c.qr.size >= 160, 'large enough to scan from a screen — ' + label);
              } else assert.equal(c.qr, null);
              checked++;
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 3 * 2 * 6 * 2 * 3 * 2);

  // A short title on a square is set as large as it will go, and nothing is given up.
  const square = S.SOCIAL_FORMATS.square;
  const p = plain(S.socialLayout({ w: square.w, h: square.h, mode: 'beside', texts: { ...base, ticks: S.socialTickList(base.ticks), stickerSub: '7 pages' },
    show: {}, pageRatio: 1.414, pageCount: 3 }, fakeMeasure));
  const head = p.block.items.find(i => i.type === 'headline');
  assert.ok(head.size >= 70, 'the title is big: ' + head.size);
  assert.deepEqual(p.fit, { cut: false, dropped: [] });
  assert.equal(p.block.items.filter(i => i.type === 'tick').length, 3);
  // A title too long for any size is cut with "…" and says so, rather than leaving the picture.
  const tooLong = plain(S.socialLayout({ w: square.w, h: square.h, mode: 'beside', texts: { ...variants.long, ticks: S.socialTickList(variants.long.ticks) },
    show: {}, pageRatio: 1.414, pageCount: 3 }, fakeMeasure));
  assert.ok(tooLong.fit.cut || tooLong.fit.dropped.length, 'the admin is told the words did not all fit');
});

/** WCAG contrast between two #RRGGBB colours. */
function contrast(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('🖼 every look of the social post keeps its words readable and its QR code dark on white', () => {
  for (const [name, t] of Object.entries(S.SOCIAL_THEMES)) {
    for (const bg of t.bg) {
      assert.ok(contrast(t.ink, bg) >= 7, name + ': the title on the background ' + contrast(t.ink, bg).toFixed(2));
      assert.ok(contrast(t.soft, bg) >= 4.5, name + ': the smaller words on the background ' + contrast(t.soft, bg).toFixed(2));
    }
    assert.ok(contrast(t.ctaInk, t.ctaBg) >= 4.5, name + ': the button ' + contrast(t.ctaInk, t.ctaBg).toFixed(2));
    assert.ok(contrast(t.kickerInk, t.kickerBg) >= 4.5, name + ': the label ' + contrast(t.kickerInk, t.kickerBg).toFixed(2));
    assert.ok(contrast(t.stickerInk, t.sticker) >= 3, name + ': the sticker ' + contrast(t.stickerInk, t.sticker).toFixed(2));
    assert.ok(contrast(t.tickInk, t.tick) >= 3, name + ': the ticks ' + contrast(t.tickInk, t.tick).toFixed(2));
    assert.ok(contrast(t.qrInk, '#FFFFFF') >= 12, name + ': the QR code must be near-black on white to scan');
    for (const key of ['ink', 'soft', 'ctaBg', 'ctaInk', 'kickerBg', 'kickerInk', 'sticker', 'stickerInk', 'tick', 'tickInk', 'qrInk'])
      assert.match(t[key], /^#[0-9A-F]{6}$/i, name + '.' + key + ' is a solid colour');
  }
  assert.equal(Object.keys(S.SOCIAL_FORMATS).join(), 'square,portrait,story');
  assert.deepEqual([S.SOCIAL_FORMATS.square.w, S.SOCIAL_FORMATS.square.h], [1080, 1080], 'Instagram\'s square');
});

test('🖼 the social post is the admin\'s, reads the file through the admin link only, and writes nothing to the server', () => {
  assert.match(all, /data-act="social"[^']*>🖼 Social post<\/button>/);
  assert.match(all, /act === 'social'\) \{\n\s+Social\.open\(f\);/);
  assert.match(html, /id="socialPageButton"/);
  assert.match(all, /\$\('socialPageButton'\)\.addEventListener\('click', e => \{ pressed\(e\.currentTarget\); Social\.openPage\(\); \}\);/);
  assert.match(all, /if \(overlay === \$\('socialOverlay'\)\) Social\.close\(\);/);
  // The admin panel the buttons live in is shown only to the admin.
  assert.match(all, /\$\('adminPanel'\)\.hidden = !state\.isAdmin/);
  assert.ok(socialBlock.length > 1000);
  assert.ok(!/\badmin\(|callFn\(|fetch\(/.test(socialBlock), 'the social post makes no calls of its own — only fetchStoredFile');
  assert.match(socialBlock, /fetchStoredFile\(f\.id\)/);
  assert.ok(!/firestore|\.ref\(|savePreviews/.test(socialBlock));
  // The booklet keeps its own size: the wider render is the social post's alone.
  assert.match(all, /async function renderPdfCanvases\(buffer, pageSpec, onProgress, width = PREVIEW_WIDTH\)/);
  assert.match(all, /const maxHeight = Math\.round\(2400 \* width \/ PREVIEW_WIDTH\);/);
  assert.match(socialBlock, /renderPdfCanvases\(await entry\.blob\.arrayBuffer\(\), pagesSpecText\(missing\), null, SOCIAL_RENDER_WIDTH\)/);
  // Remembered on this device only, under its own key.
  assert.match(all, /const LS_SOCIAL = 'polymath-cs-social';/);
  // Every box in the dialog the script looks for is in the page.
  for (const id of ['socialOverlay', 'socialCanvas', 'socialBusy', 'socialBusyText', 'socialSize', 'socialSave', 'socialCopy', 'socialShare', 'socialSaveAll',
    'socialCopyLink', 'socialForm', 'socialFormats', 'socialThemes', 'socialLayout', 'socialHeadline', 'socialSubline', 'socialTicks', 'socialKicker',
    'socialSticker', 'socialCta', 'socialLinkText', 'socialNote', 'socialPages', 'socialPagesField', 'socialFitNote', 'socialCaption',
    'socialCopyCaption', 'socialRebuildCaption', 'socialReset', 'socialNotice', 'socialTitle']) {
    assert.match(html, new RegExp('id="' + id + '"'), id + ' is in the page');
  }
  for (const name of ['show-qr', 'show-sticker', 'show-ticks', 'show-kicker', 'show-note'])
    assert.match(html, new RegExp('name="' + name + '"'));
});
