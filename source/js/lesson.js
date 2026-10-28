/*
 * lesson.js — one flat list of teaching steps and one list of practice questions,
 * built from the engine. DOM-free; every UI template renders these its own way.
 *
 *   Lesson.steps(s)        -> [{ stage, title, text, ref }]   (ref points into the engine data)
 *   Lesson.questions(s, n) -> [{ stage, kind, prompt, answer, options, why, check(text) }]
 */
(function (root) {
  'use strict';
  var Core = root.Core, P = root.Practice, SLR = root.SLR;
  var STAGE = { grammar: 'Grammar', ff: 'FIRST & FOLLOW', items: 'LR(0) items', table: 'Parsing table', conflicts: 'Conflicts', parse: 'Parse' };

  function steps(s) {
    var out = [], g = s.g;
    out.push({ stage: 'grammar', title: 'Augment the grammar', text: 'Add (0) ' + SLR.prodStr(g.productions[0]) + ' so the parser knows when it is finished.', ref: {} });
    s.an.ff.steps.forEach(function (st, i) {
      out.push({ stage: 'ff', title: st.sym + ' ∈ ' + st.kind + '(' + st.of + ')', text: st.reason + '.', ref: { i: i } });
    });
    s.an.lr0.steps.forEach(function (st, i) {
      out.push({ stage: 'items', title: st.type === 'start' ? 'Start: I0' : 'goto(I' + st.from + ', ' + st.sym + ')', text: st.text + '.', ref: { i: i } });
    });
    s.an.table.fills.forEach(function (f, i) {
      out.push({ stage: 'table', title: (f.table === 'goto' ? 'GOTO' : 'ACTION') + '[' + f.state + ', ' + f.sym + '] = ' + SLR.entryStr(f.entry), text: f.entry.reason + '.', ref: { i: i } });
    });
    var c = Core.conflicts(s);
    out.push({ stage: 'conflicts', title: c.isSLR ? 'No conflicts' : c.list.length + ' conflict(s)', text: c.isSLR ? 'Every cell has at most one entry, so the grammar is SLR(1).' : c.list.map(function (x) { return x.explain; }).join(' '), ref: {} });
    if (s.sim) s.sim.steps.forEach(function (st, i) {
      out.push({ stage: 'parse', title: 'Move ' + (i + 1) + ': ' + st.type, text: st.reason + '.', ref: { i: i } });
    });
    return out;
  }

  function shuffle(a, r) { return P.shuffle(a, r); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* Practice questions across all stages; each has a typed answer and, where it helps, choices. */
  function questions(s, seed) {
    var rand = P.rng(seed || 7), qs = [], t = s.an.table;
    /* FIRST / FOLLOW: two sets */
    var ff = P.firstFollowRound(s.an);
    shuffle(ff, rand).slice(0, 3).forEach(function (q) {
      var ans = '{ ' + q.answer.join(', ') + ' }';
      var all = uniq([].concat.apply([], ff.map(function (x) { return x.answer; })));
      var wrong1 = q.answer.slice(0, -1), wrong2 = uniq(q.answer.concat([all.filter(function (x) { return q.answer.indexOf(x) < 0; })[0]]).filter(Boolean));
      qs.push({ stage: 'ff', kind: 'set', prompt: q.kind + '(' + q.nt + ') = ?', answer: ans,
        options: shuffle(uniq([ans, '{ ' + wrong1.join(', ') + ' }', '{ ' + wrong2.join(', ') + ' }']), rand),
        why: q.answer.map(function (x) { return x + ': ' + q.reasons[x]; }).join('. ') + '.',
        check: function (text) { return P.checkFirstFollow(q, String(text).replace(/[{}]/g, ' '), s.g.terminals).correct; } });
    });
    /* goto targets */
    P.itemsRound(s.an, rand, 2).forEach(function (q) {
      var ans = 'I' + q.to, opts = shuffle(uniq([ans].concat(shuffle(s.an.lr0.states.map(function (I) { return 'I' + I.id; }), rand).slice(0, 4))).slice(0, 4), rand);
      if (opts.indexOf(ans) < 0) opts[0] = ans;
      qs.push({ stage: 'items', kind: 'state', prompt: 'goto(I' + q.from + ', ' + q.sym + ') = ?', answer: ans, options: shuffle(opts, rand), why: q.explain,
        check: function (text) { return String(text).trim().toUpperCase().replace(/^(\d)/, 'I$1') === ans; } });
    });
    /* table cells */
    P.tableRound(s.an, rand, 4).forEach(function (q) {
      var ans = q.answer || 'blank';
      var row = t.terminals.concat(t.nonTerminals).map(function (c) { return SLR.cellText(t, q.state, c); }).filter(Boolean);
      var opts = uniq([ans].concat(row, ['blank', 'acc', 's' + (q.state + 1), 'r1'])).slice(0, 6);
      qs.push({ stage: 'table', kind: 'cell', prompt: (q.table === 'goto' ? 'GOTO' : 'ACTION') + '[' + q.state + ', ' + q.sym + '] = ?', answer: ans, state: q.state, sym: q.sym,
        options: shuffle(opts.slice(0, 4).indexOf(ans) >= 0 ? opts.slice(0, 4) : [ans].concat(opts.slice(1, 4)), rand), why: q.reason,
        check: function (text) { return P.checkCell(q.answer, /^blank$/i.test(String(text).trim()) ? '' : text).correct; } });
    });
    /* SLR(1)? */
    var sq = P.slrQuestion(s.an);
    qs.push({ stage: 'conflicts', kind: 'yn', prompt: 'Is this grammar SLR(1)?', answer: sq.answer ? 'Yes' : 'No', options: ['Yes', 'No'], why: sq.explain,
      check: function (text) { return /^y/i.test(String(text).trim()) === sq.answer; } });
    /* parse moves */
    if (s.sim) {
      var pr = P.parseRound(s.an, s.tokens);
      [1, 3, 6, 8].filter(function (i) { return i < pr.questions.length; }).forEach(function (i) {
        var q = pr.questions[i], st = s.sim.steps[i], ans = q.answer || 'err';
        var opts = uniq([ans, 'acc'].concat(t.terminals.concat(t.nonTerminals).map(function (c) { return SLR.cellText(t, st.cell.state, c); }).filter(function (x) { return /^[sr]/.test(x); }))).slice(0, 4);
        ['s4', 'r2', 's6', 'r4', 's5'].forEach(function (x) { if (opts.length < 4 && opts.indexOf(x) < 0) opts.push(x); });
        qs.push({ stage: 'parse', kind: 'move', prompt: 'Stack ' + Core.stackText(st.stack) + ' · input ' + st.input.slice(st.ip).join(' ') + ' · next move?', answer: ans, step: i,
          options: shuffle(uniq(opts), rand), why: q.reason,
          check: function (text) { return P.checkMove(q, text).correct; } });
      });
    }
    return qs;
  }

  root.Lesson = { steps: steps, questions: questions, STAGE: STAGE };
})(this);
