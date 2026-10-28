SLR(1) Parser, Step by Step
Compiler Design Lab, slot L37 + L38
Ragunandhan T (24BCE0721) · Suyambulingam (24BCE0726) · Guruprasad V (24BCE0761)

OPEN IT
  Online:  https://claude.ai/artifact/XiLWtpewKGKkncjFG71BFA
  Offline: double-click SLR-Parser.html (one file, works in any browser; fonts need internet)

HOW TO USE
  1. Type your grammar, one production per row (a new row appears as you type).
     Example:  S -> AA   and   A -> aA | b
  2. Type the input string to parse, for example  aabb
  3. Press "Build parser".
  4. Teach: press "Next step" to build FIRST/FOLLOW, the LR(0) item sets, the SLR(1) table,
     check conflicts and parse the input, one step at a time with the reason for each step.
  5. Practice: solve the whole worksheet yourself from scratch, then press "Check" on each
     part; every wrong entry is marked with the reason. "Show answer" fills a part.

FOLDERS
  SLR-Parser.html   the app, everything in one file
  docs/             DESIGN.md (architecture and algorithms), VIVA_QUESTIONS.md
  source/           source code: final/index.html, js/ (engine), tests/
                    run the tests with:  node source/tests/run-tests.js
