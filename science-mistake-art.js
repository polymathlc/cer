// Original, self-contained artwork for the ten 🐾 MISTAKE ANIMALS — the
// familiar habits behind a wrong answer (rushed it, repeated the question,
// stopped halfway, …). It is the sister of science-coach-art.js and it keeps
// that file's two rules: every interpolated value is selected from this fixed
// cast, so a caller-provided id never becomes SVG markup; and the animation
// hooks are CLASSES ONLY (sc-avatar-float / -blink / -hand / -spark), so the
// same stylesheet that moves the Science Sidekicks moves these, and the same
// motion switch pauses both. Nothing here is fetched, no icon font, no library.
//
// The ids are the TAXONOMY's ids — MISTAKE_ANIMALS in app.js, shared byte for
// byte with polymathlc/anskey and polymathlc/scan — and this file only ever
// draws an id it knows. An unknown id draws NOTHING rather than a stand-in:
// a rabbit drawn beside a lesson about the parrot teaches the wrong animal.
export const MISTAKE_ANIMAL_ART_IDS = Object.freeze([
  'rabbit', 'parrot', 'sloth', 'chameleon', 'octopus',
  'monkey', 'goldfish', 'fox', 'bat', 'peacock'
]);
const INK = '#29314d';
const CREAM = '#fff7df';
const CAST = Object.freeze({
  rabbit:   {fur:'#f0d9c4',shade:'#c9a58a',coat:'#f08a9b',dark:'#c25a72',shirt:'#ffe7a6',light:'#fff0ea',accent:'#ff9b6b',animal:'rabbit'},
  parrot:   {fur:'#e85d6a',shade:'#b23c4c',coat:'#4fb7d9',dark:'#2f86a8',shirt:'#ffe07a',light:'#e6f6ff',accent:'#ffc94d',animal:'parrot'},
  sloth:    {fur:'#b9a78c',shade:'#8a7458',coat:'#8fcf9d',dark:'#4f9d67',shirt:'#f6dc9a',light:'#eef7e6',accent:'#7ccba8',animal:'sloth'},
  chameleon:{fur:'#8fd36f',shade:'#5da24a',coat:'#f6c453',dark:'#c98f24',shirt:'#fff1bd',light:'#eafbe2',accent:'#ff9a7a',animal:'chameleon'},
  octopus:  {fur:'#c884d6',shade:'#9257a8',coat:'#f5a6c8',dark:'#c96f9b',shirt:'#fff3c9',light:'#f6e8fb',accent:'#77cfe0',animal:'octopus'},
  monkey:   {fur:'#a5754e',shade:'#75502f',coat:'#f5b448',dark:'#c68420',shirt:'#e9d9c1',light:'#fff1dd',accent:'#ff8d6e',animal:'monkey'},
  goldfish: {fur:'#ff9f3f',shade:'#d06b1c',coat:'#ffd24a',dark:'#d19a1c',shirt:'#fff5cf',light:'#e4f5ff',accent:'#5fc6e6',animal:'goldfish'},
  fox:      {fur:'#ef8d4c',shade:'#c25f2c',coat:'#5a4ed6',dark:'#3d33a9',shirt:'#f8e8c8',light:'#fff0e2',accent:'#ffd36b',animal:'fox'},
  bat:      {fur:'#6e6ab8',shade:'#48458c',coat:'#ffcf5e',dark:'#d19c27',shirt:'#f0ecff',light:'#ecebff',accent:'#8ee0d0',animal:'bat'},
  peacock:  {fur:'#2f9fd8',shade:'#1f6fa3',coat:'#5fd1a4',dark:'#2c9a6c',shirt:'#fff1a8',light:'#e2f4ff',accent:'#ffc94d',animal:'peacock'}
});
const path = (d,fill,extra='') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d,color=INK,width=2.8) => path(d,'none',`stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const outlined = (d,fill,width=2.8) => path(d,fill,`stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const ellipse = (cx,cy,rx,ry,fill,extra='') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circle = (cx,cy,r,fill,extra='') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const rim = (width=2.8) => `stroke="${INK}" stroke-width="${width}"`;
const star = (x,y,color,scale=1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M0-7 2-2 7 0 2 2 0 7-2 2-7 0-2-2Z',color)}</g>`;

/* The floor shadow, the soft blob behind the animal and the sparks that
   twinkle while the card is fresh — the same stage the Sidekicks stand on. */
function backdrop(c,motion) {
  return `${ellipse(89,165,57,7,INK,'opacity=".09"')}
    ${path('M34 114C15 90 26 51 56 39c28-12 48-17 73-3 27 15 38 46 21 74-14 22-37 42-64 43-24 1-38-22-52-39Z',c.light)}
    <g${motion('sc-avatar-spark')}>${star(25,70,c.accent,.9)}${star(149,42,c.coat,.8)}${circle(150,81,3,c.accent)}${circle(24,116,2.5,c.coat)}
    ${line('M28 39l4 5m-13 6 6 1',c.coat,2.6)}${line('M154 146l4 4m-14 2 1 5',c.coat,2.6)}</g>`;
}
function eyes(points,motion,size=1) {
  return `<g${motion('sc-avatar-blink')}>${points.map(([x,y]) => `${ellipse(x,y,7*size,9*size,'#fffef8')}${ellipse(x+1,y+1,3.7*size,5.5*size,INK)}${circle(x+2.1,y-1.5,1.5*size,'#fff')}`).join('')}</g>`;
}
function paw(c,x=134,y=140) {
  return `${ellipse(x,y,10,7,c.fur,rim(2.4))}${line(`M${x-3} ${y+1}v3m5-3v3`,c.shade,1.6)}`;
}
/* The prop is what makes each habit legible without a word — a stopwatch for
   the rabbit, a mirror for the parrot, a half-drawn chain for the sloth. */
function heldProp(id,c,motion,{bird=false,tentacle=false,fin=false}={}) {
  const hand = bird ? `${outlined('M124 129c9 0 20 5 19 12-1 7-11 9-19 3l-7-8Z',c.coat,2.4)}${line('M129 140l9-2m-8 6 8-3',c.dark,1.8)}`
    : tentacle ? `${line('M112 128c10 4 22 9 27 17',INK,12)}${line('M112 128c10 4 22 9 27 17',c.fur,7.5)}${circle(131,137,2,c.shade)}${circle(137,143,1.6,c.shade)}`
    : fin ? `${outlined('M118 126c9 4 18 9 22 16l-9 3c-6-5-12-9-16-13Z',c.coat,2.2)}`
    : paw(c);
  return `<g${motion('sc-avatar-hand')}>${prop(id,c)}${hand}</g>`;
}
function badge(c,x=70,y=137) {
  return `${outlined(`M${x-7} ${y-9}h14v18h-14Z`,CREAM,1.7)}${path(`M${x-3} ${y-12}h6v6h-6Z`,c.accent)}${line(`M${x-4} ${y-2}h8m-8 5h5`,c.dark,1.8)}`;
}
/* One torso shared by the five animals that stand upright in a waistcoat. */
function body(c) {
  return `${outlined('M71 98c-15 8-20 28-18 43 2 18 14 23 35 23s34-6 36-24c2-19-5-36-20-42Z',c.fur)}${ellipse(88,138,22,23,CREAM)}
    ${ellipse(69,161,13,6,c.shade,rim(2.4))}${ellipse(108,161,13,6,c.shade,rim(2.4))}${line('M65 161v3m6-3v3m32-3v3m6-3v3',CREAM,1.5)}
    ${outlined('M66 107l13 7 9 19 9-19 14-7c9 13 12 28 10 45-9 6-21 8-29 8l-4-27-4 27c-11 0-21-3-28-8-1-16 2-34 10-45Z',c.coat,2.4)}
    ${path('M96 118l16-7 6 15-18 3Z',c.dark)}${badge(c)}`;
}
function leftPaw(c) {
  return `${outlined('M59 118c-11-2-21 9-17 17 3 6 12 7 18 0l7-10Z',c.fur,2.4)}${line('M46 131l3 3m2-7 3 3',c.shade,1.7)}`;
}
function muzzle(c,motion,{red=false}={}) {
  return `${eyes([[68,70],[108,70]],motion,.86)}${outlined('M80 88c4-3 12-3 16 0-1 7-6 10-8 10s-7-3-8-10Z',INK,1.5)}
    ${line('M88 98v5m0 0c-5 4-9 2-12 0m12 0c5 4 9 2 12 0',INK,1.9)}${ellipse(56,84,5,3,red?'#e7a38c':'#ecb0a4')}${ellipse(120,84,5,3,red?'#e7a38c':'#ecb0a4')}`;
}

/* 🐇 Rushed it — ears streaming back, one foot already off the ground. */
function rabbit(c,motion) {
  return `${outlined('M60 150c-14 8-33 2-33-12 0-9 9-14 17-9-5 8 3 13 16 12Z',c.fur,2.4)}${body(c)}
    ${outlined('M62 66C36 52 28 24 41 12c8-7 18 2 17 16l4 38Zm50 0c22-16 33-44 21-54-8-6-17 3-16 17l-5 37Z',c.fur)}
    ${path('M52 24c-4 8-1 22 4 34l4-6c-3-10-5-20-8-28Zm70 0c4 8 1 22-4 34l-4-6c3-10 5-20 8-28Z','#f5b8c4')}
    ${outlined('M50 66c3-22 19-34 39-34 21 0 36 13 38 35l6 15-15 8c-6 14-18 22-29 22s-24-8-30-22l-15-8Z',c.fur)}
    ${path('M56 79l16-8c7 6 13 13 16 24 4-11 10-18 17-24l16 8-13 10c-6 13-13 21-20 22-8-1-15-9-20-22Z',CREAM)}
    ${muzzle(c,motion)}${outlined('M83 99h4v9h-4Zm5 0h4v9h-4Z','#fffef5',1.4)}${line('M58 60l10-3m34-1 10 3',c.shade,2.6)}
    ${line('M14 122l12-1m-9 8 13-2m-15 8 12 0',c.accent,2.6)}${leftPaw(c)}${heldProp('rabbit',c,motion)}`;
}
/* 🦜 Repeated the question — a parrot with a mirror, saying it right back. */
function parrot(c,motion) {
  return `${outlined('M81 137l-9 30 13-3 7 6 7-27Z',c.dark,2.5)}${line('M85 147l-2 15m8-16 1 15',c.accent,2.2)}
    ${outlined('M61 83c-14 16-17 40-10 62 6 17 23 20 39 17 24-4 35-21 31-44-3-20-17-35-32-40Z',c.fur)}${path('M69 98c-10 15-16 33-11 48 4 13 16 17 30 14 15-4 22-19 17-35l-13-26Z',c.accent)}
    ${outlined('M60 109c-21 0-33 22-20 38 5 6 11 5 16-4 3-5 9-8 11-14Z',c.coat,2.5)}${line('M43 131l7 6m-8 1 6 5m6-17 7 5',c.dark,2.3)}
    ${outlined('M56 62c0-25 16-40 38-40 22 0 36 17 36 38 0 23-17 41-39 41-23 0-35-16-35-39Z',c.fur)}${outlined('M78 26c-3-11 2-18 9-15l9 13c-1-15 8-18 12-12l4 18Z',c.coat,2.4)}
    ${path('M91 30c-17 5-22 19-20 35 3 14 17 18 28 10 14 10 26 0 27-13 1-16-14-29-35-32Z',CREAM)}${eyes([[83,57],[113,58]],motion,.96)}
    ${outlined('M93 69c9-5 24 0 23 10-1 9-12 17-20 18 4-10 6-16-3-28Z',c.accent,2.4)}${outlined('M94 81c8-3 13-2 16 0-4 7-9 11-14 14Z',c.shade,1.8)}${line('M99 76l8-1','#d4993b',1.8)}${ellipse(73,77,6,3,'#eeaca4')}
    ${outlined('M70 156v5l-8 3 4 4 11-4 8 1 2-4-8-2v-4Zm30 0v5l-5 4 3 3 8-4 10 2 2-4-10-3v-4Z',c.accent,2.2)}${badge(c,76,124)}${heldProp('parrot',c,motion,{bird:true})}`;
}
/* 🦥 Stopped halfway — hanging happily off a branch, eyes half-lidded. */
function sloth(c,motion) {
  return `${line('M14 34c40-10 100-10 152 2',INK,11)}${line('M14 34c40-10 100-10 152 2','#8c6a45',7)}${line('M40 31l2 8m38-10 1 9m44-6 2 9',c.shade,2)}
    ${outlined('M58 40c-3 20 7 30 14 38l4 22c-7 5-9 16-3 22 8 7 20 5 25-4 3-6 1-12-3-16l6-24c9-10 17-22 12-38Z',c.fur)}
    ${outlined('M52 36c-10 4-10 14-2 18l10-2Zm74 0c10 4 10 14 2 18l-10-2Z',c.fur,2.4)}${line('M46 44l4 4m-5 3 4 3m78-10-4 4m5 3-4 3',c.shade,1.9)}
    ${outlined('M60 96c-9 12-8 32 0 46 6 12 18 16 30 16 14 0 24-6 28-18 5-16 2-32-7-44Z',c.fur)}${ellipse(89,124,21,26,CREAM)}
    ${outlined('M66 106l13 8 10 18 8-18 14-8c8 13 10 28 8 42-9 6-19 8-27 8l-3-26-4 26c-10 0-19-3-26-8-1-15 2-30 7-42Z',c.coat,2.3)}${badge(c,72,139)}
    ${outlined('M56 76c0-20 14-31 33-31 20 0 34 12 34 31 0 21-14 34-34 34-19 0-33-13-33-34Z',c.fur)}
    ${path('M62 77c0-15 11-24 27-24 17 0 28 10 28 24-1 15-12 26-28 26-15 0-27-11-27-26Z',CREAM)}
    ${path('M64 66c4-7 12-7 19 1l-2 9c-6 3-11 2-17-3Zm50 0c-4-7-12-7-19 1l2 9c6 3 11 2 17-3Z',c.shade)}
    ${eyes([[73,72],[105,72]],motion,.82)}${path('M66 70c3-4 11-4 14 0v3H66Zm32 0c3-4 11-4 14 0v3H98Z',c.shade)}
    ${outlined('M84 88c3-2 8-2 11 0-1 5-4 7-5 7s-5-2-6-7Z',INK,1.4)}${line('M80 100c6 5 13 5 19 0',INK,2)}${ellipse(60,88,5,3,'#e9b7a3')}${ellipse(118,88,5,3,'#e9b7a3')}
    ${outlined('M57 118c-11-2-19 8-15 15 3 6 11 7 16 1l6-9Z',c.fur,2.3)}${line('M45 130l3 3m2-7 3 3',c.shade,1.6)}${heldProp('sloth',c,motion)}`;
}
/* 🦎 Wrong keyword — a chameleon whose skin is still changing colour. */
function chameleon(c,motion) {
  return `${line('M66 144C42 167 14 147 25 128c8-14 28-8 24 4-3 9-14 8-15 1',INK,19)}${line('M66 144C42 167 14 147 25 128c8-14 28-8 24 4-3 9-14 8-15 1',c.accent,13)}
    ${outlined('M77 98c-16 9-21 28-17 45 4 13 17 17 34 17 18 0 25-8 23-24-1-15-5-28-14-36Z',c.fur)}${path('M86 110c-7 17-8 34-2 49h14c8-16 6-34-3-49Z',c.accent)}
    ${line('M69 117l9 3m-11 9 9 3m-9 10 8 3',c.shade,4)}${outlined('M68 150l-8 11 8 3 7-5 8 3 5-5-11-10Z',c.accent,2.3)}${outlined('M103 149l-2 12 9 3 5-5 8 1 2-5-13-9Z',c.accent,2.3)}
    ${outlined('M56 64c6-22 25-32 45-25 10 4 17 15 20 27l14 14c6 7 2 18-8 21-16 5-28 13-43 12-18-1-32-17-28-49Z',c.fur)}
    ${path('M59 87c21 9 45 11 73 0-1 7-3 11-8 12-18 6-28 13-40 12-11 0-20-9-25-24Z',c.accent)}${outlined('M62 44l5-13 10 8 9-12 9 14 9-6 5 13Z',c.accent,2.2)}
    ${circle(72,60,19,c.shade,rim(2.7))}${circle(105,59,20,c.accent,rim(2.7))}${circle(72,60,14,c.fur)}${circle(105,59,14,'#ffe0b8')}${eyes([[72,60],[105,59]],motion,.98)}
    ${circle(128,80,1.8,INK)}${line('M79 90c12 7 26 7 37-1',INK,2.4)}${ellipse(69,86,6,3,'#f9b4b2','opacity=".65"')}
    ${outlined('M65 115c-14-6-24-1-25 10-1 7 4 10 9 7l7-6 12 2Z',c.fur,2.4)}${line('M44 125l5 2m-1-6 5 2',c.shade,1.8)}${heldProp('chameleon',c,motion)}`;
}
/* 🐙 Grabbed everything — eight arms, every one holding something. */
function octopus(c,motion) {
  return `${line('M52 122c-18 6-34 24-30 40',INK,12)}${line('M52 122c-18 6-34 24-30 40',c.fur,7.5)}${line('M64 132c-14 12-22 26-16 38',INK,12)}${line('M64 132c-14 12-22 26-16 38',c.fur,7.5)}
    ${line('M120 134c12 10 20 26 12 36',INK,12)}${line('M120 134c12 10 20 26 12 36',c.fur,7.5)}${line('M100 140c2 12-2 24-14 30',INK,12)}${line('M100 140c2 12-2 24-14 30',c.fur,7.5)}
    ${line('M80 142c-2 12 2 24 12 30',INK,12)}${line('M80 142c-2 12 2 24 12 30',c.fur,7.5)}${line('M132 120c16 6 26 22 18 38',INK,12)}${line('M132 120c16 6 26 22 18 38',c.fur,7.5)}
    ${circle(26,152,2,c.shade)}${circle(46,160,2,c.shade)}${circle(135,160,2,c.shade)}${circle(150,150,2,c.shade)}${circle(90,166,2,c.shade)}${circle(86,166,2,c.shade)}
    ${outlined('M50 82c0-30 18-50 40-50s40 20 40 50c0 27-12 46-40 52-28-6-40-25-40-52Z',c.fur)}${ellipse(90,118,26,14,c.shade,'opacity=".35"')}
    ${circle(70,52,4,c.shade)}${circle(110,50,4,c.shade)}${circle(90,42,3,c.shade)}${circle(60,72,3,c.shade)}${circle(120,74,3,c.shade)}
    ${eyes([[74,82],[106,82]],motion,1.05)}${line('M66 66c4-3 9-3 13-1m22 0c4-2 9-1 13 2',c.shade,2.6)}${line('M80 106c6 6 14 6 20 0',INK,2.2)}
    ${ellipse(58,96,6,3,'#f0b3c7')}${ellipse(122,96,6,3,'#f0b3c7')}${badge(c,70,122)}
    ${outlined('M22 108h8v6h-8Zm2 16h8l-1 8h-6Z',c.accent,1.5)}${outlined('M150 100h8v9h-8Z',c.coat,1.5)}${line('M156 110l2 6',c.dark,1.8)}
    ${heldProp('octopus',c,motion,{tentacle:true})}`;
}
/* 🐒 Mixed-up ideas — a monkey juggling two labels that belong apart. */
function monkey(c,motion) {
  return `${line('M60 150c-24 8-42-6-34-24 4-9 15-11 20-4',INK,11)}${line('M60 150c-24 8-42-6-34-24 4-9 15-11 20-4',c.fur,7)}${body(c)}
    ${circle(54,62,15,c.fur,rim())}${circle(122,62,15,c.fur,rim())}${circle(54,62,8,'#e7b9a1')}${circle(122,62,8,'#e7b9a1')}
    ${outlined('M50 70c-1-25 17-40 38-40 22 0 39 15 38 40 0 26-15 43-38 43-24 0-39-17-38-43Z',c.fur)}${path('M74 32l6-9 8 7 7-8 4 12Z',c.fur)}
    ${path('M56 72c3-19 16-30 32-30 17 0 30 11 32 30-2 16-14 30-32 30-17 0-30-14-32-30Z','#f2cdb0')}${path('M66 53c6-9 15-12 22-12s16 3 22 12l-6 9c-5-7-10-10-16-10s-11 3-16 10Z','#f2cdb0')}
    ${eyes([[72,68],[106,68]],motion,.9)}${line('M63 55c4-3 9-3 12-1m24 0c4-2 9-1 12 2',c.shade,2.6)}${outlined('M83 84c3-2 9-2 12 0-1 5-4 7-6 7s-5-2-6-7Z',INK,1.4)}
    ${line('M78 96c7 6 16 6 23 0',INK,2.2)}${ellipse(60,84,5,3,'#e4a08c')}${ellipse(118,84,5,3,'#e4a08c')}${leftPaw(c)}${heldProp('monkey',c,motion)}`;
}
/* 🐟 Forgot the fact — a goldfish with a thought bubble that has gone blank. */
function goldfish(c,motion) {
  return `${path('M28 78c0-4 6-6 9-3 2-5 10-5 12 0 4-3 9 0 9 4 1 6-5 9-10 8-3 3-9 3-11 0-6 1-10-4-9-9Z','#fff')}${circle(46,96,3,'#fff')}${circle(52,104,2,'#fff')}
    ${outlined('M46 118c-16 2-30 16-30 32 12-4 26-6 34-3l6-13Z',c.fur,2.4)}${line('M24 140l14-8m-9 14 14-7',c.shade,1.8)}
    ${outlined('M58 118c6-28 34-46 62-38 24 6 36 28 30 50-7 26-38 36-62 28-20-7-33-22-30-40Z',c.fur)}
    ${path('M66 122c8-18 30-30 54-22l-6 10c-16-4-31 3-38 16Z',c.coat)}${line('M84 148c12-4 24-4 36 2M76 156c14-4 30-3 44 4',c.shade,2.2)}
    ${outlined('M92 74c6-14 24-16 30-2l-4 14-20 2Z',c.coat,2.3)}${outlined('M118 150c10 4 22 2 30-8-8-2-18-1-26 4Z',c.coat,2.3)}
    ${eyes([[80,118],[110,112]],motion,1.05)}${ellipse(66,132,6,3,'#ffb9a0')}${circle(128,120,2,INK)}${line('M118 132c4 3 9 3 13-1',INK,2.2)}
    ${circle(140,96,3.5,c.accent,'opacity=".8"')}${circle(150,84,2.5,c.accent,'opacity=".8"')}${circle(146,108,2,c.accent,'opacity=".8"')}
    ${heldProp('goldfish',c,motion,{fin:true})}`;
}
/* 🦊 Reversed the logic — a fox holding a signpost the wrong way round. */
function fox(c,motion) {
  return `${outlined('M65 148C24 168 10 133 22 104c6 20 35 13 43 38Z',c.fur)}${path('M22 104c5 14 15 17 26 23l-12 5-4 11-13-7c-3-10-1-22 3-32Z',CREAM)}${body(c)}
    ${outlined('M49 65l-7-42c-1-7 4-9 9-5l28 25Zm48-20 24-26c5-5 10-2 9 5l-6 44Z',c.fur)}${path('M51 30l5 24 15-10Zm68 3-16 13 17 12Z','#8c4b48')}
    ${outlined('M47 65c4-21 21-31 40-31 20 0 38 12 42 33l8 16-18 8c-7 13-20 23-32 24-14-1-25-12-33-24l-17-8Z',c.fur)}
    ${path('M43 77l19-8c8 6 16 13 25 26 9-13 18-20 25-26l19 8-17 10c-7 13-17 23-27 25-10-2-21-14-28-26Z',CREAM)}
    ${muzzle(c,motion)}${line('M59 57l11-3m38 0 8 4',c.shade,2.8)}${leftPaw(c)}${heldProp('fox',c,motion)}`;
}
/* 🦇 Ignored the evidence — a bat with its wings over its eyes. */
function bat(c,motion) {
  return `${outlined('M62 96C30 90 10 108 12 140c14-16 30-16 46-8Z',c.fur,2.5)}${line('M20 130c10-8 22-10 34-6M18 138c10-2 24-1 34 2',c.shade,1.8)}
    ${outlined('M118 96c32-6 52 12 50 44-14-16-30-16-46-8Z',c.fur,2.5)}${line('M160 130c-10-8-22-10-34-6m36 14c-10-2-24-1-34 2',c.shade,1.8)}
    ${outlined('M70 98c-14 8-19 26-17 41 2 17 14 22 35 22s33-6 35-23c2-18-5-34-19-40Z',c.fur)}${ellipse(88,136,20,22,c.shirt)}
    ${outlined('M66 106l13 7 9 18 9-18 14-7c8 12 11 26 9 42-9 6-20 8-28 8l-4-25-4 25c-10 0-20-3-27-8-1-15 2-30 9-42Z',c.coat,2.3)}${badge(c,71,136)}
    ${outlined('M52 62l-6-38 26 20c10-4 22-4 32 0l26-20-6 38c0 24-16 40-36 40-21 0-36-16-36-40Z',c.fur)}${path('M54 32l3 22 12-12Zm70 0-15 10 12 12Z','#c9a3d6')}
    ${path('M64 68c4-14 16-22 26-22 11 0 22 8 26 22-3 16-13 26-26 26-12 0-23-10-26-26Z','#d9cbe8')}
    ${eyes([[74,70],[104,70]],motion,.9)}${outlined('M84 84c3-2 8-2 11 0-1 4-4 6-5 6s-5-2-6-6Z',INK,1.4)}${line('M78 95c7 5 15 5 22 0m-18 0 2 5m14-5-2 5',INK,2)}
    ${ellipse(61,82,5,3,'#e6a9c7')}${ellipse(118,82,5,3,'#e6a9c7')}
    ${outlined('M58 118c-10-3-19 6-16 14 3 6 11 7 16 1l6-8Z',c.fur,2.3)}${line('M46 129l3 3m2-7 3 3',c.shade,1.6)}${heldProp('bat',c,motion)}`;
}
/* 🦚 Too vague — a peacock fanning a tail with nothing written on it. */
function peacock(c,motion) {
  return `<g${motion('sc-avatar-spark')}>${outlined('M89 128C56 128 30 96 40 60c6 22 18 36 34 44-4-30 4-56 15-72 11 16 19 42 15 72 16-8 28-22 34-44 10 36-16 68-49 68Z',c.coat,2.6)}
    ${circle(62,84,7,c.accent,rim(1.8))}${circle(62,84,3,c.dark)}${circle(89,58,7,c.accent,rim(1.8))}${circle(89,58,3,c.dark)}${circle(116,84,7,c.accent,rim(1.8))}${circle(116,84,3,c.dark)}
    ${circle(48,110,6,c.accent,rim(1.8))}${circle(48,110,2.5,c.dark)}${circle(130,110,6,c.accent,rim(1.8))}${circle(130,110,2.5,c.dark)}</g>
    ${outlined('M84 150l-6 20 12-3 6 5 6-22Z',c.dark,2.4)}${line('M88 158l-2 10m8-11 1 10',c.accent,2)}
    ${outlined('M66 108c-10 14-12 34-5 50 6 14 20 17 33 15 20-3 30-17 27-37-2-17-12-30-24-34Z',c.fur)}${path('M74 120c-8 12-12 28-8 40 4 10 14 13 25 11 13-3 19-15 15-28l-10-22Z',c.shade)}
    ${outlined('M62 128c-18 0-27 18-16 30 4 5 9 4 13-3 3-4 8-6 9-11Z',c.coat,2.3)}${line('M48 145l6 5m-7 1 5 4m5-14 6 4',c.dark,2)}
    ${outlined('M64 86c0-22 14-36 34-36 20 0 32 15 32 34 0 21-15 37-34 37-20 0-32-14-32-35Z',c.fur)}
    ${line('M92 48l-4-14m6 14 2-14m-10 14-8-11',c.dark,2.4)}${circle(88,33,3.5,c.accent,rim(1.6))}${circle(96,33,3.5,c.accent,rim(1.6))}${circle(80,36,3,c.accent,rim(1.6))}
    ${path('M96 56c-15 5-19 18-17 32 2 12 14 16 24 9 12 9 22 0 23-11 1-14-12-26-30-30Z',CREAM)}${eyes([[86,80],[112,80]],motion,.9)}
    ${outlined('M100 92c7-4 18 0 17 8-1 7-9 13-15 14 3-8 4-13-2-22Z',c.accent,2.2)}${outlined('M101 102c6-2 10-1 12 0-3 5-7 8-11 10Z',c.shade,1.6)}${ellipse(78,98,5,3,'#ffb6a4')}
    ${badge(c,79,140)}${heldProp('peacock',c,motion,{bird:true})}`;
}
const ANIMAL_ART = Object.freeze({rabbit,parrot,sloth,chameleon,octopus,monkey,goldfish,fox,bat,peacock});

/* Each prop names the habit: what the animal is holding is the lesson. */
function prop(id, c) {
  if (id === 'rabbit') return `<g transform="rotate(12 134 114)">
    ${outlined('M131 86h8v8h-8Z',c.dark,2)}${line('M135 84v-4',INK,2.6)}
    ${circle(134,116,22,INK)}${circle(134,116,18.5,'#fff',`stroke="${c.dark}" stroke-width="3.5"`)}
    ${line('M134 116l-8-9',INK,3)}${line('M134 116l11 3',INK,2.4)}${circle(134,116,2.4,c.accent)}
    ${line('M134 100v3m16 13h-3m-13 13v3m-16-16h3',c.shade,2)}${line('M152 96l6-6m-6 0 6 6',c.accent,2.4)}</g>`;
  if (id === 'parrot') return `<g transform="rotate(-8 134 116)">
    ${outlined('M128 128h8v16h-8Z',c.dark,2.1)}${circle(132,106,21,INK)}${circle(132,106,17.5,'#dff3ff',`stroke="${c.dark}" stroke-width="3.5"`)}
    ${path('M120 110c-5-11 3-20 12-19l6 2-15 19Z','#f7fdff')}${line('M126 100l6 6 8-8',c.dark,2.6)}
    ${outlined('M116 84c6-4 14-4 20 0l-10 8Z',c.accent,1.8)}${line('M147 86c4 4 4 10 0 14',c.accent,2.4)}${line('M152 82c6 6 6 16 0 22',c.accent,2)}</g>`;
  if (id === 'sloth') return `<g transform="rotate(8 134 118)">
    ${outlined('M112 104h18v12h-18Z',c.accent,2.3)}${line('M130 110h10',INK,3)}${outlined('M140 104h18v12h-18Z',c.accent,2.3)}
    ${line('M121 116l-2 12 8 6',INK,3.2)}${line('M121 116l-2 12 8 6',c.coat,1.6)}${line('M149 116l3 12',INK,3)}${line('M149 116l3 12',c.coat,1.5)}
    ${line('M152 128c6 2 10 8 8 14',INK,2.2)}
    ${line('M160 142l-4-3m4 3 4-3',c.dark,2)}${line('M132 90l4 4m4-6 1 5m-14-3 3 4',c.dark,2)}</g>`;
  if (id === 'chameleon') return `<g transform="rotate(9 134 114)">
    ${outlined('M114 96h40v40h-40Z','#fffaf0',2.5)}${line('M120 106h22m-22 8h28m-28 8h16',c.shade,2.2)}
    ${outlined('M138 118h22l-4 10-18 3Z',c.accent,2)}${line('M142 122h12',INK,1.6)}
    ${line('M124 138l-4 10 12-3',c.dark,2.4)}${circle(150,92,4,c.coat,rim(1.5))}${line('M148 92h4',CREAM,1.5)}</g>`;
  if (id === 'octopus') return `<g transform="rotate(6 132 112)">
    ${outlined('M110 100h16v12h-16Z',c.accent,2)}${outlined('M130 92h14v18h-14Z','#fffaf0',2)}${line('M133 98h8m-8 5h6',c.dark,1.8)}
    ${outlined('M148 98h12v14h-12Z',c.coat,2)}${outlined('M114 118h14v12h-14Z',c.shirt,2)}${outlined('M134 116h18l-3 14h-12Z',c.dark,2)}
    ${circle(120,138,6,c.accent,rim(1.8))}${circle(148,138,5,c.coat,rim(1.8))}${star(158,112,c.accent,.7)}</g>`;
  if (id === 'monkey') return `<g transform="rotate(10 134 114)">
    ${outlined('M110 96h22v14h-22Z','#fff3c9',2.2)}${line('M114 103h14',c.dark,2.4)}${outlined('M136 118h22v14h-22Z','#dff5ff',2.2)}${line('M140 125h14',c.dark,2.4)}
    ${line('M121 110v8l15 0',INK,2.6)}${line('M147 118v-8l-15 0',INK,2.6)}${line('M124 92l-3-5m40 19 4-5',c.accent,2.2)}
    ${path('M128 128l-4 6 8 1Z',c.accent)}${path('M140 100l4-6-8-1Z',c.accent)}</g>`;
  if (id === 'goldfish') return `<g transform="rotate(-6 138 108)">
    ${outlined('M120 94c-12 0-16 16-6 22-3 8 8 14 14 8 5 8 18 6 20-3 10 0 14-14 4-19 4-10-8-18-16-11-4-5-14-4-16 3Z','#fff',2.5)}
    ${circle(118,126,3.5,'#fff',rim(1.6))}${circle(112,134,2.5,'#fff',rim(1.4))}
    ${line('M126 108h20m-16 8h12','#c9d4de',2.2)}${line('M140 100l-2 2m4 2 2-2',c.accent,2)}</g>`;
  if (id === 'fox') return `<g transform="rotate(8 134 114)">
    ${outlined('M132 92h4v52h-4Z','#e8c68f',2.3)}${outlined('M106 100h34l8 7-8 7h-34Z',c.accent,2.2)}${line('M112 107h22m-2-4 4 4-4 4',INK,2)}
    ${outlined('M134 118h34l-8 7 8 7h-34Z',c.shirt,2.2)}${line('M162 125h-22m2-4-4 4 4 4',INK,2)}${line('M126 148h16',INK,2.4)}</g>`;
  if (id === 'bat') return `<g transform="rotate(7 134 116)">
    ${outlined('M112 96h40v36h-40Z','#fffaf0',2.4)}${line('M118 108h10m-10 8h12m-12 8h8',c.shade,2)}
    ${path('M132 104h16v20h-16Z','#dfe8f2')}${line('M134 114l4 6 8-10',c.dark,2.4)}${line('M120 88l4 5m8-7v6',c.accent,2.2)}
    ${outlined('M144 132l8 12-10-2Z',c.coat,1.8)}</g>`;
  return `<g transform="rotate(8 134 116)">
    ${outlined('M112 94h40v42h-40Z','#fffaf0',2.4)}${line('M120 106h24m-24 10h24m-24 10h14','#d5dbe4',2.2)}
    ${outlined('M138 84c6-4 14 0 14 6 0 5-4 8-8 8l-4 6Z',c.accent,1.9)}${line('M148 90l-5 4',INK,1.6)}
    ${line('M116 142l6 6m2-10 6 8',c.dark,2)}</g>`;
}

/* One figure, 180×180, animated by class only. An id nobody knows returns
   an EMPTY string — never a stand-in — so a lesson can never wear the wrong
   animal, and a caller that spliced a guess in gets nothing rather than a
   plausible picture. */
export function renderMistakeAnimalAvatar(id,{animated=true}={}) {
  if (typeof id !== 'string' || !Object.hasOwn(CAST,id)) return '';
  const c = CAST[id];
  const motion = name => animated ? ` class="${name}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" class="sc-avatar sc-avatar--mistake-${id}${animated ? '' : ' sc-avatar--still'}" data-animal="${c.animal}" aria-hidden="true" role="presentation" focusable="false" style="overflow:visible">
    ${backdrop(c,motion)}<g${motion('sc-avatar-float')}>${ANIMAL_ART[id](c,motion)}</g>
  </svg>`;
}
export function mistakeAnimalAccent(id) {
  return typeof id === 'string' && Object.hasOwn(CAST,id) ? {accent:CAST[id].dark,wash:CAST[id].light} : null;
}
