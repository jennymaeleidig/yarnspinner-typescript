# 01: Demo compiles through the public seam

**What to build:** port `src/react/DialogueExample.tsx` from
`compileDocument()` (throwing, AST-level) to `compileSource()` — the
collect-don't-throw public seam from ticket 49. Deletes the `try/catch` +
`setError` plumbing and the hand-built empty `Program` literal
(`{ languageVersion, nodes: {}, enums: {}, initialValues: {}, smartVariables: {} }`)
that exists only to satisfy the throwing path. The demo content is a single
string, so this is a one-line-scale change — deliberately lands first in the
wave so the package's own demo stops teaching the pre-§3 anti-pattern today.

Background: `compile()` (files) is the seam; `compileSource()` is the thin
single-file convenience; `compileDocument` is the AST-level internal entry
still used by 15 test files and exported from the package root. Ticket 09
owns its demotion — this ticket only moves the demo.

**Blocked by:** None (can start immediately)

Type: task

**Status:** resolved

- [ ] `DialogueExample.tsx` uses `compileSource()`; the `try/catch` and the
      empty-`Program` literal are gone
- [ ] Demo renders and plays as before (browser demo build green)
- [ ] No public surface change; suite green, lint clean

## Answer

Landed. `DialogueExample.tsx` now compiles through the public seam
(`compileSource` from `../compile/compileSource.js`); the `try/catch` +
`setError` plumbing, the `parseYarn`/`compileDocument`/`programLanguageVersion`
imports, and the hand-built empty-`Program` literal are all deleted.

One discovery beyond the ticket's one-line-scale estimate: the seam runs the
validate + type-check passes that AST-level `compileDocument` skips, so the
demo's two runtime-seeded variables (`$playerName`, `$reputation`) came back
as **YS0029 errors** ("can't determine the type") until the host declared
them via `declarations.variables` (`playerName: { type: "string" }`,
`reputation: { type: "number" }`). The demo now teaches the correct host
pattern: compile-time external declarations mirror the runtime seeds passed
to `DialogueView`'s `variables`. Verified against the demo content directly
before porting (program non-null, `hasErrors` false with declarations).

Shape of the port: `useMemo` calls `compileSource(yarnText, { declarations })`;
error-severity diagnostics render in the existing red banner (code + message
per diagnostic); `<DialogueView>` renders conditionally on `program` (TS
narrows the `Program | null`), so the null-program path shows diagnostics
instead of an empty shell.

Verification: suite 521/521 (incl. "DialogueExample (the browser demo)
renders its opening line"), `ts-check` clean, `lint` clean, `demo:build`
green. No public surface change — only the demo component moved. The
`parseScenes` try/catch stays: scene parsing is ticket 07's seam, not this
one. Implication noted for ticket 09: `compileDocument` lacks the
type-check pass entirely, which strengthens the case for its demotion.
