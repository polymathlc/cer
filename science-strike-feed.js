// Science Strike's database adapters are deterministic: no network or AI calls.
// Keep persisted checker signatures compatible with app.js tlSig/_tlFromStamp.
const CHECK_SIGNATURE_HEAD = 4000;
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const text = value => String(value ?? '').trim();

// Only school-level metadata from the portal's default objective list. These
// are not questions or answer content. A saved objectives array, even empty,
// replaces this seed so teacher deletions are respected.
export const STRIKE_DEFAULT_OBJECTIVES = Object.freeze([
  ['P3', 'div-living div-infer div-groups div-classify mat-uses mat-props lc-different lc-plants lc-animals mag-push mag-char mag-uses mag-materials mag-make'],
  ['P4', 'matt-def matt-states matt-measure hum-systems hum-digest plant-parts light-see light-straight light-shadow-vars heat-sources heat-temp heat-energy heat-vs-temp heat-flow heat-change heat-effects heat-cond heat-measure'],
  ['P5', 'rep-cell rep-continuity rep-plant rep-human rep-similar rep-ways wat-three wat-change wat-points wat-heat wat-evap wat-cycle wat-import wat-life wat-poll air-gases resp-parts sys-integrate gas-exchange trans-plant-parts trans-plant-inv trans-compare elec-circuit elec-closed elec-cond elec-diagram elec-arrange'],
  ['P6', 'force-what force-effects force-types force-weight force-friction force-spring env-survival env-unfavourable env-food env-levels env-habitat env-adapt env-man photo-resp photo-sun photo-obtain photo-req econv-sun econv-forms econv-conversion']
].flatMap(([level, ids]) => ids.split(' ').map(id => Object.freeze({ id, level }))));

function checkSignature(question) {
  if (!question) return '';
  try {
    const raw = JSON.stringify({ cropAudit: 1, keyImage: question.answerKeyImage || '',
      t: question.title || '', p: question.topic || '', c: question.category || '',
      a: !!question.annotation, b: question.blocks || [] });
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
    return raw.length + ':ai:' + (hash >>> 0).toString(36) + ':' + raw.slice(0, CHECK_SIGNATURE_HEAD);
  } catch (_) { return ''; }
}

export function strikeQuestionQualityOptions(question) {
  const importSignature = checkSignature(question);
  let checkedState = { state: 'idle', findings: [], stale: false };
  const stamp = question?.autoCheck;
  if (question?.id && object(stamp) && stamp.state && stamp.sig) {
    const findings = Array.isArray(stamp.findings) ? stamp.findings : [];
    if (!importSignature || stamp.sig !== importSignature)
      checkedState = { state: 'stale', findings, stale: true, error: stamp.error || '' };
    else if (stamp.state === 'error')
      checkedState = { state: 'error', findings, stale: false, error: stamp.error || '' };
    else checkedState = { state: stamp.state, findings, stale: false, at: Date.parse(stamp.at || '') || 0 };
  }
  return { checkedState, importSignature };
}

function timestampMs(value) {
  try {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value && typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (value && typeof value.seconds === 'number') return value.seconds * 1000 + (Number(value.nanoseconds) || 0) / 1e6;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' && value.trim()) return Number(value) || Date.parse(value) || 0;
  } catch (_) {}
  return 0;
}

// Number(null), Number('') and Number(false) are zero, but those fields do not
// record a mark. A missing/malformed result must not lower a child's mastery.
function scoreNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function strikeAttemptProgress(attempts, displayName, localProgress = {}, now = Date.now()) {
  const until = Number.isFinite(now) ? now : Date.now();
  const name = text(displayName), progress = Object.create(null), remote = new Map();
  const validTime = at => Number.isFinite(at) && at > 0 && at <= until;
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    if (!object(attempt) || text(attempt.displayName) !== name || !text(attempt.questionId)) continue;
    const id = text(attempt.questionId), at = timestampMs(attempt.timestamp);
    const total = scoreNumber(attempt.totalBlanks ?? attempt.outOf);
    const override = object(attempt.override) ? scoreNumber(attempt.override.score) : null;
    const score = override ?? scoreNumber(attempt.score ?? attempt.marks);
    if (!validTime(at) || total == null || total <= 0 || score == null) continue;
    const fraction = Math.max(0, Math.min(1, score / total));
    const correction = override == null ? 0 : timestampMs(attempt.override.at);
    const correctionAt = validTime(correction) ? correction : 0;
    const previous = remote.get(id);
    // Order by when the child answered, not when a teacher corrected it. At an
    // equal timestamp, a corrected mark wins; remaining ties are conservative.
    if (!previous || at > previous.last || at === previous.last && (
      (override != null && !previous.overridden)
      || (override != null) === previous.overridden && (correctionAt > previous.correctionAt
        || correctionAt === previous.correctionAt && fraction < previous.latestFrac)))
      remote.set(id, { last: at, latestFrac: fraction, overridden: override != null, correctionAt });
  }
  for (const [id, row] of object(localProgress) ? Object.entries(localProgress) : []) {
    if (!text(id) || !object(row)) continue;
    const at = timestampMs(row.last), fraction = scoreNumber(row.latestFrac);
    if (validTime(at) && fraction != null && fraction >= 0 && fraction <= 1)
      progress[text(id)] = { last: at, latestFrac: fraction };
  }
  for (const [id, row] of remote) {
    // An equal-time database row includes teacher corrections a local cache
    // cannot know. A newer local answer still protects its waiting review.
    if (!progress[id] || row.last >= progress[id].last)
      progress[id] = { last: row.last, latestFrac: row.latestFrac };
  }
  return progress;
}
