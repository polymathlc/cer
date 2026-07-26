// Grades the five simulated-student runs and reports % correct per question.
// Reads the agent transcripts directly so the raw 1000 answers never have to be
// pasted anywhere. MCQ marking is exact; the written rubric is spelled out below
// so every mark can be checked by hand.
const fs = require('fs');
const path = require('path');

const TASKS = '/tmp/claude-0/-home-user-cer/61222d7c-710c-5391-88ee-6f64ce8a2ed1/tasks';
const KEY = {
  f01: { type: 'mcq', correct: 1, label: 'Plants — what a plant needs to make food' },
  f02: { type: 'mcq', correct: 1, label: 'Heat — ball no longer fits ring (expansion)' },
  f03: { type: 'mcq', correct: 1, label: 'Light — ball moved closer to torch, shadow size' },
  f04: { type: 'mcq', correct: 1, label: 'Energy — torch bulb conversion (light AND heat)' },
  f05: { type: 'mcq', correct: 1, label: 'Matter — equal mass, one floats one sinks' },
  f06: { type: 'mcq', correct: 1, label: 'Adaptations — cactus spines' },
  f07: { type: 'mcq', correct: 1, label: 'Electricity — series bulb removed' },
  f08: { type: 'open', label: 'Matter — droplets outside a cold glass',
         need: [/condens/i, /(vapour|vapor|moisture|water in the air|air)/i],
         reject: [/leak|came out|come out|go outside|through the glass|melt/i, /evaporat/i] },
  f09: { type: 'open', label: 'Plant reproduction — no insects, fewer fruits',
         need: [/pollinat/i],
         reject: [/spread (the )?seed|disperse|eat the pest|eat the flower|help the plant.{0,12}grow|no food|weaker|sick/i] },
  f10: { type: 'open', label: 'Heat — towel-wrapped cup stays hotter',
         need: [/cup a/i, /(poor conductor|bad conductor|insulat|less heat|lose[s]? heat slower|slower|trap|keep[s]? the heat|keeps? it warm|cannot (escape|go out|leave)|stop[s]? the heat|prevent|does not (let|allow)|block)/i],
         reject: [/give[s]?.{0,12}heat|extra heat|absorb.{0,12}heat|cup b|both/i] },
};

function markOpen(k, text) {
  const t = String(text || '');
  if (k.reject.some(r => r.test(t))) return false;
  return k.need.every(r => r.test(t));
}

// The transcript is JSONL; the run we want is the assistant text block that
// contains the JSON we asked for. Parse structurally rather than by string
// surgery so nothing depends on how the transcript is escaped.
function extractRun(file) {
  let found = null;
  fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
    if (!line.trim()) return;
    let rec; try { rec = JSON.parse(line); } catch (_) { return; }
    const msg = rec && rec.message;
    if (!msg || msg.role !== 'assistant') return;
    const parts = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    parts.forEach(p => {
      const text = typeof p === 'string' ? p : (p && p.type === 'text' ? p.text : '');
      if (!text || text.indexOf('"student"') < 0) return;
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return;
      try {
        const obj = JSON.parse(text.slice(start, end + 1));
        if (obj && Array.isArray(obj.attempts)) found = obj;
      } catch (_) {}
    });
  });
  return found;
}

const files = fs.readdirSync(TASKS).filter(f => f.endsWith('.output')).map(f => path.join(TASKS, f));
const runs = [];
files.forEach(f => { const r = extractRun(f); if (r && Array.isArray(r.attempts)) runs.push(r); });

if (!runs.length) { console.error('no runs parsed'); process.exit(1); }

const qids = Object.keys(KEY);
const tally = {};
qids.forEach(q => { tally[q] = { correct: 0, n: 0, perStudent: {} } });

runs.forEach(run => {
  const sid = run.student || '?';
  qids.forEach(q => { tally[q].perStudent[sid] = { c: 0, n: 0 }; });
  run.attempts.forEach(att => {
    const ans = att && att.answers ? att.answers : {};
    qids.forEach(q => {
      const given = ans[q];
      if (given === undefined) return;
      const k = KEY[q];
      const ok = k.type === 'mcq'
        ? parseInt(given.option, 10) === k.correct
        : markOpen(k, given.text);
      tally[q].n++; if (ok) tally[q].correct++;
      tally[q].perStudent[sid].n++; if (ok) tally[q].perStudent[sid].c++;
    });
  });
});

const BANDS = [[85,'very easy'],[70,'easy'],[50,'medium'],[30,'hard'],[0,'very hard']];
const band = p => (BANDS.find(b => p >= b[0]) || BANDS[4])[1];

const rows = qids.map(q => {
  const t = tally[q];
  const pct = t.n ? Math.round((t.correct / t.n) * 100) : 0;
  const spread = Object.keys(t.perStudent).sort().map(s => {
    const ps = t.perStudent[s];
    return s + ':' + (ps.n ? Math.round((ps.c / ps.n) * 100) : 0) + '%';
  }).join(' ');
  return { q, type: KEY[q].type, label: KEY[q].label, pct, n: t.n, band: band(pct), spread };
}).sort((a, b) => a.pct - b.pct);

console.log('Students parsed: ' + runs.map(r => r.student).sort().join(', ') +
  '   attempts each: ' + runs[0].attempts.length + '   total answers graded: ' + qids.reduce((s,q)=>s+tally[q].n,0));
console.log('');
console.log('HARDEST FIRST');
console.log('pct  n    band        type  question                                            per-student');
rows.forEach(r => {
  console.log(
    String(r.pct).padStart(3) + '% ' + String(r.n).padStart(3) + '  ' +
    r.band.padEnd(11) + ' ' + r.type.padEnd(5) + ' ' +
    r.label.slice(0, 50).padEnd(51) + r.spread);
});
fs.writeFileSync(__dirname + '/results.json', JSON.stringify({ rows, tally }, null, 1));
