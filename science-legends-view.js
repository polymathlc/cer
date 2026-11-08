/* One orthographic view for rendering and input. Combat never changes its angle or zoom. */
(function (root) {
  'use strict';
  function axis(position, viewport, extent) {
    if (viewport >= extent) return (extent - viewport) / 2;
    return Math.max(0, Math.min(extent - viewport, position - viewport / 2));
  }
  function create(x, y, width, height, worldWidth, worldHeight) {
    return { x: axis(x, width, worldWidth), y: axis(y, height, worldHeight),
      width: width, height: height, scale: 1, angle: 0, offsetX: 0, offsetY: 0 };
  }
  function screenToWorld(view, x, y) { return { x: x + view.x - view.offsetX, y: y + view.y - view.offsetY }; }
  function worldToScreen(view, x, y) { return { x: x - view.x + view.offsetX, y: y - view.y + view.offsetY }; }
  var api = { create: create, screenToWorld: screenToWorld, worldToScreen: worldToScreen };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegendsView = api;
})(typeof window === 'object' ? window : globalThis);
