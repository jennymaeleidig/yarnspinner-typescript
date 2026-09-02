## Commands (Yarn Spinner)

Source: [docs.yarnspinner.dev — Commands](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/commands)

### What it covers
- Inline instructions to the host game/engine using `<<command ...>>`.
- Often used to trigger animations, SFX, gameplay events, or state changes.

### Examples
```yarn
title: Start
---
Narrator: Opening the door.
<<play_sfx name="door_open">>
<<animate target="Door" action="Open">>
===
```

Exact command names and parameters are defined by your game integration.

### Implementation notes (this runtime)
- Delivered command text is interpolated: `{expr}` inside the command is
  expanded before the `command` event reaches the host (upstream expands
  substitutions at delivery).
- `<<set>>`, `<<declare>>`, and `<<call>>` are state statements: they
  execute internally and never surface as `command` events (upstream
  behavior).
- `<<set_saliency <mode>>>` (upstream Try Yarn Spinner's strategy-switch
  command) switches the active [saliency strategy](saliency.md); it is
  internal and never surfaces as an event either.
- `<<stop>>` halts dialogue immediately (a dialogue-complete event fires);
  `<<return>>` ends a detour, or acts as stop outside one.


