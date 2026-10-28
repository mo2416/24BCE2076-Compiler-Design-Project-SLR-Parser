/*
 * practice-ui.js — Practice mode.
 *
 * The learner works through the whole SLR(1) construction for the grammar in
 * the left panel, in four rounds. Every answer is checked against the engine's
 * own result, and every mark comes with the reason for the correct entry.
 */
(function () {
  'use strict';

  var $ = function (sel, r) { return (r || document).querySelector(sel); };
  var $$ = function (sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); };
  var esc, m;

  var ROUNDS = [
    { key: 'ff', name: 'FIRST & FOLLOW' },
    { key: 'items', name: 'Item sets' },
    { key: 'table', name: 'Parsing table' },
    { key: 'parse', name: 'Parse moves' },
    { key: 'sum', name: 'Summary' }
  ];

  var P = { session: null, hide: 10, built: false };

  function host() { return $('#practice'); }
  function an() { return App.state.an; }

  /* ------------------------------------------------------------------ */
  /* Session                                                             */
  /* ------------------------------------------------------------------ */

  function newSession() {
    var A = an();
    if (!A) return;
    var seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    var rand = Practice.rng(seed);
    var parse = App.state.tokens ? Practice.parseRound(A, App.state.tokens) : null;
    P.session = {
      seed: seed,
      grammarText: $('#grammar').value,
      ff: Practice.firstFollowRound(A),
      items: Practice.itemsRound(A, rand, Math.min(3, A.lr0.states.length - 1)),
      table: Practice.tableRound(A, rand, P.hide),
      slr: Practice.slrQuestion(A),
      parse: parse,
      parseAt: 0, parseLog: [], parseChecked: false,
      scores: [null, null, null, null],
      checked: [false, false, false, false],
      current: 0
    };
    render();
  }

  function grammarKey() {
    var s = $('#grammar').value.replace(/\s+/g, ' ').trim(), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'slr.best.' + (h >>> 0).toString(36);
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                               */
  /* ------------------------------------------------------------------ */

  function render() {
    var s = P.session, el = host();
    if (!s) { el.innerHTML = ''; return; }
    var ex = App.state.example && App.state.example.grammar === $('#grammar').value ? App.state.example : null;
    el.innerHTML =
      '<header class="p-head"><div><h2>Practice</h2><p>Build the SLR(1) parser yourself for ' +
        (ex ? '<b>' + esc(ex.title) + '</b>' : 'the grammar in the left panel') +
        '. Four rounds follow the same order as the construction, and each one is marked with the reason for every correct entry.</p></div>' +
        '<div class="p-controls">' +
          '<label>Grammar <select id="p-example"><option value="">Current grammar</option>' +
            EXAMPLES.map(function (e) { return '<option value="' + e.id + '">' + esc(e.title) + '</option>'; }).join('') + '</select></label>' +
          '<label>Hidden cells <select id="p-hide">' + [6, 10, 14, 20].map(function (n) { return '<option' + (n === P.hide ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
          '<button type="button" class="btn" id="p-new">New questions</button>' +
        '</div></header>' +
      '<nav class="rounds" aria-label="Rounds">' + ROUNDS.map(function (r, i) {
        var sc = i < 4 && s.scores[i] ? s.scores[i].got + ' / ' + s.scores[i].of : (i < 4 ? 'not done' : '');
        return '<button type="button" data-round="' + i + '"' + (i === s.current ? ' aria-current="step"' : '') + (s.checked[i] ? ' class="done"' : '') + '>' +
          '<span class="rn">' + (i < 4 ? 'Round ' + (i + 1) : 'Result') + '</span><span class="rt">' + r.name + '</span><span class="rs">' + sc + '</span></button>';
      }).join('') + '</nav>' +
      '<div class="round-body" id="p-body"></div>';
    [renderFF, renderItems, renderTable, renderParse, renderSummary][s.current]($('#p-body'));
  }

  function actions(i, extra) {
    var s = P.session, done = s.checked[i];
    return '<div class="round-actions">' +
      (done ? '' : '<button type="button" class="btn dark" data-check="' + i + '">Check answers</button>') +
      (extra || '') +
      (done && s.scores[i] ? '<span class="score">' + s.scores[i].got + ' / ' + s.scores[i].of + ' correct</span>' : '') +
      (done ? '<button type="button" class="btn dark" data-goround="' + (i + 1) + '">' + (i === 3 ? 'See the result' : 'Next round') + ' →</button>' : '') +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Round 1 · FIRST and FOLLOW                                          */
  /* ------------------------------------------------------------------ */

  function renderFF(body) {
    var s = P.session, done = s.checked[0];
    body.innerHTML =
      '<p class="round-intro">Write each set as symbols separated by spaces or commas, for example <code>( id</code>. Use <code>eps</code> or <code>ε</code> for the empty string and <code>$</code> for end of input. Productions are listed in the left panel.</p>' +
      '<div class="q-grid">' + s.ff.map(function (q, i) {
        var res = q.result;
        var cls = done ? (res.correct ? ' right' : ' wrong') : '';
        var fb = '';
        if (done) {
          fb = '<div class="fb"><span class="mark">' + (res.correct ? 'Correct' : 'Not quite') + '</span>' +
            (res.correct ? '' : (res.missing.length ? 'Missing ' + res.missing.map(m).join(' ') + '. ' : '') + (res.extra.length ? 'Should not contain ' + res.extra.map(m).join(' ') + '. ' : '')) +
            '<span class="ans">' + esc(q.kind + '(' + q.nt + ') = { ' + q.answer.join(', ') + ' }') + '</span>' +
            (res.correct ? '' : '<span class="why">' + q.answer.filter(function (x) { return res.missing.indexOf(x) >= 0; }).map(function (x) {
              return m(x) + ': ' + esc(q.reasons[x]);
            }).join('<br>') + '</span>') + '</div>';
        }
        return '<div class="q' + cls + '"><label for="pff-' + i + '">' + m(q.kind + '(' + q.nt + ')') + '</label>' +
          '<input type="text" id="pff-' + i + '" spellcheck="false" autocomplete="off" value="' + esc(q.given || '') + '"' + (done ? ' disabled' : '') + '>' + fb + '</div>';
      }).join('') + '</div>' + actions(0);
  }

  function checkFF() {
    var s = P.session, got = 0;
    s.ff.forEach(function (q, i) {
      q.given = $('#pff-' + i).value;
      q.result = Practice.checkFirstFollow(q, q.given, an().grammar.terminals);
      if (q.result.correct) got++;
    });
    s.scores[0] = { got: got, of: s.ff.length };
  }

  /* ------------------------------------------------------------------ */
  /* Round 2 · item sets                                                 */
  /* ------------------------------------------------------------------ */

  function renderItems(body) {
    var s = P.session, done = s.checked[1], A = an();
    if (!s.items.length) { body.innerHTML = '<p class="round-intro">This grammar has a single state, so there is no goto to compute.</p>' + actions(1); return; }
    body.innerHTML =
      '<p class="round-intro">For each transition, tick every item of the resulting state: the kernel items (dot moved over the symbol) <em>and</em> the items added by closure.</p>' +
      s.items.map(function (q, qi) {
        var from = A.lr0.states[q.from];
        var chosen = q.chosen || [];
        var cands = q.candidates.map(function (c, ci) {
          var cls = '', tag = '';
          if (done) {
            var inAns = q.answer.indexOf(c.key) >= 0, picked = chosen.indexOf(c.key) >= 0;
            if (inAns && picked) { cls = 'c-right'; tag = 'correct'; }
            else if (inAns) { cls = 'c-missed'; tag = 'missed'; }
            else if (picked) { cls = 'c-wrong'; tag = 'not in the set'; }
          }
          return '<li><label class="' + cls + '"><input type="checkbox" data-q="' + qi + '" value="' + c.key + '"' + (chosen.indexOf(c.key) >= 0 ? ' checked' : '') + (done ? ' disabled' : '') + '>' +
            esc(c.text) + (tag ? '<span class="tagx">' + tag + '</span>' : '') + '</label></li>';
        }).join('');
        return '<div class="q' + (done ? (q.result.correct ? ' right' : ' wrong') : '') + '" style="margin-bottom:14px">' +
          '<div class="cols-2" style="gap:14px"><div><span class="q-title">I' + q.from + '</span>' + App.itemsListHTML(from) + '</div>' +
          '<div><span class="q-title">Which items are in goto(I' + q.from + ', ' + esc(q.sym) + ')?</span><ul class="cands">' + cands + '</ul>' +
          (done ? '<div class="fb"><span class="mark">' + (q.result.correct ? 'Correct' : 'Not quite') + '</span><span class="why">' + esc(q.explain) + '</span></div>' : '') +
          '</div></div></div>';
      }).join('') + actions(1);
  }

  function checkItems() {
    var s = P.session, got = 0;
    s.items.forEach(function (q, qi) {
      q.chosen = $$('input[data-q="' + qi + '"]:checked').map(function (x) { return x.value; });
      q.result = Practice.checkItems(q, q.chosen);
      if (q.result.correct) got++;
    });
    s.scores[1] = { got: got, of: s.items.length };
  }

  /* ------------------------------------------------------------------ */
  /* Round 3 · table cells                                               */
  /* ------------------------------------------------------------------ */

  function renderTable(body) {
    var s = P.session, done = s.checked[2], A = an(), t = A.table, g = A.grammar;
    var asked = {};
    s.table.forEach(function (q, i) { asked[q.state + '\u0001' + q.sym] = i; });
    var head = '<tr><th rowspan="2">State</th><th colspan="' + t.terminals.length + '">ACTION</th><th colspan="' + t.nonTerminals.length + '" class="split">GOTO</th></tr><tr>' +
      t.terminals.map(function (a) { return '<th>' + esc(a) + '</th>'; }).join('') +
      t.nonTerminals.map(function (B, i) { return '<th' + (i === 0 ? ' class="split"' : '') + '>' + esc(B) + '</th>'; }).join('') + '</tr>';
    var rows = A.lr0.states.map(function (I) {
      var cols = t.terminals.concat(t.nonTerminals);
      return '<tr><th>' + I.id + '</th>' + cols.map(function (c, ci) {
        var split = ci === t.terminals.length ? ' split' : '';
        var k = I.id + '\u0001' + c;
        if (asked.hasOwnProperty(k)) {
          var q = s.table[asked[k]];
          var cls = done ? (q.result.correct ? ' right' : ' wrong') : '';
          return '<td class="ask' + split + cls + '"><input type="text" id="pt-' + asked[k] + '" aria-label="' + esc((t.nonTerminals.indexOf(c) >= 0 ? 'GOTO' : 'ACTION') + ' ' + I.id + ', ' + c) +
            '" spellcheck="false" autocomplete="off" value="' + esc(q.given || '') + '"' + (done ? ' disabled' : '') + ' placeholder="?"></td>';
        }
        var txt = SLR.cellText(t, I.id, c);
        var e = t.action[I.id] && t.action[I.id][c];
        var kind = e && e.length > 1 ? 'conf' : e && e.length ? (e[0].type) : txt ? 'g' : '';
        return '<td class="' + kind + split + '">' + esc(txt) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var follow = g.nonTerminals.slice(1).map(function (B) { return '<li>' + m('FOLLOW(' + B + ') = { ' + Object.keys(A.ff.follow[B]).join(', ') + ' }') + '</li>'; }).join('');
    var sets = A.lr0.states.map(function (I) { return '<div class="itemset"><h4>I' + I.id + '</h4>' + App.itemsListHTML(I).replace('class="items"', 'class="items" style="padding:6px 10px;margin:0"') + '</div>'; }).join('');

    var fb = '';
    if (done) {
      fb = '<div class="p-feedback">' + s.table.map(function (q) {
        var shown = q.answer || 'blank';
        return '<div class="fbi' + (q.result.correct ? ' ok' : '') + '"><b>' + esc((q.table === 'goto' ? 'GOTO' : 'ACTION') + '[' + q.state + ', ' + q.sym + '] = ' + shown) + '</b>' +
          (q.result.correct ? ' · correct' : ' · you wrote ' + m(q.given || 'blank')) + '<br>' + esc(q.reason) + '</div>';
      }).join('') + '<div class="fbi' + (s.slrResult ? ' ok' : '') + '"><b>SLR(1)? ' + (s.slr.answer ? 'Yes' : 'No') + '</b>' + (s.slrResult ? ' · correct' : '') + '<br>' + esc(s.slr.explain) + '</div></div>';
    }

    body.innerHTML =
      '<p class="round-intro">Fill the dashed cells. Write <code>s5</code> for shift 5, <code>r3</code> for reduce by production (3), <code>acc</code> for accept, a state number under GOTO, and leave it empty (or <code>-</code>) for an error entry. A conflict is written with a slash: <code>s6/r5</code>.</p>' +
      '<details class="sheet" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600">Reference: item sets and FOLLOW sets</summary>' +
        '<ul style="list-style:none;padding:0;margin:12px 0;display:flex;flex-wrap:wrap;gap:6px 18px">' + follow + '</ul>' +
        '<div class="itemsets" style="padding:0;max-height:none">' + sets + '</div></details>' +
      '<div class="sheet scroll-x"><table class="lr p-table">' + '<thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="q" style="margin-top:12px;max-width:520px"><span class="q-title">Is this grammar SLR(1)?</span><div class="yn">' +
        '<label><input type="radio" name="p-slr" value="yes"' + (s.slrGiven === 'yes' ? ' checked' : '') + (done ? ' disabled' : '') + '> Yes</label>' +
        '<label><input type="radio" name="p-slr" value="no"' + (s.slrGiven === 'no' ? ' checked' : '') + (done ? ' disabled' : '') + '> No</label></div></div>' +
      fb + actions(2);
  }

  function checkTable() {
    var s = P.session, got = 0;
    s.table.forEach(function (q, i) {
      q.given = $('#pt-' + i).value;
      q.result = Practice.checkCell(q.answer, q.given);
      if (q.result.correct) got++;
    });
    var r = $('input[name="p-slr"]:checked');
    s.slrGiven = r ? r.value : '';
    s.slrResult = (s.slrGiven === 'yes') === s.slr.answer && s.slrGiven !== '';
    if (s.slrResult) got++;
    s.scores[2] = { got: got, of: s.table.length + 1 };
  }

  /* ------------------------------------------------------------------ */
  /* Round 4 · parse moves                                               */
  /* ------------------------------------------------------------------ */

  function allowedMoves(step) {
    var t = an().table;
    if (step.type === 'error') return [''];
    var cell = t.action[step.cell.state][step.cell.sym] || [];
    return cell.map(SLR.entryStr);
  }

  function renderParse(body) {
    var s = P.session, A = an();
    if (!s.parse) {
      body.innerHTML = '<p class="round-intro">Enter a valid input string in the left panel and press Build parser to practise parse moves.</p>' + actions(3);
      return;
    }
    var steps = s.parse.sim.steps, k = s.parseAt, finished = k >= steps.length;
    var log = '<table class="trace"><thead><tr><th>#</th><th>Stack</th><th class="r">Input</th><th>Your move</th><th>Correct</th></tr></thead><tbody>' +
      s.parseLog.map(function (r, i) {
        var st = steps[i];
        return '<tr class="' + st.type + '"><td>' + (i + 1) + '</td><td>' + esc(App.stackText(st.stack)) + '</td><td class="r">' + esc(st.input.slice(st.ip).join(' ')) + '</td>' +
          '<td style="color:' + (r.correct ? 'var(--green)' : 'var(--red)') + '">' + esc(r.given || '(blank)') + ' ' + (r.correct ? '✓' : '✗') + '</td><td>' + esc(s.parse.questions[i].answer || 'err') + '</td></tr>';
      }).join('') + '</tbody></table>';

    var current = '';
    if (!finished) {
      var st = steps[k];
      var fb = s.lastFeedback;
      current =
        '<div class="sheet"><dl class="now"><dt>Stack</dt><dd>' + esc(App.stackText(st.stack)) + '</dd><dt>Input</dt><dd>' + esc(st.input.slice(st.ip).join(' ')) + '</dd>' +
        '<dt>Look up</dt><dd>ACTION[' + st.stack[st.stack.length - 1].state + ', ' + esc(st.input[st.ip]) + ']</dd></dl>' +
        '<label for="p-move" class="q-title">Next move ' + (k + 1) + ' of ' + steps.length + '</label>' +
        '<form class="answer-row" id="p-move-form"><input type="text" id="p-move" spellcheck="false" autocomplete="off" placeholder="s5, r3, acc or err"><button class="btn dark" type="submit">Check</button></form>' +
        '<p class="hint">Press Enter to check. After a reduce, the parser pops the right side and consults GOTO; you only give the ACTION entry.</p>' +
        (fb ? '<div class="p-feedback"><div class="fbi' + (fb.correct ? ' ok' : '') + '"><b>Move ' + fb.n + ': ' + esc(fb.answer || 'err') + '</b>' + (fb.correct ? ' · correct' : ' · you wrote ' + m(fb.given || 'blank')) + '<br>' + esc(fb.reason) + '</div></div>' : '') +
        '</div>';
    }

    var tableHTML = '<details class="sheet" style="margin-top:12px"' + (s.showTable ? ' open' : '') + ' id="p-table-ref"><summary style="cursor:pointer;font-weight:600">Parsing table</summary><div class="scroll-x" style="margin-top:10px">' + miniTable(A) + '</div></details>';
    body.innerHTML =
      '<p class="round-intro">Parse ' + m(App.state.tokens.join(' ') + ' $') + ' yourself. At each configuration, give the ACTION entry the parser uses next.</p>' +
      '<div class="parse-q"><div>' + (finished ? '<div class="banner ' + (steps[steps.length - 1].type === 'accept' ? 'ok' : 'bad') + '">' + App.ICON[steps[steps.length - 1].type === 'accept' ? 'okc' : 'bad'] +
        '<div><h3>Parse finished: ' + (steps[steps.length - 1].type === 'accept' ? 'accepted' : 'syntax error') + '</h3><p>' + s.scores[3].got + ' of ' + s.scores[3].of + ' moves were correct.</p></div></div>' : current) +
        tableHTML + '</div><div class="sheet trace-sheet" style="max-height:520px">' + log + '</div></div>' +
      (finished ? actions(3) : '');
    var input = $('#p-move');
    if (input) input.focus({ preventScroll: true });
  }

  function miniTable(A) {
    var t = A.table, cols = t.terminals.concat(t.nonTerminals);
    return '<table class="lr p-table"><thead><tr><th>State</th>' + cols.map(function (c, i) { return '<th' + (i === t.terminals.length ? ' class="split"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      A.lr0.states.map(function (I) {
        return '<tr><th>' + I.id + '</th>' + cols.map(function (c, i) { return '<td' + (i === t.terminals.length ? ' class="split"' : '') + '>' + esc(SLR.cellText(t, I.id, c)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function answerMove(text) {
    var s = P.session, steps = s.parse.sim.steps, k = s.parseAt, q = s.parse.questions[k];
    var got = Practice.normalizeEntry(text);
    var ok = got !== null && allowedMoves(steps[k]).indexOf(got) >= 0;
    s.parseLog.push({ given: text.trim(), correct: ok });
    s.lastFeedback = { n: k + 1, correct: ok, given: text.trim(), answer: q.answer, reason: q.reason };
    s.parseAt++;
    s.showTable = $('#p-table-ref') && $('#p-table-ref').open;
    if (s.parseAt >= steps.length) {
      s.checked[3] = true;
      s.scores[3] = { got: s.parseLog.filter(function (r) { return r.correct; }).length, of: steps.length };
      render();
      return;
    }
    renderParse($('#p-body'));
  }

  /* ------------------------------------------------------------------ */
  /* Summary                                                             */
  /* ------------------------------------------------------------------ */

  function renderSummary(body) {
    var s = P.session, got = 0, of = 0;
    var rows = ROUNDS.slice(0, 4).map(function (r, i) {
      var sc = s.scores[i];
      if (sc) { got += sc.got; of += sc.of; }
      return '<tr><td>Round ' + (i + 1) + ' · ' + r.name + '</td><td class="n">' + (sc ? sc.got + ' / ' + sc.of : 'not attempted') + '</td><td class="n">' + (sc && sc.of ? Math.round(100 * sc.got / sc.of) + '%' : '–') + '</td></tr>';
    }).join('');
    var pct = of ? Math.round(100 * got / of) : 0;
    var key = grammarKey(), best = +(App.store(key) || 0);
    var allDone = s.checked.every(Boolean);
    if (allDone && pct > best) App.store(key, String(pct));
    var weakest = s.scores.map(function (sc, i) { return { i: i, r: sc && sc.of ? sc.got / sc.of : 1 }; }).sort(function (a, b) { return a.r - b.r; })[0];
    var stageFor = ['ff', 'items', 'table', 'parse'];
    body.innerHTML =
      '<div class="cols-2"><div><p class="eyebrow">Overall</p><p class="bigscore">' + pct + '%</p><p style="color:var(--ink-2)">' + got + ' of ' + of + ' answers correct' + (allDone ? '' : ' so far; some rounds are not finished') + '.</p>' +
      (best ? '<p class="prev-best">Best before this session on this grammar: ' + best + '%</p>' : '') +
      '<div class="round-actions"><button type="button" class="btn dark" id="p-again">Practise again with new questions</button>' +
      (weakest && weakest.r < 1 ? '<button type="button" class="btn" id="p-review" data-stage="' + stageFor[weakest.i] + '">Review ' + ROUNDS[weakest.i].name + ' in Visualize</button>' : '') + '</div></div>' +
      '<div><table class="summary-table"><thead><tr><th>Round</th><th class="n">Score</th><th class="n">%</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td>Total</td><td class="n">' + got + ' / ' + of + '</td><td class="n">' + pct + '%</td></tr></tfoot></table></div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function onClick(e) {
    var s = P.session;
    var b = e.target.closest('button');
    if (!b || !s) return;
    if (b.hasAttribute('data-round')) { s.current = +b.getAttribute('data-round'); render(); host().scrollIntoView({ block: 'start' }); return; }
    if (b.hasAttribute('data-goround')) { s.current = +b.getAttribute('data-goround'); render(); window.scrollTo({ top: 0 }); return; }
    if (b.hasAttribute('data-check')) {
      var i = +b.getAttribute('data-check');
      [checkFF, checkItems, checkTable, function () {
        s.scores[3] = { got: 0, of: 0 };
      }][i]();
      s.checked[i] = true;
      render();
      return;
    }
    if (b.id === 'p-new' || b.id === 'p-again') { newSession(); return; }
    if (b.id === 'p-review') { App.setMode('visual'); App.goStage(b.getAttribute('data-stage')); return; }
  }

  function onChange(e) {
    if (e.target.id === 'p-hide') { P.hide = +e.target.value; newSession(); }
    if (e.target.id === 'p-example' && e.target.value) {
      var ex = EXAMPLES.filter(function (x) { return x.id === e.target.value; })[0];
      App.state.example = ex;
      $('#grammar').value = ex.grammar; $('#input-string').value = ex.input; $('#space-only').checked = false;
      App.build({ keepStage: true });
    }
  }

  function onSubmit(e) {
    if (e.target.id !== 'p-move-form') return;
    e.preventDefault();
    answerMove($('#p-move').value);
  }

  window.PracticeUI = {
    show: function () {
      if (!P.session || P.session.grammarText !== $('#grammar').value || P.stale) { P.stale = false; newSession(); }
      else render();
    },
    redraw: function () { if (App.state.mode === 'practice') render(); }
  };

  function init() {
    esc = App.esc; m = App.m;
    host().addEventListener('click', onClick);
    host().addEventListener('change', onChange);
    host().addEventListener('submit', onSubmit);
    App.onBuild(function () {
      P.stale = true;
      if (App.state.mode === 'practice') window.PracticeUI.show();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
