## Flow Control (Yarn Spinner)

Source: [docs.yarnspinner.dev — Flow Control](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/flow-control)

### What it covers

- Conditional blocks with `<<if>>`, `<<elseif>>`, `<<else>>`, `<<endif>>`.
- Loops and structural control features provided by Yarn (engine-dependent usage).
- Combining flow with variables and options.

### Example

```yarn
title: Start
---
<<set $affinity = 3>>
<<if $affinity >= 5>>
    NPC: We're close friends.
<<elseif $affinity >= 2>>
    NPC: We're friendly enough.
<<else>>
    NPC: Do I know you?
<<endif>>
===
```

### Implementation notes (this runtime)

- `<<stop>>` halts dialogue immediately: the stack clears and a
  dialogue-complete event fires — both the node-complete and complete events
  ride the same `continue()` batch that hit the stop, so afterwards further
  advances return no events.
- `<<return>>` pops to the detour's caller (recording the visit), or acts as
  stop outside a detour (upstream: ends the dialogue).
- Compound assignment `<<set $x += expr>>` (also `-=`, `*=`, `/=`, `%=`) is
  supported; string `+=` concatenates with upstream value rendering
  (booleans as `True`/`False`).
