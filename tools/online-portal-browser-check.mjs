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

  // Class is on worksheet 3 → up to 8 released.
  await page.fill('#currentInput', '3');
  await page.click('[data-action="set-current"]');
  await page.waitForFunction(() => /Up to 8/.test(document.querySelector('.control-strip').textContent));
  check('admin: putting the class on worksheet 3 releases up to 8', true);

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
  check('admin: Finished saves the move and what was finished', classAfterFinish.currentIndex === 3 && classAfterFinish.releasedThrough === 8 && classAfterFinish.lastFinishedIndex === 2);
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
  const { page, context, errors } = await open({ user: student, docs: db, query: '?invite=' + inviteId, width: 1100 });
  await page.waitForSelector('.class-card', { timeout: 10000 });
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

  // ▶ Video: the two recordings, newest first; picking one replays it in Ans Key, in the portal.
  await page.click('.tl-item.is-current [data-action="video"]');
  await page.waitForSelector('.rec-row');
  const recTitles = await page.$$eval('.rec-row b', (els) => els.map((e) => e.textContent));
  check('student: the video list shows both lessons, newest first, with their length', recTitles.length === 2 && /^Q5/.test(recTitles[0]) && /12:04/.test(await page.textContent('.rec-row:first-child')) && /41:00/.test(await page.textContent('.rec-row:last-child')));
  await page.screenshot({ path: path.join(shots, '04b-student-videos.png') });
  await page.click('.rec-row:first-child');
  await page.waitForSelector('.modal-wide iframe.anskey-frame');
  const playSrc = await page.getAttribute('.modal-wide iframe.anskey-frame', 'src');
  check('student: the video plays in Ans Key inside the portal, writing and all', playSrc === '../anskey/?ws=' + encodeURIComponent(ws3Id) + '&do=play&rec=rec-new');
  await page.screenshot({ path: path.join(shots, '04c-student-video-player.png') });
  await page.click('.modal-wide [data-modal-close]');
  check('student: the player closes', (await page.locator('.modal-back').count()) === 0);
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
  // Before Ans Key has filed the video page, the old chooser still plays them.
  await page.click('.tl-item.is-current .tl-day >> nth=-1');
  await page.waitForSelector('.modal-wide iframe.anskey-frame');
  check('student: with no video page yet, a one-lesson day replays that lesson in Ans Key',
    (await page.getAttribute('.modal-wide iframe.anskey-frame', 'src')) === '../anskey/?ws=' + encodeURIComponent(ws3Id) + '&do=play&rec=rec-old');
  await page.keyboard.press('Escape');
  // A page filed BEFORE the newest lesson is not used: nobody misses a lesson.
  const VP_HASH = 'vp1-812-9a3b4c5d', VP_TOKEN = '7e1d0a3c-1b2c-4d5e-8f90-000000000001';
  await page.evaluate(([p, at, hash, token]) => {
    window.__fake.seed(p, Object.assign({}, window.__fake.db[p], { videoPlaylist: { hash, token, n: 2, at: at } }));
  }, [ws3, edited, VP_HASH, VP_TOKEN]);
  await page.waitForTimeout(300);
  await page.click('.tl-item.is-current [data-action="video"]');
  await page.waitForSelector('.rec-row');
  check('student: a video page older than the newest lesson is not used', (await page.locator('.rec-row').count()) === 3);
  await page.keyboard.press('Escape');
  // Ans Key files the page after the lesson: ▶ opens the SAME page as the printed QR code.
  await page.evaluate(([p, at, hash, token]) => {
    window.__fake.seed(p, Object.assign({}, window.__fake.db[p], { videoPlaylist: { hash, token, n: 4, at: at + 3700000 } }));
  }, [ws3, edited, VP_HASH, VP_TOKEN]);
  await page.waitForFunction(() => /4 videos/.test((document.querySelector('.tl-item.is-current [data-action="video"]') || {}).textContent || ''));
  await page.locator('.tl-item.is-current').screenshot({ path: path.join(shots, '04f-student-lesson-days.png') });
  check('student: the worksheet says when its videos were last updated', /videos updated Mon 12 Oct/.test(await page.textContent('.tl-item.is-current .tl-sub')));
  await page.click('.tl-item.is-current [data-action="video"]');
  await page.waitForSelector('.modal-wide iframe.video-page-frame');
  const pageSrc = await page.getAttribute('.modal-wide iframe.video-page-frame', 'src');
  const wantSrc = await page.evaluate(([hash, token]) => '../anskey/videos.html?' + window.PolymathOnlineCore.videoPackCode(hash, token), [VP_HASH, VP_TOKEN]);
  check('student: ▶ Videos opens Ans Key\'s video page, the same page as the QR code', pageSrc === wantSrc && /^\.\.\/anskey\/videos\.html\?[A-Za-z0-9_-]{31}$/.test(pageSrc), pageSrc);
  await page.screenshot({ path: path.join(shots, '04e-student-video-page.png') });
  await page.keyboard.press('Escape');
  await page.click('.tl-item.is-current .tl-day >> nth=0');
  await page.waitForSelector('.modal-wide iframe.video-page-frame');
  check('student: a lesson day opens the video page at that day',
    (await page.getAttribute('.modal-wide iframe.video-page-frame', 'src')) === wantSrc + '#day-' + wantDays[0] &&
    /Mon 12 Oct lesson/.test(await page.textContent('.modal-wide h2')));
  await page.keyboard.press('Escape');

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
  check('stranger: told they have not been invited, nothing else', /not been invited/.test(await page.textContent('.state-card')) && (await page.locator('.class-card').count()) === 0);
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
  check('another level: no classes, and no worksheet names leak', (await page.locator('.class-card').count()) === 0 && !(await page.textContent('body')).includes('Worksheet 1'));
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
  await page.waitForSelector('.class-card');
  const text = await page.textContent('body');
  check('/student approval: P5 Maths opens although the old invitation said P6 Science', (await page.locator('.class-card').count()) >= 1 && /P5/.test(await page.textContent('.welcome .chips')));
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
  check('/student approval: a Science-only account no longer sees the P5 Maths class', (await page.locator('.class-card').count()) === 0);
  check('/student approval (science only): no script errors', errors.length === 0);
  await context.close();
}
{
  const docs = JSON.parse(JSON.stringify(db));
  docs['onlineMembers/wait'] = { level: 'P5', subjects: ['math'], role: 'student', name: 'Kai', email: 'wait@example.com' };
  docs['studentAccess/wait'] = { uid: 'wait', status: 'pending', childCount: 1, children: [{ name: 'Kai Ong', level: 'P5', subjects: 'math' }] };
  const { page, context, errors } = await open({ user: { uid: 'wait', email: 'wait@example.com', displayName: 'Kai' }, docs, width: 390 });
  await page.waitForSelector('.state-card');
  check('/student approval: an account still waiting sees no classes, and is told why', /Waiting for approval/.test(await page.textContent('.state-card')) && (await page.locator('.class-card').count()) === 0);
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

await browser.close();
console.log(`Passed ${checks} Polymath Online browser checks.`);
