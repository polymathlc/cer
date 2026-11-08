// The requested twenty implementation/review rounds are a release deliverable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ledger=JSON.parse(readFileSync(new URL('../docs/science-legends-20-rounds.json',import.meta.url),'utf8'));

test('release records twenty distinct completed evaluator-to-implementer rounds',()=>{
  assert.equal(ledger.completed_rounds,20);
  assert.equal(ledger.current_round,null);
  assert.deepEqual(ledger.verified_rounds.map(round=>round.round),Array.from({length:20},(_,i)=>i+1));
  assert.equal(new Set(ledger.verified_rounds.map(round=>round.commit)).size,20);
  for(const round of ledger.verified_rounds){
    assert.equal(round.status,'verified');
    assert.match(round.commit,/^[a-f0-9]{7,40}$/);
    assert.ok(round.idea.length>10&&round.finding.length>20&&round.change.length>30);
    assert.ok(round.verification.length>0,`round${round.round} has acceptance evidence`);
  }
});

test('research references stay attributable to primary RPG design sources',()=>{
  const hosts=new Set(['news.blizzard.com','grimdawn.com','supergiantgames.com']);
  const ids=new Set(ledger.sources.map(source=>source.id));
  assert.equal(ids.size,ledger.sources.length);
  for(const source of ledger.sources){
    const url=new URL(source.url);assert.equal(url.protocol,'https:');
    assert.ok(hosts.has(url.hostname.replace(/^www\./,'')));assert.ok(source.lesson.length>20);
  }
  for(const round of ledger.verified_rounds)for(const id of round.sources)assert.ok(ids.has(id),`round${round.round} reference ${id} exists`);
});

test('all source-isolation visual acceptance follow-ups are resolved before release',()=>{
  for(const followup of ledger.asset_quality_followups||[]){assert.equal(followup.status,'resolved');assert.ok(followup.resolved_by.length>0);}
  for(const round of ledger.verified_rounds)assert.ok(!String(round.visual_acceptance||'').startsWith('pending'),`round${round.round} visual acceptance is complete`);
});
