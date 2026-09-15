// 🐾 THE MISTAKE FIGURE IS THE SIDEKICK (v1.394.0).
// The ten animal drawings this file used to hold — the Rabbit, the Parrot,
// the Sloth… — were a SECOND cast standing beside the nine Science Sidekicks
// who already coach the very same answers, so a child met two animals for one
// habit and had to translate between them. The mistake types are the
// Sidekicks' own skills now (MISTAKE_ANIMALS in app.js, shared byte for byte
// with polymathlc/anskey and polymathlc/scan), so the figure a mistake wears
// is the coach's own drawing, from science-coach-art.js, and nothing is drawn
// twice. This file keeps the same three exports the card, the practice page
// and the harness read, and keeps that file's two rules: every interpolated
// value is selected from a fixed cast, so a caller-provided id never becomes
// SVG markup; and the animation hooks are CLASSES ONLY, so the same
// stylesheet that moves a Sidekick moves the mistake figure and the same
// motion switch pauses both.
//
// TWO THINGS DIFFER FROM CALLING THE COACH ART DIRECTLY, and both are the
// point of keeping a wrapper:
//  • An UNKNOWN id draws NOTHING. renderScienceCoachAvatar falls back to
//    Comparison Casey for an id it does not know, which is the right thing
//    for a coach card (there is always a coach) and the wrong thing here: a
//    lesson filed under an invented animal must not wear a plausible face.
//  • `data-animal` is the TAXONOMY id (`specific`, `evidence`…), which is
//    what the card, the roster and the browser harness match a figure on;
//    the species the coach art names ("fox", "red-panda") is kept beside it
//    as `data-species`.
import { renderScienceCoachAvatar } from './science-coach-art.js';

/* The taxonomy's ids, in the taxonomy's own order — the same nine ids as
   SCIENCE_COACH_IDS, in the order MISTAKE_ANIMALS lists them. */
export const MISTAKE_ANIMAL_ART_IDS = Object.freeze([
  'comparison', 'context', 'specific', 'evidence', 'keywords',
  'concept', 'reasoning', 'careful', 'complete'
]);

/* Each Sidekick's own dark and light, read off the coach cast so the card's
   accent and wash are the colours the coach card beside it already wears.
   Nine entries, no two accents alike. */
const CAST = Object.freeze({
  comparison: { accent: '#7157b3', wash: '#eee2ff', species: 'chameleon' },
  context:    { accent: '#25858d', wash: '#e0f4ed', species: 'meerkat' },
  specific:   { accent: '#249d99', wash: '#d7f8ee', species: 'fox' },
  evidence:   { accent: '#c98c32', wash: '#fff0c5', species: 'elephant' },
  keywords:   { accent: '#4074c3', wash: '#dfedff', species: 'parrot' },
  concept:    { accent: '#815eb8', wash: '#f0e2ff', species: 'owl' },
  reasoning:  { accent: '#be6540', wash: '#ffead5', species: 'red-panda' },
  careful:    { accent: '#558a64', wash: '#edfad1', species: 'tortoise' },
  complete:   { accent: '#c76496', wash: '#ffe0ed', species: 'beaver' }
});

function known(id) {
  return typeof id === 'string' && Object.hasOwn(CAST, id);
}

/* One figure, 180×180, animated by class only — the Sidekick's own drawing,
   re-labelled for the mistake it stands for. An id nobody knows returns an
   EMPTY string, never a stand-in. */
export function renderMistakeAnimalAvatar(id, { animated = true } = {}) {
  if (!known(id)) return '';
  const svg = renderScienceCoachAvatar(id, { animated });
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) return '';
  return svg
    .replace(` class="sc-avatar sc-avatar--${id}`, ` class="sc-avatar sc-avatar--mistake-${id}`)
    .replace(/ data-animal="[^"]*"/, ` data-animal="${id}" data-species="${CAST[id].species}"`);
}

export function mistakeAnimalAccent(id) {
  return known(id) ? { accent: CAST[id].accent, wash: CAST[id].wash } : null;
}
