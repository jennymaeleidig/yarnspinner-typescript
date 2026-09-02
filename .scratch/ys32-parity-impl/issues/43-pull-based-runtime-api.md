# 43: Pull-based runtime API reshape

**What to build:** consumers drive dialogue by pulling — `continue() → DialogueEvent[]` with the upstream camelCased event vocabulary (`Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, opt-in `LineHints`, `DialogueComplete`); `advance()` is gone, replaced by `selectOption(index | noOptionSelected)` with the fall-through, `setNode()`, `stop()`; state commands never surface as `Command` events; a Library-style registry replaces the functions-map/handleCommand split; runtime diagnostics surface as `logError`/`logDebug` option callbacks.

This is an expand–contract: add the new API beside the old, port the suite in batches, remove `advance()`/old registration last so CI stays green throughout.

**Blocked by:** 23 (needs the diagnostics callbacks).

**Status:** done

- [x] Full existing suite ported and green on the event-stream API (225 tests, node --test)
- [x] Conformance harness runs on the new API (src/tests/upstream/testBase.ts rewritten over Dialogue; 102 fixture checks green incl. ShortcutOptions fall-through cases)
- [x] `advance()` and the old registration path removed (runner.ts, results.ts, CommandHandler class deleted; `parseCommand` kept; exports updated)
- [x] No-option-selected fall-through observable in the event stream (`selectOption(noOptionSelected)` pushes a resume block past the options instruction; covered in dialogue.test.ts and ShortcutOptions.yarn `select: 0` plans)

Notes:
- Declares are initializations, not assignments: a re-executed `<<declare>>` skips storage that already holds a value (upstream InitialValues semantics; host writes win). This retired the old "declare re-seeds on re-entry" fork behavior noted in smartVariables tests.
- Library command handlers receive quote-stripped parameters; evaluator reads functions via `Library.getFunction`.
- React hook `useYarnRunner` wraps `Dialogue` with a batch-reducing view state; DialogueView renders the full option set with unavailable options disabled.
