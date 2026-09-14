// Science feeding only. No network, AI, storage, grading or reward writes.
// The grade/mastery and spacing algorithms match the Math portal; this adapter
// reads Science's own topic metadata, rich-text blocks and per-child history.
import { parsePracticeLevel, practiceQuestionLevel, buildPracticeMasteryContext, evaluatePracticeFit } from './science-feed-mastery.js';
import { PRACTICE_FAMILY_COOLDOWN_MS, buildPracticeCatalog, planPracticeQuestions } from './science-feed-variety.js';
import { evaluateQuestionQuality, questionHasUnresolvedStudentFlag } from './science-feed-quality.js';

export { parsePracticeLevel as parseScienceLevel, PRACTICE_FAMILY_COOLDOWN_MS as SCIENCE_FEED_COOLDOWN_MS };
const str = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
const topicsOf = q => [...new Set([q.topic, q.topic2, ...list(q.topics)].map(str).filter(Boolean))];
const retiredQuestion = q => q.notInSyllabus === true || /cell\s*systems?/i.test(topicsOf(q).join(' '));
const time = value => typeof value === 'number' ? (Number.isFinite(value) ? value : 0)
  : value && typeof value.toMillis === 'function' ? Number(value.toMillis()) || 0
    : value && typeof value.seconds === 'number' ? value.seconds * 1000 : Date.parse(value || '') || 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function metadata(options = {}) {
  const objectives = Object.create(null), reverse = new Map();
  for (const [key, value] of Array.isArray(options.objectives)
    ? options.objectives.map(item => [item?.id, item]) : Object.entries(options.objectives || {})) {
    if (key && value) objectives[str(key)] = value;
  }
  for (const [lo, ids] of Object.entries(options.objectiveMap || {})) for (const id of list(ids)) {
    if (!reverse.has(str(id))) reverse.set(str(id), []);
    reverse.get(str(id)).push(lo);
  }
  const topicLevels = new Map(Object.entries(options.topicLevels || {}).map(([key, value]) =>
    [key.trim().toLowerCase(), typeof value === 'object' && value ? value.level : value]));
  return { objectives, reverse, topicLevels };
}

// Exclude all private answer/model fields from exact-content grouping. A corrected
// key must not make the same displayed question appear to be fresh practice.
function visibleBlocks(q) {
  return list(q.blocks).flatMap(block => {
    if (!block || typeof block !== 'object') return [];
    if (block.type === 'text') return [{ type: 'text', content: block.content, part: block.part, subPart: block.subPart }];
    if (block.type === 'image') return [{ type: 'image', url: block.url, caption: block.caption, annotate: !!q.annotation && block.annotate !== false }];
    if (block.type === 'table') {
      const data = block.data || (Array.isArray(block.rows) ? block.rows : {});
      // Keep sparse Firestore cell coordinates. Compacting Object.values would
      // turn [A, blank, B] into [A, B] and erase visible experimental context.
      const cells = Object.keys(data).filter(k => /^\d+$/.test(k)).sort((a,b) => +a-+b).map(r => [r,
        Object.keys(data[r] || {}).filter(k => /^\d+$/.test(k)).sort((a,b) => +a-+b).map(c => [c, data[r][c]])]);
      const rows = cells.map(([r, values]) => values.map(([c, value]) => JSON.stringify([r,c,value])));
      // Dimensions, merged cells and headers are visible context too.
      return [{ type: 'table', rows, caption: JSON.stringify([block.caption || '', block.rows, block.cols, block.headers, block.merges]), header: block.header }];
    }
    // The MCQ renderer does not display block.content/block.question.
    if (block.type === 'fillblank') return [{ type: 'text', content: String(block.text || '')
      .replace(/\[\[[\s\S]+?\]\](?:\s*\[\[[\s\S]+?\]\])*/g, '\uE000')
      .replace(/\[\[[\s\S]*$/g, '\uE000').replace(/\uE000/g, '[[_]]') }];
    if (block.type === 'part') return [{ type: 'text', content: block.content || '', part: block.label, subPart: block.subPart }];
    // A quoted student's response is part of the question students must assess,
    // not the hidden model answer. The renderer deliberately shows these blocks.
    if (block.type === 'studentAnswer') return [{ type: 'text', content: block.answer || '', part: block.label || "Student's Answer" }];
    if (block.type === 'commonMistake') return [{ type: 'text', content: block.text || '', part: block.title || 'Common Mistake' }];
    return [];
  });
}
function normalizeQuestion(q, meta) {
  q = q || {};
  const topics = topicsOf(q);
  const levels = [...list(q.levels)];
  const los = [...new Set([...list(q.los), ...(meta.reverse.get(str(q.id)) || [])].map(str))];
  const hasExplicitStage = parsePracticeLevel(q.level).known || parsePracticeLevel(q.levels).known
    || los.some(id => parsePracticeLevel(meta.objectives[id]?.level).known);
  for (const topic of topics) {
    const mapped = meta.topicLevels.get(topic.toLowerCase());
    if (mapped != null && mapped !== '') levels.push(mapped);
    else if (topic === str(q.topic2) || !hasExplicitStage) levels.push('Unknown topic metadata');
  }
  // Unknown nonempty explicit metadata remains visible to the strict parser.
  const normalized = { id: str(q.id), level: q.level, levels, los,
    topic: topics.join(', '), topics,
    // Keep the topic/category scope one tag. A plain string containing topic
    // commas or pipes is otherwise split into unrelated partial concept tags.
    concept: q.concept || q.category ? [JSON.stringify([topics.slice().sort(),str(q.concept || q.category)])] : '',
    title: q.title, variantOf: q.variantOf || q.sourceQuestionId || '',
    blocks: visibleBlocks(q), options: list(q.blocks).filter(b => b?.type === 'mcq')
      .map(b => list(b.options).map(option => typeof option === 'object' && option ? option.text : option)),
    difficulty: q.difficulty ?? q.d };
  const stage = practiceQuestionLevel(normalized, { syllabusById: meta.objectives });
  if (stage.known) {
    const rating = Number(normalized.difficulty), base = 500 + stage.max * 100;
    if (normalized.difficulty != null && normalized.difficulty !== '' && Number.isInteger(rating) && rating >= 1 && rating <= 5)
      normalized.difficulty = base + [-100, -50, 0, 80, 150][rating - 1];
    else if (normalized.difficulty == null || normalized.difficulty === '') {
      const usage = q.usage;
      if (usage && Number(usage.students) >= 8 && Number(usage.attempts) >= 12
          && typeof usage.pct === 'number' && Number.isFinite(usage.pct) && usage.pct >= 0 && usage.pct <= 100) {
        const confidence = Math.min(0.75, Number(usage.students) / (Number(usage.students) + 20));
        normalized.difficulty = Math.round(base + clamp((0.65 - usage.pct / 100) * 240 * confidence, -100, 150));
      }
    }
  }
  return normalized;
}

export function scienceQuestionLevel(question, options = {}) {
  const meta = options.context?.meta || metadata(options);
  return practiceQuestionLevel(normalizeQuestion(question, meta), { syllabusById: meta.objectives });
}

function progressRecord(id, record, now) {
  if (!record || typeof record !== 'object') return null;
  const at = time(record.lastAttemptAt ?? record.last);
  const verdict = str(record.lastVerdict).toLowerCase();
  let fraction = null;
  if (typeof record.latestFrac === 'number' && Number.isFinite(record.latestFrac)) fraction = clamp(record.latestFrac, 0, 1);
  else if (verdict === 'correct') fraction = 1;
  else if (verdict === 'incorrect' || verdict === 'wrong') fraction = 0;
  else if (verdict === 'partial' && Number(record.lastOutOf) > 0 && Number.isFinite(Number(record.lastMarks))) fraction = clamp(Number(record.lastMarks) / Number(record.lastOutOf), 0, 1);
  // Lifetime best/attempt counts never substitute for a latest observation.
  const due = time(record.nextReviewAt) || (at && at <= now && fraction != null
    ? at + (fraction >= 1 ? 86400000 : fraction > 0 ? 14400000 : 1800000) : 0);
  return { questionId: id, lastAttemptAt: at, nextReviewAt: due,
    ...(fraction == null ? {} : { lastVerdict: fraction >= 1 ? 'correct' : fraction > 0 ? 'partial' : 'incorrect', lastMarks: fraction, lastOutOf: 1 }) };
}

export function buildScienceFeedContext(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const meta = metadata(options), sourceById = new Map(), normalizedById = new Map(), qualityById = new Map();
  const progress = Object.create(null), excludeEvidenceIds = new Set(), unavailableImageIds = new Set();
  for (const q of Array.isArray(options.bank) ? options.bank : []) {
    if (!q || !str(q.id)) continue;
    const id = str(q.id); sourceById.set(id, q); normalizedById.set(id, normalizeQuestion(q, meta));
    const failed = options.failedImageUrls?.[id] ?? options.failedImageUrls?.get?.(id);
    if (failed && Array.from(failed).length) unavailableImageIds.add(id);
    const check = evaluateQuestionQuality(q, { ...(options.qualityOptions?.(q) || {}),
      studentFlagged: questionHasUnresolvedStudentFlag(q, options.flags?.[id]), failedImageUrls: Array.from(failed || []) });
    qualityById.set(id, check);
    if (check.tier !== 'sound' || retiredQuestion(q) || unavailableImageIds.has(id)) excludeEvidenceIds.add(id);
  }
  for (const [id, record] of Object.entries(options.progress || {})) {
    const value = progressRecord(id, record, now); if (value) progress[id] = value;
  }
  const bank = [...normalizedById.values()], catalog = buildPracticeCatalog(bank);
  const mastery = buildPracticeMasteryContext({ bank, catalog, now, progress, studentLevel: options.studentLevel,
    syllabusById: meta.objectives, excludeEvidenceIds });
  const served = Object.entries(options.served || {}).flatMap(([id, value]) => {
    const at = time(value && typeof value === 'object' ? value.at : value);
    return at > 0 && at <= now && now - at < PRACTICE_FAMILY_COOLDOWN_MS ? [{ id, at }] : [];
  });
  return { meta, options, now, bank, sourceById, normalizedById, qualityById, catalog, mastery, progress,
    run: { uid: 'science', served }, excludeEvidenceIds, unavailableImageIds };
}

export function evaluateScienceFit(question, options = {}) {
  const context = options.context || buildScienceFeedContext({ ...options, bank: options.bank || [question] });
  const q = context.normalizedById.get(str(question?.id)) || normalizeQuestion(question, context.meta);
  const result = evaluatePracticeFit(q, { context: context.mastery, levelOnly: !!options.manual });
  // Secondary Science is a separate syllabus band in this portal.
  if (context.mastery.studentLevel.max >= 7 && result.diagnostic.level.max < 7)
    return { ...result, eligible: false, stageEligible: false, reason: 'below-school-band' };
  return result;
}

export function planScienceQuestions(candidates, options = {}) {
  const source = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const context = options.context || buildScienceFeedContext({ ...options, bank: options.bank || source });
  const rows = [], blocked = []; let reviewCount = 0;
  source.forEach((q, order) => {
    const id = str(q.id), fit = evaluateScienceFit(q, { context, manual: options.manual });
    const quality = context.qualityById.get(id) || evaluateQuestionQuality(q, context.options.qualityOptions?.(q) || {});
    const retired = retiredQuestion(q);
    const reason = !id ? 'question-id-required' : !fit.eligible ? fit.reason
      : retired && !(options.manual && options.allowRetired) ? 'outside-syllabus'
      : !quality.eligible || context.unavailableImageIds.has(id)
        ? 'question-blocked' : !options.manual && quality.tier !== 'sound' ? 'question-review' : '';
    if (reason) { blocked.push({ id, reason }); return; }
    if (quality.tier !== 'sound') reviewCount++;
    rows.push({ q, order, fit });
  });
  if (!options.manual) rows.sort((a,b) => a.fit.diagnostic.priorityTier - b.fit.diagnostic.priorityTier
    || b.fit.score - a.fit.score || a.order - b.order);
  const scheduled = planPracticeQuestions(rows.map(row => context.normalizedById.get(str(row.q.id)) || normalizeQuestion(row.q, context.meta)), {
    catalog: context.catalog, bank: context.bank, progress: context.progress, run: context.run,
    uid: 'science', now: context.now, manual: !!options.manual, limit: options.limit,
    excludeIds: options.excludeIds, excludeFamilyIds: options.excludeFamilyIds, onePerFamily: options.onePerFamily });
  const originals = new Map(source.map(q => [str(q.id), q]));
  blocked.push(...scheduled.blocked);
  return { questions: scheduled.questions.map(q => originals.get(str(q.id))).filter(Boolean), blocked,
    reasons: [...new Set(blocked.map(row => row.reason))], reviewCount, nextReviewAt: scheduled.nextReviewAt };
}
