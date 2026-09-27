## Functions (Yarn Spinner)

Source: [docs.yarnspinner.dev — Functions](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/functions)

### What it covers

- Use functions in expressions for calculations and queries.
- Custom functions can be exposed by the host game.

### Examples

```yarn
title: Start
---
<<set total = add(2, 3)>>
Narrator: The total is {total}.
===
```

Function names/arity/behavior depend on your integration’s function bindings.

### Writing custom functions

Register a function on the runtime `Library`; it becomes callable from any
Yarn expression — lines, `<<if>>`, `<<set>>`, and `<<call>>`:

```ts
import { compileSource, Dialogue, Library } from "yarnspinner-typescript";

const library = new Library();
library.registerFunction(
  "add",
  (a: number, b: number) => Number(a) + Number(b),
  { params: ["number", "number"], returns: "number" },
);

// Pass the same library to the compiler so its signatures feed the checker.
const { program, diagnostics } = compileSource(source, { library });
const dialogue = new Dialogue(program, { startAt: "Start", library });
```

- The optional third argument is the compile-time signature
  `{ params, returns, variadic? }`, where each type is one of `number`,
  `string`, `bool`, or `any`. Passing the same `library` to `compileSource`
  (or `loadProject`) feeds it to the type checker for arity and
  argument-type errors — the same information upstream derives from the
  delegate's .NET parameter types. Without a signature a call is still
  accepted and typed implicitly from its usage (upstream's implicit function
  declarations); it is then simply not arity/type-checked.
- Function names are matched **exactly** (case-sensitive), as upstream.
  `registerFunction` throws on a duplicate name (host programming error,
  upstream's `ArgumentException`); `deregisterFunction(name)` removes one.
- Variadic functions are ordinary TypeScript rest-parameter callables; add
  `variadic: true` to the signature so the checker accepts extra arguments.
- `<<call add(1, 2)>>` invokes the function and discards its return value,
  so side-effecting helpers run even when nothing is assigned.
- Built-in functions (`visited`, `random`, …) are registered the same way
  at dialogue construction and can be overridden by an imported library.
- `.ysls.json` `functions` entries are parsed onto
  `YarnProject.commandDefinitions` for editor tooling, but compile-time
  signature checking reads the `Library` (or explicit
  `declarations.functions`), not the `.ysls.json` file.
