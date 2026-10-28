# Viva Questions and Answers

Answers refer to this project's implementation where relevant.

### Parsing basics

**1. What is bottom-up parsing?**
Building the parse tree from the leaves (the input tokens) up to the root, by
repeatedly reducing a substring that matches a production's right side to its left
side. It traces a rightmost derivation in reverse.

**2. What is a handle?**
A substring matching the right side of a production whose reduction is one step of
the reverse rightmost derivation. LR parsers find handles on top of the stack.

**3. What are the four actions of a shift-reduce parser?**
Shift, reduce, accept, error. In the table they are `sj`, `rk`, `acc` and a blank cell.

**4. What does the "S", "L", "R" and "(1)" in SLR(1) mean?**
Simple LR: the input is scanned **L**eft to right, a **R**ightmost derivation is
produced in reverse, using **1** symbol of lookahead. "Simple" because lookahead is
taken from FOLLOW sets rather than computed per item.

**5. Why is the grammar augmented with S' → S?**
So that there is exactly one production whose reduction means success. The parser
accepts when it sees `S' → S •` with `$` as lookahead (rule 2(c)). The interface
shows the added production as (0).

### FIRST and FOLLOW

**6. Define FIRST(α).**
The set of terminals that can begin a string derived from α, plus ε if α ⇒* ε.

**7. Define FOLLOW(A).**
The set of terminals that can appear immediately to the right of A in some sentential
form, plus `$` if A can end the input.

**8. State the FOLLOW rules.**
(1) `$ ∈ FOLLOW(S)`; (2) for `A → αBβ`, FIRST(β) − {ε} ⊆ FOLLOW(B); (3) for `A → αB`,
or β ⇒* ε, FOLLOW(A) ⊆ FOLLOW(B). They are applied repeatedly until nothing changes;
stage 2 shows each pass.

**9. Why does SLR need FOLLOW sets?**
To decide on which lookaheads a completed item `A → α •` should reduce. Reducing only
under FOLLOW(A) removes many LR(0) conflicts.

**10. Why is ε never in a FOLLOW set?**
FOLLOW records terminals that can come after A; ε is not a terminal. End of input is `$`.

### Items, closure, goto

**11. What is an LR(0) item?**
A production with a dot in its right side, e.g. `E → E • + T`. The dot marks how much
of the right side has been seen. In code it is `{ p: production index, d: dot position }`.

**12. Kernel and closure items?**
Kernel items are `S' → • S` and every item whose dot is not at the left end. Closure
items have the dot at the left end and are added by closure. The diagram separates
them with a dashed line.

**13. What does closure do?**
If `A → α • B β` is in the set, it adds `B → • γ` for every production of B, repeating
until nothing new is added (Module 2, p. 171).

**14. What does goto(I, X) do?**
It moves the dot over X in every item of I that has X after the dot, then takes the
closure of the result (p. 172).

**15. How do you know goto produced an existing state?**
By comparing kernels. Two states with the same kernel have the same closure, so the
program compares the sorted set of `production.dot` pairs.

**16. How many states does the expression grammar have?**
Twelve, I0 to I11. The test suite checks this and the numbering of key transitions.

### Table construction

**17. When is ACTION[i, a] = shift j?**
When `A → α • a β` is in Ii and goto(Ii, a) = Ij (rule 2(a)).

**18. When is ACTION[i, a] = reduce A → α?**
When `A → α •` is in Ii, A is not S', and a ∈ FOLLOW(A) (rule 2(b)).

**19. What are the GOTO entries?**
goto(Ii, A) = Ij for a non-terminal A gives GOTO[i, A] = j. They are used right after a reduction.

**20. What does a blank cell mean?**
An error: the lookahead cannot follow what is on the stack. The parse stage reports the
position, the symbol, and the terminals that had entries in that row.

### Conflicts

**21. What is a shift-reduce conflict? Give an example.**
A cell needs both a shift and a reduce. In `S → L = R | R, L → * R | id, R → L`
(Exercise 3), state I2 has `S → L • = R` (shift on `=`) and `R → L •`, and `=` is in
FOLLOW(R), so ACTION[2, =] = `s6/r5`.

**22. What is a reduce-reduce conflict? Give an example.**
Two completed items whose FOLLOW sets overlap. In Example 2 (p. 179) the state after `d`
has `A → d •` and `B → d •`, and FOLLOW(A) ∩ FOLLOW(B) = { a, c }.

**23. Is a grammar with conflicts necessarily ambiguous?**
No. Both examples above are unambiguous; they are just not SLR(1). Exercise 3 is LALR(1),
because LALR computes per-item lookaheads that are finer than FOLLOW.

**24. How does the tool report a conflict?**
It never resolves it silently. It lists the type, state, lookahead, each competing
entry with its reason, and the items responsible, and marks the cell red with both entries.

**25. LR(0) vs SLR(1)?**
LR(0) reduces on every lookahead, so any state with a completed item and another action
conflicts. SLR(1) reduces only under FOLLOW. The p.199 grammar and the expression grammar
are SLR(1) but not LR(0); the Conflicts stage lists which states needed FOLLOW.

**26. Order the LR methods by power.**
LR(0) ⊂ SLR(1) ⊂ LALR(1) ⊂ CLR(1) in the grammars they accept. SLR and LALR tables have the
same number of states as LR(0); CLR may have many more.

### Parsing

**27. What is on the stack?**
Alternating grammar symbols and states, e.g. `0 E 1 + 6 T 9`, as in the textbook trace.
The state on top summarises the whole stack.

**28. What happens on a reduce by A → β?**
Pop 2·|β| entries (|β| symbol/state pairs), look at the exposed state t, push A and GOTO[t, A].
For ε-productions nothing is popped.

**29. How is the parse tree built?**
A shift adds a leaf. A reduce takes the top |β| subtrees and makes them children of a new
node A (or an ε leaf for an ε-production). On accept one tree remains.

**30. How does the tree show operator precedence?**
For `id + id * id` the root is `E → E + T`, and `*` sits inside the right T (`T → T * F`).
So the multiplication is grouped first; this is checked by a test.

### Implementation

**31. Why separate the engine from the interface?**
So the construction can be tested in Node on known grammars before it is drawn, and the
same results feed both Visualize and Practice.

**32. How is "step by step" implemented?**
Each stage records an ordered list of steps (set additions, gotos, cell fills, parse moves).
The interface shows the first k steps; stepping back just shows fewer.

**33. How are compact grammars like `A → aA` read?**
Greedy longest match against the known non-terminals and a few word terminals (`id`, `num`,
…); otherwise one character per symbol. The Grammar stage shows how each compact word was split.

**34. How does Practice mode check answers?**
Against the engine's own results: sets compared as sets, cells normalised (`S5` = `s5`,
blank = error) and compared as sets of entries, and parse moves against the simulator.
Each mark comes with the reason for the correct entry.

**35. Why D3.js?**
It binds data to SVG with enter/update/exit, which suits states and nodes that appear one
at a time, and gives zoom, pan and drag for the automaton and tree.

**36. How do you know the results are correct?**
47 automated tests compare against the lecture notes (the S → AA table on p. 177, the
`aabb` trace on p. 178, the Example 2 and Exercise 3 conflicts) and the Dragon Book table for
the expression grammar.

**37. What are the limitations?**
SLR(1) only (no CLR/LALR tables), no precedence declarations, stops at the first error,
and compact notation splits unknown multi-letter words.

**38. How would you extend it to LALR(1)?**
Build LR(1) items (item plus lookahead), then merge states with identical cores, or
propagate lookaheads on the LR(0) collection directly. The table rules stay the same except
that rule 2(b) uses the item's lookahead set instead of FOLLOW(A).
