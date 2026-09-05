## Nodes and Lines (Yarn Spinner)

Source: [docs.yarnspinner.dev — Nodes and Lines](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/lines-nodes-and-options)

### What it covers

- **Nodes**: titled containers for dialogue. Headers above `---`, body between `---` and `===`.
- **Lines**: dialogue or narration lines emitted to the game one at a time.
- **Character prefix**: `Name: Dialogue` marks the speaking character.
- **Node rules**: titles start with a letter or underscore; letters/numbers/underscores only; no `.`.

  Implementation note: this runtime's YS0027 pass enforces the leading
  letter/underscore rule (upstream lexer `IDENTIFIER_HEAD`) and the
  letters/numbers/underscores set for titles and subtitles; upstream's
  extended Unicode ID ranges are not accepted for titles/subtitles — the
  recorded ASCII simplification (see docs/compatibility.md). Other
  identifiers (header keys, variables, enum cases) accept the full
  upstream ID ranges via the shared classes in `src/parse/identifier.ts`.

### Basic structure

```yarn
title: Start
---
Narrator: Hi, I'm the narrator for the documentation!
===
```

### Character speaking vs narration

```yarn
This is a line of dialogue, without a character name.
Speaker: This is another line said by a character called "Speaker".
```

### Tips

- Use multiple nodes to manage long or branching stories.
- Additional headers (e.g., `color:`, `group:`) organize nodes in editors.
- The game decides how to render each delivered line.
