import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// 🔎 Search and AI visibility (Oct 2026). Google, Bing and AI assistants find
// the site through robots.txt → sitemap.xml, read llms.txt for a summary, and
// read the home page's JSON-LD for the centre, its courses and its FAQ. These
// checks keep those files truthful as pages move: every sitemap page exists,
// is indexable and names itself as canonical; the FAQ schema says exactly what
// the page says; one phone number everywhere; app and game pages stay noindex.

const SITE = 'https://polymathlc.com.sg';
const PHONE = '+65 9645 0588';
const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const exists = rel => existsSync(new URL('../' + rel, import.meta.url));
const head = html => html.slice(0, html.search(/<\/head>/i));

// https://polymathlc.com.sg/schedule/ → schedule/index.html
function fileFor(url) {
  assert.ok(url.startsWith(SITE + '/'), `${url} is on the site`);
  const path = url.slice(SITE.length + 1);
  return path === '' || path.endsWith('/') ? path + 'index.html' : path;
}

// Parent landing pages (Oct 2026): plain HTML + assets/landing/tuition.css, no app code.
const LANDING = ['primary-science-tuition', 'primary-maths-tuition', 'online-tuition', 'psle-science-open-ended-answers'];

const sitemapUrls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

function homeGraph() {
  const blocks = [...read('index.html').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, 'the home page carries one JSON-LD block');
  return JSON.parse(blocks[0][1])['@graph'];
}

test('robots.txt lets every crawler in and points at the sitemap', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/polymathlc\.com\.sg\/sitemap\.xml$/m);
  for (const bot of ['Googlebot', 'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
    assert.match(robots, new RegExp(`^User-agent: ${bot}\\nAllow: /$`, 'm'), `${bot} is welcome`);
  }
  // A Disallow on a page would hide its noindex from Google; only non-page folders are skipped.
  const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(m => m[1]);
  for (const path of disallowed) {
    assert.ok(!sitemapUrls.some(url => url.startsWith(SITE + path)), `${path} hides no sitemap page`);
  }
});

test('every sitemap page exists, is indexable, and is its own canonical', () => {
  assert.ok(sitemapUrls.length >= 6, 'the sitemap lists the public pages');
  assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, 'no page is listed twice');
  for (const url of sitemapUrls) {
    const rel = fileFor(url);
    assert.ok(exists(rel), `${rel} exists`);
    const h = head(read(rel));
    assert.doesNotMatch(h, /name="robots"[^>]*noindex/, `${rel} is not noindex`);
    assert.match(h, new RegExp(`<link rel="canonical" href="${url.replace(/[.?]/g, '\\$&')}">`), `${rel} names ${url} as canonical`);
    assert.match(h, /<title>[\s\S]*?\S[\s\S]*?<\/title>/, `${rel} has a title`);
    assert.match(h, /<meta\s+name="description"\s+content="[^"]{50,}"/, `${rel} has a real description`);
    assert.match(h, /<meta property="og:title" content="[^"]+">/, `${rel} has a link preview title`);
    assert.match(h, /<meta property="og:image" content="https:\/\/[^"]+">/, `${rel} has a link preview image`);
  }
});

test('the home page names the centre, both courses and the FAQ in its structured data', () => {
  const graph = homeGraph();
  const org = graph.find(node => [].concat(node['@type']).includes('EducationalOrganization'));
  assert.ok(org, 'the centre is described');
  assert.ok([].concat(org['@type']).includes('LocalBusiness'), 'and is a local business, for map and "near me" results');
  assert.equal(org.telephone, PHONE);
  assert.equal(org.address.addressLocality, 'Clementi');
  assert.equal(org.address.addressCountry, 'SG');
  assert.equal(org.url, SITE + '/');

  const courses = graph.filter(node => node['@type'] === 'Course');
  assert.deepEqual(courses.map(c => c.name).sort(), ['Primary Maths Tuition (P4 to P6, PSLE)', 'Primary Science Tuition (P3 to P6, PSLE)']);
  for (const course of courses) {
    assert.equal(course.provider['@id'], org['@id'], `${course.name} is offered by the centre`);
    assert.deepEqual(course.hasCourseInstance.map(i => i.courseMode).sort(), ['online', 'onsite'], `${course.name} runs in Clementi and online`);
  }
  for (const offer of org.hasOfferCatalog.itemListElement) {
    assert.ok(courses.some(c => c['@id'] === offer.itemOffered['@id']), 'the catalogue points at a real course');
  }
});

test('the FAQ schema says word for word what the page shows', () => {
  const html = read('index.html');
  const decode = s => s.replace(/&amp;/g, '&');
  const shown = [...html.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)]
    .map(([, q, a]) => [decode(q), decode(a)]);
  const faq = homeGraph().find(node => node['@type'] === 'FAQPage');
  const schema = faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]);
  assert.ok(shown.length >= 4, 'the page shows its FAQ');
  assert.deepEqual(schema, shown);
});

test('one phone number everywhere parents can see it', () => {
  const html = read('index.html');
  assert.ok(html.includes(`href="https://wa.me/6596450588"`), 'the home page links WhatsApp');
  assert.ok(html.includes(`WhatsApp ${PHONE}`), 'and shows the number');
  for (const rel of ['index.html', 'schedule/index.html', 'enquiry.html', 'enquiry-core.mjs', 'llms.txt']) {
    assert.doesNotMatch(read(rel), /9022\s?3314|6590223314/, `${rel} has no old number`);
  }
  assert.ok(read('enquiry-core.mjs').includes(`'WhatsApp ${PHONE}'`), 'the enquiry form falls back to the same number');
  assert.ok(read('llms.txt').includes(PHONE), 'llms.txt gives the same number');
});

test('the home page links its public pages so crawlers find them', () => {
  const footer = read('index.html').match(/<footer class="lp-footer">[\s\S]*?<\/footer>/)[0];
  for (const href of ['schedule/', 'products/', 'interactive-textbook/', 'cs/', 'enquiry.html', ...LANDING.map(slug => slug + '/')]) {
    assert.ok(footer.includes(`href="${href}"`), `footer links ${href}`);
  }
});

test('app, game and tool pages stay out of search results', () => {
  const pages = [
    'bar-model.html', 'fps.html', 'fractions.html', 'grand-line.html', 'math-worksheet.html', 'math.html',
    'mistakes.html', 'offline.html', 'pdf-annotator.html', 'pirate-rift.html', 'psle-roadmap.html', 'psle-science-analysis.html',
    'question-app.html', 'sample-materials.html', 'science-defenders.html', 'science-legends.html', 'science-raiders.html',
    'science-slayers.html', 'science-spire.html', 'science-worksheet.html', 'textbooks.html', 'video-review.html', 'whiteboard.html',
    'online/index.html', 'online/offline.html', 'student/index.html', 'student/offline.html', 'handbook/index.html',
    'polymath.html', '404.html',
  ];
  for (const rel of pages) {
    assert.match(head(read(rel)), /<meta name="robots" content="noindex">/, `${rel} is noindex`);
    assert.ok(!sitemapUrls.includes(SITE + '/' + rel.replace(/index\.html$/, '')), `${rel} is not in the sitemap`);
  }
});

test('llms.txt summarises the centre and links only real pages', () => {
  const llms = read('llms.txt');
  assert.match(llms, /^# Polymath Learning Centre\n\n> /, 'title, then the one-paragraph summary');
  for (const fact of ['Clementi', 'Primary 3 to Primary 6', 'Primary 4 to Primary 6', 'PSLE', 'Mr Chung']) {
    assert.ok(llms.includes(fact), `llms.txt mentions ${fact}`);
  }
  const links = [...llms.matchAll(/\]\((https:\/\/polymathlc\.com\.sg[^)]*)\)/g)].map(m => m[1]);
  assert.ok(links.length >= 6);
  for (const url of links) assert.ok(sitemapUrls.includes(url), `${url} is a sitemap page`);
});

test('the parent landing pages are in the sitemap, light, and their FAQ schema matches the page', () => {
  const decode = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  for (const slug of LANDING) {
    const rel = `${slug}/index.html`;
    const html = read(rel);
    assert.ok(sitemapUrls.includes(`${SITE}/${slug}/`), `${slug} is in the sitemap`);
    assert.ok(Buffer.byteLength(html) < 60_000, `${slug} stays a light page`);
    assert.doesNotMatch(html, /app\.js|tailwind/i, `${slug} loads no app code`);
    assert.ok(html.includes('href="../assets/landing/tuition.css"'), `${slug} uses the shared stylesheet`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${slug} has one h1`);
    assert.ok(html.includes('href="https://wa.me/6596450588"'), `${slug} links WhatsApp`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 1);
    const graph = JSON.parse(blocks[0][1])['@graph'];
    const org = graph.find(n => [].concat(n['@type']).includes('LocalBusiness'));
    assert.equal(org['@id'], `${SITE}/#organization`, `${slug} points at the same centre as the home page`);
    assert.equal(org.telephone, PHONE);
    const crumbs = graph.find(n => n['@type'] === 'BreadcrumbList').itemListElement;
    assert.equal(crumbs.at(-1).item, `${SITE}/${slug}/`);
    const shown = [...html.matchAll(/<details><summary>([^<]+)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(([, q, a]) => [decode(q), decode(a)]);
    const schema = graph.find(n => n['@type'] === 'FAQPage').mainEntity.map(q => [q.name, q.acceptedAnswer.text]);
    assert.ok(shown.length >= 4, `${slug} shows its FAQ`);
    assert.deepEqual(schema, shown, `${slug} FAQ schema matches the page`);
  }
  assert.ok(exists('assets/landing/tuition.css'));
});

test('link previews use a real 1200×630 share card and pages show the small logo', () => {
  const png = readFileSync(new URL('../assets/branding/share-card.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const small = readFileSync(new URL('../assets/branding/polymath-learning-centre-320.png', import.meta.url));
  assert.equal(small.readUInt32BE(16), 320);
  assert.ok(small.length < 40_000, 'the web logo stays small');
  for (const url of sitemapUrls) {
    const rel = fileFor(url);
    if (rel === 'cs/index.html') continue;   // the free-resources page keeps its own logo and preview (cs-page-tests)
    const h = head(read(rel));
    assert.match(h, /<meta property="og:image" content="https:\/\/polymathlc\.com\.sg\/assets\/branding\/share-card\.png">/, `${rel} previews with the share card`);
    assert.doesNotMatch(read(rel), /<img[^>]+src="[^"]*polymath-learning-centre\.png"/, `${rel} does not download the 500 KB logo`);
  }
});
