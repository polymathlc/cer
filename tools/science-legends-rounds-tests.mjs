import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const ledger=read('docs/science-legends-50-rounds.json');
test('the requested fifty improvement rounds each retain distinct feedback, implementation and executable verification evidence',()=>{
 assert.equal(ledger.targetRounds,50);assert.equal(ledger.completedRounds,50);assert.equal(ledger.rounds.length,50);
 assert.deepEqual(ledger.rounds.map(r=>r.number).sort((a,b)=>a-b),Array.from({length:50},(_,i)=>i+1));
 for(const key of['area','feedback'])assert.equal(new Set(ledger.rounds.map(r=>r[key])).size,50,'distinct '+key);
 for(const round of ledger.rounds){assert.equal(round.status,'verified');assert.ok(round.feedback.length>30);assert.ok(round.acceptance.length&&round.acceptance.every(s=>s.length>15));assert.match(round.implementation.commit,/^[a-f0-9]{7,40}$/);assert.ok(round.implementation.change.length>30);assert.ok(round.verification.result.length>50);for(const file of round.implementation.files)assert.ok(fs.existsSync(new URL(file,root)),file);const scripts=round.verification.command.match(/tools\/[a-z0-9-]+\.mjs/g);assert.ok(scripts?.length);for(const file of scripts)assert.ok(fs.existsSync(new URL(file,root)),file);}
});
test('benchmark evidence preserves both quality modes, exact actor workload and the adverse outlier',()=>{
 const high=read(ledger.finalBenchmark.highRefreshArtifact),balanced=read(ledger.finalBenchmark.balancedArtifact),outlier=read(ledger.finalBenchmark.retainedOutlierArtifact);
 for(const [rows,cadence]of[[high,120],[balanced,60],[outlier,60]])for(const row of rows){assert.equal(row.cfg.paintCadence,cadence);assert.equal(row.dense.enemyCount,100);assert.equal(row.dense.petCount,4);assert.deepEqual(row.errors,[]);}
 assert.ok(outlier.some(row=>row.dense.stats.draw.max>500),'retain actual adverse draw stall');assert.ok(ledger.finalBenchmark.limitations.some(s=>s.includes('737ms')));assert.ok(ledger.finalBenchmark.limitations.some(s=>s.includes('not universal FPS')));
});
