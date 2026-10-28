/*
 * run-tests.js — automated tests for the engine and the practice checker.
 * Run:  node tests/run-tests.js
 *
 * Expected values are taken from the Module 2 lecture notes (pages cited) and
 * the standard Dragon Book results for the expression grammar, not from the
 * program's own output.
 */
'use strict';
const assert = require('assert');
const Grammar = require('../js/grammar.js');
const SLR = require('../js/slr.js');
const Practice = require('../js/practice.js');
const EXAMPLES = require('../js/examples.js');

const results = { pass: 0, fail: 0, groups: {} };
let group = 'general';
function section(name) { group = name; results.groups[name] = results.groups[name] || { pass: 0, fail: 0 }; }
function test(name, fn) {
  try { fn(); results.pass++; results.groups[group].pass++; }
  catch (e) { results.fail++; results.groups[group].fail++; console.log('  FAIL  [' + group + '] ' + name + '\n        ' + e.message); }
}

const build = (text, opts) => SLR.analyze(Grammar.parseGrammar(text, opts));
const setOf = (obj) => Object.keys(obj).sort();
const sorted = (a) => a.slice().sort();
function tableRows(an) {
  const cols = an.table.terminals.concat(an.table.nonTerminals);
  return an.lr0.states.map((s) => cols.map((c) => SLR.cellText(an.table, s.id, c)));
}
function trace(an, input) {
  const g = an.grammar;
  const r = SLR.simulate(g, an.table, Grammar.tokenizeInput(input, g));
  return { r, rows: r.steps.map((st) => st.stack.map((e) => (e.sym || '') + e.state).join('')) };
}

/* ------------------------------------------------------------------ */
section('Grammar input');

test('arrow forms ->, -->, → and ::= are accepted', () => {
  ['S -> a', 'S --> a', 'S → a', 'S ::= a'].forEach((t) => assert.strictEqual(Grammar.parseGrammar(t).productions[1].rhs[0], 'a'));
});
test('alternatives and continuation lines', () => {
  const g = Grammar.parseGrammar('E -> E + T\n  | T\nT -> id');
  assert.deepStrictEqual(g.productions.map(SLR.prodStr), ["E' → E", 'E → E + T', 'E → T', 'T → id']);
});
test('compact form splits symbols: aA → a A, TF → T F, F* → F *', () => {
  const g = Grammar.parseGrammar('E -> E + T|T\nT -> TF|F\nF -> F*| a | b');
  assert.deepStrictEqual(g.productions[3].rhs, ['T', 'F']);
  assert.deepStrictEqual(g.productions[5].rhs, ['F', '*']);
});
test('id stays one terminal in compact input', () => {
  const g = Grammar.parseGrammar('E -> E + T | T\nT -> id');
  assert.deepStrictEqual(Grammar.tokenizeInput('id+id', g), ['id', '+', 'id']);
});
test('space-only mode keeps multi-letter words whole', () => {
  const g = Grammar.parseGrammar('S -> while C do S | x\nC -> c', { spaceOnly: true });
  assert.ok(g.terminals.includes('while') && g.terminals.includes('do'));
});
test('quoted terminals are kept whole', () => {
  const g = Grammar.parseGrammar("S -> 'if' C | x\nC -> c");
  assert.ok(g.terminals.includes('if'));
});
test('epsilon spellings: ε, eps, #, empty alternative', () => {
  ['A -> a | ε', 'A -> a | eps', 'A -> a | #', 'A -> a |'].forEach((t) => {
    const g = Grammar.parseGrammar(t);
    assert.strictEqual(g.productions[2].rhs.length, 0, t);
  });
});
test('augmented start avoids name clashes', () => {
  const g = Grammar.parseGrammar("S -> S' a | b\nS' -> c");
  assert.strictEqual(g.augmentedStart, "S''");
});
test('errors: empty grammar, missing arrow, reserved $', () => {
  assert.throws(() => Grammar.parseGrammar('   '), /empty/);
  assert.throws(() => Grammar.parseGrammar('S a b'), /expected a rule/);
  assert.throws(() => Grammar.parseGrammar('S -> a $'), /reserved/);
});
test('input symbol that is not a terminal is reported', () => {
  const g = Grammar.parseGrammar('S -> a S | b');
  assert.throws(() => Grammar.tokenizeInput('a c b', g), /not a terminal/);
});
test('unreachable non-terminal produces a warning', () => {
  const g = Grammar.parseGrammar('S -> a\nB -> b');
  assert.ok(g.warnings.some((w) => /B/.test(w)));
});

test('notation from PDFs is cleaned: ⟶ ⇒ arrows, ∈/ϵ for ε, curly primes, full-width letters', () => {
  const g = Grammar.parseGrammar('S\u2019 \u27F6 S\nS \u21D2 A A | \u2208\nA \u2192 \uFF41A | b');
  assert.deepStrictEqual(g.productions.map(SLR.prodStr), ["S'' → S'", "S' → S", 'S → A A', 'S → ε', 'A → a A', 'A → b']);
});
test('cleaned input string: full-width and non-breaking spaces', () => {
  const g = Grammar.parseGrammar('E -> E + T | T\nT -> id');
  assert.deepStrictEqual(Grammar.tokenizeInput('\uFF49\uFF44\u00A0+ id', g), ['id', '+', 'id']);
});

/* ------------------------------------------------------------------ */
section('FIRST and FOLLOW');

test('expression grammar FIRST sets (Dragon Book 4.4)', () => {
  const an = build(EXAMPLES[0].grammar);
  ['E', 'T', 'F'].forEach((A) => assert.deepStrictEqual(setOf(an.ff.first[A]), ['(', 'id']));
});
test('expression grammar FOLLOW sets', () => {
  const an = build(EXAMPLES[0].grammar);
  assert.deepStrictEqual(setOf(an.ff.follow.E), sorted(['$', '+', ')']));
  assert.deepStrictEqual(setOf(an.ff.follow.T), sorted(['$', '+', ')', '*']));
  assert.deepStrictEqual(setOf(an.ff.follow.F), sorted(['$', '+', ')', '*']));
});
test('S → AA: FOLLOW(S) = {$}, FOLLOW(A) = {a, b, $}  (Module 2 p.177)', () => {
  const an = build('S -> AA\nA -> aA | b');
  assert.deepStrictEqual(setOf(an.ff.follow.S), ['$']);
  assert.deepStrictEqual(setOf(an.ff.follow.A), sorted(['a', 'b', '$']));
});
test('ε handling: FIRST(Y) = {b, ε}, FOLLOW(Y) = FOLLOW(Z) = {z}  (p.199)', () => {
  const an = build('X -> Yz | a\nY -> bZ | ε\nZ -> ε');
  assert.deepStrictEqual(setOf(an.ff.first.Y), sorted(['b', 'ε']));
  assert.deepStrictEqual(setOf(an.ff.first.X), sorted(['a', 'b', 'z']));
  assert.deepStrictEqual(setOf(an.ff.follow.Y), ['z']);
  assert.deepStrictEqual(setOf(an.ff.follow.Z), ['z']);
});
test('every set member records a reason', () => {
  const an = build(EXAMPLES[0].grammar);
  an.ff.steps.forEach((s) => assert.ok(s.reason && s.reason.length > 10));
  assert.strictEqual(an.ff.steps.length, an.grammar.nonTerminals.reduce((n, A) => n + setOf(an.ff.first[A]).length + setOf(an.ff.follow[A]).length, 0));
});

/* ------------------------------------------------------------------ */
section('LR(0) items');

test('closure of E\' → •E has 7 items', () => {
  const g = Grammar.parseGrammar(EXAMPLES[0].grammar);
  assert.strictEqual(SLR.closure(g, [{ p: 0, d: 0 }]).length, 7);
});
test('expression grammar has 12 states, I0..I11', () => {
  assert.strictEqual(build(EXAMPLES[0].grammar).lr0.states.length, 12);
});
test('state numbering matches the textbook: goto(I0,( ) = I4, goto(I0,id) = I5, goto(I4,E) = I8', () => {
  const st = build(EXAMPLES[0].grammar).lr0.states;
  const go = (i, X) => st[i].transitions.find((t) => t.sym === X).to;
  assert.strictEqual(go(0, '('), 4); assert.strictEqual(go(0, 'id'), 5);
  assert.strictEqual(go(4, 'E'), 8); assert.strictEqual(go(8, ')'), 11);
  assert.strictEqual(go(6, 'T'), 9); assert.strictEqual(go(7, 'F'), 10);
});
test('S → AA has 7 states with goto(I0,a) = I3, goto(I0,b) = I4  (p.175)', () => {
  const st = build('S -> AA\nA -> aA | b').lr0.states;
  assert.strictEqual(st.length, 7);
  assert.strictEqual(st[0].transitions.find((t) => t.sym === 'a').to, 3);
  assert.strictEqual(st[0].transitions.find((t) => t.sym === 'b').to, 4);
  assert.strictEqual(st[3].transitions.find((t) => t.sym === 'a').to, 3); // self loop
});
test('construction steps cover every transition exactly once', () => {
  const an = build(EXAMPLES[0].grammar);
  const transitions = an.lr0.states.reduce((n, s) => n + s.transitions.length, 0);
  assert.strictEqual(an.lr0.steps.length, transitions + 1);
});

/* ------------------------------------------------------------------ */
section('SLR(1) table');

test('S → AA table equals Module 2 p.177 exactly', () => {
  assert.deepStrictEqual(tableRows(build('S -> AA\nA -> aA | b')), [
    ['s3', 's4', '', '1', '2'],
    ['', '', 'acc', '', ''],
    ['s3', 's4', '', '', '5'],
    ['s3', 's4', '', '', '6'],
    ['r3', 'r3', 'r3', '', ''],
    ['', '', 'r1', '', ''],
    ['r2', 'r2', 'r2', '', '']
  ]);
});
test('expression grammar table equals the Dragon Book table (Fig. 4.37)', () => {
  // columns: + * ( ) id $ E T F
  assert.deepStrictEqual(tableRows(build(EXAMPLES[0].grammar)), [
    ['', '', 's4', '', 's5', '', '1', '2', '3'],
    ['s6', '', '', '', '', 'acc', '', '', ''],
    ['r2', 's7', '', 'r2', '', 'r2', '', '', ''],
    ['r4', 'r4', '', 'r4', '', 'r4', '', '', ''],
    ['', '', 's4', '', 's5', '', '8', '2', '3'],
    ['r6', 'r6', '', 'r6', '', 'r6', '', '', ''],
    ['', '', 's4', '', 's5', '', '', '9', '3'],
    ['', '', 's4', '', 's5', '', '', '', '10'],
    ['s6', '', '', 's11', '', '', '', '', ''],
    ['r1', 's7', '', 'r1', '', 'r1', '', '', ''],
    ['r3', 'r3', '', 'r3', '', 'r3', '', '', ''],
    ['r5', 'r5', '', 'r5', '', 'r5', '', '', '']
  ]);
});
test('expression grammar is SLR(1) but not LR(0)', () => {
  const t = build(EXAMPLES[0].grammar).table;
  assert.ok(t.isSLR); assert.ok(!t.isLR0);
});
test('S → AA is LR(0)', () => { assert.ok(build('S -> AA\nA -> aA | b').table.isLR0); });
test('Example 2 (p.179): reduce-reduce conflicts on a and c in the state after d', () => {
  const t = build('S -> Aa | bAc | Bc | bBa\nA -> d\nB -> d').table;
  assert.ok(!t.isSLR);
  assert.deepStrictEqual(t.conflicts.map((c) => c.type + ':' + c.sym), ['reduce-reduce:a', 'reduce-reduce:c']);
  assert.strictEqual(new Set(t.conflicts.map((c) => c.state)).size, 1);
});
test('Exercise 3 (p.183): one shift-reduce conflict on = (s6/r5)', () => {
  const an = build('S -> L = R | R\nL -> * R | id\nR -> L');
  assert.strictEqual(an.table.conflicts.length, 1);
  const c = an.table.conflicts[0];
  assert.strictEqual(c.type, 'shift-reduce'); assert.strictEqual(c.sym, '=');
  assert.strictEqual(SLR.cellText(an.table, c.state, '='), 's6/r5');
});
test('p.199 grammar: SLR(1), not LR(0); I0 reduces Y → ε on z', () => {
  const an = build('X -> Yz | a\nY -> bZ | ε\nZ -> ε');
  assert.ok(an.table.isSLR && !an.table.isLR0);
  assert.strictEqual(SLR.cellText(an.table, 0, 'z'), 'r4');
});
test('every reduce entry lies in a FOLLOW column of its left side', () => {
  EXAMPLES.forEach((ex) => {
    const an = build(ex.grammar);
    an.table.fills.filter((f) => f.entry.type === 'r').forEach((f) => {
      const A = an.grammar.productions[f.entry.prod].lhs;
      assert.ok(an.ff.follow[A][f.sym], ex.id + ': r' + f.entry.prod + ' under ' + f.sym);
    });
  });
});

/* ------------------------------------------------------------------ */
section('Parse simulation');

test('aabb trace equals Module 2 p.178', () => {
  const { r, rows } = trace(build('S -> AA\nA -> aA | b'), 'aabb');
  assert.ok(r.accepted);
  assert.deepStrictEqual(rows, ['0', '0a3', '0a3a3', '0a3a3b4', '0a3a3A6', '0a3A6', '0A2', '0A2b4', '0A2A5', '0S1']);
});
test('id + id * id is accepted in 14 moves and the tree respects precedence', () => {
  const { r } = trace(build(EXAMPLES[0].grammar), 'id + id * id');
  assert.ok(r.accepted); assert.strictEqual(r.steps.length, 14);
  const t = r.tree;
  assert.strictEqual(t.sym, 'E');
  assert.deepStrictEqual(t.children.map((c) => c.sym), ['E', '+', 'T']);
  assert.deepStrictEqual(t.children[2].children.map((c) => c.sym), ['T', '*', 'F']); // * binds tighter
});
test('tree leaves spell the input', () => {
  const leaves = (n) => (n.children.length ? n.children.flatMap(leaves) : n.sym === 'ε' ? [] : [n.sym]);
  ['id * ( id + id )', 'id', '( ( id ) )'].forEach((w) => {
    const { r } = trace(build(EXAMPLES[0].grammar), w);
    assert.deepStrictEqual(leaves(r.tree), w.split(' '));
  });
});
test('syntax error reports position, symbol and expected terminals', () => {
  const { r } = trace(build(EXAMPLES[0].grammar), 'id + * id');
  assert.ok(!r.accepted);
  assert.strictEqual(r.error.position, 2); assert.strictEqual(r.error.symbol, '*');
  assert.deepStrictEqual(sorted(r.error.expected), sorted(['(', 'id']));
});
test('premature end of input is an error on $', () => {
  const { r } = trace(build(EXAMPLES[0].grammar), 'id +');
  assert.ok(!r.accepted); assert.strictEqual(r.error.symbol, '$');
});
test('ε-reductions: balanced parentheses (()()) accepted, (() rejected', () => {
  const an = build('S -> ( S ) S | ε');
  assert.ok(trace(an, '( ( ) ( ) )').r.accepted);
  assert.ok(!trace(an, '( ( )').r.accepted);
  assert.ok(trace(an, '').r.accepted);
});
test('Exercise 2 (p.183): a * b + a accepted', () => {
  assert.ok(trace(build('E -> E + T|T\nT -> TF|F\nF -> F*| a | b'), 'a*b+a').r.accepted);
});
test('conflicting table still simulates and marks the guessed move', () => {
  const { r } = trace(build('S -> L = R | R\nL -> * R | id\nR -> L'), 'id = id');
  assert.ok(r.steps.some((s) => s.conflict));
});
test('every example grammar builds, and its sample input parses when SLR(1)', () => {
  EXAMPLES.forEach((ex) => {
    const an = build(ex.grammar);
    if (an.table.isSLR) assert.ok(trace(an, ex.input).r.accepted, ex.id);
  });
});

/* ------------------------------------------------------------------ */
section('Practice checking');

test('symbol sets accept braces, commas and eps', () => {
  assert.deepStrictEqual(Practice.parseSymbolSet('{ (, id }'), ['(', 'id']);
  assert.deepStrictEqual(Practice.parseSymbolSet('b eps'), ['b', 'ε']);
  assert.deepStrictEqual(Practice.parseSymbolSet(''), []);
});
test('entry normalisation', () => {
  assert.strictEqual(Practice.normalizeEntry('S5'), 's5');
  assert.strictEqual(Practice.normalizeEntry('shift 12'), 's12');
  assert.strictEqual(Practice.normalizeEntry('R3'), 'r3');
  assert.strictEqual(Practice.normalizeEntry('accept'), 'acc');
  assert.strictEqual(Practice.normalizeEntry(' - '), '');
  assert.strictEqual(Practice.normalizeEntry('07'), '7');
  assert.strictEqual(Practice.normalizeEntry('hello'), null);
});
test('conflict cells are compared as sets: r5/s6 equals s6/r5', () => {
  assert.ok(Practice.checkCell('s6/r5', 'r5 / S6').correct);
  assert.ok(!Practice.checkCell('s6/r5', 's6').correct);
});
test('FIRST/FOLLOW round covers every set and marks mistakes', () => {
  const an = build(EXAMPLES[0].grammar);
  const qs = Practice.firstFollowRound(an);
  assert.strictEqual(qs.length, 6);
  const q = qs.find((x) => x.id === 'FOLLOW:T');
  assert.ok(Practice.checkFirstFollow(q, '$ + ) *').correct);
  const bad = Practice.checkFirstFollow(q, '$ + id');
  assert.deepStrictEqual(sorted(bad.missing), sorted([')', '*'])); assert.deepStrictEqual(bad.extra, ['id']);
});
test('item-set questions: the answer is exactly the target state, distractors are not in it', () => {
  const an = build(EXAMPLES[0].grammar);
  const qs = Practice.itemsRound(an, Practice.rng(42), 3);
  assert.strictEqual(qs.length, 3);
  qs.forEach((q) => {
    assert.deepStrictEqual(sorted(q.answer), sorted(an.lr0.states[q.to].items.map(SLR.itemKey)));
    assert.ok(Practice.checkItems(q, q.answer).correct);
    q.candidates.filter((c) => !q.answer.includes(c.key)).forEach((c) => assert.ok(!an.lr0.states[q.to].items.some((it) => SLR.itemKey(it) === c.key)));
  });
});
test('table round hides the requested number of cells, with a variety of kinds', () => {
  const an = build(EXAMPLES[0].grammar);
  const qs = Practice.tableRound(an, Practice.rng(7), 10);
  assert.strictEqual(qs.length, 10);
  const kinds = new Set(qs.map((q) => (q.table === 'goto' ? 'g' : (q.answer[0] || '-'))));
  ['s', 'r', 'g', 'a', '-'].forEach((k) => assert.ok(kinds.has(k), 'missing kind ' + k));
  qs.forEach((q) => assert.ok(Practice.checkCell(q.answer, q.answer).correct));
});
test('same seed gives the same questions', () => {
  const an = build(EXAMPLES[0].grammar);
  const a = Practice.tableRound(an, Practice.rng(99), 8).map((q) => q.id);
  const b = Practice.tableRound(an, Practice.rng(99), 8).map((q) => q.id);
  assert.deepStrictEqual(a, b);
});
test('parse round asks one question per move with the simulator\'s answers', () => {
  const an = build('S -> AA\nA -> aA | b');
  const pr = Practice.parseRound(an, ['a', 'a', 'b', 'b']);
  assert.deepStrictEqual(pr.questions.map((q) => q.answer), ['s3', 's3', 's4', 'r3', 'r2', 'r2', 's4', 'r3', 'r1', 'acc']);
  assert.ok(Practice.checkMove(pr.questions[0], 'S3').correct);
  assert.ok(!Practice.checkMove(pr.questions[0], 'r3').correct);
});
test('SLR(1) question answer follows the conflict check', () => {
  assert.strictEqual(Practice.slrQuestion(build(EXAMPLES[0].grammar)).answer, true);
  assert.strictEqual(Practice.slrQuestion(build('S -> L = R | R\nL -> * R | id\nR -> L')).answer, false);
});

section('Test mode best result');
test('best key depends on the productions, not spacing or input', () => {
  const k = (t) => Practice.bestKey(Grammar.parseGrammar(t));
  assert.strictEqual(k('S -> AA\nA -> aA | b'), k('S->A A\n A -> a A|b'));
  assert.notStrictEqual(k('S -> AA\nA -> aA | b'), k('S -> AA\nA -> bA | a'));
});
test('higher score wins, then shorter time', () => {
  const b = { ok: 17, of: 20, ms: 700000 };
  assert.ok(Practice.isBetter({ ok: 18, of: 20, ms: 900000 }, b));
  assert.ok(!Practice.isBetter({ ok: 16, of: 20, ms: 1000 }, b));
  assert.ok(Practice.isBetter({ ok: 17, of: 20, ms: 600000 }, b));
  assert.ok(!Practice.isBetter({ ok: 17, of: 20, ms: 700000 }, b));
  assert.ok(!Practice.isBetter({ ok: 17, of: 20, ms: 800000 }, b));
  assert.ok(Practice.isBetter({ ok: 1, of: 2, ms: 5 }, null));
});
test('scores compare as fractions across different totals', () => {
  assert.ok(Practice.isBetter({ ok: 9, of: 10, ms: 5 }, { ok: 17, of: 20, ms: 5 }));
});
test('malformed stored data reads as no result', () => {
  ['', 'x', 'null', '5', '{}', '{"ok":3,"of":2,"ms":1}', '{"ok":1,"of":0,"ms":1}', '{"ok":"a","of":2,"ms":1}', '{"ok":1,"of":2,"ms":-1}'].forEach((r) => assert.strictEqual(Practice.parseBest(r), null, r));
  assert.strictEqual(Practice.parseBest(null), null);
  assert.deepStrictEqual(Practice.parseBest('{"ok":3,"of":4,"ms":900,"x":1}'), { ok: 3, of: 4, ms: 900 });
});

/* ------------------------------------------------------------------ */
console.log('\n========================================');
console.log(' SLR(1) Visualizer · test suite');
console.log('========================================');
Object.keys(results.groups).forEach((k) => {
  const g = results.groups[k];
  console.log(' ' + (k + ' ').padEnd(26, '.') + ' ' + (g.fail ? 'FAIL' : 'PASS') + '  (' + g.pass + '/' + (g.pass + g.fail) + ')');
});
console.log('----------------------------------------');
console.log(' Total: ' + (results.pass + results.fail) + '   Passed: ' + results.pass + '   Failed: ' + results.fail);
process.exit(results.fail ? 1 : 0);
