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
const rendered = cover.render({subject:'math',nameLabel:'Student',dateLabel:'Class',artworkScale:1.2,artworkTextureOpacity:.4});
assert.match(rendered,/>Student</);
assert.match(rendered,/>Class</);
assert.match(rendered,/--wc-art-scale:1.2/);
assert.match(rendered,/--wc-texture-opacity:0.4/);
assert.match(cover.logoUrl,/https:\/\/example.test\/cer\/assets\/branding\//);
assert.match(cover.printStyles,/image-rendering:pixelated/);
assert.ok(!cover.printStyles.includes('background-image:'),'Artwork must print with background graphics disabled');
console.log('PASS small scattered subject symbols, sixteen-cell transparent atlases, print-safe bubble/polygon textures, legacy layout upgrade, escaping and settings');
