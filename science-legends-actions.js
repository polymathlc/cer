/* Simulation-timed VFX events are visual only: drawing never applies damage. */
(function(root){
  'use strict';
  var atlases={attacks:null,elements:null};
  var ELEMENTS=['lightning','poison','holy','arrow'];
  function familyForSkill(sid){
    if(/^(chain|storm)$/.test(sid))return 'lightning';
    if(/^(sting|plague|locusts)$/.test(sid))return 'poison';
    if(/^(smite|holybolt|hammers|consecrate|retribution|judgement|fist)$/.test(sid))return 'holy';
    if(/^(multishot|strafe|rain)$/.test(sid))return 'arrow';
    if(/^(nova|icebolt|blizzard)$/.test(sid))return 'frost';
    if(/^(orb|teleport)$/.test(sid))return 'arcane';
    return 'fire';
  }
  function frame(progress,reduced){return reduced?1:Math.min(3,Math.max(0,Math.floor(progress*4)));}
  function emit(state,row,x,y,radius,angle,duration){
    var actions=state.actions||(state.actions=[]);if(actions.length>=24)actions.shift();
    var action={row:row,x:x,y:y,r:radius,ang:angle||0,start:state.time,life:duration||.32};actions.push(action);return action;
  }
  function emitElement(state,family,x,y,radius,angle,duration){var row=ELEMENTS.indexOf(family);if(row<0)return null;var action=emit(state,row,x,y,radius,angle,duration);action.sheet='elements';action.family=family;return action;}
  function expire(state){state.actions=(state.actions||[]).filter(function(action){return state.time-action.start<action.life;});}
  function sample(action,time,reduced){var progress=Math.max(0,Math.min(1,(time-action.start)/action.life));return {frame:frame(progress,reduced),progress:progress,alpha:(1-progress*.65)*(reduced?.45:.8)};}
  function ready(sheet){var atlas=atlases[sheet||'attacks'];return !!atlas&&atlas.complete&&atlas.naturalWidth>0;}
  function snapshot(){var profile={};Object.keys(atlases).forEach(function(sheet){profile[sheet]=ready(sheet)?atlases[sheet]:null;});return Object.freeze(profile);}
  function draw(ctx,action,time,reduced,profile){
    var sheet=action.sheet||'attacks',atlas=profile?profile[sheet]:atlases[sheet];if(!atlas||!atlas.complete||!atlas.naturalWidth)return false;var state=sample(action,time,reduced),w=atlas.naturalWidth/4,h=atlas.naturalHeight/4;
    var size=Math.max(36,Math.min(reduced?180:340,action.r*2.1));
    var height=size*h/w;
    ctx.save();ctx.translate(action.x,action.y);if((sheet==='attacks'&&action.row===0)||(sheet==='elements'&&action.row===3))ctx.rotate(action.ang);
    ctx.globalAlpha=state.alpha;ctx.imageSmoothingEnabled=true;
    ctx.drawImage(atlas,state.frame*w,action.row*h,w,h,-size/2,-height/2,size,height);ctx.restore();return true;
  }
  var api={frame:frame,emit:emit,emitElement:emitElement,familyForSkill:familyForSkill,expire:expire,sample:sample,ready:ready,snapshot:snapshot,draw:draw};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsActions=api;
  if(typeof root.Image==='function')Object.keys(atlases).forEach(function(sheet){var image=atlases[sheet]=new root.Image();image.src='assets/science-legends/v2/'+(sheet==='elements'?'elements-clean':'attacks')+'.webp';});
})(typeof window==='object'?window:globalThis);
