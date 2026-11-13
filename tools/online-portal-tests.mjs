// Polymath Online's rules (online/portal-core.js): who sees which class,
// what is released, the next two, reordering and the invitation email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../online/portal-core.js');
const course = (over = {}) => ({ id: 'k', level: 'P5', subject: 'math', worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], currentIndex: -1, releasedThrough: -1, ...over });

function plainList(value) { return JSON.parse(JSON.stringify(value)); }

test('nothing is released until the class starts or an admin releases it', () => {
  const c = course();
  assert.deepEqual(Core.releasedWorksheets(c), []);
  assert.deepEqual(Core.nextWorksheets(c), []);
  assert.equal(Core.lockedCount(c), 10);
});

test('on worksheet 3, worksheets 1 to 8 are out and 4, 5 are next', () => {
  const update = Core.progressUpdate(course(), 2);
  assert.deepEqual(update, { currentIndex: 2, currentDocId: 'c', releasedThrough: 7 });
  const c = course(update);
  assert.deepEqual(Core.releasedWorksheets(c).map((w) => w.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['d', 'e']);
  assert.equal(Core.worksheetState(c, 2), 'current');
  assert.equal(Core.worksheetState(c, 3), 'next');
  assert.equal(Core.worksheetState(c, 5), 'released');
  assert.equal(Core.worksheetState(c, 8), 'locked');
  assert.equal(Core.lockedCount(c), 2);
});

test('progress never goes backwards, except when an admin forces the position — and releases stay out', () => {
  const c = course({ currentIndex: 4, releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1), { currentIndex: 4, currentDocId: 'e', releasedThrough: 9 });
  assert.deepEqual(Core.progressUpdate(c, 1, { force: true }), { currentIndex: 1, currentDocId: 'b', releasedThrough: 9 });
  assert.equal(Core.progressUpdate(c, 10), null);
  assert.equal(Core.progressUpdate(c, -1), null);
});

test('the next two never name a worksheet that is not released', () => {
  const c = course({ currentIndex: 2, releasedThrough: 3 });
  assert.deepEqual(Core.nextWorksheets(c).map((w) => w.id), ['d']);
  const end = course({ currentIndex: 9, releasedThrough: 9 });
  assert.deepEqual(Core.nextWorksheets(end), []);
});

test('a member sees only their level and subjects; P3 is Science only', () => {
  const classes = [course({ id: 'm5' }), course({ id: 's5', subject: 'science' }), course({ id: 'm6', level: 'P6' }), course({ id: 'old', archived: true })];
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: ['science'] }).map((c) => c.id), ['s5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: ['math', 'science'] }).map((c) => c.id), ['m5', 's5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P5', subjects: 'both' }).map((c) => c.id), ['m5', 's5']);
  assert.deepEqual(Core.coursesForMember(classes, { level: 'P6', subjects: ['science'] }).map((c) => c.id), []);
  assert.deepEqual(Core.coursesForMember(classes, null), []);
  assert.deepEqual(Core.cleanSubjects('P3', ['math', 'science']), ['science']);
  assert.equal(Core.profileSubjectFor(['math', 'science']), 'both');
  assert.equal(Core.profileSubjectFor(['science']), 'science');
});

test('a reorder keeps the class on the same worksheet and the same number released', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  const moved = Core.moveItem(c.worksheetIds, 2, 0);
  assert.deepEqual(moved.slice(0, 3), ['c', 'a', 'b']);
  assert.deepEqual(Core.remapProgress(c, moved), { currentIndex: 0, currentDocId: 'c', releasedThrough: 7 });
  const removed = c.worksheetIds.filter((id) => id !== 'c');
  assert.deepEqual(Core.remapProgress(c, removed), { currentIndex: -1, currentDocId: null, releasedThrough: 7 });
  const shorter = ['a', 'b', 'c'];
  assert.deepEqual(Core.remapProgress(c, shorter), { currentIndex: 2, currentDocId: 'c', releasedThrough: 2 });
});

test('files are added in the order a person numbers them', () => {
  const names = ['Worksheet 10.pdf', 'Worksheet 2.pdf', 'worksheet 1.pdf', 'Worksheet 2a.pdf'];
  assert.deepEqual(names.sort(Core.naturalCompare), ['worksheet 1.pdf', 'Worksheet 2.pdf', 'Worksheet 2a.pdf', 'Worksheet 10.pdf']);
  assert.equal(Core.worksheetNameFromFile('P5_Fractions_3.PDF'), 'P5 Fractions 3');
});

test('class names and sessions match Ans Key\'s three sessions a day', () => {
  assert.equal(Core.autoCourseTitle('P5', 'math', 'Monday', 1), 'P5 Mathematics · Monday 5:00pm');
  assert.equal(Core.autoCourseTitle('P4', 'science', 'Saturday', 0), 'P4 Science · Saturday 9:00am');
  assert.equal(Core.autoCourseTitle('P6', 'science', '', null), 'P6 Science');
});

test('the invitation email carries the link and escapes what people typed', () => {
  const link = Core.inviteLink('https://polymathlc.com.sg/online/', 'abc 123');
  assert.equal(link, 'https://polymathlc.com.sg/online/?invite=abc%20123');
  const mail = Core.inviteEmail({ name: '<b>Ethan</b>', role: 'parent', level: 'P5', subjects: ['math', 'science'], email: 'p@example.com' }, link, 'Mr Chung');
  assert.match(mail.text, /Join here: https:\/\/polymathlc\.com\.sg\/online\/\?invite=abc%20123/);
  assert.match(mail.text, /your child's P5 Mathematics and Science worksheets/);
  assert.ok(mail.html.includes('&lt;b&gt;Ethan&lt;/b&gt;') && !mail.html.includes('<b>Ethan</b>'));
  assert.ok(Core.mailtoLink({ email: 'p@example.com', level: 'P5', subjects: ['math'] }, link).startsWith('mailto:p%40example.com?subject='));
});

test('every portal email is sent as admin@polymathlc.com.sg, whoever invited', () => {
  const message = Core.inviteEmail({ role: 'student', level: 'P6', subjects: ['math'], email: 's@example.com' }, 'https://x/?invite=1', Core.SENDER_NAME);
  const mail = Core.portalMail('s@example.com', message, { inviteId: '1', sentBy: 'elsielcr@gmail.com' });
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(mail.replyTo, 'admin@polymathlc.com.sg');
  assert.deepEqual(plainList(mail.to), ['s@example.com']);
  assert.equal(mail.polymathOnline.sender, 'admin@polymathlc.com.sg');
  assert.equal(mail.polymathOnline.sentBy, 'elsielcr@gmail.com');
  assert.match(message.text, /^Hello,\n\nPolymath Learning Centre has invited you/);
  assert.ok(!/Mr Chung|elsie/i.test(message.text + message.html));
});

test('emails are checked and normalised', () => {
  assert.equal(Core.isEmail('a@b.co'), true);
  assert.equal(Core.isEmail('nope'), false);
  assert.equal(Core.normalizeEmail('  Ethan.T@Gmail.com '), 'ethan.t@gmail.com');
  assert.equal(Core.initials('Ethan Tan'), 'ET');
  assert.equal(Core.initials('', 'mei@x.com'), 'M');
});


test('timeline: worksheets in teaching order, with their Ans Key edit date and recorded lessons', () => {
  const course = { worksheetIds: ['a', 'b', 'c', 'd', 'e', 'f'], currentIndex: 2, releasedThrough: 4 };
  const docs = {
    a: { name: 'WS A', updatedAt: { seconds: 1760256300, nanoseconds: 0 }, pageCount: 2 },
    b: { name: 'WS B', updatedAt: { toMillis: () => 1760342700000 } },
    c: { name: 'WS C', createdAt: { seconds: 1760000000 }, annotations: '' }
  };
  const recordings = { c: Core.lessonRecordings(JSON.stringify([{ id: 'r', type: 'video', url: 'u', ts: 5, lessonRecording: { version: 1, duration: 90000 } }])) };
  const items = plainList(Core.timelineItems(course, docs, recordings));
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(items.map((i) => i.state), ['released', 'released', 'current', 'next', 'next']);
  assert.equal(items[0].edited, 1760256300000);
  assert.equal(items[1].edited, 1760342700000);
  assert.equal(items[2].edited, 1760000000000, 'falls back to when it was uploaded');
  assert.equal(items[3].edited, 0);
  assert.equal(items[3].loading, true);
  assert.equal(items[3].name, 'Worksheet 4');
  assert.equal(items[0].pages, 2);
  assert.equal(items[0].marked, false);
  assert.equal(Core.timelineItems(course, { a: { annotations: '[{"id":"p","type":"pen"}]' } })[0].marked, true);
  assert.equal(Core.timelineItems(course, { a: { annotationsPath: 'pdf-annotator/a.annotations.json' } })[0].marked, true);
  assert.deepEqual(items[2].recordings.map((r) => [r.id, r.duration]), [['r', 90]]);
});

test('timeline: recorded lessons are only Ans Key lesson recordings, newest first', () => {
  const list = [
    { id: 'pen', type: 'pen' },
    { id: 'yt', type: 'video', url: 'https://youtu.be/x' },
    { id: 'a', type: 'video', url: 'u1', ts: 10, lessonRecording: { version: 1, duration: 724000, title: 'Q5', video: true } },
    { id: 'b', type: 'video', url: 'u2', ts: 20, lessonRecording: { version: 1, duration: 61000 } },
    { id: '', type: 'video', url: 'u3', ts: 30, lessonRecording: { version: 1 } }
  ];
  const recs = plainList(Core.lessonRecordings(JSON.stringify(list)));
  assert.deepEqual(recs.map((r) => r.id), ['b', 'a']);
  assert.equal(recs[1].title, 'Q5');
  assert.equal(recs[1].video, true);
  assert.equal(recs[0].title, 'Lesson recording');
  assert.equal(Core.formatDuration(recs[1].duration), '12:04');
  assert.equal(Core.formatDuration(3729), '1:02:09');
  assert.deepEqual(plainList(Core.lessonRecordings('not json')), []);
  assert.deepEqual(plainList(Core.lessonRecordings(null)), []);
});

test('timeline: dates read like a person wrote them', () => {
  const ms = new Date(2026, 9, 12, 16, 5).getTime();
  assert.equal(Core.formatDay(ms, new Date(2026, 11, 1).getTime()), 'Mon 12 Oct');
  assert.equal(Core.formatDay(ms, new Date(2027, 0, 5).getTime()), 'Mon 12 Oct 2026');
  assert.equal(Core.formatClock(ms), '4:05 pm');
  assert.equal(Core.formatClock(new Date(2026, 0, 1, 0, 9).getTime()), '12:09 am');
  assert.equal(Core.formatDay(0), '');
  assert.equal(Core.toMillis('2026-10-12T08:05:00Z'), Date.UTC(2026, 9, 12, 8, 5));
  assert.equal(Core.toMillis({ _seconds: 2 }), 2000);
  assert.equal(Core.toMillis(undefined), 0);
});

test('Ans Key links: view, replay a lesson, print the answers, nothing unexpected', () => {
  assert.equal(Core.anskeyLink('../anskey/', 'w 1'), '../anskey/?ws=w%201');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'play', 'rec-1'), '../anskey/?ws=w1&do=play&rec=rec-1');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'play'), '../anskey/?ws=w1&do=play');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'print-answers', 'ignored'), '../anskey/?ws=w1&do=print-answers');
  assert.equal(Core.anskeyLink('../anskey/', 'w1', 'delete'), '../anskey/?ws=w1');
});

test('a re-render only puts back what someone is typing, never a file picker', () => {
  for (const [tag, type] of [['INPUT', 'text'], ['INPUT', ''], ['INPUT', 'email'], ['INPUT', 'number'], ['TEXTAREA', ''], ['SELECT', 'select-one']]) {
    assert.equal(Core.keepsTyping(tag, type), true, tag + ' ' + type);
  }
  for (const [tag, type] of [['INPUT', 'file'], ['INPUT', 'checkbox'], ['INPUT', 'radio'], ['INPUT', 'button'], ['BUTTON', ''], ['DIV', '']]) {
    assert.equal(Core.keepsTyping(tag, type), false, tag + ' ' + type);
  }
});

test('a batch of uploads reads as one line and one bar', () => {
  assert.deepEqual(Core.uploadSummary([]), { total: 0, added: 0, failed: 0, pct: 0, label: '' });
  const going = Core.uploadSummary([{ state: 'added', pct: 100 }, { state: 'uploading', pct: 50 }, { state: 'waiting', pct: 0 }, { state: 'waiting', pct: 0 }]);
  assert.equal(going.label, 'Uploading 2 of 4…');
  assert.equal(going.pct, 38);
  assert.equal(Core.uploadSummary([{ state: 'added' }, { state: 'added' }]).label, 'All 2 uploaded');
  assert.equal(Core.uploadSummary([{ state: 'added' }]).label, 'Uploaded');
  const mixed = Core.uploadSummary([{ state: 'added' }, { state: 'failed: storage/unauthorized' }]);
  assert.equal(mixed.label, '1 of 2 uploaded, 1 failed');
  assert.equal(mixed.pct, 100);
  assert.equal(Core.uploadStateLabel('waiting'), 'queued');
  assert.equal(Core.uploadStateLabel('added'), '✓ added');
  assert.equal(Core.uploadStateLabel('failed: x'), 'failed: x');
});

/* ---- 📌 Current worksheet / Next worksheet: what Ans Key shows (portal v1.4.0) ---- */
test('Ans Key shows worksheet 1 as current and 2 as next before the first lesson', () => {
  const c = course();
  assert.equal(Core.ansKeyAt(c), 0);
  assert.equal(Core.ansKeyState(c, 0), 'current');
  assert.equal(Core.ansKeyState(c, 1), 'next');
  assert.equal(Core.ansKeyState(c, 2), 'queued');
  assert.equal(Core.ansKeyAt(course({ worksheetIds: [] })), -1, 'an empty class has nothing to show');
});

test('on worksheet 3: 1 and 2 are done, 3 is current, 4 is next, the rest are queued', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  assert.deepEqual(c.worksheetIds.map((_, i) => Core.ansKeyState(c, i)),
    ['done', 'done', 'current', 'next', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued']);
  assert.equal(Core.ansKeyState(c, 10), '');
  assert.equal(Core.ansKeyState(c, -1), '');
  assert.equal(Core.ansKeyAt(course({ worksheetIds: ['a', 'b'], currentIndex: 6 })), 1, 'a shortened list keeps a real place');
});

test('Finished moves the class one step and releases like opening the next sheet', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  assert.deepEqual(Core.finishUpdate(c), { currentIndex: 3, currentDocId: 'd', releasedThrough: 8, lastFinishedIndex: 2, lastFinishedDocId: 'c' });
  const fresh = course();
  assert.deepEqual(Core.finishUpdate(fresh), { currentIndex: 1, currentDocId: 'b', releasedThrough: 6, lastFinishedIndex: 0, lastFinishedDocId: 'a' },
    'finishing worksheet 1 before the class opened anything');
  assert.equal(Core.finishUpdate(course({ currentIndex: 9, releasedThrough: 9 })), null, 'nothing after the last one');
  assert.equal(Core.finishUpdate(course({ worksheetIds: [] })), null);
  const after = course(Core.finishUpdate(c));
  assert.equal(Core.ansKeyState(after, 3), 'current', 'the old Next is now Current');
  assert.equal(Core.ansKeyState(after, 4), 'next', 'and the one after it is loaded as Next');
  assert.equal(Core.ansKeyState(after, 2), 'done');
});

test('the labels stay with their worksheets when the list is reordered', () => {
  const c = course({ currentIndex: 2, releasedThrough: 7 });
  const moved = Core.moveItem(c.worksheetIds, 2, 0);
  const after = course(Object.assign({ worksheetIds: moved }, Core.remapProgress(c, moved)));
  assert.equal(after.worksheetIds[Core.ansKeyAt(after)], 'c', 'the class is still on the same worksheet');
  assert.equal(Core.ansKeyState(after, 1), 'next');
});

test('a duplicated class keeps level and subject, drops the time, and starts from nothing', () => {
  const copy = Core.duplicateCourseData(course({ id: 'orig', day: 'Thursday', slot: 0, title: 'P5 Mathematics · Thursday 3:00pm', currentIndex: 4, releasedThrough: 9 }), 'zk@example.com');
  assert.deepEqual(plainList(copy), { title: 'P5 Mathematics', level: 'P5', subject: 'math', day: '', slot: null,
    worksheetIds: [], currentIndex: -1, releasedThrough: -1, copiedFrom: 'orig', createdBy: 'zk@example.com' });
});

test('a copied worksheet keeps its answer key but not the lesson recordings', () => {
  const json = JSON.stringify([{ id: 'a', type: 'pen' }, { id: 'r', type: 'video', lessonRecording: { version: 1 } }, { id: 't', type: 'text', text: 'Ans: 42' }]);
  const out = Core.stripLessonRecordings(json);
  assert.deepEqual(JSON.parse(out.json).map((a) => a.id), ['a', 't']);
  assert.equal(out.removed, 1);
  assert.equal(Core.stripLessonRecordings('not json').json, '[]');
  assert.equal(Core.stripLessonRecordings('').json, '[]');
  const ws = Core.worksheetCopy({ name: 'WS 3', level: 'P5', subject: 'math', wsDay: 'Monday', wsSlot: 1, hidden: true, storagePath: 'pdf-annotator/old.pdf',
    starPages: [2], pageCount: 4, ownerUid: 'u1', ownerEmail: 't@x', share: { mode: 'edit' }, onlineCourseId: 'old', annotations: '[]' },
  { id: 'new', storageDir: 'pdf-annotator', courseId: 'k2', seq: 2, fromId: 'old', by: 'a@x' });
  assert.equal(ws.storagePath, 'pdf-annotator/new.pdf', 'its own PDF, never the original\'s');
  assert.equal(ws.wsDay, ''); assert.equal(ws.wsSlot, null); assert.equal(ws.hidden, false);
  assert.equal(ws.onlineCourseId, 'k2'); assert.equal(ws.onlineSeq, 2); assert.equal(ws.onlineCopiedFrom, 'old');
  assert.equal(ws.share, undefined, 'share links are not copied');
  assert.equal(ws.annotations, undefined, 'the answer key is filled in by the portal after stripping');
  assert.deepEqual(plainList(ws.starPages), [2]);
});

test('🔁 a replaced PDF keeps its path and is told apart by pdfVersion', () => {
  assert.equal(Core.pdfCacheKey({ storagePath: 'pdf-annotator/a.pdf' }), 'pdf-annotator/a.pdf', 'never replaced: as before');
  assert.equal(Core.pdfCacheKey({ storagePath: 'pdf-annotator/a.pdf', pdfVersion: 17 }), 'pdf-annotator/a.pdf#v17');
  assert.equal(Core.pdfCacheKey({}), '');
  assert.equal(Core.pdfCacheKey(null), '');
  const u = Core.replacementUpdate({ version: 1762150000000, fileName: 'WS 3 fixed.pdf', by: 'a@x', pageCount: 5 });
  assert.deepEqual(plainList(u), { pdfVersion: 1762150000000, pdfFileName: 'WS 3 fixed.pdf', pdfReplacedBy: 'a@x', pageCount: 5 });
  assert.equal(u.storagePath, undefined, 'the path is never changed (Ans Key writes it back on every save)');
  assert.equal(u.annotations, undefined, 'the answer key is never touched');
  assert.equal(Core.replacementUpdate({ version: 1, pageCount: null }).pageCount, undefined, 'an unknown page count leaves the old one');
});

test('🔁 the copies made by Duplicate class are found, wherever the replace starts', () => {
  const docs = {
    orig: { storagePath: 'p/orig.pdf', onlineCourseId: 'thu' },
    c1: { storagePath: 'p/c1.pdf', onlineCourseId: 'sat', onlineCopiedFrom: 'orig' },
    c2: { storagePath: 'p/c2.pdf', onlineCourseId: 'sun', onlineCopiedFrom: 'orig' },
    cc: { storagePath: 'p/cc.pdf', onlineCourseId: 'wed', onlineCopiedFrom: 'c1' },
    other: { storagePath: 'p/other.pdf', onlineCourseId: 'thu' },
    lost: { missing: true }
  };
  assert.equal(Core.copyRoot('cc', docs), 'orig');
  assert.deepEqual(plainList(Core.copyFamily('orig', docs)), ['orig', 'c1', 'c2', 'cc']);
  assert.deepEqual(plainList(Core.copyFamily('cc', docs)).sort(), ['c1', 'c2', 'cc', 'orig']);
  assert.equal(Core.copyFamily('cc', docs)[0], 'cc', 'the one being replaced comes first');
  assert.deepEqual(plainList(Core.copyFamily('other', docs)), ['other'], 'an unrelated worksheet has no copies');
  // The original deleted: its copies still belong together.
  const orphan = { a: { storagePath: 'p/a.pdf', onlineCopiedFrom: 'gone' }, b: { storagePath: 'p/b.pdf', onlineCopiedFrom: 'gone' }, gone: { missing: true } };
  assert.deepEqual(plainList(Core.copyFamily('a', orphan)), ['a', 'b']);
  // A loop never hangs.
  const loop = { x: { storagePath: 'x', onlineCopiedFrom: 'y' }, y: { storagePath: 'y', onlineCopiedFrom: 'x' } };
  assert.ok(Core.copyFamily('x', loop).length === 2);
  const courses = { sat: { id: 'sat', title: 'P5 Maths · Saturday', worksheetIds: ['z', 'c1'] } };
  const targets = Core.copyTargets('orig', docs, courses);
  assert.equal(targets.length, 3);
  assert.equal(targets.find((t) => t.id === 'c1').where, 'P5 Maths · Saturday · worksheet 2');
  assert.equal(targets.find((t) => t.id === 'c2').where, 'A class no longer listed');
});

test('🔁 the Replace window warns when the page count changes, and sums up', () => {
  assert.equal(Core.pageChangeNote(4, 4), '');
  assert.equal(Core.pageChangeNote(0, 4), '', 'nothing known: nothing said');
  assert.equal(Core.pageChangeNote(4, null), '');
  assert.match(Core.pageChangeNote(5, 3), /new PDF has 3 pages and the old one 5 pages\. Answers written on page 4 to 5 will have no page/);
  assert.match(Core.pageChangeNote(5, 4), /on page 5 will have/);
  assert.match(Core.pageChangeNote(3, 4), /same page numbers/);
  assert.equal(Core.replaceSummary(['a'], []), 'Worksheet PDF replaced. Answer keys are kept.');
  assert.equal(Core.replaceSummary(['a', 'b', 'c'], []), 'PDF replaced in 3 worksheets. Answer keys are kept.');
  assert.equal(Core.replaceSummary(['a'], ['Saturday: offline']), 'Worksheet PDF replaced. 1 could not be replaced. Saturday: offline');
  assert.equal(Core.replaceSummary([], ['This class: offline']), 'The PDF could not be replaced. This class: offline');
});

/* ---- 🎬📅 v1.7.0: the worksheet's video page is Ans Key's videos.html, the QR code's own ---- */
const VP_HASH = 'vp1-812-9a3b4c5d';
const VP_TOKEN = '7e1d0a3c-1b2c-4d5e-8f90-000000000001';

test('the video page link carries the same packed code as the printed QR code', async () => {
  const vp = Core.videoPlaylistOf({ videoPlaylist: { hash: VP_HASH, token: VP_TOKEN, n: 3, at: 1794474000000 } });
  assert.deepEqual(vp, { hash: VP_HASH, token: VP_TOKEN, n: 3, at: 1794474000000 });
  const code = Core.videoPackCode(VP_HASH, VP_TOKEN);
  assert.match(code, /^[A-Za-z0-9_-]{31}$/);
  assert.equal(Core.videoPageLink('../anskey/', vp), '../anskey/videos.html?' + code);
  assert.equal(Core.videoPageLink('../anskey', vp, '2026-11-12'), '../anskey/videos.html?' + code + '#day-2026-11-12');
  assert.equal(Core.videoPageLink('../anskey/', vp, 'tomorrow'), '../anskey/videos.html?' + code, 'a bad day is left off');
  // A token that cannot be packed is spelled out, as Ans Key does.
  assert.equal(Core.videoPageLink('../anskey/', { hash: VP_HASH, token: 'abcdefghijklmnopqrst' }), '../anskey/videos.html?p=' + VP_HASH + '&t=abcdefghijklmnopqrst');
  // Anything else is no page at all.
  assert.equal(Core.videoPlaylistOf({ videoPlaylist: { hash: 'living-1', token: VP_TOKEN } }), null);
  assert.equal(Core.videoPlaylistOf({ videoPlaylist: { hash: VP_HASH, token: 'x"><script>' } }), null);
  assert.equal(Core.videoPlaylistOf({}), null);
  assert.equal(Core.videoPageLink('../anskey/', null), '');
  // Byte for byte Ans Key's packCode, when anskey is checked out beside this repo.
  const fs = await import('node:fs');
  for (const dir of ['../../anskey/video-playlist.js', '../../polymathlc/anskey/video-playlist.js']) {
    const file = new URL(dir, import.meta.url);
    if (!fs.existsSync(file)) continue;
    const VP = require(file.pathname).pure;
    for (const [h, t] of [[VP_HASH, VP_TOKEN], ['vp1-1-0', '00000000-0000-0000-0000-000000000000'], ['vp1-9999999-ffffffff', 'ffffffff-ffff-ffff-ffff-ffffffffffff']]) {
      assert.equal(Core.videoPackCode(h, t), VP.packCode(h, t));
      assert.deepEqual(VP.unpackCode(Core.videoPackCode(h, t)), { hash: h, token: t });
      assert.equal('https://polymathlc.com.sg/anskey/' + Core.videoPageLink('', { hash: h, token: t }), VP.viewerUrl('https://polymathlc.com.sg/anskey/', h, t));
    }
    // Both read a lesson's day the same way.
    const at = Date.UTC(2026, 10, 12, 9, 30);
    assert.equal(Core.lessonDayKey(at), VP.dayKey(at));
    break;
  }
});

test('a filed list is used only while it holds every lesson', () => {
  const at = Date.UTC(2026, 10, 12, 9);
  const recs = [{ id: 'a', at: at - 86400000 }, { id: 'b', at: at }];
  assert.equal(Core.videoPlaylistCurrent({ n: 2, at: at + 5000 }, recs), true);
  assert.equal(Core.videoPlaylistCurrent({ n: 5, at: at + 5000 }, recs), true, 'YouTube clips count as videos too');
  assert.equal(Core.videoPlaylistCurrent({ n: 1, at: at + 5000 }, recs), false, 'fewer videos than lessons');
  assert.equal(Core.videoPlaylistCurrent({ n: 3, at: at - 60000 }, recs), false, 'filed before the newest lesson');
  assert.equal(Core.videoPlaylistCurrent({ n: 3, at: 0 }, recs), true, 'an older filing with no time still counts');
  assert.equal(Core.videoPlaylistCurrent({ n: 0, at: at }, []), false);
  assert.equal(Core.videoPlaylistCurrent(null, recs), false);
});

test('the recorded lessons are grouped by the day of the class, first lesson first', () => {
  const day = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  const days = Core.recordingDays([
    { id: 'n2', at: day(12, 18), duration: 600 },
    { id: 'o', at: day(5, 17), duration: 2460 },
    { id: 'n1', at: day(12, 17), duration: 60 },
    { id: 'old', at: 0, duration: 30 }
  ], day(13, 9));
  assert.deepEqual(days.map((d) => d.key), ['2026-11-05', '2026-11-12']);
  assert.deepEqual(days.map((d) => d.label), ['Thu 5 Nov', 'Thu 12 Nov']);
  assert.deepEqual(days.map((d) => d.count), [1, 2]);
  assert.deepEqual(days[1].ids, ['n2', 'n1']);
  assert.equal(days[1].seconds, 660);
  assert.equal(days[1].at, day(12, 17));
  assert.deepEqual(Core.recordingDays([]), []);
  // The timeline hands both to the page.
  const course = { worksheetIds: ['w1'], currentIndex: 0, releasedThrough: 0 };
  const items = Core.timelineItems(course, { w1: { name: 'WS', videoPlaylist: { hash: VP_HASH, token: VP_TOKEN, n: 1, at: day(12, 19) } } },
    { w1: [{ id: 'n1', at: day(12, 17), duration: 60 }] });
  assert.equal(items[0].playlist.hash, VP_HASH);
  assert.equal(items[0].days.length, 1);
});
