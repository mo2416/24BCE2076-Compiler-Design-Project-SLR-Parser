/*
 * app.js — the Visualize mode: grammar panel, the six stage views, their
 * step controls, and the share / print / theme tools.
 *
 * Data flow:  grammar text ──Grammar.parseGrammar──► g
 *             g ──SLR.analyze──► { ff, lr0, table }
 *             input ──Grammar.tokenizeInput──► tokens ──SLR.simulate──► sim
 * Each stage view only reads that state; nothing here recomputes the parser.
 */
(function () {
  'use strict';

  var $ = function (sel, rootEl) { return (rootEl || document).querySelector(sel); };
  var $$ = function (sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function m(s) { return '<span class="m">' + esc(s) + '</span>'; }
  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } return null; }

  var ICON = {
    first: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h2v10H3zM13 3v10L6 8z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3v10L4 8z"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l7-5z"/></svg>',
    last: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
    cross: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    okc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>',
    bad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /* Shared state                                                        */
  /* ------------------------------------------------------------------ */

  var S = {
    g: null, an: null, tokens: null, tokenError: null, sim: null, example: null,
    stage: 'grammar', mode: 'visual',
    ffSel: null, selState: null, selCell: null,
    steppers: {}, listeners: []
  };

  /* ------------------------------------------------------------------ */
  /* Stepper: first / back / play / forward / last, position and speed   */
  /* ------------------------------------------------------------------ */

  function Stepper(host, name, onChange) {
    this.host = host; this.name = name; this.onChange = onChange;
    this.count = 0; this.i = 0; this.timer = null;
    host.innerHTML =
      '<div class="btns">' +
        '<button type="button" data-a="first" aria-label="First step" title="First (Home)">' + ICON.first + '</button>' +
        '<button type="button" data-a="prev" aria-label="Step back" title="Back (←)">' + ICON.prev + '</button>' +
        '<button type="button" data-a="play" class="play" aria-label="Run" title="Run / pause (Space)">' + ICON.play + '<span>Run</span></button>' +
        '<button type="button" data-a="next" aria-label="Step forward" title="Forward (→)">' + ICON.next + '</button>' +
        '<button type="button" data-a="last" aria-label="Last step" title="Last (End)">' + ICON.last + '</button>' +
      '</div>' +
      '<span class="pos" aria-live="polite"></span>' +
      '<div class="bar" role="presentation"><i></i></div>' +
      '<label class="speed">Speed <select aria-label="Playback speed">' +
        '<option value="1400">slow</option><option value="750" selected>normal</option><option value="320">fast</option><option value="90">very fast</option>' +
      '</select></label>' +
      '<div class="caption"></div>';
    var self = this;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'play') return self.toggle();
      self.pause();
      if (a === 'first') self.set(0);
      if (a === 'prev') self.set(self.i - 1);
      if (a === 'next') self.set(self.i + 1);
      if (a === 'last') self.set(self.count - 1);
    });
    $('.bar', host).addEventListener('click', function (e) {
      var r = this.getBoundingClientRect();
      self.pause();
      self.set(Math.round(((e.clientX - r.left) / r.width) * (self.count - 1)));
    });
    $('select', host).addEventListener('change', function () { if (self.timer) { self.pause(); self.play(); } });
  }
  Stepper.prototype.reset = function (count, start) {
    this.pause();
    this.count = count;
    this.set(start === undefined ? 0 : start);
  };
  Stepper.prototype.set = function (i) {
    if (!this.count) { this.i = 0; this.paint(); return; }
    this.i = Math.max(0, Math.min(this.count - 1, i));
    this.paint();
    this.onChange(this.i);
  };
  Stepper.prototype.paint = function () {
    var h = this.host;
    $('.pos', h).textContent = this.count ? 'Step ' + (this.i + 1) + ' of ' + this.count : 'No steps';
    $('.bar i', h).style.width = this.count > 1 ? (100 * this.i / (this.count - 1)) + '%' : '100%';
    $('[data-a=first]', h).disabled = $('[data-a=prev]', h).disabled = this.i <= 0;
    $('[data-a=last]', h).disabled = $('[data-a=next]', h).disabled = this.i >= this.count - 1;
    $('[data-a=play]', h).disabled = this.count < 2;
  };
  Stepper.prototype.caption = function (html) { $('.caption', this.host).innerHTML = html || ''; };
  Stepper.prototype.play = function () {
    var self = this;
    if (this.i >= this.count - 1) this.set(0);
    var ms = +$('select', this.host).value;
    this.timer = setInterval(function () {
      if (self.i >= self.count - 1) return self.pause();
      self.set(self.i + 1);
    }, ms);
    $('[data-a=play]', this.host).innerHTML = ICON.pause + '<span>Pause</span>';
    $('[data-a=play]', this.host).setAttribute('aria-label', 'Pause');
  };
  Stepper.prototype.pause = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    $('[data-a=play]', this.host).innerHTML = ICON.play + '<span>Run</span>';
    $('[data-a=play]', this.host).setAttribute('aria-label', 'Run');
  };
  Stepper.prototype.toggle = function () { if (this.timer) this.pause(); else this.play(); };

  /* ------------------------------------------------------------------ */
  /* Build                                                               */
  /* ------------------------------------------------------------------ */

  function showFormError(msg) {
    var box = $('#grammar-error');
    box.hidden = !msg;
    box.textContent = msg || '';
    $('#grammar').setAttribute('aria-invalid', msg && /grammar|rule|Line|left-hand|reserved/i.test(msg) ? 'true' : 'false');
  }

  function build(opts) {
    opts = opts || {};
    var text = $('#grammar').value;
    var spaceOnly = $('#space-only').checked;
    var g;
    try {
      g = Grammar.parseGrammar(text, { spaceOnly: spaceOnly });
    } catch (err) {
      showFormError(err.message);
      return false;
    }
    showFormError('');
    S.g = g;
    S.an = SLR.analyze(g);
    S.tokenError = null;
    try { S.tokens = Grammar.tokenizeInput($('#input-string').value, g); }
    catch (err) { S.tokens = null; S.tokenError = err.message; showFormError(err.message); }
    S.sim = S.tokens ? SLR.simulate(g, S.an.table, S.tokens) : null;
    S.ffSel = null; S.selCell = null; S.selState = null;
    store('slr.last', JSON.stringify({ g: text, w: $('#input-string').value, s: spaceOnly }));

    renderRef();
    renderGrammarStage();
    setupFF();
    setupItems();
    setupTable();
    renderConflicts();
    setupParse();
    $('[data-stage=conflicts] .flag', $('#stages')) && $('[data-stage=conflicts] .flag', $('#stages')).remove();
    if (!S.an.table.isSLR) $('[data-stage=conflicts]', $('#stages')).insertAdjacentHTML('beforeend', '<span class="flag" aria-label="has conflicts"></span>');
    if (!opts.keepStage) goStage(S.stage || 'grammar');
    S.listeners.forEach(function (fn) { fn(S); });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Reference column (always visible)                                   */
  /* ------------------------------------------------------------------ */

  function renderRef() {
    var g = S.g, t = S.an.table;
    $('#ref-prods').innerHTML = g.productions.map(function (p) {
      return '<li data-prod="' + p.index + '"><span class="n">(' + p.index + ')</span><span>' + esc(SLR.prodStr(p)) + '</span></li>';
    }).join('');
    $('#ref-nts').textContent = g.nonTerminals.join('  ');
    $('#ref-ts').textContent = g.terminals.join('  ');
    var v = '';
    v += t.isSLR
      ? '<span class="verdict ok">' + ICON.check + 'SLR(1)</span>'
      : '<span class="verdict bad">' + ICON.cross + 'Not SLR(1) · ' + t.conflicts.length + ' conflict' + (t.conflicts.length === 1 ? '' : 's') + '</span>';
    v += t.isLR0 ? '<span class="verdict ok">' + ICON.check + 'LR(0)</span>' : '<span class="verdict neutral">not LR(0)</span>';
    v += '<span class="verdict neutral">' + S.an.lr0.states.length + ' states</span>';
    $('#ref-verdict').innerHTML = v;
  }

  function highlightProd(idx) {
    $$('#ref-prods li').forEach(function (li) { li.classList.toggle('hl', idx !== null && +li.getAttribute('data-prod') === idx); });
  }

  /* ------------------------------------------------------------------ */
  /* Stage 1 · grammar                                                   */
  /* ------------------------------------------------------------------ */

  function renderGrammarStage() {
    var g = S.g;
    $('#aug-rule').textContent = SLR.prodStr(g.productions[0]);
    $('#g-prods tbody').innerHTML = g.productions.map(function (p) {
      return '<tr' + (p.index === 0 ? ' class="aug"' : '') + '><td>(' + p.index + ')</td><td>' + esc(SLR.prodStr(p)) +
        (p.index === 0 ? ' <span class="eyebrow" style="display:inline;margin-left:8px">added</span>' : '') + '</td></tr>';
    }).join('');
    var splits = g.splits.filter(function (s, i, a) { return a.findIndex(function (x) { return x.text === s.text; }) === i; });
    $('#g-splits').innerHTML = splits.length
      ? '<p class="note"><b>Compact form read as separate symbols:</b> ' + splits.slice(0, 8).map(function (s) {
          return m(s.text) + ' → ' + m(s.symbols.join(' '));
        }).join(', ') + '. If a word should be one symbol, tick "Every space-separated word is one symbol" or quote it, e.g. <code>\'while\'</code>.</p>'
      : '';
    var notes = g.warnings.slice();
    if (S.example && S.example.grammar === $('#grammar').value) {
      $('#g-warnings').innerHTML = '<p class="note"><b>' + esc(S.example.title) + '</b> · ' + esc(S.example.source) + '. ' + esc(S.example.note) + '</p>';
    } else $('#g-warnings').innerHTML = '';
    if (notes.length) $('#g-warnings').innerHTML += notes.map(function (w) { return '<p class="note warn">' + esc(w) + '</p>'; }).join('');

    $('#g-symbols').innerHTML =
      '<dt>Start symbol</dt><dd>' + esc(g.start) + ' (augmented: ' + esc(g.augmentedStart) + ')</dd>' +
      '<dt>Non-terminals</dt><dd>' + esc(g.nonTerminals.join(', ')) + '</dd>' +
      '<dt>Terminals</dt><dd>' + esc(g.terminals.join(', ')) + '</dd>' +
      '<dt>Productions</dt><dd>' + g.productions.length + ' including (0)</dd>';
    $('#g-tokens').innerHTML = S.tokens
      ? S.tokens.map(function (t) { return '<span class="tok">' + esc(t) + '</span>'; }).join('') + '<span class="tok end">$</span>'
      : '<span class="note warn">' + esc(S.tokenError || 'No input string.') + '</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Stage 2 · FIRST and FOLLOW                                          */
  /* ------------------------------------------------------------------ */

  function setupFF() {
    var steps = S.an.ff.steps, html = '', lastHead = '';
    steps.forEach(function (st, i) {
      var head = st.kind + (st.pass ? ' · pass ' + st.pass : ' · rule 1');
      if (head !== lastHead) { html += '<li class="pass" aria-hidden="true">' + esc(head) + '</li>'; lastHead = head; }
      html += '<li data-i="' + i + '"><span>' + m(st.sym) + ' ∈ ' + m(st.kind + '(' + st.of + ')') + '<br>' + esc(st.reason) + '</span></li>';
    });
    $('#ff-log').innerHTML = html;
    S.steppers.ff.reset(steps.length, 0);
  }

  function renderFF(i) {
    var an = S.an, steps = an.ff.steps;
    var shown = {};
    steps.slice(0, i + 1).forEach(function (st) { shown[st.kind + ':' + st.of + ':' + st.sym] = true; });
    var cur = steps[i];
    var rows = S.g.nonTerminals.map(function (A) {
      function cell(kind) {
        var set = kind === 'FIRST' ? an.ff.first[A] : an.ff.follow[A];
        var chips = Object.keys(set).filter(function (s) { return shown[kind + ':' + A + ':' + s]; }).map(function (s) {
          var isCur = cur && cur.kind === kind && cur.of === A && cur.sym === s;
          var isSel = S.ffSel && S.ffSel.kind === kind && S.ffSel.of === A && S.ffSel.sym === s;
          return '<button type="button" class="chip' + (s === 'ε' ? ' eps' : '') + (isCur ? ' new' : '') + (isSel ? ' sel' : '') +
            '" data-kind="' + kind + '" data-of="' + esc(A) + '" data-sym="' + esc(s) + '" aria-label="' + esc(s + ' in ' + kind + '(' + A + ')') + '">' + esc(s) + '</button>';
        });
        return '<td><div class="set">' + chips.join('') + '</div></td>';
      }
      return '<tr><td>' + esc(A) + '</td>' + cell('FIRST') + cell('FOLLOW') + '</tr>';
    });
    $('#ff-table tbody').innerHTML = rows.join('');
    S.steppers.ff.caption(cur ? esc(cur.sym + ' ∈ ' + cur.kind + '(' + cur.of + ')') + ' — ' + esc(cur.reason) : '');
    $$('#ff-log li[data-i]').forEach(function (li) {
      var k = +li.getAttribute('data-i');
      li.className = k < i ? 'done' : k === i ? 'cur' : 'future';
    });
    var curLi = $('#ff-log li.cur');
    if (curLi && S.stage === 'ff') curLi.scrollIntoView({ block: 'nearest' });
    showFFReason();
    highlightProd(cur ? cur.prod : null);
  }

  function showFFReason() {
    var sel = S.ffSel, box = $('#ff-reason');
    if (!sel) { box.innerHTML = ''; return; }
    var set = sel.kind === 'FIRST' ? S.an.ff.first[sel.of] : S.an.ff.follow[sel.of];
    var r = set[sel.sym];
    box.innerHTML = m(sel.sym) + ' is in ' + m(sel.kind + '(' + sel.of + ')') + ' because ' + esc(r.reason) + '.';
  }

  /* ------------------------------------------------------------------ */
  /* Stage 3 · LR(0) item sets                                           */
  /* ------------------------------------------------------------------ */

  function setupItems() {
    $('#items-start').textContent = SLR.itemStr(S.g, { p: 0, d: 0 });
    S.automaton.setData(S.an);
    S.steppers.items.reset(S.an.lr0.steps.length, 0);
  }

  function itemsView(i) {
    var steps = S.an.lr0.steps, states = new Set(), edges = new Set();
    steps.slice(0, i + 1).forEach(function (st) {
      states.add(st.state);
      if (st.from !== null && st.from !== undefined) edges.add(st.from + '>' + st.state + ':' + st.sym);
    });
    var cur = steps[i];
    return { states: states, edges: edges, cur: cur };
  }

  function renderItems(i) {
    var v = itemsView(i), cur = v.cur;
    if (S.itemsFollowStep !== false) S.selState = cur.state;
    var conflictStates = new Set(S.an.table.conflicts.map(function (c) { return c.state; }));
    S.automaton.update({
      states: v.states, edges: v.edges, current: cur.state, selected: S.selState,
      currentEdge: cur.from !== null && cur.from !== undefined ? { from: cur.from, to: cur.state } : null,
      itemHighlight: null, conflictStates: conflictStates
    });
    S.steppers.items.caption(esc(cur.text));
    renderItemSetList(v);
    renderStateInspector(S.selState, v);
    if (S.stage === 'items') S.automaton.focusState(cur.state);
  }

  function originOf(id) {
    if (id === 0) return 'closure({ ' + SLR.itemStr(S.g, { p: 0, d: 0 }) + ' })';
    var st = S.an.lr0.steps.filter(function (s) { return s.type === 'new' && s.state === id; })[0];
    return st ? 'goto(I' + st.from + ', ' + st.sym + ')' : '';
  }

  function itemsListHTML(I, hlKeys) {
    var g = S.g, out = '', sepDone = false;
    I.items.forEach(function (it) {
      if (!it.kernel && !sepDone) { out += '<li class="sep" aria-hidden="true"></li>'; sepDone = true; }
      var key = SLR.itemKey(it), hl = hlKeys && hlKeys.indexOf(key) >= 0;
      var why = '';
      if (!it.kernel) {
        var f = it.from.split('.');
        why = '<span class="why">closure of ' + esc(SLR.itemStr(g, { p: +f[0], d: +f[1] })) + '</span>';
      }
      out += '<li class="' + (it.kernel ? 'kernel' : 'closure') + (hl ? ' hl' : '') + '">' + esc(SLR.itemStr(g, it)) + why + '</li>';
    });
    return '<ul class="items">' + out + '</ul>';
  }

  function renderStateInspector(id, v) {
    var box = $('#state-inspector');
    var I = S.an.lr0.states[id];
    if (!I || (v && !v.states.has(id))) { box.innerHTML = '<p class="empty">Select a state in the diagram.</p>'; return; }
    var visibleT = I.transitions.filter(function (t) { return !v || v.edges.has(I.id + '>' + t.to + ':' + t.sym); });
    var kinds = [];
    I.items.forEach(function (it) {
      if (SLR.afterDot(S.g, it) === null) kinds.push(it.p === 0 ? 'accept on $' : 'reduce by (' + it.p + ')');
    });
    box.innerHTML =
      '<h3>I' + id + '</h3><p class="sub">' + esc(originOf(id)) + ' · ' + I.kernel.length + ' kernel, ' + (I.items.length - I.kernel.length) + ' closure</p>' +
      '<h4 class="eyebrow">Items</h4>' + itemsListHTML(I) +
      (kinds.length ? '<h4 class="eyebrow">Completed items</h4><p style="font-size:14px;margin-bottom:12px">' + esc(kinds.join('; ')) + '</p>' : '') +
      '<h4 class="eyebrow">Transitions</h4>' +
      (visibleT.length ? '<div class="trans">' + visibleT.map(function (t) {
        return '<button type="button" data-state="' + t.to + '">' + esc(t.sym) + ' → I' + t.to + '</button>';
      }).join('') + '</div>' : '<p class="empty">' + (I.transitions.length ? 'Not explored yet at this step.' : 'None: every item is complete.') + '</p>');
  }

  function renderItemSetList(v) {
    var host = $('#itemsets');
    if (host.hidden) return;
    host.innerHTML = S.an.lr0.states.filter(function (I) { return v.states.has(I.id); }).map(function (I) {
      var lis = '', sep = false;
      I.items.forEach(function (it) {
        if (!it.kernel && !sep) { lis += '<li class="sep"></li>'; sep = true; }
        lis += '<li class="' + (it.kernel ? '' : 'closure') + '">' + esc(SLR.itemStr(S.g, it)) + '</li>';
      });
      return '<div class="itemset' + (I.id === S.selState ? ' sel' : '') + '" data-state="' + I.id + '" tabindex="0"><h4>I' + I.id + '<small>' + esc(originOf(I.id)) + '</small></h4><ul>' + lis + '</ul></div>';
    }).join('');
  }

  function selectState(id) {
    S.selState = id;
    S.itemsFollowStep = false;
    var v = itemsView(S.steppers.items.i);
    S.automaton.update(Object.assign({}, S.automaton.view, { selected: id }));
    renderStateInspector(id, v);
    renderItemSetList(v);
    S.itemsFollowStep = true;
    S.itemsPinned = id;
  }

  /* ------------------------------------------------------------------ */
  /* Stage 4 · ACTION / GOTO table                                       */
  /* ------------------------------------------------------------------ */

  function setupTable() {
    var t = S.an.table;
    var head1 = '<tr><th rowspan="2" scope="col">State</th><th colspan="' + t.terminals.length + '" scope="colgroup">ACTION</th>' +
      '<th colspan="' + t.nonTerminals.length + '" scope="colgroup" class="split">GOTO</th></tr>';
    var head2 = '<tr>' + t.terminals.map(function (a) { return '<th scope="col" data-col="' + esc(a) + '">' + esc(a) + '</th>'; }).join('') +
      t.nonTerminals.map(function (A, i) { return '<th scope="col" data-col="' + esc(A) + '"' + (i === 0 ? ' class="split"' : '') + '>' + esc(A) + '</th>'; }).join('') + '</tr>';
    var body = S.an.lr0.states.map(function (I) {
      return '<tr data-row="' + I.id + '"><th scope="row">' + I.id + '</th>' +
        t.terminals.map(function (a) { return '<td data-s="' + I.id + '" data-c="' + esc(a) + '" tabindex="-1"></td>'; }).join('') +
        t.nonTerminals.map(function (A, i) { return '<td data-s="' + I.id + '" data-c="' + esc(A) + '"' + (i === 0 ? ' class="split"' : '') + ' tabindex="-1"></td>'; }).join('') + '</tr>';
    }).join('');
    $('#lr-table').innerHTML = '<thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody>';
    S.steppers.table.reset(t.fills.length, 0);
  }

  function cellKey(s, c) { return s + '\u0001' + c; }

  function renderTable(i) {
    var t = S.an.table, fills = t.fills;
    var acc = {};
    fills.slice(0, i + 1).forEach(function (f) {
      var k = cellKey(f.state, f.sym);
      (acc[k] = acc[k] || []).push(f.entry);
    });
    var cur = fills[i];
    $$('#lr-table td').forEach(function (td) {
      var s = +td.getAttribute('data-s'), c = td.getAttribute('data-c');
      var list = acc[cellKey(s, c)] || [];
      var split = td.classList.contains('split');
      td.className = split ? 'split' : '';
      td.textContent = list.map(SLR.entryStr).join('/');
      if (list.length > 1) td.classList.add('conf');
      else if (list.length) td.classList.add(list[0].type === 'g' ? 'g' : list[0].type);
      if (cur && cur.state === s && cur.sym === c) td.classList.add('cur');
      if (S.selCell && S.selCell.state === s && S.selCell.sym === c) td.classList.add('sel');
      td.setAttribute('aria-label', 'State ' + s + ', ' + c + ': ' + (td.textContent || 'blank'));
    });
    S.steppers.table.caption(cur ? esc(cur.entry.reason) + (cur.conflict ? ' <b style="color:var(--red)">— this cell already had an entry: conflict</b>' : '') : '');
    var shownCell = S.selCell || (cur ? { state: cur.state, sym: cur.sym } : null);
    renderCellInspector(shownCell, acc);
    highlightProd(cur && cur.entry.type === 'r' ? cur.entry.prod : null);
  }

  function renderCellInspector(cell, acc) {
    var box = $('#cell-inspector');
    $$('#lr-table tr.row-hl').forEach(function (r) { r.classList.remove('row-hl'); });
    $$('#lr-table th.col-hl').forEach(function (r) { r.classList.remove('col-hl'); });
    if (!cell) { box.innerHTML = '<p class="empty">Select a cell to see where its entry comes from.</p>'; return; }
    var g = S.g, t = S.an.table, I = S.an.lr0.states[cell.state];
    var row = $('#lr-table tr[data-row="' + cell.state + '"]');
    if (row) row.classList.add('row-hl');
    $$('#lr-table th[data-col]').forEach(function (th) { if (th.getAttribute('data-col') === cell.sym) th.classList.add('col-hl'); });

    var isGoto = t.nonTerminals.indexOf(cell.sym) >= 0;
    var entries = (acc && acc[cellKey(cell.state, cell.sym)]) || [];
    var title = (isGoto ? 'GOTO' : 'ACTION') + '[' + cell.state + ', ' + cell.sym + ']';
    var full = SLR.cellText(t, cell.state, cell.sym);
    var hl = [], body = '';

    if (!entries.length) {
      var stillToCome = full && acc;
      if (stillToCome) {
        body = '<p class="empty">Not filled yet at this step. Final entry: ' + m(full) + '.</p>';
      } else if (isGoto) {
        body = '<p>I' + cell.state + ' has no item with ' + m(cell.sym) + ' after the dot, so goto(I' + cell.state + ', ' + esc(cell.sym) + ') is empty. Blank means error.</p>';
      } else {
        var completes = I.items.filter(function (it) { return SLR.afterDot(g, it) === null && it.p !== 0; });
        body = '<p>No item in I' + cell.state + ' has ' + m(cell.sym) + ' after the dot, so there is no shift.</p>' +
          (completes.length ? '<p style="margin-top:8px">' + completes.map(function (it) {
            var A = g.productions[it.p].lhs;
            return m(SLR.itemStr(g, it)) + ' is complete, but ' + m(cell.sym) + ' ∉ FOLLOW(' + esc(A) + ') = { ' + esc(Object.keys(S.an.ff.follow[A]).join(', ')) + ' }';
          }).join('; ') + ', so there is no reduce.</p>' : '') +
          '<p style="margin-top:8px">The cell stays blank: an error entry.</p>';
      }
    } else {
      body = entries.map(function (e) {
        hl = hl.concat(e.items || []);
        var tag = SLR.entryStr(e);
        var rule = { a: 'rule 2(a), shift', b: 'rule 2(b), reduce', c: 'rule 2(c), accept', 3: 'rule 3, goto' }[e.rule] || '';
        var extra = '';
        if (e.type === 'r') {
          var A = g.productions[e.prod].lhs;
          extra = '<p class="follow-line">FOLLOW(' + esc(A) + ') = { ' + esc(Object.keys(S.an.ff.follow[A]).join(', ')) + ' }</p>';
        }
        return '<div class="cell-entry"><span class="tag">' + esc(tag) + '</span><span class="eyebrow" style="display:inline">' + esc(rule) + '</span>' +
          '<p style="margin-top:6px">' + esc(e.reason) + '.</p>' + extra + '</div>';
      }).join('');
      if (entries.length > 1) body = '<p class="note warn" style="margin:0 0 10px"><b>Conflict.</b> This cell has ' + entries.length + ' entries, so the grammar is not SLR(1).</p>' + body;
    }
    box.innerHTML = '<h3>' + esc(title) + '</h3><p class="sub">State I' + cell.state + ' · ' + esc(originOf(cell.state)) + '</p>' + body +
      '<h4 class="eyebrow" style="margin-top:14px">Items of I' + cell.state + '</h4>' + itemsListHTML(I, hl) +
      '<button type="button" class="linkish" data-show-state="' + cell.state + '">Show I' + cell.state + ' in the automaton</button>';
  }

  /* ------------------------------------------------------------------ */
  /* Stage 5 · conflicts                                                 */
  /* ------------------------------------------------------------------ */

  function renderConflicts() {
    var t = S.an.table, g = S.g, html = '';
    if (t.isSLR) {
      html += '<div class="banner ok">' + ICON.okc + '<div><h3>The grammar is SLR(1)</h3><p>Every cell of the ACTION table has at most one entry, so the parser never has to guess.</p></div></div>';
    } else {
      html += '<div class="banner bad">' + ICON.bad + '<div><h3>Not SLR(1): ' + t.conflicts.length + ' conflicting cell' + (t.conflicts.length === 1 ? '' : 's') + '</h3>' +
        '<p>The table is still shown in full. Each conflict is listed with the state, the lookahead and the items responsible, rather than being resolved silently.</p></div></div>';
      html += '<div class="conflicts">' + t.conflicts.map(function (c) {
        var I = S.an.lr0.states[c.state];
        return '<article class="conflict"><span class="type">' + esc(c.type) + ' conflict</span>' +
          '<h4>State I' + c.state + ', lookahead ' + esc(c.sym) + '</h4>' +
          '<p>ACTION[' + c.state + ', ' + esc(c.sym) + '] = ' + m(c.entries.map(SLR.entryStr).join(' / ')) + '</p>' +
          '<ol class="entries">' + c.entries.map(function (e) { return '<li>' + esc(SLR.entryStr(e)) + '<small>' + esc(e.reason) + '</small></li>'; }).join('') + '</ol>' +
          '<p>' + esc(c.explain) + '</p>' +
          '<h4 class="eyebrow" style="margin-top:10px">Items of I' + c.state + '</h4>' + itemsListHTML(I, c.items) +
          '<button type="button" class="linkish" data-show-cell="' + c.state + '|' + esc(c.sym) + '">Show the cell in the table</button></article>';
      }).join('') + '</div>';
    }

    /* LR(0) comparison: which states need FOLLOW to decide. */
    html += '<div class="sheet" style="margin-top:16px"><h3 class="eyebrow">Compared with LR(0)</h3>';
    if (t.isLR0) {
      html += '<p style="font-size:14px">The grammar is also LR(0): no state holds a completed item together with a shift or another completed item, so FOLLOW sets are never needed to decide.</p>';
    } else {
      html += '<p style="font-size:14px">An LR(0) parser reduces on every lookahead. These states hold a completed item alongside another action, so the grammar is not LR(0). SLR(1) writes each reduction only under FOLLOW of its left side:</p><ul class="lr0-list">' +
        t.lr0Conflicts.map(function (c) {
          var I = S.an.lr0.states[c.state];
          var parts = [];
          I.items.forEach(function (it) {
            var X = SLR.afterDot(g, it);
            if (X === null && it.p !== 0) {
              var A = g.productions[it.p].lhs;
              parts.push(m(SLR.itemStr(g, it)) + ' reduces on FOLLOW(' + esc(A) + ') = { ' + esc(Object.keys(S.an.ff.follow[A]).join(', ')) + ' }');
            } else if (X && g.nonTerminals.indexOf(X) < 0) {
              parts.push(m(SLR.itemStr(g, it)) + ' shifts on ' + m(X));
            }
          });
          var still = t.conflicts.some(function (x) { return x.state === c.state; });
          return '<li><b>I' + c.state + '</b> (' + esc(c.type) + ' in LR(0)): ' + parts.join('; ') + '. ' +
            (still ? '<b style="color:var(--red)">The sets overlap, so the conflict remains in SLR(1).</b>' : 'These do not overlap, so SLR(1) resolves it.') + '</li>';
        }).join('') + '</ul>';
    }
    html += '</div>';
    $('#conflict-body').innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* Stage 6 · parse                                                     */
  /* ------------------------------------------------------------------ */

  function stackText(stack) {
    return stack.map(function (e) { return (e.sym === null ? '' : e.sym + ' ') + e.state; }).join(' ');
  }

  function setupParse() {
    $('#parse-input-echo').textContent = S.tokens ? S.tokens.join(' ') + ' $' : '';
    $('#parse-warning').innerHTML = !S.an.table.isSLR && S.sim
      ? '<div class="banner warn">' + ICON.bad + '<div><h3>The table has conflicts</h3><p>The simulation still runs: in a conflicting cell it takes the entry that was written first and marks that move, so you can see where the parser had to guess.</p></div></div>'
      : '';
    S.tree.layer = null;
    S.tree.resetView();
    S.machine.built = false;
    if (!S.sim) {
      $('#trace tbody').innerHTML = '';
      $('#parse-move').textContent = '';
      $('#parse-result').innerHTML = '<div class="banner bad">' + ICON.bad + '<div><h3>The input cannot be read</h3><p>' + esc(S.tokenError || '') + '</p></div></div>';
      S.steppers.parse.reset(0);
      $('#machine').innerHTML = ''; $('#tree').innerHTML = '';
      return;
    }
    $('#trace tbody').innerHTML = S.sim.steps.map(function (st, i) {
      var act = st.type === 'shift' ? 'shift ' + st.action.slice(1)
        : st.type === 'reduce' ? 'reduce ' + SLR.prodStr(S.g.productions[st.prod]) + '  (r' + st.prod + ')'
        : st.type === 'accept' ? 'accept' : 'error';
      return '<tr data-i="' + i + '" class="' + st.type + '"><td>' + (i + 1) + '</td><td>' + esc(stackText(st.stack)) + '</td><td class="r">' +
        esc(st.input.slice(st.ip).join(' ')) + '</td><td>' + esc(act) + (st.conflict ? ' *' : '') + '</td></tr>';
    }).join('');
    S.steppers.parse.reset(S.sim.steps.length, 0);
  }

  function renderParse(i) {
    if (!S.sim) return;
    var steps = S.sim.steps, st = steps[i];
    var n = st.type === 'reduce' ? S.g.productions[st.prod].rhs.length : 0;
    S.machine.render(st, { popFrom: st.type === 'reduce' && n ? st.stack.length - n : undefined });
    var kind = '<span class="kind ' + st.type + '">' + st.type + '</span>';
    $('#parse-move').innerHTML = kind + esc(st.reason);
    S.steppers.parse.caption('');

    $$('#trace tbody tr').forEach(function (tr) {
      var k = +tr.getAttribute('data-i');
      tr.classList.toggle('future', k > i);
      tr.classList.toggle('cur', k === i);
    });
    var curRow = $('#trace tbody tr.cur');
    if (curRow && S.stage === 'parse') {
      var box = curRow.closest('.trace-sheet');
      if (curRow.offsetTop > box.scrollTop + box.clientHeight - 40 || curRow.offsetTop < box.scrollTop + 30) box.scrollTop = curRow.offsetTop - box.clientHeight / 2;
    }

    /* The tree shows the result of this move: after a reduce, the new subtree is highlighted. */
    var after = steps[i + 1] ? steps[i + 1].forest : st.forest;
    var fresh = st.type === 'reduce' && after.length ? after[after.length - 1].id : null;
    S.tree.render(after, { nonTerminals: S.g.nonTerminals, freshId: fresh });
    highlightProd(st.type === 'reduce' ? st.prod : null);

    var res = '';
    if (i === steps.length - 1) {
      if (st.type === 'accept') {
        res = '<div class="banner ok">' + ICON.okc + '<div><h3>Accepted in ' + steps.length + ' moves</h3><p>' +
          esc(S.tokens.join(' ')) + ' is a sentence of the grammar. The parse tree is complete; read its leaves left to right to get the input back.</p></div></div>';
      } else {
        var e = st.error;
        res = '<div class="banner bad">' + ICON.bad + '<div><h3>Syntax error at position ' + (e.position + 1) + '</h3><p>Unexpected ' + m(e.symbol) +
          ' in state I' + e.state + '. Symbols that were valid here: ' +
          (e.expected.length ? e.expected.map(function (x) { return '<span class="tok">' + esc(x) + '</span>'; }).join(' ') : 'none') + '.</p></div></div>';
      }
    }
    $('#parse-result').innerHTML = res;
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function goStage(name) {
    S.stage = name;
    $$('#stages button').forEach(function (b) {
      var on = b.getAttribute('data-stage') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('#visual .stage').forEach(function (sec) { sec.hidden = sec.getAttribute('data-stage') !== name; });
    Object.keys(S.steppers).forEach(function (k) { if (k !== name) S.steppers[k].pause(); });
    /* Drawings measure their container, so redraw once visible. */
    if (name === 'items' && S.an) { S.automaton.fit(true); renderItems(S.steppers.items.i); }
    if (name === 'parse' && S.sim) { S.machine.built = false; S.tree.layer = null; renderParse(S.steppers.parse.i); }
    store('slr.stage', name);
  }

  function setMode(mode) {
    S.mode = mode;
    $('#mode-visual').setAttribute('aria-selected', mode === 'visual');
    $('#mode-practice').setAttribute('aria-selected', mode === 'practice');
    $('#visual').hidden = mode !== 'visual';
    $('#practice').hidden = mode !== 'practice';
    if (mode === 'practice' && window.PracticeUI) window.PracticeUI.show();
    if (mode === 'visual') goStage(S.stage);
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function shareLink() {
    var p = new URLSearchParams();
    p.set('g', $('#grammar').value);
    p.set('w', $('#input-string').value);
    if ($('#space-only').checked) p.set('s', '1');
    var url = location.href.split('#')[0] + '#' + p.toString();
    history.replaceState(null, '', url);
    var done = function () { toast('Link copied. Opening it loads this grammar and input.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast('Link is in the address bar; copy it from there.'); });
    else toast('Link is in the address bar; copy it from there.');
  }

  function downloadCSV() {
    var t = S.an.table;
    var cols = t.terminals.concat(t.nonTerminals);
    var q = function (s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [['State'].concat(cols.map(function (c) { return (t.terminals.indexOf(c) >= 0 ? 'ACTION ' : 'GOTO ') + c; })).map(q).join(',')];
    S.an.lr0.states.forEach(function (I) {
      lines.push([String(I.id)].concat(cols.map(function (c) { return SLR.cellText(t, I.id, c); })).map(q).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'slr-table.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store('slr.theme', next);
    redrawFigures();
  }

  function redrawFigures() {
    if (!S.an) return;
    S.automaton.setData(S.an);
    renderItems(S.steppers.items.i);
    S.tree.layer = null; S.machine.built = false;
    if (S.sim) renderParse(S.steppers.parse.i);
    if (window.PracticeUI) window.PracticeUI.redraw && window.PracticeUI.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function loadExample(id, buildNow) {
    var ex = EXAMPLES.filter(function (e) { return e.id === id; })[0];
    if (!ex) return;
    S.example = ex;
    $('#grammar').value = ex.grammar;
    $('#input-string').value = ex.input;
    $('#space-only').checked = false;
    if (buildNow) build();
  }

  function init() {
    S.steppers.ff = new Stepper($('#ff-stepper'), 'ff', renderFF);
    S.steppers.items = new Stepper($('#items-stepper'), 'items', renderItems);
    S.steppers.table = new Stepper($('#table-stepper'), 'table', renderTable);
    S.steppers.parse = new Stepper($('#parse-stepper'), 'parse', renderParse);

    S.automaton = new Viz.Automaton($('#automaton'), { onSelect: selectState });
    S.tree = new Viz.ParseTree($('#tree'));
    S.machine = new Viz.Machine($('#machine'));

    var sel = $('#example');
    sel.innerHTML = '<option value="">Examples…</option>' + EXAMPLES.map(function (e) {
      return '<option value="' + e.id + '">' + esc(e.title) + '</option>';
    }).join('');
    sel.addEventListener('change', function () { if (sel.value) loadExample(sel.value, true); sel.value = ''; });

    $('#grammar-form').addEventListener('submit', function (e) { e.preventDefault(); if (build({ keepStage: true })) goStage(S.stage); });
    $('#stages').addEventListener('click', function (e) { var b = e.target.closest('button[data-stage]'); if (b) goStage(b.getAttribute('data-stage')); });
    $('#stages').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = $$('#stages button'), i = tabs.findIndex(function (b) { return b.getAttribute('aria-selected') === 'true'; });
      var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      goStage(n.getAttribute('data-stage')); n.focus(); e.preventDefault(); e.stopPropagation();
    });
    $$('.next[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goStage(b.getAttribute('data-goto')); window.scrollTo({ top: 0 }); }); });
    $('#mode-visual').addEventListener('click', function () { setMode('visual'); });
    $('#mode-practice').addEventListener('click', function () { setMode('practice'); });

    $('#ff-table').addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      S.ffSel = { kind: c.getAttribute('data-kind'), of: c.getAttribute('data-of'), sym: c.getAttribute('data-sym') };
      $$('#ff-table .chip.sel').forEach(function (x) { x.classList.remove('sel'); });
      c.classList.add('sel');
      showFFReason();
      highlightProd((S.ffSel.kind === 'FIRST' ? S.an.ff.first : S.an.ff.follow)[S.ffSel.of][S.ffSel.sym].prod);
    });
    $('#ff-log').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) { S.steppers.ff.pause(); S.steppers.ff.set(+li.getAttribute('data-i')); } });

    $('#state-inspector').addEventListener('click', function (e) { var b = e.target.closest('[data-state]'); if (b) { selectState(+b.getAttribute('data-state')); S.automaton.focusState(+b.getAttribute('data-state')); } });
    $('#itemsets').addEventListener('click', function (e) { var b = e.target.closest('[data-state]'); if (b) selectState(+b.getAttribute('data-state')); });
    $$('.figure-bar .seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        var list = b.getAttribute('data-view') === 'list';
        $$('.figure-bar .seg button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
        $('#automaton').hidden = list; $('#itemsets').hidden = !list;
        renderItems(S.steppers.items.i);
      });
    });
    $('#auto-fit').addEventListener('click', function () { S.automaton.fit(); });
    $('#auto-all').addEventListener('change', function () { S.automaton.setAllArrows(this.checked); renderItems(S.steppers.items.i); });
    $('#auto-reset').addEventListener('click', function () { S.automaton.resetLayout(); renderItems(S.steppers.items.i); });
    $('#auto-png').addEventListener('click', function () { Viz.exportPNG($('#automaton'), 'lr0-automaton.png'); });
    $('#tree-png').addEventListener('click', function () { Viz.exportPNG($('#tree'), 'parse-tree.png'); });
    $('#table-csv').addEventListener('click', downloadCSV);

    $('#lr-table').addEventListener('click', function (e) {
      var td = e.target.closest('td[data-s]'); if (!td) return;
      S.selCell = { state: +td.getAttribute('data-s'), sym: td.getAttribute('data-c') };
      renderTable(S.steppers.table.i);
    });
    $('#cell-inspector').addEventListener('click', function (e) {
      var b = e.target.closest('[data-show-state]'); if (!b) return;
      goStage('items'); S.steppers.items.set(S.steppers.items.count - 1); selectState(+b.getAttribute('data-show-state')); S.automaton.focusState(+b.getAttribute('data-show-state'));
    });
    $('#conflict-body').addEventListener('click', function (e) {
      var b = e.target.closest('[data-show-cell]'); if (!b) return;
      var parts = b.getAttribute('data-show-cell').split('|');
      S.selCell = { state: +parts[0], sym: parts[1] };
      goStage('table'); S.steppers.table.set(S.steppers.table.count - 1);
    });
    $('#trace').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) { S.steppers.parse.pause(); S.steppers.parse.set(+tr.getAttribute('data-i')); } });

    $('#share').addEventListener('click', shareLink);
    $('#print').addEventListener('click', function () { window.print(); });
    $('#theme').addEventListener('click', toggleTheme);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (!document.documentElement.getAttribute('data-theme')) redrawFigures(); });

    /* Keyboard: ← → step, Space run/pause, Home/End, in the active stage. */
    document.addEventListener('keydown', function (e) {
      if (S.mode !== 'visual' || e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.target.closest && e.target.closest('#stages')) return;
      var st = S.steppers[S.stage]; if (!st) return;
      if (e.key === 'ArrowRight') { st.pause(); st.set(st.i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { st.pause(); st.set(st.i - 1); e.preventDefault(); }
      else if (e.key === 'Home') { st.pause(); st.set(0); e.preventDefault(); }
      else if (e.key === 'End') { st.pause(); st.set(st.count - 1); e.preventDefault(); }
      else if (e.key === ' ' && tag !== 'button') { st.toggle(); e.preventDefault(); }
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (S.stage === 'parse' && S.sim) { S.machine.built = false; renderParse(S.steppers.parse.i); }
      }, 150);
    });

    /* Initial content: shared link > last session > the project's worked example. */
    var params = new URLSearchParams(location.hash.slice(1));
    var last = null;
    try { last = JSON.parse(store('slr.last') || 'null'); } catch (e) { last = null; }
    if (params.get('g')) {
      $('#grammar').value = params.get('g'); $('#input-string').value = params.get('w') || ''; $('#space-only').checked = params.get('s') === '1';
    } else if (last && last.g) {
      $('#grammar').value = last.g; $('#input-string').value = last.w || ''; $('#space-only').checked = !!last.s;
      S.example = EXAMPLES.filter(function (e) { return e.grammar === last.g; })[0] || null;
    } else {
      loadExample('expr', false);
    }
    var savedStage = store('slr.stage');
    if (savedStage && S.steppers[savedStage] || savedStage === 'grammar' || savedStage === 'conflicts') S.stage = savedStage;
    if (!build()) { loadExample('expr', false); build(); }
    goStage(S.stage);
  }

  window.App = {
    state: S, build: build, goStage: goStage, setMode: setMode, toast: toast, esc: esc, m: m, store: store,
    onBuild: function (fn) { S.listeners.push(fn); }, itemsListHTML: itemsListHTML, stackText: stackText, ICON: ICON
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
