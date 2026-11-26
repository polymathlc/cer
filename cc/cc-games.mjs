// The game owns only the DOM inside its host. Reward persistence belongs to the quest board.
const games = {
  dash: {
    title: 'Foxfire Dash',
    instructions: 'Collect 8 blue foxfires. Tap the lane with the flame, or move with the left and right arrow keys. Three hits end the run.',
    art: 'caris-banner.webp',
    theme: 'dash',
    create: createDash
  },
  signals: {
    title: 'Smoke Signals',
    instructions: 'Watch the runes light up, then repeat them in order. Tap a rune or press its number (1–4). Complete three patterns to win.',
    art: 'caius-banner.webp',
    theme: 'signals',
    create: createSignals
  },
  rush: {
    title: 'Relic Rush',
    instructions: 'Catch 10 relics in 20 seconds. Tap the lit tile or press its number (1–9). A wrong tile costs one second.',
    art: 'relics/tide-compass.webp',
    theme: 'rush',
    create: createRush
  }
};
const asset = file => new URL('./assets/' + file, import.meta.url).href;
const pick = count => Math.floor(Math.random() * count);
const lanes = ['Left', 'Middle', 'Right'];
const runes = [
  { name: 'Star', symbol: '✦' }, { name: 'Moon', symbol: '☾' },
  { name: 'Wave', symbol: '≈' }, { name: 'Crystal', symbol: '◇' }
];

function createDash({ field, kid, hud, announce, end }) {
  let lane = 1, safe = pick(3), caught = 0, hits = 0, progress = 0, duration = 1900;
  field.innerHTML = `<div class="ccg-track">
    <div class="ccg-lanes">${lanes.map((name, i) => `<button type="button" data-pad="${i}"><span class="ccg-lane-name">${name}</span></button>`).join('')}</div>
    <div class="ccg-finish-line"></div>
    <div class="ccg-wave" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="ccg-runner" aria-hidden="true"><img alt="" src="${asset(kid + '-form.webp')}"></div>
  </div>`;
  const track = field.querySelector('.ccg-track');
  const wave = field.querySelector('.ccg-wave');
  const pads = [...track.querySelectorAll('button')];
  function move(next) {
    lane = Math.max(0, Math.min(2, next));
    track.style.setProperty('--lane', lane);
    pads.forEach((pad, i) => pad.setAttribute('aria-pressed', String(i === lane)));
  }
  function showGate() {
    [...wave.children].forEach((mark, i) => { mark.className = i === safe ? 'ccg-fire' : 'ccg-spike'; });
    pads.forEach((pad, i) => pad.setAttribute('aria-label', lanes[i] + ' lane, ' + (i === safe ? 'foxfire' : 'obstacle')));
    announce('Foxfire in the ' + lanes[safe].toLowerCase() + ' lane.');
  }
  function updateHud() { hud('Foxfires', caught + ' / 8', 'Shields', String(3 - hits)); }
  move(lane);
  showGate();
  updateHud();
  return {
    pad: move,
    key(key) {
      if (key === 'ArrowLeft') move(lane - 1);
      else if (key === 'ArrowRight') move(lane + 1);
      else if (/^[1-3]$/.test(key)) move(Number(key) - 1);
      else return false;
      return true;
    },
    tick(delta) {
      progress += delta;
      track.style.setProperty('--travel', Math.min(progress / duration, 1));
      if (progress < duration) return;
      const success = safe === lane;
      if (success) caught++;
      else hits++;
      updateHud();
      if (caught === 8 || hits === 3) {
        end(caught === 8, caught, caught + ' of 8 foxfires collected.');
        return;
      }
      // Change the safe lane each time so a stationary player must eventually move.
      safe = (safe + 1 + pick(2)) % 3;
      progress = 0;
      duration = Math.max(1150, duration - 65);
      track.style.setProperty('--travel', 0);
      showGate();
      announce((success ? 'Foxfire caught! ' : 'Shield lost! ') + 'Next flame in the ' + lanes[safe].toLowerCase() + ' lane.');
    }
  };
}

function createSignals({ field, hud, announce, end }) {
  field.innerHTML = `<div class="ccg-runes">${runes.map((r, i) => `<button type="button" data-pad="${i}" aria-label="${i + 1}, ${r.name}"><span class="ccg-rune-symbol" aria-hidden="true">${r.symbol}</span><span>${r.name} <kbd>${i + 1}</kbd></span></button>`).join('')}</div>`;
  const pads = [...field.querySelectorAll('button')];
  const sequence = [pick(4), pick(4)];
  let round = 1, entered = 0, score = 0, time = 0, lit = -1, listening = false, feedback = 0;
  function light(i) {
    pads.forEach((p, idx) => p.classList.toggle('ccg-lit', i === idx));
    lit = i;
  }
  function watch() {
    entered = 0; time = 0; listening = false; feedback = 0;
    light(-1);
    if (field.contains(document.activeElement)) field.focus({ preventScroll: true });
    pads.forEach(p => { p.disabled = true; });
    hud('Round', round + ' / 3', 'Runes', String(score));
    announce('Watch the ' + sequence.length + '-rune pattern.');
  }
  function tap(i) {
    if (!listening || i < 0 || i >= pads.length) return;
    if (i !== sequence[entered]) {
      end(false, score, 'That rune was ' + runes[sequence[entered]].name + '. You matched ' + score + ' in total.');
      return;
    }
    ++score;
    ++entered;
    light(i);
    feedback = 190;
    hud('Round', round + ' / 3', 'Runes', String(score));
    if (entered !== sequence.length) {
      announce('Correct. Choose rune ' + (entered + 1) + '.');
      return;
    }
    if (round === 3) { end(true, score, 'You matched all 9 runes in order.'); return; }
    ++round;
    sequence.push(pick(4));
    watch();
  }
  watch();
  return {
    pad: tap,
    key(key) { if (!/^[1-4]$/.test(key)) return false; tap(Number(key) - 1); return true; },
    tick(delta) {
      if (listening) {
        if (feedback > 0 && (feedback -= delta) <= 0) light(-1);
        return;
      }
      time += delta;
      if (time < 700) return;
      const elapsed = time - 700;
      const step = Math.floor(elapsed / 880);
      if (step >= sequence.length) {
        light(-1);
        listening = true;
        pads.forEach(p => { p.disabled = false; });
        announce('Your turn. Repeat the ' + sequence.length + ' runes.');
        return;
      }
      const highlight = elapsed % 880 < 630 ? sequence[step] : -1;
      if (lit === highlight) return;
      light(highlight);
      if (highlight >= 0) announce('Rune ' + (step + 1) + ' · ' + runes[highlight].name + ' (' + (highlight + 1) + ')');
    }
  };
}

function createRush({ field, hud, announce, end }) {
  let seconds = 20000, target = pick(9), caught = 0, displayedSecond = 20;
  field.innerHTML = `<div class="ccg-vault">${Array.from({ length: 9 }, (_, i) => `<button type="button" data-pad="${i}"><kbd>${i + 1}</kbd></button>`).join('')}</div>`;
  const pads = [...field.querySelectorAll('button')];
  const relic = document.createElement('img');
  relic.alt = '';
  relic.src = asset('relics/tide-compass.webp');
  function updateTarget() {
    pads.forEach((pad, i) => {
      pad.classList.toggle('ccg-treasure', target === i);
      pad.setAttribute('aria-label', (i + 1) + (target === i ? ', relic' : ', empty'));
    });
    pads[target].append(relic);
  }
  function updateHud() {
    displayedSecond = Math.max(0, Math.ceil(seconds / 1000));
    hud('Relics', caught + ' / 10', 'Time', displayedSecond + 's');
  }
  function timeOut() { end(false, caught, 'Time is up. You caught ' + caught + ' of 10 relics.'); }
  function tap(i) {
    if (target !== i) {
      seconds -= 1000;
      updateHud();
      if (seconds <= 0) timeOut();
      else announce('Empty tile. One second lost. Find tile ' + (target + 1) + '.');
      return;
    }
    caught++;
    updateHud();
    if (caught === 10) { end(true, caught, 'You recovered all 10 relics with ' + displayedSecond + 's left.'); return; }
    target = (target + 1 + pick(8)) % pads.length;
    updateTarget();
    announce('Relic spotted on tile ' + (target + 1) + '.');
  }
  updateTarget();
  updateHud();
  announce('Relic spotted on tile ' + (target + 1) + '.');
  return {
    pad: tap,
    key(key) { if (!/^[1-9]$/.test(key)) return false; tap(Number(key) - 1); return true; },
    tick(delta) {
      seconds -= delta;
      if (seconds <= 0) { timeOut(); return; }
      if (Math.ceil(seconds / 1000) !== displayedSecond) updateHud();
    }
  };
}

/**
 * Mount one arcade cabinet. Call the returned function when its dialog closes or
 * its player changes. A completed win calls onFinish({ score }) once per attempt.
 */
export function mountGame(container, gameId, kid, onFinish = () => {}, onExit = () => {}) {
  const game = Object.hasOwn(games, gameId) && games[gameId];
  if (!game) throw new RangeError('Unknown arcade game');
  const player = (kid?.id || kid) === 'caris' ? 'caris' : 'caius';
  const root = document.createElement('section');
  root.className = 'ccg ccg-' + game.theme;
  root.setAttribute('aria-label', game.title);
  root.tabIndex = -1;
  root.innerHTML = `<div class="ccg-header"><h3>${game.title}</h3><button type="button" class="ccg-exit" data-game-action="exit">Back to arcade</button></div>
    <div class="ccg-hud" hidden><div><span></span><strong></strong></div><div><span></span><strong></strong></div>
      <button type="button" data-game-action="pause">Pause</button></div>
    <div class="ccg-arena"><div class="ccg-field" tabindex="-1"></div><div class="ccg-cover"></div></div>
    <p class="ccg-status" aria-live="polite" aria-atomic="true"></p>`;
  container.replaceChildren(root);
  const field = root.querySelector('.ccg-field');
  const cover = root.querySelector('.ccg-cover');
  const status = root.querySelector('.ccg-status');
  const hudBox = root.querySelector('.ccg-hud');
  const hudLabels = [...hudBox.querySelectorAll('span')];
  const hudValues = [...hudBox.querySelectorAll('strong')];
  const pauseButton = root.querySelector('[data-game-action="pause"]');
  let state = 'ready', engine, lastFrame = null, frame = 0;
  const events = new AbortController();
  const options = { signal: events.signal };

  function hud(labelA, valueA, labelB, valueB) {
    hudLabels[0].textContent = labelA; hudValues[0].textContent = valueA;
    hudLabels[1].textContent = labelB; hudValues[1].textContent = valueB;
  }
  function announce(message) { status.textContent = message; }
  function showCover(title, detail, button, action, poster = false) {
    cover.hidden = false;
    field.inert = true;
    cover.classList.toggle('ccg-poster', poster);
    cover.innerHTML = `<div class="ccg-cover-copy"><h4></h4><p></p><button type="button" class="ccg-primary"></button></div>`;
    cover.querySelector('h4').textContent = title;
    cover.querySelector('p').textContent = detail;
    const primary = cover.querySelector('button');
    primary.textContent = button;
    primary.dataset.gameAction = action;
    primary.focus({ preventScroll: true });
  }
  function clearCover() {
    cover.hidden = true; cover.replaceChildren(); field.inert = false;
    root.focus({ preventScroll: true });
  }
  function tick(now) {
    if (state !== 'playing') return;
    const delta = lastFrame === null ? 0 : now - lastFrame;
    lastFrame = now;
    engine.tick(delta);
    if (state === 'playing') frame = requestAnimationFrame(tick);
  }
  function play() {
    state = 'playing';
    root.classList.remove('ccg-paused');
    pauseButton.hidden = false;
    clearCover();
    lastFrame = null;
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (state !== 'ready' && state !== 'finished') return;
    hudBox.hidden = false;
    engine = game.create({ field, kid: player, hud, announce, end });
    play();
  }
  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    root.classList.add('ccg-paused');
    cancelAnimationFrame(frame);
    pauseButton.hidden = true;
    showCover('Paused', 'Continue when you are ready.', 'Resume game', 'resume');
  }
  function end(won, score, detail) {
    if (state !== 'playing') return;
    state = 'finished';
    cancelAnimationFrame(frame);
    pauseButton.hidden = true;
    announce('');
    showCover(won ? 'Challenge cleared!' : 'Try another run', detail, 'Play again', 'start');
    if (won) onFinish({ score });
  }
  function cleanup() {
    if (state === 'closed') return;
    state = 'closed';
    cancelAnimationFrame(frame);
    events.abort();
    root.remove();
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !root.contains(button)) return;
    switch (button.dataset.gameAction) {
      case 'exit': cleanup(); onExit(); break;
      case 'start': start(); break;
      case 'pause': pause(); break;
      case 'resume': if (state === 'paused') play(); break;
      default:
        if (state === 'playing' && button.hasAttribute('data-pad')) engine.pad(Number(button.dataset.pad));
    }
  }, options);
  root.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || state !== 'playing') return;
    if (engine.key(event.key)) event.preventDefault();
  }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }, options);
  root.style.setProperty('--ccg-art', 'url("' + asset(game.art) + '")');
  const goals = { dash: 'Catch the foxfire', signals: 'Follow the runes', rush: 'Hunt the relics' };
  showCover(goals[gameId], game.instructions, 'Start game', 'start', true);
  return cleanup;
}
