// Card IDs are save data. Signatures add run-local rules without changing the dex.
export const SCIENCE_TCG_IDENTITIES = Object.freeze({
  c141: { name: 'Extinction Rally', icon: '📣', kind: 'rally', desc: 'Accelerate every ally and strike the strongest enemy.' },
  c142: { name: 'Abyssal Undertow', icon: '🌊', kind: 'tide', desc: 'Delay three enemies and wash over the nearest one.' },
  c143: { name: 'Storm Circuit', icon: '⚡', kind: 'chain', desc: 'Lightning jumps through three enemies, losing power with each jump.' },
  c144: { name: 'Mountainheart', icon: '⛰️', kind: 'bulwark', desc: 'Raise your own barrier and delay the two nearest enemies.' },
  c145: { name: 'First Light Purification', icon: '🌤️', kind: 'cleanse', desc: 'Cleanse and heal the most injured ally.' },
  c146: { name: 'Night Hunter', icon: '🌑', kind: 'predator', desc: 'Hunt the weakest enemy, dealing more damage if it is below half health, and heal yourself.' },
  c147: { name: 'Iron Capacitor', icon: '⚙️', kind: 'capacitor', desc: 'Alternate between raising a barrier and discharging a heavy shot at the strongest enemy.' },
  c148: { name: 'Seraphic Constellation', icon: '🌟', kind: 'constellation', desc: 'Strike three enemies equally and shelter yourself with starlight.' },
  c149: { name: 'Dawnward Covenant', icon: '🌅', kind: 'dawn', desc: 'Dawn damages every enemy and heals every ally.' },
  c150: { name: 'Worldsend Brand', icon: '🕯️', kind: 'curse', desc: 'Brand every enemy: the next hit against each one deals extra damage.' },
  c151: { name: 'Borrowed Tomorrow', icon: '⌛', kind: 'rewind', desc: 'Cleanse yourself and accelerate the most injured ally.' },
  c194: { name: 'Unbroken Oath', icon: '🛡️', kind: 'guardian', desc: 'Give the most injured ally a strong barrier and a small heal.' },
  c195: { name: 'Twin Starfall', icon: '☄️', kind: 'meteor', desc: 'Two heavy meteors seek the enemies with the greatest maximum health.' },
  c196: { name: 'Bloodbanner Advance', icon: '🚩', kind: 'bloodbanner', desc: 'Spend a little of your health to accelerate every ally and strike the strongest enemy harder.' },
  c197: { name: 'Soulharvest Ward', icon: '💀', kind: 'harvest', desc: 'Strike the weakest enemy; gain a larger barrier when that enemy was already wounded.' },
  c198: { name: 'Pact of Thorns', icon: '🔮', kind: 'pact', desc: 'Spend a little of your health to brand all enemies and damage the strongest one.' },
  c199: { name: 'Everflame Embers', icon: '🔥', kind: 'embers', desc: 'Hit the nearest two enemies; leave an ember on each that detonates on its next hit.' },
  c200: { name: 'Dragon Hunter', icon: '🗡️', kind: 'execution', desc: 'Hunt the enemy with the greatest maximum health. Damage grows with its size, within a safe cap.' },
  c201: { name: 'Winter Sanctuary', icon: '👑', kind: 'winter', desc: 'Delay every enemy and shield the most injured ally.' }
});
const RESONANCE = {
  scratch: 'chain', smash: 'capacitor', bite: 'predator', horn: 'tide', inferno: 'embers', tidal: 'tide', storm: 'chain', quake: 'bulwark', solar: 'dawn', nova: 'meteor',
  fang: 'execution', arrow: 'meteor', drain: 'harvest', eclipse: 'predator', bloom: 'cleanse', aurora: 'guardian', rain: 'dawn', chorus: 'cleanse', aegis: 'guardian', bark: 'bulwark',
  warcry: 'rally', roar: 'bloodbanner', jolt: 'tide', freeze: 'winter', venomf: 'pact', spores: 'embers'
};
export function scienceTcgIdentity(card) {
  if (!card) return null;
  if (card.stars >= 6) return SCIENCE_TCG_IDENTITIES[card.id] || null;
  const base = Object.values(SCIENCE_TCG_IDENTITIES).find(s => s.kind === RESONANCE[card.skillId]);
  return base ? { ...base, name: String(card.name || 'Card').split(',')[0] + ' · ' + base.name, lesser: true } : null;
}
export function scienceTcgIdentityText(card, mode) {
  const s = scienceTcgIdentity(card); if (!s) return '';
  const trigger = mode === 'arena' ? 'After each charged skill. ' : mode === 'duel' ? 'On summon. ' : mode === 'legends' ? (s.lesser ? 'Every sixth normal attack. ' : 'Every fourth normal attack. ') : s.lesser ? 'Every sixth attack or healing action. ' : 'Every fourth attack or healing action. ';
  const terms = mode === 'duel' ? ' Barriers grant Divine Shield; delay freezes; acceleration grants +1 Attack. Brands add 1 damage to the next hit.'
    : mode === 'arena' ? ' Delay holds skill charge for one turn; acceleration adds one charge. Brands add 25% damage to the next hit.'
    : mode === 'siege' ? ' Delay slows for two seconds; acceleration shortens recharge. Barriers absorb damage. Brands add 25% damage to the next hit.'
    : ' Delay stuns for one second; acceleration shortens skill cooldowns. Brands add 25% damage to the next hit.';
  const range = mode === 'siege' ? ' Affects allies in neighbouring lanes and up to four enemies in reach.' : mode === 'legends' ? ' Affects you and up to six enemies within signature reach.' : '';
  if(mode==='duel' && s.kind==='capacitor') return 'On summon, gain Divine Shield. After your first surviving attack, discharge a heavy shot into the strongest enemy minion.' + (s.lesser ? ' Minor resonance: reduced strength.' : '');
  return trigger + s.desc + (s.lesser ? ' Minor resonance: reduced strength.' : '') + range + terms;
}

// The plan does not touch health, rewards or saves. Adapters apply it through each
// mode's damage/guard rules. Targets retain object identity for the live engine.
export function scienceTcgSignaturePlan(card, actor, allies, enemies, state = {}, { power = 1, mode = 'legends' } = {}) {
  const s = scienceTcgIdentity(card); if (!s || !actor || actor.hp <= 0) return [];
  if (s.lesser) power *= .3;
  const alive = xs => xs.filter(x => x && !x.dead && x.hp > 0);
  const a = alive(allies), e = alive(enemies), out = [];
  const weak = xs => [...xs].sort((x, y) => x.hp / Math.max(1, x.maxHp) - y.hp / Math.max(1, y.maxHp));
  const strong = [...e].sort((x, y) => y.maxHp - x.maxHp);
  const add = (type, target, value = 1) => { if (target) out.push({ type, target, amount: Math.max(0, Number(value) || 0) }); };
  const hit = (t, scale) => add('damage', t, power * scale);
  const heal = (t, scale) => add('heal', t, power * scale);
  const shield = (t, scale) => add('shield', t, power * scale);
  const brand = t => add('brand', t, mode === 'duel' ? 1 : .25);
  state.casts = (state.casts || 0) + 1;
  switch (s.kind) {
    case 'rally': a.forEach(t => add('charge', t)); hit(strong[0], .35); break;
    case 'tide': e.slice(0, 3).forEach(t => add('delay', t)); hit(e[0], .55); break;
    case 'chain': e.slice(0, 3).forEach((t, i) => hit(t, .8 - i * .2)); break;
    case 'bulwark': shield(actor, .9); e.slice(0, 2).forEach(t => add('delay', t)); break;
    case 'cleanse': add('cleanse', weak(a)[0]); heal(weak(a)[0], 1.1); break;
    case 'predator': { const t = weak(e)[0]; hit(t, t && t.hp < t.maxHp / 2 ? 1.3 : .65); heal(actor, .35); break; }
    case 'capacitor': if (state.casts % 2) shield(actor, 1.2); else hit(strong[0], 1.55); break;
    case 'constellation': e.slice(0, 3).forEach(t => hit(t, .4)); shield(actor, .4); break;
    case 'dawn': e.forEach(t => hit(t, .3)); a.forEach(t => heal(t, .3)); break;
    case 'curse': e.forEach(brand); break;
    case 'rewind': add('cleanse', actor); add('charge', weak(a)[0]); break;
    case 'guardian': shield(weak(a)[0], 1.5); heal(weak(a)[0], .2); break;
    case 'meteor': strong.slice(0, 2).forEach(t => hit(t, .85)); break;
    case 'bloodbanner': add('cost', actor, actor.maxHp * .03); a.forEach(t => add('charge', t)); hit(strong[0], .7); break;
    case 'harvest': { const t = weak(e)[0]; hit(t, .75); shield(actor, t && t.hp < t.maxHp / 2 ? 1 : .3); break; }
    case 'pact': add('cost', actor, actor.maxHp * .03); e.forEach(brand); hit(strong[0], .8); break;
    case 'embers': e.slice(0, 2).forEach(t => { hit(t, .55); brand(t); }); break;
    case 'execution': if (strong[0]) hit(strong[0], Math.min(1.8, .7 + strong[0].maxHp / Math.max(1, power) * .025)); break;
    case 'winter': e.forEach(t => add('delay', t)); shield(weak(a)[0], .6); break;
  }
  return out;
}

export function scienceTcgSkillPath(nodes, targetId, owned = {}) {
  const byId = new Map(nodes.map(n => [n.id, n])), path = [], seen = new Set();
  let n = byId.get(targetId);
  while (n && !seen.has(n.id)) { seen.add(n.id); if (!owned[n.id]) path.unshift(n.id); n = byId.get(n.req); }
  return n ? [] : path;
}
