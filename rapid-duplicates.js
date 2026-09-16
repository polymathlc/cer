// Conservative duplicate candidates for a destructive bulk action. The older
// editor warning deliberately has a looser matcher: a warning is not a delete.
export function rapidDuplicateThreshold(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 50 || n > 100) throw new Error('Choose a whole percentage from 50 to 100.');
  return n;
}

export function rapidDuplicateFingerprint(value) {
  function sorted(v) {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]));
    return v;
  }
  return JSON.stringify(sorted(value));
}

function words(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:['./%-][\p{L}\p{N}]+)*/gu) || [];
}

const CRITICAL = /^(?:no|not|never|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|without|except|incorrect|correct|false|true|least|most|before|after|increase|increases|decrease|decreases|greater|less|higher|lower|largest|smallest|hot|cold|heating|cooling|conductor|insulator)$/;

function bag(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return counts;
}
function overlap(a, b) {
  let shared = 0, total = 0;
  for (const count of a.values()) total += count;
  for (const [word, count] of b) { total += count; shared += Math.min(count, a.get(word) || 0); }
  return total ? 2 * shared / total : 0;
}

// shape is supplied by the portal's existing question parser. Mandatory
// details (numbers, polarity, options, answers and diagrams) cannot be waived
// by a low percentage. Unknown block kinds are kept for manual review.
export function rapidDuplicateFeatures(record) {
  const shape = record.shape || {};
  const tokens = words(shape.text);
  const numbers = (String(shape.text || '').match(/[-+]?\d+(?:[.,]\d+)*(?:\/\d+)?\s*(?:%|°[CF]|(?:kg|mg|g|km|cm|mm|m|ml|l|seconds?|minutes?|hours?|s|min|h|n|v|a|j|w)\b)?/gi) || [])
    .map(n => n.replace(/\s+/g, '').toLowerCase());
  const guard = rapidDuplicateFingerprint({
    numbers, critical: tokens.filter(t => CRITICAL.test(t)),
    options: shape.options || [], answers: shape.answers || [], images: shape.images || [],
    structure: shape.structure || [], level: shape.level || '', annotation: !!shape.annotation
  });
  return { guard, tokens, text: tokens.join(' '), bag: bag(tokens),
    pairs: bag(tokens.slice(1).map((t, i) => tokens[i] + ' ' + t)),
    eligible: shape.safe !== false && tokens.length >= 6 };
}

function score(a, b) {
  if (!a.eligible || !b.eligible || a.guard !== b.guard) return 0;
  if (a.text === b.text) return 100;
  // Word counts retain repetition; adjacent pairs keep word order relevant.
  return 100 * Math.min(overlap(a.bag, b.bag), overlap(a.pairs, b.pairs));
}

export function rapidDuplicateSimilarity(a, b) {
  return score(rapidDuplicateFeatures(a), rapidDuplicateFeatures(b));
}

export function findRapidDuplicates(records, minimum) {
  minimum = rapidDuplicateThreshold(minimum);
  const unique = new Map();
  for (const r of records || []) if (r && r.key && !unique.has(r.key)) unique.set(r.key, r);
  const removable = r => r.where === 'vetting' && !!r.removable;
  const ordered = [...unique.values()].sort((a, b) =>
    Number(a.where !== 'bank') - Number(b.where !== 'bank') ||
    Number(removable(a)) - Number(removable(b)) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.key.localeCompare(b.key));
  const keepers = [], buckets = new Map(), pairs = [];
  for (const record of ordered) {
    const features = rapidDuplicateFeatures(record);
    const candidates = buckets.get(features.guard) || [];
    let best = null, bestScore = 0;
    if (removable(record) && features.eligible) {
      for (const keeper of candidates) {
        const pct = score(features, keeper.features);
        if (pct >= minimum && pct > bestScore) { best = keeper.record; bestScore = pct; }
      }
    }
    if (best) pairs.push({ remove: record, keep: best, pct: Math.floor(bestScore * 10) / 10 });
    else {
      keepers.push(record);
      candidates.push({ record, features }); buckets.set(features.guard, candidates);
    }
  }
  return { minimum, pairs, keepers, scanned: ordered.length };
}

export function rapidDuplicatePairCurrent(pair, remove, keep, minimum) {
  if (!pair || !remove || !keep || !remove.removable || remove.where !== 'vetting' || remove.key === keep.key) return false;
  if (remove.key !== pair.remove.key || keep.key !== pair.keep.key) return false;
  if (remove.fingerprint !== pair.remove.fingerprint || keep.fingerprint !== pair.keep.fingerprint) return false;
  return rapidDuplicateSimilarity(remove, keep) >= rapidDuplicateThreshold(minimum);
}
