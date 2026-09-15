/**
 * Pointer input for a placement canvas and an optional, stable palette root.
 * Call refresh() when edit permission or the active placement tool changes.
 * Palette drag handles need `touch-action: none` in CSS before a touch starts;
 * the surrounding palette keeps its normal page-scrolling behavior.
 *
 * onPreview(cellId, item, {clientX, clientY}) receives an empty cellId outside
 * the map or when clearing a preview. onDragState receives the same coordinates
 * plus {dragging, item, cellId, pointerType, cancelled}. Callbacks own all game
 * state and must validate placement rules in onDrop/onCellClick themselves.
 * onCellClick(cellId, point) also supports sprites above a grid cell: a hit
 * returned by getCanvasItem('', point) can be selected there, but not dropped.
 */
export function installPlacementInput({
  canvas, palette = null, viewport = null, pickCell, canEdit = () => true,
  isPlacementArmed = () => false, getCanvasItem, getPaletteItem,
  onSelect, onPreview, onDrop, onCellClick, onCancel, onDragState,
}) {
  if (!canvas?.addEventListener || typeof pickCell !== 'function') {
    throw new TypeError('Placement input requires a canvas and a cell picker.');
  }
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const originalTouchAction = canvas.style.getPropertyValue('touch-action');
  const originalTouchPriority = canvas.style.getPropertyPriority('touch-action');
  const listeners = [], pointers = new Set();
  let gesture = null, quarantine = false, disposed = false, manualTouch = false;
  let suppressedClick = null;
  const listen = (target, type, fn, options) => {
    if (!target) return;
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const point = event => ({ clientX: event.clientX, clientY: event.clientY });
  const editable = () => !disposed && !!canEdit();
  const contains = (root, target) => !!root && (target === root || root.contains(target));
  const prevent = event => { if (event.cancelable) event.preventDefault(); };
  const consumeClick = event => { prevent(event); event.stopImmediatePropagation(); };
  const onVisibleCanvas = event => {
    const { clientX: x, clientY: y } = event;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const r = canvas.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
    // A zoomed canvas can extend beyond its scrolling viewport. Hidden cells
    // outside that viewport are not drop targets, even inside the canvas rect.
    if (viewport) {
      const v = viewport.getBoundingClientRect();
      if (x < v.left || x >= v.right || y < v.top || y >= v.bottom) return false;
    }
    return true;
  };
  const atCell = event => {
    if (!onVisibleCanvas(event)) return '';
    const { clientX: x, clientY: y } = event;
    const id = pickCell(x, y);
    return typeof id === 'string' ? id : '';
  };
  const paletteItem = target => {
    if (!contains(palette, target)) return null;
    const item = getPaletteItem?.(target);
    return item && typeof item === 'object' ? { ...item } : null;
  };
  function releaseCapture(g) {
    try {
      if (g.source.hasPointerCapture?.(g.pointerId)) g.source.releasePointerCapture(g.pointerId);
    } catch (_) { /* The browser may have already released a cancelled pointer. */ }
  }
  function suppress(g) {
    suppressedClick = { source: g.source, pointerId: g.pointerId, until: Date.now() + 2000 };
  }
  function clearGesture(g, cancelled) {
    if (gesture !== g) return;
    gesture = null;
    suppress(g);
    releaseCapture(g);
    if (g.mode === 'drag' || g.mode === 'pan') onPreview?.('', g.item, point(g));
    if (g.mode === 'drag') onDragState?.({ dragging: false, item: g.item,
      cellId: g.cellId || '', pointerType: g.pointerType, cancelled, ...point(g) });
  }
  function cancel(reason = 'cancelled') {
    const g = gesture;
    if (!g) return false;
    clearGesture(g, true);
    if (pointers.size) quarantine = true;
    onCancel?.(g.item, reason);
    return true;
  }
  function refresh() {
    if (disposed) return;
    const edit = editable();
    // Crew can be dragged without first arming a tool. Empty-space touch
    // gestures then pan the map explicitly, rather than accidentally building.
    manualTouch = edit && (!!isPlacementArmed() || typeof getCanvasItem === 'function');
    if (manualTouch) canvas.style.setProperty('touch-action', 'none');
    else if (originalTouchAction) canvas.style.setProperty('touch-action', originalTouchAction, originalTouchPriority);
    else canvas.style.removeProperty('touch-action');
    if (gesture?.editable && !edit) cancel('locked');
  }
  function trackDown(event) {
    suppressedClick = null;
    pointers.add(event.pointerId);
    if (pointers.size > 1 || event.isPrimary === false) {
      quarantine = true;
      cancel('multiple-pointers');
    } else if (gesture && event.button !== 0) {
      quarantine = true;
      cancel('secondary-button');
    }
  }
  function begin(event, source) {
    if (disposed || quarantine || gesture || event.button !== 0 || event.isPrimary === false) return;
    refresh();
    const edit = editable(), fromCanvas = source === canvas, cellId = fromCanvas ? atCell(event) : '';
    let item = null;
    if (edit) item = fromCanvas ? getCanvasItem?.(cellId, point(event)) : paletteItem(event.target);
    if (!fromCanvas && !item) return;
    if (item && typeof item === 'object') item = { ...item };
    else item = null;
    const g = gesture = { source, fromCanvas, item, editable: edit,
      pointerId: event.pointerId, pointerType: event.pointerType || 'mouse',
      startX: event.clientX, startY: event.clientY, ...point(event), cellId,
      threshold: event.pointerType === 'touch' ? 10 : 6, mode: 'pending',
      panLeft: viewport?.scrollLeft || 0, panTop: viewport?.scrollTop || 0,
      manualTouch: fromCanvas && manualTouch };
    // Capture the stable root, never a palette child that selection can replace.
    try { source.setPointerCapture(event.pointerId); } catch (_) {}
    if (!pointers.has(g.pointerId)) pointers.add(g.pointerId);
  }
  function move(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId || quarantine) return;
    Object.assign(g, point(event));
    if (g.editable && !editable()) { cancel('locked'); return; }
    if (g.mode === 'pending' && Math.hypot(g.clientX - g.startX, g.clientY - g.startY) >= g.threshold) {
      if (g.item && editable()) {
        g.mode = 'drag';
        onSelect?.(g.item);
        if (gesture !== g) return;
        g.cellId = atCell(event);
        onDragState?.({ dragging: true, item: g.item, cellId: g.cellId,
          pointerType: g.pointerType, cancelled: false, ...point(g) });
        if (gesture !== g) return;
      } else if (g.pointerType === 'touch' && g.manualTouch && viewport) {
        g.mode = 'pan';
        onPreview?.('', null, point(g));
      } else g.mode = 'moved';
    }
    if (g.mode === 'drag') {
      prevent(event);
      g.cellId = atCell(event);
      onPreview?.(g.cellId, g.item, point(g));
    } else if (g.mode === 'pan') {
      prevent(event);
      viewport.scrollLeft = g.panLeft - (g.clientX - g.startX);
      viewport.scrollTop = g.panTop - (g.clientY - g.startY);
    } else if (g.mode === 'moved' && g.editable && g.pointerType !== 'touch') prevent(event);
  }
  function end(event) {
    // A secondary mouse button can finish while the primary button is held.
    if (event.pointerType === 'mouse' && event.button !== 0 && event.buttons) return;
    pointers.delete(event.pointerId);
    const g = gesture;
    if (quarantine) {
      if (suppressedClick) suppressedClick.until = Date.now() + 2000;
      if (!pointers.size) quarantine = false;
      return;
    }
    if (!g || event.pointerId !== g.pointerId) return;
    move(event); // A fast gesture may deliver its final movement only at release.
    if (gesture !== g) { if (!pointers.size) quarantine = false; return; }
    const cellId = atCell(event);
    if (g.mode === 'drag') {
      prevent(event);
      g.cellId = cellId;
      const valid = !!cellId && editable();
      clearGesture(g, !valid);
      if (valid && editable()) onDrop?.(g.item, cellId);
      else onCancel?.(g.item, cellId ? 'locked' : 'outside');
    } else if (g.mode === 'pending') {
      clearGesture(g, false);
      if (g.fromCanvas && onVisibleCanvas(event) && (cellId || getCanvasItem?.(cellId, point(event)))) {
        if (g.item && editable()) onSelect?.(g.item);
        onCellClick?.(cellId, point(event));
      } else if (!g.fromCanvas && contains(palette, doc.elementFromPoint?.(event.clientX, event.clientY))) {
        if (editable()) onSelect?.(g.item);
        else onCancel?.(g.item, 'locked');
      } else onCancel?.(g.item, 'outside');
    } else clearGesture(g, false); // Pan or unarmed movement is never a click.
  }
  function pointerCancel(event) {
    pointers.delete(event.pointerId);
    if (gesture?.pointerId === event.pointerId) cancel('pointer-cancel');
    if (!pointers.size) quarantine = false;
  }
  function lostCapture(event) {
    if (gesture?.pointerId === event.pointerId) cancel('lost-capture');
  }
  function click(event) {
    if (event.detail !== 0 && (event.target === canvas ||
      (suppressedClick && Date.now() <= suppressedClick.until &&
        (contains(suppressedClick.source, event.target) || contains(canvas, event.target) ||
          event.pointerId === suppressedClick.pointerId)))) {
      consumeClick(event);
      suppressedClick = null;
      return;
    }
    // Preserve keyboard and assistive-technology activation of palette items.
    if (event.detail === 0) {
      const item = paletteItem(event.target);
      if (item && editable()) { consumeClick(event); onSelect?.(item); }
    }
  }
  function cancelAll(reason) {
    cancel(reason);
    pointers.clear();
    quarantine = false;
  }
  listen(doc, 'pointerdown', trackDown, true);
  listen(canvas, 'pointerdown', event => begin(event, canvas));
  if (palette && palette !== canvas) listen(palette, 'pointerdown', event => begin(event, palette));
  listen(doc, 'pointermove', move, { capture: true, passive: false });
  listen(doc, 'pointerup', end, { capture: true, passive: false });
  listen(doc, 'pointercancel', pointerCancel, true);
  listen(canvas, 'lostpointercapture', lostCapture);
  if (palette && palette !== canvas) listen(palette, 'lostpointercapture', lostCapture);
  listen(doc, 'click', click, true);
  listen(doc, 'keydown', event => { if (event.key === 'Escape' && gesture) { prevent(event); cancel('escape'); } }, true);
  listen(win, 'blur', () => cancelAll('blur'));
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancelAll('hidden'); });
  // Native image dragging must not compete with a captured placement gesture.
  listen(doc, 'dragstart', event => { if (gesture || event.target === canvas || paletteItem(event.target)) prevent(event); }, true);
  refresh();
  return {
    cancel, refresh,
    get dragging() { return gesture?.mode === 'drag'; },
    destroy() {
      if (disposed) return;
      cancelAll('destroyed');
      disposed = true;
      for (const remove of listeners) remove();
      if (originalTouchAction) canvas.style.setProperty('touch-action', originalTouchAction, originalTouchPriority);
      else canvas.style.removeProperty('touch-action');
      suppressedClick = null;
    },
  };
}
