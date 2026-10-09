import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SS_LIMITS, extractSummaryQuestionImages, summarySourceFingerprint, createSummaryCard,
  normalizeSummarySheet, normalizeSummarySuggestion, summarySheetPrintHtml,
} from '../summary-sheet-core.mjs';
import { fixtureImage, sampleQuestions, sourceContext } from './summary-sheet-fixtures.mjs';

test('original question images include stem, figure, table and options without solution diagrams', () => {
  const q=sampleQuestions()[0],before=structuredClone(q);
  const images=extractSummaryQuestionImages(q);
  assert.deepEqual(images.map(image=>image.url),[
    fixtureImage('apparatus'),fixtureImage('table-figure'),fixtureImage('option-a'),fixtureImage('option-b'),
  ]);
  assert.equal(new Set(images.map(image=>image.url)).size,images.length,'A repeated original figure appears once');
  assert.ok(images.every(image=>typeof image.label==='string'));
  assert.deepEqual(q,before);
});
test('unsafe image schemes and attributes cannot become student or print image requests', () => {
  const q={...sampleQuestions()[0],blocks:[
    {id:'unsafe',type:'image',url:'javascript:alert(1)'},
    {id:'html',type:'text',content:'<img src="data:text/html,<script>alert(1)</script>"><img data-src="https://wrong.test/fake.png" src="'+fixtureImage('apparatus')+'" onerror="alert(1)">'},
  ]};
  assert.deepEqual(extractSummaryQuestionImages(q).map(image=>image.url),[fixtureImage('apparatus')]);
});
test('every original image is kept or the oversized source is refused explicitly',()=>{
  const q={id:'many',title:'All figures matter',blocks:Array.from({length:SS_LIMITS.images+1},(_,i)=>({id:'picture-'+i,type:'image',url:fixtureImage('picture-'+i)}))};
  assert.throws(()=>createSummaryCard(q,{text:q.title,answer:'Inspect every figure.'}),/pictures|images|figures/i);
});
test('a card copies authentic source wording, answers, units and original images without mutating the source', () => {
  const q=sampleQuestions()[0],before=structuredClone(q),card=createSummaryCard(q,sourceContext(q),'card-1');
  assert.equal(card.id,'card-1');assert.equal(card.questionId,q.id);assert.equal(card.topic,q.topic);
  assert.ok(card.sourceText.includes('80°C') && card.sourceText.includes('50°C'));
  assert.match(card.sourceAnswer,/heat.*surroundings/i);
  assert.deepEqual(card.images,extractSummaryQuestionImages(q));assert.notEqual(card.images,q.blocks);
  assert.equal(card.sourceSignature,summarySourceFingerprint(q));
  assert.ok(card.shortQuestion.length<=SS_LIMITS.question && card.shortAnswer.length<=SS_LIMITS.answer);
  card.images[0].label='Teacher changed only the card caption';assert.deepEqual(q,before);
});
test('CER claims, evidence and reasoning remain available to the source-grounded suggestion', () => {
  const q=sampleQuestions()[1],card=createSummaryCard(q,sourceContext(q),'card-cer');
  assert.ok(card.sourceAnswer.includes('Cup A keeps water hot longer.'));
  assert.ok(card.sourceAnswer.includes('It loses less heat in the same time.'));
  assert.ok(card.sourceAnswer.includes('Felt is a poor conductor of heat.'));
  assert.deepEqual(card.images.map(image=>image.url),[fixtureImage('wide-insulation')]);
});
test('source fingerprints detect changed wording, original diagram or answer while surviving JSON storage', () => {
  const q=sampleQuestions()[0],original=summarySourceFingerprint(q);
  assert.equal(summarySourceFingerprint(JSON.parse(JSON.stringify(q))),original);
  for(const change of [copy=>{copy.blocks[0].content='New wording';},copy=>{copy.blocks[1].url=fixtureImage('new-figure');},copy=>{copy.blocks[4].content='A new answer';}]){
    const copy=structuredClone(q);change(copy);assert.notEqual(summarySourceFingerprint(copy),original);
  }
});
test('AI suggestions normalize bounded editable fields and cannot replace source identities or images', () => {
  const reply={shortQuestion:'Why does water cool?',shortAnswer:'It loses heat to cooler surroundings.',howTo:'Compare the water and surrounding temperatures.',questionId:'invented',images:[{url:'https://invented.test/image.png'}]};
  const suggestion=normalizeSummarySuggestion(JSON.stringify(reply));
  assert.equal(suggestion.shortQuestion,reply.shortQuestion);assert.equal(suggestion.shortAnswer,reply.shortAnswer);assert.equal(suggestion.howTo,reply.howTo);
  assert.equal(suggestion.questionId,undefined);assert.equal(suggestion.images,undefined);
  const bounded=normalizeSummarySuggestion({shortQuestion:'q'.repeat(2000),shortAnswer:'a'.repeat(2000),howTo:'h'.repeat(2000)});
  assert.ok(bounded.shortQuestion.length<=SS_LIMITS.question);assert.ok(bounded.shortAnswer.length<=SS_LIMITS.answer);assert.ok(bounded.howTo.length<=SS_LIMITS.howTo);
  assert.throws(()=>normalizeSummarySuggestion('not-json'));
});
test('saved-sheet JSON round trips retain teacher text, card order and original image URLs', () => {
  const cards=sampleQuestions().slice(0,2).map((q,index)=>createSummaryCard(q,sourceContext(q),'card-'+index));
  cards[0].shortQuestion='Teacher wording';cards[0].shortAnswer='Teacher answer';cards[0].howTo='Teacher strategy';
  const stored={id:'sheet-1',kind:'summary-sheet',title:'Heat revision',summaryCards:cards.reverse(),createdAt:'2026-10-10'};
  const result=normalizeSummarySheet(JSON.parse(JSON.stringify(stored)),'sheet-1');
  assert.equal(result.kind,'summary-sheet');assert.equal(result.id,'sheet-1');assert.equal(result.title,stored.title);
  assert.deepEqual(result.summaryCards.map(card=>card.id),stored.summaryCards.map(card=>card.id));
  assert.equal(result.summaryCards[1].shortQuestion,'Teacher wording');assert.equal(result.summaryCards[1].shortAnswer,'Teacher answer');
  assert.deepEqual(result.summaryCards[1].images.map(image=>image.url),cards[1].images.map(image=>image.url));
});
test('normalized cards and sheets enforce compact text and collection limits', () => {
  const card=createSummaryCard(sampleQuestions()[0],{},'card-1');
  const stored={id:'large',kind:'summary-sheet',title:'t'.repeat(1000),summaryCards:Array.from({length:SS_LIMITS.cards+10},(_,i)=>({...card,id:'card-'+i,shortQuestion:'q'.repeat(2000),shortAnswer:'a'.repeat(2000),howTo:'h'.repeat(2000)}))};
  const result=normalizeSummarySheet(stored,'large');
  assert.ok(result.title.length<=SS_LIMITS.title);assert.ok(result.summaryCards.length<=SS_LIMITS.cards);
  assert.ok(result.summaryCards.length>0 && result.summaryCards.every(card=>card.shortQuestion.length<=SS_LIMITS.question && card.shortAnswer.length<=SS_LIMITS.answer && card.howTo.length<=SS_LIMITS.howTo));
});
test('presentation and print HTML preserve card content while escaping teacher text and image labels', () => {
  const card=createSummaryCard(sampleQuestions()[2],{},'card-print');
  card.shortQuestion='<img src=x onerror="alert(1)"> Why & how?';card.shortAnswer='<script>alert(1)</script> Light is blocked.';
  card.images[0].label='" onerror="alert(1)';
  const sheet=normalizeSummarySheet({id:'print',kind:'summary-sheet',title:'Heat <lesson>',summaryCards:[card]},'print');
  const html=summarySheetPrintHtml(sheet);
  assert.match(html,/Heat &lt;lesson&gt;/);assert.ok(html.includes(fixtureImage('tall-shadow')));
  assert.doesNotMatch(html,/<script\b|<img src=x/i);assert.doesNotMatch(html,/<img[^>]*\sonerror\s*=\s*["']/i);
  assert.match(html,/Light is blocked/);assert.match(html,/break-inside:\s*avoid|page-break-inside:\s*avoid/i);
});
