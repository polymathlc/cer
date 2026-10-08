/* Guest annotation pads. Only local strokes/labels are retained; marking gets
   one composite PNG per teacher-authored pad, under its original block ID. */
(function (root) {
  'use strict';
  const MAX_PNG_LENGTH = 1800000;
  function node(tag, className, text) {
    const el = document.createElement(tag); if (className) el.className = className;
    if (text != null) el.textContent = text; return el;
  }
  function create({ block, state, disabled, onChange }) {
    state.strokes ||= []; state.labels ||= []; state.history ||= []; state.tool ||= 'pen'; state.color ||= '#d51d42'; state.size ||= 4;
    const wrap = node('section', 'annotation-wrap'), toolbar = node('div', 'annotation-toolbar');
    const canvas = node('canvas', 'annotation-canvas'), editors = node('div', 'annotation-labels'), notice = node('p', 'annotation-notice');
    const name = block.label || (block.type === 'image' ? 'Diagram' : 'Working area');
    wrap.dataset.blockId = block.id; canvas.setAttribute('aria-label', name + ' — draw or place labels');
    canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
    wrap.append(node('h3', '', name), node('p', 'annotation-help', 'Draw with Pen, erase marks, or select Label and tap the diagram to type a label.'));
    const tools = {};
    for (const [tool, title] of [['pen', 'Pen'], ['erase', 'Eraser'], ['label', 'Label']]) {
      const button = node('button', '', title); button.type = 'button'; button.disabled = disabled;
      button.addEventListener('click', () => { state.tool = tool; toolState(); }); tools[tool] = button; toolbar.append(button);
    }
    const colors = node('label', 'annotation-select'), color = node('select'); colors.append(node('span', '', 'Colour'), color);
    for (const [value, title] of [['#d51d42','Red'],['#1f64b6','Blue'],['#168442','Green'],['#172b26','Black']]) {
      const option = node('option', '', title); option.value = value; color.append(option);
    }
    color.value = state.color; color.disabled = disabled; color.addEventListener('change', () => { state.color = color.value; }); toolbar.append(colors);
    const widths = node('label', 'annotation-select'), size = node('select'); widths.append(node('span', '', 'Pen width'), size);
    for (const [value, title] of [[2,'Fine'],[4,'Medium'],[7,'Thick']]) { const option = node('option', '', title); option.value = value; size.append(option); }
    size.value = String(state.size); size.disabled = disabled; size.addEventListener('change', () => { state.size = Number(size.value); }); toolbar.append(widths);
    const undo = node('button', '', 'Undo'), clear = node('button', '', 'Clear'); undo.type = clear.type = 'button';
    undo.addEventListener('click', () => { const old = state.history.pop(); if (!old) return; state.strokes = old.strokes; state.labels = old.labels; changed(true); });
    clear.addEventListener('click', () => { remember(); state.strokes = []; state.labels = []; changed(true); }); toolbar.append(undo, clear);
    wrap.append(toolbar, canvas, editors, notice);
    let image = null, failure = '', active = null, ready, loading = block.type === 'image';
    const hasMarks = () => state.strokes.length > 0 || state.labels.some(label => label.text.trim());
    const remember = () => {
      state.history.push(structuredClone({strokes:state.strokes,labels:state.labels})); if (state.history.length > 40) state.history.shift();
    };
    function toolState() {
      for (const [tool, button] of Object.entries(tools)) button.setAttribute('aria-pressed', String(tool === state.tool));
      canvas.dataset.tool = state.tool; undo.disabled = disabled || !state.history.length; clear.disabled = disabled || (!state.strokes.length && !state.labels.length);
    }
    function paint(target, width, height) {
      const cx = target.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, width, height);
      if (image) cx.drawImage(image, 0, 0, width, height);
      cx.lineCap = cx.lineJoin = 'round';
      for (const stroke of state.strokes) {
        cx.strokeStyle = stroke.color; cx.lineWidth = Math.max(1, stroke.size * width / 1000); cx.beginPath();
        stroke.points.forEach((p, index) => index ? cx.lineTo(p.x * width, p.y * height) : cx.moveTo(p.x * width, p.y * height));
        if (stroke.points.length === 1) { const p = stroke.points[0]; cx.lineTo(p.x * width + .1, p.y * height + .1); } cx.stroke();
      }
      const fontSize = Math.max(12, width * .024); cx.font = '600 ' + fontSize + 'px Arial'; cx.textBaseline = 'top';
      for (const label of state.labels) {
        if (!label.text.trim()) continue;
        const x = label.x * width, y = label.y * height; const textWidth = cx.measureText(label.text).width;
        cx.fillStyle = '#ffffffe6'; cx.fillRect(x - 2, y - 2, textWidth + 5, fontSize * 1.2 + 4);
        cx.fillStyle = label.color; cx.fillText(label.text, x, y);
      }
    }
    function draw() { paint(canvas, canvas.width, canvas.height); toolState(); }
    function changed(rebuild = false) {
      onChange(); draw(); if (rebuild) labelEditors();
    }
    function labelEditors() {
      editors.replaceChildren();
      state.labels.forEach((label, index) => {
        const row = node('div', 'annotation-label-row'), field = node('label'), input = node('input'), remove = node('button', '', 'Remove');
        field.append(node('span', '', 'Label ' + (index + 1)), input); input.type = 'text'; input.maxLength = 120; input.value = label.text; input.disabled = disabled;
        input.addEventListener('focus', remember); input.addEventListener('input', () => { label.text = input.value; changed(); });
        remove.type = 'button'; remove.disabled = disabled; remove.setAttribute('aria-label', 'Remove label ' + (index + 1));
        remove.addEventListener('click', () => { remember(); state.labels.splice(index, 1); changed(true); }); row.append(field, remove); editors.append(row);
      });
    }
    function point(event) {
      const rect = canvas.getBoundingClientRect(); return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/(rect.width||1))),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/(rect.height||1)))};
    }
    function labelAt(p) {
      const width = canvas.width, height = canvas.height, cx = canvas.getContext('2d'); cx.font = '600 ' + Math.max(12,width*.024) + 'px Arial';
      return state.labels.find(label => p.x >= label.x-.012 && p.x <= label.x+cx.measureText(label.text || 'Label').width/width+.012 && p.y >= label.y-.015 && p.y <= label.y+Math.max(12,width*.024)*1.3/height+.015);
    }
    function erase(p) {
      const rect = canvas.getBoundingClientRect(), radius = 13;
      function near(a, b) {
        const ax=a.x*rect.width, ay=a.y*rect.height, bx=b.x*rect.width, by=b.y*rect.height, px=p.x*rect.width, py=p.y*rect.height;
        const t=Math.max(0,Math.min(1,((px-ax)*(bx-ax)+(py-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2||1)));
        return Math.hypot(px-ax-t*(bx-ax),py-ay-t*(by-ay)) <= radius;
      }
      const before = state.strokes.length+state.labels.length;
      state.strokes = state.strokes.filter(stroke => !stroke.points.some((a,i)=>near(a,stroke.points[i+1]||a)));
      const label=labelAt(p); if(label) state.labels.splice(state.labels.indexOf(label),1);
      if (before !== state.strokes.length+state.labels.length) changed(true);
    }
    canvas.addEventListener('pointerdown', event => {
      if (disabled || loading || failure || active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); const p=point(event); remember(); canvas.setPointerCapture(event.pointerId);
      if (state.tool==='label') {
        const existing=labelAt(p), label=existing || {x:p.x,y:p.y,text:'',color:state.color};
        if(!existing) state.labels.push(label);
        active={pointerId:event.pointerId,label,start:p,origin:{x:label.x,y:label.y}}; changed(true);
      } else if(state.tool==='erase') { active={pointerId:event.pointerId,erase:true}; erase(p); }
      else {
        const stroke={color:state.color,size:state.size,points:[p]}; state.strokes.push(stroke); active={pointerId:event.pointerId,stroke}; changed();
      }
    });
    canvas.addEventListener('pointermove', event => {
      if(!active || active.pointerId!==event.pointerId) return; event.preventDefault(); const p=point(event);
      if(active.erase) erase(p);
      else if(active.label) { active.label.x=Math.max(0,Math.min(.98,active.origin.x+p.x-active.start.x)); active.label.y=Math.max(0,Math.min(.95,active.origin.y+p.y-active.start.y)); changed(); }
      else { if(active.stroke.points.length<12000) active.stroke.points.push(p); draw(); }
    });
    function finish(event) {
      if(!active || active.pointerId!==event.pointerId) return;
      const label=active.label; active=null; changed();
      if(label) editors.querySelectorAll('input')[state.labels.indexOf(label)]?.focus({preventScroll:true});
    }
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
    if (block.type==='image') {
      notice.textContent='Loading diagram…';
      ready=new Promise(resolve => {
        const source=new Image(); source.crossOrigin='anonymous';
        source.onload=()=> {
          image=source; const ratio=Math.min(1,1500/Math.max(source.naturalWidth,source.naturalHeight));
          canvas.width=Math.max(1,Math.round(source.naturalWidth*ratio)); canvas.height=Math.max(1,Math.round(source.naturalHeight*ratio)); loading=false;notice.textContent='';draw(); resolve();
        };
        source.onerror=()=>{failure='This diagram could not load for drawing. Your marks are kept; try loading the sample again.';notice.textContent=failure;resolve();}; source.src=block.url;
      });
    } else { canvas.width=1000;canvas.height=Math.max(120,Math.min(1600,Number(block.height)||(Math.max(3,Math.min(40,Number(block.lines)||6))*40)));ready=Promise.resolve(); }
    draw(); labelEditors();
    return {node:wrap,hasMarks,async exportPNG() {
      if(!hasMarks()) return null;
      let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The diagram is still loading. Your marks are kept; try checking again.')),12000);})]);}finally{clearTimeout(timer);}
      if(failure) throw new Error(failure);
      let width=canvas.width, height=canvas.height;
      for(let tries=0;tries<8;tries++) {
        const output=document.createElement('canvas');output.width=width;output.height=height;paint(output,width,height);
        let result;try{result=output.toDataURL('image/png');}catch{throw new Error('This diagram could not be prepared for checking. Your marks are still here.');}
        if(result.length<=MAX_PNG_LENGTH) return result;
        width=Math.max(1,Math.floor(width*.8));height=Math.max(1,Math.floor(height*.8));
      }
      throw new Error('This drawing is too large to check. Your marks are still here.');
    }};
  }
  root.SampleAnnotations=Object.freeze({create,MAX_PNG_LENGTH});
})(typeof window!=='undefined'?window:globalThis);
