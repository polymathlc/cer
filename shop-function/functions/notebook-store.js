'use strict';
/* Firestore and Storage (Admin SDK) side of the mistake notebook (notebook.js).

   READS (never written here):
     studentAccess/{uid}                          the /student approval and the
                                                  parent email the family typed
     studentProfiles/{uid}                        officeId = familyId_childId
     officeFamilies                               the Office's families (cached)
     users/{uid}/mistakes                         Study Buddy's mistake book
     users/{teacher}/liveClassProgress/main       which lessons each child was in
     users/{teacher}/liveClass/{epoch}            the lesson itself (questions,
                                                  answers, the teacher's marks)
     users/{teacher}/liveClass/{epoch}/photos/{r} a question's picture
     Storage tutor-mistakes/{uid}/{id}.jpg        a worksheet question's picture
   WRITES:
     mistakeNotebook/{r_<familyId_childId> | u_<uid>}
       { v, json, items, open, child, updatedAt }  one document per child; the
       notebook itself is the JSON string (mistake ids are not field names). */
const N = require('./notebook-core');

const NOTEBOOK_COLLECTION = 'mistakeNotebook';
const MAX_DOC_CHARS = 900000;
const FAMILY_CACHE_MS = 5 * 60 * 1000;
const BOOK_CACHE_MS = 2 * 60 * 1000;
const SESSION_CACHE_MS = 2 * 60 * 1000;
const SESSION_CACHE_MAX = 200;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const WORKSHEET_FIELDS = ['docId', 'docName', 'question', 'options', 'option', 'answer', 'explanation', 'studentAnswer',
  'verdict', 'skipped', 'type', 'number', 'level', 'subject', 'topic', 'sylTopic', 'imagePath', 'cleared', 'createdAt', 'qId'];
const FAMILY_FIELDS = ['email', 'email2', 'students', 'parentName', 'status', 'withdrawn'];

function parseJson(text, fallback) {
  if (typeof text !== 'string' || !text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
// Smaller until it fits one document: mastered, then fixed, then the oldest.
function fitState(state) {
  let s = N.trimState(N.cleanState(state));
  let json = JSON.stringify(s);
  let guard = 0;
  while (json.length > MAX_DOC_CHARS && Object.keys(s.items).length && guard++ < 2000) {
    const ids = Object.keys(s.items);
    const rank = id => ({ mastered: 0, fixed: 1, open: 2 })[N.statusOf(s.log[id])];
    ids.sort((a, b) => rank(a) - rank(b) || s.items[a].at - s.items[b].at);
    const drop = ids.slice(0, Math.max(1, Math.ceil(ids.length / 20)));
    drop.forEach(id => { delete s.items[id]; delete s.log[id]; });
    s = N.cleanState(s);
    json = JSON.stringify(s);
  }
  return { state: s, json };
}

function createNotebookStore(db, { bucket = null, now = Date.now } = {}) {
  let families = null;
  let books = null;
  const sessions = new Map();

  async function getDoc(path) {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() || {} : null;
  }

  return {
    async getAccess(uid) { return getDoc('studentAccess/' + uid); },
    async getProfile(uid) {
      const p = await getDoc('studentProfiles/' + uid);
      return p ? { officeId: String(p.officeId || ''), name: String(p.name || ''), level: String(p.level || '') } : null;
    },
    async listFamilies() {
      if (families && now() - families.at < FAMILY_CACHE_MS) return families.list;
      const snap = await db.collection('officeFamilies').select(...FAMILY_FIELDS).get();
      const list = snap.docs.map(d => Object.assign({ id: d.id }, d.data() || {}));
      families = { at: now(), list };
      return list;
    },
    async uidsForRoster(rosterId) {
      if (!N.ROSTER_ID.test(rosterId)) return [];
      const snap = await db.collection('studentProfiles').where('officeId', '==', rosterId).limit(10).get();
      return snap.docs.map(d => d.id).filter(id => /^[A-Za-z0-9]{1,128}$/.test(id));
    },
    async worksheetMistakes(uid) {
      if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) return [];
      const snap = await db.collection('users').doc(uid).collection('mistakes').select(...WORKSHEET_FIELDS).limit(800).get();
      return snap.docs.map(d => ({ id: d.id, data: d.data() || {} }));
    },
    async progressBooks() {
      if (books && now() - books.at < BOOK_CACHE_MS) return books.list;
      const snap = await db.collectionGroup('liveClassProgress').get();
      const list = [];
      snap.docs.forEach(d => {
        if (d.id !== 'main') return;
        const teacher = d.ref.parent && d.ref.parent.parent ? d.ref.parent.parent.id : '';
        const book = parseJson((d.data() || {}).json, null);
        if (teacher && book) list.push({ teacher, book });
      });
      books = { at: now(), list };
      return list;
    },
    async liveSession(teacher, epoch) {
      const path = 'users/' + teacher + '/liveClass/' + epoch;
      if (!/^users\/[A-Za-z0-9]{1,128}\/liveClass\/\d{1,16}$/.test(path)) return null;
      const hit = sessions.get(path);
      if (hit && now() - hit.at < SESSION_CACHE_MS) return hit.session;
      const data = await getDoc(path);
      const session = data ? parseJson(data.json, null) : null;
      sessions.set(path, { at: now(), session });
      if (sessions.size > SESSION_CACHE_MAX) sessions.delete(sessions.keys().next().value);
      return session;
    },
    async livePhoto(teacher, epoch, ref) {
      const path = 'users/' + teacher + '/liveClass/' + epoch + '/photos/' + ref;
      if (!/^users\/[A-Za-z0-9]{1,128}\/liveClass\/\d{1,16}\/photos\/[A-Za-z0-9_-]{1,64}$/.test(path)) return '';
      const data = await getDoc(path);
      return data ? String(data.d || '') : '';
    },
    async storageImage(path) {
      if (!bucket || !N.IMAGE_PATH.test(path)) return '';
      const file = bucket.file(path);
      const [meta] = await file.getMetadata();
      if (Number(meta && meta.size) > IMAGE_MAX_BYTES) return '';
      const [bytes] = await file.download();
      const ext = path.split('.').pop().toLowerCase();
      const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64');
    },
    async getState(docId) {
      const data = await getDoc(NOTEBOOK_COLLECTION + '/' + docId);
      return data ? parseJson(data.json, N.emptyState()) : N.emptyState();
    },
    // fn(rawState) → { state, changed, meta }. Read and written in one
    // transaction, so two taps (or two devices) never lose a redo.
    async updateState(docId, fn) {
      const ref = db.collection(NOTEBOOK_COLLECTION).doc(docId);
      return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const raw = snap.exists ? parseJson((snap.data() || {}).json, N.emptyState()) : N.emptyState();
        const out = fn(raw);
        const fitted = fitState(out.state);
        if (out.changed) {
          const s = fitted.state;
          tx.set(ref, {
            v: 1, json: fitted.json, items: Object.keys(s.items).length,
            open: Object.keys(s.items).filter(id => N.statusOf(s.log[id]) === 'open').length,
            child: out.meta && out.meta.child ? String(out.meta.child) : (snap.exists ? String((snap.data() || {}).child || '') : ''),
            updatedAt: now()
          });
        }
        return { state: fitted.state };
      });
    }
  };
}

module.exports = { createNotebookStore, fitState, NOTEBOOK_COLLECTION, MAX_DOC_CHARS };
