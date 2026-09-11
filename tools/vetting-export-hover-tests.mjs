// Run: node tools/vetting-export-hover-tests.mjs
// Real hover controller, iframe writer and preview packer; no Firebase writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(a, b) {
  const start = src.indexOf(a), end = src.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, a);
  return src.slice(start, end);
}
const hover = cut('var _vetPrintPeek = null;', '// 🖨 the whole scoped set');
class El {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.style = {}; this.attrs = {};
    this.dataset = {}; this.listeners = {}; this.isConnected = true;
    this.classList = { toggle() {} };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, cb) { this.listeners[k] = cb; }
  appendChild(x) { this.children.push(x); return x; }
  remove() { this.isConnected = false; }
  contains(x) { return x === this || this.children.some(c => c.contains(x)); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(c => [c, ...c.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter(c => selector[0] === '.'
      ? (c.className || '').split(' ').includes(selector.slice(1)) : c.tag === selector);
  }
  querySelector(s) { return this.querySelectorAll(s)[0]; }
}
function harness() {
  const timers = new Map(), rendered = [], written = [], actions = [], listeners = {};
  let timerSeq = 0, author = true;
  const document = { activeElement: null, body: new El('body'), addEventListener: (k, cb) => { listeners[k] = cb; } };
  document.createElement = tag => {
    const host = new El(tag);
    if (tag === 'section') {
      host.offsetWidth = 680; host.offsetHeight = 600;
      Object.defineProperty(host, 'innerHTML', {set(html) {
        host.markup = html;
        host.appendChild(new El('strong'));
        for (let i=0;i<3;i++) host.appendChild(new El('button'));
        const status=host.appendChild(new El()); status.className='vet-print-peek-status';
        const stage=host.appendChild(new El()); stage.className='vet-print-peek-stage';
        stage.clientWidth=680; stage.clientHeight=450;
        const frame=stage.appendChild(new El('iframe')); frame.contentDocument=new El('document');
      }});
    }
    return host;
  };
  const window = {innerWidth:1200,innerHeight:800,addEventListener:(k,cb)=>{listeners[k]=cb;}};
  const factory = new Function('document','window','setTimeout','clearTimeout','_canAuthor','buildWorksheetHtml','_wsWritePreview','actions', `
    let vettingList=[], _cpbQuestions=[];
    const escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const _wnyCachedNotes=()=>({cached:true}), wnyPrintOn=()=>false, akxPrintOn=()=>true, objBoxPrintOn=()=>true;
    const previewOneQuestionPrint=(id,where)=>actions.push(['full',id,where]);
    const editQuestion=id=>actions.push(['edit',id]);
    const cpbPreviewQuestion=id=>actions.push(['cpb-full',id]);
    const cpbEditQuestion=id=>actions.push(['cpb-edit',id]);
    // 🔍± the picture-size pills: a hover that closes writes the sizes back.
    let pvsFlushes=0; const pvsFlush=()=>{pvsFlushes++;};
    ${hover}
    return {show:vetPrintPeekShow,leave:vetPrintPeekLeave,keep:vetPrintPeekKeep,hide:vetPrintPeekHide,
      dismiss:vetPrintPeekDismiss,key:vetPrintPeekKeydown,button:vetPrintPeekButton,
      full:vetPrintPeekFull,edit:vetPrintPeekEdit,resolve:_vetPeekQuestion,
      get state(){return _vetPrintPeek},get flushes(){return pvsFlushes},set list(x){vettingList=x},set paper(x){_cpbQuestions=x}};
  `);
  const api = factory(document, window, (cb,ms)=>{const id=++timerSeq;timers.set(id,{cb,ms});return id;}, id=>timers.delete(id), ()=>author,
    (qs,title,opts)=>{rendered.push({qs,title,opts});return '<p>exported</p>';},
    (frame,html,opts)=>written.push({frame,html,opts}), actions);
  function anchor(id, scope) {
    const a=new El('button'); a.dataset.qid=id; if (scope) a.dataset.scope=scope;
    a.getBoundingClientRect=()=>({left:1000,right:1030,top:300});
    a.focus=()=>{document.activeElement=a;api.show(a);};
    return a;
  }
  return {...api, api, document, timers, rendered, written, actions, listeners, anchor,
    set author(x){author=x}, flush(){const jobs=[...timers.values()];timers.clear();jobs.forEach(x=>x.cb());}};
}
const Q = id => ({id,title:'Question '+id,blocks:[{type:'image',url:'diagram.png'},{type:'plainanswer',content:'The model answer'}]});

test('eye precedes the Vetting traffic light and supports keyboard and touch', () => {
  const row=cut('function renderVettingList()', '// Returning to the Vetting List');
  assert.match(row, /\$\{vetPrintPeekButton\(q\)\}\s*\$\{tlLightHtml\(q, 'vet'\)\}/);
  const h=harness(), html=h.button({id:'a"<',title:'<title>'});
  assert.match(html,/data-qid="a&quot;&lt;"/); assert.match(html,/&lt;title&gt;/);
  for(const name of ['onpointerenter','onfocus','onclick','aria-label','aria-haspopup']) assert.ok(html.includes(name));
  assert.match(css,/\.vet-print-eye:focus-visible/);
  for(const name of ['vetPrintPeekShow','vetPrintPeekLeave','vetPrintPeekFull']) assert.ok(src.includes(`window.${name} = ${name};`));
});

// 🗂️ The SAME peek, on a 🗂️ Custom Paper row. Its questions are in NEITHER
// `questionBank` NOR `vettingList` until the paper is sent, so every failure
// here is one pool's eye silently opening nothing — or, worse, resolving an id
// against the wrong list and showing a different question entirely.
test('the Custom Paper eye reads the paper, and routes to the paper\'s own doors', () => {
  const h=harness(), paper=Q('p1'), vet={...Q('p1'), title:'A DIFFERENT question'};
  h.api.list=[vet]; h.api.paper=[paper];
  // the row emits the scope, and wears the row's own tool shape
  const row=cut('function _cpbRowHtml(q, num, book, first, last)', 'function _cpbBookletHtml(');
  assert.match(row,/\$\{vetPrintPeekButton\(q, 'cpb'\)\}/);
  const html=h.button(paper,'cpb');
  assert.match(html,/data-scope="cpb"/);
  assert.match(html,/class="cpb-tool cpb-tool-eye vet-print-eye"/);
  assert.match(html,/vetPrintPeekFull\(this\.dataset\.qid,this\.dataset\.scope\)/);
  assert.match(css,/\.cpb-tool-eye svg/);
  // …and the default is byte-for-byte the Vetting button it has always been
  assert.match(h.button(paper),/class="qb-action-btn vet-print-eye"/);
  assert.match(h.button(paper),/data-scope="vetting"/);
  // ONE resolver, and an unknown scope falls back to Vetting rather than dying
  assert.equal(h.resolve('p1','cpb').title,'Question p1');
  assert.equal(h.resolve('p1','vetting').title,'A DIFFERENT question');
  assert.equal(h.resolve('p1','nonsense').title,'A DIFFERENT question');
  assert.equal(h.resolve('nope','cpb'),null);
  // hovering renders the PAPER's copy, not the same id out of Vetting
  const a=h.anchor('p1','cpb'); h.show(a,{pointerType:'mouse'}); h.flush();
  assert.equal(h.rendered.length,1);
  assert.equal(h.rendered[0].title,'Question p1');
  // both foot buttons go to the paper's doors, never the bank's
  h.api.state.host.children.filter(c=>c.tag==='button')[1].onclick();
  h.show(h.anchor('p1','cpb'),{pointerType:'mouse'}); h.flush();
  h.api.state.host.children.filter(c=>c.tag==='button')[2].onclick();
  assert.deepEqual(h.actions,[['cpb-full','p1'],['cpb-edit','p1']]);
  // and the rows are rebuilt wholesale, so the render tears an open peek down
  assert.match(cut('function cpbRender()', 'function _cpbLibHtml('),/vetPrintPeekHide\(\)/);
  assert.ok(src.includes('window.cpbPreviewQuestion = cpbPreviewQuestion;'));
});

test('passing over an eye and leaving avoids all rendering work', () => {
  const h=harness(); h.api.list=[Q('a')]; h.show(h.anchor('a'),{pointerType:'mouse'});
  assert.equal(h.rendered.length,0); h.leave(); h.flush(); assert.equal(h.rendered.length,0);
});

test('hover renders the current Vetting copy with the export options and isolated A4 frame', () => {
  const h=harness(), q=Q('a'), a=h.anchor('a'); h.api.list=[q]; h.show(a,{pointerType:'mouse'});
  const edited={...q,title:'Latest edit'};h.api.list=[edited]; h.flush();
  const r=h.rendered[0]; assert.equal(r.title,'Latest edit'); assert.deepEqual(r.qs,[edited]);
  assert.notEqual(r.qs[0],edited); assert.notEqual(r.qs[0].blocks,edited.blocks);
  assert.deepEqual(r.opts,{frontHtml:'',plainNumbers:true,noStudentFields:true,whyNotes:{cached:true},answerKeyExtras:true,objectivesBoxAll:true});
  assert.equal(h.written[0].opts.readOnly,true); assert.equal(h.written[0].frame.style.width,'850px');
  assert.equal(h.written[0].frame.style.transform,'scale(0.8)');
  assert.equal(a.attrs['aria-expanded'],'true'); assert.deepEqual(h.actions,[]);
});

test('moving into the panel keeps it open; leaving closes and resets the eye', () => {
  const h=harness(), a=h.anchor('a'); h.api.list=[Q('a')];h.show(a);h.flush();
  h.leave();h.keep();h.flush();assert.ok(h.api.state);
  h.leave();h.flush();assert.equal(h.api.state,null);assert.equal(a.attrs['aria-expanded'],'false');
});

test('switching eyes cancels old renders and invalidates delayed image/font callbacks', () => {
  const h=harness();h.api.list=[Q('a'),Q('b')];h.show(h.anchor('a'));h.flush();
  const first=h.written[0];h.show(h.anchor('b'));h.flush();
  assert.equal(first.opts.isCurrent(),false);assert.equal(h.written[1].opts.isCurrent(),true);
  h.hide();assert.equal(h.written[1].opts.isCurrent(),false);
});

test('Escape and close restore focus without reopening; full preview and edit use the right id', () => {
  const h=harness(),a=h.anchor('a');h.api.list=[Q('a')];h.show(a);h.flush();
  h.key({key:'Escape',preventDefault(){},stopPropagation(){}});h.flush();
  assert.equal(h.api.state,null);assert.equal(h.document.activeElement,a);
  h.show(a);h.flush();h.dismiss();h.flush();assert.equal(h.api.state,null);
  h.full('a');h.edit('a');assert.deepEqual(h.actions,[['full','a','vetting'],['edit','a']]);
});

test('touch only opens on click; missing, detached and unauthorised questions never render', () => {
  const h=harness();h.api.list=[Q('a')];h.show(h.anchor('a'),{pointerType:'touch'});h.flush();
  assert.equal(h.rendered.length,0);h.full('a');assert.equal(h.actions.length,1);
  h.show(h.anchor('missing'));h.flush();assert.equal(h.rendered.length,0);
  const a=h.anchor('a');a.isConnected=false;h.show(a);h.flush();assert.equal(h.rendered.length,0);
  h.author=false;h.show(h.anchor('a'));h.full('a');h.edit('a');h.flush();
  assert.equal(h.rendered.length,0);assert.equal(h.actions.length,1);
});

test('navigation, list refresh, outside clicks and viewport changes dismiss the peek', () => {
  assert.match(cut('function navigateTo(page)', '// Employees may only'),/vetPrintPeekHide\(\)/);
  assert.match(cut('function renderVettingList()', '// Live "processing"'),/vetPrintPeekHide\(\)/);
  const h=harness();h.api.list=[Q('a')];h.show(h.anchor('a'));h.flush();
  h.listeners.pointerdown({target:new El()});assert.equal(h.api.state,null);
  h.show(h.anchor('a'));h.flush();h.listeners.resize();assert.equal(h.api.state,null);
});

test('shared document writer waits for print assets and drops stale callbacks', () => {
  const calls=[],ready=[];let current=true;
  const doc={open(){},write(s){calls.push(s)},close(){}};
  const write=new Function('_printFontLinksHtml','_wsAppCssForPreview','WS_PREVIEW_CSS','_printStampImgDims','_wsPreviewWhenReady','_wsPreviewPack',
    cut('function _wsWritePreview(', 'function _wsPreviewWhenReady(')+'return _wsWritePreview;')(
      ()=>'<link rel="stylesheet">',()=>'.print-style{}','.a4-style{}',()=>calls.push('stamp'),(d,cb)=>ready.push(cb),()=>{calls.push('pack');return true;});
  write({contentDocument:doc},'<p>diagram and answers</p>',{readOnly:true,isCurrent:()=>current,onReady:()=>calls.push('ready')});
  assert.match(calls[0],/\.print-style\{\}\.a4-style\{\}/);assert.match(calls[0],/id="wsMeasure"/);
  assert.ok(!calls.includes('pack'));current=false;ready[0]();assert.ok(!calls.includes('pack'));
  current=true;write({contentDocument:doc},'fresh',{onReady:()=>calls.push('ready')});ready[1]();
  assert.deepEqual(calls.slice(-3),['stamp','pack','ready']);
});

function packHarness(readOnly) {
  const measure=new El(),pages=new El(),count=new El(),seen=[];
  for(const id of ['a','b']) {const chunk=measure.appendChild(new El());chunk.className='print-question-chunk';chunk.dataset.qid=id;}
  const ak=measure.appendChild(new El());ak.className='print-answer-key-page';
  const row=ak.appendChild(new El());row.className='print-ak-question';row.dataset.qid='a';
  const doc={getElementById:id=>id==='wsMeasure'?measure:pages,createElement:tag=>new El(tag)};
  const forced=new Set(['stored-break']),merged=new Set(['stored-merge']);
  const pack=new Function('document','_printPlanIn','_printAkPageEl','wsManualBreaks','wsMergeUp', `
    const PRINT_PAGE_PX=1000, _canAuthor=()=>true, _wsPreviewIsDraft=()=>false;
    const _wsPreviewSaved={id:'existing-worksheet'};
    const pvsDecorateDoc=()=>{};   // 🔍± the picture-size pills hung after packing
    // The REAL front-sheet placement, so the hover preview is exercised with
    // the same rule the printer uses rather than a stub that cannot disagree
    // with it. Every front page here is unanchored, which is every front page
    // this app printed before booklets existed.
    ${cut('function _printFrontAnchor(f) {', 'function _printPlanIn(')}
    ${cut('function _wsPreviewPack(', '// WORKSHEET QUICK EDIT')}
    return _wsPreviewPack;
  `)({getElementById:()=>count},(d,m,opts)=>{seen.push(opts);return {
    heights:[500,500],footerH:10,sepH:10,tallFlags:[false,false],groups:[[0],[1]],
    frontSpans:[],pageTall:[false,false],pageHs:[500,500],pageZoom:[1,1],
    akPlans:[[{rows:[0],h:500,zoom:1}]]};},()=>new El('answer-sheet'),forced,merged);
  assert.equal(pack(doc,{readOnly}),true);
  return {measure,pages,count,seen,forced,merged};
}
test('read-only pack uses the same pages and answer key without worksheet tools or state changes', () => {
  const peek=packHarness(true),full=packHarness(false);
  assert.equal(peek.pages.children.length,3);assert.equal(full.pages.children.length,3);
  assert.equal(peek.pages.querySelectorAll('button').length,0);
  assert.ok(full.pages.querySelectorAll('button').length>0);
  assert.equal(peek.count.textContent,undefined);assert.match(full.count.textContent,/3 pages/);
  // The hover carries NO stored break, and the stored set is left untouched.
  assert.deepEqual([...peek.seen[0].forcedBreakIds],[]);assert.deepEqual([...peek.forced],['stored-break']);
  // The full preview carries them. It is a COPY now rather than the live Set —
  // a paper's own breaks are unioned into it — so what matters is the contents,
  // and that the stored set was not mutated on the way through.
  assert.deepEqual([...full.seen[0].forcedBreakIds],['stored-break']);
  assert.deepEqual([...full.forced],['stored-break']);
  assert.equal(full.seen[0].mergeUpIds,full.merged);
});

test('closing the peek writes any picture resized inside it back (pvsFlush)', () => {
  // The − / + pills inside the exported hover change `block.scale` in memory
  // and the write is deferred to the close — so a hide that stopped calling
  // pvsFlush is a size the teacher watched change and that never reached the
  // bank.
  const h = harness();
  h.api.list = [{ id: 'a', title: 'A', blocks: [] }];
  const before = h.api.flushes;
  h.show(h.anchor('a')); h.flush();
  h.api.hide();
  assert.ok(h.api.flushes > before, 'vetPrintPeekHide did not flush the picture sizes');
  // …and the pack hangs the pills on the exported pages, or the hover's
  // pictures carry no control at all.
  assert.ok(/pvsDecorateDoc\(doc\)/.test(cut('function _wsPreviewPack(', '// WORKSHEET QUICK EDIT')), '_wsPreviewPack does not decorate the pages with the picture-size pills');
});
