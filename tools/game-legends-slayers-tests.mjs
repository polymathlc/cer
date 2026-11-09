import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = slug => readFileSync(new URL(`../science-${slug}.html`, import.meta.url), 'utf8');
function fn(text, name) {
  const start=text.indexOf(`function ${name}(`);
  assert.ok(start>=0,`${name} exists`);
  let depth=0,open=text.indexOf('{',start);
  // The exercised mechanics have no brace-containing strings or templates.
  for(let i=open;i<text.length;i++){
    if(text[i]==='{')depth++;
    if(text[i]==='}'&&--depth===0)return text.slice(start,i+1);
  }
  throw Error(`Unclosed ${name}`);
}
function world(slug, functions){
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,style:{},classList:{add(){},remove(){},contains(){return false;}},getContext(){return {fillRect(){},beginPath(){},arc(){},fill(){}}},width:150,height:150});return nodes.get(id);};
  const state={G:{state:'play',player:{x:100,y:100,r:16,fx:0,fy:1,dashT:0,hp:100},evadeTrail:[],enemies:[],ap:10},
    keys:{w:true},joyVec:{on:true,x:1,y:0},mouse:{lDown:true,rDown:true},lowMotion:false,
    $:node,activeGameSurface:()=>true,failedCastFeedback:()=>{},overlayOpen:()=>false,moveInput:()=>({x:3,y:4}),ringFx(){},sfx(){},Event:class{},window:{dispatchEvent(){}},
    noteAction(n){state.G.ap-=n;if(state.G.ap===0)state.G.state='feed-loading';},
    nextDepth(){state.G.wave=(state.G.wave||1)+1;state.G.stairs=null;},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2,
    WORLD:{w:2300,h:2300},TILE:46,MAPW:50,MAPH:50,map:null,Math,Uint8Array};
  vm.createContext(state);if(slug==='legends'&&functions.includes('clearCombatInput')){state.skillGesture={};state.sceneRevision=0;vm.runInContext(fn(source(slug),'cancelSkillGesture')+'\n'+fn(source(slug),'invalidateScene'),state);}for(const f of functions)vm.runInContext(fn(source(slug),f),state);return state;
}
for(const slug of ['legends','slayers']){
  test(`${slug}: full shipped inline script parses`,()=>{const s=source(slug);new vm.Script(s.split('<script>')[1].split('</script>')[0]);});
  test(`${slug}: evade normalizes input, has a cooldown and cannot stack`,()=>{
    const w=world(slug,['evade']);assert.equal(w.evade(),true);assert.equal(w.G.player.evadeX,.6);assert.equal(w.G.player.evadeY,.8);assert.equal(w.G.player.evadeCd,5);assert.equal(w.evade(),false);assert.equal(w.G.ap,slug==='slayers'?9:10);
  });
  test(`${slug}: evade uses facing when stationary and respects class dash, pause and loading`,()=>{
    const w=world(slug,['evade']);w.moveInput=()=>({x:0,y:0});w.G.player.dashT=.1;assert.equal(w.evade(),false);w.G.player.dashT=0;w.overlayOpen=()=>true;assert.equal(w.evade(),false);w.overlayOpen=()=>false;w.G.state='feed-loading';assert.equal(w.evade(),false);w.G.state='play';assert.equal(w.evade(),true);assert.equal(w.G.player.evadeY,1);
  });
  test(`${slug}: opening overlays resets mouse, joystick, keyboard and queued movement`,()=>{
    const w=world(slug,['clearCombatInput','show','hide']);w.G.moveTarget={x:4,y:5};w.G.atkTarget={};w.show('pauseOverlay');assert.deepEqual(Object.keys(w.keys),[]);assert.equal(w.joyVec.on,false);assert.equal(w.mouse.rDown,false);assert.equal(w.mouse.lDown,false);assert.equal(w.G.moveTarget,null);assert.equal(w.G.atkTarget,null);
    if(slug==='legends'){assert.equal(w.skillGesture,null);assert.equal(w.sceneRevision,1);w.hide('pauseOverlay');assert.equal(w.sceneRevision,2);}
  });
  test(`${slug}: charge warning commits the direction before the enemy moves`,()=>{
    const w=world(slug,['lockCharge']);const e={speed:100};w.lockCharge(e,3,4);assert.equal(e.chargeSt,1);assert.equal(e.chargeT,.7);assert.equal(e.cvx,276);assert.equal(e.cvy,368);
    const update=fn(source(slug),'updateEnemies');const windup=update.slice(update.indexOf('e.chargeSt === 1'),update.indexOf('e.chargeSt === 1')+260);assert.ok(!windup.includes('cvx = dx'),'telegraph must not retarget at launch');
  });
  test(`${slug}: evade lasts 0.2 seconds and travels at most 130 units`,()=>{
    const w=world(slug,['moveEvade']);w.moveActor=(p,dx,dy)=>{p.x+=dx;p.y+=dy;};Object.assign(w.G.player,{evadeT:.2,evadeX:1,evadeY:0});for(let i=0;i<5;i++)w.moveEvade(w.G.player,.05);assert.ok(Math.abs(w.G.player.x-230)<.0001);assert.equal(w.G.player.evadeT,0);
  });
  test(`${slug}: evasion prevents hits without granting a shield or reward`,()=>{
    const w=world(slug,['hurtPlayer']);w.G.player.evadeT=.1;w.hurtPlayer(50);assert.equal(w.G.player.hp,100);assert.equal(w.G.player.shield,undefined);assert.equal(w.G.gold,undefined);
  });
}
test('Slayers: evade reaching zero action points waits for the learning question',()=>{const w=world('slayers',['evade']);w.G.ap=1;assert.equal(w.evade(),false);assert.equal(w.G.ap,0);assert.equal(w.G.state,'feed-loading');assert.equal(w.G.player.evadeT,undefined);});
test('Slayers: stairs require proximity, active play and explicit confirmation',()=>{
  const w=world('slayers',['clearCombatInput','nearStairs','descend']);w.G.stairs={x:500,y:500};assert.equal(w.descend(),false);w.G.stairs={x:120,y:120};w.overlayOpen=()=>true;assert.equal(w.descend(),false);w.overlayOpen=()=>false;assert.equal(w.descend(),true);assert.equal(w.G.wave,2);assert.equal(w.descend(),false);
});
test('Slayers: movement cannot automatically abandon the current floor',()=>{const w=world('slayers',['nearStairs','doSpawning']);w.G.stairs={x:100,y:100};w.doSpawning(.1);assert.equal(w.G.wave,undefined);assert.equal(w.$('descendBtn').hidden,false);});
test('Slayers: minimap sight does not reveal rooms through walls',()=>{
  const w=world('slayers',['revealDungeon']);w.MAPW=w.MAPH=12;w.TILE=10;w.map=new Uint8Array(144);for(let y=0;y<12;y++)w.map[y*12+6]=1;w.G.player={x:45,y:55};w.revealDungeon();assert.equal(w.G.explored[5*12+5],1);assert.equal(w.G.explored[5*12+6],1);assert.equal(w.G.explored[5*12+7],0);assert.equal(w.G.explored[5*12+9],0);
});
test('Slayers: dodge uses collision-aware movement even with a long frame',()=>{
  const w=world('slayers',['solidAt','moveActor','moveEvade']);w.TILE=46;w.map=new Uint8Array(2500);w.map[2*50+3]=1;Object.assign(w.G.player,{x:118,y:110,evadeT:.2,evadeX:1,evadeY:0});w.moveEvade(w.G.player,.05);assert.equal(w.G.player.x,118);
});

function gamePortal(legends, roster = []) {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bridgeStart = app.indexOf("window.addEventListener('message'", app.indexOf('async function _sdQuestionsPayload('));
  const bridge = app.slice(bridgeStart, app.indexOf('\n});', bridgeStart) + 4);
  const helpers = ['_scienceFeedGameMessageCurrent', '_isEmbeddedGameWindow', '_legendsMessageCurrent',
    '_legendsGearScope', '_sendLegendsMeta', '_legendsGoldDelta', '_legendsSaveMeta'].map(name => fn(app, name));
  const reportHandlers = app.slice(app.indexOf('const FLAG_DAILY_LIMIT ='), app.indexOf('// Students get a shared daily pool of GAME CREDITS'));
  const state = { studentKey: 'student-a', studentLevel: 'P4', replies: [], writes: 0,
    reports: [], ownFlags: [], beforeFlagRead: async () => {}, save: async () => true, hero: { legends, gold: 400 } };
  const origin = 'https://portal.test';
  const frames = Object.fromEntries(['legendsFrame', 'slayersFrame', 'defendersFrame'].map(id => [id, {
    postMessage(data, targetOrigin) { state.replies.push({ id, data: structuredClone(data), targetOrigin }); }
  }]));
  let listener;
  const gearSaves = app.match(/^const _legendsGearSaves = .*;$/m)[0];
  vm.runInNewContext(helpers.join('\n') + '\n' + gearSaves + '\n' + reportHandlers + '\n' + bridge, {
    window: { addEventListener(_, callback) { listener = callback; } }, location: { origin },
    document: { getElementById(id) { return frames[id] ? { contentWindow: frames[id] } : null; } },
    _scienceFeedKey: profile => profile?.key || state.studentKey, _scienceFeedGameLevel: () => state.studentLevel,
    famStudents: () => roster, rpgState: state.hero, rpgSave() { state.writes++; return state.save(); },
    currentUser: { uid: 'family-uid', role: 'student', name: 'Learner A', email: 'learner@example.test' },
    db: {}, collection: (_, name) => name, query: (...parts) => parts, where: (...parts) => parts,
    async getDocs() {
      await state.beforeFlagRead();
      return { forEach: visit => state.reports.forEach(report => visit({ data: () => report })) };
    },
    async addDoc(name, report) {
      assert.equal(name, 'flaggedQuestions');
      state.reports.push(structuredClone(report));
    },
    Timestamp: { now: () => new Date() },
    _scienceFeedSources: () => [{ id: 'water', title: 'Which part of a plant absorbs water?' }],
    questionQualitySignature: question => 'visible:' + question.id,
    _scienceFeedFlagOwn: (...args) => state.ownFlags.push(args)
  });
  function send(data, source = frames.legendsFrame, senderOrigin = origin) {
    listener({ data, source, origin: senderOrigin });
  }
  return { state, frames, origin, send };
}

const legendsClient = 'a'.repeat(32), slayersClient = 'b'.repeat(32);
test('Shared Armory saves preserve older gear and concurrent drops from both game frames', () => {
  const legacy = Array.from({ length: 105 }, (_, index) => ({
    id: 'old-' + index, name: 'Old helm ' + index, slot: 'helm', r: 'mythic', af: { hp: 12 }
  }));
  const f = gamePortal({ inv: legacy, eq: { helm: 'old-0' }, loadout: { barb: ['cleave'] }, ts: 1 });
  const owner = { studentKey: 'student-a', studentLevel: 'P4' };
  const mythic = { id: 'boss-loot', name: 'Mythic blade', slot: 'onehand', r: 'mythic', signature: 'named-blade', af: { dmg: 9 } };
  const slayerDrop = { id: 'slayer-loot', name: 'Ancient helm', slot: 'helm', r: 'rare', af: { hp: 24 } };
  f.send({ type: 'LEGENDS_SAVE', ...owner, client: legendsClient, seq: 1, patch: { add: [mythic], eq: { mainhand: mythic.id } } });
  f.send({ type: 'LEGENDS_SAVE', ...owner, client: slayersClient, seq: 1, patch: { add: [slayerDrop], eq: { helm: slayerDrop.id } } }, f.frames.slayersFrame);
  assert.equal(f.state.hero.legends.inv.length, 107);
  assert.deepEqual(f.state.hero.legends.inv.find(item => item.id === mythic.id), mythic);
  assert.equal(f.state.hero.legends.eq.mainhand, mythic.id);
  assert.equal(f.state.hero.legends.eq.helm, slayerDrop.id);
  assert.equal(f.state.hero.legends.loadout.barb[0], 'cleave');

  f.send({ type: 'LEGENDS_SAVE', ...owner, client: slayersClient, seq: 2, patch: { remove: [slayerDrop.id] } }, f.frames.slayersFrame);
  f.send({ type: 'LEGENDS_SAVE', ...owner, meta: { inv: legacy.concat(slayerDrop), ts: Date.now() } });
  assert.equal(f.state.hero.legends.inv.length, 106);
  assert.ok(!f.state.hero.legends.inv.some(item => item.id === slayerDrop.id));
  assert.equal(f.state.hero.legends.eq.helm, null);
  assert.equal(f.state.hero.legends.eq.mainhand, mythic.id);
  assert.equal(f.state.writes, 3, 'A full snapshot cannot override the authoritative inventory');
  assert.deepEqual(new Set(f.state.replies.map(reply => reply.id)), new Set(['legendsFrame', 'slayersFrame']));
  assert.ok(f.state.replies.every(({ data, targetOrigin }) => targetOrigin === f.origin && data.studentKey === owner.studentKey && data.studentLevel === owner.studentLevel));
});

test('Family Armories isolate siblings and replay a lost drop receipt without reviving a salvaged item', async () => {
  const primary = { studentKey: 'student-a', studentLevel: 'P4' };
  const younger = { studentKey: 'student-b', studentLevel: 'P3' };
  const legacy = { id: 'legacy-helm', slot: 'helm' };
  const item = { id: 'mythic-drop', slot: 'onehand', signature: 'named-blade' };
  const f = gamePortal({ inv: [legacy], eq: { helm: legacy.id }, ts: 1 }, [{key: primary.studentKey}, {key: younger.studentKey}]);
  const { state, frames } = f;
  Object.assign(state, younger);
  f.send({ type: 'LEGENDS_REQUEST_META', ...younger });
  assert.equal(state.replies.at(-1).data.legacy, false);
  assert.deepEqual(state.replies.at(-1).data.meta, {});
  assert.equal(state.hero.legends, undefined);
  assert.deepEqual(state.hero.legendsByLearner[primary.studentKey].inv, [legacy]);
  const youngerItem = { id: 'younger-drop', slot: 'pants' };
  f.send({ type: 'LEGENDS_SAVE', ...younger, client: slayersClient, seq: 1, patch: { add: [youngerItem] } }, frames.slayersFrame);
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(state.hero.legendsByLearner[younger.studentKey].inv), [youngerItem]);

  Object.assign(state, primary);
  let resolveSave;
  state.save = () => new Promise(resolve => { resolveSave = resolve; });
  const drop = { type: 'LEGENDS_SAVE', ...primary, client: legendsClient, seq: 1, patch: { add: [item] } };
  f.send(drop);
  assert.deepEqual(Array.from(state.hero.legendsByLearner[primary.studentKey].inv), [legacy, item]);
  const messagesBeforeSwitch = state.replies.length;
  Object.assign(state, younger);
  resolveSave(true);
  await new Promise(setImmediate);
  assert.equal(state.replies.length, messagesBeforeSwitch, 'A delayed receipt cannot publish a previous learner’s gear');
  f.send(drop);
  assert.equal(state.replies.length, messagesBeforeSwitch, 'A stale sender cannot replay its queue under a sibling');

  Object.assign(state, primary);
  state.save = async () => true;
  f.send({ type: 'LEGENDS_SAVE', ...primary, client: slayersClient, seq: 1, patch: { remove: [item.id] } }, frames.slayersFrame);
  f.send(drop);
  await new Promise(setImmediate);
  assert.deepEqual(state.replies.at(-1).data.receipt, { client: legendsClient, seq: 1 });
  assert.deepEqual(Array.from(state.hero.legendsByLearner[primary.studentKey].inv), [legacy]);
  assert.deepEqual(Array.from(state.hero.legendsByLearner[younger.studentKey].inv), [youngerItem]);
  assert.equal(state.hero.legendsByLearner[primary.studentKey].eq.helm, legacy.id);
});

test('Shared Armory requires the known frame, origin, learner and level before reading or writing', () => {
  const f = gamePortal({ inv: [] });
  const owner = { studentKey: 'student-a', studentLevel: 'P4' };
  const messages = [
    { type: 'LEGENDS_REQUEST_META' },
    { type: 'LEGENDS_SAVE', client: legendsClient, seq: 1, patch: { add: [{ id: 'stale' }] } },
    { type: 'LEGENDS_GOLD_DELTA', delta: 25, reason: 'salvage' }
  ];
  for (const message of messages) {
    f.send(message);
    f.send({ ...message, ...owner }, f.frames.defendersFrame);
    f.send({ ...message, ...owner }, {});
    f.send({ ...message, ...owner }, f.frames.slayersFrame, 'https://foreign.test');
    f.send({ ...message, ...owner, studentKey: 'student-before-switch' });
    f.send({ ...message, ...owner, studentLevel: 'P3' });
  }
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.replies.length, 0);
  assert.equal(f.state.hero.gold, 400);
  assert.equal(f.state.hero.legends.inv.length, 0);
  f.send({ type: 'LEGENDS_REQUEST_META', ...owner }, f.frames.slayersFrame);
  assert.equal(f.state.replies[0].data.type, 'LEGENDS_META');
  assert.equal(f.state.replies[0].targetOrigin, f.origin);
});

const report = {
  type: 'SD_FLAG', mode: 'legends', requestId: 'report-1', questionId: 'water', questionTitle: 'Fixture title',
  studentKey: 'student-a', studentLevel: 'P4', comment: 'The wording of option 1 is ambiguous.'
};
const settleMessages = () => new Promise(resolve => setImmediate(resolve));

test('Game flag retries share one teacher report and return exactly bound acknowledgements', async () => {
  const f = gamePortal({ inv: [] });
  f.send(report, f.frames.legendsFrame, 'https://foreign.test');
  f.send(report, f.frames.slayersFrame);
  f.send({ ...report, studentKey: 'previous-learner' });
  f.send(report);
  f.send(report);
  await settleMessages();
  assert.equal(f.state.reports.length, 1);
  assert.equal(f.state.reports[0].comment, '[Science Legends] ' + report.comment);
  assert.equal(f.state.reports[0].questionTitle, 'Which part of a plant absorbs water?');
  assert.equal(f.state.reports[0].status, 'open');
  assert.deepEqual(f.state.ownFlags, [['water', 'visible:water', 'student-a', false]], 'The current question is not invalidated');
  assert.equal(f.state.replies.length, 2);
  for (const reply of f.state.replies) {
    assert.equal(reply.targetOrigin, f.origin);
    assert.deepEqual(reply.data, { type: 'SD_FLAG_RESULT', requestId: report.requestId, questionId: report.questionId,
      studentKey: report.studentKey, studentLevel: report.studentLevel, ok: true });
  }
});

test('Game reports recheck the learner after the asynchronous limit read', async () => {
  const f = gamePortal({ inv: [] });
  const reading = Promise.withResolvers(), release = Promise.withResolvers();
  f.state.beforeFlagRead = () => { reading.resolve(); return release.promise; };
  f.send(report);
  await reading.promise;
  f.state.studentKey = 'student-b';
  f.state.studentLevel = 'P3';
  release.resolve();
  await settleMessages();
  assert.equal(f.state.reports.length, 0);
  assert.equal(f.state.ownFlags.length, 0);
  assert.equal(f.state.replies.length, 1);
  assert.equal(f.state.replies[0].data.studentKey, 'student-a');
  assert.equal(f.state.replies[0].data.studentLevel, 'P4');
  assert.equal(f.state.replies[0].data.ok, false);
});

test('Simultaneous game reports share the daily limit across modes', async () => {
  const f = gamePortal({ inv: [] });
  for (let i = 0; i < 11; i++) {
    if (i % 2) f.send({ ...report, requestId: 'batch-' + i, mode: 'slayers' }, f.frames.slayersFrame);
    else f.send({ ...report, requestId: 'batch-' + i });
  }
  await settleMessages();
  assert.equal(f.state.reports.length, 10);
  assert.equal(f.state.replies.length, 11);
  assert.match(f.state.replies.at(-1).data.message, /Daily flag limit reached/);
});
