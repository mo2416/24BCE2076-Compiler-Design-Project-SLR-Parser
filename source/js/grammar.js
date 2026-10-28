/*
 * grammar.js — reads a context-free grammar typed by the user.
 *
 * Accepted notation (the same forms used in the lecture notes):
 *   E -> E + T | T        arrows: ->  -->  →  ::=
 *   A -> aA | b           compact form: symbols written without spaces
 *   A -> ε                epsilon: ε  eps  epsilon  #  λ  or an empty alternative
 *   S -> 'if' C 'then' S  quotes force a multi-character terminal
 *
 * Non-terminals are exactly the symbols that appear on a left-hand side.
 * Everything else on a right-hand side is a terminal.
 */
(function (root) {
  'use strict';

  var EPS_WORDS = ['ε', 'eps', 'epsilon', '#', 'λ', 'Λ', "''"];
  // Multi-character terminals recognised inside compact alternatives such as "id+id".
  var WORD_TERMINALS = ['id', 'num', 'number', 'digit', 'int', 'float', 'char', 'string', 'literal'];
  var ARROW = /\s*(?:-->|->|→|::=)\s*/;

  /*
   * Clean notation copied from PDFs and slides before reading it:
   *   full-width / subscript characters (NFKC), curly or typographic primes,
   *   arrow variants ⟶ ⇒ ⟹ ➝ =>, and ε look-alikes ϵ ∈ Є.
   */
  function normalize(text) {
    var t = String(text);
    if (t.normalize) t = t.normalize('NFKC');
    return t
      .replace(/[\u2018\u2019\u2032\u02B9\u00B4`]/g, "'")
      .replace(/\u2033/g, "''")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s*(?:\u27F6|\u21D2|\u27F9|\u279D|\u279E|\u2192|=>)\s*/g, ' -> ')
      .replace(/[\u03F5\u2208\u0404]/g, 'ε')
      .replace(/[\u2013\u2014]>/g, '->')
      .replace(/\u00A0/g, ' ');
  }

  function GrammarError(message, line) {
    this.name = 'GrammarError';
    this.message = message;
    this.line = line;
  }
  GrammarError.prototype = Object.create(Error.prototype);

  /* Split a chunk like "aA" or "E'+T" into symbols using greedy longest match. */
  function splitCompact(chunk, known) {
    var out = [];
    var i = 0;
    while (i < chunk.length) {
      if (chunk[i] === "'" && chunk.indexOf("'", i + 1) > i + 1) {
        var end = chunk.indexOf("'", i + 1);
        out.push(chunk.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      var best = '';
      for (var k = 0; k < known.length; k++) {
        var s = known[k];
        if (s.length > best.length && chunk.substr(i, s.length) === s) best = s;
      }
      if (!best) best = chunk[i];
      out.push(best);
      i += best.length;
    }
    return out;
  }

  function tokenizeAlternative(text, known, spaceOnly, splits, line) {
    var t = text.trim();
    if (t === '' || EPS_WORDS.indexOf(t) >= 0) return [];
    var chunks = t.split(/\s+/);
    var syms = [];
    chunks.forEach(function (c) {
      if (EPS_WORDS.indexOf(c) >= 0) return;
      if (/^'.+'$/.test(c)) { syms.push(c.slice(1, -1)); return; }
      if (spaceOnly || known.indexOf(c) >= 0) { syms.push(c); return; }
      var parts = splitCompact(c, known);
      if (parts.length > 1 && splits) splits.push({ text: c, symbols: parts, line: line });
      parts.forEach(function (s) { syms.push(s); });
    });
    return syms;
  }

  /*
   * parseGrammar(text, options) -> grammar object
   *   options.spaceOnly: true = every whitespace-separated word is one symbol
   */
  function parseGrammar(text, options) {
    var spaceOnly = !!(options && options.spaceOnly);
    var rawRules = [];
    var lines = normalize(text).split(/\r?\n/);
    var last = null;

    lines.forEach(function (line, idx) {
      var clean = line.replace(/\/\/.*$/, '').trim();
      if (!clean) return;
      if (ARROW.test(clean)) {
        var parts = clean.split(ARROW);
        var lhs = parts[0].trim();
        if (!lhs || /\s/.test(lhs)) {
          throw new GrammarError('Line ' + (idx + 1) + ': the left-hand side must be one non-terminal, found "' + lhs + '".', idx + 1);
        }
        last = { lhs: lhs, rhs: parts.slice(1).join('->'), line: idx + 1 };
        rawRules.push(last);
      } else if (clean[0] === '|' && last) {
        last.rhs += ' ' + clean;                 // continuation line:  | T
      } else {
        throw new GrammarError('Line ' + (idx + 1) + ': expected a rule like  A -> α , found "' + clean + '".', idx + 1);
      }
    });

    if (!rawRules.length) throw new GrammarError('The grammar is empty. Enter at least one rule such as  S -> a S | b.', 0);

    var nonTerminals = [];
    rawRules.forEach(function (r) { if (nonTerminals.indexOf(r.lhs) < 0) nonTerminals.push(r.lhs); });

    var known = nonTerminals.concat(WORD_TERMINALS).sort(function (a, b) { return b.length - a.length; });

    var productions = [];
    var splits = [];
    rawRules.forEach(function (r) {
      r.rhs.split('|').forEach(function (alt) {
        var rhs = tokenizeAlternative(alt, known, spaceOnly, splits, r.line);
        var dup = productions.some(function (p) { return p.lhs === r.lhs && p.rhs.join('\u0001') === rhs.join('\u0001'); });
        if (!dup) productions.push({ lhs: r.lhs, rhs: rhs, line: r.line });
      });
    });

    var terminals = [];
    productions.forEach(function (p) {
      p.rhs.forEach(function (s) {
        if (nonTerminals.indexOf(s) < 0 && terminals.indexOf(s) < 0) terminals.push(s);
      });
    });
    if (terminals.indexOf('$') >= 0) throw new GrammarError('"$" is reserved for the end-of-input marker and cannot be used as a terminal.', 0);

    var start = nonTerminals[0];
    var aug = start + "'";
    while (nonTerminals.indexOf(aug) >= 0 || terminals.indexOf(aug) >= 0) aug += "'";

    var augmented = [{ lhs: aug, rhs: [start], line: 0 }].concat(productions);
    augmented.forEach(function (p, i) { p.index = i; });

    var warnings = [];
    nonTerminals.forEach(function (nt) {
      var used = nt === start || productions.some(function (p) { return p.rhs.indexOf(nt) >= 0; });
      if (!used) warnings.push('Non-terminal ' + nt + ' is never used on any right-hand side (unreachable).');
    });

    return {
      start: start,
      augmentedStart: aug,
      nonTerminals: [aug].concat(nonTerminals),
      terminals: terminals,
      productions: augmented,
      warnings: warnings,
      splits: splits,
      mode: spaceOnly ? 'space' : 'auto'
    };
  }

  /* Split an input string into grammar terminals (longest match). "id+id*id" -> [id,+,id,*,id] */
  function tokenizeInput(text, grammar) {
    var terms = grammar.terminals.slice().sort(function (a, b) { return b.length - a.length; });
    var out = [];
    var chunks = normalize(text).trim().split(/\s+/).filter(Boolean);
    for (var c = 0; c < chunks.length; c++) {
      var chunk = chunks[c];
      if (chunk === '$') continue;
      if (terms.indexOf(chunk) >= 0) { out.push(chunk); continue; }
      var i = 0;
      while (i < chunk.length) {
        var best = '';
        for (var k = 0; k < terms.length; k++) {
          if (terms[k].length > best.length && chunk.substr(i, terms[k].length) === terms[k]) best = terms[k];
        }
        if (!best) {
          throw new GrammarError('Input symbol "' + chunk.slice(i) + '" is not a terminal of this grammar. Terminals are: ' + grammar.terminals.join('  '), 0);
        }
        out.push(best);
        i += best.length;
      }
    }
    return out;
  }

  function productionToString(p) {
    return p.lhs + ' → ' + (p.rhs.length ? p.rhs.join(' ') : 'ε');
  }

  var api = {
    parseGrammar: parseGrammar,
    tokenizeInput: tokenizeInput,
    productionToString: productionToString,
    normalize: normalize,
    GrammarError: GrammarError
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Grammar = api;
})(this);
