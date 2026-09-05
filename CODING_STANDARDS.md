# Coding Standards

Standing rules for this repository — binding for human and agent contributors alike. Each rule exists because violating it cost us something concrete.

## 1. Upstream is the source of truth

Behavior divergences from Yarn Spinner 3.x require a deliberate, recorded decision (ticket, ADR, or spec note) — never silent drift. When docs and upstream disagree, the upstream source (grammar, per-code diagnostic registry, changelog) is authoritative, not the docs site, and not our own `docs/` transcriptions.

_Case study: the docs errors page lists severities and codes that diverge from the 3.2.2 source registry; our old README documented a ternary that never existed._

## 2. No I/O in the library

The library never reads files, globs, clocks, or networks. Hosts provide sources, text, and time. This keeps the package browser-safe by construction. The only permitted dependency style is pure data in, pure data out.

_Case study: the compile API takes `{ name, source }` entries precisely so no glob/filesystem code can leak in._

## 3. Collect, don't throw

Problems are data: diagnostics with stable codes, severities, and ranges, returned with results. Throwing is an explicit opt-in (strict mode). No bare `throw` crosses the public API boundary.

_Case study: the fixture corpus asserts expected diagnostic codes — impossible if the first problem throws._

_Sanctioned exception: the Transcript orchestration helper `runUntilCompleteEvents` throws on a stalled drain — past its pull cap, or on a broken stopping-point invariant — a documented, bounded guard whose contract is stated on the function. The silent alternative (returning a partial stream) is the documented anti-pattern the helper exists to replace, so each guard throws a named, self-describing error instead. Story execution itself still never throws._

## 4. Resettable state lives in variable storage

All story state — once-seen content, visit counts, saliency history — is stored as generated variables in the pluggable variable storage. Module-level mutable state is forbidden.

_Case study: the once-state bug where module-level sets leaked across all runner instances._

## 5. Naming mirrors upstream concepts

Use the canonical glossary in `CONTEXT.md`. Upstream concept names render in camelCase; never invent synonyms. "Runner", "engine", "machine" are not synonyms for the runtime (`Dialogue`). If a term is missing from the glossary, that's a signal: reconcile it there first.

## 6. Tests only through public seams

Tests assert observable behavior — compiled outputs and runtime event streams — against the upstream fixture corpus (mounted as a git submodule) and ported upstream tests. No tests against internals, opcode layout, or private modules. The corpus is pinned by upstream tag.

_Sanctioned exception: `src/tests/operands.test.ts` imports the operand operators (`../runtime/operands.js`) directly — that module is the operator contract both drivers dispatch through (the VM's stack ops and the string evaluator's arithmetic/comparison/logical loops), and the table exists to pin them in lockstep; behavioral coverage of the same operators still runs through the public runtime seams._

_Case study: the golden-test design behind the conformance suite (seams: compile→run pipeline; runtime line parser)._

## 7. Docs must match reality

Every reference transcription in `docs/` cites its source URL. Claims about upstream behavior are verified against the authoritative source before being documented. Stale docs get fixed or deleted in the same change that makes them stale — a compatibility checklist that describes long-fixed gaps as current is worse than no checklist.

Citations stay resolvable: cite living artifacts — ADR files, `docs/` pages, registry codes (`YS####`/`YP####`), section numbers of this file — never ephemeral tracker tickets or numbered spec stories, which are working notes and get deleted. A reference whose target no longer exists is stale on arrival.
