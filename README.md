# SLR(1) Parser — Step by Step

**Compiler Design Lab**  
**Project by:** Mohammed Asif (24BCE2076)

## Overview

This project is an interactive learning tool for understanding how an **SLR(1) parser** works. It takes a context-free grammar and an input string, then guides the user through the main parsing stages: FIRST and FOLLOW sets, LR(0) item sets, the SLR(1) parsing table, conflict checks, and parsing the input. A practice mode lets users complete parts of the process and check their answers.

## How to Run

1. Clone or download the repository.
2. Open `SLR-Parser.html` in a modern web browser.
3. Enter a grammar and an input string, then select **Build parser**.
4. Use **Next step** to follow the parsing process, or open Practice mode to try it yourself.

Example grammar:
```text
S -> AA
A -> aA | b
```

Example input: `aabb`

The application runs locally in the browser. An internet connection may be needed to load external fonts.

## Repository Structure

- `SLR-Parser.html` — Standalone browser application.
- `source/` — Application source code, parser engine, and tests.
- `docs/` — Design notes and viva questions.
- `backups/` — Earlier versions of the application.
- `templates/` — Supporting template files.
- `README.txt` — Original project usage notes.

## Run Tests

If Node.js is installed, run this command from the repository root:

```bash
node source/tests/run-tests.js
```

