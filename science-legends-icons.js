/* Original generated archetype art; semantic skill names stay in the DOM. */
(function(root){
  'use strict';
  var groups=['cleave whirlwind warcry slam axes quake execute bladestorm berserk trap','fireball hydra combust','nova icebolt blizzard','chain storm fury','sting vines locusts plague','smite hammers zeal consecrate holybolt retribution lay fist judgement banner valk','ironskin barrier aegis decoy net','javelin multishot strafe rain eagle','wolf stampede ravens frenzy hawk boarpet mend roar','meteor','orb','charge rampage teleport stag bash roll'];
  var mapping={};groups.forEach(function(group,index){group.split(' ').forEach(function(sid){mapping[sid]=index;});});
  function index(sid){return Object.prototype.hasOwnProperty.call(mapping,sid)?mapping[sid]:10;}
  function markup(sid,def){var slot=index(sid),x=slot%6*20,y=Math.floor(slot/6)*100;return '<span class="legend-skill-icon" data-icon-index="'+slot+'" aria-hidden="true"><span class="icon-fallback">'+(def?def.icon:'✦')+'</span><span class="icon-art" style="background-position:'+x+'% '+y+'%"></span></span>';}
  var image=null;function ready(){return !!image&&image.complete&&image.naturalWidth>0;}
  var api={index:index,markup:markup,ready:ready,mapping:mapping};if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsIcons=api;
  if(typeof root.Image==='function'){image=new root.Image();image.onload=function(){root.document.documentElement.classList.add('legends-icons-ready');};image.src='assets/science-legends/v2/skill-icons.webp';}
})(typeof window==='object'?window:globalThis);
