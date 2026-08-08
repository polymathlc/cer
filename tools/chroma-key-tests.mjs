// Regression tests for the CHROMA SCREEN path (_screenKeyOut / _screenBack) —
// the generated sprite is drawn against a named flat screen and that one colour
// is keyed out. Run with: node tools/chroma-key-tests.mjs
//
// It loads the REAL functions out of app.js and runs them over synthetic
// pictures on a small canvas shim. The cases are the ones that defeated the
// flood-fill knock-out entirely (a torn pack, an almost-black monster, an
// almost-white effect), plus the refusals that keep the keyer safe.
import fs from 'fs';
const src = fs.readFileSync('/home/user/cer/app.js','utf8');
const grab = sig => { const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const consts = src.slice(src.indexOf('const TCG_SCREEN_HI'), src.indexOf('function _screenDn'))
  + '\n' + src.slice(src.indexOf('const TCG_SCREEN_RING_MIN'), src.indexOf('async function _screenKeyOut'));
const screens = src.slice(src.indexOf('const TCG_SCREENS = {'), src.indexOf('function tcgScreenForElement'));
// The MANUAL background remover (v1.277.0) — the 🧼 button. Same file, same
// functions, so the tests below run the shipping code.
const plate = src.slice(src.indexOf('const TCG_PLATE_RING_MIN'), src.indexOf('// Remove that colour.'));
const pieces = [screens, consts, plate, grab('function _screenDn'), grab('async function _screenKeyOut'),
  grab('async function _screenBack'), grab('function _tcgPlateColour'), grab('function _tcgEnclosedPlateColour'),
  grab('async function _tcgKeyPlate')].join('\n');   // _screenStillThere + its constant ride along in `consts`
const store = new Map(); let seq = 0;
const mk = (w,h,px) => { const u='buf:'+(++seq); store.set(u,{w,h,px}); return u; };
class ImageData { constructor(px,w,h){this.data=px;this.width=w;this.height=h;} }
const canvas = () => { let W=0,H=0,PX=null; return {
  set width(v){W=v;PX=new Uint8ClampedArray(v*H*4);}, get width(){return W;},
  set height(v){H=v;PX=new Uint8ClampedArray(W*v*4);}, get height(){return H;},
  getContext(){ return { drawImage:img=>{ const b=store.get(img.src);
      // source-over, like a real canvas — the shim used to overwrite
      for(let i=0;i<W*H;i++){ const o=i*4, sa=b.px[o+3]/255;
        if(sa<=0) continue;
        if(sa>=1){ PX[o]=b.px[o];PX[o+1]=b.px[o+1];PX[o+2]=b.px[o+2];PX[o+3]=255; continue; }
        const da=PX[o+3]/255, oa=sa+da*(1-sa);
        for(let k=0;k<3;k++) PX[o+k]=Math.round((b.px[o+k]*sa+PX[o+k]*da*(1-sa))/(oa||1));
        PX[o+3]=Math.round(oa*255); } },
    getImageData:()=>new ImageData(PX,W,H), putImageData:d=>PX.set(d.data),
    fillRect(x,y,w,h){ for(let i=0;i<W*H;i++){PX[i*4]=FILL[0];PX[i*4+1]=FILL[1];PX[i*4+2]=FILL[2];PX[i*4+3]=255;} },
    set fillStyle(v){ FILL = v==='#FF00FF'?[255,0,255]: v==='#00FF00'?[0,255,0]:[0,0,255]; } }; },
  toDataURL(){ return mk(W,H,PX.slice()); } }; };
let FILL=[255,0,255];
global.document = { createElement: canvas };
const _loadImageEl = async u => { const b=store.get(u); return {naturalWidth:b.w,naturalHeight:b.h,width:b.w,height:b.h,src:u}; };
const M = new Function('_loadImageEl','ImageData','console', pieces + '\nreturn {_screenKeyOut,_screenBack,_screenDn,TCG_SCREENS,_tcgPlateColour,_tcgKeyPlate,_screenStillThere};')(_loadImageEl, ImageData, console);

const S = 220;
const paint = fn => { const px = new Uint8ClampedArray(S*S*4);
  for (let y=0;y<S;y++) for (let x=0;x<S;x++){ const o=(y*S+x)*4, c=fn(x,y);
    if(!c){px[o+3]=0;continue;} px[o]=c[0];px[o+1]=c[1];px[o+2]=c[2];px[o+3]=255; }
  return mk(S,S,px); };
const scoreOf = (url, tagOf) => { const b=store.get(url), keep={}, tot={};
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){ const t=tagOf(x,y); if(!t) continue;
    tot[t]=(tot[t]||0)+1; if(b.px[(y*S+x)*4+3]>128) keep[t]=(keep[t]||0)+1; }
  const o={}; Object.keys(tot).forEach(t=>o[t]=Math.round((keep[t]||0)/tot[t]*100)); return o; };

let pass=0, fail=0;
const check = (name, got, want) => { const bad=[];
  Object.keys(want).forEach(t=>{ const v=got[t]==null?-1:got[t];
    if(want[t]==='keep'&&v<90) bad.push(`${t} kept ${v}% (want >=90)`);
    if(want[t]==='cut'&&v>8) bad.push(`${t} kept ${v}% (want <=8)`); });
  const state=Object.entries(got).map(([k,v])=>`${k} ${v}%`).join(', ');
  if(bad.length){fail++;console.log(`FAIL  ${name.padEnd(26)} ${state}\n        ${bad.join('\n        ')}`);}
  else {pass++;console.log(`pass  ${name.padEnd(26)} ${state}`);} };

// 1. The reported bug, shot on a magenta screen: the SAME torn pack, whose
//    interior the flood fill ate. The screen shows through the tear and must
//    be keyed; the navy panel is not magenta, so it cannot be.
{
  const inPack=(x,y)=>x>=64&&x<156&&y>=26&&y<194, inPanel=(x,y)=>x>=78&&x<142&&y>=52&&y<168;
  const emblem=(x,y)=>Math.hypot(x-110,y-110)<30, tear=(x,y)=>x>=104&&x<116&&y>=26&&y<56;
  const u = paint((x,y)=> tear(x,y)?[255,0,255]
    : inPanel(x,y)&&emblem(x,y)?[196,150,58] : inPanel(x,y)?[16,24,52]
    : inPack(x,y)?[214,168,66] : [255,0,255]);
  const out = await M._screenKeyOut(u,'magenta');
  check('torn-pack-on-screen', scoreOf(out, (x,y)=> tear(x,y)?'tear'
    : inPanel(x,y)&&!emblem(x,y)?'panel' : inPanel(x,y)?'emblem' : inPack(x,y)?'foil':'screen'),
    { panel:'keep', emblem:'keep', foil:'keep', screen:'cut', tear:'cut' });
}
// 2. A shadow monster, almost black — defeated the cut entirely.
{
  const inM=(x,y)=>Math.hypot(x-110,y-110)<62;
  const u = paint((x,y)=> inM(x,y)?[18,16,26]:[255,0,255]);
  check('shadow-monster-on-screen', scoreOf(await M._screenKeyOut(u,'magenta'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'monster':Math.hypot(x-110,y-110)>70?'screen':null),
    { monster:'keep', screen:'cut' });
}
// 3. A white frost effect — also defeated the cut.
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[232,244,252]:[255,0,255]);
  check('white-frost-on-screen', scoreOf(await M._screenKeyOut(u,'magenta'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'effect':Math.hypot(x-110,y-110)>70?'screen':null),
    { effect:'keep', screen:'cut' });
}
// 4. An UNEVENLY LIT screen — the commonest way a model misses "flat".
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[214,168,66]
    : [255-(y/S*90|0), 0, 255-(x/S*70|0)]);
  check('uneven-screen', scoreOf(await M._screenKeyOut(u,'magenta'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'sprite':Math.hypot(x-110,y-110)>70?'screen':null),
    { sprite:'keep', screen:'cut' });
}
// 5. A RED subject on a magenta screen — red must not be read as magenta.
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[228,26,24]:[255,0,255]);
  check('red-subject-on-magenta', scoreOf(await M._screenKeyOut(u,'magenta'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'red':Math.hypot(x-110,y-110)>70?'screen':null),
    { red:'keep', screen:'cut' });
}
// 6. The model IGNORED the brief and painted a chequerboard — the keyer must
//    decline (return null) so the caller falls back to the knock-out.
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[214,168,66]
    : (((x>>3)+(y>>3))%2?[242,242,242]:[217,217,217]));
  const out = await M._screenKeyOut(u,'magenta');
  if (out === null) { pass++; console.log('pass  no-screen-declines          returned null -> falls back to the knock-out'); }
  else { fail++; console.log('FAIL  no-screen-declines          keyed something it should not have'); }
}
// 7. A green effect on a BLUE screen (the flora/venom routing).
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[46,190,74]:[0,0,255]);
  check('green-effect-blue-screen', scoreOf(await M._screenKeyOut(u,'blue'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'leaf':Math.hypot(x-110,y-110)>70?'screen':null),
    { leaf:'keep', screen:'cut' });
}
// 8. A violet psychic monster on a GREEN screen (the psychic/cosmic routing).
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<62?[168,64,220]:[0,255,0]);
  check('violet-on-green-screen', scoreOf(await M._screenKeyOut(u,'green'),
    (x,y)=>Math.hypot(x-110,y-110)<58?'psychic':Math.hypot(x-110,y-110)>70?'screen':null),
    { psychic:'keep', screen:'cut' });
}
// 9. Round trip: key it, then put it back on the screen for the next frame.
{
  const inM=(x,y)=>Math.hypot(x-110,y-110)<62;
  const u = paint((x,y)=> inM(x,y)?[214,168,66]:[255,0,255]);
  const keyed = await M._screenKeyOut(u,'magenta');
  const backed = await M._screenBack(keyed,'magenta');
  const b = store.get(backed); let opaque=0, magentaCorners=0;
  for(let i=3;i<b.px.length;i+=4) if(b.px[i]>200) opaque++;
  const c=(x,y)=>{const o=(y*S+x)*4; return b.px[o]>200&&b.px[o+1]<40&&b.px[o+2]>200;};
  [[2,2],[S-3,2],[2,S-3],[S-3,S-3]].forEach(([x,y])=>{ if(c(x,y)) magentaCorners++; });
  if (opaque === S*S && magentaCorners === 4) { pass++; console.log('pass  chain-round-trip            fully opaque, all 4 corners back on the screen'); }
  else { fail++; console.log(`FAIL  chain-round-trip            opaque ${opaque}/${S*S}, magenta corners ${magentaCorners}/4`); }
}
// 10. The model painted the KEY COLOUR INSIDE THE SUBJECT (a magenta gem set
//     in the middle of the sprite). Keying it would punch a hole, so a strict
//     slot must REFUSE and fall back to the cautious knock-out.
{
  const inM=(x,y)=>Math.hypot(x-110,y-110)<78;
  const gem=(x,y)=>Math.hypot(x-110,y-110)<30;
  const u = paint((x,y)=> gem(x,y)?[250,10,246] : inM(x,y)?[228,206,180] : [255,0,255]);
  const out = await M._screenKeyOut(u,'magenta',true);
  if (out === null) { pass++; console.log('pass  key-colour-inside-subject    refused -> falls back to the knock-out'); }
  else { fail++; console.log('FAIL  key-colour-inside-subject    keyed it and holed the subject'); }
}
// 10b. KNOWN LIMIT, reported not asserted: key colour on the subject's OUTER
//      edge is contiguous with the wall, so no colour test can separate them.
//      The defences are the per-element key routing (magenta is never used for
//      the violet/pink elements) and the prompt forbidding the key colour on
//      the subject — not the keyer.
{
  const inM=(x,y)=>Math.hypot(x-110,y-110)<70;
  const robe=(x,y)=>inM(x,y)&&y>108;
  const u = paint((x,y)=> robe(x,y)?[250,10,246] : inM(x,y)?[228,206,180] : [255,0,255]);
  const out = await M._screenKeyOut(u,'magenta',true);
  console.log('note  key-colour-on-outline       ' + (out === null ? 'refused' : 'keyed (known limit — routing + prompt are the defence)'));
}
// 11. The hue is in the ART but there is no wall (a magenta nebula on a dark
//     plate). The ring test must refuse: containing the colour is not the same
//     as being shot against it.
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<80?[236,20,230]:[12,14,30]);
  const out = await M._screenKeyOut(u,'magenta',true);
  if (out === null) { pass++; console.log('pass  hue-in-art-no-wall          refused (border ring is not screen)'); }
  else { fail++; console.log('FAIL  hue-in-art-no-wall          keyed a subject that merely contains the hue'); }
}
// 12. THE DUEL ZONE WALL (v1.277.0). A wide effect fills the frame edge to
//     edge by design — a wall of water rising from the bottom leaves only the
//     TOP edge on the screen. The whole-ring test refuses that at ~50%, which
//     is exactly why the generated frames came back with a magenta band still
//     across the top. A `wide` slot relaxes the ring but still demands one
//     WHOLE edge of clean screen, so it is real evidence of a wall.
{
  const wave = (x,y) => y > 60 + Math.sin(x/14)*18;      // fills left-right, open at the top
  const u = paint((x,y)=> wave(x,y) ? [30,120+((x*7)%80),190] : [255,0,255]);
  const strictOut = await M._screenKeyOut(u,'magenta',false);          // the old behaviour
  const wideOut   = await M._screenKeyOut(u,'magenta',false,true);     // wide
  if (strictOut === null && wideOut !== null) {
    const sc = scoreOf(wideOut, (x,y)=> wave(x,y) ? 'wall' : 'screen');
    check('duel-zone-wall', sc, { wall:'keep', screen:'cut' });
  } else if (wideOut === null) {
    fail++; console.log('FAIL  duel-zone-wall              a wide slot still refused — the magenta band survives');
  } else {
    fail++; console.log('FAIL  duel-zone-wall              the un-widened call should have refused, so the flag does nothing');
  }
}
// 13. …and the relaxation must not become a way in for a picture that merely
//     CONTAINS the hue. No clean edge → still refused, wide or not.
{
  const u = paint((x,y)=> Math.hypot(x-110,y-110)<80?[236,20,230]:[12,14,30]);
  const out = await M._screenKeyOut(u,'magenta',false,true);
  if (out === null) { pass++; console.log('pass  wide-hue-in-art-no-wall     refused (no clean edge of screen anywhere)'); }
  else { fail++; console.log('FAIL  wide-hue-in-art-no-wall     wide keyed a subject that merely contains the hue'); }
}
// 19. THE RING (v1.280.0). A metal ring with the screen showing through the
//     middle. The interior is REAL background — the wall, seen through a hole —
//     but it does not touch the border, so the strict "enclosed screen" guard
//     counted it as key colour painted onto the subject and refused the whole
//     key. The artifact shipped with a solid magenta disc inside it.
{
  const R = 92, r = 52, cx = 110, cy = 110;
  const d = (x,y) => Math.hypot(x-cx, y-cy);
  const ringPx = (x,y) => d(x,y) <= R && d(x,y) >= r;
  const holePx = (x,y) => d(x,y) < r;
  const u = paint((x,y)=> ringPx(x,y) ? [150,120,80] : [255,0,255]);
  const out = await M._screenKeyOut(u,'magenta',true);
  if (out === null) { fail++; console.log('FAIL  ring-hole-keeps-screen       refused — the hole keeps its magenta disc'); }
  else check('ring-hole-keeps-screen', scoreOf(out, (x,y)=> ringPx(x,y) ? 'ring' : holePx(x,y) ? 'hole' : 'outside'),
    { ring:'keep', hole:'cut', outside:'cut' });
}

// 19b. The paired negative, which pins that the rule is THINNESS and not merely
//      "is enclosed": the same disc inside a THICK body. That is a patch of key
//      colour sitting deep in a mass — paint, not an opening — and it must
//      still be refused however flat and pure its colour is.
{
  const d = (x,y) => Math.hypot(x-110,y-110);
  const u = paint((x,y)=> (d(x,y) <= 96 && d(x,y) >= 24) ? [150,120,80] : d(x,y) < 24 ? [255,0,255] : [255,0,255]);
  const out = await M._screenKeyOut(u,'magenta',true);
  if (out === null) { pass++; console.log('pass  thick-body-patch-refused    a patch deep inside a mass is paint, not a hole'); }
  else { fail++; console.log('FAIL  thick-body-patch-refused    keyed a patch buried in the subject'); }
}

// ---- the 🧼 manual remover -------------------------------------------------
// 14. The exact frame from the report: a wall of water with a band of the
//     magenta screen still across the top. The button finds the flat colour the
//     border is made of and takes out that colour and nothing else.
{
  const wave = (x,y) => y > 60 + Math.sin(x/14)*18;
  const u = paint((x,y)=> wave(x,y) ? [30,120+((x*7)%80),190] : [255,0,255]);
  const got = await M._tcgKeyPlate(u);
  if (!got) { fail++; console.log('FAIL  plate-remove-magenta-band    found no plate to remove'); }
  else {
    const sc = scoreOf(got.url, (x,y)=> wave(x,y) ? 'wall' : 'plate');
    check('plate-remove-magenta-band', sc, { wall:'keep', plate:'cut' });
  }
}
// 15. It is not limited to the three named screens — the point of the button is
//     that the admin can SEE the colour that sticks out, whatever it is.
{
  const blob = (x,y) => Math.hypot(x-110,y-110) < 70;
  const u = paint((x,y)=> blob(x,y) ? [250,230,120] : [17,17,17]);   // a near-black plate
  const got = await M._tcgKeyPlate(u);
  if (!got) { fail++; console.log('FAIL  plate-remove-black-plate     found no plate to remove'); }
  else check('plate-remove-black-plate', scoreOf(got.url, (x,y)=> blob(x,y) ? 'art' : 'plate'), { art:'keep', plate:'cut' });
}
// 16. A painted SCENE has no flat border, so there is nothing to remove and the
//     button must say so rather than eating a quarter of the picture.
{
  const u = paint((x,y)=> [40+((x*3)%180), 30+((y*5)%160), 90+((x*y)%120)]);
  const got = await M._tcgKeyPlate(u);
  if (got === null) { pass++; console.log('pass  plate-none-on-a-scene       nothing flat on the border -> nothing removed'); }
  else { fail++; console.log('FAIL  plate-none-on-a-scene       removed a colour from a painted scene'); }
}
// 17. …and a picture that is ALREADY cut out reports nothing to do rather than
//     nibbling its edges — the button is pressed more than once.
{
  const blob = (x,y) => Math.hypot(x-110,y-110) < 70;
  const u = paint((x,y)=> blob(x,y) ? [250,230,120] : null);
  const got = await M._tcgKeyPlate(u);
  if (got === null || got.cut === 0) { pass++; console.log('pass  plate-already-cut-out       nothing removed on a second press'); }
  else { fail++; console.log('FAIL  plate-already-cut-out       cut ' + got.cut + ' more pixels from a finished sprite'); }
}
// 18. The one failure that looks tidy and has destroyed the artwork: the plate
//     colour IS the subject. `kept` is what tcgCleanSlotBg guards on, so it has
//     to fall below TCG_BG_KEEP_MIN here.
{
  const u = paint((x,y)=> [255,0,255]);        // the whole frame is the plate
  const got = await M._tcgKeyPlate(u);
  if (got && got.kept < 0.62) { pass++; console.log('pass  plate-would-hollow-it       kept ' + Math.round(got.kept*100) + '% -> refused by the caller'); }
  else { fail++; console.log('FAIL  plate-would-hollow-it       kept ' + (got ? Math.round(got.kept*100) : '—') + '%, the guard would not fire'); }
}
// 20. …and the 🧼 button could not rescue it either. By the time the admin
//     presses it the OUTSIDE is already transparent, so the border ring the
//     plate detector samples is empty and it finds no plate at all — while the
//     magenta the admin is actually looking at sits in the middle of the frame.
{
  const R = 92, r = 52, cx = 110, cy = 110;
  const d = (x,y) => Math.hypot(x-cx, y-cy);
  const ringPx = (x,y) => d(x,y) <= R && d(x,y) >= r;
  const holePx = (x,y) => d(x,y) < r;
  const u = paint((x,y)=> ringPx(x,y) ? [150,120,80] : holePx(x,y) ? [255,0,255] : null);
  const got = await M._tcgKeyPlate(u);
  if (!got || !got.cut) { fail++; console.log('FAIL  plate-enclosed-on-cut-sprite the 🧼 button found nothing to remove'); }
  else check('plate-enclosed-on-cut-sprite', scoreOf(got.url, (x,y)=> ringPx(x,y) ? 'ring' : holePx(x,y) ? 'hole' : null),
    { ring:'keep', hole:'cut' });
}
// 21. The VERIFIER could never see this either: it only ever inspected the
//     border ring and the corners, so a disc walled in behind a ring passed as
//     clean and was saved. The screen is a colour we chose and the subject is
//     briefed never to contain it, so "is any of it still here, anywhere?" is
//     the honest question.
{
  const R = 92, r = 52, cx = 110, cy = 110;
  const d = (x,y) => Math.hypot(x-cx, y-cy);
  const dirty = paint((x,y)=> (d(x,y) <= R && d(x,y) >= r) ? [150,120,80] : d(x,y) < r ? [255,0,255] : null);
  const clean = paint((x,y)=> (d(x,y) <= R && d(x,y) >= r) ? [150,120,80] : null);
  const a = await M._screenStillThere(dirty,'magenta');
  const b = await M._screenStillThere(clean,'magenta');
  if (a && !b) { pass++; console.log('pass  verifier-sees-walled-in-plate ' + a); }
  else { fail++; console.log('FAIL  verifier-sees-walled-in-plate dirty=' + a + ' clean=' + b); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
