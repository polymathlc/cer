/* Simulation-timed VFX events are visual only: drawing never applies damage. */
(function(root){
  'use strict';
  var atlas=null;
  function frame(progress,reduced){return reduced?1:Math.min(3,Math.max(0,Math.floor(progress*4)));}
  function emit(state,row,x,y,radius,angle,duration){
    var actions=state.actions||(state.actions=[]);if(actions.length>=24)actions.shift();
    var action={row:row,x:x,y:y,r:radius,ang:angle||0,start:state.time,life:duration||.32};actions.push(action);return action;
  }
  function expire(state){state.actions=(state.actions||[]).filter(function(action){return state.time-action.start<action.life;});}
  function sample(action,time,reduced){var progress=Math.max(0,Math.min(1,(time-action.start)/action.life));return {frame:frame(progress,reduced),progress:progress,alpha:(1-progress*.65)*(reduced?.45:.8)};}
  function ready(){return !!atlas&&atlas.complete&&atlas.naturalWidth>0;}
  function draw(ctx,action,time,reduced){
    if(!ready())return false;var state=sample(action,time,reduced),w=atlas.naturalWidth/4,h=atlas.naturalHeight/4;
    var size=Math.max(36,Math.min(reduced?180:340,action.r*2.1));
    ctx.save();ctx.translate(action.x,action.y);if(action.row===0)ctx.rotate(action.ang);
    ctx.globalAlpha=state.alpha;ctx.imageSmoothingEnabled=true;
    ctx.drawImage(atlas,state.frame*w,action.row*h,w,h,-size/2,-size/2,size,size);ctx.restore();return true;
  }
  var api={frame:frame,emit:emit,expire:expire,sample:sample,ready:ready,draw:draw};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsActions=api;
  if(typeof root.Image==='function'){atlas=new root.Image();atlas.src='assets/science-legends/v2/attacks.png';}
})(typeof window==='object'?window:globalThis);
