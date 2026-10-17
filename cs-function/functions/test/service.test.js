// The whole /cs flow against in-memory Firestore and Storage: an admin
// uploads and publishes, a visitor unlocks with consent, the link streams the
// file a bounded number of times, and the admin reads, withdraws and erases
// leads. Nothing here can reach the real project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, isAdminToken, clientIp, downloadErrorPage, LIMITS, COLLECTIONS, ServiceError,
  PREVIEW_PREFIX, cleanPreviews } from '../service.js';
import { CONSENT_TEXT, CONSENT_VERSION, leadIdFor } from '../validate.js';
import { FakeFirestore, FakeBucket, fakeRandom, fakeClock } from './fakes.js';

const ADMIN = { uid: 'admin-uid', token: { email: 'chungzhikai@gmail.com', email_verified: true } };
const STRANGER = { uid: 'x', token: { email: 'someone@example.com', email_verified: true } };
const UNVERIFIED = { uid: 'y', token: { email: 'chungzhikai@gmail.com', email_verified: false } };

function setup() {
  const db = new FakeFirestore(), bucket = new FakeBucket(), now = fakeClock();
  const service = createService({ db, bucket, now, random: fakeRandom(7), downloadUrl: 'https://dl.example/csDownload' });
  return { db, bucket, now, service };
}

async function addFile(ctx, { fileId = 'file_heat01', title = 'P6 Heat cheat sheet', published = true, bytes = '%PDF-1.7 heat' } = {}) {
  const storagePath = 'cs-files/' + fileId + '/Heat.pdf';
  ctx.bucket.put(storagePath, bytes);
  return ctx.service.admin({ action: 'createFile', fileId, storagePath, fileName: 'Heat.pdf', title,
    description: 'Everything about heat.', published }, ADMIN);
}

function visitor(overrides = {}) {
  return { fileId: 'file_heat01', name: 'Tan Wei Ming', email: 'mum@example.com', whatsapp: '9123 4567',
    consent: true, consentVersion: CONSENT_VERSION, website: '', elapsedMs: 8000, ...overrides };
}

const keyOf = url => new URL(url).searchParams.get('k');

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test('only a verified admin email can use the admin actions', async () => {
  const { service } = setup();
  assert.equal(isAdminToken(ADMIN), true);
  assert.equal(isAdminToken(STRANGER), false);
  assert.equal(isAdminToken(UNVERIFIED), false);
  assert.equal(isAdminToken({ token: { email: 'CHUNGZHIKAI@gmail.com', email_verified: true } }), true);
  await assert.rejects(service.admin({ action: 'overview' }, null), e => e.code === 'unauthenticated');
  await assert.rejects(service.admin({ action: 'overview' }, STRANGER), e => e.code === 'permission-denied');
  await assert.rejects(service.admin({ action: 'overview' }, UNVERIFIED), e => e.code === 'permission-denied');
  await assert.rejects(service.admin({ action: 'constructor' }, ADMIN), e => e.code === 'invalid-argument');
  await assert.rejects(service.admin({ action: '__proto__' }, ADMIN), e => e.code === 'invalid-argument');
  const o = await service.admin({ action: 'overview' }, ADMIN);
  assert.deepEqual(o.files, []);
  assert.equal(o.stats.leads, 0);
});

test('the public list shows published files only, and never a storage path', async () => {
  const ctx = setup();
  await addFile(ctx);
  await addFile(ctx, { fileId: 'file_hidden1', title: 'Draft', published: false });
  const list = await ctx.service.listFiles();
  assert.equal(list.files.length, 1);
  assert.equal(list.files[0].id, 'file_heat01');
  assert.equal(list.files[0].title, 'P6 Heat cheat sheet');
  assert.equal(list.files[0].ext, 'pdf');
  assert.equal(list.consent.version, CONSENT_VERSION);
  assert.equal(list.consent.text, CONSENT_TEXT);
  const json = JSON.stringify(list);
  assert.ok(!json.includes('cs-files/'), 'no storage path leaves the server');
  assert.ok(!json.includes('storagePath'));
  for (const key of ['unlocks', 'downloads', 'published', 'order', 'storagePath', 'createdAt'])
    assert.ok(!(key in list.files[0]), 'no ' + key + ' for the public');
  assert.equal(list.featuredId, 'file_heat01');
});

test('createFile verifies the upload really is in the file\'s own folder', async () => {
  const ctx = setup();
  ctx.bucket.put('cs-files/other_file/x.pdf', 'x');
  await assert.rejects(ctx.service.admin({ action: 'createFile', fileId: 'file_abc123', storagePath: 'cs-files/other_file/x.pdf', title: 'X' }, ADMIN),
    e => e.code === 'invalid-argument');
  await assert.rejects(ctx.service.admin({ action: 'createFile', fileId: 'file_abc123', storagePath: 'cs-files/file_abc123/missing.pdf', title: 'X' }, ADMIN),
    e => e.code === 'not-found');
  ctx.bucket.put('cs-files/file_abc123/empty.pdf', '');
  await assert.rejects(ctx.service.admin({ action: 'createFile', fileId: 'file_abc123', storagePath: 'cs-files/file_abc123/empty.pdf', title: 'X' }, ADMIN),
    e => /empty/.test(e.message));
  await addFile(ctx, { fileId: 'file_abc123' });
  await assert.rejects(addFile(ctx, { fileId: 'file_abc123' }), e => e.code === 'already-exists');
  const doc = ctx.db.dump(COLLECTIONS.files).file_abc123;
  assert.equal(doc.size, '%PDF-1.7 heat'.length, 'the size comes from Storage, not from the browser');
  assert.equal(doc.contentType, 'application/pdf');
});

test('a visitor with consent becomes ONE lead and gets a link that streams the file', async () => {
  const ctx = setup();
  await addFile(ctx);
  const r = await ctx.service.unlock(visitor(), { ip: '203.0.113.9', userAgent: 'Test/1.0' });
  assert.match(r.downloadUrl, /^https:\/\/dl\.example\/csDownload\?k=[A-Za-z0-9_-]{43}$/);
  assert.equal(r.fileName, 'Heat.pdf');
  assert.equal(r.visitor.whatsapp, '+6591234567');
  assert.equal(r.returning, false);

  const leads = ctx.db.dump(COLLECTIONS.leads);
  const id = leadIdFor('mum@example.com');
  assert.deepEqual(Object.keys(leads), [id]);
  const lead = leads[id];
  assert.equal(lead.name, 'Tan Wei Ming');
  assert.equal(lead.email, 'mum@example.com');
  assert.equal(lead.whatsapp, '+6591234567');
  assert.equal(lead.consentActive, true);
  assert.equal(lead.consent.version, CONSENT_VERSION);
  assert.equal(lead.consent.text, CONSENT_TEXT, 'the exact words agreed to are kept with the lead');
  assert.deepEqual(lead.consent.channels, ['email', 'whatsapp']);
  assert.equal(lead.unlockCount, 1);
  assert.deepEqual(lead.fileIds, ['file_heat01']);
  assert.equal(lead.consentHistory.length, 1);
  assert.equal(lead.consentHistory[0].action, 'granted');
  const events = ctx.db.dump(COLLECTIONS.leads + '/' + id + '/unlocks');
  assert.equal(Object.keys(events).length, 1);
  const event = Object.values(events)[0];
  assert.equal(event.fileId, 'file_heat01');
  assert.ok(!JSON.stringify(event).includes('203.0.113.9'), 'the raw IP is never stored');
  assert.equal(ctx.db.dump(COLLECTIONS.files).file_heat01.unlocks, 1);

  const opened = await ctx.service.openDownload(keyOf(r.downloadUrl));
  assert.equal(opened.headers['Content-Type'], 'application/pdf');
  assert.match(opened.headers['Content-Disposition'], /^attachment; filename="Heat\.pdf"/);
  assert.equal(opened.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(await readAll(opened.object.createReadStream()), '%PDF-1.7 heat');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(ctx.db.dump(COLLECTIONS.files).file_heat01.downloads, 1);
});

test('the same email unlocking again updates the one row and keeps the history', async () => {
  const ctx = setup();
  await addFile(ctx);
  await addFile(ctx, { fileId: 'file_light1', title: 'Light' });
  await ctx.service.unlock(visitor(), { ip: '1.1.1.1' });
  ctx.now.advance(60_000);
  const again = await ctx.service.unlock(visitor({ fileId: 'file_light1', email: 'MUM@example.com', name: 'Tan W. M.', whatsapp: '+65 8123 4567' }), { ip: '1.1.1.1' });
  assert.equal(again.returning, true);
  const leads = ctx.db.dump(COLLECTIONS.leads);
  assert.equal(Object.keys(leads).length, 1);
  const lead = Object.values(leads)[0];
  assert.equal(lead.unlockCount, 2);
  assert.deepEqual(lead.fileIds, ['file_heat01', 'file_light1']);
  assert.equal(lead.whatsapp, '+6581234567', 'the newest number is the one used');
  assert.deepEqual(lead.whatsappHistory, ['+6591234567', '+6581234567'], 'the old one is not lost');
  assert.deepEqual(lead.nameHistory, ['Tan Wei Ming', 'Tan W. M.']);
  assert.equal(lead.consentHistory.length, 1, 'reaffirming the same wording is not a new history entry');
  assert.ok(lead.consent.lastAffirmedAt > lead.consent.at);
});

test('no consent, an old consent wording, or a hidden file: nothing is stored', async () => {
  const ctx = setup();
  await addFile(ctx);
  await addFile(ctx, { fileId: 'file_hidden1', published: false });
  await assert.rejects(ctx.service.unlock(visitor({ consent: false })), e => e.code === 'invalid-argument' && e.details.field === 'consent');
  await assert.rejects(ctx.service.unlock(visitor({ consentVersion: 'old' })), e =>
    e.code === 'failed-precondition' && e.details.consent.version === CONSENT_VERSION && e.details.consent.text === CONSENT_TEXT);
  await assert.rejects(ctx.service.unlock(visitor({ fileId: 'file_hidden1' })), e => e.code === 'not-found');
  await assert.rejects(ctx.service.unlock(visitor({ fileId: 'file_nothere' })), e => e.code === 'not-found');
  await assert.rejects(ctx.service.unlock(visitor({ website: 'spam' })), e => e.code === 'invalid-argument');
  assert.deepEqual(ctx.db.dump(COLLECTIONS.leads), {});
  assert.deepEqual(ctx.db.dump(COLLECTIONS.grants), {});
});

test('rate limits: per address, per email, and they reset with the hour', async () => {
  const ctx = setup();
  await addFile(ctx);
  for (let i = 0; i < LIMITS.unlockPerIpHour; i++)
    await ctx.service.unlock(visitor({ email: 'p' + i + '@example.com' }), { ip: '9.9.9.9' });
  await assert.rejects(ctx.service.unlock(visitor({ email: 'late@example.com' }), { ip: '9.9.9.9' }), e => e.code === 'resource-exhausted');
  // A different address is not punished for the first one.
  await ctx.service.unlock(visitor({ email: 'other@example.com' }), { ip: '8.8.8.8' });
  ctx.now.advance(60 * 60 * 1000);
  await ctx.service.unlock(visitor({ email: 'late@example.com' }), { ip: '9.9.9.9' });

  const ctx2 = setup();
  await addFile(ctx2);
  for (let i = 0; i < LIMITS.unlockPerEmailHour; i++)
    await ctx2.service.unlock(visitor(), { ip: '10.0.0.' + i });
  await assert.rejects(ctx2.service.unlock(visitor(), { ip: '10.0.1.1' }), e => e.code === 'resource-exhausted');
});

test('a link is bounded: a few uses, 24 hours, and HEAD does not spend one', async () => {
  const ctx = setup();
  await addFile(ctx);
  const r = await ctx.service.unlock(visitor(), { ip: '1.2.3.4' });
  const key = keyOf(r.downloadUrl);
  await ctx.service.openDownload(key, { method: 'HEAD' });
  for (let i = 0; i < LIMITS.grantUses; i++) await ctx.service.openDownload(key);
  await assert.rejects(ctx.service.openDownload(key), e => e.details.status === 410 && /used up/.test(e.message));

  const r2 = await ctx.service.unlock(visitor(), { ip: '1.2.3.4' });
  ctx.now.advance(LIMITS.grantTtlMs + 1);
  await assert.rejects(ctx.service.openDownload(keyOf(r2.downloadUrl)), e => e.details.status === 410 && /expired/.test(e.message));
  await assert.rejects(ctx.service.openDownload('nope'), e => e.details.status === 404);
  await assert.rejects(ctx.service.openDownload('A'.repeat(43)), e => e.details.status === 404);
  // Keys are stored only as hashes: the grant id is not the key.
  const grants = ctx.db.dump(COLLECTIONS.grants);
  assert.ok(!Object.keys(grants).includes(key));
});

test('a deleted file takes its objects with it, and an old link then says so', async () => {
  const ctx = setup();
  await addFile(ctx);
  const r = await ctx.service.unlock(visitor(), { ip: '1.2.3.4' });
  ctx.bucket.put(PREVIEW_PREFIX + 'file_heat01/a-0.jpg', 'jpg');
  const d = await ctx.service.admin({ action: 'deleteFile', fileId: 'file_heat01' }, ADMIN);
  assert.equal(d.deleted, true);
  assert.equal(d.objectsRemoved, 2);
  assert.equal(ctx.bucket.objects.size, 0);
  await assert.rejects(ctx.service.openDownload(keyOf(r.downloadUrl)), e => e.details.status === 410);
  assert.deepEqual((await ctx.service.listFiles()).files, []);
});

test('admin edits: hide/show, rename, reorder, replace, and the test link', async () => {
  const ctx = setup();
  await addFile(ctx);
  await addFile(ctx, { fileId: 'file_light1', title: 'Light' });
  await ctx.service.admin({ action: 'updateFile', fileId: 'file_heat01', published: false }, ADMIN);
  assert.deepEqual((await ctx.service.listFiles()).files.map(f => f.id), ['file_light1']);
  await ctx.service.admin({ action: 'updateFile', fileId: 'file_heat01', published: true, title: 'Heat (2026)' }, ADMIN);
  await assert.rejects(ctx.service.admin({ action: 'updateFile', fileId: 'file_heat01', title: '' }, ADMIN), e => e.code === 'invalid-argument');
  await ctx.service.admin({ action: 'reorder', ids: ['file_light1', 'file_heat01'] }, ADMIN);
  assert.deepEqual((await ctx.service.listFiles()).files.map(f => f.id), ['file_light1', 'file_heat01']);
  await ctx.service.admin({ action: 'reorder', ids: ['file_heat01', 'file_light1'] }, ADMIN);
  assert.deepEqual((await ctx.service.listFiles()).files.map(f => f.title), ['Heat (2026)', 'Light']);

  ctx.bucket.put('cs-files/file_heat01/Heat v2.pdf', '%PDF v2 longer');
  const rep = await ctx.service.admin({ action: 'replaceFile', fileId: 'file_heat01', storagePath: 'cs-files/file_heat01/Heat v2.pdf', fileName: 'Heat v2.pdf' }, ADMIN);
  assert.equal(rep.file.fileName, 'Heat v2.pdf');
  assert.equal(ctx.bucket.objects.has('cs-files/file_heat01/Heat.pdf'), false, 'the replaced copy is removed');

  const link = await ctx.service.admin({ action: 'adminLink', fileId: 'file_heat01' }, ADMIN);
  const opened = await ctx.service.openDownload(keyOf(link.downloadUrl));
  assert.equal(await readAll(opened.object.createReadStream()), '%PDF v2 longer');
  assert.deepEqual(ctx.db.dump(COLLECTIONS.leads), {}, 'the admin\'s own test link is not a lead');
});

test('leads: listed newest first, exported, withdrawn, undone, and erased', async () => {
  const ctx = setup();
  await addFile(ctx);
  for (let i = 0; i < 5; i++) {
    ctx.now.advance(1000);
    await ctx.service.unlock(visitor({ email: 'p' + i + '@example.com', name: 'Parent ' + 'ABCDE'[i] }), { ip: 'ip' + i });
  }
  const page = await ctx.service.admin({ action: 'leads', limit: 2 }, ADMIN);
  assert.deepEqual(page.leads.map(l => l.email), ['p4@example.com', 'p3@example.com']);
  assert.equal(page.more, true);
  const page2 = await ctx.service.admin({ action: 'leads', limit: 2, before: page.next }, ADMIN);
  assert.deepEqual(page2.leads.map(l => l.email), ['p2@example.com', 'p1@example.com']);
  const all = await ctx.service.admin({ action: 'exportLeads' }, ADMIN);
  assert.equal(all.leads.length, 5);

  const id = leadIdFor('p2@example.com');
  const w = await ctx.service.admin({ action: 'setConsent', leadId: id, withdrawn: true }, ADMIN);
  assert.equal(w.lead.consentActive, false);
  assert.ok(w.lead.withdrawnAt > 0);
  const o = await ctx.service.admin({ action: 'overview' }, ADMIN);
  assert.equal(o.stats.leads, 5);
  assert.equal(o.stats.consenting, 4);
  const u = await ctx.service.admin({ action: 'setConsent', leadId: id, withdrawn: false }, ADMIN);
  assert.equal(u.lead.consentActive, true);
  const h = await ctx.service.admin({ action: 'leadHistory', leadId: id }, ADMIN);
  assert.deepEqual(h.consentHistory.map(e => e.action), ['granted', 'withdrawn', 'withdrawal undone']);
  assert.equal(h.unlocks.length, 1);
  assert.equal(h.consentText, CONSENT_TEXT);

  // Withdrawn, then the person unlocks again and ticks the box: consent is theirs again.
  await ctx.service.admin({ action: 'setConsent', leadId: id, withdrawn: true }, ADMIN);
  await ctx.service.unlock(visitor({ email: 'p2@example.com' }), { ip: 'again' });
  const back = (await ctx.service.admin({ action: 'leadHistory', leadId: id }, ADMIN));
  assert.equal(back.lead.consentActive, true);
  assert.equal(back.consentHistory.at(-1).action, 'regranted');

  const del = await ctx.service.admin({ action: 'deleteLead', leadId: id }, ADMIN);
  assert.equal(del.deleted, true);
  assert.equal(del.events, 2);
  assert.equal(ctx.db.dump(COLLECTIONS.leads)[id], undefined);
  assert.deepEqual(ctx.db.dump(COLLECTIONS.leads + '/' + id + '/unlocks'), {});
  await assert.rejects(ctx.service.admin({ action: 'leadHistory', leadId: id }, ADMIN), e => e.code === 'not-found');
  await assert.rejects(ctx.service.admin({ action: 'deleteLead', leadId: 'nope' }, ADMIN), e => e.code === 'invalid-argument');
});

test('the server-side upload fallback composes chunks into the file\'s folder', async () => {
  const ctx = setup();
  const text = 'abcdefghijklmnopqrstuvwxyz';
  const pieces = ['abcdefghi', 'jklmnopqr', 'stuvwxyz'];
  for (let i = 0; i < pieces.length; i++)
    await ctx.service.admin({ action: 'uploadChunk', fileId: 'file_up0001', uploadId: 'up12345678', index: i, total: 3,
      data: Buffer.from(pieces[i]).toString('base64') }, ADMIN);
  await assert.rejects(ctx.service.admin({ action: 'uploadFinish', fileId: 'file_up0001', uploadId: 'up12345678', total: 4,
    fileName: 'A.pdf' }, ADMIN), e => /missing/.test(e.message));
  const done = await ctx.service.admin({ action: 'uploadFinish', fileId: 'file_up0001', uploadId: 'up12345678', total: 3,
    fileName: 'Alphabet notes.pdf', contentType: 'application/pdf' }, ADMIN);
  assert.equal(done.storagePath, 'cs-files/file_up0001/Alphabet notes.pdf');
  assert.equal(done.size, text.length);
  assert.equal(ctx.bucket.objects.get(done.storagePath).bytes.toString(), text);
  assert.deepEqual([...ctx.bucket.objects.keys()].filter(k => k.includes('.parts')), [], 'parts are cleaned up');
  const created = await ctx.service.admin({ action: 'createFile', fileId: 'file_up0001', storagePath: done.storagePath, title: 'Alphabet' }, ADMIN);
  assert.equal(created.file.size, text.length);
  await assert.rejects(ctx.service.admin({ action: 'uploadChunk', fileId: 'file_up0001', uploadId: 'up12345678', index: 5, total: 3, data: 'YQ==' }, ADMIN),
    e => e.code === 'invalid-argument');
});

test('the upload fallback folds more than 32 chunks in rounds', async () => {
  const ctx = setup();
  // 34 chunks of 3 MB is the most a 100 MB file can need — past compose's 32.
  const total = 34;
  for (let i = 0; i < total; i++)
    await ctx.service.admin({ action: 'uploadChunk', fileId: 'file_big001', uploadId: 'bigupload1', index: i, total,
      data: Buffer.from(String(i).padStart(2, '0')).toString('base64') }, ADMIN);
  const done = await ctx.service.admin({ action: 'uploadFinish', fileId: 'file_big001', uploadId: 'bigupload1', total, fileName: 'big.pdf' }, ADMIN);
  const want = Array.from({ length: total }, (_, i) => String(i).padStart(2, '0')).join('');
  assert.equal(ctx.bucket.objects.get(done.storagePath).bytes.toString(), want, 'order is kept across rounds');
});

// A minimal valid-looking JPEG: the three magic bytes and some padding.
const jpeg = () => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(400, 7)]).toString('base64');

test('booklet pages: stored publicly in their own folder, replaced cleanly, featured once', async () => {
  const ctx = setup();
  await addFile(ctx);
  await addFile(ctx, { fileId: 'file_light1', title: 'Light' });
  await assert.rejects(ctx.service.admin({ action: 'savePreviews', fileId: 'file_heat01', pages: [{ data: Buffer.from('not a jpeg at all').toString('base64'), w: 600, h: 800 }] }, ADMIN),
    e => /JPEG/.test(e.message));
  await assert.rejects(ctx.service.admin({ action: 'savePreviews', fileId: 'file_heat01', pages: Array(9).fill({ data: jpeg(), w: 600, h: 800 }) }, ADMIN),
    e => /at most/.test(e.message));
  const saved = await ctx.service.admin({ action: 'savePreviews', fileId: 'file_heat01', pageCount: 12,
    pages: [1, 2, 3, 4].map(page => ({ data: jpeg(), w: 600, h: 848, page })) }, ADMIN);
  assert.equal(saved.file.previews.length, 4);
  assert.equal(saved.file.pageCount, 12);
  for (const p of saved.file.previews) {
    assert.match(p.url, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/mathgen--app\.firebasestorage\.app\/o\/cs-previews%2Ffile_heat01%2F.+\.jpg\?alt=media&token=[0-9a-f-]{36}$/);
  }
  const objects = [...ctx.bucket.objects.keys()].filter(k => k.startsWith(PREVIEW_PREFIX));
  assert.equal(objects.length, 4);
  const meta = ctx.bucket.objects.get(objects[0]).metadata;
  assert.equal(meta.contentType, 'image/jpeg');
  assert.match(meta.metadata.firebaseStorageDownloadTokens, /^[0-9a-f-]{36}$/);

  // The public list carries the pages (that is their job) but still no file path.
  const list = await ctx.service.listFiles();
  const heat = list.files.find(f => f.id === 'file_heat01');
  assert.equal(heat.previews.length, 4);
  assert.equal(list.featuredId, 'file_heat01', 'the first file with pages is in the booklet');
  assert.ok(!JSON.stringify(list).includes('cs-files/'));

  // Saving again replaces the old pages; nothing is left behind.
  ctx.now.advance(5000);
  await ctx.service.admin({ action: 'savePreviews', fileId: 'file_heat01', pages: [{ data: jpeg(), w: 600, h: 848, page: 2 }] }, ADMIN);
  assert.equal([...ctx.bucket.objects.keys()].filter(k => k.startsWith(PREVIEW_PREFIX)).length, 1);

  await ctx.service.admin({ action: 'savePreviews', fileId: 'file_light1', pages: [{ data: jpeg(), w: 600, h: 848, page: 1 }] }, ADMIN);
  await ctx.service.admin({ action: 'setFeatured', fileId: 'file_light1' }, ADMIN);
  assert.equal((await ctx.service.listFiles()).featuredId, 'file_light1');
  await ctx.service.admin({ action: 'setFeatured', fileId: 'file_heat01' }, ADMIN);
  const files = ctx.db.dump(COLLECTIONS.files);
  assert.equal(files.file_heat01.featured, true);
  assert.equal(files.file_light1.featured, false, 'only one file is featured at a time');

  await ctx.service.admin({ action: 'clearPreviews', fileId: 'file_heat01' }, ADMIN);
  assert.equal([...ctx.bucket.objects.keys()].filter(k => k.startsWith(PREVIEW_PREFIX + 'file_heat01/')).length, 0);
  assert.equal((await ctx.service.listFiles()).featuredId, 'file_light1', 'a featured file with no pages yields to one that has them');
});

test('preview URLs that point anywhere else are dropped', () => {
  const ok = 'https://firebasestorage.googleapis.com/v0/b/b1/o/' + encodeURIComponent('cs-previews/f1/') + 'x.jpg?alt=media&token=t';
  const list = cleanPreviews([{ url: ok, w: 10, h: 10 }, { url: 'https://evil.example/x.jpg' },
    { url: ok.replace('f1', 'f2') }, null, 'x'], 'f1', 'b1');
  assert.equal(list.length, 1);
  assert.equal(list[0].url, ok);
});

test('housekeeping removes expired counters and links only', async () => {
  const ctx = setup();
  await addFile(ctx);
  await ctx.service.unlock(visitor(), { ip: '1.1.1.1' });
  assert.ok(Object.keys(ctx.db.dump(COLLECTIONS.limits)).length >= 3);
  assert.equal(await ctx.service.cleanup(), 0);
  ctx.now.advance(LIMITS.grantTtlMs + 3 * 60 * 60 * 1000);
  const removed = await ctx.service.cleanup();
  assert.ok(removed >= 4);
  assert.deepEqual(ctx.db.dump(COLLECTIONS.limits), {});
  assert.deepEqual(ctx.db.dump(COLLECTIONS.grants), {});
  assert.equal(Object.keys(ctx.db.dump(COLLECTIONS.leads)).length, 1, 'leads are never swept');
});

test('helpers: the client address, and an error page that cannot run anything', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }), '203.0.113.5');
  assert.equal(clientIp({ headers: {}, ip: '::ffff:198.51.100.7' }), '198.51.100.7');
  assert.equal(clientIp(null), 'unknown');
  const page = downloadErrorPage(410, '<img src=x onerror=alert(1)>');
  assert.ok(!page.includes('<img'));
  assert.ok(!/<script/i.test(page));
  assert.match(page, /24 hours/);
  assert.match(page, /polymathlc\.com\.sg\/cs/);
  assert.ok(new ServiceError('not-found', 'x') instanceof Error);
});
