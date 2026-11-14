/* =====================================================================
   POLYMATH MIND MAP — the pure core (v1.0.0, November 2026)
   ---------------------------------------------------------------------
   Everything here is plain logic with no DOM, no network and no Firebase,
   so tools/mindmap-tests.mjs can run it under node:

     • the map model (nodes, links, view) and its normaliser
     • the tidy-up layout (a balanced left/right mind map around the root)
     • the AI "operations" a voice command turns into, and applying them
     • the prompts the page sends to the AI for voice, expanding a topic
       and building / changing a learning app
     • the question bank helpers: level, release gate, search text, and the
       snapshot that is stored on a question node
     • the sandbox document a code window runs in
     • a tolerant JSON parser for model output (same rules as the cer app)

   The page (mindmap-app.js) imports this file. Nothing in it may touch
   `window`, `document` or the network.
   ===================================================================== */

export const MINDMAP_VERSION = '1.2.0';

/* ------------------------------------------------------------------ */
/*  Limits                                                              */
/* ------------------------------------------------------------------ */
export const LIMITS = {
  nodes: 400,               // one map; a Firestore document is 1 MB, so this keeps us well clear
  links: 600,
  text: 600,                // characters on one topic
  note: 4000,               // characters in one sticky note
  title: 120,
  codePart: 160000,         // characters in each of HTML / CSS / JS of one code window
  mapBytes: 950000,         // the saved document, measured as JSON
  history: 80,              // undo steps kept
  opsPerCommand: 40         // a voice command never adds more than this at once
};

export const NODE_TYPES = ['topic', 'note', 'image', 'code', 'question'];

/* Faint pastels, in the Polymath palette. `ink` is the text / border colour
   drawn on top, so every pair stays readable. */
export const NODE_COLORS = [
  { id: 'white',  label: 'White',  fill: '#FFFFFF', ink: '#1A1A1A', line: '#D4D4CF' },
  { id: 'orange', label: 'Orange', fill: '#FFF3E0', ink: '#8A4B00', line: '#FFCC80' },
  { id: 'blue',   label: 'Blue',   fill: '#E3F2FD', ink: '#0D47A1', line: '#90CAF9' },
  { id: 'green',  label: 'Green',  fill: '#F1F8E9', ink: '#1B5E20', line: '#A5D6A7' },
  { id: 'purple', label: 'Purple', fill: '#EDE7F6', ink: '#4527A0', line: '#B39DDB' },
  { id: 'coral',  label: 'Coral',  fill: '#FFEBEE', ink: '#B71C1C', line: '#EF9A9A' },
  { id: 'yellow', label: 'Yellow', fill: '#FFFDE7', ink: '#6D5D00', line: '#FFF176' },
  { id: 'teal',   label: 'Teal',   fill: '#E0F2F1', ink: '#004D40', line: '#80CBC4' },
  { id: 'gray',   label: 'Gray',   fill: '#F3F3F0', ink: '#3A3A3A', line: '#BDBDBD' }
];
export const COLOR_IDS = NODE_COLORS.map(c => c.id);
export function colorOf(id) { return NODE_COLORS.find(c => c.id === id) || NODE_COLORS[0]; }

/* Branch colours, in the order the root's children take them. */
export const BRANCH_ORDER = ['blue', 'green', 'orange', 'purple', 'coral', 'teal', 'yellow'];

export const SHAPES = ['rounded', 'pill', 'rect', 'cloud'];

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */
const str = value => String(value == null ? '' : value);
const clip = (value, max) => str(value).slice(0, max);
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

let idCounter = 0;
export function makeId(prefix = 'n') {
  idCounter = (idCounter + 1) % 1679616;
  const time = Date.now().toString(36).slice(-6);
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return prefix + time + rand + idCounter.toString(36);
}
export function isId(value) { return typeof value === 'string' && ID_RE.test(value); }

export function escapeHtml(value) {
  return str(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** HTML → plain text, without a DOM (good enough for search and the AI summary). */
export function htmlToText(html) {
  return str(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/*  The map model                                                       */
/* ------------------------------------------------------------------ */
/**
 * A map:
 *   { id, title, rootId, nodes: [node], links: [link], view: {x, y, zoom},
 *     ownerUid, ownerName, ownerEmail, createdAt, updatedAt, version }
 * A node:
 *   { id, type, parentId, x, y, w, h, text, color, shape, collapsed, side,
 *     note, image: {url, prompt, alt}, code: {title, html, css, js, height, prompt},
 *     question: {qid, title, topic, level, category, marks, blocks, answer} }
 * A node with no parentId that is not the root is FREE-STANDING (v1.1.0): it sits
 * where it was put, on its own, with no branch to anything (a question as its own
 * "container"). Tidy-up never moves it; its own children grow out of it to the right.
 * A link (a free connection, not the tree):
 *   { id, from, to, label }
 */
export function newMap({ title = 'My mind map', ownerUid = '', ownerName = '', ownerEmail = '' } = {}) {
  const rootId = makeId('r');
  const now = new Date().toISOString();
  return {
    id: makeId('m'),
    title: clip(title, LIMITS.title) || 'My mind map',
    rootId,
    nodes: [{ id: rootId, type: 'topic', parentId: '', x: 0, y: 0, w: 0, h: 0,
      text: clip(title, LIMITS.text) || 'Central idea', color: 'orange', shape: 'pill', collapsed: false, side: '' }],
    links: [],
    view: { x: 0, y: 0, zoom: 1 },
    ownerUid, ownerName, ownerEmail,
    createdAt: now, updatedAt: now,
    version: MINDMAP_VERSION
  };
}

function normalizeImage(image) {
  if (!image || typeof image !== 'object') return { url: '', prompt: '', alt: '', width: 260, style: 'illustration' };
  const url = str(image.url);
  const okUrl = /^https:\/\//i.test(url) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ? url : '';
  return { url: okUrl, prompt: clip(image.prompt, 2000), alt: clip(image.alt, 300),
    width: clamp(Math.round(num(image.width, 260)), 100, 900), style: clip(image.style, 20) || 'illustration' };
}
function normalizeCode(code) {
  const c = code && typeof code === 'object' ? code : {};
  return {
    title: clip(c.title, 120) || 'Learning app',
    html: clip(c.html, LIMITS.codePart),
    css: clip(c.css, LIMITS.codePart),
    js: clip(c.js, LIMITS.codePart),
    height: clamp(Math.round(num(c.height, 320)), 160, 1400),
    width: clamp(Math.round(num(c.width, 420)), 240, 1600),
    prompt: clip(c.prompt, 4000)
  };
}
function normalizeQuestion(q) {
  const v = q && typeof q === 'object' ? q : {};
  return {
    qid: clip(v.qid, 120),
    title: clip(v.title, 300),
    topic: clip(v.topic, 120),
    level: clip(v.level, 12),
    category: clip(v.category, 120),
    marks: clip(v.marks, 12),
    blocks: Array.isArray(v.blocks) ? v.blocks.slice(0, 60).map(normalizeSnapshotBlock).filter(Boolean) : [],
    width: clamp(Math.round(num(v.width, 360)), 240, 900),
    // v1.1.0: a question card can be folded down to one line (its headline), so a map full of questions stays neat.
    folded: v.folded === true
  };
}
/** A stored question block: only what the node draws. Answers are kept, but only drawn for staff or on "Check". */
export function normalizeSnapshotBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const type = str(block.type);
  switch (type) {
    case 'text': case 'part': case 'explanation': case 'plainanswer':
      return { type, label: clip(block.label, 40), content: clip(block.content, 20000) };
    case 'image':
      return { type, url: /^https:\/\//i.test(str(block.url)) ? str(block.url) : '', caption: clip(block.caption, 400) };
    case 'mcq':
      return { type, correctId: clip(block.correctId, 80),
        options: (Array.isArray(block.options) ? block.options : []).slice(0, 8).map(o => ({ id: clip(o && o.id, 80), text: clip(o && o.text, 4000) })) };
    case 'fillblank':
      return { type, text: clip(block.text, 8000) };
    case 'table': {
      // Firestore refuses arrays inside arrays, so a row is stored as { c: [cells] }.
      const rows = Array.isArray(block.rows) ? block.rows.map(r => (r && Array.isArray(r.c)) ? r.c : [])
        : Array.isArray(block.data) ? block.data : [];
      return { type, rows: rows.slice(0, 30).map(r => ({ c: (Array.isArray(r) ? r : []).slice(0, 12).map(c => clip(c, 2000)) })) };
    }
    case 'answer':
      return { type, claim: clip(block.claim, 4000), evidence: clip(block.evidence, 4000), reasoning: clip(block.reasoning, 4000) };
    case 'commonMistake':
      return { type, title: clip(block.title, 80), text: clip(block.text, 4000) };
    case 'studentAnswer':
      return { type, label: clip(block.label, 80), answer: clip(block.answer, 4000) };
    default:
      return null;
  }
}

export function normalizeNode(node) {
  if (!node || typeof node !== 'object' || !isId(node.id)) return null;
  const type = NODE_TYPES.includes(node.type) ? node.type : 'topic';
  const out = {
    id: node.id,
    type,
    parentId: isId(node.parentId) ? node.parentId : '',
    x: Math.round(num(node.x)),
    y: Math.round(num(node.y)),
    w: Math.max(0, Math.round(num(node.w))),
    h: Math.max(0, Math.round(num(node.h))),
    text: clip(node.text, LIMITS.text),
    color: COLOR_IDS.includes(node.color) ? node.color : 'white',
    shape: SHAPES.includes(node.shape) ? node.shape : 'rounded',
    collapsed: node.collapsed === true,
    side: node.side === 'left' || node.side === 'right' ? node.side : '',
    pinned: node.pinned === true
  };
  if (type === 'note') out.note = clip(node.note, LIMITS.note);
  if (type === 'image') out.image = normalizeImage(node.image);
  if (type === 'code') out.code = normalizeCode(node.code);
  if (type === 'question') out.question = normalizeQuestion(node.question);
  return out;
}

export function normalizeMap(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nodes = [];
  const seen = new Set();
  for (const n of Array.isArray(src.nodes) ? src.nodes : []) {
    const node = normalizeNode(n);
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
    if (nodes.length >= LIMITS.nodes) break;
  }
  let rootId = isId(src.rootId) && seen.has(src.rootId) ? src.rootId : '';
  if (!rootId) {
    const first = nodes.find(n => !n.parentId) || nodes[0];
    if (first) rootId = first.id;
  }
  if (!rootId) {
    const fresh = newMap({ title: src.title || 'My mind map' });
    nodes.push(fresh.nodes[0]);
    rootId = fresh.rootId;
    seen.add(rootId);
  }
  // Parents must exist, the root has none, and no cycles.
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (n.id === rootId) { n.parentId = ''; continue; }
    if (n.parentId && !byId.has(n.parentId)) n.parentId = rootId;
  }
  for (const n of nodes) {
    const trail = new Set([n.id]);
    let p = n.parentId;
    while (p) {
      if (trail.has(p)) { n.parentId = rootId; break; }
      trail.add(p);
      p = byId.get(p)?.parentId || '';
    }
  }
  const links = [];
  const linkSeen = new Set();
  for (const l of Array.isArray(src.links) ? src.links : []) {
    if (!l || !isId(l.id) || !byId.has(l.from) || !byId.has(l.to) || l.from === l.to) continue;
    const key = l.from + '>' + l.to;
    if (linkSeen.has(key) || linkSeen.has(l.id)) continue;
    linkSeen.add(key); linkSeen.add(l.id);
    links.push({ id: l.id, from: l.from, to: l.to, label: clip(l.label, 80) });
    if (links.length >= LIMITS.links) break;
  }
  const view = src.view && typeof src.view === 'object' ? src.view : {};
  return {
    id: isId(src.id) ? src.id : makeId('m'),
    title: clip(src.title, LIMITS.title) || 'My mind map',
    rootId,
    nodes,
    links,
    view: { x: num(view.x), y: num(view.y), zoom: clamp(num(view.zoom, 1), 0.1, 3) },
    ownerUid: str(src.ownerUid),
    ownerName: clip(src.ownerName, 120),
    ownerEmail: clip(src.ownerEmail, 200),
    createdAt: str(src.createdAt) || new Date().toISOString(),
    updatedAt: str(src.updatedAt) || new Date().toISOString(),
    version: MINDMAP_VERSION
  };
}

/* ------------------------------------------------------------------ */
/*  Tree helpers                                                        */
/* ------------------------------------------------------------------ */
export function nodeById(map, id) { return map.nodes.find(n => n.id === id) || null; }
export function childrenOf(map, id) { return map.nodes.filter(n => n.parentId === id); }
export function descendantsOf(map, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const child of childrenOf(map, current)) { out.push(child); stack.push(child.id); }
  }
  return out;
}
export function depthOf(map, id) {
  let depth = 0;
  let node = nodeById(map, id);
  while (node && node.parentId) { depth++; node = nodeById(map, node.parentId); if (depth > 500) break; }
  return depth;
}
export function ancestorsOf(map, id) {
  const out = [];
  let node = nodeById(map, id);
  while (node && node.parentId) {
    node = nodeById(map, node.parentId);
    if (!node || out.includes(node)) break;
    out.push(node);
  }
  return out;
}
/** A free-standing item: not the root, and not attached to any topic. */
export function isFree(map, nodeOrId) {
  const node = typeof nodeOrId === 'string' ? nodeById(map, nodeOrId) : nodeOrId;
  return !!node && node.id !== map.rootId && !node.parentId;
}
/** The free-standing item (or the root) a node's branch hangs from. */
export function treeTopOf(map, id) {
  let node = nodeById(map, id);
  let guard = 0;
  while (node && node.parentId && guard++ < 500) {
    const up = nodeById(map, node.parentId);
    if (!up) break;
    node = up;
  }
  return node;
}
/** Take a node (and everything under it) off its branch so it stands on its own. */
export function detachNode(map, id) {
  const node = nodeById(map, id);
  if (!node || node.id === map.rootId || !node.parentId) return false;
  node.parentId = '';
  node.side = '';
  node.pinned = false;
  return true;
}
/** Hidden because an ancestor is collapsed. */
export function isHidden(map, id) {
  return ancestorsOf(map, id).some(a => a.collapsed);
}
/** The side (left / right) a node's branch grows on. */
export function sideOf(map, id) {
  const node = nodeById(map, id);
  if (!node || node.id === map.rootId) return 'right';
  let cur = node;
  while (cur && cur.parentId && cur.parentId !== map.rootId) cur = nodeById(map, cur.parentId);
  if (!cur) return 'right';
  // A free-standing item (or anything hanging from one) grows to the right.
  if (!cur.parentId) return 'right';
  if (cur.side) return cur.side;
  const first = childrenOf(map, map.rootId);
  const index = first.findIndex(n => n.id === cur.id);
  return index % 2 === 0 ? 'right' : 'left';
}
/** The branch colour a brand-new child would get. */
export function colorForNewChild(map, parentId) {
  const parent = nodeById(map, parentId);
  if (!parent) return 'white';
  if (parent.id === map.rootId) {
    const used = childrenOf(map, parentId).map(n => n.color);
    return BRANCH_ORDER.find(c => !used.includes(c)) || BRANCH_ORDER[used.length % BRANCH_ORDER.length];
  }
  return parent.color === 'white' ? 'white' : parent.color;
}

/** Remove a node and everything under it, and any link that touched them. Never removes the root. */
export function removeNode(map, id) {
  if (!id || id === map.rootId) return [];
  const gone = [nodeById(map, id), ...descendantsOf(map, id)].filter(Boolean);
  const ids = new Set(gone.map(n => n.id));
  map.nodes = map.nodes.filter(n => !ids.has(n.id));
  map.links = map.links.filter(l => !ids.has(l.from) && !ids.has(l.to));
  return [...ids];
}

/** Move a node under a new parent (refuses to move it under its own descendant). */
export function reparent(map, id, newParentId) {
  if (id === map.rootId || id === newParentId) return false;
  const node = nodeById(map, id);
  const parent = nodeById(map, newParentId);
  if (!node || !parent) return false;
  if (descendantsOf(map, id).some(d => d.id === newParentId)) return false;
  node.parentId = newParentId;
  if (newParentId === map.rootId) node.side = '';
  return true;
}

/* ------------------------------------------------------------------ */
/*  Layout                                                              */
/* ------------------------------------------------------------------ */
export const LAYOUT = { gapX: 70, gapY: 22, defaultW: 160, defaultH: 46 };

/**
 * Tidy up: a classic two-sided mind map. The root sits at (0, 0); its
 * children alternate right / left (or keep the side they were given), and
 * every subtree is stacked so no two branches overlap.
 * `size(node)` → {w, h} is the rendered size (the page measures it).
 * Returns a Map id → {x, y} of node CENTRES. Pinned nodes keep their place.
 */
export function layoutMap(map, size = n => ({ w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH })) {
  const out = new Map();
  const root = nodeById(map, map.rootId);
  if (!root) return out;
  const sz = new Map();
  const getSize = n => {
    if (!sz.has(n.id)) {
      const s = size(n) || {};
      sz.set(n.id, { w: Math.max(40, num(s.w, LAYOUT.defaultW)), h: Math.max(24, num(s.h, LAYOUT.defaultH)) });
    }
    return sz.get(n.id);
  };
  const visibleChildren = n => n.collapsed ? [] : childrenOf(map, n.id);
  const heights = new Map();
  const subtreeHeight = n => {
    if (heights.has(n.id)) return heights.get(n.id);
    const kids = visibleChildren(n);
    const own = getSize(n).h;
    const kidsHeight = kids.reduce((sum, k) => sum + subtreeHeight(k), 0) + Math.max(0, kids.length - 1) * LAYOUT.gapY;
    const h = Math.max(own, kidsHeight);
    heights.set(n.id, h);
    return h;
  };
  const place = (n, x, centerY, direction) => {
    out.set(n.id, { x, y: centerY });
    const kids = visibleChildren(n);
    if (!kids.length) return;
    const total = kids.reduce((sum, k) => sum + subtreeHeight(k), 0) + (kids.length - 1) * LAYOUT.gapY;
    let top = centerY - total / 2;
    const parentW = getSize(n).w;
    for (const k of kids) {
      const h = subtreeHeight(k);
      const kw = getSize(k).w;
      const kx = x + direction * (parentW / 2 + LAYOUT.gapX + kw / 2);
      place(k, kx, top + h / 2, direction);
      top += h + LAYOUT.gapY;
    }
  };
  out.set(root.id, { x: 0, y: 0 });
  const first = visibleChildren(root);
  const right = [], left = [];
  first.forEach((k, i) => {
    const side = k.side || (i % 2 === 0 ? 'right' : 'left');
    (side === 'left' ? left : right).push(k);
  });
  // Keep the two sides roughly the same height when nothing was pinned to a side.
  const sideHeight = list => list.reduce((s, k) => s + subtreeHeight(k), 0) + Math.max(0, list.length - 1) * LAYOUT.gapY;
  const stack = (list, direction) => {
    const total = sideHeight(list);
    let top = -total / 2;
    const rootW = getSize(root).w;
    for (const k of list) {
      const h = subtreeHeight(k);
      const kw = getSize(k).w;
      place(k, direction * (rootW / 2 + LAYOUT.gapX * 1.4 + kw / 2), top + h / 2, direction);
      top += h + LAYOUT.gapY;
    }
  };
  stack(right, 1);
  stack(left, -1);
  // Free-standing items stay exactly where they were put; whatever hangs from one is tidied around it.
  for (const n of map.nodes) {
    if (!isFree(map, n)) continue;
    place(n, num(n.x), num(n.y), 1);
  }
  for (const n of map.nodes) if (n.pinned && out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

/** Where a brand-new child of `parentId` should first appear (before any tidy-up). */
export function spotForNewChild(map, parentId, size = { w: LAYOUT.defaultW, h: LAYOUT.defaultH }) {
  const parent = nodeById(map, parentId);
  if (!parent) return { x: 0, y: 0 };
  const side = parent.id === map.rootId
    ? (childrenOf(map, parent.id).length % 2 === 0 ? 'right' : 'left')
    : sideOf(map, parent.id);
  const dir = side === 'left' ? -1 : 1;
  const kids = childrenOf(map, parentId).filter(k => parent.id !== map.rootId || (k.side || sideOf(map, k.id)) === side);
  const pw = parent.w || LAYOUT.defaultW;
  const x = parent.x + dir * (pw / 2 + LAYOUT.gapX + size.w / 2);
  if (!kids.length) return { x, y: parent.y, side };
  const lowest = kids.reduce((m, k) => Math.max(m, k.y + (k.h || LAYOUT.defaultH) / 2), -Infinity);
  return { x, y: lowest + LAYOUT.gapY + size.h / 2, side };
}

/** The bounding box of the visible nodes (world units). */
export function boundsOf(map, ids) {
  const list = map.nodes.filter(n => (!ids || ids.includes(n.id)) && !isHidden(map, n.id));
  if (!list.length) return { minX: -200, minY: -150, maxX: 200, maxY: 150 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of list) {
    const w = n.w || LAYOUT.defaultW, h = n.h || LAYOUT.defaultH;
    minX = Math.min(minX, n.x - w / 2); maxX = Math.max(maxX, n.x + w / 2);
    minY = Math.min(minY, n.y - h / 2); maxY = Math.max(maxY, n.y + h / 2);
  }
  return { minX, minY, maxX, maxY };
}

/** A view that fits `bounds` in a viewport of vw × vh pixels. */
export function fitView(bounds, vw, vh, padding = 60, maxZoom = 1.4) {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(Math.min((vw - padding * 2) / bw, (vh - padding * 2) / bh), 0.1, maxZoom);
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom };
}

/** The curved branch between a parent and a child (SVG path data, world units). */
export function branchPath(from, to) {
  const fw = (from.w || LAYOUT.defaultW) / 2;
  const tw = (to.w || LAYOUT.defaultW) / 2;
  const dir = to.x >= from.x ? 1 : -1;
  const x1 = from.x + dir * fw, y1 = from.y;
  const x2 = to.x - dir * tw, y2 = to.y;
  const mid = (x2 - x1) * 0.5;
  return `M ${round(x1)} ${round(y1)} C ${round(x1 + mid)} ${round(y1)}, ${round(x2 - mid)} ${round(y2)}, ${round(x2)} ${round(y2)}`;
}
/** A free connection: an arc between two box edges. */
export function linkPath(from, to) {
  const a = edgePoint(from, to), b = edgePoint(to, from);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const bend = 0.18;
  const cx = mx - dy * bend, cy = my + dx * bend;
  return { d: `M ${round(a.x)} ${round(a.y)} Q ${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`, mid: { x: round((a.x + 2 * cx + b.x) / 4), y: round((a.y + 2 * cy + b.y) / 4) }, end: b, control: { x: cx, y: cy } };
}
function edgePoint(box, toward) {
  const w = (box.w || LAYOUT.defaultW) / 2, h = (box.h || LAYOUT.defaultH) / 2;
  const dx = toward.x - box.x, dy = toward.y - box.y;
  if (!dx && !dy) return { x: box.x, y: box.y };
  const sx = dx ? w / Math.abs(dx) : Infinity;
  const sy = dy ? h / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: box.x + dx * s, y: box.y + dy * s };
}
const round = v => Math.round(v * 10) / 10;

/* ------------------------------------------------------------------ */
/*  Undo / redo                                                         */
/* ------------------------------------------------------------------ */
export class History {
  constructor(limit = LIMITS.history) { this.limit = limit; this.past = []; this.future = []; }
  push(snapshot) {
    const s = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
    if (this.past[this.past.length - 1] === s) return false;
    this.past.push(s);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current) {
    if (!this.past.length) return null;
    const prev = this.past.pop();
    this.future.push(typeof current === 'string' ? current : JSON.stringify(current));
    return JSON.parse(prev);
  }
  redo(current) {
    if (!this.future.length) return null;
    const next = this.future.pop();
    this.past.push(typeof current === 'string' ? current : JSON.stringify(current));
    return JSON.parse(next);
  }
  clear() { this.past = []; this.future = []; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

/* ------------------------------------------------------------------ */
/*  Saving                                                              */
/* ------------------------------------------------------------------ */
/** What is written to Firestore (no measured sizes of hidden things, no undefined). */
export function serializeMap(map) {
  const clean = normalizeMap(map);
  return JSON.parse(JSON.stringify(clean));
}
export function mapBytes(map) {
  try { return new TextEncoder().encode(JSON.stringify(map)).length; }
  catch (e) { return JSON.stringify(map).length; }
}

/** The map as Markdown (an outline), for copy / export. */
export function mapToOutline(map) {
  const lines = ['# ' + (map.title || 'Mind map')];
  const walk = (node, depth) => {
    const pad = '  '.repeat(Math.max(0, depth - 1));
    const label = nodeLabel(node);
    if (depth > 0) lines.push(pad + '- ' + label);
    for (const child of childrenOf(map, node.id)) walk(child, depth + 1);
  };
  const root = nodeById(map, map.rootId);
  if (root) {
    lines.push('', '**' + nodeLabel(root) + '**', '');
    for (const child of childrenOf(map, root.id)) walk(child, 1);
  }
  const free = map.nodes.filter(n => isFree(map, n));
  if (free.length) {
    lines.push('', '## On their own');
    for (const n of free) walk(n, 1);
  }
  if (map.links.length) {
    lines.push('', '## Connections');
    for (const l of map.links) {
      const a = nodeById(map, l.from), b = nodeById(map, l.to);
      if (a && b) lines.push('- ' + nodeLabel(a) + ' → ' + nodeLabel(b) + (l.label ? ' (' + l.label + ')' : ''));
    }
  }
  return lines.join('\n');
}
export function nodeLabel(node) {
  if (!node) return '';
  switch (node.type) {
    case 'image': return '🖼 ' + (node.text || node.image?.alt || node.image?.prompt || 'Picture');
    case 'code': return '💻 ' + (node.code?.title || node.text || 'Learning app');
    case 'question': return '❓ ' + (node.question?.title || node.text || 'Question');
    case 'note': return '📝 ' + (node.text || htmlToText(node.note).slice(0, 60) || 'Note');
    default: return node.text || 'Topic';
  }
}

/* ------------------------------------------------------------------ */
/*  Tolerant JSON parse for model output (same rules as the cer app)   */
/* ------------------------------------------------------------------ */
export function parseAiJson(raw) {
  let s = str(raw).trim();
  if (!s) throw new Error('The AI sent back nothing. Please try again.');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.search(/[\[{]/);
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s); }
  catch (firstErr) {
    try { return JSON.parse(repairAiJson(s)); }
    catch (_) { throw new Error('The AI reply could not be read. Please try again.'); }
  }
}
export function repairAiJson(s) {
  s = str(s);
  let out = '', inString = false, escaped = false;
  const closers = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && ' \t\r\n'.includes(s[j])) j++;
        const nxt = j < s.length ? s[j] : '';
        let close = false;
        if (!nxt || ':}]'.includes(nxt)) close = true;
        else if (nxt === ',') {
          let k = j + 1;
          while (k < s.length && ' \t\r\n'.includes(s[k])) k++;
          close = k >= s.length || '"{[}]-0123456789'.includes(s[k]) || /^(true|false|null)\b/.test(s.slice(k, k + 6));
        }
        if (close) { out += ch; inString = false; } else out += '\\"';
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch; continue;
    }
    if (ch === '"') { out += ch; inString = true; continue; }
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if ((ch === '}' || ch === ']') && closers[closers.length - 1] === ch) closers.pop();
    out += ch;
  }
  if (inString) out += '"';
  out = out.replace(/([{,]\s*)"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1').replace(/,\s*$/, '');
  while (closers.length) out += closers.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** A model asked for a page often wraps it in a fence or says a sentence first: keep the document. */
export function extractHtmlDocument(text) {
  let t = str(text).trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence && /<(?:!doctype|html|body|div|svg|script|canvas|main)/i.test(fence[1])) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) t = t.slice(0, end + 7);
  if (!/<(?:html|body|div|svg|canvas|main|section)[\s>]/i.test(t)) return '';
  return t.slice(0, LIMITS.codePart);
}

/* ------------------------------------------------------------------ */
/*  Code windows: the sandbox document                                   */
/* ------------------------------------------------------------------ */
/**
 * Join HTML / CSS / JS into one document for a sandboxed iframe.
 * • A full page pasted into HTML is used as it is (CSS goes before </head>,
 *   JS before </body>).
 * • Plain JS pasted into the HTML box (no tags at all) is treated as JS.
 * • The console bridge posts console output and errors to the parent, tagged
 *   with `channel`, so the window can show them under the app. The parent
 *   only trusts messages whose source is that iframe's own window.
 */
export function buildSandboxDoc(code, { channel = '', bridge = true } = {}) {
  const c = normalizeCode(code);
  let html = c.html, css = c.css, js = c.js;
  const looksLikeTags = /<[a-z!][\s\S]*>/i.test(html);
  if (html.trim() && !looksLikeTags && /[;{}()=]/.test(html) && !js.trim()) { js = html; html = ''; }
  const bridgeScript = bridge ? `<script>(function(){var ch=${JSON.stringify(str(channel))};function send(kind,args){try{parent.postMessage({mindmapConsole:ch,kind:kind,text:Array.prototype.map.call(args,function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' ').slice(0,2000)},'*')}catch(e){}}['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);try{o.apply(console,arguments)}catch(e){}}});window.addEventListener('error',function(e){send('error',[e.message+(e.lineno?' (line '+e.lineno+')':'')])});window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise: '+(e.reason&&e.reason.message||e.reason)])});function size(){try{var h=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0);parent.postMessage({mindmapConsole:ch,kind:'size',height:h},'*')}catch(e){}}window.addEventListener('load',function(){size();setTimeout(size,400)});})();<\/script>` : '';
  const baseStyle = '<style>html,body{margin:0;font-family:"Century Gothic",CenturyGothic,AppleGothic,sans-serif;color:#1A1A1A;background:#fff}body{padding:12px;box-sizing:border-box}*,*::before,*::after{box-sizing:inherit}</style>';
  const cssTag = css.trim() ? '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>' : '';
  const jsTag = js.trim() ? '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n<\/script>' : '';
  const isFullDoc = /<!doctype html|<html[\s>]/i.test(html);
  if (isFullDoc) {
    let doc = html;
    const headInject = bridgeScript + cssTag;
    if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, m => m + headInject);
    else doc = doc.replace(/<html[^>]*>/i, m => m + '<head>' + headInject + '</head>');
    if (jsTag) {
      if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, jsTag + '</body>');
      else doc += jsTag;
    }
    return doc;
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    bridgeScript + baseStyle + cssTag + '</head><body>' + html + jsTag + '</body></html>';
}

/** The attributes every code window's iframe carries. No allow-same-origin: the app can never reach the page, its sign-in or its data. */
export const SANDBOX_FLAGS = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';

/* ------------------------------------------------------------------ */
/*  The question bank                                                    */
/* ------------------------------------------------------------------ */
/* The Science app's default topic → level map (app.js topicLevelMap). The
   teacher's custom topics (users/{admin}/settings/topics → custom) are laid
   over it on load. */
export const TOPIC_LEVELS = {
  'Living and non-living things': 'P3', 'Materials': 'P3', 'Life Cycles': 'P3', 'Magnets': 'P3',
  'Plant Systems': 'P4', 'Human Body Systems': 'P4', 'Matter and its 3 States': 'P4', 'Light': 'P4', 'Heat': 'P4',
  'Water and its 3 States': 'P5', 'Plant Reproduction': 'P5', 'Human Reproduction': 'P5',
  'Human and Plant Respiration': 'P5', 'Human and Plant Transport': 'P5', 'Electrical Systems': 'P5',
  'Forces': 'P6', 'Energy in Food': 'P6', 'Energy Conversion': 'P6',
  'Living Together': 'P6', 'Food Chains and Webs': 'P6', 'Humans and the Environment': 'P6',
  'The Scientific Endeavour': 'S1', 'Measurement and Lab Skills': 'S1',
  'Diversity of Matter — Physical Properties': 'S1', 'Diversity of Matter — Chemical Composition': 'S1',
  'Separation Techniques': 'S1', 'Particulate Nature of Matter': 'S1',
  'Atoms and Molecules': 'S1', 'Cells — The Basic Unit of Life': 'S1',
  'Ray Model of Light': 'S1', 'Forces and Their Effects': 'S1'
};
export const BANK_LEVELS = ['P3', 'P4', 'P5', 'P6'];
const LEVEL_RANK = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6, S1: 7, S2: 8, S3: 9, S4: 10, S5: 11 };
export function levelRank(level) { return LEVEL_RANK[str(level).trim().toUpperCase()] || 0; }

/** A question's level: the highest level of the topics it is filed under (the cer rule), or its own `level`. */
export function questionLevel(q, topicLevels = TOPIC_LEVELS) {
  if (!q) return '';
  const lookup = new Map(Object.entries(topicLevels || {}).map(([k, v]) => [k.trim().toLowerCase(), str(v).toUpperCase()]));
  const levels = [];
  for (const t of [q.topic, q.topic2].map(str).filter(Boolean)) {
    const lv = lookup.get(t.trim().toLowerCase());
    if (lv) levels.push(lv);
  }
  if (!levels.length && levelRank(q.level)) levels.push(str(q.level).toUpperCase());
  if (!levels.length) return '';
  return levels.sort((a, b) => levelRank(b) - levelRank(a))[0];
}

/** Singapore's calendar day, 'YYYY-MM-DD' (what q.releaseOn is written in). */
export function singaporeDay(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 3600000);
  return t.toISOString().slice(0, 10);
}

/**
 * May this question be shown to a student? The same gates as the cer app's
 * student pools: not held back, not scheduled for later, in syllabus, not a
 * retired topic, and not Secondary 1 (retired in cer v1.453.0).
 */
export function questionServable(q, { today = singaporeDay(), topicLevels = TOPIC_LEVELS } = {}) {
  if (!q || !q.id || !Array.isArray(q.blocks) || !q.blocks.length) return false;
  if (q.holdBack === true) return false;
  if (typeof q.releaseOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.releaseOn) && q.releaseOn > today) return false;
  if (q.notInSyllabus === true) return false;
  if (/cell\s*systems?/i.test(str(q.topic) + ' ' + str(q.topic2))) return false;
  if (questionLevel(q, topicLevels) === 'S1' || str(q.level).toUpperCase() === 'S1') return false;
  if (q.status && /^(draft|vetting|rejected|deleted)$/i.test(str(q.status))) return false;
  return true;
}

/** Is the question multiple choice? */
export function questionIsMcq(q) {
  return !!(q && Array.isArray(q.blocks) && q.blocks.some(b => b && b.type === 'mcq'));
}

/** Everything a search box should find a question by. */
export function questionSearchText(q) {
  if (!q) return '';
  const parts = [q.title, q.topic, q.topic2, q.category, q.category2, q.source, q.year, q.id];
  for (const b of Array.isArray(q.blocks) ? q.blocks : []) {
    if (!b) continue;
    if (b.type === 'text' || b.type === 'part') parts.push(htmlToText(b.content));
    if (b.type === 'fillblank') parts.push(str(b.text).replace(/\[\[|\]\]/g, ''));
    if (b.type === 'mcq') for (const o of Array.isArray(b.options) ? b.options : []) parts.push(htmlToText(o && o.text));
  }
  if (Array.isArray(q.tags)) parts.push(q.tags.join(' '));
  return parts.map(str).join(' ').toLowerCase();
}

/** The first line of a question, for a tile / list row. */
export function questionHeadline(q, max = 160) {
  if (!q) return '';
  for (const b of Array.isArray(q.blocks) ? q.blocks : []) {
    if (b && (b.type === 'text' || b.type === 'part')) {
      const t = htmlToText(b.content);
      if (t) return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }
    if (b && b.type === 'fillblank') {
      const t = str(b.text).replace(/\[\[[\s\S]*?\]\]/g, '____');
      if (t) return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }
  }
  return str(q.title) || 'Question';
}
export function questionFirstImage(q) {
  for (const b of Array.isArray(q && q.blocks) ? q.blocks : []) if (b && b.type === 'image' && /^https:\/\//i.test(str(b.url))) return b.url;
  return '';
}

/** Firestore stores table rows as {"0": {"0": ..}}; turn them back into arrays. */
export function tableRows(data) {
  if (Array.isArray(data)) return data.map(r => Array.isArray(r) ? r : Object.keys(r || {}).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b).map(k => r[k]));
  if (data && typeof data === 'object') {
    return Object.keys(data).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b).map(r => {
      const row = data[r] || {};
      if (Array.isArray(row)) return row;
      const keys = Object.keys(row).filter(k => /^\d+$/.test(k)).map(Number);
      const width = keys.length ? Math.max(...keys) + 1 : 0;
      return Array.from({ length: width }, (_, c) => row[c] == null ? '' : row[c]);
    });
  }
  return [];
}

/** The copy of a bank question kept on a question node (only what it draws). */
export function questionSnapshot(q, topicLevels = TOPIC_LEVELS) {
  const blocks = (Array.isArray(q.blocks) ? q.blocks : []).map(b => {
    if (b && b.type === 'table') return { ...b, data: tableRows(b.data) };
    return b;
  }).map(normalizeSnapshotBlock).filter(Boolean);
  return normalizeQuestion({
    qid: q.id, title: q.title || questionHeadline(q, 90), topic: q.topic || '', level: questionLevel(q, topicLevels),
    category: q.category || '', marks: q.marks == null ? '' : String(q.marks), blocks, width: 380
  });
}

/** The levels (P3–P6) a student may pick questions from: their approved Science children's levels. */
export function allowedBankLevels({ staff = false, pairs = [] } = {}) {
  if (staff) return BANK_LEVELS.slice();
  const out = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || !Array.isArray(p.subjects) || !p.subjects.includes('science')) continue;
    const lv = str(p.level).toUpperCase();
    if (BANK_LEVELS.includes(lv)) out.add(lv);
    // Secondary children see the top of the primary bank (cer serves a Sec account at P6).
    if (levelRank(lv) > 6) out.add('P6');
  }
  // A child may practise earlier levels too, as the cer app's level band allows.
  const top = Math.max(0, ...[...out].map(levelRank));
  return BANK_LEVELS.filter(lv => levelRank(lv) <= top);
}

/** Filter + sort the bank for the picker. */
export function filterQuestions(list, { search = '', topic = '', level = '', kind = '', levels = BANK_LEVELS, topicLevels = TOPIC_LEVELS, sort = 'newest' } = {}) {
  const words = str(search).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const q of Array.isArray(list) ? list : []) {
    const lv = questionLevel(q, topicLevels);
    if (levels && levels.length && lv && !levels.includes(lv)) continue;
    if (levels && levels.length && !lv && levels.length < BANK_LEVELS.length) continue;
    if (level && lv !== level) continue;
    if (topic && str(q.topic) !== topic && str(q.topic2) !== topic) continue;
    if (kind === 'mcq' && !questionIsMcq(q)) continue;
    if (kind === 'open' && questionIsMcq(q)) continue;
    if (kind === 'picture' && !questionFirstImage(q)) continue;
    if (words.length) {
      const hay = q._search || (q._search = questionSearchText(q));
      if (!words.every(w => hay.includes(w))) continue;
    }
    out.push(q);
  }
  const time = q => {
    const v = q.createdAt;
    if (typeof v === 'number') return v;
    if (v && typeof v.seconds === 'number') return v.seconds * 1000;
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    return Date.parse(v || '') || 0;
  };
  if (sort === 'newest') out.sort((a, b) => time(b) - time(a));
  else if (sort === 'topic') out.sort((a, b) => str(a.topic).localeCompare(str(b.topic)) || levelRank(questionLevel(a, topicLevels)) - levelRank(questionLevel(b, topicLevels)));
  else if (sort === 'level') out.sort((a, b) => levelRank(questionLevel(a, topicLevels)) - levelRank(questionLevel(b, topicLevels)) || str(a.topic).localeCompare(str(b.topic)));
  return out;
}

/* ------------------------------------------------------------------ */
/*  AI: describing the map, and the operations a command becomes        */
/* ------------------------------------------------------------------ */
/** A compact outline of the map for the AI (ids included so it can point at nodes). */
export function describeMapForAi(map, selectedId = '', maxNodes = 160) {
  const lines = [];
  let count = 0;
  const walk = (node, depth) => {
    if (count >= maxNodes) return;
    count++;
    let extra = '';
    if (node.type === 'code') extra = ' [app: ' + (node.code?.title || '') + ']';
    if (node.type === 'image') extra = ' [picture]';
    if (node.type === 'question') extra = ' [question ' + (node.question?.topic || '') + ']';
    if (node.type === 'note') extra = ' [note]';
    lines.push('  '.repeat(depth) + '- (' + node.id + ') ' + clip(nodeLabel(node).replace(/\s+/g, ' '), 90) + extra + (node.id === selectedId ? '   <== SELECTED' : ''));
    for (const child of childrenOf(map, node.id)) walk(child, depth + 1);
  };
  const root = nodeById(map, map.rootId);
  if (root) walk(root, 0);
  const free = map.nodes.filter(n => isFree(map, n));
  if (free.length && count < maxNodes) {
    lines.push('FREE-STANDING (not attached to any topic):');
    for (const n of free) walk(n, 1);
  }
  if (count >= maxNodes) lines.push('  … (' + (map.nodes.length - count) + ' more nodes not shown)');
  const links = map.links.slice(0, 40).map(l => '  ' + l.from + ' -> ' + l.to + (l.label ? ' "' + l.label + '"' : ''));
  return 'MAP TITLE: ' + map.title + '\nROOT: ' + map.rootId + '\nSELECTED: ' + (selectedId || 'none') +
    '\nNODES (indented = child of the line above it):\n' + lines.join('\n') + (links.length ? '\nCONNECTIONS:\n' + links.join('\n') : '');
}

/** The operations the AI may ask for. */
export const OP_TYPES = ['add_topic', 'add_note', 'rename', 'recolor', 'delete', 'connect', 'move', 'collapse', 'expand',
  'add_image', 'build_app', 'update_app', 'add_questions', 'set_title', 'select', 'tidy', 'focus'];

export function voiceSystemPrompt({ topicNames = [], levels = BANK_LEVELS } = {}) {
  return [
    'You are the live voice builder inside Polymath Mind Map, a mind-mapping tool for Singapore primary-school students and their teachers.',
    'A person is TALKING to you. Each message is what they just said (speech-to-text, so expect small mistakes and filler words) plus the current map.',
    'Turn what they said into edits to the map. Reply with ONE JSON object and nothing else:',
    '{"say": "<one short friendly sentence describing what you did, or a question back if you truly cannot tell>", "ops": [ ... ]}',
    '',
    'Operations (use "ref" to name a node you create so later ops in the same reply can point at it, e.g. "ref":"a1"; point at existing nodes by their id in brackets):',
    '{"op":"add_topic","ref":"a1","parent":"<id or ref, default the SELECTED node or the root>","text":"<2-6 words>","color":"blue|green|orange|purple|coral|teal|yellow|gray|white (optional)"}',
    '{"op":"add_note","ref":"n1","parent":"<id or ref>","text":"<title>","note":"<1-4 sentences of explanation>"}',
    '{"op":"rename","node":"<id or ref>","text":"<new text>"}',
    '{"op":"recolor","node":"<id or ref>","color":"<colour>"}',
    '{"op":"delete","node":"<id>"}',
    '{"op":"connect","from":"<id or ref>","to":"<id or ref>","label":"<optional 1-3 words>"}',
    '{"op":"move","node":"<id>","parent":"<new parent id or ref>"}',
    '{"op":"collapse","node":"<id>"}  {"op":"expand","node":"<id>"}',
    '{"op":"add_image","ref":"p1","parent":"<id or ref>","prompt":"<a clear description of a simple, child-friendly educational picture to draw>","caption":"<2-5 words>"}',
    '{"op":"build_app","ref":"c1","parent":"<id or ref>","title":"<app name>","description":"<what the interactive learning app should do, detailed enough for a developer>"}',
    '{"op":"update_app","node":"<id of an existing app node>","change":"<the change the person asked for, in detail>"}',
    '{"op":"add_questions","parent":"<id or ref, or none to place them on their own>","search":"<keywords>","topic":"<one of the topic names below, optional>","level":"<' + levels.join('|') + ', optional>","count":<1-6>}',
    '{"op":"set_title","text":"<map title>"}',
    '{"op":"select","node":"<id or ref>"}',
    '{"op":"tidy"}  (re-arrange the whole map neatly)',
    '',
    'Rules:',
    '- Keep topic texts SHORT (2-6 words). Put longer explanations in add_note.',
    '- "Add three ideas about X" means three add_topic ops. Build whole branches at once when asked ("make a mind map about photosynthesis" → a central topic rename/set_title plus 4-6 branches with 2-4 children each).',
    '- If they ask for a picture / drawing / diagram / image, use add_image. If they ask for an app, game, simulation, quiz, interactive or "something I can play with", use build_app. If an app node is SELECTED and they ask to change it ("make it bigger", "add a reset button"), use update_app on it.',
    '- If they ask for questions / practice / exam questions, use add_questions. If they want questions on their own (not under a topic), use "parent":"none".',
    '- "Here", "this", "it" usually mean the SELECTED node.',
    '- Science content must be correct for the Singapore primary science syllabus. Use British spelling.',
    '- Never more than ' + LIMITS.opsPerCommand + ' ops. If nothing should change (they were just thinking aloud), return "ops": [] and a short "say".',
    topicNames.length ? '- Question bank topics: ' + topicNames.slice(0, 60).join('; ') : ''
  ].filter(Boolean).join('\n');
}

export function voiceUserPrompt(map, selectedId, transcript, recent = []) {
  return describeMapForAi(map, selectedId) +
    (recent.length ? '\n\nEARLIER IN THIS CONVERSATION:\n' + recent.slice(-6).map(r => '- They said: ' + clip(r.said, 300) + (r.reply ? '\n  You did: ' + clip(r.reply, 200) : '')).join('\n') : '') +
    '\n\nTHEY JUST SAID: "' + clip(transcript, 3000).replace(/"/g, "'") + '"';
}

export function expandPrompt(map, nodeId, count = 5) {
  const node = nodeById(map, nodeId);
  const path = [...ancestorsOf(map, nodeId)].reverse().map(nodeLabel).concat(nodeLabel(node)).join(' > ');
  const existing = childrenOf(map, nodeId).map(nodeLabel);
  return [
    'You are helping a Singapore primary-school student (or their teacher) build a mind map.',
    'Map: ' + map.title,
    'Branch: ' + path,
    existing.length ? 'It already has: ' + existing.join('; ') : 'It has no sub-ideas yet.',
    'Suggest ' + count + ' NEW sub-ideas for "' + nodeLabel(node) + '" that are correct for the Singapore primary syllabus, each 2-6 words, and for each a one-sentence explanation a 10-year-old understands.',
    'Reply with JSON only: {"ideas":[{"text":"...","note":"..."}]}'
  ].join('\n');
}

export function mapFromTopicPrompt(topic, level = '') {
  return [
    'Build a complete, well-organised mind map about: "' + clip(topic, 300) + '"' + (level ? ' for a ' + level + ' student in Singapore' : ' for a Singapore primary-school student') + '.',
    'Use 4 to 7 main branches, each with 2 to 5 short sub-ideas (2-6 words each). Facts must be correct for the Singapore primary science / maths syllabus where relevant. British spelling.',
    'Reply with JSON only: {"title":"...","branches":[{"text":"...","children":[{"text":"...","children":[{"text":"..."}]}]}]}'
  ].join('\n');
}

export const APP_SYSTEM = 'You are an expert front-end developer and a Singapore primary-school teacher. You write ONE complete, self-contained, interactive HTML page for learning, and nothing else.';

export function appBuildPrompt({ title = '', description = '', context = '' } = {}) {
  return [
    'Build a small interactive learning app.',
    'Title: ' + clip(title, 120),
    'What it must do: ' + clip(description, 6000),
    context ? 'Where it sits in the mind map: ' + clip(context, 600) : '',
    '',
    'Rules for the page:',
    '- One complete HTML document (<!doctype html> … </html>) with all CSS and JavaScript inline. No external scripts, fonts, images or network requests of any kind (draw with SVG / canvas / CSS).',
    '- It runs in a sandboxed iframe about 420 x 360 pixels that may be resized: make it responsive and readable from 300px wide up.',
    '- Style: light and minimal, white background, font-family "Century Gothic", CenturyGothic, AppleGothic, sans-serif; soft pastel accents (#BBDEFB, #C8E6C9, #FFE0B2); rounded corners; gentle shadows; large tap targets.',
    '- It must be interactive (sliders, buttons, drag, inputs) and give instant visual feedback. Include a short one-line instruction at the top.',
    '- Content must be correct for the Singapore primary syllabus. British spelling.',
    '- Do not use localStorage, sessionStorage, cookies, alert(), prompt() or confirm().',
    '- Reply with the HTML document only.'
  ].filter(Boolean).join('\n');
}

export function appUpdatePrompt({ title = '', change = '', html = '' } = {}) {
  return [
    'Here is a small interactive learning app ("' + clip(title, 120) + '"). Change it as asked and return the WHOLE updated HTML document.',
    'The change: ' + clip(change, 4000),
    'Keep everything else working. Same rules: one self-contained HTML document, no external resources or network, no storage, no alert/prompt/confirm, light Polymath style, British spelling.',
    'Reply with the HTML document only.',
    '',
    '--- CURRENT APP ---',
    clip(html, 120000)
  ].join('\n');
}

export function imagePrompt(prompt, style = 'illustration') {
  const styles = {
    illustration: 'A clean, friendly educational illustration for a Singapore primary-school science or maths mind map. Soft pastel colours, white background, clear shapes, no clutter.',
    diagram: 'A clear labelled educational diagram on a white background, like a textbook figure for a Singapore primary-school student. Simple flat colours, neat thin lines, readable labels.',
    sketch: 'A simple black-and-white line drawing on a white background, like a teacher\'s whiteboard sketch.',
    photo: 'A realistic, well-lit photograph suitable for a primary-school learning resource.',
    icon: 'A single simple flat icon on a plain white background, pastel colours, no text.'
  };
  return (styles[style] || styles.illustration) + ' Subject: ' + clip(prompt, 1500) + '. Correct science; British spelling for any labels; nothing scary or unsuitable for children.';
}

/**
 * Apply AI operations to the map. Pure: async work (pictures, apps,
 * questions) is not done here; it is RETURNED as `jobs` for the page to run,
 * each pointing at the node it fills (a placeholder is created for pictures
 * and apps so the person sees where they will appear).
 *
 * Returns { created: [ids], changed: [ids], removed: [ids], jobs: [], select, tidy, errors: [] }.
 */
export function applyOps(map, ops, { selectedId = '', size } = {}) {
  const result = { created: [], changed: [], removed: [], jobs: [], select: '', tidy: false, errors: [] };
  const refs = new Map();
  const resolve = value => {
    const v = str(value).trim().replace(/^\(|\)$/g, '');
    if (!v) return '';
    if (refs.has(v)) return refs.get(v);
    if (nodeById(map, v)) return v;
    // The model sometimes names a node by its text instead of its id.
    const lower = v.toLowerCase();
    const byText = map.nodes.find(n => str(n.text).toLowerCase() === lower);
    return byText ? byText.id : '';
  };
  const fallbackParent = () => (selectedId && nodeById(map, selectedId) ? selectedId : map.rootId);
  const addNode = (parentId, fields) => {
    if (map.nodes.length >= LIMITS.nodes) { result.errors.push('The map is full (' + LIMITS.nodes + ' items).'); return null; }
    const parent = nodeById(map, parentId) || nodeById(map, map.rootId);
    const spot = spotForNewChild(map, parent.id, size ? size(fields) : undefined);
    const node = normalizeNode({ id: makeId('n'), parentId: parent.id, x: spot.x, y: spot.y,
      color: fields.color && COLOR_IDS.includes(fields.color) ? fields.color : colorForNewChild(map, parent.id),
      shape: 'rounded', ...fields });
    if (!node) return null;
    if (parent.id === map.rootId && spot.side) node.side = spot.side;
    if (parent.collapsed) parent.collapsed = false;
    map.nodes.push(node);
    result.created.push(node.id);
    return node;
  };
  const list = (Array.isArray(ops) ? ops : []).slice(0, LIMITS.opsPerCommand);
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const op = str(raw.op).toLowerCase();
    try {
      switch (op) {
        case 'add_topic': {
          const text = clip(raw.text, LIMITS.text).trim();
          if (!text) break;
          const node = addNode(resolve(raw.parent) || fallbackParent(), { type: 'topic', text, color: raw.color });
          if (node && raw.ref) refs.set(str(raw.ref), node.id);
          break;
        }
        case 'add_note': {
          const node = addNode(resolve(raw.parent) || fallbackParent(), { type: 'note', text: clip(raw.text, 120), note: clip(raw.note || raw.text, LIMITS.note), color: 'yellow' });
          if (node && raw.ref) refs.set(str(raw.ref), node.id);
          break;
        }
        case 'rename': {
          const id = resolve(raw.node);
          const node = nodeById(map, id);
          const text = clip(raw.text, LIMITS.text).trim();
          if (node && text) {
            if (node.type === 'code') node.code.title = clip(text, 120);
            node.text = text;
            result.changed.push(id);
          }
          break;
        }
        case 'recolor': {
          const node = nodeById(map, resolve(raw.node));
          if (node && COLOR_IDS.includes(raw.color)) { node.color = raw.color; result.changed.push(node.id); }
          break;
        }
        case 'delete': {
          const id = resolve(raw.node);
          if (id && id !== map.rootId) result.removed.push(...removeNode(map, id));
          break;
        }
        case 'connect': {
          const from = resolve(raw.from), to = resolve(raw.to);
          if (from && to && from !== to && !map.links.some(l => l.from === from && l.to === to) && map.links.length < LIMITS.links) {
            map.links.push({ id: makeId('l'), from, to, label: clip(raw.label, 80) });
          }
          break;
        }
        case 'move': {
          const id = resolve(raw.node), parent = resolve(raw.parent);
          if (reparent(map, id, parent)) { result.changed.push(id); result.tidy = true; }
          break;
        }
        case 'collapse': case 'expand': {
          const node = nodeById(map, resolve(raw.node));
          if (node) { node.collapsed = op === 'collapse'; result.changed.push(node.id); result.tidy = true; }
          break;
        }
        case 'add_image': {
          const prompt = clip(raw.prompt || raw.description || raw.text, 1500).trim();
          if (!prompt) break;
          const node = addNode(resolve(raw.parent) || fallbackParent(), { type: 'image', text: clip(raw.caption || '', 120), image: { url: '', prompt, alt: clip(raw.caption || prompt, 300) }, color: 'white' });
          if (node) {
            if (raw.ref) refs.set(str(raw.ref), node.id);
            result.jobs.push({ kind: 'image', nodeId: node.id, prompt, style: raw.style || 'illustration' });
          }
          break;
        }
        case 'build_app': {
          const description = clip(raw.description || raw.text, 6000).trim();
          if (!description) break;
          const title = clip(raw.title || 'Learning app', 120);
          const node = addNode(resolve(raw.parent) || fallbackParent(), { type: 'code', text: title, code: { title, html: '', css: '', js: '', prompt: description }, color: 'white' });
          if (node) {
            if (raw.ref) refs.set(str(raw.ref), node.id);
            result.jobs.push({ kind: 'build_app', nodeId: node.id, title, description });
          }
          break;
        }
        case 'update_app': {
          const node = nodeById(map, resolve(raw.node) || selectedId);
          const change = clip(raw.change || raw.text, 4000).trim();
          if (node && node.type === 'code' && change) result.jobs.push({ kind: 'update_app', nodeId: node.id, change });
          else if (change) result.errors.push('Select an app window first, then say what to change.');
          break;
        }
        case 'add_questions': {
          // "on their own" / parent "none": free-standing question cards, attached to nothing.
          const free = raw.free === true || /^(none|free|own|on their own|no parent)$/i.test(str(raw.parent).trim());
          const parent = free ? '' : resolve(raw.parent) || fallbackParent();
          result.jobs.push({ kind: 'questions', parentId: parent, free, search: clip(raw.search, 200), topic: clip(raw.topic, 120),
            level: clip(raw.level, 4).toUpperCase(), count: clamp(Math.round(num(raw.count, 3)), 1, 6) });
          break;
        }
        case 'set_title': {
          const text = clip(raw.text, LIMITS.title).trim();
          if (text) {
            map.title = text;
            const root = nodeById(map, map.rootId);
            if (root && (!root.text || /^(central idea|my mind map)$/i.test(root.text))) { root.text = clip(text, LIMITS.text); result.changed.push(root.id); }
          }
          break;
        }
        case 'select': case 'focus': {
          const id = resolve(raw.node);
          if (id) result.select = id;
          break;
        }
        case 'tidy': result.tidy = true; break;
        default: break;
      }
    } catch (e) {
      result.errors.push(str(e && e.message || e));
    }
  }
  if (!result.select && result.created.length === 1) result.select = result.created[0];
  if (result.created.length > 2) result.tidy = true;
  return result;
}

/** Turn an AI "map from a topic" reply into nodes under the root. */
export function buildFromOutline(map, outline) {
  const created = [];
  if (!outline || typeof outline !== 'object') return created;
  const root = nodeById(map, map.rootId);
  if (outline.title) { map.title = clip(outline.title, LIMITS.title); if (root) root.text = clip(outline.title, LIMITS.text); }
  const add = (parentId, item, depth) => {
    if (!item || depth > 4 || map.nodes.length >= LIMITS.nodes) return;
    const text = clip(typeof item === 'string' ? item : item.text, LIMITS.text).trim();
    if (!text) return;
    const node = normalizeNode({ id: makeId('n'), type: 'topic', parentId, x: 0, y: 0, text, color: colorForNewChild(map, parentId), shape: depth === 1 ? 'pill' : 'rounded' });
    map.nodes.push(node);
    created.push(node.id);
    for (const child of Array.isArray(item.children) ? item.children : []) add(node.id, child, depth + 1);
  };
  for (const branch of Array.isArray(outline.branches) ? outline.branches : []) add(map.rootId, branch, 1);
  return created;
}

/** Parse a plain text outline (indent with spaces / tabs or "-" bullets) into nodes under `parentId`. */
export function importOutlineText(map, parentId, text) {
  const created = [];
  const lines = str(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return created;
  const stack = [{ indent: -1, id: parentId }];
  for (const line of lines.slice(0, LIMITS.nodes)) {
    const m = /^(\s*)(?:[-*•+]|\d+[.)])?\s*(.*)$/.exec(line.replace(/\t/g, '  '));
    const indent = m[1].length;
    const label = clip(m[2].replace(/^#+\s*/, ''), LIMITS.text).trim();
    if (!label) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].id;
    if (map.nodes.length >= LIMITS.nodes) break;
    const node = normalizeNode({ id: makeId('n'), type: 'topic', parentId: parent, x: 0, y: 0, text: label, color: colorForNewChild(map, parent) });
    map.nodes.push(node);
    created.push(node.id);
    stack.push({ indent, id: node.id });
  }
  return created;
}
