/* =====================================================================
   MR CHUNG'S MAPS — the library page (v1.0.0, November 2026)
   ---------------------------------------------------------------------
   polymathlc.com.sg/maps. See index.html for the overview.

   The parts, in the order they appear below:
     1. state, the server call, small helpers, toasts and modals
     2. sign-in (Google for everyone, the centre username for students)
     3. the subscription: status, subscribe, coming back from Stripe,
        cancel / keep, update card
     4. the library: the catalogue cards, search, locked and open states
     5. the viewer: a read-only mind map (pan, zoom, fold, questions, apps)
     6. the admin panel (#admin): subscribers and the monthly price
   ===================================================================== */
import { watchUser, signInGoogle, signInUsername, signOut, friendlyAuthError } from '../mindmap/mindmap-services.js';
import {
  normalizeMap, colorOf, escapeHtml, nodeById, childrenOf, depthOf, isHidden, sideOf, layoutMap, boundsOf, fitView,
  branchPath, linkPath, buildSandboxDoc, SANDBOX_FLAGS, htmlToText
} from '../mindmap/mindmap-core.mjs?v=1.3.0';
import { renderQuestionHtml, questionHasAnswer } from '../mindmap/mindmap-questions.js?v=1.3.0';

export const MAPS_PAGE_VERSION = '1.0.0';
const ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/mapsLibrary';
const WHATSAPP = 'https://wa.me/6596450588';
const SEEN_KEY = 'polymath-maps:seen';
const NEW_FOR_MS = 14 * 86400000;

/* =====================================================================
   1. STATE AND HELPERS
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const S = {
  user: null,
  userReady: false,
  status: null,            // the server's answer to "status": { access, admin, subscription, price }
  catalogue: [],
  price: null,
  search: '',
  pendingSubscribe: false, // the visitor tapped Subscribe before signing in
  viewer: null             // { map, qState, live } while a map is open
};

/** One call to the mapsLibrary function. Signed in → the Firebase ID token goes with it. */
async function api(action, data = {}, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && S.user) headers.Authorization = 'Bearer ' + await S.user.getIdToken();
  let response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(Object.assign({ action, pageVersion: MAPS_PAGE_VERSION }, data)) });
  } catch {
    throw Object.assign(new Error('No connection. Check your internet and try again.'), { code: 'offline' });
  }
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body || body.ok === false) {
    const code = body && body.error ? body.error : 'http-' + response.status;
    throw Object.assign(new Error(friendlyError(code)), { code, status: response.status });
  }
  return body;
}

function friendlyError(code) {
  const map = {
    'sign-in-required': 'Please sign in first.',
    'subscription-required': 'This map is for subscribers. Subscribe to open the whole library.',
    'free-for-you': 'Good news: the library is already free for your account.',
    'already-subscribed': 'You are already subscribed. Enjoy the maps!',
    'card-payments-off': 'Card payments are switched off right now. Please WhatsApp us on +65 9645 0588.',
    'stripe-unavailable': 'The payment service did not answer. Please try again in a minute.',
    'portal-unavailable': 'Updating the card online is not set up yet. Please WhatsApp us on +65 9645 0588 and we will help.',
    'no-subscription': 'There is no subscription on this account.',
    'map-not-found': 'That map is no longer in the library.',
    'admin-only': 'Only the Polymath admins can do that.',
    'invalid-price': 'Please type a monthly price between S$1 and S$200.',
    'checkout-not-found': 'We could not find that checkout. If you paid, it will show here within a minute.',
    'origin-not-allowed': 'Please open this page at polymathlc.com.sg/maps.',
    'temporarily-unavailable': 'Something went wrong on our side. Please try again in a minute.'
  };
  return map[code] || 'Something went wrong (' + code + '). Please try again.';
}

function toast(text, kind = '', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, ms);
}

function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-busy', !!on);
  btn.disabled = !!on;
}

/** A small modal. Returns { el, close }. Esc and the backdrop close it. */
function modal(html, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(back);
  // close('done') is a close after the modal did its job; any other close is the visitor dismissing it.
  const close = how => { if (!back.isConnected) return; back.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(how === 'done' ? 'done' : 'dismissed'); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  const first = back.querySelector('button, input');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back, close };
}

function local(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode: fine */ }
  return null;
}

function dateLabel(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function priceLabel() {
  return S.price ? S.price.label : 'S$9.90 / month';
}
function priceAmount() {
  return S.price ? 'S$' + (S.price.cents / 100).toFixed(2) : 'S$9.90';
}

const OPEN = ['staff', 'student', 'subscriber'];
const hasAccess = () => !!(S.status && OPEN.includes(S.status.access));

/* =====================================================================
   2. SIGN-IN
   ===================================================================== */
function signInModal({ reason = '' } = {}) {
  const m = modal(`
    <h2>Sign in</h2>
    <p>${escapeHtml(reason || 'Your subscription belongs to the account you sign in with, so you can open the maps on any device.')}</p>
    <div class="stack">
      <button class="btn btn-primary google-btn" type="button" data-google>
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt=""> Continue with Google
      </button>
      <div class="divider">Polymath student? Use your centre username</div>
      <form class="stack" data-username>
        <label class="field">Username<input name="loginId" autocomplete="username" required></label>
        <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Sign in</button>
      </form>
      <div class="form-error" data-error></div>
    </div>
    <div class="row"><button class="btn btn-ghost" type="button" data-close>Not now</button></div>`,
  { onClose: how => { if (how !== 'done') S.pendingSubscribe = false; } });
  const err = $('[data-error]', m.el);
  $('[data-google]', m.el).addEventListener('click', async e => {
    const btn = e.currentTarget;
    err.textContent = '';
    busy(btn, true);
    try { await signInGoogle(); m.close('done'); }
    catch (error) { err.textContent = friendlyAuthError(error); }
    finally { busy(btn, false); }
  });
  $('[data-username]', m.el).addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $('button[type="submit"]', form);
    err.textContent = '';
    busy(btn, true);
    try { await signInUsername(form.loginId.value, form.password.value); m.close('done'); }
    catch (error) { err.textContent = friendlyAuthError(error); }
    finally { busy(btn, false); }
  });
  return m;
}

$('#headerSignIn').addEventListener('click', () => signInModal());
$('#signOutBtn').addEventListener('click', async () => {
  await signOut();
  toast('Signed out.');
});

function renderUser() {
  const u = S.user;
  $('#headerSignIn').hidden = !!u || !S.userReady;
  $('#userChip').hidden = !u;
  if (!u) return;
  const name = u.displayName || (u.email || '').split('@')[0] || 'You';
  $('#userName').textContent = name;
  const av = $('#userAvatar');
  av.innerHTML = '';
  if (u.photoURL) { const img = document.createElement('img'); img.src = u.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer'; av.appendChild(img); }
  else av.textContent = name.slice(0, 1).toUpperCase();
  const pill = $('#accessPill');
  const access = S.status ? S.status.access : '';
  pill.textContent = { staff: 'Staff', student: 'Student · free', subscriber: 'Subscribed', none: 'Not subscribed' }[access] || '…';
  pill.classList.toggle('is-open', OPEN.includes(access));
}

watchUser(async user => {
  S.user = user && !user.isAnonymous ? user : null;
  S.userReady = true;
  S.status = null;
  renderUser();
  if (!S.user) { renderAccount(); renderLibrary(); renderAdmin(); return; }
  await afterSignIn();
});

async function afterSignIn() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session');
  try {
    if (params.get('subscribed') === '1' && sessionId) {
      S.status = await api('confirm', { sessionId });
      cleanUrl();
      if (S.status.access === 'subscriber') celebrate();
      else toast('Thank you! Your payment is being confirmed; the library opens in a moment.', 'good', 7000);
      if (S.status.access !== 'subscriber') setTimeout(() => refreshStatus(true), 6000);
    } else {
      S.status = await api('status');
    }
  } catch (error) {
    S.status = { access: 'none', admin: false, subscription: null, price: S.price, error: error.message };
    toast(error.message, 'error');
  }
  if (S.status.price) { S.price = S.status.price; renderPrice(); }
  renderUser();
  renderAccount();
  renderLibrary();
  renderAdmin();
  if (S.pendingSubscribe) { S.pendingSubscribe = false; subscribe(); }
}

async function refreshStatus(fresh = false) {
  if (!S.user) return;
  try {
    S.status = await api('status', fresh ? { fresh: true } : {});
    renderUser(); renderAccount(); renderLibrary();
  } catch (error) { toast(error.message, 'error'); }
}

function cleanUrl() {
  const url = new URL(location.href);
  ['subscribed', 'session', 'cancelled'].forEach(k => url.searchParams.delete(k));
  history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
}

{
  const params = new URLSearchParams(location.search);
  if (params.get('cancelled') === '1') {
    toast('Checkout cancelled. Nothing was charged.');
    cleanUrl();
  }
}

/* =====================================================================
   3. THE SUBSCRIPTION
   ===================================================================== */
async function subscribe(btn) {
  if (!S.user) {
    S.pendingSubscribe = true;
    signInModal({ reason: 'First, sign in. Your subscription belongs to this account, so you can open the maps on any device.' });
    return;
  }
  if (hasAccess()) {
    toast(S.status.access === 'subscriber' ? 'You are already subscribed. Enjoy the maps!' : 'The library is already free for your account.', 'good');
    location.hash = '#library';
    return;
  }
  busy(btn, true);
  try {
    const { url } = await api('subscribe', { returnUrl: location.origin + location.pathname });
    location.assign(url);
  } catch (error) {
    if (error.code === 'already-subscribed' || error.code === 'free-for-you') await refreshStatus(true);
    toast(error.message, error.code === 'free-for-you' || error.code === 'already-subscribed' ? 'good' : 'error', 6000);
    busy(btn, false);
  }
}
$('#heroSubscribe').addEventListener('click', e => subscribe(e.currentTarget));

function paywall(map) {
  const signedIn = !!S.user;
  const m = modal(`
    <h2>🔒 ${escapeHtml(map ? map.title : 'Mr Chung\'s Maps')}</h2>
    <p>This map is part of Mr Chung's Maps. Subscribe for <b>${escapeHtml(priceLabel())}</b> to open it and every other map in the library. Cancel anytime.</p>
    ${map && map.topics && map.topics.length ? `<p><b>Inside:</b> ${map.topics.map(escapeHtml).join(' · ')}${map.counts && map.counts.questions ? ` · ${map.counts.questions} question${map.counts.questions === 1 ? '' : 's'}` : ''}</p>` : ''}
    <p style="font-size:0.9rem"><b style="color:var(--good)">Polymath student?</b> ${signedIn ? 'Your account is not approved yet. Ask the centre to approve it at My Polymath, and the library opens free.' : 'Sign in with your My Polymath account and it opens free.'}</p>
    <div class="row">
      <button class="btn btn-ghost" type="button" data-close>Not now</button>
      ${signedIn ? '' : '<button class="btn" type="button" data-signin>Sign in</button>'}
      <button class="btn btn-primary" type="button" data-subscribe>Subscribe · ${escapeHtml(priceAmount())}/month</button>
    </div>`);
  $('[data-subscribe]', m.el).addEventListener('click', e => { subscribe(e.currentTarget); if (!S.user) m.close(); });
  const si = $('[data-signin]', m.el);
  if (si) si.addEventListener('click', () => { m.close(); signInModal(); });
}

function renderPrice() {
  $('#priceAmount').textContent = priceAmount();
  $('#heroSubscribe').textContent = hasAccess() ? 'Open the library' : 'Subscribe · ' + priceAmount() + ' a month';
}

function renderAccount() {
  const section = $('#accountSection');
  const panel = $('#accountPanel');
  const st = S.status;
  if (!S.user || !st) { section.hidden = true; renderPrice(); return; }
  section.hidden = false;
  panel.className = 'account';
  const sub = st.subscription;
  const actions = [];
  let title = '', text = '';
  if (st.access === 'staff') {
    panel.classList.add('is-open');
    title = 'Staff account: the whole library is open.';
    text = st.admin ? 'You can see subscribers and change the price in the admin panel below.' : 'Publish maps from the Mind Map app with 📌.';
    actions.push('<a class="btn btn-small" href="../mindmap/">Open Mind Map</a>');
  } else if (st.access === 'student') {
    panel.classList.add('is-open');
    title = 'You are a Polymath student, so the library is free.';
    text = 'Every map below is open. You will also find them in the Mind Map app under Mr Chung\'s Maps.';
    actions.push('<a class="btn btn-small" href="../mindmap/">Open Mind Map</a>');
  } else if (st.access === 'subscriber') {
    panel.classList.add('is-open');
    if (sub && sub.cancelAtPeriodEnd) {
      title = 'Your subscription ends on ' + dateLabel(sub.currentPeriodEnd) + '.';
      text = 'You can keep using every map until then, and you will not be charged again.';
      actions.push('<button class="btn btn-small btn-primary" type="button" data-act="resume">Keep my subscription</button>');
    } else {
      title = 'You are subscribed. The whole library is open.';
      text = sub ? 'Next payment' + (sub.amountCents != null ? ' of S$' + (sub.amountCents / 100).toFixed(2) : '') + ' on ' + dateLabel(sub.currentPeriodEnd) + '.' : '';
      actions.push('<button class="btn btn-small btn-ghost btn-danger" type="button" data-act="cancel">Cancel subscription</button>');
    }
    actions.push('<button class="btn btn-small" type="button" data-act="manage">Update card</button>');
  } else if (sub && (sub.status === 'past_due' || sub.status === 'unpaid')) {
    panel.classList.add('is-warn');
    title = 'Your last payment did not go through.';
    text = 'The library is paused until the card is updated. Stripe will try again automatically.';
    actions.push('<button class="btn btn-small btn-primary" type="button" data-act="manage">Update card</button>');
    actions.push(`<a class="btn btn-small" href="${WHATSAPP}" target="_blank" rel="noopener">WhatsApp us</a>`);
  } else if (sub && (sub.status === 'canceled' || sub.status === 'incomplete_expired')) {
    title = 'Your subscription has ended.';
    text = 'Subscribe again any time for ' + priceLabel() + '.';
    actions.push('<button class="btn btn-small btn-primary" type="button" data-act="subscribe">Subscribe again</button>');
  } else if (sub && sub.status === 'incomplete') {
    panel.classList.add('is-warn');
    title = 'Your first payment is still being confirmed.';
    text = 'This usually takes a few seconds. If your bank asked you to approve it, please do.';
    actions.push('<button class="btn btn-small" type="button" data-act="refresh">Check again</button>');
  } else {
    title = 'Signed in as ' + (S.user.email || S.user.displayName || 'you') + '.';
    text = 'Subscribe for ' + priceLabel() + ' to open every map. Polymath students: once the centre approves your account at My Polymath, it is free.';
    actions.push('<button class="btn btn-small btn-primary" type="button" data-act="subscribe">Subscribe · ' + escapeHtml(priceAmount()) + '/month</button>');
  }
  $('#accountTitle').textContent = title;
  $('#accountText').textContent = text;
  $('#accountActions').innerHTML = actions.join('');
  renderPrice();
}

$('#accountActions').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'subscribe') return subscribe(btn);
  if (act === 'refresh') { busy(btn, true); await refreshStatus(true); return; }
  if (act === 'cancel') return confirmCancel();
  if (act === 'resume') {
    busy(btn, true);
    try { S.status = await api('resume'); toast('Done. Your subscription carries on as before.', 'good'); }
    catch (error) { toast(error.message, 'error'); }
    renderAccount(); renderUser();
    return;
  }
  if (act === 'manage') {
    busy(btn, true);
    try { const { url } = await api('manage', { returnUrl: location.origin + location.pathname }); location.assign(url); }
    catch (error) { toast(error.message, 'error', 7000); busy(btn, false); }
  }
});

function confirmCancel() {
  const sub = S.status && S.status.subscription;
  const m = modal(`
    <h2>Cancel your subscription?</h2>
    <p>You keep every map until <b>${escapeHtml(dateLabel(sub && sub.currentPeriodEnd) || 'the end of this month')}</b>, and you will not be charged again. You can change your mind before then.</p>
    <div class="row">
      <button class="btn" type="button" data-close>Keep it</button>
      <button class="btn btn-danger" type="button" data-yes>Cancel subscription</button>
    </div>`);
  $('[data-yes]', m.el).addEventListener('click', async e => {
    busy(e.currentTarget, true);
    try {
      S.status = await api('cancel');
      toast('Cancelled. The library stays open until ' + dateLabel(S.status.subscription && S.status.subscription.currentPeriodEnd) + '.', 'good', 6000);
    } catch (error) { toast(error.message, 'error'); }
    m.close();
    renderAccount(); renderUser();
  });
}

function celebrate() {
  toast('🎉 Welcome to Mr Chung\'s Maps! Every map is now open.', 'good', 7000);
  const panel = $('#accountSection');
  if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
}

/* =====================================================================
   4. THE LIBRARY
   ===================================================================== */
async function loadCatalogue() {
  try {
    const answer = await api('catalogue', {}, { auth: false });
    S.catalogue = answer.maps || [];
    if (answer.price) { S.price = answer.price; renderPrice(); }
  } catch (error) {
    S.catalogue = null;
    S.catalogueError = error.message;
  }
  renderLibrary();
}

/** A tiny drawing of a map's first branches, for its card. */
function thumbSvg(map, index) {
  const colours = ['#90CAF9', '#A5D6A7', '#FFCC80', '#B39DDB', '#EF9A9A', '#80CBC4'];
  const n = clamp((map.topics || []).length || 3, 2, 6);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const left = i % 2 === 0;
    const row = Math.floor(i / 2);
    const rows = Math.ceil(n / 2);
    const y = 32 + (row - (rows - 1) / 2) * 16;
    const x = left ? 40 : 200;
    parts.push(`<path d="M120 32 C ${left ? 90 : 150} 32, ${left ? 80 : 160} ${y}, ${x + (left ? 22 : -22)} ${y}" stroke="${colours[(i + index) % colours.length]}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    parts.push(`<rect x="${x - 22}" y="${y - 6}" width="44" height="12" rx="6" fill="#fff" stroke="${colours[(i + index) % colours.length]}"/>`);
  }
  return `<svg viewBox="0 0 240 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parts.join('')}<rect x="96" y="22" width="48" height="20" rx="10" fill="#FFF3E0" stroke="#FFCC80" stroke-width="1.5"/></svg>`;
}

function countsLine(c) {
  if (!c) return '';
  const bits = [];
  if (c.topics) bits.push(c.topics + ' topic' + (c.topics === 1 ? '' : 's'));
  if (c.notes) bits.push(c.notes + ' note' + (c.notes === 1 ? '' : 's'));
  if (c.questions) bits.push(c.questions + ' question' + (c.questions === 1 ? '' : 's'));
  if (c.pictures) bits.push(c.pictures + ' picture' + (c.pictures === 1 ? '' : 's'));
  if (c.apps) bits.push(c.apps + ' app' + (c.apps === 1 ? '' : 's'));
  return bits.map(b => '<span>' + escapeHtml(b) + '</span>').join('');
}

function renderLibrary() {
  const grid = $('#mapGrid');
  const open = hasAccess();
  $('#librarySub').textContent = open
    ? 'Tap a map to open it. New maps appear here as soon as Mr Chung publishes them.'
    : 'Every map Mr Chung has published. Subscribe for ' + priceLabel() + ' to open them all.';
  if (S.catalogue === null) {
    grid.innerHTML = `<div class="empty-state">The library could not load. ${escapeHtml(S.catalogueError || '')}<br><br><button class="btn btn-small" type="button" data-retry>Try again</button></div>`;
    $('[data-retry]', grid).addEventListener('click', () => { grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; loadCatalogue(); });
    $('#mapCount').textContent = '';
    return;
  }
  if (!Array.isArray(S.catalogue)) return;
  const q = S.search.trim().toLowerCase();
  const list = S.catalogue.filter(m => !q || (m.title + ' ' + (m.topics || []).join(' ')).toLowerCase().includes(q));
  $('#mapCount').textContent = S.catalogue.length ? list.length + ' of ' + S.catalogue.length + ' map' + (S.catalogue.length === 1 ? '' : 's') : '';
  if (!S.catalogue.length) {
    grid.innerHTML = '<div class="empty-state">The first maps are on their way. Check back soon!</div>';
    return;
  }
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">No maps match "' + escapeHtml(S.search) + '".</div>';
    return;
  }
  const seen = new Set(String(local(SEEN_KEY) || '').split(',').filter(Boolean));
  const now = Date.now();
  grid.innerHTML = list.map((m, i) => {
    const isNew = !seen.has(m.id) && m.publishedAtMs && now - m.publishedAtMs < NEW_FOR_MS;
    return `<button class="map-card${isNew ? ' is-new' : ''}" type="button" data-map="${escapeHtml(m.id)}" style="animation-delay:${Math.min(i, 12) * 0.05}s"
      aria-label="${escapeHtml(m.title)}${open ? '' : ' (subscribers only)'}">
      <span class="lock${open ? ' is-open' : ''}">${open ? 'Open' : '🔒 Subscribers'}</span>
      <div class="thumb">${thumbSvg(m, i)}</div>
      <h3>${escapeHtml(m.title)}</h3>
      <div class="topics">${(m.topics || []).slice(0, 6).map(t => '<span>' + escapeHtml(t) + '</span>').join('')}</div>
      <div class="meta">${countsLine(m.counts)}${m.publishedAtMs ? '<span>' + escapeHtml(dateLabel(m.publishedAtMs)) + '</span>' : ''}</div>
    </button>`;
  }).join('');
}

$('#search').addEventListener('input', e => { S.search = e.target.value; renderLibrary(); });
$('#mapGrid').addEventListener('click', e => {
  const card = e.target.closest('[data-map]');
  if (!card) return;
  const map = (S.catalogue || []).find(m => m.id === card.dataset.map);
  if (!hasAccess()) { paywall(map); return; }
  openMap(card.dataset.map);
});

/* =====================================================================
   5. THE VIEWER (read-only)
   ===================================================================== */
const ui = {
  viewer: $('#viewer'), viewport: $('#viewport'), world: $('#world'), nodes: $('#nodes'), edges: $('#edges'),
  loading: $('#viewerLoading'), title: $('#viewerTitle'), zoom: $('#zoomLabel')
};

async function openMap(id) {
  ui.viewer.hidden = false;
  document.body.style.overflow = 'hidden';
  ui.loading.hidden = false;
  ui.loading.textContent = 'Opening the map…';
  ui.nodes.innerHTML = '';
  ui.edges.innerHTML = '';
  const card = (S.catalogue || []).find(m => m.id === id);
  ui.title.textContent = card ? card.title : '';
  history.pushState({ map: id }, '', '#map=' + encodeURIComponent(id));
  try {
    const answer = await api('open', { mapId: id });
    const map = normalizeMap(answer.map);
    S.viewer = { map, qState: new Map(), live: new Set() };
    ui.title.textContent = map.title;
    const seen = new Set(String(local(SEEN_KEY) || '').split(',').filter(Boolean));
    seen.add(id);
    local(SEEN_KEY, [...seen].join(','));
    drawMap();
    ui.loading.hidden = true;
    requestAnimationFrame(() => { drawMap(); fitAll(); });
  } catch (error) {
    ui.loading.textContent = error.message;
    if (error.code === 'subscription-required') { closeViewer(); await refreshStatus(true); paywall(card); }
  }
}

function closeViewer(fromHistory = false) {
  if (ui.viewer.hidden) return;
  ui.viewer.hidden = true;
  document.body.style.overflow = '';
  S.viewer = null;
  ui.nodes.innerHTML = '';
  if (!fromHistory && /^#map=/.test(location.hash)) history.back();
  renderLibrary();
}
$('#viewerClose').addEventListener('click', () => closeViewer());
window.addEventListener('popstate', () => {
  if (!/^#map=/.test(location.hash)) closeViewer(true);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ui.viewer.hidden && !document.querySelector('.modal-back')) closeViewer(); });

function nodeStyle(el, n) {
  const c = colorOf(n.color);
  el.style.setProperty('--node-fill', c.fill);
  el.style.setProperty('--node-ink', c.ink);
  el.style.setProperty('--node-line', c.line);
}

function questionHeadline(q) {
  let text = String(q.title || '').trim();
  if (!text) {
    for (const b of q.blocks || []) {
      const plain = htmlToText(String((b && (b.text || b.content)) || '')).replace(/\s+/g, ' ').trim();
      if (plain) { text = plain; break; }
    }
  }
  return (text || 'Question').slice(0, 140);
}

function nodeHtml(map, n) {
  const isRoot = n.id === map.rootId;
  const side = isRoot ? 'right' : sideOf(map, n.id);
  const kids = childrenOf(map, n.id).length;
  const fold = kids && !isRoot ? `<button class="fold ${side}" type="button" data-act="fold" aria-label="${n.collapsed ? 'Show' : 'Hide'} ${kids} sub-topics">${n.collapsed ? kids : '−'}</button>` : '';
  switch (n.type) {
    case 'note':
      return `${n.text ? `<div class="note-title mm-text">${escapeHtml(n.text)}</div>` : ''}<div class="note-body">${escapeHtml(n.note || '')}</div>${fold}`;
    case 'image': {
      const w = n.image.width || 260;
      const pic = n.image.url
        ? `<img class="pic" src="${escapeHtml(n.image.url)}" alt="${escapeHtml(n.image.alt || n.text || 'Picture')}" style="width:${w}px" draggable="false" loading="lazy">`
        : `<div class="pic" style="width:${w}px;height:${Math.round(w * 0.6)}px"></div>`;
      return `${pic}${n.text ? `<div class="pic-caption mm-text">${escapeHtml(n.text)}</div>` : ''}${fold}`;
    }
    case 'code': {
      const live = S.viewer && S.viewer.live.has(n.id);
      return `<div class="code-bar"><span class="code-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="code-title">💻 ${escapeHtml(n.code.title || 'Learning app')}</span>
        ${live ? '<button class="btn btn-small btn-ghost" type="button" data-act="code-stop">Done</button>' : ''}</div>
        <div class="code-frame-wrap" style="width:${n.code.width}px;height:${n.code.height}px">
          <iframe class="code-frame" sandbox="${SANDBOX_FLAGS}" referrerpolicy="no-referrer" loading="lazy" title="${escapeHtml(n.code.title || 'Learning app')}"></iframe>
          <div class="code-shield"><button class="btn btn-small btn-primary" type="button" data-act="code-use">▶ Use the app</button></div>
        </div>${fold}`;
    }
    case 'question': {
      const q = n.question;
      const st = questionState(n.id);
      const head = `<div class="q-head"><button class="q-fold" type="button" data-act="q-fold" aria-label="${q.folded ? 'Open' : 'Fold'} the question">${q.folded ? '▸' : '▾'}</button>❓ <span>${escapeHtml(q.topic || 'Question')}</span>${q.level ? `<span class="q-badge">${escapeHtml(q.level)}</span>` : ''}${q.marks ? `<span class="q-badge">${escapeHtml(q.marks)}m</span>` : ''}</div>`;
      if (q.folded) return `${head}<button class="q-mini" type="button" data-act="q-fold" style="width:${Math.min(q.width, 300)}px">${escapeHtml(questionHeadline(q))}</button>${fold}`;
      const canReveal = questionHasAnswer(q);
      return `${head}<div class="q-body" style="width:${q.width}px">${renderQuestionHtml(q, { interactive: true, picked: st.picked, reveal: st.reveal })}</div>
        <div class="q-foot">${canReveal ? `<button class="btn btn-small" type="button" data-act="q-reveal">${st.reveal ? 'Hide answer' : 'Show answer'}</button>` : ''}
        ${st.picked ? '<button class="btn btn-small btn-ghost" type="button" data-act="q-reset">↺ Try again</button>' : ''}</div>${fold}`;
    }
    default:
      return `<div class="mm-text">${escapeHtml(n.text || (isRoot ? 'Central idea' : ''))}</div>${fold}`;
  }
}

function questionState(id) {
  if (!S.viewer.qState.has(id)) S.viewer.qState.set(id, { picked: '', reveal: false });
  return S.viewer.qState.get(id);
}

/** Draws every visible node, measures it, then the branches. Positions are the map's own (as Mr Chung laid it out). */
function drawMap() {
  const v = S.viewer;
  if (!v) return;
  const map = v.map;
  const keep = new Map($$('.mm-node', ui.nodes).map(el => [el.dataset.id, el]));
  const live = new Set();
  for (const n of map.nodes) {
    if (isHidden(map, n.id)) continue;
    live.add(n.id);
    let el = keep.get(n.id);
    const html = nodeHtml(map, n);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = n.id;
      ui.nodes.appendChild(el);
    }
    el.className = 'mm-node type-' + n.type + ' shape-' + n.shape + (n.id === map.rootId ? ' is-root' : '') + (n.type === 'code' && v.live.has(n.id) ? ' is-live' : '');
    nodeStyle(el, n);
    // A code window keeps its running app: it is only rebuilt when its live state changes.
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
      if (n.type === 'code') {
        const frame = el.querySelector('.code-frame');
        if (frame) frame.srcdoc = buildSandboxDoc(n.code, { bridge: false });
      }
    }
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w && h) { n.w = w; n.h = h; }
  }
  for (const [id, el] of keep) if (!live.has(id)) el.remove();
  // A map saved before it was ever laid out (every node at 0,0) is tidied, and tidied again
  // whenever a card changes size (a question showing its answer, a branch opening).
  if (v.autoLayout === undefined) v.autoLayout = map.nodes.filter(n => n.x || n.y).length < Math.min(2, map.nodes.length - 1);
  if (v.autoLayout) {
    const pos = layoutMap(map, n => ({ w: n.w, h: n.h }));
    for (const n of map.nodes) { const p = pos.get(n.id); if (p) { n.x = Math.round(p.x); n.y = Math.round(p.y); } }
  }
  for (const n of map.nodes) {
    const el = ui.nodes.querySelector(`.mm-node[data-id="${CSS.escape(n.id)}"]`);
    if (!el) continue;
    el.style.left = Math.round(n.x - (n.w || el.offsetWidth) / 2) + 'px';
    el.style.top = Math.round(n.y - (n.h || el.offsetHeight) / 2) + 'px';
  }
  drawEdges();
}

function drawEdges() {
  const map = S.viewer.map;
  const parts = ['<defs><marker id="mpArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9E9E9E"/></marker></defs>'];
  for (const n of map.nodes) {
    if (!n.parentId || isHidden(map, n.id)) continue;
    const p = nodeById(map, n.parentId);
    if (!p) continue;
    const depth = depthOf(map, n.id);
    let top = n;
    while (top.parentId && top.parentId !== map.rootId) { const up = nodeById(map, top.parentId); if (!up) break; top = up; }
    const stroke = top.color === 'white' ? '#BDBDBD' : colorOf(top.color).line;
    const width = depth <= 1 ? 4 : depth === 2 ? 3 : 2;
    parts.push(`<path class="branch" d="${branchPath(p, n)}" stroke="${stroke}" stroke-width="${width}"/>`);
  }
  for (const l of map.links) {
    const a = nodeById(map, l.from), b = nodeById(map, l.to);
    if (!a || !b || isHidden(map, a.id) || isHidden(map, b.id)) continue;
    const path = linkPath(a, b);
    parts.push(`<path class="link" d="${path.d}" marker-end="url(#mpArrow)"/>`);
    if (l.label) parts.push(`<text class="link-label" x="${path.mid.x}" y="${path.mid.y}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(l.label)}</text>`);
  }
  ui.edges.innerHTML = parts.join('');
}

/* pan and zoom */
const view = { x: 0, y: 0, zoom: 1 };
function applyView() {
  ui.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  ui.zoom.textContent = Math.round(view.zoom * 100) + '%';
}
function fitAll() {
  if (!S.viewer) return;
  const r = ui.viewport.getBoundingClientRect();
  const fit = fitView(boundsOf(S.viewer.map), r.width, r.height, r.width < 600 ? 24 : 60, 1.2);
  // On a phone a big map fitted whole is too small to read: start at a readable size on the centre.
  if (fit.zoom < 0.45 && r.width < 600) {
    const root = nodeById(S.viewer.map, S.viewer.map.rootId);
    const zoom = 0.6;
    Object.assign(fit, { zoom, x: r.width / 2 - (root ? root.x : 0) * zoom, y: r.height / 2 - (root ? root.y : 0) * zoom });
  }
  Object.assign(view, fit);
  applyView();
}
function zoomAt(factor, sx, sy) {
  const r = ui.viewport.getBoundingClientRect();
  const px = sx == null ? r.width / 2 : sx - r.left;
  const py = sy == null ? r.height / 2 : sy - r.top;
  const nz = clamp(view.zoom * factor, 0.15, 3);
  view.x = px - (px - view.x) * (nz / view.zoom);
  view.y = py - (py - view.y) * (nz / view.zoom);
  view.zoom = nz;
  applyView();
}
$('#zoomIn').addEventListener('click', () => zoomAt(1.2));
$('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.2));
$('#zoomFit').addEventListener('click', fitAll);
$('#foldAll').addEventListener('click', e => {
  if (!S.viewer) return;
  const map = S.viewer.map;
  const branches = map.nodes.filter(n => n.parentId === map.rootId && childrenOf(map, n.id).length);
  const anyOpen = branches.some(n => !n.collapsed);
  branches.forEach(n => { n.collapsed = anyOpen; });
  e.currentTarget.textContent = anyOpen ? 'Open all' : 'Fold all';
  drawMap();
  fitAll();
});
window.addEventListener('resize', () => { if (S.viewer) fitAll(); });

ui.viewport.addEventListener('wheel', e => {
  if (e.target.closest('.q-body, .code-frame-wrap')) return;
  e.preventDefault();
  // A trackpad pinch (ctrlKey) or a mouse wheel (line steps, or big whole pixel steps) zooms;
  // a trackpad's two-finger scroll (small smooth steps) moves the map.
  const wheel = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 && e.deltaX === 0);
  if (e.ctrlKey || e.metaKey || wheel) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX, e.clientY);
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
}, { passive: false });

const pointers = new Map();
let pan = null, pinch = null;
ui.viewport.addEventListener('pointerdown', e => {
  if (e.target.closest('button, a, input, iframe, .q-body')) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ui.viewport.setPointerCapture(e.pointerId);
  if (pointers.size === 1) { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; ui.viewport.classList.add('is-panning'); }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    pan = null;
  }
});
ui.viewport.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const target = clamp(pinch.zoom * d / (pinch.d || 1), 0.15, 3);
    zoomAt(target / view.zoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
  } else if (pan) {
    view.x = pan.vx + (e.clientX - pan.x);
    view.y = pan.vy + (e.clientY - pan.y);
    applyView();
  }
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) { pan = null; ui.viewport.classList.remove('is-panning'); }
};
ui.viewport.addEventListener('pointerup', endPointer);
ui.viewport.addEventListener('pointercancel', endPointer);

/* taps inside the map: fold, questions, apps */
ui.nodes.addEventListener('click', e => {
  if (!S.viewer) return;
  const nodeEl = e.target.closest('.mm-node');
  if (!nodeEl) return;
  const map = S.viewer.map;
  const n = nodeById(map, nodeEl.dataset.id);
  if (!n) return;
  const option = e.target.closest('[data-option-id]');
  if (option && n.type === 'question') {
    questionState(n.id).picked = option.dataset.optionId;
    drawMap();
    return;
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  switch (act.dataset.act) {
    case 'fold': n.collapsed = !n.collapsed; break;
    case 'q-fold': n.question.folded = !n.question.folded; break;
    case 'q-reveal': { const st = questionState(n.id); st.reveal = !st.reveal; break; }
    case 'q-reset': S.viewer.qState.set(n.id, { picked: '', reveal: false }); break;
    case 'code-use': S.viewer.live.add(n.id); break;
    case 'code-stop': S.viewer.live.delete(n.id); break;
    default: return;
  }
  drawMap();
});

/* =====================================================================
   6. THE ADMIN PANEL (#admin, the access admins only)
   ===================================================================== */
async function renderAdmin() {
  const section = $('#adminSection');
  const panel = $('#adminPanel');
  const wanted = location.hash === '#admin';
  if (!S.status || !S.status.admin) { section.hidden = true; return; }
  section.hidden = false;
  if (!wanted && !panel.dataset.loaded) {
    panel.innerHTML = '<h2>Admin</h2><p class="sub">Subscribers and the monthly price.</p><button class="btn btn-small" type="button" data-load>Show subscribers and price</button>';
    $('[data-load]', panel).addEventListener('click', () => { panel.dataset.loaded = '1'; loadAdmin(); });
    return;
  }
  panel.dataset.loaded = '1';
  loadAdmin();
}

async function loadAdmin() {
  const panel = $('#adminPanel');
  panel.innerHTML = '<h2>Admin</h2><p>Loading subscribers from Stripe…</p>';
  let data;
  try { data = await api('admin'); }
  catch (error) { panel.innerHTML = '<h2>Admin</h2><p class="form-error">' + escapeHtml(error.message) + '</p>'; return; }
  const subs = data.subscribers || [];
  const active = subs.filter(s => s.open && !s.cancelAtPeriodEnd).length;
  const ending = subs.filter(s => s.open && s.cancelAtPeriodEnd).length;
  const trouble = subs.filter(s => s.status === 'past_due' || s.status === 'unpaid').length;
  const monthly = subs.filter(s => s.open && !s.cancelAtPeriodEnd).reduce((sum, s) => sum + (s.amountCents || 0), 0);
  panel.innerHTML = `
    <h2>Admin · Mr Chung's Maps</h2>
    <p class="sub">Only you, admin@ and support@ see this. The maps in the library are the ones you publish with 📌 in the Mind Map app.</p>
    <div class="stats">
      <div class="stat"><b>${active}</b><span>active subscribers</span></div>
      <div class="stat"><b>S$${(monthly / 100).toFixed(2)}</b><span>a month from them</span></div>
      <div class="stat"><b>${ending}</b><span>cancelled, ending soon</span></div>
      <div class="stat"><b>${trouble}</b><span>payment failed</span></div>
    </div>
    <form class="price-edit" data-price>
      <label class="field">Monthly price for new subscribers (S$)
        <input name="price" type="number" min="${data.limits.minimumCents / 100}" max="${data.limits.maximumCents / 100}" step="0.10" value="${(data.price.cents / 100).toFixed(2)}" required>
      </label>
      <button class="btn btn-primary" type="submit">Save price</button>
      <span class="count">Now ${escapeHtml(data.price.label)}${data.priceFromStripe ? '' : ' (the starting price; saving creates it in Stripe)'}. People already subscribed keep the price they joined at.</span>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Status</th><th>Price</th><th>Since</th><th>Renews / ends</th></tr></thead>
        <tbody>${subs.length ? subs.map(s => `<tr>
          <td>${escapeHtml(s.email || '—')}${s.name ? '<br><small>' + escapeHtml(s.name) + '</small>' : ''}</td>
          <td><span class="status-tag ${escapeHtml(s.status)}">${escapeHtml(s.cancelAtPeriodEnd && s.open ? 'ending' : s.status.replace('_', ' '))}</span></td>
          <td>${s.amountCents != null ? 'S$' + (s.amountCents / 100).toFixed(2) : '—'}</td>
          <td>${escapeHtml(dateLabel(s.createdAt))}</td>
          <td>${escapeHtml(s.open ? dateLabel(s.currentPeriodEnd) : '—')}</td></tr>`).join('') : '<tr><td colspan="5">No subscribers yet.</td></tr>'}</tbody>
      </table>
    </div>`;
  $('[data-price]', panel).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', e.currentTarget);
    const cents = Math.round(Number(e.currentTarget.price.value) * 100);
    busy(btn, true);
    try {
      const answer = await api('admin-price', { cents });
      S.price = answer.price;
      renderPrice(); renderLibrary(); renderAccount();
      toast(answer.changed ? 'Saved. New subscribers now pay ' + answer.price.label + '.' : 'That is already the price.', 'good');
      loadAdmin();
    } catch (error) { toast(error.message, 'error'); busy(btn, false); }
  });
}
window.addEventListener('hashchange', () => { if (location.hash === '#admin') renderAdmin(); });

/* =====================================================================
   START
   ===================================================================== */
$('#versionLabel').textContent = 'v' + MAPS_PAGE_VERSION;
renderPrice();
loadCatalogue();
