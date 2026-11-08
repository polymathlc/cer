/* Fixed-camera, foot-anchored model atlases. Images are decoded and measured once. */
(function(root){
  'use strict';
  var HEROES=['barb','sorc','beast','pala','ama'];
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
  var atlas=null,metadata=[],prepared=false;
  function ready(){return !!atlas&&prepared&&atlas.complete&&atlas.naturalWidth>0;}
  function prepare(){
    if(prepared)return;
    var canvas=root.document.createElement('canvas');canvas.width=atlas.naturalWidth;canvas.height=atlas.naturalHeight;
    var context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(atlas,0,0);
    metadata=HEROES.map(function(_,column){var rows=[];for(var row=0;row<4;row++){
      var rect=sourceRect(canvas.width,canvas.height,5,column,row),w=Math.floor(rect.w),h=Math.floor(rect.h);
      try{rows.push(footAnchor(context.getImageData(Math.floor(rect.x),Math.floor(rect.y),w,h).data,w,h));}catch(_){rows.push({x:.5,y:.96});}
    }return rows;});
    prepared=true;root.dispatchEvent(new Event('legendsmodelsready'));
  }
  function drawHero(ctx,cls,actor,time,reduced,size){
    var column=HEROES.indexOf(cls);if(column<0||!ready())return false;
    var row=stateFrame(actor,time,reduced),rect=sourceRect(atlas.naturalWidth,atlas.naturalHeight,5,column,row),anchor=metadata[column][row];
    size=size||72;ctx.save();ctx.translate(actor.x,actor.y+(actor.r||0));if(actor.fx<0)ctx.scale(-1,1);
    ctx.imageSmoothingEnabled=true;ctx.drawImage(atlas,rect.x,rect.y,rect.w,rect.h,-anchor.x*size,-anchor.y*size,size,size);
    ctx.restore();return true;
  }
  var api={ready:ready,drawHero:drawHero,stateFrame:stateFrame,sourceRect:sourceRect,footAnchor:footAnchor};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LegendsModels=api;
  if(typeof root.Image==='function'&&root.document){atlas=new root.Image();atlas.onload=prepare;atlas.src='assets/science-legends/v2/heroes.png';}
})(typeof window==='object'?window:globalThis);
