/*
 * practice.js — question generation and answer checking for Practice mode.
 *
 * A practice session walks the whole SLR(1) pipeline for one grammar:
 *   Round 1  FIRST and FOLLOW of every non-terminal
 *   Round 2  the items of goto(Ii, X) for a few transitions
 *   Round 3  hidden ACTION / GOTO cells, plus "is the grammar SLR(1)?"
 *   Round 4  the next parser move at every step of a parse
 *
 * All answers are derived from the engine's own construction, never stored.
 * No DOM code here, so the checks are unit-tested in Node.
 */
(function (root) {
  'use strict';

  var SLR = root.SLR || (typeof require !== 'undefined' ? require('./slr.js') : null);
  var EPS = 'ε';

  /* Small seeded generator so a session can be replayed with the same questions. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- answer normalisation ---------- */

  /* "{ (, id }", "( id", "id,(" -> ['(', 'id'];  eps / epsilon / # / e -> ε */
  function parseSymbolSet(text, terminals) {
    var cleaned = String(text || '').replace(/[{}]/g, ' ').trim();
    if (!cleaned) return [];
    var parts = cleaned.split(/[\s,]+/).filter(Boolean);
    var out = [];
    parts.forEach(function (p) {
      var s = /^(eps|epsilon|#|λ|ε)$/i.test(p) || (p === 'e' && (!terminals || terminals.indexOf('e') < 0)) ? EPS : p;
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function compareSets(expected, given) {
    var missing = expected.filter(function (s) { return given.indexOf(s) < 0; });
    var extra = given.filter(function (s) { return expected.indexOf(s) < 0; });
    return { correct: !missing.length && !extra.length, missing: missing, extra: extra };
  }

  /*
   * One table entry to canonical form:
   *   "S5" "shift 5" "s 5" -> s5 ;  "R3" "reduce 3" -> r3 ;  "accept" "acc" -> acc ;
   *   "" "-" "err" "error" "blank" -> "" ;  "7" -> 7 (GOTO entry)
   * Returns null when the text cannot be read as an entry.
   */
  function normalizeEntry(text) {
    var t = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
    if (t === '' || t === '-' || t === 'err' || t === 'error' || t === 'blank' || t === 'e' || t === 'x') return '';
    if (t === 'acc' || t === 'accept' || t === 'a' || t === 'ac') return 'acc';
    var m = /^(s|shift)(\d+)$/.exec(t);
    if (m) return 's' + Number(m[2]);
    m = /^(r|reduce)(\d+)$/.exec(t);
    if (m) return 'r' + Number(m[2]);
    if (/^\d+$/.test(t)) return String(Number(t));
    return null;
  }

  /* A cell answer may hold several entries ("s6/r5") when it is a conflict. */
  function normalizeCell(text) {
    var parts = String(text == null ? '' : text).split(/[\/,|]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var n = normalizeEntry(parts[i]);
      if (n === null) return null;
      if (n !== '' && out.indexOf(n) < 0) out.push(n);
    }
    return out.sort();
  }

  function checkCell(expectedText, given) {
    var exp = normalizeCell(expectedText);
    var got = normalizeCell(given);
    if (got === null) return { correct: false, unreadable: true };
    return { correct: exp.join('/') === got.join('/') };
  }

  /* ---------- Round 1: FIRST and FOLLOW ---------- */

  function firstFollowRound(an) {
    var g = an.grammar, qs = [];
    g.nonTerminals.slice(1).forEach(function (A) {
      ['FIRST', 'FOLLOW'].forEach(function (kind) {
        var set = kind === 'FIRST' ? an.ff.first[A] : an.ff.follow[A];
        var answer = Object.keys(set);
        var reasons = {};
        answer.forEach(function (s) { reasons[s] = set[s].reason; });
        qs.push({ id: kind + ':' + A, kind: kind, nt: A, answer: answer, reasons: reasons });
      });
    });
    return qs;
  }

  function checkFirstFollow(q, text, terminals) {
    var res = compareSets(q.answer, parseSymbolSet(text, terminals));
    res.answer = q.answer;
    return res;
  }

  /* ---------- Round 2: item sets ---------- */

  function itemsRound(an, rand, count) {
    var g = an.grammar;
    var states = an.lr0.states;
    var transitions = [];
    states.forEach(function (I) {
      I.transitions.forEach(function (t) { transitions.push({ from: I.id, sym: t.sym, to: t.to }); });
    });
    /* Prefer transitions whose target needs closure work, and one question per target. */
    var seenTarget = {};
    var ordered = shuffle(transitions, rand).sort(function (a, b) {
      var ca = states[a.to].items.length - states[a.to].kernel.length;
      var cb = states[b.to].items.length - states[b.to].kernel.length;
      return (cb > 0) - (ca > 0);
    });
    var picked = [];
    ordered.forEach(function (t) {
      if (picked.length >= count || seenTarget[t.to]) return;
      seenTarget[t.to] = true;
      picked.push(t);
    });

    return picked.map(function (t) {
      var target = states[t.to];
      var correctKeys = target.items.map(SLR.itemKey);
      /* Distractors: same productions with the dot one place off, then other initial items. */
      var pool = [];
      target.items.forEach(function (it) {
        [it.d - 1, it.d + 1].forEach(function (d) {
          if (d < 0 || d > g.productions[it.p].rhs.length) return;
          var k = it.p + '.' + d;
          if (correctKeys.indexOf(k) < 0 && pool.indexOf(k) < 0) pool.push(k);
        });
      });
      g.productions.forEach(function (p) {
        var k = p.index + '.0';
        if (p.index !== 0 && correctKeys.indexOf(k) < 0 && pool.indexOf(k) < 0) pool.push(k);
      });
      var distractors = shuffle(pool, rand).slice(0, Math.max(3, Math.min(5, correctKeys.length + 1)));
      var candidates = shuffle(correctKeys.concat(distractors), rand).map(function (k) {
        var parts = k.split('.');
        return { key: k, text: SLR.itemStr(g, { p: +parts[0], d: +parts[1] }) };
      });
      var kernelText = target.kernel.map(function (it) { return SLR.itemStr(g, it); });
      var closureText = target.items.filter(function (it) { return !it.kernel; }).map(function (it) { return SLR.itemStr(g, it); });
      return {
        id: 'goto:' + t.from + ':' + t.sym, from: t.from, sym: t.sym, to: t.to,
        answer: correctKeys, candidates: candidates,
        explain: 'Move the dot over ' + t.sym + ' in every item of I' + t.from + ' that has ' + t.sym + ' after the dot: ' +
          kernelText.join(' ; ') + '.' +
          (closureText.length ? ' Closure then adds ' + closureText.join(' ; ') + '.' : ' No closure items are added.') +
          ' This set is I' + t.to + '.'
      };
    });
  }

  function checkItems(q, chosenKeys) {
    var res = compareSets(q.answer, chosenKeys || []);
    res.answer = q.answer;
    return res;
  }

  /* ---------- Round 3: table cells ---------- */

  function tableRound(an, rand, count) {
    var t = an.table, g = an.grammar;
    var buckets = { shift: [], reduce: [], accept: [], goto: [], blank: [], conflict: [] };
    an.lr0.states.forEach(function (I) {
      t.terminals.forEach(function (a) {
        var cell = t.action[I.id][a];
        var q = { state: I.id, sym: a, table: 'action' };
        if (!cell.length) buckets.blank.push(q);
        else if (cell.length > 1) buckets.conflict.push(q);
        else buckets[{ s: 'shift', r: 'reduce', acc: 'accept' }[cell[0].type]].push(q);
      });
      t.nonTerminals.forEach(function (A) {
        if (t.goto[I.id][A] !== undefined) buckets.goto.push({ state: I.id, sym: A, table: 'goto' });
      });
    });
    Object.keys(buckets).forEach(function (k) { buckets[k] = shuffle(buckets[k], rand); });

    /* Guarantee variety first, then fill the rest from shifts, reduces and gotos. */
    var picked = [];
    ['reduce', 'shift', 'goto', 'accept', 'conflict', 'blank', 'reduce', 'shift', 'goto'].forEach(function (k) {
      if (picked.length < count && buckets[k].length) picked.push(buckets[k].shift());
    });
    var rest = shuffle(buckets.shift.concat(buckets.reduce, buckets.goto), rand);
    while (picked.length < count && rest.length) picked.push(rest.shift());

    return picked.map(function (q) {
      var answer = SLR.cellText(t, q.state, q.sym);
      var reason;
      if (q.table === 'goto') {
        reason = 'goto(I' + q.state + ', ' + q.sym + ') = I' + answer + ', so GOTO[' + q.state + ', ' + q.sym + '] = ' + answer + '.';
      } else if (!answer) {
        reason = 'No item in I' + q.state + ' has ' + q.sym + ' after the dot, and no completed item has ' + q.sym +
          ' in the FOLLOW set of its left side, so the cell is blank (error).';
      } else {
        reason = t.action[q.state][q.sym].map(function (e) { return e.reason; }).join(' Also: ') + '.';
      }
      return { id: q.table + ':' + q.state + ':' + q.sym, state: q.state, sym: q.sym, table: q.table, answer: answer, reason: reason };
    }).sort(function (a, b) { return a.state - b.state; });
  }

  function slrQuestion(an) {
    var t = an.table;
    return {
      answer: t.isSLR,
      explain: t.isSLR
        ? 'No cell of the ACTION table received two entries, so the grammar is SLR(1).'
        : 'The table has ' + t.conflicts.length + ' conflicting cell' + (t.conflicts.length === 1 ? '' : 's') + ': ' +
          t.conflicts.map(function (c) { return c.type + ' in state ' + c.state + ' on ' + c.sym; }).join('; ') + '. So the grammar is not SLR(1).'
    };
  }

  /* ---------- Round 4: parse moves ---------- */

  function parseRound(an, tokens) {
    var sim = SLR.simulate(an.grammar, an.table, tokens);
    return {
      sim: sim,
      questions: sim.steps.map(function (s, i) {
        var answer = s.type === 'error' ? '' : (s.type === 'accept' ? 'acc' : s.action);
        return { id: 'move:' + i, step: i, answer: answer, reason: s.reason, type: s.type };
      })
    };
  }

  function checkMove(q, text) {
    var got = normalizeEntry(text);
    if (got === null) return { correct: false, unreadable: true };
    return { correct: got === q.answer };
  }

  /* ---- Test mode: best result per grammar (storage itself lives in the UI) ---- */
  /* Stable key from the grammar's productions only, so the input string and spacing do not matter. */
  function bestKey(g) {
    var s = g.productions.map(function (p) { return p.lhs + '>' + p.rhs.join(' '); }).join('|'), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'slr.testbest.' + (h >>> 0).toString(36);
  }
  /* A stored value is { ok, of, ms }; anything else (missing, malformed) reads as null. */
  function parseBest(raw) {
    var r;
    try { r = JSON.parse(raw); } catch (e) { return null; }
    if (!r || typeof r !== 'object') return null;
    if (!(isFinite(r.ok) && isFinite(r.of) && isFinite(r.ms)) || r.of <= 0 || r.ok < 0 || r.ok > r.of || r.ms < 0) return null;
    return { ok: +r.ok, of: +r.of, ms: +r.ms };
  }
  /* Higher score wins; on equal scores the shorter time wins. A missing old result always loses. */
  function isBetter(a, b) {
    if (!b) return true;
    var d = a.ok * b.of - b.ok * a.of;
    return d > 0 || (d === 0 && a.ms < b.ms);
  }

  var api = {
    bestKey: bestKey, parseBest: parseBest, isBetter: isBetter,
    rng: rng, shuffle: shuffle,
    parseSymbolSet: parseSymbolSet, compareSets: compareSets,
    normalizeEntry: normalizeEntry, normalizeCell: normalizeCell, checkCell: checkCell,
    firstFollowRound: firstFollowRound, checkFirstFollow: checkFirstFollow,
    itemsRound: itemsRound, checkItems: checkItems,
    tableRound: tableRound, slrQuestion: slrQuestion,
    parseRound: parseRound, checkMove: checkMove
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Practice = api;
})(this);
