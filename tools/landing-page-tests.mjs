import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run the shipped navigation function with only its DOM and scroll boundaries
// mocked. This covers the race where signed-out auth resolves after a visitor
// has already followed a public section link or started reading the home page.
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const navigation = source.match(/function showPage\(pageId\) \{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(navigation, 'The production showPage function must be available.');
const entryRouting = source.match(/function signedOutEntryPage\(\) \{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(entryRouting, 'The production signed-out entry routing must be available.');

const pageIds = ['landingPage', 'loginPage', 'registerPage', 'appWrapper'];
function setup({ visible = 'landingPage', scrollY = 0, hash = '' } = {}) {
  const pages = new Map(pageIds.map(id => [id, {
    style: { display: id === visible ? (id === 'appWrapper' ? 'flex' : '') : 'none' }
  }]));
  const errors = [{ style: { display: 'block' } }, { style: { display: 'block' } }];
  const loading = [new Set(['active']), new Set(['active'])];
  const forgotPassword = { style: { display: 'block' } };
  const document = {
    getElementById(id) { return id === 'forgotPassInfo' ? forgotPassword : pages.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === '.auth-error') return errors;
      if (selector === '.auth-loading') return loading.map(classes => ({ classList: { remove: name => classes.delete(name) } }));
      throw new Error(`Unexpected DOM query: ${selector}`);
    }
  };
  const scrollCalls = [];
  const window = {
    scrollX: 0, scrollY, location: { hash, pathname: '/cer/index.html', search: '?test=1' },
    scrollTo(x, y) { scrollCalls.push([x, y]); this.scrollX = x; this.scrollY = y; }
  };
  window.history = { replaceState(_state, _title, url) {
    assert.equal(url, '/cer/index.html?test=1');
    window.location.hash = '';
  } };
  const showPage = new Function('document', 'window', `${navigation}\nreturn showPage;`)(document, window);
  const signedOutEntryPage = new Function('document', 'window', `${entryRouting}\nreturn signedOutEntryPage;`)(document, window);
  return { showPage, signedOutEntryPage, pages, window, scrollCalls, errors, loading, forgotPassword };
}

function assertVisible(t, expected) {
  assert.deepEqual([...t.pages].filter(([, el]) => el.style.display !== 'none').map(([id]) => id), [expected]);
  assert.equal(t.pages.get(expected).style.display, expected === 'appWrapper' ? 'flex' : '');
}

test('late signed-out initialization preserves a public section reached before auth resolves', () => {
  const t = setup({ scrollY: 3253, hash: '#lp-about' });
  t.showPage('landingPage');
  assert.equal(t.window.scrollY, 3253, 'About Us remains at the visitor’s current position.');
  assert.equal(t.window.location.hash, '#lp-about');
  assert.deepEqual(t.scrollCalls, []);
  assertVisible(t, 'landingPage');
});

test('repeated signed-out updates preserve reading position without a URL fragment', () => {
  const t = setup({ scrollY: 1200 });
  t.showPage('landingPage');
  assert.equal(t.window.scrollY, 1200);
  t.window.scrollY = 2400; // The visitor continues reading before another callback.
  t.showPage('landingPage');
  assert.equal(t.window.scrollY, 2400);
  assert.deepEqual(t.scrollCalls, []);
  assertVisible(t, 'landingPage');
});

for (const pageId of ['loginPage', 'registerPage']) {
  test(`${pageId} opens at the top when selected from a lower home-page section`, () => {
    const t = setup({ scrollY: 4400, hash: '#lp-about' });
    t.showPage(pageId);
    assert.equal(t.window.scrollY, 0);
    assert.deepEqual(t.scrollCalls, [[0, 0]]);
    assertVisible(t, pageId);
  });

  test(`returning home from ${pageId} starts at the top even with a previous section fragment`, () => {
    const t = setup({ visible: pageId, scrollY: 200, hash: '#lp-about' });
    t.showPage('landingPage');
    assert.equal(t.window.scrollY, 0);
    assert.deepEqual(t.scrollCalls, [[0, 0]]);
    assertVisible(t, 'landingPage');
  });
}

test('opening the signed-in app leaves outer scrolling to the app and displays its flex wrapper', () => {
  const t = setup({ visible: 'loginPage', scrollY: 175 });
  t.showPage('appWrapper');
  assert.equal(t.window.scrollY, 175);
  assert.deepEqual(t.scrollCalls, []);
  assertVisible(t, 'appWrapper');
});

test('signing out of the app returns to the top of the public home', () => {
  const t = setup({ visible: 'appWrapper', scrollY: 800, hash: '#lp-about' });
  t.showPage('landingPage');
  assert.equal(t.window.scrollY, 0);
  assert.deepEqual(t.scrollCalls, [[0, 0]]);
  assertVisible(t, 'landingPage');
});

test('navigation clears stale authentication errors, loading states, and reset-password feedback', () => {
  const t = setup({ visible: 'loginPage' });
  t.showPage('registerPage');
  assert.ok(t.errors.every(error => error.style.display === 'none'));
  assert.ok(t.loading.every(classes => !classes.has('active')));
  assert.equal(t.forgotPassword.style.display, 'none');
  assertVisible(t, 'registerPage');
});

for (const [hash, expected] of [['#login', 'loginPage'], ['#register', 'registerPage'], ['#lp-about', 'landingPage'], ['#practice', 'landingPage']]) {
  test(`signed-out entry routes ${hash} correctly`, () => {
    const t = setup({ hash });
    assert.equal(t.signedOutEntryPage(), expected);
    t.showPage(t.signedOutEntryPage());
    assertVisible(t, expected);
  });
}

for (const page of ['loginPage', 'registerPage']) {
  test(`late auth callback respects a visitor already using ${page}`, () => {
    const t = setup({ visible: page, hash: '#lp-about' });
    assert.equal(t.signedOutEntryPage(), page);
  });
}

for (const destination of ['landingPage', 'appWrapper']) {
  test(`${destination} clears auth-only fragments`, () => {
    const t = setup({ visible: 'loginPage', hash: '#login' });
    t.showPage(destination);
    assert.equal(t.window.location.hash, '');
    assertVisible(t, destination);
  });
  test(`${destination} preserves game deep links`, () => {
    const t = setup({ visible: 'loginPage', hash: '#practice' });
    t.showPage(destination);
    assert.equal(t.window.location.hash, '#practice');
    assertVisible(t, destination);
  });
}
