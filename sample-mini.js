'use strict';

(() => {
  const API = 'https://us-central1-mathgen--app.cloudfunctions.net/studyBuddySample';
  const subject = document.body.dataset.sampleSubject;
  const status = document.getElementById('sampleStatus'), retry = document.getElementById('sampleRetry');
  const nav = document.getElementById('sampleNav'), card = document.getElementById('sampleQuestion');
  let questions = [], token = '', selected = 0, pending = false, loadEpoch = 0;
  const attempts = new Map();
  function element(tag, className, content) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (content != null) node.textContent = content; return node;
  }
  // Content is rendered as text or explicitly constructed nodes. Stored bank
  // HTML never enters innerHTML, and answer keys are never sent by this API.
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
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    let result; try { result = await response.json(); } catch { throw new Error('The sample service did not reply. Please try again.'); }
    if (!response.ok) throw new Error(result.message || result.error?.message || 'The sample is unavailable right now. Please try again.');
    return result;
  }
  function attempt(q) {
    if (!attempts.has(q.id)) attempts.set(q.id, { responses: {}, result: null });
    return attempts.get(q.id);
  }
  function answerField(q, id, label) {
    const wrap = element('label', 'answer-field'), input = element('textarea');
    input.maxLength = 5000; input.rows = 4; input.disabled = pending; input.value = attempt(q).responses[id] || '';
    input.addEventListener('input', () => { attempt(q).responses[id] = input.value; attempt(q).result = null; card.querySelector('.feedback')?.remove(); });
    wrap.append(element('span', '', label), input); return wrap;
  }
  function feedback(result) {
    const node = element('div', 'feedback', result.feedback || 'Try again.');
    node.setAttribute('role', 'status'); node.dataset.verdict = result.verdict || 'uncertain'; return node;
  }
  function render() {
    const q = questions[selected]; if (!q) return;
    const state = attempt(q); card.replaceChildren(); nav.replaceChildren();
    questions.forEach((item, index) => {
      const button = element('button', '', String(index + 1)); button.type = 'button';
      button.setAttribute('aria-label', 'Question ' + (index + 1)); button.setAttribute('aria-current', String(index === selected));
      button.addEventListener('click', () => { selected = index; render(); }); nav.append(button);
    });
    card.append(element('p', 'question-meta', [q.level, q.topic].filter(Boolean).join(' · ')), element('h2', '', q.title));
    for (const block of q.blocks || []) {
      if (['text', 'part'].includes(block.type)) {
        const paragraph = element('div', block.type === 'part' ? 'question-part' : 'question-text');
        if (block.label) paragraph.append(element('strong', '', block.label));
        const copy = element('span', 'question-text'); mathText(copy, block.text); paragraph.append(copy); card.append(paragraph);
      } else if (block.type === 'image') {
        const image = element('img', 'diagram'); image.src = block.url; image.alt = block.label || 'Question diagram';
        image.addEventListener('error', () => { image.replaceWith(element('p', 'diagram-error', 'This question’s diagram could not load. Try loading the sample again.')); }); card.append(image);
      } else if (block.type === 'table') {
        const wrap = element('div', 'table-wrap'), table = element('table');
        if (block.caption) table.append(element('caption', '', block.caption));
        (block.rows || []).forEach((row, r) => {
          const tr = element('tr'); row.forEach(cell => { const td = element(r === 0 && block.header ? 'th' : 'td'); mathText(td, cell); tr.append(td); }); table.append(tr);
        }); wrap.append(table); card.append(wrap);
      } else if (block.type === 'mcq') {
        const group = element('fieldset'); group.append(element('legend', '', 'Choose your answer'));
        (block.options || []).forEach((option, index) => {
          const label = element('label', 'option'), input = element('input'), copy = element('span');
          input.type = 'radio'; input.name = 'choice-' + block.id; input.value = String(option.id); input.disabled = pending;
          input.checked = state.responses[block.id] === String(option.id);
          input.addEventListener('change', () => { state.responses[block.id] = input.value; state.result = null; card.querySelector('.feedback')?.remove(); });
          const optionText = /^\s*\(?[A-D1-8]\)?[.)]?\s*$/.test(option.text || '') ? option.text : '(' + (index + 1) + ') ' + option.text;
          mathText(copy, optionText); label.append(input, copy); group.append(label);
        }); card.append(group);
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
    nav.hidden = false; card.hidden = false;
  }
  async function mark(q) {
    if (pending) return;
    const state = attempt(q);
    if (!Object.values(state.responses).some(value => String(value).trim())) {
      state.result = { feedback: 'Write an answer or choose an option first.' }; render(); return;
    }
    pending = true; render();
    try { state.result = await request({ action: 'check', subject, token, questionId: q.id, responses: { ...state.responses } }); }
    catch (error) { state.result = { verdict: 'uncertain', feedback: error.message }; }
    finally { pending = false; render(); }
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
