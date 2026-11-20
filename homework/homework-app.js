/* =====================================================================
   POLYMATH HOMEWORK HELPER — the screen (v1.0.0)
   ---------------------------------------------------------------------
   1. ask       take / choose / drop / paste a photo, pick the child,
                add a note, "Get my first hint"
   2. thinking  while the helper reads the question
   3. coach     the question as read, the steps (one hint at a time, the
                next step opens when this one is done), and "Check my work",
                a short chat where the helper checks the student's working
                or answer without ever giving the answer away.
   Recent questions (with the sealed session, never the answer) are kept
   on this device for three days, so a student can come back to one.
   ===================================================================== */
import * as services from './homework-services.js';
import {
  MAX_PHOTO_SIDE, PHOTO_QUALITY, allowanceLine, fitSize, initialProgress, revealHint, finishStep, hintsSeen,
  allStepsDone, historyForServer, VERDICT_LABELS, friendlyError, RECENT_KEY, rememberRecent, liveRecent, shortQuestion
} from './homework-core.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};

const SUBJECT_NAMES = { math: '➗ Maths', science: '🔬 Science', english: '📖 English', chinese: '🀄 Chinese', other: '📝 Homework' };
const TIPS = [
  'Tip: underline the important numbers and words in the question.',
  'Tip: in Maths, a bar model often makes the question much clearer.',
  'Tip: in Science, use the keywords from your notes in your answer.',
  'Tip: always check your answer has the right units.',
  'Tip: read the question one more time. What is it really asking?'
];

const state = {
  user: null,
  status: null,          // { access, children, allowance }
  childIndex: 0,
  photo: null,           // data URL of the photo being asked about
  current: null,         // { id, result, session, level, photoThumb, progress, turns, solved }
  busy: false
};

/* ---------------- recent questions on this device ---------------- */

function loadRecent() {
  try { return liveRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')); } catch (_) { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) { /* full or blocked: fine */ }
}
function saveCurrent() {
  const c = state.current;
  if (!c || !c.session) return;
  saveRecent(rememberRecent(loadRecent(), {
    id: c.id, session: c.session, result: c.result, level: c.level, photoThumb: c.photoThumb,
    progress: c.progress, turns: c.turns.slice(-12), solved: !!c.solved, savedAtMs: c.savedAtMs || Date.now()
  }));
}

function renderRecent() {
  const list = loadRecent();
  $('recentCard').hidden = !list.length;
  const ul = $('recentList');
  ul.textContent = '';
  for (const item of list) {
    const when = new Date(item.savedAtMs);
    const meta = (item.solved ? '✅ Solved · ' : '') + (SUBJECT_NAMES[item.result.subject] || '') + ' · ' + when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    ul.append(el('li', {}, el('button', { class: 'recent-item', type: 'button', onclick: () => openRecent(item) },
      item.photoThumb ? el('img', { src: item.photoThumb, alt: '' }) : el('span', { class: 'n', 'aria-hidden': 'true' }, '📝'),
      el('span', { class: 'words' }, el('span', { class: 'q', text: shortQuestion(item.result.question) }), el('span', { class: 'meta', text: meta }))
    )));
  }
}

function openRecent(item) {
  state.current = { ...item, turns: item.turns || [], progress: item.progress || initialProgress(item.result.steps) };
  showCoach();
}

/* ---------------- views ---------------- */

function show(view) {
  $('askView').hidden = view !== 'ask';
  $('thinkingView').hidden = view !== 'thinking';
  $('coachView').hidden = view !== 'coach';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAllowance() {
  const a = state.status && state.status.allowance;
  const line = allowanceLine(a);
  $('allowanceLine').textContent = line;
  $('allowanceLine').classList.toggle('is-empty', !!a && a.photosLeft <= 0);
  $('replyAllowance').textContent = a && typeof a.repliesLeft === 'number'
    ? (a.repliesLeft > 0 ? a.repliesLeft + ' replies left today' : 'No replies left today. It resets at midnight.') : '';
  $('getHintsButton').disabled = !!a && a.photosLeft <= 0;
}

function renderChildren() {
  const children = (state.status && state.status.children) || [];
  $('childField').hidden = children.length < 2;
  $('levelField').hidden = !(state.status && state.status.access === 'staff');
  const chips = $('childChips');
  chips.textContent = '';
  children.forEach((child, i) => {
    chips.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(i === state.childIndex),
      onclick: () => { state.childIndex = i; renderChildren(); }
    }, child.name.split(' ')[0] + ' · ' + child.level));
  });
}

function showAccessProblem(message) {
  $('accessNotice').hidden = !message;
  $('accessNoticeText').textContent = message || '';
  $('snapRow').hidden = !!message;
  $('dropZone').hidden = !!message;
}

/* ---------------- the photo ---------------- */

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file is not a picture I can read. Try a JPG or PNG photo.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function drawToDataUrl(image, max, quality) {
  const w = image.width || image.naturalWidth;
  const h = image.height || image.naturalHeight;
  const size = fitSize(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function usePhotoFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type || 'image/')) { toastProblem('That file is not a picture. Please use a photo.'); return; }
  try {
    const image = await loadImage(file);
    state.photo = drawToDataUrl(image, MAX_PHOTO_SIDE, PHOTO_QUALITY);
    state.photoThumb = drawToDataUrl(image, 240, 0.7);
    $('previewImage').src = state.photo;
    $('preview').hidden = false;
    $('snapRow').hidden = true;
    $('dropZone').hidden = true;
    renderChildren();
    renderAllowance();
    setTimeout(() => $('noteInput').focus({ preventScroll: true }), 50);
    $('preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    toastProblem(e.message || 'That picture could not be opened.');
  }
}

function resetAsk() {
  state.photo = null;
  $('preview').hidden = true;
  $('snapRow').hidden = false;
  $('dropZone').hidden = false;
  $('noteInput').value = '';
  $('cameraInput').value = '';
  $('fileInput').value = '';
  showAccessProblem(state.accessProblem || '');
}

function toastProblem(message) {
  showAccessProblem('');
  const box = $('accessNotice');
  box.classList.remove('bad');
  box.classList.add('warn');
  $('accessNoticeText').textContent = message;
  box.hidden = false;
  setTimeout(() => { box.classList.add('bad'); box.classList.remove('warn'); if (!state.accessProblem) box.hidden = true; }, 6000);
}

/* ---------------- asking ---------------- */

let tipTimer = null;
function startTips() {
  let i = Math.floor(Math.random() * TIPS.length);
  $('thinkingTip').textContent = TIPS[i];
  clearInterval(tipTimer);
  tipTimer = setInterval(() => {
    i = (i + 1) % TIPS.length;
    $('thinkingTip').style.opacity = 0;
    setTimeout(() => { $('thinkingTip').textContent = TIPS[i]; $('thinkingTip').style.opacity = 1; }, 300);
  }, 6000);
}

async function askForHints(event) {
  event.preventDefault();
  if (!state.photo || state.busy) return;
  state.busy = true;
  show('thinking');
  startTips();
  try {
    const data = await services.start({
      imageDataUrl: state.photo,
      note: $('noteInput').value,
      childIndex: state.childIndex,
      level: $('levelSelect').value
    });
    if (state.status) state.status.allowance = data.allowance;
    state.current = {
      id: 'q' + Date.now().toString(36),
      result: data.result,
      session: data.session,
      level: data.level,
      photo: state.photo,
      photoThumb: state.photoThumb,
      progress: initialProgress(data.result.steps),
      turns: [],
      solved: false,
      savedAtMs: Date.now()
    };
    if (data.result.needs === 'ok') {
      // The first hint of step 1 is open straight away: that is what the student asked for.
      state.current.progress = revealHint(state.current.progress, data.result.steps, 0);
      saveCurrent();
    }
    showCoach();
  } catch (e) {
    show('ask');
    if (e && (e.status === 403)) { state.accessProblem = friendlyError(e); showAccessProblem(state.accessProblem); }
    else toastProblem(friendlyError(e));
    if (e && e.status === 429 && state.status) { state.status.allowance = { ...(state.status.allowance || {}), photosLeft: 0 }; renderAllowance(); }
  } finally {
    clearInterval(tipTimer);
    state.busy = false;
  }
}

/* ---------------- coaching ---------------- */

function showCoach() {
  const c = state.current;
  const r = c.result;
  show('coach');
  $('subjectChip').textContent = SUBJECT_NAMES[r.subject] || SUBJECT_NAMES.other;
  $('topicChip').textContent = r.topic || '';
  $('topicChip').hidden = !r.topic;
  const ok = r.needs === 'ok';
  $('needsCard').hidden = ok;
  $('needsText').textContent = r.message || '';
  for (const id of ['questionCard', 'encourageCard', 'stepsList', 'chatCard']) $(id).hidden = !ok;
  $('solvedCard').hidden = !(ok && c.solved);
  if (!ok) return;
  $('questionPhoto').src = c.photo || c.photoThumb || '';
  $('questionPhoto').hidden = !(c.photo || c.photoThumb);
  $('questionText').textContent = r.question;
  $('encourageText').textContent = [r.encouragement, r.checkIn].filter(Boolean).join(' ');
  renderSteps();
  renderTurns();
  renderAllowance();
}

function renderSteps() {
  const c = state.current;
  const steps = c.result.steps;
  const list = $('stepsList');
  list.textContent = '';
  steps.forEach((step, i) => {
    const shown = c.progress.shown[i] || 0;
    const done = c.progress.done[i];
    const current = i === c.progress.step && !done;
    const locked = i > c.progress.step;
    const li = el('li', { class: 'step' + (current ? ' is-current' : '') + (locked ? ' is-locked' : '') + (done ? ' is-done' : ''), 'data-step': String(i + 1) });
    li.append(el('div', { class: 'step-head' },
      el('span', { class: 'step-num', 'aria-hidden': 'true' }, done ? '✓' : String(i + 1)),
      el('div', {},
        el('p', { class: 'eyebrow', text: 'Step ' + (i + 1) + ' of ' + steps.length + (done ? ' · done' : '') }),
        el('p', { class: 'step-goal' + (locked ? ' is-hidden-goal' : ''), text: locked ? 'Opens when you finish step ' + i + '.' : step.goal })
      )
    ));
    if (shown) {
      li.append(el('ul', { class: 'hints' }, step.hints.slice(0, shown).map((hint, h) =>
        el('li', { class: 'hint' }, el('span', { class: 'bulb', 'aria-hidden': 'true' }, '💡'), el('span', {}, el('b', {}, 'Hint ' + (h + 1) + ': '), hint)))));
    }
    if (!locked && !done) {
      const actions = el('div', { class: 'step-actions' });
      if (shown < step.hints.length) {
        actions.append(el('button', { class: 'btn btn-small btn-hint', type: 'button', onclick: () => moreHint(i) }, shown ? '💡 Show another hint' : '💡 Show a hint'));
      }
      actions.append(el('button', { class: 'btn btn-small', type: 'button', onclick: () => stepDone(i) }, i === steps.length - 1 ? '✓ I have my answer' : '✓ I have done this step'));
      actions.append(el('span', { class: 'hint-count', text: shown + ' of ' + step.hints.length + ' hints' }));
      li.append(actions);
    }
    list.append(li);
  });
}

function moreHint(i) {
  const c = state.current;
  c.progress = revealHint(c.progress, c.result.steps, i);
  saveCurrent();
  renderSteps();
}

function stepDone(i) {
  const c = state.current;
  c.progress = finishStep(c.progress, c.result.steps, i);
  saveCurrent();
  renderSteps();
  if (allStepsDone(c.progress)) {
    $('replyInput').placeholder = 'Type your final answer here and I will check it';
    $('chatCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('replyInput').focus({ preventScroll: true }), 400);
  } else {
    const next = $('stepsList').querySelector('[data-step="' + (i + 2) + '"]');
    if (next) next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderTurns() {
  const c = state.current;
  const ul = $('turnsList');
  ul.textContent = '';
  for (const turn of c.turns) ul.append(turnNode(turn));
}

function turnNode(turn) {
  if (turn.who === 'student') return el('li', { class: 'turn student', text: turn.text });
  const label = VERDICT_LABELS[turn.verdict];
  return el('li', { class: 'turn coach' + (turn.verdict ? ' v-' + turn.verdict : '') + (turn.thinking ? ' is-thinking' : '') },
    label ? el('span', { class: 'verdict' }, el('span', { 'aria-hidden': 'true' }, label.icon), label.label) : null,
    turn.thinking ? el('span', { class: 'dots', 'aria-label': 'Thinking' }, el('i'), el('i'), el('i')) : turn.text);
}

async function sendReply(text) {
  const c = state.current;
  const message = String(text || '').trim();
  if (!c || !message || state.busy) return;
  state.busy = true;
  const button = $('replyButton');
  button.classList.add('is-busy');
  button.disabled = true;
  const history = historyForServer(c.turns);
  c.turns.push({ who: 'student', text: message });
  $('replyInput').value = '';
  renderTurns();
  const thinking = turnNode({ who: 'coach', thinking: true });
  $('turnsList').append(thinking);
  thinking.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const data = await services.reply({ session: c.session, message, history, hintsSeen: hintsSeen(c.progress) });
    if (state.status) state.status.allowance = data.allowance;
    const r = data.result;
    c.turns.push({ who: 'coach', text: r.message, verdict: r.verdict });
    // The helper says which step the student has reached: open it, so the hints follow along.
    if (r.step && r.step - 1 > c.progress.step && r.step <= c.result.steps.length) {
      for (let s = c.progress.step; s < r.step - 1; s++) c.progress = finishStep(c.progress, c.result.steps, s);
      renderSteps();
    }
    if (r.verdict === 'correct') {
      c.solved = true;
      c.result.steps.forEach((_, s) => { c.progress = finishStep(c.progress, c.result.steps, s); });
      renderSteps();
      $('solvedCard').hidden = false;
      celebrate();
    }
    saveCurrent();
  } catch (e) {
    c.turns.push({ who: 'coach', text: friendlyError(e) });
    if (e && e.code === 'bad-session') { c.session = ''; }
  } finally {
    renderTurns();
    renderAllowance();
    state.busy = false;
    button.classList.remove('is-busy');
    button.disabled = false;
    const last = $('turnsList').lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function celebrate() {
  const card = $('solvedCard');
  const colours = ['#80CBC4', '#FFCC80', '#A5D6A7', '#90CAF9', '#F48FB1', '#FFE082'];
  for (let i = 0; i < 28; i++) {
    const bit = el('span', { class: 'confetti' });
    bit.style.left = (10 + Math.random() * 80) + '%';
    bit.style.background = colours[i % colours.length];
    bit.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    bit.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    bit.style.animationDelay = (Math.random() * 0.3) + 's';
    card.append(bit);
    setTimeout(() => bit.remove(), 2000);
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function newQuestion() {
  state.current = null;
  resetAsk();
  renderRecent();
  show('ask');
}

/* ---------------- sign in ---------------- */

async function refreshStatus() {
  try {
    state.status = await services.status();
    state.accessProblem = '';
    if (state.childIndex >= ((state.status.children || []).length || 1)) state.childIndex = 0;
    showAccessProblem('');
    renderChildren();
    renderAllowance();
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      state.accessProblem = friendlyError(e);
      showAccessProblem(state.accessProblem);
    } else {
      console.warn('[homework] status', e);
    }
  }
}

function wire() {
  $('googleSignIn').addEventListener('click', async () => {
    $('signinError').textContent = '';
    try { await services.signInGoogle(); } catch (e) { $('signinError').textContent = services.friendlyAuthError(e); }
  });
  $('usernameForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    $('signinError').textContent = '';
    $('usernameSubmit').disabled = true;
    try { await services.signInUsername(form.loginId.value, form.password.value); }
    catch (e) { $('signinError').textContent = services.friendlyAuthError(e); }
    finally { $('usernameSubmit').disabled = false; }
  });
  $('signOutButton').addEventListener('click', () => services.signOut());

  $('takePhotoButton').addEventListener('click', () => $('cameraInput').click());
  $('choosePhotoButton').addEventListener('click', () => $('fileInput').click());
  $('cameraInput').addEventListener('change', (e) => usePhotoFile(e.target.files && e.target.files[0]));
  $('fileInput').addEventListener('change', (e) => usePhotoFile(e.target.files && e.target.files[0]));
  $('retakeButton').addEventListener('click', resetAsk);
  $('askForm').addEventListener('submit', askForHints);

  const zone = $('dropZone');
  ['dragenter', 'dragover'].forEach((type) => document.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((type) => document.addEventListener(type, (e) => { e.preventDefault(); if (type === 'drop' || e.target === zone) zone.classList.remove('is-over'); }));
  document.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && !$('askView').hidden) usePhotoFile(file);
  });
  document.addEventListener('paste', (e) => {
    if ($('askView').hidden) return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((x) => x.type && x.type.startsWith('image/'));
    if (item) usePhotoFile(item.getAsFile());
  });

  $('newQuestionButton').addEventListener('click', newQuestion);
  $('solvedNext').addEventListener('click', newQuestion);
  $('needsRetry').addEventListener('click', newQuestion);
  $('replyForm').addEventListener('submit', (e) => { e.preventDefault(); sendReply($('replyInput').value); });
  $('replyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); sendReply($('replyInput').value); }
  });
  $('quickReplies').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick]');
    if (b) sendReply(b.dataset.quick);
  });
  $('questionPhoto').addEventListener('click', () => {
    $('photoViewImage').src = $('questionPhoto').src;
    $('photoView').hidden = false;
  });
  $('photoView').addEventListener('click', () => { $('photoView').hidden = true; });
}

wire();
services.watchUser((user) => {
  state.user = user;
  $('signinScreen').hidden = !!user;
  $('app').hidden = !user;
  if (!user) return;
  $('whoAmI').textContent = user.displayName || user.email || '';
  renderRecent();
  refreshStatus();
});
