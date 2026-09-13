// Original, self-contained animal mascot artwork. Every interpolated value is
// selected from this fixed cast; caller-provided IDs never become SVG markup.
export const SCIENCE_COACH_IDS = Object.freeze([
  'comparison', 'specific', 'evidence', 'keywords',
  'concept', 'reasoning', 'careful', 'complete'
]);
const INK = '#29314d';
const CREAM = '#fff7df';
const CAST = Object.freeze({
  comparison:{fur:'#9f83df',shade:'#7861bd',coat:'#aa88ef',dark:'#7157b3',shirt:'#ff9e91',light:'#eee2ff',accent:'#72d8c3',animal:'chameleon'},
  specific:{fur:'#ee944c',shade:'#c86935',coat:'#51c4b7',dark:'#249d99',shirt:'#fff0ac',light:'#d7f8ee',accent:'#ffcf69',animal:'fox'},
  evidence:{fur:'#8bb9d4',shade:'#6492b4',coat:'#ffc259',dark:'#c98c32',shirt:'#5987cc',light:'#fff0c5',accent:'#78bce4',animal:'elephant'},
  keywords:{fur:'#4ebebc',shade:'#278f9f',coat:'#6d9feb',dark:'#4074c3',shirt:'#76d5ca',light:'#dfedff',accent:'#ffd577',animal:'parrot'},
  concept:{fur:'#a780c9',shade:'#7958a5',coat:'#ad84db',dark:'#815eb8',shirt:'#eaa6d1',light:'#f0e2ff',accent:'#f8d770',animal:'owl'},
  reasoning:{fur:'#dc8550',shade:'#a8503b',coat:'#f5a165',dark:'#be6540',shirt:'#6b87b8',light:'#ffead5',accent:'#7fd5d0',animal:'red-panda'},
  careful:{fur:'#9dcd72',shade:'#6d9b54',coat:'#a6ce68',dark:'#558a64',shirt:'#459f98',light:'#edfad1',accent:'#ffd46b',animal:'tortoise'},
  complete:{fur:'#b98057',shade:'#865437',coat:'#ee8db6',dark:'#c76496',shirt:'#f6cb69',light:'#ffe0ed',accent:'#84d9cf',animal:'beaver'}
});
const path = (d,fill,extra='') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d,color=INK,width=2.8) => path(d,'none',`stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const outlined = (d,fill,width=2.8) => path(d,fill,`stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const ellipse = (cx,cy,rx,ry,fill,extra='') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circle = (cx,cy,r,fill,extra='') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const rim = (width=2.8) => `stroke="${INK}" stroke-width="${width}"`;
const star = (x,y,color,scale=1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M0-7 2-2 7 0 2 2 0 7-2 2-7 0-2-2Z',color)}</g>`;

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
function heldProp(id,c,motion,bird=false) {
  return `<g${motion('sc-avatar-hand')}>${prop(id,c)}${bird ? `${outlined('M124 129c9 0 20 5 19 12-1 7-11 9-19 3l-7-8Z',c.coat,2.4)}${line('M129 140l9-2m-8 6 8-3',c.dark,1.8)}` : paw(c)}</g>`;
}
function badge(c,x=70,y=137) {
  return `${outlined(`M${x-7} ${y-9}h14v18h-14Z`,CREAM,1.7)}${path(`M${x-3} ${y-12}h6v6h-6Z`,c.accent)}${line(`M${x-4} ${y-2}h8m-8 5h5`,c.dark,1.8)}`;
}
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
function chameleon(c,motion) {
  return `${line('M66 144C42 167 14 147 25 128c8-14 28-8 24 4-3 9-14 8-15 1',INK,19)}${line('M66 144C42 167 14 147 25 128c8-14 28-8 24 4-3 9-14 8-15 1',c.accent,13)}
    ${outlined('M77 98c-16 9-21 28-17 45 4 13 17 17 34 17 18 0 25-8 23-24-1-15-5-28-14-36Z',c.fur)}${path('M86 110c-7 17-8 34-2 49h14c8-16 6-34-3-49Z',c.accent)}
    ${line('M69 117l9 3m-11 9 9 3m-9 10 8 3',c.shade,4)}${outlined('M68 150l-8 11 8 3 7-5 8 3 5-5-11-10Z',c.accent,2.3)}${outlined('M103 149l-2 12 9 3 5-5 8 1 2-5-13-9Z',c.accent,2.3)}
    ${outlined('M56 64c6-22 25-32 45-25 10 4 17 15 20 27l14 14c6 7 2 18-8 21-16 5-28 13-43 12-18-1-32-17-28-49Z',c.fur)}
    ${path('M59 87c21 9 45 11 73 0-1 7-3 11-8 12-18 6-28 13-40 12-11 0-20-9-25-24Z',c.accent)}${outlined('M62 44l5-13 10 8 9-12 9 14 9-6 5 13Z',c.accent,2.2)}
    ${circle(72,60,19,c.shade,rim(2.7))}${circle(105,59,20,c.accent,rim(2.7))}${circle(72,60,14,c.fur)}${circle(105,59,14,'#b8efe0')}${eyes([[72,60],[105,59]],motion,.98)}
    ${circle(128,80,1.8,INK)}${line('M79 90c12 7 26 7 37-1',INK,2.4)}${ellipse(69,86,6,3,'#f9b4b2','opacity=".65"')}
    ${outlined('M65 115c-14-6-24-1-25 10-1 7 4 10 9 7l7-6 12 2Z',c.fur,2.4)}${line('M44 125l5 2m-1-6 5 2',c.shade,1.8)}${heldProp('comparison',c,motion)}`;
}
function fox(c,motion) {
  return `${outlined('M65 148C24 168 10 133 22 104c6 20 35 13 43 38Z',c.fur)}${path('M22 104c5 14 15 17 26 23l-12 5-4 11-13-7c-3-10-1-22 3-32Z',CREAM)}${body(c)}
    ${outlined('M49 65l-7-42c-1-7 4-9 9-5l28 25Zm48-20 24-26c5-5 10-2 9 5l-6 44Z',c.fur)}${path('M51 30l5 24 15-10Zm68 3-16 13 17 12Z','#8c4b48')}
    ${outlined('M47 65c4-21 21-31 40-31 20 0 38 12 42 33l8 16-18 8c-7 13-20 23-32 24-14-1-25-12-33-24l-17-8Z',c.fur)}
    ${path('M43 77l19-8c8 6 16 13 25 26 9-13 18-20 25-26l19 8-17 10c-7 13-17 23-27 25-10-2-21-14-28-26Z',CREAM)}
    ${muzzle(c,motion)}${line('M59 57l11-3m38 0 8 4',c.shade,2.8)}${leftPaw(c)}${heldProp('specific',c,motion)}`;
}
function elephant(c,motion) {
  return `${outlined('M120 135c13 4 18 13 12 22l-6-4c4-6 1-9-9-10Z',c.fur,2.2)}${body(c)}
    ${outlined('M63 48C39 30 23 46 28 77c3 23 19 35 35 24l14-28Z',c.fur)}${outlined('M110 47c25-17 42 0 37 29-4 24-20 35-36 24l-13-27Z',c.fur)}
    ${path('M57 55C42 42 34 54 38 75c3 14 10 20 20 16l8-16Z','#e1b2c8')}${path('M117 54c15-12 23 1 19 22-3 14-10 19-20 15l-7-16Z','#e1b2c8')}
    ${outlined('M54 58c0-24 15-37 34-37s35 14 35 37v21c0 19-15 30-34 30S54 98 54 79Z',c.fur)}${path('M78 22l8-8 3 9 8-4-1 10Z',c.shade)}
    ${eyes([[70,64],[105,64]],motion,.92)}${line('M64 52c4-3 8-3 12-1m23-1c4-2 8-1 11 2',c.shade,2.8)}${ellipse(64,83,7,4,'#e1b2c8','opacity=".8"')}${ellipse(111,83,7,4,'#e1b2c8','opacity=".8"')}
    ${outlined('M76 85c-4 13-2 24 5 31 10 11 28 5 30-5 2-8-6-12-10-7-3 5-7 6-9 2-3-5 0-13 0-21Z',c.fur,2.5)}${line('M77 96h12m-10 8 9-1m-4 10 7-3',c.shade,1.8)}${line('M69 93l5 4m25-4-4 4',INK,2)}
    ${leftPaw(c)}${heldProp('evidence',c,motion)}`;
}
function parrot(c,motion) {
  return `${outlined('M81 137l-9 30 13-3 7 6 7-27Z',c.dark,2.5)}${line('M85 147l-2 15m8-16 1 15',c.accent,2.2)}
    ${outlined('M61 83c-14 16-17 40-10 62 6 17 23 20 39 17 24-4 35-21 31-44-3-20-17-35-32-40Z',c.fur)}${path('M69 98c-10 15-16 33-11 48 4 13 16 17 30 14 15-4 22-19 17-35l-13-26Z',c.accent)}
    ${outlined('M60 109c-21 0-33 22-20 38 5 6 11 5 16-4 3-5 9-8 11-14Z',c.coat,2.5)}${line('M43 131l7 6m-8 1 6 5m6-17 7 5',c.dark,2.3)}
    ${outlined('M56 62c0-25 16-40 38-40 22 0 36 17 36 38 0 23-17 41-39 41-23 0-35-16-35-39Z',c.fur)}${outlined('M78 26c-3-11 2-18 9-15l9 13c-1-15 8-18 12-12l4 18Z',c.coat,2.4)}
    ${path('M91 30c-17 5-22 19-20 35 3 14 17 18 28 10 14 10 26 0 27-13 1-16-14-29-35-32Z',CREAM)}${eyes([[83,57],[113,58]],motion,.96)}
    ${outlined('M93 69c9-5 24 0 23 10-1 9-12 17-20 18 4-10 6-16-3-28Z',c.accent,2.4)}${outlined('M94 81c8-3 13-2 16 0-4 7-9 11-14 14Z',c.shade,1.8)}${line('M99 76l8-1','#d4993b',1.8)}${ellipse(73,77,6,3,'#eeaca4')}
    ${outlined('M70 156v5l-8 3 4 4 11-4 8 1 2-4-8-2v-4Zm30 0v5l-5 4 3 3 8-4 10 2 2-4-10-3v-4Z',c.accent,2.2)}${badge(c,76,124)}${heldProp('keywords',c,motion,true)}`;
}
function owl(c,motion) {
  return `${outlined('M72 149l-4 17 13-5 8 6 9-7 11 4-6-16Z',c.shade,2.4)}${outlined('M53 80c-8 17-9 42 0 62 6 15 20 21 36 21 23 0 36-9 40-30 4-25-5-46-16-56Z',c.fur)}${ellipse(89,128,25,30,'#dcc4ed')}
    ${line('M73 118l5 5 5-5m3 9 5 5 5-5m-23 12 5 5 5-5m15-22 5 5 5-5m-7 22 5 5 5-5',c.shade,2.5)}
    ${outlined('M60 105c-14-3-23 12-20 26 2 11 9 18 16 13l12-21Z',c.shade,2.5)}${line('M45 126l8 8m-7-1 7 7',c.coat,2.1)}
    ${outlined('M48 65l-4-40 26 13c12-5 26-5 38 0l27-13-5 40c1 27-17 44-41 44-25 0-43-17-41-44Z',c.fur)}${path('M52 38l3 20 13-14Zm75 0-15 7 12 13Z',c.shade)}
    ${outlined('M89 57c-6-17-33-22-37 4-4 25 24 39 37 24 13 15 40 1 36-24-4-26-30-21-36-4Z',CREAM,2)}${circle(70,67,14,'#f0dfbf')}${circle(108,67,14,'#f0dfbf')}${eyes([[70,67],[108,67]],motion,1.13)}
    ${outlined('M83 81l6-6 6 6-6 10Z',c.accent,2)}${ellipse(57,85,6,3,'#e8b4cb')}${ellipse(120,85,6,3,'#e8b4cb')}${line('M63 49l9-3m31 0 9 3',c.shade,2.8)}${star(89,40,c.accent,.6)}
    ${outlined('M75 157l-7 7 7 3 6-5 7 3 4-4-10-5Zm25 0-5 6 5 4 6-5 8 3 4-4-11-5Z',c.accent,2.1)}${heldProp('concept',c,motion,true)}`;
}
function redPanda(c,motion) {
  return `${outlined('M66 149C34 176 11 147 23 118c4-9 13-13 19-8-11 16 2 22 23 23Z',c.fur)}${path('M19 133l22 3 7 11-26-3Zm8 22 13-13 12 7-10 13Zm-2-37 13 8-1-11-8-2Z',c.shade)}${body(c)}
    ${outlined('M52 54C30 42 43 16 62 25l13 18Zm51-13 14-17c20-8 29 20 11 33Z',c.fur)}${path('M51 41c-7-11 1-17 8-11l7 11Zm62 0 9-11c8-4 13 5 5 14Z',CREAM)}
    ${outlined('M46 62c4-21 21-30 42-30s39 12 42 33l7 13-16 8c-5 18-20 28-33 28-16 0-31-11-36-28l-13-8Z',c.fur)}
    ${path('M49 70l18-13c5 0 10 5 14 13l7 12 8-12c5-9 9-13 14-13l18 13-12 10c-6 19-15 29-28 29S65 98 60 80Z',CREAM)}
    ${outlined('M57 65c8-8 21 0 23 10l-13 12c-11-3-17-15-10-22Zm61 0c-8-8-20 0-23 10l13 12c12-3 17-15 10-22Z',c.shade,1.7)}${muzzle(c,motion,{red:true})}${leftPaw({...c,fur:c.shade,shade:CREAM})}${heldProp('reasoning',{...c,fur:c.shade,shade:CREAM},motion)}`;
}
function tortoise(c,motion) {
  return `${outlined('M45 150l-14 6 3-14 15-6Z',c.fur,2.4)}${outlined('M83 86C46 82 25 106 32 138c4 22 26 29 53 23 24-5 38-20 31-43-5-17-17-28-33-32Z',c.dark)}
    ${outlined('M73 95c-25-1-39 17-35 38 4 19 20 23 41 18 20-4 30-17 25-34-3-13-15-21-31-22Z','#83b988',2.3)}${outlined('M63 109l20-1 9 18-13 17-20-6-4-17Z','#588c6c',2.2)}${line('M63 109l-6-10m26 9 7-8m2 26 13 3m-26 14 2 7m-22-13-16 1m12-18-15-6',INK,2)}
    ${outlined('M80 105c17-5 33 10 36 28 2 16-6 28-20 29-13 0-22-10-22-26Z',c.fur)}${path('M87 116c-10 9-12 30-3 43 10 3 18 0 22-6 5-14-3-31-10-37Z','#e2e9a1')}${line('M83 135h15m-15 9h19',c.shade,2)}
    ${outlined('M58 147l-8 13 5 7 11-2 10-10-5-8Zm41 7 2 11 14 2 7-5-10-12Z',c.fur,2.5)}${line('M54 160l4 3m1-6 4 3m42 1v3m6-3v3',CREAM,1.8)}
    ${outlined('M65 60c2-20 16-31 34-30 19 1 31 16 29 35l-2 17c-2 18-15 28-33 27-20-2-31-17-30-35Z',c.fur)}${path('M73 51c11-15 32-15 43 1l-5-16-19-8-16 8Z',c.shade)}${eyes([[81,67],[112,67]],motion,.9)}
    ${ellipse(96,86,24,14,'#c4e59c')}${circle(88,81,1.6,c.shade)}${circle(103,81,1.6,c.shade)}${line('M84 91c7 7 18 6 25-1',INK,2.2)}${ellipse(76,85,5,3,'#edc294')}${ellipse(117,85,5,3,'#edc294')}
    ${outlined('M75 113c-15 0-23 6-19 16 3 7 13 9 19 3l7-11Z',c.fur,2.4)}${line('M59 126l4 3m1-7 4 3',c.shade,1.7)}${outlined('M81 109l7 8 9-7 5 9-12 8-13-9Z',c.shirt,2)}${heldProp('careful',c,motion)}`;
}
function beaver(c,motion) {
  return `${outlined('M65 144C50 124 27 119 19 134c-9 19 14 36 38 26l15-9Z',c.shade)}${line('M27 133l24 23m-31-15 22 20m-5-34 20 19m-32-3 19-16m-10 25 19-17','#bb8d63',2.1)}${body(c)}
    ${circle(58,44,15,c.fur,rim())}${circle(117,44,15,c.fur,rim())}${circle(58,44,8,'#e7b49d')}${circle(117,44,8,'#e7b49d')}
    ${outlined('M46 70c-1-26 17-42 41-42 25 0 43 16 42 42 0 27-15 45-42 45-26 0-41-18-41-45Z',c.fur)}${path('M78 30l4-9 8 7 7-8 3 13Z',c.fur)}${eyes([[68,67],[106,67]],motion,.94)}${line('M60 54c4-3 9-4 13-2m26 0c4-2 9-1 12 2',c.shade,2.7)}
    ${ellipse(74,91,19,15,'#edcda4')}${ellipse(101,91,19,15,'#edcda4')}${outlined('M79 81c5-3 12-3 17 0-1 7-6 10-9 10s-7-3-8-10Z',INK,1.7)}
    ${outlined('M73 99c8 5 20 5 28-1-2 17-25 21-28 1Z','#683f3c',1.8)}${outlined('M78 101h9v12h-7Zm10 0h9l-2 12h-7Z','#fffef5',1.5)}${line('M60 89l-13-3m13 8-14 3m68-8 12-3m-12 8 14 3',c.shade,1.7)}
    ${ellipse(57,83,5,3,'#e9a69c')}${ellipse(119,83,5,3,'#e9a69c')}${leftPaw(c)}${heldProp('complete',c,motion)}`;
}
const ANIMAL_ART = Object.freeze({comparison:chameleon,specific:fox,evidence:elephant,keywords:parrot,concept:owl,reasoning:redPanda,careful:tortoise,complete:beaver});

function prop(id, c) {
  if (id === 'comparison') return `<g transform="rotate(9 133 111)">
    ${outlined('M130 93h6v46h-6Z','#ffe9ac',2.1)}${outlined('M115 134h37v7h-37Z','#ffe9ac',2.1)}
    ${line('M110 105h46',INK,3)}${circle(133,103,4,c.accent,`stroke="${INK}" stroke-width="2"`)}
    ${line('M115 106l-7 15m7-15 7 15m28-15-7 15m7-15 7 15',INK,1.6)}
    ${outlined('M105 121h20c-2 11-17 11-20 0Z',c.accent,2)}${outlined('M140 121h20c-2 11-17 11-20 0Z','#86d2cb',2)}
    ${line('M108 94h16m-4-4 4 4-4 4',c.dark,2.5)}${line('M155 89h-16m4-4-4 4 4 4',c.dark,2.5)}</g>`;
  if (id === 'specific') return `<g transform="rotate(16 135 115)">
    ${outlined('M129 113h10v28c0 7-10 7-10 0Z','#ffd16e',2.5)}
    ${circle(134,105,20,INK)}${circle(134,105,16.5,'#b3ede7',`stroke="${c.dark}" stroke-width="4"`)}
    ${path('M123 111c-6-9 0-18 8-19h9l-17 19Z','#e5fffa')}
    ${line('M125 107l5 5 11-12',c.dark,2.8)}${circle(142,96,3,'#fff')}
    ${line('M133 124v9','#fff0bd',2)}</g>`;
  if (id === 'evidence') return `<g transform="rotate(10 135 116)">
    ${outlined('M114 91h37c3 0 5 2 5 5v42c0 3-2 5-5 5h-37Z','#5a8ace',2.8)}
    ${outlined('M112 91h37v48h-37Z','#fffaf0',2.4)}${path('M112 91h7v48h-7Z','#cde6f2')}
    ${line('M116 99h-7m7 10h-7m7 10h-7m7 10h-7',INK,2.5)}
    ${line('M124 101h16m-16 5h11','#9eacb7',2)}${line('M124 115v15h20',INK,1.9)}
    ${path('M127 123h4v7h-4Z','#79c8bd')}${path('M133 118h4v12h-4Z',c.coat)}${path('M139 112h4v18h-4Z','#ee9383')}
    ${path('M142 89v14l-4-3-4 3V89Z','#ec8a80')}</g>`;
  if (id === 'keywords') return `<g transform="rotate(-7 134 118)">
    ${outlined('M116 109h30v31h-30Z','#fff1ba',2.4)}${path('M119 132h24v5h-24Z','#edbf60')}
    ${line('M124 117v13m1-6 10-7m-10 7 10 6',c.dark,3.6)}
    ${outlined('M133 83a11 11 0 1 0 0 22h5v10h7v-6h5v-9h-12a11 11 0 0 0-5-17Z',c.accent,2.5)}
    ${circle(127,94,3.5,'#fff7db',`stroke="${INK}" stroke-width="1.8"`)}</g>`;
  if (id === 'concept') return `<g transform="rotate(8 134 111)">
    ${outlined('M120 111c-11-13-3-30 12-30s23 17 12 30l-3 11h-18Z','#ffe391',2.5)}
    ${path('M130 86c-10 2-13 12-8 18','none','stroke="#fff7ce" stroke-width="4" stroke-linecap="round"')}
    ${line('M129 119l-3-16 6 4 6-4-3 16','#d49b40',2.1)}
    ${outlined('M122 122h20v9h-20Z',c.accent,2.3)}${outlined('M126 132h12l-3 5h-6Z',c.dark,2)}
    ${line('M111 88l-4-4m26-10v-6m22 20 5-4',c.accent,3)}
    ${ellipse(151,111,10,4,'none',`stroke="${c.dark}" stroke-width="1.5" transform="rotate(-40 151 111)"`)}
    ${ellipse(151,111,10,4,'none',`stroke="${c.dark}" stroke-width="1.5" transform="rotate(40 151 111)"`)}${circle(151,111,2,c.dark)}</g>`;
  if (id === 'reasoning') return `<g transform="rotate(8 132 114)">
    ${outlined('M116 88l7-3 5 7 7-1 4 6-4 7 4 7-4 6-7-1-5 7-7-3-1-8-7-4v-7l7-5Z',c.accent,2.3)}
    ${circle(123,104,6,'#e6fff6',`stroke="${INK}" stroke-width="2.3"`)}
    ${outlined('M139 107l6-1 3 6 7 2 1 6-6 4-1 7-6 1-5-6-7-1-2-6 6-5Z','#ffda7c',2.3)}
    ${circle(142,119,5,'#fff4c9',`stroke="${INK}" stroke-width="2.3"`)}
    ${line('M118 128l-1 9c-1 7 8 8 10 3l4-9',INK,6)}${line('M118 128l-1 9c-1 7 8 8 10 3l4-9','#ffda7c',2.8)}
    ${line('M151 93l3-5m-12 2v-5',c.dark,2.5)}</g>`;
  if (id === 'careful') return `<g transform="rotate(9 132 114)">
    ${outlined('M113 94h37v48h-37Z',c.dark,2.6)}${path('M118 99h27v37h-27Z','#fffef2')}
    ${outlined('M124 90h15v10h-15Z',c.accent,2.1)}${circle(131.5,94,1.6,'#fff7d6')}
    ${line('M122 108l2 2 4-4m-6 13 2 2 4-4m-6 13 2 2 4-4',c.dark,2.2)}
    ${line('M133 109h7m-7 11h7m-7 11h7','#abb9a2',1.9)}
    ${outlined('M148 110l5 2-9 26-5 4v-7Z',c.accent,1.7)}${path('M139 136l5 2-5 4Z',INK)}</g>`;
  return `<g transform="rotate(7 134 118)">
    ${outlined('M112 101h14c-4-11 12-12 12 0h14v13c11-4 12 12 0 12v14h-14c4-11-12-12-12 0h-14v-14c11 4 12-12 0-12Z',c.accent,2.8)}
    ${path('M114 132h12c2-7 10-7 12 0h12v6h-10c0-11-16-11-16 0h-10Z','#5bb6b1')}
    ${star(133,117,'#edfff7',1.05)}
    ${outlined('M143 87h8c-2-6 7-6 7 0h7v8c6-2 6 7 0 7v8h-8c2-6-7-6-7 0h-7v-8c6 2 6-7 0-7Z',c.shirt,2.1)}</g>`;
}

export function renderScienceCoachAvatar(id,{animated=true}={}) {
  const key = typeof id === 'string' && Object.hasOwn(CAST,id) ? id : 'comparison';
  const c = CAST[key];
  const motion = name => animated ? ` class="${name}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" class="sc-avatar sc-avatar--${key}${animated ? '' : ' sc-avatar--still'}" data-animal="${c.animal}" aria-hidden="true" role="presentation" focusable="false" style="overflow:visible">
    ${backdrop(c,motion)}<g${motion('sc-avatar-float')}>${ANIMAL_ART[key](c,motion)}</g>
  </svg>`;
}
