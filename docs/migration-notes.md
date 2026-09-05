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

`&css{...}` on nodes, lines, and options no longer exists. There is no
replacement syntax in the language: styling is consumer-side — hosts consume
the runtime's structured events (speaker, tags, markup attributes) and apply
their own presentation.

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

## 5. `YarnRunner` → `Dialogue`

The glossary concept is upstream's `Dialogue` — "runner" is retired
vocabulary (CONTEXT.md). The runtime class ships under the new name; the
old one remains as a **deprecated, exact alias for this release only** and
is removed in the release after 0.2.0:

```typescript
// Before (0.1.x)
import { YarnRunner } from "yarnspinner-typescript";
const runner = new YarnRunner(program);

// After (0.2.0)
import { Dialogue } from "yarnspinner-typescript";
const dialogue = new Dialogue(program);
```

Note that the 0.1.x `YarnRunner` class already spoke the pull-based API
(`continue()`/`selectOption()`) — only the name changed. The retired
mutate-and-read surface (`advance()`, `currentResult`, `TextResult`) was
removed earlier in the parity wave; see CONTEXT.md "Retired terms".

## 6. The React adapter → removed

0.2.0 also renamed the React adapter's fork-era prop vocabulary
(`advance` → `continue`, `onStoryEnd` → `onDialogueComplete`, the
typing-flow props to their `Continue` spellings). That surface no longer
exists to migrate to: the adapter has since been removed entirely (ADR 0006,
amended) — the package root is the whole story. Hosts own their UI against
`Dialogue`/`Transcript` directly; there is no `./react` subpath, hook, or
component to update to.

## Unchanged

- Block-level `<<if>>`/`<<elseif>>`/`<<else>>`/`<<endif>>` and `<<once>>` keep
  working exactly as before.
- Option-line conditions are evaluated by the same expression engine as
  before — only the syntax around them changed.
