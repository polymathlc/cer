import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePracticeLevel, practiceQuestionLevel, buildPracticeMasteryContext, evaluatePracticeFit } from '../science-feed-mastery.js';

const NOW = Date.parse('2026-09-14T08:00:00Z');
const q = (id, extra = {}) => ({ id, title: 'Question', level: 'P4', topic: 'Fractions',
  blocks: [{ type: 'text', content: `Calculate ${id} + 2.` }], ...extra });
const fit = (question, extra = {}) => evaluatePracticeFit(question, { studentLevel: 'P4', now: NOW, ...extra });
const p = (verdict = 'correct', extra = {}) => ({ lastVerdict: verdict, lastAttemptAt: new Date(NOW - 60000).toISOString(), ...extra });
const evidence = (n, verdict, extra = {}) => {
  const bank = Array.from({ length: n }, (_, i) => q(`e${i}`, extra));
  return { bank, progress: Object.fromEntries(bank.map(question => [question.id, p(verdict)])) };
};

test('all declared range endpoints determine the school ceiling', () => {
  for (const raw of ['P4/P6', 'P4–P6', 'P4–6', 'Primary 4 to 6', 'P4, P6', ['P4', 'P6'], 'Upper primary']) {
    assert.equal(parsePracticeLevel(raw).max, 6, JSON.stringify(raw));
    assert.equal(fit(q('q', { level: raw })).reason, 'above-student-level');
  }
  assert.equal(parsePracticeLevel('Primary 4 (Foundation)').label, 'P4');
  assert.equal(parsePracticeLevel('P4 / Primary 6').label, 'P6');
  assert.equal(parsePracticeLevel('P6/S1').label, 'S1');
});

test('malformed school levels never become a lower valid level', () => {
  for (const level of ['P4/P7', 'P40', 'P4-2', 'P4 mystery', 'P4 (P6?)', 'P4 / H3', 4, {}, ['P4', 'unknown']]) {
    assert.equal(fit(q('q', { level })).eligible, false, JSON.stringify(level));
  }
});

test('unfinished mixed school-stage labels cannot collapse into their lower endpoint', () => {
  for (const level of ['P4 / Secondary', 'P4 and Sec', 'P4 + S', 'P4 + JC', 'P4 / Junior college', 'P4 / Primary']) {
    assert.equal(parsePracticeLevel(level).invalid, true, level);
    assert.equal(fit(q('q', { level })).reason, 'question-level-invalid', level);
  }
  assert.equal(fit(q('q', { level: 'Secondary', los: ['P4.FR.1.1'] })).reason, 'question-level-invalid');
  for (const level of ['Primary 4 (Foundation Maths)', 'P4 Standard', 'P4 easy', 'P4 and Primary 6']) {
    assert.equal(parsePracticeLevel(level).known, true, level);
  }
  assert.equal(parsePracticeLevel('JC').max, 13);
});

test('unknown student level must be selected even with an inflated Elo or a range', () => {
  for (const studentLevel of ['', null, undefined, 'unknown', 'Practice', 'P4/P6']) {
    const result = fit(q('q'), { studentLevel, profile: { elo: 2200, eloAttempts: 999 } });
    assert.equal(result.reason, 'student-level-required');
  }
});

test('P4 cold start prefers current-stage ordinary work, never P5/P6 despite low difficulty', () => {
  const current = fit(q('current'));
  assert.equal(current.eligible, true);
  assert.equal(current.target, 865);
  assert.ok(current.score > fit(q('old', { level: 'P1' })).score);
  for (const level of ['P5', 'P6', 'S1', 'Secondary 2', 'JC1', 'H2']) {
    const result = fit(q('q', { level, difficulty: 400 }), { profile: { elo: 2200 } });
    assert.equal(result.reason, 'above-student-level', level);
  }
  assert.equal(fit(q('hard', { difficulty: 1800 })).reason, 'difficulty-too-high');
});

test('syllabus objectives raise the ceiling regardless of a misleading level label', () => {
  const syllabusById = { 'P6.ALG.1.1': { level: 'P6' }, 'P4.FR.1.1': { level: 'P4' } };
  assert.equal(fit(q('q', { los: ['P6.ALG.1.1'], difficulty: 400 }), { syllabusById }).reason, 'above-student-level');
  assert.equal(fit(q('q', { level: 'Practice', los: ['P4.FR.1.1'] }), { syllabusById }).eligible, true);
  assert.equal(fit(q('q', { level: '', los: ['P6.ALG.1.1'] }), { syllabusById }).reason, 'above-student-level');
  assert.equal(practiceQuestionLevel(q('q', { los: ['P4.FR.1.1'] }), { syllabusById }).label, 'P4');
});

test('missing and invalid level metadata cannot bypass the cap', () => {
  assert.equal(fit(q('q', { level: 'Practice' })).reason, 'question-level-unknown');
  for (const los of [['P7.ALG.1.1'], ['weird-id'], 'P6.ALG.1.1', [null]]) {
    assert.equal(fit(q('q', { los })).reason, 'question-level-invalid');
  }
  assert.equal(fit(q('q', { los: ['P4.FR.1.1'] }), { syllabusById: {} }).reason, 'question-level-invalid');
  assert.equal(fit(q('q', { level: 'P4/P7', los: ['P4.FR.1.1'] })).reason, 'question-level-invalid');
});

test('manual level-only mode preserves worksheets but cannot bypass a school boundary', () => {
  assert.equal(fit(q('hard', { difficulty: 1800 })).stageEligible, true);
  assert.equal(fit(q('older', { level: 'P6' })).stageEligible, false);
  assert.equal(fit(q('hard', { difficulty: 1800 }), { levelOnly: true }).eligible, true);
  assert.equal(fit(q('older', { level: 'P6' }), { levelOnly: true }).eligible, false);
  assert.equal(fit(q('unknown', { level: '' }), { levelOnly: true }).eligible, false);
  assert.equal(fit(q('revision', { level: 'P1' }), { studentLevel: 'P6', levelOnly: true }).eligible, true);
});

test('automatic work has a lower difficulty floor rather than filling a P6 feed with P1 questions', () => {
  for (const level of ['P1', 'P2', 'P3']) {
    const result = fit(q('revision', { level }), { studentLevel: 'P6' });
    assert.equal(result.reason, 'difficulty-too-low', level);
    assert.equal(result.eligible, false);
    assert.equal(result.stageEligible, true, 'an explicit revision choice may still use this school level');
    assert.equal(result.diagnostic.difficultyFloor, 845);
  }
  assert.equal(fit(q('revision', { level: 'P4' }), { studentLevel: 'P6' }).eligible, false);
  const history = evidence(12, 'incorrect', { level: 'P6' });
  const scaffold = fit(q('scaffold', { level: 'P3' }), { ...history, studentLevel: 'P6' });
  assert.equal(scaffold.target, 1000);
  assert.equal(scaffold.eligible, false, 'automatic scaffolding cannot jump back three school years');
  assert.equal(fit(q('scaffold', { level: 'P4' }), { ...history, studentLevel: 'P6' }).eligible, true,
    'distinct relevant struggles permit a two-year scaffold');
  assert.equal(fit(q('filler', { level: 'P1' }), { ...history, studentLevel: 'P6' }).eligible, false);
});

test('distinct recent mastery promotes within-grade challenge gradually', () => {
  const challenge = q('challenge', { difficulty: 990 });
  assert.equal(fit(challenge).eligible, false);
  const history = evidence(12, 'correct');
  const mastered = fit(challenge, history);
  assert.equal(mastered.eligible, true);
  assert.ok(mastered.target > fit(challenge).target);
  assert.equal(mastered.diagnostic.focus, 'progress');
  assert.equal(fit(q('p5', { level: 'P5', difficulty: 400 }), history).eligible, false);
});

test('misses prefer a prior-stage scaffold and suppress advanced current-stage work', () => {
  const history = evidence(12, 'incorrect');
  const ordinary = fit(q('current'), history), scaffold = fit(q('easier', { level: 'P3' }), history);
  assert.equal(ordinary.target, 800);
  assert.equal(ordinary.eligible, true, 'a neutral current-stage question remains available if no scaffold exists');
  assert.ok(scaffold.score > ordinary.score);
  assert.equal(ordinary.diagnostic.focus, 'scaffold');
  assert.equal(fit(q('challenge', { difficulty: 970 }), history).eligible, false);
});

test('a strong unrelated topic never raises a weak topic or an unseen concept', () => {
  const strong = evidence(12, 'correct', { topic: 'Geometry' });
  const history = { bank: strong.bank.concat(q('fraction')), progress: { ...strong.progress, fraction: p('incorrect') } };
  const geometry = fit(q('shape', { topic: 'Geometry' }), history);
  const fraction = fit(q('fraction-next'), history);
  const unseen = fit(q('ratio', { topic: 'Ratio' }), history);
  assert.ok(geometry.target > fraction.target);
  assert.equal(unseen.target, 865);
  assert.equal(unseen.diagnostic.evidenceCount, 0);
});

test('objective and concept evidence follows the skill across different topic names', () => {
  const bank = [q('a', { topic: 'Word problems', concept: 'Bar modelling', los: ['P4.FR.1.1'] })];
  const progress = { a: p('correct') };
  const byObjective = fit(q('b', { topic: 'Unrelated label', los: ['P4.FR.1.1'] }), { bank, progress });
  const byConcept = fit(q('b', { topic: 'Another label', concept: 'bar modelling' }), { bank, progress });
  assert.equal(byObjective.diagnostic.evidenceCount, 1);
  assert.equal(byConcept.diagnostic.evidenceCount, 1);
  assert.ok(byObjective.diagnostic.confidence > byConcept.diagnostic.confidence);
});

test('different explicit objectives in the same topic remain separate skills', () => {
  const history = evidence(12, 'correct', { los: ['P4.FR.1.1'], concept: 'Fraction calculation' });
  const unfamiliar = fit(q('division', { los: ['P4.FR.2.1'], concept: 'Fraction calculation', difficulty: 990 }), history);
  assert.equal(unfamiliar.target, 865);
  assert.equal(unfamiliar.diagnostic.evidenceCount, 0);
  assert.equal(unfamiliar.eligible, false);
  const familiar = fit(q('addition', { los: ['P4.FR.1.1'], difficulty: 990 }), history);
  assert.equal(familiar.eligible, true);
});

test('different explicit concepts cannot promote an unseen skill within the same broad topic', () => {
  const history = evidence(12, 'correct', { concept: 'Adding fractions' });
  const unfamiliar = fit(q('division', { concept: 'Dividing fractions', difficulty: 990 }), history);
  assert.equal(unfamiliar.target, 865);
  assert.equal(unfamiliar.diagnostic.evidenceCount, 0);
  assert.equal(unfamiliar.eligible, false);
  const familiar = fit(q('addition', { concept: 'Adding fractions', difficulty: 990 }), history);
  assert.equal(familiar.eligible, true);
  const sharedObjectiveHistory = evidence(12, 'correct', { concept: 'Adding fractions', los: ['P4.FR.1.1'] });
  const sharedObjective = fit(q('renamed', { concept: 'Equivalent fraction sums', los: ['P4.FR.1.1'], difficulty: 990 }), sharedObjectiveHistory);
  assert.equal(sharedObjective.eligible, true, 'matching syllabus objectives remain direct evidence despite different concept labels');
});

test('100 attempts on one question count once and never use inflated aggregate Elo', () => {
  const bank = [q('a')];
  const one = fit(q('next'), { bank, progress: { a: p('correct', { attempts: 1, correctStreak: 1 }) } });
  const repeated = fit(q('next'), { bank, progress: { a: p('correct', { attempts: 100, correctStreak: 100, pointsEarned: 1000 }) },
    profile: { elo: 2200, eloAttempts: 100, topicStats: { Fractions: { attempts: 100, correct: 100 } } } });
  assert.deepEqual(repeated, one);
  assert.equal(repeated.diagnostic.evidenceCount, 1);
  assert.ok(repeated.diagnostic.confidence < 0.2);
});

test('same-content duplicates and numerical story variants each count as one family', () => {
  const exact = Array.from({ length: 12 }, (_, i) => q(`copy${i}`, { blocks: [{ type: 'text', content: 'Find 3 + 4.' }] }));
  const variants = Array.from({ length: 12 }, (_, i) => q(`story${i}`, { title: "Peggy's Savings", variantOf: 'peggy' }));
  for (const bank of [exact, variants]) {
    const progress = Object.fromEntries(bank.map(question => [question.id, p('correct')]));
    assert.equal(fit(q('next'), { bank, progress }).diagnostic.evidenceCount, 1);
  }
});

test('a later miss replaces earlier family success instead of averaging repeated wins', () => {
  const bank = [q('a', { variantOf: 'root' }), q('b', { variantOf: 'root' })];
  const progress = { a: p('correct', { attempts: 500 }), b: p('incorrect', { lastAttemptAt: new Date(NOW).toISOString() }) };
  const result = fit(q('next'), { bank, progress });
  assert.equal(result.diagnostic.evidenceCount, 1);
  assert.ok(result.target < 865);
});

test('unclassified, future, stale and above-level history cannot inflate the target', () => {
  const bank = [q('future'), q('stale'), q('above', { level: 'P6' }), q('unknown', { level: 'Practice' })];
  const progress = { future: p('correct', { lastAttemptAt: NOW + 2 * 86400000 }), stale: p('correct', { lastAttemptAt: NOW - 181 * 86400000 }),
    above: p('correct'), unknown: p('correct'), deleted: p('correct') };
  const result = fit(q('next'), { bank, progress });
  assert.equal(result.target, 865);
  assert.equal(result.diagnostic.evidenceCount, 0);
});

test('success on very easy earlier-stage work does not unlock harder current-stage questions', () => {
  const history = evidence(12, 'correct', { level: 'P1' });
  assert.equal(fit(q('hard', { difficulty: 990 }), history).eligible, false);
  assert.ok(fit(q('normal'), history).target <= 865);
});

test('partial results use the latest marks, not lifetime accumulated points', () => {
  const bank = [q('a')];
  const low = fit(q('next'), { bank, progress: { a: p('partial', { lastMarks: 1, lastOutOf: 4, pointsEarned: 1000, pointsPossible: 1000 }) } });
  const high = fit(q('next'), { bank, progress: { a: p('partial', { lastMarks: 3, lastOutOf: 4 }) } });
  assert.ok(high.target > low.target);
});

test('suspect or broken questions do not count against student mastery', () => {
  const bank = [q('broken'), q('healthy')], progress = { broken: p('incorrect'), healthy: p('correct') };
  const healthyOnly = fit(q('next'), { bank, progress: { healthy: progress.healthy } });
  for (const excludeEvidenceIds of [['broken'], new Set(['broken'])]) {
    assert.deepEqual(fit(q('next'), { bank, progress, excludeEvidenceIds }), healthyOnly);
  }
  assert.deepEqual(fit(q('next'), { bank, progress, evidenceEligible: question => question.id !== 'broken' }), healthyOnly);
});

test('cached contexts are deterministic, support Firestore timestamps and do not mutate inputs', () => {
  const bank = [q('a')], progress = { a: p('correct', { lastAttemptAt: { seconds: (NOW - 60000) / 1000 } }) };
  const original = JSON.stringify({ bank, progress });
  const options = { bank, progress, studentLevel: 'P4', now: NOW };
  const context = buildPracticeMasteryContext(options);
  assert.deepEqual(evaluatePracticeFit(q('next'), { context }), fit(q('next'), { bank, progress }));
  assert.equal(JSON.stringify({ bank, progress }), original);
});

test('malformed difficulty ratings use stage baseline and valid ratings stay in a stage envelope', () => {
  for (const difficulty of [NaN, Infinity, -1, 5, 100, 'oops', null]) assert.equal(fit(q('q', { difficulty })).difficulty, 900);
  assert.equal(fit(q('q', { difficulty: 400 })).difficulty, 760);
  assert.equal(fit(q('q', { difficulty: 2200 })).difficulty, 1160);
  assert.equal(fit(q('q', { level: 'P4 Foundation' })).difficulty, 810);
});
