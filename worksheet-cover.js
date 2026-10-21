/* Shared, printable subject artwork and cover editor. No network services required. */
(function (global) {
  'use strict';
  const doc = global.document;
  const base = new URL('.', doc?.currentScript?.src || global.location?.href || 'https://polymathlc.com.sg/');
  const logoUrl = new URL('assets/branding/polymath-learning-centre.png', base).href;
  const atlas = Object.freeze({
    math: new URL('assets/worksheet-covers/math-icons-v2.png', base).href,
    science: new URL('assets/worksheet-covers/science-icons-v2.png', base).href
  });
  // The generated sheets have slightly uneven gutters. Crop at their inspected
  // transparent seams, preserving the source files and every complete motif.
  const atlasCells = Object.freeze({
    math: { size:1254, x:[0,344,634,940,1254], y:[0,338,636,920,1254] },
    science: { size:1254, x:[0,312,638,958,1254], y:[0,338,643,933,1254] }
  });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const subject = value => /\b(?:maths?|mathematics|numeracy)\b/i.test(String(value || '')) ? 'math' : 'science';
  const bounded = (value, fallback, min, max) => value == null || !Number.isFinite(Number(value)) ? fallback : Math.min(max, Math.max(min, Number(value)));
  const layoutOf = value => ['frame','minimal','exam','exam-b'].includes(value) ? value : 'scattered';
  // ── The Big M cover (render() and the editor). ─────────────────────────────
  // Positions come from the approved A4 design (794 × 1123): left, top and width
  // are percentages of the sheet, then rotation and the atlas cell. They sit in
  // the margins, between the header and the title, between the title and the
  // student-fields card, and between the card and the footer — never on text.
  // decoration() keeps its legacy arrangements for Custom Paper and the two
  // standalone worksheet creators, which lay their text out differently.
  const DESIGN = 'big-m';
  const M_ICON_OPACITY = .38, M_TEXTURE_OPACITY = .6, M_FACET_OPACITY = 1;
  const M_ICONS = [[0.76,0.53,5.04,-9,0],[31.74,2.32,5.54,7,5],[37.28,10.51,4.28,11,4],[1.01,17.81,5.29,-12,14],[12.09,21.02,5.04,-9,3],[26.95,16.56,5.79,7,8],[41.56,22.26,5.04,0,13],[68.01,24.58,4.28,-5,7],[87.15,25.29,4.28,4,9],[94.71,17.45,4.03,-12,12],[1.01,35.62,4.03,-9,6],[94.96,33.13,4.03,7,11],[1.26,46.3,3.78,0,0],[94.71,43.46,4.03,-5,5],[8.06,53.43,4.79,11,10],[22.67,56.46,4.28,4,15],[37.78,53.07,5.04,-12,4],[54.16,56.99,4.28,-9,9],[70.03,53.43,5.04,7,14],[85.64,56.28,4.79,0,3],[1.01,65.89,4.03,-5,8],[94.96,69.46,4.03,11,13],[5.04,82.81,5.29,4,2],[20.15,87.27,4.53,-12,7],[35.52,82.1,5.04,-9,12],[50.88,87.8,4.28,7,1],[65.49,82.46,5.29,0,6],[80.6,87.44,4.53,-5,11],[91.69,81.75,5.04,11,0],[1.01,96.17,4.03,4,5],[94.96,96.35,4.03,-12,10]];
  // Edge sprinkles keep the margins and the top and bottom rows; airy keeps every other icon.
  const M_FRAME = [0,1,3,8,9,10,11,12,13,14,20,21,22,28,29,30];
  const M_AIRY = M_ICONS.map((_, i) => i).filter(i => i % 2 === 0);
  // The faceted Polymath "M" in the top-right corner, in the design's 794 × 320 band.
  const M_FACETS = [['597,-75 712,-190 836,-128 717,-14','#f2c3da'],['352,-50 449,-148 717,-14 620,85','#bfe3e7'],['352,-50 620,85 648,259 379,124','#ddf3f5'],['379,124 406,298 513,193','#a8d9df'],['379,124 475,228 513,193','#8ccbd3'],['620,85 836,-128 862,49 648,259','#fbddec'],['756,154 862,49 889,222','#f2c3da'],['756,154 804,177 862,49','#e6a7c6']];
  // Title and subtitle sizes are in cqw of the content width. Long titles step
  // down so the title block never grows past two full-size lines and into the
  // icons between the title and the student fields.
  const M_TITLE_SIZES = [8.8,7.6,6.6,5.8,5.1,4.5], M_TITLE_BUDGET = 8.8 * 1.05 * 2;
  const M_SUBTITLE_SIZES = [2.93,2.5,2.2], M_SUBTITLE_BUDGET = 2.93 * 1.4;
  const fitSize = (text, sizes, budget, em, lineHeight) => {
    const lines = String(text == null ? '' : text).split('\n').map(line => line.trim().length);
    const height = size => lines.reduce((n, len) => n + Math.max(1, Math.ceil(len * em * size / 100)), 0) * size * lineHeight;
    return sizes.find(size => height(size) <= budget + 1e-6) ?? sizes[sizes.length - 1];
  };
  // Covers saved before the Big M design stored the old, stronger artwork
  // intensities. Those are dropped so every cover gets the faint backdrop; size
  // and arrangement are still honoured.
  const artOf = (options = {}) => {
    const current = options.coverDesign === DESIGN;
    return {
      scale: bounded(options.scale ?? options.artworkScale, 1, .6, 1.4),
      opacity: current ? bounded(options.opacity ?? options.artworkOpacity, M_ICON_OPACITY, .15, 1) : M_ICON_OPACITY,
      textureOpacity: current ? bounded(options.textureOpacity ?? options.artworkTextureOpacity, M_TEXTURE_OPACITY, 0, 1) : M_TEXTURE_OPACITY,
      facetOpacity: bounded(options.facetOpacity ?? options.artworkFacetOpacity, M_FACET_OPACITY, 0, 1),
      layout: layoutOf(options.layout || options.artworkLayout)
    };
  };
  const printStyles = `
.cover-artwork{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.cover-artwork .wc-icon{position:absolute;display:block;aspect-ratio:1;overflow:hidden;transform:rotate(var(--wc-art-turn,0deg)) scale(var(--wc-art-scale,1));transform-origin:center;opacity:var(--wc-art-opacity,.72)}
.cover-artwork .wc-icon img{position:absolute!important;display:block!important;width:var(--wc-cell-width)!important;height:var(--wc-cell-height)!important;max-width:none!important;max-height:none!important;image-rendering:pixelated;object-fit:fill!important;margin:0!important;border:0!important;filter:none!important;opacity:1!important}
.cover-artwork .wc-textures{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:hidden;opacity:var(--wc-texture-opacity,.65)}
.wc-cover{position:relative;isolation:isolate;box-sizing:border-box;container-type:inline-size;display:grid;grid-template-rows:auto 1fr auto;min-height:260mm;width:100%;padding:18mm 16mm;background:#fff;color:#28474d;font-family:Georgia,'Times New Roman',serif;overflow:hidden;break-after:page;page-break-after:always}
.wc-cover>*:not(.cover-artwork){position:relative;z-index:1}
.wc-cover .wc-header{padding:0 3% 4%;border-bottom:1px solid #bddcde;text-align:center;font:600 clamp(9px,1.65cqw,13px)/1.5 Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;white-space:pre-line;overflow-wrap:anywhere}
.wc-cover .wc-center{align-self:center;display:flex;flex-direction:column;align-items:center;text-align:center;padding:10% 8% 13%;gap:0}
.wc-cover .wc-logo{display:block;width:28%;max-width:170px;height:auto;object-fit:contain;filter:saturate(.58) brightness(1.12);opacity:.88;margin:0 0 7%}
.wc-cover .wc-title{font:700 clamp(25px,6.5cqw,51px)/1.16 Georgia,'Times New Roman',serif;letter-spacing:-.025em;white-space:pre-line;overflow-wrap:anywhere;margin:0;color:#243c44}
.wc-cover .wc-subheader{font:italic clamp(13px,2.5cqw,20px)/1.5 Georgia,'Times New Roman',serif;white-space:pre-line;overflow-wrap:anywhere;color:#66888e;margin-top:5%}
.wc-cover .wc-fields{display:grid;grid-template-columns:1fr 1fr;gap:8%;width:100%;margin-top:14%;text-align:left}
.wc-cover .wc-field-label{font:600 clamp(9px,1.65cqw,12px)/1.4 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;overflow-wrap:anywhere}
.wc-cover .wc-field-line{height:6mm;border-bottom:1px solid #8cabad}
.wc-cover .wc-footer{border-top:1px solid #bddcde;padding:3% 3% 0;text-align:center;font:500 clamp(9px,1.5cqw,12px)/1.5 Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;white-space:pre-line;overflow-wrap:anywhere;color:#68868c}
.wc-cover [contenteditable=true]{border-radius:3px;outline:1px dashed transparent;min-width:30px;min-height:1.3em;cursor:text}
.wc-cover [contenteditable=true]:hover,.wc-cover [contenteditable=true]:focus{outline-color:#8bbcc3;background:#edf7f8}
.wc-cover [contenteditable=true]:empty:before{content:attr(aria-label);color:#a0b5b9;font-style:italic}
.wc-editor{box-sizing:border-box;width:min(1100px,96vw);max-width:96vw;max-height:94vh;border:1px solid #cfdee1;border-radius:16px;padding:0;background:#f5f9fa;color:#243c44;box-shadow:0 20px 90px #18343b45;font:14px/1.5 Arial,sans-serif}
.wc-editor::backdrop{background:#17343e80}
.wc-editor *{box-sizing:border-box}
.wc-editor .wc-editor-top,.wc-editor .wc-editor-actions{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:16px 22px;background:white}
.wc-editor .wc-editor-top h2{font-size:20px;margin:0;color:#243c44}
.wc-editor .wc-editor-top p{margin:3px 0 0;color:#617b83;font-size:13px}
.wc-editor .wc-editor-body{display:grid;grid-template-columns:minmax(240px,340px) minmax(0,1fr);gap:24px;padding:22px;overflow:auto;max-height:calc(94vh - 155px)}
.wc-editor .wc-editor-form{display:flex;flex-direction:column;gap:12px}
.wc-editor label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;color:#3e626a}
.wc-editor input:not([type=checkbox]):not([type=range]),.wc-editor textarea,.wc-editor select{width:100%;border:1px solid #bdcfd3;border-radius:7px;background:white;color:#243c44;font:14px/1.4 Arial,sans-serif;padding:9px}
.wc-editor textarea{resize:vertical;min-height:70px}
.wc-editor input[type=range]{width:100%;accent-color:#5a9da8}
.wc-editor .wc-check{flex-direction:row;align-items:center;gap:8px;font-size:13px}
.wc-editor .wc-editor-preview{width:100%;max-width:520px;aspect-ratio:210/297;align-self:start;background:white;box-shadow:0 3px 17px #25424a18}
.wc-editor .wc-editor-preview .wc-cover{height:100%;min-height:100%;padding:8.6% 7.6%;break-after:auto;page-break-after:auto}
.wc-editor .wc-editor-preview .wc-field-line{height:16px}
.wc-editor button{border:1px solid #c1d1d4;border-radius:8px;padding:9px 16px;background:white;color:#294950;font:600 14px/1.5 Arial,sans-serif;cursor:pointer}
.wc-editor button[type=submit]{background:#377d88;color:white;border-color:#377d88}
.wc-editor button:focus-visible,.wc-editor input:focus-visible,.wc-editor select:focus-visible,.wc-editor textarea:focus-visible{outline:3px solid #a3cfd7;outline-offset:2px}
.cover-artwork .wc-facets{position:absolute;left:0;top:0;display:block;width:100%;height:auto;aspect-ratio:794/320;overflow:hidden;opacity:var(--wc-facet-opacity,1)}
.wc-cover.wc-m{display:flex;flex-direction:column;align-items:stretch;padding:6.05% 7.05% 5.04%;color:#15323a;font-family:'Century Gothic','CenturyGothic','Jost','Avenir Next','Segoe UI',Arial,sans-serif;line-height:1.3;text-align:left}
.wc-cover.wc-m .wc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:3cqw}
.wc-cover.wc-m .wc-logo{display:block;flex:0 0 auto;width:24.6cqw;max-width:none;height:auto;margin:0;object-fit:contain;filter:none;opacity:1}
.wc-cover.wc-m .wc-pills{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:1.17cqw;min-width:0}
.wc-cover.wc-m .wc-pill{display:inline-block;box-sizing:border-box;min-width:4cqw;border-radius:999px;font-size:1.9cqw;font-weight:700;line-height:1.2;letter-spacing:.14em;white-space:nowrap;text-align:center}
.wc-cover.wc-m .wc-pill-level{padding:1.03cqw 2.05cqw;background:#1c7880;color:#fff}
.wc-cover.wc-m .wc-pill-subject{padding:.82cqw 1.84cqw;border:1.5px solid #1c7880;background:#fff;color:#1c7880;text-transform:uppercase}
.wc-cover.wc-m .wc-hero{display:flex;flex-direction:column;align-items:flex-start;margin-top:24.6cqw;min-width:0}
.wc-cover.wc-m .wc-eyebrow{max-width:100%;font-size:1.9cqw;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#1c7880;white-space:pre-line;overflow-wrap:anywhere}
.wc-cover.wc-m .wc-title{max-width:100%;margin:1.76cqw 0 0;font-family:inherit;font-size:var(--wc-title-size,8.8cqw);font-weight:700;line-height:1.05;letter-spacing:-.015em;color:#15323a;white-space:pre-line;overflow-wrap:anywhere;text-wrap:balance}
.wc-cover.wc-m .wc-bar{flex:0 0 auto;width:8.2cqw;height:.73cqw;margin-top:2.93cqw;border-radius:.44cqw;background:#c8107a}
.wc-cover.wc-m .wc-subtitle{max-width:100%;margin:2.64cqw 0 0;font-size:var(--wc-subtitle-size,2.93cqw);line-height:1.4;color:#4f6970;white-space:pre-line;overflow-wrap:anywhere}
.wc-cover.wc-m .wc-gap{flex:1 1 0;min-height:4cqw}
.wc-cover.wc-m .wc-tail{flex:0 0 28.4cqw}
.wc-cover.wc-m .wc-fields{display:grid;grid-template-columns:minmax(0,1fr) 22cqw;gap:2.93cqw 3.52cqw;box-sizing:border-box;width:auto;margin:0;padding:3.23cqw 3.81cqw;border:1.5px solid #bfd9dc;border-radius:2.64cqw;background:#fff;text-align:left}
.wc-cover.wc-m .wc-field{display:flex;flex-direction:column;gap:.88cqw;min-width:0}
.wc-cover.wc-m .wc-field-name{grid-column:1;grid-row:1}
.wc-cover.wc-m .wc-field-date{grid-column:1;grid-row:2}
.wc-cover.wc-m .wc-fields.wc-no-score{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
.wc-cover.wc-m .wc-no-score .wc-field-date{grid-column:2;grid-row:1}
.wc-cover.wc-m .wc-field-label{font-family:inherit;font-size:max(7px,1.61cqw);font-weight:700;line-height:1.25;letter-spacing:.18em;text-transform:uppercase;color:#1c7880;white-space:pre-line;overflow-wrap:anywhere}
.wc-cover.wc-m .wc-fields .wc-field-line{height:4.4cqw;border-bottom:1.5px solid #8fb7bc}
.wc-cover.wc-m .wc-score{grid-column:2;grid-row:1/span 2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.47cqw;min-width:0;padding:2.05cqw 1.47cqw;border-radius:2.05cqw;background:#eef8f9;text-align:center}
.wc-cover.wc-m .wc-score-row{display:flex;align-items:flex-end;gap:.88cqw}
.wc-cover.wc-m .wc-fields .wc-score-box{width:6.45cqw;height:5cqw}
.wc-cover.wc-m .wc-score-slash{font-size:4.4cqw;line-height:1;color:#8fb7bc}
.wc-cover.wc-m .wc-footer{display:flex;justify-content:space-between;align-items:center;gap:3cqw;margin:0;padding:2.05cqw 0 0;border-top:1px solid #cfe3e6;font-family:inherit;font-size:max(7px,1.76cqw);font-weight:400;line-height:1.3;letter-spacing:normal;text-transform:none;text-align:left;color:#4f6970;white-space:normal}
.wc-cover.wc-m .wc-footer-main{min-width:0;overflow-wrap:anywhere}
.wc-cover.wc-m .wc-org{font-weight:700;color:#15323a;white-space:pre-line}
.wc-cover.wc-m .wc-note{white-space:pre-line}
.wc-cover.wc-m .wc-site{flex:0 0 auto;white-space:nowrap}
.wc-editor .wc-editor-preview .wc-cover.wc-m{padding:6.05% 7.05% 5.04%}
.wc-editor .wc-editor-preview .wc-cover.wc-m .wc-fields .wc-field-line{height:4.4cqw}
.wc-editor .wc-editor-preview .wc-cover.wc-m .wc-fields .wc-score-box{height:5cqw}
.wc-editor .wc-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(min-width:701px){.wc-editor .wc-editor-preview{position:sticky;top:0}}
@media(max-width:700px){.wc-editor .wc-editor-body{grid-template-columns:1fr}.wc-editor .wc-editor-preview{max-width:430px;justify-self:center}.wc-editor .wc-editor-top,.wc-editor .wc-editor-actions{padding:12px 16px}.wc-editor .wc-editor-body{padding:16px}.wc-editor .wc-editor-top p{max-width:280px}}
@media print{.wc-editor{display:none!important}.wc-cover{height:260mm;min-height:260mm;print-color-adjust:exact;-webkit-print-color-adjust:exact}.wc-cover [contenteditable]{outline:none!important;background:none!important}.wc-cover [contenteditable]:empty:before{content:none}.cover-artwork{display:block!important}}
`;
  function ensureStyles(target = doc) {
    if (!target?.createElement || target.getElementById('worksheet-cover-styles')) return;
    const style = target.createElement('style');
    style.id = 'worksheet-cover-styles';
    style.textContent = printStyles;
    (target.head || target.documentElement).appendChild(style);
  }
  // The Big M cover leaves out the shapes that would sit under its facets.
  const M_SKIP_POLYGONS = new Set([1]), M_SKIP_DOTS = new Set([1,7,8]);
  function textures(design) {
    const big = design === DESIGN;
    const bubbles = [[8,12,26],[38,7,12],[198,286,30],[202,256,12],[17,188,7],[189,113,9],[85,52,6],[118,253,10],[57,234,5],[164,222,6],[203,80,5],[7,105,4]];
    const polygons = ['19,48 29,52 22,61','172,28 182,31 177,40 168,37','183,181 193,185 187,196','26,239 37,235 41,246 30,251','138,260 149,257 154,267 142,273','3,149 11,146 14,156 6,159','192,209 204,214 196,222','63,18 70,15 74,22 67,27','101,278 109,275 113,283 105,286','37,78 43,73 48,81'];
    const dots = [[54,34],[158,58],[199,143],[26,213],[77,270],[182,241],[12,65],[153,8],[101,24],[203,177]];
    const colours = ['#8bcfd0','#dfadcc','#b9b1df'];
    return `<svg class="wc-textures" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true"><g class="wc-bubbles">${bubbles.map(([cx,cy,r],i)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colours[i%3]}" fill-opacity="${i<4 ? '.27' : '.18'}"/>${i%2===0 ? `<circle cx="${cx+2}" cy="${cy-2}" r="${r*.64}" fill="none" stroke="${colours[(i+1)%3]}" stroke-width=".6" stroke-opacity=".3"/>` : ''}`).join('')}</g><g class="wc-polygons">${polygons.map((points,i)=>big && M_SKIP_POLYGONS.has(i) ? '' : `<polygon points="${points}" fill="${colours[(i+1)%3]}" fill-opacity=".25"${i%3===0 ? ` stroke="${colours[i%3]}" stroke-width=".5" stroke-opacity=".25"` : ''}/>`).join('')}</g><g fill="#a4d9d6" fill-opacity=".35">${dots.map(([cx,cy],i)=>big && M_SKIP_DOTS.has(i) ? '' : `<circle cx="${cx}" cy="${cy}" r="1.2"/>`).join('')}</g></svg>`;
  }
  function facets() {
    return `<svg class="wc-facets" viewBox="0 0 794 320" preserveAspectRatio="xMidYMin meet" aria-hidden="true">${M_FACETS.map(([points,fill])=>`<polygon points="${points}" fill="${fill}"/>`).join('')}</svg>`;
  }
  // One cropped atlas icon. Shared by every arrangement so the crop maths cannot drift.
  function iconHtml(key, cell, left, top, width, turn) {
    const grid = atlasCells[key], col = cell%4, row = Math.floor(cell/4);
    const x = grid.x[col], y = grid.y[row], w = grid.x[col+1]-x, h = grid.y[row+1]-y;
    return `<span class="wc-icon" data-icon="${key}-${cell}" data-crop="${x},${y},${w},${h}" style="left:${left}%;top:${top}%;width:${width}%;aspect-ratio:${w}/${h};--wc-art-turn:${turn}deg;--wc-cell-width:${grid.size/w*100}%;--wc-cell-height:${grid.size/h*100}%"><img src="${esc(atlas[key])}" alt="" draggable="false" style="left:${-x/w*100}%;top:${-y/h*100}%"></span>`;
  }
  // The Big M backdrop: faint textures, the faceted M and the designed icon sprinkle.
  function bigMDecoration(key, art) {
    const layout = ['frame','minimal'].includes(art.layout) ? art.layout : 'scattered';
    const picks = layout === 'frame' ? M_FRAME : layout === 'minimal' ? M_AIRY : M_ICONS.map((_, i) => i);
    return `<div class="cover-artwork" data-cover-subject="${key}" data-cover-layout="${layout}" data-cover-design="${DESIGN}" aria-hidden="true" style="--wc-art-scale:${art.scale};--wc-art-opacity:${art.opacity};--wc-texture-opacity:${art.textureOpacity};--wc-facet-opacity:${art.facetOpacity}">${textures(DESIGN)}${facets()}${picks.map(i => { const [left, top, width, turn, cell] = M_ICONS[i]; return iconHtml(key, cell, left, top, width, turn); }).join('')}</div>`;
  }
  function decoration(value, options = {}) {
    const key = subject(value);
    if (options.design === DESIGN) return bigMDecoration(key, artOf(Object.assign({}, options, { coverDesign: DESIGN })));
    const scale = bounded(options.scale ?? options.artworkScale, 1, .6, 1.4);
    const opacity = bounded(options.opacity ?? options.artworkOpacity, .72, .15, 1);
    const layout = layoutOf(options.layout || options.artworkLayout);
    const textureOpacity = bounded(options.textureOpacity ?? options.artworkTextureOpacity, .65, 0, 1);
    const scatter = [[3,2],[17,3],[79,2],[92,5],[7,13],[26,15],[45,13],[66,16],[86,14],[16,23],[36,22],[56,23],[76,22],[91,25],[2,35],[93,37],[2,48],[93,50],[2,62],[93,64],[6,78],[25,78],[45,78],[65,78],[85,78],[15,82],[34,82],[54,82],[74,82],[91,82],[3,92.5],[15,92.5],[81,92.5],[92,92.5]];
    const frame = [[4,3],[20,2],[40,2],[62,2],[80,3],[93,8],[88,18],[93,28],[88,38],[94,50],[88,61],[93,73],[87,82],[81,92.5],[56,82],[36,82],[16,82],[5,92.5],[7,78],[2,67],[7,54],[2,40],[9,28],[3,16]];
    const exam = [[0,14],[96,17],[0,28],[96,32],[0,43],[96,47],[0,55],[96,58],[12,61],[28,61],[44,61],[60,61],[76,61],[88,61],[5,69],[22,69],[38,69],[55,69],[72,69],[90,69],[9,77],[25,77],[40,77],[55,77],[70,77],[84,77],[93,77],[4,84],[18,84],[33,84],[48,84],[63,84],[78,84],[91,84]];
    const examB = [[0,14],[96,17],[0,24],[96,27],[0,34],[96,37],[0,44],[96,47],[0,54],[96,57],[0,64],[96,65],[4,69],[16,69],[28,69],[40,69],[52,69],[64,69],[76,69],[88,69],[6,75],[18,75],[30,75],[42,75],[54,75],[66,75],[78,75],[90,75],[4,81],[16,81],[28,81],[40,81],[52,81],[64,81]];
    const airy = [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,32].map(i=>scatter[i]);
    const positions = layout === 'exam-b' ? examB : layout === 'exam' ? exam : layout === 'frame' ? frame : layout === 'minimal' ? airy : scatter;
    return `<div class="cover-artwork" data-cover-subject="${key}" data-cover-layout="${layout}" aria-hidden="true" style="--wc-art-scale:${scale};--wc-art-opacity:${opacity};--wc-texture-opacity:${textureOpacity}">${textures()}${positions.map(([left,top],n) => {
      const width = (layout === 'exam' && n < 8) || (layout === 'exam-b' && n < 12) ? 3.2 : [5.4,6.4,4.8,5.8,6.7,5.5,6.1][n%7];
      return iconHtml(key, (n * 5) % 16, left, top, width, [-9,7,0,-5,11,4,-12][n%7]);
    }).join('')}</div>`;
  }
  const FIELD_NAMES = {header:'Centre name',title:'Worksheet title',subheader:'Small heading above the title',subtitle:'Line under the title',footer:'Footer note',level:'Level',nameLabel:'Name label',dateLabel:'Date label',scoreLabel:'Score label'};
  // The Big M cover: logo and level/subject pills, a left-aligned title block
  // with the magenta bar, a student-fields card and a footer, over the faint
  // backdrop. Option keys are the ones saved worksheets already store:
  // `subheader` is the small heading above the title, `header` is the centre
  // name in the footer and `footer` is the note beside it.
  function render(options = {}) {
    const has = key => options[key] != null && String(options[key]).trim() !== '';
    const text = (key, fallback) => esc(options[key] == null ? fallback : options[key]);
    const editable = key => options.editable ? ` contenteditable="true" spellcheck="false" data-wc-field="${key}" role="textbox" aria-label="${esc(FIELD_NAMES[key])}"` : '';
    const shown = key => options.editable || has(key);
    const classes = String(options.className || '').split(/\s+/).filter(v => /^[a-zA-Z0-9_-]+$/.test(v)).join(' ');
    const key = subject(options.subject);
    const title = options.title == null ? 'Worksheet' : options.title;
    const titleSize = fitSize(title, M_TITLE_SIZES, M_TITLE_BUDGET, .62, 1.05);
    const subtitleSize = fitSize(options.subtitle, M_SUBTITLE_SIZES, M_SUBTITLE_BUDGET, .55, 1.4);
    const field = (name, fallback, extra = '') => `<div class="wc-field${extra}"><div class="wc-field-label"${editable(name)}>${text(name, fallback)}</div><div class="wc-field-line"></div></div>`;
    // The card is Name and Date. The score box beside them can be switched off
    // (`score: false`), and the two lines then share the card's one row.
    const score = options.score !== false;
    const scoreBox = score ? `<div class="wc-score"><div class="wc-field-label"${editable('scoreLabel')}>${text('scoreLabel','Score')}</div><div class="wc-score-row"><div class="wc-field-line wc-score-box"></div><span class="wc-score-slash">/</span><div class="wc-field-line wc-score-box"></div></div></div>` : '';
    const fields = options.fields === false ? '' : `<div class="wc-fields${score ? '' : ' wc-no-score'}">${field('nameLabel','Name',' wc-field-name')}${scoreBox}${field('dateLabel','Date',' wc-field-date')}</div>`;
    const note = shown('footer') ? `<span class="wc-dot"> · </span><span class="wc-note"${editable('footer')}>${text('footer','')}</span>` : '';
    return `<div class="wc-cover wc-m${classes ? ' ' + classes : ''}" data-cover-subject="${key}" data-cover-design="${DESIGN}">
      ${bigMDecoration(key, artOf(options))}
      <div class="wc-top"><img class="wc-logo" src="${esc(logoUrl)}" width="2681" height="1957" alt="Polymath Learning Centre">
        <div class="wc-pills">${shown('level') ? `<span class="wc-pill wc-pill-level"${editable('level')}>${text('level','')}</span>` : ''}<span class="wc-pill wc-pill-subject">${key === 'math' ? 'Mathematics' : 'Science'}</span></div></div>
      <div class="wc-hero">${shown('subheader') ? `<div class="wc-eyebrow"${editable('subheader')}>${text('subheader','')}</div>` : ''}
        <h1 class="wc-title"${editable('title')} style="--wc-title-size:${titleSize}cqw">${esc(title)}</h1>
        <div class="wc-bar"></div>${shown('subtitle') ? `<p class="wc-subtitle"${editable('subtitle')} style="--wc-subtitle-size:${subtitleSize}cqw">${text('subtitle','')}</p>` : ''}</div>
      <div class="wc-gap"></div>${fields}<div class="wc-tail"></div>
      <div class="wc-footer"><span class="wc-footer-main"><span class="wc-org"${editable('header')}>${text('header','Polymath Learning Centre')}</span>${note}</span><span class="wc-site">polymathlc.com.sg</span></div></div>`;
  }
  function edit(options = {}) {
    ensureStyles();
    return new Promise(resolve => {
      const art = artOf(options);
      const value = {...options, subject:subject(options.subject), fields:options.fields !== false, score:options.score !== false, coverDesign:DESIGN,
        scale:art.scale, opacity:art.opacity, layout:['frame','minimal'].includes(art.layout) ? art.layout : 'scattered',
        textureOpacity:art.textureOpacity, facetOpacity:art.facetOpacity};
      const dialog = doc.createElement('dialog');
      dialog.className = 'wc-editor';
      dialog.setAttribute('aria-label','Edit worksheet cover');
      dialog.innerHTML = `<form method="dialog"><div class="wc-editor-top"><div><h2>Edit cover</h2><p>Change the fields or click text in the preview. Your changes appear in the export.</p></div><button type="button" data-wc-cancel aria-label="Close cover editor">×</button></div>
        <div class="wc-editor-body"><div class="wc-editor-form">
        <label>Subject artwork<select data-wc-input="subject"><option value="science">Science</option><option value="math">Mathematics</option></select></label>
        <label>Worksheet title<textarea data-wc-input="title" rows="2"></textarea></label>
        <label>Small heading above the title<input data-wc-input="subheader" placeholder="Topical worksheet"></label>
        <label>Line under the title<input data-wc-input="subtitle" placeholder="Optional, e.g. Circuits, conductors and insulators"></label>
        <div class="wc-editor-grid"><label>Level pill<input data-wc-input="level" placeholder="e.g. P5"></label><label>Footer note<input data-wc-input="footer"></label></div>
        <label>Centre name (footer)<input data-wc-input="header"></label>
        <label class="wc-check"><input type="checkbox" data-wc-input="fields"> Include student fields</label>
        <label class="wc-check"><input type="checkbox" data-wc-input="score"> Include score box</label>
        <div class="wc-editor-grid"><label>Name label<input data-wc-input="nameLabel"></label><label>Date label<input data-wc-input="dateLabel"></label>
        <label>Score label<input data-wc-input="scoreLabel"></label></div>
        <label>Icon arrangement<select data-wc-input="layout"><option value="scattered">Sprinkled across the page</option><option value="frame">Edges only</option><option value="minimal">Light sprinkle</option></select></label>
        <label>Icon size<input type="range" data-wc-input="scale" min="0.6" max="1.4" step="0.05"></label>
        <label>Icon visibility<input type="range" data-wc-input="opacity" min="0.15" max="1" step="0.01"></label>
        <label>Bubble &amp; polygon texture<input type="range" data-wc-input="textureOpacity" min="0" max="1" step="0.05"></label>
        <label>Big M corner<input type="range" data-wc-input="facetOpacity" min="0" max="1" step="0.05"></label>
        </div><div class="wc-editor-preview" aria-label="Editable cover preview"></div></div>
        <div class="wc-editor-actions"><button type="button" data-wc-cancel>Cancel</button><button type="submit">Use this cover</button></div></form>`;
      const defaults = {title:'Worksheet',header:'Polymath Learning Centre',subheader:'Worksheet',subtitle:'',level:'',footer:'',nameLabel:'Name',dateLabel:'Date',scoreLabel:'Score'};
      Object.keys(defaults).forEach(key => { if (value[key] == null) value[key] = defaults[key]; });
      const inputs = [...dialog.querySelectorAll('[data-wc-input]')];
      if (options.subjectLocked) dialog.querySelector('[data-wc-input="subject"]').disabled = true;
      // The score box lives on the student-fields card, so it has nothing to
      // switch while the card itself is off.
      const sync = () => inputs.forEach(input => { const key = input.dataset.wcInput; if(input.type === 'checkbox') input.checked = value[key]; else input.value = value[key] ?? ''; if(key === 'score') input.disabled = !value.fields; });
      const preview = dialog.querySelector('.wc-editor-preview');
      const draw = () => { preview.innerHTML = render({...value,className:'',editable:true}); };
      sync(); draw();
      inputs.forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.wcInput;
        value[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
        if (key === 'fields') sync();
        draw();
      }));
      preview.addEventListener('input', event => {
        const key = event.target.dataset.wcField;
        if (!key) return;
        value[key] = event.target.innerText;
        sync();
      });
      preview.addEventListener('paste', event => {
        if (!event.target.closest('[data-wc-field]')) return;
        event.preventDefault();
        doc.execCommand('insertText',false,event.clipboardData.getData('text/plain'));
      });
      let settled = false;
      const finish = result => { if(settled) return; settled = true; dialog.close(); dialog.remove(); resolve(result); };
      dialog.querySelectorAll('[data-wc-cancel]').forEach(button => button.addEventListener('click', () => finish(null)));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        finish({...value,artworkScale:value.scale,artworkOpacity:value.opacity,artworkLayout:value.layout,artworkTextureOpacity:value.textureOpacity,artworkFacetOpacity:value.facetOpacity});
      });
      doc.body.appendChild(dialog);
      dialog.showModal();
    });
  }
  global.WorksheetCover = Object.freeze({decoration,render,edit,ensureStyles,printStyles,logoUrl,subject,atlas,atlasCells,design:DESIGN});
  ensureStyles();
})(typeof window === 'undefined' ? globalThis : window);
