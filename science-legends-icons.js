/* Each class atlas contains twelve original skill portraits in CLASSES skill order. */
(function(root){
  'use strict';
  var classes={
    barb:'cleave whirlwind charge warcry slam axes ironskin rampage quake execute bladestorm berserk',
    sorc:'fireball chain nova meteor icebolt storm blizzard teleport barrier hydra orb combust',
    beast:'wolf stampede ravens frenzy sting vines hawk boarpet mend roar locusts stag',
    pala:'smite hammers zeal consecrate bash holybolt retribution lay fist judgement aegis banner',
    ama:'javelin multishot strafe plague fury roll valk decoy rain trap eagle net'
  };
  var mapping={},images={},loaded={},classIds=Object.keys(classes);
  classIds.forEach(function(classId,classIndex){
    classes[classId].split(' ').forEach(function(sid,slot){
      mapping[sid]={classId:classId,slot:slot,index:classIndex*12+slot,file:'assets/science-legends/v3/icons-'+classId+'.webp'};
    });
  });
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function index(sid){return Object.prototype.hasOwnProperty.call(mapping,sid)?mapping[sid].index:-1;}
  function ready(classId){return classId?loaded[classId]===true:classIds.every(function(id){return loaded[id]===true;});}
  function markup(sid,def,options){
    var entry=Object.prototype.hasOwnProperty.call(mapping,sid)?mapping[sid]:null,badge=options&&options.badge;
    var html='<span class="legend-skill-icon'+(options&&options.kind?' icon-kind-'+escape(options.kind):'')+'" data-skill-icon="'+escape(sid)+'"';
    if(entry)html+=' data-icon-class="'+entry.classId+'" data-icon-slot="'+entry.slot+'" data-icon-index="'+entry.index+'"';
    html+=' aria-hidden="true"><span class="icon-fallback">'+escape(def?def.icon:'?')+'</span>';
    if(entry){
      var x=entry.slot%4*(100/3),y=Math.floor(entry.slot/4)*50;
      html+='<span class="icon-art" style="background-image:url(\''+entry.file+'\');background-position:'+x+'% '+y+'%"></span>';
    }
    if(badge)html+='<span class="icon-kind-badge" title="'+escape(options.label)+'">'+escape(badge)+'</span>';
    return html+'</span>';
  }
  function treeMarkup(node,skills){
    var sid=node.fx&&(node.fx.unlock||node.fx.skill)||node.ultInfo&&node.ultInfo.sid||node.sm&&node.sm.sid||node.mod&&node.mod.split('.')[0];
    if(!sid||!Object.prototype.hasOwnProperty.call(mapping,sid)||!skills[sid]){
      return '<span class="legend-node-symbol icon-kind-'+escape(node.kind)+'" aria-hidden="true">'+escape(node.icon)+'</span>';
    }
    var kind=node.kind,badge='',label='';
    if(kind==='unlock'){badge='+';label='Learn skill';}
    else if(kind==='enh'){badge=node.id.indexOf('e2_')===0?'II':'I';label='Enhancement '+badge;}
    else if(kind==='branch'){
      var branch=node.id.split('_')[0],badges={b1:'DMG',b2:'CD',b3:'AREA',b4:'D+',b5:'C+',b6:'M'};
      badge=badges[branch]||'B';label=node.name;
    }
    else if(kind==='ult'){badge='U'+node.ultInfo.n;label='Ultimate '+node.ultInfo.n;}
    return markup(sid,skills[sid],{kind:kind,badge:badge,label:label});
  }
  var api={index:index,markup:markup,treeMarkup:treeMarkup,ready:ready,mapping:mapping};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LegendsIcons=api;
  if(typeof root.Image==='function')classIds.forEach(function(classId){
    var image=images[classId]=new root.Image();
    image.onload=function(){
      loaded[classId]=image.naturalWidth>0;
      if(root.document)root.document.documentElement.classList.toggle('legends-icons-ready-'+classId,loaded[classId]);
    };
    image.onerror=function(){
      loaded[classId]=false;
      if(root.document)root.document.documentElement.classList.remove('legends-icons-ready-'+classId);
    };
    image.src='assets/science-legends/v3/icons-'+classId+'.webp';
  });
})(typeof window==='object'?window:globalThis);
