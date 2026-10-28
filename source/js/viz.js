/*
 * viz.js — D3/SVG drawings: the LR(0) automaton, the parse tree, and the
 * parser's stack and input tape.
 *
 * Colours and fonts are written onto the SVG elements as attributes (read from
 * the CSS custom properties at draw time) so that an exported PNG looks the
 * same as the screen without needing the stylesheet.
 */
(function (root) {
  'use strict';

  var MOTION = !(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function dur(ms) { return MOTION ? ms : 0; }

  function palette() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    return {
      paper: v('--paper'), sheet: v('--sheet'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
      rule: v('--rule'), rule2: v('--rule-2'), blue: v('--blue'), blueWash: v('--blue-wash'),
      red: v('--red'), redWash: v('--red-wash'), green: v('--green'), greenWash: v('--green-wash'),
      mark: v('--mark'), markWash: v('--mark-wash'), mono: v('--font-mono'), sans: v('--font-sans'), serif: v('--font-serif'),
      radius: parseFloat(v('--viz-radius')) || 3, stroke: parseFloat(v('--viz-stroke')) || 1,
      chalk: v('--viz-chalk') === '1', advance: setAdvance(parseFloat(v('--mono-advance')) || 0.6)
    };
  }

  /* Each template sets --mono-advance to its monospace font's character width (in em). */
  var ADV = 0.6;
  function setAdvance(a) { ADV = a; return a; }

  function hasD3() { return typeof root.d3 !== 'undefined'; }

  function noD3(svgEl) {
    svgEl.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';
    var t = document.createElementNS(ns, 'text');
    t.setAttribute('x', 20); t.setAttribute('y', 40);
    t.setAttribute('fill', 'currentColor');
    t.textContent = 'The diagram needs D3.js, which could not be loaded. Check the internet connection, or place d3.min.js in js/vendor/.';
    svgEl.appendChild(t);
  }

  /* Width of a monospace string at a given font size (Plex Mono advance ≈ 0.6em). */
  function monoWidth(str, size) { return Array.from(str).length * size * ADV; }

  /* ================================================================== */
  /* LR(0) automaton                                                     */
  /* ================================================================== */

  var ITEM_FS = 12.5, LINE_H = 18, HEAD_H = 24, PAD_X = 10, COL_GAP = 110, ROW_GAP = 34;
  var STUB_FS = 11.5, STUB_H = 20, STUB_GAP = 5;

  /*
   * Place states in columns by BFS depth from I0, rows in discovery order.
   * Unless allArrows is set, a transition to a state in the same or an earlier
   * column is drawn as a labelled stub under its source ("( → I4"), the way
   * textbooks keep the diagram readable; only forward transitions get arrows.
   */
  function layoutAutomaton(an, allArrows) {
    var g = an.grammar, states = an.lr0.states;
    var depth = {}; depth[0] = 0;
    var queue = [0];
    while (queue.length) {
      var s = queue.shift();
      states[s].transitions.forEach(function (t) {
        if (depth[t.to] === undefined) { depth[t.to] = depth[s] + 1; queue.push(t.to); }
      });
    }
    var boxes = states.map(function (I) {
      var lines = I.items.map(function (it) { return root.SLR.itemStr(g, it); });
      var w = Math.max(70, Math.max.apply(null, lines.map(function (l) { return monoWidth(l, ITEM_FS); })) + PAD_X * 2);
      /* Leave room for the title and the ACCEPT / REDUCE badge side by side. */
      var badged = I.items.some(function (it) { return it.d === g.productions[it.p].rhs.length; });
      if (badged) w = Math.max(w, 112);
      var b = { id: I.id, col: depth[I.id] || 0, w: w, h: HEAD_H + lines.length * LINE_H + 8, lines: lines, items: I.items, stubs: [] };
      if (!allArrows) {
        var byTarget = {};
        I.transitions.forEach(function (t) {
          if (t.to === I.id || depth[t.to] > depth[I.id]) return;
          if (!byTarget[t.to]) { byTarget[t.to] = { from: I.id, to: t.to, syms: [] }; b.stubs.push(byTarget[t.to]); }
          byTarget[t.to].syms.push(t.sym);
        });
      }
      /* Lay the stub tags out in rows under the box. */
      var x = 0, row = 0, maxW = Math.max(w, 170);
      b.stubs.forEach(function (st) {
        st.text = st.syms.join(', ') + ' → I' + st.to;
        st.w = monoWidth(st.text, STUB_FS) + 14;
        if (x > 0 && x + st.w > maxW) { x = 0; row++; }
        st.x = x; st.y = row * (STUB_H + STUB_GAP);
        x += st.w + STUB_GAP;
      });
      b.stubH = b.stubs.length ? (row + 1) * (STUB_H + STUB_GAP) + 8 : 0;
      return b;
    });
    var cols = [];
    boxes.forEach(function (b) { (cols[b.col] = cols[b.col] || []).push(b); });
    var x = 0, colHeights = [];
    cols.forEach(function (col, ci) {
      var cw = Math.max.apply(null, col.map(function (b) { return Math.max(b.w, b.stubs.length ? 170 : 0); }));
      var y = 0;
      col.forEach(function (b) { b.x = x; b.y = y; y += b.h + b.stubH + ROW_GAP; });
      colHeights[ci] = y - ROW_GAP;
      x += cw + COL_GAP;
    });
    var tallest = Math.max.apply(null, colHeights);
    cols.forEach(function (col, ci) {
      var off = (tallest - colHeights[ci]) / 2;
      col.forEach(function (b) { b.y += off; });
    });
    return boxes;
  }

  /* Arrowed edges, grouped by (from, to) so two symbols to one state share an arrow. */
  function automatonEdges(an, boxes, allArrows) {
    var map = {}, list = [], col = {};
    boxes.forEach(function (b) { col[b.id] = b.col; });
    an.lr0.states.forEach(function (I) {
      I.transitions.forEach(function (t) {
        var kind = t.to === I.id ? 'self' : col[t.to] > col[I.id] ? 'fwd' : 'back';
        if (kind === 'back' && !allArrows) return;
        var k = I.id + '>' + t.to;
        if (!map[k]) { map[k] = { from: I.id, to: t.to, syms: [], kind: kind }; list.push(map[k]); }
        map[k].syms.push(t.sym);
      });
    });
    return list;
  }

  /* Spread arrow ends along box sides, ordered by the other end's height, to limit crossings. */
  function assignPorts(edges, byId) {
    var outs = {}, ins = {};
    edges.forEach(function (e) {
      if (e.kind !== 'fwd') return;
      (outs[e.from] = outs[e.from] || []).push(e);
      (ins[e.to] = ins[e.to] || []).push(e);
    });
    Object.keys(outs).forEach(function (k) {
      var list = outs[k].sort(function (p, q) { return byId[p.to].y - byId[q.to].y; });
      var a = byId[k], room = a.h - HEAD_H - 10, step = Math.min(18, room / Math.max(1, list.length));
      list.forEach(function (e, i) { e.sy = a.y + HEAD_H + 6 + step * (i + 0.5); });
    });
    Object.keys(ins).forEach(function (k) {
      var list = ins[k].sort(function (p, q) { return byId[p.from].y - byId[q.from].y; });
      var b = byId[k], room = Math.min(b.h - 8, 22 + list.length * 12), step = room / Math.max(1, list.length);
      list.forEach(function (e, i) { e.ty = b.y + 6 + step * (i + 0.5); });
    });
  }

  function edgePath(e, a, b) {
    if (e.kind === 'self') {
      var x0 = a.x + a.w - 24, y0 = a.y;
      return 'M' + x0 + ',' + y0 + ' C' + (x0 - 8) + ',' + (y0 - 40) + ' ' + (x0 + 36) + ',' + (y0 - 40) + ' ' + (x0 + 16) + ',' + (y0 - 1);
    }
    if (e.kind === 'fwd') {
      var sx = a.x + a.w, sy = e.sy, tx = b.x - 2, ty = e.ty;
      var mx = sx + (tx - sx) * 0.5;
      return 'M' + sx + ',' + sy + ' C' + mx + ',' + sy + ' ' + mx + ',' + ty + ' ' + tx + ',' + ty;
    }
    /* Backward or same-column edge (only with "all arrows"): arc over the top. */
    var ax = a.x + a.w / 2, ay = a.y;
    var bx = b.x + b.w / 2 + 10, by = b.y - 2;
    var lift = Math.min(ay, by) - 46 - Math.abs(ax - bx) * 0.08;
    return 'M' + ax + ',' + ay + ' C' + ax + ',' + lift + ' ' + bx + ',' + lift + ' ' + bx + ',' + by;
  }

  /*
   * Automaton(svgEl, handlers) — a reusable drawing.
   *   .setData(an)      new grammar: lay out from scratch
   *   .update(view)     view = { states:Set, edges:Set('from>to:sym'), current, selected, currentEdge, conflictStates }
   *   .fit() .resetLayout() .setAllArrows(bool)
   */
  function Automaton(svgEl, handlers) {
    this.svgEl = svgEl;
    this.handlers = handlers || {};
    this.boxes = [];
    this.view = null;
    this.allArrows = false;
    svgEl.__automaton = this; /* lets the console inspect the camera */
  }

  Automaton.prototype.setAllArrows = function (on) { this.allArrows = !!on; this.resetLayout(); };

  Automaton.prototype.setData = function (an) {
    this.an = an;
    if (!hasD3()) { noD3(this.svgEl); return; }
    var d3 = root.d3, self = this, C = palette();
    this.C = C;
    this.userMoved = false;
    this.lastFrame = '';
    this.boxes = layoutAutomaton(an, this.allArrows);
    this.edges = automatonEdges(an, this.boxes, this.allArrows);
    var svg = d3.select(this.svgEl);
    svg.selectAll('*').remove();
    svg.attr('font-family', C.mono);

    var defs = svg.append('defs');
    [['arrow', C.ink2], ['arrow-blue', C.blue], ['arrow-hot', C.mark]].forEach(function (mk) {
      defs.append('marker').attr('id', mk[0] + '-' + self.svgEl.id).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
        .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('fill', mk[1]);
    });

    if (C.chalk) chalkFilter(defs, 'chalk-' + self.svgEl.id);

    this.zoomLayer = svg.append('g').attr('class', 'zoom-layer');
    var inner = this.zoomLayer.append('g');
    if (C.chalk) inner.attr('filter', 'url(#chalk-' + self.svgEl.id + ')');
    this.edgeLayer = inner.append('g').attr('class', 'edges');
    this.nodeLayer = inner.append('g').attr('class', 'nodes');

    /* Plain wheel scrolls the page; Ctrl+wheel or the buttons zoom; dragging the background pans. */
    this.zoom = d3.zoom().scaleExtent([0.3, 2.5])
      .filter(function (ev) { return ev.type === 'wheel' ? ev.ctrlKey : !ev.button; })
      .on('zoom', function (ev) { self.zoomLayer.attr('transform', ev.transform); if (ev.sourceEvent) self.userMoved = true; });
    svg.call(this.zoom).on('dblclick.zoom', null);

    this.drawNodes();
    this.drawEdges();
  };

  /* A rough, slightly broken stroke, like chalk on a board (feTurbulence + displacement). */
  function chalkFilter(defs, id) {
    var f = defs.append('filter').attr('id', id).attr('x', '-5%').attr('y', '-5%').attr('width', '110%').attr('height', '110%');
    f.append('feTurbulence').attr('type', 'fractalNoise').attr('baseFrequency', 0.9).attr('numOctaves', 2).attr('result', 'noise');
    f.append('feDisplacementMap').attr('in', 'SourceGraphic').attr('in2', 'noise').attr('scale', 1.6).attr('result', 'rough');
    f.append('feComponentTransfer').attr('in', 'noise').attr('result', 'grain')
      .append('feFuncA').attr('type', 'discrete').attr('tableValues', '0 1 1 1 1 1 1 1');
    f.append('feComposite').attr('in', 'rough').attr('in2', 'grain').attr('operator', 'in');
  }

  Automaton.prototype.drawNodes = function () {
    var d3 = root.d3, self = this, C = this.C, g = this.an.grammar;
    var nodes = this.nodeLayer.selectAll('g.state').data(this.boxes, function (b) { return b.id; })
      .join('g').attr('class', 'state').attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', function (b) { return 'State I' + b.id; })
      .attr('transform', function (b) { return 'translate(' + b.x + ',' + b.y + ')'; })
      .style('cursor', 'pointer')
      .on('click', function (ev, b) { if (self.handlers.onSelect) self.handlers.onSelect(b.id); })
      .on('keydown', function (ev, b) { if ((ev.key === 'Enter' || ev.key === ' ') && self.handlers.onSelect) { ev.preventDefault(); self.handlers.onSelect(b.id); } });

    nodes.append('rect').attr('class', 'box').attr('width', function (b) { return b.w; }).attr('height', function (b) { return b.h; })
      .attr('rx', C.radius).attr('fill', C.sheet).attr('stroke', C.ink2).attr('stroke-width', C.stroke);
    nodes.append('rect').attr('class', 'head').attr('width', function (b) { return b.w; }).attr('height', HEAD_H)
      .attr('rx', C.radius).attr('fill', C.paper).attr('stroke', 'none');
    nodes.append('line').attr('x1', 0).attr('x2', function (b) { return b.w; }).attr('y1', HEAD_H).attr('y2', HEAD_H)
      .attr('stroke', C.rule).attr('stroke-width', 1);
    nodes.append('text').attr('class', 'title').attr('x', PAD_X).attr('y', 16)
      .attr('font-family', C.serif).attr('font-size', 14).attr('font-weight', 600).attr('fill', C.ink)
      .text(function (b) { return 'I' + b.id; });
    nodes.append('text').attr('class', 'badge').attr('x', function (b) { return b.w - PAD_X; }).attr('y', 16)
      .attr('text-anchor', 'end').attr('font-family', C.sans).attr('font-size', 10.5).attr('letter-spacing', 0.4).attr('fill', C.ink3)
      .text(function (b) {
        var acc = b.items.some(function (it) { return it.p === 0 && it.d === 1; });
        var red = b.items.some(function (it) { return it.p !== 0 && it.d === g.productions[it.p].rhs.length; });
        return acc ? 'ACCEPT' : red ? 'REDUCE' : '';
      });

    nodes.each(function (b) {
      var n = d3.select(this);
      var firstClosure = b.items.findIndex(function (it) { return !it.kernel; });
      if (firstClosure > 0) {
        var yy = HEAD_H + firstClosure * LINE_H + 5;
        n.append('line').attr('x1', PAD_X).attr('x2', b.w - PAD_X).attr('y1', yy).attr('y2', yy)
          .attr('stroke', C.rule).attr('stroke-dasharray', '2 3');
      }
      n.selectAll('text.item').data(b.items.map(function (it, i) { return { it: it, i: i, text: b.lines[i] }; }))
        .join('text').attr('class', 'item').attr('x', PAD_X).attr('y', function (d) { return HEAD_H + 14 + d.i * LINE_H; })
        .attr('font-size', ITEM_FS).attr('fill', function (d) { return d.it.kernel ? C.ink : C.ink2; })
        .text(function (d) { return d.text; });
    });

    nodes.each(function (b) {
      if (!b.stubs.length) return;
      var n = d3.select(this);
      var sg = n.append('g').attr('class', 'stubs').attr('transform', 'translate(0,' + (b.h + 7) + ')');
      sg.selectAll('g.stub').data(b.stubs).join(function (enter) {
        var e = enter.append('g').attr('class', 'stub').style('cursor', 'pointer')
          .attr('transform', function (st) { return 'translate(' + st.x + ',' + st.y + ')'; })
          .on('click', function (ev, st) { ev.stopPropagation(); if (self.handlers.onSelect) self.handlers.onSelect(st.to); });
        e.append('rect').attr('width', function (st) { return st.w; }).attr('height', STUB_H).attr('rx', 2)
          .attr('fill', C.paper).attr('stroke', C.rule2).attr('stroke-dasharray', '3 2');
        e.append('text').attr('x', 7).attr('y', 14).attr('font-size', STUB_FS).attr('fill', C.ink2).text(function (st) { return st.text; });
        return e;
      });
    });

    nodes.call(d3.drag().clickDistance(4)
      .on('drag', function (ev, b) {
        b.x += ev.dx; b.y += ev.dy;
        d3.select(this).attr('transform', 'translate(' + b.x + ',' + b.y + ')');
        self.drawEdges(true);
      }));
  };

  Automaton.prototype.drawEdges = function (fast) {
    var C = this.C, byId = {};
    this.boxes.forEach(function (b) { byId[b.id] = b; });
    assignPorts(this.edges, byId);
    var groups = this.edgeLayer.selectAll('g.edge').data(this.edges, function (e) { return e.from + '>' + e.to; })
      .join(function (enter) {
        var gEl = enter.append('g').attr('class', 'edge');
        gEl.append('path').attr('fill', 'none');
        gEl.append('rect').attr('class', 'lbl-bg').attr('rx', 2);
        gEl.append('text').attr('class', 'lbl').attr('text-anchor', 'middle').attr('font-size', 12);
        return gEl;
      });
    groups.each(function (e) {
      var gEl = root.d3.select(this);
      var a = byId[e.from], b = byId[e.to];
      var path = gEl.select('path').attr('d', edgePath(e, a, b));
      var len = path.node().getTotalLength();
      /* Labels sit near the source end of forward arrows, where arrows are still apart. */
      var mid = path.node().getPointAtLength(len * (e.kind === 'fwd' ? 0.3 : 0.5));
      var label = e.syms.join(', ');
      var tw = monoWidth(label, 12) + 8;
      gEl.select('rect').attr('x', mid.x - tw / 2).attr('y', mid.y - 9).attr('width', tw).attr('height', 17).attr('fill', C.paper);
      gEl.select('text').attr('x', mid.x).attr('y', mid.y + 4).text(label);
    });
    if (this.view) { if (fast) this.paintEdges(); else this.update(this.view); }
  };

  Automaton.prototype.paintEdges = function () {
    var C = this.C, v = this.view, id = this.svgEl.id, nts = this.an.grammar.nonTerminals;
    this.edgeLayer.selectAll('g.edge').each(function (e) {
      var gEl = root.d3.select(this);
      var visible = e.syms.some(function (s) { return v.edges.has(e.from + '>' + e.to + ':' + s); });
      var hot = v.currentEdge && v.currentEdge.from === e.from && v.currentEdge.to === e.to;
      var isNT = e.syms.every(function (s) { return nts.indexOf(s) >= 0; });
      var color = hot ? C.mark : isNT ? C.blue : C.ink2;
      gEl.attr('display', visible ? null : 'none');
      gEl.select('path').attr('stroke', color).attr('stroke-width', hot ? 2.2 : 1.2)
        .attr('stroke-dasharray', isNT && !hot ? '5 3' : null)
        .attr('marker-end', 'url(#' + (hot ? 'arrow-hot' : isNT ? 'arrow-blue' : 'arrow') + '-' + id + ')');
      gEl.select('text').attr('fill', hot ? C.mark : isNT ? C.blue : C.ink).attr('font-weight', hot ? 700 : 500)
        .attr('font-style', isNT ? 'italic' : null);
    });
    this.nodeLayer.selectAll('g.stub').each(function (st) {
      var gEl = root.d3.select(this);
      var visible = st.syms.some(function (s) { return v.edges.has(st.from + '>' + st.to + ':' + s); });
      var hot = v.currentEdge && v.currentEdge.from === st.from && v.currentEdge.to === st.to;
      gEl.attr('display', visible ? null : 'none');
      gEl.select('rect').attr('stroke', hot ? C.mark : C.rule2).attr('stroke-width', hot ? 2 : 1).attr('stroke-dasharray', hot ? null : '3 2')
        .attr('fill', hot ? C.markWash : C.paper);
      gEl.select('text').attr('fill', hot ? C.mark : C.ink2).attr('font-weight', hot ? 700 : 400);
    });
  };

  Automaton.prototype.update = function (view) {
    this.view = view;
    if (!hasD3() || !this.an) return;
    var C = this.C;
    this.nodeLayer.selectAll('g.state').each(function (b) {
      var n = root.d3.select(this);
      var visible = view.states.has(b.id);
      var sel = view.selected === b.id, cur = view.current === b.id;
      n.attr('display', visible ? null : 'none');
      n.select('rect.box').attr('stroke', sel ? C.blue : cur ? C.mark : C.ink2).attr('stroke-width', sel || cur ? C.stroke + 1.4 : C.stroke)
        .attr('fill', view.conflictStates && view.conflictStates.has(b.id) ? C.redWash : C.sheet);
      n.select('rect.head').attr('fill', sel ? C.blueWash : C.paper);
      n.selectAll('text.item').attr('font-weight', function (d) { return view.itemHighlight && view.itemHighlight.has(b.id + ':' + d.it.p + '.' + d.it.d) ? 700 : 400; })
        .attr('fill', function (d) {
          if (view.itemHighlight && view.itemHighlight.has(b.id + ':' + d.it.p + '.' + d.it.d)) return C.blue;
          return d.it.kernel ? C.ink : C.ink2;
        });
    });
    this.paintEdges();
    this.frame(false);
  };

  /*
   * Camera: frame the states visible at this step, never smaller than MIN_K so the
   * items stay readable. If they do not fit, centre on the current state instead.
   * Stops following once the user pans or zooms, until Fit is pressed.
   */
  var MIN_K = 0.8, MAX_K = 1.3;

  Automaton.prototype.frame = function (force) {
    if (!hasD3() || !this.view || (this.userMoved && !force)) return;
    var W = this.svgEl.clientWidth, H = this.svgEl.clientHeight;
    if (!W || !H) return;
    var v = this.view, focus = null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.boxes.forEach(function (b) {
      if (!v.states.has(b.id)) return;
      if (b.id === v.current) focus = b;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y - 48);
      maxX = Math.max(maxX, b.x + Math.max(b.w, b.stubs.length ? 170 : 0) + 24); maxY = Math.max(maxY, b.y + b.h + b.stubH + 8);
    });
    if (minX === Infinity) return;
    var pad = 24;
    var k = Math.min(MAX_K, (W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var minK = this.handlers.minK || MIN_K;
    if (k < minK) {
      k = minK;
      if (focus) { cx = focus.x + focus.w / 2; cy = focus.y + (focus.h + focus.stubH) / 2; }
    }
    var key = [W, H, k.toFixed(3), cx.toFixed(1), cy.toFixed(1)].join(':');
    if (key === this.lastFrame && !force) return;
    this.lastFrame = key;
    var d3 = root.d3, sel = d3.select(this.svgEl);
    var t = d3.zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k).scale(k);
    var self = this;
    if (!MOTION || document.hidden) { sel.interrupt(); sel.call(this.zoom.transform, t); return; }
    /* If a newer move interrupts this one, forget the key so the next frame() call is not skipped. */
    sel.transition().duration(380).ease(d3.easeCubicInOut)
      .on('interrupt', function () { self.lastFrame = ''; })
      .call(this.zoom.transform, t);
  };

  Automaton.prototype.fit = function () { this.userMoved = false; this.lastFrame = ''; this.frame(true); };

  Automaton.prototype.zoomBy = function (f) {
    if (!hasD3() || !this.zoom) return;
    this.userMoved = true;
    var sel = root.d3.select(this.svgEl);
    (MOTION ? sel.transition().duration(200) : sel).call(this.zoom.scaleBy, f);
  };

  /* Kept for callers that ask to bring one state into view. */
  Automaton.prototype.focusState = function (id) {
    if (!hasD3() || !this.svgEl.clientWidth) return;
    var b = this.boxes.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var d3 = root.d3, t = d3.zoomTransform(this.svgEl);
    var W = this.svgEl.clientWidth, H = this.svgEl.clientHeight;
    var cx = (b.x + b.w / 2) * t.k + t.x, cy = (b.y + b.h / 2) * t.k + t.y;
    if (cx > 40 && cx < W - 40 && cy > 40 && cy < H - 40) return;
    d3.select(this.svgEl).transition().duration(dur(350))
      .call(this.zoom.transform, d3.zoomIdentity.translate(W / 2 - (b.x + b.w / 2) * t.k, H / 2 - (b.y + b.h / 2) * t.k).scale(t.k));
  };

  Automaton.prototype.resetLayout = function () { if (this.an) { this.setData(this.an); if (this.view) this.update(this.view); } };

  /* ================================================================== */
  /* Parse tree                                                          */
  /* ================================================================== */

  function ParseTree(svgEl) { this.svgEl = svgEl; }

  ParseTree.prototype.render = function (forest, opts) {
    if (!hasD3()) { noD3(this.svgEl); return; }
    opts = opts || {};
    var d3 = root.d3, C = palette(), svg = d3.select(this.svgEl);
    var nts = opts.nonTerminals || [];
    if (!this.layer) {
      svg.selectAll('*').remove();
      this.layer = svg.append('g');
      var inner = this.layer;
      if (C.chalk) {
        chalkFilter(svg.append('defs'), 'chalk-' + this.svgEl.id);
        inner = this.layer.append('g').attr('filter', 'url(#chalk-' + this.svgEl.id + ')');
      }
      this.linkLayer = inner.append('g');
      this.nodeLayer = inner.append('g');
      var self = this;
      this.zoom = d3.zoom().scaleExtent([0.3, 2.5])
        .filter(function (ev) { return ev.type === 'wheel' ? ev.ctrlKey : !ev.button; })
        .on('zoom', function (ev) { self.layer.attr('transform', ev.transform); if (ev.sourceEvent) self.userZoomed = true; });
      svg.call(this.zoom).on('dblclick.zoom', null);
    }
    var W = this.svgEl.clientWidth, H = this.svgEl.clientHeight;
    /* A hidden SVG has no size; the caller redraws once the panel is shown. */
    if (!W || !H) return;

    if (!forest.length) {
      this.linkLayer.selectAll('*').remove(); this.nodeLayer.selectAll('*').remove();
      return;
    }
    var hroot = d3.hierarchy({ sym: '', id: 0, children: forest }, function (d) { return d.children; });
    var tree = d3.tree().nodeSize([44, 58]).separation(function (a, b) { return a.parent === b.parent ? 1 : 1.25; });
    tree(hroot);
    var nodes = hroot.descendants().filter(function (n) { return n.depth > 0; });
    var links = hroot.links().filter(function (l) { return l.source.depth > 0; });

    /* Leaves of separate subtrees sit at their own depths; shift so the forest reads left to right. */
    var minX = d3.min(nodes, function (n) { return n.x; }), maxX = d3.max(nodes, function (n) { return n.x; });
    var maxY = d3.max(nodes, function (n) { return n.y; });
    var bw = maxX - minX + 60, bh = maxY + 30;
    var k = Math.max(0.55, Math.min(1.2, (W - 30) / bw, (H - 30) / bh));
    if (!this.userZoomed) {
      var focusX = (maxX + minX) / 2;
      if (bw * k > W && opts.freshId) {
        var fn = nodes.filter(function (n) { return n.data.id === opts.freshId; })[0];
        if (fn) focusX = fn.x;
      }
      svg.call(this.zoom.transform, d3.zoomIdentity.translate(W / 2 - focusX * k, 28 - 58 * k).scale(k));
    }

    var T = svg.transition().duration(dur(320)).ease(d3.easeCubicOut);
    var fresh = opts.freshId;
    var link = d3.linkVertical().x(function (d) { return d.x; }).y(function (d) { return d.y; });

    this.linkLayer.selectAll('path').data(links, function (l) { return l.target.data.id; })
      .join(function (enter) { return enter.append('path').attr('fill', 'none').attr('opacity', 0).attr('d', link); })
      .attr('stroke', C.ink3).attr('stroke-width', 1.2)
      .transition(T).attr('opacity', 1).attr('d', link);

    var g = this.nodeLayer.selectAll('g.tn').data(nodes, function (n) { return n.data.id; })
      .join(function (enter) {
        var e = enter.append('g').attr('class', 'tn').attr('opacity', 0)
          .attr('transform', function (n) { return 'translate(' + n.x + ',' + (n.y - 12) + ')'; });
        e.append('rect');
        e.append('text').attr('text-anchor', 'middle').attr('y', 4.5);
        return e;
      });
    g.each(function (n) {
      var el = d3.select(this);
      var isNT = nts.indexOf(n.data.sym) >= 0;
      var isEps = n.data.sym === 'ε';
      var w = Math.max(26, monoWidth(n.data.sym, 13) + 14);
      el.select('rect').attr('x', -w / 2).attr('y', -12).attr('width', w).attr('height', 24).attr('rx', isNT ? Math.min(12, C.radius * 4) : Math.min(2, C.radius))
        .attr('fill', n.data.id === fresh ? C.blueWash : isNT ? C.sheet : C.paper)
        .attr('stroke', n.data.id === fresh ? C.blue : isNT ? C.ink2 : C.rule2).attr('stroke-width', n.data.id === fresh ? 2 : 1);
      el.select('text').text(n.data.sym).attr('font-family', isNT ? C.serif : C.mono)
        .attr('font-size', isNT ? 14 : 13).attr('font-style', isEps ? 'italic' : null)
        .attr('font-weight', isNT ? 600 : 500).attr('fill', isEps ? C.ink3 : C.ink);
    });
    g.transition(T).attr('opacity', 1).attr('transform', function (n) { return 'translate(' + n.x + ',' + n.y + ')'; });
  };

  ParseTree.prototype.resetView = function () { this.userZoomed = false; };

  /* ================================================================== */
  /* Stack and input tape                                                */
  /* ================================================================== */

  function Machine(svgEl) { this.svgEl = svgEl; }

  Machine.prototype.render = function (step, opts) {
    if (!hasD3()) { noD3(this.svgEl); return; }
    opts = opts || {};
    var d3 = root.d3, C = palette(), svg = d3.select(this.svgEl);
    var W = this.svgEl.clientWidth || 600;
    if (!this.built) {
      svg.selectAll('*').remove();
      svg.append('text').attr('x', 0).attr('y', 14).attr('font-family', C.sans).attr('font-size', 10.5)
        .attr('letter-spacing', 1.2).attr('fill', C.ink3).text('STACK');
      svg.append('text').attr('x', 0).attr('y', 86).attr('font-family', C.sans).attr('font-size', 10.5)
        .attr('letter-spacing', 1.2).attr('fill', C.ink3).text('INPUT');
      this.stackG = svg.append('g').attr('transform', 'translate(0,24)');
      this.inputG = svg.append('g').attr('transform', 'translate(0,96)');
      this.built = true;
    }
    var T = svg.transition().duration(dur(260)).ease(d3.easeCubicOut);

    /* Stack cells: 0 | a 3 | A 6 … ; each entry shows its grammar symbol and state. */
    var cells = [];
    step.stack.forEach(function (e, i) {
      if (e.sym !== null) cells.push({ key: i + 's' + e.sym, text: e.sym, kind: 'sym', depth: i });
      cells.push({ key: i + 'q' + e.state, text: String(e.state), kind: 'state', depth: i });
    });
    var x = 0;
    cells.forEach(function (c) { c.w = Math.max(c.kind === 'state' ? 26 : 30, monoWidth(c.text, 14) + 14); c.x = x; x += c.w + (c.kind === 'state' ? 8 : 2); });
    var shift = Math.min(0, W - 10 - x);
    var popFrom = opts.popFrom === undefined ? Infinity : opts.popFrom;

    this.stackG.selectAll('g.cell').data(cells, function (c) { return c.key; })
      .join(
        function (enter) {
          var e = enter.append('g').attr('class', 'cell').attr('opacity', 0)
            .attr('transform', function (c) { return 'translate(' + (c.x + shift) + ',-16)'; });
          e.append('rect'); e.append('text').attr('text-anchor', 'middle').attr('y', 23);
          return e;
        },
        function (update) { return update; },
        function (exit) { exit.transition(T).attr('opacity', 0).attr('transform', function () { return d3.select(this).attr('transform') + ' translate(0,-14)'; }).remove(); }
      )
      .each(function (c) {
        var el = d3.select(this), top = c.depth >= popFrom;
        el.select('rect').attr('width', c.w).attr('height', 34).attr('rx', c.kind === 'state' ? 17 : 2)
          .attr('fill', c.kind === 'state' ? (top ? C.redWash : C.blueWash) : (top ? C.redWash : C.sheet))
          .attr('stroke', c.kind === 'state' ? C.blue : C.ink2).attr('stroke-width', 1);
        el.select('text').attr('x', c.w / 2).text(c.text)
          .attr('font-family', C.mono).attr('font-size', c.kind === 'state' ? 13 : 14).attr('font-weight', c.kind === 'state' ? 600 : 500)
          .attr('fill', c.kind === 'state' ? C.blue : C.ink);
      })
      .transition(T).attr('opacity', 1).attr('transform', function (c) { return 'translate(' + (c.x + shift) + ',0)'; });

    /* Input tape: consumed symbols fade, the lookahead is boxed. */
    var tape = step.input.map(function (s, i) { return { key: i + ':' + s, text: s, i: i }; });
    var ix = 0;
    tape.forEach(function (c) { c.w = Math.max(30, monoWidth(c.text, 14) + 14); c.x = ix; ix += c.w + 2; });
    var off = Math.min(0, W - 10 - ix);
    off = Math.max(off, -((tape[step.ip] || { x: 0 }).x - 40));
    this.inputG.selectAll('g.tc').data(tape, function (c) { return c.key; })
      .join(function (enter) {
        var e = enter.append('g').attr('class', 'tc');
        e.append('rect'); e.append('text').attr('text-anchor', 'middle').attr('y', 23);
        return e;
      })
      .each(function (c) {
        var el = d3.select(this), done = c.i < step.ip, la = c.i === step.ip;
        el.select('rect').attr('width', c.w).attr('height', 34).attr('rx', 2)
          .attr('fill', la ? C.mark : 'none').attr('fill-opacity', la ? 0.16 : 0)
          .attr('stroke', la ? C.mark : C.rule2).attr('stroke-width', la ? 2 : 1).attr('stroke-dasharray', done ? '3 3' : null);
        el.select('text').attr('x', c.w / 2).text(c.text).attr('font-family', C.mono).attr('font-size', 14)
          .attr('font-weight', la ? 700 : 500).attr('fill', done ? C.ink3 : C.ink);
      })
      .transition(T).attr('transform', function (c) { return 'translate(' + (c.x + off) + ',0)'; });
  };

  /* ================================================================== */
  /* Export an SVG drawing as PNG                                        */
  /* ================================================================== */

  function exportPNG(svgEl, filename, scale) {
    scale = scale || 2;
    var C = palette();
    var clone = svgEl.cloneNode(true);
    var layer = svgEl.querySelector('g');
    var bb = layer ? layer.getBBox() : { x: 0, y: 0, width: svgEl.clientWidth, height: svgEl.clientHeight };
    var t = layer && layer.getAttribute('transform');
    var pad = 24;
    clone.querySelectorAll('[display="none"]').forEach(function (n) { n.parentNode.removeChild(n); });
    var inner = clone.querySelector('g');
    if (inner && t) inner.removeAttribute('transform');
    var w = Math.ceil(bb.width + pad * 2), h = Math.ceil(bb.height + pad * 2);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    clone.setAttribute('viewBox', (bb.x - pad) + ' ' + (bb.y - pad) + ' ' + w + ' ' + h);
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', bb.x - pad); bg.setAttribute('y', bb.y - pad); bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('fill', C.paper);
    clone.insertBefore(bg, clone.firstChild);
    var data = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = h * scale;
      var ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
  }

  root.Viz = { Automaton: Automaton, ParseTree: ParseTree, Machine: Machine, exportPNG: exportPNG, hasD3: hasD3, palette: palette };
})(this);
