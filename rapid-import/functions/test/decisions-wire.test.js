import { decisionRequest, decisionAnswers } from '../decisions-wire.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const body = { state: { text: 'Untrusted worksheet' }, questions: { route: { instructions: 'Choose', criteria: { yes: 'Allowed', no: 'Not allowed' } } } };
const good = () => ({ answers: [{ name: 'route', type: 'choice', choice: 'yes', confidence: .95, probabilities: [{ value: 'yes', probability: .95 }, { value: 'no', probability: .05 }] }] });
test('Decisions schema uses named questions and keeps state only in input', () => {
  const result = decisionRequest(body);
  assert.deepEqual(Object.keys(result).sort(), ['input','model','questions']);
  assert.equal(result.model, 'gpt-6-luna');
  assert.deepEqual(JSON.parse(result.input), body.state);
  assert.deepEqual(result.questions[0], { name: 'route', type: 'choice', instructions: 'Choose', choices: [{ value: 'yes', description: 'Allowed' }, { value: 'no', description: 'Not allowed' }] });
  assert.equal(decisionAnswers(good(), body).answers.route.probabilities.yes, .95);
});
test('Decisions refuses missing, duplicated, unknown, refused or corrupt answers', () => {
  for (const change of [
    p => { p.answers = {}; }, p => { p.answers = []; },
    p => { p.answers.push(p.answers[0]); }, p => { p.answers[0].name = 'unknown'; },
    p => { p.answers[0].type = 'refusal'; }, p => { p.answers[0].choice = 'unknown'; },
    p => { p.answers[0].confidence = NaN; }, p => { p.answers[0].confidence = -1; },
    p => { p.answers[0].probabilities.pop(); },
    p => { p.answers[0].probabilities[1] = p.answers[0].probabilities[0]; },
    p => { p.answers[0].probabilities[0].value = 'unknown'; },
    p => { p.answers[0].probabilities[0].probability = Infinity; },
    p => { p.answers[0].probabilities[0].probability = .2; },
    p => { p.answers[0].choice = 'no'; },
  ]) {
    const payload = good(); change(payload);
    assert.throws(() => decisionAnswers(payload, body), /unreadable/);
  }
});
test('Decisions matches answers by name, independently of response order', () => {
  const schema = { ...body, questions: { route: body.questions.route, target: body.questions.route } };
  const result = good(); result.answers.unshift({ ...good().answers[0], name: 'target' });
  assert.deepEqual(Object.keys(decisionAnswers(result, schema).answers).sort(), ['route', 'target']);
});
