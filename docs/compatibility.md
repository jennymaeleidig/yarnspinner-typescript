# Compatibility

This library targets **behavioral parity with Yarn Spinner 3.2.2** — the
newest upstream tag (re-checked at the 1.0.0 release: no `v3.2.3` or `v3.3.0`
exists yet; upstream has announced a future 3.3 but not shipped it).

Parity here means the observable contract upstream's own test suite pins:

- The **conformance corpus** — the `test/fixtures/upstream/YarnSpinner` git
  submodule, pinned byte-exact at upstream tag `v3.2.2` (`Tests/` subtree) —
  drives the compile → run
  pipeline (`src/tests/upstream-conformance.test.ts`). Event streams, not
  bytecode, are the contract (ADR 0001: our program format is this project's
  own versioned JSON, deliberately not upstream's protobuf).
- **Diagnostics** use upstream's stable YS-codes, keyed to the per-code
  registry in the upstream repo (authoritative — the docs errors page is
  stale on severities), plus a local `YP` range for `.yarnproject` loading,
  which upstream has no registry for.
- **Deliberate divergences** (each with a recorded decision, never silent
  drift):
  - Program/bytecode format is our own versioned JSON (ADR 0001/0003).
  - The runtime API is pull-based (`continue()` → `DialogueEvent[]`), the
    Rust port's shape, not upstream .NET's push handlers (ADR 0002).
  - On error diagnostics upstream nulls the program; this project keeps it
    observable.
  - Generated-variable keys mirror upstream's `$Yarn.Internal.*` names and
    separators exactly, leading `$` sigil included (once-state
    `$Yarn.Internal.Once.<id>`, view counts
    `$Yarn.Internal.Content.ViewCount.<id>`), so host-visible storage
    inspection matches upstream. Authored variables keep this project's
    `$`-stripping at the variable-resolution seam; generated keys are
    runtime-internal and read straight from storage.
  - Identifiers (header keys, variable names, enum case names, function
    and type names) use upstream's full ID rule — the shared character
    classes in `src/parse/identifier.ts`, transcribed from the lexer
    grammar's `IDENTIFIER_HEAD`/`IDENTIFIER_CHARACTER` fragments. The one
    remaining ASCII simplification is the YS0027 title/subtitle pass:
    generated node names validate against the ASCII identifier set
    (letters, numbers, underscores), where upstream's lexer would accept
    the extended Unicode ID ranges for titles — a recorded
    simplification, not permissive drift.
  - Expression operators accept tolerated upstream-foreign spellings
    (ADR 0005): a single `=` reads as equality, `===`/`!==` read as
    `==`/`!=`, and the operator word aliases (`and`, `or`, `not`, `xor`,
    `eq`, `is`, `neq`, `gt`, `lt`, `gte`, `lte`) match case-insensitively.
    Upstream 3.2.2's lexer only defines `=`, `==`, `!=` and the lowercase
    alias set (`YarnSpinnerLexer.g4`, the `OPERATOR_LOGICAL_*` rules); the
    extra spellings are permissive drift surfaced by the review, kept for
    content compatibility and recorded here rather than silently
    inherited. Precedence itself matches upstream: comparison binds
    tighter than equality (`expComparison` below `expEquality`).
  - Comparing against an unset variable applies the compared side's
    implicit default (bool→false, number→0, string→""); upstream 3.2.2
    falls back to the program's declared initial values and throws when a
    variable is unset (`VirtualMachine.PushVariable`) — a deliberate
    adaptation so comparisons stay total in the collect-don't-throw
    runtime (coding standards §3).
  - A `<<declare>>` initializer whose constant evaluation fails (a modulo
    by a constant zero — upstream's `NumberType.MethodModulus` throws
    `DivideByZeroException`) reports YS0037 (`InvalidLiteralValue`) at
    compile. Upstream compiles the declare with no diagnostic
    (`ResolveInitialValues` marks the non-literal initializer
    inline-expanded) and fails at runtime when the value is first read;
    the port keeps that runtime behavior (the initializer still lowers to
    a smart-variable slice) and adds the compile-time report so the
    failure is visible at the collect-don't-throw compile seam (coding
    standards §3). A constant `/` by zero stays clean — upstream's
    `NumberType.MethodDivide` is float division (Infinity, no exception).
  - Line-ID collision handling: upstream throws after 1000 suffix attempts;
    this project emits YS0041 and keeps retrying past that cap — no throw
    crosses the seam (coding standards §3).
  - `tagLines` aborts are data, not throws (upstream `TagLines` throws on
    abort), and upstream's 500 ms stopwatch becomes an attempt cap — no
    clocks in the library (coding standards §2/§3).
  - `continue()` while an option set is pending logs a diagnostic and
    returns an empty batch; upstream fails loudly (.NET throws
    `DialogueException`, `VirtualMachine.cs:537–540`; Rust returns
    `Err(ContinueOnOptionSelectionError)`, `virtual_machine.rs:214–224`) —
    no throw crosses the seam (coding standards §3; the tagLines/line-ID
    precedents). `Dialogue.isWaitingForOptionSelection` (Rust
    `is_waiting_for_option_selection`, same name) lets hosts avoid the
    call.
  - `Dialogue.isComplete` is a recorded project extension: upstream
    completion is push-only (the `DialogueComplete` handler/delegate; no
    `IsComplete`/`is_complete` exists in .NET 3.x `Dialogue.cs` or the Rust
    runtime crate). It answers "did the story finish?", not "is it done
    being used?" — `stop()` makes the dialogue inactive without completing
    it, and its complete event still delivers on the next `continue()`.
    The delivery-not-queued contract is what hosts lean on there: after
    `stop()` with an option set pending, the next pull drains the queued
    complete event, so a host awaiting completion after `stop()` is never
    left hanging (corrected Answer).
  - The transcript-reduction module (`pullUntilStopped`/`mergeEvents` and
    their consumers `runUntilStopped`/`runUntilCompleteEvents`, accumulating
    a `Transcript`) is exported non-upstream orchestration over the pull
    API — same standing as the loader. Upstream has
    no transcript
    accumulator; the stopping-point contract it packages (line stops,
    options stop and await selection, commands surface-then-skip, node
    lifecycle and line-hint events ride through, completion terminates) is
    upstream's own batch behaviour, re-delivered and pinned by
    `src/tests/transcript.test.ts` against the upstream semantics cited
    there (.NET `Dialogue.cs` handlers; Rust `Dialogue::continue_`).
  - `NodeStartEvent.scene?` and `Transcript.scene` are recorded project
    extensions: upstream's node-start event carries the node name only, and
    upstream has no transcript. The `scene:` header is an ordinary
    upstream-compatible header; its images and actors are this project's
    scene system (non-upstream, CONTEXT.md glossary), so the name rides the
    node-start event to the one seam where hosts cross-check it against
    their scene collection.
  - The `.yarnproject` loader is this project's own
    surface (non-upstream).
  - Uncompilable state statements (`<<set>>`/`<<declare>>`/`<<call>>` with
    trailing garbage) emit the upstream compile diagnostic (YS0005) but also
    execute at runtime through the raw-command fallback — upstream never
    executes them. The fallback is collect-don't-throw: a failed evaluation
    logs a runtime diagnostic and skips the write (a prior value survives;
    a void host function still writes `undefined`), so a garbage statement
    never silently clobbers storage (coding standards §3; the
    `continue()`-while-pending precedent).
  - Debug output (`projectDebugInfo`, upstream `ProjectDebugInfo`) carries
    per-instruction source ranges reconstructed from the lowered program
    against the parsed documents, not recorded during code generation like
    upstream's (`CodeGenerationVisitor`). Line, option, and saliency-candidate
    instructions (and the gate bytecode in front of them) resolve exactly to
    their statement's source line; command/jump instructions locate their
    authored text in the node's region. Instructions after the last locatable
    anchor carry no range — `getLineInfo` throws for them, mirroring
    upstream's `ArgumentOutOfRangeException`.
  - No v1→v2 syntax upgrader ships: upstream 3.2.2 removed it (upstream
    CHANGELOG 2.4.1, "Removed the Yarn Spinner v1 to v2 upgrader"; its
    `TestUpgradingFiles` theory is skipped and the `Tests/Upgrader/`
    fixtures are gone). The port carries the surviving surface —
    `TextReplacement`/`applyReplacements` and the `UpgradeJob`/
    `UpgradeResult` shapes (`src/compile/upgrader.ts`) — and
    `languageUpgrader.upgrade` throws `Upgrade type {type} is not
supported.` for every upgrade type, exactly as upstream does. Legacy
    v1/v2 content is not auto-migrated, matching upstream.

## Program format: version 2 (upstream 3.2.2 parity)

The compiled program is this project's own versioned JSON (ADR 0003), now
at `languageVersion` **2** (`programLanguageVersion`, `src/compile/program.ts`):

- **Node headers are retained** — every compiled node carries its raw
  `headers` as authored (upstream `Node.Headers`), including the `tags:`
  header's raw text, plus `sourceFile`/`startLine` provenance. This is what
  the `Dialogue` query surface reads (`nodeExists`, `nodeNames`,
  `getStringIDForNode` — upstream `Dialogue.cs:939/1014–1060/1113` — and
  `GetHeaders`/`GetHeaderValue`).
- **Node-group members carry upstream's unique names** (upstream
  `Utility.GetNodeUniqueName`): `when:`-bearing members are renamed to
  `Title.Subtitle` or `Title.<crc32(fileName + title + startLine)>` and
  registered in the node table under it, so each member is individually
  jump-addressable; the hub node keeps the source title and selects a
  member by saliency when jumped to. Member saliency content IDs and
  once-state keys derive from the unique name — upstream's shape, replacing
  the pre-upgrade `Title.<index>` fallback.
- Node-table insertion order matches upstream `Compiler.cs`: source-order
  nodes (members under their unique names) first, then the appended hub
  entries.

## Historical fork syntax

Fork-era extensions removed for parity (option `[if]` suffixes, inline
`{if}{else}{endif}` blocks, `&css{}`, bare `<<set>>` variables) are
documented with before/after examples in
[migration-notes.md](./migration-notes.md). The retired runtime vocabulary
(`YarnRunner`, `advance()`, `currentResult`, …) is reconciled with the
shipped API in [CONTEXT.md](../CONTEXT.md) under "Retired terms".

The old compatibility checklist this file replaces described long-fixed gaps
(`{if}` blocks, missing substitution, missing `<<declare>>`) as current and
is gone; per-feature documentation lives in the language docs under
[`docs/`](.), each citing its upstream source URL.

## Known issues

- A ternary expression (`a ? b : c`) in `<<declare>>`/`<<set>>` is
  rejected at compile with YS0005 (upstream has no ternary); if the
  content reaches the runtime's raw-command fallback anyway, the fallback
  logs a failed-evaluation diagnostic and leaves the variable unset —
  collect-don't-throw, never silent (coding standards §3). Branch with
  `<<if>>` instead (the language docs are already corrected).
- Conformance-harness note: the upstream testplan hashtags are parsed but
  not asserted — upstream's own assertion on them is dead code, and one
  upstream fixture's plan has a hashtag its own compiler cannot parse.
