import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../science-spire.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function section(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return source.slice(start,end);}
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const line=source.indexOf('\n',start);return source.slice(start,source.slice(start,line).trimEnd().endsWith('}')?line:source.indexOf('\n}',start)+2);}
function element(){
  const classes=new Set(),node={children:[],style:{},textContent:'',onclick:null,classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n)},appendChild(n){this.children.push(n);},querySelectorAll(){return[];}};
  Object.defineProperty(node,'innerHTML',{get(){return '';},set(){node.children=[];}});return node;
}
function harness(){
  const nodes=new Map(),messages=[],events={questions:0};
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const api=new Function('$','nodes','messages','events',`
    const document={createElement:()=>$.create(),querySelectorAll:()=>Array.from(nodes.entries()).filter(([id])=>id.endsWith('Overlay')).map(([,node])=>node)};
    const window={parent:{postMessage:message=>messages.push(message)}},location={origin:'https://science.test'};
    const scienceFeed={context:()=>({studentKey:'child',studentLevel:'P4'})},embedded=()=>true;
    const show=id=>$(id).classList.add('show'),hide=id=>$(id).classList.remove('show');
    const toast=()=>{},banner=()=>{},addLog=()=>{},render=()=>{},updateHud=()=>{};
    const randint=(a,b)=>a,choice=a=>a[0],shuffle=a=>a;
    const cardEl=id=>Object.assign($.create(),{id});
    const askQuestion=()=>{events.questions++;G.state='question';},beginCombat=()=>{G.state='combat';};
    const openTreasurePack=()=>{G.state='pack';show('packOverlay');};
    const healPlayer=n=>{G.player.hp=Math.min(G.player.maxHp,G.player.hp+n);};
    let _selCard=null,scienceFeedOpening=false,CUSTOM_DECK=null;
    ${section('var CARDS =','/* ============================ ENEMIES')}
    ${section('var ENEMIES =','/* ===================== ANIMATED BESTIARY')}
    ${section('var HEROES =','function spriteSvg(')}
    ${section('var G = null','/* ============================ COMBAT')}
    ${fn('spireRunCurrent')}
    ${fn('startNode')}
    ${fn('spawnEnemies')}
    ${section('function winCombat(','/* ============================ QUESTION')}
    ${fn('finishTreasure')}
    ${fn('leaveRest')}
    ${section('/* ============================ END STATES','/* ============================ DECK / MAP VIEW')}
    ${fn('showMap')}
    return {newRun,get:()=>G,buildMap,winCombat,afterReward,nextNode,startNode,score,reportScore,finishRun,gameOver,finishTreasure,leaveRest,spawnEnemies,showMap,definitions:ENEMIES};
  `)(Object.assign($,{create:element}),nodes,messages,events);
  api.newRun();return {api,nodes,$,messages,events};
}
function combatAt(api,floor){const g=api.get();g.floor=floor;g.map=api.buildMap(floor-Math.floor((floor-1)%12));g.node=(floor-1)%12;g.pendingRoom=g.map[g.node];g.state='combat';g.enemies=[{dead:true}];return g;}

test('Spire: bosses at Floors 12 and 24 reward and continue the same paid climb',()=>{
  const {api,$}=harness(),g=combatAt(api,12);g.player.hp=20;g.gold=100;g.kills=17;g.deck=['strike','guard'];
  const identity=g.feedContext,deck=g.deck,hp=g.player.hp;
  api.winCombat();assert.equal(g.state,'reward');assert.equal(g.maxFloor,12);assert.ok(g.gold>=150);assert.equal(g.player.hp,Math.min(g.player.maxHp,hp+Math.round(g.player.maxHp*.3)));
  api.afterReward();assert.equal(api.get(),g);assert.equal(g.floor,13);assert.equal(g.node,0);assert.equal(g.map[0].floor,13);assert.equal(g.state,'question');assert.equal(g.feedContext,identity);assert.equal(g.deck,deck);assert.equal(g.kills,17);assert.equal($('overOverlay').classList.contains('show'),false);
  combatAt(api,24);api.winCombat();api.afterReward();assert.equal(g.floor,25);assert.equal(g.map[0].floor,25);assert.equal(g.maxFloor,24);
});

test('Spire: 240 cleared floors retain only the current chapter and count every room',()=>{
  const {api,events}=harness(),g=api.get();
  for(let floor=1;floor<=240;floor++){
    assert.equal(g.floor,floor);assert.equal(g.map.length,12);assert.equal(g.map[g.node].floor,floor);
    const room=g.map[g.node];g.state=['rest','treasure'].includes(room.type)?(room.type==='rest'?'rest':'pack'):'combat';
    if(g.state==='combat'){api.winCombat();api.afterReward();}else if(g.state==='rest')api.leaveRest(true);else api.finishTreasure();
    assert.equal(g.maxFloor,floor);assert.equal(g.floor,floor+1);assert.notEqual(g.state,'over');
  }
  assert.equal(g.floor,241);assert.equal(g.map[0].floor,241);assert.equal(g.map.at(-1).type,'boss');assert.ok(events.questions>100);
});

test('Spire: repeated win and stale reward clicks cannot pay or advance twice',()=>{
  const {api,$}=harness(),g=combatAt(api,12);api.winCombat();const gold=g.gold,hp=g.player.hp,oldChoice=$('rewardCards').children[0].onclick;
  api.winCombat();assert.equal(g.gold,gold);assert.equal(g.player.hp,hp);
  oldChoice();const deckLength=g.deck.length;oldChoice();api.afterReward();api.nextNode();
  assert.equal(g.deck.length,deckLength);assert.equal(g.floor,13);assert.equal(g.node,0);
  combatAt(api,24);api.winCombat();oldChoice();assert.equal(g.floor,24);assert.equal(g.deck.length,deckLength);assert.equal(g.state,'reward');
});

test('Spire: unfinished rooms cannot advance or score as cleared',()=>{
  const {api,messages}=harness(),g=api.get();g.state='question';api.nextNode();assert.equal(g.floor,1);assert.equal(g.maxFloor,0);assert.equal(messages.length,0);
});

test('Spire: treasure and rest rewards apply once and count their cleared floors',()=>{
  const {api}=harness(),g=combatAt(api,3);g.state='pack';const cards=g.deck.length;api.finishTreasure('guard');
  assert.equal(g.floor,3,'A treasure card cannot be claimed before opening its pack');
  g.map[g.node].packOpened=true;api.finishTreasure('guard');api.finishTreasure('guard');
  assert.equal(g.floor,4);assert.equal(g.maxFloor,3);assert.equal(g.deck.length,cards+1);
  combatAt(api,5);g.state='rest';g.player.hp=10;const expected=10+Math.round(g.player.maxHp*.3);api.leaveRest(true);api.leaveRest(true);
  assert.equal(g.floor,6);assert.equal(g.maxFloor,5);assert.equal(g.player.hp,expected);
});

test('Spire: loss and deliberate finish retain cleared-floor scores with no summit bonus',()=>{
  for(const defeated of [false,true]){
    const {api,$,messages}=harness(),g=combatAt(api,13);g.maxFloor=12;g.kills=20;g.gold=80;g.player.hp=defeated?0:30;$('qOverlay').classList.add('show');
    if(defeated)api.gameOver();else api.finishRun();
    assert.equal(g.state,'over');assert.equal($('qOverlay').classList.contains('show'),false);assert.equal($('overOverlay').classList.contains('show'),true);
    assert.equal(messages.at(-1).score,12*120+20*15+80);assert.match(messages.at(-1).label,/12/);const count=messages.length;
    api.finishRun();api.gameOver();assert.equal(messages.length,count);assert.equal(g.floor,13);
  }
});

test('Spire: later chapter attacks and blocks scale without mutating enemy templates',()=>{
  const {api}=harness(),g=api.get(),original=structuredClone(api.definitions);
  g.floor=1;const first=api.spawnEnemies('boss')[0];assert.deepEqual(first.moves,original.titan.moves);
  g.floor=13;const second=api.spawnEnemies('boss')[0];g.floor=25;const third=api.spawnEnemies('boss')[0];
  assert.ok(second.hp>first.hp);assert.ok(third.hp>second.hp);assert.ok(second.moves[0].value>first.moves[0].value);assert.ok(second.moves[1].value>first.moves[1].value);assert.ok(third.moves[0].value>second.moves[0].value);
  second.moves[0].value=999;assert.deepEqual(api.definitions,original);assert.deepEqual(first.moves,original.titan.moves);assert.notEqual(third.moves[0].value,999);
});

test('Spire: the map displays absolute floors after several chapters',()=>{
  const {api,$}=harness(),g=combatAt(api,121);api.showMap();const rows=$('mapList').children;
  assert.equal(rows.length,12);assert.match(rows[0].textContent,/121/);assert.match(rows.at(-1).textContent,/132/);assert.match(rows.at(-1).textContent,/Boss/);assert.equal(g.floor,121);
});
