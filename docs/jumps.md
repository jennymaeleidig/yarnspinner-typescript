## Jump Command (Yarn Spinner)

Source: [docs.yarnspinner.dev — Jump Command](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/jumps)

### What it covers
- **`<<jump NodeTitle>>`**: transfer execution to another node by title.
- Visualized in graph views as an arrow to the target node.
- Works across files; node titles must be unique in the project.

### Example
```yarn
title: Start
---
Narrator: Proceeding to the next scene.
<<jump NextScene>>
===

title: NextScene
---
Narrator: We are in the next scene.
===
```

### Implementation notes (this runtime)
- Jump destinations may be braced expressions: `<<jump {"Node3"}>>` or
  `<<jump {$var}>>` are evaluated at jump time (upstream 3.2).
- A jump exits the current node entirely: the exit records a visit, and
  detoured nodes on the return stack record theirs (upstream records visits
  on node return).
- The `tracking: never` node header suppresses visit recording for that node
  (spec story 22 / issue 13).
- The runtime API exposes `setNode(title)` for host-initiated jumps (upstream
  `Dialogue.SetNode`).


