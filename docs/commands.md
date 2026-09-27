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

### Writing custom commands (host side)

Declaration in `.ysls.json` makes a command's _name and arity_ known to the
compiler and editor tooling (the lint below). To actually **run** a
command, register a handler on the runtime `Library`:

```ts
import { compileSource, Dialogue, Library } from "yarnspinner-typescript";

const library = new Library();
library.registerCommandHandler("play_sfx", (params) => {
  // `<<play_sfx door_open>>` → params = ["door_open"]
  playSound(params[0]);
});

const { program } = compileSource(source, { library });
const dialogue = new Dialogue(program, { startAt: "Start", library });
```

- The handler fires when a `command` event is delivered, and the event is
  **still surfaced** to the consumer. The registry is a convenience for host
  side effects; a host that ignores it can switch on the delivered
  `event.command` text instead.
- Parameters are parsed once, for both the handler and the event:
  whitespace-separated with quote awareness. `registerCommandHandler`
  receives them quote-stripped (`"door_open"` → `door_open`); the event
  keeps the authored, interpolated text.
- Handlers are synchronous. The engine never awaits them — do the work (or
  schedule it) and delay the next `continue()` if the dialogue should
  pause. A handler that throws is logged as a runtime diagnostic, not
  propagated.
- Matching is case-insensitive, and registering a duplicate name throws
  (host programming error, as upstream). `deregisterCommandHandler(name)`
  removes one.
- Built-in state statements (`<<set>>`/`<<declare>>`/`<<call>>`) and the
  core ops (`<<stop>>`/`<<return>>`/`<<set_saliency>>`) never reach a
  handler — see the next sections.

### Built-in commands: `<<stop>>` and `<<wait>>`

**`<<stop>>` is a core op.** It ends the current node and every detour on
it, unwinds the call stack (each frame firing its own `nodeComplete`), and
completes the dialogue. It never surfaces as a `command` event. `<<return>>`
is its detour counterpart — inside a detour it returns to the caller;
outside one it stops as well. (The `Dialogue.stop()` _method_ is a
separate, host-driven stop.)

**`<<wait duration>>` is the built-in consumer-timed command.** Upstream's
compiler has no command table at all — its engine integrations (Unity's
`WaitForSeconds`-backed command, Bevy's handler) own the pause. This runtime
follows that layering: `<<wait 1>>` is delivered like any other command and
ends the `continue()` batch; here is the whole implementation a host needs:

```ts
function run(dialogue: Dialogue) {
  for (;;) {
    for (const event of dialogue.continue()) {
      if (event.type === "command") {
        const [name, duration] = event.command.split(/\s+/);
        if (name === "wait") {
          setTimeout(() => run(dialogue), Number(duration) * 1000);
          return; // resume the pull when the pause elapses
        }
        handleCommand(event.command);
      }
    }
    if (dialogue.isComplete) return;
  }
}
```

Because _every_ command is already a stopping point in this pull API, a
host that wants commands to run without stopping uses the drain helpers
(`runUntilComplete` / `runUntilCompleteEvents`), which auto-continue across
`command` stops. The library ships no clock (coding standards §2) — the
timing is entirely the consumer's.

The runtime neither waits nor errors on a malformed `<<wait>>`; its
one-parameter arity is checked only under the opt-in command validation
below.

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

Input parameters are counted with upstream's structured-command grammar (a
full expression or `func(1, 2)` is one parameter); a variadic/optional tail
is honoured. Interpolated command names (`<<{ $cmd
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
- `<<set_saliency <mode>>>` (upstream Try Yarn Spinner's strategy-switch
  command) switches the active [saliency strategy](saliency.md); it is
  internal and never surfaces as an event either.
