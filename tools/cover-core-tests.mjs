import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const context = {URL,location:{href:'https://example.test/cer/index.html'}};
vm.runInNewContext(fs.readFileSync(new URL('worksheet-cover.js',root),'utf8'), context);
const cover = context.WorksheetCover;
assert.equal(cover.subject('Primary Mathematics'),'math');
assert.equal(cover.subject('Primary Science'),'science');
for(const key of ['math','science']) {
  const html = cover.decoration(key);
  const icons = [...html.matchAll(/class="wc-icon"[^>]*data-icon="([^"]+)"[^>]*style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%/g)]
    .map(([,id,left,top,width]) => ({id,left:Number(left),top:Number(top),width:Number(width)}));
  assert.ok(icons.length>=30 && icons.length<=38,'Default cover needs many small, scattered symbols');
  assert.equal(new Set(icons.map(icon=>icon.id)).size,16,'Use all sixteen subject icons');
  icons.forEach(icon=>assert.ok(icon.width<=8,'Icons must remain small relative to the page'));
  assert.equal(new Set(icons.map(icon=>Math.floor(icon.top/25))).size,4,'Scatter symbols over all four vertical quarters');
  assert.ok(icons.filter(icon=>icon.left>=20 && icon.left<=75 && icon.top>=10 && icon.top<=90).length>=6,'Pepper the interior whitespace as well as the edges');
  assert.match(html,/data-cover-layout="scattered"/);
  assert.match(html,new RegExp(`/${key}-icons-v2.png`));
  assert.ok(!html.includes(`${key === 'math' ? 'science' : 'math'}-icons`));
  assert.match(html,/<svg\b/,'Coloured textures must print as SVG artwork');
  assert.ok((html.match(/<circle\b/g)||[]).length>=6,'Include pastel bubble textures');
  assert.ok((html.match(/<polygon\b/g)||[]).length>=4,'Include pastel polygon textures');
  const minimalCount=(cover.decoration(key,{layout:'minimal'}).match(/class="wc-icon"/g)||[]).length;
  assert.ok(minimalCount>=16 && minimalCount<icons.length,'Quiet arrangement retains the full icon variety');
  assert.equal(cover.decoration(key,{layout:'corners'}),html,'Saved legacy corner layouts upgrade to the scattered design');
  const asset = fs.readFileSync(new URL(`assets/worksheet-covers/${key}-icons-v2.png`,root));
  assert.equal(asset.subarray(1,4).toString(),'PNG');
  assert.equal(asset.readUInt32BE(16),asset.readUInt32BE(20),'Four-by-four atlas must be square');
  assert.ok(asset.readUInt32BE(16)>=1024);
  assert.equal(asset[25],6,'Atlas must keep its RGBA transparency');
  const crops=[...html.matchAll(/data-crop="([^"]+)"/g)].map(([,crop])=>crop.split(',').map(Number));
  assert.equal(crops.length,icons.length,'Each symbol declares its actual atlas crop');
  assert.equal(new Set(crops.map(crop=>crop.join(','))).size,16,'Use sixteen separate atlas regions');
  crops.forEach(([x,y,w,h])=>{
    assert.ok([x,y,w,h].every(Number.isInteger),'Crop coordinates use source pixels');
    assert.ok(x>=0 && y>=0 && w>0 && h>0 && x+w<=asset.readUInt32BE(16) && y+h<=asset.readUInt32BE(20),'Each crop stays inside the source atlas');
  });
}
assert.match(cover.decoration('science',{scale:'bad',opacity:-1}),/--wc-art-scale:1;--wc-art-opacity:0.15/);
assert.match(cover.decoration('science',{textureOpacity:0}),/--wc-texture-opacity:0/);
const escaped = cover.render({title:'<img onerror="bad()">',fields:false,className:'print-front-page <bad>',header:'A & B'});
assert.ok(!escaped.includes('<img onerror'));
assert.match(escaped,/&lt;img onerror=/);
assert.match(escaped,/A &amp; B/);
assert.ok(!escaped.includes('class="wc-fields"'));
assert.ok(!escaped.includes(' <bad>'));
const rendered = cover.render({subject:'math',nameLabel:'Student',dateLabel:'Class',artworkScale:1.2,artworkTextureOpacity:.4,coverDesign:cover.design});
assert.match(rendered,/>Student</);
assert.match(rendered,/>Class</);
assert.match(rendered,/--wc-art-scale:1.2/);
assert.match(rendered,/--wc-texture-opacity:0.4/);

// The Big M cover: render() always draws it; decoration() keeps its legacy arrangements.
assert.equal(cover.design,'big-m');
const big = cover.render({subject:'science',title:'Electrical Systems',subheader:'Topical worksheet',subtitle:'Circuits & insulators',level:'P5',header:'Polymath Learning Centre',footer:'Primary Science'});
assert.match(big,/^<div class="wc-cover wc-m" data-cover-subject="science" data-cover-design="big-m">/);
assert.match(big,/data-cover-layout="scattered" data-cover-design="big-m"/);
assert.match(big,/<svg class="wc-facets" viewBox="0 0 794 320"/,'The faceted M sits in the top-right band');
assert.equal((big.match(/<svg class="wc-facets"/g)||[]).length,1);
assert.equal((big.match(/<svg class="wc-textures"/g)||[]).length,1);
assert.match(big,/--wc-art-opacity:0.38;--wc-texture-opacity:0.6;--wc-facet-opacity:1/,'Default backdrop is the faint one the design was approved at');
const bigIcons=[...big.matchAll(/class="wc-icon" data-icon="([^"]+)"[^>]*style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%/g)].map(([,id,left,top,width])=>({id,left:+left,top:+top,width:+width}));
assert.equal(bigIcons.length,31,'The approved sprinkle has thirty-one icons');
assert.equal(new Set(bigIcons.map(icon=>icon.id)).size,16,'…using all sixteen subject icons');
bigIcons.forEach(icon=>{assert.ok(icon.width<=6,'Icons stay small');assert.ok(icon.left>=0 && icon.left+icon.width<=100 && icon.top>=0 && icon.top<=97,'Icons stay on the sheet');});
// Nothing sits on the title block or the student-fields card: in the design's
// coordinates the text column runs from 7% to 93% across, the title block from
// 30% to 50% down and the fields card from 61% to 77%.
bigIcons.forEach(icon=>{
  const inColumn = icon.left + icon.width > 7.05 && icon.left < 92.95;
  if (!inColumn) return;
  const bottom = icon.top + icon.width * (210 / 297) * 1.2; // widest-to-tallest crop, as a share of the sheet height
  assert.ok(!(icon.top < 50.5 && bottom > 30.2), `${icon.id} would sit on the title block`);
  assert.ok(!(icon.top < 77 && bottom > 61.5), `${icon.id} would sit on the student fields`);
});
assert.match(big,/<img class="wc-logo"[^>]*width="2681" height="1957"/,'The logo reserves its box before it loads');
assert.match(big,/<span class="wc-pill wc-pill-level">P5<\/span><span class="wc-pill wc-pill-subject">Science<\/span>/);
assert.match(big,/<div class="wc-eyebrow">Topical worksheet<\/div>/);
assert.match(big,/<h1 class="wc-title" style="--wc-title-size:8.8cqw">Electrical Systems<\/h1>/);
assert.match(big,/<p class="wc-subtitle"[^>]*>Circuits &amp; insulators<\/p>/);
assert.match(big,/<span class="wc-org">Polymath Learning Centre<\/span><span class="wc-dot"> · <\/span><span class="wc-note">Primary Science<\/span>/);
assert.match(big,/polymathlc\.com\.sg/);
for (const label of ['Name','Date','Score']) assert.match(big,new RegExp(`class="wc-field-label">${label}<`));
assert.ok(!/>Class</.test(big),'The cover asks for Name and Date only, never Class');
assert.equal((big.match(/class="wc-field-line[ "]/g)||[]).length,4,'Two writing lines and two score boxes');
assert.match(big,/<div class="wc-fields"><div class="wc-field wc-field-name">/);
// The score box can be switched off; Name and Date then share the card's row.
const noScore = cover.render({title:'Heat',score:false});
assert.ok(!noScore.includes('wc-score') && !/>Score</.test(noScore),'No score box, label or slash when it is off');
assert.match(noScore,/<div class="wc-fields wc-no-score">/);
assert.equal((noScore.match(/class="wc-field-line[ "]/g)||[]).length,2,'Just the Name and Date lines');
assert.ok(!cover.render({title:'Heat',score:false,editable:true}).includes('data-wc-field="scoreLabel"'));
assert.match(cover.render({title:'Heat',score:true}),/class="wc-score"/);
assert.match(cover.printStyles,/\.wc-no-score \.wc-field-date\{grid-column:2;grid-row:1\}/);
// A missing level, subtitle or footer note leaves no empty pill, paragraph or stray dot.
const bare = cover.render({title:'Heat',footer:''});
assert.ok(!bare.includes('wc-pill-level') && !bare.includes('wc-subtitle') && !bare.includes('wc-dot'));
assert.match(bare,/wc-pill-subject">Science</);
assert.match(cover.render({subject:'math'}),/wc-pill-subject">Mathematics</);
// The editor shows every field, empty ones as placeholders to type into.
const editable = cover.render({editable:true,title:'Heat'});
for (const field of ['level','subheader','title','subtitle','header','footer','nameLabel','dateLabel','scoreLabel']) assert.match(editable,new RegExp(`data-wc-field="${field}"`));
// Long titles step down so the title block stays within two full-size lines.
const sizeOf = title => +cover.render({title}).match(/--wc-title-size:([\d.]+)cqw/)[1];
assert.equal(sizeOf('Heat'),8.8);
assert.ok(sizeOf('Photosynthesis, leaves\n& gas exchange') < 8.8);
assert.ok(sizeOf('Interactions within the environment: food chains and food webs') <= 6);
assert.ok(sizeOf('Interactions within the environment: food chains and food webs') >= 4.5);
// Arrangements: edges only and light sprinkle are smaller sets of the same design.
for (const [layout,count] of [['frame',16],['minimal',16],['exam',31],['corners',31]]) {
  assert.equal((cover.render({artworkLayout:layout}).match(/class="wc-icon"/g)||[]).length,count,layout);
}
// Covers saved before the redesign kept the old, stronger intensities: they get the faint backdrop.
assert.match(cover.render({artworkOpacity:.72,artworkTextureOpacity:.65,artworkScale:.8}),/--wc-art-scale:0.8;--wc-art-opacity:0.38;--wc-texture-opacity:0.6/);
assert.match(cover.render({coverDesign:cover.design,artworkOpacity:.5,artworkFacetOpacity:.4}),/--wc-art-opacity:0.5;--wc-texture-opacity:0.6;--wc-facet-opacity:0.4/);
assert.match(cover.decoration('science',{design:cover.design}),/data-cover-design="big-m"/);
assert.ok(!cover.decoration('science').includes('wc-facets'),'Legacy decoration has no facets');
assert.match(cover.logoUrl,/https:\/\/example.test\/cer\/assets\/branding\//);
assert.match(cover.printStyles,/image-rendering:pixelated/);
assert.ok(!cover.printStyles.includes('background-image:'),'Artwork must print with background graphics disabled');
console.log('PASS Big M cover structure, faint backdrop, icons clear of text, title fitting, small scattered subject symbols, sixteen-cell transparent atlases, print-safe bubble/polygon textures, legacy layout upgrade, escaping and settings');
