# Ticket 02 — Derive DialogueViewOption from DialogueOption

Type: task
Status: open

## Question

`DialogueViewOption` restates `DialogueOption` field-for-field (index, text,
tags, markup, isAvailable — same members, same optionality, only declaration
order differs), and `reshapeView`'s options branch re-copies every field by
hand. `TranscriptLine` next door solved the identical problem the right way:
`Omit<LineEvent, "type">` ("derived, so the two shapes cannot drift"). The
option shape has no such derivation, so a new field on `DialogueOption`
compiles fine everywhere and silently drops between runtime and view.

## Evidence

- `src/react/useDialogue.tsx` — `DialogueViewOption` (:60–66), `reshapeView` options branch (:168–210)
- `src/runtime/events.ts` — `DialogueOption` (:44–63)
- The prior review fix (04c0920) explicitly blessed the `TranscriptLine`
  derivation for lines; options were missed.

## Work item

`export type DialogueViewOption = DialogueOption` (adapter-side alias, matching
the `TranscriptLine` derivation), and pass `transcript.options` through (or
spread) instead of field-copying. Consider the same treatment for the `text`
branch's `Omit<LineEvent, "type">` if it collapses cleanly.

Deletion test: `reshapeView`'s options branch is close to a pure pass-through
that exists only because the type was re-declared.

## Tests

- A type-level pin that a field added to `DialogueOption` flows to
  `DialogueViewOption` (the existing copied shape could not catch a dropped
  field).
- Existing `adapterOptions.test.tsx` / `dialogue_view.test.tsx` pins unchanged.

## Constraints

- Structurally non-breaking; still run demo/next/sveltekit builds (map Fog
  item: confirm no host depends on the copy's declaration-order quirks).
- No ADR tension (adapter-side only).
- Suite green, lint clean, ts-check clean per CODING_STANDARDS.
