/* =====================================================================
   🧠 THE POLYMATH — the page (v1.447.0)
   ---------------------------------------------------------------------
   What a student sees after scanning a QR code on an answer key. Mounted
   by `polymath.html`, which hands in the three things that touch the
   outside world — read a paper, ask the model, fetch a picture — so this
   file can be driven by a fake in `tools/polymath-tutor-browser.mjs`.

   One paper, two screens, routed by the URL hash:
     #<id>       the whole paper: every question with how this phone has
                 done on it, and a button to start.
     #<id>/<n>   one question: the question as printed, somewhere to answer
                 it, ✓ Check, 💡 Hint (three steps, smallest first), a worked
                 solution once the student has had a real go, and a chat.

   EVERYTHING ON SCREEN IS BUILT WITH textContent. The paper document comes
   from a collection anyone can write (see polymath-tutor-core.mjs), so no
   string from it is ever parsed as HTML.

   PROGRESS STAYS ON THE PHONE (localStorage, per paper). A code on a
   printed sheet has to work on any phone, at once, so signing in is never
   required — but it is OFFERED (v1.448.0):

   👤 A STUDENT WITH A STUDY BUDDY ACCOUNT can sign in with it (the same
     Google account, the same project), and from then on every question The
     Polymath marks wrong or partly right is written into their Study Buddy
     mistake book (`d.mistakes`, shapes from `mistakeDoc`). A question got
     right later is marked Sorted there. Signing in part-way through a paper
     files the questions already marked wrong on this phone, once each
     (`progress.filed`).

   🎙 THE CRYSTAL is a live voice tutor (`polymath-voice.js`). ONE card,
     made once and moved into whichever screen is drawn, so a call carries
     on across a re-render and from question to question. The voice model
     is told only what is on the screen (`voiceContext`, never the key);
     everything it is asked is delegated back here and answered by the same
     tutor engine as the typed chat (`buildVoicePrompt`), then trimmed to be
     spoken (`speakable`). A new paper ends the call.
   ===================================================================== */
import {
  TUTOR_NAME, TUTOR_HINT_LEVELS, normalizeTutorPaper, parseTutorHash, answerSlots, hasAnyAnswer, mcqVerdict,
  buildCheckPrompt, buildHintPrompt, buildSolutionPrompt, buildChatPrompt, parseCheckReply, stripMarkdown,
  readProgress, writeProgress, paperScore, solutionUnlocked, TUTOR_SOLUTION_AFTER,
  voiceContext, buildVoicePrompt, speakable, shouldFileMistake, mistakeDoc, mistakeDocId
} from './polymath-tutor-core.mjs?v=2';
import { createPolymathVoice } from './polymath-voice.js?v=1';

const MAX_AI_IMAGES = 4;
const VERDICT_TEXT = { correct: 'Correct', partial: 'Almost there', incorrect: 'Not yet' };
const VERDICT_ICON = { correct: '✓', partial: '◐', incorrect: '✗' };

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(k => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  (Array.isArray(children) ? children : (children == null ? [] : [children])).forEach(c => {
    if (c == null || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}
// Plain text with its line breaks, as separate text nodes and <br>s.
function textWithBreaks(tag, cls, text) {
  const node = el(tag, { class: cls });
  String(text || '').split('\n').forEach((line, i) => {
    if (i) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
  return node;
}

export function mountPolymathTutor(root, deps) {
  const d = deps || {};
  const storage = d.storage || (function () { try { return window.localStorage; } catch (e) { return null; } })();
  const state = { id: '', paper: null, progress: null, n: 0, busy: '', error: '', imageCache: new Map(),
    account: null, profile: null, signing: false, bookNote: {}, accountError: '' };

  function save() { if (state.paper) writeProgress(storage, state.id, state.progress); }
  function question(n) { return state.paper && state.paper.questions.find(q => q.n === n) || null; }
  function answersFor(n) {
    if (!state.progress.answers[n]) state.progress.answers[n] = {};
    return state.progress.answers[n];
  }

  /* ---------- the outside world ---------- */
  async function questionImages(q) {
    const urls = [];
    q.items.forEach(it => {
      if (it.t === 'img') urls.push(it.url);
      if (it.t === 'mcq') it.options.forEach(o => { if (o.img) urls.push(o.img); });
    });
    const out = [];
    for (const url of urls.slice(0, MAX_AI_IMAGES)) {
      if (!state.imageCache.has(url)) {
        let img = null;
        try { img = d.fetchImage ? await d.fetchImage(url) : null; } catch (e) { img = null; }
        state.imageCache.set(url, img);
      }
      const got = state.imageCache.get(url);
      if (got) out.push(got);
    }
    return out;
  }
  async function ask(prompt, q, opts) {
    if (typeof d.ask !== 'function') throw new Error(TUTOR_NAME + ' is not available on this page.');
    const images = await questionImages(q);
    const text = await d.ask(prompt, Object.assign({ images }, opts || {}));
    if (!String(text || '').trim()) throw new Error(TUTOR_NAME + ' did not answer. Please try again.');
    return text;
  }

  /* ---------- 👤 the Study Buddy account and its mistake book ---------- */
  function signedIn() { return !!(state.account && !state.account.anonymous && state.account.uid); }
  function displayName() {
    if (!signedIn()) return '';
    return (state.profile && state.profile.name) || state.account.name || state.account.email || 'Signed in';
  }
  async function signIn() {
    if (!d.account || state.signing) return;
    state.signing = true; state.accountError = ''; render();
    try { await d.account.signIn(); }
    catch (e) { state.accountError = (e && e.message) || 'Signing in did not work. Please try again.'; }
    finally { state.signing = false; render(); }
  }
  async function signOut() {
    if (!d.account) return;
    if (voice && voice.active) voice.stop();
    try { await d.account.signOut(); } catch (e) { /* the watcher says what really happened */ }
  }
  // Every account change goes through here: the profile is re-read, and the
  // questions already marked wrong on this phone are filed into the new book.
  let accountSeq = 0;
  function accountChanged(who) {
    const before = state.account && state.account.uid;
    state.account = who || null;
    if ((who && who.uid) !== before) { state.profile = null; state.bookNote = {}; }
    const mine = ++accountSeq;
    render();
    if (!signedIn()) return;
    const uid = state.account.uid;
    Promise.resolve(d.account.profile ? d.account.profile(uid) : null).catch(() => null).then(profile => {
      if (mine !== accountSeq) return;
      state.profile = profile || null;
      render();
      backfill();
    });
  }
  // A card for every question this phone has marked wrong and not yet filed.
  function backfill() {
    if (!signedIn() || !state.paper || !state.progress) return;
    state.paper.questions.forEach(q => {
      const r = state.progress.results[q.n];
      const filed = (state.progress.filed || {})[q.n];
      if (shouldFileMistake(r) && filed !== 'filed') remember(q, { quiet: true });
    });
  }
  // File or clear one question, after it has been checked. Never blocks the
  // page and never throws: a book that could not be written is a line of text.
  async function remember(q, opts) {
    if (!signedIn() || !d.mistakes || !state.paper) return;
    const uid = state.account.uid, paperId = state.id;
    const id = mistakeDocId(paperId, q.n);
    if (!id) return;
    const result = state.progress.results[q.n];
    if (!state.progress.filed) state.progress.filed = {};
    const quiet = !!(opts && opts.quiet);
    const still = () => signedIn() && state.account.uid === uid && state.id === paperId;
    try {
      if (shouldFileMistake(result)) {
        const data = mistakeDoc(state.paper, paperId, q, answersFor(q.n), result, { level: state.profile && state.profile.level, attempts: state.progress.attempts[q.n] || 1 });
        await d.mistakes.file(uid, id, data);
        if (!still()) return;
        state.progress.filed[q.n] = 'filed';
        if (!quiet) state.bookNote[q.n] = '📕 Saved to your Study Buddy mistake book, so you can practise it again there.';
      } else if (result && result.verdict === 'correct' && state.progress.filed[q.n] === 'filed') {
        await d.mistakes.clear(uid, id);
        if (!still()) return;
        state.progress.filed[q.n] = 'cleared';
        if (!quiet) state.bookNote[q.n] = '📕 Marked as sorted in your Study Buddy mistake book. Well done!';
      } else return;
      save();
    } catch (e) {
      if (!still()) return;
      if (!quiet) state.bookNote[q.n] = 'Your mistake book could not be updated just now. It will try again next time you check.';
    }
    if (!quiet || state.n === q.n) render();
  }

  /* ---------- 🎙 the crystal ---------- */
  // Made once, the first time a screen is drawn, and only on a page that
  // was handed the voice's credentials.
  let voice = null;
  function currentQuestion() { return state.paper && state.n ? question(state.n) : null; }
  function voiceCard() {
    if (!d.voice) return null;
    if (!voice) {
      const v = d.voice;
      voice = (v.create || createPolymathVoice)({
        document: v.document, window: v.window, bridge: v.bridge, mediaDevices: v.mediaDevices, audio: v.audio,
        RTCPeerConnection: v.RTCPeerConnection, fetch: v.fetch, endpoint: v.endpoint,
        getUser: v.getUser, getAppCheckToken: v.getAppCheckToken,
        allowed: () => !!state.paper,
        getContext: () => {
          const q = currentQuestion();
          return voiceContext(q, q ? answersFor(q.n) : {}, q ? state.progress.results[q.n] : null);
        },
        delegate: async task => {
          const q = currentQuestion();
          const solved = q ? solutionUnlocked(state.progress, q.n) : false;
          const prompt = buildVoicePrompt(q, q ? answersFor(q.n) : {}, task && task.transcript, solved);
          if (typeof d.ask !== 'function') throw new Error(TUTOR_NAME + ' is not available on this page.');
          const images = q ? await questionImages(q) : [];
          if (task && task.signal && task.signal.aborted) throw new DOMException('Superseded', 'AbortError');
          const text = speakable(await d.ask(prompt, { images }));
          if (!text) throw new Error(TUTOR_NAME + ' did not answer.');
          return text;
        }
      });
    }
    return voice.node;
  }
  function voiceSlot() {
    const card = voiceCard();
    if (card) queueMicrotask(() => voice && voice.attached());
    return card;
  }

  /* ---------- routing ---------- */
  async function route() {
    const parsed = parseTutorHash((d.location || window.location).hash);
    if (!parsed) { state.error = 'This link is not a Polymath link. Scan the QR code on your answer key again.'; render(); return; }
    if (parsed.id !== state.id) {
      // A call about one paper does not carry on into another.
      if (voice && voice.active) voice.stop();
      state.id = parsed.id; state.paper = null; state.error = ''; state.n = 0; state.bookNote = {};
      render();
      try {
        const raw = await d.loadPaper(parsed.id);
        if (!raw) throw new Error('This paper could not be found. Ask your teacher to print the answer key again.');
        state.paper = normalizeTutorPaper(raw);
        state.progress = readProgress(storage, parsed.id);
        backfill();
      } catch (e) {
        state.error = (e && e.message) || 'This paper could not be opened.';
      }
    }
    state.n = parsed.n && state.paper && question(parsed.n) ? parsed.n : 0;
    state.reveal = true;   // the cascade plays on arriving at a screen, never on every re-draw
    state.error2 = '';
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* no window in a test */ }
  }
  function go(n) {
    const loc = d.location || window.location;
    loc.hash = '#' + state.id + (n ? '/' + n : '');
  }

  /* ---------- rendering ---------- */
  function render() {
    root.textContent = '';
    root.appendChild(header());
    const main = el('main', { class: 'pt-main' });
    root.appendChild(main);
    if (state.error) { main.appendChild(el('section', { class: 'pt-card pt-error', role: 'alert' }, [el('h2', { text: 'Hmm.' }), el('p', { text: state.error })])); return; }
    if (!state.paper) { main.appendChild(el('section', { class: 'pt-card pt-loading', role: 'status' }, [el('div', { class: 'pt-spinner' }), el('p', { text: 'Opening your paper…' })])); return; }
    main.appendChild(state.n ? questionView(question(state.n)) : paperView());
    state.reveal = false;
    if (voice) voice.attached();
  }

  function header() {
    const score = state.paper ? paperScore(state.paper, state.progress) : null;
    return el('header', { class: 'pt-header' }, [
      el('div', { class: 'pt-brand' }, [
        el('img', { class: 'pt-logo', src: 'assets/branding/polymath-learning-centre.png', alt: 'Polymath Learning Centre' }),
        el('div', { class: 'pt-brand-text' }, [el('strong', { text: TUTOR_NAME }), el('span', { text: state.paper ? state.paper.title : 'Your study companion' })])
      ]),
      score ? el('div', { class: 'pt-score', title: 'Questions checked on this phone' }, [el('b', { text: String(score.correct) }), ' / ' + score.total + ' correct']) : null,
      accountBox()
    ]);
  }
  function accountBox() {
    if (!d.account) return null;
    if (signedIn()) {
      return el('div', { class: 'pt-account' }, [
        el('span', { class: 'pt-account-name', title: state.account.email || '', text: '👤 ' + displayName() }),
        el('button', { type: 'button', class: 'pt-btn pt-signout', onclick: signOut }, 'Sign out')
      ]);
    }
    return el('div', { class: 'pt-account' }, [
      el('button', { type: 'button', class: 'pt-btn pt-signin', disabled: state.signing, onclick: signIn, title: 'Sign in with your Study Buddy account' }, state.signing ? 'Signing in…' : 'Sign in')
    ]);
  }
  // What the intro card says about the mistake book.
  function bookNote() {
    if (!d.account || !d.mistakes) return null;
    if (signedIn()) {
      return el('div', { class: 'pt-book-note pt-book-on' }, [el('span', { text: '📕 Signed in as ' + displayName() + '. Every question you get wrong here goes into your Study Buddy mistake book, so you can practise it again there.' })]);
    }
    return el('div', { class: 'pt-book-note pt-book-off' }, [
      el('span', { text: '📕 Have a Study Buddy account? Sign in and Study Buddy will remember the questions you get wrong here.' }),
      el('button', { type: 'button', class: 'pt-btn', disabled: state.signing, onclick: signIn }, state.signing ? 'Signing in…' : 'Sign in'),
      state.accountError ? el('span', { class: 'pt-inline-error', role: 'alert', text: state.accountError }) : null
    ]);
  }

  function paperView() {
    const p = state.paper;
    const score = paperScore(p, state.progress);
    const next = p.questions.find(q => !state.progress.results[q.n]) || p.questions[0];
    const list = el('ol', { class: 'pt-qlist' }, p.questions.map(q => {
      const r = state.progress.results[q.n];
      const first = (q.items.find(it => it.t === 'text') || {}).text || '';
      return el('li', {}, [el('button', { type: 'button', class: 'pt-qrow' + (r ? ' pt-' + r.verdict : ''), onclick: () => go(q.n) }, [
        el('span', { class: 'pt-qdot', 'aria-hidden': 'true', text: r ? VERDICT_ICON[r.verdict] : String(q.n) }),
        el('span', { class: 'pt-qrow-text' }, [el('b', { text: q.label }), el('span', { text: first.split('\n')[0].slice(0, 110) })]),
        el('span', { class: 'pt-qrow-state', text: r ? VERDICT_TEXT[r.verdict] : 'Not tried' })
      ])]);
    }));
    return el('section', { class: 'pt-paper' + (state.reveal ? ' pt-reveal' : '') }, [
      el('div', { class: 'pt-card pt-intro' }, [
        el('h1', { text: p.title }),
        el('p', { text: 'Answer each question here and ' + TUTOR_NAME + ' will check it, give you hints when you are stuck, and talk it through with you — type, or tap the crystal and just say it. Your work stays on this phone.' }),
        el('div', { class: 'pt-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(score.total), 'aria-valuenow': String(score.done) }, [
          el('span', { style: 'width:' + (score.total ? Math.round(100 * score.done / score.total) : 0) + '%' })
        ]),
        el('p', { class: 'pt-muted', text: score.done + ' of ' + score.total + ' checked · ' + score.correct + ' correct' }),
        next ? el('button', { type: 'button', class: 'pt-btn pt-primary', onclick: () => go(next.n) }, score.done ? 'Carry on with ' + next.label : 'Start with ' + next.label) : null,
        bookNote()
      ]),
      voiceSlot(),
      list
    ]);
  }

  function itemNode(q, it, answers) {
    const part = it.part ? el('span', { class: 'pt-part', text: it.part }) : null;
    switch (it.t) {
      case 'text': { const n = textWithBreaks('p', 'pt-text', it.text); if (part) n.insertBefore(part, n.firstChild); return n; }
      case 'img': return el('figure', { class: 'pt-figure' }, [part, el('img', { src: it.url, alt: it.caption || 'Diagram for this question', loading: 'lazy' }), it.caption ? el('figcaption', { text: it.caption }) : null]);
      case 'table': return el('div', { class: 'pt-table-wrap' }, [part, el('table', { class: 'pt-table' }, [el('tbody', {}, it.rows.map((r, i) => el('tr', {}, r.c.map(cell => el(i === 0 ? 'th' : 'td', { text: cell })))))])]);
      case 'mcq': {
        const chosen = answers[it.id] || '';
        return el('div', { class: 'pt-mcq', role: 'radiogroup', 'aria-label': 'Options' + (it.part ? ' for ' + it.part : '') }, [part].concat(it.options.map(o => el('button', {
          type: 'button', role: 'radio', 'aria-checked': chosen === o.label ? 'true' : 'false',
          class: 'pt-option' + (chosen === o.label ? ' pt-chosen' : ''),
          onclick: () => { answers[it.id] = o.label; save(); render(); }
        }, [el('span', { class: 'pt-option-label', text: '(' + o.label + ')' }), el('span', { class: 'pt-option-body' }, [o.text ? textWithBreaks('span', '', o.text) : null, o.img ? el('img', { src: o.img, alt: 'Option ' + o.label }) : null])]))));
      }
      case 'write': {
        const ta = el('textarea', { class: 'pt-write', rows: String(Math.min(8, Math.max(2, it.lines))), placeholder: 'Type your answer…', 'aria-label': (it.part ? it.part + ' ' : '') + (it.label || 'Your answer') });
        ta.value = answers[it.id] || '';
        ta.addEventListener('input', () => { answers[it.id] = ta.value; save(); });
        return el('label', { class: 'pt-write-wrap' }, [el('span', { class: 'pt-write-label' }, [part, it.label || 'Your answer']), ta]);
      }
      case 'fill': {
        const vals = Array.isArray(answers[it.id]) ? answers[it.id] : [];
        let k = 0;
        return el('p', { class: 'pt-fill' }, [part].concat(it.segments.map(s => {
          if (!s.blank) return document.createTextNode(s.text);
          const i = k++;
          const inp = el('input', { type: 'text', class: 'pt-blank', 'aria-label': 'Blank ' + (i + 1), autocomplete: 'off' });
          inp.value = vals[i] || '';
          inp.addEventListener('input', () => { const cur = Array.isArray(answers[it.id]) ? answers[it.id].slice() : []; cur[i] = inp.value; answers[it.id] = cur; save(); });
          return inp;
        })));
      }
      default: return null;
    }
  }

  function questionView(q) {
    const p = state.paper;
    const answers = answersFor(q.n);
    const result = state.progress.results[q.n];
    const hints = state.progress.hints[q.n] || [];
    const chat = state.progress.chats[q.n] || [];
    const attempts = state.progress.attempts[q.n] || 0;
    const unlocked = solutionUnlocked(state.progress, q.n);
    const idx = p.questions.indexOf(q);
    const prev = p.questions[idx - 1], next = p.questions[idx + 1];

    const nav = el('nav', { class: 'pt-nav', 'aria-label': 'Questions' }, [
      el('button', { type: 'button', class: 'pt-link', onclick: () => go(0) }, '← Whole paper'),
      el('span', { class: 'pt-muted', text: 'Question ' + (idx + 1) + ' of ' + p.questions.length }),
      el('span', { class: 'pt-nav-arrows' }, [
        el('button', { type: 'button', class: 'pt-icon-btn', 'aria-label': 'Previous question', disabled: !prev, onclick: () => prev && go(prev.n) }, '‹'),
        el('button', { type: 'button', class: 'pt-icon-btn', 'aria-label': 'Next question', disabled: !next, onclick: () => next && go(next.n) }, '›')
      ])
    ]);

    const card = el('article', { class: 'pt-card pt-question' }, [
      el('header', { class: 'pt-q-head' }, [el('h1', { text: q.label }), q.source ? el('span', { class: 'pt-chip', text: q.source }) : null, q.marks ? el('span', { class: 'pt-chip', text: q.marks + (q.marks === 1 ? ' mark' : ' marks') }) : null])
    ].concat(q.items.map(it => itemNode(q, it, answers))));

    const busy = state.busy;
    const actions = el('div', { class: 'pt-actions' }, [
      el('button', { type: 'button', class: 'pt-btn pt-primary', disabled: !!busy, onclick: () => check(q) }, busy === 'check' ? 'Checking…' : (attempts ? 'Check again' : 'Check my answer')),
      el('button', { type: 'button', class: 'pt-btn', disabled: !!busy || hints.length >= TUTOR_HINT_LEVELS, onclick: () => hint(q), title: 'Hints start small and get bigger' },
        busy === 'hint' ? 'Thinking…' : (hints.length >= TUTOR_HINT_LEVELS ? '💡 No more hints' : '💡 Hint ' + (hints.length + 1) + ' of ' + TUTOR_HINT_LEVELS)),
      el('button', { type: 'button', class: 'pt-btn', disabled: !!busy || !unlocked, onclick: () => solution(q),
        title: unlocked ? 'See the full worked answer' : 'Have ' + TUTOR_SOLUTION_AFTER + ' tries first — or get it right!' }, busy === 'solution' ? 'Writing…' : (unlocked ? '📘 Worked solution' : '🔒 Worked solution'))
    ]);

    const feedback = [];
    if (result) {
      feedback.push(el('section', { class: 'pt-card pt-feedback pt-' + result.verdict, 'aria-live': 'polite' }, [
        el('div', { class: 'pt-verdict' }, [el('span', { class: 'pt-verdict-icon', 'aria-hidden': 'true', text: VERDICT_ICON[result.verdict] }), el('strong', { text: VERDICT_TEXT[result.verdict] }), el('span', { class: 'pt-muted', text: ' · try ' + attempts })]),
        textWithBreaks('p', '', result.feedback),
        result.nextStep ? textWithBreaks('p', 'pt-next', result.nextStep) : null,
        state.bookNote[q.n] ? el('p', { class: 'pt-filed', text: state.bookNote[q.n] }) : null
      ]));
    }
    hints.forEach((h, i) => feedback.push(el('section', { class: 'pt-card pt-hint' }, [el('strong', { text: '💡 Hint ' + (i + 1) }), textWithBreaks('p', '', h)])));
    if (state.progress.solutions && state.progress.solutions[q.n]) {
      feedback.push(el('section', { class: 'pt-card pt-solution' }, [el('strong', { text: '📘 Worked solution' }), textWithBreaks('p', '', state.progress.solutions[q.n])]));
    }
    if (state.error2) feedback.push(el('p', { class: 'pt-inline-error', role: 'alert', text: state.error2 }));

    const chatBox = el('section', { class: 'pt-card pt-chat' }, [
      el('h2', { text: 'Ask ' + TUTOR_NAME }),
      chat.length ? el('div', { class: 'pt-chat-log' }, chat.map(m => el('div', { class: 'pt-bubble pt-' + m.who }, [el('b', { text: m.who === 'student' ? 'You' : TUTOR_NAME }), textWithBreaks('span', '', m.text)]))) : el('p', { class: 'pt-muted', text: 'Not sure what a word means, or why something happens? Ask — ' + TUTOR_NAME + ' will help you think it through.' }),
      chatForm(q)
    ]);

    const nextBar = next ? el('div', { class: 'pt-next-bar' }, [el('button', { type: 'button', class: 'pt-btn', onclick: () => go(next.n) }, 'Next: ' + next.label + ' →')]) : el('div', { class: 'pt-next-bar' }, [el('button', { type: 'button', class: 'pt-btn', onclick: () => go(0) }, 'Back to the whole paper')]);

    return el('section', { class: 'pt-qview' + (state.reveal ? ' pt-reveal' : '') }, [nav, card, actions].concat(feedback, [voiceSlot(), chatBox, nextBar]));
  }

  function chatForm(q) {
    const input = el('textarea', { class: 'pt-chat-input', rows: '2', placeholder: 'Ask ' + TUTOR_NAME + ' anything about this question…', 'aria-label': 'Message to ' + TUTOR_NAME });
    const form = el('form', { class: 'pt-chat-form', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) sendChat(q, t); } }, [
      input, el('button', { type: 'submit', class: 'pt-btn pt-primary', disabled: !!state.busy }, state.busy === 'chat' ? '…' : 'Send')
    ]);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); } });
    return form;
  }

  /* ---------- actions ---------- */
  async function run(kind, fn) {
    if (state.busy) return;
    state.busy = kind; state.error2 = ''; render();
    try { await fn(); }
    catch (e) { state.error2 = 'Sorry — ' + ((e && e.message) || 'that did not go through.') + ' Please try again.'; }
    finally { state.busy = ''; save(); render(); }
  }
  function check(q) {
    const answers = answersFor(q.n);
    if (!hasAnyAnswer(q, answers)) { state.error2 = 'Have a go first — type or choose your answer, then check it.'; render(); return; }
    return run('check', async () => {
      const attempt = (state.progress.attempts[q.n] || 0) + 1;
      const local = mcqVerdict(q, answers);
      const reply = parseCheckReply(await ask(buildCheckPrompt(q, answers, attempt) + (local ? '\nThe options chosen are ' + local.verdict.toUpperCase() + ' (' + local.right + ' of ' + local.total + ').' : ''), q, { json: true }));
      if (local) reply.verdict = local.verdict;
      state.progress.attempts[q.n] = attempt;
      state.progress.results[q.n] = reply;
      delete state.bookNote[q.n];
    }).then(() => remember(q));
  }
  function hint(q) {
    return run('hint', async () => {
      const list = (state.progress.hints[q.n] || []).slice();
      const text = stripMarkdown(await ask(buildHintPrompt(q, answersFor(q.n), list.length + 1), q));
      list.push(text);
      state.progress.hints[q.n] = list;
    });
  }
  function solution(q) {
    if (!solutionUnlocked(state.progress, q.n)) return;
    return run('solution', async () => {
      const text = stripMarkdown(await ask(buildSolutionPrompt(q, answersFor(q.n)), q));
      if (!state.progress.solutions) state.progress.solutions = {};
      state.progress.solutions[q.n] = text;
    });
  }
  function sendChat(q, message) {
    return run('chat', async () => {
      const log = (state.progress.chats[q.n] || []).slice();
      const solved = solutionUnlocked(state.progress, q.n);
      const reply = stripMarkdown(await ask(buildChatPrompt(q, answersFor(q.n), log, message, solved), q));
      log.push({ who: 'student', text: message }, { who: 'tutor', text: reply });
      state.progress.chats[q.n] = log.slice(-30);
    });
  }

  (d.window || window).addEventListener('hashchange', route);
  if (d.account && typeof d.account.watch === 'function') d.account.watch(accountChanged);
  route();
  return { route, state, get voice() { return voice; } };
}
