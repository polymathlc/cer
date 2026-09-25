/* Original science illustrations and Study Buddy companions for printable worksheets.
 * All SVG markup is a fixed local constant. User-written text is escaped before rendering.
 * Character provenance: assets/worksheet-characters/README.md.
 */
(function (root) {
  'use strict';

  var script = typeof document !== 'undefined' ? document.currentScript : null;
  var baseUrl = script && script.src ? script.src : (typeof location !== 'undefined' ? location.href : '');
  var characters = [
    { id: 'orbit', name: 'Orbit', label: 'Orbit the robot', color: '#087f8c', description: 'A curious teal robot with a golden antenna.' },
    { id: 'pip', name: 'Pip', label: 'Pip the fox', color: '#bd531c', description: 'An encouraging orange fox with a teal neckerchief.' },
    { id: 'nova', name: 'Nova', label: 'Nova the owl', color: '#784b86', description: 'A thoughtful plum owl with golden glasses.' }
  ];
  var poses = [
    { id: 'welcome', label: 'Welcome' },
    { id: 'thinking', label: 'Thinking' },
    { id: 'encourage', label: 'Encouraging' },
    { id: 'celebrate', label: 'Celebrating' }
  ];
  var bubbleTypes = [
    { id: 'hint', label: 'Hint' },
    { id: 'reminder', label: 'Reminder' },
    { id: 'tip', label: 'Tip' }
  ];
  var science = [
    { id: 'flask', label: 'Colourful flask', category: 'Investigations', description: 'A laboratory flask with turquoise liquid and bubbles.' },
    { id: 'microscope', label: 'Microscope', category: 'Investigations', description: 'A blue and coral microscope for exploring small things.' },
    { id: 'magnet', label: 'Magnet', category: 'Forces', description: 'A red and blue horseshoe magnet with visible north and south poles.' },
    { id: 'plant', label: 'Growing plant', category: 'Living things', description: 'A green seedling growing in a terracotta plant pot.' },
    { id: 'bulb', label: 'Bright idea', category: 'Energy', description: 'A glowing golden light bulb with teal accents.' },
    { id: 'planet', label: 'Ringed planet', category: 'Space', description: 'A purple planet with a golden ring and stars.' },
    { id: 'water', label: 'Water droplet', category: 'Water', description: 'A blue water droplet with ripples.' },
    { id: 'butterfly', label: 'Butterfly', category: 'Living things', description: 'A butterfly with coral and violet wings.' },
    { id: 'thermometer', label: 'Thermometer', category: 'Heat', description: 'A red thermometer with a scale and a small golden sun.' },
    { id: 'gears', label: 'Gears', category: 'Machines', description: 'Interlocking teal and gold gears.' },
    { id: 'test-tubes', label: 'Test tubes', category: 'Investigations', description: 'Three colourful test tubes in a blue laboratory rack.' },
    { id: 'leaf', label: 'Leaf', category: 'Living things', description: 'A green leaf with visible branching veins.' }
  ];

  // A common 160px viewBox keeps every illustration balanced in the picker and on paper.
  var drawings = {
    flask: '<circle cx="80" cy="80" r="66" fill="#e9f8f5"/><path d="M61 24h38M66 26v40l-31 55a12 12 0 0 0 10 18h70a12 12 0 0 0 10-18L94 66V26" fill="#fff" stroke="#315668" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M56 94h48l20 33a5 5 0 0 1-5 7H41a5 5 0 0 1-5-7Z" fill="#29b8aa"/><path d="M58 95c15-12 28 10 45 0" fill="none" stroke="#087f8c" stroke-width="4"/><circle cx="70" cy="114" r="6" fill="#b9f2de"/><circle cx="96" cy="121" r="4" fill="#e2fff1"/><circle cx="82" cy="78" r="5" fill="#ffc45b"/><circle cx="73" cy="50" r="4" fill="#76c9d5"/><path d="m119 44 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z" fill="#f5b331"/>',
    microscope: '<circle cx="80" cy="80" r="66" fill="#eef4ff"/><path d="M82 54c34 3 50 36 27 63" fill="none" stroke="#365d89" stroke-width="15" stroke-linecap="round"/><path d="m52 41 19-13 33 43-19 14Z" fill="#60acc8" stroke="#315668" stroke-width="4" stroke-linejoin="round"/><path d="m48 36 22-15 9 12-22 15Z" fill="#ef8e79" stroke="#315668" stroke-width="4"/><path d="m83 82 18-12 7 10-18 12Z" fill="#34556b"/><path d="M47 104h46M68 105v25" fill="none" stroke="#315668" stroke-width="6" stroke-linecap="round"/><path d="M43 136c0-10 8-17 18-17h54c10 0 16 7 16 17Z" fill="#65aec8" stroke="#315668" stroke-width="4"/><circle cx="107" cy="80" r="10" fill="#f6bf5c" stroke="#315668" stroke-width="4"/><path d="M54 96h30" stroke="#ef8e79" stroke-width="5" stroke-linecap="round"/>',
    magnet: '<circle cx="80" cy="80" r="66" fill="#fff4e6"/><path d="M40 38v50a40 40 0 0 0 80 0V38H96v50a16 16 0 0 1-32 0V38Z" fill="#ec7979" stroke="#424f65" stroke-width="4" stroke-linejoin="round"/><path d="M80 128a40 40 0 0 0 40-40V38H96v50a16 16 0 0 1-16 16Z" fill="#65a6d8"/><path d="M40 38h24v21H40ZM96 38h24v21H96Z" fill="#fff" stroke="#424f65" stroke-width="4"/><path d="M47 53V44l10 9v-9M111 44h-8v4h8v5h-8" fill="none" stroke="#424f65" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m24 49-9-4m11 24-11 2m117-22 10-4m-10 24 11 2M55 21l-3-8m55 8 3-8" stroke="#e2ac35" stroke-width="4" stroke-linecap="round"/>',
    plant: '<circle cx="80" cy="80" r="66" fill="#eff8e7"/><path d="M81 106V58" stroke="#46774a" stroke-width="5" stroke-linecap="round"/><path d="M80 81C43 84 32 61 34 43c32-1 49 12 46 38Z" fill="#82bc67" stroke="#46774a" stroke-width="3"/><path d="M81 66c-2-29 19-45 46-44 2 31-17 49-46 44Z" fill="#57a97c" stroke="#46774a" stroke-width="3"/><path d="m48 56 32 25m3-17 29-28" stroke="#d8edbb" stroke-width="3" stroke-linecap="round"/><path d="m47 100 10 39h46l10-39" fill="#dc9977" stroke="#8b5947" stroke-width="4" stroke-linejoin="round"/><rect x="41" y="94" width="78" height="15" rx="4" fill="#f1b28e" stroke="#8b5947" stroke-width="4"/><path d="M63 116h33" stroke="#eab495" stroke-width="4" stroke-linecap="round"/>',
    bulb: '<circle cx="80" cy="80" r="66" fill="#fff8dd"/><path d="M105 83c8-7 12-16 12-26a37 37 0 0 0-74 0c0 11 5 21 13 28 8 7 11 14 11 23h26c0-10 4-18 12-25Z" fill="#ffd36d" stroke="#9c7432" stroke-width="4"/><path d="m69 69 11 10 11-10M80 79v27" stroke="#bc8a32" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M68 108h25v19H68Z" fill="#78b9bb" stroke="#315668" stroke-width="4"/><path d="M68 116h25M73 131h15" stroke="#315668" stroke-width="4" stroke-linecap="round"/><path d="M57 53c0-9 6-16 14-19" stroke="#fff4c8" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M80 7v-4M29 35l-9-5m113 5 9-5M20 71H9m131 0h11m-23 27 9 6m-107-6-9 6" stroke="#d6a333" stroke-width="4" stroke-linecap="round"/>',
    planet: '<circle cx="80" cy="80" r="66" fill="#f3edfb"/><circle cx="80" cy="78" r="40" fill="#9d7bc5" stroke="#624d8d" stroke-width="4"/><path d="M48 59c20 14 42 12 65 3M43 78c17 11 46 17 73 7M48 95c13 7 38 13 53 11" fill="none" stroke="#bda3df" stroke-width="6"/><path d="M40 77c-19 15-26 27-20 32 9 9 42-1 72-17s56-37 50-44c-5-6-20-2-35 4" fill="none" stroke="#bb862d" stroke-width="13" stroke-linecap="round"/><path d="M40 77c-19 15-26 27-20 32 9 9 42-1 72-17s56-37 50-44c-5-6-20-2-35 4" fill="none" stroke="#f6c36a" stroke-width="8" stroke-linecap="round"/><path d="m34 30 3-8 3 8 8 3-8 3-3 8-3-8-8-3Zm90 96 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z" fill="#d4a53e"/><circle cx="113" cy="24" r="3" fill="#8d6bae"/>',
    water: '<circle cx="80" cy="80" r="66" fill="#e9f7fd"/><ellipse cx="80" cy="128" rx="51" ry="13" fill="#bfe7ed"/><ellipse cx="80" cy="128" rx="29" ry="6" fill="none" stroke="#81cbd6" stroke-width="3"/><path d="M80 21c-9 19-35 42-35 64a35 35 0 0 0 70 0c0-22-26-45-35-64Z" fill="#62bddc" stroke="#327e9b" stroke-width="4"/><path d="M62 76c-7 11-4 22 3 28" stroke="#d7f5fb" stroke-width="7" fill="none" stroke-linecap="round"/><path d="m126 58 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z" fill="#f1c45c"/><circle cx="34" cy="44" r="5" fill="#8ed4df"/>',
    butterfly: '<circle cx="80" cy="80" r="66" fill="#fff0ec"/><path d="M75 77C40 18 13 33 23 70c5 18 29 20 51 16-39-2-43 37-22 42 19 5 30-25 28-40" fill="#f29d8b" stroke="#a85f61" stroke-width="4" stroke-linejoin="round"/><path d="M85 77c35-59 62-44 52-7-5 18-29 20-51 16 39-2 43 37 22 42-19 5-30-25-28-40" fill="#af8bc7" stroke="#77598f" stroke-width="4" stroke-linejoin="round"/><path d="M59 65c-13-17-26-15-22-2 3 10 14 13 25 12" fill="#fbc76e"/><path d="M101 65c13-17 26-15 22-2-3 10-14 13-25 12" fill="#dcc5e9"/><ellipse cx="58" cy="108" rx="8" ry="11" fill="#ffdba7" transform="rotate(25 58 108)"/><ellipse cx="102" cy="108" rx="8" ry="11" fill="#e6d4f0" transform="rotate(-25 102 108)"/><path d="M80 69v41m-4-43-7-15m15 15 7-15" stroke="#4d4c60" stroke-width="5" stroke-linecap="round"/><circle cx="80" cy="70" r="7" fill="#4d4c60"/>',
    thermometer: '<circle cx="80" cy="80" r="66" fill="#fff1e5"/><path d="M66 99V36a14 14 0 0 1 28 0v63a26 26 0 1 1-28 0Z" fill="#fff" stroke="#526174" stroke-width="4"/><path d="M80 61v49" stroke="#e87470" stroke-width="11" stroke-linecap="round"/><circle cx="80" cy="121" r="15" fill="#e87470"/><path d="M89 43h-9m9 14h-5m5 15h-5m5 14h-9" stroke="#526174" stroke-width="3" stroke-linecap="round"/><circle cx="124" cy="44" r="11" fill="#f6c45d"/><path d="M124 25v-4m0 46v-4m19-19h4m-46 0h4m6-13-3-3m30 30-3-3m0-24 3-3m-30 30 3-3" stroke="#c29330" stroke-width="3" stroke-linecap="round"/><path d="M35 83h11m-5-8 8 8-8 8" fill="none" stroke="#e7a47c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    gears: '<circle cx="80" cy="80" r="66" fill="#eef8f5"/><g transform="translate(62 64)" fill="#55aaab" stroke="#346f7e" stroke-width="3" stroke-linejoin="round"><path d="m-9-36 18 0 3 9 7 3 9-4 12 13-5 9 3 7 10 3v18l-10 3-3 7 5 9-12 12-9-4-7 3-3 10H-9l-3-10-7-3-9 4-12-12 5-9-3-7-10-3V4l10-3 3-7-5-9 12-13 9 4 7-3Z" transform="scale(.83)"/><circle cx="0" cy="10" r="13" fill="#e5f4ed"/></g><g transform="translate(108 109)" fill="#f2c25d" stroke="#a98335" stroke-width="3" stroke-linejoin="round"><path d="m-6-27 12 0 3 8 7 3 8-3 9 9-4 8 3 7 8 3v12l-8 3-3 7 4 8-9 9-8-4-7 3-3 8H-6l-3-8-7-3-8 4-9-9 4-8-3-7-8-3V8l8-3 3-7-4-8 9-9 8 3 7-3Z" transform="scale(.72)"/><circle cx="0" cy="10" r="9" fill="#fff3d7"/></g>',
    'test-tubes': '<circle cx="80" cy="80" r="66" fill="#edf5fc"/><path d="M35 37v65a10 10 0 0 0 20 0V37m15 0v65a10 10 0 0 0 20 0V37m15 0v65a10 10 0 0 0 20 0V37" fill="#fff" stroke="#496778" stroke-width="4"/><path d="M39 67h12v34a6 6 0 0 1-12 0Z" fill="#ed9785"/><path d="M74 83h12v18a6 6 0 0 1-12 0Z" fill="#72c4b2"/><path d="M109 58h12v43a6 6 0 0 1-12 0Z" fill="#b296d0"/><path d="M32 37h26m9 0h26m9 0h26" stroke="#496778" stroke-width="5" stroke-linecap="round"/><path d="M25 84v47h110V84M25 91h110M21 132h118" fill="none" stroke="#5189a5" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><circle cx="44" cy="52" r="4" fill="#f4c96c"/><circle cx="115" cy="26" r="5" fill="#bc9cd4"/><circle cx="81" cy="61" r="4" fill="#87cebb"/>',
    leaf: '<circle cx="80" cy="80" r="66" fill="#f1f8e5"/><path d="M38 112C17 65 51 27 128 27c7 68-27 103-77 96Z" fill="#77b777" stroke="#407748" stroke-width="4" stroke-linejoin="round"/><path d="M29 137 110 45M53 108l-3-38m24 14 2-35m-5 40 35 2m-51 18 31 4m7-42 20 1" stroke="#e0efbd" stroke-width="4" fill="none" stroke-linecap="round"/><path d="m29 137 23-26" stroke="#407748" stroke-width="5" stroke-linecap="round"/><path d="m133 111 3-6 3 6 6 3-6 3-3 6-3-6-6-3Z" fill="#e4b649"/>'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function find(list, id) {
    return list.filter(function (entry) { return entry.id === id; })[0];
  }
  function scienceSvg(id) {
    var item = find(science, id);
    if (!item) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" class="wa-science-svg" viewBox="0 0 160 160" role="img" aria-label="' + escapeHtml(item.label) + '"><title>' + escapeHtml(item.description) + '</title>' + drawings[id] + '</svg>';
  }
  function characterSrc(id, pose) {
    if (!find(characters, id)) id = 'orbit';
    if (!find(poses, pose)) pose = 'welcome';
    var path = 'assets/worksheet-characters/' + id + '-' + pose + '.webp';
    try { return new URL(path, baseUrl).href; } catch (e) { return path; }
  }
  function renderCharacter(id, pose) {
    var character = find(characters, id) || characters[0];
    var selectedPose = find(poses, pose) || poses[0];
    return '<img class="wa-character-image" src="' + escapeHtml(characterSrc(character.id, selectedPose.id)) + '" alt="' + escapeHtml(character.label + ', ' + selectedPose.label.toLowerCase()) + '" width="128" height="128" decoding="sync">';
  }
  function renderScience(id, caption) {
    var svg = scienceSvg(id);
    if (!svg) return '';
    return '<figure class="wa-science">' + svg + (caption ? '<figcaption>' + escapeHtml(caption) + '</figcaption>' : '') + '</figure>';
  }
  function renderElement(element) {
    element = element || {};
    var size = ['small', 'medium', 'large'].indexOf(element.size) >= 0 ? element.size : 'medium';
    if (element.kind === 'science' || element.type === 'science') {
      var illustration = renderScience(element.artId || element.scienceId || element.id, element.caption || element.text);
      return illustration ? '<div class="wa-element wa-size-' + size + '">' + illustration + '</div>' : '';
    }
    if (element.kind !== 'character' && element.type !== 'character') return '';
    var character = find(characters, element.character || element.characterId) || characters[0];
    var bubbleType = find(bubbleTypes, element.bubbleType) || bubbleTypes[0];
    var hasText = !!String(element.text || '').trim();
    return '<div class="wa-element wa-companion wa-' + character.id + ' wa-size-' + size + '">' + renderCharacter(character.id, element.pose) +
      (hasText ? '<div class="wa-speech"><strong class="wa-speech-label">' + escapeHtml(character.name + '’s ' + bubbleType.label.toLowerCase()) + '</strong><div class="wa-speech-text">' + escapeHtml(element.text) + '</div></div>' : '') + '</div>';
  }
  function styles() {
    return '.wa-science{display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0;break-inside:avoid;page-break-inside:avoid;}' +
      '.wa-element{max-width:100%;margin:10px 0;}' +
      '.wa-science-svg{display:block;width:128px;max-width:100%;height:auto;flex-shrink:0;}' +
      '.wa-size-small .wa-science-svg{width:88px;}.wa-size-large .wa-science-svg{width:192px;}' +
      '.wa-science figcaption{max-width:100%;margin-top:5px;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.45;color:#334155;}' +
      '.wa-companion{--wa-accent:#087f8c;display:flex;align-items:center;gap:12px;max-width:100%;break-inside:avoid;page-break-inside:avoid;}' +
      '.wa-pip{--wa-accent:#bd531c;}.wa-nova{--wa-accent:#784b86;}' +
      '.wa-character-image{display:block;flex:0 0 112px;width:112px;height:112px;max-width:40%;object-fit:contain;}' +
      '.wa-size-small{--wa-character-size:80px;}.wa-size-large{--wa-character-size:152px;}' +
      '.wa-element.wa-companion>.wa-character-image{flex-basis:var(--wa-character-size,112px);width:var(--wa-character-size,112px)!important;height:var(--wa-character-size,112px)!important;max-width:40%!important;max-height:none!important;margin:0!important;}' +
      '.wa-speech{position:relative;min-width:0;flex:1;padding:14px 17px;border:2px solid var(--wa-accent);border-radius:18px;background:#fff;color:#24364a;}' +
      '.wa-speech:before{content:"";position:absolute;left:-8px;top:calc(50% - 7px);width:12px;height:12px;background:#fff;border-left:2px solid var(--wa-accent);border-bottom:2px solid var(--wa-accent);transform:rotate(45deg);}' +
      '.wa-speech-label{display:block;color:var(--wa-accent);font-size:11px;letter-spacing:.035em;margin-bottom:5px;}' +
      '.wa-speech-text{font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;}' +
      '@media print{.wa-science,.wa-companion,.wa-speech,.wa-science-svg{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.wa-science,.wa-companion{break-inside:avoid;page-break-inside:avoid;}}';
  }

  root.WorksheetArt = Object.freeze({
    science: science, characters: characters, poses: poses, bubbleTypes: bubbleTypes,
    scienceSvg: scienceSvg, characterSrc: characterSrc, renderScience: renderScience,
    renderCharacter: renderCharacter, renderElement: renderElement, styles: styles, escapeHtml: escapeHtml
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WorksheetArt;
})(typeof window !== 'undefined' ? window : globalThis);
