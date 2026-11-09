import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legends-builds.test') return route.abort();
    const file = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? route.fulfill({ path: file })
      : route.abort();
  });
  await page.goto('http://legends-builds.test/science-legends.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => G?.state === 'play', null, { timeout: 20000 });

  const result = await page.evaluate(() => {
    const step = 1 / 120;
    const presentation = G.presentation;
    const models = presentation.models;
    const names = ['hero', 'heroRear', 'boss', 'bossRear', 'mythicHero', 'mythicHeroRear'];
    const missingModels = names.filter(name => !models[name]);
    if (missingModels.length) throw new Error('Hunt began before preparing ' + missingModels.join(', '));
    const label = (enemy, status) => LegendsModels.statuses(enemy).find(entry => entry.kind === status)?.label;
    const woundDamage = wounds => wounds.reduce((total, wound) => total + wound.rate * wound.time, 0);
    muted = true;

    function run(cls, slots, alloc, items = [], equipped = {}) {
      META.inv = items;
      META.eq = equipped;
      newGame(cls, presentation);
      G.slots = slots;
      G.alloc = alloc;
      computeStats();
      G.pets = [];
      G.spawnT = 999;
      G.qTimer = -1000;
      G.stats.armor = 0;
      G.stats.crit = 0;
      G.stats.regen = 0;
      mouse.active = false;
      Object.assign(G.player, { x: 1000, y: 1000, fx: 1, fy: 0, atkCd: 999 });
    }
    function target(distance, enemy = spawnEnemy('brute', false)) {
      Object.assign(enemy, {
        x: G.player.x + distance, y: G.player.y, hp: 10000, maxHp: 10000, speed: 0, dmg: 0, stun: 100
      });
      G.enemySpatialDirty = true;
      return enemy;
    }
    function advance(steps, afterStep = () => {}) {
      for (let i = 0; i < steps; i++) {
        update(step);
        afterStep();
      }
    }
    function fireball(enemy) {
      G.cds.fireball = 0;
      const hp = enemy.hp;
      castSkill(0);
      const shot = G.projs.some(projectile => projectile.sid === 'fireball');
      for (let i = 0; i < 120 && enemy.hp === hp; i++) updateProjectiles(step);
      if (!shot || enemy.hp === hp) throw new Error('Fireball did not reach the positioned enemy');
      return { damage: hp - enemy.hp, chill: label(enemy, 'chill'), frozen: label(enemy, 'frozen') };
    }
    function frost(affinity) {
      const items = affinity ? [{ id: 'ring', slot: 'ring', name: 'Test ring', r: 'rare', af: {}, affinity, affinityPower: 20 }] : [];
      run('sorc', ['fireball'], { r_fireball: 3, ult2_fireball: 1 }, items, affinity ? { ring1: 'ring' } : {});
      const enemy = target(110);
      return { element: skillBuild('fireball').kind, hits: Array.from({ length: 3 }, () => fireball(enemy)) };
    }
    const ice = frost();
    const iceAffix = frost('frost');
    const unrelatedAffix = frost('fire');
    G.enemies = [];
    const frostBoss = target(110, spawnBoss(5));
    const bossFrost = Array.from({ length: 3 }, () => fireball(frostBoss));

    function spin(ultimate) {
      run('barb', ['whirlwind', 'execute'], {
        u_whirlwind: 1, r_whirlwind: 3, e2_whirlwind: 1, ['ult' + ultimate + '_whirlwind']: 1,
        u_execute: 1, r_execute: 3, ult3_execute: 1
      });
      const inner = target(43);
      const outer = target(112);
      let projectile = false;
      const inspect = () => { projectile ||= G.projs.some(shot => shot.sid === 'whirlwind'); };
      castSkill(0);
      if (!G.spin) throw new Error('Whirlwind did not begin its channel');
      const channelSteps = Math.ceil(G.spin.life / step) + 1;
      inspect();
      advance(1, inspect);
      const bleed = inner.afflictions?.bleed || [];
      const fire = inner.afflictions?.fire || [];
      const firstTick = wounds => wounds.reduce((total, wound) => total + wound.rate * step, 0);
      const first = {
        inner: inner.maxHp - inner.hp, outer: outer.maxHp - outer.hp,
        impact: inner.maxHp - inner.hp - firstTick(bleed) - firstTick(fire),
        bleed: woundDamage(bleed) + firstTick(bleed),
        fire: woundDamage(fire) + firstTick(fire)
      };
      advance(75, inspect);
      const stacks = {
        bleed: inner.afflictions?.bleed?.length || 0,
        fire: inner.afflictions?.fire?.length || 0
      };
      const statuses = { bleed: label(inner, 'bleed'), burn: label(inner, 'burn') };
      // Finish the channel so every tick is checked for an accidental projectile.
      for (let i = 76; G.spin && i < channelSteps; i++) advance(1, inspect);
      if (G.spin) throw new Error('Whirlwind outlasted its channel duration');
      return { element: skillBuild('whirlwind').kind, first, stacks, statuses, projectile, inner };
    }
    const bleedSpin = spin(3);
    const wounded = bleedSpin.inner;
    const beforeTick = wounded.hp;
    advance(8);
    const tickedAfterSpin = wounded.hp < beforeTick;
    const originalWounds = [...wounded.afflictions.bleed];
    const ruptureHp = wounded.hp;
    const ruptureDamage = woundDamage(originalWounds) * 1.2;
    const finisherImpact = SKILLS.execute.p.dmg * skillDmgMult('execute') * buffDmg() * .25;
    castSkill(1);
    const execution = {
      actual: ruptureHp - wounded.hp, expected: ruptureDamage + finisherImpact,
      hadStacks: originalWounds.length, remaining: wounded.afflictions.bleed.length,
      consumed: !originalWounds.some(wound => wounded.afflictions.bleed.includes(wound)),
      caption: G.texts.some(text => text.txt === 'RUPTURE'),
      spinProjectile: G.projs.some(shot => shot.sid === 'whirlwind')
    };
    const fireSpin = spin(2);
    const physicalSpin = spin(1);

    run('barb', ['bladestorm'], { u_bladestorm: 1 });
    const attacker = target(80);
    castSkill(0);
    advance(100);
    const wardIdleDamage = attacker.maxHp - attacker.hp;
    const heroStart = G.player.hp;
    G.player.shield = 20;
    hurtPlayer(20);
    const wardBlockedDamage = attacker.maxHp - attacker.hp;
    hurtPlayer(20);
    const wardHit = { hero: heroStart - G.player.hp, counter: attacker.maxHp - attacker.hp };
    hurtPlayer(20);
    const wardCooldown = attacker.maxHp - attacker.hp;
    advance(61);
    hurtPlayer(20);
    const wardSecondCounter = attacker.maxHp - attacker.hp;
    advance(700);
    const wardExpiredHp = G.player.hp;
    hurtPlayer(20);
    const wardExpired = { hero: wardExpiredHp - G.player.hp, counter: attacker.maxHp - attacker.hp };

    function drawnTextures(draw) {
      const textures = [];
      const original = ctx.drawImage;
      ctx.drawImage = function(image, ...args) {
        textures.push(image);
        return original.call(this, image, ...args);
      };
      try { draw(); } finally { ctx.drawImage = original; }
      return textures;
    }
    function groundStrokes() {
      const strokes = [];
      const original = ctx.stroke;
      ctx.stroke = function(...args) {
        strokes.push(this.strokeStyle);
        return original.apply(this, args);
      };
      try { drawHeroGround(); } finally { ctx.stroke = original; }
      return strokes;
    }
    function pose(actor, rear, draw) {
      actor.fx = rear ? -1 : 1;
      actor.fy = rear ? -1 : 1;
      LegendsModels.advanceFacing(actor);
      return drawnTextures(draw);
    }
    run('barb', [], {});
    const bosses = [5, 10, 15, 20].map((wave, column) => {
      const boss = spawnBoss(wave);
      const draw = () => drawEnemyModel(boss, 116);
      const front = pose(boss, false, draw);
      const rear = pose(boss, true, draw);
      boss.modelAttackUntil = G.time + 1;
      const attack = pose(boss, true, draw);
      return {
        id: boss.bossId,
        front: front.includes(models.boss.frames[column][0].texture),
        rear: rear.includes(models.bossRear.frames[column][0].texture),
        attack: attack.includes(models.bossRear.frames[column][3].texture),
        different: front[0] !== rear[0] && attack[0] !== rear[0]
      };
    });
    const mythics = CLASS_ORDER.map((cls, column) => {
      const item = LegendsLoot.rollBossItem(cls, () => 0, () => null, () => cls + '-mythic');
      const slot = item.slot === 'twohand' ? 'mainhand' : 'offhand';
      run(cls, [], {}, [item], { [slot]: item.id });
      const signature = G.stats.signature?.id;
      const front = pose(G.player, false, drawHeroModel);
      const rear = pose(G.player, true, drawHeroModel);
      G.player.moving = true;
      const walk = pose(G.player, true, drawHeroModel);
      G.player.moving = false;
      const aura = groundStrokes();
      META.eq = {};
      computeStats();
      const base = pose(G.player, true, drawHeroModel);
      return {
        cls, signature, aura, baseAura: groundStrokes(),
        front: front.includes(models.mythicHero.frames[column][0].texture),
        rear: rear.includes(models.mythicHeroRear.frames[column][0].texture),
        walk: walk.includes(models.mythicHeroRear.frames[column][1].texture),
        base: base.includes(models.heroRear.frames[column][0].texture),
        different: front[0] !== rear[0] && rear[0] !== walk[0] && base[0] !== rear[0]
      };
    });
    const spinResults = [bleedSpin, fireSpin, physicalSpin].map(({ element, first, stacks, statuses, projectile }) =>
      ({ element, first, stacks, statuses, projectile }));
    return {
      ice, iceAffix, unrelatedAffix, bossFrost, spins: spinResults, tickedAfterSpin, execution,
      wardIdleDamage, wardBlockedDamage, wardHit, wardCooldown, wardSecondCounter, wardExpired,
      bosses, mythics
    };
  });

  function near(actual, expected, description) {
    assert.ok(Math.abs(actual - expected) < 1e-7, description + ' (' + actual + ' vs ' + expected + ')');
  }
  assert.equal(result.ice.element, 'frost');
  const [firstIce, secondIce, thirdIce] = result.ice.hits;
  assert.equal(firstIce.chill, 'CHILLED');
  assert.equal(secondIce.chill, 'CHILLED');
  assert.equal(thirdIce.frozen, 'FROZEN');
  near(secondIce.damage, firstIce.damage * 1.3, 'The next Fireball exploits chill');
  near(thirdIce.damage, secondIce.damage, 'The third Fireball deals chilled damage and freezes');
  near(result.iceAffix.hits[0].damage, firstIce.damage * 1.2, 'Equipped frost affinity boosts actual frost damage');
  near(result.unrelatedAffix.hits[0].damage, firstIce.damage, 'Equipped fire affinity leaves frost damage unchanged');
  assert.ok(result.bossFrost.every(hit => hit.chill === 'CHILLED' && !hit.frozen));

  const [bleed, fire, physical] = result.spins;
  assert.deepEqual(result.spins.map(spin => spin.element), ['bleed', 'fire', 'physical']);
  assert.ok(result.spins.every(spin => !spin.projectile), 'Whirlwind only damages through its channel');
  near(bleed.first.inner, bleed.first.outer * 1.3, 'Grindstone amplifies the inner half of Whirlwind');
  near(bleed.first.bleed, bleed.first.impact * 3, 'Bleed defers 75% of damage');
  assert.ok(bleed.stacks.bleed >= 3 && bleed.stacks.bleed <= 8);
  assert.equal(bleed.statuses.bleed, 'BLEED ×' + bleed.stacks.bleed);
  assert.ok(result.tickedAfterSpin, 'Existing wounds tick after Whirlwind ends');
  near(fire.first.fire, fire.first.impact * (2 / 3), 'Fire defers 40% of damage');
  assert.equal(fire.stacks.bleed, 0);
  assert.ok(fire.stacks.fire >= 3 && fire.stacks.fire <= 5);
  assert.equal(fire.statuses.burn, 'BURN ×' + fire.stacks.fire);
  assert.deepEqual(physical.stacks, { bleed: 0, fire: 0 });
  near(physical.first.impact, bleed.first.impact * 4, 'Physical delivers the full strike immediately');

  assert.ok(result.execution.hadStacks >= 3 && result.execution.consumed);
  near(result.execution.actual, result.execution.expected, 'Executioner ruptures existing bleed at 120% and then delivers its own impact');
  assert.equal(result.execution.remaining, 1, 'Only the new Executioner wound remains');
  assert.ok(result.execution.caption && !result.execution.spinProjectile);

  assert.equal(result.wardIdleDamage, 0);
  assert.equal(result.wardBlockedDamage, 0);
  near(result.wardHit.hero, 16, 'Blade Ward reduces real incoming damage by 20%');
  assert.ok(result.wardHit.counter > 0);
  near(result.wardCooldown, result.wardHit.counter, 'Blade Ward caps retaliation within its half-second cooldown');
  near(result.wardSecondCounter, result.wardHit.counter * 2, 'Blade Ward can retaliate again after cooldown');
  near(result.wardExpired.hero, 20, 'Expired Blade Ward stops reducing incoming damage');
  near(result.wardExpired.counter, result.wardSecondCounter, 'Expired Blade Ward stops retaliation');

  assert.deepEqual(result.bosses.map(boss => boss.id), ['tyrant', 'prism', 'mire', 'storm']);
  for (const boss of result.bosses) {
    assert.ok(boss.front && boss.rear && boss.attack && boss.different, boss.id + ' paints its front, rear and rear attack frames');
  }
  const signatureIds = ['worldbreaker', 'astral-heart', 'primeval-pact', 'sunward', 'skyspike'];
  const auraColors = ['#ff8b50', '#b8e7ff', '#9cf27b', '#ffdf89', '#79cfff'];
  assert.deepEqual(result.mythics.map(hero => hero.signature), signatureIds);
  result.mythics.forEach((hero, index) => {
    assert.ok(hero.front && hero.rear && hero.walk && hero.base && hero.different, hero.cls + ' paints its equipped Mythic and base models');
    assert.deepEqual(hero.aura, [auraColors[index]], hero.cls + ' paints the signature aura');
    assert.deepEqual(hero.baseAura, [], hero.cls + ' removes the aura on unequip');
  });
  assert.deepEqual(errors, []);
  console.log('Science Legends builds browser: frost, Whirlwind, Executioner, Blade Ward, four boss models and five Mythic models passed');
} finally {
  await browser.close();
}
