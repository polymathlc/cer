// Public, game-only CER hero snapshot consumed by the anskey classroom wheel.
// Private inventory, learning history and credentials never enter this payload.
export const BATTLE_ROLES = Object.freeze({
  warrior: { name: 'Warrior', icon: '⚔️', description: 'Strong melee strikes, extra health and defence. Protect the team while taking bigger hits.' },
  ranger: { name: 'Ranger', icon: '🏹', description: 'Rapid arrows and an increased chance of critical hits. Every correct answer fires a volley.' },
  mage: { name: 'Mage', icon: '✨', description: 'Powerful spell projectiles. Your attack and spell-power bonuses strengthen each cast.' },
  healer: { name: 'Healer', icon: '💚', description: 'Light damage plus healing for the team. Your attack and spell power strengthen healing, including reviving fallen heroes.' }
});
const slots = ['weapon', 'shield', 'armor', 'helmet', 'accessory', 'pet'];
const statDefaults = { level: 1, atk: 5, def: 0, crit: 5, maxHp: 50, goldPct: 0, critMult: 2, dodge: 0, spellPct: 0, cdr: 0, poisonOnHit: 0, thorns: 0, leechPct: 0 };

export function battleRole(role, clazz) {
  return Object.hasOwn(BATTLE_ROLES, role) ? role : clazz === 'mage' ? 'mage' : clazz === 'rogue' ? 'ranger' : 'warrior';
}

// Accept only self-contained vector output from the CER paper-doll compositor.
// Consumers must assign this URL to <img src>, never insert the SVG as markup.
export function battleAvatarDataUrl(svg) {
  if (typeof svg !== 'string' || svg.length > 180000 || !/^\s*<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return '';
  if (/<(?:script|foreignObject|image|use|iframe|object|embed|style|a)\b|<!|\bon\w+\s*=|\b(?:href|src|style)\s*=|url\(\s*[^#]/i.test(svg)) return '';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function buildBattleHero({ uid, state = {}, stats = {}, svg = '', updatedAt = new Date().toISOString() }) {
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new Error('A stable account UID is required to publish a battle hero.');
  const safeStats = Object.fromEntries(Object.entries(statDefaults).map(([key, fallback]) => {
    const value = Number(stats[key]);
    return [key, Number.isFinite(value) ? Math.max(0, Math.min(1000000, value)) : fallback];
  }));
  safeStats.level = Math.max(1, safeStats.level);
  safeStats.atk = Math.max(1, safeStats.atk);
  safeStats.maxHp = Math.max(10, safeStats.maxHp);
  return {
    version: 1, uid, role: battleRole(state.battleRole, state.clazz),
    avatarDataUrl: battleAvatarDataUrl(svg),
    equipment: Object.fromEntries(slots.map(slot => {
      const id = state.equipment?.[slot];
      return [slot, typeof id === 'string' && /^[a-z0-9_]{1,80}$/.test(id) ? id : null];
    })),
    gender: state.gender === 'female' ? 'female' : 'male',
    level: safeStats.level, stats: safeStats, updatedAt
  };
}
