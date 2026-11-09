/* Milestone bosses retain the combat engine's shared status and recovery state. */
(function(root) {
  'use strict';

  const rotation = Object.freeze([
    Object.freeze({
      id: 'tyrant', name: 'Core Tyrant', column: 0, color: '#e2a0cb', icon: '♜',
      hp: 950, speed: 52, dmg: 24, r: 34, xp: 150, role: 'Groundbreaker',
      tell: 'A circle marks the coming ground strike.',
      counter: 'Move out of the warning area, then strike during recovery. Below 55% health, move clear of all three circles.'
    }),
    Object.freeze({
      id: 'prism', name: 'Prism Regent', column: 1, color: '#c7a7ff', icon: '✧',
      hp: 870, speed: 57, dmg: 25, r: 31, xp: 160, role: 'Crystal artillery',
      tell: 'Violet rays lock into place before crystal bolts travel down them.',
      counter: 'Step between the rays. The Regent fires five lanes below 55% health.'
    }),
    Object.freeze({
      id: 'mire', name: 'Mire Matriarch', column: 2, color: '#c0e37e', icon: '❖',
      hp: 1050, speed: 46, dmg: 23, r: 37, xp: 170, role: 'Poison and brood',
      tell: 'Green circles show where lingering poison beds will form.',
      counter: 'Leave the marked beds before they bloom. The Matriarch adds a third bed and a limited brood below 55% health.'
    }),
    Object.freeze({
      id: 'storm', name: 'Storm Warden', column: 3, color: '#8aeaff', icon: 'ϟ',
      hp: 975, speed: 61, dmg: 27, r: 34, xp: 180, role: 'Halberd charger',
      tell: 'A cyan corridor fixes the path of its halberd lunge.',
      counter: 'Dodge sideways, then attack during recovery. The lunge reaches farther below 55% health.'
    })
  ]);
  const definitions = Object.freeze(Object.fromEntries(rotation.map(boss => [boss.id, boss])));
  const enragedNames = Object.freeze({
    prism: 'Overcharged Prism Regent',
    mire: 'Brooding Mire Matriarch',
    storm: 'Overcharged Storm Warden'
  });
  const enraged = Object.freeze(Object.fromEntries(Object.entries(enragedNames).map(([id, name]) => [
    id, Object.freeze({ ...definitions[id], name })
  ])));
  const phaseCues = Object.freeze({
    prism: 'PRISM OVERCHARGED',
    mire: 'THE BROOD STIRS',
    storm: 'STORM UNBOUND'
  });

  function get(id) {
    return Object.prototype.hasOwnProperty.call(definitions, id) ? definitions[id] : null;
  }

  function forWave(wave) {
    const milestone = Number.isFinite(wave) ? Math.max(1, Math.floor(wave / 5)) : 1;
    return rotation[(milestone - 1) % rotation.length];
  }

  function variant(enemy) {
    const boss = enemy && enemy.kind === 'boss' && get(enemy.bossId);
    return boss && boss.id !== 'tyrant' ? boss : null;
  }

  function intelligence(enemy) {
    const boss = variant(enemy);
    if (!boss || !enemy.variety?.phaseTwo) return boss;
    return enraged[boss.id];
  }

  function alive(actor) {
    return actor && !actor.dead && actor.hp > 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cue(ctx, enemy, text, color, kind = 'attack') {
    enemy.variety.feedback = { kind, text, color, time: ctx.time || 0 };
    if (ctx.cue) ctx.cue(text, color, enemy);
  }

  function recover(enemy, duration, cooldown) {
    const state = enemy.variety;
    state.phase = 'recovery';
    state.timer = duration;
    state.cooldown = cooldown;
    state.target = null;
    state.bossAttack = null;
  }

  function lockPrism(state, dx, dy) {
    const heading = Math.atan2(dy, dx);
    const offsets = state.phaseTwo ? [-.52, -.26, 0, .26, .52] : [-.3, 0, .3];
    const rays = offsets.map(offset => ({
      x: Math.cos(heading + offset), y: Math.sin(heading + offset)
    }));
    return { rays, speed: state.phaseTwo ? 330 : 295, life: 1.45, width: 5.5 };
  }

  function lockMire(state, target, dx, dy) {
    const spread = state.phaseTwo ? 73 : 53;
    const pools = [-1, 1].map(side => ({
      x: target.x - dy * side * spread,
      y: target.y + dx * side * spread
    }));
    if (state.phaseTwo) pools.push({ x: target.x + dx * 42, y: target.y + dy * 42 });
    return { pools, radius: state.phaseTwo ? 58 : 54 };
  }

  function lockStorm(enemy, state, ctx, dx, dy) {
    const distance = state.phaseTwo ? 355 : 305;
    let x = enemy.x + dx * distance;
    let y = enemy.y + dy * distance;
    if (ctx.world) {
      x = clamp(x, 20, ctx.world.w - 20);
      y = clamp(y, 20, ctx.world.h - 20);
    }
    return { x, y, width: 31, speed: state.phaseTwo ? 765 : 680, active: false, hits: new Set() };
  }

  function lock(enemy, target, ctx, boss, dx, dy) {
    const state = enemy.variety;
    let duration;
    if (boss.id === 'prism') {
      duration = state.phaseTwo ? .72 : .9;
      state.bossAttack = lockPrism(state, dx, dy);
    } else if (boss.id === 'mire') {
      duration = state.phaseTwo ? .8 : .95;
      state.bossAttack = lockMire(state, target, dx, dy);
    } else {
      duration = state.phaseTwo ? .76 : .92;
      state.bossAttack = lockStorm(enemy, state, ctx, dx, dy);
    }
    state.phase = 'windup';
    state.timer = state.duration = duration;
    state.target = target;
    state.castSerial++;
    enemy.fx = dx;
    enemy.fy = dy;
    enemy.modelAttackUntil = (ctx.time || 0) + duration + .12;
  }

  function releasePrism(enemy, state, ctx, boss) {
    const attack = state.bossAttack;
    if (ctx.shoot) {
      for (const ray of attack.rays) {
        ctx.shoot({
          x: enemy.x + ray.x * (enemy.r + 5), y: enemy.y + ray.y * (enemy.r + 5),
          vx: ray.x * attack.speed, vy: ray.y * attack.speed, r: attack.width,
          damage: enemy.dmg * .68, life: attack.life, element: 'prism',
          color: boss.color, source: enemy
        });
      }
    }
    recover(enemy, .92, state.phaseTwo ? 2.2 : 3);
  }

  function releaseMire(enemy, state, ctx, boss) {
    const attack = state.bossAttack;
    if (ctx.hazard) {
      for (const pool of attack.pools) {
        ctx.hazard({
          kind: 'mire', x: pool.x, y: pool.y, r: attack.radius, warning: .12,
          life: 2.2, tick: .58, damage: enemy.dmg * .34, slow: .22,
          color: boss.color, owner: enemy, source: enemy, castId: state.castSerial, detached: true
        });
      }
    }
    // At most two per cast and four in this encounter. Hatchlings cannot grant rewards.
    let remaining = Math.min(2, 4 - (state.broodSpawned || 0));
    if (state.phaseTwo && remaining > 0 && ctx.spawnChild) {
      for (const side of [-1, 1]) {
        if (!remaining) break;
        const offset = (enemy.r + 14) * side;
        const child = ctx.spawnChild({
          kind: 'mite', x: enemy.x - enemy.fy * offset, y: enemy.y + enemy.fx * offset,
          noLoot: true, noXP: true, grace: .9, parentKind: 'mire'
        });
        if (child) {
          state.broodSpawned = (state.broodSpawned || 0) + 1;
          remaining--;
        }
      }
    }
    recover(enemy, 1.1, state.phaseTwo ? 2.45 : 3.25);
  }

  function strikeAlong(enemy, target, ctx, attack, startX, startY) {
    if (!alive(target) || attack.hits.has(target) || !ctx.strike) return;
    const dx = enemy.x - startX;
    const dy = enemy.y - startY;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return;
    const along = clamp(((target.x - startX) * dx + (target.y - startY) * dy) / lengthSquared, 0, 1);
    const reach = attack.width + (target.r || 0);
    if (Math.hypot(target.x - (startX + dx * along), target.y - (startY + dy * along)) > reach) return;
    attack.hits.add(target);
    ctx.strike(target, enemy.dmg * 1.12);
  }

  function advanceStormLunge(enemy, state, dt, ctx) {
    const attack = state.bossAttack;
    const dx = attack.x - enemy.x;
    const dy = attack.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const distanceThisStep = Math.min(distance, attack.speed * dt);
      const startX = enemy.x;
      const startY = enemy.y;
      enemy.fx = dx / distance;
      enemy.fy = dy / distance;
      enemy.x += enemy.fx * distanceThisStep;
      enemy.y += enemy.fy * distanceThisStep;
      strikeAlong(enemy, ctx.player, ctx, attack, startX, startY);
      if (state.target !== ctx.player) strikeAlong(enemy, state.target, ctx, attack, startX, startY);
    }
    state.timer -= dt;
    if (distance <= attack.speed * dt || state.timer <= 0) {
      recover(enemy, 1.12, state.phaseTwo ? 2.1 : 2.8);
    }
  }

  function advance(enemy, dt, target, ctx = {}) {
    const boss = variant(enemy);
    const state = enemy && enemy.variety;
    if (!boss || !state) return false; // Existing Core Tyrant owns its original state machine.
    if (!alive(enemy)) {
      state.phase = 'dead';
      state.timer = 0;
      state.target = null;
      state.bossAttack = null;
      return true;
    }
    if (!Number.isFinite(dt) || dt <= 0 || dt > .25 || ctx.paused || ctx.ended) return true;
    if (enemy.frozen > 0 || enemy.stun > 0) {
      if (state.phase === 'windup') {
        recover(enemy, .62, .9);
        enemy.modelAttackUntil = 0;
        cue(ctx, enemy, 'INTERRUPTED', '#b7e8f0', 'interrupt');
      }
      return true;
    }
    if (!state.phaseTwo && enemy.hp <= enemy.maxHp * .55) {
      state.phaseTwo = true;
      recover(enemy, 1.05, 0);
      enemy.modelAttackUntil = 0;
      cue(ctx, enemy, phaseCues[boss.id], boss.color, 'enrage');
      return true;
    }
    if (state.phase === 'recovery') {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 1e-8) state.phase = 'approach';
      return true;
    }
    if (state.phase === 'windup' && state.bossAttack) {
      if (state.bossAttack.active) {
        advanceStormLunge(enemy, state, dt, ctx);
        return true;
      }
      state.timer -= dt;
      if (state.timer > 1e-8) return true;
      if (boss.id === 'prism') releasePrism(enemy, state, ctx, boss);
      else if (boss.id === 'mire') releaseMire(enemy, state, ctx, boss);
      else {
        // Retain the shared windup phase while lunging so existing control effects cancel it.
        state.bossAttack.active = true;
        state.timer = .53;
        enemy.modelAttackUntil = (ctx.time || 0) + state.timer;
      }
      return true;
    }
    if (!alive(target)) return true;

    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    const directionX = distance ? dx / distance : enemy.fx || 1;
    const directionY = distance ? dy / distance : enemy.fy || 0;
    const range = boss.id === 'prism' ? 400 : boss.id === 'mire' ? 310 : 275;
    state.cooldown = Math.max(0, state.cooldown - dt);
    enemy.fx = directionX;
    enemy.fy = directionY;
    if (distance <= range && !state.cooldown) {
      lock(enemy, target, ctx, boss, directionX, directionY);
      return true;
    }
    const followAt = boss.id === 'prism' ? 310 : boss.id === 'mire' ? 225 : 170;
    const movement = distance > followAt ? 1 : boss.id === 'prism' && distance < 155 ? -.62 : 0;
    const step = enemy.speed * (ctx.slowMult ?? 1) * dt * movement;
    enemy.x += directionX * step;
    enemy.y += directionY * step;
    return true;
  }

  function line(ctx, x, y, endX, endY) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  function drawTelegraphs(ctx, enemy, time, caption) {
    const boss = variant(enemy);
    if (!boss) return false;
    const state = enemy.variety;
    if (!alive(enemy) || !state) return true;
    const attack = state.bossAttack;
    if (state.phase === 'recovery') {
      if (caption) caption(enemy.x, enemy.y - enemy.r - 24, 'RECOVERING', '#ffe3ad');
      return true;
    }
    if (state.phase !== 'windup' || !attack) return true;

    const progress = clamp(1 - state.timer / state.duration, 0, 1);
    let label;
    ctx.save();
    ctx.strokeStyle = boss.color;
    ctx.fillStyle = boss.color;
    ctx.lineWidth = 2;
    if (boss.id === 'prism') {
      for (const ray of attack.rays) {
        const startX = enemy.x + ray.x * (enemy.r + 5);
        const startY = enemy.y + ray.y * (enemy.r + 5);
        const reach = attack.speed * attack.life;
        ctx.globalAlpha = .1 + progress * .14;
        ctx.lineWidth = attack.width * 2;
        line(ctx, startX, startY, startX + ray.x * reach, startY + ray.y * reach);
        ctx.globalAlpha = .85;
        ctx.lineWidth = 2;
        line(ctx, startX, startY, startX + ray.x * reach, startY + ray.y * reach);
      }
      label = attack.rays.length + ' CRYSTAL LANES';
    } else if (boss.id === 'mire') {
      for (const pool of attack.pools) {
        ctx.beginPath();
        ctx.arc(pool.x, pool.y, attack.radius, 0, Math.PI * 2);
        ctx.globalAlpha = .15 + progress * .14;
        ctx.fill();
        ctx.globalAlpha = .9;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pool.x, pool.y, attack.radius - 5, -Math.PI / 2, Math.PI * (2 * progress - .5));
        ctx.stroke();
      }
      label = 'POISON BEDS';
    } else {
      ctx.lineCap = 'round';
      ctx.lineWidth = attack.width * 2;
      ctx.globalAlpha = attack.active ? .28 : .13 + progress * .12;
      line(ctx, enemy.x, enemy.y, attack.x, attack.y);
      ctx.globalAlpha = .96;
      ctx.lineWidth = attack.active ? 5 : 2.5;
      line(ctx, enemy.x, enemy.y, attack.x, attack.y);
      ctx.beginPath();
      ctx.arc(attack.x, attack.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      label = attack.active ? 'HALBERD LUNGE' : 'DODGE SIDEWAYS';
    }
    ctx.restore();
    if (caption) caption(enemy.x, enemy.y - enemy.r - 24, label, boss.color);
    return true;
  }

  function drawProjectile(ctx, projectile) {
    if (projectile.element !== 'prism') return false;
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
    ctx.strokeStyle = '#8764d3';
    ctx.lineWidth = 3;
    line(ctx, -17, 0, -3, 0);
    ctx.fillStyle = '#e5d7ff';
    ctx.strokeStyle = '#35255d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-2, -5.5);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-2, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return true;
  }

  const api = Object.freeze({ rotation, get, forWave, intelligence, advance, drawTelegraphs, drawProjectile });
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegendsBosses = api;
})(typeof window === 'object' ? window : globalThis);
