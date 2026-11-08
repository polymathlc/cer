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
  var api={beginSpit:beginSpit,advanceSpit:advanceSpit};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsAI=api;
})(typeof window==='object'?window:globalThis);
