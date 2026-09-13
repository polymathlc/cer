// Local feeding decisions only. This module never calls AI, changes a mark,
// rewrites question metadata or changes the reward/Elo system.
import { buildPracticeCatalog } from './science-feed-variety.js';

const str = value => String(value == null ? '' : value).trim();
const norm = value => str(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const DAY = 24 * 60 * 60 * 1000;
const STAGE_WORD = '(?:primary|grade|p|secondary|sec|s|junior\\s+college|jc)';
const LABELS = ['', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4', 'S5', 'JC1', 'JC2'];

function stageNumber(prefix, number) {
  const p = norm(prefix), n = Number(number);
  if (/^(?:p|primary|grade)$/.test(p)) return n >= 1 && n <= 6 ? n : 0;
  if (/^(?:s|sec|secondary)$/.test(p)) return n >= 1 && n <= 5 ? n + 6 : 0;
  return n >= 1 && n <= 2 ? n + 11 : 0;
}

// Parse every endpoint, never just the first P digit. Unrecognised mixed
// metadata is not permission to serve: P4/P7 cannot silently become P4.
export function parsePracticeLevel(raw) {
  if (Array.isArray(raw)) {
    const parts = raw.map(parsePracticeLevel);
    const known = parts.filter(part => part.known);
    const invalid = parts.some(part => part.invalid || !part.known);
    const min = known.length ? Math.min(...known.map(part => part.min)) : 0;
    const max = known.length ? Math.max(...known.map(part => part.max)) : 0;
    return { known: !!max && !invalid, invalid, min, max, label: LABELS[max] || '' };
  }
  if (typeof raw !== 'string' || !raw.trim()) return { known: false, invalid: raw != null && raw !== '', min: 0, max: 0, label: '' };
  let input = norm(raw).replace(/[‐‑‒–—−]/g, '-');
  const stages = [];
  let invalid = false;
  input = input.replace(/\bupper\s+primary\b/g, () => { stages.push(4, 6); return ' '; })
    .replace(/\blower\s+primary\b/g, () => { stages.push(1, 3); return ' '; })
    .replace(/\bpsle\b/g, () => { stages.push(6); return ' '; });
  const ranges = new RegExp(`\\b(${STAGE_WORD})\\s*(\\d{1,2})(?:\\s*(?:-|to|/)\\s*(?:(${STAGE_WORD})\\s*)?(\\d{1,2}))?\\b`, 'gi');
  input = input.replace(ranges, (_, prefix, start, endPrefix, end) => {
    const a = stageNumber(prefix, start), b = end ? stageNumber(endPrefix || prefix, end) : a;
    if (!a || !b || b < a) invalid = true;
    if (a) stages.push(a);
    if (b) stages.push(b);
    return ' ';
  });
  // A leftover school-stage word is not a harmless difficulty qualifier.
  // In particular, "P4 / Secondary" must not silently become P4, and a bare
  // secondary label cannot be overridden by a lower primary objective.
  if (/\b(?:secondary|sec|s)\b/.test(input)
      || (stages.length && /\b(?:primary|grade|p|jc|junior\s+college)\b/.test(input))) invalid = true;
  // H1/H2 and an unspecified JC course are certainly above primary school.
  input = input.replace(/\b(?:h[12]|jc|junior\s+college)\b/g, () => { stages.push(13); return ' '; });
  const residue = input.replace(/\b(?:math|maths|mathematics|standard|foundation|easy|basic|beginner|intermediate|moderate|hard|harder|easier|advanced|challenge|challenging|expert|olympiad|practice|primary|secondary|level|levels|grade|grades|and|or|to)\b/g, ' ')
    .replace(/[\s,;:/&+()[\]{}.-]/g, '');
  // Plain descriptive difficulty labels have no level; a half-read stage
  // or extra unknown text is malformed, including "P4 (P6?)".
  if (residue) invalid = true;
  const min = stages.length ? Math.min(...stages) : 0;
  const max = stages.length ? Math.max(...stages) : 0;
  return { known: !!max && !invalid, invalid, min, max, label: LABELS[max] || '' };
}

export function practiceQuestionLevel(question, options = {}) {
  const q = question || {}, stages = [], sources = [];
  let invalid = false;
  for (const [field, raw] of [['level', q.level], ['levels', q.levels]]) {
    if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
    const parsed = parsePracticeLevel(raw);
    if (parsed.invalid) invalid = true;
    if (parsed.known) { stages.push(parsed.min, parsed.max); sources.push(field); }
  }
  if (q.los != null && !Array.isArray(q.los)) invalid = true;
  const objectiveIds = [];
  for (const raw of Array.isArray(q.los) ? q.los : []) {
    const id = str(raw), prefix = /^((?:P[1-6]|S[1-5]|JC[12]))\.[A-Z][A-Z0-9]*\.\d+(?:\.\d+)+$/i.exec(id);
    const lo = options.syllabusById && options.syllabusById[id];
    // Science objectives have stored, arbitrary IDs. Their explicitly mapped
    // level is authoritative; an unknown objective never defaults to P6.
    if ((!prefix && !lo) || (options.syllabusById && !lo)) { invalid = true; continue; }
    const parsed = parsePracticeLevel(prefix ? prefix[1] : lo.level);
    const mapped = lo ? parsePracticeLevel(lo.level) : parsed;
    if (!mapped.known) { invalid = true; continue; }
    stages.push(parsed.max, mapped.max); sources.push('objective'); objectiveIds.push(id);
  }
  const min = stages.length ? Math.min(...stages) : 0, max = stages.length ? Math.max(...stages) : 0;
  return { known: !!max && !invalid, invalid, min, max, label: LABELS[max] || '', sources, objectiveIds };
}

function timeMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return Date.parse(value || '') || 0;
}

function labels(value) {
  return [...new Set((Array.isArray(value) ? value : str(value).split(/[,;\n|]+/)).map(norm).filter(Boolean))];
}

function evidenceTags(q, progress = {}) {
  const topics = labels((q.topics && q.topics.length ? q.topics : q.topic) || (progress.topics && progress.topics.length ? progress.topics : progress.topic))
    .filter(topic => !['math', 'maths', 'mathematics', 'practice', 'problem solving'].includes(topic));
  return { topics, concepts: labels(q.concept || progress.concept), objectives: labels(q.los || progress.los) };
}

function stageDifficulty(stage) { return 500 + stage * 100; }

function questionDifficulty(q, level) {
  const base = stageDifficulty(level.max), number = Number(q.difficulty);
  // A saved legacy Elo is useful only inside its school-stage envelope.
  // Missing, malformed, or unsupported scales use that stage's neutral value.
  if (str(q.difficulty) && Number.isFinite(number) && number >= 400 && number <= 2200) {
    return { value: Math.round(clamp(number, base - 140, base + 260)), source: 'stage-bounded-rating' };
  }
  const descriptor = norm(`${q.level || ''} ${typeof q.difficulty === 'string' ? q.difficulty : ''}`);
  const offset = /\b(?:olympiad|expert|advanced)\b/.test(descriptor) ? 180
    : /\b(?:hard|harder|challenge|challenging)\b/.test(descriptor) ? 110
      : /\b(?:easy|easier|basic|foundation|beginner)\b/.test(descriptor) ? -90 : 0;
  return { value: base + offset, source: offset ? 'stage-and-description' : 'school-stage' };
}

function outcome(progress) {
  const verdict = norm(progress.lastVerdict || progress.verdict);
  if (verdict === 'correct') return 1;
  if (verdict === 'incorrect' || verdict === 'wrong') return 0;
  if (verdict === 'partial') {
    const total = Number(progress.lastOutOf), marks = Number(progress.lastMarks);
    return Number.isFinite(total) && total > 0 && Number.isFinite(marks) ? clamp(marks / total, 0, 1) : 0.5;
  }
  return null;
}

// One context per selection pass keeps a large bank from repeatedly scanning
// history. A family contributes its latest result once, regardless of attempts,
// correct streak, repeated copies, profile totals, or the student's global Elo.
export function buildPracticeMasteryContext(options = {}) {
  const bank = Array.isArray(options.bank) ? options.bank : [];
  const catalog = options.catalog || buildPracticeCatalog(bank);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const studentLevel = parsePracticeLevel(options.studentLevel);
  if (studentLevel.min !== studentLevel.max) studentLevel.known = false;
  const byFamily = new Map();
  const excludedEvidence = new Set(Array.from(options.excludeEvidenceIds || [], str));
  if (studentLevel.known) for (const [storedId, progress] of Object.entries(options.progress || {})) {
    if (!progress || typeof progress !== 'object') continue;
    const id = str(progress.questionId || storedId), q = catalog.byId.get(id);
    if (!q) continue; // Removed/unclassified questions cannot raise a target.
    // A broken or disputed question is not evidence that its learner failed
    // to understand the maths. The caller supplies already-computed checks.
    if (excludedEvidence.has(id) || (typeof options.evidenceEligible === 'function' && options.evidenceEligible(q, progress) === false)) continue;
    const level = practiceQuestionLevel(q, options), credit = outcome(progress);
    const at = timeMs(progress.lastAttemptAt);
    if (!level.known || level.max > studentLevel.max || credit == null || !at || at > now + DAY || now - at > 180 * DAY) continue;
    const family = catalog.families.get(id) || catalog.exact.get(id) || id;
    const evidence = { id, family, credit, at, level: level.max, difficulty: questionDifficulty(q, level).value, ...evidenceTags(q, progress) };
    const existing = byFamily.get(family);
    if (!existing || at > existing.at || (at === existing.at && credit < existing.credit)) byFamily.set(family, evidence);
  }
  return { studentLevel, syllabusById: options.syllabusById, now,
    observations: [...byFamily.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)) };
}

const overlap = (a, b) => a.some(value => b.includes(value));

export function evaluatePracticeFit(question, options = {}) {
  const context = options.context || buildPracticeMasteryContext(options);
  const student = context.studentLevel, q = question || {};
  const level = practiceQuestionLevel(q, { syllabusById: context.syllabusById });
  const result = { eligible: false, stageEligible: false, reason: '', score: -Infinity, difficulty: null, target: null,
    studentLevel: student.label, questionLevel: level.label, diagnostic: { level, evidenceCount: 0, confidence: 0, mastery: 0.65 } };
  if (!student.known) return { ...result, reason: 'student-level-required' };
  if (level.invalid) return { ...result, reason: 'question-level-invalid' };
  if (!level.known) return { ...result, reason: 'question-level-unknown' };
  if (level.max > student.max) return { ...result, reason: 'above-student-level' };

  const baseline = stageDifficulty(student.max), prior = baseline - 35, tags = evidenceTags(q);
  const relevant = context.observations.map(observation => {
    const sameObjective = overlap(tags.objectives, observation.objectives);
    const sameConcept = overlap(tags.concepts, observation.concepts);
    const sameTopic = overlap(tags.topics, observation.topics);
    // With explicit tags on both sides, different objectives or concepts are
    // distinct skills: adding fractions does not prove fraction division.
    // Missing tags permit a cautious topic fallback, never full LO confidence.
    const relevance = sameObjective ? 1
      : tags.objectives.length && observation.objectives.length ? 0
        : tags.concepts.length && observation.concepts.length && !sameConcept ? 0
        : sameConcept ? 0.9
          : sameTopic ? (tags.objectives.length || observation.objectives.length ? 0.25 : 0.7) : 0;
    const recency = Math.pow(0.5, Math.max(0, context.now - observation.at) / (45 * DAY));
    return { observation, weight: relevance * recency };
  }).filter(item => item.weight > 0).slice(0, 12);
  const weight = relevant.reduce((sum, item) => sum + item.weight, 0);
  const confidence = weight / (weight + 4);
  const mastery = (4 * 0.65 + relevant.reduce((sum, item) => sum + item.weight * item.observation.credit, 0)) / (4 + weight);
  const evidenceTarget = relevant.reduce((sum, { observation, weight: w }) => {
    // A correct easy question is evidence at that question's difficulty, not
    // a free promotion. A miss lowers the local target and invites scaffolding.
    const estimate = clamp(observation.difficulty + (observation.credit - 0.7) * 280 - 20, baseline - 240, baseline + 260);
    return sum + w * estimate;
  }, 0);
  const target = Math.round(clamp((4 * prior + evidenceTarget) / (4 + weight), baseline - 100, baseline + 220));
  const difficulty = questionDifficulty(q, level);
  const ceiling = target + 100;
  // Automatic practice may scaffold below the target, but a small bank must
  // not fill a capable older pupil's feed with very basic arithmetic. A
  // teacher's explicit level-only revision choice can still go further back.
  const floor = target - 220;
  // Lower-level revision has an explicit cost, so a cold P6 learner starts
  // on P6 rather than cycling through P1 arithmetic. Weak evidence can still
  // make a carefully chosen prior-stage scaffold the closest fit.
  const stageGap = student.max - level.max;
  const score = Math.round(1000 - Math.abs(difficulty.value - target) - stageGap * 12);
  const diagnostic = { level, evidenceCount: relevant.length, confidence, mastery,
    difficultySource: difficulty.source, difficultyFloor: floor, difficultyCeiling: ceiling,
    focus: mastery < 0.55 ? 'scaffold' : confidence >= 0.35 && mastery >= 0.75 ? 'progress' : 'steady' };
  return { ...result, stageEligible: true, eligible: !!options.levelOnly || (difficulty.value >= floor && difficulty.value <= ceiling),
    reason: options.levelOnly ? '' : difficulty.value > ceiling ? 'difficulty-too-high' : difficulty.value < floor ? 'difficulty-too-low' : '',
    difficulty: difficulty.value, target, score, diagnostic };
}
