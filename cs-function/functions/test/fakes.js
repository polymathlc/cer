// In-memory stand-ins for the Admin SDK's Firestore and Storage bucket — just
// the surface service.js uses, so every test runs offline and can never touch
// the real mathgen--app project. Documents are deep-copied on the way in and
// out, exactly like a real round trip, so a test cannot pass by mutating an
// object the "database" still holds.
import { Readable } from 'node:stream';

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
let autoId = 0;

export class FakeFirestore {
  constructor() { this.docs = new Map(); this.writes = 0; this.failNextCommit = false; }
  collection(path) { return new FakeCollection(this, path); }
  doc(path) { return new FakeDocRef(this, path); }
  batch() { return new FakeBatch(this); }
  async runTransaction(fn) {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx.commit();
    return result;
  }
  async getAll(...refs) { return refs.map(ref => ref._snap()); }
  _write(path, data) { this.writes++; this.docs.set(path, clone(data)); }
  _delete(path) { this.writes++; this.docs.delete(path); }
  /** Plain object of every document under a collection path (direct children). */
  dump(collectionPath) {
    const out = {};
    for (const [path, data] of this.docs) {
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent === collectionPath) out[path.slice(path.lastIndexOf('/') + 1)] = clone(data);
    }
    return out;
  }
}

class FakeDocRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.slice(path.lastIndexOf('/') + 1); }
  collection(sub) { return new FakeCollection(this.db, this.path + '/' + sub); }
  _snap() {
    const data = this.db.docs.get(this.path);
    return { id: this.id, ref: this, exists: data !== undefined, data: () => clone(data) };
  }
  async get() { return this._snap(); }
  async set(data, opts) {
    const prev = this.db.docs.get(this.path);
    this.db._write(this.path, opts && opts.merge && prev ? { ...prev, ...data } : data);
  }
  async update(data) {
    const prev = this.db.docs.get(this.path);
    if (prev === undefined) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
    this.db._write(this.path, { ...prev, ...data });
  }
  async delete() { this.db._delete(this.path); }
}

function getField(data, field) {
  return String(field).split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), data);
}

class FakeQuery {
  constructor(db, path, filters = [], order = null, max = null, after = undefined) {
    Object.assign(this, { db, path, filters, order, max, after });
  }
  where(field, op, value) { return new FakeQuery(this.db, this.path, [...this.filters, { field, op, value }], this.order, this.max, this.after); }
  orderBy(field, dir = 'asc') { return new FakeQuery(this.db, this.path, this.filters, { field, dir }, this.max, this.after); }
  limit(n) { return new FakeQuery(this.db, this.path, this.filters, this.order, n, this.after); }
  startAfter(value) { return new FakeQuery(this.db, this.path, this.filters, this.order, this.max, value); }
  _rows() {
    let rows = [];
    for (const [path, data] of this.db.docs) {
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent !== this.path) continue;
      rows.push({ path, data });
    }
    for (const f of this.filters) {
      rows = rows.filter(({ data }) => {
        const v = getField(data, f.field);
        switch (f.op) {
          case '==': return v === f.value;
          case '!=': return v !== f.value;
          case '<': return v < f.value;
          case '<=': return v <= f.value;
          case '>': return v > f.value;
          case '>=': return v >= f.value;
          default: throw new Error('Unsupported op ' + f.op);
        }
      });
    }
    if (this.order) {
      const { field, dir } = this.order;
      rows = rows.filter(r => getField(r.data, field) !== undefined);
      rows.sort((a, b) => {
        const x = getField(a.data, field), y = getField(b.data, field);
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
      if (this.after !== undefined) {
        rows = rows.filter(r => {
          const v = getField(r.data, field);
          return dir === 'desc' ? v < this.after : v > this.after;
        });
      }
    } else {
      rows.sort((a, b) => a.path.localeCompare(b.path));
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows;
  }
  async get() {
    const docs = this._rows().map(({ path }) => new FakeDocRef(this.db, path)._snap());
    return { docs, empty: docs.length === 0, size: docs.length, forEach: fn => docs.forEach(fn) };
  }
  count() {
    return { get: async () => { const n = this._rows().length; return { data: () => ({ count: n }) }; } };
  }
}

class FakeCollection extends FakeQuery {
  constructor(db, path) { super(db, path); }
  doc(id) { return new FakeDocRef(this.db, this.path + '/' + (id || 'auto' + (++autoId).toString(36))); }
}

class FakeBatch {
  constructor(db) { this.db = db; this.ops = []; }
  set(ref, data, opts) { this.ops.push(() => ref.set(data, opts)); return this; }
  update(ref, data) { this.ops.push(() => ref.update(data)); return this; }
  delete(ref) { this.ops.push(() => ref.delete()); return this; }
  async commit() {
    if (this.db.failNextCommit) { this.db.failNextCommit = false; throw new Error('commit failed'); }
    for (const op of this.ops) await op();
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.ops = []; this.wrote = false; }
  async get(ref) {
    if (this.wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.');
    if (typeof ref._rows === 'function' && !(ref instanceof FakeDocRef)) return ref.get();
    return ref._snap();
  }
  async getAll(...refs) {
    if (this.wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.');
    return refs.map(ref => ref._snap());
  }
  set(ref, data, opts) {
    this.wrote = true;
    this.ops.push(() => {
      const prev = this.db.docs.get(ref.path);
      this.db._write(ref.path, opts && opts.merge && prev ? { ...prev, ...data } : data);
    });
    return this;
  }
  update(ref, data) {
    this.wrote = true;
    this.ops.push(() => {
      const prev = this.db.docs.get(ref.path);
      if (prev === undefined) throw new Error('NOT_FOUND');
      this.db._write(ref.path, { ...prev, ...data });
    });
    return this;
  }
  delete(ref) { this.wrote = true; this.ops.push(() => this.db._delete(ref.path)); return this; }
  commit() { for (const op of this.ops) op(); }
}

export class FakeBucket {
  constructor(name = 'mathgen--app.firebasestorage.app') { this.name = name; this.objects = new Map(); }
  file(path) { return new FakeFile(this, path); }
  async getFiles({ prefix = '' } = {}) {
    return [[...this.objects.keys()].filter(k => k.startsWith(prefix)).sort().map(k => new FakeFile(this, k))];
  }
  async combine(sources, destination) {
    const dest = typeof destination === 'string' ? this.file(destination) : destination;
    const parts = sources.map(s => {
      const o = this.objects.get(typeof s === 'string' ? s : s.name);
      if (!o) throw new Error('No such object ' + (s.name || s));
      return o.bytes;
    });
    this.objects.set(dest.name, { bytes: Buffer.concat(parts), metadata: { contentType: 'application/octet-stream' } });
    return [dest];
  }
  /** Test helper: put an object straight in, as the browser's upload would. */
  put(path, bytes, contentType = 'application/pdf') {
    this.objects.set(path, { bytes: Buffer.from(bytes), metadata: { contentType } });
  }
}

class FakeFile {
  constructor(bucket, name) { this.bucket = bucket; this.name = name; }
  async exists() { return [this.bucket.objects.has(this.name)]; }
  async getMetadata() {
    const o = this.bucket.objects.get(this.name);
    if (!o) throw Object.assign(new Error('Not found'), { code: 404 });
    return [{ ...o.metadata, name: this.name, size: String(o.bytes.length) }];
  }
  async setMetadata(meta) {
    const o = this.bucket.objects.get(this.name);
    if (!o) throw Object.assign(new Error('Not found'), { code: 404 });
    o.metadata = { ...o.metadata, ...meta };
    return [o.metadata];
  }
  async save(bytes, opts = {}) {
    const meta = { ...(opts.metadata || {}) };
    if (opts.contentType) meta.contentType = opts.contentType;
    this.bucket.objects.set(this.name, { bytes: Buffer.from(bytes), metadata: meta });
  }
  async copy(dest) {
    const o = this.bucket.objects.get(this.name);
    const target = typeof dest === 'string' ? this.bucket.file(dest) : dest;
    this.bucket.objects.set(target.name, { bytes: Buffer.from(o.bytes), metadata: { ...o.metadata } });
    return [target];
  }
  async delete({ ignoreNotFound = false } = {}) {
    if (!this.bucket.objects.has(this.name) && !ignoreNotFound) throw Object.assign(new Error('Not found'), { code: 404 });
    this.bucket.objects.delete(this.name);
  }
  createReadStream() {
    const o = this.bucket.objects.get(this.name);
    return Readable.from(o ? [o.bytes] : []);
  }
}

/** Deterministic randomness: a counter, so keys and ids differ but tests repeat. */
export function fakeRandom(seed = 1) {
  let n = seed;
  return size => {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i++) { n = (n * 1103515245 + 12345) & 0x7fffffff; out[i] = n & 0xff; }
    return out;
  };
}

export function fakeClock(start = Date.UTC(2026, 9, 17, 8, 0, 0)) {
  let t = start;
  const now = () => t;
  now.advance = ms => { t += ms; return t; };
  now.set = ms => { t = ms; return t; };
  return now;
}
