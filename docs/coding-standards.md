# Coding Standards

Standing rules for this repository — binding for human and agent contributors alike. Each rule exists because violating it cost us something concrete.

## 1. Upstream is the source of truth

Behavior divergences from Yarn Spinner 3.x require a deliberate, recorded decision (ticket, ADR, or spec note) — never silent drift. When docs and upstream disagree, the upstream source (grammar, per-code diagnostic registry, changelog) is authoritative, not the docs site, and not our own `docs/` transcriptions.

*Case study: the docs errors page lists severities and codes that diverge from the 3.2.2 source registry; our old README documented a ternary that never existed.*

## 2. No I/O in the library

The library never reads files, globs, clocks, or networks. Hosts provide sources, text, and time. This keeps the package browser-safe by construction. The only permitted dependency style is pure data in, pure data out.

*Case study: the compile API takes `{ name, source }` entries precisely so no glob/filesystem code can leak in.*

## 3. Collect, don't throw

Problems are data: diagnostics with stable codes, severities, and ranges, returned with results. Throwing is an explicit opt-in (strict mode). No bare `throw` crosses the public API boundary.

*Case study: the fixture corpus asserts expected diagnostic codes — impossible if the first problem throws.*

## 4. Resettable state lives in variable storage

All story state — once-seen content, visit counts, saliency history — is stored as generated variables in the pluggable variable storage. Module-level mutable state is forbidden.

*Case study: the once-state bug where module-level sets leaked across all runner instances.*

## 5. Naming mirrors upstream concepts

Use the canonical glossary in `CONTEXT.md`. Upstream concept names render in camelCase; never invent synonyms. "Runner", "engine", "machine" are not synonyms for the runtime (`Dialogue`). If a term is missing from the glossary, that's a signal: reconcile it there first.

## 6. Tests only through public seams

Tests assert observable behavior — compiled outputs and runtime event streams — against the vendored upstream fixture corpus and ported upstream tests. No tests against internals, opcode layout, or private modules. The vendored corpus is pinned by upstream tag.

*Case study: the golden-test design in `.scratch/ys32-parity/spec.md` (seams: compile→run pipeline; runtime line parser).*

## 7. Docs must match reality

Every reference transcription in `docs/` cites its source URL. Claims about upstream behavior are verified against the authoritative source before being documented. Stale docs get fixed or deleted in the same change that makes them stale — a compatibility checklist that describes long-fixed gaps as current is worse than no checklist.
