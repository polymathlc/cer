import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(read('hades-game.manifest.json'));
const html=read('hades-game.html');
const digest=value=>createHash('sha256').update(value).digest('hex');
assert.equal(digest(html),manifest.gameSha256,'Hades beta must match its reviewed build');
assert.equal(digest(read('hades-learning-parent.js')),manifest.parentSha256,'Bridge must match the reviewed integration');
assert.equal(manifest.upstreamRepository,'polymathlc/hades');
assert.match(manifest.upstreamCommit,/^[a-f0-9]{40}$/);
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
assert.equal(manifest.sourcePatch,'hades-game.source.patch');
assert.equal(digest(read(manifest.sourcePatch)),manifest.sourcePatchSha256,'Source patch must match the release manifest');
assert.ok(html.includes('name="application-version" content="'+manifest.version+'"'));
assert.ok(html.includes('HADES_ROUND_REQUEST')&&html.includes('drawSvgCast'));
assert.doesNotMatch(html,/%(?:ASSETS_JSON|SCRIPTS|STYLES)%/);
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
const science=fs.existsSync(new URL('../app.js',import.meta.url));
const launcher=read(science?'app.js':'hades-math-beta.js');
assert.ok(launcher.includes('hades-learning-parent.js?v='+manifest.version),'Bridge cache key must match the release');
if(science)assert.ok(launcher.includes('hades-game.html?learning=1&subject=science&v='+manifest.version),'Science game cache key must match the release');
else{
  assert.ok(launcher.includes("url.searchParams.set('v', '"+manifest.version+"')"),'Math game cache key must match the release');
  assert.ok(read('index.html').includes('hades-math-beta.js?v='+manifest.version),'Math launcher cache key must match the release');
}
console.log('Hades '+manifest.version+' beta artifact and parent bridge match their release manifest.');
