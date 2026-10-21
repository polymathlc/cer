// Standalone worksheet covers: real renderers, editing handlers and persisted export data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

for (const subject of ['math', 'science']) {
  const source = readFileSync(new URL(`../${subject}-worksheet.html`, import.meta.url), 'utf8');
  const section = (from, to) => {
    const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, `Missing section: ${from}`);
    return source.slice(start, end);
  };
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, events: {}, classList: { toggle() {} }, addEventListener(type, handler) { this.events[type] = handler; } });
    return elements.get(id);
  };
  const ctx = vm.createContext({ console, URL, document: {
    currentScript: { src: 'https://polymathlc.github.io/cer/worksheet-cover.js' },
    getElementById: getElement, querySelector: () => null, createElement: () => ({}), head: { appendChild() {} }
  } });
  vm.runInContext('globalThis.window=globalThis;', ctx);
  ctx.document.getElementById = id => id === 'worksheet-cover-styles' ? {} : id === 'coverPreviewWrap' ? null : getElement(id);
  vm.runInContext(readFileSync(new URL('../worksheet-cover.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`
    let state={title:'Test worksheet',subtitle:'',questions:[]}; let saved=0;
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const previewTitleEl={textContent:''};
    function scheduleAutoSave(){saved++;}
    function getContents(){return {enabled:false};}
    function ensureContentsPreview(){}
    function getEmbeddedPreviewCss(){return '';}
    function getPrintCss(){return '';}
    function buildContentsHtml(){return '';}
    ${section('function defaultCover()', 'function defaultContents()')}
    ${section('function coverDecoSvg()', 'function contentsSnippet(')}
    ${section('const COVER_LOGO_URL', 'function ensureContentsPreview()')}
    ${section('function applyCoverEnabledClass()', 'const COVER_LOGO_URL')}
    ${section('function getCoverCss()', 'function buildPrintableHtml()')}
    ${section('function buildPrintableHtml()', 'function questionToPrintHtml(')}
    ${section('function buildStandaloneHtml()', 'function questionToHtml(')}
    ${section('function dvCoverPageHtml()', 'function dvContentsPageHtml()')}
    ${section('function serializeStateForCloud(', 'function withTimeout(')}
    globalThis.api={setState:s=>state=s,getState:()=>state,getSaved:()=>saved,getCover,syncCoverInputs,
      buildCoverHtml,buildCoverPreviewMarkup,dvCoverPageHtml,wireCoverPreviewEditing,
      buildPrintableHtml,buildStandaloneHtml,serializeStateForCloud,getCoverCss};
  `, ctx);
  const api = ctx.api;
  vm.runInContext(section('var DV_ENGINE', 'function dvCoverPageHtml()') + ';globalThis.designEngine=DV_ENGINE;', ctx);

  test(`${subject}: Design edits preserve line breaks and its embedded script compiles`, () => {
    assert.doesNotThrow(() => new vm.Script(ctx.designEngine));
    assert.match(ctx.designEngine, /fieldText=typeof fieldEl\.innerText/);
    assert.match(ctx.designEngine, /field:f, value:fieldText/);
    assert.match(ctx.designEngine, /act==='toggle-fields'/);
  });

  test(`${subject}: old worksheets gain defaults without replacing saved values`, () => {
    api.setState({ title:'Older paper', questions:[], cover:{enabled:true,header:'My centre',footer:'Final paper',fields:false} });
    const cover = api.getCover();
    assert.equal(cover.header, 'My centre'); assert.equal(cover.footer, 'Final paper'); assert.equal(cover.fields, false);
    assert.equal(cover.nameLabel, 'Name'); assert.equal(cover.dateLabel, 'Date'); assert.equal(cover.artworkOpacity, .72);
    assert.equal(api.getCover(), cover, 'defaults must not replace the object an input handler is editing');
  });

  test(`${subject}: saved text and subject artwork survive every cover/export route`, () => {
    api.setState({ title:'Plants & <light>\nInvestigation', questions:[], cover:{enabled:true,header:'P O L Y M A T H',subheader:'Primary '+subject,
      footer:'Term 4',nameLabel:'Student & class',dateLabel:'Lesson date',artworkLayout:'frame',artworkScale:1.25,artworkOpacity:.42} });
    const staticCover = api.buildCoverHtml(), preview = api.buildCoverPreviewMarkup(), design = api.dvCoverPageHtml();
    for (const html of [staticCover, preview, design, api.buildPrintableHtml(), api.buildStandaloneHtml()]) {
      assert.match(html, new RegExp(`assets/worksheet-covers/${subject}-icons\\.png`));
      assert.doesNotMatch(html, new RegExp(`assets/worksheet-covers/${subject === 'math' ? 'science' : 'math'}-icons\\.png`));
      assert.match(html, /assets\/branding\/polymath-learning-centre\.png/);
      assert.doesNotMatch(html, /dropbox\.com/);
      assert.match(html, /Plants &amp; &lt;light&gt;\nInvestigation/);
      assert.match(html, /Student &amp; class/); assert.match(html, /Lesson date/);
      assert.match(html, /data-cover-layout="frame"/); assert.match(html, /--wc-art-scale:1\.25;--wc-art-opacity:0\.42/);
    }
    for (const field of ['header','title','subheader','footer','nameLabel','dateLabel']) {
      assert.ok(preview.includes(`data-cover-field="${field}"`)); assert.ok(design.includes(`data-cover-field="${field}"`));
    }
    assert.doesNotMatch(staticCover, /contenteditable/);
    const stored=JSON.parse(api.serializeStateForCloud(api.getState()));
    assert.equal(stored.cover.artworkLayout,'frame'); assert.equal(stored.cover.nameLabel,'Student & class'); assert.equal(stored.cover.artworkOpacity,.42);
    assert.match(api.getCoverCss(), /\.cover-artwork\s*\{/); assert.match(api.getCoverCss(), /white-space:pre-line/);
  });

  test(`${subject}: settings edits autosave and restore labels, layout, size and intensity`, () => {
    api.setState({title:'Editing',questions:[],cover:{enabled:true}}); api.syncCoverInputs();
    for (const [id,value] of [['coverNameLabelInput','Candidate'],['coverDateLabelInput','Date of lesson'],['coverArtworkLayout','minimal'],['coverArtworkScale','135'],['coverArtworkOpacity','58']]) {
      const input=getElement(id); input.value=value; input.events.input({target:input});
    }
    const cover=api.getCover(); assert.equal(cover.nameLabel,'Candidate'); assert.equal(cover.dateLabel,'Date of lesson');
    assert.equal(cover.artworkLayout,'minimal'); assert.equal(cover.artworkScale,1.35); assert.equal(cover.artworkOpacity,.58);
    assert.ok(api.getSaved()>=5);
    api.syncCoverInputs(); assert.equal(getElement('coverArtworkScale').value,135); assert.equal(getElement('coverNameLabelInput').value,'Candidate');
  });

  test(`${subject}: inline edits preserve Enter and synchronize settings`, () => {
    api.setState({title:'Editing',questions:[],cover:{enabled:true}});
    const field={dataset:{coverField:'nameLabel'},textContent:'FirstSecond',innerText:'First\nSecond',events:{},addEventListener(type,handler){this.events[type]=handler;}};
    api.wireCoverPreviewEditing({querySelectorAll:()=>[field]}); field.events.input();
    assert.equal(api.getCover().nameLabel,'First\nSecond'); assert.equal(getElement('coverNameLabelInput').value,'First\nSecond');
    assert.match(api.buildCoverHtml(), /First\nSecond/);
    const title={...field,dataset:{coverField:'title'},innerText:'Line one\nLine two',events:{}};
    api.wireCoverPreviewEditing({querySelectorAll:()=>[title]}); title.events.input();
    assert.equal(api.getState().title,'Line one\nLine two');
  });

  test(`${subject}: hiding student fields works with and without a cover`, () => {
    api.setState({title:'Clean paper',questions:[],cover:{enabled:true,fields:false}});
    assert.doesNotMatch(api.buildCoverHtml(), /class="cover-fields-grid/);
    api.getCover().enabled=false;
    assert.equal(api.buildCoverHtml(),'');
    assert.doesNotMatch(api.buildPrintableHtml(), /<div class="student-row">/);
  });
}
