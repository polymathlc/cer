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
  function varietyModel(kind){return root.LegendsVariety&&root.LegendsVariety.model(kind);}
  function enemyColumn(kind){var extra=varietyModel(kind);return extra?extra.column:kind==='boss'?3:ENEMIES.indexOf(kind);}
  var enemyPoses=Object.create(null);
  function enemyPose(actor,profile){
    var boss = actor.kind === 'boss' && root.LegendsBosses && getSheet('boss',profile) && root.LegendsBosses.get(actor.bossId || 'tyrant');
    if(boss){
      var bossKey = 'boss:' + boss.id;
      return enemyPoses[bossKey] || (enemyPoses[bossKey] = Object.freeze({kind:'boss',column:boss.column}));
    }
    var extra = varietyModel(actor.kind), elite = extra && getSheet('enemyElite',profile);
    var key = (elite ? 'elite:' : 'base:') + actor.kind;
    return enemyPoses[key] || (enemyPoses[key] = Object.freeze(elite ? {kind:'enemyElite',column:extra.column} :
      {kind:'enemy',column:extra ? ENEMIES.indexOf(extra.fallback) : enemyColumn(actor.kind)}));
  }
  function sortActors(entries,inPlace){return (inPlace?entries:entries.slice()).sort(function(a,b){return (a.actor.y+(a.actor.r||0))-(b.actor.y+(b.actor.r||0))||a.order-b.order;});}
  function bodyBounds(actor,size,anchor){anchor=anchor||{x:.5,y:.96};return {x:actor.x-(actor.fx<0?1-anchor.x:anchor.x)*size,y:actor.y+(actor.r||0)-anchor.y*size,w:size,h:size};}
  function frameBounds(actor,size,frame,mirror){var w=frame.w/frame.nominalWidth*size,h=frame.h/frame.nominalHeight*size;mirror=mirror==null?actor.fx<0:mirror;return {x:actor.x-(mirror?1-frame.anchor.x:frame.anchor.x)*w,y:actor.y+(actor.r||0)-frame.anchor.y*h,w:w,h:h};}
  function enemyBounds(actor,time,reduced,size,profile){var model=enemyPose(actor,profile),column=model.column,row=enemyFrame(actor,time,reduced),pose=orientation(model.kind,actor,profile),frame=pose.sheet&&column>=0&&pose.sheet.frames[column][row];return frame?frameBounds(actor,size,frame,pose.mirror):bodyBounds(actor,size,{x:.5,y:1});}
  function companionBounds(actor,time,reduced,size,cls,profile){var model=companionModel(actor.kind,cls),pose=model&&orientation(model.sheet,actor,profile),frame=pose&&pose.sheet&&pose.sheet.frames[model.column][stateFrame(actor,time,reduced)];return frame?frameBounds(actor,size,frame,pose.mirror):bodyBounds(actor,size,{x:.5,y:1});}
  function pick(enemies,x,y,bounds){var best=null,depth=-Infinity,order=-1;for(var i=0;i<enemies.length;i++){var actor=enemies[i];if(actor.dead||actor.hp<=0)continue;var z=actor.y+(actor.r||0);if(z<depth||z===depth&&i<order)continue;var box=bounds(actor);if(x>=box.x&&x<=box.x+box.w&&y>=box.y&&y<=box.y+box.h){best=actor;depth=z;order=i;}}return best;}
  function statuses(actor){
    var list=[];
    if(actor.frozen>0)list.push({kind:'frozen',label:'FROZEN',glyph:'❄',color:'#9eefff'});
    if(actor.stun>0)list.push({kind:'stun',label:'STUN',glyph:'✦',color:'#ffe197'});
    if(actor.slowT>0)list.push({kind:'slow',label:'SLOW',glyph:'◷',color:'#b4d9f0'});
    if(actor.bleedT>0)list.push(actor.dotKind==='poison'?{kind:'poison',label:'VENOM',glyph:'◆',color:'#bce87f'}:actor.dotKind==='burn'?{kind:'burn',label:'BURN',glyph:'♨',color:'#ffbd84'}:{kind:'bleed',label:'BLEED',glyph:'♦',color:'#ffa49c'});
    if(actor.chillT>0 && !(actor.frozen>0))list.push({kind:'chill',label:'CHILLED',glyph:'❄',color:'#a4eaff'});
    if(actor.afflictions?.bleed?.length)list.push({kind:'bleed',label:'BLEED ×'+actor.afflictions.bleed.length,glyph:'♦',color:'#ff8190'});
    if(actor.afflictions?.fire?.length)list.push({kind:'burn',label:'BURN ×'+actor.afflictions.fire.length,glyph:'♨',color:'#ff9554'});
    return list;
  }
  function enemyFrame(actor,time,reduced){
    if(actor.variety&&actor.variety.phase==='windup')return 3;
    if(actor.chargeSt===1)return 3;
    if(actor.spitWindup>0)return 3;
    if(actor.heavyWindup>0)return 3;
    if(actor.frozen>0||actor.stun>0)return 0;
    if((actor.modelAttackUntil||0)>time)return 3;
    return actor.moving?(reduced?1:1+(Math.floor((time+(actor.modelPhase||0))*7)%2)):0;
  }
  var sheets={hero:{columns:5,file:'heroes',image:null,frames:[],prepared:false},enemy:{columns:6,file:'enemies-clean',image:null,frames:[],prepared:false},companion:{columns:4,file:'companions',image:null,frames:[],prepared:false},heroRear:{columns:5,file:'heroes-rear',image:null,frames:[],prepared:false},enemyRear:{columns:6,file:'enemies-rear',image:null,frames:[],prepared:false},companionRear:{columns:4,file:'companions-rear',image:null,frames:[],prepared:false},enemyElite:{columns:4,file:'enemies-elite',optional:true,image:null,frames:[],prepared:false},enemyEliteRear:{columns:4,file:'enemies-elite-rear',optional:true,image:null,frames:[],prepared:false}};
  ['boss','bossRear','mythicHero','mythicHeroRear'].forEach(function(kind,index){
    var files = ['bosses','bosses-rear','mythic-heroes','mythic-heroes-rear'];
    sheets[kind] = {columns:index<2?4:5,file:files[index],optional:true,release:'v5',image:null,frames:[],prepared:false};
  });
  function getSheet(kind,profile){var sheet=profile?profile[kind]:sheets[kind];return sheet&&sheet.prepared?sheet:null;}
  function orientation(kind,actor,profile){var front=getSheet(kind,profile),back=front&&rearFacing(actor)&&getSheet(kind+'Rear',profile);return {sheet:back||front,rear:!!back,mirror:back?actor.fx>0:actor.fx<0};}
  function ready(kind){return !!getSheet(kind||'hero');}
  function allReady(){return ['hero','enemy','companion','heroRear','enemyRear','companionRear'].every(ready);}
  function assetStates() {
    return Object.values(sheets).map(function (sheet) {
      return sheet.prepared ? 'ready' : sheet.failed ? 'failed' : 'pending';
    });
  }
  function snapshot(){var profile={};Object.keys(sheets).forEach(function(kind){profile[kind]=getSheet(kind);});return Object.freeze(profile);}
  function frameInfo(kind,column,row){var sheet=getSheet(kind),frame=sheet&&sheet.frames[column]&&sheet.frames[column][row];if(!frame)return null;return Object.freeze({x:frame.x,y:frame.y,w:frame.w,h:frame.h,anchor:Object.freeze({x:frame.anchor.x,y:frame.anchor.y}),nominalWidth:frame.nominalWidth,nominalHeight:frame.nominalHeight,pixels:frame.pixels,visiblePixels:frame.visiblePixels,core:Object.freeze(Object.assign({},frame.core))});}
  var atlasWorker=null,workerDisabled=false,workerRequests=new Map(),workerSequence=0,workerIdleTimer=null;
  var modelScript=root.document&&root.document.currentScript&&root.document.currentScript.src;
  function publishFrames(sheet,frames,missing){
    if(missing.length){sheet.processing=false;sheet.failed=true;return;}
    sheet.frames=frames.map(function(rows){return rows.map(function(frame){
      var texture=root.document.createElement('canvas');texture.width=frame.w;texture.height=frame.h;
      var target=texture.getContext('2d'),data=typeof root.ImageData==='function'?new root.ImageData(frame.rgba,frame.w,frame.h):target.createImageData(frame.w,frame.h);
      if(data.data!==frame.rgba)data.data.set(frame.rgba);target.putImageData(data,0,0);
      var cached=Object.assign({},frame,{texture:texture});delete cached.rgba;delete cached.coverage;return Object.freeze(cached);
    });});
    sheet.processing=false;sheet.prepared=true;sheet.failed=false;root.dispatchEvent(new Event('legendsmodelsready'));
  }
  function prepareFallback(sheet){sheet.processing=false;root.setTimeout(function(){prepare(sheet,true);},0);}
  function cancelAtlasWorkerRetirement(){
    if(workerIdleTimer!==null){root.clearTimeout(workerIdleTimer);workerIdleTimer=null;}
  }
  function stopAtlasWorker(worker){
    if(!worker)return;
    if(atlasWorker===worker){cancelAtlasWorkerRetirement();atlasWorker=null;}
    // Keep the identity-guarded error sink for already queued native errors.
    worker.onmessage=null;worker.terminate();
  }
  function retireAtlasWorker(worker){
    if(!worker||atlasWorker!==worker)return;
    cancelAtlasWorkerRetirement();
    var timer=root.setTimeout(function(){
      if(workerIdleTimer!==timer||atlasWorker!==worker)return;
      workerIdleTimer=null;if(!workerRequests.size)stopAtlasWorker(worker);
    },500);
    workerIdleTimer=timer;
  }
  function getAtlasWorker(){
    if(workerDisabled||typeof root.Worker!=='function')return null;
    cancelAtlasWorkerRetirement();
    if(atlasWorker)return atlasWorker;
    try{
      var worker=new root.Worker(new URL('science-legends-atlas-worker.js?v=1.458.0',modelScript||root.location.href));atlasWorker=worker;
      worker.onmessage=function(event){
        if(atlasWorker!==worker)return;
        var response=event.data,request=workerRequests.get(response.id);if(!request||request.worker!==worker)return;workerRequests.delete(response.id);
        if(response.error)prepareFallback(request.sheet);
        else try{publishFrames(request.sheet,response.frames,response.missing);}catch(_){prepareFallback(request.sheet);}
        retireAtlasWorker(worker);
      };
      worker.onerror=function(event){
        if(event.preventDefault)event.preventDefault();
        if(atlasWorker!==worker)return;
        workerDisabled=true;stopAtlasWorker(worker);
        var pending=[];workerRequests.forEach(function(request,id){if(request.worker===worker){pending.push(request);workerRequests.delete(id);}});
        pending.forEach(function(request){prepareFallback(request.sheet);});
      };
      return worker;
    }catch(_){workerDisabled=true;cancelAtlasWorkerRetirement();atlasWorker=null;return null;}
  }
  function prepare(sheet,synchronous,pixelsOnly){
    if(sheet.prepared||sheet.processing)return;
    var atlas=sheet.image;if(!atlas.naturalWidth||!atlas.naturalHeight||atlas.naturalWidth*atlas.naturalHeight>16777216){sheet.failed=true;return;}
    try{
      var worker=synchronous?null:getAtlasWorker();sheet.processing=true;
      if(worker&&!pixelsOnly&&typeof root.createImageBitmap==='function'&&typeof root.OffscreenCanvas==='function'){
        var bitmapId=++workerSequence;workerRequests.set(bitmapId,{sheet:sheet,worker:worker});
        function bitmapFailed(){if(!workerRequests.has(bitmapId))return;workerRequests.delete(bitmapId);sheet.processing=false;prepare(sheet,false,true);retireAtlasWorker(worker);}
        var bitmapTask;try{bitmapTask=root.createImageBitmap(atlas);}catch(_){bitmapFailed();return;}
        Promise.resolve(bitmapTask).then(function(bitmap){
          var request=workerRequests.get(bitmapId);if(!request||request.worker!==worker||atlasWorker!==worker){bitmap.close();return;}
          try{worker.postMessage({id:bitmapId,bitmap:bitmap,width:atlas.naturalWidth,height:atlas.naturalHeight,columns:sheet.columns},[bitmap]);}
          catch(_){bitmap.close();workerRequests.delete(bitmapId);prepareFallback(sheet);retireAtlasWorker(worker);}
        },bitmapFailed);
        return;
      }
      var canvas=root.document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
      var context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(atlas,0,0);
      var pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      if(worker){
        var id=++workerSequence;workerRequests.set(id,{sheet:sheet,worker:worker});
        try{worker.postMessage({id:id,pixels:pixels.buffer,width:canvas.width,height:canvas.height,columns:sheet.columns},[pixels.buffer]);return;}
        catch(_){workerRequests.delete(id);prepareFallback(sheet);retireAtlasWorker(worker);return;}
      }
      var unpacked=root.LegendsAtlas.extract(pixels,canvas.width,canvas.height,sheet.columns,4);
      var frames=unpacked.frames.map(function(rows){return rows.map(function(frame){
        return frame?Object.assign({},frame,{rgba:root.LegendsAtlas.cropPixels(pixels,canvas.width,canvas.height,frame)}):null;
      });});
      publishFrames(sheet,frames,unpacked.missing);
    }catch(_){sheet.processing=false;sheet.failed=true;retireAtlasWorker(worker);}
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
  function drawMythicHero(ctx,cls,actor,time,reduced,size,profile){
    return drawModel(ctx,'mythicHero',HEROES.indexOf(cls),stateFrame(actor,time,reduced),actor,size,profile);
  }
  function drawEnemy(ctx,actor,time,reduced,size,profile){var model=enemyPose(actor,profile);return drawModel(ctx,model.kind,model.column,enemyFrame(actor,time,reduced),actor,size,profile);}
  function drawCompanion(ctx,actor,time,reduced,size,cls,profile){var model=companionModel(actor.kind,cls);if(!model)return false;ctx.save();if(actor.kind==='decoy')ctx.globalAlpha=.55;var drawn=drawModel(ctx,model.sheet,model.column,stateFrame(actor,time,reduced),actor,size,profile);ctx.restore();return drawn;}
  var api={ready:ready,allReady:allReady,snapshot:snapshot,frameInfo:frameInfo,advanceFacing:advanceFacing,rearFacing:rearFacing,drawHero:drawHero,drawEnemy:drawEnemy,drawCompanion:drawCompanion,companionModel:companionModel,companionRole:companionRole,stateFrame:stateFrame,enemyFrame:enemyFrame,enemyColumn:enemyColumn,enemyPose:enemyPose,sourceRect:sourceRect,footAnchor:footAnchor,sortActors:sortActors,statuses:statuses,bodyBounds:bodyBounds,frameBounds:frameBounds,enemyBounds:enemyBounds,companionBounds:companionBounds,pick:pick};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LegendsModels=api;
  function loadSheet(kind) {
    var sheet = sheets[kind];
    if (sheet.image) return;
    sheet.image = new root.Image();
    sheet.image.onload = function () { prepare(sheet); };
    sheet.image.onerror = function () { sheet.failed = true; };
    sheet.image.src = 'assets/science-legends/' + (sheet.release || (sheet.optional ? 'v4' : 'v2')) + '/' + sheet.file + '.webp';
  }
  var optionalScheduled=false;
  function prepareAll() {
    if (typeof root.Image !== 'function' || !root.document) return;
    optionalScheduled = true;
    Object.keys(sheets).forEach(loadSheet);
  }
  function warmOptional() {
    if (optionalScheduled) return;
    optionalScheduled = true;
    function warmElites(){ loadSheet('enemyElite'); loadSheet('enemyEliteRear'); }
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(warmElites, { timeout: 3000 });
    else root.setTimeout(warmElites, 100);
  }
  api.drawMythicHero = drawMythicHero;
  api.assetStates = assetStates;
  api.prepareAll = prepareAll;
  api.warmOptional=warmOptional;
  if(typeof root.Image==='function'&&root.document){Object.keys(sheets).forEach(function(kind){if(!sheets[kind].optional)loadSheet(kind);});root.addEventListener('legendsmodelsready',function(){if(allReady())warmOptional();});}

})(typeof window==='object'?window:globalThis);
