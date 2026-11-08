/* Conservative broad phase; exact swept-circle and area rules still decide hits. */
(function(root){
  'use strict';
  function create(size){return {size:Math.max(32,Math.min(256,size||96)),buckets:new Map(),active:[],records:new WeakMap(),revision:0,maxRadius:0,source:null,sourceLength:0,lastCandidates:0,lastTested:0};}
  function rebuild(index,enemies){
    for(var a=0;a<index.active.length;a++)index.active[a].entries.length=0;
    index.active.length=0;index.revision++;index.maxRadius=0;index.source=enemies;index.sourceLength=enemies.length;
    for(var i=0;i<enemies.length;i++){
      var actor=enemies[i];if(actor.dead||actor.hp<=0||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))continue;
      var key=Math.floor(actor.x/index.size)+':'+Math.floor(actor.y/index.size),bucket=index.buckets.get(key);
      if(!bucket){bucket={entries:[],revision:0};index.buckets.set(key,bucket);}
      if(bucket.revision!==index.revision){bucket.revision=index.revision;index.active.push(bucket);}
      var record=index.records.get(actor);if(!record){record={actor:actor,order:i};index.records.set(actor,record);}record.order=i;bucket.entries.push(record);
      index.maxRadius=Math.max(index.maxRadius,Math.max(0,actor.r||0));
    }
    return index;
  }
  function queryBox(index,x1,y1,x2,y2,pad){
    var found=[],result=[];pad=Math.max(0,pad||0);index.lastTested=0;
    if(![x1,y1,x2,y2,pad].every(Number.isFinite)||!index.active.length){index.lastCandidates=0;return result;}
    var left=Math.min(x1,x2)-pad,right=Math.max(x1,x2)+pad,top=Math.min(y1,y2)-pad,bottom=Math.max(y1,y2)+pad;
    var cx0=Math.floor((left-index.maxRadius)/index.size),cx1=Math.floor((right+index.maxRadius)/index.size),cy0=Math.floor((top-index.maxRadius)/index.size),cy1=Math.floor((bottom+index.maxRadius)/index.size);
    function visit(bucket){
      if(!bucket||bucket.revision!==index.revision)return;
      for(var i=0;i<bucket.entries.length;i++){
        var record=bucket.entries[i],actor=record.actor,r=Math.max(0,actor.r||0);index.lastTested++;
        if(!actor.dead&&actor.hp>0&&actor.x+r>=left&&actor.x-r<=right&&actor.y+r>=top&&actor.y-r<=bottom)found.push(record);
      }
    }
    if((cx1-cx0+1)*(cy1-cy0+1)>index.active.length*2)for(var j=0;j<index.active.length;j++)visit(index.active[j]);
    else for(var x=cx0;x<=cx1;x++)for(var y=cy0;y<=cy1;y++)visit(index.buckets.get(x+':'+y));
    found.sort(function(a,b){return a.order-b.order;});for(var f=0;f<found.length;f++)result.push(found[f].actor);
    index.lastCandidates=result.length;return result;
  }
  function radius(index,x,y,r){return queryBox(index,x-r,y-r,x+r,y+r,0);}
  function sweep(index,projectile,x,y){return queryBox(index,projectile.x,projectile.y,x,y,projectile.r||0);}
  var api={create:create,rebuild:rebuild,queryBox:queryBox,radius:radius,sweep:sweep};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsSpatial=api;
})(typeof window==='object'?window:globalThis);
