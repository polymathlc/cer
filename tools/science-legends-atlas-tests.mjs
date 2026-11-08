import test from 'node:test';import assert from 'node:assert/strict';
import atlas from '../science-legends-atlas.js';
function image(w,h){return new Uint8ClampedArray(w*h*4);}
function box(pixels,width,x,y,w,h,alpha=255,color=[100,150,200]){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const index=(yy*width+xx)*4;pixels[index]=color[0];pixels[index+1]=color[1];pixels[index+2]=color[2];pixels[index+3]=alpha;}}
function alpha(frame,pixels,x,y){return pixels[((y-frame.y)*frame.w+x-frame.x)*4+3];}

test('whole silhouettes crossing nominal grid boundaries retain their complete source bounds and scale',()=>{
 const pixels=image(48,32);box(pixels,48,2,4,26,22);box(pixels,48,33,5,12,20);
 const before=pixels.slice(),result=atlas.extract(pixels,48,32,2,1,{minPixels:20});
 const first=result.frames[0][0],second=result.frames[1][0];
 assert.deepEqual(result.missing,[]);assert.equal(first.core.x,2);assert.equal(first.core.w,26);
 assert.ok(first.x+first.w>24,'the first actor extends past the nominal cell instead of losing its arm');
 assert.equal(second.core.x,33);assert.equal(first.nominalWidth,24);assert.equal(second.nominalWidth,24);
 assert.equal(first.nominalHeight,32);assert.deepEqual(pixels,before,'unpacking never edits source pixels');
 const extracted=atlas.cropPixels(pixels,48,32,first);assert.equal(alpha(first,extracted,27,10),255);
});

test('overlapping bounding rectangles do not include another actor or detached foreign islands',()=>{
 const pixels=image(48,32);
 box(pixels,48,2,2,9,19);box(pixels,48,10,2,18,5); // actor A: upside-down L
 box(pixels,48,18,12,4,15,255,[240,20,20]);box(pixels,48,18,22,26,5,255,[240,20,20]); // actor B: L
 box(pixels,48,12,15,1,1,255,[240,20,20]); // detached island close to A's edge
 box(pixels,48,11,10,1,1,32); // A antialias pixel
 box(pixels,48,17,15,1,1,32,[240,20,20]); // B antialias pixel inside A's rectangle
 const result=atlas.extract(pixels,48,32,2,1,{minPixels:20,padding:2}),first=result.frames[0][0];
 assert.deepEqual(result.missing,[]);
 const extracted=atlas.cropPixels(pixels,48,32,first);
 assert.equal(alpha(first,extracted,4,15),255,'own body remains');
 assert.equal(alpha(first,extracted,19,15),0,'foreign core is excluded where rectangles overlap');
 assert.equal(alpha(first,extracted,12,15),0,'small detached island is not mistaken for antialias');
 assert.equal(alpha(first,extracted,11,10),32,'own antialias alpha is preserved exactly');
 assert.equal(alpha(first,extracted,17,15),0,'foreign antialias does not leak into the actor');
});

test('foot anchoring follows the selected silhouette rather than neighboring lower weapon pieces',()=>{
 const pixels=image(60,40);box(pixels,60,5,4,15,25);box(pixels,60,25,32,3,3);box(pixels,60,36,5,18,29);
 const result=atlas.extract(pixels,60,40,2,1,{minPixels:30}),frame=result.frames[0][0];
 assert.equal(frame.footY,28);assert.equal(frame.footX,12);
 assert.ok(Math.abs(frame.y+frame.anchor.y*frame.h-frame.footY)<1e-9);
 assert.ok(Math.abs(frame.x+frame.anchor.x*frame.w-frame.footX)<1e-9);
});

test('diagonal core pixels are connected and missing frames are reported explicitly',()=>{
 const pixels=image(12,12);box(pixels,12,1,1,1,1);box(pixels,12,2,2,1,1);box(pixels,12,8,1,2,2);box(pixels,12,1,8,2,2);
 const result=atlas.extract(pixels,12,12,2,2,{minPixels:2,padding:0});
 assert.equal(result.frames[0][0].pixels,2);assert.equal(result.frames[1][0].pixels,4);
 assert.deepEqual(result.missing,[{column:1,row:1}]);assert.equal(result.frames[1][1],null);
});

test('one connected body spanning two cells is never duplicated into a fake second actor',()=>{
 const pixels=image(40,20);box(pixels,40,5,4,30,12);
 const result=atlas.extract(pixels,40,20,2,1,{minPixels:20});
 assert.equal(result.components.length,1);assert.equal(result.missing.length,1);
 assert.equal(result.frames.flat().filter(Boolean).length,1);
});

test('invalid dimensions and invalid frame coverage are rejected before allocation/copying',()=>{
 assert.throws(()=>atlas.extract(image(2,2),3,3,1,1),RangeError);
 assert.throws(()=>atlas.extract([],0,2,1,1),RangeError);
 assert.throws(()=>atlas.extract(image(2,2),2,2,0,1),RangeError);
 assert.throws(()=>atlas.cropPixels(image(2,2),2,2,{x:0,y:0,w:2,h:2,coverage:new Uint8Array(1)}),RangeError);
});
