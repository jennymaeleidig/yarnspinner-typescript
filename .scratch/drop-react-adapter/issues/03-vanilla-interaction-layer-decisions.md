# 03: What do the vanilla hosts own? The adapter's presentation opinions

**Type:** grilling

**The question:** The adapter embodied four presentation opinions. With it gone, each needs an owner: **recipe-in-docs** (a documented pattern hosts copy), **demo-owned code** (implemented once in an example, cited from docs), or **dropped** (the opinion dies with the adapter). Decide per opinion — these are human-taste calls, not implementation details:

1. **Continue scheduling** — auto-continue after commands finish, after typing completes, after option selection. The vanilla demo needs *some* continue story (a button at minimum); how much of the adapter's automatic scheduling survives as demo code vs. a documented pattern?
2. **Typing effect** — `TypingText` char-by-char reveal with its timing. Re-implement vanilla, or is a plain text swap good enough for the examples?
3. **Markup rendering** — `MarkupRenderer` turned markup attributes into styled spans. The vanilla demos need *something* (or raw text); who owns the mapping now?
4. **View shaping** — `reshapeView`/`DialogueViewOption` turned `Transcript` entries into render-ready view objects. Vanilla hosts read `Transcript` directly; is that the documented contract now (docs show how), with no shaping helper at all?

**Constraints (do not re-litigate):** no new package-surface helpers — nothing React-shaped or presentation-shaped re-enters the core; the browser demo keeps its acceptance-harness role (04); the Next SSR path stays (05). The grilling should also settle how much vanilla demo code is *teaching material* (heavily commented, cited from docs) vs. *just a demo*.

**Blocked by:** 01 (the audit says what behavior is being discussed).

**Status:** resolved

## Answer

The human ruled in one stroke: the examples are **"just a demo"** — not teaching material. Every ruling below derives from that one ruling and is reopenable only if a demo proves unusable to play.

1. **Continue scheduling — dropped as an automatic mechanism; demo-owned minimal manual continue.** No auto-continue after commands, typing, or selection. The vanilla demo gets the minimum a playable dialogue needs: the user acts (clicks a continue button / picks an option), the host calls `continue()` and reads the returned events. No timers, no scheduler code.
2. **Typing effect — dropped.** Plain text swap. No char-reveal, no timing code in any example.
3. **Markup rendering — dropped.** Demos render plain text. The core markup API stays package surface for hosts who want it; no styling-mapping code ships anywhere in this repo.
4. **View shaping — dropped.** No shaping helper, no view types. Hosts read `Transcript` directly; ticket 06's docs describe the read-and-act pattern in as many words as it takes, no more.

**Teaching material: no.** The demos are minimal, lightly commented, and cited from docs only where the docs already needed an example. No doc-referencing comments farming the demo as a tutorial.

Net effect for 04/05: the rewrites are *deletion-shaped* — each example shrinks to construct `Dialogue`, render the current line + options as plain text, act on input, repeat. Nothing from `useDialogue`/`DialogueView`'s behavior is ported except the bare manual-continue loop.

## Comments
