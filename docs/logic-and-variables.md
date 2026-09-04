## Logic and Variables (Yarn Spinner)

Source: [docs.yarnspinner.dev — Logic and Variables](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/logic-and-variables)

### What it covers
- Declaring and using variables; reading and writing from the game.
- Basic expressions for conditions and assignments.
- Interpolating values in lines.

### Examples
```yarn
title: Start
---
<<set $hasKey = true>>
<<set $score = 10 + 5>>

<<if $hasKey>>
    Narrator: You unlock the door. Score: {$score}
<<else>>
    Narrator: The door is locked.
<<endif>>
===
```

### Implementation notes (this runtime)
- `<<declare $var = expr (as type)?>>`d variables are seeded into variable
  storage at start-up (upstream `Program.InitialValues`), so they exist before
  the first node runs; host-provided variables override the declared defaults.
- `///` documentation comments above a `<<declare>>` become that declaration's
  `description` in the compile result (upstream `Declaration.Description`; the
  VS Code editor docs call this [Variable
  Documentation](https://docs.yarnspinner.dev/write-yarn-scripts/yarn-spinner-editor/writing-yarn-in-vs-code)).
  Consecutive `///` lines join with a space, both ends trimmed; the comment
  attaches to the next `<<declare>>` in the file even across block boundaries
  (never across node boundaries) and is dropped if no declaration follows.
- Dialogue options accept a `variableStorage` — the pluggable variable storage
  holding story variables and generated variables alike (in-memory default).
  Injecting a pre-populated `VariableStorage` is the persistence seam: restore
  by re-injecting a storage whose `entries()` mirror the host's saved state;
  declare-default seeding skips names it already holds. Generated keys (the
  reserved `Yarn.Internal.` namespace) appear in `entries()` but not in
  `Dialogue.getVariables()` snapshots.
- Booleans interpolate as upstream's C# `ToString`: `True`/`False`.
- String `+` concatenates; comparing against an unset variable uses the
  implicit type default (bool→false, number→0, string→"") — a recorded
  adaptation.


