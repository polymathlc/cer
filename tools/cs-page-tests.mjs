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
