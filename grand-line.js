import {CHARACTERS,CHARACTER_BY_ID,ENCOUNTERS,STARTER_IDS,PACK_ODDS,createCollection,normalizeCollection,statsFor,setTeam,createBattle,getActiveUnit,getValidTargets,act,chooseDefend,advanceBattle,completeLearning} from './grand-line-core.js?v=1.0.0';
import {createArtManager,createBattleRenderer} from './grand-line-render.js?v=1.0.0';

const $=id=>document.getElementById(id);
const embedded=parent!==window,params=new URLSearchParams(location.search),origin=location.origin;
const art=createArtManager(),renderer=createBattleRenderer($('battle-canvas'),art);
const RARITIES=['','Common','Uncommon','Rare','Epic','Legendary','Mythic','Galaxy'];
const GLYPHS={punch:'✦',slash:'╱',lightning:'ϟ',fire:'♨',ice:'❄',water:'≈',heal:'✚',shield:'⬡',earth:'◈',poison:'●',dark:'◉',soul:'♬',wind:'≋',light:'☀',plant:'❧',dragon:'✧',gravity:'◎',magnet:'∩',explosion:'✷',smoke:'☁',string:'⌘',sand:'⁙',revive:'✥'};
const uuid=prefix=>prefix+'-'+(crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const format=n=>Number.isFinite(n)?Math.floor(n).toLocaleString():'—';
const displayName=c=>c.id==='luffy'?'Luffy':c.id==='whitebeard'?'Whitebeard':c.id==='akainu'?'Akainu':c.id==='kaido'?'Kaido':c.name;
let collection=createCollection(),wallet={available:false,balance:0,currency:'points',offers:[]};
let subject=params.get('subject')?.toLowerCase()==='science'?'Science':'Math',scope='preview',sessionId='',helloId='',ready=!embedded;
let settings={muted:false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
let view='collection',dialog='',battle=null,selectedSlot=null,selectedSkill='',selectedTarget='',lastActor='',busyUntil=0,wasBusy=false;
let lastOutcome='',bannerUntil=0,enemyAt=0,bridgeRound=0,learningPending=null,savePending=null,purchasePending=null;
let selectedPack='spark',toastTimer=0,helloTimer=0,audioContext=null,questionSession=null,initialFocus=null,unsavedLearning=false;
const storageKey=()=>`grand-line.v1:${subject.toLowerCase()}:${scope}`;
const pendingKey=()=>storageKey()+':purchase';
const current=()=>ready&&(!embedded||!!sessionId);
const busy=()=>performance.now()<busyUntil||!!savePending||unsavedLearning||!!dialog||!current()||document.hidden;
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,className='subtle')=>{const n=el('button',className,text);n.type='button';n.onclick=fn;return n;};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3400);}
function post(message){if(embedded)parent.postMessage(message,origin);}
function localGet(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
function localSet(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
function loadPreferences(){const old=localGet(storageKey());for(const k of Object.keys(settings))if(typeof old?.settings?.[k]==='boolean')settings[k]=old.settings[k];if(!embedded)collection=normalizeCollection(old?.collection);settingsUI();}
function savePreferences(){localSet(storageKey(),{settings,...(!embedded?{collection}:{})});}
function sound(kind='click'){
  if(settings.muted||document.hidden)return;
  try{audioContext ||=new(window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});const now=audioContext.currentTime;
    const tones=kind==='reveal'?[261.6,329.6,392,523.2]:kind==='apex'?[130.8,196,261.6,392,523.2,783.9]:kind==='skill'?[185,270]:kind==='win'?[392,494,587]:[440];
    tones.forEach((hz,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type=kind==='skill'?'triangle':'sine';o.frequency.setValueAtTime(hz,now+i*.085);g.gain.setValueAtTime(0,now);g.gain.setValueAtTime(.045,now+i*.085);g.gain.exponentialRampToValueAtTime(.001,now+i*.085+.35);o.connect(g).connect(audioContext.destination);o.start(now+i*.085);o.stop(now+i*.085+.37);o.onended=()=>{o.disconnect();g.disconnect();};});
  }catch(_){}
}
function settingsUI(){document.documentElement.classList.toggle('reduced-motion',settings.reducedMotion);$('sound-button').textContent=settings.muted?'♩':'♪';$('sound-button').setAttribute('aria-pressed',String(settings.muted));$('sound-button').setAttribute('aria-label',settings.muted?'Turn sound on':'Mute sound');}
function applySnapshot(data){
  if(data?.collection){collection=normalizeCollection(data.collection);if(battle)battle.collection=collection;}
  if(data?.wallet){const w=data.wallet;wallet={available:w.available===true,balance:Number.isFinite(w.balance)?Math.max(0,Math.floor(w.balance)):0,currency:'points',offers:(Array.isArray(w.offers)?w.offers:[]).filter(o=>typeof o.id==='string'&&Number.isSafeInteger(o.cost)&&o.cost>0&&o.odds&&typeof o.odds==='object')};}
  renderCounters();if(view==='packs')renderPacks();if(view==='collection')renderCollection();if(view==='crew')renderCrew();if(view==='campaign')renderCampaign();
}
function connection(message,blocked=false){$('connection').hidden=!message;$('connection').textContent=message;if(blocked){ready=false;wallet.available=false;}renderCounters();}
function renderCounters(){
  const owned=Object.keys(collection.cards).filter(id=>CHARACTER_BY_ID[id]&&collection.cards[id].copies>0).length;
  $('collection-count').textContent=`${owned} / 50`;$('packs-count').textContent=embedded?`${format(wallet.balance)} points`:'Preview';
  $('subject-tag').textContent=embedded?`${subject.toUpperCase()} · ${ready?'CONNECTED':'CONNECTING'}`:`${subject.toUpperCase()} PREVIEW`;
  $('learning-progress').textContent=embedded?`${format(wallet.balance)} ${subject} points · One card per pack`:'Preview · Sign in to Math or Science to buy cards';
  $('collection-summary').textContent=`${owned} / 50 unlocked · ${format(collection.stats.packsOpened)} packs opened`;
}
function card(character,{eager=false,inspect=true,owned=!!collection.cards[character.id],copies=collection.cards[character.id]?.copies||0}={}){
  const c=character,n=el(inspect?'button':'div','tcg-card');if(inspect)n.type='button';n.dataset.character=c.id;n.dataset.stars=c.stars;n.dataset.owned=String(owned);
  n.setAttribute('aria-label',`${c.name}, ${c.stars} stars, ${RARITIES[c.stars]}, ${owned?`unlocked, ${copies} ${copies===1?'copy':'copies'}`:'not yet collected'}`);
  const inner=el('span','card-inner'),artNode=el('span','card-art');art.attach(artNode,c.id,eager);const heading=el('span','card-heading');heading.append(el('span','card-stars','★'.repeat(c.stars)),el('span','card-index',`GL • ${String(CHARACTERS.indexOf(c)+1).padStart(3,'0')}`));
  const text=el('span','card-copy');text.append(el('span','card-title',c.title),el('strong','card-name',displayName(c)));
  const bottom=el('span','card-bottom');bottom.append(el('span','',c.role.toUpperCase()),el('strong','',owned?'UNLOCKED':'DISCOVER'));text.append(bottom);
  inner.append(artNode,heading,text);if(copies>1)inner.append(el('span','card-level',`MERGE RANK ${statsFor(c.id,copies).rank} · ${copies} COPIES`));
  n.append(inner,el('i','card-corner nw'),el('i','card-corner se'));if(inspect)n.onclick=()=>inspectCard(c.id);return n;
}
function renderCollection(){
  const query=$('search-input').value.trim().toLowerCase(),filter=$('ownership-filter').value,stars=$('star-filter').value,sort=$('sort-filter').value;
  let rows=CHARACTERS.filter(c=>(!query||[c.name,c.title,c.description,c.element,...c.skills.map(s=>s.name)].join(' ').toLowerCase().includes(query))&&(stars==='all'||c.stars===Number(stars))&&(filter==='all'||(filter==='owned')===!!collection.cards[c.id]));
  if(sort==='rarity')rows=rows.slice().sort((a,b)=>b.stars-a.stars||a.name.localeCompare(b.name));if(sort==='name')rows=rows.slice().sort((a,b)=>a.name.localeCompare(b.name));if(sort==='merge')rows=rows.slice().sort((a,b)=>(collection.cards[b.id]?.copies||0)-(collection.cards[a.id]?.copies||0));
  $('card-grid').replaceChildren(...rows.map(c=>card(c)));$('empty-collection').hidden=!!rows.length;
}
function go(next){
  if(!['collection','crew','campaign','packs','battle'].includes(next))return;
  if(next!=='battle'&&(unsavedLearning||savePending)){toast('Please wait for your progress to finish saving.');return;}
  if(battle&&view==='battle'&&next!=='battle'&&!['victory','defeat'].includes(battle.status)){retreat(()=>go(next));return;}
  view=next;for(const n of document.querySelectorAll('.view'))n.hidden=n.id!==`${next}-view`;
  for(const n of document.querySelectorAll('[data-view]')){if(n.dataset.view===next)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');}
  $('game-footer').hidden=next==='battle';if(next==='collection')renderCollection();if(next==='crew')renderCrew();if(next==='campaign')renderCampaign();if(next==='packs')renderPacks();
  if(next==='battle'){renderer.resize();renderBattle();}window.scrollTo({top:0,behavior:'instant'});
}
function openDialog(kind,title){
  if(!dialog)initialFocus=document.activeElement;dialog=kind;$('dialog-layer').hidden=false;const panel=$('dialog-panel');panel.className='dialog-panel';panel.replaceChildren();const h=el('h1','',title);h.id='dialog-title';panel.append(h);
  if(kind!=='question')panel.append(button('×',closeDialog,'dialog-close'));
  requestAnimationFrame(()=>panel.querySelector('button:not(:disabled)')?.focus());return panel;
}
function closeDialog(){if(dialog==='question'&&questionSession||dialog==='save-progress'&&unsavedLearning)return;dialog='';$('dialog-layer').hidden=true;$('dialog-panel').replaceChildren();if(initialFocus?.isConnected)initialFocus.focus({preventScroll:true});initialFocus=null;enemyAt=performance.now()+650;if(view==='battle')renderBattle();}
function inspectCard(id){
  const c=CHARACTER_BY_ID[id];if(!c)return;const panel=openDialog('card',c.name);panel.querySelector('h1').remove();const layout=el('div','card-detail'),copy=el('div','detail-copy');
  const owned=collection.cards[id],stats=statsFor(id,owned?.copies||1);layout.append(card(c,{inspect:false,eager:true}));copy.append(el('p','eyebrow',`${RARITIES[c.stars]} · ${c.stars} STARS · ${c.role.toUpperCase()}`));const title=el('h1','',c.name);title.id='dialog-title';copy.append(title,el('p','',c.description));
  const statRow=el('div','detail-stats');for(const [label,value]of[['LIFE',stats.hp],['ATTACK',stats.attack],['DEFENSE',stats.defense],['SPEED',stats.speed]]){const item=el('span');item.append(el('b','',value),document.createTextNode(label));statRow.append(item);}copy.append(statRow);
  for(const skill of c.skills){const n=el('div','skill-description');n.style.setProperty('--skill-color',skill.color);n.append(el('h3','',`${GLYPHS[skill.kind]||'✧'} ${skill.name}`),el('p','',skill.description),el('small','',`${skill.cost} Spirit · ${skill.cooldown?skill.cooldown+' own-turn cooldown':'Always available'}`));copy.append(n);}
  const passive=el('div','skill-description');passive.append(el('h3','',`Passive · ${c.passive.name}`),el('p','',c.passive.description));copy.append(passive);
  copy.append(el('p','merge-note',owned?`${owned.copies} ${owned.copies===1?'copy':'copies'} · Merge rank ${stats.rank}. ${stats.rank>=10?'Maximum merge rank.':`Next rank at ${2**(stats.rank+1)} total copies. Duplicates merge automatically.`}`:'Not yet collected. Find this character in a single-card pack to unlock the battle avatar.'));
  if(owned){const add=button(collection.team.includes(id)?'Already in your crew':'Add to my crew',()=>replaceMenu(id),'gold-button');add.disabled=collection.team.includes(id)||!current()||!!battle&&!['victory','defeat'].includes(battle.status);copy.append(add);}else copy.append(button('View card packs',()=>{closeDialog();go('packs');},'gold-button'));
  layout.append(copy);panel.append(layout);
}
function renderCrew(){
  $('crew-slots').replaceChildren(...collection.team.map((id,index)=>{const slot=el('div','crew-slot'+(selectedSlot===index?' selected':''));slot.append(card(CHARACTER_BY_ID[id]),button(`SLOT ${index+1} · CHANGE`,()=>{selectedSlot=index;renderCrew();$('crew-picker-heading').scrollIntoView({behavior:settings.reducedMotion?'instant':'smooth',block:'center'});},'text-button'));return slot;}));
  $('crew-picker-heading').textContent=selectedSlot===null?'Your unlocked characters':`Choose a character for slot ${selectedSlot+1}`;
  const owned=CHARACTERS.filter(c=>collection.cards[c.id]);$('crew-count').textContent=`${owned.length} unlocked · 5 crew slots`;
  $('crew-picker').replaceChildren(...owned.map(c=>{const n=card(c);n.onclick=()=>selectedSlot===null?inspectCard(c.id):changeTeam(selectedSlot,c.id);return n;}));
}
function replaceMenu(id){const panel=openDialog('replace','Choose a crew slot');panel.append(el('p','',`${CHARACTER_BY_ID[id].name} will replace the selected character. Your previous card stays in the collection.`));const grid=el('div','replace-grid');collection.team.forEach((current,index)=>{const n=button('',()=>changeTeam(index,id));n.append(el('span','',`Slot ${index+1}`),document.createTextNode(displayName(CHARACTER_BY_ID[current])));grid.append(n);});panel.append(grid);}
async function changeTeam(index,id){
  if(!current()||savePending)return;
  if(collection.team.includes(id)&&collection.team[index]!==id){toast('That character is already in your crew. Choose a different character.');return;}
  const before=[...collection.team],next=[...before];next[index]=id;if(!setTeam(collection,next)){toast('Choose five different unlocked characters.');return;}
  selectedSlot=null;closeDialog();renderCrew();try{await persistCollection();toast(`${displayName(CHARACTER_BY_ID[id])} is ready to sail.`);}catch(error){collection.team=before;renderCrew();toast(error.message);}
}
function renderCampaign(){
  $('campaign-map').replaceChildren(...ENCOUNTERS.map(e=>{const locked=e.id>collection.unlockedEncounter,n=el('article','encounter');n.dataset.locked=String(locked);n.style.setProperty('--encounter-color',['#8ac7ca','#b998d5','#dd9584'][Math.ceil(e.id/3)-1]);n.append(el('span','chapter-number',String(e.id).padStart(2,'0')),el('p','eyebrow',`ACT ${Math.ceil(e.id/3)} · ENCOUNTER ${e.id}`),el('h2','',e.name),el('p','',e.description));const avatars=el('div','enemy-roster');for(const id of e.enemies){const medallion=el('div','enemy-medallion');medallion.title=CHARACTER_BY_ID[id].name;const image=el('div','card-art');art.attach(image,id);medallion.append(image);avatars.append(medallion);}n.append(avatars);if(collection.completed.includes(e.id))n.append(el('p','completed-tag','✓ Completed · Replay available'));const start=button(locked?`Complete encounter ${e.id-1} first`:'Battle with this crew →',()=>beginBattle(e.id),'gold-button');start.disabled=locked||!current()||!!savePending;n.append(start);return n;}));
}
function renderPacks(){
  $('pack-balance').textContent=embedded?format(wallet.balance):'—';const offer=wallet.offers.find(o=>o.id===selectedPack)||wallet.offers[0];if(offer)selectedPack=offer.id;
  $('pack-tiers').replaceChildren(...wallet.offers.map(o=>{const n=button('',()=>{selectedPack=o.id;renderPacks();});n.dataset.pack=o.id;n.setAttribute('aria-pressed',String(o.id===selectedPack));n.append(el('strong','',`${format(o.cost)} points`),document.createTextNode(o.name),el('small','',`ONE CARD · ${Math.min(...Object.keys(o.odds).filter(k=>Number(o.odds[k])>0).map(Number))}★+`));return n;}));
  $('open-pack').textContent=purchasePending?'Resume pending purchase':!embedded?'Sign in to buy packs':offer?`Buy ${offer.name} · ${format(offer.cost)} points`:'Shop unavailable';
  $('open-pack').disabled=!current()||!embedded||(!purchasePending&&(!wallet.available||!offer||wallet.balance<offer.cost));
  $('pack-progress').textContent=purchasePending?'This purchase is awaiting confirmation. Resume uses the same receipt and cannot charge twice.':!embedded?'Preview collection. Open this game from the Math or Science portal to use your real reward points.':!wallet.available?'Your platform wallet is not ready. Answer a question in the portal first.':offer&&wallet.balance<offer.cost?`You need ${format(offer.cost-wallet.balance)} more points for this pack.`:`Purchases use your ${subject} reward-point wallet. Every pack contains one character card.`;
  const odds=el('div','odds-grid');if(offer)for(let stars=1;stars<=7;stars++){const n=el('div');n.append(el('strong','',`${Number(offer.odds[stars]||0)}%`),el('span','',`${stars} STAR · ${RARITIES[stars]}`));odds.append(n);}else{const note=el('p','', 'Live pack prices and odds appear when connected to your platform wallet.');$('odds-table').replaceChildren(note);return;}$('odds-table').replaceChildren(el('p','',`${offer.name} · ${offer.cost} points · one character card`),odds);
}
function purchaseDialog(message='Confirming your card purchase…'){
  const panel=openDialog('purchase','Your next legend.');panel.append(el('p','purchase-pending',message));
  if(purchasePending&&!purchasePending.waiting)panel.append(button('Resume this purchase',sendPurchase,'gold-button'));
  panel.append(el('p','', 'A purchase is complete only when your platform confirms the points and card together. Closing this window does not create a second charge.'));
}
function beginPurchase(){
  if(purchasePending){purchaseDialog('A previous purchase is awaiting confirmation. Resume it to recover the same card receipt.');return;}
  const offer=wallet.offers.find(o=>o.id===selectedPack);if(!current()||!embedded||!wallet.available||!offer||wallet.balance<offer.cost)return;
  purchasePending={purchaseId:uuid('pack'),packId:offer.id,requestId:'',waiting:false};if(!localSet(pendingKey(),{purchaseId:purchasePending.purchaseId,packId:offer.id})){purchasePending=null;toast('Your browser could not save a purchase receipt. Enable storage before buying a pack.');return;}sendPurchase();
}
function sendPurchase(){
  if(!purchasePending||purchasePending.waiting||!sessionId)return;
  purchasePending.waiting=true;purchasePending.requestId=uuid('buy');post({type:'GLTCG_BUY_REQUEST',sessionId,requestId:purchasePending.requestId,purchaseId:purchasePending.purchaseId,packId:purchasePending.packId});
  purchaseDialog();renderPacks();const request=purchasePending.requestId;purchasePending.timer=setTimeout(()=>{if(purchasePending?.requestId!==request)return;purchasePending.waiting=false;purchaseDialog('Confirmation is taking longer than expected. Resume with the same receipt to check the outcome.');},15000);
}
function reveal(grant){
  const c=CHARACTER_BY_ID[grant.characterId];if(!c)return;const panel=openDialog('reveal',grant.duplicate?'Your legend grows.':'A new legend joins you.');panel.classList.add('reveal-panel');const title=panel.querySelector('h1');const body=el('div','reveal-content'+(c.stars===7?' apex-reveal':''));body.append(el('p','eyebrow',`${RARITIES[c.stars]} · ${c.stars} STARS · EXACTLY ONE CARD`),title,card(c,{inspect:false,eager:true}));
  const copies=collection.cards[c.id]?.copies||grant.copies,rank=statsFor(c.id,copies).rank;body.append(el('p','',grant.duplicate?`${c.name} merged automatically. ${copies} total copies · Merge rank ${rank}.`:`${c.name} and the matching battle avatar are now unlocked.`));const actions=el('div','dialog-actions');actions.append(button('View character',()=>inspectCard(c.id),'gold-button'),button('Back to card shop',()=>{closeDialog();go('packs');}));body.append(actions);panel.append(body);sound(c.stars===7?'apex':'reveal');
}
function persistCollection(){
  if(!embedded){savePreferences();return Promise.resolve(collection);}if(!current())return Promise.reject(Error('The learning profile is no longer active.'));
  if(savePending)return savePending.promise;
  const requestId=uuid('save');let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  savePending={requestId,promise,resolve,reject,timer:setTimeout(()=>{if(savePending?.requestId===requestId){savePending=null;reject(Error('Progress has not been confirmed. Try saving again before leaving.'));if(view==='battle')renderBattle();}},15000)};
  post({type:'GLTCG_SAVE_REQUEST',sessionId,requestId,team:[...collection.team],progress:{unlockedEncounter:collection.unlockedEncounter,completed:[...collection.completed],stats:{...collection.stats}}});return promise;
}
function beginBattle(encounter){
  if(purchasePending){toast('Resume your pending purchase in the Card shop before starting a battle.');return;}if(!current()||savePending||unsavedLearning)return;const next=createBattle(collection,{encounter,seed:uuid('voyage')});if(!next){toast('Choose five unlocked crew members and an available encounter.');return;}
  battle=next;lastActor='';lastOutcome='';selectedSkill='';selectedTarget='';busyUntil=performance.now()+400;enemyAt=busyUntil+600;learningPending=null;go('battle');sound();
}
function selectSkill(id){if(!battle||battle.status!=='player'||busy())return;selectedSkill=id;const targets=getValidTargets(battle,id);if(!targets.some(u=>u.id===selectedTarget))selectedTarget=targets[0]?.id||'';renderBattle();}
function selectTarget(id){if(!battle||battle.status!=='player'||busy())return;if(getValidTargets(battle,selectedSkill).some(u=>u.id===id)){selectedTarget=id;renderBattle();}}
function useSkill(){if(!battle||battle.status!=='player'||busy())return;if(act(battle,selectedSkill,selectedTarget)){busyUntil=performance.now()+900;enemyAt=busyUntil+350;sound('skill');lastActor='';renderBattle();}else toast('That action is unavailable. Check your target, Spirit and cooldown.');}
function defend(){if(!battle||busy())return;if(chooseDefend(battle)){busyUntil=performance.now()+650;enemyAt=busyUntil+300;lastActor='';renderBattle();}}
function renderBattle(){
  if(!battle)return;const b=battle,e=typeof b.encounter==='object'?b.encounter:ENCOUNTERS.find(x=>x.id===b.encounter),actor=getActiveUnit(b);
  $('battle-chapter').textContent=`ACT ${Math.ceil((e?.id||1)/3)} · GRAND LINE EXPEDITION`;$('battle-title').textContent=e?.name||'The Grand Line';$('round-label').textContent=`Round ${b.round}`;
  const all=[...b.allies,...b.enemies];$('turn-order').replaceChildren(...b.turnOrder.map(id=>all.find(u=>u.id===id)).filter(u=>u&&u.hp>0).map(u=>el('span','turn-token'+(u.side==='enemy'?' enemy':'')+(u.id===b.activeId?' active':''),displayName(CHARACTER_BY_ID[u.characterId]))));
  const waiting=b.status==='learning';$('round-gate').hidden=!waiting;$('gate-title').textContent=b.pendingOutcome?'The final round is complete.':`Round ${b.round} complete`;
  const boost=b.learningBoost;$('learning-boost').dataset.active=String(!!boost);$('learning-boost').replaceChildren();
  if(boost){$('learning-boost').append(el('strong','',`✧ KNOWLEDGE BOOST · ${boost.correct}/3 CORRECT`),el('span','',`Attack +${Math.round((boost.attackMultiplier-1)*100)}%`),el('span','',`Critical chance +${Math.round(boost.critBonus*100)} percentage points`),el('span','',`Defense +${Math.round((boost.defenseMultiplier-1)*100)}%`),el('small','',`ACTIVE FOR ROUND ${boost.round}`));}
  else $('learning-boost').append(el('span','',waiting?'Each correct answer powers the next round: +10% attack, +5 percentage points critical chance, +8% defense.':'Answer the next three questions to strengthen your crew’s attack, critical chance, and defense.'));
  $('gate-message').textContent=learningPending?.message||`Answer three ${subject} questions to ${b.pendingOutcome?'finish the battle':'continue the next round'}.`;
  $('study-button').textContent=learningPending?.waiting?'Questions in progress…':learningPending?'Retry these 3 questions →':'Answer 3 questions →';$('study-button').disabled=!!learningPending?.waiting||!!savePending||!current();
  if(actor&&lastActor!==actor.id){lastActor=actor.id;selectedSkill=actor.skills[0]?.id||'';selectedTarget=getValidTargets(b,selectedSkill)[0]?.id||'';}
  const player=b.status==='player',locked=busy()||!player;$('actor-label').textContent=waiting?'STUDY BREAK':player?'YOUR TURN':b.status==='enemy'?'ENEMY TURN':'EXPEDITION COMPLETE';$('actor-name').textContent=actor?displayName(CHARACTER_BY_ID[actor.characterId]):waiting?'Knowledge is power.':'Well fought.';
  $('actor-passive').textContent=actor?`${actor.passive.name} · ${actor.passive.description}`:waiting?'Combat resumes only after all three answers are graded.':'Return to your collection to prepare your next crew.';
  $('actor-energy').replaceChildren();if(actor){const fill=el('span');fill.style.width=`${actor.energy/actor.maxEnergy*100}%`;$('actor-energy').append(fill,el('b','',`${Math.floor(actor.energy)} / ${actor.maxEnergy} SPIRIT`));}
  $('defend-button').disabled=locked;
  $('skill-buttons').replaceChildren(...(actor?.skills||[]).map(s=>{const n=button('',()=>selectSkill(s.id),'skill-command'+(selectedSkill===s.id?' selected':''));n.style.setProperty('--skill-color',s.color);n.dataset.skill=s.id;const cd=actor.cooldowns[s.id]||0;n.disabled=locked||cd>0||actor.energy<s.cost;n.append(el('span','glyph',GLYPHS[s.kind]||'✧'),el('strong','',s.name),el('p','',s.description),el('small','',cd?`${cd} own-turn cooldown`:actor.energy<s.cost?`Need ${s.cost} Spirit`:`${s.cost} Spirit · ${s.target.replaceAll('-',' ')}`));return n;}));
  const targets=player?getValidTargets(b,selectedSkill):[];$('target-buttons').replaceChildren(...targets.map(u=>{const n=button(`${displayName(CHARACTER_BY_ID[u.characterId])} · ${Math.max(0,Math.ceil(u.hp))}`,()=>selectTarget(u.id),'');n.dataset.target=u.id;n.setAttribute('aria-pressed',String(selectedTarget===u.id));n.disabled=locked;return n;}));
  const skill=actor?.skills.find(s=>s.id===selectedSkill);$('target-label').textContent=waiting?'Three questions are required between every battle round.':player?skill?`${skill.name} · Select ${skill.target==='all-enemies'?'any enemy to confirm an attack on all enemies':skill.target==='all-allies'?'any ally to confirm the whole crew':skill.target==='self'?'your character':'a target'}.`:'Choose a skill.':'The opposing crew is taking its turn.';
  $('cast-button').textContent=skill?.name||'Use skill';$('cast-button').disabled=locked||!skill||!targets.length||!selectedTarget||(actor.cooldowns[selectedSkill]||0)>0||actor.energy<skill.cost;
  $('battle-log').replaceChildren(...b.log.map(text=>el('li','',text)));
  if(['victory','defeat'].includes(b.status)&&!unsavedLearning&&lastOutcome!==b.id){lastOutcome=b.id;ending();}
}
function retreat(after){if(learningPending?.waiting||savePending||unsavedLearning){toast('Finish the current questions and save before leaving the battle.');return;}if(!battle){after?.();return;}if(['victory','defeat'].includes(battle.status)){battle=null;after?.();return;}const panel=openDialog('retreat','Leave this battle?');panel.append(el('p','', 'This battle will end. Completed question records and your collected cards are retained. The current unfinished round gives no battle progress.'));const actions=el('div','dialog-actions');actions.append(button('Keep fighting',closeDialog,'gold-button'),button('Retreat',()=>{learningPending=null;questionSession=null;closeDialog();battle=null;go('campaign');after?.();}));panel.append(actions);}
function ending(){if(!battle)return;const win=battle.status==='victory',panel=openDialog('ending',win?'Your crew prevails.':'Regroup. Return stronger.');panel.classList.add('battle-result');panel.insertBefore(el('p','eyebrow',win?'ENCOUNTER COMPLETE':'THE VOYAGE CONTINUES'),panel.firstChild);panel.append(el('p','',win?'A new course is open. Use your reward points to discover more crew members.':'Try a new crew combination, defend to recover Spirit, and watch your healing and control abilities.'));
  const stats=el('div','result-stats');for(const [label,value]of[['ROUNDS',battle.round],['CORRECT ANSWERS',battle.roundResults.reduce((n,r)=>n+r.correct,0)],['CREW STANDING',battle.allies.filter(u=>u.hp>0).length]]){const n=el('span');n.append(el('strong','',value),document.createTextNode(label));stats.append(n);}panel.append(stats);const actions=el('div','dialog-actions');actions.append(button('Continue the voyage',()=>{closeDialog();battle=null;go('campaign');},'gold-button'),button('Review my crew',()=>{closeDialog();battle=null;go('crew');}));panel.append(actions);sound(win?'win':'click');}
function requestLearning(){
  if(!battle||battle.status!=='learning'||learningPending?.waiting||savePending||!current())return;
  if(!embedded){startPreviewQuestions();return;}
  const requestId=uuid('round'),round=bridgeRound+1;learningPending={requestId,round,battleId:battle.id,battleRound:battle.round,waiting:true,message:'Your portal is preparing three suitable questions.'};post({type:'GLTCG_ROUND_REQUEST',requestId,sessionId,round});renderBattle();
}
async function finishLearning(correct,total,battleRound){
  if(!battle||battle.status!=='learning')return;const result=completeLearning(battle,{correct,total,round:battleRound});if(!result)return;
  learningPending=null;unsavedLearning=true;lastActor='';renderCounters();if(result.boost)toast(`${correct}/3 correct · Your crew’s attack, critical chance, and defense are stronger for round ${result.boost.round}.`);await saveLearningProgress();
}
async function saveLearningProgress(){
  try{await persistCollection();unsavedLearning=false;if(dialog==='save-progress')closeDialog();busyUntil=performance.now()+700;enemyAt=busyUntil+350;renderBattle();}
  catch(error){if(!current())return;const panel=openDialog('save-progress','Saving your voyage');panel.querySelector('.dialog-close')?.remove();panel.append(el('p','',error.message),el('p','', 'Your answers have been graded. Combat is paused until your battle progress is saved.'),button('Retry saving',saveLearningProgress,'gold-button'));}
}

// Standalone examples never stand in for portal grading or award real points.
const PREVIEW={
  Math:[['What is 3 × 8?',['11','24','18','32'],1,'Three groups of eight make twenty-four.'],['What is one quarter of 20?',['4','5','10','15'],1,'20 ÷ 4 = 5.'],['A boat travels 18 km in 3 hours. What is its average speed?',['3 km/h','6 km/h','9 km/h','54 km/h'],1,'Average speed = distance ÷ time = 18 ÷ 3.'],['What is 0.5 written as a fraction in simplest form?',['1/5','1/2','5/10','2/5'],1,'0.5 is five tenths, which simplifies to one half.'],['What is the perimeter of a square with side 7 cm?',['14 cm','21 cm','28 cm','49 cm'],2,'A square has four equal sides: 4 × 7 = 28.'],['What is 25% of 80?',['10','20','25','40'],1,'25% is one quarter; 80 ÷ 4 = 20.']],
  Science:[['Which part of a plant absorbs most water from the soil?',['Flower','Leaf','Root','Fruit'],2,'Roots take in water and dissolved mineral salts from the soil.'],['What is the main source of energy for the water cycle?',['The Sun','The Moon','Soil','Rocks'],0,'Energy from the Sun causes water to evaporate.'],['Which material is usually the best electrical conductor?',['Rubber','Plastic','Copper','Dry wood'],2,'Copper is a metal that allows electric current to flow easily.'],['What happens to water vapour when it cools enough?',['It condenses into liquid','It becomes light','It disappears forever','It always becomes salt'],0,'Cooling water vapour can condense into liquid water droplets.'],['Why does a shadow form behind an opaque object?',['It makes extra light','It blocks light','It attracts darkness','It reflects all sound'],1,'An opaque object blocks light from passing through it.'],['Which process allows green plants to make food using light?',['Condensation','Photosynthesis','Melting','Digestion'],1,'Photosynthesis uses light energy, water and carbon dioxide to make food.']]
};
function startPreviewQuestions(){
  if(!battle||battle.status!=='learning')return;const rows=PREVIEW[subject],offset=((battle.round-1)*3)%rows.length;questionSession={battleId:battle.id,battleRound:battle.round,index:0,correct:0,rows:[0,1,2].map(i=>rows[(offset+i)%rows.length]),selected:null,graded:false};previewQuestion();
}
function previewQuestion(){
  const q=questionSession;if(!q||battle?.id!==q.battleId)return;const [stem,options,answer,explanation]=q.rows[q.index],panel=openDialog('question',stem);panel.classList.add('question-preview');panel.insertBefore(el('p','eyebrow',`${subject.toUpperCase()} PREVIEW · LOCAL EXAMPLES`),panel.firstChild);panel.append(el('p','question-count',`Question ${q.index+1} of 3 · No platform points awarded`));const choices=el('div','question-options');options.forEach((text,index)=>{const n=button(text,()=>{if(q.graded)return;q.selected=index;previewQuestion();},'');n.dataset.answer=index;n.setAttribute('aria-pressed',String(q.selected===index));n.disabled=q.graded;choices.append(n);});panel.append(choices);
  if(q.graded){panel.append(el('p','question-feedback'+(q.selected===answer?'':' wrong'),`${q.selected===answer?'Correct.':'The correct answer is '+options[answer]+'.'} ${explanation}`));panel.append(button(q.index===2?'Return to battle':'Next question',()=>{if(q.index===2){const result={correct:q.correct,round:q.battleRound};questionSession=null;closeDialog();finishLearning(result.correct,3,result.round);}else{q.index++;q.selected=null;q.graded=false;previewQuestion();}},'gold-button'));}
  else{const submit=button('Check answer',()=>{if(q.selected===null||q.graded)return;q.graded=true;if(q.selected===answer)q.correct++;previewQuestion();},'gold-button');submit.disabled=q.selected===null;panel.append(submit);}
}
function help(){
  const panel=openDialog('settings','A crew worth collecting.');panel.append(el('p','', 'Collect fifty One Piece characters, build a crew of five, and command each hero in turn-based battles. Your card’s star rating is its fixed rarity; repeat copies merge into stronger ranks.'));
  const options=el('div','settings-options');for(const [key,label]of[['muted','Mute sound'],['reducedMotion','Reduce animation']]){const n=el('label'),input=el('input');input.type='checkbox';input.checked=settings[key];input.onchange=()=>{settings[key]=input.checked;settingsUI();savePreferences();};n.append(input,document.createTextNode(label));options.append(n);}panel.append(options);
  const rules=el('ol','rules-list');for(const text of ['Choose five different unlocked characters in My crew. Tap a slot to replace it.','Choose a skill, select its target, then confirm. Basic skills restore Spirit; stronger skills spend it. Defend adds a shield and restores Spirit.','Initiative determines the order. Freeze, stun, poison, shields and each character’s passive can change the battle.','After every full round—including the final round—answer exactly three questions from your active Math or Science portal. Standalone play uses labeled preview questions.','Each correct answer grants +10% attack damage, +5 percentage points critical chance, and +8% defense for the next full round. Three correct answers give +30% attack, +15 percentage points critical chance, and +24% defense. Boosts refresh after each quiz and never stack across rounds. Critical chance is capped at 75%.','Packs are purchased using your platform’s existing reward points and TCG rates. One purchase grants exactly one card. A duplicate merges automatically.','Merge rank increases at 2, 4, 8, 16… copies, up to rank 10. Every rank adds 12% to base life, attack and defense.','Seven-star expansion cards: Kaido the Beast, Whitebeard, and Admiral Akainu. Their gold galaxy foil animates unless reduced motion is enabled.','In battle, press 1, 2 or 3 to choose a skill and D to defend. Skill and target buttons also support keyboard navigation.'])rules.append(el('li','',text));panel.append(rules);panel.append(button('Ready to sail',closeDialog,'gold-button'));
}

function hello(){if(!embedded)return;clearTimeout(helloTimer);helloId=uuid('hello');post({type:'GLTCG_HELLO',requestId:helloId});helloTimer=setTimeout(()=>{if(!ready)connection('The portal connection is taking longer than expected. Close and reopen Grand Line Chronicles from the portal to try again.');},12000);}
window.addEventListener('message',event=>{
  const d=event.data;if(!embedded||event.origin!==origin||event.source!==parent||!d||typeof d!=='object')return;
  if(d.type==='GLTCG_READY'){
    if(d.requestId!==helloId||typeof d.sessionId!=='string'||typeof d.profileKey!=='string'||sessionId)return;
    clearTimeout(helloTimer);sessionId=d.sessionId;scope=d.profileKey;subject=d.subject==='Science'?'Science':'Math';ready=d.available===true;bridgeRound=0;loadPreferences();applySnapshot(d);connection(ready?'':d.reason||'Choose your school level in the portal before playing.');
    const old=localGet(pendingKey());if(old&&typeof old.purchaseId==='string'&&typeof old.packId==='string')purchasePending={...old,requestId:'',waiting:false};renderPacks();renderCounters();return;
  }
  if(!sessionId||d.sessionId!==sessionId)return;
  if(d.type==='GLTCG_INVALIDATE'){sessionId='';ready=false;learningPending=null;questionSession=null;unsavedLearning=false;battle=null;if(purchasePending)clearTimeout(purchasePending.timer);purchasePending=null;if(savePending){clearTimeout(savePending.timer);savePending.reject(Error('The learning profile changed.'));savePending=null;}closeDialog();go('collection');connection(d.message||'Your profile changed. Reopen the game from the portal.',true);return;}
  if(['GLTCG_BUY_RESULT','GLTCG_BUY_BLOCKED'].includes(d.type)){
    const p=purchasePending;if(!p||d.requestId!==p.requestId||d.purchaseId!==p.purchaseId)return;clearTimeout(p.timer);p.waiting=false;
    if(d.type==='GLTCG_BUY_RESULT'&&d.grant&&CHARACTER_BY_ID[d.grant.characterId]&&d.collection){applySnapshot(d);try{localStorage.removeItem(pendingKey());}catch(_){}purchasePending=null;reveal(d.grant);renderCounters();}
    else{if(d.wallet)applySnapshot(d);if(d.confirmedNoCharge===true){try{localStorage.removeItem(pendingKey());}catch(_){}purchasePending=null;closeDialog();toast(d.message||'No points were charged. Choose a pack when you are ready.');}else purchaseDialog(d.message||'The purchase could not be confirmed. Resume using the same receipt.');}renderPacks();return;
  }
  if(['GLTCG_SAVE_RESULT','GLTCG_SAVE_BLOCKED'].includes(d.type)){
    const s=savePending;if(!s||d.requestId!==s.requestId)return;clearTimeout(s.timer);savePending=null;if(d.type==='GLTCG_SAVE_RESULT'){applySnapshot(d);s.resolve(collection);}else s.reject(Error(d.message||'Your progress could not be saved.'));if(view==='battle')renderBattle();return;
  }
  if(['GLTCG_ROUND_RESULT','GLTCG_ROUND_BLOCKED'].includes(d.type)){
    const p=learningPending;if(!p||d.requestId!==p.requestId||d.round!==p.round||battle?.id!==p.battleId||battle.status!=='learning')return;
    if(d.type==='GLTCG_ROUND_BLOCKED'){p.waiting=false;p.message=d.message||'Three fresh, suitable questions are needed. Please retry.';renderBattle();return;}
    if(d.total!==3||!Number.isInteger(d.correct)||d.correct<0||d.correct>3)return;bridgeRound=d.round;if(d.wallet)applySnapshot({wallet:d.wallet});finishLearning(d.correct,3,p.battleRound);
  }
});
function frame(now){
  if(battle&&view==='battle'){
    const events=renderer.draw(battle,now,{selectedTarget,selectedSkill,reducedMotion:settings.reducedMotion})||[];
    if(events.length){const text=events.find(e=>e.text)?.text||'';$('action-banner').textContent=text;bannerUntil=now+1100;}
    if(bannerUntil&&now>bannerUntil){$('action-banner').textContent='';bannerUntil=0;}
    if(battle.status==='enemy'&&!busy()&&now>=enemyAt){if(advanceBattle(battle)){busyUntil=now+900;enemyAt=busyUntil+350;lastActor='';renderBattle();}}
    const isBusy=now<busyUntil;if(wasBusy&&!isBusy&&!dialog)renderBattle();wasBusy=isBusy;
  }requestAnimationFrame(frame);
}
for(const n of document.querySelectorAll('[data-view]'))n.onclick=()=>go(n.dataset.view);
for(const n of document.querySelectorAll('[data-go]'))n.onclick=()=>go(n.dataset.go);
document.querySelector('.brand').onclick=event=>{event.preventDefault();go('collection');};
$('search-input').oninput=renderCollection;for(const id of ['ownership-filter','star-filter','sort-filter'])$(id).onchange=renderCollection;
$('apex-showcase').replaceChildren(...['kaido','whitebeard','akainu'].map(id=>card(CHARACTER_BY_ID[id],{eager:true})));
$('open-pack').onclick=beginPurchase;$('cast-button').onclick=useSkill;$('defend-button').onclick=defend;$('study-button').onclick=requestLearning;$('retreat-button').onclick=()=>retreat();
$('battle-canvas').addEventListener('click',e=>{const id=renderer.hitTest(e.clientX,e.clientY);if(id)selectTarget(id);});
$('settings-button').onclick=help;$('help-button').onclick=help;$('sound-button').onclick=()=>{settings.muted=!settings.muted;settingsUI();savePreferences();sound();};
$('rift-button').onclick=()=>{if(learningPending?.waiting||unsavedLearning||savePending||purchasePending?.waiting){toast('Finish the current questions or save before switching games.');return;}if(embedded)post({type:'GLTCG_OPEN_RIFT'});else location.href='./pirate-rift.html';};
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select'))return;
  if(dialog){if(event.key==='Escape'&&dialog!=='question'){event.preventDefault();closeDialog();}if(event.key==='Tab'){const nodes=[...$('dialog-panel').querySelectorAll('button:not(:disabled),input,select,a[href]')];if(nodes.length&&event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(nodes.length&&!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}return;}
  if(view!=='battle'||!battle||event.repeat)return;const actor=getActiveUnit(battle);if(['1','2','3'].includes(event.key)&&actor){event.preventDefault();selectSkill(actor.skills[Number(event.key)-1].id);}if(event.key.toLowerCase()==='d'){event.preventDefault();defend();}
});
window.addEventListener('pagehide',()=>{savePreferences();audioContext?.suspend().catch(()=>{});});document.addEventListener('visibilitychange',()=>{enemyAt=performance.now()+750;if(document.hidden)audioContext?.suspend().catch(()=>{});});
window.addEventListener('error',()=>{if(!document.querySelector('.tcg-card'))$('fatal').hidden=false;});
loadPreferences();renderCounters();renderCollection();if(!embedded)connection('Preview voyage · Questions are local examples. Sign in through Math or Science to purchase cards with platform reward points.');else{connection('Connecting to your portal, learning profile and reward-point wallet…');hello();}
requestAnimationFrame(frame);
if(params.get('test')==='1')window.__grandLine={get collection(){return collection;},get battle(){return battle;},get wallet(){return wallet;},get dialog(){return dialog;},get sessionId(){return sessionId;},get learningPending(){return learningPending;},get purchasePending(){return purchasePending;},get scope(){return scope;},get settings(){return settings;},get ready(){return ready;},art,renderer,go,beginBattle,selectSkill,selectTarget,useSkill,defend,requestLearning,inspectCard,closeDialog,renderBattle,renderCollection,applySnapshot,statsFor,completeLearning,CHARACTERS,ENCOUNTERS};
