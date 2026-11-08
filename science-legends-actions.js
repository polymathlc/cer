/* Simulation-timed VFX events are visual only: drawing never applies damage. */
(function(root){
  'use strict';
  var atlases={attacks:null,elements:null,'fx-barb':null,'fx-sorc':null,'fx-beast':null,'fx-pala':null,'fx-ama':null,whirlwind:null};
  var ELEMENTS=['lightning','poison','holy','arrow'];
  // Every entry has its own authored atlas cell AND a readable native motif.
  // The native layer supplies precise hit geometry when art is absent or subdued.
  var recipes={};
  function define(cls,entries){entries.forEach(function(entry,index){var sid=entry[0];recipes[sid]=Object.freeze({sid:sid,cls:cls,index:index,motif:entry[1],mode:entry[2],color:entry[3],accent:entry[4],family:entry[5],count:entry[6]||6,rate:entry[7]||2});});}
  define('barb',[
    ['cleave','axeCrescent','arc','#f8d09b','#f5f8ff','physical',3,2],
    ['whirlwind','weaponCyclone','spin','#e8d3ad','#effaff','physical',8,3],
    ['charge','shoulderWake','dash','#eda775','#ffe7bb','physical',5,7],
    ['warcry','rallyWaves','buff','#e6965b','#ffedb4','physical',3,3],
    ['slam','radialFracture','nova','#f2b06c','#ffe5ac','physical',9,3],
    ['axes','twinAxe','projectile','#cedbe1','#ffffff','physical',2,17],
    ['ironskin','ironPlates','shield','#acbfcb','#effaff','physical',6,1],
    ['rampage','runningChevrons','buff','#f0a26d','#ffe9b9','physical',4,5],
    ['quake','tectonicFaults','zone','#ca955d','#ffdc8b','physical',7,4],
    ['execute','executionCross','arc','#e38473','#fff4df','physical',2,2],
    ['bladestorm','razorSatellites','aura','#b7cbd7','#f4fcff','physical',5,5],
    ['berserk','bloodFlames','buff','#ee7268','#ffd1b7','physical',7,4]
  ]);
  define('sorc',[
    ['fireball','cinderComet','projectile','#ff9b4e','#fff2ba','fire',8,5],
    ['chain','forkedLightning','chain','#9adfff','#f6ffff','lightning',5,8],
    ['nova','icePetals','nova','#91e7ff','#f6ffff','frost',12,2],
    ['meteor','moltenImpact','target','#ff9e61','#ffe8b9','fire',9,4],
    ['icebolt','crystalLance','projectile','#9cecff','#ffffff','frost',3,3],
    ['storm','stormArcs','aura','#91bcff','#f5f2ff','lightning',5,7],
    ['blizzard','fallingHail','zone','#a7ddff','#f4fcff','frost',14,4],
    ['teleport','phaseRift','dash','#c4a6ff','#f3e8ff','arcane',8,4],
    ['barrier','arcaneFacets','shield','#b2afff','#ece6ff','arcane',8,2],
    ['hydra','tripleFlameHeads','summon','#ff9d66','#ffe9b9','fire',3,4],
    ['orb','gravitySpiral','projectile','#bc9bff','#f8e5ff','arcane',3,3],
    ['combust','emberCrown','buff','#ffa15e','#fff0ad','fire',8,4]
  ]);
  define('beast',[
    ['wolf','wolfTracks','summon','#a8e0bd','#e7fff6','nature',4,2],
    ['stampede','tuskWake','projectile','#bdd69a','#f4f8c9','nature',5,4],
    ['ravens','wingFlock','aura','#94a9bf','#e1e8ff','nature',7,3],
    ['frenzy','packClaws','buff','#ee947b','#ffe5c2','nature',3,4],
    ['sting','venomNeedle','projectile','#b1e778','#eeffbb','poison',4,5],
    ['vines','thornRoots','zone','#9fd88b','#e2ffc3','nature',7,2],
    ['hawk','talonDive','target','#c6dbb4','#f5ffda','nature',3,4],
    ['boarpet','tuskSigil','summon','#d2b58b','#f9ebc1','nature',2,2],
    ['mend','flowerBloom','heal','#c0eda0','#ffe5e4','nature',6,2],
    ['roar','lionFangs','buff','#f0ca87','#ffefbc','nature',6,3],
    ['locusts','insectVortex','aura','#cadc76','#f4ffc0','poison',16,4],
    ['stag','antlerTrail','dash','#a8e3c0','#e4ffe9','nature',5,5]
  ]);
  define('pala',[
    ['smite','sunblade','arc','#ffe49b','#fffbed','holy',5,2],
    ['hammers','hammerOrbit','orbit','#f9d47e','#fff7cb','holy',3,3.2],
    ['zeal','swordVigil','buff','#f9e5a6','#ffffff','holy',3,5],
    ['consecrate','cathedralSeal','zone','#ead888','#fff7c7','holy',8,1],
    ['bash','shieldRam','dash','#efcf85','#fff4c4','holy',3,4],
    ['holybolt','radiantSpear','projectile','#ffe49b','#fffef0','holy',4,4],
    ['retribution','judgementRunes','aura','#efd086','#fff8c8','holy',10,2],
    ['lay','healingPillar','heal','#ffe8b4','#ffffff','holy',5,2],
    ['fist','heavenLance','target','#fff0a9','#ffffff','holy',5,8],
    ['judgement','verdictScales','nova','#f7d482','#fff9cb','holy',6,2],
    ['aegis','guardianWings','shield','#ffe4aa','#fffdf0','holy',6,2],
    ['banner','battleStandard','buff','#eeb98b','#fff1c0','holy',4,2]
  ]);
  define('ama',[
    ['javelin','piercingJavelin','projectile','#d2e6e8','#fff9ed','physical',3,4],
    ['multishot','arrowFan','projectile','#f0c3bd','#fff3e0','arrow',5,3],
    ['strafe','rapidFletching','buff','#efb2ba','#ffe9ed','arrow',4,7],
    ['plague','toxicSpear','projectile','#b4e67b','#e9ffc0','poison',7,3],
    ['fury','stormJavelins','chain','#d4c8ff','#faf1ff','lightning',6,9],
    ['roll','tumbleDust','dash','#dab7a0','#fff0cc','physical',5,6],
    ['valk','valkyrieWings','summon','#f3ddae','#fffdf1','holy',6,2],
    ['decoy','echoSilhouette','summon','#e5adc6','#ffe6f2','arcane',3,2],
    ['rain','descendingArrows','target','#dac5bd','#fff1dc','arrow',11,6],
    ['trap','razorMechanism','zone','#bfced3','#f5e9ce','physical',8,4],
    ['eagle','eagleReticle','buff','#f0d7ac','#fffbe6','nature',4,1],
    ['net','weightedWeb','nova','#c5d1c5','#f4f5df','physical',10,2]
  ]);
  Object.freeze(recipes);
  function recipe(sid){return recipes[sid]||null;}
  function familyForSkill(sid){
    return recipes[sid]?recipes[sid].family:'physical';
  }
  function frame(progress,reduced){return reduced?1:Math.min(3,Math.max(0,Math.floor(progress*4)));}
  function emit(state,row,x,y,radius,angle,duration){
    var actions=state.actions||(state.actions=[]);if(actions.length>=24)actions.shift();
    var action={row:row,x:x,y:y,r:radius,ang:angle||0,start:state.time,life:duration||.32};actions.push(action);return action;
  }
  function emitElement(state,family,x,y,radius,angle,duration){var row=ELEMENTS.indexOf(family);if(row<0)return null;var action=emit(state,row,x,y,radius,angle,duration);action.sheet='elements';action.family=family;return action;}
  function emitSkill(state,sid,x,y,radius,angle,duration,options){
    if(!recipes[sid])return null;
    var action=emit(state,0,x,y,radius,angle,duration||.52);action.sid=sid;action.recipe=sid;
    if(options){if(options.points)action.points=options.points.slice(0,16).map(function(p){return {x:p.x,y:p.y};});if(options.phase)action.phase=options.phase;if(Number.isFinite(options.arc))action.arc=options.arc;}
    return action;
  }
  function expire(state){state.actions=(state.actions||[]).filter(function(action){return state.time-action.start<action.life;});}
  function sample(action,time,reduced){var progress=Math.max(0,Math.min(1,(time-action.start)/action.life));return {frame:frame(progress,reduced),progress:progress,alpha:(1-progress*.65)*(reduced?.45:.8)};}
  function sampleSkill(action,time,reduced){
    var r=recipe(action.sid),age=Math.max(0,time-action.start),life=Math.max(.001,action.life||.5),progress=Math.min(1,age/life),channel=!!action.channel;
    var cycle=reduced?0:age*(r?r.rate:2),n=action.sid==='whirlwind'?8:4;
    var f=reduced?1:channel?Math.floor(cycle*n)%n:Math.min(3,Math.floor(progress*4));
    var envelope=channel?Math.min(1,age/.1,Math.max(0,life-age)/.22):Math.sin(Math.PI*Math.min(.98,progress+.035));
    return {progress:progress,age:age,frame:f,cycle:cycle,alpha:Math.max(0,envelope)*(reduced?.38:.78)};
  }
  function ready(sheet){var atlas=atlases[sheet||'attacks'];return !!atlas&&atlas.complete&&atlas.naturalWidth>0;}
  function snapshot(){var profile={};Object.keys(atlases).forEach(function(sheet){profile[sheet]=ready(sheet)?atlases[sheet]:null;});return Object.freeze(profile);}
  var TAU=Math.PI*2;
  function line(ctx,x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function polygon(ctx,points,fill){ctx.beginPath();points.forEach(function(p,i){if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);});ctx.closePath();if(fill)ctx.fill();else ctx.stroke();}
  function diamond(ctx,x,y,size){polygon(ctx,[[x,y-size],[x+size*.48,y],[x,y+size],[x-size*.48,y]],true);}
  function blade(ctx,x,y,angle,size,axe){
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.strokeStyle='#6d5b49';ctx.lineWidth=Math.max(2,size*.09);line(ctx,-size*.5,0,size*.6,0);
    ctx.fillStyle='#bacbd5';polygon(ctx,axe?[[size*.3,-size*.35],[size*.78,-size*.52],[size*.98,0],[size*.78,size*.52],[size*.3,size*.35],[size*.57,0]]:[[size*.18,-size*.11],[size*.9,0],[size*.18,size*.11],[-size*.05,0]],true);
    ctx.strokeStyle='#f3fcff';ctx.lineWidth=1.2;line(ctx,size*.3,-size*.27,size*.8,-size*.34);ctx.restore();
  }
  function spear(ctx,x,y,angle,size,color){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.strokeStyle=color;ctx.lineWidth=2;line(ctx,-size,0,size*.6,0);ctx.fillStyle=color;polygon(ctx,[[size,0],[size*.56,-size*.17],[size*.65,0],[size*.56,size*.17]],true);line(ctx,-size*.8,0,-size,-size*.15);line(ctx,-size*.8,0,-size,size*.15);ctx.restore();}
  function motes(ctx,r,n,phase,color,rising){
    ctx.fillStyle=color;for(var i=0;i<n;i++){var a=i*2.39996+phase*.7,d=r*(.35+.55*((i*.618+.2)%1)),x=Math.cos(a)*d,y=Math.sin(a)*d;
      if(rising)y-=((phase*.4+i*.17)%1)*r*.8;
      diamond(ctx,x,y,2+(i%3));}
  }
  function crest(ctx,r,n,phase){for(var i=0;i<n;i++){var a=i*TAU/n+phase;ctx.save();ctx.rotate(a);line(ctx,r*.7,-r*.07,r*.85,0);line(ctx,r*.85,0,r*.7,r*.07);ctx.restore();}}
  function wings(ctx,r,phase){for(var side=-1;side<=1;side+=2){for(var i=0;i<5;i++){var x=side*(r*.18+i*r*.12),y=-r*.3+Math.sin(i*.6+phase)*r*.12;polygon(ctx,[[x,y],[x+side*r*.24,y-r*(.35-i*.04)],[x+side*r*.12,y+r*.2]],true);}}}
  function shield(ctx,r,n,phase){polygon(ctx,[[0,-r*.75],[r*.58,-r*.44],[r*.46,r*.34],[0,r*.7],[-r*.46,r*.34],[-r*.58,-r*.44]],false);for(var i=0;i<n;i++){var a=i*TAU/n+phase;diamond(ctx,Math.cos(a)*r*.8,Math.sin(a)*r*.8,5);}}
  function drawSkillAtlas(ctx,action,s,reduced,profile){
    var rec=recipes[action.sid],sheet='fx-'+rec.cls,atlas=profile?profile[sheet]:atlases[sheet],cols=8,rows=6,index=rec.index,col=(index%2)*4+Math.min(3,s.frame),row=Math.floor(index/2);
    var cyclone=action.sid==='whirlwind'&&(profile?profile.whirlwind:atlases.whirlwind);
    if(cyclone&&cyclone.complete&&cyclone.naturalWidth){atlas=cyclone;cols=4;rows=2;col=s.frame%4;row=Math.floor(s.frame/4);}
    if(!atlas||!atlas.complete||!atlas.naturalWidth)return false;
    var w=atlas.naturalWidth/cols,h=atlas.naturalHeight/rows,flight=action.phase==='flight';
    var size=Math.max(flight?30:48,Math.min(reduced?260:380,action.r*(flight?3:2.05))),height=size*h/w;
    ctx.save();ctx.translate(action.x,action.y);if(flight||rec.mode==='arc'||rec.mode==='dash')ctx.rotate(action.ang||0);
    ctx.globalAlpha=s.alpha*(action.channel?.34:flight?.6:.63);ctx.imageSmoothingEnabled=true;
    ctx.drawImage(atlas,col*w,row*h,w,h,-size/2,-height/2,size,height);ctx.restore();return true;
  }
  function drawSkillNative(ctx,action,s,reduced){
    if(action.phase==='atlas')return;
    var rec=recipes[action.sid],r=Math.max(12,action.r||42),phase=reduced?0:s.age*rec.rate,progress=s.progress,n=reduced?Math.min(4,rec.count):rec.count;
    var expansion=action.channel?1:Math.min(1,.2+progress*2),rad=r*expansion;
    ctx.save();ctx.translate(action.x,action.y);ctx.globalAlpha=s.alpha*.78;ctx.strokeStyle=rec.color;ctx.fillStyle=rec.accent;ctx.lineWidth=2;ctx.lineCap='round';
    if(action.points){ctx.translate(-action.x,-action.y);action.points.forEach(function(p,i){if(!i)return;var a=action.points[i-1],dx=p.x-a.x,dy=p.y-a.y,length=Math.hypot(dx,dy)||1;ctx.beginPath();ctx.moveTo(a.x,a.y);for(var j=1;j<6;j++){var q=j/6,offset=Math.sin(j*2.8+i*1.7+phase)*8*(reduced?0:1);ctx.lineTo(a.x+dx*q-dy/length*offset,a.y+dy*q+dx/length*offset);}ctx.lineTo(p.x,p.y);ctx.stroke();diamond(ctx,p.x,p.y,5+Math.sin(phase)*2);});ctx.restore();return;}
    // Projectiles retain the native shaft/model. Their local aura moves with the
    // swept collision body instead of lingering at the cast position.
    if(action.phase==='flight'){
      ctx.rotate(action.ang||0);
      if(rec.sid==='axes'||rec.sid==='whirlwind')blade(ctx,0,0,phase,r*.9,true);
      else if(rec.sid==='icebolt'){for(var ic=0;ic<3;ic++)diamond(ctx,-ic*8,(ic%2?1:-1)*ic*3,6-ic);}
      else if(rec.sid==='fireball'||rec.sid==='orb'){for(var co=0;co<3;co++){ctx.beginPath();ctx.ellipse(-co*6,0,r*(.5+co*.15),r*(.45-co*.07),phase*(co%2?-1:1),0,TAU);ctx.stroke();}}
      else if(rec.sid==='stampede'){for(var ho=0;ho<3;ho++){ctx.beginPath();ctx.arc(-8-ho*10,0,8+ho*3,-.7,.7);ctx.stroke();}}
      else {spear(ctx,0,0,0,r*.9,rec.accent);if(rec.family==='holy'){line(ctx,0,-r*.5,0,r*.5);}if(rec.family==='poison')motes(ctx,r*.9,reduced?2:4,phase,rec.color,false);}
      ctx.restore();return;
    }
    switch(rec.motif){
      case 'weaponCyclone': {
        // Independent weapon choreography; actor and camera stay upright.
        var spin=reduced?.7:s.age*13,envelope=Math.min(1,s.age/.1,(action.life-s.age)/.2);
        ctx.globalAlpha=Math.max(0,envelope)*(reduced?.3:.58);
        for(var sw=0;sw<(reduced?2:5);sw++){
          var direction=sw%2?-1:1,a=spin*direction+sw*2.1,rr=r*(.48+sw*.095);
          ctx.strokeStyle=sw%2?rec.accent:rec.color;ctx.lineWidth=sw<2?7:2.5;
          ctx.beginPath();ctx.arc(0,0,rr,a-.95,a+.48);ctx.stroke();
          if(sw<2)blade(ctx,Math.cos(a)*rr,Math.sin(a)*rr,a+Math.PI*.5,36,true);
          if(!reduced){var gx=Math.cos(a+.5)*rr,gy=Math.sin(a+.5)*rr;ctx.strokeStyle='#fffbea';ctx.lineWidth=1.5;line(ctx,gx-4,gy,gx+4,gy);line(ctx,gx,gy-5,gx,gy+5);}
        }
        ctx.globalAlpha*=.55;for(var du=0;du<(reduced?3:10);du++){var da=du*2.399-spin*.2,dr=r*(.78+(((reduced?0:s.age*.7)+du*.21)%1)*.18);ctx.fillStyle=du%2?'#a89980':'#dfc9a7';ctx.beginPath();ctx.ellipse(Math.cos(da)*dr,Math.sin(da)*dr,4+(du%3)*2,2+(du%2),da,0,TAU);ctx.fill();}
        break;
      }
      case 'axeCrescent': case 'executionCross': case 'sunblade': {
        ctx.rotate(action.ang||0);var arc=action.arc||2.1,sweep=-arc/2+progress*arc;
        for(var ar=0;ar<(reduced?1:3);ar++){ctx.lineWidth=6-ar*1.7;ctx.globalAlpha=s.alpha*(.55-ar*.12);ctx.beginPath();ctx.arc(0,0,rad*(.6+ar*.13),-arc/2,sweep);ctx.stroke();}
        if(rec.motif==='executionCross'){line(ctx,rad*.25,-rad*.12,rad,rad*.28);line(ctx,rad*.25,rad*.12,rad,-rad*.28);blade(ctx,Math.cos(sweep)*rad*.7,Math.sin(sweep)*rad*.7,sweep,48,true);}
        else if(rec.motif==='sunblade'){crest(ctx,rad,5,0);line(ctx,rad*.65,-14,rad*.65,14);}
        else blade(ctx,Math.cos(sweep)*rad*.75,Math.sin(sweep)*rad*.75,sweep,32,true);
        break;
      }
      case 'radialFracture': case 'tectonicFaults': case 'moltenImpact': {
        for(var fr=0;fr<n;fr++){var fa=fr*TAU/n+.17,flow=rec.motif==='tectonicFaults'?Math.sin(phase+fr)*.08:0;ctx.save();ctx.rotate(fa);ctx.beginPath();ctx.moveTo(rad*.15,0);ctx.lineTo(rad*.43,rad*(.05+flow));ctx.lineTo(rad*.67,-rad*.07);ctx.lineTo(rad,rad*.025);ctx.stroke();ctx.restore();}
        if(rec.motif==='moltenImpact'){motes(ctx,rad,n,phase,rec.accent,true);ctx.beginPath();ctx.ellipse(0,0,rad*.5,rad*.2,0,0,TAU);ctx.stroke();}
        if(rec.motif==='tectonicFaults')for(var rb=0;rb<n;rb++)diamond(ctx,Math.cos(rb*2.4)*rad*.65,Math.sin(rb*2.4)*rad*.65,6+Math.sin(phase+rb)*2);
        break;
      }
      case 'icePetals': {
        for(var ip=0;ip<n;ip++){var ia=ip*TAU/n;ctx.save();ctx.rotate(ia);line(ctx,rad*.2,0,rad,0);line(ctx,rad*.65,0,rad*.47,-rad*.12);line(ctx,rad*.65,0,rad*.47,rad*.12);diamond(ctx,rad*.92,0,9);ctx.restore();}break;
      }
      case 'weightedWeb': {
        for(var we=0;we<n;we++){var wa=we*TAU/n;line(ctx,0,0,Math.cos(wa)*rad,Math.sin(wa)*rad);diamond(ctx,Math.cos(wa)*rad,Math.sin(wa)*rad,5);}
        for(var ring=1;ring<=3;ring++){var pts=[];for(var wp=0;wp<n;wp++)pts.push([Math.cos(wp*TAU/n)*rad*ring/3,Math.sin(wp*TAU/n)*rad*ring/3]);polygon(ctx,pts,false);}break;
      }
      case 'verdictScales': {crest(ctx,rad,6,0);line(ctx,-rad*.45,-rad*.24,rad*.45,-rad*.24);line(ctx,0,-rad*.5,0,rad*.45);for(var sc=-1;sc<=1;sc+=2){line(ctx,sc*rad*.4,-rad*.24,sc*rad*.4,rad*.12);polygon(ctx,[[sc*rad*.4-rad*.16,rad*.12],[sc*rad*.4,rad*.28],[sc*rad*.4+rad*.16,rad*.12]],false);}break;}
      case 'fallingHail': {for(var ha=0;ha<n;ha++){var hx=Math.sin(ha*8.1)*rad*.85,hy=((phase*.5+ha*.39)%1)*rad*1.6-rad*.8;line(ctx,hx-6,hy-17,hx,hy);diamond(ctx,hx,hy,5);}break;}
      case 'thornRoots': {for(var vi=0;vi<n;vi++){var va=vi*TAU/n;ctx.save();ctx.rotate(va);ctx.beginPath();ctx.moveTo(rad*.12,0);ctx.quadraticCurveTo(rad*.5,rad*.25*Math.sin(phase+vi),rad*.95,0);ctx.stroke();for(var th=0;th<3;th++)polygon(ctx,[[rad*(.32+th*.2),0],[rad*(.38+th*.2),-rad*.1],[rad*(.42+th*.2),0]],true);ctx.restore();}break;}
      case 'cathedralSeal': {var seal=[];for(var se=0;se<8;se++)seal.push([Math.cos(se*TAU/8)*rad*.9,Math.sin(se*TAU/8)*rad*.9]);polygon(ctx,seal,false);crest(ctx,rad,8,0);line(ctx,-rad*.38,0,rad*.38,0);line(ctx,0,-rad*.55,0,rad*.55);motes(ctx,rad*.6,n,phase,rec.accent,true);break;}
      case 'razorMechanism': {for(var ge=0;ge<n;ge++){var ga=ge*TAU/n+(reduced?0:phase);ctx.save();ctx.rotate(ga);polygon(ctx,[[rad*.5,-rad*.05],[rad*.9,-rad*.12],[rad*.73,rad*.16]],true);ctx.restore();}polygon(ctx,[[-rad*.3,-rad*.3],[rad*.3,-rad*.3],[rad*.3,rad*.3],[-rad*.3,rad*.3]],false);break;}
      case 'razorSatellites': {for(var bl=0;bl<n;bl++){var ba=phase+bl*TAU/n;blade(ctx,Math.cos(ba)*r*.82,Math.sin(ba)*r*.82,ba+Math.PI/2,26,false);}break;}
      case 'wingFlock': {for(var bi=0;bi<n;bi++){var ba2=phase+bi*TAU/n,br=r*(.5+.3*Math.sin(bi*1.9));ctx.save();ctx.translate(Math.cos(ba2)*br,Math.sin(ba2)*br);ctx.rotate(ba2+Math.PI/2);var flap=6+Math.sin(phase*4+bi)*4;polygon(ctx,[[-13,-flap],[0,0],[13,-flap],[5,6],[0,3],[-5,6]],true);ctx.restore();}break;}
      case 'insectVortex': {for(var lo=0;lo<n;lo++){var la=phase*(lo%2?-1:1)+lo*2.4,lr=r*(.3+.6*((lo*.618)%1)),lx=Math.cos(la)*lr,ly=Math.sin(la)*lr;line(ctx,lx-3,ly-2,lx+3,ly+2);line(ctx,lx-3,ly+2,lx+3,ly-2);}break;}
      case 'stormArcs': {for(var st=0;st<n;st++){var sta=st*TAU/n+phase*.2,sx=Math.cos(sta)*r*.72,sy=Math.sin(sta)*r*.72;ctx.beginPath();ctx.moveTo(sx,sy-36);ctx.lineTo(sx-7,sy-14);ctx.lineTo(sx+5,sy-18);ctx.lineTo(sx,sy+3);ctx.stroke();}break;}
      case 'judgementRunes': {for(var ru=0;ru<n;ru++){var ra=ru*TAU/n+phase*.15;ctx.save();ctx.rotate(ra);line(ctx,r*.85,-6,r*.85,6);line(ctx,r*.81,-3,r*.9,-3);diamond(ctx,r*.85,0,3);ctx.restore();}break;}
      case 'hammerOrbit': {for(var ho=0;ho<n;ho++){var hoa=phase+ho*TAU/n;ctx.save();ctx.translate(Math.cos(hoa)*r,Math.sin(hoa)*r);ctx.rotate(hoa);line(ctx,-5,0,8,0);ctx.fillRect(5,-8,9,16);ctx.restore();}break;}
      case 'ironPlates': {for(var pl=0;pl<n;pl++){var pa=pl*TAU/n+phase*.15;ctx.save();ctx.rotate(pa);polygon(ctx,[[r*.48,-8],[r*.75,-7],[r*.8,7],[r*.45,9]],false);ctx.restore();}break;}
      case 'arcaneFacets': {var facets=[],breath=.8+Math.sin(phase*2)*.025;for(var af=0;af<8;af++)facets.push([Math.cos(af*TAU/8)*r*breath,Math.sin(af*TAU/8)*r*breath]);polygon(ctx,facets,false);for(var inr=0;inr<4;inr++)line(ctx,facets[inr][0],facets[inr][1],facets[inr+4][0],facets[inr+4][1]);diamond(ctx,Math.cos(phase)*r*.8,Math.sin(phase)*r*.8,4);break;}
      case 'guardianWings': {ctx.globalAlpha*=.65;wings(ctx,r*.9,phase*.5);ctx.globalAlpha=s.alpha*.8;shield(ctx,r*.7,4,0);break;}
      case 'rallyWaves': case 'lionFangs': {for(var rw=0;rw<(reduced?1:3);rw++){var rr=r*(.3+((phase*.3+rw*.3)%.7));ctx.beginPath();ctx.arc(0,0,rr,-.9,.9);ctx.stroke();ctx.beginPath();ctx.arc(0,0,rr,Math.PI-.9,Math.PI+.9);ctx.stroke();}if(rec.motif==='lionFangs')for(var fang=-1;fang<=1;fang+=2)polygon(ctx,[[fang*r*.25,-r*.45],[fang*r*.4,-r*.45],[fang*r*.3,0]],true);else crest(ctx,r*.65,3,0);break;}
      case 'runningChevrons': case 'rapidFletching': {ctx.rotate(action.ang||0);for(var ch=0;ch<n;ch++){var cx=-r*.8+((phase*.45+ch/n)%1)*r*1.6;line(ctx,cx-7,-8,cx+3,0);line(ctx,cx+3,0,cx-7,8);}if(rec.motif==='rapidFletching')spear(ctx,0,-r*.45,0,22,rec.accent);break;}
      case 'bloodFlames': case 'emberCrown': {for(var fl=0;fl<n;fl++){var fla=fl*TAU/n,fx=Math.cos(fla)*r*.6,fy=Math.sin(fla)*r*.6;polygon(ctx,[[fx-5,fy],[fx+Math.sin(phase+fl)*4,fy-12-(fl%3)*3],[fx+5,fy]],true);}if(rec.motif==='emberCrown')crest(ctx,r*.6,5,-Math.PI/2);break;}
      case 'packClaws': {for(var cl=0;cl<3;cl++)line(ctx,-r*.45+cl*9,-r*.55,-r*.2+cl*9,r*.3);motes(ctx,r*.7,3,phase,rec.color,true);break;}
      case 'swordVigil': {for(var sv=0;sv<3;sv++)blade(ctx,(sv-1)*r*.45,-r*.25+Math.sin(phase+sv)*3,-Math.PI/2,27,false);break;}
      case 'battleStandard': {line(ctx,-r*.4,r*.4,-r*.4,-r*.85);polygon(ctx,[[-r*.4,-r*.8],[r*.35,-r*.7+Math.sin(phase)*4],[r*.2,-r*.35],[-r*.4,-r*.4]],false);crest(ctx,r*.7,3,Math.PI/2);break;}
      case 'eagleReticle': {for(var er=0;er<4;er++){ctx.save();ctx.rotate(er*Math.PI/2);line(ctx,r*.6,-5,r*.6,5);line(ctx,r*.5,0,r*.82,0);ctx.restore();}wings(ctx,r*.48,phase*.5);diamond(ctx,Math.cos(phase)*r*.8,Math.sin(phase)*r*.8,3);break;}
      case 'flowerBloom': {for(var pe=0;pe<6;pe++){ctx.save();ctx.rotate(pe*TAU/6+phase*.2);ctx.beginPath();ctx.ellipse(0,-rad*.35,rad*.13,rad*.3,0,0,TAU);ctx.stroke();ctx.restore();}motes(ctx,rad*.7,n,phase,rec.accent,true);break;}
      case 'healingPillar': {for(var pi=0;pi<5;pi++){var px=(pi-2)*r*.22,py=-((phase*.35+pi*.21)%1)*r;line(ctx,px,py+20,px,py-16);diamond(ctx,px,py,4);}line(ctx,-r*.25,-r*.3,r*.25,-r*.3);line(ctx,0,-r*.6,0,0);break;}
      case 'wolfTracks': {for(var paw=0;paw<4;paw++){var pawx=(paw%2?1:-1)*rad*.27,pawy=rad*.4-paw*rad*.25;ctx.beginPath();ctx.ellipse(pawx,pawy,6,8,-.2,0,TAU);ctx.stroke();for(var toe=0;toe<3;toe++)diamond(ctx,pawx+(toe-1)*5,pawy-10,2);}break;}
      case 'tripleFlameHeads': {for(var he=0;he<3;he++){var hX=(he-1)*rad*.35;ctx.beginPath();ctx.moveTo(hX,rad*.4);ctx.quadraticCurveTo(hX+Math.sin(phase+he)*rad*.2,0,hX,-rad*.45);ctx.stroke();diamond(ctx,hX,-rad*.45,10);line(ctx,hX,-rad*.55,hX,-rad*.8);}break;}
      case 'tuskSigil': {for(var tu=-1;tu<=1;tu+=2){ctx.beginPath();ctx.moveTo(tu*rad*.15,rad*.3);ctx.quadraticCurveTo(tu*rad*.75,rad*.4,tu*rad*.45,-rad*.5);ctx.stroke();}crest(ctx,rad*.7,4,Math.PI/4);break;}
      case 'valkyrieWings': {wings(ctx,rad,phase*.5);spear(ctx,0,0,-Math.PI/2,rad*.6,rec.accent);break;}
      case 'echoSilhouette': {for(var ec=0;ec<3;ec++){ctx.globalAlpha=s.alpha*(.7-ec*.18);var ex=(ec-1)*rad*.3;ctx.beginPath();ctx.ellipse(ex,-rad*.4,rad*.15,rad*.17,0,0,TAU);ctx.stroke();polygon(ctx,[[ex-rad*.17,-rad*.2],[ex+rad*.17,-rad*.2],[ex+rad*.25,rad*.5],[ex-rad*.25,rad*.5]],false);}break;}
      case 'shoulderWake': case 'phaseRift': case 'antlerTrail': case 'shieldRam': case 'tumbleDust': {ctx.rotate(action.ang||0);
        if(rec.motif==='shieldRam')shield(ctx,rad*.8,3,0);
        else if(rec.motif==='phaseRift'){for(var po=0;po<3;po++){ctx.beginPath();ctx.ellipse(-po*rad*.25,0,rad*.17,rad*.7,0,-Math.PI*.6,Math.PI*.6);ctx.stroke();}}
        else if(rec.motif==='antlerTrail'){for(var ant=-1;ant<=1;ant+=2){line(ctx,-rad*.4,ant*rad*.2,rad*.5,ant*rad*.6);for(var pr=0;pr<3;pr++)line(ctx,(-.2+pr*.2)*rad,ant*(.3+pr*.1)*rad,(-.3+pr*.2)*rad,ant*(.5+pr*.1)*rad);}}
        else if(rec.motif==='tumbleDust')motes(ctx,rad,n,phase,rec.color,false);
        else{for(var wak=0;wak<4;wak++){line(ctx,-rad*.7-wak*8,(wak-1.5)*12,rad*.3,(wak-1.5)*12);}crest(ctx,rad*.5,3,0);}break;}
      case 'talonDive': {for(var ta=0;ta<3;ta++)line(ctx,-rad*.6+ta*rad*.25,-rad*.5,-rad*.25+ta*rad*.25,rad*.4);wings(ctx,rad*.55,-phase);break;}
      case 'heavenLance': {ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-rad*1.6);ctx.lineTo(-rad*.1,-rad*.7);ctx.lineTo(rad*.13,-rad*.8);ctx.lineTo(0,0);ctx.stroke();crest(ctx,rad*.8,5,0);break;}
      case 'descendingArrows': {for(var arrow=0;arrow<n;arrow++){var ax=Math.sin(arrow*2.4)*rad*.8,ay=Math.cos(arrow*1.7)*rad*.6;spear(ctx,ax,ay,-Math.PI*.36,18,rec.accent);}break;}
      case 'twinAxe': {blade(ctx,-rad*.25,0,phase,34,true);blade(ctx,rad*.25,0,-phase,34,true);break;}
      case 'forkedLightning': case 'stormJavelins': {for(var li=0;li<n;li++){var lia=li*TAU/n;ctx.save();ctx.rotate(lia);ctx.beginPath();ctx.moveTo(rad*.12,0);ctx.lineTo(rad*.48,-8);ctx.lineTo(rad*.4,9);ctx.lineTo(rad*.95,0);ctx.stroke();if(rec.motif==='stormJavelins')spear(ctx,rad*.65,0,0,12,rec.accent);ctx.restore();}break;}
      case 'cinderComet': {motes(ctx,rad,n,phase,rec.color,true);for(var ci=0;ci<3;ci++){ctx.beginPath();ctx.arc(0,0,rad*(.2+ci*.22),ci*1.1,ci*1.1+Math.PI*1.5);ctx.stroke();}break;}
      case 'crystalLance': {for(var cr=0;cr<3;cr++){ctx.save();ctx.rotate((action.ang||0)+(cr-1)*.3);diamond(ctx,rad*.3,0,rad*.5);ctx.restore();}break;}
      case 'gravitySpiral': {for(var gr=0;gr<3;gr++){ctx.beginPath();ctx.ellipse(0,0,rad*.8,rad*.32,phase+gr*Math.PI/3,0,TAU);ctx.stroke();}diamond(ctx,0,0,rad*.25);break;}
      case 'tuskWake': {for(var tw=0;tw<3;tw++){ctx.beginPath();ctx.arc(-tw*12,0,rad*(.4+tw*.12),-.9,.9);ctx.stroke();}break;}
      case 'venomNeedle': {ctx.rotate(action.ang||0);spear(ctx,0,0,0,rad*.65,rec.accent);motes(ctx,rad*.6,4,phase,rec.color,false);break;}
      case 'radiantSpear': {ctx.rotate(action.ang||0);spear(ctx,0,0,0,rad*.8,rec.accent);for(var rays=0;rays<4;rays++){ctx.save();ctx.rotate(rays*Math.PI/2);line(ctx,rad*.2,0,rad*.5,0);ctx.restore();}break;}
      case 'piercingJavelin': {ctx.rotate(action.ang||0);spear(ctx,0,0,0,rad*.85,rec.accent);for(var speed=0;speed<3;speed++)line(ctx,-rad*.8,(speed-1)*8,-rad*.3,(speed-1)*8);break;}
      case 'arrowFan': {for(var fan=0;fan<5;fan++)spear(ctx,Math.cos((action.ang||0)+(fan-2)*.2)*rad*.35,Math.sin((action.ang||0)+(fan-2)*.2)*rad*.35,(action.ang||0)+(fan-2)*.2,rad*.35,rec.accent);break;}
      case 'toxicSpear': {ctx.rotate(action.ang||0);spear(ctx,0,0,0,rad*.6,rec.accent);for(var bub=0;bub<6;bub++){var bua=bub*2.4;ctx.beginPath();ctx.arc(Math.cos(bua)*rad*.65,Math.sin(bua)*rad*.65,4+(bub%3)*2,0,TAU);ctx.stroke();}break;}
    }
    ctx.restore();
  }
  function drawSkill(ctx,action,time,reduced,profile){if(!recipes[action.sid])return false;var s=sampleSkill(action,time,reduced);if(s.progress>=1||s.alpha<=0)return false;drawSkillAtlas(ctx,action,s,reduced,profile);drawSkillNative(ctx,action,s,reduced);return true;}
  function drawChannel(ctx,channel,time,reduced,profile){
    if(!recipes[channel.sid])return false;
    var life=channel.life||Math.max(.01,channel.t||1),start=channel.start===undefined?time:channel.start;
    return drawSkill(ctx,{sid:channel.sid,x:channel.x,y:channel.y,r:channel.r||channel.radius||42,ang:channel.ang||0,start:start,life:life,channel:true,phase:channel.phase},time,reduced,profile);
  }
  function drawAnticipation(ctx,target,reduced,profile){
    var rec=recipe(target.sid);if(!rec)return false;var k=Math.max(0,Math.min(1,target.progress)),r=target.r;
    ctx.save();ctx.translate(target.x,target.y);ctx.strokeStyle=rec.color;ctx.fillStyle=rec.accent;ctx.lineWidth=1.5;
    ctx.globalAlpha=.33;for(var i=0;i<8;i++){var a=i*TAU/8;ctx.beginPath();ctx.arc(0,0,r,a+.1,a+.5);ctx.stroke();}
    ctx.globalAlpha=.7;crest(ctx,Math.max(14,r*(1-k)),4,Math.PI/4);
    if(!reduced){
      var height=(1-k)*240;
      if(target.sid==='meteor'){ctx.translate((1-k)*48,-height);ctx.strokeStyle=rec.color;ctx.lineWidth=7;line(ctx,0,0,20,-65);ctx.fillStyle=rec.accent;diamond(ctx,0,0,13);}
      else if(target.sid==='hawk'){ctx.translate((1-k)*35,-height);wings(ctx,32,Math.sin(k*12));polygon(ctx,[[0,-8],[5,7],[0,16],[-5,7]],true);}
      else if(target.sid==='fist'){ctx.lineWidth=3;line(ctx,0,-height-40,0,-height);diamond(ctx,0,-height,10);}
      else if(target.sid==='rain'){for(var ar=0;ar<9;ar++){var ax=Math.sin(ar*2.4)*r*.75,ay=Math.cos(ar*1.7)*r*.65-height;spear(ctx,ax,ay,Math.PI*.65,18,rec.accent);}}
    }
    ctx.restore();return true;
  }
  function draw(ctx,action,time,reduced,profile){
    if(action.sid)return drawSkill(ctx,action,time,reduced,profile);
    var sheet=action.sheet||'attacks',atlas=profile?profile[sheet]:atlases[sheet];if(!atlas||!atlas.complete||!atlas.naturalWidth)return false;var state=sample(action,time,reduced),w=atlas.naturalWidth/4,h=atlas.naturalHeight/4;
    var size=Math.max(36,Math.min(reduced?180:340,action.r*2.1));
    var height=size*h/w;
    ctx.save();ctx.translate(action.x,action.y);if((sheet==='attacks'&&action.row===0)||(sheet==='elements'&&action.row===3))ctx.rotate(action.ang);
    ctx.globalAlpha=state.alpha;ctx.imageSmoothingEnabled=true;
    ctx.drawImage(atlas,state.frame*w,action.row*h,w,h,-size/2,-height/2,size,height);ctx.restore();return true;
  }
  var api={frame:frame,emit:emit,emitElement:emitElement,emitSkill:emitSkill,recipe:recipe,recipes:recipes,familyForSkill:familyForSkill,expire:expire,sample:sample,sampleSkill:sampleSkill,ready:ready,snapshot:snapshot,draw:draw,drawSkill:drawSkill,drawChannel:drawChannel,drawAnticipation:drawAnticipation};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsActions=api;
  if(typeof root.Image==='function')Object.keys(atlases).forEach(function(sheet){var image=atlases[sheet]=new root.Image();image.onload=function(){if(typeof image.decode==='function')image.decode().catch(function(){});};image.src=sheet==='attacks'||sheet==='elements'?'assets/science-legends/v2/'+(sheet==='elements'?'elements-clean':'attacks')+'.webp':'assets/science-legends/v3/'+sheet+'.webp';});
})(typeof window==='object'?window:globalThis);
