// node --test tools/firebase-backup-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as B from './firebase-backup-core.mjs';
import { buildBackup } from './firebase-backup.mjs';
import { parseArgs, collectFromZips, selectCollections } from './firebase-restore.mjs';

class Timestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } toDate() { return new Date(this.seconds * 1000); } }
class GeoPoint { constructor(a, b) { this.latitude = a; this.longitude = b; } }
class DocumentReference { constructor(p) { this.path = p; } }
const types = { Timestamp, GeoPoint, DocumentReference };
const NOW = Date.UTC(2026, 10, 13, 16, 3, 0); // 14 Nov 2026, 12:03 AM in Singapore

test('recipients are exactly the two inboxes', () => {
  assert.deepEqual([...B.BACKUP_RECIPIENTS], ['admin@polymathlc.com.sg', 'chungzhikai@gmail.com']);
  const doc = B.mailDoc({ message: { subject: 's', html: 'h', text: 't' }, attachments: [] });
  assert.deepEqual(doc.to, ['admin@polymathlc.com.sg', 'chungzhikai@gmail.com']);
  assert.equal(doc.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(doc.bcc, undefined);
  assert.equal(doc.cc, undefined);
});

test('values survive encode → JSON → decode', () => {
  const original = {
    when: new Timestamp(1763049600, 123000000),
    where: new GeoPoint(1.35, 103.8),
    who: new DocumentReference('officeFamilies/abc'),
    blob: Buffer.from([1, 2, 3, 250]),
    tricky: { __type: 'not a tag', n: 1 },
    list: [1, 'two', null, { deep: new Timestamp(1, 0) }],
    nan: NaN,
    plain: 'hello', yes: true, zero: 0
  };
  const json = JSON.parse(JSON.stringify(B.encodeValue(original, types)));
  assert.equal(json.when.__type, 'timestamp');
  assert.equal(json.when.iso, '2025-11-13T16:00:00.123Z');
  assert.equal(json.tricky.__type, 'map');
  const back = B.decodeValue(json, {
    timestamp: (s, n) => new Timestamp(s, n), geopoint: (a, b) => new GeoPoint(a, b), ref: p => new DocumentReference(p), bytes: b => b
  });
  assert.deepEqual(back.when, new Timestamp(1763049600, 123000000));
  assert.deepEqual(back.where, new GeoPoint(1.35, 103.8));
  assert.equal(back.who.path, 'officeFamilies/abc');
  assert.deepEqual([...back.blob], [1, 2, 3, 250]);
  assert.deepEqual(back.tricky, { __type: 'not a tag', n: 1 });
  assert.equal(back.list[3].deep.seconds, 1);
  assert.ok(Number.isNaN(back.nan));
  assert.equal(back.plain, 'hello');
  assert.equal(back.zero, 0);
  // Without makers, times come back as ISO strings (what the office code reads).
  assert.equal(B.decodeValue(json).when, '2025-11-13T16:00:00.123Z');
});

test('collections are sorted into the right emails, logs and limits skipped', () => {
  for (const id of ['officeFamilies', 'officeInvoices', 'officePayments', 'schedule_bookings', 'schedule_config', 'shop_orders', 'studentAccess', 'polymathEnquiryRequests', 'june2026_registrations', 'officeSomethingNew'])
    assert.ok(B.isEssential(id), id);
  assert.ok(B.isEssential('csLeads/L1/unlocks'));
  for (const id of ['questionAttempts', 'tutorWorksheets', 'users', 'awards']) assert.ok(!B.isEssential(id), id);
  assert.ok(B.skipReason('mail'));
  assert.ok(B.skipReason('loginEvents'));
  assert.ok(B.skipReason('zhLoginEvents'));
  assert.ok(B.skipReason('shop_checkout_limits'));
  assert.ok(B.skipReason('polymathEnquiryLimits'));
  assert.ok(B.skipReason('worksheets'));
  assert.equal(B.skipReason('officeFamilies'), '');
  assert.equal(B.skipReason('user_worksheets'), '');
  assert.equal(B.skipReason('tutorWorksheets'), '');
});

test('the zip opens with the system unzip and with our reader', () => {
  const entries = [
    B.prepareEntry('README.txt', 'hello\r\n'),
    B.prepareEntry('firestore/users/u1/settings.json', JSON.stringify({ a: 1 })),
    B.prepareEntry('csv/名字.csv', '﻿name\r\n陈\r\n'),
    B.prepareEntry('random.bin', randomBytes(5000)) // incompressible → stored
  ];
  const zip = B.writeZip(entries, NOW);
  assert.equal(zip.length, B.zipSizeOf(entries));
  const files = B.readZip(zip);
  assert.deepEqual(files.map(f => f.name), entries.map(e => e.name));
  assert.equal(files[1].data.toString(), '{"a":1}');
  assert.equal(files[3].data.length, 5000);
  const dir = mkdtempSync(join(tmpdir(), 'backup-zip-'));
  writeFileSync(join(dir, 'x.zip'), zip);
  let unzip = null;
  try { unzip = execFileSync('unzip', ['-t', join(dir, 'x.zip')], { encoding: 'utf8' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (unzip !== null) assert.match(unzip, /No errors detected/);
});

test('CSV quoting, BOM and formula-safe cells', () => {
  const csv = B.documentsCsv([
    { id: 'a', data: { name: 'Tan, Ah Kow', note: 'said "hi"', when: { __type: 'timestamp', seconds: 1763049600, nanos: 0, iso: '' } } },
    { id: 'b', data: { name: '=HYPERLINK("x")', extra: { k: [1, 2] } } }
  ]);
  assert.ok(csv.startsWith('﻿id,name,note,when,extra\r\n'));
  assert.match(csv, /"Tan, Ah Kow"/);
  assert.match(csv, /"said ""hi"""/);
  assert.match(csv, /2025-11-14 00:00/);
  assert.match(csv, /"=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"\{""k"":\[1,2\]\}"/);
});

test('Singapore dates', () => {
  assert.equal(B.sgDateKey(NOW), '2026-11-14');
  assert.equal(B.prettySgDate(NOW), '14 Nov 2026');
  assert.equal(B.prettySgTime(NOW), '12:03 AM');
});

function fakeEntry(path, bytes, essential) {
  const e = B.prepareEntry(B.collectionFileName(path), randomBytes(bytes), { path, count: 1, essential });
  return e;
}

test('planEmails keeps the office email under budget and the full zip under its limit', () => {
  const entries = [
    fakeEntry('officeFamilies', 2000, true),
    fakeEntry('officeInvoices', 3000, true),
    fakeEntry('schedule_bookings', 40000, true),
    fakeEntry('questionAttempts', 50000, false),
    fakeEntry('tutorWorksheets', 90000, false),
    fakeEntry('users', 1000, false)
  ];
  const plan = B.planEmails(entries, { inlineBudget: 20000, linkedLimit: 100000 });
  assert.deepEqual(plan.inline.map(e => e.meta.path), ['officeFamilies', 'officeInvoices']);
  assert.deepEqual(plan.movedToFull.map(e => e.meta.path), ['schedule_bookings']);
  assert.deepEqual(plan.leftOut.map(e => e.meta.path), ['tutorWorksheets']);
  assert.ok(B.zipSizeOf(plan.linked) <= 100000);
  assert.ok(plan.linked.some(e => e.meta.path === 'schedule_bookings'));
});

test('packInlineParts fills small parts first and stops at the part cap', () => {
  const entries = [fakeEntry('a', 300, false), fakeEntry('b', 300, false), fakeEntry('c', 300, false), fakeEntry('d', 5000, false)];
  const { parts, leftOut } = B.packInlineParts(entries, { partLimit: 1000, maxParts: 1 });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].length, 2);
  assert.ok(parts.every(p => B.zipSizeOf(p) <= 1000));
  assert.deepEqual(leftOut.map(e => e.meta.path).sort(), ['c', 'd']);
});

test('emails name what is attached and never contain record data', () => {
  const entries = [Object.assign(fakeEntry('officeFamilies', 100, true), { meta: { path: 'officeFamilies', count: 26, essential: true } })];
  const m = B.inlineEmail({ nowMs: NOW, entries, attachments: [{ filename: 'polymath-office-backup-2026-11-14.zip' }], otherEmail: 'The full data backup arrives in a second email.', problems: [] });
  assert.match(m.subject, /2026-11-14/);
  assert.match(m.html, /Office — families and students/);
  assert.match(m.html, /polymath-office-backup-2026-11-14\.zip/);
  assert.match(m.html, /second email/);
  const f = B.fullEmail({ nowMs: NOW, entries, leftOut: [], skipped: [{ path: 'mail', reason: 'log' }], partIndex: 0, partCount: 1, zipBytes: 1234, linked: true });
  assert.match(f.subject, /full data/);
  assert.match(f.html, /Not included/);
});

test('a whole backup builds, fits, and restores back to the same documents', async () => {
  const exported = (docs) => docs.map(([id, data]) => ({ id, data: B.encodeValue(data, types) }));
  const found = [
    { path: 'officeFamilies', docs: exported([['f1', { parentName: 'Mdm Tan', email: 'tan@example.com', whatsapp: '91234567', status: 'active', students: [{ id: 's1', name: 'Ah Boy', level: 'P5', status: 'active', classes: [] }], createdAt: new Timestamp(1763049600, 0) }]]) },
    { path: 'officeInvoices', docs: exported([['f1_2026-11', { familyId: 'f1', period: '2026-11', total: 280, status: 'paid' }]]) },
    { path: 'schedule_config', docs: exported([['main', { slots: [] }]]) },
    { path: 'questionAttempts', docs: exported(Array.from({ length: 300 }, (_, i) => ['q' + i, { uid: 'u' + (i % 7), correct: i % 2 === 0, at: new Timestamp(1763000000 + i, 0) }])) },
    { path: 'users/u1/settings', docs: exported([['prefs', { theme: 'dark' }]]) }
  ];
  const problems = [];
  const built = await buildBackup({ found, skipped: [{ path: 'mail', reason: 'log' }], authUsers: [{ uid: 'u1', email: 'kid@example.com', providerData: [] }], storageIndex: [], nowMs: NOW, problems });
  assert.ok(built.officeZip.length < B.INLINE_BASE64_BUDGET);
  assert.equal(built.fullParts.length, 1);
  const fullZip = built.fullParts[0].zip;
  assert.ok(fullZip.length < B.LINKED_PART_LIMIT);
  const officeFiles = B.readZip(built.officeZip).map(f => f.name);
  for (const n of ['README.txt', 'backup-manifest.json', 'firestore/officeFamilies.json', 'firestore/officeInvoices.json', 'auth/users.json', 'csv/officeFamilies.csv'])
    assert.ok(officeFiles.includes(n), n + ' in office zip');
  assert.ok(!officeFiles.includes('firestore/questionAttempts.json'));
  const fullFiles = B.readZip(fullZip).map(f => f.name);
  assert.ok(fullFiles.includes('firestore/questionAttempts.json'));
  assert.ok(fullFiles.includes('firestore/users/u1/settings.json'));

  const { collections, auth } = collectFromZips([{ name: 'office.zip', buffer: built.officeZip }, { name: 'full.zip', buffer: fullZip }]);
  assert.equal(collections.get('questionAttempts').length, 300);
  assert.equal(collections.get('users/u1/settings')[0].data.theme, 'dark');
  assert.equal(auth[0].uid, 'u1');
  const fam = B.decodeValue(collections.get('officeFamilies')[0].data, { timestamp: (s, n) => new Timestamp(s, n) });
  assert.equal(fam.parentName, 'Mdm Tan');
  assert.deepEqual(fam.createdAt, new Timestamp(1763049600, 0));
  assert.deepEqual(selectCollections(collections, ['users']), ['users/u1/settings']);
});

test('restore refuses to run without a project or a zip, and defaults to a dry run', () => {
  assert.throws(() => parseArgs(['x.zip']), /--project/);
  assert.throws(() => parseArgs(['--project', 'p']), /zip/);
  const o = parseArgs(['--project', 'p', '--only', 'officeFamilies, officeInvoices', 'a.zip', 'b.zip']);
  assert.equal(o.apply, false);
  assert.deepEqual(o.only, ['officeFamilies', 'officeInvoices']);
  assert.deepEqual(o.zips, ['a.zip', 'b.zip']);
});

test('the workflow runs at 12 AM Singapore time and keeps data out of artifacts', () => {
  const yml = readFileSync(new URL('../.github/workflows/firebase-backup.yml', import.meta.url), 'utf8');
  const cron = yml.match(/cron:\s*'(\d+) (\d+) \* \* \*'/);
  assert.ok(cron, 'has a daily cron');
  assert.equal(Number(cron[2]), 16, '16:xx UTC is 12:xx AM in Singapore');
  assert.ok(Number(cron[1]) < 15);
  assert.doesNotMatch(yml, /upload-artifact/);
  assert.match(yml, /rm -f "\$RUNNER_TEMP\/firebase-sa\.json"/);
});

test('the walk finds every subcollection, including under missing parents, without mixing scopes', async () => {
  const data = new Map(); // path -> data
  const add = (p, d) => data.set(p, d);
  add('awards/a1', {x:1});
  for (let i=0;i<10;i++){ add(`users/u${i}`, {n:i}); add(`users/u${i}/settings/s`, {t:i}); add(`users/u${i}/hist/h${i}`, {h:i}); add(`users/u${i}/hist/h${i}/deep/d`, {d:i}); }
  add('ghost/g1/sub/s1', {only:'sub'});
  add('csLeads/L1', {a:1}); add('csLeads/L1/unlocks/u', {b:1});
  add('other/o1/settings/s', {not:'users'});
  add('mail/m1', {});
  const seg = p => p.split('/').length;
  const FieldPath = { documentId: () => '__id' };
  function docsIn(colPath){ return [...data.keys()].filter(k=>k.startsWith(colPath+'/') && seg(k)===seg(colPath)+1).sort(); }
  function subcolsOf(docPath){ const s=new Set(); for(const k of data.keys()) if(k.startsWith(docPath+'/')) s.add(docPath+'/'+k.slice(docPath.length+1).split('/')[0]); return [...s].sort(); }
  function snapOf(path){ return { id: path.split('/').pop(), data: () => data.get(path), ref: docRef(path) }; }
  function query(listFn, lim, after){ return { orderBy(){ return this; }, limit(n){ return query(listFn, n, after); }, startAfter(d){ return query(listFn, lim, d.ref.path); },
    async get(){ let l=listFn(); if(after) l=l.filter(p=>p>after); l=l.slice(0, lim||1e9); return { docs: l.map(snapOf), size: l.length, empty: !l.length }; } }; }
  function colRef(path){ const q = query(() => docsIn(path)); return Object.assign(q, { path, id: path.split('/').pop(), doc: id => docRef(path+'/'+id),
    listDocuments: async () => { const s=new Set(); for(const k of data.keys()) if(k.startsWith(path+'/')) s.add(path+'/'+k.slice(path.length+1).split('/')[0]); return [...s].sort().map(docRef); } }); }
  function docRef(path){ return { path, id: path.split('/').pop(), get parent(){ return colRef(path.split('/').slice(0,-1).join('/')); }, listCollections: async () => subcolsOf(path).map(colRef) }; }
  const db = { listCollections: async () => [...new Set([...data.keys()].map(k=>k.split('/')[0]))].map(colRef), collection: colRef,
    collectionGroup: id => query(() => [...data.keys()].filter(k=>{const s=k.split('/'); return s.length%2===0 && s[s.length-2]===id;}).sort()) };
  const ctx = { db, FieldPath, types: {} };
  const { readEverything } = await import('./firebase-backup.mjs');
  const r = await readEverything(db, ctx);
  const paths = r.found.map(f => f.path);
  for (const p of ['awards', 'csLeads', 'csLeads/L1/unlocks', 'ghost/g1/sub', 'other/o1/settings', 'users', 'users/u3/settings', 'users/u9/hist', 'users/u7/hist/h7/deep'])
    assert.ok(paths.includes(p), p);
  assert.equal(paths.length, 36);
  assert.ok(!paths.includes('mail'));
  assert.equal(r.found.find(f => f.path === 'other/o1/settings').docs[0].data.not, 'users');
});
