// Permanent, subject/profile-scoped exposure ledger. Every automatic delivery
// commits its question ID AND visible-content identity before showing a question.
// One immutable document per marker avoids document-size limits and lost merges.
const identityKey = value => JSON.stringify([String(value?.uid || ''), String(value?.profile || '')]);
const stamp = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : Date.now();
async function digest(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createStudentQuestionHistory({ db, doc, collection, getDocs, onSnapshot,
  runTransaction, subject, onChange = () => {}, onError = () => {} }) {
  if (!['math', 'science'].includes(subject)) throw new TypeError('A question-history subject is required.');
  let generation = 0, active = null;
  function current(state) { return active === state && state.generation === generation; }
  function changed(state) { if (current(state)) onChange(); }
  function absorb(state, rows) {
    let added = false;
    for (const row of rows) {
      if (!row || typeof row.value !== 'string' || !row.value) continue;
      if (row.kind === 'id' && !state.seen.has(row.value)) {
        state.seen.set(row.value, stamp(row.at)); added = true;
      } else if (row.kind === 'content' && !state.content.has(row.value)) {
        state.content.add(row.value); added = true;
      }
    }
    if (added) changed(state);
  }
  function snapshotRows(snapshot) {
    const rows = []; snapshot.forEach(item => rows.push(item.data())); return rows;
  }
  async function markers(entries) {
    const unique = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = String(entry?.id || ''), content = String(entry?.contentKey || '');
      if (!id) continue;
      if (id.length > 1500 || content.length > 256) throw new RangeError('Invalid question-history identity.');
      for (const [kind, value] of [['id', id], ['content', content]]) {
        if (!value) continue;
        const key = `${kind}:${value}`;
        if (!unique.has(key)) unique.set(key, { kind, value, at: stamp(entry.at) });
      }
    }
    return Promise.all(Array.from(unique.values(), async row => ({ ...row,
      key: await digest(`${row.kind}:${row.value}`) })));
  }
  async function commit(state, rows, allowSeen) {
    if (!current(state)) return false;
    const result = await runTransaction(db, async transaction => {
      if (!current(state)) throw new Error('Your student profile changed.');
      const refs = rows.map(row => doc(state.ref, row.key));
      // All reads precede all writes. Firestore retries on competing claims.
      const existing = await Promise.all(refs.map(ref => transaction.get(ref)));
      const found = existing.filter(item => item.exists()).map(item => item.data());
      if (!allowSeen && found.length) return { claimed: false, found };
      rows.forEach((row, index) => {
        if (!existing[index].exists()) transaction.set(refs[index], {
          kind: row.kind, value: row.value, at: row.at
        });
      });
      return { claimed: true, found };
    });
    if (!current(state)) return false;
    absorb(state, result.found);
    if (result.claimed) absorb(state, rows);
    return result.claimed;
  }
  async function migrate(state, entries) {
    const rows = (await markers(entries)).filter(row => row.kind === 'id'
      ? !state.seen.has(row.value) : !state.content.has(row.value));
    // Migration is a union, so interrupted batches are safely retried next login.
    for (let index = 0; index < rows.length; index += 200) {
      if (!await commit(state, rows.slice(index, index + 200), true)) return false;
    }
    return current(state);
  }
  function close() {
    generation++; active?.unsubscribe?.(); active = null; onChange();
  }
  async function open(identity, legacyEntries = []) {
    const uid = String(identity?.uid || '');
    if (!uid || uid.includes('/')) { close(); return false; }
    const key = identityKey(identity);
    if (active?.key === key && !active.failed) {
      const state = active;
      await state.opening;
      if (!current(state) || !state.ready) return false;
      try { return await migrate(state, legacyEntries); }
      catch (error) { if (current(state)) { state.ready = false; state.failed = true; onError(error); } throw error; }
    }
    close();
    const state = { key, generation, ready: false, seen: new Map(), content: new Set(), unsubscribe: null };
    active = state;
    state.opening = (async () => {
      const scope = `${subject}-${await digest(String(identity.profile || ''))}`;
      if (!current(state)) return false;
      state.ref = collection(db, 'users', uid, 'questionHistory', scope, 'entries');
      state.unsubscribe = onSnapshot(state.ref, snapshot => {
        if (current(state)) absorb(state, snapshotRows(snapshot));
      }, error => {
        if (current(state)) { state.ready = false; state.failed = true; state.error = error; onError(error); changed(state); }
      });
      const stored = await getDocs(state.ref);
      if (!current(state)) return false;
      if (stored.metadata?.fromCache) throw new Error('Connect to the internet to sync your question history.');
      absorb(state, snapshotRows(stored));
      if (!await migrate(state, legacyEntries)) return false;
      if (state.error) throw state.error;
      state.ready = true; changed(state); return true;
    })().catch(error => {
      if (current(state)) { state.ready = false; state.failed = true; state.unsubscribe?.(); onError(error); changed(state); }
      throw error;
    });
    return state.opening;
  }
  function isReady(identity) {
    return !!active?.ready && (!identity || active.key === identityKey(identity));
  }
  function snapshot() {
    return { seen: Object.fromEntries(active?.seen || []), contentKeys: Array.from(active?.content || []) };
  }
  function has(id, contentKey = '') {
    return !!(active?.seen.has(String(id)) || (contentKey && active?.content.has(String(contentKey))));
  }
  async function claimMany(entries, { allowSeen = false } = {}) {
    const state = active;
    if (!state?.ready) throw new Error('Your question history is still syncing. Please retry.');
    if (!allowSeen) {
      const ids = new Set(), contents = new Set();
      for (const entry of Array.isArray(entries) ? entries : []) {
        const id = String(entry?.id || ''), content = String(entry?.contentKey || '');
        if (!id || ids.has(id) || (content && contents.has(content))) return false;
        ids.add(id); if (content) contents.add(content);
      }
    }
    const rows = await markers(entries);
    if (!rows.length) return false;
    if (rows.length > 400) throw new RangeError('Request at most 200 questions at a time.');
    try { return await commit(state, rows, !!allowSeen); }
    catch (error) {
      if (current(state)) { state.ready = false; state.failed = true; onError(error); changed(state); }
      throw error;
    }
  }
  return { open, isReady, snapshot, has, claimMany, close };
}
