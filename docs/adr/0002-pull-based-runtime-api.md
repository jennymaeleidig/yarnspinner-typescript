# Pull-based runtime API

The fork's runtime was mutate-and-read (`advance()` sets `currentResult`). Upstream's .NET `Dialogue` is push-based (consumer registers handlers; `Continue()` fires them). We decided on the Rust port's third shape: a pull-based API where `continue()` returns the events up to the next stopping point (`DialogueEvent[]`), with `selectOption`, `setNode`, and `stop` alongside. The deciding factor was the conformance contract: upstream's golden fixtures assert strict event streams via a TestBase step-lock runner, which a pull API produces directly and testably. Handlers can be layered on top of events later; the reverse retrofit is painful.

## Consequences

`advance()` and the single `onStoryEnd` callback are removed (breaking, pre-1.0); the React hook migrates to the event stream; opt-in lookahead ships as a `LineHints` event (the Rust treatment of upstream's `PrepareForLines`).

*Amendment note: the React hook's migration was superseded by ADR 0006's amendment, which removed the React adapter entirely.*
