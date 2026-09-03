# 05: useDialogue config/live split

**What to build:** reshape the hook's interface to
`useDialogue(program, config, live)`, killing the rebuild-on-change matrix
in `src/react/useDialogue.tsx` (~60 lines of change detection + per-option
JSDoc paragraphs — today: 8 options × 4 comparison disciplines, including
`haveFunctionsChanged`'s key-wise deep compare, `haveVariablesChanged`'s
double `JSON.stringify` per render, and `logError`/`logDebug` silently
ignored after construction).

**Decisions (binding):**
- **One rule:** config identity = dialogue identity. `config` holds
  construction-only inputs, reference-compared.
- **`variables` stays in `config`** — it seeds state; changing it means a
  new dialogue (same observable outcome as today's rebuild), not live
  re-seeding nobody asked for.
- **`live` is read through a ref** — identity ignored, always current;
  holds callbacks and logging (`onDialogueComplete`, `logError`,
  `logDebug`, and anything else per-call). Setters were considered and
  rejected: they add interface for a problem the ref already solves.
- `haveFunctionsChanged` / `haveVariablesChanged` are **deleted**, not
  hidden — with volatile inputs out of the construction path, they have no
  caller left.
- **Hard break, no alias** (0.2.0 never published — verified, no tags); the
  existing `@deprecated` alias machinery from tickets 55/56 is untouched
  and nothing here extends it.
- `adapterOptions.test.tsx`'s rebuild-matrix tests are rewritten to pin the
  one rule: config identity changes rebuild; `live` changes don't.

**Blocked by:** 04

Type: task

**Status:** open

- [ ] `useDialogue(program, config, live)`; one comparison rule; the matrix
      helpers deleted
- [ ] The frozen-`logError` trap is gone (live logging works after
      construction)
- [ ] Tests pin: config identity = dialogue identity; `live` is always
      current
- [ ] README/useDialogue JSDoc updated; suite green, lint clean
