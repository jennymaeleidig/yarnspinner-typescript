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

### Declaring commands (`.ysls.json`)

A project can declare its custom commands and functions in `.ysls.json`
files (schema:
[schemas.yarnspinner.dev/ysls.schema.json](https://schemas.yarnspinner.dev/ysls.schema.json))
and point at them from the project file's `definitions` field:

```json
{
  "projectFileVersion": 4,
  "sourceFiles": ["**/*.yarn"],
  "baseLanguage": "en",
  "definitions": "./definitions.ysls.json"
}
```

```json
{
  "version": 1,
  "commands": [
    {
      "yarnName": "block",
      "parameters": [
        { "name": "id", "type": "string" },
        { "name": "placement", "type": "string", "defaultValue": "join" }
      ]
    }
  ]
}
```

`loadProject` reads those files through the project's file-system seam and
attaches the parsed declarations to `YarnProject.commandDefinitions`.
A `defaultValue` makes a parameter optional for count validation; a last
parameter with `isParamsArray: true` accepts any number of further
arguments. A malformed or unreadable file is a `YP0009`/`YP0010` warning
(the project still compiles).

### Command validation (opt-in)

Command names and arities can be linted against the built-ins plus the
declared set. Because upstream emits the two codes from its _language
server_, not its compiler, validation is **opt-in** — the default compile
path is unchanged:

```ts
loadProject({ project, fileSystem, validateCommands: true });
```

- unknown command → `YS0060` (`Unknown command: {0}`);
- wrong parameter count → `YS0061` (`Command {0} was called with {1}
parameters, but expected {2}`).

Input parameters are counted as whitespace-separated arguments; a
variadic/optional tail is honoured. Interpolated command names (`<<{ $cmd
}>>`) are left to runtime.

### Implementation notes (this runtime)

- Delivered command text is interpolated: `{expr}` inside the command is
  expanded before the `command` event reaches the host (upstream expands
  substitutions at delivery).
- `<<set>>`, `<<declare>>`, and `<<call>>` are state statements: they
  execute internally and never surface as `command` events (upstream
  behavior). `<<call f(args)>>` (upstream `CallStatement`) invokes the
  registered host function and discards its return value; an unknown
  function is a runtime diagnostic through `logError`, not a throw.
- `<<wait duration>>` is the built-in **consumer-timed command** (upstream
  engines implement the pause game-side — e.g. the vendored Space project's
  `<<wait 1>>`): it is delivered as an ordinary `command` event and ends
  that `continue()` batch; the host pauses for the duration and calls
  `continue()` again. The library ships no clock (coding standards §2) —
  the timing is entirely the consumer's.
- `<<set_saliency <mode>>>` (upstream Try Yarn Spinner's strategy-switch
  command) switches the active [saliency strategy](saliency.md); it is
  internal and never surfaces as an event either.
- `<<stop>>` halts dialogue immediately (a dialogue-complete event fires);
  `<<return>>` ends a detour, or acts as stop outside one.
