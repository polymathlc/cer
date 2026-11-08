// Science feeding only. No network, AI, storage, grading or reward writes.
// The grade/mastery and spacing algorithms match the Math portal; this adapter
// reads Science's own topic metadata, rich-text blocks and per-child history.
import { parsePracticeLevel, practiceQuestionLevel, buildPracticeMasteryContext, evaluatePracticeFit } from './science-feed-mastery.js';
import { PRACTICE_FAMILY_COOLDOWN_MS, buildPracticeCatalog, planPracticeQuestions, practiceContentKey } from './science-feed-variety.js';
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

// Persist visible question identity, never private answers or changing bank titles.
export function scienceQuestionContentKey(question) {
  return practiceContentKey(normalizeQuestion(question, metadata()));
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
  const seenIds = new Set(Object.keys(options.seen || {}));
  const seenContentKeys = new Set(options.seenContentKeys || []);
  for (const [id, value] of Object.entries(options.served || {})) {
    const at = time(value && typeof value === 'object' ? value.at : value);
    if (at > 0) seenIds.add(id);
  }
  for (const [id, record] of Object.entries(options.progress || {})) {
    if (record && (time(record.lastAttemptAt ?? record.last) > 0 || Number(record.n) > 0 || Number(record.attempts) > 0)) seenIds.add(id);
  }
  for (const id of seenIds) {
    const item = normalizedById.get(id);
    if (item) { const key = practiceContentKey(item); if (key) seenContentKeys.add(key); }
  }
  const mastery = buildPracticeMasteryContext({ bank, catalog, now, progress, studentLevel: options.studentLevel,
    syllabusById: meta.objectives, excludeEvidenceIds });
  const served = Object.entries(options.served || {}).flatMap(([id, value]) => {
    const at = time(value && typeof value === 'object' ? value.at : value);
    return at > 0 && at <= now && now - at < PRACTICE_FAMILY_COOLDOWN_MS ? [{ id, at }] : [];
  });
  return { meta, options, now, bank, sourceById, normalizedById, qualityById, catalog, mastery, progress,
    run: { uid: 'science', served }, seenIds, seenContentKeys, excludeEvidenceIds, unavailableImageIds };
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

// Games draw a fresh order among comparably suitable questions, never across
// grade priorities or a large mastery gap. Each family gets one lottery entry
// in its fit band, so importing twenty copies cannot crowd out other stories.
function randomizeGameRows(rows, context, options) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const shuffle = values => {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const sample = Number(random());
      const j = Math.floor((Number.isFinite(sample) ? clamp(sample, 0, 1 - Number.EPSILON) : 0.5) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const result = [];
  for (let start = 0; start < rows.length;) {
    const best = rows[start]; let end = start + 1;
    while (end < rows.length && rows[end].fit.diagnostic.priorityTier === best.fit.diagnostic.priorityTier
      && best.fit.score - rows[end].fit.score <= 50) end++;
    const band = rows.slice(start, end);
    if (options.onePerFamily === false) result.push(...shuffle(band));
    else {
      const families = new Map();
      for (const row of band) {
        const id = str(row.q.id), family = context.catalog.families.get(id) || id;
        if (!families.has(family)) families.set(family, []);
        families.get(family).push(row);
      }
      // Pick the family order before its representative; copy count cannot
      // change which family the first random draw chooses.
      for (const family of shuffle([...families.values()])) result.push(...shuffle(family));
    }
    start = end;
  }
  return result;
}

// 🚫 Secondary 1 is retired (v1.453.0). The owner removed every Sec 1 question
// from the system, so no planner — practice, worksheets, quests, the arcade or
// Science Strike — may ever serve one. Nothing is deleted from the database:
// set this to false (and SEC1_RETIRED in app.js / fps.html) to bring them back.
export const SCIENCE_SEC1_RETIRED = true;
const SECONDARY_STAGE = 7;
// Is this question Secondary 1 work? Its HIGHEST filed level decides (a P6
// question with a Sec 1 second topic teaches Sec 1 material too).
export function scienceQuestionIsSec1(question, options = {}) {
  const level = scienceQuestionLevel(question, options);
  return !!level && level.known && !level.invalid && level.max >= SECONDARY_STAGE;
}

export function planScienceQuestions(candidates, options = {}) {
  const source = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const context = options.context || buildScienceFeedContext({ ...options, bank: options.bank || source });
  const sec1Retired = options.sec1Retired ?? SCIENCE_SEC1_RETIRED;
  const rows = [], blocked = [], recyclable = [], fallbackable = []; let reviewCount = 0;
  source.forEach((q, order) => {
    const id = str(q.id), fit = evaluateScienceFit(q, { context, manual: options.manual });
    const quality = context.qualityById.get(id) || evaluateQuestionQuality(q, context.options.qualityOptions?.(q) || {});
    const retired = retiredQuestion(q);
    const qLevel = fit.diagnostic?.level;
    const sec1 = sec1Retired && !!qLevel && qLevel.known && !qLevel.invalid && qLevel.max >= SECONDARY_STAGE;
    if (sec1) { blocked.push({ id, reason: 'sec1-retired' }); return; }
    // 🎮 Games-only safety net: a question turned away ONLY for its grade fit
    // (above/below the learner, outside the mastery window, unknown level…)
    // is still a usable question. options.fallback serves these, nearest
    // level first, when nothing suitable is left (see the end of this plan).
    if (options.fallback && !options.manual && id && !fit.eligible && !retired && quality.tier === 'sound'
        && !context.unavailableImageIds.has(id)) fallbackable.push({ q, order, fit });
    const reason = !id ? 'question-id-required' : !fit.eligible ? fit.reason
      : !options.manual && (context.seenIds.has(id) || context.seenContentKeys.has(scienceQuestionContentKey(q))) ? 'already-seen'
      : retired && !(options.manual && options.allowRetired) ? 'outside-syllabus'
      : !quality.eligible || context.unavailableImageIds.has(id)
        ? 'question-blocked' : !options.manual && quality.tier !== 'sound' ? 'question-review' : '';
    if (reason) {
      blocked.push({ id, reason });
      // A seen question is still a GOOD question: it passed grade, quality and
      // syllabus. Only the arcade's endless cycle (options.recycle) uses it.
      if (reason === 'already-seen' && quality.tier === 'sound' && !retired) recyclable.push({ q, order, fit });
      return;
    }
    if (quality.tier !== 'sound') reviewCount++;
    rows.push({ q, order, fit });
  });
  if (!options.manual) rows.sort((a,b) => a.fit.diagnostic.priorityTier - b.fit.diagnostic.priorityTier
    || b.fit.score - a.fit.score || a.order - b.order);
  const scheduleOptions = {
    catalog: context.catalog, bank: context.bank, progress: context.progress, run: context.run,
    uid: 'science', now: context.now, manual: !!options.manual, limit: options.limit,
    excludeIds: options.excludeIds, excludeFamilyIds: options.excludeFamilyIds, onePerFamily: options.onePerFamily };
  const normalized = row => context.normalizedById.get(str(row.q.id)) || normalizeQuestion(row.q, context.meta);
  let ordered = rows, available;
  if (options.randomize && !options.manual) {
    // Remove recent/held-back questions before forming fit bands. Randomize
    // the entire suitable pool before applying limit; never shuffle a fixed
    // prefix of bank IDs that would give every child the same small set.
    available = planPracticeQuestions(rows.map(normalized), { ...scheduleOptions, limit: Infinity, onePerFamily: false });
    const readyIds = new Set(available.questions.map(q => str(q.id)));
    const unique = new Set();
    ordered = randomizeGameRows(rows.filter(row => {
      const id = str(row.q.id);
      if (!readyIds.has(id) || unique.has(id)) return false;
      unique.add(id); return true;
    }), context, options);
  }
  const scheduled = planPracticeQuestions(ordered.map(normalized), scheduleOptions);
  const originals = new Map(source.map(q => [str(q.id), q]));
  if (available) blocked.push(...available.blocked);
  blocked.push(...scheduled.blocked);
  const questions = scheduled.questions.map(q => originals.get(str(q.id))).filter(Boolean);
  // 🔁 Arcade endless cycle. When the fresh pool cannot fill the request, the
  // games top it up from questions this learner has ALREADY seen, so a game
  // never stops with "no more questions". Grade, quality, syllabus and image
  // checks still apply; only the "seen" ledger and the repeat spacing are
  // waived. See recycleScienceGameRows for the order.
  const recycled = [];
  if (options.recycle && !options.manual) {
    const want = Number.isFinite(options.limit) ? Math.max(0, options.limit) : 1;
    if (questions.length < want) {
      const chosen = new Set(questions.map(q => str(q.id)));
      const room = Number.isFinite(options.limit) ? options.limit - questions.length : Infinity;
      for (const row of recycleScienceGameRows(rows.concat(recyclable).filter(row => !chosen.has(str(row.q.id))), context, options)) {
        if (recycled.length >= room) break;
        const original = originals.get(str(row.q.id));
        if (original) recycled.push(original);
      }
    }
  }
  // 🎮 Arcade safety net (v1.453.0). Students saw "No suitable questions are
  // set for your level yet" whenever the strict grade-and-mastery window held
  // nothing (a small level bank, a learner far above or below the usual
  // difficulty, topics without level metadata). Games now fall back to the
  // nearest usable questions instead of stopping: same level first, then the
  // levels just below, then unlabelled ones, then ONE level above. Only
  // SOUND questions: quality checks, student reports, retired topics, failed
  // images and Sec 1 are never relaxed.
  const fallback = [];
  // A learner with no school level set still fails closed: the game asks for
  // the level instead of guessing which school year to serve.
  if (options.fallback && !options.manual && context.mastery?.studentLevel?.known) {
    const want = Number.isFinite(options.limit) ? Math.max(0, options.limit) : 1;
    const have = questions.length + recycled.length;
    if (have < want) {
      const chosen = new Set(questions.concat(recycled).map(q => str(q.id)));
      const rowsToRank = fallbackable.filter(row => !chosen.has(str(row.q.id)) && scienceFallbackRank(row, context) != null)
        .map(row => ({ q: row.q, order: row.order, fit: { ...row.fit,
          diagnostic: { ...(row.fit.diagnostic || {}), priorityTier: scienceFallbackRank(row, context) } } }));
      for (const row of recycleScienceGameRows(rowsToRank, context, options)) {
        if (have + fallback.length >= want) break;
        const original = originals.get(str(row.q.id));
        if (original) fallback.push(original);
      }
    }
  }
  return { questions: questions.concat(recycled, fallback), recycled: recycled.concat(fallback).map(q => str(q.id)),
    fallback: fallback.map(q => str(q.id)), blocked,
    reasons: [...new Set(blocked.map(row => row.reason))], reviewCount, nextReviewAt: available?.nextReviewAt || scheduled.nextReviewAt };
}

// The endless cycle's order, for a pool that has run out of fresh questions.
// options.cycle maps a question id to when it was last recycled IN THE CURRENT
// ROUND (the app keeps it per learner and starts a new round once every
// question in it has come back once). So:
//   1. questions not yet recycled this round come first, in a fresh shuffle
//      (best grade tier first, then a random order inside each tier), one per
//      family before any second variant of the same story;
//   2. then questions already recycled this round, the longest-ago first —
//      the app sees that and opens a new round, reshuffled.
// Nothing here repeats the question that was just served unless it is the
// only suitable question left.
export function recycleScienceGameRows(rows, context, options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const cycle = options.cycle && typeof options.cycle === 'object' ? options.cycle : {};
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = str(row?.q?.id);
    if (id && !unique.has(id)) unique.set(id, row);
  }
  const lastAt = id => { const at = Number(cycle[id]); return Number.isFinite(at) && at > 0 ? at : 0; };
  const fresh = [], again = [];
  for (const [id, row] of unique) (lastAt(id) ? again : fresh).push(row);
  const keyed = fresh.map(row => {
    const sample = Number(random());
    return { row, key: Number.isFinite(sample) ? sample : 0.5 };
  });
  keyed.sort((a, b) => a.row.fit.diagnostic.priorityTier - b.row.fit.diagnostic.priorityTier || a.key - b.key);
  again.sort((a, b) => lastAt(str(a.q.id)) - lastAt(str(b.q.id)) || a.order - b.order);
  const freshOrdered = keyed.map(item => item.row);
  if (options.onePerFamily === false) return freshOrdered.concat(again);
  // One per family first inside each group, so twenty copies of one story
  // cannot fill a round, and every fresh question still comes before any
  // question that has already been recycled this round.
  const spread = group => {
    const families = new Set(), first = [], rest = [];
    for (const row of group) {
      const id = str(row.q.id), family = context?.catalog?.families?.get(id) || id;
      if (families.has(family)) rest.push(row);
      else { families.add(family); first.push(row); }
    }
    return first.concat(rest);
  };
  return spread(freshOrdered).concat(spread(again));
}

// How far a fallback question sits from what the learner should be doing.
// Lower is better. 0 = their own level (only the mastery window turned it
// away); 1, 2… = that many levels below; 5 = no level metadata; 11 = one level
// ABOVE the learner (a last resort). Two or more levels above, or across the
// primary/secondary line, is never served (null).
export function scienceFallbackRank(row, context) {
  const student = context?.mastery?.studentLevel || {};
  const level = row?.fit?.diagnostic?.level || {};
  if (!level.known || level.invalid) return 5;
  const gap = student.max - level.max;
  if (gap >= 0) return gap;
  return gap === -1 && level.max < 7 ? 11 : null;
}
