// The pure rules of the /cs download gate. Every one of these is a sentence a
// visitor reads or a value that ends up in the centre's marketing list, so
// both directions matter: refusing a real person is a lost lead, and letting
// junk through is a message sent to a stranger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_TEXT, CONSENT_VERSION, MIN_FILL_MS, cleanBlock, cleanLine, clip, contentDisposition, csvCell, csvRow,
  emailSuggestion, fileExtension, formatBytes, leadIdFor, normaliseEmail, normaliseName, normaliseWhatsApp,
  safeFileName, servedContentType, settingsWithDefaults, storagePathFor, storagePathOk, validateFileText,
  validateSettings, validateUnlock, waLink, LEAD_ID_RE, FILE_ID_RE
} from '../validate.js';

test('names: real names pass, junk is refused with a sentence', () => {
  for (const name of ['Tan Wei Ming', 'Siti Nur Aisyah', 'Mary-Jane O\'Neil', '陈伟明', 'Ravi s/o Kumar', 'Ng']) {
    const r = normaliseName(name);
    assert.equal(r.ok, true, name);
  }
  assert.equal(normaliseName('  Tan   Wei\tMing  ').value, 'Tan Wei Ming');
  for (const [name, why] of [['', 'empty'], ['A', 'one letter'], ['12345678', 'digits'], ['http://spam.example', 'url'],
    ['www.casino.com', 'www'], ['me@example.com', 'email'], ['<script>', 'symbols'], ['aaaaaaaaaa', 'repeat'],
    ['x'.repeat(81), 'too long'], ['Tan 91234567', 'number in name']]) {
    const r = normaliseName(name);
    assert.equal(r.ok, false, why);
    assert.equal(r.field, 'name');
    assert.ok(r.message.length > 10, 'a real sentence for ' + why);
  }
});

test('emails: lower-cased and checked, never rewritten', () => {
  assert.deepEqual(normaliseEmail('  Parent.Name+cs@Gmail.COM ').value, 'parent.name+cs@gmail.com');
  assert.equal(normaliseEmail('mailto:a@b.co').value, 'a@b.co');
  for (const bad of ['', 'nope', 'a@b', '@b.com', 'a@@b.com', 'a@b..com', 'a..b@c.com', '.a@b.com', 'a@-b.com',
    'a@b.c', 'a b@c.com', 'a@b.com.', 'x'.repeat(65) + '@b.com']) {
    assert.equal(normaliseEmail(bad).ok, false, bad);
  }
  // A typo is offered as a suggestion — the server never "fixes" it.
  assert.equal(emailSuggestion('mum@gmial.com'), 'mum@gmail.com');
  assert.equal(emailSuggestion('mum@gmail.com'), '');
  assert.equal(normaliseEmail('mum@gmial.com').value, 'mum@gmial.com');
});

test('WhatsApp: Singapore mobiles without a country code, everything else with one', () => {
  for (const [typed, want] of [['9123 4567', '+6591234567'], ['8123-4567', '+6581234567'], ['+65 9123 4567', '+6591234567'],
    ['6591234567', '+6591234567'], ['0065 9123 4567', '+6591234567'], ['(+65) 9123-4567', '+6591234567'],
    ['3123 4567', '+6531234567'], ['+60 12-345 6789', '+60123456789'], ['+44 7700 900123', '+447700900123'],
    ['+1 (415) 555-0132', '+14155550132']]) {
    const r = normaliseWhatsApp(typed);
    assert.equal(r.ok, true, typed + ' → ' + (r.message || ''));
    assert.equal(r.value, want, typed);
  }
  assert.equal(normaliseWhatsApp('9123 4567').display, '+65 9123 4567');
  const refusals = {
    '': 'empty', '6123 4567': 'landline', '+65 6123 4567': 'landline with code', '7123 4567': 'no 7 mobiles',
    '0123456789': 'no country code', '9123456': 'seven digits', '+65 9123 456': 'short sg', 'nine one two': 'letters',
    '+0123456789': 'plus zero', '+1234567': 'too short intl', '+1234567890123456': 'too long'
  };
  for (const [typed, why] of Object.entries(refusals)) {
    const r = normaliseWhatsApp(typed);
    assert.equal(r.ok, false, why);
    assert.equal(r.field, 'whatsapp');
  }
  assert.match(normaliseWhatsApp('6123 4567').message, /landline/);
  assert.equal(waLink('+6591234567'), 'https://wa.me/6591234567');
  assert.equal(waLink(''), '');
});

test('an unlock needs every field, a real tick, and the CURRENT consent wording', () => {
  const good = { fileId: 'file_abc123', name: 'Tan Wei Ming', email: 'Mum@Example.com', whatsapp: '9123 4567',
    consent: true, consentVersion: CONSENT_VERSION, website: '', elapsedMs: 9000 };
  const ok = validateUnlock(good, { now: 5 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { fileId: 'file_abc123', name: 'Tan Wei Ming', email: 'mum@example.com',
    whatsapp: '+6591234567', whatsappDisplay: '+65 9123 4567', at: 5 });

  const cases = [
    [{ ...good, consent: 'yes' }, 'consent', 'invalid-argument'],
    [{ ...good, consent: false }, 'consent', 'invalid-argument'],
    [{ ...good, consent: undefined }, 'consent', 'invalid-argument'],
    [{ ...good, consentVersion: 'cs-marketing-v0' }, 'consent', 'failed-precondition'],
    [{ ...good, name: '' }, 'name', 'invalid-argument'],
    [{ ...good, email: 'x' }, 'email', 'invalid-argument'],
    [{ ...good, whatsapp: '6123 4567' }, 'whatsapp', 'invalid-argument'],
    [{ ...good, fileId: '../../etc' }, 'fileId', 'invalid-argument'],
    [{ ...good, website: 'http://bot' }, '', 'invalid-argument'],
    [{ ...good, elapsedMs: MIN_FILL_MS - 1 }, '', 'invalid-argument'],
    [null, '', 'invalid-argument'],
    [[], '', 'invalid-argument']
  ];
  for (const [data, field, code] of cases) {
    const r = validateUnlock(data);
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.equal(r.field, field, JSON.stringify(data));
    assert.equal(r.code, code, JSON.stringify(data));
  }
  // No elapsed time at all (an old page) is not held against anybody.
  assert.equal(validateUnlock({ ...good, elapsedMs: undefined }).ok, true);
});

test('the consent text names both channels, the centre and how to withdraw', () => {
  assert.match(CONSENT_TEXT, /Polymath Learning Centre/);
  assert.match(CONSENT_TEXT, /email/i);
  assert.match(CONSENT_TEXT, /WhatsApp/);
  assert.match(CONSENT_TEXT, /marketing/i);
  assert.match(CONSENT_TEXT, /withdraw/i);
  assert.match(CONSENT_VERSION, /^cs-marketing-v\d+$/);
});

test('lead ids are stable per email, private, and well-formed', () => {
  const a = leadIdFor('mum@example.com'), b = leadIdFor('MUM@example.com'), c = leadIdFor('dad@example.com');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, LEAD_ID_RE);
  assert.ok(!a.includes('mum'));
});

test('file names, paths and the download headers are safe', () => {
  assert.equal(safeFileName('PSLE Science: Cheat Sheet?.PDF'), 'PSLE Science_ Cheat Sheet_.pdf');
  assert.equal(safeFileName('../../etc/passwd'), 'etc_passwd');
  assert.equal(safeFileName(''), 'download');
  assert.equal(safeFileName('.hidden'), 'hidden');
  assert.ok(safeFileName('a'.repeat(300) + '.pdf').length <= 120);
  assert.equal(fileExtension('Notes.Final.PDF'), 'pdf');
  assert.equal(fileExtension('README'), '');

  assert.ok(FILE_ID_RE.test('Ab3_x-9Q'));
  assert.equal(storagePathFor('file_abc123', 'My Notes.pdf'), 'cs-files/file_abc123/My Notes.pdf');
  assert.equal(storagePathOk('file_abc123', 'cs-files/file_abc123/My Notes.pdf'), true);
  for (const bad of ['cs-files/other_file1/x.pdf', 'cs-files/file_abc123/', 'cs-files/file_abc123/a/b.pdf',
    'cs-files/file_abc123/.parts/x', 'cs-files/file_abc123/../x', 'shop-orders/x.pdf', 42])
    assert.equal(storagePathOk('file_abc123', bad), false, String(bad));

  assert.equal(servedContentType('application/pdf'), 'application/pdf');
  for (const active of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', '', 'nonsense'])
    assert.equal(servedContentType(active), 'application/octet-stream', active);

  const cd = contentDisposition('Sains Ringkasan — P6.pdf');
  assert.match(cd, /^attachment; filename="Sains Ringkasan  P6\.pdf"; filename\*=UTF-8''Sains%20Ringkasan%20%E2%80%94%20P6\.pdf$/);
  assert.ok(!/[\r\n]/.test(contentDisposition('a\r\nSet-Cookie: x.pdf')));
});

test('text cleaning keeps paragraphs, drops control and direction characters', () => {
  assert.equal(cleanLine('  a\u0000b‮c\n d  '), 'abc d');
  assert.equal(cleanBlock('Line one\r\n\r\n\r\n\r\nLine two  \n  three'), 'Line one\n\nLine two\nthree');
  assert.equal(clip('😀😀😀', 2), '😀😀');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('file text, settings and their defaults', () => {
  assert.deepEqual(validateFileText({ title: '  P6 Heat  ', description: 'One\n\n\n\ntwo', published: true }).value,
    { title: 'P6 Heat', description: 'One\n\ntwo', published: true });
  assert.equal(validateFileText({ title: '' }).ok, false);
  assert.equal(validateFileText({ title: 'x', published: 'yes' }).ok, false);
  assert.equal(validateFileText({ published: false }, { requireTitle: false }).ok, true);
  assert.equal(validateSettings({ headline: '' }).ok, false);
  assert.deepEqual(validateSettings({ headline: 'Hi', intro: 'a', thankYou: 'b' }).value, { headline: 'Hi', intro: 'a', thankYou: 'b' });
  const d = settingsWithDefaults(null);
  assert.ok(d.headline && d.intro && d.thankYou);
  assert.equal(settingsWithDefaults({ headline: 'X', intro: '' }).intro, '');
});

test('CSV cells are quoted and cannot smuggle in a formula', () => {
  assert.equal(csvCell('Tan "Ah" Kow'), '"Tan ""Ah"" Kow"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(csvCell('-2+3+cmd|x'), '"\'-2+3+cmd|x"');
  // A phone number is a number, and is left exactly as it is.
  assert.equal(csvCell('+6591234567'), '"+6591234567"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvRow(['a', 1, '']), '"a","1",""');
});
