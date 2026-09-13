// Presentation-only coaching: consumes marks already awarded and existing
// feedback. It never grades an answer, calls a model or reads the answer key.
const coach = (id,name,focus,intro,action,accent,animal) => Object.freeze({id,name,focus,intro,action,accent,animal});
export const SCIENCE_COACHES = Object.freeze({
  comparison:coach('comparison','Comparison Casey','Compare both sides',"Let's make the comparison clear.",'Name both things, compare the same feature, and say how they differ or are alike.','#3867a8','Chameleon'),
  context:coach('context','Context Connie','Use the question clues',"Let's make your answer fit this question.",'Pick a relevant detail or label from the question or diagram, name it, then explain how it supports or changes your answer.','#866126','Meerkat'),
  specific:coach('specific','Specific Sherry','Make it precise',"Let's help your reader picture exactly what you mean.",'Replace vague words with the exact object, change or observation named in the feedback.','#9a4e99','Fox'),
  evidence:coach('evidence','Evidence Ellen','Use the evidence',"Let's find something that supports your answer.",'Choose a relevant observation or result from the question and state how it supports your claim.','#287b72','Elephant'),
  keywords:coach('keywords','Keyword Kai','Choose science terms',"Let's choose the science words that make your meaning clear.",'Use the science term identified in the feedback, then explain what it means in this question.','#996719','Parrot'),
  concept:coach('concept','Concept Cora','Check the science idea',"Let's work through the science idea together.",'Compare the specific idea flagged in the feedback with the explanation, then rewrite that part in your own words.','#6558a6','Owl'),
  reasoning:coach('reasoning','Reasoning Ravi','Explain the link',"Let's show how your evidence leads to your answer.",'Link your observation to a science idea using “because”, then explain how that leads to your claim.','#ab5b31','Red panda'),
  careful:coach('careful','Careful Cleo','Check the details',"Let's give the details one more look.",'Check the particular label, unit, number or instruction flagged in the feedback against the question.','#367c95','Tortoise'),
  complete:coach('complete','Complete Cody','Take the next step',"One small revision is a good next step.",'Re-read each part of the question and use the marking feedback to choose one thing to add or revise.','#6d7c35','Beaver')
});

export const SCIENCE_COACH_INSTRUCTIONS =
  'Optional feedback field: add coachIssues: [] to each marked item in a batch, or to the single marking result. ' +
  'For partial or incorrect answers only, you may return at most 3 entries {"type":"comparison|context|specific|evidence|keywords|concept|reasoning|careful|complete","detail":"one concrete gap already supported by your marking feedback"}. ' +
  'Order the most useful next step first. Describe the answer, never the child\'s ability or personality. ' +
  'Use context when an answer fails to apply a relevant detail, diagram label or feature of the given situation to its science explanation. Name the actual missed clue and the missing scientific link in detail and in marking feedback. ' +
  'Ground context feedback only in the supplied question, answer key or a diagram you can actually see; do not invent labels, colours, surroundings or other clues. Do not require context for a general science question that does not call for it. ' +
  'For example, ONLY IF the supplied question, key or visible diagram establishes dull-green fruit among green leaves, a missing context link could be that the fruit blends into the leaves and is harder to see, so its smell helps animals locate it. Dull-green fruit alone does not establish a green background. ' +
  'Distinguish context from specific (vague wording), evidence (missing supporting data), reasoning (a missing general causal link), concept (an incorrect science idea), and careful (a specific label swap or other detail error). Prefer one context issue over redundant evidence or reasoning issues for the same gap; keep other independent issues. ' +
  'Do not infer carelessness or misunderstanding from a wrong answer or score alone. Accepted synonyms are not missing keywords. ' +
  'Use complete for a blank answer. Correct or full-credit answers must have coachIssues: []. ' +
  'Omit uncertain or unsupported issues; never state a guess as fact. Do not change the marks or verdict to fit a coach.';

const LIMIT = 280;
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,LIMIT) : '';
const verdict = result => text(result?.verdict || result?.status).toLowerCase();
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function marks(result) {
  return {score:number(result.score ?? result.awarded ?? result.correct),total:number(result.total ?? result.marks ?? result.totalBlanks)};
}
function isCorrect(result) {
  const {score,total}=marks(result);
  return result.correct === true || ['correct','full','full-credit'].includes(verdict(result))
    || (score !== null && total !== null && total > 0 && score >= total);
}
function isWrong(result) {
  const {score,total}=marks(result);
  return result.correct === false || ['partial','incorrect','wrong','blank','incomplete'].includes(verdict(result))
    || (score !== null && total !== null && total > 0 && score >= 0 && score < total);
}
const failed = result => !!result.error || ['error','failed','unavailable','unmarked','pending'].includes(verdict(result));
const unsafeJudgment = s => /\b(?:careless|lazy|stupid|dumb|bad student|poor student|you (?:are|aren't|are not) (?:smart|clever)|(?:do not|don't|does not|doesn't|cannot|can't) understand)\b/i.test(s);
const uncertain = s => /\b(?:maybe|perhaps|possibly|might|may be|seems? (?:to|like))\b/i.test(s);
const reassuring = s => /\b(?:no (?:misconceptions?|errors?|mistakes?|issues?|problems?|missing (?:keywords?|evidence))|no (?:evidence|keywords?|reasoning|comparison) (?:is|are|was|were) missing|without misconceptions?|not (?:a )?misconception|(?:is|are|was|were) not (?:wrong|incorrect|missing|vague|incomplete)|(?:isn't|aren't|wasn't|weren't) (?:wrong|incorrect|missing|vague|incomplete)|(?:do not|don't|does not|doesn't) need to|you (?:did|have|already) (?:clearly )?(?:provide|provided|include|included|compare|compared|explain|explained|use|used)|(?:good|clear|correct|accurate|strong|sufficient|complete|appropriate) (?:comparison|evidence|reasoning|explanation|keywords?|science terms?)|(?:comparison|evidence|reasoning|explanation|keywords?) (?:is|are|was|were) (?:good|clear|correct|accurate|strong|sufficient|complete))\b/i.test(s);
const generic = s => /^(?:wrong|incorrect|not correct|try again|check (?:your|the) answer|needs? improvement|no misconception(?:s)?|none|n\/?a)[.! ]*$/i.test(s);

const contextSource = /\b(?:question(?:'s)?(?: context)?|diagrams?|pictures?|images?|illustrations?|scenarios?|situations?|given (?:information|details?|features?|conditions?))\b/i;
const contextPraise = s => /\b(?:no (?:question )?context (?:is |was )?missing|(?:context|diagram labels?|question clues?) (?:is|are|was|were) (?:used|included|applied|clear|correct|relevant)|(?:context|diagram labels?|question clues?) (?:is|are|was|were) not (?:missing|ignored|omitted)|(?:correctly|clearly|already|appropriately) (?:use[ds]?|appl(?:y|ies|ied)|link(?:s|ed)?|refer(?:s|red) to))\b/i.test(s)
  || /\b(?:do not|don't|does not|doesn't|need not) (?:need to )?(?:use|refer to|apply|link)\b/i.test(s) && /\b(?:need not|do not need|don't need|does not need|doesn't need)\b/i.test(s)
  || /\b(?:does not|doesn't|did not|didn't|never) (?:ignore|omit|overlook)\b/i.test(s);
function contextGap(s) {
  const hasSource=contextSource.test(s) || /\blabels?\b/i.test(s) && /\b(?:use[ds]?|refer|appl(?:y|ied)|link(?:ed)?|connect(?:ed)?|relate[ds]?)\b/i.test(s);
  if (!hasSource || contextPraise(s)) return false;
  // Require an instruction or an observed omission in the answer. Merely
  // discussing a diagram or a scientific absence does not diagnose a pupil.
  return /^(?:please )?(?:use|refer to|apply|link|connect|include|relate|consider)\b/i.test(s)
    || /\b(?:you|your (?:answer|explanation|response))\b.{0,45}\b(?:did not|didn't|do not|don't|does not|doesn't|have not|haven't|has not|hasn't|never|failed to|need to|needs? to|should|must)\b.{0,60}\b(?:use[ds]?|refer(?:red)?|appl(?:y|ies|ied)|link(?:ed)?|connect(?:ed)?|include[ds]?|relate[ds]?|consider(?:ed)?|mention(?:ed)?)\b/i.test(s)
    || /\b(?:your (?:answer|explanation|response))\b.{0,30}\b(?:ignores?|omits?|overlooks?|lacks?)\b/i.test(s)
    || /\b(?:missing|no) (?:clear |explicit )?(?:link|connection|reference|application|use) (?:to|of|between)\b/i.test(s) && /\b(?:your|answer|explanation|response)\b/i.test(s)
    || /\b(?:missing|unused|ignored|omitted) (?:question context|question clues?|details? from (?:the )?(?:question|diagram))\b/i.test(s)
    || /\b(?:diagram labels?|question clues?|question context|given (?:details?|features?|conditions?)) (?:is|are|was|were) (?:missing|unused|ignored|omitted|not (?:used|applied|linked))\b/i.test(s) && /\b(?:your|answer|explanation|response)\b/i.test(s);
}
const contextOverlap = new Set(['specific','evidence','reasoning']);

// Conservative legacy matching. A topic word alone is not an observed gap;
// praise and negated criticisms are removed before these rules are considered.
const RULES = {
  comparison:[/\b(?:missing|lacks?|incomplete|no|needs? (?:a |an )?)\s*(?:clear |direct |explicit )?comparisons?\b/i,/\bcomparisons? (?:is|are|was|were) (?:missing|unclear|incomplete|incorrect)\b/i,/\b(?:did not|didn't|failed to|need to|should|must) (?:explicitly |directly )?(?:compare|contrast)\b/i,/^(?:please )?(?:compare|contrast)\b/i],
  specific:[/\b(?:too vague|not specific|not precise|unclear (?:what|which)|missing (?:specific )?details?)\b/i,/\b(?:be|become|could be|should be|must be) more (?:specific|precise)\b/i,/^(?:please )?(?:name|identify|state) (?:the|which) (?:object|material|variable|change)\b/i],
  evidence:[/\b(?:missing|lacks?|without|no|insufficient|needs? more|not enough)\b.{0,25}\b(?:evidence|observations?|data|results?|measurements?)\b/i,/\b(?:evidence|observations?|data|results?) (?:is|are|was|were) (?:missing|absent|insufficient|not (?:given|provided|included))\b/i,/^(?:please )?(?:add|include|provide|quote|use|give)\b.{0,45}\b(?:evidence|observations?|data|results?|readings?|measurements?)\b/i,/\byou (?:didn't|did not|haven't|have not) (?:give|include|provide|use|quote)\b.{0,25}\b(?:evidence|observations?|data|results?)\b/i],
  keywords:[/\b(?:missing|lacks?|omitted|forgot|no|wrong|incorrect)\b.{0,25}\b(?:keywords?|key terms?|scientific terms?|science terms?|terminology)\b/i,/\b(?:keywords?|science terms?) (?:is|are|was|were) (?:missing|incorrect|wrong)\b/i,/^(?:please )?(?:add|include|use|replace)\b.{0,40}\b(?:keywords?|scientific terms?|science terms?|terminology)\b/i],
  concept:[/\b(?:misconceptions?|misunderstanding|conceptual error)\b/i,/\b(?:you|your answer|your explanation) (?:confuses?|confused|incorrectly (?:states?|says?|claims?))\b/i,/\b(?:incorrect|wrong) (?:science|scientific idea|concept|fact)\b/i,/\b(?:science idea|concept|fact) (?:is|was) (?:incorrect|wrong)\b/i],
  reasoning:[/\b(?:missing|lacks?|no|insufficient|incomplete)\b.{0,20}\b(?:reasoning|explanation|causal link)\b/i,/\b(?:reasoning|explanation|causal link) (?:is|was) (?:missing|incomplete|unclear|insufficient)\b/i,/\b(?:did not|didn't|need to|should|must|does not|doesn't) explain (?:why|how)\b/i,/^(?:please )?(?:explain (?:why|how)|link\b|connect\b|add\b.{0,20}\bbecause\b)/i],
  careful:[/\b(?:wrong|incorrect|missing|omitted|forgot|reversed|swapped|misread|check|recheck)\b.{0,25}\b(?:units?|labels?|numbers?|values?|calculations?|arithmetic|option)\b/i,/\b(?:units?|labels?|numbers?|values?|calculations?) (?:is|are|was|were) (?:wrong|incorrect|missing|swapped)\b/i,/\blabels?\b.{0,30}\b(?:is|are|was|were) (?:wrong|incorrect|swapped|reversed)\b/i],
  complete:[/\b(?:blank|unanswered|not answered|haven't answered|have not answered|haven't annotated|have not annotated|incomplete answer|missing (?:a |the )?(?:part|answer|sentence)|left (?:a |the )?part out)\b/i,/^(?:please )?(?:answer|complete|finish) (?:all |each |every |the remaining |both |part )/i]
};
const PRIORITY = ['concept','comparison','context','evidence','reasoning','specific','keywords','careful','complete'];

export function selectScienceCoaches(result, context = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || failed(result) || isCorrect(result)) return [];
  const found = new Map();
  const add = (id,detail,rank) => {
    if (!Object.hasOwn(SCIENCE_COACHES,id)) return;
    const clean=text(detail);
    if (unsafeJudgment(clean) || uncertain(clean)) return;
    const prior=found.get(id);
    if (!prior || rank > prior.rank) found.set(id,{...SCIENCE_COACHES[id],detail:clean,rank});
  };
  const rows=[result,...(Array.isArray(result.items) ? result.items.slice(0,40) : [])];
  let hasWrong=false, safeFallback='';
  for (const row of rows) {
    if (!row || typeof row !== 'object' || failed(row) || isCorrect(row)) continue;
    const wrong=isWrong(row);hasWrong ||= wrong;
    if (!wrong) continue;
    const feedback=text(row.feedback);
    if (wrong && feedback && !unsafeJudgment(feedback) && !uncertain(feedback) && !reassuring(feedback)) safeFallback ||= feedback;
    if (wrong && Array.isArray(row.coachIssues)) {
      const issues=row.coachIssues.slice(0,12);
      const contextDetails=new Set(issues.filter(issue=>typeof issue?.type === 'string' && issue.type.toLowerCase() === 'context').map(issue=>text(issue.detail).toLowerCase()));
      issues.forEach((issue,i) => {
        if (!issue || typeof issue !== 'object') return;
        const detail=text(issue.detail);let id=typeof issue.type === 'string' ? issue.type.toLowerCase() : '';
        if (!detail || generic(detail) || reassuring(detail) || detail.split(/\s+/).length < 3) return;
        // Older marking prompts can call the same context omission evidence or
        // reasoning. Show a single useful coach for that gap, not three tips.
        if (contextOverlap.has(id) && (contextGap(detail) || contextDetails.has(detail.toLowerCase()))) id='context';
        if (id === 'context' && contextPraise(detail)) return;
        add(id,detail,200-i);
      });
    }
    const misconception=text(row.misconception);
    if (wrong && misconception && !generic(misconception) && !reassuring(misconception)) add('concept',misconception,150);
    const blank=verdict(row) === 'blank' || (wrong && (row.blank === true || context.blank === true));
    if (blank) add('complete',feedback,180);
    // Do not classify modelAnswer/expected/student text as marking feedback.
    // An explanation is considered only where it explicitly addresses you.
    const sources=[{value:feedback,explanation:false},{value:text(row.explanation),explanation:true}];
    for (const source of sources) {
      const clauses=source.value.split(/[.!?;]|\b(?:but|however|yet)\b/i).flatMap(sentence=>
        // Keep "between the diagram and your explanation" together. The and
        // joins the two things to link, not another feedback sentence.
        /\b(?:link|connection)\b.{0,30}\bbetween\b/i.test(sentence) ? [sentence] : sentence.split(/\band (?=(?:you|your)\b)/i));
      for (const raw of clauses) {
        const clause=raw.trim().replace(/[’]/g,"'");
        if (!clause || unsafeJudgment(clause) || uncertain(clause) || reassuring(clause)) continue;
        if (source.explanation && !/\b(?:you|your)\b/i.test(clause)) continue;
        // A statement about absent scientific evidence is not necessarily a
        // criticism of the pupil's answer.
        if (/\b(?:there is|there was|shows?|found) no evidence\b|\bno evidence of\b/i.test(clause)) continue;
        const needsContext=contextGap(clause);
        if (needsContext) add('context',raw.trim(),100-PRIORITY.indexOf('context'));
        for (const [id,rules] of Object.entries(RULES)) {
          if (needsContext && contextOverlap.has(id)) continue;
          // Missing use of a label is a context gap; swapping or misreading one
          // remains a separate detail check, even in the same feedback clause.
          if (needsContext && id === 'careful' && !/\b(?:wrong|incorrect|reversed|swapped|misread)\b/i.test(clause)) continue;
          if (rules.some(rule=>rule.test(clause))) add(id,raw.trim(),100-PRIORITY.indexOf(id));
        }
      }
    }
  }
  if (!found.size && hasWrong) add('complete',safeFallback,0);
  return [...found.values()].sort((a,b)=>b.rank-a.rank).slice(0,3).map(({rank,...item})=>item);
}
