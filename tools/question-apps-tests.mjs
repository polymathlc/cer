import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require = createRequire(import.meta.url);
const apps = require('../question-apps.js');
globalThis.qrcode = require('../vendor/qrcode-generator.js');
const id = 'ab'.repeat(32), token = 'c33f87fa-93cb-4447-9b21-ed35f103ec3a';
const appUrl = apps.viewerUrl(id, token);

test('generation limits match the provider bounds and reject invalid numbers', () => {
  assert.equal(apps.normalizeTokenLimit(undefined), 4096);
  assert.equal(apps.normalizeTokenLimit(''), 4096);
  assert.equal(apps.normalizeTokenLimit('invalid'), 4096);
  assert.equal(apps.normalizeTokenLimit(Infinity), 4096);
  assert.equal(apps.normalizeTokenLimit(512), 1024);
  assert.equal(apps.normalizeTokenLimit(99999), 32000);
  assert.equal(apps.normalizeTokenLimit('4567.9'), 4567);
});
test('sandbox precedes supplied HTML and escapes iframe attributes', () => {
  const html = '<!doctype html><html><head><script>window.parent.compromised=true</script></head><body>Demo</body></html>';
  const source = apps.sandboxDocument(html);
  assert.ok(source.indexOf('Content-Security-Policy') < source.indexOf(html));
  assert.match(source, /default-src &#39;none&#39;/);
  assert.match(source, /connect-src &#39;none&#39;/);
  const frame = apps.frame({html, title:'" onload="alert(1)', height:'900;position:fixed'});
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin|allow-popups| onload="|<script>/);
  assert.match(frame, /height:560px/);
  assert.equal(apps.normalizeHeight(99), 240);
  assert.equal(apps.normalizeHeight(99999), 900);
});
test('share links only resolve to this app and one scoped Storage object', () => {
  assert.equal(apps.validViewerUrl(appUrl), appUrl);
  assert.equal(apps.validViewerUrl(appUrl.replace('polymathlc.github.io', 'evil.example')), '');
  assert.equal(apps.validViewerUrl(appUrl.replace('question-app.html#', 'question-app.html?x=1#')), '');
  assert.equal(apps.validViewerUrl(appUrl.replace('https://', 'https://evil@')), '');
  assert.equal(apps.validViewerUrl(appUrl + '&token=' + token), '');
  assert.equal(apps.validViewerUrl(appUrl + '&redirect=https://evil.example'), '');
  assert.equal(apps.viewerUrl('../secret', token), '');
  const storageUrl = new URL(apps.storageUrlFromHash(new URL(appUrl).hash));
  assert.equal(storageUrl.origin, 'https://firebasestorage.googleapis.com');
  assert.equal(decodeURIComponent(storageUrl.pathname), '/v0/b/mathgen--app.firebasestorage.app/o/cer-images/question-app-' + id + '.json');
  assert.equal(storageUrl.searchParams.get('token'), token);
  assert.equal(apps.storageUrlFromHash('#https://evil.example'), '');
});
test('editing HTML suppresses an obsolete worksheet QR until publication', () => {
  const block = {title:'A <lab>', html:'<button>Try</button>', appUrl};
  block.appSourceHash = apps.sourceHash(block);
  assert.equal(apps.publishedUrl(block), appUrl);
  const printed = apps.printBlock(block);
  assert.match(printed, /<svg[^>]+width="128"/);
  assert.match(printed, /href="https:\/\/polymathlc.github.io\/cer\/question-app.html#id=/);
  assert.match(printed, /A &lt;lab&gt;/);
  assert.match(printed, /viewBox="0 0 /);
  block.html += '<p>Changed</p>';
  assert.equal(apps.publishedUrl(block), '');
  assert.doesNotMatch(apps.printBlock(block), /<svg|href=/);
  assert.match(apps.printBlock(block), /Publish app in question editor before printing a QR code/);
  block.appSourceHash = apps.sourceHash(block);
  assert.equal(apps.publishedUrl({...block, title:'New title'}), '');
  assert.equal(apps.publishedUrl({...block, height:800}), '');
});
test('empty or discarded app placeholders add no card to student worksheets', () => {
  for (const block of [null, {}, {html:''}, {html:' \n\t', appUrl, appSourceHash:apps.sourceHash({html:' \n\t'})}]) {
    assert.equal(apps.printBlock(block), '');
  }
});
test('viewer uses no Firebase auth or private question-bank reads', () => {
  const source = readFileSync(new URL('../question-app-viewer.js', import.meta.url), 'utf8');
  assert.match(source, /credentials:'omit'/);
  assert.match(source, /redirect:'error'/);
  assert.match(source, /crypto.subtle.digest\('SHA-256', bytes\)/);
  assert.doesNotMatch(source, /firebase-app|firebase-auth|firebase-firestore|getFirestore|localStorage/);
  assert.match(source, /reader.cancel\(\)/);
});
