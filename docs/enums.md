## Enums (Yarn Spinner)

Source: [docs.yarnspinner.dev — Enums](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/enums)

### What it covers
- Define named sets of values for clarity and safety.
- Compare enum values in conditions and assignments.

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


