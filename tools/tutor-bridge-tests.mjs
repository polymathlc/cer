// 📖 The Study Buddy bridge and 🧭 the apps under one roof (v1.410.0).
//
// Every failure here is silent. The export writes into ANOTHER repository's
// collections in that repository's document shape: a field name that drifts
// on either side throws nothing — the worksheet opens in Study Buddy with its
// answer key showing to the student, or the class never sees the sheet the
// teacher set, or the PDF is uploaded to a folder nothing reads. So this
// harness reads BOTH repositories when the sibling checkout is beside this
// one, and pins the names against Study Buddy's own constants.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('✗ ' + name); } }
function cut(from, to, what) {
  const a = js.indexOf(from); if (a < 0) throw new Error('cannot find ' + what);
  const b = js.indexOf(to, a + from.length); if (b < 0) throw new Error('cannot find the end of ' + what);
  return js.slice(a, b);
}
const constOf = (src, name) => { const m = src.match(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*[\'"]([^\'"]+)[\'"]')); return m ? m[1] : null; };

// ---- 🧭 one table, all apps -------------------------------------------------
const tools = cut('const POLYMATH_TOOLS = [', '];', 'POLYMATH_TOOLS');
ok('the tools table names Ans Key and Study Buddy', /key: 'anskey'/.test(tools) && /key: 'tutor'/.test(tools));
ok('every tool url is a RELATIVE sibling-folder hop ending in /', [...tools.matchAll(/url: '([^']+)'/g)].every(m => /^\.\.\/[a-z]+\/$/.test(m[1])));
ok('the tool folders are the REPO names', /url: '\.\.\/anskey\/'/.test(tools) && /url: '\.\.\/tutor\/'/.test(tools));
ok('the subject table still holds exactly the four subjects', (cut('const SUBJECT_APPS = [', '];', 'SUBJECT_APPS').match(/key: '/g) || []).length === 4);
const menu = cut('function subjectRenderMenu() {', '\nfunction subjectToggle', 'subjectRenderMenu');
ok('the switcher menu lists the tools under the subjects', /Your tools/.test(menu) && /POLYMATH_TOOLS\.map/.test(menu));
ok('a tool row is a real link (the href is the standalone app)', /href="\$\{escapeHtml\(t\.url\)\}"/.test(menu));
ok('a plain click opens the embedded page; a modified click is left to the browser',
  /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;/.test(js));

// ---- the sidebar and the embedded pages ---------------------------------------
const navStart = html.indexOf('<nav class="sidebar-nav">');
const nav = html.slice(navStart, html.indexOf('</nav>', navStart));
const apps = (nav.match(/<details class="nav-group" data-group="apps"[\s\S]*?<\/details>/) || [''])[0];
ok('the 🧭 Polymath Apps group exists and is open to every role', apps.length > 0);
ok('Study Buddy and Ans Key are pages of this portal', /data-page="tutor"/.test(apps) && /data-page="anskey"/.test(apps));
ok('both embedded pages exist', /id="page-tutor"/.test(html) && /id="page-anskey"/.test(html));
ok('the frames carry NO src at first paint — they load on first open', !/id="appEmbedFrame-tutor"[^>]*\ssrc=/.test(html) && !/id="appEmbedFrame-anskey"[^>]*\ssrc=/.test(html));
ok('navigateTo points the frame on every navigation', /appEmbedOnNavigate\(page\)/.test(cut('function navigateTo(page) {', '\n}', 'navigateTo')));
ok('the embed url is derived from the tools table, never typed twice', /function _appEmbedUrl\(page, params\)[\s\S]{0,200}polymathToolFor\(/.test(js));

// ---- 📖 the export ----------------------------------------------------------------
const send = cut('async function tsendSend() {', '\n// A fresh Firestore document id', 'tsendSend');
ok('the sheet is built through the ONE preview builder', /_wsPreviewBuildHtml\(ctx, \{ noTags: true \}\)/.test(js));
ok('the A4 preview builds through the same builder', /const html = _wsPreviewBuildHtml\(ctx\);/.test(cut('async function renderWsPreview() {', '\nfunction _wsWritePreview(', 'renderWsPreview')));
ok('the hidden frame is packed with noTools — nothing is hung on a page about to be photographed', /noTools: true,/.test(cut('function _tsendRenderPages(ctx) {', '\nasync function tsendSend', '_tsendRenderPages')));
const pack = cut('function _wsPreviewPack(doc, opts) {', '\n// WORKSHEET QUICK EDIT', '_wsPreviewPack');
ok('the packer draws tools only when neither readOnly nor noTools', /const drawTools = !readOnly && !noTools;/.test(pack) && !/if \(!readOnly && idx !== 0\)/.test(pack));
ok('the packer marks the key sheets', /sh\.dataset\.kind = 'key'/.test(pack));
ok('the pills and bars are not hung on a noTools frame', /if \(!noTools\) pvsDecorateDoc\(doc\);/.test(pack) && /if \(!noTools\) pvoDecorateDoc\(doc\);/.test(pack));
ok('the live preview page count is not overwritten by the hidden frame', /\(readOnly \|\| noTools\) \? null : document\.getElementById\('wsPreviewPageCount'\)/.test(pack));
ok('a zoomed sheet is photographed through a transform on width 100%/zoom', /content\.style\.transform = 'scale\(' \+ z \+ '\)';/.test(js) && /content\.style\.width = \(100 \/ z\) \+ '%';/.test(js));
ok('a sheet is pinned to ONE A4 with overflow hidden', /sheet\.style\.height = '297mm'/.test(js) && /sheet\.style\.overflow = 'hidden'/.test(js));
ok('the key pages travel by page number and the rows off the rendered key', /keyPages\.push\(i \+ 1\)/.test(send) && /_tsendKeyRows\(rdoc\)/.test(send));
ok('the frame document never shadows Firestore\'s doc()', !/const doc = frame\.contentDocument/.test(send) && /setDoc\(doc\(db, TSEND_COLLECTION/.test(send));
ok('with the key unticked, the key sheets are left out of the photograph', /if \(!includeKey\) sheets = sheets\.filter\(sh => sh\.dataset\.kind !== 'key'\);/.test(send));
ok('the class tick is honoured for an ADMIN only, in the handler', /const setForClass = _isAdmin\(\) && !!document\.getElementById\('tsendSet'\)/.test(send));
ok('the assignment is written only when set for the class', /if \(setForClass\) \{\s*await setDoc\(doc\(db, TSEND_ASSIGN_COLLECTION, docId\)/.test(send));
ok('the PDF goes up BEFORE the documents are written', send.indexOf('uploadBytes(') < send.indexOf('setDoc(doc(db, TSEND_COLLECTION'));
ok('the body carries an already-read key', /scanned: true/.test(send));
ok('a denied write is NAMED', /rules for ' \+ TSEND_COLLECTION/.test(send));
ok('the libraries are loaded on demand from two CDNs, never at first paint',
  !/<script[^>]*html2canvas/.test(html) && !/<script[^>]*pdf-lib/.test(html) && /TSEND_LIBS = \{[\s\S]*?jsdelivr[\s\S]*?cdnjs[\s\S]*?\}/.test(js));
ok('the three doors and the dialog are on window', ['tsendFromPreview', 'tsendFromBuilder', 'tsendFromSaved', 'tsendSend', 'tsendClose', 'appEmbedOpen'].every(f => js.includes('window.' + f + ' = ' + f + ';')));
ok('the three doors are wired in the markup', /onclick="tsendFromPreview\(\)"/.test(html) && /onclick="tsendFromBuilder\(\)"/.test(html) && /tsendFromSaved\('\$\{ws\.id\}'\)/.test(js));
ok('the dialog exists', /id="tsendOverlay"/.test(html) && /id="tsendGrades"/.test(html) && /id="tsendKey"/.test(html));

// ---- against Study Buddy ITSELF, when it is checked out beside this repo ---------
const tutorFile = path.join(path.dirname(root), 'tutor', 'index.html');
if (fs.existsSync(tutorFile)) {
  const t = fs.readFileSync(tutorFile, 'utf8');
  const pairs = [['TSEND_COLLECTION', 'COLLECTION'], ['TSEND_ASSIGN_COLLECTION', 'ASSIGN_COLLECTION'], ['TSEND_STORAGE_DIR', 'STORAGE_DIR'], ['TSEND_GRADE_DEFAULT', 'HINT_DEFAULT'], ['TSEND_TEACHER_NAME', 'ADMIN_DISPLAY_NAME']];
  for (const [mine, theirs] of pairs) ok(mine + ' matches Study Buddy\'s ' + theirs, constOf(js, mine) !== null && constOf(js, mine) === constOf(t, theirs));
  const grades = [...cut('const TSEND_GRADES = [', '];', 'TSEND_GRADES').matchAll(/key: '([a-z]+)'/g)].map(m => m[1]);
  const theirs = [...(t.match(/var GUIDANCE_GRADES = \[[\s\S]*?\];/) || [''])[0].matchAll(/key: '([a-z]+)'/g)].map(m => m[1]);
  ok('the help levels are Study Buddy\'s own keys, in order', grades.join() === theirs.join());
  const levels = (js.match(/const TSEND_LEVELS = \[([^\]]+)\]/) || ['', ''])[1].replace(/['\s]/g, '');
  ok('the levels are Study Buddy\'s LEVELS', levels === (t.match(/var LEVELS = \[([^\]]+)\]/) || ['', ''])[1].replace(/['\s]/g, ''));
  ok('Study Buddy opens a worksheet named on its url (?ws=)', /URLSearchParams\(location\.search\)\.get\('ws'\)/.test(t));
  ok('Study Buddy reads the body fields this export writes', ['annotations', 'hints', 'marking', 'chat', 'key'].every(k => new RegExp('body\\.' + k + '\\b').test(t)));
  ok('Study Buddy\'s assignment card reads the fields the assignment carries', ['guidanceLocked', 'keyPages', 'keyRows', 'storagePath', 'pageCount', 'cover', 'active'].every(k => t.includes(k)));
  ok('Study Buddy carries the same tools table', /key: 'anskey'/.test(t) && /url: '\.\.\/anskey\/'/.test(t) && /key: 'tutor'/.test(t));
} else {
  console.log('  (tutor checkout not beside this repo — the cross-repo checks were skipped)');
}

console.log((fail ? '❌ ' : '✓ ') + pass + '/' + (pass + fail) + ' Study Buddy bridge checks passed');
process.exit(fail ? 1 : 0);
