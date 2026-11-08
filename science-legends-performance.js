/* Presentation-only helpers: avoid rewriting unchanged HUD state. */
(function(root){
  'use strict';
  function text(node,value){value=String(value);if(node.textContent!==value){node.textContent=value;return true;}return false;}
  function html(node,value){if(node.innerHTML!==value){node.innerHTML=value;return true;}return false;}
  function attr(node,name,value){value=String(value);if(node.getAttribute(name)!==value){node.setAttribute(name,value);return true;}return false;}
  function style(node,name,value){value=String(value);if(node.style[name]!==value){node.style[name]=value;return true;}return false;}
  function toggle(node,name,value){value=!!value;if(node.classList.contains(name)!==value){node.classList.toggle(name,value);return true;}return false;}
  function hidden(node,value){value=!!value;if(node.hidden!==value){node.hidden=value;return true;}return false;}
  function disabled(node,value){value=!!value;if(node.disabled!==value){node.disabled=value;return true;}return false;}
  function visible(actor,x,y,width,height,pad){return actor.x>=x-pad&&actor.x<=x+width+pad&&actor.y>=y-pad&&actor.y<=y+height+pad;}
  var api={text:text,html:html,attr:attr,style:style,toggle:toggle,hidden:hidden,disabled:disabled,visible:visible};
  if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsPerformance=api;
})(typeof window==='object'?window:globalThis);
