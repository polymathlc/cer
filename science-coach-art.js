// Original, self-contained SVG artwork. Every interpolated value is selected
// from this fixed cast; caller-provided IDs never become SVG markup.
export const SCIENCE_COACH_IDS = Object.freeze([
  'comparison', 'specific', 'evidence', 'keywords',
  'concept', 'reasoning', 'careful', 'complete'
]);

const INK = '#29314d';
const CAST = Object.freeze({
  comparison: {skin:'#c88663',shade:'#ae654d',hair:'#34304f',coat:'#aa88ef',dark:'#7e60c7',shirt:'#ff8c83',light:'#eee2ff',accent:'#ff9f90',name:'Casey'},
  specific: {skin:'#995b45',shade:'#784338',hair:'#282638',coat:'#51c4b7',dark:'#249d99',shirt:'#fff0ac',light:'#d7f8ee',accent:'#ffcf69',name:'Sherry'},
  evidence: {skin:'#f2bd98',shade:'#d79272',hair:'#a94f3d',coat:'#ffc259',dark:'#e2993d',shirt:'#5987cc',light:'#fff0c5',accent:'#78bce4',name:'Ellen'},
  keywords: {skin:'#e8b08b',shade:'#c9896e',hair:'#273451',coat:'#6d9feb',dark:'#4074c3',shirt:'#76d5ca',light:'#dfedff',accent:'#ffd577',name:'Kai'},
  concept: {skin:'#cba17e',shade:'#ac7a61',hair:'#443154',coat:'#ad84db',dark:'#815eb8',shirt:'#eaa6d1',light:'#f0e2ff',accent:'#f8d770',name:'Cora'},
  reasoning: {skin:'#ad704b',shade:'#8b523c',hair:'#312d36',coat:'#f5a165',dark:'#d77943',shirt:'#6b87b8',light:'#ffead5',accent:'#7fd5d0',name:'Ravi'},
  careful: {skin:'#ebbd9d',shade:'#ca8e73',hair:'#2b5d57',coat:'#a6ce68',dark:'#72a34a',shirt:'#459f98',light:'#edfad1',accent:'#ffd46b',name:'Cleo'},
  complete: {skin:'#a96e59',shade:'#895143',hair:'#49324f',coat:'#ee8db6',dark:'#c76496',shirt:'#f6cb69',light:'#ffe0ed',accent:'#84d9cf',name:'Cody'}
});

const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d, color = INK, width = 2.8) => path(d, 'none', `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const outlined = (d, fill, width = 2.8) => path(d, fill, `stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
const ellipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const star = (x, y, color, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${path('M0-7 2-2 7 0 2 2 0 7-2 2-7 0-2-2Z',color)}</g>`;

function backdrop(c, motion) {
  return `${ellipse(89,165,57,7,INK,'opacity=".09"')}
    ${path('M34 114C15 90 26 51 56 39c28-12 48-17 73-3 27 15 38 46 21 74-14 22-37 42-64 43-24 1-38-22-52-39Z',c.light)}
    <g${motion('sc-avatar-spark')}>${star(30,70,c.accent,1.05)}${star(146,45,c.coat,.8)}
      ${circle(147,82,3.5,c.accent)}${circle(33,121,2.5,c.coat)}
      ${line('M30 41l4 5m-13 6 6 1',c.coat,2.6)}${line('M149 137l4 4m-14 2 1 5',c.coat,2.6)}
    </g>`;
}

function hairBehind(id, c) {
  if (id === 'specific') return `${outlined('M49 57C34 65 26 52 32 42c-8-12 4-24 15-20 6-13 23-11 26 0 14-2 19 14 11 23L66 69Z',c.hair)}
    ${outlined('M116 55c17 11 31 0 27-13 11-10 3-25-10-24-8-10-23-6-23 6-15-1-20 16-9 27Z',c.hair)}
    ${path('M34 39c3-8 10-8 14-5m83-9c7 0 11 6 10 10','none','stroke="#544150" stroke-width="4" stroke-linecap="round"')}`;
  if (id === 'evidence') return `${outlined('M58 52C44 53 44 37 54 33c0-15 14-21 24-13 19-13 48-1 52 22l-4 48-22 19H62Z',c.hair)}
    ${outlined('M119 78c15 3 15 17 5 22 12 6 10 19-1 22 7 9 4 21-7 24l-6-11c-9-7-7-16 0-21-10-8-9-21 0-27Z',c.hair)}
    ${line('M119 93l-8 6m12 17-12 5m9 13-9 1','#dc8460',3.5)}${path('M109 138l15-3-2 10-10 2Z','#76b9e1')}`;
  if (id === 'concept') return `${outlined('M54 59C42 31 58 17 79 20c16-16 49 0 51 23 13 16 7 28 3 40 10 14 3 29-9 31l-21-8-35 10C49 116 41 98 49 84Z',c.hair)}
    ${line('M50 63c-4 11-2 17 4 22m74-34c5 9 4 18 0 23','#685073',3.5)}`;
  if (id === 'careful') return `${outlined('M52 61c-6-30 16-40 40-39 27-1 42 15 38 43l-9 38-57 2Z',c.hair)}
    ${outlined('M56 82c-10 7-11 16-5 24-6 9-4 20 6 24l8-9c3-6 1-11-3-15 7-8 5-17-2-23Z',c.hair)}
    ${outlined('M123 82c10 7 11 16 5 24 6 9 4 20-6 24l-8-9c-3-6-1-11 3-15-7-8-5-17 2-23Z',c.hair)}
    ${line('M52 98l10 6m-11 13 10 4m64-23-10 6m11 13-10 4','#538177',3)}
    ${path('M48 123l12-2 4 8-12 2Z',c.accent)}${path('M119 121l12 2-4 8-12-2Z',c.accent)}`;
  if (id === 'complete') return `${outlined('M52 62C36 51 40 35 52 30c-1-13 17-20 28-11 10-14 27-7 30 2 16-2 27 11 24 24 12 10 7 28-4 35l-10 13-60-2Z',c.hair)}
    ${line('M50 45c-2-6 3-12 9-11m18-13c4-2 9-1 12 3m27 5c6 0 10 6 9 11','#6f4d72',4)}`;
  return outlined('M53 62C45 39 58 18 80 19c19-13 46 4 49 24l-2 40-68 9Z',c.hair);
}

function outfit(id, c, motion) {
  const coat = `${outlined('M74 110c-19 2-32 14-37 38-1 5 3 9 9 10l14 2 2 10h58l3-10 14-2c7-1 10-5 8-12-6-22-19-33-37-36Z',c.coat)}
    ${path('M116 121c13 6 18 20 19 29l-17 7-1 13H94l13-57Z',c.dark)}
    ${outlined('M76 105v14c0 12 29 12 29-1v-14Z',c.skin,2.5)}
    ${path('M76 108v9c7 7 18 8 29 0v-9Z',c.shade)}
    ${path('M73 115l17 12 18-12-3 55H77Z',c.shirt)}
    ${outlined('M74 112l-10 8 9 13-6 8 17 29 3-44Z',c.light,2.2)}
    ${outlined('M107 112l10 9-9 12 6 8-19 29-2-44Z',c.light,2.2)}
    ${line('M52 135l7 14m68-15-6 14',c.dark,2.5)}
    ${outlined('M45 145c-6-2-9 2-7 7 2 7 11 10 18 5l8-6c3-4-2-8-6-5l-4 2-3-7c-2-4-7-1-6 4Z',c.skin,2.3)}
    ${path('M88 131h4v36h-4Z',c.light)}${circle(90,142,1.7,c.dark)}${circle(90,152,1.7,c.dark)}
    ${outlined('M60 132h12v15H60Z','#fffaf0',1.7)}${line('M63 136h6m-6 4h4',c.coat,1.8)}
    ${path('M64 129h5v5h-5Z',c.accent)}`;
  const accent = id === 'reasoning' ? `${path('M45 126l10-7 3 8-10 6Z',c.accent)}${circle(51,127,1.6,INK)}`
    : id === 'complete' ? `${outlined('M62 113l-8 7 10 10 14-13Z',c.dark,2)}${outlined('M111 113l12 8-12 10-14-13Z',c.dark,2)}`
      : id === 'keywords' ? `${path('M103 145h10v12h-10Z',c.dark)}${line('M105 146v-6m5 6v-4',c.accent,2.3)}` : '';
  return `${coat}${accent}<g${motion('sc-avatar-hand')}>${prop(id,c)}
    ${outlined('M133 132c-5-1-9 2-8 7 2 7 11 10 17 5 4-3 5-8 1-10-3-1-4 2-6 3l1-6c0-3-4-4-5 1Z',c.skin,2.3)}
    ${line('M133 141l5 1',c.shade,1.8)}</g>`;
}

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

function face(id, c, motion) {
  const face = `${ellipse(56,76,8,11,c.skin,`stroke="${INK}" stroke-width="2.4"`)}${ellipse(126,76,8,11,c.skin,`stroke="${INK}" stroke-width="2.4"`)}
    ${line('M54 74l4 5m70-5-4 5',c.shade,2)}
    ${outlined('M57 62c-1-23 12-36 33-36s36 14 35 37v14c0 23-15 36-34 36S57 100 57 78Z',c.skin,2.8)}
    ${path('M118 49c2 8 2 18 2 27 0 23-14 33-30 33-12 0-21-5-27-13 5 11 15 17 28 17 19 0 34-13 34-36V63c0-6-2-11-7-14Z',c.shade)}
    ${ellipse(67,87,7,4,'#e6837a','opacity=".52"')}${ellipse(114,87,7,4,'#e6837a','opacity=".48"')}
    ${line('M88 82l-3 7c2 2 5 2 7 1',c.shade,2.1)}`;
  const eyes = `<g${motion('sc-avatar-blink')}>
    ${ellipse(75,75,6.5,8.2,'#fffdf7')}${ellipse(105,75,6.5,8.2,'#fffdf7')}
    ${ellipse(76,76,3.9,5.7,INK)}${ellipse(104,76,3.9,5.7,INK)}
    ${circle(77.4,73.5,1.6,'#fff')}${circle(105.4,73.5,1.6,'#fff')}
    ${line('M69 71c3-3 7-3 11 0m19 0c3-3 7-3 11 0',INK,1.5)}</g>`;
  const brows = id === 'specific' ? line('M67 64c4-3 9-3 13-1m20 0c4-5 9-5 13-2',c.hair,3)
    : id === 'reasoning' ? line('M67 64l12-2m22 0 11 3',c.hair,3)
      : line('M67 64c4-3 9-3 13-1m20 0c4-3 9-3 13 1',c.hair,3);
  const mouth = id === 'complete' ? `${outlined('M80 96c6 3 15 3 22-1-1 12-19 16-22 1Z','#763e49',1.9)}${path('M84 98h6v6h-6Zm9 0h6l-1 5h-5Z','#fffdf5')}${path('M87 106c4-4 9-3 11-1-3 4-8 5-11 1Z','#e79092')}`
    : id === 'careful' || id === 'concept' ? `${line('M81 97c5 6 13 5 19-1',INK,2.3)}${line('M88 102h5',c.shade,1.7)}`
      : `${outlined('M79 96c8 4 16 4 24-1-1 12-20 15-24 1Z','#763e49',1.9)}${path('M82 98c5 2 12 2 17 0l-1 4c-5 2-10 2-14 0Z','#fffdf5')}${path('M86 106c4-3 8-3 11-2-2 4-7 5-11 2Z','#e79092')}`;
  const freckles = id === 'evidence' || id === 'careful' ? `${circle(64,84,1.1,c.shade)}${circle(69,82,1.1,c.shade)}${circle(71,87,1.1,c.shade)}${circle(111,83,1.1,c.shade)}${circle(116,84,1.1,c.shade)}${circle(113,88,1.1,c.shade)}` : '';
  return face + eyes + brows + mouth + freckles;
}

function hairFront(id, c) {
  if (id === 'comparison') return `${outlined('M54 65C42 53 48 42 54 40c-3-13 10-23 21-18 7-12 23-10 29 0 14-2 25 7 26 20 8 9 5 21-4 27l-4-16c-9 3-17-2-21-10-5 12-17 16-28 11l-8 13-2-10Z',c.hair)}
    ${line('M58 41c-1-6 4-10 10-10m9-8c5-3 11 0 12 4m19 1c6 0 10 4 10 10','#595070',4)}
    ${outlined('M111 44l13 6-3 7-13-6Z',c.accent,1.7)}
    ${outlined('M61 68c9-4 19-4 26 0v11c-2 11-23 11-25 0Zm34 0c8-4 18-4 25 0l-1 11c-2 11-23 11-24 0Z','none',2.4)}${line('M87 72h8',INK,2.4)}`;
  if (id === 'specific') return `${outlined('M54 63C47 44 60 29 77 29c22-15 48 2 48 27l-3 10-5-16c-16 5-30-1-38-10-2 13-12 20-25 23Z',c.hair)}
    ${line('M65 40c8-5 17-5 23-1','#504050',3.4)}
    ${outlined('M48 47l10-2 4 8-11 4Z',c.accent,1.7)}${outlined('M119 42l10 3-2 9-11-3Z',c.accent,1.7)}
    ${circle(54,86,2.8,c.accent,`stroke="${INK}" stroke-width="1.4"`)}${circle(128,86,2.8,c.accent,`stroke="${INK}" stroke-width="1.4"`)}`;
  if (id === 'evidence') return `${outlined('M53 60c-6-14 7-30 23-30 22-13 45 1 49 23l-1 11-7-16c-6 5-13 6-23 2l4-11c-10 13-23 17-36 14l-5 14Z',c.hair)}
    ${line('M61 44c9 2 20-2 26-9m21 0c5 2 8 5 10 10','#dd8963',4)}
    ${outlined('M55 54l6-12 7 3-6 12Z','#ffd469',1.6)}
    ${path('M117 62l5 10-3 4-6-12Z',c.hair)}`;
  if (id === 'keywords') return `${outlined('M55 63C46 47 54 31 67 30l-4-10c15 7 24-5 31-5 3 7 1 13-1 15 13-6 27-1 32 10l-3 26-7-18c-9 8-27 11-40 6l-14 17Z',c.hair)}
    ${line('M70 40c12 3 23-3 30-5','#4c6080',4)}
    ${outlined('M50 65h8v21h-8c-4 0-6-4-6-10s2-11 6-11Zm75 0h6c4 0 6 5 6 11s-2 10-6 10h-6Z',c.coat,2.1)}
    ${line('M49 65c-2-27 18-45 43-45s40 18 40 44',c.dark,4.5)}${line('M50 69v12m79-12v12',c.light,2.3)}`;
  if (id === 'concept') return `${outlined('M51 67c-6-15 3-31 17-31 5-15 23-19 35-8 14 0 23 14 22 31l-4 10-7-23c-7 9-17 11-28 6l3-10c-6 13-18 17-30 15l-1 13Z',c.hair)}
    ${line('M59 45c5-5 13-6 20-5m23-8c8 1 14 8 16 14','#76557f',4)}
    ${path('M56 48c15-22 48-23 67 0l-3 6c-18-21-44-19-60 0Z',c.coat)}${star(114,42,c.accent,.8)}
    ${outlined('M62 69h24v13c-7 7-19 6-24-1Zm34 0h24v12c-5 7-17 8-24 1Z','none',2.3)}${line('M86 74h10',INK,2.3)}`;
  if (id === 'reasoning') return `${outlined('M54 64c-4-12 0-26 11-30l-6-10c13 5 16-8 31-8 14 0 14 10 23 11 10 2 15 12 13 24l-5 17-6-21c-14 11-34 13-51 6l-5 17Z',c.hair)}
    ${line('M68 38c12 4 26-1 33-6','#615058',4)}
    ${outlined('M59 37l61 2v9l-61-2Z',c.dark,2)}
    ${outlined('M64 34h18v14H64Zm31 0h18v14H95Z','#c2f1ea',2.4)}
    ${path('M68 37h10l-10 7Zm31 0h10l-10 7Z','#f0fffb')}${line('M83 40h10',INK,2.7)}`;
  if (id === 'careful') return `${outlined('M55 64c-4-14 4-27 19-29 17-8 42 0 47 19l-1 13-8-14c-9 4-22 4-28-3-5 9-14 11-23 8l-4 13Z',c.hair)}
    ${outlined('M48 43l9-17c17-9 43-9 62 0l13 17c-25 7-60 7-84 0Z',c.coat,2.5)}
    ${path('M55 39c20 5 46 5 68-1l-4-10c-10 5-18 3-23-3-11 7-23 7-37 5Z',c.light)}
    ${outlined('M43 43c22 9 65 10 96-1l3 8c-29 13-73 13-103 1Z',c.coat,2.4)}
    ${outlined('M88 30c9-3 14 0 13 5-1 6-8 8-13 3Z',c.dark,1.5)}${line('M89 37l9-4',c.light,1.4)}`;
  return `${outlined('M52 68c-9-13-4-28 7-32 1-11 16-18 25-10 9-10 24-7 28 3 14-1 23 12 18 24l-8 15-5-16c-9 5-21 2-25-5-10 12-24 10-30 6l-3 17Z',c.hair)}
    ${line('M62 39c4-7 11-8 17-3m14-6c6-3 12 0 14 5m12 5c6 4 7 9 4 13','#795778',4)}
    ${outlined('M53 57l10 2-2 10-11-2Z',c.coat,1.9)}${star(57,63,'#fff0b5',.48)}
    ${line('M109 64l7 1',c.hair,2.5)}`;
}

export function renderScienceCoachAvatar(id, {animated = true} = {}) {
  const key = typeof id === 'string' && Object.hasOwn(CAST, id) ? id : 'comparison';
  const c = CAST[key];
  const motion = name => animated ? ` class="${name}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" class="sc-avatar sc-avatar--${key}${animated ? '' : ' sc-avatar--still'}" aria-hidden="true" role="presentation" focusable="false" style="overflow:visible">
    ${backdrop(c,motion)}
    <g${motion('sc-avatar-float')}>${hairBehind(key,c)}${outfit(key,c,motion)}${face(key,c,motion)}${hairFront(key,c)}</g>
  </svg>`;
}
