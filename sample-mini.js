'use strict';

(() => {
  const API = 'https://us-central1-mathgen--app.cloudfunctions.net/studyBuddySample';
  const subject = document.body.dataset.sampleSubject;
  const status = document.getElementById('sampleStatus'), retry = document.getElementById('sampleRetry');
  const nav = document.getElementById('sampleNav'), card = document.getElementById('sampleQuestion');
  let questions = [], token = '', selected = 0, pending = false, loadEpoch = 0;
  const attempts = new Map();
  let annotationPads = new Map();
  function element(tag, className, content) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (content != null) node.textContent = content; return node;
  }
  // Content is rendered as text or explicitly constructed nodes. Stored bank
  // HTML never enters the host document. Review content is released by the
  // service only after checking; interactive apps reuse CER's opaque sandbox.
  function mathText(node, value) {
    const text = String(value || ''), pattern = /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}|([_^])\(([^()]+)\)/g;
    let start = 0, match;
    while ((match = pattern.exec(text))) {
      node.append(document.createTextNode(text.slice(start, match.index)));
      if (match[1] != null) {
        const fraction = element('span', 'math-fraction');
        fraction.setAttribute('aria-label', match[1] + ' divided by ' + match[2]);
        fraction.append(element('span', '', match[1]), element('span', '', match[2])); node.append(fraction);
      } else node.append(element(match[3] === '^' ? 'sup' : 'sub', '', match[4]));
      start = pattern.lastIndex;
    }
    node.append(document.createTextNode(text.slice(start)));
  }
  async function request(body) {
    const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(body.action === 'check' ? 110000 : 60000) });
    let result; try { result = await response.json(); } catch { throw new Error('The sample service did not reply. Please try again.'); }
    if (!response.ok) throw new Error(result.message || result.error?.message || 'The sample is unavailable right now. Please try again.');
    return result;
  }
  function attempt(q) {
    if (!attempts.has(q.id)) attempts.set(q.id, { responses: {}, result: null, annotations: {} });
    return attempts.get(q.id);
  }
  function clearReview(q) {
    attempt(q).result = null; hideWhy();
    card.querySelectorAll('.feedback,.review-card,.why-note,.why-button,.retry-button').forEach(node => node.remove());
    card.querySelectorAll('.option').forEach(node => { delete node.dataset.verdict; });
  }
  function answerField(q, id, label) {
    const wrap = element('label', 'answer-field'), input = element('textarea');
    input.maxLength = 5000; input.rows = 4; input.disabled = pending; input.value = attempt(q).responses[id] || '';
    input.addEventListener('input', () => { attempt(q).responses[id] = input.value; clearReview(q); });
    wrap.append(element('span', '', label), input); return wrap;
  }
  function feedback(result) {
    const node = element('div', 'feedback', result.feedback || 'Try again.');
    node.setAttribute('role', 'status'); node.dataset.verdict = result.verdict || 'uncertain'; return node;
  }
  function markedReview(state) {
    return ['correct', 'incorrect', 'partly-correct'].includes(state.result?.verdict) && state.result.review && typeof state.result.review === 'object' ? state.result.review : null;
  }
  function optionLabel(q, index, text) {
    const letters = (q.labelStyle || q.mcqLabels) === 'letters' || (!(q.labelStyle || q.mcqLabels) && /^(?:sec|secondary|s[1-5]\b)/i.test(q.level || ''));
    const label = letters ? String.fromCharCode(65 + index) : String(index + 1);
    const copy = String(text || ''), bare = copy.match(/^\s*\(\s*([1-9]|[A-Ha-h])\s*\)\s*$/);
    const number = bare && (/^[a-h]$/i.test(bare[1]) ? bare[1].toUpperCase().charCodeAt(0) - 64 : Number(bare[1]));
    return !copy || number === index + 1 ? '(' + label + ')' : '(' + label + ') ' + copy;
  }
  function imageSize(node, block) {
    const chosen = Number(block.scale) > 0;
    node.style.maxWidth = chosen ? '100%' : '70%';
    if (chosen) node.style.width = Math.max(20, Math.min(100, Number(block.scale) * 100)) + '%';
  }
  function annotation(q, block) {
    const state = attempt(q); state.annotations[block.id] ||= {};
    const pad = window.SampleAnnotations.create({block,state:state.annotations[block.id],disabled:pending,onChange() {
      delete state.responses[block.id]; clearReview(q);
    }});
    if (block.type === 'image') imageSize(pad.node.querySelector('.annotation-canvas'), block);
    annotationPads.set(block.id, pad); card.append(pad.node);
    if (block.caption) card.append(element('p', 'diagram-caption', block.caption));
  }
  let whyPopup, whyAnchor, whyPinned = false, whyTimer, whyHideTimer, whyId = 0;
  function hideWhy() {
    clearTimeout(whyTimer); clearTimeout(whyHideTimer);
    if (whyAnchor) { whyAnchor.setAttribute('aria-expanded', 'false'); whyAnchor.removeAttribute('aria-describedby'); }
    whyAnchor = null; whyPinned = false; if (whyPopup) whyPopup.hidden = true;
  }
  function dismissWhy() {
    const anchor = whyAnchor, returnFocus = whyPopup?.contains(document.activeElement);
    hideWhy(); if (returnFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }
  function whySoon() {
    clearTimeout(whyTimer);
    if (!whyPinned) { clearTimeout(whyHideTimer); whyHideTimer = setTimeout(hideWhy, 160); }
  }
  function showWhy(button, label, reason, pinned = false) {
    hideWhy(); whyAnchor = button; whyPinned = pinned;
    if (!whyPopup) {
      whyPopup = element('aside', 'why-popup'); whyPopup.id = 'sampleWhy'; whyPopup.hidden = true;
      whyPopup.setAttribute('role', 'dialog'); whyPopup.setAttribute('aria-label', 'Why this option is wrong');
      whyPopup.addEventListener('mouseenter', () => clearTimeout(whyHideTimer));
      whyPopup.addEventListener('mouseleave', whySoon); document.body.append(whyPopup);
    }
    const close = element('button', 'why-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close explanation');
    close.addEventListener('click', () => { hideWhy(); button.focus({ preventScroll: true }); });
    whyPopup.replaceChildren(element('strong', '', label + ' — why this is wrong'), close, element('p', '', reason));
    whyPopup.hidden = false; button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-describedby', whyPopup.id);
    const anchor = button.getBoundingClientRect(), width = whyPopup.offsetWidth, height = whyPopup.offsetHeight;
    const pad = 10, gap = 10;
    let top = anchor.top - height - gap;
    if (top < pad) top = anchor.bottom + gap;
    whyPopup.style.left = Math.max(pad, Math.min(anchor.right - width, window.innerWidth - width - pad)) + 'px';
    whyPopup.style.top = Math.max(pad, Math.min(top, window.innerHeight - height - pad)) + 'px';
  }
  function whyButton(label, reason) {
    const button = element('button', 'why-button', 'ⓘ'); button.type = 'button'; button.id = 'sampleWhyButton-' + (++whyId);
    button.setAttribute('aria-label', 'Why is ' + label + ' wrong?'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('mouseenter', () => { clearTimeout(whyHideTimer); clearTimeout(whyTimer); if (!whyPinned) whyTimer = setTimeout(() => showWhy(button, label, reason), 160); });
    button.addEventListener('mouseleave', whySoon);
    button.addEventListener('click', () => { if (whyAnchor === button && whyPinned) hideWhy(); else showWhy(button, label, reason, true); });
    button.addEventListener('keydown', event => { if (event.key === 'Escape') hideWhy(); });
    return button;
  }
  window.addEventListener('scroll', hideWhy, true); window.addEventListener('resize', hideWhy);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dismissWhy(); });
  document.addEventListener('click', event => {
    if (whyPinned && !whyPopup?.contains(event.target) && event.target !== whyAnchor) hideWhy();
  });
  function reviewCard(title, text) {
    const node = element('section', 'review-card'); node.append(element('h3', '', title));
    if (text) { const copy = element('div', 'question-text'); mathText(copy, text); node.append(copy); }
    return node;
  }
  function reviewImages(title, diagrams) {
    const valid = (Array.isArray(diagrams) ? diagrams : []).filter(item => typeof (item?.url || item) === 'string');
    if (!valid.length) return;
    const node = reviewCard(title);
    valid.forEach(item => {
      const image = element('img', 'diagram'); image.src = item.url || item; image.alt = item.label || title; image.loading = 'lazy';
      if (Number(item.scale) > 0) image.style.width = Math.max(20, Math.min(100, Number(item.scale) * 100)) + '%';
      image.addEventListener('error', () => image.replaceWith(element('p', 'diagram-error', 'This explanation diagram could not load.')));
      node.append(image);
    }); card.append(node);
  }
  function showReview(review) {
    if (review.explanation) card.append(reviewCard('Explanation', review.explanation));
    if (review.modelAnswer) card.append(reviewCard('Model answer', review.modelAnswer));
    reviewImages('Answer diagram', review.answerDiagrams); reviewImages('Picture it', review.explanationDiagrams);
    for (const widget of Array.isArray(review.widgets) ? review.widgets : []) {
      if (!String(widget?.html || '').trim() || !window.QuestionApps) continue;
      const node = reviewCard(widget.title || 'Explore it — interactive'), holder = element('div', 'widget-holder');
      const tools = element('div', 'widget-tools'), reset = element('button', '', 'Restart activity'), expand = element('button', '', 'Expand activity');
      reset.type = expand.type = 'button'; expand.setAttribute('aria-expanded', 'false');
      function start() {
        const frame = element('iframe', 'question-app-frame'); frame.title = widget.title || 'Explore this question';
        frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
        frame.style.height = window.QuestionApps.normalizeHeight(widget.height) + 'px'; frame.srcdoc = window.QuestionApps.sandboxDocument(widget.html);
        holder.replaceChildren(frame);
      }
      reset.addEventListener('click', start);
      expand.addEventListener('click', () => {
        const expanded = node.classList.toggle('widget-expanded'); expand.textContent = expanded ? 'Restore activity size' : 'Expand activity';
        expand.setAttribute('aria-expanded', String(expanded));
      });
      tools.append(reset, expand); node.append(tools, holder); card.append(node); start();
    }
    if (review.reasonError) { const note = element('p', 'why-note', review.reasonError); note.setAttribute('role', 'status'); card.append(note); }
    const reset = element('button', 'retry-button', 'Try this question again'); reset.type = 'button'; reset.disabled = pending;
    reset.addEventListener('click', () => {
      attempts.delete(questions[selected].id); render(); card.querySelector('input,textarea')?.focus({ preventScroll: true });
    }); card.append(reset);
  }
  function render() {
    const q = questions[selected]; if (!q) return;
    const state = attempt(q), review = markedReview(state); hideWhy(); card.replaceChildren(); nav.replaceChildren(); annotationPads = new Map();
    questions.forEach((item, index) => {
      const button = element('button', '', String(index + 1)); button.type = 'button';
      button.setAttribute('aria-label', 'Question ' + (index + 1)); button.setAttribute('aria-current', String(index === selected));
      button.addEventListener('click', () => {
        selected = index; render(); nav.querySelector('[aria-current=true]')?.focus({ preventScroll: true });
      }); nav.append(button);
    });
    card.append(element('p', 'question-meta', [q.level, q.topic].filter(Boolean).join(' · ')), element('h2', '', q.title));
    for (const block of q.blocks || []) {
      if (['text', 'part'].includes(block.type)) {
        const paragraph = element('div', block.type === 'part' ? 'question-part' : 'question-text');
        if (block.label) paragraph.append(element('strong', '', block.label));
        const copy = element('span', 'question-text'); mathText(copy, block.text); paragraph.append(copy); card.append(paragraph);
      } else if (block.type === 'image') {
        if (block.annotate) { annotation(q, block); continue; }
        const image = element('img', 'diagram'); image.src = block.url; image.alt = block.label || 'Question diagram';
        imageSize(image, block);
        image.addEventListener('error', () => { image.replaceWith(element('p', 'diagram-error', 'This question’s diagram could not load. Try loading the sample again.')); }); card.append(image);
        if (block.caption) card.append(element('p', 'diagram-caption', block.caption));
      } else if (block.type === 'annotation') {
        annotation(q, block);
      } else if (block.type === 'table') {
        const wrap = element('div', 'table-wrap'), table = element('table');
        if (block.caption) table.append(element('caption', '', block.caption));
        (block.rows || []).forEach((row, r) => {
          const tr = element('tr'); row.forEach(cell => { const td = element(r === 0 && block.header ? 'th' : 'td'); mathText(td, cell); tr.append(td); }); table.append(tr);
        }); wrap.append(table); card.append(wrap);
      } else if (block.type === 'mcq') {
        const group = element('fieldset'); group.append(element('legend', '', 'Choose your answer'));
        const graded = review?.mcq?.find(item => item.blockId === block.id);
        (block.options || []).forEach((option, index) => {
          const row = element('div', 'option'), label = element('label', 'option-answer'), input = element('input'), copy = element('span');
          input.type = 'radio'; input.name = 'choice-' + block.id; input.value = String(option.id); input.disabled = pending;
          input.checked = state.responses[block.id] === String(option.id);
          input.addEventListener('change', () => { state.responses[block.id] = input.value; clearReview(q); });
          mathText(copy, optionLabel(q, index, option.text)); label.append(input, copy); row.append(label);
          if (graded && graded.correctId === String(option.id)) row.dataset.verdict = 'correct';
          else if (graded && input.checked) row.dataset.verdict = 'incorrect';
          const why = graded?.options?.find(item => item.id === String(option.id))?.why;
          if (why && graded.correctId !== String(option.id)) row.append(whyButton(optionLabel(q, index, ''), why));
          group.append(row);
        }); card.append(group);
      } else if (block.type === 'fillblank') {
        const sentence = element('div', 'question-text blank-sentence'); let blankIndex = 0;
        for (const segment of block.segments || []) {
          if (segment.type !== 'blank') { mathText(sentence, segment.text); continue; }
          const id = block.id + ':blank:' + blankIndex++, input = element('input', 'blank-input');
          input.type = 'text'; input.maxLength = 5000; input.disabled = pending; input.value = state.responses[id] || '';
          input.setAttribute('aria-label', 'Blank ' + blankIndex); input.autocomplete = 'off';
          input.addEventListener('input', () => { state.responses[id] = input.value; clearReview(q); }); sentence.append(input);
        } card.append(sentence);
      } else if (block.type === 'cer') {
        for (const [field, label] of [['claim', 'Claim — what do you conclude?'], ['evidence', 'Evidence — what in the question supports it?'], ['reasoning', 'Reasoning — explain the science linking them.']]) card.append(answerField(q, block.id + ':' + field, label));
      } else if (block.type === 'response') {
        if (block.text) { const paragraph = element('p', 'question-text'); mathText(paragraph, block.text); card.append(paragraph); }
        card.append(answerField(q, block.id, block.label || 'Your answer'));
      }
    }
    const check = element('button', 'check-button', pending ? 'Checking your answer…' : 'Check my answer');
    check.type = 'button'; check.disabled = pending; check.addEventListener('click', () => mark(q)); card.append(check);
    if (state.result) card.append(feedback(state.result));
    if (review) showReview(review);
    nav.hidden = false; card.hidden = false;
  }
  async function mark(q) {
    if (pending) return;
    const state = attempt(q);
    const pads = [...annotationPads.entries()];
    if (!Object.values(state.responses).some(value => String(value).trim()) && !pads.some(([, pad]) => pad.hasMarks())) {
      state.result = { feedback: 'Write an answer or choose an option first.' }; render(); return;
    }
    pending = true; render();
    try {
      for (const [id, pad] of pads) { const png = await pad.exportPNG(); if (png) state.responses[id] = png; else delete state.responses[id]; }
      state.result = await request({ action: 'check', subject, token, questionId: q.id, responses: { ...state.responses } });
    }
    catch (error) { state.result = { verdict: 'uncertain', feedback: error.message }; }
    finally {
      pending = false; render();
      if (questions[selected]?.id === q.id) card.querySelector('.check-button')?.focus({ preventScroll: true });
    }
  }
  async function load() {
    const epoch = ++loadEpoch; status.textContent = 'Loading the teacher’s sample questions…'; retry.hidden = true;
    nav.hidden = true; card.hidden = true;
    try {
      const result = await request({ action: 'questions', subject }); if (epoch !== loadEpoch) return;
      token = result.token; questions = Array.isArray(result.questions) ? result.questions : []; selected = 0;
      status.textContent = questions.length ? questions.length + ' teacher-selected question' + (questions.length === 1 ? '' : 's') + ' · no account needed'
        : 'The teacher is preparing these sample questions. You can try the worksheet tutor in the next section.';
      render();
    } catch (error) { if (epoch !== loadEpoch) return; status.textContent = error.message; retry.hidden = false; }
  }
  retry.addEventListener('click', load); load();
})();
