# 52: React adapter + demo migration

**What to build:** the React adapter and browser demo work on the new runtime API — demo green as the acceptance harness, plus a node-group/saliency storylet demo exercising strategy switching. Scene/actor system unchanged; React stays in the package; adapter gets only migration, no feature work.

**Blocked by:** 47 (saliency strategies to demo), 48 (markup rendering path).

**Status:** resolved

- [x] Browser demo green on the new API
- [x] Storylet demo exercises saliency strategy switching
- [x] Existing React adapter tests ported and green

## Landing notes (ticket 52)

- **Adapter**: already on the new API since ticket 43's reshape (`useYarnRunner`
  over `Dialogue.continue()`/`selectOption()`); this ticket migrated nothing —
  it verified and pinned. The two ported adapter tests
  (`dialogue_view.test.tsx`) were already green. No adapter feature work, per
  the ticket: the storylet demo drives the runtime through the public
  `Dialogue` API directly, not through new hook surface.
- **Browser demo** (`examples/browser/`): `main.tsx` is now a two-tab shell —
  **Dialogue** (the package's `DialogueExample`, unchanged) and the new
  **Storylets** tab (`StoryletsDemo.tsx`). Build verified via
  `npm run demo:build` + `vite preview` (assets 200, storylet bundle present)
  and the dev server (both entry transforms 200). Two hermetic-build fixes:
  `css.postcss` pinned empty in `vite.config.ts` and a `browserslist` field in
  `package.json` — both stop config searches from walking above the repo root
  (EPERM under restricted sandboxes; ENOENT-and-continue elsewhere).
- **Storylet demo**: one node group, six members with `when:` headers of every
  complexity shape (`always` 0, `not $x` 1, `once` 1, `$x` 1, `once if $x` 2,
  `$x and $y` 2). UI: strategy switcher over the five `<<set_saliency>>`
  modes with upstream-strategy blurbs, a live `getSaliencyOptionsForNodeGroup`
  panel (contentId/complexity/pass/fail), a `hasSalientContent` empty-state,
  story-variable chips, and a draw history. Members' bodies set `$metRogue` /
  `$trustHigh`, so draws unlock further storylets; the two `once` members
  exhaust. Reset proves the saliency history is storage-backed generated
  state (coding standards §4).
- **Tests**: three added to `src/tests/dialogue_view.test.tsx` — SSR of
  `DialogueExample` (the package-level "demo green" harness), SSR of
  `DialogueView` over a node-group program (default strategy deterministically
  picks the `once` member), and the storylet story driven through `Dialogue`:
  complexity table pinned, unknown-mode rejection, the full `best_least_recent`
  walk (rumor → first-meeting → duel → heist), a mid-history switch to `best`,
  and fresh-dialogue `first`/`best` draws. The yarn mirrors
  `StoryletsDemo.tsx` (noted in both files). 412/412.
- **Drive-by (lint)**: four pre-existing unused-symbol lint errors in
  `src/markup/lineParser.ts` and `src/runtime/interpolate.ts` (ticket 48
  debt) fixed — dead `helpers.internalIDproperty` plumbing, an unused import,
  an unused local. Lint now clean.
- **Docs**: `examples/browser/README.md` rewritten for the two tabs; root
  README's Browser Demo section updated (the "live Yarn script editor" claim
  was stale — no editor exists).
- **Not done (by design)**: no adapter feature work; scene/actor system
  untouched; docs overhaul is ticket 53.
