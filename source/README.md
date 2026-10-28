# SLR(1) Parser, Step by Step

**Main app: open `final/index.html`** (or `index.html`, which redirects there). Earlier design rounds: `all-designs.html`, `templates/`, `demos*/`.

**Compiler Design Lab · Slot L37 + L38**
Ragunandhan T (24BCE0721) · Suyambulingam (24BCE0726) · Guruprasad V (24BCE0761)

A web application that builds an SLR(1) parser for any context-free grammar
**one visible step at a time** and then lets you practise the same construction
yourself. It runs entirely in the browser: no installation, no server-side code.

---

## Five interfaces to choose from

`index.html` is a chooser with live previews of five complete front ends. All of them
run the same engine and the same production-by-production grammar input; only the
layout, navigation and look differ.

| | Template | Folder | Idea |
|---|---|---|---|
| A | IDE Workbench | `templates/ide/` | Code-editor layout: `grammar.y`, one file per stage, debugger-style stepping (F10), inspector, Problems panel, status bar |
| B | Chalkboard Lecture | `templates/chalk/` | One board per step, chalk-drawn automaton and table, the stage's rule in the margin, notebook dialog for the grammar |
| C | Scroll Story | `templates/story/` | Editorial long-read; sticky figures advance as you scroll |
| D | Control Room | `templates/dashboard/` | All stages on one screen, one master timeline you can scrub |
| E | SLR/OS Terminal | `templates/terminal/` | Phosphor CRT; `NEW` asks "Enter number of productions:" then each production; ASCII tables plus a graphics monitor |

The first single-page version is kept as `classic.html` (the only one with Practice mode so far).

### Entering a grammar
Set the **number of productions**, then fill one row per production: left side → right
side, with an ε button and add/remove. Rows are checked as you type (empty left side,
spaces in the left side, `$` used), compact right sides show how they were read
(`aA` → `a A`), and symbols that look like non-terminals but have no production are
flagged. The input string can be typed or built by tapping terminal chips. A text mode
for pasting a whole grammar stays in sync with the rows.

Notation copied from PDFs is cleaned before reading: `⟶ ⇒ → =>` arrows, `∈ ϵ Λ λ` for ε,
curly primes (`S’`), and full-width characters.

## What it does

| Stage | What you see |
|---|---|
| 1 · Grammar | The augmented grammar `S' → S`, productions numbered from (0), terminals and non-terminals, the input split into tokens. Compact rules such as `A -> aA` are read as `A → a A`, and the screen says so. |
| 2 · FIRST & FOLLOW | Both sets built rule by rule until nothing changes. Every symbol in every set can be selected to show the rule that put it there. |
| 3 · LR(0) items | The canonical collection, built with closure and goto one transition at a time and drawn as an automaton (D3.js). States are draggable; the view zooms and pans. A list view shows the item sets in textbook form. |
| 4 · Parsing table | The ACTION and GOTO table filled cell by cell: shift from goto on a terminal, reduce only under FOLLOW of the left side, accept on `$`. Selecting any cell explains it and highlights the item responsible. Exports as CSV. |
| 5 · Conflicts | Each conflicting cell is named with its type (shift-reduce / reduce-reduce), state, lookahead and competing items, instead of being resolved silently. Also shows whether the grammar is LR(0) and which states need FOLLOW sets. |
| 6 · Parse | The input is parsed with step forward / back / run / reset. The stack and input tape animate, each move gives its reason (the ACTION and GOTO cells used), and the parse tree grows on every reduce. Errors give the position, the unexpected symbol and the symbols that were valid there. |

### Practice mode
The same grammar, done by you, in four marked rounds:

1. **FIRST & FOLLOW**: type every set.
2. **Item sets**: for some transitions, tick every item of `goto(Ii, X)`, closure items included.
3. **Parsing table**: fill in hidden ACTION/GOTO cells (6, 10, 14 or 20), and say whether the grammar is SLR(1).
4. **Parse moves**: give the next ACTION entry at every configuration of a real parse.

Every answer is checked against the engine's own construction. A wrong answer is
shown with the correct entry and **the reason for it**. The summary gives a score per
round, remembers your best score per grammar, and links to the stage to review.

### Other tools
- **Examples**: the worked examples and exercises from the Module 2 notes (S → AA from pp. 175–178, Example 2 on p. 179, Exercises 1–3 on p. 183, the ε-grammar on p. 199) plus the expression grammar.
- **Share link**: puts the grammar and input in the URL, so opening the link reproduces the example.
- **Print / PDF**: prints the current stage with the controls hidden.
- **PNG export** of the automaton and the parse tree.
- **Light / dark** theme; keyboard control (← → step, Space run/pause, Home/End).

---

## Running it

The application is static files. Either:

```bash
python -m http.server 5173
```

then open <http://localhost:5173> and pick an interface, **or** open `index.html` directly in a browser.

D3.js 7.9.0 is loaded from cdnjs. For offline use (e.g. a lab without internet),
save `d3.min.js` from <https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js>
as `js/vendor/d3.min.js`; the page uses the local copy first. Without D3 the tables,
traces and practice still work; only the three drawings are replaced by a notice.

## Tests

```bash
node tests/run-tests.js
```

49 tests in six groups (grammar input, FIRST/FOLLOW, LR(0) items, SLR table,
parse simulation, practice checking). Expected values are taken from the Module 2
lecture notes and the standard Dragon Book tables, not from the program's own
output. For example, the S → AA table is checked cell by cell against p. 177 and the
`aabb` trace against p. 178.

## Grammar notation

```
E -> E + T | T          arrows: ->  -->  →  ::=
T -> T * F | F          | separates alternatives
F -> ( E ) | id         a line starting with | continues the previous rule
A -> aA | b             compact form: aA is read as a A
Y -> bZ | ε             ε, eps, epsilon, # or an empty alternative
S -> 'if' C 'then' S    quotes keep a multi-letter terminal whole
```

The first rule's left side is the start symbol. Non-terminals are exactly the
symbols that appear on a left-hand side. `$` is reserved for end of input. Tick
*Every space-separated word is one symbol* for grammars with keyword terminals.

## Project structure

```
cd_pro/
├── index.html            chooser: live previews of the five interfaces
├── classic.html          the first single-page version (with Practice mode)
├── templates/            ide/ chalk/ story/ dashboard/ terminal/  (index.html, style.css, app.js each)
├── css/style.css         paper-and-ink theme, light/dark, print, responsive
├── js/
│   ├── grammar.js        grammar text → productions; input → tokens
│   ├── slr.js            engine: FIRST/FOLLOW, closure/goto, table, conflicts, parse
│   ├── practice.js       practice questions and answer checking (no DOM)
│   ├── examples.js       grammar bank (Module 2 examples)
│   ├── viz.js            D3/SVG: automaton, parse tree, stack & input tape, PNG export
│   ├── core.js           shared session layer: "what does stage X look like at step i?"
│   ├── rows.js           production-by-production grammar editor (shared by templates)
│   ├── player.js         step / back / play timing
│   ├── app.js            Visualize mode: stages, steppers, inspectors, share/print/theme
│   └── practice-ui.js    Practice mode interface
├── tests/run-tests.js    automated tests (Node, no dependencies)
└── docs/
    ├── DESIGN.md         architecture, data flow and algorithms
    └── VIVA_QUESTIONS.md likely viva questions with answers
```

The engine (`grammar.js`, `slr.js`, `practice.js`) has no DOM code and runs
unchanged in Node, so it is tested on known grammars before anything is drawn.

## Limitations

- SLR(1) only. LR(0) is reported as a yes/no check; CLR(1) and LALR(1) are not built.
- When a grammar has conflicts, the parse simulation uses the first entry written to
  a conflicting cell and marks those moves. There is no precedence/associativity
  declaration to resolve conflicts on purpose.
- The parser stops at the first syntax error (no panic-mode recovery).
- In compact form, a run of letters is split into single-letter symbols unless it is a
  non-terminal name, a quoted word, or one of `id num number digit int float char string literal`.

## Possible extensions

From the project abstract's scope for enhancement: a comparison mode for LR(0) /
SLR(1) / CLR(1) / LALR(1); `%left` / `%right` style precedence; an integrated lexical
analyser stage; syntax-directed translation (emit three-address code on each reduce);
panic-mode error recovery.
