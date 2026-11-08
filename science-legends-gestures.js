/* A release can only act on the run and skill that owned its pointer-down. */
(function(root){'use strict';
  function begin(owner,slot,sid,pointerId,x,y){return {owner:owner,feedOwner:owner.feedOwner,slot:slot,sid:sid,pointerId:pointerId,startX:x,startY:y,x:x,y:y,dragged:false};}
  function move(gesture,x,y){gesture.x=x;gesture.y=y;if(Math.hypot(x-gesture.startX,y-gesture.startY)>=10)gesture.dragged=true;return gesture;}
  function inside(x,y,rect){return x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;}
  function finish(gesture,context){if(!gesture||gesture.owner!==context.owner||gesture.feedOwner!==context.owner.feedOwner||gesture.sid!==context.sid||gesture.pointerId!==context.pointerId||!context.running||context.blocked)return 'cancel';if(gesture.dragged&&(!inside(gesture.x,gesture.y,context.stage)||inside(gesture.x,gesture.y,context.button)))return 'cancel';return gesture.dragged?'aim':'tap';}
  var api={begin:begin,move:move,finish:finish,inside:inside};if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsGestures=api;
})(typeof window==='object'?window:globalThis);
