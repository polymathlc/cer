// Cull only fully invisible work, using independently observed painted quads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: width < 600 ? 2 : 1 }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); if (url.hostname !== 'legends-cull.test') return route.abort();
      const file = path.join(root, decodeURIComponent(url.pathname));
      return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
    });
    await page.goto('http://legends-cull.test/science-legends.html');
    await page.waitForFunction(() => LegendsModels.allReady() && LegendsActions.ready('fx-barb'));
    await page.locator('#startBtn').click(); await page.waitForFunction(() => G && G.time > .05);
    const actors = await page.evaluate(() => {
      G.state = 'qa-manual'; G.enemies = []; G.pets = []; G.spawnT = 999; G.qTimer = -1000; G.time = 1; draw();
      const rows = [], cx = G.camX, cy = G.camY;
      // Observe actual drawImage destination quads; do not trust the culling
      // helper's own proposed bounds when placing a body on a viewport edge.
      function paintedBox(actor, size) {
        const image = ctx.drawImage; let quad;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage = function (texture, ...args) {
          const [x, y, w, h] = args.slice(-4), m = this.getTransform();
          const points = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => ({ x: m.a * a + m.c * b + m.e, y: m.b * a + m.d * b + m.f }));
          quad = { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
          return image.call(this, texture, ...args);
        };
        try { drawEnemyModel(actor, size); return quad; } finally { ctx.drawImage = image; ctx.restore(); }
      }
      const model = LegendsModels.drawEnemy; let calls = 0;
      LegendsModels.drawEnemy = function (...args) { calls++; return model.apply(this, args); };
      try {
        for (const kind of ['slime', 'imp', 'mite', 'brute', 'spitter', 'charger']) for (const rear of [false, true]) for (const pose of ['idle', 'walk', 'attack']) {
          G.enemies = []; const e = spawnEnemy(kind, false);
          Object.assign(e, { x: cx, y: cy + VH / 2, hp: 500, maxHp: 500, fx: 1, fy: rear ? -1 : 1, modelRear: rear, modelPhase: 0, moving: pose === 'walk', modelAttackUntil: pose === 'attack' ? 2 : 0, chargeSt: 0, spitWindup: 0, heavyWindup: 0 });
          const box = paintedBox(e, Math.max(40, e.r * 4));
          e.x += cx - 60 - box.right; calls = 0; drawActors(cx, cy); const invisible = calls;
          e.x += 64; calls = 0; drawActors(cx, cy); const edge = calls;
          rows.push({ kind, rear, pose, hasQuad: !!box, invisible, edge });
        }
      } finally { LegendsModels.drawEnemy = model; }
      return rows;
    });
    for (const actor of actors) {
      check(actor.hasQuad && actor.invisible === 0, `${width}: fully invisible ${actor.kind}/${actor.pose}/${actor.rear ? 'rear' : 'front'} body is culled`);
      check(actor.edge === 1, `${width}: edge-crossing ${actor.kind}/${actor.pose}/${actor.rear ? 'rear' : 'front'} limb/body remains drawn`);
    }
    const effects = await page.evaluate(() => {
      G.enemies = []; G.pets = []; G.fx = []; G.actions = []; G.impacts = []; G.zones = []; G.projs = []; G.eprojs = []; G.orbs = []; G.texts = []; G.time = 1; draw();
      const x = G.camX, y = G.camY, mid = y + VH / 2;
      const channel = LegendsActions.drawChannel, image = ctx.drawImage, stroke = ctx.stroke; let channels = 0, images = 0, strokes = 0;
      LegendsActions.drawChannel = function (...args) { channels++; return channel.apply(this, args); };
      ctx.drawImage = function (...args) { images++; return image.apply(this, args); };
      ctx.stroke = function (...args) { strokes++; return stroke.apply(this, args); };
      let outside, tail;
      try {
        for (let i = 0; i < 80; i++) drawProjectile({ kind: 'skillproj', sid: 'axes', x: x - 1000, y: mid + i, vx: 300, vy: 0, r: 7, life: 2, vfxStart: .8, vfxLife: 2 });
        outside = { channels, images, strokes };
        drawProjectile({ kind: 'skillproj', sid: 'axes', x: x - 180, y: mid, vx: -300, vy: 0, r: 7, life: 2, vfxStart: .8, vfxLife: 2, trail: [{ x: x + 30, y: mid, age: .02 }, { x: x - 180, y: mid, age: 0 }] });
        tail = { channels: channels - outside.channels, strokes: strokes - outside.strokes };
      } finally { LegendsActions.drawChannel = channel; ctx.drawImage = image; ctx.stroke = stroke; }

      const arcs = ctx.arc, line = ctx.lineTo; let meteorArcs = 0, chainEndpoints = 0;
      const warning = { kind: 'meteor', x: x - 120, y: mid, r: 160, t: .4, life: .9, evil: true, dmg: 0 };
      const left = x - 40, right = x + VW + 40, level = mid + 13.39;
      ctx.arc = function (a, b, ...args) { if (Math.abs(a - warning.x) < .001 && Math.abs(b - warning.y) < .001) meteorArcs++; return arcs.call(this, a, b, ...args); };
      ctx.lineTo = function (a, b) { if ((Math.abs(a - left) < .001 || Math.abs(a - right) < .001) && Math.abs(b - level) < .001) chainEndpoints++; return line.call(this, a, b); };
      const before = { time: G.time, hp: G.player.hp, kills: G.kills, answered: G.answered };
      try {
        G.fx = [warning, { kind: 'bolt', pts: [{ x: left, y: level }, { x: x + VW / 2, y: level }, { x: right, y: level }], t: .05, life: .5, color: '#fff' }];
        draw();
      } finally { ctx.arc = arcs; ctx.lineTo = line; }
      return { outside, tail, meteorArcs, chainEndpoints, unchanged: JSON.stringify(before) === JSON.stringify({ time: G.time, hp: G.player.hp, kills: G.kills, answered: G.answered }) };
    });
    check(effects.outside.channels === 0 && effects.outside.images === 0 && effects.outside.strokes === 0, `${width}:80fully offscreen projectiles issue no visual work`);
    check(effects.tail.channels > 0 && effects.tail.strokes > 0, `${width}: an onscreen trail is retained even with its projectile body outside`);
    check(effects.meteorArcs > 0, `${width}: a large blast warning crossing the screen edge remains visible`);
    check(effects.chainEndpoints > 0, `${width}: a chain crossing the viewport is retained although both endpoints are outside`);
    check(effects.unchanged, `${width}: culling/rendering changes no health, reward, question count or simulation time`);
    check(errors.length === 0, `${width}: visibility scenarios leave no browser errors: ${errors.join(', ')}`);
    await page.close();
  }
  console.log(`Science Legends culling browser: ${checks} checks passed`);
} finally { await browser.close(); }
