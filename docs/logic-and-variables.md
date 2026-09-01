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
- Booleans interpolate as upstream's C# `ToString`: `True`/`False`.
- String `+` concatenates; comparing against an unset variable uses the
  implicit type default (bool→false, number→0, string→"") — recorded
  adaptation, see `.scratch/ys32-parity/spec.md`.


