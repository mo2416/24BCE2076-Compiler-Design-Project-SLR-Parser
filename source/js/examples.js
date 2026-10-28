/*
 * examples.js — the grammar bank.
 * Most entries are the worked examples and exercises from the Module 2 lecture
 * notes (Syntax Analysis), so results can be checked against the notes.
 */
(function (root) {
  'use strict';

  var EXAMPLES = [
    {
      id: 'expr',
      title: 'E → E + T | T,  T → T * F | F,  F → ( E ) | id',
      source: 'Project worked example · closure/goto, Module 2 p.171',
      grammar: 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id',
      input: 'id + id * id',
      note: 'The classic left-recursive expression grammar. SLR(1), not LR(0); 12 states.'
    },
    {
      id: 'saa',
      title: 'S → A A,  A → a A | b',
      source: 'Module 2 p.175–178 (SLR example, parse of aabb)',
      grammar: 'S -> AA\nA -> aA | b',
      input: 'aabb',
      note: 'Seven states. Compare the table and the trace with pages 177 and 178.'
    },
    {
      id: 'ex2',
      title: 'S → A a | b A c | B c | b B a,  A → d,  B → d   (not SLR)',
      source: 'Module 2 p.179',
      grammar: 'S -> Aa | bAc | Bc | bBa\nA -> d\nB -> d',
      input: 'bdc',
      note: 'A → d• and B → d• share a state, and FOLLOW(A) ∩ FOLLOW(B) = { a, c }. Not SLR(1).'
    },
    {
      id: 'exer1',
      title: 'E → E + T | T,  T → T * F | F,  F → id',
      source: 'Module 2 p.183, exercise 1',
      grammar: 'E -> E + T | T\nT -> T * F | F\nF -> id',
      input: 'id * id + id',
      note: 'The expression grammar without parentheses.'
    },
    {
      id: 'exer2',
      title: 'E → E + T | T,  T → T F | F,  F → F * | a | b',
      source: 'Module 2 p.183, exercise 2',
      grammar: 'E -> E + T | T\nT -> TF | F\nF -> F* | a | b',
      input: 'a * b + a',
      note: 'Written in compact form: TF means T F, and F* means F *.'
    },
    {
      id: 'exer3',
      title: 'S → L = R | R,  L → * R | id,  R → L   (not SLR)',
      source: 'Module 2 p.183, exercise 3',
      grammar: 'S -> L = R | R\nL -> * R | id\nR -> L',
      input: '* id = id',
      note: 'Unambiguous, but not SLR(1): in the state with S → L•=R and R → L•, the symbol = is in FOLLOW(R).'
    },
    {
      id: 'eps',
      title: 'X → Y z | a,  Y → b Z | ε,  Z → ε',
      source: 'Module 2 p.199',
      grammar: 'X -> Yz | a\nY -> bZ | ε\nZ -> ε',
      input: 'b z',
      note: 'Not LR(0) (I0 can shift a or reduce Y → ε) but SLR(1), because FOLLOW(Y) = { z }.'
    },
    {
      id: 'paren',
      title: 'S → ( S ) S | ε',
      source: 'Additional example',
      grammar: 'S -> ( S ) S | ε',
      input: '( ( ) ( ) )',
      note: 'A nullable start symbol: reductions by S → ε appear in several states.'
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
  else root.EXAMPLES = EXAMPLES;
})(this);
