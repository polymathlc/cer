// The board remains the source of truth for completed quests and credited Robux.
// A child's browser stores only which reveals they watched and which wins Dad can review.
import { KID_IDS, isAdminEmail, sgDate } from './cc-core.mjs';

export const ARCADE_VERSION = '1.1.1';

export function arcadeAssetPath(file) {
  const version = file === 'caius-form.webp' || file === 'caius-banner.webp' ? '?v=' + ARCADE_VERSION : '';
  return './assets/' + file + version;
}

export const ARCADE_STORAGE_PREFIX = 'cc.arcade.v1:';
export const WIN_REWARD = 5;
export const GAMES = Object.freeze([
  { id: 'dash', name: 'Foxfire Dash' },
  { id: 'signals', name: 'Smoke Signals' },
  { id: 'rush', name: 'Relic Rush' }
].map(Object.freeze));

const relics = [
  ['smoke-vial', 'Smoke Vial', 'A wisp from Caius’s Gas Fruit swirls under the cork.', 'Common', 15],
  ['fox-lantern', 'Foxfire Lantern', 'A blue fox-flame lights the trail home.', 'Common', 15],
  ['tide-compass', 'Tide Compass', 'Its needle follows the pull of the hidden moon.', 'Common', 15],
  ['anchor-bracelet', 'Anchor Bracelet', 'A pocket-sized anchor from the first island voyage.', 'Common', 15],
  ['kitsune-mask', 'Kitsune Mask', 'Blue flames dance along the spirit fox’s ears.', 'Rare', 8],
  ['smoke-gauntlet', 'Smoke Gauntlet', 'A wisp escapes through each joint when the fingers close.', 'Rare', 8],
  ['moon-pendant', 'Moon Pendant', 'This crescent keeps a sliver of moonlight through the day.', 'Rare', 8],
  ['cloud-boots', 'Cloud Boots', 'The soles leave little puffs of cloud with every step.', 'Rare', 8],
  ['storm-orb', 'Storm Orb', 'A miniature thunderstorm rolls inside the crystal.', 'Epic', 3],
  ['fox-fan', 'Foxfire Fan', 'One sweep scatters sparks in the shape of fox tails.', 'Epic', 3],
  ['spirit-crown', 'Spirit Crown', 'Only the oldest fox spirits remember who forged it.', 'Legendary', 1],
  ['dragon-core', 'Dragon Core', 'An ember at its heart pulses like a sleeping dragon.', 'Legendary', 1]
];

// The order and weights make up the first edition's draw table. Keep this
// edition stable so returning players always see the item their quest earned.
export const ITEMS = Object.freeze(relics.map(([id, name, description, rarity, weight]) =>
  Object.freeze({ id, name, description, rarity, weight, image: './assets/relics/' + id + '.webp' })
));

function itemFor(kid, questId) {
  const seed = 'cc-relics-1:' + kid + ':' + questId;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  // Mix the high and low bits, including for quests with similar IDs.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  let roll = ((hash ^ (hash >>> 16)) >>> 0) % 100;
  for (const item of ITEMS) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }
  throw new Error('The relic draw table must cover all 100 outcomes.');
}

function earnedDraw(kid, quest) {
  return KID_IDS.includes(kid) && typeof quest?.id === 'string' && quest.id.length > 0
    && quest.kids?.includes(kid) && quest.results?.[kid]?.status === 'success';
}

function validDay(day, today) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return false;
  const ms = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

export function receiptFor(kid, gameId, day, now = Date.now()) {
  if (!KID_IDS.includes(kid) || !GAMES.some(game => game.id === gameId) || !validDay(day, sgDate(now))) return null;
  return { id: 'arcade-' + kid + '-' + gameId + '-' + day, kid, gameId, day };
}

export function arcadeLedgerEntry(receipt, email, now = Date.now()) {
  if (!receipt || !isAdminEmail(email)) return null;
  const canonical = receiptFor(receipt.kid, receipt.gameId, receipt.day, now);
  if (!canonical || receipt.id !== canonical.id) return null;
  const game = GAMES.find(game => game.id === canonical.gameId);
  return { kid: canonical.kid, type: 'bonus', amount: WIN_REWARD,
    note: game.name + ' win · ' + canonical.day, at: now, by: email };
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function createArcadeStore(storage = browserStorage(), clock = Date.now) {
  // One immutable marker per event avoids lost updates when two games or draws
  // finish in other tabs. Failed writes live in this page until it closes.
  const volatile = new Set();
  const winPrefix = ARCADE_STORAGE_PREFIX + 'win:';
  const revealKey = (kid, questId) => ARCADE_STORAGE_PREFIX + 'draw:' + kid + ':' + questId;
  const winKey = ({ kid, gameId, day }) => winPrefix + kid + ':' + gameId + ':' + day;

  function has(key) {
    if (volatile.has(key)) return true;
    try { return storage?.getItem(key) === '1'; } catch { return false; }
  }
  function mark(key) {
    try {
      if (storage) {
        storage.setItem(key, '1');
        volatile.delete(key);
        return true;
      }
    } catch { /* In private mode or at quota the win can still be approved in this session. */ }
    volatile.add(key);
    return false;
  }

  function draw(kid, quest) {
    return { questId: quest.id, title: quest.title, item: itemFor(kid, quest.id),
      revealed: has(revealKey(kid, quest.id)) };
  }

  return {
    draws(kid, quests) {
      const seen = new Set();
      const draws = [];
      for (const quest of quests) {
        if (earnedDraw(kid, quest) && !seen.has(quest.id)) {
          seen.add(quest.id);
          draws.push(draw(kid, quest));
        }
      }
      return draws;
    },
    reveal(kid, quest) {
      if (!earnedDraw(kid, quest)) return null;
      const key = revealKey(kid, quest.id);
      const persisted = mark(key);
      return { ...draw(kid, quest), persisted };
    },
    recordWin(kid, gameId, ledger = []) {
      const time = clock();
      const receipt = receiptFor(kid, gameId, sgDate(time), time);
      if (!receipt) return { receipt: null, newWin: false, persisted: false };
      if (ledger.some(entry => entry.id === receipt.id)) return { receipt, newWin: false, persisted: true };
      const key = winKey(receipt);
      const newWin = !has(key);
      return { receipt, newWin, persisted: mark(key) };
    },
    won(kid, gameId, ledger = [], day = sgDate(clock())) {
      const receipt = receiptFor(kid, gameId, day, clock());
      return !!receipt && (has(winKey(receipt)) || ledger.some(entry => entry.id === receipt.id));
    },
    pending(kid, ledger = []) {
      if (!KID_IDS.includes(kid)) return [];
      const prefix = winPrefix + kid + ':';
      const keys = new Set(volatile);
      try {
        for (let i = 0; i < (storage?.length ?? 0); i++) {
          const key = storage.key(i);
          if (key?.startsWith(prefix)) keys.add(key);
        }
      } catch { /* Storage may become unavailable during this session. */ }
      const paid = new Set(ledger.map(entry => entry.id));
      const receipts = [];
      const time = clock();
      for (const key of keys) {
        if (!key.startsWith(prefix) || !has(key)) continue;
        const [gameId, day] = key.slice(prefix.length).split(':');
        const receipt = receiptFor(kid, gameId, day, time);
        if (receipt && winKey(receipt) === key && !paid.has(receipt.id)) receipts.push(receipt);
      }
      return receipts.sort((a, b) => b.day.localeCompare(a.day) || a.gameId.localeCompare(b.gameId));
    }
  };
}
