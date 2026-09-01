# 43: Pull-based runtime API reshape

**What to build:** consumers drive dialogue by pulling — `continue() → DialogueEvent[]` with the upstream camelCased event vocabulary (`Line`, `Options`, `Command`, `NodeStart`, `NodeComplete`, opt-in `LineHints`, `DialogueComplete`); `advance()` is gone, replaced by `selectOption(index | noOptionSelected)` with the fall-through, `setNode()`, `stop()`; state commands never surface as `Command` events; a Library-style registry replaces the functions-map/handleCommand split; runtime diagnostics surface as `logError`/`logDebug` option callbacks.

This is an expand–contract: add the new API beside the old, port the suite in batches, remove `advance()`/old registration last so CI stays green throughout.

**Blocked by:** 23 (needs the diagnostics callbacks).

**Status:** ready-for-agent

- [ ] Full existing suite ported and green on the event-stream API
- [ ] Conformance harness runs on the new API
- [ ] `advance()` and the old registration path removed
- [ ] No-option-selected fall-through observable in the event stream
