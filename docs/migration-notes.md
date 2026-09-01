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

## Unchanged

- Block-level `<<if>>`/`<<elseif>>`/`<<else>>`/`<<endif>>` and `<<once>>` keep
  working exactly as before.
- Option-line conditions are evaluated by the same expression engine as
  before — only the syntax around them changed.
