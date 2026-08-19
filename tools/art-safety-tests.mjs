// Regression tests for 🛟 ART SAFETY & RECOVERY.
// Run with:
//     node tools/art-safety-tests.mjs            all cases
//     node tools/art-safety-tests.mjs <name>     one case
//
// It loads the REAL backup / restore / import / rescue block out of app.js and
// runs it against a shimmed page.
//
// Every picture in the game is ONE KEY in ONE Firestore map, and that map was
// lost once already — the Maths app carried a port of this game with the card
// ids deliberately kept identical, was writing this very document, and reset
// its art with a whole-document overwrite. This block is what makes the map
// survivable next time, and each way it can fail is silent:
//
//  • THE BACKUP MUST NEVER SHRINK. A wipe presents as an empty map, so a
//    backup that mirrored the live map would faithfully copy the wipe over the
//    last good copy — turning the safety net into a second way to lose
//    everything, at the exact moment it was needed.
//  • A FAILED READ MUST NOT BE BACKED UP. An unreadable store and an empty one
//    look identical, and backing one up writes "0 pictures" under a name that
//    says the collection is safe.
//  • RESTORE, IMPORT AND RESCUE MUST BE ADDITIVE. They exist to fill gaps. Any
//    of them overwriting a slot that already has art is a recovery tool that
//    destroys work — the fault this whole section exists to answer.
//  • NO WRITE MAY BE A WHOLE-DOCUMENT OVERWRITE. `setDoc({ overrides: {} })`
//    takes out every field the document holds, including any another app put
//    there. That single call is what caused all of this.
//  • THE RESCUE PROPOSAL MUST FOLLOW THE GENERATOR'S ORDER. Rescue works only
//    because uploads land in the order `tcgGenerateAllArt` draws in — card art
//    then avatar, monster by monster. Lay a run on wrongly and every picture
//    is filed under the wrong monster, which looks like a working restore.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The page these tests run against. Everything the real block reaches out to
// is here and nothing else, so a change to the block is the only thing that
// can move a result.
const FIXTURE = `
let _tcgArt = {};
let _tcgArtLoadFailed = false;
let admin = true;
const toasts = [];
const confirms = [];
let confirmAnswer = true;
// Every setDoc the block makes, exactly as it made it.
const writes = [];
let stored = {};                       // the backup document
let refreshes = 0, renders = 0;

function _isAdmin() { return admin; }
function _tcgOwnerUid() { return 'uid1'; }
const db = {};
function doc(_db, _u, uid, _s, name) { return { path: uid + '/' + name, name }; }
async function getDoc(ref) {
  const d = stored[ref.name];
  return { exists: () => !!d, data: () => d };
}
async function setDoc(ref, data, opts) {
  writes.push({ doc: ref.name, data, merge: !!(opts && opts.merge) });
  if (!(opts && opts.merge)) stored[ref.name] = data;
  else {
    const prev = stored[ref.name] || {};
    stored[ref.name] = Object.assign({}, prev, data, { overrides: Object.assign({}, prev.overrides, data.overrides) });
  }
}
function showToast(msg, kind) { toasts.push({ msg, kind }); }
function confirm(msg) { confirms.push(msg); return confirmAnswer; }
function tcgArtRefresh() { refreshes++; }
function tcgArtSafetyRender() { renders++; }
function escapeHtml(s) { return String(s); }

// Two sets, because the fault this section was rebuilt for is a run from ONE
// set being laid onto the other's slots: the National Day cards were drawn
// months after the original dex, so their run got filed onto monster slots
// and every picture wore a name that had nothing to do with it.
const TCG_SETS = {
  gen1: { key: 'gen1', name: 'Original dex', em: '\u{1F409}' },
  nd:   { key: 'nd',   name: 'Lionheart Legion', em: '\u{1F981}' },
};
const TCG_CARDS = [
  { id: 'c001', num: 1, name: 'Alpha',   em: 'A', element: 'fire',  stars: 1, set: 'gen1' },
  { id: 'c002', num: 2, name: 'Bravo',   em: 'B', element: 'aqua',  stars: 1, set: 'gen1' },
  { id: 'c003', num: 3, name: 'Charlie', em: 'C', element: 'terra', stars: 1, set: 'gen1' },
  { id: 'c004', num: 4, name: 'Knight',  em: 'K', element: 'light', stars: 5, set: 'nd', human: true, cls: 'paladin', sex: 'female' },
  { id: 'c005', num: 5, name: 'Mage',    em: 'M', element: 'spark', stars: 5, set: 'nd', human: true, cls: 'wizard',  sex: 'male' },
];

// --- AI + image shims -------------------------------------------------
// aiReply is what the vision model answers; alphaFor says which pictures
// are cut-out avatars, which is the deterministic half of the match.
let aiReply = null;
let aiCalls = 0;
let alphaFor = {};
let lastPrompt = '';
async function askGeminiVision(prompt, media, opts) { aiCalls++; lastPrompt = prompt; return JSON.stringify(typeof aiReply === 'function' ? aiReply(prompt, media) : aiReply); }
function _parseAIJson(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }
async function _urlToDataUrlRobust(url) { return 'data:image/png;base64,' + String(url).split('/').pop(); }
function _parseImageDataUrl(d) { return String(d).indexOf('data:image/') === 0 ? { mime: 'image/png' } : null; }
class Image {
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
  get naturalWidth() { return 8; }
  get naturalHeight() { return 8; }
}

// Storage shim: a bucket of objects with upload times.
let bucket = [];
let listFails = null;
const storage = {};
function storageRef(_s, path) { return { path }; }
async function listAll() {
  if (listFails) throw listFails;
  return { items: bucket.map(b => ({ name: b.name, _b: b })) };
}
async function getMetadata(r) { return { timeCreated: new Date(r._b.t).toISOString(), size: r._b.size || 1 }; }
async function getDownloadURL(r) { return 'https://files/' + r.name; }
const document = {
  getElementById: () => null,
  body: { appendChild() {} },
  createElement(tag) {
    if (tag !== 'canvas') return { click() {}, remove() {} };
    const cv = {
      width: 0, height: 0,
      getContext: () => ({
        drawImage(img) { cv._src = img._src; },
        getImageData(_x, _y, w, h) {
          // alphaFor is keyed by the picture's file name, which survives
          // into the shimmed data url.
          const key = Object.keys(alphaFor).find(n => String(cv._src || '').includes(n));
          const frac = key ? alphaFor[key] : 0;
          const px = new Uint8ClampedArray(w * h * 4);
          const clear = Math.round(w * h * frac);
          for (let i = 0; i < w * h; i++) px[i * 4 + 3] = i < clear ? 0 : 255;
          return { data: px };
        },
      }),
    };
    return cv;
  },
};
`;

const block = cut(
  "const TCG_ART_BACKUP_DOC = 'tcgArtBackup';",
  '// ---- The panel ---',
  'art safety block'
);

const mk = () => new Function(FIXTURE + block + `
return {
  state: () => ({ art: _tcgArt, writes, toasts, confirms, stored, refreshes, renders }),
  setArt(m) { _tcgArt = m; },
  setBackup(m, savedAt) { stored['tcgArtBackup'] = { overrides: m, count: Object.keys(m).length, savedAt: savedAt || '2026-01-01T00:00:00Z' }; },
  loadFailed(v) { _tcgArtLoadFailed = v; },
  admin(v) { admin = v; },
  answer(v) { confirmAnswer = v; },
  bucket(list) { bucket = list; },
  listFails(e) { listFails = e; },
  backupSync: tcgArtBackupSync,
  restore: tcgArtRestoreBackup,
  writeMany: _tcgArtWriteMany,
  scan: tcgArtRescueScan,
  openRun: tcgArtRescueOpenRun,
  shift: tcgArtRescueShift,
  drop: tcgArtRescueDrop,
  apply: tcgArtRescueApply,
  rescue: () => _tcgRescue,
  seq: _tcgRescueSlotSequence,
  scope: tcgArtRescueScope,
  identify: tcgArtRescueIdentify,
  pick: tcgArtRescueSet,
  ai(reply) { aiReply = reply; },
  aiCalls: () => aiCalls,
  prompt: () => lastPrompt,
  alpha(m) { alphaFor = m; },
};`)();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const map = n => { const o = {}; for (let i = 0; i < n; i++) o['k' + i] = 'https://files/x' + i; return o; };

// ── the backup never shrinks ────────────────────────────────────────────────

test('a full map is backed up', async () => {
  const M = mk(); M.setArt(map(5));
  await M.backupSync();
  eq(Object.keys(M.state().stored.tcgArtBackup.overrides).length, 5, 'backed up');
});

test('a WIPED map never overwrites a good backup', async () => {
  const M = mk(); M.setBackup(map(400)); M.setArt({});
  await M.backupSync();
  eq(Object.keys(M.state().stored.tcgArtBackup.overrides).length, 400,
    'the backup after a wipe — a wipe must never propagate into it');
});

test('a SMALLER map never overwrites a bigger backup', async () => {
  const M = mk(); M.setBackup(map(400)); M.setArt(map(399));
  await M.backupSync();
  eq(Object.keys(M.state().stored.tcgArtBackup.overrides).length, 400, 'the backup after a partial loss');
});

test('an equal-sized map still refreshes the backup', async () => {
  const M = mk(); M.setBackup(map(5)); M.setArt(map(5));
  await M.backupSync();
  ok(M.state().writes.some(w => w.doc === 'tcgArtBackup'), 'an equal map never refreshed the backup');
});

test('a map that could not be READ is never backed up', async () => {
  const M = mk(); M.setBackup(map(400)); M.setArt({}); M.loadFailed(true);
  await M.backupSync();
  ok(!M.state().writes.some(w => w.doc === 'tcgArtBackup'), 'an unreadable store was backed up over the good copy');
});

test('a non-admin never writes a backup', async () => {
  const M = mk(); M.admin(false); M.setArt(map(5));
  await M.backupSync();
  ok(!M.state().writes.length, 'a non-admin wrote the backup document');
});

// ── restore is additive ─────────────────────────────────────────────────────

test('restore puts back only the slots that are empty', async () => {
  const M = mk();
  M.setBackup({ a: 'https://files/A', b: 'https://files/B' });
  M.setArt({ a: 'https://files/NEW' });
  await M.restore();
  eq(M.state().art.a, 'https://files/NEW', 'art drawn since restore');
  eq(M.state().art.b, 'https://files/B', 'the missing picture');
});

test('restore never deletes and never overwrites the whole document', async () => {
  const M = mk();
  M.setBackup({ a: 'https://files/A' });
  await M.restore();
  const arts = M.state().writes.filter(w => w.doc === 'tcgArt');
  ok(arts.length > 0, 'restore wrote nothing');
  ok(arts.every(w => w.merge), 'a restore write was not a merge');
  ok(arts.every(w => Object.keys(w.data.overrides).length > 0), 'a restore write cleared the map');
});

test('restore with no backup says so instead of clearing anything', async () => {
  const M = mk(); M.setArt(map(3));
  await M.restore();
  ok(!M.state().writes.some(w => w.doc === 'tcgArt'), 'restore wrote with no backup to restore from');
  ok(M.state().toasts.some(t => t.kind === 'error'), 'restore with no backup said nothing');
});

// ── every write is a merge, chunked ─────────────────────────────────────────

test('a large write is chunked and every chunk merges', async () => {
  const M = mk();
  await M.writeMany(map(450));
  const arts = M.state().writes.filter(w => w.doc === 'tcgArt');
  ok(arts.length >= 3, 'a 450-key write was not chunked (got ' + arts.length + ' writes)');
  ok(arts.every(w => w.merge), 'a chunk was written without { merge: true }');
  eq(Object.keys(M.state().art).length, 450, 'the local map after the write');
});

test('no whole-document overwrite of an art map exists in app.js', () => {
  const bad = [...src.matchAll(/setDoc\(\s*doc\([^;]*?\)\s*,\s*\{\s*overrides:\s*\{\s*\}\s*\}/g)];
  ok(bad.length === 0,
    'setDoc(..., { overrides: {} }) is present — a whole-document overwrite takes ' +
    'every field the document holds, and that is the call that wiped this game once');
});

test('a failed art read is recorded rather than swallowed', () => {
  const fn = /async function tcgLoadArt\(force\)[\s\S]*?\n}/.exec(src);
  ok(fn, 'tcgLoadArt is gone');
  ok(/_tcgArtLoadFailed = true/.test(fn[0]),
    'a failed read no longer sets _tcgArtLoadFailed — unreadable and wiped become indistinguishable');
  ok(/_tcgArtLoadFailed = false/.test(fn[0]), 'a good read never clears the flag, so one failure is permanent');
});

// ── the rescue proposal follows the generator's order ───────────────────────

const RUN = n => Array.from({ length: n }, (_, i) => ({ name: 'f' + i, t: 1000 + i * 1000, size: 100 }));

test('the slot sequence is card-then-avatar, monster by monster', () => {
  const M = mk(); M.setArt({});
  eq(M.seq().map(s => s.id), ['c001', 'c001:av', 'c002', 'c002:av', 'c003', 'c003:av'], 'the generator order');
});

test('the sequence skips slots that already hold art', () => {
  const M = mk(); M.setArt({ c001: 'https://files/keep', 'c002:av': 'https://files/keep2' });
  eq(M.seq().map(s => s.id), ['c001:av', 'c002', 'c003', 'c003:av'], 'the gaps only');
});

test('a scanned run is laid onto the sequence in upload order', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan();
  await M.openRun(0);
  const R = M.rescue();
  eq([0, 1, 2, 3].map(k => R.assign[k]), ['c001', 'c001:av', 'c002', 'c002:av'], 'the proposal');
});

test('uploads far apart in time are separate runs', async () => {
  const M = mk();
  M.bucket([...RUN(4), ...RUN(4).map(x => ({ ...x, name: 'late' + x.name, t: x.t + 60 * 60 * 1000 }))]);
  await M.scan();
  eq(M.rescue().runs.length, 2, 'runs found');
});

test('nudging shifts the whole proposal by one', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.shift(1);
  const R = M.rescue();
  eq([0, 1, 2].map(k => R.assign[k]), ['c001:av', 'c002', 'c002:av'], 'the nudged proposal');
});

test('marking a stray pulls everything BELOW it back into line', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.drop(1);                                   // upload #1 was a retry
  const R = M.rescue();
  eq(R.assign[0], 'c001', 'the picture above the stray must not move');
  eq(R.assign[1], '', 'the stray takes no slot');
  eq([2, 3].map(k => R.assign[k]), ['c001:av', 'c002'], 'everything below the stray');
});

test('a stray can be put back', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.drop(1); M.drop(1);
  eq([0, 1, 2, 3].map(k => M.rescue().assign[k]), ['c001', 'c001:av', 'c002', 'c002:av'], 'after putting it back');
});

test('a run longer than the gaps leaves the extra pictures unfiled', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(8));   // 8 uploads, 6 empty slots
  await M.scan(); await M.openRun(0);
  const R = M.rescue();
  eq([6, 7].map(k => R.assign[k]), ['', ''], 'the overflow must not wrap round onto filled slots');
});

// ── filing is additive too ──────────────────────────────────────────────────

test('filing writes one picture per slot, merged', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  await M.apply();
  const arts = M.state().writes.filter(w => w.doc === 'tcgArt');
  ok(arts.length > 0, 'filing wrote nothing');
  ok(arts.every(w => w.merge), 'a filing write was not a merge');
  eq(Object.keys(M.state().art).sort(), ['c001', 'c001:av', 'c002', 'c002:av'], 'the filed slots');
});

test('filing never touches a slot that already has art', async () => {
  const M = mk();
  M.setArt({ c001: 'https://files/KEEP' });
  M.bucket(RUN(3));
  await M.scan(); await M.openRun(0);
  await M.apply();
  eq(M.state().art.c001, 'https://files/KEEP', 'art already in place');
});

test('a refused confirm files nothing', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.answer(false);
  await M.apply();
  ok(!M.state().writes.some(w => w.doc === 'tcgArt'), 'filing went ahead after the confirm was refused');
});

test('a denied Storage listing is named, not reported as an empty bucket', async () => {
  const M = mk();
  const err = new Error('nope'); err.code = 'storage/unauthorized';
  M.listFails(err);
  await M.scan();
  const R = M.rescue();
  ok(/permission|list/i.test(R.error), 'a denied listing must say the rules deny listing, got: ' + R.error);
});

// ── the scope: which half of the dex a run belongs to ───────────────────────
// This is the fault that shipped. Art is drawn one SET at a time — the
// National Day cards were generated months after the original 151 — so a run
// laid onto the whole dex in order put human knights and sorceresses against
// a tiger, a turtle and a polar bear, each captioned with a name that had
// nothing to do with the picture. A nudge of one cannot cross a gap of a
// hundred, so the scope has to be pickable.

test('the scope narrows the sequence to one set', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  eq(M.seq().map(s => s.id), ['c004', 'c004:av', 'c005', 'c005:av'], 'the National Day slots only');
});

test('a National Day run is never offered an original-dex slot', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  const gen1 = ['c001', 'c002', 'c003'];
  const proposed = Object.values(M.rescue().assign).filter(Boolean).map(x => x.replace(':av', ''));
  ok(proposed.every(id => !gen1.includes(id)),
    'a run scoped to the National Day set was offered original-dex slots: ' + proposed.join(', '));
});

test('the AI is only ever shown the scope\'s own cards as candidates', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  M.ai({ cards: [] });
  await M.identify();
  const p = M.prompt();
  ok(/c004/.test(p) && /c005/.test(p), 'the National Day cards were not offered as candidates');
  ok(!/c001|c002|c003/.test(p),
    'original-dex cards were offered as candidates for a National Day run — that is how a sorceress ends up filed as a polar bear');
});

// ── identification beats position ───────────────────────────────────────────

test('what the picture SHOWS wins over where it sits', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  // deliberately the reverse of the positional order
  M.ai({ cards: [
    { i: 0, id: 'c005', confidence: 0.9 },
    { i: 1, id: 'c005', confidence: 0.9 },
    { i: 2, id: 'c004', confidence: 0.9 },
    { i: 3, id: 'c004', confidence: 0.9 },
  ] });
  M.alpha({ f1: 0.5, f3: 0.5 });          // pictures 1 and 3 are cut-out avatars
  await M.identify();
  eq([0, 1, 2, 3].map(k => M.rescue().assign[k]),
     ['c005', 'c005:av', 'c004', 'c004:av'], 'the identified assignment');
});

test('the ALPHA CHANNEL decides card art from battle avatar', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  M.ai({ cards: [{ i: 0, id: 'c004', confidence: 0.9 }, { i: 1, id: 'c004', confidence: 0.9 }] });
  M.alpha({ f0: 0, f1: 0.5 });
  await M.identify();
  eq(M.rescue().assign[0], 'c004', 'an opaque picture is the card art');
  eq(M.rescue().assign[1], 'c004:av', 'a cut-out picture is the battle avatar');
});

test('a picture the AI could not name is left UNASSIGNED, never guessed', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  M.ai({ cards: [{ i: 0, id: 'c004', confidence: 0.9 }] });
  await M.identify();
  eq(M.rescue().assign[0], 'c004', 'the one that was identified');
  eq([1, 2, 3].map(k => M.rescue().assign[k]), ['', '', ''],
     'the rest must be left alone — once anything is identified the positional ' +
     'guesses no longer line up with anything, and filing under a guess is the whole fault');
});

test('an id the model invented is ignored', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.ai({ cards: [{ i: 0, id: 'c999', confidence: 0.9 }, { i: 1, id: 'c001', confidence: 0.9 }] });
  await M.identify();
  eq(M.rescue().assign[0], '', 'an unknown card id must not be filed anywhere');
  eq(M.rescue().assign[1], 'c001', 'the real one still lands');
});

test('two pictures naming the same card keep the more confident one', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.ai({ cards: [{ i: 0, id: 'c001', confidence: 0.4 }, { i: 1, id: 'c001', confidence: 0.95 }] });
  await M.identify();
  eq(M.rescue().assign[0], '', 'the less confident duplicate');
  eq(M.rescue().assign[1], 'c001', 'the more confident duplicate');
});

test('identification never proposes a slot that already has art', async () => {
  const M = mk();
  M.setArt({ c001: 'https://files/KEEP' });
  M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.ai({ cards: [{ i: 0, id: 'c001', confidence: 0.9 }] });
  await M.identify();
  eq(M.rescue().assign[0], '', 'a filled slot was proposed for overwriting');
});

test('an identified run files what it identified', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.scope('set:nd');
  M.ai({ cards: [{ i: 0, id: 'c004', confidence: 0.9 }, { i: 1, id: 'c005', confidence: 0.9 }] });
  await M.identify();
  await M.apply();
  eq(Object.keys(M.state().art).sort(), ['c004', 'c005'], 'the filed slots');
});

test('a hand-set slot counts as an identification and outranks position', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.pick(2, 'c003');
  eq(M.rescue().assign[2], 'c003', 'the hand-set slot');
  eq(M.rescue().assign[0], '', 'the rest fall back to unassigned rather than a stale guess');
});

test('a picture whose card is already in place is NAMED, not left blank', async () => {
  const M = mk();
  M.setArt({ c001: 'https://files/KEEP' });
  M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.ai({ cards: [{ i: 0, id: 'c001', confidence: 0.9 }] });
  await M.identify();
  eq(M.rescue().have[0], 'c001', 'the cell must say the card is already in place');
  eq(M.rescue().assign[0], '', 'and it must not be filed again');
});

test('nudging puts an identified run back onto position', async () => {
  const M = mk(); M.setArt({}); M.bucket(RUN(4));
  await M.scan(); await M.openRun(0);
  M.ai({ cards: [{ i: 3, id: 'c001', confidence: 0.9 }] });
  await M.identify();
  eq(M.rescue().assign[0], '', 'identified run: unidentified pictures stay unassigned');
  M.shift(0);
  eq(M.rescue().assign[0], 'c001',
    'after a nudge the run must match by position again, or the nudge buttons ' +
    'appear to do nothing at all');
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { await c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n' + (process.env.STACK ? err.stack : '         ' + err.message)); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
