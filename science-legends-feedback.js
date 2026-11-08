/* Decorative health lag is separate from the authoritative player health. */
(function(root){
  'use strict';
  function ensure(state){var p=state.player;if(!state.healthVisual)state.healthVisual={trail:p.hp,hold:0,hitUntil:0,max:p.maxHp,last:p.hp,flash:0};return state.healthVisual;}
  function damage(state,previous){var visual=ensure(state);visual.trail=Math.max(visual.trail,previous);visual.hold=.3;visual.hitUntil=state.time+.24;}
  function heal(state){var visual=ensure(state);visual.trail=state.player.hp;visual.last=state.player.hp;visual.hold=0;visual.hitUntil=0;visual.flash=0;}
  function update(state,dt,reduced){var p=state.player,visual=ensure(state),hp=Math.max(0,Math.min(p.maxHp,p.hp));
    if(visual.max!==p.maxHp||hp>visual.last||reduced){visual.trail=hp;visual.hold=0;}
    else if(visual.hold>0)visual.hold=Math.max(0,visual.hold-dt);
    else visual.trail=Math.max(hp,visual.trail-p.maxHp*dt*1.4);
    visual.trail=Math.max(hp,Math.min(p.maxHp,visual.trail));visual.max=p.maxHp;visual.last=hp;
    visual.flash=reduced?0:Math.max(0,Math.min(1,(visual.hitUntil-state.time)/.24))*.45;return visual;
  }
  var api={ensure:ensure,damage:damage,heal:heal,update:update};if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsFeedback=api;
})(typeof window==='object'?window:globalThis);
