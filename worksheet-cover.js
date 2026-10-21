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
  function textures() {
    const bubbles = [[8,12,26],[38,7,12],[198,286,30],[202,256,12],[17,188,7],[189,113,9],[85,52,6],[118,253,10],[57,234,5],[164,222,6],[203,80,5],[7,105,4]];
    const polygons = ['19,48 29,52 22,61','172,28 182,31 177,40 168,37','183,181 193,185 187,196','26,239 37,235 41,246 30,251','138,260 149,257 154,267 142,273','3,149 11,146 14,156 6,159','192,209 204,214 196,222','63,18 70,15 74,22 67,27','101,278 109,275 113,283 105,286','37,78 43,73 48,81'];
    const colours = ['#8bcfd0','#dfadcc','#b9b1df'];
    return `<svg class="wc-textures" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true"><g class="wc-bubbles">${bubbles.map(([cx,cy,r],i)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colours[i%3]}" fill-opacity="${i<4 ? '.27' : '.18'}"/>${i%2===0 ? `<circle cx="${cx+2}" cy="${cy-2}" r="${r*.64}" fill="none" stroke="${colours[(i+1)%3]}" stroke-width=".6" stroke-opacity=".3"/>` : ''}`).join('')}</g><g class="wc-polygons">${polygons.map((points,i)=>`<polygon points="${points}" fill="${colours[(i+1)%3]}" fill-opacity=".25"${i%3===0 ? ` stroke="${colours[i%3]}" stroke-width=".5" stroke-opacity=".25"` : ''}/>`).join('')}</g><g fill="#a4d9d6" fill-opacity=".35">${[[54,34],[158,58],[199,143],[26,213],[77,270],[182,241],[12,65],[153,8],[101,24],[203,177]].map(([cx,cy])=>`<circle cx="${cx}" cy="${cy}" r="1.2"/>`).join('')}</g></svg>`;
  }
  function decoration(value, options = {}) {
    const key = subject(value);
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
      const i = (n * 5) % 16;
      const width = (layout === 'exam' && n < 8) || (layout === 'exam-b' && n < 12) ? 3.2 : [5.4,6.4,4.8,5.8,6.7,5.5,6.1][n%7];
      const turn = [-9,7,0,-5,11,4,-12][n%7];
      const grid = atlasCells[key], col = i%4, row = Math.floor(i/4);
      const x = grid.x[col], y = grid.y[row], w = grid.x[col+1]-x, h = grid.y[row+1]-y;
      return `<span class="wc-icon" data-icon="${key}-${i}" data-crop="${x},${y},${w},${h}" style="left:${left}%;top:${top}%;width:${width}%;aspect-ratio:${w}/${h};--wc-art-turn:${turn}deg;--wc-cell-width:${grid.size/w*100}%;--wc-cell-height:${grid.size/h*100}%"><img src="${esc(atlas[key])}" alt="" draggable="false" style="left:${-x/w*100}%;top:${-y/h*100}%"></span>`;
    }).join('')}</div>`;
  }
  function render(options = {}) {
    const text = (key, fallback) => esc(options[key] == null ? fallback : options[key]);
    const editable = key => options.editable ? ` contenteditable="true" spellcheck="false" data-wc-field="${key}" role="textbox" aria-label="${esc({header:'Cover header',title:'Worksheet title',subheader:'Subtitle',footer:'Footer',nameLabel:'Name label',dateLabel:'Date label'}[key])}"` : '';
    const classes = String(options.className || '').split(/\s+/).filter(v => /^[a-zA-Z0-9_-]+$/.test(v)).join(' ');
    return `<div class="wc-cover ${classes}" data-cover-subject="${subject(options.subject)}">
      ${decoration(options.subject, options)}
      <div class="wc-header"${editable('header')}>${text('header','Polymath Learning Centre')}</div>
      <div class="wc-center"><img class="wc-logo" src="${esc(logoUrl)}" alt="Polymath Learning Centre">
        <h1 class="wc-title"${editable('title')}>${text('title','Worksheet')}</h1>
        <div class="wc-subheader"${editable('subheader')}>${text('subheader','Worksheet')}</div>
        ${options.fields === false ? '' : `<div class="wc-fields"><div><div class="wc-field-label"${editable('nameLabel')}>${text('nameLabel','Name')}</div><div class="wc-field-line"></div></div><div><div class="wc-field-label"${editable('dateLabel')}>${text('dateLabel','Date')}</div><div class="wc-field-line"></div></div></div>`}
      </div><div class="wc-footer"${editable('footer')}>${text('footer','')}</div></div>`;
  }
  function edit(options = {}) {
    ensureStyles();
    return new Promise(resolve => {
      const value = {...options, subject:subject(options.subject), fields:options.fields !== false,
        scale:bounded(options.scale ?? options.artworkScale,1,.6,1.4), opacity:bounded(options.opacity ?? options.artworkOpacity,.72,.15,1),
        layout:layoutOf(options.layout || options.artworkLayout),
        textureOpacity:bounded(options.textureOpacity ?? options.artworkTextureOpacity,.65,0,1)};
      const dialog = doc.createElement('dialog');
      dialog.className = 'wc-editor';
      dialog.setAttribute('aria-label','Edit worksheet cover');
      dialog.innerHTML = `<form method="dialog"><div class="wc-editor-top"><div><h2>Edit cover</h2><p>Change the fields or click text in the preview. Your changes appear in the export.</p></div><button type="button" data-wc-cancel aria-label="Close cover editor">×</button></div>
        <div class="wc-editor-body"><div class="wc-editor-form">
        <label>Subject artwork<select data-wc-input="subject"><option value="science">Science</option><option value="math">Mathematics</option></select></label>
        <label>Worksheet title<textarea data-wc-input="title" rows="2"></textarea></label>
        <label>Header<input data-wc-input="header"></label><label>Subtitle<input data-wc-input="subheader"></label><label>Footer<input data-wc-input="footer"></label>
        <label class="wc-check"><input type="checkbox" data-wc-input="fields"> Include student fields</label>
        <label>First field label<input data-wc-input="nameLabel"></label><label>Second field label<input data-wc-input="dateLabel"></label>
        <label>Artwork arrangement<select data-wc-input="layout"><option value="scattered">Scattered across the page</option><option value="frame">Edge sprinkles</option><option value="minimal">Airy sprinkles</option></select></label>
        <label>Icon size<input type="range" data-wc-input="scale" min="0.6" max="1.4" step="0.05"></label>
        <label>Artwork visibility<input type="range" data-wc-input="opacity" min="0.15" max="1" step="0.05"></label>
        <label>Bubble &amp; polygon texture<input type="range" data-wc-input="textureOpacity" min="0" max="1" step="0.05"></label>
        </div><div class="wc-editor-preview" aria-label="Editable cover preview"></div></div>
        <div class="wc-editor-actions"><button type="button" data-wc-cancel>Cancel</button><button type="submit">Use this cover</button></div></form>`;
      const defaults = {title:'Worksheet',header:'Polymath Learning Centre',subheader:'Worksheet',footer:'',nameLabel:'Name',dateLabel:'Date'};
      Object.keys(defaults).forEach(key => { if (value[key] == null) value[key] = defaults[key]; });
      const inputs = [...dialog.querySelectorAll('[data-wc-input]')];
      if (options.subjectLocked) dialog.querySelector('[data-wc-input="subject"]').disabled = true;
      const sync = () => inputs.forEach(input => { const key = input.dataset.wcInput; if(input.type === 'checkbox') input.checked = value[key]; else input.value = value[key] ?? ''; });
      const preview = dialog.querySelector('.wc-editor-preview');
      const draw = () => { preview.innerHTML = render({...value,className:'',editable:true}); };
      sync(); draw();
      inputs.forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.wcInput;
        value[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
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
        finish({...value,artworkScale:value.scale,artworkOpacity:value.opacity,artworkLayout:value.layout,artworkTextureOpacity:value.textureOpacity});
      });
      doc.body.appendChild(dialog);
      dialog.showModal();
    });
  }
  global.WorksheetCover = Object.freeze({decoration,render,edit,ensureStyles,printStyles,logoUrl,subject,atlas,atlasCells});
  ensureStyles();
})(typeof window === 'undefined' ? globalThis : window);
