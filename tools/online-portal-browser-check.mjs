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
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => document.querySelectorAll('.seq-row').length === 10, null, { timeout: 15000 });
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
  check('student: every worksheet has View and Print for the worksheet and for its answer key',
    (await page.locator('.tl-item [data-action="view"]').count()) === 8 && (await page.locator('.tl-item [data-action="print"]').count()) === 8 &&
    (await page.locator('.tl-item [data-action="answer-key"]').count()) === 8 && (await page.locator('.tl-item [data-action="print-key"]').count()) === 8);
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
  await page.click('.tl-item.is-current [data-action="answer-key"]');
  const keySrc = await page.getAttribute('.modal-wide iframe.anskey-frame', 'src');
  check('student: View answer key opens the worksheet in Ans Key with ?ws=', keySrc === '../anskey/?ws=' + encodeURIComponent(ws3Id));
  await page.keyboard.press('Escape');
  await page.click('.tl-item.is-current [data-action="print-key"]');
  const printSrc = await page.getAttribute('.modal-wide iframe.anskey-frame', 'src');
  check('student: Print answer key asks Ans Key to print the answers', printSrc === '../anskey/?ws=' + encodeURIComponent(ws3Id) + '&do=print-answers');
  await page.keyboard.press('Escape');

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
  await page.click('.tl-item.is-current [data-action="answer-key"]');
  const box = await page.locator('.modal-wide .anskey-frame-wrap').boundingBox();
  check('student phone: the answer key window fills the screen', box && box.width > 330 && box.height > 500);
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

await browser.close();
console.log(`Passed ${checks} Polymath Online browser checks.`);
