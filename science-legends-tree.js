/* Spatial browsing follows the visible skill graph, without allocating points. */
(function(root){
  'use strict';
  function order(nodes){return nodes.slice().sort(function(a,b){return a.row-b.row||a.col-b.col||a.id.localeCompare(b.id);});}
  function next(nodes,id,key){
    var sorted=order(nodes),from=nodes.find(function(node){return node.id===id;});if(!sorted.length)return null;
    if(key==='Home'||!from)return sorted[0].id;if(key==='End')return sorted[sorted.length-1].id;
    var direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[key];if(!direction)return id;
    var best=null,score=Infinity;nodes.forEach(function(node){var dx=node.col-from.col,dy=node.row-from.row,forward=dx*direction[0]+dy*direction[1],side=Math.abs(dx*direction[1]-dy*direction[0]);if(forward<=0)return;var value=forward+side*4+Math.hypot(dx,dy)*.01;if(value<score||(value===score&&node.id<(best||''))){score=value;best=node.id;}});return best||id;
  }
  var api={order:order,next:next};if(typeof module==='object'&&module.exports)module.exports=api;root.LegendsTree=api;
})(typeof window==='object'?window:globalThis);
