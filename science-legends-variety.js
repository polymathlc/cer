/* Distinct enemy commitments. Only advance/onDeath emit gameplay effects. */
(function(root){
  'use strict';
  var TAU=Math.PI*2, MAX_ENEMIES=140;
  function freeze(o){return Object.freeze(o);}
  function own(object,key){return Object.prototype.hasOwnProperty.call(object,key);}
  var definitions=freeze({
    warden:freeze({hp:126,speed:43,dmg:15,r:21,xp:14,minWave:4,weight:.65,name:'Iron Warden',color:'#e5bc76',model:'warden',fallback:'brute'}),
    broodling:freeze({hp:43,speed:73,dmg:7,r:16,xp:8,minWave:5,weight:.9,name:'Eggback Broodling',color:'#b8dc78',model:'broodling',fallback:'slime'}),
    hexer:freeze({hp:41,speed:58,dmg:9,r:14,xp:11,minWave:6,weight:.55,name:'Rift Hexer',color:'#bba0e5',model:'hexer',fallback:'spitter'}),
    sentinel:freeze({hp:57,speed:52,dmg:10,r:16,xp:12,minWave:7,weight:.5,name:'Crossbow Sentinel',color:'#e3b17e',model:'sentinel',fallback:'charger'})
  });
  var guides=freeze({
    warden:freeze({name:'Iron Warden',role:'Shielded frontline',tell:'An amber swing marks its committed mace strike.',counter:'Flank its shield, strike during recovery, or break the guard with heavy hits.',icon:'\u25d0',color:'#e5bc76'}),
    hexer:freeze({name:'Rift Hexer',role:'Ground-control caster',tell:'A violet curse circle locks where its target was standing.',counter:'Leave the circle. Freeze, stun or land a heavy hit during the cast to cancel it.',icon:'\u2726',color:'#bba0e5'}),
    broodling:freeze({name:'Eggback Broodling',role:'Hatching pursuer',tell:'Two emerald egg sacs signal a possible hatch on death.',counter:'Kill it while frozen or stunned to prevent the hatch. Hatchlings have no loot or XP.',icon:'\u25c9',color:'#b8dc78'}),
    sentinel:freeze({name:'Crossbow Sentinel',role:'Committed ranged volley',tell:'Three amber lanes show the exact incoming bolt directions.',counter:'Step between the lanes or interrupt the windup; it cannot turn its volley after aiming.',icon:'\u27b6',color:'#e3b17e'}),
    volatile:freeze({name:'Volatile elite',role:'Counterable death burst',tell:'A jagged ember crest marks the elite; its death leaves a warning ring.',counter:'Move away from the ring, or kill it while frozen or stunned to disarm the burst.',icon:'\u2739',color:'#f09b72'}),
    boss:freeze({name:'Core Tyrant',role:'Chamber tyrant',tell:'Its ground strike locks before release and leaves a recovery opening.',counter:'Leave the warning area, then attack during recovery. At half life, expect three linked strike circles.',icon:'\u265c',color:'#e2a0cb'}),
    bossEnraged:freeze({name:'Enraged Core Tyrant',role:'Three-lane groundbreaker',tell:'Three linked ground circles replace the single strike below 55% life.',counter:'Move clear of the whole line, then punish its recovery; control effects cancel the windup.',icon:'\u265c',color:'#f1a284'})
  });
  var order=freeze(['warden','hexer','broodling','sentinel']);
  var models={};order.forEach(function(kind,index){models[kind]=freeze({column:index,fallback:definitions[kind].fallback});});freeze(models);
  var guideEntries=freeze(order.map(function(k){return guides[k];}).concat([guides.volatile,guides.boss]));
  function handles(kind){return own(definitions,kind)||kind==='boss';}
  function live(e){return !!e&&!e.dead&&e.hp>0;}
  function bounded(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function initialize(e,ctx){
    if(!e||e.variety)return e&&e.variety;
    e.varietyGrace=.8;e.hitCd=Math.max(e.hitCd||0,.8);
    var s=e.variety={phase:'approach',timer:0,cooldown:e.kind==='boss'?1.8:1.05,guard:Math.max(12,(e.maxHp||e.hp||60)*.23),guardMax:Math.max(12,(e.maxHp||e.hp||60)*.23),guardCycle:0,brokenUntil:0,aimX:e.x,aimY:e.y,aimDX:1,aimDY:0,target:null,castSerial:0,phaseTwo:false,summonCd:8.5,feedback:null};
    if(e.elite&&!e.boss&&(e.kind==='warden'||e.kind==='hexer'||e.kind==='sentinel')){
      var active=0,others=ctx&&ctx.enemies;
      if(others)for(var i=0;i<others.length;i++)if(others[i]!==e&&live(others[i])&&others[i].varietyAffix==='volatile')active++;
      if(active<3)e.varietyAffix='volatile';
    }
    return s;
  }
  function note(e,kind,text,color,time,ctx){
    var s=e.variety||initialize(e);s.feedback={kind:kind,text:text,color:color,time:time};
    if(ctx&&ctx.cue)ctx.cue(text,color,e);
  }
  function interrupt(e,reason,ctx){
    var s=e&&e.variety;
    if(!s||s.phase!=='windup')return false;
    s.phase='recovery';s.timer=.62;s.cooldown=Math.max(s.cooldown,.9);s.target=null;
    e.modelAttackUntil=0;
    note(e,'interrupt',reason==='frozen'?'FROZEN — INTERRUPTED':'INTERRUPTED','#b7e8f0',ctx&&ctx.time||0,ctx);
    return true;
  }
  function setFacing(e,dx,dy){var d=Math.hypot(dx,dy)||1;e.fx=dx/d;e.fy=dy/d;return d;}
  function lock(e,target,time,timer){
    var s=e.variety,dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1;
    s.aimX=target.x;s.aimY=target.y;s.aimDX=dx/d;s.aimDY=dy/d;s.target=target;s.phase='windup';s.timer=timer;s.duration=timer;s.castSerial++;
    e.fx=s.aimDX;e.fy=s.aimDY;e.modelAttackUntil=time+timer+.13;
  }
  function move(e,dx,dy,d,dt,slow,mult){e.x+=dx/d*e.speed*slow*dt*mult;e.y+=dy/d*e.speed*slow*dt*mult;}
  function recover(s,dt){s.timer=Math.max(0,s.timer-dt);if(s.timer<=1e-8)s.phase='approach';}
  function emitHazard(ctx,e,s,spec){
    if(!ctx.hazard)return;
    spec.source=e;spec.owner=e;spec.castId=s.castSerial;spec.detached=true;ctx.hazard(spec);
  }
  function advanceWarden(e,dt,target,ctx,dx,dy,d){
    var s=e.variety,time=ctx.time||0;
    s.guardCycle=(s.guardCycle+dt)%4.2;
    if(s.brokenUntil>time)return move(e,dx,dy,d,dt,ctx.slowMult||1,.45);
    if(s.brokenUntil&&s.brokenUntil<=time){s.brokenUntil=0;s.guard=s.guardMax;}
    if(s.phase==='recovery'){recover(s,dt);return;}
    if(s.phase==='windup'){
      s.timer-=dt;if(s.timer>1e-8)return;
      var t=s.target,tx=t&&t.x-e.x,ty=t&&t.y-e.y,range=e.r+(t&&t.r||14)+54,length=Math.hypot(tx||0,ty||0),dot=length?((tx*s.aimDX+ty*s.aimDY)/length):1;
      s.phase='recovery';s.timer=1.05;s.cooldown=1.1;s.target=null;
      if(live(t)&&length<=range&&dot>=Math.cos(.95)&&ctx.strike)ctx.strike(t,e.dmg*1.15);
      note(e,'mace','MACE STRIKE','#ecc28b',time,ctx);return;
    }
    setFacing(e,dx,dy);s.cooldown=Math.max(0,s.cooldown-dt);
    if(d<e.r+(target.r||14)+58&&s.cooldown<=0){lock(e,target,time,.68);return;}
    if(d>e.r+(target.r||14)+18)move(e,dx,dy,d,dt,ctx.slowMult||1,1);
  }
  function advanceHexer(e,dt,target,ctx,dx,dy,d){
    var s=e.variety,time=ctx.time||0;
    if(s.phase==='recovery'){recover(s,dt);return;}
    if(s.phase==='windup'){
      s.timer-=dt;if(s.timer>1e-8)return;
      emitHazard(ctx,e,s,{kind:'curse',x:s.aimX,y:s.aimY,r:54,warning:.12,life:1.85,tick:.45,damage:e.dmg*.55,slow:.24,color:'#b294da'});
      s.phase='recovery';s.timer=.62;s.cooldown=3.05;s.target=null;
      note(e,'curse','CURSE RELEASED','#c9a9ed',time,ctx);return;
    }
    setFacing(e,dx,dy);s.cooldown=Math.max(0,s.cooldown-dt);
    if(s.cooldown<=0&&d<365){lock(e,target,time,.72);return;}
    if(d>295)move(e,dx,dy,d,dt,ctx.slowMult||1,1);
    else if(d<180)move(e,dx,dy,d,dt,ctx.slowMult||1,-.7);
  }
  function advanceSentinel(e,dt,target,ctx,dx,dy,d){
    var s=e.variety,time=ctx.time||0;
    if(s.phase==='recovery'){recover(s,dt);return;}
    if(s.phase==='windup'){
      s.timer-=dt;if(s.timer>1e-8)return;
      var a=Math.atan2(s.aimDY,s.aimDX);
      if(ctx.shoot)for(var i=-1;i<=1;i++){var angle=a+i*.28;ctx.shoot({x:e.x+s.aimDX*(e.r+5),y:e.y+s.aimDY*(e.r+5),vx:Math.cos(angle)*300,vy:Math.sin(angle)*300,r:4.5,damage:e.dmg*.72,life:1.9,element:'physical',color:'#edc187',source:e});}
      s.phase='recovery';s.timer=.75;s.cooldown=2.7;s.target=null;
      note(e,'volley','VOLLEY','#e7bf8f',time,ctx);return;
    }
    setFacing(e,dx,dy);s.cooldown=Math.max(0,s.cooldown-dt);
    if(s.cooldown<=0&&d<370){lock(e,target,time,.66);return;}
    if(d>305)move(e,dx,dy,d,dt,ctx.slowMult||1,1);
    else if(d<165)move(e,dx,dy,d,dt,ctx.slowMult||1,-.65);
  }
  function advanceBoss(e,dt,target,ctx,dx,dy,d){
    var s=e.variety,time=ctx.time||0;
    if(!s.phaseTwo&&e.hp<=e.maxHp*.55){s.phaseTwo=true;s.phase='recovery';s.timer=1.1;s.cooldown=0;note(e,'enrage','TYRANT ENRAGED','#f6ad8c',time,ctx);}
    s.summonCd=Math.max(0,s.summonCd-dt);
    if(s.phase==='recovery'){recover(s,dt);return;}
    if(s.phase==='windup'){
      s.timer-=dt;if(s.timer>1e-8)return;
      var n=s.phaseTwo?3:1,spread=s.phaseTwo?68:0;
      for(var i=0;i<n;i++)emitHazard(ctx,e,s,{kind:'tyrant',x:s.aimX-s.aimDY*(i-(n-1)/2)*spread,y:s.aimY+s.aimDX*(i-(n-1)/2)*spread,r:s.phaseTwo?57:88,warning:.1,life:.18,tick:.3,damage:e.dmg*(s.phaseTwo?.85:1),slow:0,color:s.phaseTwo?'#eaa07f':'#cf9ecb'});
      s.phase='recovery';s.timer=s.phaseTwo?1.15:.9;s.cooldown=s.phaseTwo?2.75:4.1;s.target=null;return;
    }
    setFacing(e,dx,dy);s.cooldown=Math.max(0,s.cooldown-dt);
    if(s.cooldown<=0&&d<300){lock(e,target,time,s.phaseTwo?.76:.9);return;}
    if(s.summonCd<=0&&ctx.spawnChild){
      s.summonCd=8.5;
      for(var a=-1;a<=1;a+=2)ctx.spawnChild({kind:'imp',x:e.x-dx/d*32-dy/d*a*25,y:e.y-dy/d*32+dx/d*a*25,noLoot:false,noXP:false,grace:1.1,parentKind:'boss'});
      note(e,'summon','TYRANT REINFORCEMENTS','#d5b1df',time,ctx);
    }
    if(d>e.r+(target.r||14)+20)move(e,dx,dy,d,dt,ctx.slowMult||1,.85);
  }
  function advance(e,dt,target,ctx){
    if(!e||!handles(e.kind))return false;
    var s=initialize(e),valid=Number.isFinite(dt)&&dt>0&&dt<=.25;ctx=ctx||{};
    if(!live(e)){s.phase='dead';s.timer=0;s.target=null;return true;}
    if(!valid||ctx.paused||ctx.ended||!live(target))return true;
    if(e.frozen>0||e.stun>0){interrupt(e,e.frozen>0?'frozen':'stun',ctx);return true;}
    e.varietyGrace=Math.max(0,(e.varietyGrace||0)-dt);
    var dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1;
    if(e.kind==='warden')advanceWarden(e,dt,target,ctx,dx,dy,d);
    else if(e.kind==='hexer')advanceHexer(e,dt,target,ctx,dx,dy,d);
    else if(e.kind==='sentinel')advanceSentinel(e,dt,target,ctx,dx,dy,d);
    else if(e.kind==='boss')advanceBoss(e,dt,target,ctx,dx,dy,d);
    else{setFacing(e,dx,dy);move(e,dx,dy,d,dt,ctx.slowMult||1,1);}
    return true;
  }
  function contactAllowed(kind,e){return kind==='broodling'&&(!e||!(e.varietyGrace>0));}
  function guarding(e,time){var s=e&&e.variety;return e&&e.kind==='warden'&&live(e)&&s&&s.phase==='approach'&&s.guardCycle<3.05&&!(s.brokenUntil>time)&&!(e.frozen>0)&&!(e.stun>0);}
  function modifyDamage(e,amount,source,time){
    var result={amount:amount,blocked:false,broken:false,interrupted:false};
    if(!e||!handles(e.kind)||!Number.isFinite(amount)||amount<=0)return result;
    var s=initialize(e);source=source||{};time=Number(time)||0;
    if(source.heavy&&(e.kind==='hexer'||e.kind==='sentinel')&&s.phase==='windup')result.interrupted=interrupt(e,'hit',{time:time});
    if(guarding(e,time)){
      var dx=Number.isFinite(source.sourceX)?source.sourceX-e.x:source.dx,dy=Number.isFinite(source.sourceY)?source.sourceY-e.y:source.dy,d=Math.hypot(dx||0,dy||0);
      if(d>0&&((dx*(e.fx||0)+dy*(e.fy||0))/d)>=Math.cos(.9)){
        s.guard-=amount*(source.heavy?1.65:.85);result.blocked=true;
        if(s.guard<=0){s.guard=0;s.brokenUntil=time+1.9;s.phase='recovery';s.timer=.62;result.broken=true;result.blocked=false;note(e,'guard-break','GUARD BROKEN','#ffdf9d',time);}
        else result.amount=amount*.35;
      }
    }
    if(!result.broken&&!result.interrupted&&e.kind==='broodling'&&(!s.feedback||time-s.feedback.time>.24))note(e,'shell','SHELL HIT','#c1e496',time);
    return result;
  }
  function onDeath(e,ctx){
    if(!e||e.varietyDeathHandled||!e.dead&&e.hp>0)return {children:0,volatile:false,disarmed:false};
    e.varietyDeathHandled=true;ctx=ctx||{};var disarmed=e.frozen>0||e.stun>0,children=0,volatile=false;
    if(e.variety){e.variety.phase='dead';e.variety.timer=0;e.variety.target=null;}
    if(ctx.paused||ctx.ended)return {children:0,volatile:false,disarmed:disarmed};
    if(e.kind==='broodling'&&!disarmed&&ctx.spawnChild){
      var fx=e.fx||1,fy=e.fy||0;
      for(var i=-1;i<=1;i+=2){var child=ctx.spawnChild({kind:'mite',x:e.x-fy*i*14,y:e.y+fx*i*14,noLoot:true,noXP:true,grace:.7,parentKind:'broodling'});if(child)children++;}
      if(children&&ctx.cue)ctx.cue('HATCHLINGS — NO LOOT','#b8dc78',e);
    }else if(e.kind==='broodling'&&disarmed&&ctx.cue)ctx.cue('HATCH PREVENTED','#a8e4e5',e);
    if(e.varietyAffix==='volatile'){
      if(disarmed){if(ctx.cue)ctx.cue('VOLATILE DISARMED','#b3e9e8',e);}
      else if(ctx.hazard){ctx.hazard({kind:'volatile',x:e.x,y:e.y,r:65,warning:.85,life:.16,tick:.3,damage:e.dmg*.8,slow:0,color:'#efa17a',source:e,owner:null,detached:true});volatile=true;}
    }
    return {children:children,volatile:volatile,disarmed:disarmed};
  }
  function countAlive(enemies,kind){var n=0;for(var i=0;i<enemies.length;i++)if(live(enemies[i])&&enemies[i].kind===kind)n++;return n;}
  function canSpawn(kind,wave,enemies,max){
    enemies=enemies||[];wave=Math.max(1,Math.floor(Number(wave)||1));
    var limit=Number.isFinite(max)?Math.max(0,Math.floor(max)):MAX_ENEMIES;
    if(!own(definitions,kind)&&['slime','imp','mite','brute','spitter','charger','boss'].indexOf(kind)<0)return false;
    if(enemies.length>=limit)return false;
    var def=own(definitions,kind)?definitions[kind]:null;if(def&&wave<def.minWave)return false;
    var cap=kind==='warden'?Math.min(4,2+Math.floor(wave/8)):kind==='hexer'?Math.min(3,1+Math.floor(wave/10)):kind==='sentinel'?Math.min(3,1+Math.floor(wave/12)):kind==='broodling'?Math.min(6,3+Math.floor(wave/8)):Infinity;
    if(countAlive(enemies,kind)>=cap)return false;
    if(kind==='spitter'||kind==='hexer'||kind==='sentinel'){
      var ranged=countAlive(enemies,'spitter')+countAlive(enemies,'hexer')+countAlive(enemies,'sentinel');
      if(ranged>=Math.min(8,2+Math.floor(wave/3)))return false;
    }
    return true;
  }
  function pickKind(wave,enemies,roll,pool,max){
    pool=pool||['slime','imp','mite','brute','spitter','charger'].concat(order);
    var total=0,k,i,weight,options=[];roll=bounded(Number(roll)||0,0,.999999999);
    for(i=0;i<pool.length;i++){
      k=pool[i];if(k==='boss'||!canSpawn(k,wave,enemies,max))continue;
      if(!own(definitions,k)&&((k==='mite'&&wave<2)||((k==='brute'||k==='spitter')&&wave<4)||(k==='charger'&&wave<6)))continue;
      weight=wave<4?1:own(definitions,k)?definitions[k].weight:1;total+=weight;options.push({kind:k,end:total});
    }
    for(i=0;i<options.length;i++)if(roll*total<options[i].end)return options[i].kind;
    return null;
  }
  function intelligence(e){return e&&e.kind==='boss'?(e.variety&&e.variety.phaseTwo?guides.bossEnraged:guides.boss):own(guides,e&&e.kind)?guides[e.kind]:null;}
  function introduction(kind){return own(guides,kind)?guides[kind]:null;}
  function model(kind){return own(models,kind)?models[kind]:null;}
  function drawTelegraphs(c,e,time,caption){
    var s=e&&e.variety;if(!s||!live(e))return;
    c.save();c.lineWidth=2;c.strokeStyle=own(definitions,e.kind)?definitions[e.kind].color:'#dfa5c8';c.fillStyle=c.strokeStyle;
    if(guarding(e,time)){
      c.globalAlpha=.65;var face=Math.atan2(e.fy||0,e.fx||1);c.beginPath();c.arc(e.x,e.y,e.r+9,face-.9,face+.9);c.stroke();
      c.globalAlpha=.95;c.lineWidth=3;c.beginPath();c.arc(e.x,e.y,e.r+13,face-.9,face-.9+1.8*bounded(s.guard/s.guardMax,0,1));c.stroke();
      c.beginPath();c.moveTo(e.x+Math.cos(face)*(e.r+6),e.y+Math.sin(face)*(e.r+6));c.lineTo(e.x+Math.cos(face)*(e.r+13),e.y+Math.sin(face)*(e.r+13));c.stroke();
    }
    else if(e.kind==='warden'&&!(e.frozen>0)&&!(e.stun>0)&&s.phase!=='windup'&&!(e.varietyGrace>0)){
      c.globalAlpha=.65;c.strokeStyle='#ffe0a0';c.beginPath();c.moveTo(e.x-e.r-8,e.y+e.r+3);c.lineTo(e.x-e.r-3,e.y+e.r+8);c.moveTo(e.x+e.r+8,e.y+e.r+3);c.lineTo(e.x+e.r+3,e.y+e.r+8);c.stroke();
      if(caption)caption(e.x,e.y-e.r-25,'EXPOSED','#ffe0a0');
    }
    if(e.varietyAffix==='volatile'){
      c.globalAlpha=.8;c.strokeStyle='#efa17a';c.beginPath();for(var j=0;j<10;j++){var a=-Math.PI/2+j*TAU/10,r=j%2?5:10,x=e.x+Math.cos(a)*r,y=e.y-e.r-13+Math.sin(a)*r;if(!j)c.moveTo(x,y);else c.lineTo(x,y);}c.closePath();c.stroke();
    }
    if(s.phase==='windup'){
      var progress=bounded(1-s.timer/s.duration,0,1);c.globalAlpha=.75;
      if(e.kind==='warden'){
        var angle=Math.atan2(s.aimDY,s.aimDX),reach=e.r+(s.target&&s.target.r||14)+54;c.beginPath();c.moveTo(e.x,e.y);c.arc(e.x,e.y,reach,angle-.95,angle+.95);c.closePath();c.globalAlpha=.1+progress*.13;c.fill();c.globalAlpha=.8;c.stroke();
        if(caption)caption(e.x,e.y-e.r-25,'MACE SWING','#f0ca91');
      }else if(e.kind==='sentinel'){
        var base=Math.atan2(s.aimDY,s.aimDX);c.lineWidth=3;
        for(var lane=-1;lane<=1;lane++){var heading=base+lane*.28;c.beginPath();c.moveTo(e.x+Math.cos(heading)*(e.r+4),e.y+Math.sin(heading)*(e.r+4));c.lineTo(e.x+Math.cos(heading)*315,e.y+Math.sin(heading)*315);c.stroke();}
        if(caption)caption(e.x,e.y-e.r-25,'3-BOLT VOLLEY','#e8bf8e');
      }else{
        var count=e.kind==='boss'&&s.phaseTwo?3:1,radius=e.kind==='boss'?(s.phaseTwo?57:88):54;
        for(var n=0;n<count;n++){var shift=(n-(count-1)/2)*68,cx=s.aimX-s.aimDY*shift,cy=s.aimY+s.aimDX*shift;c.beginPath();c.arc(cx,cy,radius,0,TAU);c.globalAlpha=.12;c.fill();c.globalAlpha=.8;c.stroke();c.beginPath();c.arc(cx,cy,radius-5,-Math.PI/2,-Math.PI/2+TAU*progress);c.stroke();}
        if(caption)caption(s.aimX,s.aimY-radius-14,e.kind==='boss'?(s.phaseTwo?'TRIPLE GROUNDBREAK':'GROUNDBREAK'):'CURSE — MOVE','#e5bbdc');
      }
    }
    var feedback=s.feedback,age=feedback?time-feedback.time:1;
    if(feedback&&age>=0&&age<.32){
      c.globalAlpha=(1-age/.32)*.9;c.strokeStyle=feedback.color;
      if(feedback.kind==='guard-break')for(var shard=0;shard<5;shard++){var sa=shard*TAU/5,sd=e.r+12+age*45;c.beginPath();c.moveTo(e.x+Math.cos(sa)*sd,e.y+Math.sin(sa)*sd);c.lineTo(e.x+Math.cos(sa+.25)*(sd+9),e.y+Math.sin(sa+.25)*(sd+9));c.stroke();}
      else if(feedback.kind==='interrupt'){c.beginPath();c.moveTo(e.x-11,e.y-e.r-22);c.lineTo(e.x+11,e.y-e.r);c.moveTo(e.x+11,e.y-e.r-22);c.lineTo(e.x-11,e.y-e.r);c.stroke();}
      else if(feedback.kind==='shell'){c.beginPath();c.arc(e.x,e.y,e.r+4+age*12,.2,2.8);c.stroke();}
    }
    c.restore();
  }
  var api=freeze({definitions:definitions,modelOrder:order,guides:guides,guideEntries:guideEntries,handles:handles,initialize:initialize,advance:advance,interrupt:interrupt,contactAllowed:contactAllowed,modifyDamage:modifyDamage,onDeath:onDeath,canSpawn:canSpawn,pickKind:pickKind,intelligence:intelligence,introduction:introduction,model:model,drawTelegraphs:drawTelegraphs});
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsVariety=api;
})(typeof window==='object'?window:globalThis);
