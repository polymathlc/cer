/* Shared by cer and math. Keep both copies identical.
 * Covers are text + local logo + SVG pixels, so editing and printing stay crisp.
 */
(function (root) {
  'use strict';
  const source = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
  const logo = source ? new URL('assets/branding/polymath-learning-centre.png', source).href : 'assets/branding/polymath-learning-centre.png';
  const limits = { title: 120, org: 120, subtitle: 140, footer: 100, name: 70, className: 40, date: 40 };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {}, out = {};
    Object.keys(limits).forEach(key => {
      if (typeof input[key] === 'string') out[key] = input[key].replace(/\s+/g, ' ').trim().slice(0, limits[key]);
    });
    if (input.subject === 'science' || input.subject === 'math') out.subject = input.subject;
    if (Number.isFinite(input.seed)) out.seed = Math.abs(Math.trunc(input.seed)) % 4096;
    return out;
  }
  function resolve(value, defaults) {
    const d = Object.assign({ title: 'Worksheet', org: 'Polymath Learning Centre', subtitle: 'Practice • Discover • Grow', subject: 'science', seed: 0 }, normalize(defaults), normalize(value));
    if (!d.title) d.title = 'Worksheet';
    if (d.footer == null) d.footer = d.subject === 'math' ? 'Think clearly. Explore possibilities.' : 'Stay curious. Discover something new.';
    return d;
  }
  // Every filled cell is one square pixel, including curves and diagonals.
  const sprites = {
    tube: ['..ooooooo..','...o...o...','...o.h.o...','...o.h.o...','...o...o...','...o.a.o...','...oaaao...','...oaaao...','...oafao...','...oafao...','...oaaao...','....ooo....'],
    flask: ['....oooo....','.....oo.....','.....oo.....','....o..o....','....o.ho....','...o...ho...','..o.aaa.ho..','.o.aaaaa.ho.','.oaaaaaaaao.','.oafaafaaao.','.oooooooooo.'],
    beaker: ['.ooooooooo..','..o.....o...','..o.hh.oo...','..o....o....','..o..a.oo...','..oaaaao....','..oaaaaoo...','..oafaao....','..oaaaao....','..oooooo....'],
    atom: ['....oo....oo....','...o..o..o..o...','...o...oo...o...','....o......o....','.ooo.o....o.ooo.','o....oooooo....o','o...oo.aa.oo...o','.ooo.o.aa.o.ooo.','....o.oooo.o....','...o...oo...o...','...o..o..o..o...','....oo....oo....'],
    microscope: ['.....oooo....','....oaaao....','...oaaao.....','....ooo......','.....o..oo...','.....o...o...','..oo.o...o...','..aaaaa..o...','.........o...','........o....','....oooo.....','..oooooooo...'],
    bulb: ['....oooo....','..ooaaaaoo..','.oaaaaaaaao.','.oaahhaaaao.','.oaaaoaaaao.','..oaooaaao..','...oaaaao...','....oooo....','....aaaa....','....oooo....','.....oo.....'],
    molecule: ['..ooo.......','..oaao......','..ooo.......','.....o......','......oooo..','.....oaafao.','.....oaaaao.','....o.oooo..','...o........','.oooo.......','.oaao.......','.oooo.......'],
    magnet: ['.oooo..oooo.','.oaao..oaao.','.oaao..oaao.','.offo..offo.','.offo..offo.','.offo..offo.','..offooffo..','...offffo...','....oooo....'],
    pi: ['..oooooooooo..','.oooooooooooo.','...oo....oo...','...oo....oo...','...oo....oo...','...oo....oo...','...oo....oo...','..ooo....ooo..','..oo......oo..'],
    plus: ['....oo....','....oo....','....oo....','.oooooooo.','.oooooooo.','....oo....','....oo....','....oo....'],
    divide: ['....oo....','....oo....','..........','.oooooooo.','.oooooooo.','..........','....oo....','....oo....'],
    times: ['.oo....oo.','..oo..oo..','...oooo...','....oo....','...oooo...','..oo..oo..','.oo....oo.'],
    ruler: ['.oooooooooooooo.','.oaaoaaoaaoaaoo.','.oaaaaaaaaaaaao.','.oafaafaafaafao.','.oooooooooooooo.'],
    triangle: ['..oo..........','..oao.........','..oaao........','..oaaao.......','..oa.aao......','..oa..aao.....','..oa...aao....','..oa....aao...','..oaaaaaaaao..','..oooooooooo..'],
    calculator: ['..oooooooo..','.oaaaaaaaao.','.o.ffffff.o.','.o.ffffff.o.','.oaaaaaaaao.','.o.oo.oo..o.','.o.oo.oo..o.','.oaaaaaaaao.','.o.oo.oo..o.','.o.oo.oo..o.','.oaaaaaaaao.','..oooooooo..'],
    graph: ['.oo.........','.oo......oo.','.oo......o..','.oo....oo...','.oo...o.....','.oo..o......','.oo.o.......','.ooo........','.oooooooooo.','............'],
    root: ['.......ooooooo','.......oo.....','......oo......','.oo...oo......','..oo.oo.......','...oooo.......','....oo........'],
    equals: ['.oooooooo.','.oooooooo.','..........','..........','.oooooooo.','.oooooooo.']
  };
  const science = ['flask', 'atom', 'tube', 'microscope', 'beaker', 'bulb', 'molecule', 'magnet'];
  const math = ['pi', 'ruler', 'calculator', 'triangle', 'divide', 'graph', 'root', 'plus', 'times', 'equals'];
  function sprite(name, pink) {
    const palette = pink
      ? { o: '#ce7ba5', a: '#f5cfe2', f: '#e7a9c9', h: '#fff9fc' }
      : { o: '#70b9c0', a: '#c7ecec', f: '#98d6dc', h: '#f7ffff' };
    return sprites[name].map((row, y) => Array.from(row).map((v, x) => palette[v] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[v]}"/>` : '').join('')).join('');
  }
  function decoration(subject, seed) {
    const icons = subject === 'math' ? math : science;
    const shift = Math.abs(Math.trunc(seed || 0)) % icons.length;
    // Spread across the sheet, with a quiet central column for the title.
    const places = [[9,12,1.45],[46,29,1],[98,39,.8],[135,26,1.2],[176,13,1.35],
      [13,63,1.2],[177,67,1.15],[5,108,1.1],[184,111,1.2],[13,157,1.3],[178,161,1.4],
      [6,211,1.3],[181,214,1.15],[12,263,1.5],[53,251,1.1],[99,255,.85],[137,252,1.25],[176,267,1.4]];
    const art = places.map(([x, y, size], i) => {
      const name = icons[(i + shift) % icons.length];
      return `<g data-icon="${name}" transform="translate(${x} ${y}) scale(${size})">${sprite(name, (i + shift) % 3 === 1)}</g>`;
    }).join('');
    const sparkles = [[35,16],[74,38],[161,11],[200,52],[36,95],[168,94],[5,145],[202,194],[33,239],[71,281],[162,285],[168,229],[5,245],[202,129]];
    return `<svg class="pc-deco" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${art}${sparkles.map(([x, y], i) => `<path d="M${x} ${y}h2v2h2v2h-2v2h-2v-2h-2v-2h2z" fill="${i % 2 ? '#f1d6e5' : '#ccebed'}"/>`).join('')}</svg>`;
  }
  const css = `
  .pc-cover.pc-cover{position:relative;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;align-items:center;min-height:250mm;padding:13mm 24mm 12mm;background:#fffdfd;color:#264e56;text-align:center;font-family:Arial,Helvetica,sans-serif;isolation:isolate;break-inside:avoid;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pc-cover .pc-deco{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1}
  .pc-cover .pc-org{position:relative;font-size:8pt;line-height:1.5;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:#397e88;max-width:100%;overflow-wrap:anywhere;padding:3mm 5mm;background:#fffdfdf0}
  .pc-cover .pc-org .ws-cover-org{margin:0;color:inherit;font:inherit;letter-spacing:inherit}
  .pc-cover .pc-main{width:100%;display:flex;flex-direction:column;align-items:center;gap:6mm;margin:12mm 0}
  .pc-cover .pc-subject{font-size:8pt;letter-spacing:.24em;text-transform:uppercase;color:#a14979;font-weight:700;padding:2mm 4mm;border-top:2px solid #c9e8e9;border-bottom:2px solid #f1cfdf;background:#fffdfd}
  .pc-cover .pc-logo{width:43mm;height:32mm;object-fit:contain;max-width:100%;display:block}
  .pc-cover .pc-title{margin:1mm 0 0;width:100%}
  .pc-cover .pc-title h1{font-family:Georgia,'Times New Roman',serif;font-size:31pt;font-weight:700;line-height:1.14;letter-spacing:-.025em;margin:0;padding:0;color:#264e56;overflow-wrap:anywhere}
  .pc-cover .pc-title.pc-title-long h1{font-size:23pt}
  .pc-cover.pc-compact .pc-main{gap:3mm;margin:3mm 0}.pc-cover.pc-compact .pc-logo{height:20mm;width:28mm}.pc-cover.pc-compact .pc-title h1{font-size:18pt;line-height:1.12}
  .pc-cover.pc-compact .pc-subtitle{font-size:10.5pt;line-height:1.4}
  .pc-cover.pc-compact .pc-fields{gap:3mm 5mm;padding:3mm;margin-top:2mm}.pc-cover.pc-compact .pc-field-value{font-size:9pt;line-height:1.25}
  .pc-cover.pc-compact .pc-org,.pc-cover.pc-compact .pc-footer{font-size:7pt;line-height:1.4;letter-spacing:.08em;padding:2mm}
  .pc-cover .pc-subtitle{font-size:12pt;line-height:1.6;color:#7c526b;max-width:100%;overflow-wrap:anywhere}
  .pc-cover .pc-pixels{display:flex;gap:2mm;margin:1mm 0}
  .pc-cover .pc-pixels i{width:2mm;height:2mm;background:#9cd4da}.pc-cover .pc-pixels i:nth-child(2){background:#c4e7e9}.pc-cover .pc-pixels i:nth-child(3){background:#edbfd7}
  .pc-cover .pc-fields{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:6mm 7mm;max-width:117mm;margin-top:3mm;text-align:left;padding:5mm;background:#f6fbfb;border:1px solid #d4ebec}
  .pc-cover .pc-field:first-child{grid-column:1/-1}
  .pc-cover .pc-field-label{display:block;font-size:7pt;letter-spacing:.15em;text-transform:uppercase;font-weight:700;color:#527b82;margin-bottom:2mm}
  .pc-cover .pc-field-value{display:block;min-height:7mm;border-bottom:1px solid #9ecbd0;color:#264e56;font-size:10pt;line-height:1.4;overflow-wrap:anywhere}
  .pc-cover .pc-footer{font-size:8pt;line-height:1.5;letter-spacing:.11em;max-width:100%;color:#7c526b;overflow-wrap:anywhere;padding:3mm 5mm;background:#fffdfdf0}
  .pc-cover .ws-sheetqr{position:static;float:none;margin:0 auto;max-width:100%}
  .pc-cover .ws-sheetqr svg{width:24mm!important;height:24mm!important}
  .pc-cover .pc-main:has(.ws-sheetqr){gap:4mm;margin:7mm 0}
  .pc-cover.pc-compact .pc-main:has(.ws-sheetqr){gap:3mm;margin:3mm 0}
  .pc-cover .ws-sheetqr-cap{font-size:7pt}
  `;
  function render(value, options) {
    const o = options || {}, d = resolve(value, o.defaults);
    const compactDetails = d.subtitle.length > 90 || d.org.length > 80 || d.footer.length > 80 || (d.name || '').length > 45 || (d.className || '').length > 25 || (d.date || '').length > 25;
    const field = (key, label) => `<div class="pc-field"><span class="pc-field-label">${label}</span><span class="pc-field-value">${esc(d[key] || '')}</span></div>`;
    return `<section class="pc-cover${d.title.length > 90 || compactDetails ? ' pc-compact' : ''} ${esc(o.className || '')}" data-cover-subject="${d.subject}" data-cover-compact-details="${compactDetails ? 1 : 0}">
      <style>${css}</style>${decoration(d.subject, d.seed)}
      <div class="pc-org">${o.orgHtml != null ? o.orgHtml : esc(d.org)}</div>
      <div class="pc-main">
        <div class="pc-subject">${d.subject === 'math' ? 'Mathematics' : 'Science'}</div>
        <img class="pc-logo" src="${esc(logo)}" alt="Polymath Learning Centre">
        <div class="pc-title${d.title.length > 65 ? ' pc-title-long' : ''}">${o.titleHtml != null ? o.titleHtml : `<h1>${esc(d.title)}</h1>`}</div>
        <div class="pc-subtitle">${esc(d.subtitle)}</div>
        <div class="pc-pixels" aria-hidden="true"><i></i><i></i><i></i></div>
        ${o.noFields ? '' : `<div class="pc-fields">${field('name', 'Name')}${field('className', 'Class')}${field('date', 'Date')}</div>`}
        ${o.extraHtml || ''}
      </div>
      <div class="pc-footer">${esc(d.footer)}</div>
    </section>`;
  }
  const editorCss = `
  dialog.pc-editor{box-sizing:border-box;max-width:1120px;width:calc(100% - 28px);max-height:calc(100dvh - 28px);padding:0;border:1px solid #c5dedf;border-radius:18px;color:#234951;background:#fff;box-shadow:0 20px 80px #0005;font:15px/1.5 Arial,Helvetica,sans-serif}
  dialog.pc-editor::backdrop{background:#183a4666}
  .pc-editor *{box-sizing:border-box}
  .pc-editor .pc-editor-head{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 24px;border-bottom:1px solid #e0eeee}
  .pc-editor h2{font-size:22px;line-height:1.3;margin:0;color:#234951}.pc-editor p{margin:5px 0 0;color:#607d82}
  .pc-editor .pc-editor-body{display:grid;grid-template-columns:340px minmax(0,1fr);max-height:calc(100dvh - 200px);overflow:auto}
  .pc-editor .pc-controls{padding:22px 24px;display:grid;gap:15px;align-content:start}
  .pc-editor label{display:grid;gap:5px;font-size:13px;font-weight:600;color:#315b63}
  .pc-editor input,.pc-editor select{width:100%;padding:10px 11px;border:1px solid #b9d4d7;border-radius:7px;color:#234951;background:white;font:14px/1.4 Arial,Helvetica,sans-serif}
  .pc-editor input:focus,.pc-editor select:focus{outline:3px solid #c4e9eb;border-color:#399ca8}
  .pc-editor .pc-mini-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .pc-editor .pc-editor-preview{padding:24px;background:#edf4f4;min-width:0}
  .pc-editor .pc-preview-box{width:100%;aspect-ratio:178/250;position:relative;overflow:hidden;box-shadow:0 3px 12px #244b521c}
  .pc-editor .pc-preview-paper{position:absolute;top:0;left:0;width:178mm;transform-origin:top left}
  .pc-editor .pc-editor-foot{padding:16px 24px;border-top:1px solid #e0eeee;display:flex;justify-content:flex-end;align-items:center;gap:10px}
  .pc-editor button{border-radius:8px;border:1px solid #a9cccf;background:#fff;padding:10px 16px;font:600 14px/1.3 Arial,Helvetica,sans-serif;cursor:pointer;color:#315b63}
  .pc-editor button.pc-save{background:#287e89;color:white;border-color:#287e89}.pc-editor button:disabled{opacity:.6;cursor:wait}
  .pc-editor .pc-status{margin-right:auto;font-size:13px;color:#a13567}
  @media(max-width:740px){.pc-editor .pc-editor-body{grid-template-columns:1fr}.pc-editor .pc-editor-preview{padding:18px}.pc-editor .pc-editor-head{padding:16px}.pc-editor .pc-editor-foot{padding:12px;flex-wrap:wrap}.pc-editor .pc-status{width:100%}}
  @media print{dialog.pc-editor{display:none!important}}
  `;
  function open(value, options) {
    const o = options || {}, doc = o.document || document, view = doc.defaultView || root;
    const previous = doc.activeElement;
    const draft = resolve(value, o.defaults);
    const dialog = doc.createElement('dialog');
    dialog.className = 'pc-editor'; dialog.setAttribute('aria-label', 'Edit cover');
    const input = (key, label) => `<label>${label}<input name="${key}" maxlength="${limits[key]}" value="${esc(draft[key] || '')}"></label>`;
    dialog.innerHTML = `<style>${editorCss}</style>
      <div class="pc-editor-head"><div><h2>Edit cover</h2><p>Make it yours. Your changes appear in the printed cover.</p></div><button type="button" data-close aria-label="Close cover editor">✕</button></div>
      <div class="pc-editor-body"><form class="pc-controls">
        ${input('title', 'Title')}${input('org', 'Centre / heading')}${input('subtitle', 'Subtitle')}
        <label>Subject artwork<select name="subject"><option value="science"${draft.subject === 'science' ? ' selected' : ''}>Science · apparatus &amp; discoveries</option><option value="math"${draft.subject === 'math' ? ' selected' : ''}>Mathematics · numbers &amp; shapes</option></select></label>
        <button type="button" data-remix>Shuffle the pixel icons</button>
        ${input('footer', 'Footer message')}
        ${o.noFields ? '' : `${input('name', 'Student name (optional)')}<div class="pc-mini-fields">${input('className', 'Class (optional)')}${input('date', 'Date (optional)')}</div>`}
      </form><div class="pc-editor-preview"><div class="pc-preview-box"><div class="pc-preview-paper"></div></div></div></div>
      <div class="pc-editor-foot"><span class="pc-status" role="status" aria-live="polite"></span><button type="button" data-close>Cancel</button><button type="button" class="pc-save">Apply cover</button></div>`;
    doc.body.appendChild(dialog);
    const paper = dialog.querySelector('.pc-preview-paper'), box = dialog.querySelector('.pc-preview-box');
    function paint() {
      paper.innerHTML = render(draft, { noFields: o.noFields, extraHtml: o.extraHtml });
      const scale = box.clientWidth / paper.offsetWidth;
      paper.style.transform = `scale(${scale})`;
      box.style.height = (paper.offsetHeight * scale) + 'px';
    }
    let busy = false;
    const observer = view.ResizeObserver ? new view.ResizeObserver(paint) : null;
    dialog.addEventListener('close', () => { if (observer) observer.disconnect(); dialog.remove(); if (previous && previous.isConnected) previous.focus(); }, { once: true });
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.querySelectorAll('[data-close]').forEach(button => button.onclick = () => { if (!busy) dialog.close(); });
    dialog.querySelector('form').onsubmit = e => e.preventDefault();
    dialog.querySelector('form').oninput = e => {
      if (!e.target.name) return;
      draft[e.target.name] = e.target.value;
      paint();
    };
    dialog.querySelector('[data-remix]').onclick = () => { draft.seed = (draft.seed + 1) % 4096; paint(); };
    dialog.querySelector('.pc-save').onclick = async () => {
      if (busy) return;
      busy = true;
      dialog.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
      const status = dialog.querySelector('.pc-status');
      status.textContent = 'Saving cover…';
      try {
        await o.onSave(resolve(draft));
        dialog.close();
      } catch (error) {
        status.textContent = 'Could not save: ' + (error.message || String(error)) + '. Your edits are still here.';
      } finally {
        busy = false;
        dialog.querySelectorAll('button,input,select').forEach(el => { el.disabled = false; });
      }
    };
    dialog.showModal();
    paint();
    if (observer) observer.observe(box);
    dialog.querySelector('[name="title"]').focus();
    return dialog;
  }
  root.WorksheetCover = Object.freeze({ normalize, resolve, decoration, render, open, css });
})(typeof window === 'undefined' ? globalThis : window);
