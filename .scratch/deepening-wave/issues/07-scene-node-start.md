# 07: Scene on NodeStartEvent; js-yaml leaves

**What to build:** fix the scene system's split-brain and evict the
library's only runtime dependency.

**Today:** the scene *name* travels Program → VM (`currentScene`,
vm.ts:254) → `Dialogue` facade → stamped onto **every** view-result variant
by the hook, while scene *images* come from a host-provided
`SceneCollection` keyed by name that nothing cross-checks (mismatch =
silent no-background). Separately, `src/scene/parser.ts` (`parseScenes`) is
exported from the package root, is the **only** consumer of `js-yaml`
(the package's sole `dependencies` entry), serves exactly one in-package
consumer (`DialogueExample.tsx`), and throws + `console.error`s on bad
YAML — violating coding-standards §2 and §3, the policies the rest of the
loader already follows.

**Decisions (binding):**
- `scene` moves to **`NodeStartEvent`** — its natural home: one delivery
  per node, not per event. Removed from the three `DialogueViewResult`
  variants; `DialogueScene.tsx` consumes it from the node-start event (the
  hook derives it internally — implementation detail). `DialogueScene`'s
  transition behaviour is unchanged.
- **Both breaks land together** (0.2.0 unpublished — verified): the
  `DialogueViewResult` type-level break and `parseScenes` leaving the
  package root. Scene *types* (`src/scene/types.ts`) stay exported —
  `NodeStartEvent` now carries one.
- `parseScenes` moves to the demo (`examples/browser/`) taking `js-yaml`
  with it; `dependencies` ends empty. Alternative (re-homing it behind the
  loader's diagnostics contract) only if the demo move is blocked — record
  the choice.
- Scene remains adapter-side/non-upstream (CONTEXT.md already marks it);
  `NodeStartEvent.scene` is optional — absent when the node has no
  `scene:` header.

**Blocked by:** 04 (touches `useDialogue.tsx`/view-result types; land after
the adapter wave settles them)

Type: task

**Status:** resolved

- [x] `NodeStartEvent.scene?` shipped; the per-event stamping and the
      view-result `scene` fields gone
- [x] Scene/image mismatch is checkable at one seam (host-side, at
      node start)
- [x] `parseScenes` + `js-yaml` out of the package; demo builds green;
      `dependencies` empty
- [x] CONTEXT.md scene-system entry updated; suite green, lint clean

## Answer

Landed, both breaks together (0.2.0 unpublished). The scene name travels
one channel now: `NodeStartEvent.scene?` (stamped by `enterNode` off the
resolved member node, so node groups resolve the same way `currentScene`
did) → `Transcript.scene` (the reduction module merges it, carried forward
across scene-less nodes — the same stickiness the view's "last background"
behavior already had) → the hook's `sceneName` return. The per-event
stamping in `reshapeView` and the `scene?` field on all three
`DialogueViewResult` variants are gone; `DialogueScene`'s transition
behavior is unchanged (the command-view scene pin — "keeps scene visible
during command results" — passes untouched, and is now *more* correct: the
hook's sticky `sceneName` reaches command views too, where the old
per-result stamp silently delivered `undefined`).

**The second channel died.** `Dialogue.currentScene`, `VM.currentScene`,
and `RuntimeDriver.currentScene` are deleted — with the event as the
natural home, a synchronous getter re-deriving the same header from VM
internals is exactly the split-brain the ticket names. Hard break, README
updated.

**The mismatch seam.** Scene name and image collection meet at node start:
a host reads `Transcript.scene` (component state, per the Q12 decision) or
the hook's `sceneName` and cross-checks its `SceneCollection` — pinned by
two new transcript tests (header lands on the transcript; scene-less node
keeps the carried scene; a new header replaces it). The library stays
silent on mismatch (no new diagnostic surface was bound); it's now
diagnosable host-side instead of structurally impossible.

**`parseScenes` moved to the demo**, verbatim
(`examples/browser/scenes.ts`, the demo host owning its YAML and parse
failures — the package's only `console.error`-then-throw parser is gone
with it). `DialogueExample` takes `scenes?: SceneCollection` as host input;
`main.tsx` parses the demo YAML and passes it; the package-root export is
deleted (scene *types* stay exported, the binding's exception);
`js-yaml` moved to `devDependencies` — `dependencies` ends empty. The
demo-side choice (not the loader-diagnostics re-home) is recorded here as
the binding's alternative branch requires: nothing blocked it.

CONTEXT.md's scene entry rewritten (one channel, demo-side parser,
no scene dependency); `docs/scenes.md`'s `parseScenes` integration example
rewritten to host-data; compatibility.md gained the divergence entry
(`NodeStartEvent.scene?` / `Transcript.scene` are project extensions —
upstream's node-start event carries the name only and has no transcript).

Verification: suite 546/546 (544 + the two scene pins), lint clean,
ts-check clean, browser demo build green (the moved parser bundles with
the demo), Next.js and SvelteKit hosts green. Staged-adjacent: none —
`future-work.md`'s concurrent-session hunks remain untouched.
