/* Public demos use published samples only. Teacher writes go through an authenticated API. */
(function () {
  'use strict';
  const API = 'https://us-central1-mathgen--app.cloudfunctions.net/sampleMaterialsAdmin';
  const SUBJECTS = ['math', 'science'];
  const LABEL = { math: 'Math', science: 'Science' };
  const APPS = {
    math: 'https://polymathlc.github.io/math/sample-materials.html',
    science: 'https://polymathlc.github.io/cer/sample-materials.html',
    tutor: 'https://polymathlc.github.io/tutor/sample.html'
  };
  const state = { materials: {}, admin: false, active: location.hash === '#sample-materials', loaded: false, frames: new Map(), banks: {}, selections: {}, busy: false };
  const byId = id => document.getElementById(id);
  const esc = escapeHtml;
  const value = subject => state.materials[subject] || {};
  const selectedIds = subject => (value(subject).questionIds || []).slice(0, 5);
  function status(subject, message, error) {
    const node = byId('sample-status-' + subject);
    if (node) { node.textContent = message; node.classList.toggle('error', !!error); }
  }
  function closeDemo(subject) {
    for (const [key, frame] of state.frames) {
      if (subject && key !== subject) continue;
      frame.src = 'about:blank';
      frame.closest('.sample-embed').remove();
      state.frames.delete(key);
    }
  }
  function loadPreviews(subjects = SUBJECTS) {
    if (!state.active || !state.loaded) return;
    for (const subject of subjects) {
      if (selectedIds(subject).length && !state.frames.has(subject)) openDemo(subject, 'questions', { scroll: false });
    }
  }
  function renderPublic(previous) {
    const content = byId('sample-materials-content');
    const changed = [];
    if (!content.querySelector('.sample-subject')) content.replaceChildren();
    SUBJECTS.forEach(subject => {
      const sample = value(subject);
      const existing = byId('sample-subject-' + subject);
      if (existing && JSON.stringify(previous?.[subject] || {}) === JSON.stringify(sample)) return;
      changed.push(subject);
      closeDemo(subject);
      const count = selectedIds(subject).length;
      const worksheet = sample.worksheet;
      const html = '<section class="sample-subject" id="sample-subject-' + subject + '" aria-labelledby="sample-heading-' + subject + '">' +
        '<h2 id="sample-heading-' + subject + '">' + LABEL[subject] + '</h2><div class="sample-options">' +
        '<article class="card sample-option"><h3>' + (subject === 'math' ? 'Math practice' : 'Science CER practice') + '</h3>' +
        '<p>' + (subject === 'math' ? 'Try a few selected questions with our interactive Math app.' : 'Build your answer using Claim, Evidence and Reasoning in our Science app.') + '</p>' +
        '<p>' + (count ? count + ' sample question' + (count === 1 ? '' : 's') + ' ready to try.' : 'Sample questions will appear here when our teacher publishes them.') + '</p>' +
        '<button class="btn" data-demo="questions" data-subject="' + subject + '"' + (!count ? ' disabled' : '') + '>Try questions</button></article>' +
        '<article class="card sample-option"><h3>' + LABEL[subject] + ' worksheet &amp; live tutor</h3>' +
        '<p>Write on a sample PDF worksheet and get help from our live tutor, enabled when you begin. Allow microphone access to speak with the tutor.</p>' +
        '<p>' + (worksheet ? esc(worksheet.title || LABEL[subject] + ' sample worksheet') : 'A sample worksheet will appear here when our teacher uploads it.') + '</p>' +
        '<button class="btn" data-demo="worksheet" data-subject="' + subject + '"' + (!worksheet ? ' disabled' : '') + '>Try worksheet</button></article></div></section>';
      if (existing) existing.outerHTML = html;
      else content.insertAdjacentHTML('beforeend', html);
      byId('sample-subject-' + subject).querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => openDemo(button.dataset.subject, button.dataset.demo)));
    });
    loadPreviews(changed);
  }
  function openDemo(subject, kind, { scroll = true } = {}) {
    if (!state.active || !SUBJECTS.includes(subject)) return;
    const sample = value(subject);
    if (kind === 'worksheet' ? !sample.worksheet : !selectedIds(subject).length) return;
    closeDemo(subject);
    const wrap = document.createElement('div');
    wrap.className = 'sample-embed';
    const toolbar = document.createElement('div');
    toolbar.className = 'sample-embed-toolbar';
    const title = document.createElement('strong');
    title.textContent = LABEL[subject] + (kind === 'worksheet' ? ' worksheet & live tutor' : ' sample questions');
    const close = document.createElement('button');
    close.className = 'btn small ghost'; close.textContent = 'Close demo'; close.addEventListener('click', () => closeDemo(subject));
    toolbar.append(title, close);
    const frame = document.createElement('iframe');
    frame.className = 'sample-frame'; frame.title = title.textContent;
    frame.allow = 'microphone; autoplay; fullscreen';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const url = new URL(kind === 'worksheet' ? APPS.tutor : APPS[subject]);
    url.searchParams.set('subject', subject);
    frame.src = url.href;
    wrap.append(toolbar, frame);
    byId('sample-subject-' + subject).append(wrap);
    state.frames.set(subject, frame);
    if (scroll) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function adminCall(action, payload) {
    if (!state.admin || !auth.currentUser) throw new Error('Teacher sign-in required.');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ action }, payload)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'Could not save sample materials. Please try again.');
    return result;
  }
  function renderAdmin() {
    const panel = byId('sample-materials-admin');
    panel.classList.toggle('hidden', !state.admin);
    if (!state.admin) { panel.innerHTML = ''; return; }
    if (state.busy) return;
    panel.innerHTML = '<h2>Publish sample materials</h2><p class="sample-help">Upload one sample worksheet and choose up to five questions per subject. Published materials are available to anyone visiting this page.</p>' + SUBJECTS.map(subject => {
      state.selections[subject] = new Set(selectedIds(subject));
      const worksheet = value(subject).worksheet;
      return '<section class="sample-admin-subject"><h3>' + LABEL[subject] + '</h3>' +
        '<form id="sample-upload-' + subject + '"><div class="grid-2"><div class="field"><label for="sample-title-' + subject + '">Worksheet title</label><input id="sample-title-' + subject + '" maxlength="100" required value="' + esc(worksheet?.title || LABEL[subject] + ' sample worksheet') + '"></div>' +
        '<div class="field"><label for="sample-pdf-' + subject + '">Sample PDF (up to 10 MB, 30 pages)</label><input id="sample-pdf-' + subject + '" type="file" accept="application/pdf,.pdf" required></div></div>' +
        '<button class="btn small" type="submit">Upload &amp; publish worksheet</button></form>' +
        '<div class="sample-admin-actions"><label class="field" for="sample-search-' + subject + '"><span class="sample-help">Find questions</span><input id="sample-search-' + subject + '" type="search" maxlength="100" placeholder="Title, topic or question ID"></label>' +
        '<button class="btn small ghost" data-load="' + subject + '">Load questions</button><span class="sample-selected" id="sample-count-' + subject + '">' + selectedIds(subject).length + ' / 5 selected</span></div>' +
        '<div id="sample-selection-' + subject + '" class="sample-admin-actions"></div>' +
        '<div id="sample-bank-' + subject + '" class="sample-question-list"><p class="sample-help">Load questions to choose the ones students can try.</p></div>' +
        '<div class="sample-admin-actions"><button class="btn small ghost hidden" id="sample-more-' + subject + '">Load more</button><button class="btn small" data-publish="' + subject + '">Publish selected questions</button></div>' +
        '<p class="sample-status" id="sample-status-' + subject + '" role="status" aria-live="polite"></p></section>';
    }).join('');
    SUBJECTS.forEach(subject => {
      byId('sample-upload-' + subject).addEventListener('submit', event => { event.preventDefault(); upload(subject); });
      panel.querySelector('[data-load="' + subject + '"]').addEventListener('click', () => loadQuestions(subject, false));
      byId('sample-search-' + subject).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadQuestions(subject, false); } });
      byId('sample-more-' + subject).addEventListener('click', () => loadQuestions(subject, true));
      panel.querySelector('[data-publish="' + subject + '"]').addEventListener('click', () => publishQuestions(subject));
      state.banks[subject] = null;
      renderSelection(subject);
    });
  }
  function setBusy(busy) {
    state.busy = busy;
    byId('sample-materials-admin').querySelectorAll('button,input').forEach(node => { node.disabled = busy; });
  }
  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read that PDF.'));
      reader.readAsDataURL(file);
    });
  }
  let pdfReaderPromise;
  async function validatePdf(file) {
    if (!window.pdfjsLib) {
      if (!pdfReaderPromise) pdfReaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = resolve;
        script.onerror = () => { pdfReaderPromise = null; script.remove(); reject(new Error('The PDF reader could not load. Please try again.')); };
        document.head.append(script);
      });
      await pdfReaderPromise;
    }
    if (!window.pdfjsLib) throw new Error('The PDF reader could not load. Please try again.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      if (pdf.numPages > 30) throw new Error('Choose a sample worksheet with no more than 30 pages.');
    } catch (error) {
      throw new Error(pdf ? error.message : 'That PDF could not be read. Choose a valid PDF without a password.');
    } finally { if (pdf) await pdf.destroy(); }
  }
  async function upload(subject) {
    if (state.busy) return;
    const file = byId('sample-pdf-' + subject).files[0];
    const title = byId('sample-title-' + subject).value.trim();
    if (!file || !title) { status(subject, 'Choose a PDF and enter a worksheet title.', true); return; }
    if (file.size > 10 * 1024 * 1024 || file.size === 0) { status(subject, 'Choose a PDF no larger than 10 MB.', true); return; }
    const signature = await file.slice(0, 5).text();
    if (signature !== '%PDF-') { status(subject, 'That file is not a PDF.', true); return; }
    setBusy(true); status(subject, 'Checking PDF…');
    try {
      await validatePdf(file);
      status(subject, 'Uploading and publishing worksheet…');
      await adminCall('uploadWorksheet', { subject, title, pdfBase64: await fileBase64(file) });
      byId('sample-pdf-' + subject).value = '';
      status(subject, 'Worksheet published. Students can now try it.');
    } catch (error) { status(subject, error.message, true); }
    finally { setBusy(false); }
  }
  function renderBank(subject) {
    const bank = state.banks[subject];
    const box = byId('sample-bank-' + subject);
    box.innerHTML = bank.questions.length ? bank.questions.map(question => '<label class="sample-question-row"><input type="checkbox" value="' + esc(question.id) + '"' + (state.selections[subject].has(question.id) ? ' checked' : '') + '><span>' + esc(question.title || question.text || question.id) + '<small>' + esc([question.topic, question.type, question.id].filter(Boolean).join(' · ')) + '</small></span></label>').join('') : '<p class="sample-help">No questions found. Try another search.</p>';
    box.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
      const selection = state.selections[subject];
      if (input.checked && selection.size >= 5) { input.checked = false; status(subject, 'Choose up to five questions. Uncheck one to replace it.', true); return; }
      if (input.checked) selection.add(input.value); else selection.delete(input.value);
      renderSelection(subject);
    }));
    byId('sample-more-' + subject).classList.toggle('hidden', !bank.nextCursor);
  }
  function renderSelection(subject) {
    const selection = state.selections[subject];
    byId('sample-count-' + subject).textContent = selection.size + ' / 5 selected';
    const box = byId('sample-selection-' + subject);
    box.replaceChildren();
    for (const id of selection) {
      const button = document.createElement('button');
      const question = state.banks[subject]?.questions.find(item => item.id === id);
      button.className = 'btn small ghost';
      button.textContent = 'Remove ' + (question?.title || id);
      button.addEventListener('click', () => {
        selection.delete(id);
        renderSelection(subject);
        if (state.banks[subject]) renderBank(subject);
      });
      box.append(button);
    }
  }
  async function loadQuestions(subject, more) {
    if (state.busy) return;
    const search = byId('sample-search-' + subject).value.trim();
    const cursor = more ? state.banks[subject]?.nextCursor : undefined;
    setBusy(true); status(subject, 'Loading question bank…');
    try {
      const result = await adminCall('listQuestions', { subject, search, ...(cursor ? { cursor } : {}) });
      const questions = more ? [...state.banks[subject].questions, ...(result.questions || [])] : result.questions || [];
      state.banks[subject] = { questions: Array.from(new Map(questions.map(question => [question.id, question])).values()), nextCursor: result.nextCursor || null };
      renderBank(subject);
      renderSelection(subject);
      status(subject, 'Select questions, then publish.');
    } catch (error) { status(subject, error.message, true); }
    finally { setBusy(false); }
  }
  async function publishQuestions(subject) {
    if (state.busy) return;
    const questionIds = Array.from(state.selections[subject] || []);
    setBusy(true); status(subject, 'Publishing selected questions…');
    try {
      await adminCall('publishQuestions', { subject, questionIds });
      status(subject, questionIds.length ? 'Sample questions published.' : 'Sample questions unpublished.');
    } catch (error) { status(subject, error.message, true); }
    finally { setBusy(false); }
  }
  window.SampleMaterials = { setActive(active) {
    const wasActive = state.active;
    state.active = !!active;
    if (!state.active) closeDemo();
    else if (!wasActive) loadPreviews();
  } };
  CONFIG_DOC.onSnapshot(snapshot => {
    const next = snapshot.exists ? snapshot.data().sampleMaterials || {} : {};
    if (!state.loaded || JSON.stringify(next) !== JSON.stringify(state.materials)) {
      const previous = state.materials;
      state.materials = next; state.loaded = true;
      renderPublic(previous);
      if (!state.busy) renderAdmin();
    }
  }, () => {
    if (!state.loaded) byId('sample-materials-content').innerHTML = '<div class="card">Sample materials could not load. Please refresh to try again.</div>';
  });
  auth.onAuthStateChanged(user => {
    state.admin = !!(user && user.email === ADMIN_EMAIL);
    renderAdmin();
  });
  window.addEventListener('pagehide', () => closeDemo());
})();
