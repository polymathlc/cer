// Shared GrandLine learning bridge. The portal owns the question bank, answer keys,
// grading and history. The embedded game receives only a completed round score.
export const GRAND_LINE_QUESTION_COUNT = 3;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const validRound = value => Number.isSafeInteger(value) && value > 0;
export function grandLineLearningReward(correct) {
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) throw new RangeError('A round has three answers.');
  return { correct, total: 3 };
}
export function grandLineLearningRewardSummary(correct) {
  grandLineLearningReward(correct);
  return `${correct}/3 correct · Wave complete.`;
}
export function validGrandLineQuestions(rows, allowRemote = false) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(q => {
    if (!q || typeof q.id !== 'string' || !q.id || seen.has(q.id) || typeof q.html !== 'string' || !q.html.trim()
      || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8
      || q.options.some(option => typeof option !== 'string' || !option.trim())
      || (!(allowRemote && q.grading === 'remote') && (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length))) return false;
    seen.add(q.id); return true;
  }).slice(0, GRAND_LINE_QUESTION_COUNT);
}

export function createGrandLineLearningController(config) {
  let session = null, generation = 0, disposed = false;
  const identity = () => String(config.getIdentity() || '');
  const send = (target, payload) => { try { target?.postMessage(payload, config.origin); } catch (_) {} };
  const allowed = source => !disposed && config.isAllowed() && config.isActive()
    && source && source === config.getFrame()?.contentWindow;
  function invalidate(message = 'Your learning profile changed. Start a new run to continue.') {
    generation++;
    if (session) send(session.source, { type: 'GLTCG_INVALIDATE', sessionId: session.id, message });
    session = null; config.cancelPresentation?.();
  }
  function current(s) {
    return !disposed && session === s && identity() === s.identity && allowed(s.source);
  }
  async function handleMessage(event) {
    const d = event?.data;
    if (event?.origin !== config.origin || !d || typeof d !== 'object' || !allowed(event.source) || !token(d.requestId)) return false;
    if (session && identity() !== session.identity) invalidate();
    if (d.type === 'GLTCG_HELLO') {
      if (!session || session.helloId !== d.requestId) {
        config.cancelPresentation?.(); generation++;
        session = { id: config.makeSessionId(), identity: identity(), helloId: d.requestId,
          source: event.source, nextRound: 1, completed: new Map(), busy: false, saving: false };
      }
      const greeting = session;
      let snapshot = {};
      try { snapshot = await config.getSnapshot?.() || {}; }
      catch (_) { snapshot = { wallet: { available: false, balance: 0, currency: 'points', offers: [], reason: 'Your saved reward points are unavailable. Reopen the game once the portal has loaded.' } }; }
      if (!current(greeting)) return false;
      send(event.source, { type: 'GLTCG_READY', requestId: d.requestId, sessionId: greeting.id,
        subject: config.subject, profileKey: String(config.getProfileKey?.() || ''), questionCount: GRAND_LINE_QUESTION_COUNT,
        available: !!greeting.identity, reason: greeting.identity ? '' : 'Choose your school level before starting.', ...snapshot });
      return true;
    }
    const s = session;
    if (!s || !s.identity || d.sessionId !== s.id) return false;
    if (['GLTCG_BUY_REQUEST', 'GLTCG_SAVE_REQUEST', 'GLTCG_ADMIN_REQUEST'].includes(d.type)) {
      const buying = d.type === 'GLTCG_BUY_REQUEST', admin = d.type === 'GLTCG_ADMIN_REQUEST';
      const action = admin ? config.adminAction : buying ? config.buyPack : config.saveCollection;
      const reply = { requestId: d.requestId, sessionId: s.id, ...(buying ? { purchaseId: d.purchaseId } : {}),
        ...(admin && typeof d.action === 'string' ? { action: d.action } : {}) };
      const prefix = admin ? 'GLTCG_ADMIN_' : buying ? 'GLTCG_BUY_' : 'GLTCG_SAVE_';
      const adminAllowed = () => config.isAdmin?.() === true;
      if (admin && (!adminAllowed() || typeof action !== 'function')) {
        send(s.source, { ...reply, type: prefix + 'BLOCKED', retryable: false, message: 'Administrator access is required.' }); return true;
      }
      if (admin && !(d.action === 'unlock-all' || (d.action === 'set-unlimited-gold' && typeof d.enabled === 'boolean'))) {
        send(s.source, { ...reply, type: prefix + 'BLOCKED', retryable: false, message: 'Choose a valid administrator action.' }); return true;
      }
      if (typeof action !== 'function' || (buying && (!token(d.purchaseId) || !token(d.packId)))) return false;
      if (s.busy || s.saving) { send(s.source, { ...reply, type: prefix + 'BLOCKED', retryable: true, message: 'Finish the current learning round or save before trying again.' }); return true; }
      s.saving = true; const revision = generation;
      try {
        const request = admin ? { action: d.action, ...(d.action === 'set-unlimited-gold' ? { enabled: d.enabled } : {}) }
          : buying ? { purchaseId: d.purchaseId, packId: d.packId } : { team: d.team, progress: d.progress };
        const snapshot = await action(request);
        if (!current(s) || revision !== generation || (admin && !adminAllowed())) return false;
        send(s.source, { ...snapshot, ...reply, type: prefix + 'RESULT' });
      } catch (error) {
        if (current(s) && revision === generation && (!admin || adminAllowed())) send(s.source, { ...reply, type: prefix + 'BLOCKED', retryable: !error?.confirmedNoCharge,
          ...(error?.confirmedNoCharge ? { confirmedNoCharge: true } : {}), message: error?.message || 'Your change could not be saved. Retry safely.' });
      } finally { if (session === s) s.saving = false; }
      return true;
    }
    if (d.type !== 'GLTCG_ROUND_REQUEST' || !validRound(d.round)) return false;
    if (s.completed.has(d.round)) {
      send(event.source, { ...s.completed.get(d.round), requestId: d.requestId }); return true;
    }
    if (d.round !== s.nextRound) return false;
    if (s.saving) {
      send(s.source, { type: 'GLTCG_ROUND_BLOCKED', requestId: d.requestId, sessionId: s.id,
        round: d.round, retryable: true, message: 'Your wallet or crew is still saving. Retry these questions when the save finishes.' });
      return true;
    }
    if (s.busy) return false;
    s.busy = true; const revision = generation;
    const blocked = message => send(s.source, { type: 'GLTCG_ROUND_BLOCKED', requestId: d.requestId,
      sessionId: s.id, round: d.round, message });
    try {
      const questions = validGrandLineQuestions(await config.getQuestions(), typeof config.gradeQuestion === 'function');
      if (!current(s) || revision !== generation) return false;
      if (questions.length !== GRAND_LINE_QUESTION_COUNT) {
        blocked('Three fresh, suitable questions are needed. Try again later or choose another preview level.');
        return true;
      }
      // Reserve the set together so another mode cannot serve an unseen tail
      // while this round is being answered. Abandonment never grants a reward.
      for (const q of questions) config.markShown?.(q);
      let index = 0, correct = 0, marking = false;
      const graded = new Map();
      const grade = async (questionIndex, choice, ms) => {
        if (marking || !current(s) || revision !== generation || questionIndex !== index || !Number.isInteger(choice)) return null;
        const q = questions[index]; if (!q || choice < 0 || choice >= q.options.length) return null;
        if (graded.has(index)) return graded.get(index);
        let result;
        if (q.grading === 'remote') {
          marking = true;
          try { result = await config.gradeQuestion({ question: q, choice, round: d.round, sessionId: s.id }); }
          finally { marking = false; }
          if (!current(s) || revision !== generation) return null;
          if (!result || typeof result.correct !== 'boolean' || !Number.isInteger(result.answer)
            || result.answer < 0 || result.answer >= q.options.length || result.correct !== (choice === result.answer))
            throw new Error('No valid marking result was returned.');
        } else result = { correct: choice === q.answer, answer: q.answer, explainHtml: q.explainHtml || '' };
        // Claim before the write: rapid clicks cannot double-count history.
        graded.set(index, result); if (result.correct) correct++;
        index++;
        try { await config.recordAnswer?.({ question: q, correct: result.correct, choice,
          ms: Math.max(0, Math.min(3600000, Math.round(Number(ms) || 0))), round: d.round, sessionId: s.id }); }
        catch (error) { config.onRecordError?.(error); }
        if (!current(s) || revision !== generation) return null;
        return result;
      };
      const finished = await config.presentQuestions({ subject: config.subject, questions, grade,
        isCurrent: () => current(s) && revision === generation,
        imageFailed: (q, url) => { if (current(s) && revision === generation) config.onImageFailure?.(q, url); },
        questionUnavailable: (q, reason) => { if (current(s) && revision === generation) config.onQuestionUnavailable?.(q, reason); } });
      if (!current(s) || revision !== generation) return false;
      if (!finished || index !== GRAND_LINE_QUESTION_COUNT) { blocked('The round is paused. Complete three available questions to continue.'); return true; }
      const result = { type: 'GLTCG_ROUND_RESULT', requestId: d.requestId, sessionId: s.id, round: d.round,
        ...grandLineLearningReward(correct) };
      try { const snapshot = await config.getSnapshot?.(); if (snapshot?.wallet) result.wallet = snapshot.wallet; } catch (_) {}
      if (!current(s) || revision !== generation) return false;
      s.completed.set(d.round, result); s.nextRound++;
      // Cap the replay ledger without allowing old rounds to run again.
      if (s.completed.size > 64) s.completed.delete(s.completed.keys().next().value);
      send(s.source, result); return true;
    } catch (error) {
      if (current(s)) blocked('The question bank could not load. Check your connection and try again.');
      config.onError?.(error); return true;
    } finally { if (session === s) s.busy = false; }
  }
  return { handleMessage, invalidate, destroy() { invalidate('Learning session closed.'); disposed = true; },
    getState: () => session ? { sessionId: session.id, nextRound: session.nextRound, busy: session.busy } : null };
}

// Preserve authored labels, diagrams and tables while removing executable
// markup. Bank HTML is data, never permission to run an event handler/script.
export function sanitizeGrandLineQuestionHtml(html, doc = document) {
  const template = doc.createElement('template'); template.innerHTML = String(html || '');
  const tags = new Set(['DIV','SPAN','P','BR','B','STRONG','I','EM','U','S','SUP','SUB','UL','OL','LI',
    'TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CAPTION','IMG','FIGURE','FIGCAPTION','BLOCKQUOTE','HR']);
  const dangerous = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','BUTTON','LINK','META']);
  const properties = new Set(['color','background-color','font-weight','font-style','text-decoration','text-align',
    'vertical-align','white-space','border','border-collapse','padding','margin','margin-top','margin-bottom',
    'width','height','max-width','max-height','min-width','display','overflow','overflow-x','align-items','gap','flex','flex-direction']);
  const classes = new Set(['math-frac','num','den','math-sqrt','root','radicand']);
  const elements = [...template.content.querySelectorAll('*')];
  for (const el of elements) {
    if (dangerous.has(el.tagName)) { el.remove(); continue; }
    if (!tags.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase(), value = attr.value;
      if (name === 'style') {
        const clean = [...el.style].filter(key => properties.has(key)).map(key => [key, el.style.getPropertyValue(key)])
          .filter(([, val]) => !/url\s*\(|expression|@|var\s*\(/i.test(val));
        el.removeAttribute('style'); for (const [key, val] of clean) el.style.setProperty(key, val);
      } else if (name === 'src' && el.tagName === 'IMG') {
        let safe = false;
        try { const url = new URL(value, doc.baseURI); safe = ['https:', 'http:'].includes(url.protocol)
          || /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=]+$/i.test(value); } catch (_) {}
        if (!safe) el.removeAttribute(name);
      } else if (name === 'class') {
        el.className = value.split(/\s+/).filter(value => classes.has(value)).join(' ');
      } else if (!['alt','title','colspan','rowspan','aria-label'].includes(name)) el.removeAttribute(name);
    }
    if (el.tagName === 'IMG') { el.loading = 'eager'; el.decoding = 'async'; el.style.maxWidth = '100%'; el.style.height = 'auto'; }
  }
  return template.innerHTML;
}

// Removing an executable/unsupported visual is safer than running it, but an
// incomplete diagram or formula must never remain an answerable question.
export function grandLineUnsupportedQuestionVisual(question, doc = document) {
  const template = doc.createElement('template');
  for (const html of [question?.html, ...(question?.options || [])]) {
    template.innerHTML = String(html || '');
    if (template.content.querySelector('svg,math,canvas,iframe,object,embed,video,audio')) return true;
  }
  return false;
}

const DIALOG_CSS = `
.grand-line-learning-overlay,.grand-line-learning-overlay *{box-sizing:border-box}
.grand-line-learning-overlay{position:fixed;inset:0;z-index:200000;background:rgba(5,9,20,.84);display:grid;place-items:center;padding:20px;backdrop-filter:blur(9px);font:16px/1.55 system-ui,sans-serif;color:#182031}
.grand-line-learning-dialog{width:min(940px,100%);max-height:calc(100dvh - 40px);overflow:auto;background:#fffdf8;border:2px solid #b69b60;border-radius:22px;box-shadow:0 30px 90px #0008;padding:clamp(18px,4vw,34px)}
.grand-line-learning-top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;color:#6e521e;font-weight:750}
.grand-line-learning-dialog h2{font-size:clamp(20px,3vw,28px);margin:12px 0 4px;color:#192335}.grand-line-learning-copy{margin:0 0 18px;color:#536073}.grand-line-learning-stem{font-size:18px;overflow-wrap:anywhere}.grand-line-learning-stem img{max-width:100%;height:auto}.grand-line-learning-stem table{max-width:100%;border-collapse:collapse}.grand-line-learning-stem td,.grand-line-learning-stem th{padding:7px;border:1px solid #aab2bd}
.grand-line-learning-options{display:grid;gap:11px;margin:20px 0}.grand-line-learning-option{display:flex;gap:13px;align-items:flex-start;text-align:left;border:2px solid #dce0e5;border-radius:13px;padding:14px;background:white;color:#182031;font:inherit;cursor:pointer;min-height:52px}.grand-line-learning-option:hover:not(:disabled){border-color:#865dbe;background:#faf5ff}.grand-line-learning-option:focus-visible,.grand-line-learning-action:focus-visible{outline:3px solid #8c59ca;outline-offset:3px}.grand-line-learning-option:disabled{cursor:default;opacity:1}.grand-line-learning-option[data-correct=true]{background:#e7f6ea;border-color:#319852}.grand-line-learning-option[data-wrong=true]{background:#fff0ed;border-color:#d66d57}.grand-line-learning-number{flex:none;background:#eff0f4;border-radius:7px;width:28px;height:28px;text-align:center;font-weight:750}.grand-line-learning-feedback{padding:13px;border-radius:12px;background:#f0edf8;overflow-wrap:anywhere}.grand-line-learning-feedback:empty{display:none}.grand-line-learning-feedback img{max-width:100%}.grand-line-learning-actions{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:18px}.grand-line-learning-action{min-height:46px;padding:10px 18px;border:0;border-radius:10px;background:#64388f;color:white;font:inherit;font-weight:700;cursor:pointer}.grand-line-learning-action.secondary{background:#eceaf0;color:#333044}.grand-line-learning-action:disabled{opacity:.55;cursor:wait}.grand-line-learning-warning{padding:12px;background:#fff1cd;color:#795611;border-radius:10px}.grand-line-learning-dialog [hidden]{display:none!important}
.grand-line-learning-dialog .math-frac{display:inline-flex;vertical-align:middle;flex-direction:column;text-align:center;line-height:1.15;margin:0 .15em}.grand-line-learning-dialog .math-frac .num{padding:0 .2em .08em;border-bottom:1px solid currentColor}.grand-line-learning-dialog .math-frac .den{padding:.08em .2em 0}.grand-line-learning-dialog .math-sqrt{display:inline-flex;align-items:center}.grand-line-learning-dialog .math-sqrt .radicand{border-top:1px solid currentColor;padding:0 .15em}
@media(max-width:600px){.grand-line-learning-overlay{padding:8px}.grand-line-learning-dialog{max-height:calc(100dvh - 16px);border-radius:15px;padding:16px}.grand-line-learning-stem{font-size:16px}.grand-line-learning-option{padding:11px;gap:8px}.grand-line-learning-actions{flex-direction:column-reverse}.grand-line-learning-action{width:100%}}
@media(prefers-reduced-motion:reduce){.grand-line-learning-overlay{backdrop-filter:none}}
`;

export function installGrandLineLearningParent(config) {
  const win = config.window || window, doc = win.document;
  let overlay = null, resolvePresentation = null, previousFocus = null;
  let controller;
  function close(finished = false) {
    overlay?.remove(); overlay = null;
    const resolve = resolvePresentation; resolvePresentation = null; resolve?.(finished);
    if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null;
  }
  function make(tag, cls, text) { const node = doc.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  async function presentQuestions({ subject, questions, grade, isCurrent, imageFailed, questionUnavailable }) {
    close(); previousFocus = doc.activeElement;
    if (!doc.getElementById('grand-line-learning-style')) { const style = make('style'); style.id = 'grand-line-learning-style'; style.textContent = DIALOG_CSS; doc.head.append(style); }
    overlay = make('div', 'grand-line-learning-overlay');
    const dialog = make('section', 'grand-line-learning-dialog'); dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-labelledby','grand-line-learning-title'); dialog.tabIndex = -1;
    overlay.append(dialog); doc.body.append(overlay);
    const result = new Promise(resolve => { resolvePresentation = resolve; });
    let index = 0, score = 0;
    function render() {
      if (!isCurrent()) { close(); return; }
      dialog.replaceChildren(); const q = questions[index]; let selected = false;
      const unsupported = grandLineUnsupportedQuestionVisual(q,doc); let failed = unsupported;
      const started = performance.now();
      const top = make('div','grand-line-learning-top'); top.append(make('span','',subject + ' · Wave'), make('span','',`Question ${index + 1} of 3`));
      const heading = make('h2','',q.topic || subject + ' question'); heading.id = 'grand-line-learning-title';
      const copy = make('p','grand-line-learning-copy','Answer all three questions to complete this wave. Correct answers strengthen your crew in the next wave.');
      const stem = make('div','grand-line-learning-stem'); stem.innerHTML = sanitizeGrandLineQuestionHtml(q.html,doc);
      const options = make('div','grand-line-learning-options');
      const feedback = make('div','grand-line-learning-feedback'); feedback.setAttribute('aria-live','polite');
      const warning = make('p','grand-line-learning-warning',unsupported
        ? 'This question contains a diagram or formula that cannot be displayed safely here. Return to the game and retry with a fresh set.'
        : 'A diagram could not load. This question cannot be answered safely. Return to the game and retry with a fresh set.'); warning.hidden = !unsupported;
      const actions = make('div','grand-line-learning-actions');
      const exit = make('button','grand-line-learning-action secondary','Return to game'); exit.type = 'button'; exit.onclick = () => close();
      const next = make('button','grand-line-learning-action',index === 2 ? 'Complete wave' : 'Next question'); next.type = 'button'; next.hidden = true;
      next.onclick = () => { if (!selected || failed || !isCurrent()) return; if (index === 2) close(true); else { index++; render(); } };
      actions.append(exit,next);
      const buttons = q.options.map((html, choice) => {
        const button = make('button','grand-line-learning-option'); button.type = 'button';
        const content = make('span'); content.innerHTML = sanitizeGrandLineQuestionHtml(html,doc);
        button.append(make('span','grand-line-learning-number',String(choice + 1)),content);
        button.onclick = async () => {
          if (selected || failed || !isCurrent()) return;
          selected = true; buttons.forEach(b => { b.disabled = true; });
          let answer;
          feedback.textContent = 'Checking your answer…';
          try { answer = await grade(index,choice,performance.now()-started); }
          catch (_) {
            if (!isCurrent()) return;
            failed = true; warning.hidden = false;
            warning.textContent = 'We could not confirm this answer. Return to the game and try a new learning round when your connection is ready.';
            feedback.textContent = ''; return;
          }
          if (!answer || !isCurrent()) { close(); return; }
          if (answer.correct) score++;
          buttons[answer.answer].dataset.correct = 'true'; if (!answer.correct) button.dataset.wrong = 'true';
          feedback.textContent = answer.correct ? 'Correct. ' : `The correct answer is ${answer.answer + 1}. `;
          if (answer.explainHtml) { const explanation = make('div'); explanation.innerHTML = sanitizeGrandLineQuestionHtml(answer.explainHtml,doc); feedback.append(explanation); }
          if (index === 2) feedback.append(make('p','grand-line-learning-reward',grandLineLearningRewardSummary(score)));
          next.hidden = false; next.focus();
        };
        options.append(button); return button;
      });
      dialog.append(top,heading,copy,stem,options,warning,feedback,actions);
      if (unsupported && isCurrent() && dialog.isConnected) questionUnavailable(q,'unsupported-question-visual');
      // Disable answers until every essential image has loaded; no invisible
      // diagram may silently become a guessing question or grant a reward.
      const images = [...stem.querySelectorAll('img'),...options.querySelectorAll('img')];
      let waiting = images.length; buttons.forEach(b => { b.disabled = failed || waiting > 0; });
      for (const img of images) {
        let settled = false;
        const done = ok => {
          if (!isCurrent() || !dialog.isConnected || !img.isConnected) return;
          if (settled) return; settled = true; waiting--;
          if (!ok) { failed = true; warning.hidden = false; imageFailed(q,img.getAttribute('src') || ''); }
          if (!failed && !waiting && !selected) buttons.forEach(b => { b.disabled = false; });
        };
        img.addEventListener('load',()=>done(true),{once:true}); img.addEventListener('error',()=>done(false),{once:true});
        if (img.complete) done(img.naturalWidth > 0);
      }
      dialog.focus();
    }
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not(:disabled):not([hidden])')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (doc.activeElement === first || doc.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    render(); return result;
  }
  controller = createGrandLineLearningController({ ...config, origin: win.location.origin,
    makeSessionId: () => win.crypto.randomUUID(), presentQuestions, cancelPresentation: () => close(),
    onError: config.onError || (error => console.warn('GrandLine question bank:',error)) });
  const onMessage = event => { controller.handleMessage(event).catch(error => console.warn('GrandLine bridge:',error)); };
  win.addEventListener('message',onMessage);
  return { controller, invalidate: message => controller.invalidate(message),
    destroy() { win.removeEventListener('message',onMessage); controller.destroy(); close(); } };
}
