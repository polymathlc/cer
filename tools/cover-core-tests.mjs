import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const context = {URL,location:{href:'https://example.test/cer/index.html'}};
vm.runInNewContext(fs.readFileSync(new URL('worksheet-cover.js',root),'utf8'), context);
const cover = context.WorksheetCover;
assert.equal(cover.subject('Primary Mathematics'),'math');
assert.equal(cover.subject('Primary Science'),'science');
for(const key of ['math','science']) {
  const html = cover.decoration(key);
  assert.equal((html.match(/class="wc-icon"/g)||[]).length,6);
  assert.match(html,new RegExp(`/${key}-icons.png`));
  assert.ok(!html.includes(`${key === 'math' ? 'science' : 'math'}-icons.png`));
  assert.match(html,/left:-200%;top:-100%/);
  assert.equal((cover.decoration(key,{layout:'minimal'}).match(/class="wc-icon"/g)||[]).length,2);
  const asset = fs.readFileSync(new URL(`assets/worksheet-covers/${key}-icons.png`,root));
  assert.equal(asset.subarray(1,4).toString(),'PNG');
  assert.equal(asset.readUInt32BE(16),1536);
  assert.equal(asset.readUInt32BE(20),1024);
  assert.equal(asset[25],6,'Atlas must keep its RGBA transparency');
}
assert.match(cover.decoration('science',{scale:'bad',opacity:-1}),/--wc-art-scale:1;--wc-art-opacity:0.15/);
const escaped = cover.render({title:'<img onerror="bad()">',fields:false,className:'print-front-page <bad>',header:'A & B'});
assert.ok(!escaped.includes('<img onerror'));
assert.match(escaped,/&lt;img onerror=/);
assert.match(escaped,/A &amp; B/);
assert.ok(!escaped.includes('class="wc-fields"'));
assert.ok(!escaped.includes(' <bad>'));
const rendered = cover.render({subject:'math',nameLabel:'Student',dateLabel:'Class',artworkScale:1.2});
assert.match(rendered,/>Student</);
assert.match(rendered,/>Class</);
assert.match(rendered,/--wc-art-scale:1.2/);
assert.match(cover.logoUrl,/https:\/\/example.test\/cer\/assets\/branding\//);
assert.match(cover.printStyles,/image-rendering:pixelated/);
assert.ok(!cover.printStyles.includes('background-image:'),'Artwork must print with background graphics disabled');
console.log('PASS cover subjects, six-cell raster atlas, transparency, escaping, settings, local URLs and print CSS');
