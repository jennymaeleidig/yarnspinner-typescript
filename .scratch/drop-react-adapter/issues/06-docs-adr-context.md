# 06: Docs, ADR, CONTEXT — record the removal

**What to update:** Everywhere the adapter is documented goes React-free or records the removal:

- **README.md** — remove the React subpath from install/import examples and the peer-dependency story.
- **docs/scenes.md, docs/migration-notes.md, docs/direct-import.md** — remove or rewrite adapter references; direct-import.md's framework-boundary statement gains the vanilla-runtime story the examples now demonstrate (recipes from ticket 03's decisions land here).
- **ADR** — the human decides the shape (part of this ticket): amend ADR 0006 (framework-agnostic package boundary) to record that the adapter was removed, or write a short superseding ADR. The ADR must capture *why*: the root React-free split was a halfway house; the end state is hosts own their UI against `Dialogue`/`Transcript`.
- **CONTEXT.md** — glossary fallout: any domain terms that only existed for the adapter (`DialogueView`, `DialogueViewOption`, view shaping) are dropped or re-scoped; the domain stays core-only.
- **The prior .scratch efforts** — no edits (they are historical record); the supersession is already recorded on this map.

**Blocked by:** 04, 05 (docs describe what the examples actually do).

**Status:** resolved

## Comments

## Answer

The human ruled: amend ADR 0006 in place, no superseding ADR. All living docs now tell the adapter-free story; the suite/lint/ts-check gates are green.

**Files changed (what each says now):**

- **docs/adr/0006-framework-agnostic-package-boundary.md** — amended in place: new section "## Amendment (2026-09-04): the React adapter is removed". Records that `./react` was a halfway house, the adapter (src, export, peers, every `react` dependency) is gone entirely, the package root is the whole story (framework-agnostic core; hosts own their UI against `Dialogue`/`Transcript` directly), and that this completes — not reverses — the boundary the ADR drew. Voice matched to the existing ADR; original decision text untouched.
- **README.md** — tagline and the intro framing drop the adapter (framework-agnostic: hosts own their UI); Features drop the React hook/components and typing-animation lines, markup reworded to structured attributes, scene system reworded to `NodeStartEvent`/`Transcript.scene` delivery; "React Usage" / "Full Example Component" / "Typing Animation" sections deleted; API Reference "React Components" section deleted (Scene System section kept, re-scoped to host input + the scene-name seam); Browser Demo tab description matches the vanilla demo (`StoryletsDemo.ts`, plain text, manual continue); Next.js test filename corrected to `nextjsHost.test.ts`; project structure drops `src/react/`; docs list drops the two deleted React feature docs; `NodeStartEvent` bullet drops "adapter-side".
- **docs/scenes.md** — the system re-scoped: the runtime delivers the scene name (`NodeStartEvent.scene`, `Transcript.scene` carried forward); parsing, backgrounds, actors, transitions are host-owned. Integration example is now a plain `SceneCollection` data example; the `yd-` CSS-classes section removed (no class convention ships).
- **docs/migration-notes.md** — §3: styling is consumer-side, hosts consume structured events (no adapter sentence). §5: retitle to `YarnRunner` → `Dialogue` only (the alias survives; `useYarnRunner`/`./react` import removed from the before/after). §6: retitled "The React adapter → removed" — records that 0.2.0's prop renames died with the adapter; nothing to migrate to.
- **docs/direct-import.md** — "Framework boundary" gains the vanilla-runtime story as its first entry: no framework adapter ships, hosts read `Transcript` raw and render it their way, and the three in-repo examples (browser TS, Next, SvelteKit) demonstrate it — explicitly "just a demo".
- **docs/compatibility.md** — the delivery-not-queued bullet now says hosts lean on it (was "the React adapter leans on… fires onDialogueComplete"); the transcript-reduction module's standing line drops "and the React adapter"; the React component-split divergence bullet removed; loader line drops the adapter.
- **docs/markup.md** — renderer story replaced by the core story: tags parse into `MarkupAttribute`s (name, range, typed properties via `tryGetProperty`), rendering is host-owned; HTML/`yd-markup-` span examples and the `DialogueViewResult`/`TypingText` integration notes removed; example now states the composed text + attributes the runtime actually delivers.
- **docs/typing-animation.md, docs/actor-transition.md** — deleted: both documented React-only components whose features the interaction rulings dropped (no typing effect, no portrait-transition component). No vanilla equivalent ships, so no rewritten replacement.
- **docs/scenes-actors-setup.md** — portrait transition duration is a host presentation choice (no component prop, no 350 ms default); CSS Styling section re-scoped: package ships no stylesheet or class convention, `examples/browser/dialogue.css` is demo-owned.
- **CONTEXT.md** — intro now states the framework-agnostic end state (ADR 0006 amended); Overview drops the React-integration bullet, adds the transcript helpers; "Packaging & consumption (adapter-side)" → "Packaging & consumption" with the no-UI-layer/no-framework-surface core entry; "Adapter-side (non-upstream)" → "Runtime helpers (non-upstream)" holding **Transcript** (re-scoped: hosts read it raw, no longer "adapter-side"/"component state") and **Stopping point**; **Config/live split** and **DialogueRunner/DialogueView** entries dropped; **Scene system** entry re-scoped (no hook's `sceneName`, no `examples/browser/scenes.ts`); **Storylet** points at `StoryletsDemo.ts`; Retired-terms closing paragraph rewritten — the `YarnRunner` alias is the only surviving rename; `useYarnRunner`, the view components, and the prop-vocabulary renames are gone with the adapter.
- **AGENTS.md** — tagline: "Framework-agnostic: hosts own their UI against `Dialogue`/`Transcript` directly."
- **src/tests/index.test.ts:50-52** — the stale ticket-05 clause trimmed from the dist/tests-exclusion comment; the exclusion itself and all assertions unchanged.
- **Not changed:** `CHANGELOG.md` (historical release record), `docs/adr/0001–0005` (decision records), all `.scratch/` efforts (historical), examples source code, `package.json`.

**Sweep findings:** grep for `src/react`, `./react`, `yarn-spinner-runner-ts/react`, `useDialogue`, `useYarnRunner`, `DialogueRunner`, `DialogueView`, `DialogueViewOption`, `TypingText`, `MarkupRenderer`, `DialogueExample`, `DialogueScene`, `scenes.ts`, `reshapeView`, `scheduleContinue`, `view shaping`, `yd-` classes, "typing animation" across README.md, CONTEXT.md, AGENTS.md, docs/**, examples/*/README.md: clean. Surviving mentions are all intentional: the removal records themselves (ADR 0006 amendment, migration-notes §6, CONTEXT Retired terms), Next.js's own React client / RSC boundary, SvelteKit's `adapter-static` package name, and ADR 0002's historical decision text. `examples/*/README.md` were already adapter-free (04/05 rewrote them).

**Gate results:** `npm test` — 626 pass / 0 fail / 1 pre-existing skip (fully green); `npm run lint` — green; `npm run ts-check` — green.

The effort is complete: tickets 01–06 all resolved, fog exhausted.
