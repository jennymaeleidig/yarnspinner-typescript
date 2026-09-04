## Markup (Yarn Spinner)

Source: [docs.yarnspinner.dev — Markup](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/markup)

### Supported formatting

The runtime parses Yarn Spinner markup and surfaces it through the `Line`
event's `markup` property (and each option's `markup` in the `Options`
event). Rendering is host-owned — the runtime delivers structured data, not
HTML.

- Every tag parses into a `MarkupAttribute`: its name, the character range of
  the composed text it covers (`position` + `length`), and its properties.
- `[wave speed=2]` carries a `speed` property; values are typed
  (`MarkupValue`: integer, float, string, bool) and read with
  `tryGetProperty`.
- Tags nest: a tag inside another tag's range is a child attribute, so a host
  can render hierarchy however it likes.

### Example

```yarn
title: Start
---
Narrator: Plain [b]bold[/b] [wave speed=2]custom[/wave]
===
```

The line's composed text is `Plain bold custom`, carrying two attributes:
`b` over `bold`, and `wave` over `custom` with a `speed` property of `2`
(`tryGetAttributeWithName` and `textForAttribute` read them back).

### Integration notes

- Markup data is available on `LineEvent.markup` and on each option entry (`OptionsEvent.options[i].markup`).
- Custom tags parse like built-ins: nothing is stripped, so a host can key its own styling on any tag name.

For the full markup vocabulary see the official Yarn Spinner documentation.
