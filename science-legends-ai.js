/* Enemy attack commitments are simulation state, never renderer side effects. */
(function(root){
  'use strict';
  function beginSpit(enemy,dx,dy){
    if(enemy.dead||enemy.hp<=0||enemy.spitWindup>0)return false;
    var distance=Math.hypot(dx,dy)||1;enemy.spitVX=dx/distance*260;enemy.spitVY=dy/distance*260;
    enemy.spitWindup=.4;enemy.spitPending=true;return true;
  }
  function advanceSpit(enemy,dt){
    if(enemy.dead||enemy.hp<=0){enemy.spitWindup=0;enemy.spitPending=false;return null;}
    if(enemy.frozen>0||enemy.stun>0||!enemy.spitPending)return null;
    enemy.spitWindup=Math.max(0,enemy.spitWindup-dt);
    if(enemy.spitWindup>1e-9)return null;
    enemy.spitWindup=0;enemy.spitPending=false;enemy.spitRecovery=.22;enemy.shootCd=2.3;
    return {vx:enemy.spitVX,vy:enemy.spitVY};
  }
  function beginHeavy(enemy,target){
    if(enemy.dead||enemy.hp<=0||enemy.heavyWindup>0||enemy.heavyRecovery>0||!target||target.hp<=0)return false;
    var dx=target.x-enemy.x,dy=target.y-enemy.y,distance=Math.hypot(dx,dy)||1;
    enemy.heavyTarget=target;enemy.heavyX=enemy.x+dx/distance*(enemy.r+target.r);enemy.heavyY=enemy.y+dy/distance*(enemy.r+target.r);
    enemy.heavyRadius=Math.max(28,enemy.r+10);enemy.heavyWindup=.45;enemy.heavyPending=true;return true;
  }
  function advanceHeavy(enemy,dt){
    if(enemy.dead||enemy.hp<=0){enemy.heavyPending=false;enemy.heavyWindup=0;enemy.heavyTarget=null;return null;}
    if(enemy.frozen>0||enemy.stun>0||!enemy.heavyPending)return null;
    enemy.heavyWindup=Math.max(0,enemy.heavyWindup-dt);if(enemy.heavyWindup>1e-9)return null;
    var strike={target:enemy.heavyTarget,x:enemy.heavyX,y:enemy.heavyY,r:enemy.heavyRadius};
    enemy.heavyPending=false;enemy.heavyWindup=0;enemy.heavyRecovery=.65;enemy.heavyTarget=null;return strike;
  }
  function heavyHits(strike){var target=strike&&strike.target;return !!target&&!target.dead&&target.hp>0&&(target.x-strike.x)**2+(target.y-strike.y)**2<=(strike.r+target.r*.5)**2;}
  var api={beginSpit:beginSpit,advanceSpit:advanceSpit,beginHeavy:beginHeavy,advanceHeavy:advanceHeavy,heavyHits:heavyHits};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsAI=api;
})(typeof window==='object'?window:globalThis);
