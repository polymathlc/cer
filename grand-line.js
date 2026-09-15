import {CHARACTERS,CHARACTER_BY_ID,ENCOUNTERS,STARTER_IDS,PACK_ODDS,createCollection,normalizeCollection,statsFor,setTeam} from './grand-line-core.js?v=3.0.0';
import {FUTURE_EXPANSION_CHARACTERS,RETIRED_CHARACTER_REPLACEMENTS} from './grand-line-data.js?v=3.0.0';
import {createArtManager} from './grand-line-render.js?v=3.0.0';
import {DEFENSE_GRID,DEFENSE_PADS,DEFENSE_DEFAULT_PADS,buildMazeTower,sellMazeTower,getMazePlacementPreview,DEFENSE_STAGES,createDefense,placeDefender as placeDefenseUnit,startDefenseWave,advanceDefense,completeDefenseLearning,getDefenseProfile,getDefenseSkillProfile,getDefenseWavePreview,summonDefender,recallDefender,upgradeDefender,specializeDefender,setDefensePriority} from './grand-line-defense.js?v=3.0.0';
import {createDefenseRenderer} from './grand-line-defense-render.js?v=3.0.0';
const DEFENSE_SPEEDS=[1,2,4];
const $=id=>document.getElementById(id);
const embedded=parent!==window,params=new URLSearchParams(location.search),origin=location.origin;
const art=createArtManager(),renderer=createDefenseRenderer($('battle-canvas'),art);
const RARITIES=['','Common','Uncommon','Rare','Epic','Legendary','Mythic','Galaxy'];
const GLYPHS={punch:'✦',slash:'╱',lightning:'ϟ',fire:'♨',ice:'❄',water:'≈',heal:'✚',shield:'⬡',earth:'◈',poison:'●',dark:'◉',soul:'♬',wind:'≋',light:'☀',plant:'❧',dragon:'✧',gravity:'◎',magnet:'∩',explosion:'✷',smoke:'☁',string:'⌘',sand:'⁙',revive:'✥'};
const uuid=prefix=>prefix+'-'+(crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const format=n=>Number.isFinite(n)?Math.floor(n).toLocaleString():'—';
const displayName=c=>({luffy:'Luffy',zoro:'Zoro',chopper:'Chopper',whitebeard:'Whitebeard',akainu:'Akainu',kaido:'Kaido',law:'Law',aokiji:'Kuzan',fujitora:'Fujitora',ryokugyu:'Ryokugyu'})[c.id]||c.name;
const skillDescription=s=>s.description.replaceAll('restore 20 Spirit','restore 12 Spirit').replace(/for (\d+) turns?/g,(_,n)=>`for ${Number(n)*2} seconds`).replaceAll('every enemy','every enemy in range').replaceAll('the whole crew','all crew members in range');
function passiveDescription(p){
  if(p.type==='energy')return `Recover ${(p.value*.6).toFixed(1)} extra Spirit per second.`;
  let text=p.description.replaceAll('round’s','wave’s').replaceAll('one additional turn','two additional seconds');
  if(['regen','apex-kaido'].includes(p.type))text=text.replaceAll('at the start of each turn','every 4 seconds').replaceAll('at each turn','every 4 seconds');
  if(['all-attack','all-guard'].includes(p.type))text+=' Applies to crew members in range.';
  return text;
}
let collection=createCollection(),wallet={available:false,balance:0,currency:'points',offers:[],unlimitedGold:false},admin={available:false,unlimitedGold:false},adminPending=null;
let subject=params.get('subject')?.toLowerCase()==='science'?'Science':'Math',scope='preview',sessionId='',helloId='',ready=!embedded;
let settings={muted:false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,battleSpeed:2};
let defensePaused=false,selectedAllyId='',selectedPadId='',selectedSummonId='',selectedPreviewSkillId='',summonMode=false,hoverPadId='',lastFrame=0,lastHud=0;
let buildMode='crew',placementPreview=null,placementPreviewKey='',mapZoom=1;
let view='collection',dialog='',battle=null,selectedSlot=null,busyUntil=0;
let lastOutcome='',bannerUntil=0,bridgeRound=0,learningPending=null,savePending=null,purchasePending=null;
let selectedPack='spark',toastTimer=0,helloTimer=0,audioContext=null,questionSession=null,initialFocus=null,unsavedLearning=false;
const storageKey=()=>`grand-line.v1:${subject.toLowerCase()}:${scope}`;
const pendingKey=()=>storageKey()+':purchase';
const current=()=>ready&&(!embedded||!!sessionId);
const busy=()=>performance.now()<busyUntil||!!adminPending||!!savePending||unsavedLearning||!!dialog||!current()||document.hidden;
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,className='subtle')=>{const n=el('button',className,text);n.type='button';n.onclick=fn;return n;};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3400);}
function post(message){if(embedded)parent.postMessage(message,origin);}
function localGet(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
function localSet(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
function loadPreferences(){const old=localGet(storageKey());for(const k of ['muted','reducedMotion'])if(typeof old?.settings?.[k]==='boolean')settings[k]=old.settings[k];if(DEFENSE_SPEEDS.includes(old?.settings?.defenseSpeed))settings.battleSpeed=old.settings.defenseSpeed;if(!embedded)collection=normalizeCollection(old?.collection);settingsUI();}
function savePreferences(){localSet(storageKey(),{settings:{...settings,defenseSpeed:settings.battleSpeed},...(!embedded?{collection}:{})});}
function sound(kind='click'){
  if(settings.muted||document.hidden)return;
  try{audioContext ||=new(window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});const now=audioContext.currentTime;
    const tones=kind==='reveal'?[261.6,329.6,392,523.2]:kind==='apex'?[130.8,196,261.6,392,523.2,783.9]:kind==='skill'?[185,270]:kind==='win'?[392,494,587]:[440];
    tones.forEach((hz,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type=kind==='skill'?'triangle':'sine';o.frequency.setValueAtTime(hz,now+i*.085);g.gain.setValueAtTime(0,now);g.gain.setValueAtTime(.045,now+i*.085);g.gain.exponentialRampToValueAtTime(.001,now+i*.085+.35);o.connect(g).connect(audioContext.destination);o.start(now+i*.085);o.stop(now+i*.085+.37);o.onended=()=>{o.disconnect();g.disconnect();};});
  }catch(_){}
}
function settingsUI(){document.documentElement.classList.toggle('reduced-motion',settings.reducedMotion);$('sound-button').textContent=settings.muted?'♩':'♪';$('sound-button').setAttribute('aria-pressed',String(settings.muted));$('sound-button').setAttribute('aria-label',settings.muted?'Turn sound on':'Mute sound');}
function applySnapshot(data){
  if(data?.admin)admin={available:embedded&&data.admin.available===true,unlimitedGold:embedded&&data.admin.available===true&&data.admin.unlimitedGold===true};
  if(data?.collection){collection=normalizeCollection(data.collection);if(battle)battle.collection=collection;}
  if(data?.wallet){const w=data.wallet;wallet={available:w.available===true,unlimitedGold:w.unlimitedGold===true,balance:Number.isFinite(w.balance)?Math.max(0,Math.floor(w.balance)):0,currency:'points',offers:(Array.isArray(w.offers)?w.offers:[]).filter(o=>typeof o.id==='string'&&Number.isSafeInteger(o.cost)&&o.cost>0&&o.odds&&typeof o.odds==='object')};}
  renderCounters();if(view==='packs')renderPacks();if(view==='collection')renderCollection();if(view==='crew')renderCrew();if(view==='campaign')renderCampaign();
}
const unlimitedGold=()=>embedded&&current()&&admin.available&&admin.unlimitedGold&&wallet.unlimitedGold;
function connection(message,blocked=false){$('connection').hidden=!message;$('connection').textContent=message;if(blocked){ready=false;wallet.available=false;}renderCounters();}
function renderCounters(){
  const owned=Object.keys(collection.cards).filter(id=>CHARACTER_BY_ID[id]&&collection.cards[id].copies>0).length;
  $('collection-count').textContent=`${owned} / 50`;$('packs-count').textContent=unlimitedGold()?'∞ gold':embedded?`${format(wallet.balance)} points`:'Preview';
  $('subject-tag').textContent=embedded?`${subject.toUpperCase()} · ${ready?'CONNECTED':'CONNECTING'}`:`${subject.toUpperCase()} PREVIEW`;
  $('learning-progress').textContent=unlimitedGold()?'Admin · Unlimited gold · One card per pack':embedded?`${format(wallet.balance)} ${subject} points · One card per pack`:'Preview · Sign in to Math or Science to buy cards';
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
  if(adminPending||next!=='battle'&&(unsavedLearning||savePending)){toast('Please wait for your progress to finish saving.');return;}
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
function closeDialog(){if(dialog==='question'&&questionSession||dialog==='save-progress'&&unsavedLearning)return;dialog='';$('dialog-layer').hidden=true;$('dialog-panel').replaceChildren();if(initialFocus?.isConnected)initialFocus.focus({preventScroll:true});initialFocus=null;lastFrame=0;if(view==='battle')renderBattle();}
function inspectCard(id){
  const c=CHARACTER_BY_ID[id];if(!c)return;const panel=openDialog('card',c.name);panel.querySelector('h1').remove();const layout=el('div','card-detail'),copy=el('div','detail-copy');
  const owned=collection.cards[id],stats=statsFor(id,owned?.copies||1);layout.append(card(c,{inspect:false,eager:true}));copy.append(el('p','eyebrow',`${RARITIES[c.stars]} · ${c.stars} STARS · ${c.role.toUpperCase()}`));const title=el('h1','',c.name);title.id='dialog-title';copy.append(title,el('p','',c.description));
  const statRow=el('div','detail-stats');for(const [label,value]of[['LIFE',stats.hp],['ATTACK',stats.attack],['DEFENSE',stats.defense],['SPEED',stats.speed]]){const item=el('span');item.append(el('b','',value),document.createTextNode(label));statRow.append(item);}copy.append(statRow);
  const defenseProfile=getDefenseProfile(c.id);copy.append(el('p','defender-pattern',defenseProfile.label+' · '+defenseProfile.description));
  for(const skill of c.skills){const n=el('div','skill-description'),shape=getDefenseSkillProfile(c.id,skill);n.style.setProperty('--skill-color',skill.color);n.append(el('h3','',`${GLYPHS[skill.kind]||'✧'} ${skill.name}`),el('small','skill-shape',PATTERN_LABELS[shape.shape]||'Support'),el('p','',skillDescription(skill).replaceAll('every enemy in range','enemies inside its attack shape')),el('small','',`${skill.cost} Spirit · Used automatically when ready and in range`));copy.append(n);}
  const passive=el('div','skill-description');passive.append(el('h3','',`Passive · ${c.passive.name}`),el('p','',passiveDescription(c.passive)));copy.append(passive);
  copy.append(el('p','merge-note',owned?`${owned.copies} ${owned.copies===1?'copy':'copies'} · Merge rank ${stats.rank}. ${stats.rank>=10?'Maximum merge rank.':`Next rank at ${2**(stats.rank+1)} total copies. Duplicates merge automatically.`}`:'Not yet collected. Find this character in a single-card pack to unlock the battle avatar.'));
  if(owned){const add=button(collection.team.includes(id)?'Already in your crew':'Add to my crew',()=>replaceMenu(id),'gold-button');add.disabled=collection.team.includes(id)||!current()||!!battle&&!['victory','defeat'].includes(battle.status);copy.append(add);}else copy.append(button('View card packs',()=>{closeDialog();go('packs');},'gold-button'));
  layout.append(copy);panel.append(layout);
}
function renderCrew(){
  $('crew-slots').replaceChildren(...Array.from({length:10},(_,index)=>{
    const id=collection.team[index],slot=el('div','crew-slot'+(!id?' empty-crew-slot':'')+(selectedSlot===index?' selected':''));
    if(id){slot.append(card(CHARACTER_BY_ID[id]),button('SLOT '+(index+1)+' · CHANGE',()=>pickCrewSlot(index),'text-button'));const remove=button('Remove from crew',()=>removeCrewMember(index),'text-button');remove.disabled=collection.team.length<=1||!!savePending||!!adminPending;slot.append(remove);}
    else{slot.append(el('span','empty-slot-number',String(index+1)),el('strong','','Open crew slot'),button('+ Add character',()=>pickCrewSlot(collection.team.length),'subtle'));}
    return slot;
  }));
  $('crew-picker-heading').textContent=selectedSlot===null?'Your unlocked characters':'Choose a character for slot '+(selectedSlot+1);
  const owned=CHARACTERS.filter(c=>collection.cards[c.id]);$('crew-count').textContent=owned.length+' unlocked · '+collection.team.length+' / 10 crew members';
  $('crew-picker').replaceChildren(...owned.map(c=>{const n=card(c);n.onclick=()=>selectedSlot===null?inspectCard(c.id):changeTeam(selectedSlot,c.id);return n;}));
}
function pickCrewSlot(index){selectedSlot=index;renderCrew();$('crew-picker-heading').scrollIntoView({behavior:settings.reducedMotion?'instant':'smooth',block:'center'});}
function replaceMenu(id){if(collection.team.length<10){changeTeam(collection.team.length,id);return;}const panel=openDialog('replace','Choose a crew slot');panel.append(el('p','',CHARACTER_BY_ID[id].name+' will replace one of your ten crew members.'));const grid=el('div','replace-grid');collection.team.forEach((current,index)=>{const n=button('',()=>changeTeam(index,id));n.append(el('span','','Slot '+(index+1)),document.createTextNode(displayName(CHARACTER_BY_ID[current])));grid.append(n);});panel.append(grid);}
async function removeCrewMember(index){
  if(!current()||savePending||adminPending||collection.team.length<=1)return;
  const before=[...collection.team];if(!setTeam(collection,before.filter((_,i)=>i!==index)))return;
  selectedSlot=null;renderCrew();try{await persistCollection();}catch(error){collection.team=before;renderCrew();toast(error.message);}
}
async function changeTeam(index,id){
  if(!current()||savePending||adminPending||!Number.isInteger(index)||index<0||index>collection.team.length||index>=10)return;
  if(collection.team.includes(id)&&collection.team[index]!==id){toast('That character is already in your crew.');return;}
  const before=[...collection.team],next=[...before];next[index]=id;if(!setTeam(collection,next)){toast('Choose up to ten different unlocked characters.');return;}
  selectedSlot=null;closeDialog();renderCrew();try{await persistCollection();toast(displayName(CHARACTER_BY_ID[id])+' is ready to defend.');}catch(error){collection.team=before;renderCrew();toast(error.message);}
}
function renderCampaign(){
  $('campaign-map').replaceChildren(...DEFENSE_STAGES.map(e=>{const locked=e.id>collection.unlockedEncounter,n=el('article','encounter');n.dataset.locked=String(locked);n.style.setProperty('--encounter-color',['#8ac7ca','#b998d5','#dd9584'][Math.ceil(e.id/3)-1]);n.append(el('span','chapter-number',String(e.id).padStart(2,'0')),el('p','eyebrow',`HARBOR ${e.id} · SIX WAVES`),el('h2','',e.name),el('p','',e.description));const avatars=el('div','enemy-roster');for(const id of e.enemies){const medallion=el('div','enemy-medallion');medallion.title=CHARACTER_BY_ID[id].name;const image=el('div','card-art');art.attach(image,id);medallion.append(image);avatars.append(medallion);}n.append(avatars);if(collection.completed.includes(e.id))n.append(el('p','completed-tag','✓ Harbor unlocked · Replay available'));const start=button(locked?`Defend harbor ${e.id-1} first`:'Prepare defense →',()=>beginBattle(e.id),'gold-button');start.disabled=locked||!current()||!!savePending;n.append(start);return n;}));
}
function renderPacks(){
  const unlimited=unlimitedGold(),locked=!!adminPending||!!savePending||unsavedLearning||!!learningPending;
  $('pack-balance').textContent=unlimited?'∞':embedded?format(wallet.balance):'—';$('pack-balance-label').textContent=unlimited?'admin gold · unlimited':'platform reward points';const offer=wallet.offers.find(o=>o.id===selectedPack)||wallet.offers[0];if(offer)selectedPack=offer.id;
  $('pack-tiers').replaceChildren(...wallet.offers.map(o=>{const n=button('',()=>{selectedPack=o.id;renderPacks();});n.dataset.pack=o.id;n.setAttribute('aria-pressed',String(o.id===selectedPack));n.disabled=locked;n.append(el('strong','',unlimited?'∞ ADMIN GOLD':`${format(o.cost)} points`),document.createTextNode(o.name),el('small','',`ONE CARD · ${Math.min(...Object.keys(o.odds).filter(k=>Number(o.odds[k])>0).map(Number))}★+`));return n;}));
  $('open-pack').textContent=adminPending?adminPending.waiting?'Saving admin change…':'Confirm admin change first':purchasePending?'Resume pending purchase':!embedded?'Sign in to buy packs':offer?unlimited?`Open ${offer.name} · Unlimited gold`:`Buy ${offer.name} · ${format(offer.cost)} points`:'Shop unavailable';
  $('open-pack').disabled=locked||!current()||!embedded||(!purchasePending&&(!wallet.available||!offer||!unlimited&&wallet.balance<offer.cost));
  $('pack-progress').textContent=purchasePending?'This purchase is awaiting confirmation. Resume uses the same receipt and cannot charge twice.':!embedded?'Preview collection. Open this game from the Math or Science portal to use your real reward points.':!wallet.available?'Your platform wallet is not ready. Answer a question in the portal first.':unlimited?'Unlimited gold is active for your admin account. Open any tier as often as you like; your saved points are kept.':offer&&wallet.balance<offer.cost?`You need ${format(offer.cost-wallet.balance)} more points for this pack.`:`Purchases use your ${subject} reward-point wallet. Every pack contains one character card.`;
  renderAdminTools();
  const odds=el('div','odds-grid');if(offer)for(let stars=1;stars<=7;stars++){const n=el('div');n.append(el('strong','',`${Number(offer.odds[stars]||0)}%`),el('span','',`${stars} STAR · ${RARITIES[stars]}`));odds.append(n);}else{const note=el('p','', 'Live pack prices and odds appear when connected to your platform wallet.');$('odds-table').replaceChildren(note);return;}$('odds-table').replaceChildren(el('p','',unlimited?`${offer.name} · Unlimited admin gold · one character card`:`${offer.name} · ${offer.cost} points · one character card`),odds);
}
function renderAdminTools(){
  const visible=embedded&&current()&&admin.available,owned=CHARACTERS.filter(c=>collection.cards[c.id]?.copies>0).length;
  $('admin-tools').hidden=!visible;if(!visible)return;
  const locked=!!adminPending||!!purchasePending||!!savePending||unsavedLearning||!!learningPending||!!battle&&!['victory','defeat'].includes(battle.status);
  $('admin-unlimited').textContent=admin.unlimitedGold?'Turn off unlimited gold':'Enable unlimited gold';$('admin-unlimited').setAttribute('aria-pressed',String(admin.unlimitedGold));$('admin-unlimited').disabled=locked;
  $('admin-unlock-all').textContent=owned===50?'All 50 cards unlocked':'Unlock all 50 cards';$('admin-unlock-all').disabled=locked||owned===50;
  $('admin-retry').hidden=!adminPending||adminPending.waiting;$('admin-retry').disabled=!adminPending||adminPending.waiting;
  $('admin-status').textContent=adminPending?adminPending.waiting?'Saving your admin change…':adminPending.message||'Confirm this change before opening more packs.':admin.unlimitedGold?'Unlimited gold is on. Pack openings keep your saved points.':'Unlimited gold is off. Packs use your saved reward points.';
}
function requestAdminAction(action,enabled){
  if(!embedded||!current()||!admin.available||view!=='packs'||adminPending||purchasePending||savePending||unsavedLearning||learningPending||dialog||battle&&!['victory','defeat'].includes(battle.status))return false;
  if(action!=='unlock-all'&&!(action==='set-unlimited-gold'&&typeof enabled==='boolean'))return false;
  adminPending={action,...(action==='set-unlimited-gold'?{enabled}:{}),waiting:false};return retryAdminAction();
}
function retryAdminAction(){
  if(!adminPending||adminPending.waiting||!embedded||!current()||!admin.available)return false;
  const pending=adminPending,requestId=uuid('admin');pending.requestId=requestId;pending.waiting=true;pending.message='';
  pending.timer=setTimeout(()=>{if(adminPending?.requestId!==requestId)return;pending.waiting=false;pending.message='Confirmation is taking longer than expected. Retry this admin change before opening more packs.';renderPacks();},15000);
  post({type:'GLTCG_ADMIN_REQUEST',sessionId,requestId,action:pending.action,...(pending.action==='set-unlimited-gold'?{enabled:pending.enabled}:{})});renderPacks();return true;
}
function purchaseDialog(message='Confirming your card purchase…'){
  const panel=openDialog('purchase','Your next legend.');panel.append(el('p','purchase-pending',message));
  if(purchasePending&&!purchasePending.waiting)panel.append(button('Resume this purchase',sendPurchase,'gold-button'));
  panel.append(el('p','', 'A purchase is complete only when your platform confirms the points and card together. Closing this window does not create a second charge.'));
}
function beginPurchase(){
  if(adminPending||savePending||unsavedLearning||learningPending)return;
  if(purchasePending){purchaseDialog('A previous purchase is awaiting confirmation. Resume it to recover the same card receipt.');return;}
  const offer=wallet.offers.find(o=>o.id===selectedPack);if(!current()||!embedded||!wallet.available||!offer||!unlimitedGold()&&wallet.balance<offer.cost)return;
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
  if(purchasePending){toast('Resume your pending purchase in the Card shop before starting a defense.');return;}if(!current()||adminPending||savePending||unsavedLearning)return;const next=createDefense(collection,{encounter,seed:uuid('defense')});if(!next){toast('Choose up to ten unlocked crew members and an available harbor.');return;}
  battle=next;lastOutcome='';buildMode='crew';placementPreviewKey='';placementPreview=null;selectedPreviewSkillId='';selectedAllyId=next.allies[0]?.id||'';selectedPadId='';selectedSummonId='';summonMode=false;hoverPadId='';defensePaused=false;busyUntil=0;lastFrame=0;lastHud=0;learningPending=null;go('battle');sound();
}
function startWave(){if(!battle||busy()||learningPending?.waiting)return false;const result=startDefenseWave(battle);if(result){summonMode=false;buildMode='crew';placementPreviewKey='';placementPreview=null;selectedPreviewSkillId='';defensePaused=false;lastFrame=0;sound();renderBattle();}return result;}
function selectDefender(id){if(!battle?.allies.some(u=>u.id===id))return;selectedAllyId=id;selectedPreviewSkillId='';summonMode=false;buildMode='crew';placementPreviewKey='';selectedPadId=battle.allies.find(u=>u.id===id).padId;renderBattle();}
function placeDefender(allyId,padId){if(!battle||!['setup','learning'].includes(battle.status)||busy()||learningPending)return false;const result=placeDefenseUnit(battle,allyId,padId);if(result){selectedAllyId=allyId;renderBattle();sound();}return result;}
function canPrepare(){return !!battle&&battle.status==='setup'&&!busy()&&!learningPending&&!purchasePending;}
const cellLabel=id=>{const p=DEFENSE_PADS.find(c=>c.id===id);return p?String.fromCharCode(65+(p.col??p.column??Number(id.split('-')[1])))+((p.row??Number(id.split('-')[2]))+1):'Choose a cell';};
function choosePad(padId){
  if(!battle||!DEFENSE_PADS.some(p=>p.id===padId))return false;
  selectedPadId=padId;hoverPadId='';placementPreviewKey='';
  if(battle.status==='running'){const unit=battle.allies.find(u=>u.padId===padId);if(unit)selectDefender(unit.id);}
  renderPlacement();return true;
}
function setBuildMode(mode){if(!canPrepare())return;buildMode=mode;summonMode=false;selectedPreviewSkillId='';placementPreviewKey='';renderPlacement();}
function updatePlacementPreview(){
  if(!battle||battle.status!=='setup'){placementPreview=null;return;}
  const cellId=hoverPadId||selectedPadId,kind=buildMode==='tower'?'tower':'crew';
  const key=[battle.id,battle.routeRevision,battle.supplies,cellId,kind,buildMode,summonMode,selectedAllyId].join(':');
  if(key===placementPreviewKey)return;placementPreviewKey=key;
  placementPreview=cellId?getMazePlacementPreview(battle,cellId,{kind,remove:buildMode==='sell',...(buildMode==='crew'&&!summonMode?{allyId:selectedAllyId}:{})}):null;
}
function applyCellAction(){
  if(!canPrepare()||!selectedPadId)return false;
  const id=selectedPadId;let ok=false;
  if(buildMode==='tower')ok=buildMazeTower(battle,id);
  else if(buildMode==='sell')ok=sellMazeTower(battle,id);
  else if(summonMode)return summonCharacter();
  else ok=placeDefenseUnit(battle,selectedAllyId,id);
  if(ok){placementPreviewKey='';sound();renderBattle();}else{const preview=getMazePlacementPreview(battle,id,{kind:buildMode==='tower'?'tower':'crew',remove:buildMode==='sell',...(buildMode==='crew'&&!summonMode?{allyId:selectedAllyId}:{})});toast(preview?.reason||'That placement is unavailable. Keep an open route to the exit.');}return ok;
}
function selectSummon(id){if(!canPrepare()||!collection.cards[id]?.copies)return false;buildMode='crew';summonMode=true;selectedSummonId=id;placementPreviewKey='';renderPlacement();return true;}
function summonCharacter(id=selectedSummonId,padId=selectedPadId){
  if(!canPrepare())return false;const ok=summonDefender(battle,id,padId);
  if(ok){selectedAllyId=battle.allies.find(u=>u.characterId===id).id;summonMode=false;selectedSummonId='';selectedPadId=padId;toast(displayName(CHARACTER_BY_ID[id])+' joins the defense.');sound();renderBattle();}return ok;
}
function recallSelected(){if(!canPrepare())return false;const ok=recallDefender(battle,selectedAllyId);if(ok){selectedAllyId=battle.allies[0]?.id||'';selectedPadId='';renderBattle();}return ok;}
function upgradeSelected(){if(!canPrepare())return false;const ok=upgradeDefender(battle,selectedAllyId);if(ok){sound('reveal');renderBattle();}return ok;}
function specializeSelected(branch){if(!canPrepare())return false;const ok=specializeDefender(battle,selectedAllyId,branch);if(ok){sound('reveal');renderBattle();}return ok;}
function setPriority(priority){if(!battle||busy()||learningPending)return false;const ok=setDefensePriority(battle,selectedAllyId,priority);if(ok)renderBattle();return ok;}
function toggleDefensePause(){if(!battle||battle.status!=='running'||savePending||unsavedLearning||dialog)return;defensePaused=!defensePaused;lastFrame=0;renderBattle();}
function renderBattle(){
  if(!battle)return;const b=battle,e=b.encounter,waiting=b.status==='learning',setup=b.status==='setup',locked=!current()||!!savePending||unsavedLearning||!!learningPending?.waiting;
  if(waiting&&mapZoom!==1)setMapZoom(1);
  $('battle-chapter').textContent=`CREW DEFENSE · HARBOR ${e.id}`;$('battle-title').textContent=e.name;$('round-label').textContent=`Wave ${b.round} / ${b.waveCount}`;
  $('defense-state').textContent=locked?'SAVING / STUDYING':setup?'BUILD YOUR DEFENSE':waiting?'WAVE COMPLETE':b.status==='running'?defensePaused?'DEFENSE PAUSED':`DEFENDING · ${settings.battleSpeed}×`:'DEFENSE COMPLETE';
  $('defense-description').textContent=setup?'Scout the wave. Summon from your collection, line up your attacks, and spend training points before starting.':waiting?'The battlefield is paused for three questions.':defensePaused?'Take a breather. Resume when you are ready.':'Your defenders attack automatically. Change target priority to catch runners, focus armor, or punish a cluster.';
  $('start-wave').hidden=!setup;$('start-wave').textContent=`Start wave ${b.round} →`;$('start-wave').disabled=locked||!!dialog||!b.allies.length;
  $('defense-pause').hidden=setup||waiting||['victory','defeat'].includes(b.status);$('defense-pause').disabled=locked;$('defense-pause').textContent=defensePaused?'Resume defense':'Pause defense';$('defense-pause').setAttribute('aria-pressed',String(defensePaused));$('defense-speed').value=String(settings.battleSpeed);$('defense-speed').disabled=locked;
  $('ship-health').textContent=`${Math.max(0,Math.ceil(b.ship.hp))} / ${b.ship.maxHp}`;$('ship-meter').value=b.ship.hp;$('ship-meter').max=b.ship.maxHp;
  const remaining=(b.remainingToSpawn||0)+b.enemies.filter(u=>u.hp>0&&!u.escaped).length;$('wave-enemies').textContent=`${remaining} remaining`;$('wave-meter').value=Math.min(100,(b.waveProgress||0)*100);$('defense-kills').textContent=format(b.stats.kills||0);
  $('round-gate').hidden=!waiting;$('gate-title').textContent=b.pendingOutcome==='defeat'?'The ship needs a new defense.':b.pendingOutcome==='victory'?'The harbor is secure.':`Wave ${b.round} cleared`;
  $('gate-message').textContent=learningPending?.message||`Answer three ${subject} questions to ${b.pendingOutcome?'complete this defense':'prepare the next wave'}.`;
  $('study-button').textContent=learningPending?.waiting?'Questions in progress…':learningPending?'Retry these 3 questions →':'Answer 3 questions →';$('study-button').disabled=!!learningPending?.waiting||locked;
  const boost=b.learningBoost,boostKey=`${b.id}:${b.round}:${waiting}:${boost?.correct||0}`;
  if($('learning-boost').dataset.key!==boostKey){$('learning-boost').dataset.key=boostKey;$('learning-boost').dataset.active=String(!!boost);$('learning-boost').replaceChildren();
  if(boost)$('learning-boost').append(el('strong','',`✧ KNOWLEDGE BOOST · ${boost.correct}/3 CORRECT`),el('span','',`Attack +${Math.round((boost.attackMultiplier-1)*100)}%`),el('span','',`Critical chance +${Math.round(boost.critBonus*100)} percentage points`),el('span','',`Defense +${Math.round((boost.defenseMultiplier-1)*100)}%`),el('small','',`WAVE ${boost.round}`));
  else $('learning-boost').append(el('span','',waiting?'Each correct answer powers the next wave: +10% attack, +5 percentage points critical chance, +8% defense.':'Three questions between waves strengthen your crew’s attack, critical chance, and defense.'));}
  renderWavePreview();renderPlacement();$('battle-log').replaceChildren(...b.log.map(text=>el('li','',text)));
  if(['victory','defeat'].includes(b.status)&&!unsavedLearning&&!savePending&&lastOutcome!==b.id){lastOutcome=b.id;ending();}
}
const PATTERN_LABELS={line:'Piercing line',cone:'Sweeping cone',radial:'Surrounding area',splash:'Splash blast',chain:'Chain attacks',single:'Single target',support:'Support'};
const profilePattern=p=>p?.shape||p?.pattern||p?.style||'single';
const profileText=p=>p?.description||p?.summary||'';
function renderWavePreview(){
  if(!battle)return;const p=getDefenseWavePreview(battle);$('wave-preview').hidden=battle.status!=='setup';
  $('wave-preview-title').textContent=(p.title||p.name||'Wave '+battle.round)+' · '+(p.total||p.count||battle.spawnTotal)+' enemies';
  $('wave-preview-tip').textContent=p.tip||p.description||'Line attacks reward long sightlines. Slow clustered enemies before hitting them with splash damage.';
  const rows=p.groups||p.types||[];
  $('wave-preview-types').replaceChildren(...(Array.isArray(rows)?rows:Object.entries(rows).map(([type,count])=>({type,count}))).map(r=>{const n=el('span','enemy-type');n.append(el('strong','',String(r.count??r.amount??'')),document.createTextNode(r.label||r.name||r.type||''));return n;}));
}
function renderPlacement(){
  if(!battle)return;const b=battle,setup=b.status==='setup',locked=!setup||!!savePending||!!adminPending||!!learningPending||unsavedLearning||!current()||!!dialog;
  $('battle-supplies').textContent=format(b.supplies);$('training-points').textContent=format(b.trainingPoints);$('deployed-count').textContent=b.allies.length+' / 10';
  const rosterKey=b.id+':'+b.allies.map(u=>u.id).join(',');
  if($('defender-buttons').dataset.battle!==rosterKey){$('defender-buttons').dataset.battle=rosterKey;$('defender-buttons').replaceChildren(...b.allies.map(u=>{const c=CHARACTER_BY_ID[u.characterId],n=button('',()=>selectDefender(u.id),'defender-chip');n.dataset.ally=u.id;const face=el('span','defender-face card-art');art.attach(face,c.id,true);n.append(face,el('strong','',displayName(c)),el('small'),el('progress'));return n;}));}
  for(const n of $('defender-buttons').children){const u=b.allies.find(u=>u.id===n.dataset.ally);n.setAttribute('aria-pressed',String(!summonMode&&u.id===selectedAllyId));n.querySelector('small').textContent='Lv '+(u.level||1)+' · '+cellLabel(u.padId)+' · '+Math.ceil(u.hp)+' HP';const meter=n.querySelector('progress');meter.value=u.hp;meter.max=u.maxHp;}
  let selected=b.allies.find(u=>u.id===selectedAllyId)||b.allies[0];if(selected)selectedAllyId=selected.id;
  updatePlacementPreview();const selectedPreview=selectedPadId?getSelectedPlacementPreview():null;
  for(const [id,active]of[['move-toggle',buildMode==='crew'&&!summonMode],['summon-toggle',summonMode],['build-toggle',buildMode==='tower'],['sell-toggle',buildMode==='sell']]){$(id).setAttribute('aria-pressed',String(active));$(id).disabled=id==='move-toggle'?false:locked;}
  $('summon-panel').hidden=!summonMode;
  $('maze-tower-count').textContent=(b.mazeTowers?.length||0)+' / 80 towers';
  $('route-length').textContent=Math.round((b.routeLength||0)/DEFENSE_GRID.cellSize)+' cells to exit';
  $('selected-cell').textContent=cellLabel(selectedPadId);
  $('cell-feedback').textContent=selectedPreview?.reason||(selectedPadId?'Ready to place.':'Tap a cell on the map or use the grid controls.');
  $('cell-feedback').dataset.valid=String(selectedPreview?.valid!==false);
  $('cell-apply').textContent=buildMode==='tower'?'Build here · 5 supplies':buildMode==='sell'?'Sell here · +3 supplies':summonMode?'Summon here':'Move crew here';
  $('cell-apply').disabled=locked||!selectedPadId||!selectedPreview?.valid||(summonMode&&!selectedSummonId);
  const selectedCell=DEFENSE_PADS.find(p=>p.id===selectedPadId);if(selectedCell){$('grid-column').value=String(selectedCell.col??selectedCell.column??Number(selectedPadId.split('-')[1]));$('grid-row').value=String(selectedCell.row??Number(selectedPadId.split('-')[2]));}
  $('placement-hint').textContent=!setup?'Building pauses during combat. Select a crew member to change targeting.':buildMode==='tower'?'Build small towers for 5 supplies. Shape the path into chokepoints beside your splash heroes.':buildMode==='sell'?'Sell a basic tower for 3 supplies to reopen or reshape a passage.':summonMode?'Select an owned character and an empty grid cell, then summon.':'Select a crew member, choose a cell, then Move crew here. Crew also blocks the route.';
  if(summonMode)renderSummons(locked);
  const detail=document.querySelector('.defender-detail');detail.hidden=!selected||summonMode||buildMode!=='crew';if(!selected)return;
  const c=CHARACTER_BY_ID[selected.characterId],p=getDefenseProfile(c.id),level=selected.level||1;
  $('defender-name').textContent=displayName(c)+' · Level '+level;$('defender-role').textContent=(p.label||PATTERN_LABELS[profilePattern(p)]||c.role).toUpperCase()+' · RANGE '+Math.round(selected.range);
  $('defender-pattern').textContent=profileText(p);$('defender-passive').textContent=c.passive.name+' · '+passiveDescription(c.passive);
  $('defense-priority').value=selected.priority||'first';$('defense-priority').disabled=!['setup','running'].includes(b.status)||!!savePending||unsavedLearning||!!learningPending||!current();
  $('upgrade-defender').textContent=level>=5?'Maximum level': 'Level up → '+(level+1)+' · '+level+' training';$('upgrade-defender').disabled=locked||level>=5||b.trainingPoints<level;
  const refund=Math.floor((selected.paidSupplies||0)*.5);$('recall-defender').textContent='Recall · +'+refund+' supplies';$('recall-defender').disabled=locked;
  $('upgrade-description').textContent='Each level adds 20% base attack, 15% base life, and 10% base defense. Three questions earn 1 training point plus 1 per correct answer. Levels and specialization last for this defense, even if you recall and summon the character again.';
  $('specialization-description').textContent=selected.specialization?'Specialization: '+(selected.specialization==='power'?'Power · +25% damage and 35% armor penetration':'Reach · +15% range, wider areas, and faster attacks'):level<3?'At level 3, choose Power (+25% damage, 35% armor penetration) or Reach (+15% range, wider areas, faster attacks).':'Choose Power for armored enemies or Reach for crowd coverage. This choice lasts for this defense.';
  for(const branch of ['power','reach']){const n=$('specialize-'+branch);n.disabled=locked||level<3||!!selected.specialization;n.setAttribute('aria-pressed',String(selected.specialization===branch));}
  const skillKey=selected.id+':'+level+':'+selected.specialization;
  if($('defender-skills').dataset.ally!==skillKey){$('defender-skills').dataset.ally=skillKey;$('defender-skills').replaceChildren(...c.skills.map(s=>{const shape=getDefenseSkillProfile(selected,s),n=button('',()=>{selectedPreviewSkillId=selectedPreviewSkillId===s.id?'':s.id;renderPlacement();},'defense-skill');n.dataset.skillPreview=s.id;n.setAttribute('aria-label','Preview '+s.name+' attack area');n.style.setProperty('--skill-color',s.color);n.append(el('strong','',(GLYPHS[s.kind]||'✧')+' '+s.name),el('small','skill-shape',(PATTERN_LABELS[profilePattern(shape)]||'Support')+' · Preview area'),el('span','',skillDescription(s).replaceAll('every enemy in range','enemies inside its attack shape')));return n;}));}
  for(const n of $('defender-skills').children)n.setAttribute('aria-pressed',String(n.dataset.skillPreview===selectedPreviewSkillId));
}
let selectedPlacementKey='',selectedPlacementValue=null;
function getSelectedPlacementPreview(){const key=[battle?.id,battle?.routeRevision,battle?.supplies,selectedPadId,buildMode,summonMode,selectedAllyId].join(':');if(key!==selectedPlacementKey){selectedPlacementKey=key;selectedPlacementValue=getMazePlacementPreview(battle,selectedPadId,{kind:buildMode==='tower'?'tower':'crew',remove:buildMode==='sell',...(buildMode==='crew'&&!summonMode?{allyId:selectedAllyId}:{})});}return selectedPlacementValue;}
function renderSummons(locked){
  const b=battle,query=$('summon-search').value.trim().toLowerCase(),pattern=$('summon-pattern').value;
  const rows=CHARACTERS.filter(c=>collection.cards[c.id]?.copies>0&&(!query||(c.name+' '+c.title).toLowerCase().includes(query))&&(pattern==='all'||getDefenseProfile(c.id).skills.some(skill=>skill.shape===pattern)));
  const key=b.id+':'+rows.map(c=>c.id).join(',');
  if($('summon-roster').dataset.key!==key){$('summon-roster').dataset.key=key;$('summon-roster').replaceChildren(...rows.map(c=>{const p=getDefenseProfile(c.id),n=button('',()=>selectSummon(c.id),'summon-card');n.dataset.summon=c.id;const face=el('span','summon-face card-art');art.attach(face,c.id);n.append(face,el('strong','',displayName(c)),el('span','',p.label||PATTERN_LABELS[profilePattern(p)]),el('small'));return n;}));}
  for(const n of $('summon-roster').children){const c=CHARACTER_BY_ID[n.dataset.summon],deployed=b.allies.some(u=>u.characterId===c.id),cost=20+5*c.stars;n.disabled=locked||deployed||b.supplies<cost;n.setAttribute('aria-pressed',String(c.id===selectedSummonId));n.querySelector('small').textContent=deployed?'DEPLOYED':cost+' SUPPLIES';}
  const c=CHARACTER_BY_ID[selectedSummonId],pad=DEFENSE_PADS.find(p=>p.id===selectedPadId),occupied=b.allies.some(u=>u.padId===selectedPadId),cost=c?20+5*c.stars:0,preview=pad?getMazePlacementPreview(b,pad.id,{kind:'crew'}):null;
  $('summon-choice').textContent=c?(displayName(c)+' · '+(profileText(getDefenseProfile(c.id)))+' '+(pad?(occupied?'That position is occupied. Choose an empty spot.':cellLabel(pad.id)):'Choose an empty grid cell.')):rows.length?'Select an unlocked character to see their attack style.':'No owned characters match. Open packs to expand your options.';
  $('summon-confirm').textContent=c?'Summon '+displayName(c)+' · '+cost+' supplies':'Choose a character and cell';$('summon-confirm').disabled=locked||!c||!pad||occupied||b.supplies<cost||b.allies.some(u=>u.characterId===selectedSummonId)||b.allies.length>=10||!preview?.valid;
  $('cell-apply').disabled=$('summon-confirm').disabled;
}
function retreat(after){if(learningPending?.waiting||savePending||unsavedLearning){toast('Finish the current questions and save before leaving the defense.');return;}if(!battle){after?.();return;}if(['victory','defeat'].includes(battle.status)){battle=null;after?.();return;}const panel=openDialog('retreat','Leave this defense?');panel.append(el('p','', 'This defense will end. Your cards and completed question records are retained. Finish all six waves and their questions to open the next harbor.'));const actions=el('div','dialog-actions');actions.append(button('Keep defending',closeDialog,'gold-button'),button('Retreat',()=>{learningPending=null;questionSession=null;closeDialog();battle=null;go('campaign');after?.();}));panel.append(actions);}
function ending(){if(!battle)return;const win=battle.status==='victory',panel=openDialog('ending',win?'The harbor is safe.':'Regroup. Return stronger.');panel.classList.add('battle-result');panel.insertBefore(el('p','eyebrow',win?'DEFENSE COMPLETE':'CREW DEFENSE'),panel.firstChild);panel.append(el('p','',win?(battle.encounter.id===9?'Your crew protected every harbor. Replay a defense with a new crew or formation.':'Your crew held the route. A new harbor is ready to defend.'):'Move attackers near bends in the route, cover them with a healer, and strengthen the next wave with correct answers.'));
  const stats=el('div','result-stats');for(const [label,value]of[['WAVES',battle.round],['CORRECT ANSWERS',(battle.roundResults||[]).reduce((n,r)=>n+r.correct,0)],['SHIP LIFE',Math.ceil(battle.ship.hp)]]){const n=el('span');n.append(el('strong','',value),document.createTextNode(label));stats.append(n);}panel.append(stats);const actions=el('div','dialog-actions');actions.append(button(win?(battle.encounter.id===9?'Choose a harbor':'Choose next harbor'):'Try defense again',()=>{const stage=battle.encounter.id;closeDialog();battle=null;win?go('campaign'):beginBattle(stage);},'gold-button'),button('Review my crew',()=>{closeDialog();battle=null;go('crew');}));panel.append(actions);sound(win?'win':'click');}
function requestLearning(){
  if(!battle||battle.status!=='learning'||learningPending?.waiting||adminPending||savePending||!current())return;
  if(!embedded){startPreviewQuestions();return;}
  const requestId=uuid('round'),round=bridgeRound+1;learningPending={requestId,round,battleId:battle.id,battleRound:battle.round,waiting:true,message:'Your portal is preparing three suitable questions.'};post({type:'GLTCG_ROUND_REQUEST',requestId,sessionId,round});renderBattle();
}
async function finishLearning(correct,total,battleRound){
  if(!battle||battle.status!=='learning')return;const result=completeDefenseLearning(battle,{correct,total,round:battleRound});if(!result)return;
  learningPending=null;unsavedLearning=true;renderCounters();if(!result.outcome)toast(`${correct}/3 correct · +${result.trainingGranted} training points. Upgrade a defender before wave ${battle.round}.`);await saveLearningProgress();
}
async function saveLearningProgress(){
  try{await persistCollection();unsavedLearning=false;if(dialog==='save-progress')closeDialog();busyUntil=0;lastFrame=0;renderBattle();}
  catch(error){if(!current())return;const panel=openDialog('save-progress','Saving your defense');panel.querySelector('.dialog-close')?.remove();panel.append(el('p','',error.message),el('p','', 'Your answers have been graded. Combat is paused until your battle progress is saved.'),button('Retry saving',saveLearningProgress,'gold-button'));}
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
  if(q.graded){panel.append(el('p','question-feedback'+(q.selected===answer?'':' wrong'),`${q.selected===answer?'Correct.':'The correct answer is '+options[answer]+'.'} ${explanation}`));panel.append(button(q.index===2?'Return to defense':'Next question',()=>{if(q.index===2){const result={correct:q.correct,round:q.battleRound};questionSession=null;closeDialog();finishLearning(result.correct,3,result.round);}else{q.index++;q.selected=null;q.graded=false;previewQuestion();}},'gold-button'));}
  else{const submit=button('Check answer',()=>{if(q.selected===null||q.graded)return;q.graded=true;if(q.selected===answer)q.correct++;previewQuestion();},'gold-button');submit.disabled=q.selected===null;panel.append(submit);}
}
function help(){
  const panel=openDialog('settings','Build. Summon. Defend.');panel.append(el('p','', 'Collect fifty One Piece characters and deploy up to ten matching avatars on the maze grid. Build cheap towers to steer enemies through their attacks on the way from the left entrance to the right exit.'));
  const options=el('div','settings-options');for(const [key,label]of[['muted','Mute sound'],['reducedMotion','Reduce animation']]){const n=el('label'),input=el('input');input.type='checkbox';input.checked=settings[key];input.onchange=()=>{settings[key]=input.checked;settingsUI();savePreferences();};n.append(input,document.createTextNode(label));options.append(n);}panel.append(options);
  const rules=el('ol','rules-list');for(const text of ['Choose up to ten free starting defenders in My crew. Summon any other owned card onto an empty position using battle supplies. Each character can be deployed once, up to ten at a time.','Build a maze with cheap 5-supply towers. Tap a square cell, then Build here. Towers and crew block the route; the preview shows the new path and sealed paths are rejected. Place splash heroes beside chokepoints. Sell towers for 3 supplies between waves.','Start a wave and watch the crew defend automatically. Line, cone, surrounding area, splash, and chain attacks hit different groups. Target First, Strongest, or Cluster; healers, shields, freezing, poison, and character passives support the crew. Enemies reaching the ship damage its life.','Each harbor has six waves. After every wave, including the last or a defeat, answer exactly three Math or Science questions. Spend your training points to level up defenders, choose Power or Reach at level 3, and summon reinforcements before starting the next wave.','Each correct answer gives the next wave +10% attack, +5 percentage points critical chance, and +8% defense. Three correct answers give +30%, +15 percentage points, and +24%. Boosts refresh and do not stack between waves.','Pause any time; choose 1×, 2×, or 4× speed. Keyboard: 1–9 and 0 select a defender and Space starts or pauses a wave. Focus the map and use arrow keys to select a cell, then Enter to apply the selected build tool. Grid column and row controls provide precise phone placement.','Packs cost your platform’s existing reward points at its current TCG rates. Every pack contains exactly one card. Duplicate copies merge at 2, 4, 8, 16… copies up to rank 10, adding 12% base life, attack, and defense per rank.','The current seven-star cards are Kaido the Beast, Whitebeard, and Admiral Akainu. Eight reserved legends, including Sengoku, remain unavailable until future expansions.','Gameplay pauses in hidden tabs, menus, questions, and pending saves. There are no offline rewards. Previously unlocked harbors, cards, and pack receipts carry over.'])rules.append(el('li','',text));panel.append(rules);panel.append(button('Ready to defend',closeDialog,'gold-button'));
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
  if(d.type==='GLTCG_INVALIDATE'){if(adminPending)clearTimeout(adminPending.timer);adminPending=null;admin={available:false,unlimitedGold:false};wallet.unlimitedGold=false;$('admin-tools').hidden=true;sessionId='';ready=false;learningPending=null;questionSession=null;unsavedLearning=false;battle=null;if(purchasePending)clearTimeout(purchasePending.timer);purchasePending=null;if(savePending){clearTimeout(savePending.timer);savePending.reject(Error('The learning profile changed.'));savePending=null;}closeDialog();go('collection');connection(d.message||'Your profile changed. Reopen the game from the portal.',true);return;}
  if(['GLTCG_ADMIN_RESULT','GLTCG_ADMIN_BLOCKED'].includes(d.type)){
    const pending=adminPending;if(!pending||d.requestId!==pending.requestId)return;clearTimeout(pending.timer);
    if(d.type==='GLTCG_ADMIN_RESULT'){adminPending=null;applySnapshot(d);toast(pending.action==='unlock-all'?'All 50 current cards and their battle avatars are unlocked.':admin.unlimitedGold?'Unlimited gold is on. Keep opening packs.':'Unlimited gold is off. Packs use your saved points.');}
    else{pending.waiting=false;pending.message=(d.message||'The admin change could not be confirmed.')+' Retry this change before opening more packs.';toast(pending.message);}
    renderPacks();return;
  }
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
  const delta=lastFrame?Math.min(.1,Math.max(0,(now-lastFrame)/1000)):0;lastFrame=now;
  if(battle&&view==='battle'){
    const previous=battle.status;
    if(!busy()&&!defensePaused&&battle.status==='running')advanceDefense(battle,delta*settings.battleSpeed);
    updatePlacementPreview();const events=renderer.draw(battle,now,{selectedAllyId,selectedPadId,hoverPadId,buildMode,placementPreview,summonCharacterId:summonMode?selectedSummonId:'',previewSkillId:selectedPreviewSkillId,reducedMotion:settings.reducedMotion})||[];
    if(events.length){const text=(events.find(e=>e.skillId&&e.text)||events.find(e=>e.text))?.text||'';$('action-banner').textContent=text;bannerUntil=now+1100;}
    if(bannerUntil&&now>bannerUntil){$('action-banner').textContent='';bannerUntil=0;}
    if(previous!==battle.status||now-lastHud>250){renderBattle();lastHud=now;}
  }requestAnimationFrame(frame);
}
for(const n of document.querySelectorAll('[data-view]'))n.onclick=()=>go(n.dataset.view);
for(const n of document.querySelectorAll('[data-go]'))n.onclick=()=>go(n.dataset.go);
document.querySelector('.brand').onclick=event=>{event.preventDefault();go('collection');};
$('search-input').oninput=renderCollection;for(const id of ['ownership-filter','star-filter','sort-filter'])$(id).onchange=renderCollection;
$('apex-showcase').replaceChildren(...['kaido','whitebeard','akainu'].map(id=>card(CHARACTER_BY_ID[id],{eager:true})));
$('admin-unlimited').onclick=()=>requestAdminAction('set-unlimited-gold',!admin.unlimitedGold);$('admin-unlock-all').onclick=()=>requestAdminAction('unlock-all');$('admin-retry').onclick=retryAdminAction;
$('open-pack').onclick=beginPurchase;$('study-button').onclick=requestLearning;$('retreat-button').onclick=()=>retreat();
$('start-wave').onclick=startWave;$('defense-pause').onclick=toggleDefensePause;
$('defense-speed').onchange=()=>{const value=Number($('defense-speed').value);if(DEFENSE_SPEEDS.includes(value))settings.battleSpeed=value;lastFrame=0;savePreferences();renderBattle();};
$('future-characters').replaceChildren(...FUTURE_EXPANSION_CHARACTERS.map(c=>el('li','',`${c.name} · 7★ future expansion`)));
$('roster-conversions').textContent=FUTURE_EXPANSION_CHARACTERS.map(c=>`${c.name} → ${CHARACTER_BY_ID[RETIRED_CHARACTER_REPLACEMENTS[c.id]]?.name}`).join(' · ');
$('battle-canvas').addEventListener('click',e=>{const id=renderer.pickPad(e.clientX,e.clientY);if(id)choosePad(id);});
$('battle-canvas').addEventListener('pointermove',e=>{hoverPadId=renderer.pickPad(e.clientX,e.clientY)||'';});
$('battle-canvas').addEventListener('pointerleave',()=>{hoverPadId='';});
for(let c=0;c<26;c++){$('grid-column').append(new Option(String.fromCharCode(65+c),String(c)));}for(let r=0;r<13;r++)$('grid-row').append(new Option(String(r+1),String(r)));
function selectGridControl(){choosePad('cell-'+$('grid-column').value+'-'+$('grid-row').value);}
$('grid-column').onchange=selectGridControl;$('grid-row').onchange=selectGridControl;
for(const n of document.querySelectorAll('[data-grid-step]'))n.onclick=()=>{const [dc,dr]=n.dataset.gridStep.split(',').map(Number);const p=DEFENSE_PADS.find(p=>p.id===selectedPadId)||DEFENSE_DEFAULT_PADS[0];choosePad('cell-'+Math.max(0,Math.min(25,Number(p.id.split('-')[1])+dc))+'-'+Math.max(0,Math.min(12,Number(p.id.split('-')[2])+dr)));};
function setMapZoom(value){mapZoom=value===2?2:1;const viewport=$('map-viewport');viewport.classList.toggle('map-zoomed',mapZoom===2);if(mapZoom===1){viewport.scrollLeft=0;viewport.scrollTop=0;}$('map-zoom').setAttribute('aria-pressed',String(mapZoom===2));$('map-zoom').textContent=mapZoom===2?'Fit map':'Zoom map';requestAnimationFrame(()=>renderer.resize());}
$('map-zoom').onclick=()=>setMapZoom(mapZoom===1?2:1);
$('battle-canvas').onkeydown=event=>{const moves={ArrowLeft:'-1,0',ArrowRight:'1,0',ArrowUp:'0,-1',ArrowDown:'0,1'};if(moves[event.key]){event.preventDefault();document.querySelector('[data-grid-step="'+moves[event.key]+'"]').click();}if(event.key==='Enter'){event.preventDefault();applyCellAction();}};
$('summon-toggle').onclick=()=>{if(!canPrepare())return;buildMode='crew';summonMode=true;placementPreviewKey='';selectedPadId='';renderPlacement();};
$('move-toggle').onclick=()=>setBuildMode('crew');$('build-toggle').onclick=()=>setBuildMode('tower');$('sell-toggle').onclick=()=>setBuildMode('sell');$('cell-apply').onclick=applyCellAction;
$('summon-search').oninput=()=>renderPlacement();$('summon-pattern').onchange=()=>renderPlacement();
$('summon-confirm').onclick=()=>summonCharacter();$('upgrade-defender').onclick=upgradeSelected;$('recall-defender').onclick=recallSelected;
$('specialize-power').onclick=()=>specializeSelected('power');$('specialize-reach').onclick=()=>specializeSelected('reach');$('defense-priority').onchange=e=>setPriority(e.target.value);
$('settings-button').onclick=help;$('help-button').onclick=help;$('sound-button').onclick=()=>{settings.muted=!settings.muted;settingsUI();savePreferences();sound();};
$('rift-button').onclick=()=>{if(adminPending||learningPending?.waiting||unsavedLearning||savePending||purchasePending?.waiting){toast('Finish the current questions or save before switching games.');return;}if(embedded)post({type:'GLTCG_OPEN_RIFT'});else location.href='./pirate-rift.html';};
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select'))return;
  if(dialog){if(event.key==='Escape'&&dialog!=='question'){event.preventDefault();closeDialog();}if(event.key==='Tab'){const nodes=[...$('dialog-panel').querySelectorAll('button:not(:disabled),input,select,a[href]')];if(nodes.length&&event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(nodes.length&&!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}return;}
  if(view!=='battle'||!battle||event.repeat||event.target.closest?.('button,a'))return;if(/^[0-9]$/.test(event.key)){const unit=battle.allies[(Number(event.key)||10)-1];if(unit){event.preventDefault();selectDefender(unit.id);}}if(event.code==='Space'){event.preventDefault();battle.status==='setup'?startWave():toggleDefensePause();}
});
window.addEventListener('pagehide',()=>{savePreferences();audioContext?.suspend().catch(()=>{});});document.addEventListener('visibilitychange',()=>{lastFrame=0;if(document.hidden)audioContext?.suspend().catch(()=>{});else if(battle&&view==='battle')renderBattle();});

window.addEventListener('error',()=>{if(!document.querySelector('.tcg-card'))$('fatal').hidden=false;});
loadPreferences();renderCounters();renderCollection();if(!embedded)connection('Crew Defense preview · Questions are local examples. Sign in through Math or Science to purchase cards with platform reward points.');else{connection('Connecting to your portal, learning profile and reward-point wallet…');hello();}
requestAnimationFrame(frame);
if(params.get('test')==='1')window.__grandLine={get collection(){return collection;},get battle(){return battle;},get wallet(){return wallet;},get admin(){return admin;},get adminPending(){return adminPending;},requestAdminAction,retryAdminAction,get dialog(){return dialog;},get sessionId(){return sessionId;},get learningPending(){return learningPending;},get purchasePending(){return purchasePending;},get scope(){return scope;},get settings(){return settings;},get defensePaused(){return defensePaused;},get ready(){return ready;},get unsavedLearning(){return unsavedLearning;},art,renderer,go,beginBattle,startWave,placeDefender,selectDefender,summonCharacter,recallSelected,upgradeSelected,specializeSelected,setPriority,selectSummon,choosePad,setBuildMode,applyCellAction,changeTeam,removeCrewMember,toggleDefensePause,advanceDefense,completeDefenseLearning,requestLearning,inspectCard,closeDialog,renderBattle,renderCollection,applySnapshot,statsFor,CHARACTERS,ENCOUNTERS,DEFENSE_STAGES,DEFENSE_PADS,DEFENSE_GRID,DEFENSE_DEFAULT_PADS};
