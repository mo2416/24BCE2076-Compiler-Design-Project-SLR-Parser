/*
 * spoiler.js — a short answer hidden under drifting specks until it is clicked.
 * Plain-JS port of the kokonutui "Spoiler Text" template (templates/spoiler-text.tsx),
 * cut down to single-line answers such as a table cell.
 *
 *   <span class="spoil" role="button" tabindex="0"><span class="spoil-t">s4</span></span>
 *   Spoiler.scan(rootEl, onReveal)   wires every closed .spoil inside rootEl;
 *                                    onReveal(el) runs once when one is opened.
 *
 * One animation loop serves every spoiler on the page and stops when none is left,
 * so a table with many hidden cells stays cheap.
 */
(function (root) {
  'use strict';

  var DENSITY = 1 / 6;   // specks per square pixel, like the grain on a scratch card
  var MAX_SPECKS = 600;
  var DRIFT = 7;         // px per second while shimmering in place
  var WAVE_MS = 520;     // the reveal wave crosses the spoiler in this long
  var FADE_MS = 360;     // a speck fades over this long once the wave passes it
  var THROW = 70;

  var live = [], frame = 0, last = 0;
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeSpecks(w, h) {
    var n = Math.min(MAX_SPECKS, Math.round(w * h * DENSITY)), out = [];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = DRIFT * (0.3 + Math.random() * 0.7);
      out.push({ x: Math.random() * w, y: Math.random() * h, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        phase: Math.random(), rate: 0.35 + Math.random() * 0.9, size: Math.random() < 0.18 ? 1.5 : 1, hit: 0 });
    }
    return out;
  }

  function layout(sp) {
    var w = sp.el.offsetWidth, h = sp.el.offsetHeight, dpr = Math.min(root.devicePixelRatio || 1, 2);
    sp.w = w; sp.h = h;
    sp.c.width = Math.round(w * dpr); sp.c.height = Math.round(h * dpr);
    sp.c.style.width = w + 'px'; sp.c.style.height = h + 'px';
    sp.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sp.specks = makeSpecks(w, h);
  }

  /* Moves one speck a frame on; returns its opacity, 0 once it has faded. */
  function step(s, sp, now, dt, radius) {
    var wave = sp.wave;
    if (wave && !s.hit && Math.hypot(s.x - wave.x, s.y - wave.y) <= radius) {
      s.hit = now;
      var dx = s.x - wave.x, dy = s.y - wave.y, len = Math.hypot(dx, dy) || 1, push = THROW * (0.5 + Math.random());
      s.vx += dx / len * push; s.vy += dy / len * push;
    }
    var fade = s.hit ? 1 - (now - s.hit) / FADE_MS : 1;
    if (fade <= 0) return 0;
    if (!reduced || s.hit) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.phase = (s.phase + s.rate * dt) % 1;
    }
    if (!s.hit) { /* until hit, a speck bounces around inside the patch */
      if (s.x < 0 || s.x > sp.w) { s.vx = -s.vx; s.x = Math.min(sp.w, Math.max(0, s.x)); }
      if (s.y < 0 || s.y > sp.h) { s.vy = -s.vy; s.y = Math.min(sp.h, Math.max(0, s.y)); }
    }
    return (0.35 + 0.65 * Math.abs(Math.sin(s.phase * Math.PI))) * fade * 0.9;
  }

  function tick(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    live = live.filter(function (sp) { return sp.el.isConnected && !sp.done; });
    live.forEach(function (sp) {
      var ctx = sp.ctx, alive = 0, radius = -1;
      ctx.clearRect(0, 0, sp.w, sp.h);
      ctx.fillStyle = getComputedStyle(sp.el).color;
      if (sp.wave) {
        var t = Math.min(1, (now - sp.wave.start) / WAVE_MS), x = sp.wave.x, y = sp.wave.y;
        radius = Math.max(Math.hypot(x, y), Math.hypot(sp.w - x, y), Math.hypot(x, sp.h - y), Math.hypot(sp.w - x, sp.h - y)) * (1 - Math.pow(1 - t, 3));
      }
      sp.specks.forEach(function (s) {
        var alpha = step(s, sp, now, dt, radius);
        if (alpha > 0) { alive++; ctx.globalAlpha = alpha; ctx.fillRect(s.x, s.y, s.size, s.size); }
      });
      ctx.globalAlpha = 1;
      if (sp.wave && !alive) { sp.done = true; sp.c.remove(); }
    });
    if (live.some(function (sp) { return !reduced || sp.wave; })) frame = requestAnimationFrame(tick);
    else frame = 0;
  }

  function start() { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } }

  function reveal(sp, clientX, clientY) {
    if (sp.wave) return;
    var r = sp.el.getBoundingClientRect();
    /* A keyboard reveal starts from the left edge. */
    sp.wave = { x: clientX == null ? 4 : clientX - r.left, y: clientY == null ? r.height / 2 : clientY - r.top, start: performance.now() };
    sp.el.classList.add('open');
    ['role', 'tabindex', 'aria-label'].forEach(function (a) { sp.el.removeAttribute(a); });
    var t = sp.el.querySelector('.spoil-t'); if (t) t.removeAttribute('aria-hidden');
    if (sp.onReveal) sp.onReveal(sp.el);
    start();
  }

  function setup(el, onReveal) {
    if (el._spoil) return;
    var c = document.createElement('canvas');
    c.className = 'spoil-c';
    c.setAttribute('aria-hidden', 'true');
    el.appendChild(c);
    var sp = { el: el, c: c, ctx: c.getContext('2d'), wave: null, onReveal: onReveal };
    el._spoil = sp;
    layout(sp);
    live.push(sp);
    el.addEventListener('click', function (e) { if (e.detail) reveal(sp, e.clientX, e.clientY); else reveal(sp); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(sp); } });
  }

  function scan(rootEl, onReveal) {
    Array.prototype.forEach.call(rootEl.querySelectorAll('.spoil:not(.open)'), function (el) { setup(el, onReveal); });
    if (live.length) start();
  }

  root.Spoiler = { scan: scan };
})(this);
