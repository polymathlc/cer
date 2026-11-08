// Actual run launches only. No question time is presented as game playtime.
export const GAME_USAGE_IDS = Object.freeze(['defenders','raiders','spire','legends','slayers','fps','hades','grand-line','tcg-train','tcg-duel','tcg-siege','tcg-legends','pirate-rift','adventure','ghost-arena','tcg-arena','tcg-dungeon']);
const ids = new Set(GAME_USAGE_IDS);
export const GAME_USAGE_RETENTION_DAYS = 190;
export function gameUsageDay(time) {
  const date = new Date(Number(time) + 8 * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : '';
}
export function expiredGameUsageDays(daily, now) {
  const cutoff = gameUsageDay(Number(now) - GAME_USAGE_RETENTION_DAYS * 86400000);
  if (!cutoff || !daily || typeof daily !== 'object') return [];
  return Object.keys(daily).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff);
}
function actorSnapshot(actor) {
  return actor && actor.role === 'student' && !actor.admin && typeof actor.uid === 'string' && actor.uid && typeof actor.key === 'string' && actor.key
    ? { uid: actor.uid, key: actor.key } : null;
}
export function createGameUsageWriter({ read, merge, increment, remove, stamp, now = Date.now }) {
  const reads = new Map();
  return async event => {
    if (!event.isCurrent()) return false;
    const key = JSON.stringify([event.uid,event.day]);
    if (!reads.has(key)) {
      reads.set(key,Promise.resolve().then(() => read(event.uid)).catch(() => ({})));
      if (reads.size > 8) reads.delete(reads.keys().next().value);
    }
    const previous = await reads.get(key) || {};
    if (!event.isCurrent()) return false;
    const daily = { [event.day]: { [event.gameId]: { starts: increment(1) } } };
    for (const day of expiredGameUsageDays(previous.gameUsageDaily,now())) daily[day] = remove();
    const patch = { uid: event.uid, gameUsageVersion: 1, gameUsageDaily: daily };
    if (!previous.gameUsageRecordedSince) patch.gameUsageRecordedSince = stamp();
    // The adapter must merge, never replace, this small nested patch. Existing
    // leaderboard, wallet, FPS and best-score fields are outside this write.
    await merge(event.uid,patch);
    if (patch.gameUsageRecordedSince) previous.gameUsageRecordedSince = patch.gameUsageRecordedSince;
    for (const day of expiredGameUsageDays(previous.gameUsageDaily,now())) delete previous.gameUsageDaily[day];
    return true;
  };
}
export function createGameUsageRecorder({ getActor, write, now = Date.now }) {
  // Object tokens are owned by real runs and retire with them. String tokens
  // cover scoped iframe protocols; their cache has a fixed upper bound.
  const objects = new WeakMap(), strings = new Map();
  function start(gameId, runToken) {
    let actor, day;
    try { actor = actorSnapshot(getActor()); day = gameUsageDay(now()); }
    catch (_) { return Promise.resolve(false); }
    const objectToken = runToken && (typeof runToken === 'object' || typeof runToken === 'function');
    const stringToken = typeof runToken === 'string' && runToken.length > 0 && runToken.length <= 256;
    if (!actor || !ids.has(gameId) || (!objectToken && !stringToken) || !day) return Promise.resolve(false);
    const key = JSON.stringify([actor.uid, actor.key, gameId]);
    if (objectToken) {
      const seen = objects.get(runToken) || new Set();
      if (seen.has(key)) return Promise.resolve(false);
      seen.add(key); objects.set(runToken, seen);
    } else {
      const token = JSON.stringify([key,runToken]);
      if (strings.has(token)) return Promise.resolve(false);
      strings.set(token,true);
      if (strings.size > 256) strings.delete(strings.keys().next().value);
    }
    const isCurrent = () => {
      const current = actorSnapshot(getActor());
      return !!current && current.uid === actor.uid && current.key === actor.key;
    };
    // Defer persistence so recording never delays gameplay. The write adapter
    // checks isCurrent again after any prerequisite asynchronous reads.
    return Promise.resolve().then(() => isCurrent() ? write({ ...actor, gameId, day, isCurrent }) : false)
      .then(result => result !== false && isCurrent()).catch(() => false);
  }
  return Object.freeze({ start });
}
