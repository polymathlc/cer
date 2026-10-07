// OpenAI Decisions wire format. Internal named criteria remain stable for callers.
// https://developers.openai.com/api/docs/guides/decisions
function decisionRequest(body) {
  return {
    model: 'gpt-6-luna',
    input: JSON.stringify(body.state),
    questions: Object.entries(body.questions).map(([name, question]) => ({
      type: 'choice', name, instructions: question.instructions,
      choices: Object.entries(question.criteria).map(([value, description]) => ({
        value, description: typeof description === 'string' ? description : JSON.stringify(description)
      }))
    }))
  };
}

function decisionAnswers(payload, body) {
  const invalid = () => { throw new Error('Decisions returned an unreadable answer.'); };
  if (!Array.isArray(payload?.answers)) invalid();
  const answers = Object.create(null);
  for (const answer of payload.answers) {
    if (!answer || typeof answer.name !== 'string' || !Object.hasOwn(body.questions, answer.name) ||
        Object.hasOwn(answers, answer.name) || answer.type !== 'choice' || !Array.isArray(answer.probabilities)) invalid();
    const criteria = body.questions[answer.name].criteria;
    const probabilities = Object.create(null);
    for (const item of answer.probabilities) {
      if (!item || typeof item.value !== 'string' || !Object.hasOwn(criteria, item.value) ||
          Object.hasOwn(probabilities, item.value) || typeof item.probability !== 'number' ||
          !Number.isFinite(item.probability) || item.probability < 0 || item.probability > 1) invalid();
      probabilities[item.value] = item.probability;
    }
    if (Object.keys(probabilities).length !== Object.keys(criteria).length ||
        !Object.hasOwn(criteria, answer.choice) || typeof answer.confidence !== 'number' ||
        !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
        Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.05 ||
        Object.values(probabilities).some(p => p > probabilities[answer.choice] + 1e-6)) invalid();
    answers[answer.name] = { ...answer, probabilities };
  }
  if (Object.keys(answers).length !== Object.keys(body.questions).length) invalid();
  return { answers };
}

export { decisionRequest, decisionAnswers };
