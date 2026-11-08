/* Fixed-camera, foot-anchored model atlases. Images are decoded and measured once. */
(function(root){
  'use strict';
  var HEROES=['barb','sorc','beast','pala','ama'];
  var ENEMIES=['slime','imp','mite','brute','spitter','charger'];
  var COMPANIONS=['wolf','bear','boarpet','hydra'];
  function companionModel(kind,cls){
    var column=COMPANIONS.indexOf(kind==='boar'?'boarpet':kind);if(column>=0)return {sheet:'companion',column:column};
    var hero={fdef:'pala',fmag:'sorc',fpri:'sorc',valkyrie:'pala',decoy:cls||'ama'}[kind];
    return hero?{sheet:'hero',column:HEROES.indexOf(hero)}:null;
  }
  function companionRole(kind){return {fdef:'DEFENDER',fmag:'MAGE',fpri:'HEALER',valkyrie:'VALKYRIE',decoy:'DECOY'}[kind]||'';}
  function facingY(actor,dx,dy){dx=dx==null?actor.fx:dx;dy=dy==null?actor.fy:dy;var length=Math.hypot(dx||0,dy||0);return length>.001?(dy||0)/length:0;}
  function rearFacing(actor){return typeof actor.modelRear==='boolean'?actor.modelRear:facingY(actor)<-.22;}
  /* Only simulation calls this. Rendering reads the retained orientation. */
  function advanceFacing(actor,dx,dy){
    var rear=rearFacing(actor);if(!(actor.frozen>0)&&!(actor.stun>0)){var y=facingY(actor,dx,dy);if(y<-.22)rear=true;else if(y>.22)rear=false;}
    actor.modelRear=rear;return rear;
  }
  function stateFrame(actor,time,reduced){
    if((actor.modelAttackUntil||0)>time)return 3;
    return actor.moving?(reduced?1:1+(Math.floor(time*7)%2)):0;
  }
  function sourceRect(width,height,columns,column,row){return {x:column*width/columns,y:row*height/4,w:width/columns,h:height/4};}
  function footAnchor(pixels,width,height){
    var threshold=Math.max(3,width*.025),bottom=Math.floor(height*.96),sumX=0,sum=0;
    for(var y=height-1;y>height*.68;y--){var count=0;for(var x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>64)count++;if(count>=threshold){bottom=y;break;}}
    for(var fy=Math.max(0,bottom-Math.floor(height*.09));fy<=bottom;fy++)for(var fx=0;fx<width;fx++){var a=pixels[(fy*width+fx)*4+3];if(a>64){sumX+=fx*a;sum+=a;}}
    return {x:sum?sumX/sum/width:.5,y:bottom/height};
  }
  function enemyColumn(kind){return kind==='boss'?3:ENEMIES.indexOf(kind);}
  function sortActors(entries,inPlace){return (inPlace?entries:entries.slice()).sort(function(a,b){return (a.actor.y+(a.actor.r||0))-(b.actor.y+(b.actor.r||0))||a.order-b.order;});}
  function bodyBounds(actor,size,anchor){anchor=anchor||{x:.5,y:.96};return {x:actor.x-(actor.fx<0?1-anchor.x:anchor.x)*size,y:actor.y+(actor.r||0)-anchor.y*size,w:size,h:size};}
  function frameBounds(actor,size,frame,mirror){var w=frame.w/frame.nominalWidth*size,h=frame.h/frame.nominalHeight*size;mirror=mirror==null?actor.fx<0:mirror;return {x:actor.x-(mirror?1-frame.anchor.x:frame.anchor.x)*w,y:actor.y+(actor.r||0)-frame.anchor.y*h,w:w,h:h};}
  function enemyBounds(actor,time,reduced,size,profile){var column=enemyColumn(actor.kind),row=enemyFrame(actor,time,reduced),pose=orientation('enemy',actor,profile),frame=pose.sheet&&column>=0&&pose.sheet.frames[column][row];return frame?frameBounds(actor,size,frame,pose.mirror):bodyBounds(actor,size,{x:.5,y:1});}
  function pick(enemies,x,y,bounds){var best=null,depth=-Infinity,order=-1;for(var i=0;i<enemies.length;i++){var actor=enemies[i];if(actor.dead||actor.hp<=0)continue;var z=actor.y+(actor.r||0);if(z<depth||z===depth&&i<order)continue;var box=bounds(actor);if(x>=box.x&&x<=box.x+box.w&&y>=box.y&&y<=box.y+box.h){best=actor;depth=z;order=i;}}return best;}
  function statuses(actor){
    var list=[];
    if(actor.frozen>0)list.push({kind:'frozen',label:'FROZEN',glyph:'❄',color:'#9eefff'});
    if(actor.stun>0)list.push({kind:'stun',label:'STUN',glyph:'✦',color:'#ffe197'});
    if(actor.slowT>0)list.push({kind:'slow',label:'SLOW',glyph:'◷',color:'#b4d9f0'});
    if(actor.bleedT>0)list.push(actor.dotKind==='poison'?{kind:'poison',label:'VENOM',glyph:'◆',color:'#bce87f'}:actor.dotKind==='burn'?{kind:'burn',label:'BURN',glyph:'♨',color:'#ffbd84'}:{kind:'bleed',label:'BLEED',glyph:'♦',color:'#ffa49c'});
    return list;
  }
  function enemyFrame(actor,time,reduced){
    if(actor.chargeSt===1)return 3;
    if(actor.spitWindup>0)return 3;
    if(actor.heavyWindup>0)return 3;
    if(actor.frozen>0||actor.stun>0)return 0;
    if((actor.modelAttackUntil||0)>time)return 3;
    return actor.moving?(reduced?1:1+(Math.floor((time+(actor.modelPhase||0))*7)%2)):0;
  }
  var sheets={hero:{columns:5,file:'heroes',image:null,frames:[],prepared:false},enemy:{columns:6,file:'enemies-clean',image:null,frames:[],prepared:false},companion:{columns:4,file:'companions',image:null,frames:[],prepared:false},heroRear:{columns:5,file:'heroes-rear',image:null,frames:[],prepared:false},enemyRear:{columns:6,file:'enemies-rear',image:null,frames:[],prepared:false},companionRear:{columns:4,file:'companions-rear',image:null,frames:[],prepared:false}};
  function getSheet(kind,profile){var sheet=profile?profile[kind]:sheets[kind];return sheet&&sheet.prepared?sheet:null;}
  function orientation(kind,actor,profile){var front=getSheet(kind,profile),back=front&&rearFacing(actor)&&getSheet(kind+'Rear',profile);return {sheet:back||front,rear:!!back,mirror:back?actor.fx>0:actor.fx<0};}
  function ready(kind){return !!getSheet(kind||'hero');}
  function allReady(){return Object.keys(sheets).every(ready);}
  function snapshot(){var profile={};Object.keys(sheets).forEach(function(kind){profile[kind]=getSheet(kind);});return Object.freeze(profile);}
  function frameInfo(kind,column,row){var sheet=getSheet(kind),frame=sheet&&sheet.frames[column]&&sheet.frames[column][row];if(!frame)return null;return Object.freeze({x:frame.x,y:frame.y,w:frame.w,h:frame.h,anchor:Object.freeze({x:frame.anchor.x,y:frame.anchor.y}),nominalWidth:frame.nominalWidth,nominalHeight:frame.nominalHeight,pixels:frame.pixels,visiblePixels:frame.visiblePixels,core:Object.freeze(Object.assign({},frame.core))});}
  function prepare(sheet){
    if(sheet.prepared)return;
    var atlas=sheet.image;if(!atlas.naturalWidth||!atlas.naturalHeight||atlas.naturalWidth*atlas.naturalHeight>16777216){sheet.failed=true;return;}
    var canvas=root.document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
    try{
      var context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(atlas,0,0);
      var pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      var unpacked=root.LegendsAtlas.extract(pixels,canvas.width,canvas.height,sheet.columns,4);
      if(unpacked.missing.length)return;
      sheet.frames=unpacked.frames.map(function(rows){return rows.map(function(frame){
        var texture=root.document.createElement('canvas');texture.width=frame.w;texture.height=frame.h;
        var target=texture.getContext('2d'),data=target.createImageData(frame.w,frame.h);data.data.set(root.LegendsAtlas.cropPixels(pixels,canvas.width,canvas.height,frame));target.putImageData(data,0,0);
        // Coverage buffers are only needed during preparation, not every render.
        var cached=Object.assign({},frame,{texture:texture});delete cached.coverage;return Object.freeze(cached);
      });});
      sheet.prepared=true;root.dispatchEvent(new Event('legendsmodelsready'));
    }catch(_){sheet.failed=true;}
  }
  function drawModel(ctx,kind,column,row,actor,size,profile){
    var pose=orientation(kind,actor,profile),sheet=pose.sheet;if(column<0||!sheet)return false;
    var frame=sheet.frames[column][row];
    if(!frame)return false;
    var anchor=frame.anchor;
    size=size||72;ctx.save();ctx.translate(actor.x,actor.y+(actor.r||0));if(pose.mirror)ctx.scale(-1,1);
    var w=frame.w/frame.nominalWidth*size,h=frame.h/frame.nominalHeight*size;
    ctx.imageSmoothingEnabled=true;ctx.drawImage(frame.texture,-anchor.x*w,-anchor.y*h,w,h);
    ctx.restore();return true;
  }
  function drawHero(ctx,cls,actor,time,reduced,size,profile){return drawModel(ctx,'hero',HEROES.indexOf(cls),stateFrame(actor,time,reduced),actor,size,profile);}
  function drawEnemy(ctx,actor,time,reduced,size,profile){return drawModel(ctx,'enemy',enemyColumn(actor.kind),enemyFrame(actor,time,reduced),actor,size,profile);}
  function drawCompanion(ctx,actor,time,reduced,size,cls,profile){var model=companionModel(actor.kind,cls);if(!model)return false;ctx.save();if(actor.kind==='decoy')ctx.globalAlpha=.55;var drawn=drawModel(ctx,model.sheet,model.column,stateFrame(actor,time,reduced),actor,size,profile);ctx.restore();return drawn;}
  var api={ready:ready,allReady:allReady,snapshot:snapshot,frameInfo:frameInfo,advanceFacing:advanceFacing,rearFacing:rearFacing,drawHero:drawHero,drawEnemy:drawEnemy,drawCompanion:drawCompanion,companionModel:companionModel,companionRole:companionRole,stateFrame:stateFrame,enemyFrame:enemyFrame,enemyColumn:enemyColumn,sourceRect:sourceRect,footAnchor:footAnchor,sortActors:sortActors,statuses:statuses,bodyBounds:bodyBounds,frameBounds:frameBounds,enemyBounds:enemyBounds,pick:pick};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LegendsModels=api;
  if(typeof root.Image==='function'&&root.document)Object.keys(sheets).forEach(function(kind){var sheet=sheets[kind];sheet.image=new root.Image();sheet.image.onload=function(){prepare(sheet);};sheet.image.src='assets/science-legends/v2/'+sheet.file+'.webp';});
})(typeof window==='object'?window:globalThis);
