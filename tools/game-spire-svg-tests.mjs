import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const artSource=fs.readFileSync(new URL('../spire-svg-art.js',import.meta.url),'utf8');
const game=fs.readFileSync(new URL('../science-spire.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const context=vm.createContext({});
vm.runInContext(artSource,context);
const art=context.SpireSvgArt;
const cards=['strike','defend','bash','jab','guard','cleave','pommel','focus','adrenal','weaken','poison','fireball','shieldwall','doublestrike','rage','meteor','lifesteal','fortress','apex','singularity'];
const characters=['warrior','mage','rogue','slime','bat','spider','wraith','bot','golem','chimera','titan'];

function checkSvg(svg){
  assert.match(svg,/^<svg\b/);
  assert.match(svg,/<\/svg>$/);
  assert.doesNotMatch(svg,/<(?:image|img|foreignObject|script)\b|(?:href|onerror|onload)=|undefined|NaN/);
  const ids=[...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'gradient identifiers must be unique in an illustration');
  for(const m of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]),'every paint reference resolves inside its own SVG: '+m[1]);
  return ids;
}

test('Spire SVG collection covers every playable class, enemy and card',()=>{
  assert.deepEqual([...art.characterIds].sort(),characters.slice().sort());
  assert.deepEqual([...art.cardIds].sort(),cards.slice().sort());
  for(const kind of characters){
    const svg=art.character(kind);
    checkSvg(svg);
    assert.match(svg,new RegExp('data-spire-character="'+kind+'"'));
  }
  for(const id of cards){
    checkSvg(art.card(id));
    checkSvg(art.card(id,{compact:true}));
    checkSvg(art.effect(id));
    assert.match(art.card(id),new RegExp('data-spire-card="'+id+'"'));
  }
  checkSvg(art.effect('impact'));
});

test('Repeated characters and cards have independent paint definitions',()=>{
  const ids=[];
  for(let n=0;n<3;n++){
    for(const kind of characters) ids.push(...checkSvg(art.character(kind)));
    for(const id of cards) ids.push(...checkSvg(art.card(id)));
  }
  assert.equal(new Set(ids).size,ids.length,'cards in hand and Spellbook cannot reuse another illustration’s gradients');
});

test('Every card retains a distinct scene, including Defend and Bulwark',()=>{
  const normalised=cards.map(id=>art.card(id).replace(/spire-card-\d+/g,'paint').replace(/data-spire-card="[^"]+"/g,'').replace(/<title>.*?<\/title>/g,''));
  assert.equal(new Set(normalised).size,cards.length);
  assert.notEqual(normalised[cards.indexOf('defend')],normalised[cards.indexOf('fortress')]);
});

test('Character animation states remain compatible and presentation input stays bounded',()=>{
  for(const state of ['idle','attack','hurt','death']) assert.match(art.character('warrior',null,state),new RegExp('anim-'+state));
  assert.match(art.character('mage',['url(https://invalid.test)','" onload="x','red'],'unexpected" onload="x'),/anim-idle/);
  assert.doesNotMatch(art.character('mage',['url(https://invalid.test)','" onload="x','red']),/onload|invalid\.test/);
  assert.equal(art.character('missing'),'');
  assert.equal(art.card('missing'),'');
});

test('Spire uses vectors even when older parent tabs send saved raster overrides',()=>{
  const functionBody=name=>game.slice(game.indexOf('function '+name+'('),game.indexOf('\n}',game.indexOf('function '+name+'('))+2);
  const c=vm.createContext({SpireSvgArt:art,G:{heroKind:'rogue'},HEROES:{warrior:{kind:'warrior'},rogue:{kind:'rogue'}},ENEMIES:{slime:{kind:'slime'}},OVR:{'player:idle':'https://invalid.test/old.png','slime:idle':'https://invalid.test/old.png'},CARD_ART_OVR:{strike:'https://invalid.test/old-card.png'}});
  vm.runInContext(functionBody('spriteSvg')+'\n'+functionBody('artHtml')+'\n'+functionBody('cardArtHtml'),c);
  for(const value of [c.artHtml('player','old','idle'),c.artHtml('slime','old','attack'),c.cardArtHtml('strike')]){
    checkSvg(value);
    assert.doesNotMatch(value,/invalid\.test/);
  }
  assert.match(game,/<script src="spire-svg-art\.js"><\/script>/);
  assert.match(game,/prefers-reduced-motion:reduce\)\{\.spr \*,\.proj,\.cast,\.burst\{animation:none!important/);
});
