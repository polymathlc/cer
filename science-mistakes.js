// 🐾 The MISTAKE ANALYSIS card — the card that FOLLOWS the Science Sidekicks.
//
// A Sidekick (Evidence Ellen, Concept Cora…) says what a stronger answer
// needs next. This card says which of the nine familiar HABITS — a Science
// Sidekick's skill, missing — the answer
// showed — the Rabbit rushed it, the Parrot repeated the question, the Sloth
// stopped halfway — drawn as the same kind of animated figure, standing
// beside the ACTUAL QUESTION and what the student wrote, so the lesson is
// read against the very answer it is about rather than in the abstract.
//
// Like science-coaches.js it is presentation only: it never marks, never
// calls a model and never reads an answer key. The habit comes back on the
// SAME marking call that already returns the coach issues (`mistake` /
// `mistakeWhy` in the result), resolved through the taxonomy in app.js —
// this file is handed an animal it can draw or nothing at all.
import { MISTAKE_ANIMAL_ART_IDS, renderMistakeAnimalAvatar, mistakeAnimalAccent } from './science-mistake-art.js';
import { scienceCoachMotion } from './science-coaches.js';

const mounts = new WeakMap();
const LIMITS = Object.freeze({ why: 280, question: 900, student: 420, title: 160, label: 40, roster: 12 });
const VERDICTS = new Set(['partial', 'incorrect', 'wrong', 'blank', 'incomplete']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (value, limit) => {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > limit ? clean.slice(0, limit - 1).trimEnd() + '…' : clean;
};
const oneLine = (value, limit) => text(value, limit).replace(/\s*\n\s*/g, ' ');
/* A picture is shown only from a place a question's own figure can come
   from. Anything with a scheme other than http(s), blob or an image data
   URL is dropped rather than written into an attribute. */
const safeUrl = value => {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url || /[\s"'<>]/.test(url)) return '';
  if (/^(?:https?:\/\/|blob:|\/|\.\.?\/)/i.test(url)) return url;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return '';
};
const icon = name => name === 'close'
  ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>'
  : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12M14 4v12"/></svg>';

/**
 * Turn what app.js knows about a marked answer into the one frozen object
 * the card renders, or null when there is nothing honest to show. The
 * rules, each of which fails silently if dropped:
 *   • the VERDICT has to be a wrong one — a correct answer has no habit;
 *   • the ANIMAL has to be one this file can draw, with its own words on it
 *     (a taxonomy entry, never a model's string) — an unknown id is null;
 *   • every string is clipped and control characters are removed, because
 *     the question and the student's words are rendered into the page.
 */
export function prepareMistakeAnalysis(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const verdict = typeof input.verdict === 'string' ? input.verdict.trim().toLowerCase() : '';
  if (!VERDICTS.has(verdict)) return null;
  const animal = input.animal;
  if (!animal || typeof animal !== 'object' || typeof animal.id !== 'string' || !MISTAKE_ANIMAL_ART_IDS.includes(animal.id)) return null;
  const words = { animal: oneLine(animal.animal, 40), name: oneLine(animal.name, 60), desc: text(animal.desc, 280), spot: text(animal.spot, 200), fix: text(animal.fix, 200), emoji: oneLine(animal.emoji, 4) };
  if (!words.animal || !words.name || !words.fix) return null;
  const q = input.question && typeof input.question === 'object' ? input.question : {};
  const images = (Array.isArray(q.images) ? q.images : []).map(safeUrl).filter(Boolean).slice(0, 2);
  const roster = (Array.isArray(input.roster) ? input.roster : [])
    .filter(m => m && typeof m === 'object' && MISTAKE_ANIMAL_ART_IDS.includes(m.id))
    .slice(0, LIMITS.roster)
    .map(m => Object.freeze({ id: m.id, animal: oneLine(m.animal, 40), name: oneLine(m.name, 60), emoji: oneLine(m.emoji, 4) }));
  return Object.freeze({
    id: animal.id,
    verdict: verdict === 'wrong' ? 'incorrect' : verdict,
    ...words,
    why: text(input.why, LIMITS.why),
    question: Object.freeze({
      title: oneLine(q.title, LIMITS.title),
      label: oneLine(q.label, LIMITS.label),
      text: text(q.text, LIMITS.question),
      images: Object.freeze(images)
    }),
    student: text(input.student, LIMITS.student),
    roster: Object.freeze(roster)
  });
}

/** Remove the card belonging to this feedback element, and any left in a container. */
export function resetMistakeAnalysis(container) {
  mounts.get(container)?.remove();
  mounts.delete(container);
  container?.querySelectorAll?.('[data-sc-mistake]').forEach(element => element.remove());
}

/**
 * Mount the card AFTER `anchor` — the Sidekicks card when there is one, the
 * feedback element otherwise — keyed by `feedback` so a re-check of the same
 * part replaces it. Returns the mounted section, or null when the analysis
 * was refused.
 */
export function mountMistakeAnalysis(feedback, anchor, input) {
  if (!feedback?.isConnected) return null;
  mounts.get(feedback)?.remove();
  mounts.delete(feedback);
  const data = prepareMistakeAnalysis(input);
  if (!data) return null;
  const target = anchor?.isConnected ? anchor : feedback;
  scienceCoachMotion.load();
  const colours = mistakeAnimalAccent(data.id);
  const root = document.createElement('section');
  root.className = 'sc-coach-mount sc-mistake-mount';
  root.dataset.scMount = '';
  root.dataset.scMistake = data.id;
  root.dataset.mistake = data.id;
  if (colours) { root.style.setProperty('--sc-accent', colours.accent); root.style.setProperty('--sc-wash', colours.wash); }
  root.setAttribute('aria-label', 'Mistake analysis');
  root.innerHTML = `
    <div class="sc-sr" role="status" aria-live="polite" aria-atomic="true"></div>
    <button type="button" class="sc-reopen" data-sc-reopen hidden>Show the mistake analysis</button>
    <div class="sc-card">
      <div class="sc-topline">
        <span class="sc-eyebrow"><span class="sc-signal sc-signal--mistake" aria-hidden="true"></span> MISTAKE ANALYSIS</span>
        <div class="sc-tools">
          <button type="button" class="sc-motion" data-sc-motion>${icon('pause')}<span>Pause motion</span></button>
          <button type="button" class="sc-close" data-sc-close aria-label="Hide the mistake analysis">${icon('close')}</button>
        </div>
      </div>
      <div class="sc-stage sc-stage--mistake">
        <div class="sc-portrait">${renderMistakeAnimalAvatar(data.id)}<span class="sc-portrait-caption">${escape(data.emoji)} ${escape(data.animal)}</span></div>
        <div class="sc-message">
          <span class="sc-focus">${escape(data.name)}</span>
          <h3>${escape(data.animal)}</h3>
          <p class="sc-intro">${escape(data.desc)}</p>
          <p class="sc-observation"><span>In this answer</span>${escape(data.why || data.spot)}</p>
        </div>
        <div class="sc-question">
          <span class="sc-question-label">The question${data.question.label ? ' · ' + escape(data.question.label) : ''}</span>
          ${data.question.title ? `<strong class="sc-question-title">${escape(data.question.title)}</strong>` : ''}
          ${data.question.text ? `<p class="sc-question-text">${escape(data.question.text)}</p>` : '<p class="sc-question-text sc-question-none">The question is above, on the page.</p>'}
          ${data.question.images.length ? `<div class="sc-question-pics">${data.question.images.map(url => `<img src="${escape(url)}" alt="" loading="lazy">`).join('')}</div>` : ''}
          ${data.student ? `<span class="sc-question-label">You wrote</span><p class="sc-question-wrote">“${escape(data.student)}”</p>` : ''}
        </div>
        <div class="sc-next-move"><span class="sc-step-star" aria-hidden="true">🐾</span><div><span class="sc-next-label">WATCH FOR IT NEXT TIME</span><p>${escape(data.fix)}</p></div></div>
      </div>
      <div class="sc-bottomline">
        <span class="sc-count">Spot it: ${escape(data.spot)}</span>
      </div>
      ${data.roster.length ? `<details class="sc-team"><summary>Meet all ${data.roster.length} Science Sidekicks — the mistake types <span aria-hidden="true">↗</span></summary>
        <p class="sc-team-note">Every wrong answer is one of these familiar habits. Naming yours is how you watch for it next time.</p>
        <div class="sc-team-grid sc-team-grid--mistake"></div>
      </details>` : ''}
    </div>`;
  target.insertAdjacentElement('afterend', root);
  mounts.set(feedback, root);
  const card = root.querySelector('.sc-card');
  const reopen = root.querySelector('[data-sc-reopen]');
  const announcer = root.querySelector('[role="status"]');
  announcer.textContent = `Mistake analysis: ${data.animal}, ${data.name}. ${data.fix}`;
  root.querySelector('[data-sc-close]').addEventListener('click', () => {
    card.hidden = true;
    reopen.hidden = false;
    announcer.textContent = '';
    reopen.focus({ preventScroll: true });
  });
  reopen.addEventListener('click', () => {
    card.hidden = false;
    reopen.hidden = true;
    root.querySelector('[data-sc-close]').focus({ preventScroll: true });
  });
  root.querySelector('[data-sc-motion]').addEventListener('click', () => scienceCoachMotion.toggle());
  const team = root.querySelector('.sc-team');
  team?.addEventListener('toggle', () => {
    const grid = root.querySelector('.sc-team-grid');
    if (!team.open || !grid || grid.childElementCount) return;
    grid.innerHTML = data.roster.map(m => `<article class="sc-team-member${m.id === data.id ? ' sc-team-member--here' : ''}" data-mistake="${escape(m.id)}">
      ${renderMistakeAnimalAvatar(m.id, { animated: false })}<h4>${escape(m.emoji)} ${escape(m.animal)}</h4><p>${escape(m.name)}</p></article>`).join('');
  });
  scienceCoachMotion.sync();
  return root;
}
