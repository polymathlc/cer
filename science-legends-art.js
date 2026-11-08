/* Generated spell art is optional: the game keeps its vector renderer as fallback. */
(function (root) {
  'use strict';
  var atlas = new Image();
  atlas.src = 'assets/science-legends/arcane-atlas.webp';
  var ground = new Image(), groundPatterns = new WeakMap();
  ground.src = 'assets/science-legends/courtyard-slate.webp';
  function ready() { return atlas.complete && atlas.naturalWidth > 0 && atlas.naturalHeight > 0; }
  function groundReady() { return ground.complete && ground.naturalWidth > 0; }
  function cell(ctx, index, size, xAnchor) {
    var w = atlas.naturalWidth / 4, h = atlas.naturalHeight / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(atlas, index % 4 * w, Math.floor(index / 4) * h, w, h,
      -size * xAnchor, -size / 2, size, size);
  }
  function impactCell(color) {
    var match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color || '');
    if (!match) return 6;
    var r = parseInt(match[1], 16), g = parseInt(match[2], 16), b = parseInt(match[3], 16);
    if (b > r + 20 && g > r) return 5;
    if (b > g + 20) return 7;
    if (r > g + 35) return 4;
    return 6;
  }
  root.LegendsArt = {
    ready: ready,
    groundReady: groundReady,
    drawGround: function (ctx, x, y, width, height) {
      if (!groundReady()) return false;
      var pattern = groundPatterns.get(ctx);
      if (!pattern) {
        var tile = document.createElement('canvas'); tile.width = tile.height = 512;
        tile.getContext('2d').drawImage(ground, 0, 0, 512, 512);
        pattern = ctx.createPattern(tile, 'repeat');
        if (!pattern) return false;
        groundPatterns.set(ctx, pattern);
      }
      ctx.save(); ctx.fillStyle = pattern;
      ctx.fillRect(x - 260, y - 260, width + 520, height + 520); ctx.restore();
      return true;
    },
    drawProjectile: function (ctx, pr, style) {
      if (!ready()) return false;
      var index, size, anchor = .82;
      if (style === 'fireorb' || style === 'flameglob' || style === 'ember') {
        index = 0; size = style === 'fireorb' ? 66 : 38;
      } else if (style === 'shard' || style === 'magebolt') {
        index = 1; size = style === 'shard' ? 62 : 38; anchor = .9;
      } else if ((style === 'javelin' && pr.sid === 'plague') || style === 'venomdart') {
        index = 3; size = style === 'javelin' ? 68 : 44; anchor = .89;
      } else return false;
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(Math.atan2(pr.vy, pr.vx));
      cell(ctx, index, size, anchor); ctx.restore();
      return true;
    },
    drawImpact: function (ctx, impact, progress) {
      if (!ready()) return false;
      var size = impact.r * (1.2 + progress * 1.5);
      ctx.save(); ctx.translate(impact.x, impact.y); ctx.rotate(impact.ang * .2);
      ctx.globalAlpha = Math.pow(1 - progress, 1.4) * (impact.strong ? .95 : .72);
      cell(ctx, impactCell(impact.color), size, .5); ctx.restore();
      return true;
    },
    drawHammer: function (ctx, hammer, time) {
      if (!ready()) return false;
      ctx.save(); ctx.translate(hammer.x, hammer.y); ctx.rotate(time * 8);
      cell(ctx, 2, 48, .5); ctx.restore();
      return true;
    }
  };
})(window);
