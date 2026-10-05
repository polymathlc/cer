import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {cropDiagram,cropDiagramEx} from '../crop.js';

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
// v1.425.0 — the reported crop: a bordered table filed with the stem above it
// and the lettered parts, marks and answer lines below it. The four-rule guard
// used to stand down on the whole crop because the TABLE had four rules.
test('stem, parts, marks and answer lines come off a bordered table',()=>{
  const canvas=createCanvas(700,1000), ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,700,1000);
  const prose=(x,y,w,h)=>{for(let xx=x;xx<x+w;xx+=6)rect(ctx,xx,y,2,h);};
  prose(30,40,640,10);rect(ctx,80,85,600,2);prose(30,130,600,10);
  for(let k=0;k<=4;k++)rect(ctx,100,160+k*35,500,2);
  for(const x of [100,220,350,480,598])rect(ctx,x,160,2,142);
  for(let k=0;k<4;k++)prose(110,172+k*35,480,8);
  prose(30,320,620,10);prose(70,345,120,10);prose(640,345,25,10);rect(ctx,70,395,600,2);prose(70,420,120,10);prose(640,420,25,10);
  const crop=cropDiagram(canvas,[40,40,430,980],createCanvas);
  assert.ok(crop);
  // The table is 500×142; doubled (≤2× upscale) plus the white frame.
  const scale=Math.min(2,1600/500), pad=Math.round(Math.max(16,Math.round(500*scale)*0.035));
  assert.ok(Math.abs(crop.width-(Math.round(500*scale)+pad*2))<=6,'width '+crop.width);
  assert.ok(Math.abs(crop.height-(Math.round(142*scale)+pad*2))<=6,'height '+crop.height);
});
// v1.426.0 — figure furniture is never wording. The (1) (2) (3) (4) under four
// picture options read as a sentence and were cut off, with the stem above
// them; the stem must still go.
test('the labels under picture options survive; the stem above them goes',()=>{
  for(const gap of [5,12,20]) {
    const canvas=createCanvas(700,1000), ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,700,1000);
    const prose=(x,y,w,h)=>{for(let xx=x;xx<x+w;xx+=6)rect(ctx,xx,y,2,h);};
    prose(30,80,620,10);
    const xs=[90,250,410,570];
    for(const x of xs)rect(ctx,x,130,80,80);
    for(const x of xs)prose(x+28,210+gap,24,10);
    const crop=cropDiagramEx(canvas,[75,40,250,980],createCanvas);
    assert.ok(crop,'gap '+gap);
    assert.ok(crop.rect.y>=90,'the stem stayed (gap '+gap+', y '+crop.rect.y+')');
    assert.ok(crop.rect.y+crop.rect.h>=220+gap,'the option labels were cut off (gap '+gap+')');
  }
});
// …and a table ruled with horizontal lines only, under a drawing in the same
// crop, is a body of its own rather than a pile of answer lines to eat.
test('a horizontally-ruled table under a drawing is kept whole',()=>{
  const canvas=createCanvas(700,1000), ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,700,1000);
  const prose=(x,y,w,h)=>{for(let xx=x;xx<x+w;xx+=6)rect(ctx,xx,y,2,h);};
  rect(ctx,250,110,200,100);
  for(let k=0;k<=4;k++)rect(ctx,100,240+k*40,500,2);
  for(let k=0;k<4;k++)prose(110,256+k*40,480,8);
  const crop=cropDiagramEx(canvas,[110,40,402,960],createCanvas);
  assert.ok(crop);
  assert.ok(crop.rect.y+crop.rect.h>=400,'the table under the drawing was eaten');
});
test('the question\'s typed wording is listed for the clean-up pass, clipped',async()=>{
  const {cropWordingOf,refinePrompt}=await import('../crop.js');
  const w=cropWordingOf([{type:'text',text:'The table shows <b>three</b> substances.'},{type:'image'},
    {type:' MCQ ',question:'Which of these is a liquid at room temperature?',options:['solid',{text:'liquid'},'(3) water vapour in air']}]);
  // An MCQ lends its STEM, never its options: those are what a picture
  // option's labels and a table's cells say, and listed they read as text to cut.
  assert.equal(w,'- The table shows three substances.\n- Which of these is a liquid at room temperature?');
  assert.doesNotMatch(w,/solid|water vapour/);
  // Fewer than three words is a label, not a sentence.
  assert.equal(cropWordingOf([{type:'text',text:'(a)'},{type:'text',text:'Substance 1'},{type:'part',content:'(i) Substance 1'}]),'- (i) Substance 1');
  assert.ok(cropWordingOf([{type:'text',text:'word '.repeat(1000)}]).length<=1600);
  // A stem longer than the whole budget is clipped on a word, and the part
  // line printed under the table — the one that ends up in a crop — still fits.
  const long=cropWordingOf([{type:'text',text:'The table shows the mass of each substance '.repeat(60)},{type:'text',text:'(a) State what happens to the water.'}]);
  assert.ok(long.length<=1600,'over budget: '+long.length);
  assert.match(long,/…\n- \(a\) State what happens to the water\.$/);
  assert.match(refinePrompt(w),/ALREADY TYPED in the question/);
  assert.doesNotMatch(refinePrompt(''),/ALREADY TYPED/);
});
test('the clean-up keeps a figure\'s own words even when the question repeats them',async()=>{
  const {refinePrompt}=await import('../crop.js');
  const p=refinePrompt('- (i) Substance 1');
  assert.match(p,/sits OUTSIDE the figure is stray text/);
  assert.match(p,/INSIDE the figure/);
  assert.match(p,/belongs to the figure even if the same word is in the list above: keep it/);
  assert.match(p,/row or column heading, a table cell/);
  assert.match(p,/\(A\) \(B\) \(C\) \(D\) label of a picture option/);
  assert.doesNotMatch(p,/none of them may stay in the picture/,'the old blanket rule cut table labels off');
});
// The clean-up's rectangle is drawn on the CROP. It is cut from the PAGE and
// measured there: a cut that slices into the figure is refused, and the kept
// one carries its OWN measurements and ONE white frame.
function tablePage() {
  const canvas=createCanvas(700,700), ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,700,700);
  rect(ctx,150,60,400,40);                                     // a block above, then a clear gap
  for(const y of [200,260,320,380])rect(ctx,150,y,400,4);      // a bordered table: four rules…
  for(const x of [150,250,350,450,546])rect(ctx,x,200,4,184);  // …and five verticals, cells empty
  return canvas;
}
test('subCrop cuts the clean-up\'s box from the PAGE, re-measures it, and refuses a cut through the figure',async()=>{
  const {cropDiagramEx,subCrop}=await import('../crop.js');
  const page=tablePage();
  const made=cropDiagramEx(page,[60,190,580,820],createCanvas);
  assert.ok(made&&made.scale>=1&&made.pad>=16&&made.thr>0,'the crop carries what maps it back to the page');
  assert.ok(made.rect.y<80&&made.rect.y+made.rect.h>=380,'the first cut holds the block and the table');
  assert.deepEqual(made.measure.clipped,[]);
  const CW=made.canvas.width, CH=made.canvas.height;
  const onCrop=(y0,y1)=>[Math.round((made.pad+(y0-made.rect.y)*made.scale)/CH*1000),Math.round(made.pad/CW*1000),
    Math.round((made.pad+(y1-made.rect.y)*made.scale)/CH*1000),Math.round((CW-made.pad)/CW*1000)];
  assert.equal(subCrop(made,[0,0,1000,1000],createCanvas,page),null,'the whole image is not a cut');
  assert.equal(subCrop(made,[100,100,150,900],createCanvas,page),null,'a sliver is not trusted');
  assert.equal(subCrop(made,onCrop(200,384),createCanvas),null,'without the page there is nothing honest to measure');
  // Removing the block above the gap: kept, smaller, single frame, its own measurements.
  const kept=subCrop(made,onCrop(200,384),createCanvas,page);
  assert.ok(kept&&kept.refined,'a clean-up that only removes what sits above a clear gap is kept');
  assert.ok(kept.rect.y>110&&kept.rect.y<=200,'the cut starts below the block: '+kept.rect.y);
  assert.ok(kept.rect.y>=made.rect.y&&kept.rect.y+kept.rect.h<=made.rect.y+made.rect.h,'never past the first cut');
  assert.ok(kept.canvas.height<made.canvas.height&&kept.pageShare<made.pageShare);
  assert.notEqual(kept.measure,made.measure,'the measurements are the new rectangle\'s own');
  assert.deepEqual(kept.measure.clipped,[]);
  assert.equal(kept.pad,Math.round(Math.max(16,Math.max(Math.round(kept.rect.w*kept.scale),Math.round(kept.rect.h*kept.scale))*0.035)));
  assert.deepEqual([...kept.canvas.getContext('2d').getImageData(Math.floor(kept.pad/2),Math.floor(kept.pad/2),1,1).data],[255,255,255,255]);
  // Slicing the table in half leaves its borders running off the bottom: refused.
  assert.equal(subCrop(made,onCrop(200,290),createCanvas,page),null,'a clean-up that cuts the table in half is refused');
});
