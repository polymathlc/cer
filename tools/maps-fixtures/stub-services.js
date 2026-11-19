// Test stub for mindmap/mindmap-services.js, as the /maps page uses it (tools/maps-browser.mjs):
// a fake sign-in kept in sessionStorage, so it survives the trip to "Stripe" and back.
export const BANK_ADMIN_EMAILS = ['chungzhikai@gmail.com'];
export const db = {};
export const fb = {};
const listeners = new Set();
function current() {
  try { const raw = sessionStorage.getItem('stub-user'); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function asUser(u) { return u ? Object.assign({}, u, { isAnonymous: false, getIdToken: async () => 'token-' + u.uid + '-xxxxxxxxxxxxxxxxxxxx' }) : null; }
function emit() { const u = asUser(current()); listeners.forEach(fn => fn(u)); }
export function watchUser(fn) { listeners.add(fn); setTimeout(() => fn(asUser(current())), 30); return () => listeners.delete(fn); }
export async function signInGoogle() {
  const who = window.__nextUser || { uid: 'outsider1', email: 'parent@example.com', displayName: 'Mrs Tan' };
  sessionStorage.setItem('stub-user', JSON.stringify(who));
  setTimeout(emit, 10);
}
export async function signInUsername(loginId) {
  sessionStorage.setItem('stub-user', JSON.stringify({ uid: 'student1', email: loginId + '@students.sciencequest.app', displayName: loginId }));
  setTimeout(emit, 10);
}
export async function signOut() { sessionStorage.removeItem('stub-user'); setTimeout(emit, 10); }
export function friendlyAuthError(e) { return (e && e.message) || 'Sign-in failed.'; }
