// Test stub for mindmap/mindmap-services.js (tools/mindmap-browser.mjs): a fake signed-in user, an in-memory Firestore and canned AI.
export const BANK_ADMIN_EMAILS = ['chungzhikai@gmail.com'];
export const STUDENT_USERNAME_DOMAIN = 'students.sciencequest.app';
export const auth = {}; export const db = { store: new Map() }; export const storage = {};
const store = db.store;
window.__store = store;
const sampleQs = [];
const topics = ['Magnets', 'Light', 'Heat', 'Plant Systems', 'Forces', 'Electrical Systems'];
for (let i = 0; i < 14; i++) {
  const t = topics[i % topics.length];
  const blocks = [{ id: 'b1', type: 'text', content: `<p>Question ${i + 1} about <b>${t}</b>: which statement is correct? <script>alert(1)</script><img src=x onerror=alert(1)></p>` }];
  if (i % 2 === 0) blocks.push({ id: 'b2', type: 'mcq', correctId: 'o2', options: [{ id: 'o1', text: '(1) It attracts wood' }, { id: 'o2', text: '(2) It attracts iron' }, { id: 'o3', text: '(3) It repels everything' }, { id: 'o4', text: '(4) None' }] });
  else { blocks.push({ id: 'b3', type: 'table', data: { 0: { 0: 'Set-up', 1: 'Result' }, 1: { 0: 'A', 1: 'Melts fast' } } }); blocks.push({ id: 'b4', type: 'answer', claim: 'Metal conducts heat', evidence: 'Ice melted faster', reasoning: 'Heat flows quickly' }); }
  sampleQs.push({ id: 'q' + i, title: 'Q' + i, topic: t, category: 'Concept', marks: 2, blocks, createdAt: { seconds: 1700000000 + i }, holdBack: i === 13 });
}
store.set('config/admin', { uid: 'admin1' });
store.set('users/admin1/settings/topics', { custom: {} });
for (const q of sampleQs) store.set('users/admin1/questions/' + q.id, q);
const snapOf = (path) => ({ id: path.split('/').pop(), exists: () => store.has(path), data: () => store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined });
export const fb = {
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  where: (field, op, value) => ({ field, op, value }),
  query: (col, ...conds) => ({ path: col.path, conds }),
  qLimit: n => ({ limit: n }),
  getDoc: async ref => snapOf(ref.path),
  setDoc: async (ref, data) => { await new Promise(r => setTimeout(r, 30)); store.set(ref.path, JSON.parse(JSON.stringify(data))); window.__saves = (window.__saves || 0) + 1; },
  deleteDoc: async ref => { store.delete(ref.path); },
  getDocs: async q => {
    const prefix = q.path + '/';
    const docs = [];
    for (const [k, v] of store) {
      if (!k.startsWith(prefix) || k.slice(prefix.length).includes('/')) continue;
      let ok = true;
      for (const c of q.conds || []) { if (c.op === '==' && v[c.field] !== c.value) ok = false; if (c.op === 'in' && !c.value.includes(v[c.field])) ok = false; }
      if (ok) docs.push(snapOf(k));
    }
    return { forEach: fn => docs.forEach(fn), docs };
  },
  storageRef: () => ({}), uploadString: async () => {}, getDownloadURL: async () => ''
};
const fakeUser = { uid: 'student1', email: window.__asStaff ? 'chungzhikai@gmail.com' : 'kid@example.com', emailVerified: true, displayName: window.__asStaff ? 'Mr Chung' : 'Test Student', photoURL: '' };
export function watchUser(fn) { setTimeout(() => fn(fakeUser), 50); return () => {}; }
export async function signInGoogle() {}
export async function signInUsername() {}
export function signOut() {}
export function friendlyAuthError(e) { return String(e); }
export function isStaffEmail(u) { return !!(u && u.email === 'chungzhikai@gmail.com'); }
export function loginCandidates(s) { return [s]; }
window.__aiCalls = [];
export async function aiText(prompt, opts = {}) {
  window.__aiCalls.push({ prompt, opts });
  await new Promise(r => setTimeout(r, 120));
  if (/THEY JUST SAID/.test(prompt)) {
    const said = /THEY JUST SAID: "([\s\S]*)"/.exec(prompt)[1].toLowerCase();
    const ops = [];
    if (said.includes('plants')) {
      ops.push({ op: 'set_title', text: 'Plants' });
      ops.push({ op: 'add_topic', ref: 'r', text: 'Roots' }, { op: 'add_topic', parent: 'r', text: 'Absorb water' }, { op: 'add_topic', ref: 's', text: 'Stem' }, { op: 'add_topic', parent: 's', text: 'Carries water up' }, { op: 'add_topic', ref: 'l', text: 'Leaves' });
      ops.push({ op: 'add_image', parent: 'l', prompt: 'a green leaf with veins', caption: 'A leaf' });
      ops.push({ op: 'build_app', parent: 's', title: 'Water travel', description: 'Slider for time showing water moving up a stem' });
      ops.push({ op: 'add_questions', parent: 'r', topic: 'Plant Systems', count: 2 });
      ops.push({ op: 'connect', from: 'r', to: 'l', label: 'supplies' });
    }
    return { text: JSON.stringify({ say: 'I built a plant map with a picture, an app and questions.', ops }), route: 'gemini' };
  }
  if (/Suggest \d+ NEW sub-ideas/.test(prompt)) return { text: JSON.stringify({ ideas: [{ text: 'Idea A', note: 'Note A' }, { text: 'Idea B', note: 'Note B' }, { text: 'Idea C', note: 'Note C' }] }), route: 'gemini' };
  if (/Build a complete, well-organised mind map/.test(prompt)) return { text: JSON.stringify({ title: 'Water cycle', branches: [{ text: 'Evaporation', children: [{ text: 'Heat from Sun' }] }, { text: 'Condensation', children: [{ text: 'Clouds form' }] }, { text: 'Precipitation' }, { text: 'Collection' }] }), route: 'gemini' };
  if (/interactive learning app|Change it as asked/.test(prompt)) return { text: '```html\n<!doctype html><html><head><style>body{font-family:sans-serif}</style></head><body><h3>Water travel</h3><input type="range" id="r" min="0" max="10" value="0"><div id="o">0</div><script>r.oninput=()=>{o.textContent=r.value;console.log("moved",r.value)};console.error("test error");try{parent.document.title}catch(e){console.warn("sandbox ok: "+e.name)}</script></body></html>\n```', route: 'openai' };
  return { text: 'A short explanation note.', route: 'gemini' };
}
export async function aiImage() {
  await new Promise(r => setTimeout(r, 200));
  const c = document.createElement('canvas'); c.width = 300; c.height = 200;
  const x = c.getContext('2d'); x.fillStyle = '#C8E6C9'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#2E7D32'; x.beginPath(); x.ellipse(150, 100, 90, 50, 0.3, 0, 7); x.fill();
  return { dataUrl: c.toDataURL('image/png'), model: 'stub' };
}
export async function transcribe() { return 'make a map about plants'; }
export async function uploadDataUrl() { throw new Error('storage refused in test'); }
export function aiRouteReport() { return []; }
