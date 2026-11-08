/* Unpack globally separate silhouettes without cutting them at nominal grid lines.
 * The source pixels stay unchanged. Only prepared runtime textures are isolated. */
(function (root) {
  'use strict';
  function integer(value, fallback, low, high) {
    value = Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.max(low, Math.min(high, value));
  }
  function extract(pixels, width, height, columns, rows, options) {
    rows = rows == null ? 4 : rows; options = options || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > width || rows > height ||
        width * height > 16777216 || !pixels || pixels.length < width * height * 4) {
      throw new RangeError('Invalid actor atlas dimensions or pixel buffer');
    }
    var threshold = integer(options.threshold, 64, 1, 255);
    var minPixels = integer(options.minPixels, 500, 1, width * height);
    var padding = integer(options.padding, 2, 0, 8);
    var nominalWidth = width / columns, nominalHeight = height / rows;
    var labels = new Int32Array(width * height), queue = new Int32Array(width * height);
    var selected = Array.from({ length: columns }, function () { return Array(rows).fill(null); });
    var components = [], nextLabel = 0;
    for (var start = 0; start < labels.length; start++) {
      if (labels[start] || pixels[start * 4 + 3] < threshold) continue;
      var label = ++nextLabel, head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0, sumX = 0, sumY = 0;
      queue[0] = start; labels[start] = label;
      while (head < tail) {
        var position = queue[head++], x = position % width, y = Math.floor(position / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        sumX += x; sumY += y;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          var next = yy * width + xx;
          if (!labels[next] && pixels[next * 4 + 3] >= threshold) {
            labels[next] = label; queue[tail++] = next;
          }
        }
      }
      if (tail < minPixels) continue;
      var cx = sumX / tail, cy = sumY / tail;
      var column = Math.max(0, Math.min(columns - 1, Math.floor(cx / nominalWidth)));
      var row = Math.max(0, Math.min(rows - 1, Math.floor(cy / nominalHeight)));
      var component = { label: label, pixels: tail, x: left, y: top, w: right - left + 1, h: bottom - top + 1,
        centroidX: cx, centroidY: cy, column: column, row: row };
      components.push(component);
      if (!selected[column][row] || selected[column][row].pixels < tail) selected[column][row] = component;
    }
    var frames = Array.from({ length: columns }, function () { return Array(rows).fill(null); });
    var missing = [];
    for (var columnIndex = 0; columnIndex < columns; columnIndex++) for (var rowIndex = 0; rowIndex < rows; rowIndex++) {
      var core = selected[columnIndex][rowIndex];
      if (!core) { missing.push({ column: columnIndex, row: rowIndex }); continue; }
      var cropX = Math.max(0, core.x - padding), cropY = Math.max(0, core.y - padding);
      var cropRight = Math.min(width - 1, core.x + core.w - 1 + padding);
      var cropBottom = Math.min(height - 1, core.y + core.h - 1 + padding);
      var cropW = cropRight - cropX + 1, cropH = cropBottom - cropY + 1;
      var coverage = new Uint8Array(cropW * cropH), visiblePixels = 0;
      for (var localY = 0; localY < cropH; localY++) for (var localX = 0; localX < cropW; localX++) {
        var sourceX = cropX + localX, sourceY = cropY + localY, sourceIndex = sourceY * width + sourceX;
        if (labels[sourceIndex] === core.label) {
          coverage[localY * cropW + localX] = 255; visiblePixels++; continue;
        }
        // Foreign core pixels are always excluded, even where two rectangles overlap.
        if (labels[sourceIndex] || !pixels[sourceIndex * 4 + 3] || !padding) continue;
        var ownDistance = padding + 1, foreignDistance = padding + 1;
        for (var edgeY = -padding; edgeY <= padding; edgeY++) for (var edgeX = -padding; edgeX <= padding; edgeX++) {
          var nearX = sourceX + edgeX, nearY = sourceY + edgeY;
          if (nearX < 0 || nearY < 0 || nearX >= width || nearY >= height) continue;
          var nearLabel = labels[nearY * width + nearX];
          if (!nearLabel) continue;
          var distance = Math.max(Math.abs(edgeX), Math.abs(edgeY));
          if (nearLabel === core.label) ownDistance = Math.min(ownDistance, distance);
          else foreignDistance = Math.min(foreignDistance, distance);
        }
        if (ownDistance <= padding && ownDistance < foreignDistance) {
          coverage[localY * cropW + localX] = 255; visiblePixels++;
        }
      }
      var footY = core.y + core.h - 1, rowThreshold = Math.max(3, Math.floor(nominalWidth * .025));
      for (var scanY = footY; scanY >= core.y; scanY--) {
        var count = 0;
        for (var scanX = core.x; scanX < core.x + core.w; scanX++) if (labels[scanY * width + scanX] === core.label) count++;
        if (count >= rowThreshold) { footY = scanY; break; }
      }
      var weightedX = 0, weight = 0, bandTop = Math.max(core.y, footY - Math.floor(nominalHeight * .09));
      for (var anchorY = bandTop; anchorY <= footY; anchorY++) for (var anchorX = core.x; anchorX < core.x + core.w; anchorX++) {
        var anchorIndex = anchorY * width + anchorX;
        if (labels[anchorIndex] !== core.label) continue;
        var alpha = pixels[anchorIndex * 4 + 3]; weightedX += anchorX * alpha; weight += alpha;
      }
      var footX = weight ? weightedX / weight : core.centroidX;
      frames[columnIndex][rowIndex] = { x: cropX, y: cropY, w: cropW, h: cropH,
        nominalWidth: nominalWidth, nominalHeight: nominalHeight,
        anchor: { x: (footX - cropX) / cropW, y: (footY - cropY) / cropH }, footX: footX, footY: footY,
        pixels: core.pixels, visiblePixels: visiblePixels, coverage: coverage,
        core: { x: core.x, y: core.y, w: core.w, h: core.h } };
    }
    return { width: width, height: height, columns: columns, rows: rows,
      nominalWidth: nominalWidth, nominalHeight: nominalHeight, frames: frames, missing: missing, components: components };
  }
  function cropPixels(source, width, height, frame) {
    if (!frame || !source || source.length < width * height * 4 || frame.x < 0 || frame.y < 0 ||
        frame.x + frame.w > width || frame.y + frame.h > height || frame.coverage.length !== frame.w * frame.h) {
      throw new RangeError('Invalid actor frame bounds or coverage');
    }
    var result = new Uint8ClampedArray(frame.w * frame.h * 4);
    for (var y = 0; y < frame.h; y++) for (var x = 0; x < frame.w; x++) {
      var target = (y * frame.w + x) * 4;
      if (!frame.coverage[y * frame.w + x]) continue;
      var start = ((frame.y + y) * width + frame.x + x) * 4;
      result[target] = source[start]; result[target + 1] = source[start + 1];
      result[target + 2] = source[start + 2]; result[target + 3] = source[start + 3];
    }
    return result;
  }
  var api = { extract: extract, cropPixels: cropPixels };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegendsAtlas = api;
})(typeof window === 'object' ? window : globalThis);
