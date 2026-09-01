# Runtime API shape

Type: grilling
Status: resolved
Blocked by: 02 *(resolved — the Rust study is in: see [research/rust-reference-study.md](../research/rust-reference-study.md). Key caveat: YarnSpinner-Rust is a Yarn **2.x** implementation, so treat its API as a porting reference, not a 3.2 feature reference. Its pull-based `continue_() -> DialogueEvent[]` design is the main alternative to the .NET handler model.)*

## Question

Decide the post-parity public runtime API. Inputs: the [repo audit](../research/repo-audit.md) (current `YarnRunner`: single `advance(optionIndex?)`, one `onStoryEnd` callback, plain-object variables, `options.functions` map), the [census §4](../research/ys322-census.md) (upstream `Dialogue`: `Continue`/`SetNode`/`SetSelectedOption`/`Stop`/`NoOptionSelected`, handler set incl. NodeStart/NodeComplete/PrepareForLines/DialogueComplete, `IVariableStorage` + `MemoryVariableStore`, `Library` for functions/commands, pluggable saliency strategy), and the **YarnSpinner-Rust reference study** ([02](./02-rust-reference-study.md)) for how a second implementation drew the same line.

Decide at least: (a) how literally to mirror the upstream `Dialogue` API vs TS-idiomatic naming; (b) handler/event model (callbacks vs EventEmitter vs async iterator); (c) variable storage interface (pluggable? typed bool/number/string like upstream?); (d) once-state as generated variables in storage (upstream mechanism — fixes the global-state bug); (e) whether `advance()` survives as sugar or is replaced. Keep the browser demo working through whatever shape lands.

## Answer

All eight decisions confirmed by the maintainer:

1. **Interaction model: Rust-style pull** — `continue() -> DialogueEvent[]` per step (chosen over .NET push handlers and the fork's mutate-and-read `advance()`); chosen because the golden-test contract (ticket 01's TestBase port) asserts a strict event stream, which a pull API produces directly.
2. **Event set** (camelCased): `Line` (markup + substitutions), `Options`, `Command`, `NodeStart`, `NodeComplete`, `LineHints` (opt-in lookahead), `DialogueComplete`.
3. **Variable storage: pluggable interface** (bool/number/string) + in-memory default — enables resettable generated state and consumer persistence.
4. **`once`-state: upstream generated-variables-in-storage mechanism** (`$content-viewed_<lineId>` style) — fixes the global-state runner bug and matches the 3.2.1 contract.
5. **Registration: `Library`-style registry** for variadic functions + command handlers, replacing the `functions` map / `handleCommand` split.
6. **`advance()` dropped** — replaced by `continue()`, `selectOption(index | NoOptionSelected)`, `setNode(title)`, `stop()`; the React hook migrates, demo stays green.
7. **`NoOptionSelected` fall-through adopted** (3.1 conformance; exercised by fixture `select: 0`).
8. **Injectable text-provider seam built now** — `Line` events carry line IDs + substitutions; provider resolves ID→text (default: compiled base table; `setLanguage` later). Prevents localisation from becoming a breaking change.

Consequences: ticket [13](./13-visit-tracking-header.md) unblocked; the IR/VM fog on the map graduates to [14-ir-vm-redesign.md](./14-ir-vm-redesign.md).

**Amendment (post-review, for traceability)**: the spec's built-in conformance details — `random_range` returns int, min/max/floor family arity corrected, `has_any_content` and `format` added — are adopted here as ticket-05-backed decisions (source: census §2 built-in functions list; the fork's known divergences in research/repo-audit.md). Runtime diagnostics surface as `logError`/`logDebug` option callbacks (decided in ticket 10).
