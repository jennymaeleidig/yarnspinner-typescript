## Line Groups (Yarn Spinner)

Source: [docs.yarnspinner.dev — Line Groups](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/line-groups)

A **line group** is a collection of lines that begin with `=>`; Yarn Spinner
chooses exactly one of them to run. Think of them like option groups (`->`),
but the computer picks instead of the player:

```yarn
title: Start
---
Captain: Navigator, fire the glitter torpedoes!
=> Navigator: Sir, we don't have 'glitter torpedoes.'
=> Navigator: Weaponizing craft supplies is not standard combat protocol.
=> Navigator: I'll... make a note in the log, sir.
===
```

Conditions can be attached to items, including the `once` keyword:

```yarn
=> Guard: Greetings, citizen.
=> Guard: Hello, traveller.
=> Guard: Hail, adventurer! <<if $player_is_adventurer>>
=> Guard: I used to be an adventurer like you... <<once if $player_is_adventurer>>
```

Which item runs is decided by the active [saliency strategy](saliency.md).
If no item is salient, the whole group is skipped.

### Implementation notes (this runtime)

- Consecutive `=>` lines form one group; comments and blank lines between
  items do not break it. A line group may appear anywhere a statement can
  (inside `<<once>>` blocks, `<<if>>` blocks, and option bodies included).
- An item's `<<if>>`/`<<once>>`/`<<once if>>` modifier becomes the item's
  saliency condition rather than a line gate; a selected `once` item's
  seen-state stores when it runs (upstream: at the item's destination).
- The `=>` prefix is consumed by the lexer; the item goes through the same
  line pipeline as ordinary text (speaker prefix, hashtags, markup,
  substitutions).
