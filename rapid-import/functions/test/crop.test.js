import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {cropDiagram} from '../crop.js';

function page(paper='#fff') {
  const canvas=createCanvas(600,400), ctx=canvas.getContext('2d');
  ctx.fillStyle=paper;ctx.fillRect(0,0,600,400);
  return {canvas,ctx};
}
function rect(ctx,x,y,w,h,color='#111') {ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
function colorCount(canvas,predicate) {
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let count=0;for(let i=0;i<pixels.length;i+=4)if(predicate(pixels[i],pixels[i+1],pixels[i+2]))count++;
  return count;
}
test('empty, tiny, malformed and whole-page regions use the visible fallback',()=>{
  const {canvas}=page();
  for(const box of [null,[1,2,3],[100,100,700,800],[0,0,1000,1000],[100,100,110,800],[900,100,200,800],[0,0,NaN,900],[-1,0,500,500],[null,0,500,500],[false,0,500,500],['',0,500,500]]) {
    assert.equal(cropDiagram(canvas,box,createCanvas),null,JSON.stringify(box));
  }
  const photo=page('#b8b8b8');
  assert.equal(cropDiagram(photo.canvas,[100,100,700,800],createCanvas),null);
});
test('loose rectangles tighten all four sides and retain a white print margin',()=>{
  const {canvas,ctx}=page();rect(ctx,220,160,100,80);
  const crop=cropDiagram(canvas,[100,100,800,900],createCanvas);
  assert.ok(crop);assert.equal(crop.width,232);assert.equal(crop.height,192);
  assert.deepEqual([...crop.getContext('2d').getImageData(0,0,1,1).data],[255,255,255,255]);
});
test('a label crossing the AI rectangle is expanded back in before tightening',()=>{
  const {canvas,ctx}=page();rect(ctx,210,140,110,80);rect(ctx,365,160,55,10,'#c00000');
  const crop=cropDiagram(canvas,[300,320,650,620],createCanvas);
  assert.ok(crop);
  // The rectangle ends at x=372; retaining only its safety margin would keep
  // fewer than half these red label pixels. The expanded crop keeps them all.
  assert.equal(crop.width,452); // x=210 through the complete label at x=420, doubled + frame
  // Smoothing blends the outermost colored pixels with the white background.
  assert.ok(colorCount(crop,(r,g,b)=>r>120&&g<40&&b<40)>=55*10*3.4);
});
test('expansion does not stop between the separate letters of a clipped label',()=>{
  for(const gap of [2,3,4,5,6]) {
    const {canvas,ctx}=page();rect(ctx,210,140,110,80);
    let right=0;
    for(let x=365;x<420;x+=3+gap){rect(ctx,x,160,3,10,'#c00000');right=x+3;}
    const crop=cropDiagram(canvas,[300,320,650,620],createCanvas);
    assert.ok(crop);assert.equal(crop.width,(right-210)*2+32,'letter gap '+gap);
  }
});
test('complete left-edge labels survive, while nearby unrelated print stays outside',()=>{
  for(const gap of [3,6]) {
    const {canvas,ctx}=page();rect(ctx,280,140,110,80);
    for(let x=185;x<240;x+=3+gap)rect(ctx,x,160,3,10,'#c00000');
    // Separate print on the same line, well outside the label's whitespace.
    for(let x=120;x<150;x+=6)rect(ctx,x,160,2,10,'#000080');
    const crop=cropDiagram(canvas,[300,385,650,680],createCanvas);
    assert.ok(crop);assert.equal(crop.width,(390-185)*2+32);
    assert.equal(colorCount(crop,(r,g,b)=>b>70&&r<30&&g<30),0);
  }
});
test('right-edge expansion stops before print separated by clear whitespace',()=>{
  const {canvas,ctx}=page();rect(ctx,210,140,110,80);
  for(let x=365;x<420;x+=9)rect(ctx,x,160,3,10,'#c00000');
  for(let x=450;x<510;x+=6)rect(ctx,x,160,2,10,'#000080');
  const crop=cropDiagram(canvas,[300,320,650,620],createCanvas);
  assert.ok(crop);assert.equal(crop.width,(422-210)*2+32);
  assert.equal(colorCount(crop,(r,g,b)=>b>70&&r<30&&g<30),0);
});
test('separate question wording above a figure is removed',()=>{
  const {canvas,ctx}=page();rect(ctx,200,155,160,70);
  for(let x=170;x<410;x+=6)rect(ctx,x,108,2,6,'#000080');
  const crop=cropDiagram(canvas,[250,250,650,750],createCanvas);
  assert.ok(crop);
  assert.equal(colorCount(crop,(r,g,b)=>b>70&&r<30&&g<30),0);
  assert.ok(crop.width<380&&crop.height<190);
});
test('a framed table and its outer rules remain intact',()=>{
  const {canvas,ctx}=page();
  for(const y of [130,160,190,220])rect(ctx,180,y,210,2);
  rect(ctx,180,130,1,92);rect(ctx,389,130,1,92);
  for(const y of [140,170,200])for(let x=195;x<375;x+=6)rect(ctx,x,y,2,6);
  const crop=cropDiagram(canvas,[250,200,650,800],createCanvas);
  assert.ok(crop);assert.equal(crop.width,452);assert.equal(crop.height,216);
});
test('photographed paper and isolated specks do not defeat tightening',()=>{
  const {canvas,ctx}=page('#b8b8b8');rect(ctx,220,160,100,80);
  rect(ctx,80,70,1,1);rect(ctx,500,290,1,1);
  const crop=cropDiagram(canvas,[100,100,800,900],createCanvas);
  assert.ok(crop);assert.equal(crop.width,232);assert.equal(crop.height,192);
});
