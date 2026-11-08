// Independent visual acceptance: inspect painted tree tiles and real cast events,
// rather than trusting a recipe's name or a sprite's declared coordinates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.GAME_SCREENSHOTS || path.join(root, 'test-results/legends-skill-visual');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function open({ width = 1280, height = 900, reduced = false, failArt = false, failIcons = null, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  // A deterministic clock still invokes the production update/draw/loop functions.
  await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'skill-visual.test') return route.abort();
    if (failArt && url.pathname.includes('/assets/science-legends/')) return route.abort();
    if (failIcons && url.pathname.endsWith('/icons-' + failIcons + '.webp')) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe src="/science-legends.html"></iframe><script>
      addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow)return;
        if(e.data.type==='SD_REQUEST_QUESTIONS')e.source.postMessage({type:'SD_QUESTIONS',feedPolicyVersion:1,requestId:e.data.requestId,studentKey:'visual-qa',studentLevel:'P4',playsLeft:{legends:10},questions:[{id:'glass',q:'Which material lets light pass through?',options:['Clear glass','Wood'],answer:0,topic:'Light'}]},location.origin);
        if(e.data.type==='LEGENDS_REQUEST_META')e.source.postMessage({type:'LEGENDS_META',meta:{inv:[],eq:{},loadout:{},pts:0},gold:0},location.origin);
      });</script>` });
    const filename = path.join(root, decodeURIComponent(url.pathname));
    return fs.existsSync(filename) && fs.statSync(filename).isFile() ? route.fulfill({ path: filename }) : route.abort();
  });
  await page.goto('http://skill-visual.test/');
  const game = page.frames().find(frame => frame.url().includes('science-legends.html'));
  await game.waitForFunction(() => typeof _gameCreditsReady === 'function' && _gameCreditsReady(), null, { polling: 50 });
  await game.locator('#startBtn').click();
  await game.waitForFunction(() => G && G.state === 'play', null, { polling: 50 });
  if (!failArt) await game.waitForFunction(() => CLASS_ORDER.every(cls => LegendsActions.ready('fx-' + cls)) && LegendsActions.ready('whirlwind'), null, { polling: 50 });
  if (!failArt) await game.waitForFunction(() => LegendsModels.allReady() && LegendsArt.ready() && LegendsArt.groundReady(), null, { polling: 50 });
  if (!failArt && !failIcons) await game.waitForFunction(() => LegendsIcons.ready(), null, { polling: 50 });
  await game.evaluate(() => {
    window.__visualQA = {
      hash(canvas) {
        const p = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261, ink = 0;
        for (let i = 0; i < p.length; i++) { hash = Math.imul(hash ^ p[i], 16777619); if (i % 4 === 3 && p[i] > 8) ink++; }
        return { hash: (hash >>> 0).toString(16), ink };
      },
      prepare(cls, sid) {
        ['menuOverlay', 'treeOverlay', 'questionOverlay', 'pauseOverlay', 'overOverlay', 'armoryOverlay', 'skillSelOverlay'].forEach(hide);
        newGame(cls); G.spawnT = 999; G.qTimer = -1000; G.pets = []; G.enemies = [];
        G.slots = [sid, null, null, null]; G.stats.unlocked[sid] = true; G.stats.rank[sid] = 5;
        G.player.hp = G.player.maxHp = 100000;
        for (let i = 0; i < 4; i++) {
          const e = spawnEnemy('brute', false); e.x = G.player.x + 75 + i * 30; e.y = G.player.y + (i % 2 ? 24 : -24);
          e.hp = e.maxHp = 1e8; e.speed = e.dmg = 0;
        }
        mouse.active = true; mouse.lDown = mouse.rDown = false; mouse.sx = VW / 2 + 140; mouse.sy = VH / 2;
        mouse.wx = G.player.x + 140; mouse.wy = G.player.y;
        castSkill(0); draw();
        return G.actions.find(a => a.sid === sid);
      },
      paint(action, fraction, reduced = false) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const g = canvas.getContext('2d', { willReadFrequently: true }), images = [];
        const original = g.drawImage.bind(g); g.drawImage = (image, ...args) => { images.push(image.src || 'canvas'); return original(image, ...args); };
        const local = { ...action, x: 128, y: 128, r: 78, ang: .3 };
        const drawn = LegendsActions.draw(g, local, action.start + action.life * fraction, reduced, G.presentation.actions);
        return { canvas, ...this.hash(canvas), images, drawn };
      }
    };
  });
  return { context, page, game, errors };
}
try {
  const desktop = await open();
  const classes = await desktop.game.evaluate(() => CLASS_ORDER.map(cls => ({ cls, name: CLASSES[cls].name, skills: CLASSES[cls].skills })));
  const allIconHashes = [];
  for (const { cls, skills } of classes) {
    const icons = await desktop.game.evaluate(async ({ cls, skills }) => {
      newGame(cls); renderTree(); show('treeOverlay');
      const board = document.createElement('div'); board.id = 'visual-icon-board';
      board.style.cssText = 'position:fixed;z-index:999999;inset:0 auto auto 0;width:780px;padding:22px;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;background:#111a24;color:#eee;font:14px system-ui';
      const results = [];
      for (const [slot, sid] of skills.entries()) {
        const node = document.querySelector('.tnode[data-node="r_' + sid + '"]'), icon = node.querySelector('.legend-skill-icon');
        const art = icon.querySelector('.icon-art'), style = getComputedStyle(art), fallback = getComputedStyle(icon.querySelector('.icon-fallback'));
        const image = new Image(); image.src = style.backgroundImage.slice(5, -2); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const xy = style.backgroundPosition.split(' ').map(parseFloat), w = image.width / 4, h = image.height / 3;
        canvas.getContext('2d').drawImage(image, (image.width - w) * xy[0] / 100, (image.height - h) * xy[1] / 100, w, h, 0, 0, 64, 64);
        results.push({ sid, slot, url: image.src, size: style.backgroundSize, xy, opacity: +style.opacity, display: style.display, fallback: fallback.visibility, ...__visualQA.hash(canvas) });
        const card = document.createElement('div'), label = document.createElement('div');
        card.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:70px'; label.textContent = SKILLS[sid].name;
        card.append(icon.cloneNode(true), label); board.appendChild(card);
      }
      document.body.appendChild(board);
      return results;
    }, { cls, skills });
    check(icons.length === 12, `${cls}: actual tree contains all12 primary skill icons`);
    check(new Set(icons.map(i => i.hash)).size === 12, `${cls}: all12 painted crops are different`);
    for (const i of icons) {
      check(i.url.endsWith(`/v3/icons-${cls}.webp`) && i.size === '400% 300%', `${i.sid}: correct class atlas and4×3 layout`);
      check(Math.abs(i.xy[0] - i.slot % 4 * 100 / 3) < .02 && Math.abs(i.xy[1] - Math.floor(i.slot / 4) * 50) < .02, `${i.sid}: rendered CSS selects its intended tile`);
      check(i.opacity > .95 && i.display !== 'none' && i.fallback === 'hidden' && i.ink > 100, `${i.sid}: generated tile paints instead of repeated fallback`);
      allIconHashes.push(i.hash);
    }
    await desktop.game.locator('#visual-icon-board').screenshot({ path: path.join(output, `icons-${cls}.png`) });
    await desktop.game.locator('#visual-icon-board').evaluate(node => node.remove());
    const semantics = await desktop.game.evaluate(cls => {
      const nodes = TREES[cls].map(def => {
        const node = document.querySelector('.tnode[data-node="' + def.id + '"]'), symbol = node.querySelector('.legend-node-symbol'), badge = node.querySelector('.icon-kind-badge');
        return { id: def.id, kind: def.kind, sid: node.querySelector('[data-skill-icon]')?.dataset.skillIcon, symbol: symbol?.textContent, expected: def.icon, badge: badge?.textContent };
      });
      return { native: nodes.filter(n => n.symbol !== undefined), rank: nodes.filter(n => n.kind === 'rank'), variants: nodes.filter(n => ['unlock', 'enh', 'branch', 'ult'].includes(n.kind)), branches: nodes.filter(n => n.kind === 'branch' && n.id.endsWith('_' + CLASSES[cls].skills[0])).map(n => n.badge) };
    }, cls);
    check(semantics.native.length > 0 && semantics.native.every(n => n.symbol === n.expected && !n.sid), `${cls}: passive and capstone nodes retain their own native symbol`);
    check(semantics.rank.every(n => n.sid && !n.badge) && semantics.variants.every(n => n.sid && n.badge), `${cls}: primary ranks stay clean and every skill variant has an identifying badge`);
    check(new Set(semantics.branches).size === 6, `${cls}: all six modifier branches have distinct badges`);
  }
  check(new Set(allIconHashes).size === 60, 'all60 primary skills have globally distinct painted icon crops');

  const animationHashes = [];
  for (const { cls, skills } of classes) {
    const sourceFrames = await desktop.game.evaluate(({ cls, skills }) => {
      const image = LegendsActions.snapshot()['fx-' + cls];
      return skills.map((sid, slot) => ({ sid, frames: Array.from({ length: 4 }, (_, phase) => {
        const cell = document.createElement('canvas'); cell.width = cell.height = 64;
        const w = image.naturalWidth / 8, h = image.naturalHeight / 6;
        cell.getContext('2d').drawImage(image, (slot % 2 * 4 + phase) * w, Math.floor(slot / 2) * h, w, h, 0, 0, 64, 64);
        return __visualQA.hash(cell);
      }) }));
    }, { cls, skills });
    for (const source of sourceFrames) {
      check(source.frames.every(f => f.ink > 20), `${source.sid}: all four generated source cells contain visible effect artwork`);
      check(new Set(source.frames.map(f => f.hash)).size === 4, `${source.sid}: four generated source phases are genuinely different images`);
    }
    const samples = await desktop.game.evaluate(({ cls, skills }) => {
      const board = document.createElement('canvas'); board.id = 'visual-fx-board'; board.width = 1024; board.height = 840;
      board.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;width:1024px;height:840px';
      const b = board.getContext('2d'); b.fillStyle = '#121c28'; b.fillRect(0, 0, 1024, 840); b.font = '14px system-ui';
      const results = skills.map((sid, slot) => {
        const action = __visualQA.prepare(cls, sid);
        if (!action) return { sid, missing: true, actions: G.actions.map(a => a.sid) };
        const frames = [.12, .42, .78].map(f => __visualQA.paint(action, f));
        const reducedFrames = [.12, .78].map(f => LegendsActions.sampleSkill(action, action.start + action.life * f, true).frame);
        const x = slot % 4 * 256, y = Math.floor(slot / 4) * 280;
        b.drawImage(frames[1].canvas, x, y); b.fillStyle = '#ecdfbc'; b.fillText(SKILLS[sid].name, x + 14, y + 265);
        return { sid, recipe: action.recipe, hashes: frames.map(f => f.hash), inks: frames.map(f => f.ink), images: frames.map(f => f.images), drawn: frames.every(f => f.drawn), reducedFrames };
      });
      document.body.appendChild(board); return results;
    }, { cls, skills });
    for (const sample of samples) {
      check(!sample.missing, `${sample.sid}: real cast emits its own event: ${JSON.stringify(sample.actions)}`);
      check(sample.recipe === sample.sid, `${sample.sid}: event identifies its skill recipe`);
      check(sample.drawn && sample.inks.every(n => n > 40), `${sample.sid}: all sampled phases visibly render`);
      check(new Set(sample.hashes).size === 3, `${sample.sid}: anticipation, release and fade paint different frames`);
      check(sample.images.every(images => images.some(src => src.endsWith(`/v3/fx-${cls}.webp`) || sample.sid === 'whirlwind' && src.endsWith('/v3/whirlwind.webp'))), `${sample.sid}: actual rendered phases consume generated skill artwork`);
      check(sample.reducedFrames[0] === sample.reducedFrames[1], `${sample.sid}: reduced motion selects a stable texture frame`);
      animationHashes.push(sample.hashes[1]);
    }
    await desktop.game.locator('#visual-fx-board').screenshot({ path: path.join(output, `skills-${cls}.png`) });
    await desktop.game.locator('#visual-fx-board').evaluate(node => node.remove());
  }
  check(new Set(animationHashes).size === 60, 'all60 skill recipes paint different actual release images');

  const whirlwindSource = await desktop.game.evaluate(() => {
    const image = LegendsActions.snapshot().whirlwind;
    return Array.from({ length: 8 }, (_, index) => {
      const cell = document.createElement('canvas'); cell.width = cell.height = 64;
      const w = image.naturalWidth / 4, h = image.naturalHeight / 2;
      cell.getContext('2d').drawImage(image, index % 4 * w, Math.floor(index / 4) * h, w, h, 0, 0, 64, 64);
      return __visualQA.hash(cell);
    });
  });
  check(whirlwindSource.every(f => f.ink > 20) && new Set(whirlwindSource.map(f => f.hash)).size === 8, 'Whirlwind has eight different nonempty generated choreography cells');

  const sustained = await desktop.game.evaluate(() => {
    const results = [], oldChannel = LegendsActions.drawChannel;
    for (const cls of CLASS_ORDER) for (const sid of CLASSES[cls].skills) {
      if (!['spin', 'buff', 'zone', 'aura', 'shield', 'orbit'].includes(SKILLS[sid].type)) continue;
      __visualQA.prepare(cls, sid); G.enemies = []; G.pets = [];
      const samples = [], orbit = SKILLS[sid].type === 'orbit'; let hammerPaints = 0;
      const oldHammer = LegendsArt.drawHammer, oldRect = ctx.fillRect.bind(ctx);
      LegendsArt.drawHammer = function(...args) { const painted = oldHammer.apply(this, args); if (painted && orbit) hammerPaints++; return painted; };
      ctx.fillRect = function(x, y, w, h) { if (orbit && x === -7 && y === -9 && w === 14 && h === 8) hammerPaints++; return oldRect(x, y, w, h); };
      LegendsActions.drawChannel = function(g, channel, ...args) {
        const drawn = oldChannel.call(this, g, channel, ...args);
        if (channel.sid === sid && !orbit) {
          const crop = document.createElement('canvas'); crop.width = crop.height = 256;
          const local = { ...channel, x: 128, y: 128, r: 78 };
          oldChannel.call(this, crop.getContext('2d'), local, ...args);
          samples.push({ time: G.time, ...__visualQA.hash(crop) });
        }
        return drawn;
      };
      for (const target of [.35, .8, 1.35]) {
        while (G.time < target) update(1 / 120); hammerPaints = 0; draw();
        if (orbit) {
          const crop = document.createElement('canvas'); crop.width = crop.height = 256;
          crop.getContext('2d').drawImage(canvas, (G.player.x - G.camX - 155) * DPR, (G.player.y - G.camY - 155) * DPR, 310 * DPR, 310 * DPR, 0, 0, 256, 256);
          const state = G.orbits.find(o => o.sid === sid);
          samples.push({ time: G.time, ...__visualQA.hash(crop), angle: state?.ang, count: state?.count, paints: hammerPaints });
        }
      }
      LegendsActions.drawChannel = oldChannel;
      LegendsArt.drawHammer = oldHammer; ctx.fillRect = oldRect;
      results.push({ sid, samples, orbit });
    }
    return results;
  });
  for (const { sid, samples, orbit } of sustained) {
    check(samples.some(s => s.time > 1.3 && s.ink > 40), `${sid}: real sustained state still draws its own visible channel after1.3seconds`);
    check(new Set(samples.map(s => s.hash)).size > 1, `${sid}: sustained channel changes beyond its initial burst`);
    if (orbit) check(samples.every(s => s.paints >= s.count && Number.isFinite(s.angle)) && new Set(samples.map(s => s.angle)).size === 3, `${sid}: all live orbit weapons actually paint at changing collision-matched angles`);
  }

  const spin = await desktop.game.evaluate(() => {
    __visualQA.prepare('barb', 'whirlwind'); G.enemies = []; G.pets = [];
    const heroMatrices = [], heroRotations = [], frames = [], channels = [];
    const oldHero = drawHeroModel, oldRotate = ctx.rotate.bind(ctx), oldChannel = LegendsActions.drawChannel;
    let insideHero = false;
    drawHeroModel = function() { const m = ctx.getTransform(); heroMatrices.push([m.a / DPR, m.b / DPR, m.c / DPR, m.d / DPR]); insideHero = true; try { return oldHero(); } finally { insideHero = false; } };
    ctx.rotate = function(angle) { if (insideHero) heroRotations.push(angle); return oldRotate(angle); };
    LegendsActions.drawChannel = function(g, channel, ...args) { channels.push({ sid: channel.sid, time: G.time }); return oldChannel.call(this, g, channel, ...args); };
    const board = document.createElement('canvas'); board.id = 'visual-whirlwind-board'; board.width = 960; board.height = 480;
    board.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;width:960px;height:480px'; const b = board.getContext('2d');
    let elapsed = 0;
    for (const [index, target] of [.08, .22, .39, .57, .83, 1.15, 1.55, 2.05].entries()) {
      while (elapsed + 1 / 120 <= target) { update(1 / 120); elapsed += 1 / 120; }
      draw();
      const crop = document.createElement('canvas'); crop.width = crop.height = 240;
      crop.getContext('2d').drawImage(canvas, (G.player.x - G.camX - 155) * DPR, (G.player.y - G.camY - 155) * DPR, 310 * DPR, 310 * DPR, 0, 0, 240, 240);
      b.drawImage(crop, index % 4 * 240, Math.floor(index / 4) * 240);
      frames.push({ time: G.time, active: !!G.spin, ...__visualQA.hash(crop), view: { ...G.view } });
    }
    drawHeroModel = oldHero; ctx.rotate = oldRotate; LegendsActions.drawChannel = oldChannel;
    document.body.appendChild(board); return { frames, heroMatrices, heroRotations, channels, actions: G.actions.length };
  });
  check(spin.frames.every(f => f.active), 'Whirlwind remains active and visible through2seconds');
  check(new Set(spin.frames.map(f => f.hash)).size === 8, 'Whirlwind paints8 different real combat frames, including sustained late frames');
  check(spin.channels.some(c => c.sid === 'whirlwind' && c.time > 1.5), 'Whirlwind sustained rendering continues after initial cast burst expires');
  check(spin.heroMatrices.every(m => Math.abs(m[0] - 1) < .001 && Math.abs(m[3] - 1) < .001 && Math.abs(m[1]) < .001 && Math.abs(m[2]) < .001), 'Whirlwind keeps hero and camera upright at fixed scale');
  check(spin.heroRotations.length === 0, 'Whirlwind never rotates the character bitmap');
  check(spin.frames.every(f => JSON.stringify(f.view) === JSON.stringify(spin.frames[0].view)), 'Whirlwind impacts never change the camera perspective or position');
  await desktop.game.locator('#visual-whirlwind-board').screenshot({ path: path.join(output, 'whirlwind-8-frames.png') });
  await desktop.game.locator('#visual-whirlwind-board').evaluate(node => node.remove());
  await desktop.game.locator('#game').screenshot({ path: path.join(output, 'whirlwind-combat.png') }).catch(async () => {
    await desktop.page.screenshot({ path: path.join(output, 'whirlwind-combat.png') });
  });

  const paused = await desktop.game.evaluate(() => {
    const action = __visualQA.prepare('sorc', 'blizzard'); lastT = 0; loop(1000); show('pauseOverlay');
    const before = { time: G.time, projs: G.projs.length, life: G.spin && G.spin.t, action: LegendsActions.sampleSkill(action, G.time, false) };
    for (let i = 0; i < 12; i++) loop(1016 + i * 16);
    const after = { time: G.time, projs: G.projs.length, life: G.spin && G.spin.t, action: LegendsActions.sampleSkill(action, G.time, false) };
    hide('pauseOverlay'); return { before, after };
  });
  check(JSON.stringify(paused.before) === JSON.stringify(paused.after), 'pause freezes production simulation and animation clock');
  check(desktop.errors.length === 0, `desktop has no runtime errors: ${desktop.errors.join('; ')}`);
  await desktop.context.close();

  const partial = await open({ failIcons: 'sorc' });
  const classFailure = await partial.game.evaluate(() => CLASS_ORDER.map(cls => {
    newGame(cls); renderTree(); show('treeOverlay'); const icon = document.querySelector('.tnode[data-node="r_' + CLASSES[cls].skills[0] + '"] .legend-skill-icon');
    return { cls, ready: LegendsIcons.ready(cls), art: getComputedStyle(icon.querySelector('.icon-art')).display, fallback: getComputedStyle(icon.querySelector('.icon-fallback')).visibility };
  }));
  check(classFailure.every(i => i.cls === 'sorc' ? !i.ready && i.art === 'none' && i.fallback === 'visible' : i.ready && i.art !== 'none' && i.fallback === 'hidden'), 'one missing class atlas leaves its own visible fallback while all other class icons remain painted');
  check(partial.errors.length === 0, 'partial icon load failure has no runtime errors');
  await partial.context.close();

  for (const mode of [{ width: 390, height: 844, touch: true, reduced: true }, { width: 320, height: 760, touch: true, reduced: true }, { width: 390, height: 844, touch: true, failArt: true }]) {
    const mobile = await open(mode);
    const results = await mobile.game.evaluate(() => CLASS_ORDER.flatMap(cls => CLASSES[cls].skills.map(sid => {
      const action = __visualQA.prepare(cls, sid); for (let i = 0; i < 40; i++) update(1 / 120); draw();
      const art = __visualQA.paint(action, .42, lowMotion);
      return { sid, action: !!action, ink: art.ink, time: G.time, bounded: G.actions.length <= 24, finite: [G.player.x, G.player.y, G.player.hp].every(Number.isFinite), motion: lowMotion };
    })));
    check(results.length === 60 && results.every(r => r.action && r.ink > 10 && r.bounded && r.finite), `${mode.failArt ? 'art failure' : 'mobile reduced motion'}: every real skill has a visible bounded fallback without invalid state`);
    if (mode.reduced) check(results.every(r => r.motion), 'mobile honors the real reduced-motion preference');
    const mobileIcons = await mobile.game.evaluate(() => CLASS_ORDER.map(cls => {
      newGame(cls); renderTree(); show('treeOverlay');
      const ranks = CLASSES[cls].skills.map((sid, slot) => {
        const icon = document.querySelector('.tnode[data-node="r_' + sid + '"] .legend-skill-icon'), art = getComputedStyle(icon.querySelector('.icon-art')), fallback = getComputedStyle(icon.querySelector('.icon-fallback'));
        return { sid, slot, x: parseFloat(art.backgroundPositionX), y: parseFloat(art.backgroundPositionY), signature: art.backgroundImage + art.backgroundPosition, size: art.backgroundSize, art: art.display, fallback: fallback.visibility, label: icon.querySelector('.icon-fallback').textContent };
      });
      return { cls, ranks, badges: [...document.querySelectorAll('.tnode.k-branch .icon-kind-badge')].map(n => n.textContent), native: [...document.querySelectorAll('.tnode .legend-node-symbol')].every(n => n.textContent.trim()), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    }));
    for (const result of mobileIcons) {
      const label = `${mode.width}px ${mode.failArt ? 'art failure' : 'mobile'} ${result.cls}`;
      check(result.ranks.length === 12 && new Set(result.ranks.map(i => i.signature)).size === 12 && result.ranks.every(i => i.size === '400% 300%' && Math.abs(i.x - i.slot % 4 * 100 / 3) < .02 && Math.abs(i.y - Math.floor(i.slot / 4) * 50) < .02), `${label}: every actual primary node selects a distinct correctly positioned class tile`);
      check(result.ranks.every(i => mode.failArt ? i.art === 'none' && i.fallback === 'visible' && i.label.trim() : i.art !== 'none' && i.fallback === 'hidden'), `${label}: generated icons or visible native fallbacks match real image readiness`);
      check(new Set(result.badges).size === 6 && result.native && !result.overflow, `${label}: modifier badges, passive symbols and contained horizontal layout survive portrait width`);
    }
    await mobile.page.screenshot({ path: path.join(output, `tree-mobile-${mode.width}${mode.failArt ? '-fallback' : ''}.png`) });
    check(mobile.errors.length === 0, `mobile mode has no runtime errors: ${mobile.errors.join('; ')}`);
    await mobile.context.close();
  }
  console.log(`Science Legends skill visual browser: ${checks} checks passed;60 unique icons and60 generated skill animations; screenshots ${output}`);
} finally { await browser.close(); }
