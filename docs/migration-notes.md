# Migration notes — removed fork syntax & strictness

The 3.2 parity release ("0.2.0") aligns the language with Yarn Spinner 3.2.2.
Three fork-era extensions were removed outright, and `<<set>>`/`<<declare>>`
now require the `$` variable prefix. Scripts using the removed syntaxes fail
compilation with a `YS0005` (SyntaxError) diagnostic whose message points here.

## 1. Option-condition `[if expr]` suffix → `<<if expr>>` on the option line

The fork's inline option condition is gone; upstream's option-line condition is
the only syntax.

```yarn
// Before (fork syntax — now a YS0005 diagnostic)
-> Ask about the badge [if $hasBadge]
    Narrator: Nice badge!

// After (Yarn Spinner 3.x)
-> Ask about the badge <<if $hasBadge>>
    Narrator: Nice badge!
```

The expression is evaluated when the option list is emitted; unavailable
options are hidden before the runtime surfaces the list (the `Dialogue`
event stream only ever shows available options).

## 2. Inline `{if}{else}{endif}` text blocks → line-level `<<if>>` conditions

Inline conditionals collided with `{expr}` interpolation. Gate whole lines
with the block-form `<<if>>` instead.

```yarn
// Before (fork syntax — now a YS0005 diagnostic)
{if $score >= 10}
    Narrator: High score branch.
{else}
    Narrator: Low score branch.
{endif}

// After (Yarn Spinner 3.x)
<<if $score >= 10>>
    Narrator: High score branch.
<<else>>
    Narrator: Low score branch.
<<endif>>
```

`{...}` in line text is now exclusively variable/function interpolation
(`{$score}`).

## 3. `&css{}` removed → styling is consumer-side

`&css{...}` on nodes, lines, and options no longer exists. Style dialogue in
your consumer (e.g. via markup attributes on the text, or your own component
logic keyed on speaker/tags). There is no replacement syntax in the language;
the React adapter consumes the runtime's structured events and applies its own
presentation.

```yarn
// Before (fork syntax — now a YS0005 diagnostic)
-> Start the adventure &css{backgroundColor: #4a9eff; color: white;}

// After — no language-level styling; use markup or consumer-side logic
-> Start the adventure
```

## 4. `<<set>>`/`<<declare>>` require the `$` prefix

Bare variable names are no longer normalized to `$`-prefixed variables. This
matches upstream 3.x, where every variable reference carries the `$` prefix;
the mismatch now surfaces as a `YS0005` diagnostic at compile time.

```yarn
// Before (fork leniency — now a YS0005 diagnostic)
<<set score to 7>>
<<declare hasKey = true>>

// After (Yarn Spinner 3.x)
<<set $score to 7>>
<<declare $hasKey = true>>
```

## 5. `YarnRunner` → `Dialogue`, `useYarnRunner` → `useDialogue`

The glossary concept is upstream's `Dialogue` — "runner" is retired
vocabulary (CONTEXT.md). The runtime class and the React hook ship under the
new names; the old ones remain as **deprecated, exact aliases for this
release only** and are removed in the release after 0.2.0:

```typescript
// Before (0.1.x)
import { YarnRunner, useYarnRunner } from "yarn-spinner-runner-ts";
const runner = new YarnRunner(program);

// After (0.2.0)
import { Dialogue } from "yarn-spinner-runner-ts";
import { useDialogue } from "yarn-spinner-runner-ts/react";
const dialogue = new Dialogue(program);
```

Note that the 0.1.x `YarnRunner` class already spoke the pull-based API
(`continue()`/`selectOption()`) — only the name changed. The retired
mutate-and-read surface (`advance()`, `currentResult`, `TextResult`) was
removed earlier in the parity wave; see CONTEXT.md "Retired terms".

## 6. Adapter props: `advance` → `continue`, `onStoryEnd` → `onDialogueComplete`

The React adapter's own names were still fork-era vocabulary; they now
match the glossary. The old names remain as **deprecated exact
aliases for one release** — same pattern as §5:

```tsx
// Before (0.2.0)
const { result, advance, selectOption } = useDialogue(program, {
  onStoryEnd: (info) => console.log(info.storyEnd, info.variables),
});
<DialogueView program={program} autoAdvanceAfterTyping pauseBeforeAdvance={500} />;

// After
const { result, continue: continueDialogue, selectOption } = useDialogue(program, {
  // `continue` is a reserved word — destructure it under a local name.
  onDialogueComplete: (info) => console.log(info.dialogueComplete, info.variables),
});
<DialogueRunner program={program} autoContinueAfterTyping pauseBeforeContinue={500} />;
```

- `advance` is the same function as `continue` (identity pinned by the
  alias tests).
- `onStoryEnd` fires only when `onDialogueComplete` is absent, and keeps
  its original payload (`storyEnd: true`); the new callback's payload uses
  `dialogueComplete: true`.
- `DialogueRunner`'s typing-flow props rename with the same verb (the headless
  split moved the wired prop surface from `DialogueView` to
  `DialogueRunner`): `autoAdvanceAfterTyping` → `autoContinueAfterTyping`,
  `autoAdvanceDelay` → `autoContinueDelay`, `pauseBeforeAdvance` →
  `pauseBeforeContinue`.

## Unchanged

- Block-level `<<if>>`/`<<elseif>>`/`<<else>>`/`<<endif>>` and `<<once>>` keep
  working exactly as before.
- Option-line conditions are evaluated by the same expression engine as
  before — only the syntax around them changed.
