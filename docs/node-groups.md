## Node Groups (Yarn Spinner)

Source: [docs.yarnspinner.dev — Node Groups](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/node-groups)

A **node group** is a collection of nodes that share the same title, where
each node has at least one `when:` header. Yarn Spinner combines the group
into a single node that checks the conditions and runs one member — chosen
by the active [saliency strategy](saliency.md). Jumping to (starting
dialogue from, `<<jump>>`, or `<<detour>>`-ing to) the shared title runs the
group:

```yarn
title: Guard
when: once
---
Guard: You there, traveller!
===

title: Guard
when: always
---
Guard: I hear the king has a new advisor.
===

title: Guard
when: $has_sword
---
Guard: No weapons allowed in the city!
===
```

A node may carry multiple `when:` headers (all must hold for it to be
salient). `when: once` content can run a single time; `when: always` always
passes.

### Implementation notes (this runtime)

- Members sharing a title are grouped by the compiler; every member of a
  same-title run must carry at least one `when:` header (YS0031), and
  `subtitle:` values must be unique within the group (YS0032).
- A single node with `when:` headers is a one-member node group (upstream:
  the NodeGroupVisitor processes any node with `when:` headers).
- A member with a `subtitle:` header is qualified as `Title.Subtitle`
  (its visit-tracking key and saliency content ID); members without one get
  `Title.<index>` in this project's program format (upstream uses a
  CRC32-derived name — see `runtime/saliency.ts`).
- If no member is salient when the group runs, the group produces no
  content: the dialogue completes (upstream's hub node returns).
- Runtime queries: `isNodeGroup`, `getSaliencyOptionsForNodeGroup`,
  `hasSalientContent` on the runtime, and the `has_any_content()` function.
