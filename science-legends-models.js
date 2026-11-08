/* Fixed-camera, foot-anchored model atlases. Images are decoded and measured once. */
(function(root){
  'use strict';
  var HEROES=['barb','sorc','beast','pala','ama'];
  var ENEMIES=['slime','imp','mite','brute','spitter','charger'];
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
  function sortActors(entries){return entries.slice().sort(function(a,b){return (a.actor.y+(a.actor.r||0))-(b.actor.y+(b.actor.r||0))||a.order-b.order;});}
  function statuses(actor){
    var list=[];
    if(actor.frozen>0)list.push({kind:'frozen',label:'FROZEN',glyph:'❄',color:'#9eefff'});
    if(actor.stun>0)list.push({kind:'stun',label:'STUN',glyph:'✦',color:'#ffe197'});
    if(actor.slowT>0)list.push({kind:'slow',label:'SLOW',glyph:'◷',color:'#b4d9f0'});
    if(actor.bleedT>0)list.push(actor.dotKind==='poison'?{kind:'poison',label:'VENOM',glyph:'◆',color:'#bce87f'}:actor.dotKind==='burn'?{kind:'burn',label:'BURN',glyph:'♨',color:'#ffbd84'}:{kind:'bleed',label:'BLEED',glyph:'♦',color:'#ffa49c'});
    return list;
  }
  function enemyFrame(actor,time,reduced){
    if(actor.frozen>0||actor.stun>0)return 0;
    if(actor.chargeSt===1)return 3;
    if(actor.spitWindup>0)return 3;
    if(actor.heavyWindup>0)return 3;
    if((actor.modelAttackUntil||0)>time)return 3;
    return actor.moving?(reduced?1:1+(Math.floor((time+(actor.modelPhase||0))*7)%2)):0;
  }
  var sheets={hero:{columns:5,image:null,metadata:[],prepared:false},enemy:{columns:6,image:null,metadata:[],prepared:false}};
  function ready(kind){var sheet=sheets[kind||'hero'];return !!sheet&&!!sheet.image&&sheet.prepared&&sheet.image.complete&&sheet.image.naturalWidth>0;}
  function prepare(sheet){
    if(sheet.prepared)return;
    var atlas=sheet.image,canvas=root.document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
    var context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(atlas,0,0);
    sheet.metadata=Array.from({length:sheet.columns},function(_,column){var rows=[];for(var row=0;row<4;row++){
      var rect=sourceRect(canvas.width,canvas.height,sheet.columns,column,row),w=Math.floor(rect.w),h=Math.floor(rect.h);
      try{rows.push(footAnchor(context.getImageData(Math.floor(rect.x),Math.floor(rect.y),w,h).data,w,h));}catch(_){rows.push({x:.5,y:.96});}
    }return rows;});
    sheet.prepared=true;root.dispatchEvent(new Event('legendsmodelsready'));
  }
  function drawModel(ctx,kind,column,row,actor,size){
    if(column<0||!ready(kind))return false;
    var sheet=sheets[kind],atlas=sheet.image,rect=sourceRect(atlas.naturalWidth,atlas.naturalHeight,sheet.columns,column,row),anchor=sheet.metadata[column][row];
    size=size||72;ctx.save();ctx.translate(actor.x,actor.y+(actor.r||0));if(actor.fx<0)ctx.scale(-1,1);
    ctx.imageSmoothingEnabled=true;ctx.drawImage(atlas,rect.x,rect.y,rect.w,rect.h,-anchor.x*size,-anchor.y*size,size,size);
    ctx.restore();return true;
  }
  function drawHero(ctx,cls,actor,time,reduced,size){return drawModel(ctx,'hero',HEROES.indexOf(cls),stateFrame(actor,time,reduced),actor,size);}
  function drawEnemy(ctx,actor,time,reduced,size){return drawModel(ctx,'enemy',enemyColumn(actor.kind),enemyFrame(actor,time,reduced),actor,size);}
  var api={ready:ready,drawHero:drawHero,drawEnemy:drawEnemy,stateFrame:stateFrame,enemyFrame:enemyFrame,enemyColumn:enemyColumn,sourceRect:sourceRect,footAnchor:footAnchor,sortActors:sortActors,statuses:statuses};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LegendsModels=api;
  if(typeof root.Image==='function'&&root.document)Object.keys(sheets).forEach(function(kind){var sheet=sheets[kind];sheet.image=new root.Image();sheet.image.onload=function(){prepare(sheet);};sheet.image.src='assets/science-legends/v2/'+(kind==='hero'?'heroes':'enemies')+'.png';});
})(typeof window==='object'?window:globalThis);
