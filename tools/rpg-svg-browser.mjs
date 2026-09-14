// Render the real catalogue and paper-doll functions without Firebase or assets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, moduleNames, rendererSource, sampleSets } from './rpg-avatar-art-tests.mjs';

const module = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(/^[A-Za-z]:[\\/]/.test(module) ? pathToFileURL(module).href : module);
const out = path.resolve(process.env.GAME_SCREENSHOTS || path.join(root, '..', 'rpg-svg-qa'));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 920 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#eaf0f2;color:#24354c;font-family:system-ui,sans-serif}
    h1{font-size:26px;margin:0 0 6px}h2{margin:24px 0 14px;font-size:19px}p{margin:0 0 20px;color:#53687b}
    #heroes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.hero-card{background:linear-gradient(155deg,#fff,#d5e6e7);border:1px solid #b8ced1;border-radius:20px;padding:14px;text-align:center;box-shadow:0 6px 16px #263d4d12}
    .hero-card svg{display:block;width:100%;height:285px}.hero-card h3{font-size:15px;margin:4px 0}.hero-card small{font-size:11px;color:#667887}
    .catalogue{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.item-card{padding:12px;background:#fff;border:1px solid #cad5df;border-radius:14px;text-align:center;min-width:0}.item-card svg{display:block;width:100%;height:145px}.item-card b{display:block;font-size:12px;margin-top:8px}.item-card small{display:block;font-size:10px;color:#65778e;margin-top:3px}
    @media(max-width:600px){body{padding:14px}h1{font-size:22px}#heroes{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hero-card{padding:8px}.hero-card svg{height:190px}.hero-card h3{font-size:12px}.catalogue{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.item-card{padding:8px}.item-card svg{height:100px}}
  </style></head><body><h1>Science Quest · Vector wardrobe</h1><p>Equipped explorers and all 143 collectibles, drawn from the production renderer.</p><main id="heroes"></main><section id="sheets"></section></body></html>`);
  for (const name of moduleNames) await page.addScriptTag({ content: fs.readFileSync(path.join(root, name), 'utf8') });
  await page.addScriptTag({ content: rendererSource });
  await page.evaluate(sets => {
    const f = fixture, escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const state = { gender:'male',equipment:{},inventory:{wood_sword:1},upgrades:{},gold:321 };
    const before = JSON.stringify(state);
    f.setState(state);
    f.setOverrides({_character:'https://invalid.test/character.png',_character_female:'https://invalid.test/female.png',worldender:'https://invalid.test/item.png'});
    document.getElementById('heroes').innerHTML = sets.map(set => '<article class="hero-card" data-name="'+escape(set.name)+'"><h3>'+escape(set.name)+'</h3><small>'+set.gender+' · equipped avatar</small>'+f.avatar(set.equipment,set.gender)+'</article>').join('');
    if (JSON.stringify(state) !== before) throw Error('Rendering changed saved state');
    const parser = new DOMParser(), invalid = [];
    const quotedName = '\"><script>alert(1)</script><svg onload="alert(2)">';
    const quoted = parser.parseFromString(f.icon({...f.byId.wood_sword,name:quotedName}),'image/svg+xml');
    if(quoted.querySelector('parsererror,script,[onload]') || quoted.documentElement.getAttribute('aria-label')!==quotedName)throw Error('SVG item names must be encoded as attribute values');
    for (const it of f.items) {
      for (const gender of ['male','female']) {
        const xml = parser.parseFromString(f.avatar({[it.slot]:it.id},gender),'image/svg+xml');
        if (xml.querySelector('parsererror')) invalid.push(it.id+':'+gender);
      }
    }
    window.parseErrors = invalid;
    document.getElementById('sheets').innerHTML = Object.keys(f.slots).map(slot => {
      const items = f.items.filter(it => it.slot === slot), cards = [];
      for (const it of items) for (const upgrade of slot === 'pet' ? [0,3,6] : [0]) {
        f.setState({...state,upgrades:{[it.id]:upgrade}});
        const svg = f.icon(it), xml = parser.parseFromString(svg,'image/svg+xml');
        if (xml.querySelector('parsererror')) invalid.push(it.id+':'+upgrade);
        cards.push('<article class="item-card" data-id="'+it.id+'" data-stage="'+f.petStage(it)+'">'+svg+'<b>'+escape(it.name)+'</b><small>'+it.rarity+(slot==='pet'?' · evolution '+(f.petStage(it)+1):'')+'</small></article>');
      }
      return '<section id="sheet-'+slot+'"><h2>'+escape(f.slots[slot].label)+' · '+items.length+' collectibles</h2><div class="catalogue">'+cards.join('')+'</div></section>';
    }).join('');
    // Freeze ambient SVG animation for deterministic paint bounds and screenshots.
    document.querySelectorAll('svg').forEach(svg => {svg.pauseAnimations();svg.setCurrentTime(0);});
  }, sampleSets);
  const checks = await page.evaluate(() => {
    const definitions = new Set(), duplicates = [], missingPaints = [], clipping = [];
    document.querySelectorAll('[id]').forEach(el => { if(definitions.has(el.id))duplicates.push(el.id);definitions.add(el.id); });
    document.querySelectorAll('svg').forEach(svg => {
      const own = new Set([...svg.querySelectorAll('[id]')].map(el=>el.id));
      for(const el of svg.querySelectorAll('*')) for(const a of el.attributes) for(const m of a.value.matchAll(/url\(#([^)]+)\)/g)) if(!own.has(m[1]))missingPaints.push(m[1]);
    });
    document.querySelectorAll('.item-card > svg').forEach(svg => {
      const b=svg.getBBox(), v=svg.viewBox.baseVal, margin=1;
      if(b.x<v.x-margin||b.y<v.y-margin||b.x+b.width>v.x+v.width+margin||b.y+b.height>v.y+v.height+margin)clipping.push({id:svg.parentElement.dataset.id,stage:svg.parentElement.dataset.stage,bounds:[b.x,b.y,b.width,b.height],viewBox:[v.x,v.y,v.width,v.height]});
    });
    const avatarChecks=[...document.querySelectorAll('.hero-card > svg')].map(svg=>({
      name:svg.parentElement.dataset.name,gender:svg.querySelector('[data-gender]')?.getAttribute('data-gender'),
      head:!!svg.querySelector('circle[cx="100"][cy="78"][r="34"]'),
      left:!!svg.querySelector('[transform="translate(58,158)"]'),right:!!svg.querySelector('[transform="translate(142,158)"]'),
      grip:!!svg.querySelector('.av-swing [data-hero-part="grip"]'),animations:svg.querySelectorAll('.av-swing animateTransform').length
    }));
    return {duplicates,missingPaints,clipping,avatarChecks,parseErrors:window.parseErrors,raster:document.querySelectorAll('svg image,svg foreignObject,svg text,img').length,iconCount:document.querySelectorAll('.item-card').length};
  });
  fs.writeFileSync(path.join(out,'svg-checks.json'),JSON.stringify(checks,null,2));
  await page.locator('#heroes').screenshot({path:path.join(out,'avatars-desktop.png')});
  for (const slot of ['weapon','shield','armor','helmet','accessory','pet']) await page.locator('#sheet-'+slot).screenshot({path:path.join(out,'catalogue-'+slot+'.png')});
  // The existing sword action still turns the weapon and the local grip together.
  const swing = await page.evaluate(() => {
    const svg=document.querySelectorAll('.hero-card svg')[2],g=svg.querySelector('.av-swing');
    const before=g.getCTM();
    svg.unpauseAnimations();svg.setCurrentTime(0);g.querySelector('.av-anim-slash').beginElement();svg.pauseAnimations();svg.setCurrentTime(.22);
    const m=g.getCTM();return {beforeB:before.b,a:m.a,b:m.b,grip:!!g.querySelector('[data-hero-part="grip"]')};
  });
  assert.ok(swing.grip && Math.abs(swing.b-swing.beforeB)>0.02,'the weapon and holding fingers still animate');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#heroes').screenshot({path:path.join(out,'avatars-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile contact sheet stays within the viewport');
  assert.deepEqual(checks.parseErrors,[],'all equipped and icon SVGs parse as XML');
  assert.deepEqual(checks.duplicates,[],'repeated icons and heroes have unique definitions');
  assert.deepEqual(checks.missingPaints,[],'each SVG contains its own paint references');
  assert.equal(checks.raster,0,'saved image overrides never trigger image rendering');
  assert.deepEqual(checks.clipping,[],'collectible artwork fits its unchanged inventory viewBox');
  for(let i=0;i<sampleSets.length;i++){
    const c=checks.avatarChecks[i];assert.equal(c.gender,sampleSets[i].gender);assert.ok(c.head&&c.left&&c.right&&c.grip);assert.equal(c.animations,3);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(`rpg-svg-browser: ${checks.iconCount} collectible/evolution icons, 286 equipped SVGs, desktop/mobile heroes, no raster requests, valid paints and slot bounds OK. Screenshots: ${out}`);
} finally { await browser.close(); }
