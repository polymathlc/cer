'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   📒 THE MISTAKE NOTEBOOK — the door (mistakeNotebook, POST, signed in)

   polymathlc.com.sg/notebook/ (cer notebook/index.html) posts here with the
   student's own Firebase sign-in (Authorization: Bearer <ID token>):

     { action: 'load',   child?, as? }            the notebook, this week's quiz,
                                                  the children on the account
     { action: 'answer', child, id, value, how }  a redo: ✓ / ✗ straight away, or
                                                  null + the answer to compare with
     { action: 'self',   child, id, right, how }  the child's own verdict after
                                                  comparing with the answer
     { action: 'reveal', child, id }              show the answer without a redo
     { action: 'hide',   child, id, hidden }      take a mistake out of the quiz
                                                  ("this question was wrong")
     { action: 'image',  child, id }              the question's picture, as a
                                                  data URL
     { action: 'roster' }                         (access admins) every child

   WHO SEES WHAT. A signed-in account sees only its own children:
     • the child named on the sign-in itself (an office pass from a personal
       live-class link carries officeId = familyId_childId),
     • the child the account's studentProfiles row names (officeId),
     • the children of the Office family whose email is the account's own or
       the parent email on its /student approval, matched by name;
     with none of those, the account's own worksheets ("u-<uid>").
   An account must be APPROVED at /student (or hold an office pass); the three
   access admins may open any child with `as` (the Office's family_child id).
   Everything is read with the Admin SDK, so no Firestore rule changes.
   ═══════════════════════════════════════════════════════════════════════════ */
const { ShopError } = require('./service');
const N = require('./notebook-core');

const ACCESS_ADMINS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg']);
const STAFF = Object.freeze(ACCESS_ADMINS.concat(['elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com']));
const ACTIONS = new Set(['load', 'answer', 'self', 'reveal', 'hide', 'image', 'roster']);
const BODY_KEYS = new Set(['action', 'child', 'as', 'id', 'value', 'right', 'how', 'hidden']);
const NAME_NOISE = new Set(['mr', 'mrs', 'ms', 'mdm', 'miss', 'dr', 'the', 'and', 'bin', 'binte', 'binti', 'bte', 'a', 'o', 'd', 's', 'al', 'ap', 'de']);
const LINK_CACHE_MS = 5 * 60 * 1000;
const MAX_LESSONS = 24;                  // live lessons read for one child per load

function normText(v) {
  return String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function nameTokens(v) { return normText(v).split(' ').filter(t => t.length >= 2 && !NAME_NOISE.has(t) && !/^\d+$/.test(t)); }
function cleanEmail(v) { return String(v || '').trim().toLowerCase(); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')); }
function familyEmails(f) { return [f.email, f.email2].map(cleanEmail).filter(isEmail).filter((e, i, a) => a.indexOf(e) === i); }
function currentKids(f) {
  return (Array.isArray(f && f.students) ? f.students : [])
    .filter(s => s && /^[A-Za-z0-9-]{1,60}$/.test(String(s.id || '')) && String(s.status || 'active') !== 'left');
}
// Which of a family's children a name means (the weekly report's matchChild):
// a shared name word, then the whole name, then the only child, then the level.
function matchChild(kids, names, level) {
  const list = kids || [];
  for (const raw of names || []) {
    const want = nameTokens(raw);
    if (!want.length) continue;
    const hits = list.filter(k => { const have = nameTokens(k.name); return want.some(t => have.includes(t)); });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const exact = hits.filter(k => nameTokens(k.name).join(' ') === want.join(' '));
      if (exact.length === 1) return exact[0];
    }
  }
  if (list.length === 1) return list[0];
  const lv = String(level || '').toUpperCase();
  const byLevel = lv ? list.filter(k => String(k.level || '').toUpperCase() === lv) : [];
  return byLevel.length === 1 ? byLevel[0] : null;
}
// The Office children an account belongs to → [{ key, name, level }].
function childrenFor({ actor, access, profile, families }) {
  const out = [];
  const seen = new Set();
  const famById = new Map((families || []).map(f => [String(f.id), f]));
  const add = (familyId, kid) => {
    if (!kid) return;
    const key = familyId + '_' + kid.id;
    if (!N.ROSTER_ID.test(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: N.oneLine(kid.name, 60) || 'Student', level: N.levelOf(kid.level), familyId });
  };
  const byRoster = rosterId => {
    const m = /^([A-Za-z0-9-]{1,60})_([A-Za-z0-9-]{1,60})$/.exec(String(rosterId || ''));
    if (!m) return;
    const fam = famById.get(m[1]);
    const kid = fam ? currentKids(fam).find(k => String(k.id) === m[2]) : null;
    if (kid) add(m[1], kid);
  };
  byRoster(actor.officeId);
  byRoster(profile && profile.officeId);
  // The parent's email: the account's own (when Google verified it) and the
  // parent email the family typed on the /student enrolment form.
  const emails = new Set();
  if (actor.email && actor.verified) emails.add(cleanEmail(actor.email));
  if (access) [access.parentEmail, access.email].map(cleanEmail).filter(isEmail).forEach(e => emails.add(e));
  const fams = (families || []).filter(f => familyEmails(f).some(e => emails.has(e)));
  const accessKids = access && Array.isArray(access.children) ? access.children.filter(c => c && c.name) : [];
  for (const fam of fams) {
    const kids = currentKids(fam);
    if (accessKids.length) {
      let any = false;
      for (const c of accessKids) {
        const kid = matchChild(kids, [c.name], c.level);
        if (kid) { add(String(fam.id), kid); any = true; }
      }
      if (!any && kids.length === 1) add(String(fam.id), kids[0]);
    } else if (kids.length) {
      kids.forEach(k => add(String(fam.id), k));
    }
  }
  return out;
}
function accountChild(actor, access) {
  const c = access && Array.isArray(access.children) ? access.children.find(x => x && x.name) : null;
  return { key: 'u-' + actor.uid, name: N.oneLine(c ? c.name : (actor.name || 'My notebook'), 60), level: N.levelOf(c && c.level), familyId: '' };
}
function stateDocId(childKey) {
  return N.ROSTER_ID.test(childKey) ? 'r_' + childKey : 'u_' + childKey.slice(2);
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ShopError(400, 'invalid-request');
  if (Object.keys(body).some(k => !BODY_KEYS.has(k))) throw new ShopError(400, 'invalid-request');
  if (!ACTIONS.has(body.action)) throw new ShopError(400, 'invalid-request');
  const out = { action: body.action };
  const key = v => typeof v === 'string' && (N.ROSTER_ID.test(v) || N.ACCOUNT_KEY.test(v)) ? v : '';
  if (body.child != null && body.child !== '') { out.child = key(body.child); if (!out.child) throw new ShopError(400, 'invalid-request'); }
  if (body.as != null && body.as !== '') { out.as = N.ROSTER_ID.test(String(body.as)) ? String(body.as) : ''; if (!out.as) throw new ShopError(400, 'invalid-request'); }
  if (['answer', 'self', 'reveal', 'hide', 'image'].includes(body.action)) {
    if (typeof body.id !== 'string' || !N.ITEM_ID.test(body.id)) throw new ShopError(400, 'invalid-request');
    out.id = body.id;
  }
  if (body.action === 'answer') {
    const v = body.value;
    const ok = v === null || typeof v === 'number' || (typeof v === 'string' && v.length <= N.LIMITS.value)
      || (Array.isArray(v) && v.length <= N.LIMITS.gaps && v.every(w => typeof w === 'string' && w.length <= N.LIMITS.gap));
    if (!ok) throw new ShopError(400, 'invalid-request');
    out.value = v;
  }
  if (body.action === 'self') {
    if (typeof body.right !== 'boolean') throw new ShopError(400, 'invalid-request');
    out.right = body.right;
  }
  if (body.action === 'hide') out.hidden = body.hidden !== false;
  out.how = body.how === 'quiz' ? 'quiz' : 'redo';
  return out;
}

function createNotebookService({ store, http, verifyIdToken, now = Date.now, report = () => {} }) {
  const linkCache = new Map();

  async function signedIn(req) {
    const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.get('authorization') || '');
    if (!match) throw new ShopError(401, 'sign-in-required');
    let claims;
    try { claims = await verifyIdToken(match[1]); } catch { throw new ShopError(401, 'sign-in-required'); }
    const uid = String(claims && claims.uid || '');
    if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) throw new ShopError(401, 'sign-in-required');
    const email = cleanEmail(claims.email);
    const verified = claims.email_verified === true;
    const anonymous = claims.firebase && claims.firebase.sign_in_provider === 'anonymous';
    if (anonymous) throw new ShopError(401, 'sign-in-required');
    return {
      uid, email, verified, name: N.oneLine(claims.name, 60),
      admin: verified && ACCESS_ADMINS.includes(email),
      staff: verified && STAFF.includes(email),
      officeId: N.ROSTER_ID.test(String(claims.officeId || '')) && claims.officePass === true ? String(claims.officeId) : ''
    };
  }

  // The account's children, worked out once per 5 minutes per account.
  async function linkFor(actor) {
    const hit = linkCache.get(actor.uid);
    if (hit && now() - hit.at < LINK_CACHE_MS) return hit.value;
    const [access, profile, families] = await Promise.all([store.getAccess(actor.uid), store.getProfile(actor.uid), store.listFamilies()]);
    const status = String(access && access.status || '').toLowerCase();
    const allowed = actor.admin || actor.staff || !!actor.officeId || status === 'approved';
    const kids = childrenFor({ actor, access, profile, families });
    const value = { allowed, status: status || 'none', children: kids.length ? kids : [accountChild(actor, access)], access };
    linkCache.set(actor.uid, { at: now(), value });
    if (linkCache.size > 500) linkCache.delete(linkCache.keys().next().value);
    return value;
  }

  // The child this call is about: one of the account's own, or (admins) any
  // Office child named by `as`.
  async function childFor(actor, body) {
    if (actor.admin && body.as) {
      const families = await store.listFamilies();
      const m = /^([A-Za-z0-9-]{1,60})_([A-Za-z0-9-]{1,60})$/.exec(body.as);
      const fam = families.find(f => String(f.id) === m[1]);
      const kid = fam ? currentKids(fam).find(k => String(k.id) === m[2]) : null;
      if (!kid) throw new ShopError(404, 'child-not-found');
      return { child: { key: body.as, name: N.oneLine(kid.name, 60), level: N.levelOf(kid.level), familyId: m[1] }, link: null, viewing: true };
    }
    const link = await linkFor(actor);
    if (!link.allowed) throw new ShopError(403, link.status === 'revoked' ? 'access-paused' : 'not-approved');
    const child = body.child ? link.children.find(c => c.key === body.child) : link.children[0];
    if (!child) throw new ShopError(404, 'child-not-found');
    return { child, link, viewing: false };
  }

  // Reads every source for one child and returns the mistakes found.
  async function harvest(actor, child, link, viewing) {
    const sources = { worksheet: 0, live: 0, lessons: 0, accounts: 0, problems: [] };
    const items = [];
    // ── Worksheets: Study Buddy's mistake book on the account, plus every
    //    account the Office links to this child (a personal-link sign-in).
    const uids = new Set();
    if (!viewing) uids.add(actor.uid);
    if (N.ROSTER_ID.test(child.key)) {
      try { (await store.uidsForRoster(child.key)).forEach(u => uids.add(u)); } catch { sources.problems.push('accounts'); }
    }
    const several = !viewing && link && link.children.length > 1;
    for (const uid of uids) {
      let rows = [];
      try { rows = await store.worksheetMistakes(uid); } catch { sources.problems.push('worksheets'); continue; }
      sources.accounts++;
      for (const row of rows) {
        const it = N.fromWorksheet(row.id, row.data);
        if (!it) continue;
        // On a family account with several children, a worksheet of another
        // level belongs to the brother or sister.
        if (several && uid === actor.uid && it.lvl && child.level && it.lvl !== child.level) continue;
        items.push(it); sources.worksheet++;
      }
    }
    // ── Live lessons: the teacher's mark on each question, lesson by lesson.
    if (N.ROSTER_ID.test(child.key)) {
      const identity = 'r:' + child.key;
      let lessons = [];
      try { lessons = N.lessonsInBooks(await store.progressBooks(), identity).slice(0, MAX_LESSONS); } catch { sources.problems.push('lessons'); }
      const sessions = await Promise.all(lessons.map(l => store.liveSession(l.teacher, l.epoch).catch(() => { sources.problems.push('lesson'); return null; })));
      sessions.forEach((session, i) => {
        if (!session) return;
        sources.lessons++;
        const found = N.fromLiveSession(session, identity, lessons[i].teacher);
        sources.live += found.length;
        items.push(...found);
      });
    }
    sources.problems = [...new Set(sources.problems)];
    return { items, sources };
  }

  function seedOf(child) { return child.key; }

  async function load(actor, body) {
    const { child, link, viewing } = await childFor(actor, body);
    const { items, sources } = await harvest(actor, child, link, viewing);
    const t = now();
    const result = await store.updateState(stateDocId(child.key), raw => {
      const merged = N.mergeItems(raw, items);
      let s = merged.state;
      const wk = N.ensureWeek(s, t, seedOf(child));
      s = wk.state;
      const re = N.refillWeek(s, t, seedOf(child));
      s = re.state;
      return { state: s, changed: merged.added.length > 0 || wk.changed || re.changed, meta: { child: child.key, name: child.name } };
    });
    const week = N.weekKey(t);
    return {
      ok: true, version: N.VERSION, viewing,
      me: { admin: actor.admin, staff: actor.staff, signedInAs: actor.email || '' },
      children: viewing ? [publicChild(child)] : link.children.map(publicChild),
      child: child.key,
      notebook: N.publicNotebook(result.state, week, { sources })
    };
  }
  function publicChild(c) { return { key: c.key, name: c.name, level: c.level }; }

  async function answer(actor, body) {
    const { child } = await childFor(actor, body);
    const t = now();
    let reply = null;
    const result = await store.updateState(stateDocId(child.key), raw => {
      const s = N.cleanState(raw);
      const item = s.items[body.id];
      if (!item) throw new ShopError(404, 'mistake-not-found');
      const value = N.cleanValue(item, body.value);
      const right = value == null ? (item.kind === 'mcq' ? false : null) : N.check(item, value);
      if (right === null) {
        // The child compares with the answer and says; nothing is recorded yet.
        const p = N.peek(s, body.id, t);
        reply = { right: null, key: N.publicKey(item) };
        return { state: p.state, changed: p.changed };
      }
      const r = N.record(s, body.id, right, t, body.how);
      reply = { right, status: r.status, before: r.before, key: N.publicKey(item) };
      return { state: r.state, changed: true };
    });
    const week = N.weekKey(t);
    return Object.assign({ ok: true }, reply, {
      item: N.publicItem(result.state.items[body.id], result.state.log[body.id], true),
      stats: N.statsOf(result.state, week), week: N.publicWeek(result.state, week)
    });
  }

  async function selfMark(actor, body) {
    const { child } = await childFor(actor, body);
    const t = now();
    let reply = null;
    const result = await store.updateState(stateDocId(child.key), raw => {
      const s = N.cleanState(raw);
      if (!s.items[body.id]) throw new ShopError(404, 'mistake-not-found');
      const r = N.record(s, body.id, body.right, t, body.how);
      reply = { right: body.right, status: r.status, before: r.before };
      return { state: r.state, changed: true };
    });
    const week = N.weekKey(t);
    return Object.assign({ ok: true }, reply, {
      item: N.publicItem(result.state.items[body.id], result.state.log[body.id], true),
      stats: N.statsOf(result.state, week), week: N.publicWeek(result.state, week)
    });
  }

  async function reveal(actor, body) {
    const { child } = await childFor(actor, body);
    const t = now();
    const result = await store.updateState(stateDocId(child.key), raw => {
      const s = N.cleanState(raw);
      if (!s.items[body.id]) throw new ShopError(404, 'mistake-not-found');
      const p = N.peek(s, body.id, t);
      return { state: p.state, changed: p.changed };
    });
    return { ok: true, key: N.publicKey(result.state.items[body.id]), item: N.publicItem(result.state.items[body.id], result.state.log[body.id], true) };
  }

  async function hide(actor, body) {
    const { child } = await childFor(actor, body);
    const t = now();
    const result = await store.updateState(stateDocId(child.key), raw => {
      const s = N.cleanState(raw);
      if (!s.items[body.id]) throw new ShopError(404, 'mistake-not-found');
      const h = N.setHidden(s, body.id, body.hidden);
      return { state: h.state, changed: h.changed };
    });
    const week = N.weekKey(t);
    return { ok: true, item: N.publicItem(result.state.items[body.id], result.state.log[body.id], false), stats: N.statsOf(result.state, week) };
  }

  async function image(actor, body) {
    const { child } = await childFor(actor, body);
    const s = N.cleanState(await store.getState(stateDocId(child.key)));
    const item = s.items[body.id];
    if (!item || !item.img) throw new ShopError(404, 'image-not-found');
    let data = '';
    try {
      data = item.img.t === 'live' ? await store.livePhoto(item.img.u, item.img.e, item.img.r) : await store.storageImage(item.img.p);
    } catch { data = ''; }
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new ShopError(404, 'image-not-found');
    return { ok: true, image: data };
  }

  async function roster(actor) {
    if (!actor.admin) throw new ShopError(403, 'admins-only');
    const families = await store.listFamilies();
    const kids = [];
    for (const f of families) {
      const status = String(f.status || 'active').toLowerCase();
      if (status === 'withdrawn' || status === 'inactive' || f.withdrawn === true) continue;
      for (const k of currentKids(f)) kids.push({ key: f.id + '_' + k.id, name: N.oneLine(k.name, 60), level: N.levelOf(k.level), family: N.oneLine(f.parentName, 60) });
    }
    kids.sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name));
    return { ok: true, children: kids.filter(k => N.ROSTER_ID.test(k.key)).slice(0, 600) };
  }

  async function mistakeNotebook(req, res) {
    if (!http.cors(req, res)) return;
    try {
      const actor = await signedIn(req);
      const body = validateBody(req.body);
      const handler = { load, answer, self: selfMark, reveal, hide, image, roster }[body.action];
      return res.status(200).json(await handler(actor, body));
    } catch (error) {
      if (!(error instanceof ShopError)) report('notebook-' + String(error && error.message || error).slice(0, 80));
      return http.answerError(res, error, 'notebook-failed');
    }
  }
  return { mistakeNotebook, childrenFor, validateBody };
}

module.exports = { createNotebookService, childrenFor, matchChild, validateBody, stateDocId, ACCESS_ADMINS, STAFF };
