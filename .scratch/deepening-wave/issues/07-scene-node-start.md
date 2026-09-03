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

**Status:** open

- [ ] `NodeStartEvent.scene?` shipped; the per-event stamping and the
      view-result `scene` fields gone
- [ ] Scene/image mismatch is checkable at one seam (host-side, at
      node start)
- [ ] `parseScenes` + `js-yaml` out of the package; demo builds green;
      `dependencies` empty
- [ ] CONTEXT.md scene-system entry updated; suite green, lint clean
