// Procedural combat audio: no downloads, remote requests, or paid services.
// Nothing creates an AudioContext until a trusted input calls unlock().
export function createTcgMedia({ storageKey = 'tcg-combat-audio', legacyMuteKey = '' } = {}) {
  let context = null, gain = null, enabled = true, volume = 0.35, unlocked = false;
  const voices = new Set(), lastCue = new Map(), roots = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) { enabled = saved.enabled !== false; volume = Math.max(0, Math.min(1, Number.isFinite(saved.volume) ? saved.volume : 0.35)); }
    else if (legacyMuteKey && localStorage.getItem(legacyMuteKey) === '0') enabled = false;
  } catch (_) { /* private browsing keeps a working in-memory preference */ }
  const sync = () => {
    for (const root of roots.keys()) {
      root.querySelectorAll('[data-tcg-audio="toggle"]').forEach(b => {
        b.textContent = enabled ? '🔊 Sound on' : '🔇 Sound off';
        b.setAttribute('aria-pressed', String(enabled));
      });
      root.querySelectorAll('[data-tcg-audio="volume"]').forEach(b => { b.value = String(Math.round(volume * 100)); });
    }
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ enabled, volume })); } catch (_) {}
    if (gain && context) gain.gain.setValueAtTime(enabled ? volume * 0.16 : 0, context.currentTime);
    sync();
  };
  function stop() {
    for (const voice of voices) {
      try { voice.osc.stop(); } catch (_) {}
      try { voice.osc.disconnect(); voice.env.disconnect(); } catch (_) {}
    }
    voices.clear(); lastCue.clear();
  }
  async function unlock() {
    unlocked = true;
    if (!enabled) return false;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return false;
      if (!context) { context = new Audio(); gain = context.createGain(); gain.gain.value = volume * 0.16; gain.connect(context.destination); }
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch (_) { return false; }
  }
  const palette = { flame: 146, light: 392, aqua: 261, frost: 523, spark: 659, cosmic: 440, psychic: 349, shadow: 110, metal: 196, terra: 130, flora: 329, venom: 174 };
  const scores = {
    attack: [[1,0,.11],[1.6,.025,.07]], hit: [[.7,0,.09]],
    skill: [[1,0,.17],[1.5,.055,.2],[2,.11,.24]],
    heal: [[1,0,.18],[1.25,.07,.22],[1.5,.14,.25]],
    shield: [[.75,0,.15],[1.5,.08,.22]], level: [[1,0,.13],[1.25,.09,.15],[1.5,.18,.22],[2,.27,.25]],
    wave: [[.75,0,.17],[1,.13,.2]], victory: [[1,0,.2],[1.25,.16,.2],[1.5,.32,.2],[2,.48,.4]],
    defeat: [[1,0,.23],[.8,.18,.23],[.6,.36,.35]]
  };
  function play(cue, element = 'cosmic', power = 1) {
    if (!enabled || !unlocked || !context || context.state !== 'running' || globalThis.document?.hidden) return false;
    const score = scores[cue]; if (!score) return false;
    const now = context.currentTime, prior = lastCue.get(cue) ?? -100;
    if (now - prior < (cue === 'attack' || cue === 'hit' ? .085 : .18)) return false;
    lastCue.set(cue, now);
    const base = palette[element] || 440;
    for (const [ratio, delay, length] of score) {
      if (voices.size >= 12) break;
      const osc = context.createOscillator(), env = context.createGain();
      const voice = { osc, env }; voices.add(voice);
      osc.type = cue === 'hit' || element === 'metal' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(base * ratio, now + delay);
      if (cue === 'attack' || cue === 'hit') osc.frequency.exponentialRampToValueAtTime(Math.max(35, base * ratio * .45), now + delay + length);
      env.gain.setValueAtTime(0, now + delay);
      env.gain.linearRampToValueAtTime(Math.min(.8, Math.max(.1, power * .32)), now + delay + .008);
      env.gain.exponentialRampToValueAtTime(.001, now + delay + length);
      osc.connect(env); env.connect(gain);
      osc.onended = () => { voices.delete(voice); try { osc.disconnect(); env.disconnect(); } catch (_) {} };
      osc.start(now + delay); osc.stop(now + delay + length + .02);
    }
    return true;
  }
  function controlsHTML() {
    return '<div class="tcg-audio-controls" role="group" aria-label="Combat sound">'
      + '<button type="button" data-tcg-audio="toggle" aria-pressed="' + enabled + '">' + (enabled ? '🔊 Sound on' : '🔇 Sound off') + '</button>'
      + '<label>Volume <input type="range" data-tcg-audio="volume" min="0" max="100" step="5" value="' + Math.round(volume * 100) + '" aria-label="Combat sound volume"></label></div>';
  }
  function installControls(root) {
    if (!root || roots.has(root)) return;
    const click = event => {
      if (event.target.closest?.('[data-tcg-audio="toggle"]')) {
        enabled = !enabled; if (!enabled) stop(); save(); if (enabled && event.isTrusted) void unlock();
      } else if (event.isTrusted) void unlock();
    };
    const input = event => {
      if (event.target.matches?.('[data-tcg-audio="volume"]')) {
        volume = Math.max(0, Math.min(1, Number(event.target.value) / 100)); save();
        if (event.isTrusted) { void unlock(); play('shield'); }
      }
    };
    const key = event => { if (event.isTrusted) void unlock(); };
    root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('keydown', key);
    roots.set(root, { click, input, key }); sync();
  }
  const hidden = () => { if (globalThis.document?.hidden) stop(); };
  globalThis.document?.addEventListener('visibilitychange', hidden);
  return {
    unlock, play, stop, controlsHTML, installControls,
    get settings() { return { enabled, volume, voices: voices.size }; },
    setEnabled(value) { enabled = value === true; if (!enabled) stop(); save(); },
    destroy() {
      stop(); for (const [root, h] of roots) { root.removeEventListener('click', h.click); root.removeEventListener('input', h.input); root.removeEventListener('keydown', h.key); }
      roots.clear(); globalThis.document?.removeEventListener('visibilitychange', hidden);
      if (context) void context.close(); context = null; gain = null; unlocked = false;
    }
  };
}
