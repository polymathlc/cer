import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {CHARACTERS} from '../grand-line-data.js';

const root=new URL('../assets/grand-line/',import.meta.url);
test('all fifty characters ship their complete generated card and avatar artwork',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.length,50);
  assert.equal(new Set(manifest.map(row=>row.id)).size,50);
  assert.deepEqual(manifest.map(row=>row.id).sort(),CHARACTERS.map(c=>c.id).sort());
  assert.equal(CHARACTERS.filter(c=>c.stars===7).length,3);
  for(const row of manifest){
    assert.equal(row.file,row.id+'.webp');
    assert.equal(row.hasAlpha,true,row.id+' avatar requires transparency');
    assert.ok(row.width>=1000&&row.height>=1000,row.id+' requires full-resolution art');
    assert.ok(row.artRect.w>.35&&row.artRect.w<.7);
    assert.ok(row.avatarRect.x>=row.artRect.w-.01&&row.avatarRect.x+row.avatarRect.w<=1.001);
    assert.ok(row.prompt.length>100,row.id+' must preserve its generation prompt');
    const bytes=await fs.readFile(new URL(row.file,root));
    assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256,row.id+' delivery checksum');
    assert.match(row.sourceSha256,/^[a-f0-9]{64}$/);
  }
});
