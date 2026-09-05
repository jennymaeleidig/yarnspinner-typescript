## Enums (Yarn Spinner)

Source: [docs.yarnspinner.dev — Enums](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/enums)

### What it covers

- Define named sets of values for clarity and safety.
- Compare enum values in conditions and assignments.
- Raw values: uniform per enum (all number or all string); if any case declares one, all must; omitted raw values are auto-numbered from 0; comparisons `==`/`!=` are only valid within the same enum.

### Raw values

```yarn
<<enum Planets>>
<<case Mercury = 1>>
<<case Venus = 2>>
<<case Earth = 3>>
<<endenum>>

<<enum QuestObjectives>>
<<case Objective1 = "DoObjective1">>
<<case Objective2 = "DoObjective2">>
<<endenum>>
```

Raw values are what variables hold at runtime, so `string(QuestObjectives.Objective1)` yields `"DoObjective1"`. Cases without raw values get consecutive numbers starting at 0; a case may not mix number and string raw values in one enum.

Host code can define enums from TypeScript with `EnumTypeBuilder` and pass them to `compile()`/`compileSource()` via `declarations.enums`; they participate in compile-time checking and appear in the compile result's `userDefinedTypes` (see `docs/adr/0004-enum-representation.md`).

### Example

```yarn
<<enum Mood>>
<<case Happy>>
<<case Neutral>>
<<case Sad>>
<<endenum>>

title: Setup
---
<<declare $currentMood = Mood.Happy>>
===

title: Check
---
<<if $currentMood == Mood.Happy>>
    NPC: Great to see you!
<<endif>>
===
```
