import { installWhiteboards } from './whiteboards.js?v=1.429.0';
import { whiteboardQuestionHtml, escapeWhiteboardHtml, whiteboardWorksheetHtml } from './whiteboard-core.mjs?v=1.429.0';
import { whiteboardViewerUrl, whiteboardShareParameters, loadPublishedWhiteboard, whiteboardImageUrl } from './whiteboard-share.mjs?v=1.429.0';

const status = document.getElementById('whiteboardViewerStatus');
const dialog = document.getElementById('wbResponseDialog');
let answerCards = [], responseKey = '';
const notify = text => { status.hidden = false; status.textContent = String(text || ''); };
function tryQuestions(board, { cardId } = {}) {
  answerCards = board.cards.filter(card => !cardId || card.id === cardId);
  if (!answerCards.length) throw new Error('This question is no longer on the whiteboard.');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(responseKey) || '{}'); } catch (_) {}
  document.getElementById('wbResponseQuestions').innerHTML = answerCards.map((card, index) =>
    '<section class="wb-response-row"><h3>' + (index + 1) + '. ' + escapeWhiteboardHtml(card.question.title) + '</h3>'
    + whiteboardQuestionHtml(card.question, { imageUrl: whiteboardImageUrl }) + '<label for="wbResponse_' + index + '">My answer</label><textarea id="wbResponse_' + index + '" maxlength="12000" data-response-card="' + escapeWhiteboardHtml(card.id) + '">' + escapeWhiteboardHtml(saved[card.id] || '') + '</textarea></section>').join('');
  document.getElementById('wbResponseStatus').textContent = '';
  dialog.showModal();
  return true;
}
document.getElementById('wbResponseClose').addEventListener('click', () => dialog.close());
document.getElementById('wbResponseSave').addEventListener('click', () => {
  try {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(responseKey) || '{}'); } catch (_) {}
    for (const textarea of dialog.querySelectorAll('[data-response-card]')) saved[textarea.dataset.responseCard] = textarea.value;
    localStorage.setItem(responseKey, JSON.stringify(saved));
    document.getElementById('wbResponseStatus').textContent = 'Your answers are saved on this browser.';
  } catch (_) { document.getElementById('wbResponseStatus').textContent = 'This browser could not save the answers. Keep this window open or copy your answers.'; }
});
function printWorksheet({ board }) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Allow pop-ups to export the worksheet PDF.');
  tab.opener = null;
  tab.addEventListener('load', async () => {
    try {
      if (tab.closed) return;
      await Promise.all([...tab.document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
        const timeout = setTimeout(resolve, 15000);
        img.onload = img.onerror = () => { clearTimeout(timeout); resolve(); };
      })));
      if (tab.closed) return;
      if ([...tab.document.images].some(img => !img.naturalWidth)) { notify('A diagram has not loaded. Keep the worksheet preview open and retry printing after it loads.'); return; }
      tab.focus(); tab.print();
    } catch (_) { if (!tab.closed) notify('The worksheet preview could not print. Keep it open and use the browser Print menu to save it as PDF.'); }
  }, { once: true });
  tab.document.write(whiteboardWorksheetHtml(board, { imageUrl: whiteboardImageUrl }));
  [...tab.document.images].forEach(img => { img.loading = 'eager'; });
  tab.document.close();
  return true;
}
const whiteboards = installWhiteboards({
  getUser: () => null, getAuthUid: () => '', canAuthor: () => false,
  getBank: () => [], getLevels: () => [], isQuestionEligible: () => false,
  imageUrl: whiteboardImageUrl, practiceBoard: tryQuestions, printBoard: printWorksheet, notify,
});
async function load() {
  try {
    const parameters = whiteboardShareParameters(location.hash);
    if (!parameters) throw new Error('The whiteboard link is incomplete. Ask your teacher for the full share link.');
    const link = whiteboardViewerUrl(parameters.id, parameters.token);
    const board = await loadPublishedWhiteboard(link);
    responseKey = 'cerWhiteboardResponses:' + parameters.id;
    document.getElementById('whiteboardViewerTitle').textContent = board.title;
    document.title = board.title + ' · Polymath whiteboard';
    document.getElementById('whiteboardAccountLink').href = './?whiteboard=' + encodeURIComponent(link);
    if (!whiteboards.setPublicBoard(board)) throw new Error('The shared whiteboard could not be displayed.');
    status.hidden = true;
  } catch (error) {
    status.hidden = false; status.classList.add('viewer-error');
    status.textContent = error.message || 'The whiteboard could not be opened. Refresh to try again.';
  }
}
window.addEventListener('hashchange', () => location.reload());
load();
