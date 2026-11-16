// Polymath Online (online/) in a real browser, on an in-memory Firebase
// (tools/online-portal-fake-firebase.js): an admin creates a class, uploads
// its worksheets, invites a student; the student joins through the link and
// sees only what is released; the release moving shows up live.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fake = fs.readFileSync(path.join(root, 'tools/online-portal-fake-firebase.js'), 'utf8');
const shots = path.resolve(process.env.ONLINE_SCREENSHOTS || path.join(root, '..', 'online-portal-validation'));
fs.mkdirSync(shots, { recursive: true });
const pageUrl = pathToFileURL(path.join(root, 'online/index.html')).href;

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('✓ ' + name); }

async function open({ user, docs, query = '', width = 1280 }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-app-compat\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-(auth|firestore|storage)-compat\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/cdnjs\.cloudflare\.com\/.*pdf\.min\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.pdfjsLib={GlobalWorkerOptions:{},getDocument:function(){return{promise:Promise.resolve({numPages:3,destroy:function(){}})}}};' }));
  await page.route(/dropboxusercontent\.com/, (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="56"><rect width="120" height="56" rx="10" fill="#FFE0B2"/></svg>' }));
  await page.addInitScript(({ user, docs }) => { window.__initialUser = user; window.__initialDocs = docs; }, { user, docs });
  await page.goto(pageUrl + query);
  await page.waitForTimeout(300);
  return { page, context, errors };
}
const admin = { uid: 'admin-1', email: 'chungzhikai@gmail.com', displayName: 'Zhi Kai Chung' };
const pdf = Buffer.from('%PDF-1.4\n%fake\n');

/* ---- Signed out ---- */
{
  const { page, context, errors } = await open({ user: null });
  await page.waitForSelector('.hero');
  check('signed out: the Google sign-in screen shows', await page.locator('[data-action="sign-in"]').isVisible());
  await page.screenshot({ path: path.join(shots, '01-sign-in.png') });
  check('signed out: no script errors', errors.length === 0);
  await context.close();
}

/* ---- Admin: a class, its worksheets, an invitation ---- */
let db;
{
  const { page, context, errors } = await open({ user: admin });
  await page.waitForSelector('.tabs');
  check('admin: the admin view opens for an admin email', await page.locator('text=Upload each class').isVisible());
  await page.click('[data-action="new-course"] >> nth=0');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-m="level"][data-v="P5"]');
  await page.click('.modal [data-m="subject"][data-v="math"]');
  await page.click('.modal [data-m="day"][data-v="Monday"]');
  await page.click('.modal [data-m="slot"][data-v="1"]');
  check('admin: the class name is built from level, subject, day and session', (await page.inputValue('#courseTitle')) === 'P5 Mathematics · Monday 5:00pm');
  await page.click('.modal [data-m="save"]');
  await page.waitForSelector('#dropzone');
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `Worksheet ${10 - i}.pdf`, mimeType: 'application/pdf', buffer: pdf }));
  // A real file picker leaves the input focused when it closes. Re-rendering
  // used to try to put the file name back into it, which browsers refuse, and
  // the upload stopped at "waiting" before its first file.
  await page.focus('#fileInput');
  await page.setInputFiles('#fileInput', files);
  await page.waitForSelector('.upload-total', { timeout: 5000 });
  check('admin: the batch shows one line and one bar for all the files', /Uploading \d+ of 10|All 10 uploaded/.test(await page.textContent('.upload-total')));
  await page.waitForFunction(() => document.querySelectorAll('.seq-row').length === 10, null, { timeout: 15000 });
  check('admin: a focused file picker does not stop the upload', true);
  await page.waitForFunction(() => /All 10 uploaded/.test((document.querySelector('.upload-total') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('admin: the batch line says when all are uploaded', /All 10 uploaded/.test((await page.textContent('.upload-total').catch(() => '')) || '') || !(await page.$('.upload-total')));
  const names = await page.$$eval('.seq-row .name-edit', (els) => els.map((e) => e.value));
  check('admin: ten PDFs become ten worksheets in natural name order', names.join('|') === Array.from({ length: 10 }, (_, i) => `Worksheet ${i + 1}`).join('|'));
  db = await page.evaluate(() => window.__fake.db);
  const course = Object.entries(db).find(([p]) => p.startsWith('onlineCourses/'))[1];
  const sheets = course.worksheetIds.map((id) => db['pdfAnnotator/' + id]);
  check('admin: every worksheet carries its class and place', sheets.every((d, i) => d.onlineSeq === i && d.listOrder === i && d.onlineCourseId));
  check('admin: worksheets are filed for Ans Key (level, subject, day, session, PDF path, page count)', sheets.every((d) => d.level === 'P5' && d.subject === 'math' && d.wsDay === 'Monday' && d.wsSlot === 1 && /^pdf-annotator\/.+\.pdf$/.test(d.storagePath) && d.pageCount === 3 && d.ownerUid === 'admin-1'));
  check('admin: a new class starts with nothing released', course.currentIndex === -1 && course.releasedThrough === -1);
  await page.screenshot({ path: path.join(shots, '02-class.png'), fullPage: true });

  // Move worksheet 2 down, then back: the order and every onlineSeq follow.
  await page.click('.seq-row:nth-child(2) [data-action="move"][data-delta="1"]');
  await page.waitForFunction(() => document.querySelector('.seq-row:nth-child(2) .name-edit').value === 'Worksheet 3');
  db = await page.evaluate(() => window.__fake.db);
  const moved = Object.entries(db).find(([p]) => p.startsWith('onlineCourses/'))[1];
  check('admin: a reorder rewrites the places', db['pdfAnnotator/' + moved.worksheetIds[2]].onlineSeq === 2 && db['pdfAnnotator/' + moved.worksheetIds[2]].name === 'Worksheet 2');
  await page.click('.seq-row:nth-child(3) [data-action="move"][data-delta="-1"]');
  await page.waitForFunction(() => document.querySelector('.seq-row:nth-child(2) .name-edit').value === 'Worksheet 2');

  // Class is on worksheet 3 → always 3 ahead: up to 6 released (v1.12.0).
  await page.fill('#currentInput', '3');
  await page.click('[data-action="set-current"]');
  await page.waitForFunction(() => /Up to 6/.test(document.querySelector('.control-strip').textContent));
  check('admin: putting the class on worksheet 3 releases up to 6 (the next one and the two after it)', true);

  // 📌 What Ans Key shows: worksheet 3 is current, 4 is loaded as next, the rest queued.
  const chips = () => page.$$eval('.seq-row .seq-status', (els) => els.map((e) => e.textContent.trim()));
  let labels = await chips();
  check('admin: worksheets 1 and 2 are done', labels[0] === '✓ Done' && labels[1] === '✓ Done');
  check('admin: worksheet 3 is the Current worksheet', labels[2] === '▶ Current worksheet');
  check('admin: worksheet 4 is the Next worksheet', labels[3] === '⏭ Next worksheet');
  check('admin: released ones after it are queued, the rest wait', labels[4] === 'Released · queued' && labels[9] === 'Queued');
  check('admin: the Finished button names the worksheet', /Worksheet 3 finished · load the next/.test(await page.textContent('[data-action="finish-current"]')));
  await page.screenshot({ path: path.join(shots, '02b-current-next.png'), fullPage: true });
  await page.click('[data-action="finish-current"]');
  await page.waitForFunction(() => /Worksheet 4/.test(document.querySelector('.control-strip .big').textContent), null, { timeout: 10000 });
  labels = await chips();
  check('admin: after Finished, 4 is current and 5 is loaded as next', labels[2] === '✓ Done' && labels[3] === '▶ Current worksheet' && labels[4] === '⏭ Next worksheet');
  db = await page.evaluate(() => window.__fake.db);
  const classAfterFinish = Object.entries(db).find(([p]) => p.startsWith('onlineCourses/'))[1];
  check('admin: Finished saves the move and what was finished', classAfterFinish.currentIndex === 3 && classAfterFinish.releasedThrough === 6 && classAfterFinish.lastFinishedIndex === 2);
  // Back to worksheet 3, released up to 8, for the student checks below.
  await page.fill('#currentInput', '3');
  await page.click('[data-action="set-current"]');
  await page.waitForFunction(() => /Worksheet 3/.test(document.querySelector('.control-strip .big').textContent));
  await page.fill('#releaseInput', '8');
  await page.click('[data-action="set-release"]');
  await page.waitForFunction(() => /Up to 8/.test(document.querySelector('.control-strip').textContent));
  check('admin: the class can be put back by hand', true);

  // Invite a student.
  await page.click('[data-action="close-course"]');
  await page.click('[data-action="tab"][data-tab="people"]');
  await page.fill('#inviteEmails', 'ethan.parent@example.com');
  await page.fill('#inviteName', 'Ethan Tan');
  await page.click('[data-action="draft-level"][data-level="P5"]');
  await page.click('#inviteSend');
  await page.waitForSelector('[data-action="copy-link"]');
  db = await page.evaluate(() => window.__fake.db);
  const invite = Object.entries(db).find(([p]) => p.startsWith('onlineInvites/'));
  const mail = Object.entries(db).find(([p]) => p.startsWith('mail/'));
  check('admin: an invitation is saved with level and subjects', invite && invite[1].emailLower === 'ethan.parent@example.com' && invite[1].level === 'P5' && invite[1].subjects.join() === 'math,science' && invite[1].status === 'pending');
  check('admin: the invitation email is queued for the Trigger Email extension', mail && /^mail\/polymath-online-invite-/.test(mail[0]) && mail[1].to[0] === 'ethan.parent@example.com' && mail[1].message.html.includes('https://polymathlc.com.sg/online/?invite=' + invite[0].split('/')[1]));
  check('admin: the queued mail never uses the enquiry service\'s protected ids', !/polymath-enquiry-/.test(mail[0]));
  check('admin: the invitation is sent as admin@polymathlc.com.sg', mail && mail[1].from === 'Polymath Learning Centre <admin@polymathlc.com.sg>' && mail[1].replyTo === 'admin@polymathlc.com.sg');
  await page.screenshot({ path: path.join(shots, '03-people.png'), fullPage: true });
  check('admin: no script errors', errors.length === 0);
  if (errors.length) console.log(errors);
  await context.close();
}

let studentDb = null;
/* ---- The student joins through the link ---- */
{
  const inviteId = Object.keys(db).find((p) => p.startsWith('onlineInvites/')).split('/')[1];
  const student = { uid: 'stu-1', email: 'ethan.t@gmail.com', displayName: 'Ethan Tan', photoURL: '' };
  // The teacher has written on worksheet 3 in Ans Key and recorded two lessons on it.
  const ws3 = Object.keys(db).find((p) => p.startsWith('pdfAnnotator/') && db[p].onlineSeq === 2);
  const ws3Id = ws3.split('/')[1];
  const edited = Date.UTC(2026, 9, 12, 8, 5);   // Mon 12 Oct 2026, 4:05 pm in Singapore
  db[ws3].updatedAt = { seconds: Math.floor(edited / 1000), nanoseconds: 0 };
  db[ws3].annotations = JSON.stringify([
    { id: 'pen-1', type: 'pen', page: 1 },
    { id: 'rec-old', type: 'video', page: 1, url: 'https://firebasestorage.googleapis.com/v0/b/mathgen--app/o/pdf-annotator%2Flesson-a.m4a', ts: edited - 86400000, label: 'Play lesson · 41:00', lessonRecording: { version: 1, duration: 2460000 } },
    { id: 'rec-new', type: 'video', page: 2, url: 'https://firebasestorage.googleapis.com/v0/b/mathgen--app/o/pdf-annotator%2Flesson-b.webm', ts: edited, label: 'Q5 · video lesson · 12:04', lessonRecording: { version: 1, duration: 724000, video: true, title: 'Q5' } }
  ]);
  const { page, context, errors } = await open({ user: student, docs: db, query: '?invite=' + inviteId + '#timeline', width: 1100 });
  await page.waitForSelector('.class-card', { timeout: 10000 });
  check('student tabs: Worksheets, Answer keys, Videos and Timeline', (await page.$$eval('.st-tab .st-tab-label', (els) => els.map((e) => e.textContent))).join('|') === 'Worksheets|Answer keys|Videos|Timeline');
  check('student tabs: #timeline in the address opens the Timeline tab', (await page.getAttribute('#st-tab-timeline', 'aria-selected')) === 'true');
  const after = await page.evaluate(() => window.__fake.db);
  check('student: joining with a different Google address works through the link', after['onlineMembers/stu-1'] && after['onlineMembers/stu-1'].level === 'P5');
  check('student: the invitation is marked joined', after['onlineInvites/' + inviteId].status === 'joined' && after['onlineInvites/' + inviteId].joinedUid === 'stu-1');
  check('student: Ans Key gets their profile (level + both subjects)', after['studentProfiles/stu-1'].level === 'P5' && after['studentProfiles/stu-1'].subject === 'both');
  check('student: the invite token is taken out of the address', !(await page.evaluate(() => location.search)).includes('invite'));
  await page.waitForFunction(() => document.querySelectorAll('.tl-item').length === 8);
  const rows = await page.$$eval('.tl-item .tl-name', (els) => els.map((e) => e.textContent));
  check('student: a vertical timeline of worksheets 1 to 8, in teaching order, nothing past the release', rows.join('|') === 'Worksheet 1|Worksheet 2|Worksheet 3|Worksheet 4|Worksheet 5|Worksheet 6|Worksheet 7|Worksheet 8');
  check('student: the worksheet the class is on is highlighted as the current worksheet',
    (await page.locator('.tl-item.is-current').count()) === 1 && (await page.textContent('.tl-item.is-current .tl-name')) === 'Worksheet 3' &&
    /Current worksheet/.test(await page.textContent('.tl-item.is-current')) && (await page.getAttribute('.tl-item.is-current', 'aria-current')) === 'step');
  check('student: worksheets before it are marked done, the two after it up next', (await page.locator('.tl-item.is-done').count()) === 2 && (await page.locator('.tl-item.is-next').count()) === 2);
  await page.waitForFunction(() => /Oct/.test((document.querySelector('.tl-item.is-current .tl-date') || {}).textContent || ''));
  const dateText = await page.textContent('.tl-item.is-current .tl-date');
  check('student: each worksheet shows the date it was last edited in Ans Key', /12 Oct/.test(dateText) && /\d:\d\d (am|pm)/.test(dateText));
  check('student: the current worksheet says it was edited; one never written on says when it was uploaded',
    /^Edited/.test((await page.textContent('.tl-item.is-current .tl-date')).trim()) && /^Uploaded/.test((await page.textContent('.tl-item:nth-child(1) .tl-date')).trim()));
  check('student: every worksheet has View and Print for the worksheet, and its answer key never opens the Ans Key app',
    (await page.locator('.tl-item [data-action="view"]').count()) === 8 && (await page.locator('.tl-item [data-action="print"]').count()) === 8 &&
    (await page.locator('.tl-item [data-action="answer-key"], .tl-item [data-action="print-key"]').count()) === 0 &&
    (await page.locator('.tl-item .tl-key-wait').count()) === 8);
  check('student: the video button shows only where a lesson was recorded, with how many', (await page.locator('.tl-item [data-action="video"]').count()) === 1 && /2 videos/.test(await page.textContent('.tl-item.is-current [data-action="video"]')));
  const next = await page.$$eval('.next-tile .name', (els) => els.map((e) => e.textContent));
  check('student: the next two are worksheets 4 and 5', next.join('|') === 'Worksheet 4|Worksheet 5');
  check('student: each of the next two has Download and Print', (await page.locator('.next-tile [data-action="download"]').count()) === 2 && (await page.locator('.next-tile [data-action="print"]').count()) === 2);
  check('student: two locked worksheets are counted, not named', /2 more worksheets/.test(await page.textContent('.locked-row')) && !(await page.textContent('body')).includes('Worksheet 9'));

  // ▶ Video: a page of its own (watch.html), never the Ans Key app.
  const videoHref = await page.getAttribute('.tl-item.is-current [data-action="video"]', 'href');
  check('student: ▶ Videos is a link to the lesson video page, never the Ans Key app',
    /^watch\.html\?ws=[A-Za-z0-9_-]+&c=[A-Za-z0-9_-]+$/.test(videoHref) && videoHref.includes('ws=' + encodeURIComponent(ws3Id)) &&
    (await page.locator('.tl-item.is-current [data-action="video"]').evaluate((el) => el.tagName)) === 'A', videoHref);
  await page.click('.tl-item.is-current [data-action="video"]', { modifiers: [], trial: true });
  check('student: no Ans Key window opens over the portal for a video', (await page.locator('iframe.anskey-frame').count()) === 0);
  // The teacher records again: the timeline follows without a reload.
  await page.evaluate(([p, at]) => {
    const d = Object.assign({}, window.__fake.db[p]);
    const list = JSON.parse(d.annotations);
    list.push({ id: 'rec-3', type: 'video', page: 1, url: 'https://firebasestorage.googleapis.com/x', ts: at + 3600000, lessonRecording: { version: 1, duration: 60000 } });
    d.annotations = JSON.stringify(list);
    d.updatedAt = { seconds: Math.floor((at + 3600000) / 1000), nanoseconds: 0 };
    window.__fake.seed(p, d);
  }, [ws3, edited]);
  await page.waitForFunction(() => /3 videos/.test((document.querySelector('.tl-item.is-current [data-action="video"]') || {}).textContent || ''));
  check('student: a new recording and edit date appear live', true);
  await page.screenshot({ path: path.join(shots, '04-student.png'), fullPage: true });

  // 🎬📅 The recordings beside the worksheet, by the day of the class.
  const dayChips = await page.$$eval('.tl-item.is-current .tl-day', (els) => els.map((e) => ({ day: e.dataset.day, text: e.textContent })));
  const wantDays = await page.evaluate((at) => [at, at - 86400000].map((ms) => window.PolymathOnlineCore.lessonDayKey(ms)), edited);
  const dayDates = await page.$$eval('.tl-item.is-current .tl-cday-date', (els) => els.map((e) => e.textContent));
  check('student: the lessons are listed beside the worksheet by the day of the class, newest day first',
    dayChips.length === 2 && dayChips[0].day === wantDays[0] && dayChips[1].day === wantDays[1] &&
    /Mon 12 Oct/.test(dayDates[0]) && /Latest/.test(dayDates[0]) && /2 videos/.test(dayChips[0].text) &&
    /Sun 11 Oct/.test(dayDates[1]) && /Video/.test(dayChips[1].text) && /41:00/.test(dayChips[1].text), JSON.stringify([dayChips, dayDates]));
  check('student: a day with no key filed yet says it comes after the lesson', (await page.locator('.tl-item.is-current .tl-cday .tl-cday-none').count()) === 2);
  // Each class day's button opens the same player, starting at that day.
  const dayHrefs = await page.$$eval('.tl-item.is-current .tl-day', (els) => els.map((e) => e.getAttribute('href')));
  check('student: a lesson day opens the video page at that day',
    dayHrefs.length === 2 && dayHrefs[0].includes('&day=' + wantDays[0]) && dayHrefs[1].includes('&day=' + wantDays[1]) && dayHrefs.every((u) => u.startsWith('watch.html?ws=')), JSON.stringify(dayHrefs));
  // Ans Key's filed video page (the printed QR code's) no longer decides what ▶ opens.
  const VP_HASH = 'vp1-812-9a3b4c5d', VP_TOKEN = '7e1d0a3c-1b2c-4d5e-8f90-000000000001';
  await page.evaluate(([p, at, hash, token]) => {
    window.__fake.seed(p, Object.assign({}, window.__fake.db[p], { videoPlaylist: { hash, token, n: 4, at: at + 3700000 } }));
  }, [ws3, edited, VP_HASH, VP_TOKEN]);
  await page.waitForFunction(() => /videos updated/.test((document.querySelector('.tl-item.is-current .tl-sub') || {}).textContent || ''));
  await page.locator('.tl-item.is-current').screenshot({ path: path.join(shots, '04f-student-lesson-days.png') });
  check('student: the worksheet says when its videos were last updated', /videos updated Mon 12 Oct/.test(await page.textContent('.tl-item.is-current .tl-sub')));
  check('student: ▶ still counts the lessons recorded and opens the player', /3 videos/.test(await page.textContent('.tl-item.is-current [data-action="video"]')) &&
    (await page.getAttribute('.tl-item.is-current [data-action="video"]', 'href')).startsWith('watch.html?ws='));

  // 📄 Ans Key files the answer key PDF after each lesson, under the day of the class.
  const keyUrl = (day, token) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
    encodeURIComponent('pdf-annotator/lesson-key-' + ws3Id + '-' + day + '.pdf') + '?alt=media&token=' + token;
  const KEY_OLD = keyUrl(wantDays[1], '11111111-2222-4333-8444-555555555555');
  const KEY_NEW = keyUrl(wantDays[0], '66666666-7777-4888-9999-aaaaaaaaaaaa');
  await page.evaluate(([p, keys]) => {
    window.__fake.seed(p, Object.assign({}, window.__fake.db[p], { answerKeys: keys }));
  }, [ws3, {
    [wantDays[1]]: { url: KEY_OLD, at: edited - 86400000, pages: 4, videos: 1 },
    [wantDays[0]]: { url: KEY_NEW, at: edited, pages: 4, videos: 3 },
    '2020-02-30': { url: KEY_NEW },
    '2026-01-05': { url: 'https://evil.example/key.pdf' }
  }]);
  await page.waitForFunction(() => document.querySelectorAll('.tl-item.is-current .tl-key').length === 2);
  const keyLinks = await page.$$eval('.tl-item.is-current .tl-key', (els) => els.map((e) => ({ href: e.href, target: e.target, text: e.textContent })));
  check('student: each class day has its own answer key PDF, newest first, and junk keys are not shown',
    keyLinks.length === 2 && keyLinks[0].href === KEY_NEW && keyLinks[1].href === KEY_OLD && keyLinks.every((k) => k.target === '_blank' && /Answer key/.test(k.text) && /4 pages/.test(k.text)), JSON.stringify(keyLinks));
  const latestBtn = await page.$eval('.tl-item.is-current .tl-actions a.btn-primary', (a) => ({ href: a.href, text: a.textContent }));
  check('student: the Answer key button opens the newest PDF, not the Ans Key app', latestBtn.href === KEY_NEW && /View · Mon 12 Oct/.test(latestBtn.text), JSON.stringify(latestBtn));
  check('student: the class card\'s answer key is the newest PDF', (await page.getAttribute('.class-cta a', 'href')) === KEY_NEW);
  check('student: no answer key link anywhere points into the Ans Key app',
    (await page.$$eval('.tl-item a, .class-cta a', (els) => els.filter((a) => /\/anskey\/\?ws=/.test(a.getAttribute('href') || '')).length)) === 0);
  await page.locator('.tl-item.is-current').screenshot({ path: path.join(shots, '04g-student-answer-keys.png') });

  /* 🗂 v1.12.0: the three plain tabs for students. */
  await page.click('#st-tab-worksheets');
  await page.waitForSelector('.st-card .st-row');
  const wsRows = await page.$$eval('.st-row .st-name', (els) => els.map((e) => e.textContent));
  check('worksheets tab: this lesson and the ones out ahead first, then the earlier ones, latest first',
    wsRows.join('|') === 'Worksheet 3|Worksheet 4|Worksheet 5|Worksheet 6|Worksheet 7|Worksheet 8|Worksheet 2|Worksheet 1', wsRows.join('|'));
  check('worksheets tab: every row has Download and Print', (await page.locator('.st-row [data-action="download"]').count()) === 8 && (await page.locator('.st-row [data-action="print"]').count()) === 8);
  check('worksheets tab: only worksheets, no videos or answer keys in it',
    (await page.$$eval('#studentPanel a', (els) => els.filter((a) => /watch\.html|lesson-key-/.test(a.getAttribute('href') || '')).length)) === 0 && (await page.locator('.tl-item').count()) === 0);
  check('worksheets tab: this lesson is marked, and the next one says so',
    (await page.textContent('.st-row.is-now .st-name')) === 'Worksheet 3' && /This lesson/.test(await page.textContent('.st-row.is-now')) &&
    /Next lesson/.test(await page.textContent('.st-rows .st-row:nth-child(2)')));
  check('worksheets tab: the locked ones are counted, not named', /2 more worksheets/.test(await page.textContent('.st-foot')) && !(await page.textContent('body')).includes('Worksheet 9'));
  check('worksheets tab: the address goes back to plain /online', (await page.evaluate(() => location.hash)) === '');
  // 📅 v1.16.0: the class day, big, at the top left of the segment, in every tab.
  const bandOf = () => page.$$eval('#studentPanel .day-band', (els) => els.map((e) => ({ day: (e.querySelector('.day-name') || {}).textContent || '', left: Math.round(e.querySelector('.day-badge').getBoundingClientRect().left - e.closest('.card').getBoundingClientRect().left), big: parseFloat(getComputedStyle(e.querySelector('.day-name')).fontSize) })));
  const studentDayUpper = (await page.evaluate(() => { const c = Object.values(window.__fake.db).find((d) => d && Array.isArray(d.worksheetIds)); return String((c && c.day) || '').toUpperCase(); }));
  const wsBand = await bandOf();
  check('day band: the Worksheets tab opens the class with its day, big, at the top left',
    wsBand.length === 1 && (studentDayUpper ? wsBand[0].day === studentDayUpper : wsBand[0].day === 'CLASS') && wsBand[0].left < 40 && wsBand[0].big >= 20, JSON.stringify(wsBand) + ' ' + studentDayUpper);
  await page.screenshot({ path: path.join(shots, '04h-tab-worksheets.png'), fullPage: true });

  await page.click('#st-tab-answers');
  await page.waitForFunction(() => document.querySelector('#st-tab-answers[aria-selected="true"]') && document.querySelector('.st-row'));
  const akRows = await page.$$eval('.st-row', (els) => els.map((e) => ({ name: e.querySelector('.st-name').textContent, main: (e.querySelector('a.st-btn-main') || {}).href || '', more: [...e.querySelectorAll('.st-more a')].map((a) => a.href) })));
  check('answer keys tab: one row per worksheet with a key, opening the newest PDF, earlier days under it',
    akRows.length === 1 && akRows[0].name === 'Worksheet 3' && akRows[0].main === KEY_NEW && akRows[0].more.join() === KEY_OLD, JSON.stringify(akRows));
  check('answer keys tab: the key opens in a new tab, never the Ans Key app',
    (await page.getAttribute('a.st-btn-main', 'target')) === '_blank' && (await page.$$eval('#studentPanel a', (els) => els.filter((a) => /\/anskey\//.test(a.getAttribute('href') || '')).length)) === 0);
  check('answer keys tab: no Download or Print buttons for worksheets here', (await page.locator('#studentPanel [data-action="download"], #studentPanel [data-action="print"]').count()) === 0);
  check('answer keys tab: kept in the address', (await page.evaluate(() => location.hash)) === '#answers');
  check('day band: the Answer keys tab shows the same day band', JSON.stringify(await bandOf()) === JSON.stringify(wsBand));
  await page.screenshot({ path: path.join(shots, '04i-tab-answer-keys.png'), fullPage: true });

  await page.click('#st-tab-videos');
  await page.waitForFunction(() => document.querySelector('#st-tab-videos[aria-selected="true"]') && document.querySelector('.st-row'));
  const vRows = await page.$$eval('.st-row', (els) => els.map((e) => ({ name: e.querySelector('.st-name').textContent, sub: e.querySelector('.st-sub').textContent, watch: e.querySelector('a.st-btn-play').getAttribute('href'), days: e.querySelectorAll('.st-more a').length })));
  check('videos tab: one row per worksheet with videos, Watch opens the lesson video page',
    vRows.length === 1 && vRows[0].name === 'Worksheet 3' && /3 videos/.test(vRows[0].sub) && vRows[0].watch.startsWith('watch.html?ws=' + encodeURIComponent(ws3Id)) && !/anskey/.test(vRows[0].watch), JSON.stringify(vRows));
  check('videos tab: each class day can be started from', vRows[0].days === 2);
  check('day band: the Videos tab shows the same day band', JSON.stringify(await bandOf()) === JSON.stringify(wsBand));
  await page.screenshot({ path: path.join(shots, '04j-tab-videos.png'), fullPage: true });
  await page.click('#st-tab-timeline');
  await page.waitForFunction(() => document.querySelectorAll('.tl-item').length === 8);
  check('day band: the Timeline tab shows the same day band', JSON.stringify(await bandOf()) === JSON.stringify(wsBand));
  check('timeline tab: the full timeline is still there', true);

  // The teacher opens worksheet 5 in Ans Key: the class moves and 9, 10 come out live.
  await page.evaluate(() => {
    const course = Object.entries(window.__fake.db).find(([p]) => p.startsWith('onlineCourses/'));
    window.__fake.seed(course[0], Object.assign({}, course[1], { currentIndex: 4, releasedThrough: 9 }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.tl-item').length === 10);
  check('student: a release made in Ans Key appears without a reload', (await page.$$eval('.next-tile .name', (els) => els.map((e) => e.textContent))).join('|') === 'Worksheet 6|Worksheet 7');
  check('student: the highlight moves to the new current worksheet', (await page.textContent('.tl-item.is-current .tl-name')) === 'Worksheet 5');
  studentDb = await page.evaluate(() => window.__fake.db);
  check('student: no script errors', errors.length === 0);
  if (errors.length) console.log(errors);
  await context.close();
}

/* ---- The same student on a phone ---- */
{
  const { page, context, errors } = await open({ user: { uid: 'stu-1', email: 'ethan.t@gmail.com', displayName: 'Ethan Tan' }, docs: studentDb, width: 390 });
  // 🗂 A student lands on the Worksheets tab.
  await page.waitForSelector('.st-row.is-now');
  check('student phone: lands on the Worksheets tab', (await page.getAttribute('#st-tab-worksheets', 'aria-selected')) === 'true');
  check('student phone: the four tabs fit across the screen', (await page.$$eval('.st-tab', (els) => els.every((e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.height >= 44; }))));
  check('student phone: Download and Print are big and on the screen', (await page.$$eval('.st-row .st-btn', (els) => els.every((e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 0.5 && b.height >= 44; }))));
  check('student phone: the worksheets fit with no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: path.join(shots, '04k-phone-worksheets.png'), fullPage: true });
  // 📅 Scrolled down a long list, the day band stays in view just under the tabs.
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.st-rows .st-row:last-child').getBoundingClientRect().top + window.scrollY - 300));
  await page.waitForTimeout(150);
  const stuck = await page.evaluate(() => { const b = document.querySelector('.day-band').getBoundingClientRect(); const t = document.querySelector('.st-tabs').getBoundingClientRect(); return { band: Math.round(b.top), tabsBottom: Math.round(t.bottom), w: Math.round(b.right) }; });
  check('student phone: the day band stays just under the tabs while scrolling', Math.abs(stuck.band - stuck.tabsBottom) <= 2 && stuck.w <= 390, JSON.stringify(stuck));
  await page.screenshot({ path: path.join(shots, '04n-phone-day-band-stuck.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#st-tab-answers');
  await page.waitForSelector('#st-tab-answers[aria-selected="true"]');
  check('student phone: answer keys fit with no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: path.join(shots, '04l-phone-answer-keys.png'), fullPage: true });
  await page.click('#st-tab-videos');
  await page.waitForSelector('#st-tab-videos[aria-selected="true"]');
  check('student phone: videos fit with no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: path.join(shots, '04m-phone-videos.png'), fullPage: true });
  await page.click('#st-tab-timeline');
  await page.waitForSelector('.tl-item.is-current');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('student phone: the timeline fits with no sideways scroll', !overflow);
  await page.screenshot({ path: path.join(shots, '04d-student-phone.png'), fullPage: true });
  const keyBox = await page.locator('.tl-item .tl-key >> nth=0').boundingBox();
  check('student phone: the day\'s answer key fits on the screen', keyBox && keyBox.x >= 0 && keyBox.x + keyBox.width <= 390);
  check('student phone: no script errors', errors.length === 0);
  await context.close();
}

/* ---- Someone else, on a phone, with no invitation ---- */
{
  const { page, context, errors } = await open({ user: { uid: 'x', email: 'stranger@example.com', displayName: 'Stranger' }, docs: db, width: 390 });
  await page.waitForSelector('.state-card');
  check('stranger: told they have not been invited, nothing else', /not been invited/.test(await page.textContent('.state-card')) && (await page.locator('.class-card, .st-card').count()) === 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('stranger: no sideways scroll at phone width', !overflow);
  await page.screenshot({ path: path.join(shots, '05-no-access-phone.png') });
  check('stranger: no script errors', errors.length === 0);
  await context.close();
}

/* ---- A P6 science student sees no P5 maths ---- */
{
  const docs = JSON.parse(JSON.stringify(db));
  docs['onlineMembers/p6'] = { level: 'P6', subjects: ['science'], role: 'student', name: 'Mei', email: 'mei@example.com' };
  const { page, context, errors } = await open({ user: { uid: 'p6', email: 'mei@example.com', displayName: 'Mei' }, docs, width: 390 });
  await page.waitForSelector('.empty');
  check('another level: no classes, and no worksheet names leak', (await page.locator('.class-card, .st-card').count()) === 0 && !(await page.textContent('body')).includes('Worksheet 1'));
  check('another level: no script errors', errors.length === 0);
  await context.close();
}

/* ---- polymathlc.com.sg/student decides: the approval wins over an older invitation ---- */
{
  const docs = JSON.parse(JSON.stringify(db));
  // An old invitation said P6 Science; the approval says P5 Maths (and a Secondary 1 sibling).
  docs['onlineMembers/fam'] = { level: 'P6', subjects: ['science'], role: 'student', name: 'Wei', email: 'fam@example.com' };
  docs['studentAccess/fam'] = { uid: 'fam', status: 'approved', parentName: 'Mdm Lim', parentEmail: 'lim@example.com', childCount: 2,
    children: [{ name: 'Lim Wei', level: 'P5', subjects: 'math' }, { name: 'Lim Jun', level: 'S1', subjects: 'both' }] };
  const { page, context, errors } = await open({ user: { uid: 'fam', email: 'fam@example.com', displayName: 'Wei' }, docs, width: 390 });
  await page.waitForSelector('.st-card');
  const text = await page.textContent('body');
  check('/student approval: P5 Maths opens although the old invitation said P6 Science', (await page.locator('.st-card').count()) >= 1 && /P5/.test(await page.textContent('.welcome .chips')));
  check('/student approval: no P6 Science chip from the old invitation', !/P6/.test(await page.textContent('.welcome .chips')));
  check('/student approval: no script errors', errors.length === 0 && text.length > 0);
  await context.close();
}
{
  const docs = JSON.parse(JSON.stringify(db));
  // Invited for P5 Maths long ago, but now approved for P5 Science only: the Maths class closes.
  docs['onlineMembers/sci'] = { level: 'P5', subjects: ['math'], role: 'student', name: 'Ana', email: 'sci@example.com' };
  docs['studentAccess/sci'] = { uid: 'sci', status: 'approved', childCount: 1, children: [{ name: 'Ana Goh', level: 'P5', subjects: 'science' }] };
  const { page, context, errors } = await open({ user: { uid: 'sci', email: 'sci@example.com', displayName: 'Ana' }, docs, width: 390 });
  await page.waitForSelector('.empty');
  check('/student approval: a Science-only account no longer sees the P5 Maths class', (await page.locator('.class-card, .st-card').count()) === 0);
  check('/student approval (science only): no script errors', errors.length === 0);
  await context.close();
}
{
  const docs = JSON.parse(JSON.stringify(db));
  docs['onlineMembers/wait'] = { level: 'P5', subjects: ['math'], role: 'student', name: 'Kai', email: 'wait@example.com' };
  docs['studentAccess/wait'] = { uid: 'wait', status: 'pending', childCount: 1, children: [{ name: 'Kai Ong', level: 'P5', subjects: 'math' }] };
  const { page, context, errors } = await open({ user: { uid: 'wait', email: 'wait@example.com', displayName: 'Kai' }, docs, width: 390 });
  await page.waitForSelector('.state-card');
  check('/student approval: an account still waiting sees no classes, and is told why', /Waiting for approval/.test(await page.textContent('.state-card')) && (await page.locator('.class-card, .st-card').count()) === 0);
  check('/student approval (waiting): no script errors', errors.length === 0);
  await context.close();
}

/* ---- Admin: duplicate a class for another time slot ---- */
{
  const docs = JSON.parse(JSON.stringify(db));
  const [coursePath, original] = Object.entries(docs).find(([p]) => p.startsWith('onlineCourses/'));
  const firstId = original.worksheetIds[0];
  docs['pdfAnnotator/' + firstId].annotations = JSON.stringify([
    { id: 'ink-1', type: 'pen', page: 1, points: [[1, 1], [2, 2]] },
    { id: 'rec-1', type: 'video', page: 1, url: 'https://example.invalid/lesson.m4a', lessonRecording: { version: 1, duration: 60000 } }
  ]);
  const { page, context, errors } = await open({ user: admin, docs });
  await page.waitForSelector('.tabs');
  await page.click('[data-action="open-course"] >> nth=0');
  await page.waitForSelector('[data-action="duplicate-course"]');
  check('duplicate: a Duplicate class button sits beside Edit class', await page.locator('[data-action="duplicate-course"]').isVisible());
  await page.click('[data-action="duplicate-course"]');
  await page.waitForSelector('.modal [data-m="go"]');
  const ask = await page.textContent('.modal');
  check('duplicate: the window says what is kept and what is not', /all 10 worksheets/.test(ask) && /no day or time/.test(ask) && /nothing released/.test(ask) && /recordings stay/.test(ask));
  await page.screenshot({ path: path.join(shots, '10-duplicate-ask.png') });
  await page.click('.modal [data-m="go"]');
  await page.waitForSelector('.modal #courseTitle', { timeout: 20000 });
  check('duplicate: it goes straight on to choosing the time slot', /Edit class/.test(await page.textContent('.modal .eyebrow')));
  const after = await page.evaluate(() => window.__fake.db);
  const courses = Object.entries(after).filter(([p]) => p.startsWith('onlineCourses/'));
  const [copyPath, copy] = courses.find(([p]) => p !== coursePath);
  const copyId = copyPath.split('/')[1];
  check('duplicate: a second class with the same level and subject', courses.length === 2 && copy.level === original.level && copy.subject === original.subject);
  check('duplicate: the copy has no day or time, and its name is just level and subject', copy.day === '' && copy.slot === null && copy.title === 'P5 Mathematics');
  check('duplicate: the copy is not started and releases nothing', copy.currentIndex === -1 && copy.releasedThrough === -1);
  check('duplicate: the original class is untouched', JSON.stringify(after[coursePath].worksheetIds) === JSON.stringify(original.worksheetIds) && after[coursePath].releasedThrough === original.releasedThrough);
  const copies = copy.worksheetIds.map((id) => after['pdfAnnotator/' + id]);
  check('duplicate: all 10 worksheets are copied, in the same order, as new worksheets', copy.worksheetIds.length === 10 &&
    copy.worksheetIds.every((id) => original.worksheetIds.indexOf(id) < 0) &&
    copies.map((d) => d.name).join('|') === original.worksheetIds.map((id) => docs['pdfAnnotator/' + id].name).join('|'));
  check('duplicate: each copy belongs to the new class, in its place', copies.every((d, i) => d.onlineCourseId === copyId && d.onlineSeq === i));
  check('duplicate: each copy has its own PDF file', copy.worksheetIds.every((id) => after['pdfAnnotator/' + id].storagePath === 'pdf-annotator/' + id + '.pdf') &&
    await page.evaluate((ids) => ids.every((id) => !!window.__fake.files['pdf-annotator/' + id + '.pdf']), copy.worksheetIds));
  const copiedKey = JSON.parse(copies[0].annotations);
  check('duplicate: the answer key is copied, the lesson recording is not', copiedKey.length === 1 && copiedKey[0].id === 'ink-1');
  check('duplicate: the copies have no day or time yet', copies.every((d) => d.wsDay === '' && d.wsSlot === null && d.hidden === false));
  // Choosing the time slot names the class and refiles every copied worksheet.
  await page.click('.modal [data-m="day"][data-v="Thursday"]');
  await page.click('.modal [data-m="slot"][data-v="0"]');
  const title = await page.inputValue('#courseTitle');
  check('duplicate: choosing a day names the class after it', /^P5 Mathematics · Thursday/.test(title));
  await page.click('.modal [data-m="save"]');
  await page.waitForFunction((id) => { const d = window.__fake.db['onlineCourses/' + id]; return d && d.day === 'Thursday'; }, copyId);
  await page.waitForFunction((id) => { const c = window.__fake.db['onlineCourses/' + id]; return c.worksheetIds.every((w) => window.__fake.db['pdfAnnotator/' + w].wsDay === 'Thursday'); }, copyId);
  const final = await page.evaluate(() => window.__fake.db);
  check('duplicate: setting the time slot refiles all the copied worksheets at once', final['onlineCourses/' + copyId].worksheetIds.every((w) => final['pdfAnnotator/' + w].wsDay === 'Thursday' && final['pdfAnnotator/' + w].wsSlot === 0));
  check('duplicate: the original worksheets keep their own day', original.worksheetIds.every((w) => final['pdfAnnotator/' + w].wsDay === docs['pdfAnnotator/' + w].wsDay));
  await page.screenshot({ path: path.join(shots, '11-duplicate-done.png') });
  check('duplicate: no script errors', errors.length === 0 || (console.log(errors), false));
  await context.close();
}

/* ---- Admin: replace one worksheet's PDF (fixing a mistake) ---- */
{
  const docs = JSON.parse(JSON.stringify(db));
  const [coursePath, original] = Object.entries(docs).find(([p]) => p.startsWith('onlineCourses/'));
  const courseId = coursePath.split('/')[1];
  const thirdId = original.worksheetIds[2];
  const key = JSON.stringify([{ id: 'ink-3', type: 'pen', page: 2, points: [[1, 1], [2, 2]] }]);
  docs['pdfAnnotator/' + thirdId].annotations = key;
  docs['pdfAnnotator/' + thirdId].pageCount = 4;
  // The same worksheet copied into a Saturday class by Duplicate class.
  docs['onlineCourses/sat'] = { title: 'P5 Mathematics · Saturday', level: 'P5', subject: 'math', day: 'Saturday', slot: 0, worksheetIds: ['copy3'], currentIndex: -1, releasedThrough: -1 };
  docs['pdfAnnotator/copy3'] = { name: 'Worksheet 3', level: 'P5', subject: 'math', storagePath: 'pdf-annotator/copy3.pdf', pageCount: 4, annotations: key, onlineCourseId: 'sat', onlineSeq: 0, onlineCopiedFrom: thirdId };
  const { page, context, errors } = await open({ user: admin, docs });
  await page.waitForSelector('.tabs');
  await page.click(`[data-action="open-course"][data-id="${courseId}"]`);
  await page.waitForSelector(`[data-action="replace-pdf"][data-id="${thirdId}"]`);
  check('replace: every worksheet row has a Replace button', (await page.locator('.seq-row [data-action="replace-pdf"]').count()) === 10);
  await page.click(`[data-action="replace-pdf"][data-id="${thirdId}"]`);
  await page.waitForSelector('.modal #replaceInput', { state: 'attached' });
  const ask = await page.textContent('.modal');
  check('replace: the window says the answer key, name and place stay', /answer key, name and place in the class stay/.test(ask) && /worksheet 3 in this class/.test(ask));
  check('replace: nothing happens until a PDF is chosen', await page.locator('.modal [data-m="replace"]').isDisabled());
  await page.waitForSelector('.modal .replace-copy');
  check('replace: the copy in the Saturday class is found and ticked', /P5 Mathematics · Saturday · worksheet 1/.test(await page.textContent('.modal .replace-copies')) &&
    await page.locator('.modal [data-copy="copy3"]').isChecked());
  await page.setInputFiles('#replaceInput', { name: 'Worksheet 3 fixed.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('.modal .replace-warn');
  check('replace: a different page count is pointed out', /new PDF has 3 pages and the old one 4 pages/.test(await page.textContent('.modal .replace-warn')));
  check('replace: the chosen file is named, and the button counts both worksheets', /Worksheet 3 fixed\.pdf/.test(await page.textContent('.modal .replace-drop')) &&
    (await page.textContent('.modal [data-m="replace"]')).trim() === 'Replace in 2 worksheets');
  await page.screenshot({ path: path.join(shots, '12-replace-ask.png') });
  await page.click('.modal [data-m="replace"]');
  await page.waitForSelector('.modal-back', { state: 'detached', timeout: 10000 });
  const after = await page.evaluate(() => ({ db: window.__fake.db, files: window.__fake.files }));
  const a = after.db['pdfAnnotator/' + thirdId], b = after.db['pdfAnnotator/copy3'];
  check('replace: the new file goes to the same place, in this class and the copy', after.files[a.storagePath].name === 'Worksheet 3 fixed.pdf' && a.storagePath === docs['pdfAnnotator/' + thirdId].storagePath &&
    after.files['pdf-annotator/copy3.pdf'].name === 'Worksheet 3 fixed.pdf' && b.storagePath === 'pdf-annotator/copy3.pdf');
  check('replace: both carry the same new pdfVersion, so Ans Key and students fetch the new file', a.pdfVersion > 0 && a.pdfVersion === b.pdfVersion);
  check('replace: the answer keys, names and classes are untouched', a.annotations === key && b.annotations === key && a.name === docs['pdfAnnotator/' + thirdId].name && a.onlineCourseId === courseId && b.onlineCourseId === 'sat');
  check('replace: the page count follows the new file', a.pageCount === 3 && b.pageCount === 3);
  check('replace: the class list and release are unchanged', JSON.stringify(after.db[coursePath].worksheetIds) === JSON.stringify(original.worksheetIds) && after.db[coursePath].releasedThrough === original.releasedThrough);
  check('replace: no other worksheet changes', original.worksheetIds.filter((w) => w !== thirdId).every((w) => !after.db['pdfAnnotator/' + w].pdfVersion));
  check('replace: a message says it is done', /PDF replaced in 2 worksheets/.test(await page.textContent('body')));
  // Again, this class only.
  await page.click(`[data-action="replace-pdf"][data-id="${thirdId}"]`);
  await page.waitForSelector('.modal [data-copy="copy3"]');
  await page.click('.modal [data-copy="copy3"]');
  await page.setInputFiles('#replaceInput', { name: 'Worksheet 3 v3.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => { const b = document.querySelector('.modal [data-m="replace"]'); return b && !b.disabled; });
  check('replace: unticking the copy leaves one worksheet', (await page.textContent('.modal [data-m="replace"]')).trim() === 'Replace PDF');
  await page.click('.modal [data-m="replace"]');
  await page.waitForSelector('.modal-back', { state: 'detached', timeout: 10000 });
  const last = await page.evaluate(() => ({ db: window.__fake.db, files: window.__fake.files }));
  check('replace: only this class gets the newer file', last.files[a.storagePath].name === 'Worksheet 3 v3.pdf' && last.files['pdf-annotator/copy3.pdf'].name === 'Worksheet 3 fixed.pdf' &&
    last.db['pdfAnnotator/' + thirdId].pdfVersion > a.pdfVersion && last.db['pdfAnnotator/copy3'].pdfVersion === b.pdfVersion);
  check('replace: no script errors', errors.length === 0 || (console.log(errors), false));
  await context.close();
  // On a phone the row's buttons wrap instead of running off the screen.
  const phone = await open({ user: admin, docs, width: 390 });
  await phone.page.waitForSelector('.tabs');
  await phone.page.click(`[data-action="open-course"][data-id="${courseId}"]`);
  await phone.page.waitForSelector(`[data-action="replace-pdf"][data-id="${thirdId}"]`);
  check('replace: on a phone the Replace button is on screen and the page does not scroll sideways', await phone.page.evaluate((id) => {
    const r = document.querySelector('[data-action="replace-pdf"][data-id="' + id + '"]').getBoundingClientRect();
    return r.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth + 1;
  }, thirdId));
  await phone.page.locator('.seq-list').screenshot({ path: path.join(shots, '13-replace-phone.png') });
  await phone.context.close();
}

/* ---- Admin: 📂 Browse Ans Key app — previous and future worksheets, answer keys and videos ---- */
{
  const T = '0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b';
  const keyUrl = (id, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
    encodeURIComponent('pdf-annotator/lesson-key-' + id + '-' + day + '.pdf') + '?alt=media&token=' + T;
  const pen = (id) => ({ id, type: 'pen', page: 1, points: [[1, 1], [2, 2]] });
  const lesson = (id) => ({ id, type: 'video', url: 'https://a/' + id + '.m4a', ts: 1762000000000, lessonRecording: { version: 1, duration: 600000, title: 'Q' + id } });
  const ws = (id, name, extra) => Object.assign({ name, level: 'P5', subject: 'math', storagePath: 'pdf-annotator/seed-' + id + '.pdf', pageCount: 2, annotations: '' }, extra || {});
  const docs = {
    'onlineCourses/tue': { title: 'P5 Mathematics · Tuesday 5:00pm', level: 'P5', subject: 'math', day: 'Tuesday', slot: 1, worksheetIds: ['c1', 'c2', 'c3', 'c4'], currentIndex: 1, releasedThrough: 3 },
    'pdfAnnotator/c1': ws('c1', 'Term 4 · WS 1', { onlineCourseId: 'tue', onlineSeq: 0, wsDay: 'Tuesday', wsSlot: 1 }),
    'pdfAnnotator/c2': ws('c2', 'Term 4 · WS 2', { onlineCourseId: 'tue', onlineSeq: 1, wsDay: 'Tuesday', wsSlot: 1 }),
    'pdfAnnotator/c3': ws('c3', 'Term 4 · WS 3', { onlineCourseId: 'tue', onlineSeq: 2, wsDay: 'Tuesday', wsSlot: 1, annotations: JSON.stringify([pen('mine'), lesson('own')]) }),
    'pdfAnnotator/c4': ws('c4', 'Term 4 · WS 4', { onlineCourseId: 'tue', onlineSeq: 3, wsDay: 'Tuesday', wsSlot: 1 }),
    // The Ans Key library: a taught worksheet with answers, two lessons and a key PDF…
    'pdfAnnotator/L1': ws('L1', 'Ratio warm-up', { wsDay: 'Monday', wsDate: '2026-10-05', annotations: JSON.stringify([pen('a1'), pen('a2'), lesson('v1'), lesson('v2')]),
      answerKeys: { '2026-10-05': { url: keyUrl('L1', '2026-10-05'), pages: 2 } } }),
    // …one already in another class (so it is copied, never moved)…
    'onlineCourses/mon': { title: 'P5 Mathematics · Monday 3:00pm', level: 'P5', subject: 'math', day: 'Monday', slot: 0, worksheetIds: ['L2'], currentIndex: 0, releasedThrough: 0 },
    'pdfAnnotator/L2': ws('L2', 'Fractions review', { wsDay: 'Monday', wsDate: '2026-10-12', onlineCourseId: 'mon', onlineSeq: 0, annotations: JSON.stringify([pen('b1'), lesson('v3')]) }),
    // …a blank one, and one for another level.
    'pdfAnnotator/L3': ws('L3', 'Speed practice', { wsDay: 'Monday', wsDate: '2026-10-19' }),
    'pdfAnnotator/L4': ws('L4', 'P6 Algebra', { level: 'P6', wsDate: '2026-10-26' })
  };
  const { page, context, errors } = await open({ user: admin, docs });
  await page.waitForSelector('.tabs');
  await page.click('[data-action="open-course"][data-id="tue"]');
  await page.waitForSelector('[data-action="browse-anskey"]');
  check('browse: the class has a Browse Ans Key app button', /Browse Ans Key app/.test(await page.textContent('[data-action="browse-anskey"]')));
  await page.click('[data-action="browse-anskey"]');
  await page.waitForSelector('.modal .lib-row');
  const rows = async () => page.$$eval('.modal .lib-row .lib-name', (els) => els.map((e) => e.textContent));
  let names = await rows();
  check('browse: it lists the class level and subject, newest first, not what the class already has', names.join('|') === 'Speed practice|Fractions review|Ratio warm-up');
  const l1 = await page.textContent('.modal .lib-row:has([data-pick="L1"])');
  check('browse: each worksheet says what it carries', /Answer key/.test(l1) && /2 videos/.test(l1) && /1 key PDF/.test(l1));
  check('browse: one in another class says so', /In P5 Mathematics · Monday 3:00pm/.test(await page.textContent('.modal .lib-row:has([data-pick="L2"])')));
  await page.fill('#libSearch', 'ratio');
  await page.waitForFunction(() => document.querySelectorAll('.modal .lib-row').length === 1);
  check('browse: the search narrows the list as it is typed, and keeps the caret', (await rows()).join() === 'Ratio warm-up' && await page.evaluate(() => document.activeElement && document.activeElement.id === 'libSearch'));
  await page.fill('#libSearch', '');
  await page.waitForFunction(() => document.querySelectorAll('.modal .lib-row').length === 3);
  await page.click('.modal [data-m="scope"][data-v="all"]');
  await page.waitForFunction(() => document.querySelectorAll('.modal .lib-row').length === 4);
  check('browse: All levels shows the rest of Ans Key too', (await rows()).includes('P6 Algebra'));
  await page.click('.modal [data-m="scope"][data-v="class"]');
  await page.waitForFunction(() => document.querySelectorAll('.modal .lib-row').length === 3);
  check('browse: nothing can be added before something is ticked', await page.locator('.modal [data-m="add"]').isDisabled());

  // Two lessons the class has already had: L1 (whole) and L2 (from the Monday class).
  await page.click('.modal [data-m="mode"][data-v="previous"]');
  await page.check('.modal [data-pick="L1"]');
  await page.check('.modal [data-pick="L2"]');
  check('browse: the ticks are numbered in order, as previous worksheets', /Previous #1/.test(await page.textContent('.modal .lib-row:has([data-pick="L1"])')) && /Previous #2/.test(await page.textContent('.modal .lib-row:has([data-pick="L2"])')));
  check('browse: it says where previous worksheets go', /Before worksheet 2 \(the current worksheet\), done and released/.test(await page.textContent('.modal .lib-where')));
  check('browse: the button says what will happen', (await page.textContent('.modal [data-m="add"]')).trim() === 'Add 2 as previous worksheets');
  await page.screenshot({ path: path.join(shots, '14-browse-anskey.png') });
  await page.click('.modal [data-m="add"]');
  await page.waitForSelector('.modal-back', { state: 'detached', timeout: 10000 });
  let fake = await page.evaluate(() => window.__fake.db);
  let cls = fake['onlineCourses/tue'];
  const copyId = cls.worksheetIds[2];
  check('browse: previous worksheets go before the current one, in the order ticked', cls.worksheetIds[0] === 'c1' && cls.worksheetIds[1] === 'L1' && copyId !== 'L2' && cls.worksheetIds[3] === 'c2' && cls.worksheetIds.length === 6);
  check('browse: the class stays on its worksheet, and they are done and released', cls.currentDocId === 'c2' && cls.currentIndex === 3 && cls.releasedThrough === 5);
  const L1 = fake['pdfAnnotator/L1'], copy = fake['pdfAnnotator/' + copyId];
  check('browse: a worksheet in no class joins as it is, filed under the class lesson', L1.onlineCourseId === 'tue' && L1.onlineSeq === 1 && L1.wsDay === 'Tuesday' && L1.wsSlot === 1 && JSON.parse(L1.annotations).length === 4);
  check('browse: one in another class is copied with its answer key and videos', copy.onlineCopiedFrom === 'L2' && copy.onlineCourseId === 'tue' && copy.wsDay === 'Tuesday' &&
    JSON.parse(copy.annotations).map((x) => x.id).join() === 'b1,v3');
  check('browse: the other class keeps its worksheet', fake['pdfAnnotator/L2'].onlineCourseId === 'mon' && JSON.stringify(fake['onlineCourses/mon'].worksheetIds) === '["L2"]');
  await page.waitForFunction(() => document.querySelectorAll('.seq-row').length === 6, null, { timeout: 5000 });
  const labels = await page.$$eval('.seq-row .seq-status', (els) => els.map((e) => e.textContent.trim()));
  check('browse: the teaching order shows them as done, before the current worksheet', labels[1] === '✓ Done' && labels[2] === '✓ Done' && labels[3] === '▶ Current worksheet');

  // A future one, without its videos: copied, answers only.
  await page.click('[data-action="browse-anskey"]');
  await page.waitForSelector('.modal .lib-row');
  check('browse: what was added (or copied) is gone from the list', (await rows()).join('|') === 'Speed practice');
  await page.click('.modal [data-m="scope"][data-v="all"]');
  await page.waitForFunction(() => document.querySelectorAll('.modal .lib-row').length === 2);
  await page.check('.modal [data-pick="L4"]');
  await page.uncheck('.modal [data-bring="videos"]');
  check('browse: it says where future worksheets go', /After worksheet 6, at the end/.test(await page.textContent('.modal .lib-where')));
  await page.click('.modal [data-m="add"]');
  await page.waitForSelector('.modal-back', { state: 'detached', timeout: 10000 });
  fake = await page.evaluate(() => window.__fake.db);
  cls = fake['onlineCourses/tue'];
  check('browse: a future worksheet goes at the end and the class does not move', cls.worksheetIds.length === 7 && cls.worksheetIds[6] === 'L4' && cls.currentDocId === 'c2' && cls.releasedThrough === 5);
  check('browse: a blank worksheet in no class joins as it is', fake['pdfAnnotator/L4'].onlineCourseId === 'tue' && fake['pdfAnnotator/L4'].onlineSeq === 6);

  // 📂 From Ans Key on a row: worksheet 5 (c3) takes L1's answer key and videos.
  await page.click('[data-action="link-anskey"][data-id="c3"]');
  await page.waitForSelector('.modal .lib-row');
  check('from Ans Key: only worksheets with answers or videos to give are listed', !(await rows()).includes('Speed practice') && (await rows()).includes('Ratio warm-up'));
  check('from Ans Key: nothing happens before one is chosen', await page.locator('.modal [data-m="use"]').isDisabled());
  await page.check('.modal [data-source="L1"]');
  check('from Ans Key: the button says what comes across', (await page.textContent('.modal [data-m="use"]')).trim() === 'Use answer key · 1 answer key PDF · 2 videos');
  await page.screenshot({ path: path.join(shots, '15-from-anskey.png') });
  await page.click('.modal [data-m="use"]');
  await page.waitForSelector('.modal-back', { state: 'detached', timeout: 10000 });
  fake = await page.evaluate(() => window.__fake.db);
  const c3 = fake['pdfAnnotator/c3'];
  check('from Ans Key: the answer key replaces its writing and the videos join its own', JSON.parse(c3.annotations).map((x) => x.id).join() === 'a1,a2,own,v1,v2');
  check('from Ans Key: the answer key PDFs come too, and it remembers where from', c3.answerKeys && c3.answerKeys['2026-10-05'] && c3.onlineAnswersFrom === 'L1' && c3.onlineVideosFrom === 'L1');
  check('from Ans Key: the source is untouched', JSON.parse(fake['pdfAnnotator/L1'].annotations).length === 4);
  check('from Ans Key: a message says what came across', /now uses its answer key and 2 videos from “Ratio warm-up”/.test(await page.textContent('body')));
  check('browse: no script errors', errors.length === 0 || (console.log(errors), false));
  await context.close();

  // On a phone the window fits.
  const phone = await open({ user: admin, docs, width: 390 });
  await phone.page.waitForSelector('.tabs');
  await phone.page.click('[data-action="open-course"][data-id="tue"]');
  await phone.page.click('[data-action="browse-anskey"]');
  await phone.page.waitForSelector('.modal .lib-row');
  check('browse: on a phone the window does not scroll sideways', await phone.page.evaluate(() => {
    const m = document.querySelector('.modal').getBoundingClientRect();
    return m.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
  }));
  await phone.page.screenshot({ path: path.join(shots, '16-browse-phone.png') });
  check('browse: no script errors on a phone', phone.errors.length === 0);
  await phone.context.close();
}

/* ---- 🗄 v1.13.0: archive items for students, restore with one tap ---- */
{
  const docs = JSON.parse(JSON.stringify(studentDb));
  const [coursePath, course0] = Object.entries(docs).find(([p]) => p.startsWith('onlineCourses/'));
  const ws2 = course0.worksheetIds[1], ws3 = course0.worksheetIds[2];
  const before = { cur: course0.currentIndex, rel: course0.releasedThrough, ids: course0.worksheetIds.join() };
  const { page, context, errors } = await open({ user: admin, docs });
  await page.waitForSelector('.tabs');
  await page.click('[data-action="open-course"] >> nth=0');
  await page.waitForSelector('#archivedSection');
  check('archive: the class shows an empty Archived section to begin with', /Nothing archived in this class/.test(await page.textContent('#archivedSection')));
  await page.click('.seq-row:nth-child(2) [data-action="archive-item"]');
  await page.waitForSelector('.seq-row.is-archived');
  let now = await page.evaluate((p) => window.__fake.db[p], coursePath);
  check('archive: Archive on worksheet 2 stores it on the class, nothing else changes',
    JSON.stringify(now.archivedWorksheets) === JSON.stringify([ws2]) && now.currentIndex === before.cur && now.releasedThrough === before.rel && now.worksheetIds.join() === before.ids);
  check('archive: the row says Archived and offers Restore', /Archived/.test(await page.textContent('.seq-row.is-archived')) && (await page.locator('.seq-row.is-archived [data-action="restore-item"]').count()) === 1);
  check('archive: the Archived section lists it with Restore', /Worksheet 2/.test(await page.textContent('#archivedSection')) && (await page.locator('#archivedSection [data-action="restore-item"]').count()) === 1);
  check('archive: the worksheet itself is untouched (not deleted, not hidden in Ans Key)', !!(await page.evaluate((id) => window.__fake.db['pdfAnnotator/' + id], ws2)) && !(await page.evaluate((id) => window.__fake.db['pdfAnnotator/' + id].hidden, ws2)));
  await page.screenshot({ path: path.join(shots, '17-archive-class.png'), fullPage: true });

  // 👁 Preview as a student, Timeline tab: archive one class day there.
  await page.click('[data-action="preview-course"]');
  await page.click('#st-tab-timeline');
  await page.waitForSelector('.tl-item');
  check('archive: the preview timeline no longer shows worksheet 2', !(await page.$$eval('.tl-item .tl-name', (els) => els.map((e) => e.textContent))).includes('Worksheet 2'));
  const ws3Item = page.locator('.tl-item', { has: page.locator('.tl-name', { hasText: /^Worksheet 3$/ }) });
  check('archive: each worksheet and each class day has Archive for the admin', (await ws3Item.locator('[data-action="archive-item"][data-kind="worksheet"]').count()) === 1 && (await ws3Item.locator('[data-action="archive-item"][data-kind="day"]').count()) === 2);
  const oldDay = await ws3Item.locator('[data-action="archive-item"][data-kind="day"]').nth(1).getAttribute('data-day');
  await ws3Item.locator('[data-action="archive-item"][data-kind="day"]').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.tl-item .tl-cday').length === 1);
  now = await page.evaluate((p) => window.__fake.db[p], coursePath);
  check('archive: one class day is archived on its own', JSON.stringify(now.archivedDays) === JSON.stringify([ws3 + '|' + oldDay]));
  check('archive: the timeline keeps an admin-only Archived fold with both items', /Archived · 2 hidden/.test(await page.textContent('.arch-fold summary')));
  await page.click('.arch-fold summary');
  await page.locator('.class-card').screenshot({ path: path.join(shots, '18-archive-preview-timeline.png') });
  check('archive (admin): no script errors', errors.length === 0 || (console.log(errors), false));
  const archivedDb = await page.evaluate(() => window.__fake.db);
  await context.close();

  // The student: worksheet 2 and that day's video + answer key are gone everywhere.
  const stu = await open({ user: { uid: 'stu-1', email: 'ethan.t@gmail.com', displayName: 'Ethan Tan' }, docs: archivedDb, query: '#timeline', width: 1100 });
  await stu.page.waitForSelector('.tl-item');
  const names = await stu.page.$$eval('.tl-item .tl-name', (els) => els.map((e) => e.textContent));
  check('archive (student): the timeline skips the archived worksheet and keeps the numbers', !names.includes('Worksheet 2') && names[0] === 'Worksheet 1' && names[1] === 'Worksheet 3' &&
    (await stu.page.$$eval('.tl-item .tl-node', (els) => els.map((e) => e.textContent))).slice(0, 2).join() === '1,3');
  check('archive (student): the class is still on worksheet 5 with the same next two', (await stu.page.textContent('.tl-item.is-current .tl-name')) === 'Worksheet 5' &&
    (await stu.page.$$eval('.next-tile .name', (els) => els.map((e) => e.textContent))).join('|') === 'Worksheet 6|Worksheet 7');
  const s3 = stu.page.locator('.tl-item', { has: stu.page.locator('.tl-name', { hasText: /^Worksheet 3$/ }) });
  check('archive (student): the archived class day is gone, the other day stays', (await s3.locator('.tl-cday').count()) === 1 && !(await s3.locator('.tl-day').getAttribute('href')).includes(oldDay));
  check('archive (student): no Archive buttons or Archived list for a student', (await stu.page.locator('[data-action="archive-item"], [data-action="restore-item"], .arch-fold').count()) === 0);
  await stu.page.click('#st-tab-worksheets');
  await stu.page.waitForSelector('.st-row');
  check('archive (student): Worksheets tab leaves it out', !(await stu.page.$$eval('.st-row .st-name', (els) => els.map((e) => e.textContent))).includes('Worksheet 2'));
  await stu.page.click('#st-tab-answers');
  await stu.page.waitForFunction(() => document.querySelector('#st-tab-answers[aria-selected="true"]'));
  const ak = await stu.page.$$eval('.st-row', (els) => els.map((e) => ({ name: e.querySelector('.st-name').textContent, more: e.querySelectorAll('.st-more a').length })));
  const ak3 = ak.find((r) => r.name === 'Worksheet 3');
  check('archive (student): Answer keys tab drops the archived day\'s key', ak3 && ak3.more === 0, JSON.stringify(ak));
  await stu.page.click('#st-tab-videos');
  await stu.page.waitForFunction(() => document.querySelector('#st-tab-videos[aria-selected="true"]'));
  const v3 = await stu.page.$$eval('.st-row', (els) => els.map((e) => ({ name: e.querySelector('.st-name').textContent, sub: e.querySelector('.st-sub').textContent })).find((r) => r.name === 'Worksheet 3'));
  check('archive (student): Videos tab counts only the videos still shown', v3 && /2 videos/.test(v3.sub), JSON.stringify(v3));
  check('archive (student): no script errors', stu.errors.length === 0 || (console.log(stu.errors), false));
  await stu.context.close();

  // Restore: one tap in the class's Archived list puts it back as it was.
  const back = await open({ user: admin, docs: archivedDb });
  await back.page.waitForSelector('.tabs');
  await back.page.click('[data-action="open-course"] >> nth=0');
  await back.page.waitForSelector('#archivedSection [data-action="restore-item"]');
  await back.page.click('#archivedSection [data-action="restore-item"][data-kind="worksheet"]');
  await back.page.waitForFunction(() => !document.querySelector('.seq-row.is-archived'));
  await back.page.click('#archivedSection [data-action="restore-item"][data-kind="day"]');
  await back.page.waitForFunction(() => /Nothing archived/.test(document.querySelector('#archivedSection').textContent));
  now = await back.page.evaluate((p) => window.__fake.db[p], coursePath);
  check('restore: both lists are empty again and the class is where it was', now.archivedWorksheets.length === 0 && now.archivedDays.length === 0 && now.currentIndex === before.cur && now.releasedThrough === before.rel);
  check('restore: no script errors', back.errors.length === 0 || (console.log(back.errors), false));
  await back.context.close();
}

/* ---- 🔗 v1.17.0: one class's answer keys and videos for the other classes ----
   Zhi Kai, 16 Nov 2026: Monday 7pm P6 Science had the videos of the two P5
   Science revision worksheets; Tuesday and Saturday, doing the same
   worksheets, showed "No lesson videos yet". */
{
  const T = '0b5e4a5c-1f6c-4c1e-9a7e-2c1d3e4f5a6b';
  const keyUrl = (id, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
    encodeURIComponent('pdf-annotator/lesson-key-' + id + '-' + day + '.pdf') + '?alt=media&token=' + T;
  const lesson = (id, iso) => ({ id, type: 'video', url: 'https://a/' + id + '.webm', ts: Date.parse(iso + '+08:00'), lessonRecording: { version: 1, video: true, duration: 2400000, title: 'Lesson' } });
  const ws = (id, name, extra) => Object.assign({ name, level: 'P6', subject: 'science', storagePath: 'pdf-annotator/seed-' + id + '.pdf', pageCount: 6, annotations: '' }, extra || {});
  const cls = (day, slot, ids, cur, extra) => Object.assign({ level: 'P6', subject: 'science', day, slot, worksheetIds: ids, currentIndex: cur, releasedThrough: ids.length - 1 }, extra || {});
  const docs = {
    'onlineCourses/mon': cls('Monday', 2, ['m1', 'm2', 'm3'], 2),
    'onlineCourses/tue': cls('Tuesday', 1, ['t1', 't2', 't3'], 2),
    'onlineCourses/sat': cls('Saturday', 0, ['s1'], 1, { releasedThrough: 0 }),
    'pdfAnnotator/m1': ws('m1', 'P5 Science November WS 1 - Revision', { onlineCourseId: 'mon', annotations: JSON.stringify([lesson('a1', '2026-11-02T19:30:00'), lesson('a2', '2026-11-09T19:30:00')]),
      answerKeys: { '2026-11-09': { url: keyUrl('m1', '2026-11-09'), pages: 6 } } }),
    'pdfAnnotator/m2': ws('m2', 'P5 Science November Worksheet 2 - Revision', { onlineCourseId: 'mon', annotations: JSON.stringify([lesson('b1', '2026-11-07T09:30:00'), lesson('b2', '2026-11-14T09:30:00'), lesson('b3', '2026-11-14T10:10:00')]) }),
    'pdfAnnotator/m3': ws('m3', 'P6 Science Worksheet 1', { onlineCourseId: 'mon' }),
    'pdfAnnotator/t1': ws('t1', 'P5 Science November WS 1 - Revision', { onlineCourseId: 'tue', onlineCopiedFrom: 'm1' }),
    'pdfAnnotator/t2': ws('t2', 'P5 Science November Worksheet 2 - Revision', { onlineCourseId: 'tue' }),
    'pdfAnnotator/t3': ws('t3', 'P6 Science Worksheet 1', { onlineCourseId: 'tue' }),
    'pdfAnnotator/s1': ws('s1', 'P6 Science Worksheet 1', { onlineCourseId: 'sat' }),
    'onlineMembers/p6s': { level: 'P6', subjects: ['science'], role: 'student', name: 'Mei', email: 'mei@example.com' }
  };
  // Before: Tuesday's student has no videos, as in Zhi Kai's screenshot.
  const student = { uid: 'p6s', email: 'mei@example.com', displayName: 'Mei' };
  let stu = await open({ user: student, docs, query: '#videos', width: 1100 });
  await stu.page.waitForSelector('.st-card');
  const tueCard = () => stu.page.locator('.st-card', { has: stu.page.locator('.day-band', { hasText: /TUESDAY/ }) });
  check('share (before): Tuesday has no lesson videos', /No lesson videos yet/.test(await tueCard().textContent()));
  await stu.context.close();

  // The admin turns it on in Tuesday's class page.
  const { page, context, errors } = await open({ user: admin, docs, width: 1180 });
  await page.waitForSelector('.tabs');
  await page.click('[data-action="open-course"][data-id="tue"]');
  await page.waitForSelector('#shareSection');
  check('share: the class page has a Shared answer keys and videos section', /Shared answer keys and videos/.test(await page.textContent('#shareSection')));
  check('share: the same level and subject classes are offered first', (await page.$$eval('#shareFromSelect option', (o) => o.map((x) => x.value)))[0] === 'mon');
  await page.selectOption('#shareFromSelect', 'mon');
  await page.click('[data-action="share-follow"]');
  await page.waitForFunction(() => /Using answer keys and videos from/.test(document.querySelector('#shareSection').textContent));
  let tue = await page.evaluate(() => window.__fake.db['onlineCourses/tue']);
  check('share: Tuesday now follows Monday, only where it has none of its own', tue.shareFrom === 'mon' && tue.shareMode === 'fill');
  await page.waitForFunction(() => document.querySelectorAll('.share-row.is-shared').length === 2);
  check('share: both revision worksheets match Monday\'s (a copy, and the same name)', (await page.locator('.share-row.is-shared').count()) === 2);
  check('share: the teaching order marks the shared worksheets', (await page.locator('.seq-row .chip-share.is-on').count()) === 2);
  await page.locator('#shareSection').screenshot({ path: path.join(shots, '30-share-admin.png') });
  // Keep own on worksheet 3, then back: one tap each, nothing else changes.
  await page.click('.share-row:nth-child(1) [data-action="share-own"]');
  await page.waitForFunction(() => { const c = window.__fake.db['onlineCourses/tue']; return c.sharedKeys && c.sharedKeys.t1 && c.sharedKeys.t1.own; });
  await page.click('.share-row:nth-child(1) [data-action="share-clear"]');
  await page.waitForFunction(() => { const c = window.__fake.db['onlineCourses/tue']; return c.sharedKeys && !c.sharedKeys.t1; });
  check('share: Keep own and back to the class setting', true);
  // Saturday lacks the two revision worksheets altogether: add them from Monday.
  await page.click('[data-action="close-course"]');
  await page.click('[data-action="open-course"][data-id="sat"]');
  await page.waitForSelector('#shareFromSelect');
  await page.selectOption('#shareFromSelect', 'mon');
  await page.click('[data-action="share-follow"]');
  await page.waitForSelector('[data-action="share-add-missing"][data-mode="previous"]');
  check('share: Saturday is told which of Monday\'s worksheets it lacks', /2 worksheets in .* are not in this class/.test(await page.textContent('.share-missing')));
  await page.locator('#shareSection').screenshot({ path: path.join(shots, '31-share-missing.png') });
  await page.click('[data-action="share-add-missing"][data-mode="previous"]');
  await page.waitForFunction(() => (window.__fake.db['onlineCourses/sat'].worksheetIds || []).length === 3, null, { timeout: 10000 });
  const sat = await page.evaluate(() => window.__fake.db['onlineCourses/sat']);
  check('share: the missing two join Saturday as done worksheets, before the one it is on', sat.currentIndex === 2 && sat.worksheetIds[2] === 's1');
  await page.waitForFunction(() => document.querySelectorAll('.share-row.is-shared').length === 2);
  check('share: and they take Monday\'s answer key and videos', (await page.locator('.share-row.is-shared').count()) === 2);
  check('share (admin): no script errors', errors.length === 0 || (console.log(errors), false));
  const after = await page.evaluate(() => window.__fake.db);
  await context.close();

  // After: Tuesday's and Saturday's students see Monday's videos and answer key.
  stu = await open({ user: student, docs: after, query: '#videos', width: 1100 });
  await stu.page.waitForFunction(() => document.querySelectorAll('.st-card .st-row').length >= 4, null, { timeout: 8000 });
  const tueRows = await tueCard().locator('.st-row').count();
  check('share (student): Tuesday now lists both worksheets\' videos', tueRows === 2);
  check('share (student): each says it comes from the Monday class', /From .*Monday/.test(await tueCard().locator('.st-shared').first().textContent()));
  const href = await tueCard().locator('.st-btn-play').first().getAttribute('href');
  check('share (student): Watch plays Monday\'s worksheet for Tuesday\'s class', /ws=t\d&c=tue&src=m\d/.test(href));
  const satCard = stu.page.locator('.st-card', { has: stu.page.locator('.day-band', { hasText: /SATURDAY/ }) });
  check('share (student): Saturday has them too', (await satCard.locator('.st-row').count()) === 2);
  await stu.page.screenshot({ path: path.join(shots, '32-share-student-videos.png'), fullPage: true });
  await stu.page.click('#st-tab-answers');
  await stu.page.waitForFunction(() => document.querySelector('#st-tab-answers[aria-selected="true"]'));
  check('share (student): Monday\'s answer key PDF shows for Tuesday', (await tueCard().locator('a.st-btn-main').count()) === 1);
  check('share (student): no script errors', stu.errors.length === 0 || (console.log(stu.errors), false));
  await stu.context.close();
}

/* ---- ⭐ v1.19.0: "This is my class" ----
   Zhi Kai, 16 Nov 2026: a student in P6 Science on Monday 7pm, Tuesday 5pm
   and Saturday 9am, plus P6 Maths on Monday 5pm, ticks the classes they
   attend (one maths, one science). Those go to the top; the rest go grey
   but still open. */
{
  const ws = (id, subject, extra) => Object.assign({ name: (subject === 'math' ? 'P6 Maths' : 'P6 Science') + ' Worksheet ' + id.slice(-1), level: 'P6', subject, storagePath: 'pdf-annotator/seed-' + id + '.pdf', pageCount: 4, annotations: '' }, extra || {});
  const cls = (subject, day, slot, ids) => ({ level: 'P6', subject, day, slot, worksheetIds: ids, currentIndex: 1, releasedThrough: ids.length - 1 });
  const docs = {
    'onlineCourses/mmon': cls('math', 'Monday', 1, ['mm1', 'mm2', 'mm3']),
    'onlineCourses/smon': cls('science', 'Monday', 2, ['sm1', 'sm2', 'sm3']),
    'onlineCourses/stue': cls('science', 'Tuesday', 1, ['st1', 'st2', 'st3']),
    'onlineCourses/ssat': cls('science', 'Saturday', 0, ['ss1', 'ss2', 'ss3']),
    'onlineMembers/p6x': { level: 'P6', subjects: ['math', 'science'], role: 'student', name: 'Ryan Tan', email: 'ryan@example.com' }
  };
  for (const [c, prefix, subject] of [['mmon', 'mm', 'math'], ['smon', 'sm', 'science'], ['stue', 'st', 'science'], ['ssat', 'ss', 'science']]) {
    for (let i = 1; i <= 3; i++) docs['pdfAnnotator/' + prefix + i] = ws(prefix + i, subject, { onlineCourseId: c });
  }
  const student = { uid: 'p6x', email: 'ryan@example.com', displayName: 'Ryan Tan' };
  const bandDays = (page) => page.$$eval('#studentPanel > .st-card .day-name, #studentPanel > .class-card .day-name', (els) => els.map((e) => e.textContent + ''));
  const cardIds = (page) => page.$$eval('#studentPanel [data-action="my-class"]', (els) => els.map((e) => e.dataset.id));

  let s = await open({ user: student, docs, width: 1180 });
  await s.page.waitForFunction(() => document.querySelectorAll('.st-card .my-class-box').length === 4, null, { timeout: 8000 });
  check('my class: every maths and science band has a tick box', (await s.page.locator('.day-band .my-class-box').count()) === 4);
  check('my class: before any tick, nothing is greyed and the usual order holds', (await s.page.locator('.is-other-class').count()) === 0 && (await cardIds(s.page)).join() === 'mmon,smon,stue,ssat');
  check('my class: a line tells the student what the box is for', /Tick/.test(await s.page.textContent('.my-class-hint')));
  await s.page.screenshot({ path: path.join(shots, '40-my-class-before.png'), fullPage: true });

  await s.page.click('[data-action="my-class"][data-id="stue"]');
  await s.page.waitForFunction(() => document.querySelectorAll('.is-other-class').length === 3);
  check('my class: ticking Tuesday science puts it first', (await cardIds(s.page))[0] === 'stue');
  check('my class: it gets the gold ring, the box shows ticked', (await s.page.locator('.st-card.is-my-class [data-action="my-class"][aria-checked="true"]').count()) === 1);
  check('my class: the others sit under "Other classes"', /Other classes/.test(await s.page.textContent('.other-classes-head')));
  let prof = await s.page.evaluate(() => window.__fake.db['studentProfiles/p6x']);
  check('my class: saved in the student profile', prof && prof.onlineMyClasses && prof.onlineMyClasses.science === 'stue');
  const greyBand = await s.page.$eval('.is-other-class .day-band', (el) => getComputedStyle(el).backgroundColor);
  check('my class: other classes have a grey band', greyBand === 'rgb(140, 146, 156)');

  await s.page.click('[data-action="my-class"][data-id="ssat"]');
  await s.page.waitForFunction(() => document.querySelector('#studentPanel [data-action="my-class"]').dataset.id === 'ssat');
  check('my class: ticking Saturday science MOVES the tick (one science class only)', (await s.page.locator('[data-action="my-class"][aria-checked="true"]').count()) === 1);
  await s.page.click('[data-action="my-class"][data-id="mmon"]');
  await s.page.waitForFunction(() => document.querySelectorAll('.is-my-class').length === 2);
  check('my class: one maths and one science, both at the top', (await cardIds(s.page)).slice(0, 2).join() === 'mmon,ssat');
  prof = await s.page.evaluate(() => window.__fake.db['studentProfiles/p6x']);
  check('my class: both saved', prof.onlineMyClasses.math === 'mmon' && prof.onlineMyClasses.science === 'ssat');
  // The other classes still work.
  check('my class: a greyed class still has its Download buttons', (await s.page.locator('.is-other-class [data-action="download"]').count()) > 0);
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.page.screenshot({ path: path.join(shots, '41-my-class-desktop.png'), fullPage: true });
  for (const tab of ['answers', 'videos', 'timeline']) {
    await s.page.click('#st-tab-' + tab);
    await s.page.waitForFunction((t) => document.querySelector('#st-tab-' + t + '[aria-selected="true"]'), tab);
    check('my class: the ' + tab + ' tab lists the ticked classes first too', (await cardIds(s.page)).slice(0, 2).join() === 'mmon,ssat');
  }
  check('my class (desktop): no script errors', s.errors.length === 0 || (console.log(s.errors), false));
  const after = await s.page.evaluate(() => window.__fake.db);
  await s.context.close();

  // Another device (nothing on it yet): the profile brings the ticks along.
  s = await open({ user: student, docs: after, width: 390 });
  await s.page.waitForFunction(() => document.querySelectorAll('.is-my-class').length === 2, null, { timeout: 8000 });
  check('my class: another device shows the same ticks', (await cardIds(s.page)).slice(0, 2).join() === 'mmon,ssat');
  const box = await s.page.locator('[data-action="my-class"]').first().boundingBox();
  check('my class (phone): the tick box is big enough for a finger', box && box.height >= 44 && box.width >= 44);
  const bandFits = await s.page.$$eval('.day-band', (els) => els.every((b) => b.scrollWidth <= b.clientWidth + 1));
  check('my class (phone): the band still fits the screen', bandFits);
  await s.page.screenshot({ path: path.join(shots, '42-my-class-phone.png'), fullPage: true });
  await s.page.screenshot({ path: path.join(shots, '43-my-class-phone-top.png') });
  // Untick both: back to normal.
  await s.page.click('[data-action="my-class"][data-id="mmon"]');
  await s.page.waitForFunction(() => document.querySelectorAll('.is-my-class').length === 1);
  await s.page.click('[data-action="my-class"][data-id="ssat"]');
  await s.page.waitForFunction(() => document.querySelectorAll('.is-other-class').length === 0);
  check('my class: unticking everything brings the usual order and colours back', (await cardIds(s.page)).join() === 'mmon,smon,stue,ssat');
  check('my class (phone): no script errors', s.errors.length === 0 || (console.log(s.errors), false));
  await s.context.close();

  // An admin's preview: ticking works there but is never saved.
  const a = await open({ user: admin, docs, width: 1180 });
  await a.page.waitForSelector('.tabs');
  await a.page.click('[data-action="preview-start"]');
  await a.page.selectOption('#previewLevel', 'P6');
  await a.page.waitForSelector('[data-action="my-class"]');
  await a.page.click('[data-action="my-class"][data-id="stue"]');
  await a.page.waitForFunction(() => document.querySelectorAll('.is-my-class').length === 1);
  const adminProf = await a.page.evaluate(() => window.__fake.db['studentProfiles/admin-1']);
  check('my class (preview): ticks for the admin to see, saves nothing', !adminProf || !adminProf.onlineMyClasses);
  check('my class (preview): no script errors', a.errors.length === 0 || (console.log(a.errors), false));
  await a.context.close();
  void bandDays;
}

await browser.close();
console.log(`Passed ${checks} Polymath Online browser checks.`);
