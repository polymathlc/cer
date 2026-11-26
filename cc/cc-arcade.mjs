import { KIDS, kidById, formatDay } from './cc-core.mjs';
import { ARCADE_STORAGE_PREFIX, GAMES, ITEMS, WIN_REWARD, createArcadeStore } from './cc-arcade-core.mjs';
import { mountGame } from './cc-games.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const descriptions = {
  dash: 'Switch lanes to collect eight foxfires.',
  signals: 'Watch the runes and repeat three patterns.',
  rush: 'Catch ten relics before time runs out.'
};
const gameById = id => GAMES.find(game => game.id === id);
const elementName = { caius: 'Smoke', caris: 'Kitsune' };

function playerChoices() {
  return KIDS.map(kid => `<button class="arc-player arc-player-${kid.id}" data-arc="player" data-value="${kid.id}">
    <img src="./assets/${kid.id}-banner.webp" alt="">
    <span><strong>${kid.name}</strong><small>${elementName[kid.id]} transformation</small></span>
  </button>`).join('');
}

function heroStage(kid, replayed, rewardNote) {
  const player = kidById(kid);
  return `<div class="arc-transform arc-transform-${kid}">
    <img class="arc-transform-bg" src="./assets/${kid}-banner.webp" alt="">
    <div class="arc-transform-copy"><p class="arc-form-name">${elementName[kid]} transformation</p>
      <h2>${player.name}’s arcade</h2><p>${rewardNote}</p>
      <div class="arc-actions"><button class="arc-button" data-arc="transform">${replayed ? 'Replay transformation' : 'Transform'}</button>
        <button class="arc-secondary" data-arc="switch">Switch hero</button></div>
    </div>
    <div class="arc-transform-art">
      <div class="arc-transform-fx" aria-hidden="true">${Array.from({length: 9}, (_, i) => `<i style="--index:${i};--angle:${-76 + i * 19}deg"></i>`).join('')}</div>
      <img class="arc-full-form" src="./assets/${kid}-form.webp" alt="${kid === 'caius' ? 'Caius in his swirling Smoke form' : 'Caris in her blue nine-tailed Kitsune form'}">
    </div>
  </div>`;
}

function gameArt(id) {
  if (id === 'rush') {
    return `<span class="arc-game-art arc-art-rush" aria-hidden="true">
      <img src="./assets/relics/fox-lantern.webp" alt="">
      <img src="./assets/relics/tide-compass.webp" alt="">
      <img src="./assets/relics/storm-orb.webp" alt="">
    </span>`;
  }
  const hero = id === 'dash' ? 'caris' : 'caius';
  return `<span class="arc-game-art arc-art-${id}" aria-hidden="true"><img src="./assets/${hero}-banner.webp" alt=""></span>`;
}

function gameCards(kid, store, ledger) {
  return GAMES.map(game => {
    const won = kid && store.won(kid, game.id, ledger);
    return `<button class="arc-game-card" data-arc="play" data-value="${game.id}">
      ${gameArt(game.id)}
      <span class="arc-game-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <span>${descriptions[game.id]}</span>
        <span class="arc-card-bottom"><span class="arc-play">Play</span>
          <span class="arc-bounty${won ? ' arc-played' : ''}">${won ? 'Daily win complete' : '+' + WIN_REWARD + ' Robux'}</span>
        </span>
      </span>
    </button>`;
  }).join('');
}

function receiptPanel(receipts, data, busy) {
  if (!receipts.length) return '';
  return `<section class="arc-pending" aria-label="Game wins awaiting approval">
    <h3>Wins for Dad to approve</h3>
    <p>Dad can approve a win here or open its link on his phone.</p>
    <ul>${receipts.map(receipt => `<li>
      <span><strong>${kidById(receipt.kid).name} · ${escapeHtml(gameById(receipt.gameId).name)}</strong>
        <small>${escapeHtml(formatDay(receipt.day))} · ${WIN_REWARD} Robux</small></span>
      <div class="arc-actions"><button type="button" class="arc-secondary" data-arc="share" data-value="${escapeHtml(receipt.id)}">Share win with Dad</button>
      ${data.isAdmin ? `<button type="button" class="arc-button" data-arc="approve" data-value="${escapeHtml(receipt.id)}"
        ${busy.has(receipt.id) || !data.ledgerReady ? 'disabled' : ''}>${busy.has(receipt.id) ? 'Saving…' : 'Approve win'}</button>` : ''}</div>
    </li>`).join('')}</ul>
  </section>`;
}

function vaultMarkup(kid, draws, ready) {
  const unopened = draws.filter(draw => !draw.revealed);
  const first = unopened[0];
  let instruction = 'Choose your hero to see their quest draws.';
  if (kid) {
    instruction = !ready ? 'Waiting for the quest board to sync…'
      : first ? `Earned for “${escapeHtml(first.title)}”`
        : 'Each quest Dad marks successful unlocks one free relic draw.';
  }
  return `<section class="arc-vault" aria-label="Quest draws">
    <div class="arc-vault-art" aria-hidden="true"><i></i><img src="./assets/relics/dragon-core.webp" alt=""></div>
    <div class="arc-vault-copy"><h3>Quest vault</h3><p>${instruction}</p>
      ${first ? `<button class="arc-button" data-arc="draw" data-value="${escapeHtml(first.questId)}">Open quest draw</button>
        <span class="arc-available">${unopened.length} ready</span>` : ''}
    </div>
  </section>`;
}

function itemCounts(draws) {
  const counts = new Map();
  for (const draw of draws) {
    if (draw.revealed) counts.set(draw.item.id, (counts.get(draw.item.id) || 0) + 1);
  }
  return counts;
}

function collectionMarkup(kid, counts) {
  return `<section class="arc-collection" aria-label="Relic collection">
    <div class="arc-section-heading"><h3>Relic collection</h3>${kid ? `<span>${counts.size} / ${ITEMS.length} discovered</span>` : ''}</div>
    <div class="arc-items">${ITEMS.map(item => {
      const count = counts.get(item.id) || 0;
      return `<button class="arc-item ${count ? 'arc-owned' : ''}" data-rarity="${escapeHtml(item.rarity)}" data-arc="item" data-value="${escapeHtml(item.id)}">
        <span class="arc-item-image"><img alt="" loading="lazy" src="${escapeHtml(item.image)}"></span>
        <span class="arc-item-name">${escapeHtml(item.name)}</span>
        <span class="arc-item-meta">${escapeHtml(item.rarity)}${count ? ' · ×' + count : kid ? ' · Locked' : ''}</span>
      </button>`;
    }).join('')}</div>
  </section>`;
}

function shareUrl(receipt) {
  const link = new URL(location.href);
  link.search = '';
  link.hash = `arcade-win/${receipt.kid}/${receipt.gameId}/${receipt.day}`;
  return link.href;
}

export function createArcade(host, { approveWin, notify, selectKid } = {}) {
  const store = createArcadeStore();
  const lobby = document.createElement('div');
  lobby.className = 'arc-lobby';
  host.append(lobby);
  const approving = new Set();
  // Hide a credited receipt until the live ledger snapshot catches up.
  const justApproved = new Set();
  const transformed = new Set();
  let data = { kid: '', quests: [], ledger: [], isAdmin: false, questsReady: false, ledgerReady: false };
  let localKid = '';
  let active = false;
  let lastMarkup = '';
  let currentDialog = null;

  const kidId = () => localKid || data.kid;
  const pending = () => {
    const ids = kidId() ? [kidId()] : KIDS.map(kid => kid.id);
    return ids.flatMap(kid => store.pending(kid, data.ledger))
      .filter(receipt => !justApproved.has(receipt.id))
      .sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
  };

  function render() {
    if (!active) return;
    const kid = kidId();
    const name = kidById(kid)?.name;
    const draws = kid && data.questsReady ? store.draws(kid, data.quests) : [];
    const rewardNote = `The first win in each game earns ${WIN_REWARD} Robux once Dad approves it. Daily wins reset at midnight in Singapore.`;
    const markup = `${name ? heroStage(kid, transformed.has(kid), rewardNote)
      : `<div class="arc-heading"><div><h2>Elemental arcade</h2><p>${rewardNote}</p></div></div>
        <div class="arc-select"><h3>Choose your hero</h3><div class="arc-players">${playerChoices()}</div></div>`}
      <div class="arc-games" aria-label="Mini-games">${gameCards(kid, store, data.ledger)}</div>
      ${receiptPanel(pending(), data, approving)}
      ${vaultMarkup(kid, draws, data.questsReady)}
      ${collectionMarkup(kid, itemCounts(draws))}`;
    if (markup === lastMarkup) return;
    const focused = lobby.contains(document.activeElement) ? document.activeElement : null;
    lastMarkup = markup;
    lobby.innerHTML = markup;
    if (focused?.dataset.arc) restoreFocus(focused.dataset.arc, focused.dataset.value);
  }

  function restoreFocus(action, value) {
    const buttons = lobby.querySelectorAll('button[data-arc]');
    const target = Array.from(buttons).find(button => button.dataset.arc === action && button.dataset.value === value);
    (target || lobby.querySelector('[data-arc="switch"], [data-arc="player"]'))?.focus({ preventScroll: true });
  }

  function choosePlayer(kid) {
    if (!kidById(kid)) return;
    localKid = kid;
    if (selectKid) selectKid(kid);
    render();
  }

  function dialog(title, trigger, kind = '') {
    currentDialog?.dismiss(false);
    const el = document.createElement('dialog');
    el.className = `arc-dialog ${kind}`;
    el.setAttribute('aria-label', title);
    el.innerHTML = `<div class="arc-dialog-head"><h2>${escapeHtml(title)}</h2>
      <button type="button" class="arc-close" aria-label="Close dialog">✕</button></div><div class="arc-dialog-body"></div>`;
    host.append(el);
    const session = {
      el, body: el.querySelector('.arc-dialog-body'), cleanup: null,
      dismiss(returnFocus = true) {
        if (currentDialog !== session) return;
        currentDialog = null;
        session.cleanup?.();
        if (el.open) el.close();
        el.remove();
        if (active && returnFocus) restoreFocus(trigger?.dataset.arc, trigger?.dataset.value);
      }
    };
    currentDialog = session;
    el.querySelector('.arc-close').addEventListener('click', () => session.dismiss());
    el.addEventListener('cancel', event => { event.preventDefault(); session.dismiss(); });
    el.addEventListener('close', () => session.dismiss());
    el.showModal();
    return session;
  }

  function playerDialog(trigger, gameId) {
    const view = dialog('Choose your hero', trigger, 'arc-player-dialog');
    view.body.innerHTML = `<div class="arc-players">${playerChoices()}</div>`;
    view.body.querySelectorAll('[data-arc="player"]').forEach(button => {
      button.addEventListener('click', () => {
        view.dismiss(false);
        choosePlayer(button.dataset.value);
        if (gameId) startGame(gameId, trigger);
        else restoreFocus('switch');
      });
    });
  }

  function startGame(id, trigger) {
    const kid = kidId();
    const game = gameById(id);
    if (!game) return;
    if (!kid) { playerDialog(trigger, id); return; }
    const view = dialog(`${game.name} · ${kidById(kid).name}`, trigger, 'arc-game-dialog');
    const gameRoot = document.createElement('div');
    const feedback = document.createElement('p');
    feedback.className = 'arc-win-feedback';
    feedback.setAttribute('role', 'status');
    view.body.append(gameRoot, feedback);
    gameRoot.addEventListener('click', event => {
      if (event.target.closest('[data-game-action="start"]')) feedback.replaceChildren();
    }, true);
    view.cleanup = mountGame(gameRoot, id, kid, () => {
      const { receipt, newWin, persisted } = store.recordWin(kid, id, data.ledger);
      feedback.textContent = newWin
        ? `${kidById(kid).name} earned a ${WIN_REWARD} Robux win for Dad to approve. ${persisted ? 'The win is saved on this device.' : 'Device storage is unavailable. Share the win before closing this page.'}`
        : 'Daily win already recorded. You can play again for fun.';
      if (receipt && store.pending(kid, data.ledger).some(entry => entry.id === receipt.id)) {
        const share = document.createElement('button');
        share.className = 'arc-secondary arc-win-share';
        share.type = 'button';
        share.textContent = 'Share win with Dad';
        share.addEventListener('click', () => shareWin(receipt, trigger));
        feedback.append(' ', share);
      }
      render();
    }, () => view.dismiss());
  }

  function showItem(item, trigger, draw) {
    const view = dialog(draw ? 'Quest draw' : 'Relic details', trigger, draw ? 'arc-reveal-dialog' : 'arc-detail-dialog');
    const qty = itemCounts(store.draws(kidId(), data.quests)).get(item.id) || 0;
    view.body.innerHTML = `<div class="arc-inspect ${draw ? 'arc-revealing' : ''}" data-rarity="${escapeHtml(item.rarity)}">
      <div class="arc-showcase"><i aria-hidden="true"></i><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"></div>
      <span class="arc-rarity">${escapeHtml(item.rarity)} relic</span><h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description)}</p>
      <p class="arc-item-detail">${draw ? `From “${escapeHtml(draw.title)}” · ${qty} in your collection` : `${escapeHtml(item.weight)}% draw chance${kidId() ? ' · ' + qty + ' collected' : ''}`}</p>
      ${draw && !draw.persisted ? '<p>Your reveal is saved for this visit. This device could not save it for next time.</p>' : ''}
      <button type="button" class="arc-button" data-dismiss>Back to arcade</button></div>`;
    view.body.querySelector('[data-dismiss]').onclick = () => view.dismiss();
  }

  function openQuest(questId, trigger) {
    if (!active || !data.questsReady || !kidId()) return;
    const quest = data.quests.find(q => q.id === questId);
    const existing = quest && store.draws(kidId(), [quest])[0];
    if (!existing) return;
    if (existing.revealed) { showItem(existing.item, trigger); return; }
    const draw = store.reveal(kidId(), quest);
    if (draw) { showItem(draw.item, trigger, draw); render(); }
  }

  async function shareWin(receipt, trigger) {
    const url = shareUrl(receipt);
    const title = `${kidById(receipt.kid).name} won ${gameById(receipt.gameId).name}`;
    if (navigator.share) {
      try { await navigator.share({ title, text: `${title}! Dad can approve the ${WIN_REWARD} Robux win here.`, url }); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify?.('Win link copied. Send it to Dad.', 'good');
    } catch {
      const view = dialog('Share win with Dad', trigger);
      view.body.innerHTML = '<label class="arc-share-label">Copy this win link and send it to Dad<input class="arc-share-link" type="text" readonly></label>';
      const field = view.body.querySelector('input');
      field.value = url;
      field.focus();
      field.select();
    }
  }

  async function approve(receipt) {
    if (!approveWin || !data.isAdmin || !data.ledgerReady || approving.has(receipt.id)) return;
    approving.add(receipt.id);
    render();
    try {
      const credited = await approveWin(receipt);
      justApproved.add(receipt.id);
      notify?.(credited === false ? 'This win has already been credited.' : `Approved ${WIN_REWARD} Robux for ${kidById(receipt.kid).name}.`, 'good');
    } catch (error) {
      notify?.(`Could not approve this win. ${error?.message || 'Please try again.'}`, 'bad');
    } finally {
      approving.delete(receipt.id);
      render();
    }
  }

  lobby.addEventListener('click', event => {
    const button = event.target.closest('button[data-arc]');
    if (!button || !lobby.contains(button) || button.disabled) return;
    const { arc, value } = button.dataset;
    if (arc === 'transform') {
      const kid = kidId();
      if (!kid) return;
      transformed.add(kid);
      render();
      const stage = lobby.querySelector('.arc-transform');
      stage.classList.remove('arc-transforming');
      // Restart the effect even when the player replays it mid-animation.
      void stage.offsetWidth;
      stage.classList.add('arc-transforming');
    }
    if (arc === 'switch') playerDialog(button);
    if (arc === 'player') { choosePlayer(value); restoreFocus('switch'); }
    if (arc === 'play') startGame(value, button);
    if (arc === 'item') {
      const item = ITEMS.find(candidate => candidate.id === value);
      if (item) showItem(item, button);
    }
    if (arc === 'draw') openQuest(value, button);
    if (arc === 'share' || arc === 'approve') {
      const receipt = pending().find(candidate => candidate.id === value);
      if (receipt && arc === 'share') shareWin(receipt, button);
      if (receipt && arc === 'approve') approve(receipt);
    }
  });

  window.addEventListener('storage', event => {
    if (!event.key || event.key.startsWith(ARCADE_STORAGE_PREFIX)) render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });
  return {
    openQuest,
    update(next) {
      // Honour external changes to the board's player filter, including "Both".
      if (next.kid !== data.kid) localKid = '';
      data = next;
      active = true;
      render();
    },
    hide() {
      active = false;
      currentDialog?.dismiss(false);
    }
  };
}
