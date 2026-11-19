'use strict';
// The in-memory stand-in for revision-store.js that the revision tests (and the
// page's browser preview) run against, with a small /online class and its worksheets.
const { Readable } = require('node:stream');
const { ShopError } = require('../service');

const NOW = Date.UTC(2026, 10, 19, 4, 0, 0);
const TOKEN = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const keyUrl = (sheet, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/'
  + encodeURIComponent('pdf-annotator/lesson-key-' + sheet + '-' + day + '.pdf') + '?alt=media&token=' + TOKEN;

function seedData() {
  return {
    courses: [
      { id: 'c-p6m', level: 'P6', subject: 'math', day: 'Monday', worksheetIds: ['w1', 'w2', 'w3'] },
      { id: 'c-p6m-small', level: 'P6', subject: 'math', day: 'Tuesday', worksheetIds: ['w1'] },
      { id: 'c-p5m', level: 'P5', subject: 'math', day: 'Monday', worksheetIds: ['x1', 'x2', 'x3', 'x4'] },
      { id: 'c-p6s', level: 'P6', subject: 'science', day: 'Friday', worksheetIds: ['s1', 's2'] }
    ],
    sheets: {
      w1: { name: 'Fractions: Paper 1', storagePath: 'pdf-annotator/w1.pdf', pageCount: 8,
        answerKeys: { '2026-11-02': { url: keyUrl('w1', '2026-11-02'), pages: 8 }, '2026-11-09': { url: keyUrl('w1', '2026-11-09'), pages: 9 } },
        videoPlaylist: { hash: 'vp1-1234-abcd', token: TOKEN, n: 3 } },
      w2: { name: 'Ratio: Paper 2', storagePath: 'pdf-annotator/w2.pdf', pageCount: 6 },
      w3: { name: 'Hidden one', storagePath: 'pdf-annotator/w3.pdf', hidden: true },
      x1: { name: 'P5 a' }, x2: { name: 'P5 b' }, x3: { name: 'P5 c' }, x4: { name: 'P5 d' },
      s1: { name: 'Energy: Paper 1', storagePath: 'pdf-annotator/s1.pdf', answerKeys: { '2026-11-05': { url: 'https://evil.example/x.pdf' } } },
      s2: { name: 'Cells: Paper 2', storagePath: 'pdf-annotator/s2.pdf' }
    },
    maps: {
      m1: { title: 'Fractions big picture', published: true, rootId: 'r', nodes: [
        { id: 'r', type: 'topic', parentId: '', text: 'Fractions' },
        { id: 'a', type: 'topic', parentId: 'r', text: 'Equivalent fractions', color: 'blue' },
        { id: 'b', type: 'note', parentId: 'a', text: 'Tip', note: 'Multiply top and bottom' },
        { id: 'c', type: 'code', parentId: 'r', text: 'secret app', code: { html: '<b>' } },
        { id: 'q', type: 'question', parentId: 'r', text: '', question: { title: 'Q1 fractions' } }] },
      m2: { title: 'Energy conversions', published: true, rootId: 'r', nodes: [{ id: 'r', type: 'topic', text: 'Energy' }] },
      m3: { title: 'Private map', published: false, nodes: [] }
    }
  };
}

// The in-memory store: the same answers revision-store.js gives.
function fakeStore(data = seedData()) {
  const state = { root: null, packs: new Map(), orders: new Map(), access: new Map(), mail: new Map(), limits: new Map(), shopSettings: null };
  const clone = v => structuredClone(v);
  return {
    state, data,
    async getRoot() { return state.root ? clone(state.root) : null; },
    async seed(list, at) {
      if (state.root && state.root.seededAt) return false;
      state.root = { seededAt: at, starterPacks: list.map(p => p.id) };
      list.forEach(p => { if (!state.packs.has(p.id)) state.packs.set(p.id, clone(Object.assign({}, p, { updatedAt: at, updatedBy: 'starter' }))); });
      return true;
    },
    async listPacks() { return [...state.packs].map(([id, p]) => Object.assign({ id }, clone(p))); },
    async getPack(id) { return state.packs.has(id) ? clone(state.packs.get(id)) : null; },
    async savePack(id, p) { state.packs.set(id, clone(p)); },
    async deletePack(id) { state.packs.delete(id); },
    async loadCourses() { return clone(data.courses); },
    async loadSheets(ids) { const out = {}; (ids || []).forEach(id => { if (data.sheets[id]) out[id] = clone(data.sheets[id]); }); return out; },
    async listPublishedMaps() { return Object.entries(data.maps).filter(([, m]) => m.published).map(([id, m]) => ({ id, title: m.title, nodeCount: m.nodes.length })); },
    async loadMaps(ids) { const out = {}; (ids || []).forEach(id => { if (data.maps[id]) out[id] = clone(data.maps[id]); }); return out; },
    async loadShopSettings() { return state.shopSettings; },
    async countAttempts(quotas, code) {
      if (quotas.some(q => (state.limits.get(q.id) || 0) >= q.maximum)) throw new ShopError(429, code);
      quotas.forEach(q => state.limits.set(q.id, (state.limits.get(q.id) || 0) + 1));
    },
    async createOrder(build, generate, buildMail) {
      for (let i = 0; i < 6; i++) {
        const code = generate();
        if (state.orders.has(code)) continue;
        const record = build(code);
        state.orders.set(code, clone(record));
        const message = buildMail ? buildMail(record) : null;
        if (message) state.mail.set('polymath-revision-' + code + '-new', message);
        return record;
      }
      throw new ShopError(503, 'temporarily-unavailable');
    },
    async getOrder(code) { return state.orders.has(code) ? Object.assign({ code }, clone(state.orders.get(code))) : null; },
    async updateOrder(code, patch) { Object.assign(state.orders.get(code), clone(patch)); },
    async listOrders() { return [...state.orders].map(([code, o]) => Object.assign({ code }, clone(o))); },
    async orderForAccess(code) { const a = state.access.get(code); return a ? this.getOrder(a) : null; },
    async noteOpen(code) { const o = state.orders.get(code); o.opens = (o.opens || 0) + 1; },
    async markPaid(code, { at, by, payment, newCode, endsAt, buildMails, mailId }) {
      const stored = state.orders.get(code);
      if (!stored) return { missing: true };
      const order = Object.assign({ code }, clone(stored));
      if (order.status === 'paid') return { already: true, order };
      let accessCode = '';
      for (let i = 0; i < 6 && !accessCode; i++) { const c = newCode(); if (!state.access.has(c)) accessCode = c; }
      const patch = { status: 'paid', paidAt: at, paidBy: by, accessCode, accessEndsAt: endsAt(order, state.packs.get(order.packId) || null) };
      if (payment) {
        patch.stripe = payment;
        if (payment.amountTotal !== order.totalCents) patch.amountCheck = 'mismatch';
      }
      const paid = Object.assign({}, order, patch);
      const messages = buildMails(paid);
      patch.mailCount = 1; patch.mailSentAt = at;
      state.access.set(accessCode, code);
      Object.assign(stored, patch);
      messages.forEach((m, i) => state.mail.set(i === 0 ? mailId(paid, 1) : mailId(paid, 'admin'), m));
      return { order: Object.assign(paid, patch) };
    },
    async resend(code, { at, gap, build, mailId }) {
      const o = Object.assign({ code }, state.orders.get(code));
      if (o.mailSentAt && at - o.mailSentAt < gap) throw new ShopError(429, 'receipt-just-sent');
      const message = build(o);
      const count = (o.mailCount || 0) + 1;
      state.mail.set(mailId(o, count), message);
      Object.assign(state.orders.get(code), { mailCount: count, mailSentAt: at });
      return { order: Object.assign(o, { mailCount: count, mailSentAt: at }), to: message.to[0] };
    },
    async openPdf(path) {
      const body = Buffer.from('%PDF-1.4 ' + path);
      return path.startsWith('pdf-annotator/') ? { stream: Readable.from([body]), size: body.length } : null;
    }
  };
}

module.exports = { NOW, TOKEN, keyUrl, seedData, fakeStore };
