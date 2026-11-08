/* Small deterministic combat primitives shared by the renderer and regression tests. */
(function (root) {
  'use strict';
  var STEP = 1 / 120, MAX_STEPS = 12;
  function sweepCircle(ax, ay, bx, by, cx, cy, radius) {
    var dx = bx - ax, dy = by - ay, ox = ax - cx, oy = ay - cy;
    var c = ox * ox + oy * oy - radius * radius;
    if (c <= 0) return 0;
    var a = dx * dx + dy * dy;
    if (a < 1e-12) return null;
    var b = ox * dx + oy * dy, disc = b * b - a * c;
    if (disc < 0) return null;
    var t = (-b - Math.sqrt(disc)) / a;
    return t >= 0 && t <= 1 ? t : null;
  }
  function sweepHits(projectile, x, y, enemies) {
    var hits = [];
    for (var i = 0; i < enemies.length; i++) {
      var enemy = enemies[i];
      if (enemy.dead || enemy.hp <= 0 || (projectile.hitTargets && projectile.hitTargets.has(enemy))) continue;
      var t = sweepCircle(projectile.x, projectile.y, x, y, enemy.x, enemy.y, projectile.r + enemy.r);
      if (t !== null) hits.push({ enemy: enemy, t: t });
    }
    hits.sort(function (a, b) { return a.t - b.t; });
    return hits;
  }
  function knockback(actor, dt, drag) {
    var elapsed = Math.min(dt, Math.max(0, actor.kt || 0));
    if (!elapsed) return;
    drag = drag || 7;
    var decay = Math.exp(-drag * elapsed), distance = (1 - decay) / drag;
    actor.x += (actor.kx || 0) * distance;
    actor.y += (actor.ky || 0) * distance;
    actor.kx *= decay; actor.ky *= decay;
    actor.kt = Math.max(0, actor.kt - elapsed);
  }
  function advance(clock, elapsed, active, update) {
    if (!active) { clock.accumulator = 0; clock.hitStop = 0; return 0; }
    elapsed = Math.max(0, Math.min(.1, Number.isFinite(elapsed) ? elapsed : 0));
    var stop = Math.min(elapsed, Math.max(0, clock.hitStop || 0));
    clock.hitStop = Math.max(0, (clock.hitStop || 0) - stop);
    clock.accumulator = Math.min(.1, (clock.accumulator || 0) + elapsed - stop);
    var steps = 0;
    while (clock.accumulator + 1e-10 >= STEP && steps < MAX_STEPS) {
      clock.accumulator -= STEP; steps++;
      if (update(STEP) === false || clock.hitStop > 0) { clock.accumulator = 0; break; }
    }
    return steps;
  }
  var api = { step: STEP, sweepCircle: sweepCircle, sweepHits: sweepHits, knockback: knockback, advance: advance };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LegendsCombat = api;
})(typeof window === 'object' ? window : globalThis);
