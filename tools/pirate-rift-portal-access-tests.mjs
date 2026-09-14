import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pirateRiftScope } from '../pirate-rift-portal.js';

const root = new URL('../', import.meta.url);
const science = fs.existsSync(new URL('app.js', root));
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const app = science ? fs.readFileSync(new URL('app.js', root), 'utf8') : html;

test('account, learner, role, level and subject have distinct opaque storage scopes', () => {
  const base = ['math', 'private-account-id', 'student', 'child-a', 'P6'];
  const variants = [base, ['science', ...base.slice(1)], [...base.slice(0, 4), 'P5'],
    [base[0], 'another-account', ...base.slice(2)], [...base.slice(0, 3), 'child-b', base[4]],
    [base[0], base[1], 'admin', ...base.slice(3)]];
  const scopes = variants.map(row => pirateRiftScope(JSON.stringify(row)));
  assert.equal(new Set(scopes).size, variants.length);
  assert.equal(scopes[0], pirateRiftScope(JSON.stringify(base)));
  assert.ok(scopes.every(scope => /^p[0-9a-f]{16}$/.test(scope)));
});

test('both sidebar and game hub launch the new adventure while Hades remains available', () => {
  assert.match(html, /Pirate Rift <span class="nav-beta">BETA/);
  assert.match(app, /One Piece: Pirate Rift.*action RPG|One Piece: Pirate Rift.*isometric action RPG/);
  for (const character of ['Luffy', 'Zoro', 'Whitebeard', 'Shanks']) assert.ok(app.includes(character));
  assert.match(app, /installPirateRiftPortal/);
  assert.match(app, /window\.openPirateRift =/);
  assert.match(app, /hades-game|installHadesMathBeta|installHadesLearningParent/);
});

test('authentication, navigation and learner changes dispose or invalidate the active frame', () => {
  assert.match(app, /onAuthStateChanged\(auth, (?:async )?\(user\) => \{\s*(?:hadesMathBeta.close\(\);\s*)?pirateRiftPortal\.close\(\)/);
  assert.match(app, /function navigateTo\(page\) \{\s*vetPrintPeekHide\(\);\s*(?:hadesMathBeta.close\(\);\s*)?pirateRiftPortal\.close\(\)/);
  if (science) {
    assert.match(app, /function configureSidebarForRole\(role\) \{\s*pirateRiftPortal\.close\(\)/);
    assert.match(app, /function _scienceFeedRefreshFrames\(\) \{\s*pirateRiftPortal\.sync\(\)/);
    assert.match(app, /getProfileKey: \(\) => JSON\.stringify\(\[_scienceFeedKey\(\), familyProfile\.activeStudent\]\)/);
  } else {
    assert.match(app, /async function saveStudentLevel\(lv\) \{\s*hadesMathBeta.close\(\);\s*pirateRiftPortal\.close\(\)/);
    assert.match(app, /window\.openHadesMathBeta = \(\) => \{ pirateRiftPortal\.close\(\)/);
  }
});

test('portal setup exposes no grading, credit, score or other server-write callbacks', () => {
  const start = app.indexOf('const pirateRiftPortal = installPirateRiftPortal(');
  const end = app.indexOf('\n});', start);
  assert.ok(start > 0 && end > start);
  const setup = app.slice(start, end);
  assert.doesNotMatch(setup, /setDoc|updateDoc|gradeQuestion|recordAnswer|_spendCredit|_sdRecordScore|fetch\(/);
  const portal = fs.readFileSync(new URL('pirate-rift-portal.js', root), 'utf8');
  assert.doesNotMatch(portal, /postMessage|fetch\(|localStorage|indexedDB|firebase/);
});

if (science) test('Science navigation launches the overlay without entering a missing page', () => {
  const start = app.indexOf('function navigateTo(page) {');
  const end = app.indexOf("if (page === 'pirate-rift') { openPirateRift(); return; }", start);
  assert.ok(start > 0 && end > start);
  const prefix = app.slice(start, end + "if (page === 'pirate-rift') { openPirateRift(); return; }".length);
  let opened = 0, closed = 0;
  const context = vm.createContext({ vetPrintPeekHide() {}, pirateRiftPortal: { close() { closed++; } },
    _isEmployee: () => false, EMPLOYEE_PAGES: ['create'], openPirateRift() { opened++; } });
  vm.runInContext(prefix + '\nthrow new Error("unhandled page");\n}', context);
  vm.runInContext('navigateTo("pirate-rift")', context);
  assert.equal(opened, 1); assert.equal(closed, 1);
});
