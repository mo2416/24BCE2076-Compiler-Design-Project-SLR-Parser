/*
 * core.js — the shared session layer every interface template drives.
 *
 * Wraps the engine (grammar.js + slr.js) and answers "what does stage X look
 * like at step i?" as plain data. Templates only decide how to draw it, so all
 * five interfaces show exactly the same construction.
 *
 * Also provides one global timeline across stages:
 *   FIRST/FOLLOW steps → LR(0) steps → table fills → parse moves
 * so a template can drive everything from a single scrubber.
 */
(function (root) {
  'use strict';

  var G = root.Grammar, SLR = root.SLR;
  var STAGES = ['ff', 'items', 'table', 'parse'];
  var STAGE_NAMES = { grammar: 'Grammar', ff: 'FIRST & FOLLOW', items: 'LR(0) items', table: 'Parsing table', conflicts: 'Conflicts', parse: 'Parse' };

  function esc(x) {
    return String(x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ------------------------------------------------------------------ */
  /* Building a session                                                  */
  /* ------------------------------------------------------------------ */

  function build(cfg) {
    var g;
    try { g = G.parseGrammar(cfg.grammar, { spaceOnly: !!cfg.spaceOnly }); }
    catch (e) { return { ok: false, error: e.message, where: 'grammar' }; }
    var an = SLR.analyze(g);
    var tokens = null, tokenError = null;
    try { tokens = G.tokenizeInput(cfg.input || '', g); } catch (e) { tokenError = e.message; }
    var sim = tokens ? SLR.simulate(g, an.table, tokens) : null;

    var s = { cfg: cfg, g: g, an: an, tokens: tokens, tokenError: tokenError, sim: sim };
    s.counts = { ff: an.ff.steps.length, items: an.lr0.steps.length, table: an.table.fills.length, parse: sim ? sim.steps.length : 0 };
    s.timeline = [];
    s.ranges = {};
    STAGES.forEach(function (st) {
      var start = s.timeline.length;
      for (var i = 0; i < s.counts[st]; i++) s.timeline.push({ stage: st, i: i });
      s.ranges[st] = [start, s.timeline.length - 1];
    });
    save(cfg);
    return { ok: true, s: s };
  }

  /* Local index of a stage when the global timeline is at position gi: -1 before it starts. */
  function localIndex(s, stage, gi) {
    var r = s.ranges[stage];
    if (!r || r[1] < r[0]) return -1;
    if (gi < r[0]) return -1;
    return Math.min(gi, r[1]) - r[0];
  }
  function globalIndex(s, stage, i) { return s.ranges[stage][0] + i; }
  function locate(s, gi) { return s.timeline[Math.max(0, Math.min(s.timeline.length - 1, gi))]; }

  /* ------------------------------------------------------------------ */
  /* Grammar                                                             */
  /* ------------------------------------------------------------------ */

  function prods(s) {
    return s.g.productions.map(function (p) { return { index: p.index, text: SLR.prodStr(p), lhs: p.lhs, rhs: p.rhs }; });
  }

  function grammarInfo(s) {
    var seen = {};
    return {
      start: s.g.start, augmented: s.g.augmentedStart,
      nonTerminals: s.g.nonTerminals, terminals: s.g.terminals,
      productions: prods(s), warnings: s.g.warnings,
      splits: s.g.splits.filter(function (x) { if (seen[x.text]) return false; seen[x.text] = 1; return true; }),
      tokens: s.tokens, tokenError: s.tokenError,
      verdict: { isSLR: s.an.table.isSLR, isLR0: s.an.table.isLR0, states: s.an.lr0.states.length, conflicts: s.an.table.conflicts.length }
    };
  }

  /* ------------------------------------------------------------------ */
  /* FIRST / FOLLOW at step i                                            */
  /* ------------------------------------------------------------------ */

  function ff(s, i) {
    var steps = s.an.ff.steps, shown = {};
    steps.slice(0, i + 1).forEach(function (st) { shown[st.kind + ':' + st.of + ':' + st.sym] = true; });
    var cur = i >= 0 ? steps[i] : null;
    var rows = s.g.nonTerminals.map(function (A) {
      function list(kind) {
        var set = kind === 'FIRST' ? s.an.ff.first[A] : s.an.ff.follow[A];
        return Object.keys(set).filter(function (x) { return shown[kind + ':' + A + ':' + x]; }).map(function (x) {
          return { sym: x, isNew: !!(cur && cur.kind === kind && cur.of === A && cur.sym === x), reason: set[x].reason };
        });
      }
      return { nt: A, first: list('FIRST'), follow: list('FOLLOW') };
    });
    return {
      rows: rows, cur: cur, steps: steps,
      text: cur ? cur.sym + ' ∈ ' + cur.kind + '(' + cur.of + ') — ' + cur.reason : 'Nothing computed yet.'
    };
  }

  function setReason(s, kind, A, sym) {
    var set = kind === 'FIRST' ? s.an.ff.first[A] : s.an.ff.follow[A];
    return set && set[sym] ? set[sym].reason : '';
  }

  /* ------------------------------------------------------------------ */
  /* LR(0) items at step i                                               */
  /* ------------------------------------------------------------------ */

  function items(s, i) {
    var steps = s.an.lr0.steps, states = new Set(), edges = new Set();
    steps.slice(0, Math.max(0, i) + 1).forEach(function (st) {
      states.add(st.state);
      if (st.from !== null && st.from !== undefined) edges.add(st.from + '>' + st.state + ':' + st.sym);
    });
    var cur = steps[Math.max(0, i)];
    if (i < 0) { states = new Set(); edges = new Set(); }
    return {
      states: states, edges: edges, cur: i < 0 ? null : cur,
      current: i < 0 ? null : cur.state,
      currentEdge: i >= 0 && cur.from !== null && cur.from !== undefined ? { from: cur.from, to: cur.state } : null,
      conflictStates: new Set(s.an.table.conflicts.map(function (c) { return c.state; })),
      text: i < 0 ? 'Not started.' : cur.text
    };
  }

  function originOf(s, id) {
    if (id === 0) return 'closure({ ' + SLR.itemStr(s.g, { p: 0, d: 0 }) + ' })';
    var st = s.an.lr0.steps.filter(function (x) { return x.type === 'new' && x.state === id; })[0];
    return st ? 'goto(I' + st.from + ', ' + st.sym + ')' : '';
  }

  function itemLines(s, I, hlKeys) {
    return I.items.map(function (it) {
      var why = null;
      if (!it.kernel) {
        var f = it.from.split('.');
        why = 'closure of ' + SLR.itemStr(s.g, { p: +f[0], d: +f[1] });
      }
      return { text: SLR.itemStr(s.g, it), kernel: it.kernel, why: why, key: SLR.itemKey(it), hl: !!(hlKeys && hlKeys.indexOf(SLR.itemKey(it)) >= 0), complete: SLR.afterDot(s.g, it) === null };
    });
  }

  function stateInfo(s, id) {
    var I = s.an.lr0.states[id];
    if (!I) return null;
    var completed = [];
    I.items.forEach(function (it) {
      if (SLR.afterDot(s.g, it) === null) completed.push(it.p === 0 ? 'accept on $' : 'reduce by (' + it.p + ') ' + SLR.prodStr(s.g.productions[it.p]));
    });
    return { id: id, origin: originOf(s, id), items: itemLines(s, I), kernelCount: I.kernel.length, completed: completed, transitions: I.transitions.slice() };
  }

  /* ------------------------------------------------------------------ */
  /* Table at step i                                                     */
  /* ------------------------------------------------------------------ */

  function key(a, b) { return a + '\u0001' + b; }

  function tableAt(s, i) {
    var t = s.an.table, acc = {};
    t.fills.slice(0, i + 1).forEach(function (f) { (acc[key(f.state, f.sym)] = acc[key(f.state, f.sym)] || []).push(f.entry); });
    var cur = i >= 0 ? t.fills[i] : null;
    var cols = t.terminals.concat(t.nonTerminals);
    var rows = s.an.lr0.states.map(function (I) {
      return {
        state: I.id,
        cells: cols.map(function (c) {
          var list = acc[key(I.id, c)] || [];
          var kind = list.length > 1 ? 'conf' : list.length ? (list[0].type === 'g' ? 'g' : list[0].type) : '';
          return { sym: c, text: list.map(SLR.entryStr).join('/'), kind: kind, cur: !!(cur && cur.state === I.id && cur.sym === c), isGoto: t.nonTerminals.indexOf(c) >= 0 };
        })
      };
    });
    return { terminals: t.terminals, nonTerminals: t.nonTerminals, rows: rows, cur: cur, acc: acc, text: cur ? cur.entry.reason + (cur.conflict ? ' — the cell already had an entry: conflict.' : '') : 'Table empty.' };
  }

  /* Why a cell holds what it holds (or is blank). i limits to the entries filled so far. */
  function cellInfo(s, state, sym, i) {
    var t = s.an.table, g = s.g, I = s.an.lr0.states[state];
    var at = tableAt(s, i === undefined ? t.fills.length - 1 : i);
    var entries = at.acc[key(state, sym)] || [];
    var isGoto = t.nonTerminals.indexOf(sym) >= 0;
    var full = SLR.cellText(t, state, sym);
    var out = { title: (isGoto ? 'GOTO' : 'ACTION') + '[' + state + ', ' + sym + ']', state: state, sym: sym, origin: originOf(s, state), entries: [], blank: null, pending: null, conflict: entries.length > 1 };
    var hl = [];
    if (!entries.length) {
      if (full) out.pending = 'Not filled yet at this step. Final entry: ' + full + '.';
      else if (isGoto) out.blank = 'I' + state + ' has no item with ' + sym + ' after the dot, so goto(I' + state + ', ' + sym + ') is empty. Blank means error.';
      else {
        var parts = ['No item in I' + state + ' has ' + sym + ' after the dot, so there is no shift.'];
        I.items.forEach(function (it) {
          if (SLR.afterDot(g, it) === null && it.p !== 0) {
            var A = g.productions[it.p].lhs;
            parts.push(SLR.itemStr(g, it) + ' is complete, but ' + sym + ' ∉ FOLLOW(' + A + ') = { ' + Object.keys(s.an.ff.follow[A]).join(', ') + ' }, so no reduce.');
          }
        });
        parts.push('The cell stays blank: an error entry.');
        out.blank = parts.join(' ');
      }
    }
    entries.forEach(function (e) {
      hl = hl.concat(e.items || []);
      var o = { tag: SLR.entryStr(e), type: e.type, rule: { a: 'rule 2(a) · shift', b: 'rule 2(b) · reduce', c: 'rule 2(c) · accept', 3: 'rule 3 · goto' }[e.rule] || '', reason: e.reason };
      if (e.type === 'r') {
        var A = g.productions[e.prod].lhs;
        o.follow = 'FOLLOW(' + A + ') = { ' + Object.keys(s.an.ff.follow[A]).join(', ') + ' }';
      }
      out.entries.push(o);
    });
    out.items = itemLines(s, I, hl);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Conflicts                                                           */
  /* ------------------------------------------------------------------ */

  function conflicts(s) {
    var t = s.an.table, g = s.g;
    return {
      isSLR: t.isSLR, isLR0: t.isLR0,
      list: t.conflicts.map(function (c) {
        return {
          type: c.type, state: c.state, sym: c.sym, cell: c.entries.map(SLR.entryStr).join(' / '),
          entries: c.entries.map(function (e) { return { tag: SLR.entryStr(e), reason: e.reason }; }),
          items: itemLines(s, s.an.lr0.states[c.state], c.items), explain: c.explain
        };
      }),
      lr0: t.lr0Conflicts.map(function (c) {
        var I = s.an.lr0.states[c.state], parts = [];
        I.items.forEach(function (it) {
          var X = SLR.afterDot(g, it);
          if (X === null && it.p !== 0) {
            var A = g.productions[it.p].lhs;
            parts.push(SLR.itemStr(g, it) + ' reduces on FOLLOW(' + A + ') = { ' + Object.keys(s.an.ff.follow[A]).join(', ') + ' }');
          } else if (X && g.nonTerminals.indexOf(X) < 0) parts.push(SLR.itemStr(g, it) + ' shifts on ' + X);
        });
        return { state: c.state, type: c.type, parts: parts, resolved: !t.conflicts.some(function (x) { return x.state === c.state; }) };
      })
    };
  }

  /* ------------------------------------------------------------------ */
  /* Parse at step i                                                     */
  /* ------------------------------------------------------------------ */

  function stackText(stack) {
    return stack.map(function (e) { return (e.sym === null ? '' : e.sym + ' ') + e.state; }).join(' ');
  }

  function actionText(s, st) {
    if (st.type === 'shift') return 'shift ' + st.action.slice(1);
    if (st.type === 'reduce') return 'reduce ' + SLR.prodStr(s.g.productions[st.prod]);
    return st.type;
  }

  function parse(s, i) {
    if (!s.sim || i < 0) return null;
    var steps = s.sim.steps, st = steps[Math.min(i, steps.length - 1)];
    var n = st.type === 'reduce' ? s.g.productions[st.prod].rhs.length : 0;
    var after = steps[i + 1] ? steps[i + 1].forest : st.forest;
    var last = i >= steps.length - 1;
    return {
      step: st, index: i, count: steps.length, kind: st.type, reason: st.reason, prod: st.prod,
      stack: stackText(st.stack), input: st.input.slice(st.ip).join(' '), action: actionText(s, st),
      forest: after, fresh: st.type === 'reduce' && after.length ? after[after.length - 1].id : null,
      popFrom: st.type === 'reduce' && n ? st.stack.length - n : undefined,
      done: last, accepted: last && st.type === 'accept', error: last && st.type === 'error' ? st.error : null
    };
  }

  function traceRows(s) {
    if (!s.sim) return [];
    return s.sim.steps.map(function (st, i) {
      return { n: i + 1, stack: stackText(st.stack), input: st.input.slice(st.ip).join(' '), action: actionText(s, st), type: st.type, conflict: !!st.conflict, short: st.action || st.type };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Persistence, sharing, export                                        */
  /* ------------------------------------------------------------------ */

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }
  function save(cfg) { store('slr.last', JSON.stringify({ g: cfg.grammar, w: cfg.input, s: !!cfg.spaceOnly })); }

  /* Initial grammar: shared link > last session (any template) > the expression grammar. */
  function initial() {
    var p = new URLSearchParams(location.hash.slice(1));
    if (p.get('g')) return { grammar: p.get('g'), input: p.get('w') || '', spaceOnly: p.get('s') === '1' };
    try {
      var last = JSON.parse(store('slr.last') || 'null');
      if (last && last.g) return { grammar: last.g, input: last.w || '', spaceOnly: !!last.s };
    } catch (e) { /* ignore */ }
    var ex = root.EXAMPLES[0];
    return { grammar: ex.grammar, input: ex.input, spaceOnly: false };
  }

  function shareURL(cfg) {
    var p = new URLSearchParams();
    p.set('g', cfg.grammar); p.set('w', cfg.input || '');
    if (cfg.spaceOnly) p.set('s', '1');
    return location.href.split('#')[0] + '#' + p.toString();
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('no clipboard'));
  }

  function downloadCSV(s) {
    var t = s.an.table, cols = t.terminals.concat(t.nonTerminals);
    var q = function (x) { return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lines = [['State'].concat(cols.map(function (c) { return (t.terminals.indexOf(c) >= 0 ? 'ACTION ' : 'GOTO ') + c; })).map(q).join(',')];
    s.an.lr0.states.forEach(function (I) { lines.push([String(I.id)].concat(cols.map(function (c) { return SLR.cellText(t, I.id, c); })).map(q).join(',')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'slr-table.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function example(id) { return root.EXAMPLES.filter(function (e) { return e.id === id; })[0] || null; }
  function exampleFor(grammarText) { return root.EXAMPLES.filter(function (e) { return e.grammar === grammarText; })[0] || null; }

  /* Graph layering for templates that draw their own automaton: BFS depth = column. */
  function layers(s) {
    var st = s.an.lr0.states, depth = { 0: 0 }, q = [0], cols = [];
    while (q.length) {
      var x = q.shift();
      st[x].transitions.forEach(function (t) { if (depth[t.to] === undefined) { depth[t.to] = depth[x] + 1; q.push(t.to); } });
    }
    st.forEach(function (I) { (cols[depth[I.id]] = cols[depth[I.id]] || []).push(I.id); });
    var pos = {};
    cols.forEach(function (c, ci) { c.forEach(function (id, ri) { pos[id] = { col: ci, row: ri, rows: c.length }; }); });
    var edges = [];
    st.forEach(function (I) { I.transitions.forEach(function (t) { edges.push({ from: I.id, to: t.to, sym: t.sym, nt: s.g.nonTerminals.indexOf(t.sym) >= 0 }); }); });
    return { pos: pos, cols: cols, edges: edges };
  }

  root.Core = {
    layers: layers,
    STAGES: STAGES, STAGE_NAMES: STAGE_NAMES, esc: esc,
    build: build, localIndex: localIndex, globalIndex: globalIndex, locate: locate,
    grammarInfo: grammarInfo, prods: prods,
    ff: ff, setReason: setReason,
    items: items, stateInfo: stateInfo, originOf: originOf, itemLines: itemLines,
    tableAt: tableAt, cellInfo: cellInfo,
    conflicts: conflicts,
    parse: parse, traceRows: traceRows, stackText: stackText,
    store: store, initial: initial, shareURL: shareURL, copy: copy, downloadCSV: downloadCSV,
    example: example, exampleFor: exampleFor, examples: function () { return root.EXAMPLES; }
  };
})(this);
