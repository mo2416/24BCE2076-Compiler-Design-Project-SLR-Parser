/*
 * slr.js — the SLR(1) construction engine.
 *
 * Every stage records the steps it took, so the interface can replay the
 * construction instead of only showing the finished result:
 *
 *   computeFirstFollow(g)   FIRST and FOLLOW sets + the reason each symbol was added
 *   buildLR0(g)             canonical collection of LR(0) items via closure and goto
 *   buildTable(g, ff, lr0)  ACTION/GOTO table, the fill order, and conflicts
 *   simulate(g, table, w)   shift-reduce parse of w with stack / input / tree per move
 *
 * The module has no DOM dependencies, so it runs unchanged in Node for tests.
 */
(function (root) {
  'use strict';

  var EPS = 'ε';
  var END = '$';

  function isNT(g, s) { return g.nonTerminals.indexOf(s) >= 0; }
  function prodStr(p) { return p.lhs + ' → ' + (p.rhs.length ? p.rhs.join(' ') : EPS); }

  /* ------------------------------------------------------------------ */
  /* FIRST and FOLLOW                                                    */
  /* ------------------------------------------------------------------ */

  function computeFirstFollow(g) {
    var first = {}, follow = {}, steps = [];
    g.nonTerminals.forEach(function (A) { first[A] = {}; follow[A] = {}; });

    function firstOfSymbol(X) {
      if (!isNT(g, X)) { var t = {}; t[X] = true; return t; }
      return first[X];
    }

    /* FIRST of a sequence X1..Xn, and whether the whole sequence can derive ε. */
    function firstOfSeq(seq) {
      var out = {}, nullable = true;
      for (var i = 0; i < seq.length; i++) {
        var f = firstOfSymbol(seq[i]);
        Object.keys(f).forEach(function (s) { if (s !== EPS) out[s] = true; });
        if (!f[EPS]) { nullable = false; break; }
      }
      return { set: out, nullable: nullable };
    }

    function add(kind, table, A, sym, reason, prod, pass) {
      if (table[A][sym]) return false;
      table[A][sym] = { reason: reason, prod: prod ? prod.index : null, pass: pass };
      steps.push({ kind: kind, of: A, sym: sym, reason: reason, prod: prod ? prod.index : null, pass: pass });
      return true;
    }

    /* FIRST: apply the three rules to every production until nothing changes. */
    var changed = true, pass = 0;
    while (changed) {
      changed = false; pass++;
      g.productions.forEach(function (p) {
        var A = p.lhs;
        if (p.rhs.length === 0) {
          if (add('FIRST', first, A, EPS, '(' + p.index + ') ' + prodStr(p) + ' derives ε directly', p, pass)) changed = true;
          return;
        }
        for (var i = 0; i < p.rhs.length; i++) {
          var X = p.rhs[i];
          var prefix = i === 0 ? '' : ', since ' + p.rhs.slice(0, i).join(' ') + ' can derive ε';
          if (!isNT(g, X)) {
            if (add('FIRST', first, A, X, X + ' begins the right side of (' + p.index + ') ' + prodStr(p) + prefix, p, pass)) changed = true;
            return;
          }
          Object.keys(first[X]).forEach(function (s) {
            if (s === EPS) return;
            if (add('FIRST', first, A, s, 'FIRST(' + X + ') ⊆ FIRST(' + A + ') by (' + p.index + ') ' + prodStr(p) + prefix, p, pass)) changed = true;
          });
          if (!first[X][EPS]) return;
        }
        if (add('FIRST', first, A, EPS, 'every symbol of (' + p.index + ') ' + prodStr(p) + ' can derive ε', p, pass)) changed = true;
      });
    }
    var firstPasses = pass;

    /* FOLLOW rule 1: $ follows the start symbol. */
    add('FOLLOW', follow, g.augmentedStart, END, '$ is placed in FOLLOW of the start symbol ' + g.augmentedStart, null, 0);
    changed = true; pass = 0;
    while (changed) {
      changed = false; pass++;
      g.productions.forEach(function (p) {
        for (var i = 0; i < p.rhs.length; i++) {
          var B = p.rhs[i];
          if (!isNT(g, B)) continue;
          var beta = p.rhs.slice(i + 1);
          var fb = firstOfSeq(beta);
          /* Rule 2: A → α B β gives FIRST(β) − {ε} ⊆ FOLLOW(B). */
          Object.keys(fb.set).forEach(function (s) {
            var why = (beta.length && !isNT(g, beta[0]) && beta[0] === s)
              ? s + ' comes right after ' + B + ' in (' + p.index + ') ' + prodStr(p)
              : 'FIRST(' + beta.join(' ') + ') ⊆ FOLLOW(' + B + ') by (' + p.index + ') ' + prodStr(p);
            if (add('FOLLOW', follow, B, s, why, p, pass)) changed = true;
          });
          /* Rule 3: A → α B, or β ⇒* ε, gives FOLLOW(A) ⊆ FOLLOW(B). */
          if (fb.nullable && B !== p.lhs) {
            Object.keys(follow[p.lhs]).forEach(function (s) {
              var why = 'FOLLOW(' + p.lhs + ') ⊆ FOLLOW(' + B + ') because ' + B +
                (beta.length ? ' is followed only by symbols that can derive ε' : ' ends the right side') +
                ' of (' + p.index + ') ' + prodStr(p);
              if (add('FOLLOW', follow, B, s, why, p, pass)) changed = true;
            });
          }
        }
      });
    }

    return { first: first, follow: follow, steps: steps, firstOfSeq: firstOfSeq, passes: { first: firstPasses, follow: pass } };
  }

  /* ------------------------------------------------------------------ */
  /* LR(0) items: closure, goto, canonical collection                    */
  /* ------------------------------------------------------------------ */

  /* An item is { p: production index, d: dot position }. */
  function itemKey(it) { return it.p + '.' + it.d; }

  function itemStr(g, it) {
    var p = g.productions[it.p];
    var syms = p.rhs.slice();
    syms.splice(it.d, 0, '•');
    return p.lhs + ' → ' + syms.join(' ');
  }

  function afterDot(g, it) {
    var p = g.productions[it.p];
    return it.d < p.rhs.length ? p.rhs[it.d] : null;
  }

  /* closure(kernel): items in insertion order; each added item records the item that caused it. */
  function closure(g, kernel) {
    var items = kernel.map(function (it) { return { p: it.p, d: it.d, kernel: true, from: null }; });
    var seen = {};
    items.forEach(function (it) { seen[itemKey(it)] = true; });
    for (var i = 0; i < items.length; i++) {
      var B = afterDot(g, items[i]);
      if (!B || !isNT(g, B)) continue;
      for (var j = 0; j < g.productions.length; j++) {
        var p = g.productions[j];
        if (p.lhs !== B) continue;
        var k = p.index + '.0';
        if (seen[k]) continue;
        seen[k] = true;
        items.push({ p: p.index, d: 0, kernel: false, from: itemKey(items[i]) });
      }
    }
    return items;
  }

  /* goto(I, X) kernel: move the dot over X in every item of I that has X after the dot. */
  function gotoKernel(g, items, X) {
    var k = [];
    items.forEach(function (it) {
      if (afterDot(g, it) === X) k.push({ p: it.p, d: it.d + 1 });
    });
    return k;
  }

  function kernelSig(kernel) { return kernel.map(itemKey).sort().join('|'); }

  /*
   * States are numbered in discovery order: each state's transitions are explored
   * in the order their symbols appear after the dot. This reproduces the textbook
   * numbering (I0..I11 for the expression grammar, I0..I6 for S → AA).
   */
  function buildLR0(g) {
    var states = [], steps = [], bySig = {};

    function makeState(kernel) {
      var s = { id: states.length, kernel: kernel, items: closure(g, kernel), transitions: [] };
      states.push(s);
      bySig[kernelSig(kernel)] = s.id;
      return s;
    }

    makeState([{ p: 0, d: 0 }]);
    steps.push({ type: 'start', state: 0, from: null, sym: null,
      text: 'I0 = closure({ ' + itemStr(g, { p: 0, d: 0 }) + ' })' });

    for (var i = 0; i < states.length; i++) {
      var I = states[i];
      var order = [];
      I.items.forEach(function (it) {
        var X = afterDot(g, it);
        if (X && order.indexOf(X) < 0) order.push(X);
      });
      order.forEach(function (X) {
        var k = gotoKernel(g, I.items, X);
        var sig = kernelSig(k);
        var isNew = !bySig.hasOwnProperty(sig);
        var target = isNew ? makeState(k).id : bySig[sig];
        I.transitions.push({ sym: X, to: target });
        steps.push({
          type: isNew ? 'new' : 'existing', from: I.id, sym: X, state: target,
          text: 'goto(I' + I.id + ', ' + X + ') = ' + (isNew ? 'new state I' + target : 'I' + target + ', already in the collection')
        });
      });
    }
    return { states: states, steps: steps };
  }

  /* ------------------------------------------------------------------ */
  /* SLR(1) ACTION / GOTO table                                          */
  /* ------------------------------------------------------------------ */

  function entryStr(e) {
    if (e.type === 's') return 's' + e.to;
    if (e.type === 'r') return 'r' + e.prod;
    if (e.type === 'acc') return 'acc';
    return String(e.to);
  }

  function buildTable(g, ff, lr0) {
    var terms = g.terminals.concat([END]);
    var nts = g.nonTerminals.slice(1); /* GOTO columns leave out the augmented start */
    var action = {}, gotoT = {}, fills = [], conflicts = [];

    lr0.states.forEach(function (I) {
      action[I.id] = {}; gotoT[I.id] = {};
      terms.forEach(function (a) { action[I.id][a] = []; });
    });

    function put(stateId, sym, entry) {
      var cell = action[stateId][sym];
      var same = cell.filter(function (e) { return entryStr(e) === entryStr(entry); })[0];
      if (same) {
        /* Another item gives the identical action: record it as an extra cause only. */
        if (same.items.indexOf(entry.items[0]) < 0) same.items.push(entry.items[0]);
        return;
      }
      cell.push(entry);
      fills.push({ table: 'action', state: stateId, sym: sym, entry: entry, conflict: cell.length > 1 });
    }

    lr0.states.forEach(function (I) {
      I.items.forEach(function (it) {
        var p = g.productions[it.p];
        var X = afterDot(g, it);
        var key = itemKey(it);
        if (X && !isNT(g, X)) {
          /* Rule 2(a): [A → α • a β] in Ii and goto(Ii, a) = Ij  ⇒  shift j */
          var to = I.transitions.filter(function (t) { return t.sym === X; })[0].to;
          put(I.id, X, { type: 's', to: to, items: [key], rule: 'a',
            reason: itemStr(g, it) + ' is in I' + I.id + ' and goto(I' + I.id + ', ' + X + ') = I' + to +
              ', so ACTION[' + I.id + ', ' + X + '] = shift ' + to });
        } else if (!X) {
          if (it.p === 0) {
            /* Rule 2(c): [S' → S •] in Ii  ⇒  accept on $ */
            put(I.id, END, { type: 'acc', items: [key], rule: 'c',
              reason: itemStr(g, it) + ' is in I' + I.id + ', so ACTION[' + I.id + ', $] = accept' });
          } else {
            /* Rule 2(b): [A → α •] in Ii  ⇒  reduce for every a in FOLLOW(A) */
            var fol = Object.keys(ff.follow[p.lhs]);
            terms.forEach(function (a) {
              if (fol.indexOf(a) < 0) return;
              put(I.id, a, { type: 'r', prod: p.index, items: [key], follow: p.lhs, rule: 'b',
                reason: itemStr(g, it) + ' is complete and ' + a + ' ∈ FOLLOW(' + p.lhs + ') = { ' + fol.join(', ') +
                  ' }, so ACTION[' + I.id + ', ' + a + '] = reduce by (' + p.index + ') ' + prodStr(p) });
            });
          }
        }
      });
      /* Rule 3: goto(Ii, A) = Ij  ⇒  GOTO[i, A] = j */
      I.transitions.forEach(function (t) {
        if (!isNT(g, t.sym)) return;
        gotoT[I.id][t.sym] = t.to;
        fills.push({ table: 'goto', state: I.id, sym: t.sym, entry: { type: 'g', to: t.to, rule: '3',
          reason: 'goto(I' + I.id + ', ' + t.sym + ') = I' + t.to + ', so GOTO[' + I.id + ', ' + t.sym + '] = ' + t.to } });
      });
    });

    lr0.states.forEach(function (I) {
      terms.forEach(function (a) {
        var cell = action[I.id][a];
        if (cell.length < 2) return;
        var reduces = cell.filter(function (e) { return e.type === 'r'; });
        var shifts = cell.filter(function (e) { return e.type === 's'; });
        var type = shifts.length && reduces.length ? 'shift-reduce' : 'reduce-reduce';
        var items = [];
        cell.forEach(function (e) { e.items.forEach(function (k) { if (items.indexOf(k) < 0) items.push(k); }); });
        var lhsList = reduces.map(function (r) { return g.productions[r.prod].lhs; });
        var explain = type === 'shift-reduce'
          ? 'I' + I.id + ' has a transition on ' + a + ' (shift), and ' + a + ' is also in FOLLOW(' + lhsList.join(', ') +
            ') of a completed item (reduce). On lookahead ' + a + ' the parser cannot choose between shifting and reducing.'
          : 'I' + I.id + ' has completed items for ' + lhsList.join(' and ') + ', and ' + a + ' is in ' +
            lhsList.map(function (A) { return 'FOLLOW(' + A + ')'; }).join(' ∩ ') +
            '. On lookahead ' + a + ' the parser cannot choose which production to reduce by.';
        conflicts.push({ state: I.id, sym: a, type: type, entries: cell.slice(), items: items, explain: explain });
      });
    });

    /* LR(0) check: a completed item together with any other action makes the grammar not LR(0). */
    var lr0Conflicts = [];
    lr0.states.forEach(function (I) {
      var complete = I.items.filter(function (it) { return !afterDot(g, it) && it.p !== 0; });
      var shiftsT = I.items.filter(function (it) { var X = afterDot(g, it); return X && !isNT(g, X); });
      if (complete.length > 1 || (complete.length && shiftsT.length)) {
        lr0Conflicts.push({ state: I.id, type: complete.length > 1 ? 'reduce-reduce' : 'shift-reduce' });
      }
    });

    return {
      terminals: terms, nonTerminals: nts, action: action, goto: gotoT,
      fills: fills, conflicts: conflicts, isSLR: conflicts.length === 0,
      lr0Conflicts: lr0Conflicts, isLR0: lr0Conflicts.length === 0
    };
  }

  /* Text of a cell as printed in the table: "" when empty, "s3/r2" when in conflict. */
  function cellText(table, state, sym) {
    if (table.action[state] && table.action[state].hasOwnProperty(sym)) {
      return table.action[state][sym].map(entryStr).join('/');
    }
    var gv = table.goto[state] && table.goto[state][sym];
    return gv === undefined ? '' : String(gv);
  }

  /* ------------------------------------------------------------------ */
  /* Shift-reduce parse simulation                                       */
  /* ------------------------------------------------------------------ */

  /*
   * simulate(g, table, tokens) -> { steps, accepted, error, tree }
   * Each step is a full snapshot (stack, input pointer, forest of subtrees) taken
   * before the move is applied, so the interface can step backwards freely.
   * When a cell holds a conflict the first entry is used and the step says so.
   */
  function simulate(g, table, tokens, limit) {
    limit = limit || 5000;
    var nodeSeq = 0;
    function node(sym, children, prod) { return { id: ++nodeSeq, sym: sym, children: children || [], prod: prod }; }

    var input = tokens.concat([END]);
    var stack = [{ state: 0, sym: null }];
    var forest = [];
    var ip = 0, steps = [];

    function snapshot(extra) {
      var s = { stack: stack.map(function (e) { return { state: e.state, sym: e.sym }; }), ip: ip, input: input, forest: forest.slice() };
      Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
      s.index = steps.length;
      steps.push(s);
      return s;
    }

    while (steps.length < limit) {
      var top = stack[stack.length - 1].state;
      var a = input[ip];
      var cell = table.action[top][a] || [];
      if (!cell.length) {
        var expected = table.terminals.filter(function (t) { return table.action[top][t].length; });
        var err = { position: ip, symbol: a, expected: expected, state: top };
        snapshot({ type: 'error', cell: { state: top, sym: a }, error: err,
          reason: 'ACTION[' + top + ', ' + a + '] is empty, so there is no valid move. Expected one of: ' + (expected.join('  ') || 'nothing') });
        return { steps: steps, accepted: false, error: err };
      }
      var e = cell[0];
      var conflictNote = cell.length > 1 ? ' — this cell is a conflict (' + cell.map(entryStr).join(' / ') + '); the simulation takes ' + entryStr(e) : '';

      if (e.type === 'acc') {
        snapshot({ type: 'accept', cell: { state: top, sym: a }, action: 'acc', conflict: cell.length > 1,
          reason: 'ACTION[' + top + ', $] = accept: the whole input reduces to ' + g.start + conflictNote });
        return { steps: steps, accepted: true, tree: forest[forest.length - 1] };
      }
      if (e.type === 's') {
        snapshot({ type: 'shift', cell: { state: top, sym: a }, action: 's' + e.to, conflict: cell.length > 1,
          reason: 'ACTION[' + top + ', ' + a + '] = s' + e.to + ': push ' + a + ' and state ' + e.to + ', then advance the input' + conflictNote });
        stack.push({ state: e.to, sym: a });
        forest.push(node(a));
        ip++;
        continue;
      }

      var p = g.productions[e.prod];
      var n = p.rhs.length;
      var popped = stack.slice(stack.length - n);
      var below = stack[stack.length - 1 - n].state;
      var gto = table.goto[below][p.lhs];
      snapshot({ type: 'reduce', cell: { state: top, sym: a }, action: 'r' + p.index, prod: p.index, conflict: cell.length > 1,
        gotoCell: { state: below, sym: p.lhs, to: gto },
        reason: 'ACTION[' + top + ', ' + a + '] = r' + p.index + ': reduce by ' + prodStr(p) + '. ' +
          (n ? 'Pop ' + popped.map(function (x) { return x.sym + ' ' + x.state; }).join(' ') : 'Pop nothing (ε)') +
          ', exposing state ' + below + '; GOTO[' + below + ', ' + p.lhs + '] = ' + gto + ', push ' + p.lhs + ' ' + gto + conflictNote });
      stack.length -= n;
      var kids = n ? forest.splice(forest.length - n, n) : [node(EPS)];
      forest.push(node(p.lhs, kids, p.index));
      if (gto === undefined) {
        var gerr = { position: ip, symbol: a, expected: [], state: below };
        snapshot({ type: 'error', cell: { state: below, sym: p.lhs }, error: gerr, reason: 'GOTO[' + below + ', ' + p.lhs + '] is empty' });
        return { steps: steps, accepted: false, error: gerr };
      }
      stack.push({ state: gto, sym: p.lhs });
    }
    var lerr = { position: ip, symbol: input[ip], expected: [], state: -1 };
    snapshot({ type: 'error', error: lerr, reason: 'Stopped after ' + limit + ' moves' });
    return { steps: steps, accepted: false, error: lerr };
  }

  /* Run every construction stage; the interface and the tests both call this. */
  function analyze(g) {
    var ff = computeFirstFollow(g);
    var lr0 = buildLR0(g);
    var table = buildTable(g, ff, lr0);
    return { grammar: g, ff: ff, lr0: lr0, table: table };
  }

  var api = {
    EPS: EPS, END: END,
    computeFirstFollow: computeFirstFollow, closure: closure, gotoKernel: gotoKernel,
    buildLR0: buildLR0, buildTable: buildTable, simulate: simulate, analyze: analyze,
    itemStr: itemStr, itemKey: itemKey, afterDot: afterDot, prodStr: prodStr,
    entryStr: entryStr, cellText: cellText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SLR = api;
})(this);
