import { SCIENCE_COACHES, selectScienceCoaches } from './science-coach-core.js';
import { renderScienceCoachAvatar } from './science-coach-art.js';

// Feedback stays beside its answer. Nothing takes focus, blocks the question,
// changes a grade or makes a request to a marking service.
const mounts = new WeakMap();
const MOTION_KEY = 'science:coach-motion';
let motion = true;
let media;
let preferenceLoaded = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => name === 'close'
  ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>'
  : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12M14 4v12"/></svg>';

function motionAllowed() { return motion && !media?.matches; }
function syncMotion() {
  document.querySelectorAll('[data-sc-mount]').forEach(root => {
    root.dataset.motion = motionAllowed() ? 'on' : 'off';
    const button = root.querySelector('[data-sc-motion]');
    if (!button) return;
    button.disabled = !!media?.matches;
    button.setAttribute('aria-pressed', String(!motionAllowed()));
    button.setAttribute('aria-label', media?.matches ? 'Animations off: reduced motion preference' : motion ? 'Pause coach animations' : 'Enable coach animations');
    button.querySelector('span').textContent = media?.matches ? 'Reduced motion' : motion ? 'Pause motion' : 'Motion off';
  });
}
function loadPreference() {
  if (preferenceLoaded) return;
  preferenceLoaded = true;
  try { motion = localStorage.getItem(MOTION_KEY) !== 'off'; } catch { /* Private browsing still works. */ }
  media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  media?.addEventListener?.('change', syncMotion);
}

/** Clear only the presentation belonging to this rendered question. */
export function resetScienceCoaches(container) {
  mounts.get(container)?.remove();
  mounts.delete(container);
  container?.querySelectorAll?.('[data-sc-mount]').forEach(element => element.remove());
}

/** Mount after an existing, already marked feedback element. */
export function mountScienceCoach(feedback, result, context = {}) {
  if (!feedback?.isConnected || context.mode === 'preview') return null;
  const previous = mounts.get(feedback);
  previous?.remove();
  mounts.delete(feedback);
  const issues = selectScienceCoaches(result, context);
  if (!issues.length) return null;
  loadPreference();
  const root = document.createElement('section');
  root.className = 'sc-coach-mount';
  root.dataset.scMount = '';
  root.setAttribute('aria-label', 'Science coach feedback');
  root.innerHTML = `
    <div class="sc-sr" role="status" aria-live="polite" aria-atomic="true"></div>
    <button type="button" class="sc-reopen" data-sc-reopen hidden></button>
    <div class="sc-card">
      <div class="sc-topline">
        <span class="sc-eyebrow"><span class="sc-signal" aria-hidden="true"></span> SCIENCE SIDEKICKS</span>
        <div class="sc-tools">
          <button type="button" class="sc-motion" data-sc-motion>${icon('pause')}<span>Pause motion</span></button>
          <button type="button" class="sc-close" data-sc-close aria-label="Hide science coaches">${icon('close')}</button>
        </div>
      </div>
      <div class="sc-stage"></div>
      <div class="sc-bottomline">
        <div class="sc-tips" aria-label="Tips for this answer"></div>
        <span class="sc-count"></span>
      </div>
      <details class="sc-team"><summary>Meet the whole team <span aria-hidden="true">↗</span></summary>
        <p class="sc-team-note">Eight friendly animal coaches, eight ways to strengthen your science answers. Your answer's tips are above.</p>
        <div class="sc-team-grid"></div>
      </details>
    </div>`;
  feedback.insertAdjacentElement('afterend', root);
  mounts.set(feedback, root);
  const stage = root.querySelector('.sc-stage');
  const tips = root.querySelector('.sc-tips');
  const card = root.querySelector('.sc-card');
  const reopen = root.querySelector('[data-sc-reopen]');
  const announcer = root.querySelector('[role="status"]');
  let selected = 0;

  function show(index, announce = true) {
    selected = index;
    const coach = issues[index];
    root.dataset.coach = coach.id;
    stage.innerHTML = `<div class="sc-portrait">${renderScienceCoachAvatar(coach.id)}<span class="sc-portrait-caption">${escape(coach.animal)}</span></div>
      <div class="sc-message">
        <span class="sc-focus">${escape(coach.focus)}</span>
        <h3>${escape(coach.name)}</h3>
        <p class="sc-intro">${escape(coach.intro)}</p>
        ${coach.detail ? `<p class="sc-observation"><span>In this answer</span>${escape(coach.detail)}</p>` : ''}
      </div>
      <div class="sc-next-move"><span class="sc-step-star" aria-hidden="true">✦</span><div><span class="sc-next-label">TRY THIS NEXT</span><p>${escape(coach.action)}</p></div></div>`;
    tips.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
    root.querySelector('.sc-count').textContent = issues.length > 1 ? `${index + 1} of ${issues.length} tips` : 'One small step forward';
    reopen.textContent = `Show ${coach.name}'s tip`;
    if (announce) announcer.textContent = `${coach.name}: ${coach.focus}. ${coach.action}`;
  }
  issues.forEach((coach, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scTip = String(index);
    button.setAttribute('aria-label', `Tip ${index + 1}: ${coach.name}`);
    button.innerHTML = `<span class="sc-tip-dot" data-coach="${escape(coach.id)}" aria-hidden="true"></span>${escape(coach.name.split(' ').at(-1))}`;
    button.addEventListener('click', () => show(index));
    tips.append(button);
  });
  tips.hidden = issues.length === 1;
  root.querySelector('[data-sc-close]').addEventListener('click', () => {
    card.hidden = true;
    reopen.hidden = false;
    announcer.textContent = '';
    reopen.focus({preventScroll:true});
  });
  reopen.addEventListener('click', () => {
    card.hidden = false;
    reopen.hidden = true;
    root.querySelector('[data-sc-close]').focus({preventScroll:true});
  });
  root.querySelector('[data-sc-motion]').addEventListener('click', () => {
    if (media?.matches) return;
    motion = !motion;
    try { localStorage.setItem(MOTION_KEY, motion ? 'on' : 'off'); } catch { /* Optional device preference. */ }
    syncMotion();
  });
  const team = root.querySelector('.sc-team');
  team.addEventListener('toggle', () => {
    const grid = root.querySelector('.sc-team-grid');
    if (!team.open || grid.childElementCount) return;
    grid.innerHTML = Object.values(SCIENCE_COACHES).map(coach => `<article class="sc-team-member" data-coach="${escape(coach.id)}">
      ${renderScienceCoachAvatar(coach.id, {animated:false})}<h4>${escape(coach.name)}</h4><p>${escape(coach.animal)} · ${escape(coach.focus)}</p></article>`).join('');
  });
  show(0);
  syncMotion();
  return root;
}
