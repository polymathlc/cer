/* Run-local wrong-answer pressure, shared by every question-driven game. */
(function (root) {
  'use strict';
  var rates = Object.freeze([0.08, 0.16, 0.28, 0.45, 1]);
  var rules = 'Wrong answers in a row cost 8%, 16%, 28%, then 45% of maximum health. The fifth ends the run. A correct answer resets the streak.';

  function create() { return { wrongStreak: 0, failed: false }; }

  // Call once for a final graded answer, after the game's duplicate/run guards.
  // Apply damage directly to run health, bypassing combat defenses. A fatal
  // result must use the game's normal defeat path, even after a health refill.
  function answer(state, correct, maxHealth) {
    if (!state || typeof state !== 'object') throw new TypeError('A run-local question pressure state is required.');
    if (typeof correct !== 'boolean') throw new TypeError('Question pressure requires a final boolean grade.');
    if (!Number.isFinite(maxHealth) || maxHealth <= 0) throw new RangeError('Question pressure requires positive maximum health.');
    var previous = Math.min(5, Math.max(0, Math.floor(Number(state.wrongStreak) || 0)));
    if (state.failed) return Object.freeze({ applied: false, correct: false, streak: previous, damage: 0, rate: 1, fatal: true, reset: false, message: 'Five wrong answers in a row — game over.' });
    if (correct) {
      state.wrongStreak = 0;
      return Object.freeze({ applied: true, correct: true, streak: 0, damage: 0, rate: 0, fatal: false, reset: previous > 0, message: previous ? 'Correct — wrong-answer streak reset.' : '' });
    }
    var streak = Math.min(5, previous + 1), rate = rates[streak - 1], fatal = streak >= 5;
    var damage = fatal ? maxHealth : Math.max(1, Math.ceil(maxHealth * Math.round(rate * 100) / 100));
    state.wrongStreak = streak;
    state.failed = fatal;
    var message = fatal ? 'Five wrong answers in a row — game over.'
      : 'Wrong-answer streak ' + streak + '/5: lose ' + damage + ' health (' + Math.round(rate * 100) + '% of maximum). '
        + (streak === 4 ? 'The next wrong answer ends the run.' : 'The next wrong answer costs ' + Math.round(rates[streak] * 100) + '% of maximum health.');
    return Object.freeze({ applied: true, correct: false, streak: streak, damage: damage, rate: rate, fatal: fatal, reset: false, message: message });
  }

  var api = Object.freeze({ create: create, answer: answer, rates: rates, rules: rules, limit: 5 });
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameQuestionPressure = api;
})(typeof window === 'object' ? window : globalThis);
